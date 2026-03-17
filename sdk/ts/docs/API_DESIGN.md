# @mesh-protocol/sdk — API Design

TypeScript SDK for the Agent Mesh Protocol (AMP). Monorepo, Node.js only, async, published as `@mesh-protocol/sdk`.

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

All async (Promises). Three main functions + one for data plane.

| Method | Who uses it | Description |
|--------|----------|-----------|
| `register(agentCard)` | Provider | Register/update Agent Card in the Registry. |
| `request(options)` | Consumer | Publishes capability request, waits for match or reject. |
| `listen(handler)` | Provider | Listen to matches intended for this agent; calls handler. |
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

**Objective:** Consumer asks for a capacity; the SDK publishes the request to NATS and expects match or reject in `mesh.matches`.

### Calls

| Where | What |
|------|--------|
| **NATS** | `PUB mesh.requests.{domain}.{region}` — payload = CloudEvent `amp.capability.request`. |
| **NATS** | `SUB mesh.matches` — filters by `correlationId` or `data.request_id` until it receives `amp.capability.match` or `amp.capability.reject`. |

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
reason: string;  // ex: 'no_providers_available', 'registry_error'
}
```

### Flow

1. Generate `requestId` (ex: UUID v7) and assemble subject: `mesh.requests.{domain.join('.')}.{region || 'global'}` (e.g. `mesh.requests.demo.echo.global`).
2. Build CloudEvent `amp.capability.request` (spec 1.0, type, source=options.did, data=CapabilityRequestData, AMP extensions: correlationId=requestId).
3. Subscribe to `mesh.matches` **before** publishing (so you don't miss the event).
4. Publish in the subject of step 1.
5. Loop/await until receiving message in `mesh.matches` where `correlationId === requestId` (or `data.request_id === requestId`):
- Se `type === 'amp.capability.match'` → return `MatchResult`.
- Se `type === 'amp.capability.reject'` → return `RejectResult`.
6. Se `timeoutMs` estourar → throw (ex: `TimeoutError`).

### Exported contracts

- `RequestOptions`, `RequestConstraints`, `MatchResult`, `RejectResult`, `AgreedTerms`.
- CloudEvent data types: `CapabilityRequestData`, `CapabilityMatchData`, `CapabilityRejectData` (request_id, reason).

---

## 5. list(dealer)

**Objective:** Provider listens to matches in which it is chosen and reacts (e.g. prepare data plan, execute task).

### Calls

| Where | What |
|------|--------|
| **NATS** | `SUB mesh.matches` — filter messages where `data.parties.provider === this.did`. |

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

1. Subscribe to `mesh.matches`.
2. For each message: parse CloudEvent; if `type === 'amp.capability.match'` and `data.parties.provider === options.did`, call `handler(matchPayload)`.
3. Return object with `unsubscribe()` which unsubscribes in NATS.

### Exported contracts

- `MatchHandler`, `ListenSubscription`; reuse `MatchResult` from request.

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
| **request** | — | PUB mesh.requests.{domain}.{region}; SUB mesh.matches | — (v1.1: consumer uses match for session) |
| **listen** | — | SUB mesh.matches (filter provider) | — |
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
