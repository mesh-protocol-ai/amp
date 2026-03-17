/**
 * Testa o data plane com SESSION_TOKEN válido (mesmo formato do matching Go).
 * 1) Publica um match em mesh.matches com JWT assinado por SESSION_TOKEN_SECRET.
 * 2) Aguarda o provider criar a sessão.
 * 3) Executa Handshake + Transfer + Result como o consumer faria.
 *
 * Pré-requisitos: provider rodando, consumer registrado no registry (rodar consumer uma vez).
 * SESSION_TOKEN_SECRET deve ser o mesmo no script, no provider e no matching (AWS).
 *
 * Uso:
 *   cd consumer && node --env-file=../.env ../scripts/test-dataplane-with-token.js
 *   npm run test:dataplane  (da raiz do demo)
 */

import crypto from "node:crypto";
import { connect } from "nats";
import jwt from "jsonwebtoken";
import { createDataPlaneClient, parseGrpcEndpoint, grpc } from "../shared/dataplane.js";
import {
  buildHandshakePayload,
  createX25519Ephemeral,
  decryptChunk,
  deriveSessionKey,
  encryptChunk,
  importX25519PublicKeyBase64,
  loadEd25519PrivateKeyFromBase64,
  publicKeyFromBase64,
  signEd25519,
  exportX25519PublicKeyBytes,
  verifyEd25519,
} from "../shared/security.js";

const REGISTRY_URL = (process.env.REGISTRY_URL || "https://api.meshprotocol.dev").replace(/\/$/, "");
const NATS_URL = (process.env.NATS_URL || "nats.meshprotocol.dev:4222").trim();
const NATS_SERVER = NATS_URL.startsWith("nats://") ? NATS_URL : `nats://${NATS_URL}`;
const NATS_TOKEN = (process.env.NATS_TOKEN || "").trim();
const SESSION_TOKEN_SECRET = (process.env.SESSION_TOKEN_SECRET || "").trim();
const CONSUMER_DID = "did:mesh:agent:public-demo-consumer";
const PROVIDER_DID = "did:mesh:agent:math-expert-public-demo";
const DATAPLANE_ALLOW_INSECURE = (process.env.DATAPLANE_ALLOW_INSECURE || "").trim() === "1";
const DATAPLANE_TLS_CA_CERT_PATH = (process.env.DATAPLANE_TLS_CA_CERT_PATH || "").trim();
const DATAPLANE_TLS_CLIENT_CERT_PATH = (process.env.DATAPLANE_TLS_CLIENT_CERT_PATH || "").trim();
const DATAPLANE_TLS_CLIENT_KEY_PATH = (process.env.DATAPLANE_TLS_CLIENT_KEY_PATH || "").trim();
const DATAPLANE_TLS_SERVER_NAME = (process.env.DATAPLANE_TLS_SERVER_NAME || "").trim();
const CONSUMER_ED25519_PRIVATE_KEY_BASE64 = (process.env.CONSUMER_ED25519_PRIVATE_KEY_BASE64 || "").trim();

function issueSessionToken(sessionId, consumerDid, providerDid, secret) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const payload = {
    session_id: sessionId,
    consumer_did: consumerDid,
    provider_did: providerDid,
    exp,
    iat: now,
    jti: crypto.randomUUID(),
  };
  return jwt.sign(payload, secret, { algorithm: "HS256" });
}

async function main() {
  if (!SESSION_TOKEN_SECRET) {
    console.error("[test-dataplane-with-token] SESSION_TOKEN_SECRET is required in .env");
    process.exit(1);
  }
  if (!CONSUMER_ED25519_PRIVATE_KEY_BASE64) {
    console.error("[test-dataplane-with-token] CONSUMER_ED25519_PRIVATE_KEY_BASE64 is required");
    process.exit(1);
  }
  if (!NATS_TOKEN) {
    console.error("[test-dataplane-with-token] NATS_TOKEN is required");
    process.exit(1);
  }

  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 3600 * 1000);
  const sessionToken = issueSessionToken(sessionId, CONSUMER_DID, PROVIDER_DID, SESSION_TOKEN_SECRET);

  console.log("[test-dataplane-with-token] Publishing match to mesh.matches (session_id=%s)...", sessionId);
  const nc = await connect({
    servers: NATS_SERVER,
    token: NATS_TOKEN,
  });

  const matchData = {
    request_id: `test-${sessionId}`,
    winning_bid_id: "direct",
    parties: { consumer: CONSUMER_DID, provider: PROVIDER_DID },
    agreed_terms: { max_latency_ms: 0, security_level: "STANDARD" },
    session: {
      session_id: sessionId,
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
      session_token: sessionToken,
    },
  };
  const matchEv = {
    specversion: "1.0",
    type: "amp.capability.match",
    source: "did:mesh:broker:local",
    id: `test-${Date.now()}-${crypto.randomUUID()}`,
    time: now.toISOString(),
    datacontenttype: "application/json",
    correlationid: matchData.request_id,
    sessionid: sessionId,
    data: matchData,
  };
  nc.publish("mesh.matches", new TextEncoder().encode(JSON.stringify(matchEv)));
  await nc.flush();
  console.log("[test-dataplane-with-token] Match published. Waiting 1.5s for provider to create session...");
  await new Promise((r) => setTimeout(r, 1500));
  await nc.close();

  const consumerPrivateKey = loadEd25519PrivateKeyFromBase64(CONSUMER_ED25519_PRIVATE_KEY_BASE64);
  const providerInfoResp = await fetch(`${REGISTRY_URL}/agents/${encodeURIComponent(PROVIDER_DID)}`);
  if (!providerInfoResp.ok) {
    console.error("[test-dataplane-with-token] Provider registry lookup failed:", providerInfoResp.status);
    process.exit(1);
  }
  const providerInfo = await providerInfoResp.json();
  const grpcUrl = providerInfo?.card?.spec?.endpoints?.data_plane?.grpc || "";
  if (!grpcUrl) {
    console.error("[test-dataplane-with-token] Provider card has no data_plane.grpc");
    process.exit(1);
  }
  const endpoint = parseGrpcEndpoint(grpcUrl);
  const host = endpoint.split(":")[0];
  const tlsServerName =
    DATAPLANE_TLS_SERVER_NAME || (/^127\.0\.0\.1$|^localhost$/i.test(host) ? "localhost" : "");

  const providerPubKeyB64 = providerInfo?.card?.metadata?.did_document?.verification_method?.[0]?.public_key_base64;
  const providerAgreementKeyB64 = providerInfo?.card?.metadata?.did_document?.key_agreement?.[0]?.public_key_base64;
  if (!providerPubKeyB64 || !providerAgreementKeyB64) {
    console.error("[test-dataplane-with-token] Provider DID document missing verification_method or key_agreement");
    process.exit(1);
  }

  const dpClient = createDataPlaneClient(endpoint, {
    insecure: DATAPLANE_ALLOW_INSECURE,
    caCertPath: DATAPLANE_TLS_CA_CERT_PATH,
    clientCertPath: DATAPLANE_TLS_CLIENT_CERT_PATH,
    clientKeyPath: DATAPLANE_TLS_CLIENT_KEY_PATH,
    serverName: tlsServerName,
  });

  const providerPublicKey = publicKeyFromBase64(providerPubKeyB64);
  const consumerEph = createX25519Ephemeral();
  const consumerEphPub = exportX25519PublicKeyBytes(consumerEph.publicKey);
  const providerAgreementKey = importX25519PublicKeyBase64(providerAgreementKeyB64);
  const consumerSigPayload = buildHandshakePayload(sessionId, CONSUMER_DID, consumerEphPub);
  const consumerSig = signEd25519(consumerPrivateKey, consumerSigPayload);

  console.log("[test-dataplane-with-token] Handshake...");
  const handshakeResp = await new Promise((resolve, reject) => {
    dpClient.Handshake(
      {
        session_id: sessionId,
        session_token: sessionToken,
        consumer_ephemeral_pub: consumerEphPub,
        consumer_did: CONSUMER_DID,
        consumer_did_signature: consumerSig,
      },
      (err, response) => (err ? reject(err) : resolve(response))
    );
  });

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
    console.error("[test-dataplane-with-token] Provider handshake signature invalid");
    process.exit(1);
  }
  const sessionKey = deriveSessionKey({
    privateKey: consumerEph.privateKey,
    peerPublicKeyBytes: handshakeResp.provider_ephemeral_pub,
    sessionId,
  });
  console.log("[test-dataplane-with-token] Handshake OK.");

  const question = "What is 2 + 2?";
  console.log("[test-dataplane-with-token] Transfer (question):", question);
  const transferMeta = new grpc.Metadata();
  transferMeta.set("x-session-id", sessionId);
  await new Promise((resolve, reject) => {
    const call = dpClient.Transfer(transferMeta, (err, ack) => {
      if (err) return reject(err);
      if (!ack?.accepted) return reject(new Error(ack?.error_message || "transfer rejected"));
      resolve();
    });
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
  console.log("[test-dataplane-with-token] Transfer accepted. Waiting for Result...");

  const answer = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout waiting for result")), 15_000);
    const stream = dpClient.Result({ session_id: sessionId });
    stream.on("data", (chunk) => {
      clearTimeout(timeout);
      try {
        const plaintext = decryptChunk({ key: sessionKey, chunk });
        const data = JSON.parse(plaintext.toString("utf8"));
        resolve(data.result ?? data.error ?? "(no response)");
      } catch (e) {
        reject(e);
      }
    });
    stream.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    stream.on("end", () => {
      clearTimeout(timeout);
      reject(new Error("Result stream ended without data"));
    });
  });

  dpClient.close?.();
  console.log("[test-dataplane-with-token] Result:", answer);
  console.log("[test-dataplane-with-token] OK — data plane com SESSION_TOKEN correto funcionou.");
}

main().catch((e) => {
  console.error("[test-dataplane-with-token] Failure:", e.message);
  process.exit(1);
});
