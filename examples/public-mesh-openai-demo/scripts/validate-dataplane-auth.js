/**
 * Valida conectividade e TLS do data plane contra o provider no registry.
 * Esperado: erro "session_not_found" ou "invalid token" = TLS e conexão OK.
 * Erro de conexão/certificado = problema de rede ou TLS.
 *
 * Uso (com provider já rodando):
 *   cd consumer && node --env-file=../.env ../scripts/validate-dataplane-auth.js
 * Ou da raiz do demo com .env e certs no lugar:
 *   node --env-file=.env scripts/validate-dataplane-auth.js
 */

import { createDataPlaneClient, parseGrpcEndpoint } from "../shared/dataplane.js";

const REGISTRY_URL = (process.env.REGISTRY_URL || "https://api.meshprotocol.dev").replace(/\/$/, "");
const PROVIDER_DID = "did:mesh:agent:math-expert-public-demo";
const DATAPLANE_ALLOW_INSECURE = (process.env.DATAPLANE_ALLOW_INSECURE || "").trim() === "1";
const DATAPLANE_TLS_CA_CERT_PATH = (process.env.DATAPLANE_TLS_CA_CERT_PATH || "").trim();
const DATAPLANE_TLS_CLIENT_CERT_PATH = (process.env.DATAPLANE_TLS_CLIENT_CERT_PATH || "").trim();
const DATAPLANE_TLS_CLIENT_KEY_PATH = (process.env.DATAPLANE_TLS_CLIENT_KEY_PATH || "").trim();
const DATAPLANE_TLS_SERVER_NAME = (process.env.DATAPLANE_TLS_SERVER_NAME || "").trim();

async function main() {
  console.log("[validate-dataplane-auth] Fetching provider card from registry...");
  const res = await fetch(`${REGISTRY_URL}/agents/${encodeURIComponent(PROVIDER_DID)}`);
  if (!res.ok) {
    console.error("[validate-dataplane-auth] Registry lookup failed:", res.status);
    process.exit(1);
  }
  const data = await res.json();
  const grpcUrl = data?.card?.spec?.endpoints?.data_plane?.grpc || "";
  if (!grpcUrl) {
    console.error("[validate-dataplane-auth] Provider card has no data_plane.grpc endpoint");
    process.exit(1);
  }
  const endpoint = parseGrpcEndpoint(grpcUrl);
  const host = endpoint.split(":")[0];
  const tlsServerName =
    DATAPLANE_TLS_SERVER_NAME ||
    (/^127\.0\.0\.1$|^localhost$/i.test(host) ? "localhost" : "");

  console.log("[validate-dataplane-auth] Connecting to", endpoint, "(tls:", !DATAPLANE_ALLOW_INSECURE + ", serverName:", tlsServerName || "(none)", ")");

  const client = createDataPlaneClient(endpoint, {
    insecure: DATAPLANE_ALLOW_INSECURE,
    caCertPath: DATAPLANE_TLS_CA_CERT_PATH,
    clientCertPath: DATAPLANE_TLS_CLIENT_CERT_PATH,
    clientKeyPath: DATAPLANE_TLS_CLIENT_KEY_PATH,
    serverName: tlsServerName,
  });

  const result = await new Promise((resolve) => {
    client.Handshake(
      {
        session_id: "validate-fake-session",
        session_token: "fake-token",
        consumer_ephemeral_pub: Buffer.alloc(32, 0),
        consumer_did: "did:mesh:agent:validator",
        consumer_did_signature: Buffer.alloc(64, 0),
      },
      (err, response) => resolve({ err, response })
    );
  });

  if (result.err) {
    const code = result.err.code ?? result.err.message;
    const msg = result.err.details || result.err.message || String(result.err);
    if (code === 5 || msg.includes("session_not_found") || msg.includes("NOT_FOUND")) {
      console.log("[validate-dataplane-auth] OK — TLS and connection work. Provider correctly rejected invalid session:", msg);
      process.exit(0);
    }
    if (msg.includes("invalid") || msg.includes("token") || msg.includes("UNAUTHENTICATED")) {
      console.log("[validate-dataplane-auth] OK — TLS and connection work. Provider rejected bad token/signature.");
      process.exit(0);
    }
    console.error("[validate-dataplane-auth] Handshake error:", code, msg);
    process.exit(1);
  }

  console.warn("[validate-dataplane-auth] Unexpected: Handshake succeeded with fake credentials.");
  process.exit(1);
}

main().catch((e) => {
  console.error("[validate-dataplane-auth] Failure:", e.message);
  process.exit(1);
});
