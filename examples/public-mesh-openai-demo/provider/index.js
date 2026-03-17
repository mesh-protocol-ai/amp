/**
 * Math Expert provider — connects to PUBLIC mesh (meshprotocol.dev).
 * Registers calculator capability, listens for matches, answers via OpenAI.
 * Loads .env from parent (NATS_TOKEN, REGISTRY_URL, OPENAI_API_KEY).
 */

import { Agent, InMemory } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient } from "@meshprotocol/sdk";
import agentCardJson from "./agent-card.json" with { type: "json" };
import jwt from "jsonwebtoken";
import http from "node:http";
import client from "prom-client";
import { createGrpcServer, createServerCredentials, DataPlaneService, grpc } from "../shared/dataplane.js";
import {
  buildHandshakePayload,
  createX25519Ephemeral,
  decryptChunk,
  deriveSessionKey,
  encryptChunk,
  exportEd25519PublicKeyBase64,
  exportX25519PublicKeyBase64,
  exportX25519PublicKeyBytes,
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
const DATAPLANE_BIND = (process.env.DATAPLANE_BIND || "0.0.0.0:50051").trim();
const DATAPLANE_PUBLIC_ENDPOINT = (process.env.DATAPLANE_PUBLIC_ENDPOINT || "").trim();
const SESSION_TOKEN_SECRET = (process.env.SESSION_TOKEN_SECRET || "").trim();
const PROVIDER_ED25519_PRIVATE_KEY_BASE64 = (process.env.PROVIDER_ED25519_PRIVATE_KEY_BASE64 || "").trim();
const DATAPLANE_CAPABILITY = "v1-e2e";
const DATAPLANE_ALLOW_INSECURE = (process.env.DATAPLANE_ALLOW_INSECURE || "").trim() === "1";
const DATAPLANE_TLS_CA_CERT_PATH = (process.env.DATAPLANE_TLS_CA_CERT_PATH || "").trim();
const DATAPLANE_TLS_SERVER_CERT_PATH = (process.env.DATAPLANE_TLS_SERVER_CERT_PATH || "").trim();
const DATAPLANE_TLS_SERVER_KEY_PATH = (process.env.DATAPLANE_TLS_SERVER_KEY_PATH || "").trim();
const DATAPLANE_TLS_REQUIRE_CLIENT_CERT = (process.env.DATAPLANE_TLS_REQUIRE_CLIENT_CERT || "").trim() === "1";
const METRICS_PORT = Number(process.env.METRICS_PORT || 9095);

if (!process.env.OPENAI_API_KEY) {
  console.error("[MathExpert] OPENAI_API_KEY is required (set in .env).");
  process.exit(1);
}
if (!process.env.NATS_TOKEN) {
  console.error("[MathExpert] NATS_TOKEN is required for public mesh (set in .env).");
  process.exit(1);
}
if (!SESSION_TOKEN_SECRET) {
  console.error("[MathExpert] SESSION_TOKEN_SECRET is required.");
  process.exit(1);
}
if (!PROVIDER_ED25519_PRIVATE_KEY_BASE64) {
  console.error("[MathExpert] PROVIDER_ED25519_PRIVATE_KEY_BASE64 is required.");
  process.exit(1);
}

async function main() {
  console.log("[MathExpert] Connecting to PUBLIC mesh (meshprotocol.dev)...\n");

  const mesh = new MeshClient({
    natsUrl: NATS_SERVER,
    registryUrl: REGISTRY_URL,
    did: agentCardJson.metadata.id,
    region: "global",
    natsAuth: NATS_TOKEN ? { token: NATS_TOKEN } : undefined,
  });

  const model = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5-nano",
  });

  const agent = new Agent({
    id: "math-expert-public",
    name: "MathExpertPublic",
    model,
    memory: new InMemory(),
    instructions: `You are a math specialist. Answer only calculation and numeric expression questions.
Reply ONLY with the numeric result or simplified expression, no long explanations.
Examples: "what is 2+2?" -> "4". "What is 15 * 3?" -> "45".`,
  });

  const providerPrivateKey = loadEd25519PrivateKeyFromBase64(PROVIDER_ED25519_PRIVATE_KEY_BASE64);
  const providerPublicKey = crypto.createPublicKey(providerPrivateKey);
  const providerPublicKeyBase64 = exportEd25519PublicKeyBase64(providerPublicKey);
  const providerStaticKeyAgreement = createX25519Ephemeral();
  const providerKeyAgreementPublicBase64 = exportX25519PublicKeyBase64(providerStaticKeyAgreement.publicKey);

  const sessions = new Map();
  const register = new client.Registry();
  client.collectDefaultMetrics({ register, prefix: "mesh_provider_" });
  const handshakeCounter = new client.Counter({
    name: "mesh_provider_dataplane_handshake_total",
    help: "Total handshake attempts by outcome and reason",
    labelNames: ["outcome", "reason"],
    registers: [register],
  });
  const transferCounter = new client.Counter({
    name: "mesh_provider_dataplane_transfer_total",
    help: "Total transfer attempts by outcome and reason",
    labelNames: ["outcome", "reason"],
    registers: [register],
  });
  const decryptCounter = new client.Counter({
    name: "mesh_provider_dataplane_decrypt_failures_total",
    help: "Total decrypt failures",
    labelNames: ["reason"],
    registers: [register],
  });
  const replayCounter = new client.Counter({
    name: "mesh_provider_dataplane_replay_total",
    help: "Total replay detections",
    labelNames: ["reason"],
    registers: [register],
  });
  const phaseLatency = new client.Histogram({
    name: "mesh_provider_dataplane_phase_duration_seconds",
    help: "Latency by dataplane phase",
    labelNames: ["phase"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register],
  });
  const metricsServer = http.createServer(async (req, res) => {
    if (req.url !== "/metrics") {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    try {
      res.writeHead(200, { "Content-Type": register.contentType });
      res.end(await register.metrics());
    } catch (err) {
      res.writeHead(500);
      res.end(String(err?.message || err));
    }
  });
  metricsServer.listen(METRICS_PORT, () => {
    console.log(`[MathExpert] Prometheus metrics exposed on :${METRICS_PORT}/metrics`);
  });
  const grpcServer = createGrpcServer();

  grpcServer.addService(DataPlaneService.service, {
    Handshake: async (call, callback) => {
      const endLatency = phaseLatency.startTimer({ phase: "handshake" });
      try {
        const req = call.request || {};
        const session = sessions.get(req.session_id);
        if (!session) {
          handshakeCounter.inc({ outcome: "failed", reason: "session_not_found" });
          callback({ code: grpc.status.NOT_FOUND, message: "session_not_found" });
          return;
        }
        let claims;
        try {
          claims = jwt.verify(req.session_token, SESSION_TOKEN_SECRET, { algorithms: ["HS256"] });
        } catch (err) {
          handshakeCounter.inc({ outcome: "failed", reason: "invalid_session_token" });
          callback({ code: grpc.status.UNAUTHENTICATED, message: `invalid_session_token: ${err.message}` });
          return;
        }
        if (claims.session_id !== req.session_id || claims.provider_did !== agentCardJson.metadata.id) {
          handshakeCounter.inc({ outcome: "failed", reason: "session_claims_mismatch" });
          callback({ code: grpc.status.PERMISSION_DENIED, message: "session_claims_mismatch" });
          return;
        }
        const consumerInfoResp = await fetch(`${REGISTRY_URL.replace(/\/$/, "")}/agents/${encodeURIComponent(req.consumer_did)}`);
        if (!consumerInfoResp.ok) {
          handshakeCounter.inc({ outcome: "failed", reason: "consumer_did_not_registered" });
          callback({ code: grpc.status.PERMISSION_DENIED, message: "consumer_did_not_registered" });
          return;
        }
        const consumerInfo = await consumerInfoResp.json();
        const consumerPubKeyB64 = consumerInfo?.card?.metadata?.did_document?.verification_method?.[0]?.public_key_base64;
        if (!consumerPubKeyB64) {
          handshakeCounter.inc({ outcome: "failed", reason: "consumer_did_document_missing" });
          callback({ code: grpc.status.PERMISSION_DENIED, message: "consumer_did_document_missing" });
          return;
        }
        const consumerPublicKey = publicKeyFromBase64(consumerPubKeyB64);
        const consumerSigPayload = buildHandshakePayload(req.session_id, req.consumer_did, req.consumer_ephemeral_pub);
        const consumerSigValid = verifyEd25519(consumerPublicKey, consumerSigPayload, Buffer.from(req.consumer_did_signature));
        if (!consumerSigValid) {
          handshakeCounter.inc({ outcome: "failed", reason: "consumer_signature_invalid" });
          callback({ code: grpc.status.PERMISSION_DENIED, message: "consumer_signature_invalid" });
          return;
        }

        const providerEph = createX25519Ephemeral();
        const providerEphPub = exportX25519PublicKeyBytes(providerEph.publicKey);
        const sessionKey = deriveSessionKey({
          privateKey: providerEph.privateKey,
          peerPublicKeyBytes: req.consumer_ephemeral_pub,
          sessionId: req.session_id,
        });
        const providerSigPayload = buildHandshakePayload(req.session_id, agentCardJson.metadata.id, providerEphPub);
        const providerSig = signEd25519(providerPrivateKey, providerSigPayload);

        session.consumerDid = req.consumer_did;
        session.handshakeOk = true;
        session.sessionKey = sessionKey;
        session.lastSequence = 0;
        handshakeCounter.inc({ outcome: "ok", reason: "none" });
        callback(null, {
          provider_ephemeral_pub: providerEphPub,
          provider_did: agentCardJson.metadata.id,
          provider_did_signature: providerSig,
        });
      } catch (err) {
        handshakeCounter.inc({ outcome: "failed", reason: "internal_error" });
        callback({ code: grpc.status.INTERNAL, message: err.message });
      } finally {
        endLatency();
      }
    },
    Transfer: (call, callback) => {
      const endLatency = phaseLatency.startTimer({ phase: "transfer" });
      const md = call.metadata.get("x-session-id");
      const sessionId = typeof md[0] === "string" ? md[0] : "";
      const session = sessions.get(sessionId);
      if (!session || !session.handshakeOk) {
        transferCounter.inc({ outcome: "failed", reason: "handshake_required" });
        endLatency();
        callback({ code: grpc.status.UNAUTHENTICATED, message: "handshake_required" });
        return;
      }
      const chunks = [];
      call.on("data", (chunk) => {
        if (!session.sessionKey) {
          return;
        }
        const sequence = Number(chunk.sequence || 0);
        if (sequence <= session.lastSequence) {
          replayCounter.inc({ reason: "sequence_not_increasing" });
          call.emit("error", { code: grpc.status.PERMISSION_DENIED, message: "replay_detected" });
          return;
        }
        session.lastSequence = sequence;
        if (chunk.algorithm === "AES-256-GCM") {
          try {
            chunks.push(decryptChunk({ key: session.sessionKey, chunk }));
          } catch (err) {
            decryptCounter.inc({ reason: "aes_gcm_auth_failed" });
            call.emit("error", { code: grpc.status.PERMISSION_DENIED, message: "decrypt_failed" });
            return;
          }
        } else {
          chunks.push(Buffer.from(chunk.ciphertext));
        }
      });
      call.on("error", (err) => {
        transferCounter.inc({ outcome: "failed", reason: "stream_error" });
        endLatency();
        callback({ code: grpc.status.INTERNAL, message: `transfer_error: ${err.message}` });
      });
      call.on("end", async () => {
        try {
          const payloadRaw = Buffer.concat(chunks).toString("utf8");
          const payload = JSON.parse(payloadRaw);
          const question = String(payload.description || payload.question || "").trim();
          if (!question) {
            transferCounter.inc({ outcome: "failed", reason: "empty_question" });
            endLatency();
            callback(null, { accepted: false, chunks_received: chunks.length, error_code: "EMPTY_QUESTION", error_message: "empty question" });
            return;
          }
          await agent.addMessage({ role: "user", content: question });
          const result = await agent.execute();
          const answer = (result.content && typeof result.content === "string")
            ? result.content.trim()
            : "(no response)";
          const responsePayload = Buffer.from(JSON.stringify({ result: answer }), "utf8");
          session.resultChunk = encryptChunk({
            key: session.sessionKey,
            sequence: session.lastSequence + 1,
            payloadBuffer: responsePayload,
          });
          session.lastSequence += 1;
          transferCounter.inc({ outcome: "ok", reason: "none" });
          endLatency();
          callback(null, { accepted: true, chunks_received: chunks.length });
        } catch (err) {
          transferCounter.inc({ outcome: "failed", reason: "process_error" });
          endLatency();
          callback({ code: grpc.status.INTERNAL, message: `process_error: ${err.message}` });
        }
      });
    },
    Result: (call) => {
      const req = call.request || {};
      const session = sessions.get(req.session_id);
      if (!session || !session.handshakeOk) {
        call.emit("error", { code: grpc.status.UNAUTHENTICATED, message: "handshake_required" });
        return;
      }
      if (!session.resultChunk) {
        call.emit("error", { code: grpc.status.FAILED_PRECONDITION, message: "result_not_ready" });
        return;
      }
      call.write(session.resultChunk);
      call.end();
    },
    StreamingTask: (stream) => {
      stream.emit("error", { code: grpc.status.UNIMPLEMENTED, message: "not_implemented" });
    },
  });

  await new Promise((resolve, reject) => {
    const serverCreds = createServerCredentials({
      insecure: DATAPLANE_ALLOW_INSECURE,
      caCertPath: DATAPLANE_TLS_CA_CERT_PATH,
      serverCertPath: DATAPLANE_TLS_SERVER_CERT_PATH,
      serverKeyPath: DATAPLANE_TLS_SERVER_KEY_PATH,
      requireClientCert: DATAPLANE_TLS_REQUIRE_CLIENT_CERT,
    });
    grpcServer.bindAsync(DATAPLANE_BIND, serverCreds, (err) => {
      if (err) {
        reject(err);
        return;
      }
      grpcServer.start();
      resolve();
    });
  });
  console.log(
    `[MathExpert] DataPlane gRPC listening at ${DATAPLANE_BIND} (tls=${DATAPLANE_ALLOW_INSECURE ? "off" : "on"}, mtls=${DATAPLANE_TLS_REQUIRE_CLIENT_CERT ? "on" : "off"})`
  );

  console.log("[MathExpert] Registering on public registry...");
  const cardToRegister = JSON.parse(JSON.stringify(agentCardJson));
  cardToRegister.metadata.did_document = {
    id: agentCardJson.metadata.id,
    verification_method: [
      {
        id: `${agentCardJson.metadata.id}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: agentCardJson.metadata.id,
        public_key_base64: providerPublicKeyBase64,
      },
    ],
    key_agreement: [
      {
        id: `${agentCardJson.metadata.id}#key-agreement-1`,
        type: "X25519KeyAgreementKey2020",
        controller: agentCardJson.metadata.id,
        public_key_base64: providerKeyAgreementPublicBase64,
      },
    ],
  };
  cardToRegister.metadata.annotations = {
    ...(cardToRegister.metadata.annotations || {}),
    dataplane_capability: DATAPLANE_CAPABILITY,
  };
  if (DATAPLANE_PUBLIC_ENDPOINT) {
    cardToRegister.spec.endpoints.data_plane.grpc = DATAPLANE_PUBLIC_ENDPOINT;
  }
  const reg = await mesh.register(cardToRegister);
  console.log("[MathExpert] Registered:", reg.id, reg.status);
  console.log("[MathExpert] Listening for matches (Ctrl+C to exit)...\n");

  await mesh.listen(async (match) => {
    sessions.set(match.sessionId, {
      sessionId: match.sessionId,
      sessionToken: match.sessionToken,
      consumerDid: match.parties.consumer,
      providerDid: match.parties.provider,
      handshakeOk: false,
      resultChunk: null,
    });
    console.log("[MathExpert] Match received, session prepared:", match.sessionId);
  });

  process.on("SIGINT", async () => {
    console.log("\n[MathExpert] Shutting down...");
    metricsServer.close();
    await new Promise((resolve) => grpcServer.tryShutdown(resolve));
    await mesh.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[MathExpert] Failure:", err);
  process.exit(1);
});
