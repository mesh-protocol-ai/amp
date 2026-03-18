/**
 * Math Expert provider — connects to PUBLIC mesh (meshprotocol.dev).
 * Community (OPEN): token simples HMAC, Handshake sem ephemeral/assinatura, Transfer/Result com bytes diretos.
 */

import { Agent, InMemory } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient, validateSimpleToken } from "@meshprotocol/sdk";
import agentCardJson from "./agent-card.json" with { type: "json" };
import http from "node:http";
import client from "prom-client";
import { createGrpcServer, createServerCredentials, DataPlaneService, grpc } from "../shared/dataplane.js";
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
const DATAPLANE_BIND = (process.env.DATAPLANE_BIND || "0.0.0.0:50051").trim();
const DATAPLANE_PUBLIC_ENDPOINT = (process.env.DATAPLANE_PUBLIC_ENDPOINT || "").trim();
const SESSION_TOKEN_SECRET = (process.env.SESSION_TOKEN_SECRET || "").trim();
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

async function main() {
  console.log("[MathExpert] Connecting to PUBLIC mesh (Community / OPEN)...\n");

  const mesh = new MeshClient({
    natsUrl: NATS_SERVER,
    registryUrl: REGISTRY_URL,
    did: agentCardJson.metadata.id,
    region: "global",
    natsAuth: process.env.NATS_TOKEN ? { token: process.env.NATS_TOKEN } : undefined,
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

  const sessions = new Map();
  const providerDid = agentCardJson.metadata.id;

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
        const valid = validateSimpleToken(
          req.session_token,
          SESSION_TOKEN_SECRET,
          req.session_id,
          session.consumerDid,
          providerDid
        );
        if (!valid) {
          handshakeCounter.inc({ outcome: "failed", reason: "invalid_session_token" });
          callback({ code: grpc.status.UNAUTHENTICATED, message: "invalid_session_token" });
          return;
        }
        session.handshakeOk = true;
        session.lastSequence = 0;
        handshakeCounter.inc({ outcome: "ok", reason: "none" });
        callback(null, {
          provider_ephemeral_pub: Buffer.alloc(0),
          provider_did: providerDid,
          provider_did_signature: Buffer.alloc(0),
        });
      } catch (err) {
        handshakeCounter.inc({ outcome: "failed", reason: "internal_error" });
        callback({ code: grpc.status.INTERNAL, message: err?.message || "internal_error" });
      } finally {
        endLatency();
      }
    },
    Transfer: (call, callback) => {
      const endLatency = phaseLatency.startTimer({ phase: "transfer" });
      const md = call.metadata.get("x-session-id") ?? call.metadata.get("X-Session-Id");
      const raw = Array.isArray(md) ? md[0] : md;
      const sessionId = raw != null && raw !== "" ? String(raw) : "";
      if (!sessionId) {
        console.warn("[MathExpert] Transfer metadata missing x-session-id");
      }
      const session = sessions.get(sessionId);
      if (!session || !session.handshakeOk) {
        transferCounter.inc({ outcome: "failed", reason: "handshake_required" });
        endLatency();
        callback({ code: grpc.status.UNAUTHENTICATED, message: "handshake_required" });
        return;
      }
      const chunks = [];
      call.on("data", (chunk) => {
        const sequence = Number(chunk.sequence || 0);
        if (sequence <= session.lastSequence) {
          call.emit("error", { code: grpc.status.PERMISSION_DENIED, message: "replay_detected" });
          return;
        }
        session.lastSequence = sequence;
        chunks.push(Buffer.from(chunk.ciphertext || []));
      });
      call.on("error", () => {
        transferCounter.inc({ outcome: "failed", reason: "stream_error" });
        endLatency();
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
          session.resultChunk = createChunkOpen(responsePayload, session.lastSequence + 1, true);
          session.lastSequence += 1;
          transferCounter.inc({ outcome: "ok", reason: "none" });
          endLatency();
          callback(null, { accepted: true, chunks_received: chunks.length });
        } catch (err) {
          transferCounter.inc({ outcome: "failed", reason: "process_error" });
          endLatency();
          callback({ code: grpc.status.INTERNAL, message: `process_error: ${err?.message}` });
        }
      });
    },
    Result: (call) => {
      const endLatency = phaseLatency.startTimer({ phase: "result" });
      const req = call.request || {};
      const session = sessions.get(req.session_id);
      if (!session || !session.handshakeOk) {
        call.emit("error", { code: grpc.status.UNAUTHENTICATED, message: "handshake_required" });
        endLatency();
        return;
      }
      if (!session.resultChunk) {
        call.emit("error", { code: grpc.status.FAILED_PRECONDITION, message: "result_not_ready" });
        endLatency();
        return;
      }
      call.write(session.resultChunk);
      call.end();
      endLatency();
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
    `[MathExpert] DataPlane gRPC listening at ${DATAPLANE_BIND} (tls=${DATAPLANE_ALLOW_INSECURE ? "off" : "on"})`
  );

  console.log("[MathExpert] Registering on public registry...");
  const cardToRegister = JSON.parse(JSON.stringify(agentCardJson));
  cardToRegister.metadata.annotations = {
    ...(cardToRegister.metadata.annotations || {}),
    dataplane_capability: "v1-open",
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
