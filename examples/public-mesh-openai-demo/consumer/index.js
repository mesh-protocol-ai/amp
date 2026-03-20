/**
 * Dumb consumer — connects to PUBLIC mesh (meshprotocol.dev).
 * Community (OPEN): token simples, Handshake sem ephemeral/assinatura, Transfer/Result com bytes diretos.
 */

import { Agent, InMemory, Tool } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient } from "@meshprotocol/sdk";
import { z } from "zod";
import { createDataPlaneClient, parseGrpcEndpoint, grpc } from "../shared/dataplane.js";
import { createChunkOpen } from "../shared/security.js";

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
const REGISTRY_URL = process.env.REGISTRY_URL || "https://api.meshprotocol.dev";
const CONSUMER_DID = "did:mesh:agent:public-demo-consumer";
const REQUEST_TIMEOUT_MS = 25_000;
const RESULT_TIMEOUT_MS = 15_000;
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
if (!process.env.REGISTRY_WRITE_TOKEN) {
  console.error("[Consumer] REGISTRY_WRITE_TOKEN is required (set in .env).");
  process.exit(1);
}

async function main() {
  console.log("[Consumer] Connecting to PUBLIC mesh (Community / OPEN)...\n");

  const mesh = new MeshClient({
    natsUrl: NATS_SERVER,
    registryUrl: REGISTRY_URL,
    did: CONSUMER_DID,
    region: "global",
    natsAuth: process.env.NATS_TOKEN ? { token: process.env.NATS_TOKEN } : undefined,
    auth: { type: "bearer", token: process.env.REGISTRY_WRITE_TOKEN },
  });

  const consumerCard = {
    metadata: {
      id: CONSUMER_DID,
      name: "PublicDemoConsumer",
      version: "1.0.0",
      owner: "did:mesh:org:demo",
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

  const requestFromMeshTool = new Tool({
    id: "request_from_mesh",
    description: "Request specialist provider on mesh for any question. Input must be a JSON with 'question' field. Output will be the provider's answer or error.",
    inputSchema: z.object({
      question: z.string().describe("The subject"),
    }),
    handler: async (_ctx, { question }) => {
      const timings = {};
      const totalStart = nowMs();
      try {
        const matchStart = nowMs();
        const result = await mesh.request({
          domain: ["demo", "code"],
          capabilityId: "software_engineer",
          description: question,
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        timings.match_ms = nowMs() - matchStart;

        if (result.kind === "reject") {
          console.log("[Consumer][timing]", JSON.stringify({ ...timings, outcome: "reject", reason: result.reason }));
          return { success: false, error: result.reason, result: null };
        }

        const sessionId = result.sessionId;

        await new Promise((r) => setTimeout(r, 500));

        const registryStart = nowMs();
        const providerDid = result.parties.provider;
        const providerInfoResp = await fetch(`${REGISTRY_URL.replace(/\/$/, "")}/agents/${encodeURIComponent(providerDid)}`);
        if (!providerInfoResp.ok) {
          throw new Error(`Provider registry lookup failed: ${providerInfoResp.status}`);
        }
        const providerInfo = await providerInfoResp.json();
        timings.registry_lookup_ms = nowMs() - registryStart;

        const providerGrpcEndpointRaw = providerInfo?.card?.spec?.endpoints?.data_plane?.grpc || "";
        const providerGrpcEndpoint = parseGrpcEndpoint(providerGrpcEndpointRaw);
        const tlsServerName =
          DATAPLANE_TLS_SERVER_NAME ||
          (/^127\.0\.0\.1$|^localhost$/i.test(providerGrpcEndpoint.split(":")[0]) ? "localhost" : "");

        const dpClient = createDataPlaneClient(providerGrpcEndpoint, {
          insecure: DATAPLANE_ALLOW_INSECURE,
          caCertPath: DATAPLANE_TLS_CA_CERT_PATH,
          clientCertPath: DATAPLANE_TLS_CLIENT_CERT_PATH,
          clientKeyPath: DATAPLANE_TLS_CLIENT_KEY_PATH,
          serverName: tlsServerName,
        });

        // OPEN: Handshake with only session_id + session_token
        const handshakeStart = nowMs();
        await new Promise((resolve, reject) => {
          dpClient.Handshake(
            {
              session_id: sessionId,
              session_token: result.sessionToken,
            },
            (err, response) => (err ? reject(err) : resolve(response))
          );
        });
        timings.handshake_ms = nowMs() - handshakeStart;

        const transferMeta = new grpc.Metadata();
        transferMeta.set("x-session-id", sessionId);
        const transferStart = nowMs();
        const payload = Buffer.from(JSON.stringify({ description: question }), "utf8");
        const openChunk = createChunkOpen(payload, 1, true);
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
          call.write({
            ciphertext: openChunk.ciphertext,
            nonce: openChunk.nonce,
            sequence: openChunk.sequence,
            is_final: openChunk.is_final,
            algorithm: openChunk.algorithm,
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
                const raw = chunk.algorithm === "none" || !chunk.algorithm
                  ? Buffer.from(chunk.ciphertext || [])
                  : Buffer.from(chunk.ciphertext || []);
                const data = JSON.parse(raw.toString("utf8"));
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
              finish(() => reject(new Error("Result stream ended without data")));
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
    instructions: `You cannot do anything. You don't know anything of nothing. You're completely dumb. To any question user may ask you need to request help from mesh.`,
    tools: [requestFromMeshTool],
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
