# Agent Mesh Protocol (AMP)

An open protocol for AI agents to find and call each other across organizational boundaries — without knowing each other's addresses in advance.

Full specification: [SPECS.md](./SPECS.md) · Security: [THREAT_MODEL.md](./THREAT_MODEL.md) · Control plane plan: [docs/CONTROL_PLANE_EVOLUTION.md](./docs/CONTROL_PLANE_EVOLUTION.md) · Rollout checklist: [docs/CONTROL_PLANE_CHECKLIST.md](./docs/CONTROL_PLANE_CHECKLIST.md)

---

## The problem this solves

When you build a system with multiple AI agents, one of two things happens:

**Option A — hardcode:** Agent A knows Agent B's URL. You ship. Six months later Agent B moves, changes its API, or you want to replace it. Every caller breaks.

**Option B — build a service registry:** You spend weeks building discovery, auth, routing, and session management from scratch. You end up with something bespoke that nobody else can integrate with.

AMP is Option C: a protocol — not a platform — that any agent can speak. An agent publishes what it can do. Another agent asks the network for that capability. AMP finds the match, issues a session token, and gets out of the way. The two agents talk directly.

```
consumer agent                  AMP control plane               provider agent
─────────────                   ─────────────────               ──────────────
"I need a finance analyst"  →   find match in registry      →
                            ←   "did:mesh:agent:fin-001"    ←
connect + session token     ────────────────────────────────→   validate token
send task                   ────────────────────────────────→
                            ←───────────────────────────────    return result
```

No hardcoded URLs. No custom discovery logic. No per-integration auth negotiation.

---

## When to use AMP

**Use AMP when:**
- You have agents built by different teams or organizations that need to call each other
- You want to swap out a provider (e.g., upgrade a model, change a vendor) without touching consumers
- You need an audit trail of which agent talked to which, and when
- You want to add agents to a running system without redeploying consumers

**Do not use AMP when:**
- You have a fixed set of services that will never change — a direct HTTP call is simpler
- You need sub-millisecond latency — the matching round-trip adds ~10–50ms
- You are building LLM-to-tool integration — use [MCP](https://modelcontextprotocol.io) for that (AMP and MCP are complementary)

---

## How it works

Every agent publishes an **Agent Card**: a JSON document declaring its identity, what domains it operates in, and what capabilities it offers.

```json
{
  "metadata": { "id": "did:mesh:agent:finance-v2" },
  "spec": {
    "domains": ["finance"],
    "capabilities": [{ "id": "budget-analysis", "description": "Annual budget review" }],
    "endpoints": { "data_plane": { "grpc": "finance-agent.example.com:443" } }
  }
}
```

When a consumer needs a capability:
1. It publishes a `CapabilityRequest` on NATS with `domain` and `capability_id`
2. The matching engine queries the registry and picks the best provider
3. Both parties receive a session token — a short-lived proof that this match is legitimate
4. The consumer connects directly to the provider's gRPC endpoint and presents the token
5. The provider validates the token and processes the request

All of this happens over TLS. In Enterprise, payload is additionally end-to-end encrypted (AES-256-GCM with ECDH ephemeral keys).

---

## Security model

AMP has four security levels, defined in the protocol:

| Level | What it means | Status |
|---|---|---|
| OPEN | TLS + session token (HMAC) | Community — implemented |
| STANDARD | OPEN + E2E encryption (X25519 + AES-256-GCM) + Ed25519 handshake | Enterprise |
| CONFIDENTIAL | STANDARD + TEE attestation | Spec only |
| RESTRICTED | Code moves to data (data never leaves the TEE) | Spec only |

The session token binds a match to a specific `(consumer_did, provider_did, session_id)` triplet. A token captured in transit is only usable for that exact session.

For concrete attack scenarios and mitigations: [THREAT_MODEL.md](./THREAT_MODEL.md).

---

## Control plane status

AMP's current control plane implements the MVP slices described in [docs/CONTROL_PLANE_EVOLUTION.md](./docs/CONTROL_PLANE_EVOLUTION.md) and the rollout checklist in [docs/CONTROL_PLANE_CHECKLIST.md](./docs/CONTROL_PLANE_CHECKLIST.md). Highlights:

- Matching (`services/matching`) now listens on `mesh.requests.>` (NATS) with `SESSION_TOKEN_SECRET`, replies on request `reply` subjects when supplied, and publishes directed events to `mesh.matches.{consumer_id}` and `mesh.matches.{provider_id}` while keeping `mesh.matches` for compatibility and audit.
- Providers keep themselves eligible by publishing heartbeats (`mesh.agents.heartbeat.<did>`) and matching keeps a TTL-backed presence cache (default 90s) plus a registry cache (default 60s TTL, refresh every 30s) so stale agents are filtered automatically.
- Matching logs candidate exclusion reasons, optionally publishes matches/rejects to JetStream when `ENABLE_JETSTREAM_AUDIT=1`, and follows the migration notes in [docs/CONTROL_PLANE_GAPS.md](./docs/CONTROL_PLANE_GAPS.md). Consumers and providers should subscribe to the directed subjects or rely on the request-reply flow described in [sdk/ts/docs/API_DESIGN.md](./sdk/ts/docs/API_DESIGN.md).

Production deployment guidance that keeps this behavior aligned is in [docs/DEPLOY_MATCHING_AWS.md](./docs/DEPLOY_MATCHING_AWS.md).

## Quick start

**Requirements:** Go 1.22+, Docker, Docker Compose.

```bash
# Copy and fill in secrets
cp .env.example .env
# edit: set POSTGRES_PASSWORD, NATS_TOKEN, SESSION_TOKEN_SECRET, REGISTRY_WRITE_TOKEN, RELAY_PUBLIC_HOST

# Start NATS + Postgres + Registry + Matching + Relay
docker compose up -d
```

**Register an agent:**
```bash
curl -s -X POST http://localhost:8080/agents \
  -H "Authorization: Bearer <REGISTRY_WRITE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d @fixtures/example-agent-card.json
```

**Query the registry:**
```bash
curl -s "http://localhost:8080/agents?domain=demo&capability=echo"
```

**Run tests:**
```bash
go test ./pkg/...
```

---

## Examples

### Public mesh demo — real agents over the internet

`examples/public-mesh-openai-demo/` connects a consumer and a provider to `meshprotocol.dev` (the public AMP endpoint). The consumer asks a math question via OpenAI tool use; the provider answers using `gpt-5-nano`. Shows the full flow: register → match → handshake → transfer → result.

→ [examples/public-mesh-openai-demo/README.md](./examples/public-mesh-openai-demo/README.md)

### Enterprise multi-department mesh

`examples/enterprise-mesh-demo/` shows an Executive agent querying HR, Finance, and Legal specialists in parallel and consolidating the result. All coordination happens through AMP — no direct calls between agents.

### Data plane metrics support

The SDK now supports a built-in observability helper (`createDataPlaneObservability`) e2e for Prometheus metrics in DataPlaneServer and DataPlaneConsumerClient. The `examples/public-mesh-openai-demo` provider shows this in action via `metricsServer` at `:9095/metrics`.

```
executive → mesh → [hr, finance, legal]  (parallel, ~380ms)
                       ↓       ↓       ↓
                   headcount  budget  compliance
                       └───────────────┘
                            report
```

→ [examples/enterprise-mesh-demo/README.md](./examples/enterprise-mesh-demo/README.md)

---

## Repository structure

| Path | What it is |
|---|---|
| `proto/` | gRPC data plane definition |
| `schemas/` | Agent Card JSON Schema |
| `pkg/` | Go packages: agentcard, cloudevents, did, events, session |
| `services/registry/` | Registry HTTP API (Go) |
| `services/matching/` | Matching engine: request → provider selection → session token (Go) |
| `sdk/ts/` | TypeScript SDK (`@meshprotocol/sdk`) |
| `deployments/public/` | Docker Compose + Caddy for self-hosting AMP |
| `SPECS.md` | Full protocol specification |
| `THREAT_MODEL.md` | Attack scenarios, mitigations, security defaults |
| `COMMUNITY_VS_ENTERPRISE.md` | What is open source vs commercial |

---

## Registry API

Write endpoints (`POST`, `PATCH`, `DELETE`) require `Authorization: Bearer <REGISTRY_WRITE_TOKEN>` when `REGISTRY_WRITE_TOKEN` is set. Read endpoints are public.

| Method | Path | Auth required |
|---|---|---|
| `POST` | `/agents` | Write token |
| `GET` | `/agents` | None |
| `GET` | `/agents/:id` | None |
| `PATCH` | `/agents/:id/status` | Write token |
| `DELETE` | `/agents/:id` | Write token |
| `GET` | `/health` | None |

---

## Self-hosting

To run your own AMP endpoint: [HOSTING.md](./HOSTING.md).

## Public mesh hosts

| Service | Address | Notes |
|---|---|---|
| Registry API | `https://api.meshprotocol.dev` / `https://registry.meshprotocol.dev` | TLS (Caddy) proxies the registry service. `POST/PATCH/DELETE` require `REGISTRY_WRITE_TOKEN`; see [HOSTING.md](./HOSTING.md) for the public write token and health checks. |
| NATS / JetStream | `nats.meshprotocol.dev:4222` | Connect as `nats://<DEV_TOKEN>@nats.meshprotocol.dev:4222`. Consumers, providers, and matching all share this broker and use it for requests, matches, heartbeats, and metrics events. |
| Data plane relay | `relay.meshprotocol.dev:7000` (control), `relay.meshprotocol.dev:7001` (data), `relay.meshprotocol.dev:50100–50199` (consumer gRPC) | Providers set `RELAY_HOST=relay.meshprotocol.dev`, register over the control channel, and open data channels when requested. `computeRelayPort(did)` mirrors the relay's deterministic port assignment. |
| Matching | `nats.meshprotocol.dev:4222` (`mesh.requests.>` / `mesh.matches.*`) | The public matching engine subscribes to `mesh.requests.>` and publishes matches/rejects to `mesh.matches.{consumer_id}`, `mesh.matches.{provider_id}`, and `mesh.matches`. `SESSION_TOKEN_SECRET` must match the providers; see [docs/DEPLOY_MATCHING_AWS.md](./docs/DEPLOY_MATCHING_AWS.md) for deployment details. |

---

## License

Apache-2.0. See [LICENSE](./LICENSE).

Community vs Enterprise feature boundary: [COMMUNITY_VS_ENTERPRISE.md](./COMMUNITY_VS_ENTERPRISE.md).
