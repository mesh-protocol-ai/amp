# Security Rollout Guide (Data Plane)

## Current Mode

- Payload path migrated from `mesh.tasks.*` / `mesh.results.*` to DataPlane gRPC.
- Handshake now enforces:
  - signed `session_token` (HS256),
  - Ed25519 consumer/provider signatures,
  - ephemeral X25519 key exchange.
- DID Document now also publishes `key_agreement` (X25519) for provider/consumer.
- Transfer/Result now use `AES-256-GCM` with per-message nonce and `sequence`.
- Provider now exposes Prometheus metrics on `:METRICS_PORT/metrics`.
- gRPC now supports TLS and optional mTLS (client cert validation).

## Rollout Strategy

1. Deploy provider with `dataplane_capability=v1-e2e` annotation (automatic in current provider script).
2. Enable consumer strict mode (`ALLOW_LEGACY_DATAPLANE=0`) only after provider(s) are updated.
3. Monitor provider metrics logs:
   - `handshakeFailed`
   - `decryptFailed`
   - `replayDetected`
4. If handshake failures spike, temporarily set `ALLOW_LEGACY_DATAPLANE=1` on consumers during incident triage.
5. After stabilization window, remove any legacy fallback and block providers that do not advertise `v1-e2e`.

## Local TLS/mTLS Quickstart

1. Generate dev certs:
   - `npm run certs:dev`
2. Generate Ed25519 keys:
   - `npm run keys:provider`
   - `npm run keys:consumer`
3. Copy `.env.example` to `.env` and fill:
   - `NATS_TOKEN`, `OPENAI_API_KEY`, `SESSION_TOKEN_SECRET`
   - `PROVIDER_ED25519_PRIVATE_KEY_BASE64`, `CONSUMER_ED25519_PRIVATE_KEY_BASE64`
4. Start provider:
   - `npm run run:provider`
5. Start consumer:
   - `npm run run:consumer -- "What is 17 * 23?"`
6. Verify metrics:
   - `curl -s http://localhost:9095/metrics | rg "mesh_provider_dataplane_"`

## Operational Hardening

- Keep `SESSION_TOKEN_SECRET` rotated and out of source control.
- Keep Ed25519 private keys outside repository and inject only via environment.
- Enforce TLS transport for gRPC endpoints in non-local environments:
  - Set `DATAPLANE_ALLOW_INSECURE=0`
  - Set `DATAPLANE_TLS_SERVER_CERT_PATH` + `DATAPLANE_TLS_SERVER_KEY_PATH`
  - Set `DATAPLANE_TLS_CA_CERT_PATH`
- Enable mTLS when both sides are ready:
  - Provider: `DATAPLANE_TLS_REQUIRE_CLIENT_CERT=1`
  - Consumer: `DATAPLANE_TLS_CLIENT_CERT_PATH` + `DATAPLANE_TLS_CLIENT_KEY_PATH`
- Use `DATAPLANE_TLS_SERVER_NAME` on consumer when certificate CN/SAN does not match endpoint host.
- Alert on any `replayDetected` event (treat as suspicious traffic).
- Reject providers without `did_document` in registry metadata.

## Key Generation

- Generate consumer keypair:
  - `npm run keys:consumer`
- Generate provider keypair:
  - `npm run keys:provider`
- Copy `<ROLE>_ED25519_PRIVATE_KEY_BASE64` into `.env`.
- Use `<ROLE>_ED25519_PUBLIC_KEY_BASE64` only for diagnostics/audits (public data).

## Prometheus Metrics

Main metrics:
- `mesh_provider_dataplane_handshake_total{outcome,reason}`
- `mesh_provider_dataplane_transfer_total{outcome,reason}`
- `mesh_provider_dataplane_decrypt_failures_total{reason}`
- `mesh_provider_dataplane_replay_total{reason}`
- `mesh_provider_dataplane_phase_duration_seconds{phase}`

## Deploy Checklist (Production)

- `session_token` signing secret rotated and sourced from secret manager.
- gRPC with `DATAPLANE_ALLOW_INSECURE=0`.
- Valid server cert/key configured and signed by trusted CA.
- mTLS enabled (`DATAPLANE_TLS_REQUIRE_CLIENT_CERT=1`) where client identity is required.
- `DATAPLANE_TLS_SERVER_NAME` validated in consumer environment.
- Ed25519 private keys injected by runtime secret manager (never in repo).
- Alerts configured for:
  - handshake failures spike,
  - decrypt failures > baseline,
  - replay detections > 0.
- Metrics endpoint restricted to trusted network or protected scrape path.
