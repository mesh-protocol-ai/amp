# AMP Threat Model

This document describes real attack scenarios against an AMP deployment, what the current implementation does about each one, and what remains the operator's responsibility.

It is written for people deploying or integrating AMP — not for academic purposes.

---

## What AMP protects against (and what it does not)

AMP is a **matching and transport layer**. It does not protect against:
- A malicious provider that is intentionally registered by its owner
- Compromise of the machine running a provider or consumer
- Misconfigured TLS (expired certs, weak cipher suites)
- Operator error (leaked `SESSION_TOKEN_SECRET`, open registry, etc.)

It does protect against:
- An attacker intercepting traffic between agents (TLS + E2E in Enterprise)
- A provider receiving a request without a valid session token
- Replay of a captured valid session token to a different provider

---

## Attack Scenarios

### A1 — Rogue Agent Registration

**What the attacker does:**
Anyone who knows the registry URL (`https://api.meshprotocol.dev/agents`) sends a `POST /agents` with a crafted Agent Card claiming to be a finance or HR specialist. The legitimate matching engine picks it up and routes real requests to the attacker's endpoint.

**Example:**
```bash
curl -X POST https://api.meshprotocol.dev/agents \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": {"id": "did:mesh:agent:fake-finance"},
    "spec": {
      "domains": ["finance"],
      "capabilities": [{"id": "budget-analysis"}],
      "endpoints": {"data_plane": {"grpc": "attacker.example.com:443"}}
    }
  }'
```

**What AMP does:**
`REGISTRY_WRITE_TOKEN` enforces bearer token auth on all write endpoints. Without the token, the registry returns `401`. If the token is not set, the registry logs a startup warning — it is deliberately not a hard failure to allow local dev.

**What you must do:**
Set `REGISTRY_WRITE_TOKEN` in production. Rotate it if compromised. Do not expose the registry write endpoints publicly without this token.

**Residual risk:**
If `REGISTRY_WRITE_TOKEN` is leaked, an attacker can register agents. Token rotation requires redeployment.

---

### A2 — Session Token Replay

**What the attacker does:**
The attacker observes NATS traffic (or compromises the NATS broker) and captures a `CapabilityMatch` event containing a valid `session_token`. They replay that token directly against the provider's gRPC data plane endpoint, bypassing the matching engine entirely.

**What AMP does (Community):**
The session token is `HMAC-SHA256(SESSION_TOKEN_SECRET, session_id|consumer_did|provider_did)`. It binds the token to a specific consumer DID, provider DID, and session ID. A replayed token is only valid for that exact triplet. If the provider validates the DID correctly in the Handshake, a replayed token from a different consumer DID is rejected.

**What AMP does (Enterprise):**
JWT with `exp` claim (short TTL, typically 60s). Replayed tokens expire. Combined with E2E ECDH ephemeral keys — even a captured token cannot decrypt a new session.

**What you must do:**
Keep `SESSION_TOKEN_SECRET` secret. Share it only between the matching engine and providers. Never log it. In Community, tokens do not expire — minimize the time between match and handshake.

**Residual risk (Community):**
Tokens do not expire in Community. An attacker who captures a valid token can attempt a handshake until the token is revoked (manual).

---

### A3 — Provider Impersonation

**What the attacker does:**
A legitimate provider is registered with a real Agent Card. The attacker clones the Agent Card (all fields are public) and registers an agent with the same `domains` and `capabilities` but pointing to their endpoint. The matching engine may select the attacker's agent.

**What AMP does:**
Agent Cards have unique `metadata.id` (`did:mesh:agent:<id>`). Registration with a duplicate ID overwrites the existing card only if `REGISTRY_WRITE_TOKEN` is valid. Without write auth, a second registration of the same ID is rejected by the uniqueness constraint on the database.

**What you must do:**
Lock write access with `REGISTRY_WRITE_TOKEN`. Monitor the registry for unexpected agent registrations (query `GET /agents` periodically).

**Residual risk:**
An attacker with a valid write token can overwrite any Agent Card. Write tokens should be scoped per-agent in a future iteration (see roadmap).

---

### A4 — Man-in-the-Middle on the Data Plane

**What the attacker does:**
The attacker positions themselves between consumer and provider on the gRPC data plane connection. They intercept `Transfer` messages and read the payload.

**What AMP does (Community):**
TLS is required on the gRPC connection. `DATAPLANE_ALLOW_INSECURE=0` enforces this. Payload is sent as raw bytes over TLS — no E2E encryption. If TLS is correctly configured, a passive eavesdropper cannot read the payload.

**What AMP does (Enterprise):**
E2E encryption with ECDH ephemeral keys (X25519) + HKDF-SHA384 + AES-256-GCM. The broker (NATS) and any intermediary see only ciphertext. Breaking TLS does not expose the payload.

**What you must do (Community):**
Use TLS with valid certificates. Do not set `DATAPLANE_ALLOW_INSECURE=1` in production. Run providers behind a reverse proxy (Caddy, Nginx) that terminates TLS with a valid certificate.

**Residual risk (Community):**
TLS termination at the proxy means payload is in plaintext between the proxy and the provider process. For sensitive data, use Enterprise (E2E).

---

### A5 — NATS Broker Compromise

**What the attacker does:**
The attacker gains access to the NATS broker (compromised credentials, misconfigured cluster). They can read all control plane messages: `CapabilityRequest`, `CapabilityMatch`, `CapabilityReject`. They can inject fake `CapabilityMatch` messages to redirect traffic.

**What AMP does:**
The `session_token` in a `CapabilityMatch` is signed with `SESSION_TOKEN_SECRET`. A fake match injected by the attacker without the correct `SESSION_TOKEN_SECRET` will be rejected by the provider during the Handshake. An attacker who compromises NATS but not `SESSION_TOKEN_SECRET` can disrupt matching (DoS) but cannot redirect sessions.

**What you must do:**
Use `NATS_TOKEN` auth. In production, use NATS credentials (NKeys), not plain tokens. Monitor NATS for unexpected subjects or publishers.

**Residual risk:**
A compromised NATS broker with knowledge of `SESSION_TOKEN_SECRET` can forge valid matches. Keep these two secrets independent (different rotation schedules, different storage).

---

### A6 — Consumer DID Spoofing

**What the attacker does:**
A consumer sends a `CapabilityRequest` on NATS claiming to be `did:mesh:agent:legitimate-company`. The matching engine uses `ev.Source()` as the consumer DID and embeds it in the session token.

**What AMP does:**
The consumer DID in the session token is set by the matching engine from `ev.Source()` — which is the CloudEvent `source` field. Any NATS client with a valid NATS token can publish with any `source`. The provider checks the consumer DID during Handshake against the registry, but the identity of the publisher is not cryptographically bound.

**What you must do:**
In Community, trust the consumer DID only as far as you trust NATS access control. Restrict NATS publish permissions per-subject per-client using NKeys (not plain tokens). In Enterprise, consumer DID is verified by Ed25519 signature during Handshake.

**Residual risk (Community):**
Without NKeys or signed CloudEvents, a NATS client with publish access can spoof any consumer DID. This is an explicit Community limitation.

---

### A7 — Registry Data Exfiltration

**What the attacker does:**
`GET /agents` is a public endpoint — by design, so consumers and the matching engine can discover providers. An attacker scrapes the full registry to enumerate all agents, their domains, capabilities, and data plane endpoints.

**What AMP does:**
This is by design. Agent Cards are public metadata — the protocol requires discoverability. Sensitive data (business logic, internal systems) must never appear in an Agent Card.

**What you must do:**
Never put internal IP addresses, internal service names, or business-sensitive information in an Agent Card. The `endpoints.data_plane.grpc` field should point to a public-facing endpoint (behind a proxy), not an internal address.

**Residual risk:**
None from the protocol perspective. Risk is entirely in what operators put in Agent Cards.

---

## Security defaults summary

| Control | Community default | How to harden |
|---|---|---|
| Registry write auth | Off (warning at startup) | Set `REGISTRY_WRITE_TOKEN` |
| Data plane TLS | Required (`DATAPLANE_ALLOW_INSECURE=0`) | Use valid cert, not self-signed in prod |
| Session token expiry | No expiry (HMAC) | Use Enterprise (JWT with TTL) |
| Consumer DID binding | Soft (NATS source field) | Use NKeys + Enterprise (Ed25519 sig) |
| E2E encryption | No (TLS only) | Use Enterprise (AES-256-GCM) |
| NATS auth | Optional token | Use NKeys in production |

---

## Operating modes

### Safe mode (`AMP_SAFE_MODE=1`)

Sets production-safe defaults regardless of other env vars:
- `REGISTRY_WRITE_TOKEN` becomes required (server refuses to start if unset)
- `SESSION_TOKEN_SECRET` already required (existing behavior)
- `DATAPLANE_ALLOW_INSECURE` is forced to `0`
- Startup logs print a security checklist

Set `AMP_SAFE_MODE=1` in any environment that handles real traffic.

### Local-only mode (`AMP_LOCAL_ONLY=1`)

Runs without external dependencies for development and testing:
- Registry uses in-memory store (no PostgreSQL required)
- Matching runs in-process (no NATS required)
- No traffic leaves the machine
- Auth is disabled (not useful locally)

Set `AMP_LOCAL_ONLY=1` in unit tests, CI, and local development.

---

## What is not covered here

- **Key rotation**: documented in `SPECS.md` section 15.2
- **HSM/KMS integration**: Enterprise only
- **RBAC/ABAC on matching**: Enterprise only
- **Immutable audit trail**: Enterprise only
- **TEE (RESTRICTED security level)**: spec-only, not yet implemented

---

## Reporting vulnerabilities

Use GitHub Security Advisories (private). Do not publish exploitable details in public issues. See [SECURITY.md](./SECURITY.md).
