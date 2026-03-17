/**
 * Dumb consumer — connects to PUBLIC mesh (meshprotocol.dev).
 * Asks one math question; uses tool to request from mesh specialist, returns answer via OpenAI.
 * Loads .env from parent (NATS_TOKEN, REGISTRY_URL, OPENAI_API_KEY).
 */

import { Agent, InMemory, Tool } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient } from "@meshprotocol/sdk";
import { z } from "zod";
import { createDataPlaneClient, parseGrpcEndpoint, grpc } from "../shared/dataplane.js";
import {
  buildHandshakePayload,
  createX25519Ephemeral,
  decryptChunk,
  deriveSessionKey,
  encryptChunk,
  exportEd25519PublicKeyBase64,
  exportX25519PublicKeyBase64,
  exportX25519PublicKeyBytes,
  importX25519PublicKeyBase64,
  loadEd25519PrivateKeyFromBase64,
  publicKeyFromBase64,
  signEd25519,
  verifyEd25519,
} from "../shared/security.js";
import crypto from "node:crypto";

const DEFAULT_HOST = "nats.meshprotocol.dev";
const DEFAULT_PORT = "4222";

function getNatsServerUrl() {
  const raw = (process.env.NATS_URL || "").trim();
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  if (raw.startsWith("nats://")) {
    try {
      const u = new URL(raw);
      if (u.hostname && u.hostname.includes(".")) {
        host = u.hostname;
        port = u.port || DEFAULT_PORT;
      }
      return `nats://${host}:${port}`;
    } catch (_) {}
  }
  if (raw.includes(".")) {
    const [h, p] = raw.split(":");
    if (h) host = h;
    if (p && /^\d+$/.test(p)) port = p;
  }
  return `nats://${host}:${port}`;
}

const NATS_SERVER = getNatsServerUrl();
const NATS_TOKEN = (process.env.NATS_TOKEN || "").trim();
const REGISTRY_URL = process.env.REGISTRY_URL || "https://api.meshprotocol.dev";
const CONSUMER_DID = "did:mesh:agent:public-demo-consumer";
const REQUEST_TIMEOUT_MS = 25_000;
const RESULT_TIMEOUT_MS = 15_000;
const CONSUMER_ED25519_PRIVATE_KEY_BASE64 = (process.env.CONSUMER_ED25519_PRIVATE_KEY_BASE64 || "").trim();
const ALLOW_LEGACY_DATAPLANE = (process.env.ALLOW_LEGACY_DATAPLANE || "").trim() === "1";
const DATAPLANE_ALLOW_INSECURE = (process.env.DATAPLANE_ALLOW_INSECURE || "").trim() === "1";
const DATAPLANE_TLS_CA_CERT_PATH = (process.env.DATAPLANE_TLS_CA_CERT_PATH || "").trim();
const DATAPLANE_TLS_CLIENT_CERT_PATH = (process.env.DATAPLANE_TLS_CLIENT_CERT_PATH || "").trim();
const DATAPLANE_TLS_CLIENT_KEY_PATH = (process.env.DATAPLANE_TLS_CLIENT_KEY_PATH || "").trim();
const DATAPLANE_TLS_SERVER_NAME = (process.env.DATAPLANE_TLS_SERVER_NAME || "").trim();
const nowMs = () => Date.now();

if (!process.env.OPENAI_API_KEY) {
  console.error("[Consumer] OPENAI_API_KEY is required (set in .env).");
  process.exit(1);
}
if (!process.env.NATS_TOKEN) {
  console.error("[Consumer] NATS_TOKEN is required for public mesh (set in .env).");
  process.exit(1);
}
if (!CONSUMER_ED25519_PRIVATE_KEY_BASE64) {
  console.error("[Consumer] CONSUMER_ED25519_PRIVATE_KEY_BASE64 is required.");
  process.exit(1);
}

async function main() {
  console.log("[Consumer] Connecting to PUBLIC mesh (meshprotocol.dev)...\n");

  const consumerPrivateKey = loadEd25519PrivateKeyFromBase64(CONSUMER_ED25519_PRIVATE_KEY_BASE64);
  const consumerPublicKey = crypto.createPublicKey(consumerPrivateKey);
  const consumerPublicKeyBase64 = exportEd25519PublicKeyBase64(consumerPublicKey);
  const consumerStaticKeyAgreement = createX25519Ephemeral();
  const consumerKeyAgreementPublicBase64 = exportX25519PublicKeyBase64(consumerStaticKeyAgreement.publicKey);

  const mesh = new MeshClient({
    natsUrl: NATS_SERVER,
    registryUrl: REGISTRY_URL,
    did: CONSUMER_DID,
    region: "global",
    natsAuth: NATS_TOKEN ? { token: NATS_TOKEN } : undefined,
  });

  const consumerCard = {
    metadata: {
      id: CONSUMER_DID,
      name: "PublicDemoConsumer",
      version: "1.0.0",
      owner: "did:mesh:org:demo",
      did_document: {
        id: CONSUMER_DID,
        verification_method: [
          {
            id: `${CONSUMER_DID}#key-1`,
            type: "Ed25519VerificationKey2020",
            controller: CONSUMER_DID,
            public_key_base64: consumerPublicKeyBase64,
          },
        ],
        key_agreement: [
          {
            id: `${CONSUMER_DID}#key-agreement-1`,
            type: "X25519KeyAgreementKey2020",
            controller: CONSUMER_DID,
            public_key_base64: consumerKeyAgreementPublicBase64,
          },
        ],
      },
    },
    spec: {
      domains: { primary: ["demo", "consumer"] },
      capabilities: [{ id: "requester", description: "Consumer identity registration only" }],
      endpoints: {
        control_plane: { nats_subject: "mesh.agents.demo.consumer" },
        data_plane: { grpc: "grpc://127.0.0.1:0" },
      },
    },
  };
  await mesh.register(consumerCard, { status: "active" });

  const requestMathFromMeshTool = new Tool({
    id: "request_math_from_mesh",
    description: "Sends a math/calculation question to a specialist on the mesh. Use this when the user asks for any math operation.",
    inputSchema: z.object({
      question: z.string().describe("The math question or expression"),
    }),
    handler: async (_ctx, { question }) => {
      const timings = {};
      const totalStart = nowMs();
      try {
        const matchStart = nowMs();
        const result = await mesh.request({
          domain: ["demo", "math"],
          capabilityId: "calculator",
          description: question,
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        timings.match_ms = nowMs() - matchStart;

        if (result.kind === "reject") {
          console.log("[Consumer][timing]", JSON.stringify({ ...timings, outcome: "reject", reason: result.reason }));
          return { success: false, error: result.reason, result: null };
        }

        const sessionId = result.sessionId;
        const providerDid = result.parties.provider;

        // Give the provider time to process the match and create the session (avoids session_not_found race).
        await new Promise((r) => setTimeout(r, 500));

        const registryStart = nowMs();
        const providerInfoResp = await fetch(`${REGISTRY_URL.replace(/\/$/, "")}/agents/${encodeURIComponent(providerDid)}`);
        if (!providerInfoResp.ok) {
          throw new Error(`Provider registry lookup failed: ${providerInfoResp.status}`);
        }
        const providerInfo = await providerInfoResp.json();
        timings.registry_lookup_ms = nowMs() - registryStart;

        const capability = providerInfo?.card?.metadata?.annotations?.dataplane_capability;
        if (capability !== "v1-e2e" && !ALLOW_LEGACY_DATAPLANE) {
          throw new Error("Provider does not advertise dataplane_capability=v1-e2e");
        }
        const providerGrpcEndpointRaw = providerInfo?.card?.spec?.endpoints?.data_plane?.grpc || "";
        const providerGrpcEndpoint = parseGrpcEndpoint(providerGrpcEndpointRaw);
        // Dev certs are for CN=localhost; when connecting to 127.0.0.1 we must use serverName "localhost" for TLS.
        const tlsServerName =
          DATAPLANE_TLS_SERVER_NAME ||
          (/^127\.0\.0\.1$|^localhost$/i.test(providerGrpcEndpoint.split(":")[0]) ? "localhost" : "");

        const providerPubKeyB64 = providerInfo?.card?.metadata?.did_document?.verification_method?.[0]?.public_key_base64;
        const providerAgreementKeyB64 = providerInfo?.card?.metadata?.did_document?.key_agreement?.[0]?.public_key_base64;
        if (!providerPubKeyB64) {
          throw new Error("Provider DID document missing public key");
        }
        if (!providerAgreementKeyB64) {
          throw new Error("Provider DID document missing keyAgreement X25519 key");
        }
        const providerPublicKey = publicKeyFromBase64(providerPubKeyB64);
        const dpClient = createDataPlaneClient(providerGrpcEndpoint, {
          insecure: DATAPLANE_ALLOW_INSECURE,
          caCertPath: DATAPLANE_TLS_CA_CERT_PATH,
          clientCertPath: DATAPLANE_TLS_CLIENT_CERT_PATH,
          clientKeyPath: DATAPLANE_TLS_CLIENT_KEY_PATH,
          serverName: tlsServerName,
        });

        const consumerEph = createX25519Ephemeral();
        const consumerEphPub = exportX25519PublicKeyBytes(consumerEph.publicKey);
        // Ensures provider DID exposes a valid X25519 key for agreement.
        const providerAgreementKey = importX25519PublicKeyBase64(providerAgreementKeyB64);
        const didSharedSecret = crypto.diffieHellman({
          privateKey: consumerEph.privateKey,
          publicKey: providerAgreementKey,
        });
        if (!didSharedSecret || didSharedSecret.length === 0) {
          throw new Error("Unable to derive shared secret using provider DID key agreement");
        }
        const consumerSigPayload = buildHandshakePayload(sessionId, CONSUMER_DID, consumerEphPub);
        const consumerSig = signEd25519(consumerPrivateKey, consumerSigPayload);

        const handshakeStart = nowMs();
        const handshakeResp = await new Promise((resolve, reject) => {
          dpClient.Handshake({
            session_id: sessionId,
            session_token: result.sessionToken,
            consumer_ephemeral_pub: consumerEphPub,
            consumer_did: CONSUMER_DID,
            consumer_did_signature: consumerSig,
          }, (err, response) => (err ? reject(err) : resolve(response)));
        });
        timings.handshake_ms = nowMs() - handshakeStart;

        const providerSigPayload = buildHandshakePayload(
          sessionId,
          handshakeResp.provider_did,
          handshakeResp.provider_ephemeral_pub
        );
        const providerSigValid = verifyEd25519(
          providerPublicKey,
          providerSigPayload,
          Buffer.from(handshakeResp.provider_did_signature)
        );
        if (!providerSigValid) {
          throw new Error("Provider handshake signature invalid");
        }
        const sessionKey = deriveSessionKey({
          privateKey: consumerEph.privateKey,
          peerPublicKeyBytes: handshakeResp.provider_ephemeral_pub,
          sessionId,
        });

        const transferMeta = new grpc.Metadata();
        transferMeta.set("x-session-id", sessionId);
        const transferStart = nowMs();
        await new Promise((resolve, reject) => {
          const call = dpClient.Transfer(
            transferMeta,
            (err, ack) => {
              if (err) {
                reject(err);
                return;
              }
              if (!ack?.accepted) {
                reject(new Error(ack?.error_message || "provider rejected transfer"));
                return;
              }
              resolve();
            }
          );
          const encrypted = encryptChunk({
            key: sessionKey,
            sequence: 1,
            payloadBuffer: Buffer.from(JSON.stringify({ description: question }), "utf8"),
          });
          call.write({
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            sequence: encrypted.sequence,
            is_final: encrypted.is_final,
            algorithm: encrypted.algorithm,
          });
          call.end();
        });
        timings.transfer_ack_ms = nowMs() - transferStart;

        const resultStart = nowMs();
        const answer = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout waiting for specialist response"));
          }, RESULT_TIMEOUT_MS);
          let resolved = false;
          const finish = (fn) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            fn();
          };
          const stream = dpClient.Result({ session_id: sessionId });
          stream.on("data", (chunk) => {
            finish(() => {
              try {
                const plaintext = decryptChunk({ key: sessionKey, chunk });
                const data = JSON.parse(plaintext.toString("utf8"));
                resolve(data.result ?? data.error ?? "(no response)");
              } catch {
                resolve("(invalid response)");
              }
            });
          });
          stream.on("error", (err) => {
            finish(() => reject(err));
          });
          stream.on("end", () => {
            if (!resolved) {
              finish(() => reject(new Error("Result stream ended without data (provider may have returned result_not_ready or handshake_required)")));
            }
          });
        });
        timings.result_wait_ms = nowMs() - resultStart;

        dpClient.close?.();
        timings.total_ms = nowMs() - totalStart;
        console.log("[Consumer][timing]", JSON.stringify({ ...timings, outcome: "ok" }));
        return { success: true, result: answer };
      } catch (err) {
        timings.total_ms = nowMs() - totalStart;
        const msg = err?.message || String(err);
        const code = err?.code ?? err?.details;
        console.error("[Consumer] DataPlane error:", code || msg);
        console.log("[Consumer][timing]", JSON.stringify({ ...timings, outcome: "error", error: code || msg }));
        return { success: false, error: `DataPlane: ${code ? `${code} - ` : ""}${msg}`, result: null };
      }
    },
  });

  const model = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5-nano",
  });

  const agent = new Agent({
    id: "public-demo-consumer",
    name: "PublicDemoConsumer",
    model,
    memory: new InMemory(),
    instructions: `You cannot do math. For any numeric or calculation question, use request_math_from_mesh with the user question, then answer with the returned result. Do not invent numbers.`,
    tools: [requestMathFromMeshTool],
  });

  const question = process.argv.slice(2).join(" ") || "What is 2 + 2?";

  console.log("[Consumer] Question:", question);
  console.log("[Consumer] Requesting via public mesh...\n");

  await agent.addMessage({ role: "user", content: question });
  const exec = await agent.execute();

  console.log("[Consumer] Response:", exec.content ?? "(empty)");

  await mesh.close();
  console.log("\n[Consumer] Done.");
}

main().catch((err) => {
  console.error("[Consumer] Failure:", err);
  process.exit(1);
});
