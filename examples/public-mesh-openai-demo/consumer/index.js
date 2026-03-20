/**
 * Dumb consumer — connects to PUBLIC mesh (meshprotocol.dev).
 * Community (OPEN): token simples, Handshake sem ephemeral/assinatura, Transfer/Result com bytes diretos.
 */
import { readFileSync } from "node:fs";
import { MeshClient, DataPlaneConsumerClient, resolveProviderDataPlaneEndpoint, resolveNatsUrl } from "@meshprotocol/sdk";

const NATS_SERVER = resolveNatsUrl(process.env.NATS_URL, { defaultHost: "nats.meshprotocol.dev" });
const REGISTRY_URL = process.env.REGISTRY_URL || "https://api.meshprotocol.dev";
const CONSUMER_DID = "did:mesh:agent:public-demo-consumer";
const REQUEST_TIMEOUT_MS = 25_000;
const RESULT_TIMEOUT_MS = 15_000;
const DATAPLANE_ALLOW_INSECURE = (process.env.DATAPLANE_ALLOW_INSECURE || "").trim() === "1";
const DATAPLANE_TLS_CA_CERT_PATH = (process.env.DATAPLANE_TLS_CA_CERT_PATH || "").trim();
const DATAPLANE_TLS_CLIENT_CERT_PATH = (process.env.DATAPLANE_TLS_CLIENT_CERT_PATH || "").trim();
const DATAPLANE_TLS_CLIENT_KEY_PATH = (process.env.DATAPLANE_TLS_CLIENT_KEY_PATH || "").trim();
const DATAPLANE_TLS_SERVER_NAME = (process.env.DATAPLANE_TLS_SERVER_NAME || "").trim();

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

  const consumerCard = JSON.parse(readFileSync(new URL("./consumer.json", import.meta.url), "utf8"));
  await mesh.register(consumerCard, { status: "active" });

  const question = process.argv.slice(2).join(" ") || "What is 2 + 2?";

  try {
    const result = await mesh.request({
      domain: ["demo", "code"],
      capabilityId: "software_engineer",
      description: question,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (result.kind === "reject") {
      console.log("[Consumer][timing]", JSON.stringify({ outcome: "reject", reason: result.reason }));
      return { success: false, error: result.reason, result: null };
    }

    const sessionId = result.sessionId;

    const providerEndpoint = await resolveProviderDataPlaneEndpoint({
      providerDid: result.parties.provider,
      registryUrl: REGISTRY_URL,
      auth: {
        type: "bearer",
        token: process.env.REGISTRY_WRITE_TOKEN,
      },
      tlsServerName: DATAPLANE_TLS_SERVER_NAME,
    });

    const dpClient = new DataPlaneConsumerClient(providerEndpoint.grpcEndpoint, {
      insecure: DATAPLANE_ALLOW_INSECURE || undefined,
      caCertPath: DATAPLANE_TLS_CA_CERT_PATH,
      clientCertPath: DATAPLANE_TLS_CLIENT_CERT_PATH,
      clientKeyPath: DATAPLANE_TLS_CLIENT_KEY_PATH,
      serverName: providerEndpoint.serverName,
      metrics: {},
    });

    const payload = Buffer.from(JSON.stringify({ description: question }), "utf8");
    const { result: resultBuf, meta } = await dpClient.call({ sessionId, sessionToken: result.sessionToken, payload, timeoutMs: RESULT_TIMEOUT_MS });

    let answer;
    try {
      const data = JSON.parse(resultBuf.toString('utf8'));
      answer = data.result ?? data.error ?? '(no response)';
    } catch {
      answer = '(invalid response)';
    }
    dpClient.close();
    
    console.log("Response from provider:", answer);
  } catch (err) {
    const msg = err?.message || String(err);
    const code = err?.code ?? err?.details;
    console.error("[Consumer] Error during request or data plane call:", msg);
    return { success: false, error: `DataPlane: ${code ? `${code} - ` : ""}${msg}`, result: null };
  }

  await mesh.close();
}

main().catch((err) => {
  console.error("[Consumer] Failure:", err);
  process.exit(1);
});
