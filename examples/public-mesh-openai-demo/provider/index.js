/**
 * Math Expert provider — connects to PUBLIC mesh (meshprotocol.dev).
 * Community (OPEN): token simples HMAC, Handshake sem ephemeral/assinatura, Transfer/Result com bytes diretos.
 */

import { Agent, InMemory } from "@nebulaos/core";
import { OpenAI } from "@nebulaos/openai";
import { MeshClient, startRelayTunnel, DataPlaneServer, createServerCredentials, createDataPlaneObservability, resolveNatsUrl } from "@meshprotocol/sdk";
import agentCardJson from "./agent-card.json" with { type: "json" };
import http from "node:http";
// DataPlaneServer will handle Handshake / Transfer / Result lifecycle.

const NATS_SERVER = resolveNatsUrl(process.env.NATS_URL, { defaultHost: "nats.meshprotocol.dev" });
const REGISTRY_URL = process.env.REGISTRY_URL || "https://api.meshprotocol.dev";
const DATAPLANE_BIND = (process.env.DATAPLANE_BIND || "0.0.0.0:50051").trim();
const DATAPLANE_PUBLIC_ENDPOINT = (process.env.DATAPLANE_PUBLIC_ENDPOINT || "").trim();
// When RELAY_HOST is set the provider connects to the relay instead of requiring
// a public port. RELAY_HOST takes precedence over DATAPLANE_PUBLIC_ENDPOINT.
const RELAY_HOST         = (process.env.RELAY_HOST || "").trim();
const RELAY_CONTROL_PORT = Number(process.env.RELAY_CONTROL_PORT || 7000);
const RELAY_DATA_PORT    = Number(process.env.RELAY_DATA_PORT    || 7001);
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
if (!process.env.REGISTRY_WRITE_TOKEN) {
  console.error("[MathExpert] REGISTRY_WRITE_TOKEN is required (set in .env).");
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
    auth: { type: "bearer", token: process.env.REGISTRY_WRITE_TOKEN },
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

  const providerDid = agentCardJson.metadata.id;

  const observability = createDataPlaneObservability({ prefix: "mesh_provider_" });
  const { register, handshakeCounter, transferCounter, phaseLatency, bytesCounter } = observability;
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
  // DataPlane server: use SDK helper to reduce boilerplate for Handshake/Transfer/Result
  const dpServer = new DataPlaneServer({ sessionTokenSecret: SESSION_TOKEN_SECRET, providerDid, metrics: { handshakeCounter, transferCounter, phaseLatency, bytesCounter } });
  dpServer.onTask(async (payloadBuf) => {
    const payloadRaw = payloadBuf.toString('utf8');
    const payload = JSON.parse(payloadRaw);
    const question = String(payload.description || payload.question || '').trim();
    if (!question) {
      throw new Error('empty_question');
    }
    await agent.addMessage({ role: 'user', content: question });
    const result = await agent.execute();
    const answer = (result.content && typeof result.content === 'string') ? result.content.trim() : '(no response)';
    return Buffer.from(JSON.stringify({ result: answer }), 'utf8');
  });

  const serverCreds = createServerCredentials({
    insecure: DATAPLANE_ALLOW_INSECURE,
    caCertPath: DATAPLANE_TLS_CA_CERT_PATH,
    serverCertPath: DATAPLANE_TLS_SERVER_CERT_PATH,
    serverKeyPath: DATAPLANE_TLS_SERVER_KEY_PATH,
    requireClientCert: DATAPLANE_TLS_REQUIRE_CLIENT_CERT,
  });

  await dpServer.start(DATAPLANE_BIND, serverCreds);
  console.log(`[MathExpert] DataPlane gRPC listening at ${DATAPLANE_BIND} (tls=${DATAPLANE_ALLOW_INSECURE ? 'off' : 'on'})`);

  // Determine data plane public address: relay takes precedence over static endpoint.
  let dataplaneGrpcAddress = DATAPLANE_PUBLIC_ENDPOINT;
  let relayTunnel = null;
  if (RELAY_HOST) {
    const localPort = parseInt(DATAPLANE_BIND.split(":").pop() || "50051", 10);
    relayTunnel = await startRelayTunnel({
      relayHost: RELAY_HOST,
      controlPort: RELAY_CONTROL_PORT,
      dataPort: RELAY_DATA_PORT,
      agentDID: agentCardJson.metadata.id,
      localGrpcPort: localPort,
      onDisconnect: (err) => console.warn("[MathExpert] Relay disconnected:", err?.message),
    });
    dataplaneGrpcAddress = relayTunnel.grpcAddress;
    console.log(`[MathExpert] Relay tunnel active → ${dataplaneGrpcAddress}`);
  }

  console.log("[MathExpert] Registering on public registry...");
  const cardToRegister = JSON.parse(JSON.stringify(agentCardJson));
  cardToRegister.metadata.annotations = {
    ...(cardToRegister.metadata.annotations || {}),
    dataplane_capability: "v1-open",
  };
  if (dataplaneGrpcAddress) {
    cardToRegister.spec.endpoints.data_plane.grpc = dataplaneGrpcAddress;
  }
  const reg = await mesh.register(cardToRegister);
  console.log("[MathExpert] Registered:", reg.id, reg.status);
  console.log("[MathExpert] Listening for matches (Ctrl+C to exit)...\n");
  await mesh.startHeartbeat(30_000);

  await mesh.listen(async (match) => {
    dpServer.addSession({ sessionId: match.sessionId, sessionToken: match.sessionToken, consumerDid: match.parties.consumer });
    console.log('[MathExpert] Match received, session prepared:', match.sessionId);
  });

  process.on("SIGINT", async () => {
    console.log("\n[MathExpert] Shutting down...");
    metricsServer.close();
    await dpServer.close();
    if (relayTunnel) relayTunnel.close();
    await mesh.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[MathExpert] Failure:", err);
  process.exit(1);
});
