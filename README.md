# Agent Mesh Protocol (AMP) — MVP

Specification and reference implementation of the **Agent Mesh Protocol**: decentralized network of AI agents with discovery, matching and secure data plane.

Full documentation: [SPECS.md](./SPECS.md).

## Delivery model

- Open source vs Enterprise boundaries: [COMMUNITY_VS_ENTERPRISE.md](./COMMUNITY_VS_ENTERPRISE.md)
- Product positioning: [POSITIONING.md](./POSITIONING.md)
- Security, support, and contribution:
  - [SECURITY.md](./SECURITY.md)
  - [SUPPORT.md](./SUPPORT.md)
  - [CONTRIBUTING.md](./CONTRIBUTING.md)
  - [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## Phase 0 — Foundation

- **Control Plane:** NATS with JetStream
- **Schemas:** Protobuf (Data Plane) + JSON Schema (Agent Card)
- **Envelope:** CloudEvents with AMP extensions
- **Identity:** DIDs `did:mesh:agent:<id>` (generation and verification)

## Phase 1 — Registry and Matching

- **Registry:** Agent Cards HTTP CRUD API (PostgreSQL)
- **Matching:** Listens to `mesh.requests.>`, queries Registry, filters by domain/capability/data_residency, selects provider (lowest latency) and publishes `amp.capability.match` in `mesh.matches`

## Prerequisites

- [Go 1.21+](https://go.dev/dl/)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Buf](https://buf.build/docs/installation) (optional, to generate protos)

## Quick start

### Start full stack (NATS + Postgres + Registry + Matching)

```bash
docker compose up -d
```

- **NATS:** `nats://localhost:4222` (monitoring: http://localhost:8222)
- **Registry:** http://localhost:8080
- **Postgres:** localhost:5432 (user `amp`, password `amp`, db `amp_registry`)

### Register an Agent Card

```bash
curl -s -X POST http://localhost:8080/agents \
  -H "Content-Type: application/json" \
  -d @fixtures/example-agent-card.json
```

### List agents (by domain/capability)

```bash
curl -s "http://localhost:8080/agents?domain=demo,echo&capability=echo"
```

### Demo: NebulaOS agents on the mesh

In **[examples/nebula-mesh-demo/](./examples/nebula-mesh-demo/)** there are examples with **@nebulaos/core**, **@nebulaos/openai** and **@meshprotocol/sdk**:

- **Demo Echo (mock):** provider and consumer without real LLM; validate request → match.
- **Mathematics Demo (OpenAI):** “dumb” agent that delegates calculations to a **math-expert** in the mesh; both use OpenAI. Includes tool `request_math_from_mesh` and task/result protocol via NATS.

With the stack up (`docker compose up -d`), run the provider in one terminal and the consumer in another. Full documentation: [examples/nebula-mesh-demo/README.md](./examples/nebula-mesh-demo/README.md).

### Publish a request (NATS) and receive a match

Matching subscribes to `mesh.requests.>`. Publish a CloudEvent of type `amp.capability.request` in a subject like `mesh.requests.demo.echo.global` with `data.task.domain`, `data.task.capability_id` etc. Matching consults the Registry, chooses a provider and publishes an `amp.capability.match` event in `mesh.matches`. Consumers and providers must subscribe to `mesh.matches` and filter by `parties.consumer` / `parties.provider`.

### Generate proto code

```bash
make proto
# or: docker run --rm -v "$(pwd):/workspace" -w /workspace bufbuild/buf:latest generate
```

### Run tests

```bash
go test ./pkg/...
# NATS E2E test: go test ./pkg/nats/...
```

### Run lint

```bash
go vet ./...
```

## Repository structure

| Path | Description |
|-----------|-----------|
| `proto/` | Protobuf (Data Plane) Settings |
| `schemes/` | JSON Schema (Agent Card) |
| `pkg/` | Shared libs (cloudevents, did, agentcard, events) |
| `services/registry/` | Agent Cards HTTP CRUD API |
| `services/matching/` | Matching engine (request → match) |
| `deployments/` | Init SQL, configs |
| `fixtures/` | Example of Agent Card for testing |
| `sdk/ts/` | TypeScript SDK (@mesh-protocol/sdk) — see [sdk/ts/docs/API_DESIGN.md](./sdk/ts/docs/API_DESIGN.md) |
| `SPECS.md` | Full Protocol Specification |

## Registry API

| Method | Path | Description |
|-----------|------|-----------|
| POST | /agents | Register or update Agent Card |
| GET | /agents | List (query: `domain`, `capability`, `status`) |
| GET | /agents/:id | Get a card through DID |
| PATCH | /agents/:id/status | Update status (active, suspended, etc.) |
| DELETE | /agents/:id | Remove card |

## License

This repository is licensed under Apache-2.0. See [LICENSE](./LICENSE).
