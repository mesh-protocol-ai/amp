# @mesh-protocol/sdk — API Design

See also the control-plane rollout documents for the production migration path: [../../../docs/CONTROL_PLANE_EVOLUTION.md](../../../docs/CONTROL_PLANE_EVOLUTION.md) and [../../../docs/CONTROL_PLANE_CHECKLIST.md](../../../docs/CONTROL_PLANE_CHECKLIST.md).

TypeScript SDK for the Agent Mesh Protocol (AMP). Monorepo, Node.js only, async, published as `@mesh-protocol/sdk`.

Current MVP status (Mar 2026):

- `request()` uses NATS request-reply first.
- During rollout, matching also publishes `amp.capability.match` and `amp.capability.reject` to `mesh.matches.{consumer_id}`, `mesh.matches.{provider_id}`, and legacy `mesh.matches`.
- `listen()` subscribes to the directed provider subject and keeps legacy `mesh.matches` compatibility.
- Providers can publish presence via `startHeartbeat()` / `stopHeartbeat()`.

---

## 1. Configuration and authentication

### 1.1 Customer Options

```ts
interface MeshClientOptions {
/** NATS URL (e.g. nats://broker.mesh.example:4222) */
natsUrl: string;
/** Registry base URL (e.g. https://registry.mesh.example) */
registryUrl: string;
/** DID of the agent/organization that uses this client (e.g. did:mesh:agent:my-agent-001) */
did: string;
/** Auth for Registry (demo: API Key or Bearer) */
auth?: {
    type: 'api_key' | 'bearer';
apiKey?: string;   // header X-API-Key
token?: string;    // header Authorization: Bearer <token>
  };
/** Auth for NATS (optional; demo can be without auth) */
natsAuth?: {
token?: string;
// user/pass, NKey, etc. in future versions
  };
/** Region to mount request subject (e.g. global, br) */
region?: string;
}
```

### 1.2 Who calls what

| Component | Responsible | Auth (demo) |
|-------------|--------------------|------------------|
| NATS        | Control plane      | Optional (token) |
| Registry | You (HTTP API) | API Key or Bearer|
| Data Plane  | Provider (gRPC)    | Session token    |

---

## 2. Public API (high level)

All async (Promises). Core control-plane functions plus one data-plane helper.

| Method | Who uses it | Description |
|--------|----------|-----------|
| `register(agentCard)` | Provider | Register/update Agent Card in the Registry. |
| `request(options)` | Consumer | Publishes capability request, waits for match or reject. |
| `listen(handler)` | Provider | Listen to matches intended for this agent; calls handler. |
| `startHeartbeat(intervalMs?)` | Provider | Publishes periodic heartbeat on the control plane. |
| `stopHeartbeat()` | Provider | Stops the heartbeat loop started by `startHeartbeat()`. |
| `openDataPlaneSession(match)` | Consumer | (Phase 2) Open gRPC session with the match provider. |

---

## 3. register(agentCard)

**Objective:** Publish an Agent Card in the mesh (Registry).

### Calls

| Where | What |
|------|--------|
| **Registry** | `POST /agents` — body = Agent Card JSON. |

NATS: not mandatory in v1 (Matching only uses the Registry). Optionally after: `PUB mesh.agents.register` with `amp.agent.register` event for auditing.

### Signature

```ts
function register(agentCard: AgentCard, options?: { status?: 'active' | 'draft' }): Promise<RegisterResult>;

interface RegisterResult {
id: string;   // agentCard.metadata.id
status: string;
}
```

### Flow

1. Validate `agentCard` (metadata.id, spec.domains, spec.capabilities, spec.endpoints).
2. `POST {registryUrl}/agents` with auth header; body = `agentCard`.
3. If 200 -> return `{ id, status }`; otherwise throw with status/message.

### Exported contracts

- `AgentCard` (and nested types: Metadata, Spec, Domains, Capabilities, Endpoints, etc.) — aligned to the Registry schema and Go's `pkg/agentcard`.

---

## 4. request(options)

**Objective:** Consumer asks for a capability; the SDK publishes the request to NATS and waits for match or reject using request-reply first, with compatibility fallback on directed and legacy match subjects.

### Calls

| Where | What |
|------|--------|
| **NATS** | `PUB mesh.requests.{domain}.{region}` — payload = CloudEvent `amp.capability.request`. |
| **NATS** | `REQ/REP mesh.requests.{domain}.{region}` — matching replies directly when `reply` is present. |
| **NATS** | Compatibility during rollout: `SUB mesh.matches.{consumer_id}` and `SUB mesh.matches` until a matching event arrives. |

Registry: not called by the consumer in this flow. gRPC: not in v1 (control plane only); in v1.1 the caller can use the returned `Match` to call `openDataPlaneSession` by account or via the SDK.

### Signature

```ts
function request(options: RequestOptions): Promise<MatchResult | RejectResult>;

interface RequestOptions {
/** Hierarchical domain (e.g. ['demo', 'echo']) */
domain: string[];
/** Capability ID (e.g. 'echo') */
capabilityId: string;
/** Optional task description */
description?: string;
/** Language (from: 'pt-BR') */
language?: string;
/** Constraints (max_latency_ms, data_residency, etc.) */
  constraints?: RequestConstraints;
/** Timeout to wait for match/reject (ms); default 30000 */
timeoutMs?: number;
}

interface RequestConstraints {
maxLatencyMs?: number;
maxCostUsd?: number;
minTrustScore?: number;
dataResidency?: string[];
}

interface MatchResult {
kind: 'match';
requestId: string;
sessionId: string;
sessionToken: string;
parties: { consumer: string; provider: string };
agreedTerms: AgreedTerms;
/** For data plane: resolve provider endpoint via Registry if necessary */
}

interface RejectResult {
kind: 'reject';
requestId: string;
reason: string;  // current MVP returns strings such as 'no_providers_available', 'registry_error' and may include diagnostic suffixes
}
```

### Flow

1. Generate `requestId` (ex: UUID v7) and assemble subject: `mesh.requests.{domain.join('.')}.{region || 'global'}` (e.g. `mesh.requests.demo.echo.global`).
2. Build CloudEvent `amp.capability.request` (spec 1.0, type, source=options.did, data=CapabilityRequestData, AMP extensions: correlationId=requestId).
3. Publish that event using NATS request-reply (`request()`), which creates a reply inbox automatically.
4. Keep temporary compatibility subscriptions on `mesh.matches.{consumer_id}` and legacy `mesh.matches` while waiting for the first valid answer.
5. The first message matching `correlationId === requestId` (or `data.request_id === requestId`) wins:
- Se `type === 'amp.capability.match'` → return `MatchResult`.
- Se `type === 'amp.capability.reject'` → return `RejectResult`.
6. Se `timeoutMs` estourar → throw (ex: `TimeoutError`).

### Exported contracts

- `RequestOptions`, `RequestConstraints`, `MatchResult`, `RejectResult`, `AgreedTerms`.
- CloudEvent data types: `CapabilityRequestData`, `CapabilityMatchData`, `CapabilityRejectData` (request_id, reason).

---

## 5. listen(handler)

**Objective:** Provider listens to matches addressed to its DID and reacts (e.g. prepare data plane, execute task).

### Calls

| Where | What |
|------|--------|
| **NATS** | `SUB mesh.matches.{provider_id}` — current primary routing path for provider notifications. |
| **NATS** | Compatibility during rollout: `SUB mesh.matches` and filter where `data.parties.provider === this.did`. |

Registry: not in the listen itself. The consumer can then use the Registry to resolve the provider's gRPC endpoint (GET /agents/:providerDid) if the match does not return the URL.

### Signature

```ts
function listen(handler: MatchHandler): Promise<ListenSubscription>;

type MatchHandler = (match: MatchResult) => void | Promise<void>;

interface ListenSubscription {
/** Closes subscription */
unsubscribe(): Promise<void>;
}
```

### Flow

1. Subscribe to `mesh.matches.{provider_id}`.
2. Keep legacy `mesh.matches` subscription during rollout.
3. For each message: parse CloudEvent; if `type === 'amp.capability.match'` and it is addressed to this provider, call `handler(matchPayload)`.
4. Return object with `unsubscribe()` which unsubscribes in NATS.

### Exported contracts

- `MatchHandler`, `ListenSubscription`; reuse `MatchResult` from request.

### 5.1 Provider presence: `startHeartbeat()` / `stopHeartbeat()`

**Objective:** Keep a provider eligible when matching is filtering candidates by recent heartbeat.

### Calls

| Where | What |
|------|--------|
| **NATS** | `PUB mesh.agents.heartbeat.{sanitized_did}` — payload JSON `{ did, timestamp }`. |

### Signature

```ts
async function startHeartbeat(intervalMs?: number): Promise<void>;
async function stopHeartbeat(): Promise<void>;
```

### Flow

1. `startHeartbeat()` publishes an immediate heartbeat.
2. It starts an interval that republishes every `intervalMs` milliseconds. Default current value: `30000`.
3. `stopHeartbeat()` clears that interval.

### Current contract (MVP)

- Subject: `mesh.agents.heartbeat.{sanitized_did}`
- Payload: JSON `{ "did": "did:mesh:agent:provider-1", "timestamp": "2026-03-19T12:00:00Z" }`
- Matching also accepts CloudEvent-formatted heartbeats for compatibility.
- Provider apps must call this explicitly today; it is not automatic in the current SDK lifecycle.

---

## 6. openDataPlaneSession(match) — Fase 2

**Objective:** Consumer, after receiving a match, opens a gRPC session with the provider to send payload and receive results.

### Calls

| Where | What |
|------|--------|
| **Registry** | `GET /agents/{match.parties.provider}` — obter `spec.endpoints.data_plane.grpc`. |
| **gRPC** | Connection to the provider endpoint; calls `DataPlane.Handshake`, `DataPlane.Transfer`, `DataPlane.Result` (protos converted to TS). |

### Signature (draft)

```ts
function openDataPlaneSession(match: MatchResult): Promise<DataPlaneSession>;

interface DataPlaneSession {
/** Sends payload and returns result (MVP: TLS only, without E2E) */
sendPayload(payload: Uint8Array | string): Promise<Uint8Array | string>;
close(): void;
}
```

### Flow

1. Resolve endpoint: if it doesn't appear in the match, `GET {registryUrl}/agents/{match.parties.provider}` and read `card.spec.endpoints.data_plane.grpc`.
2. Establish gRPC channel; call `Handshake(session_id, session_token, consumer_did, ...)`.
3. Expose `sendPayload` → `Transfer(stream)`; then `Result(session_id)` to receive response.
4. Protos: convert `proto/amp/dataplane/v1/dataplane.proto` to TypeScript (ts-proto or grpc-tools) and generate client.

---

## 7. Summary: NATS vs Registry vs gRPC

| API | Registry | NATS | gRPC |
|-----|----------|------|------|
| **register** | POST /agents | — (optional: pub lifecycle) | — |
| **request** | — | REQ/REP mesh.requests.{domain}.{region}; rollout compatibility on `mesh.matches.{consumer_id}` and `mesh.matches` | — (v1.1: consumer uses match for session) |
| **listen** | — | SUB `mesh.matches.{provider_id}`; rollout compatibility on `mesh.matches` | — |
| **startHeartbeat / stopHeartbeat** | — | PUB `mesh.agents.heartbeat.{sanitized_did}` | — |
| **openDataPlaneSession** | GET /agents/:id (resolver endpoint) | — | Handshake, Transfer, Result |

---

## 8. Contracts to be distributed (monorepo)

- **Agent Card:** `AgentCard`, `Metadata`, `Spec`, `Domains`, `Capability`, `Operational`, `Regions`, `Endpoints`, `Status` — espelhar `pkg/agentcard` + `schemas/agent-card.schema.json`.
- **AMP events:** `CapabilityRequestData`, `CapabilityMatchData`, reject (request_id, reason); CloudEvent types (specversion, type, source, id, time, data, AMP extensions).
- **Data plane (when to implement):** types generated from `proto/amp/dataplane/v1/dataplane.proto` (HandshakeRequest/Response, EncryptedChunk, TransferAck, ResultRequest).

Keep types in `sdk/ts/src/contracts/` (or `types/`) and export in the package; optionally publish a `@mesh-protocol/contracts` in the future.

---

## 9. Authentication (demo)

- **Registry:** header `X-API-Key: <key>` or `Authorization: Bearer <token>`; configurable in `MeshClientOptions.auth`.
- **NATS:** no auth or token in connection options; evolve to user/password or NKey as needed.
- **Data plane:** session_token of the match used in the Handshake (MVP: opaque token; then JWT).

---

## 10. Version and publishing

- npm package: `@mesh-protocol/sdk`.
- Semver; initial phase 0.x.y.
- Build: TypeScript → dist (ESM + CJS if desired); tests with local stack or fixtures.

Next step: implement in `sdk/ts/src/` according to this design (register → request/listen → open data plane when protos are in TS).
