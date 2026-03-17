# NebulaOS + Mesh — Demo of agents on the mesh

This example shows agents built with **@nebulaos/core** and **@nebulaos/openai** integrated with **Agent Mesh Protocol (AMP)** via **@meshprotocol/sdk**: mesh registration, discovery, matching and task/result exchange via NATS.

Main repository: [mesh_protocol](../) (Control Plane, Registry, Matching).

---

## Demos available

| Demo | Description | LLM |
|------|-----------|-----|
| **Echo (mock)** | Provider and consumer with mock; `assistant` capability, `demo.nebula` domain. | No |
| **Math (OpenAI)** | “Dumb” agent delegates calculations to a mesh specialist. | Yes (OpenAI) |

---

## Demo 1: Echo (mock)

It is used to validate the AMP stack and the request → match flow without depending on the API key.

- **agent-provider/** — Registers Agent Card with `assistant` capability; listens for matches and responds with mock.
- **agent-consumer/** — Publishes a capability request for `demo.nebula` / `assistant` and processes the match.

**How ​​to run:** upload the stack (`docker compose up -d` in the root of the repo), then `npm run run:provider` (terminal 1) and `npm run run:consumer` (terminal 2).

---

## Demo 2: Mathematics with OpenAI (recommended)

Two agents with **OpenAI** (via `@nebulaos/openai`):

- **agent-math-expert/** — Provider offering `calculator` capability in the `demo.math` domain. Solve mathematical questions with LLM and return the result.
- **agent-dumb/** — Consumer who “doesn't know how to do math”: for any calculation, he uses the tool `request_math_from_mesh(question)` and delegates it to the mesh specialist.

### Flow (diagram)

```
User Agent Dumb (consumer) Mesh (NATS) Math Expert (provider)
     |                                |                               |                                |
|  "What's 15*3?"            |                               |                                |
     |------------------------------->|                               |                                |
|                                |  mesh.request(domain: demo.math, capability: calculator)
     |                                |------------------------------->|                                |
|                                |                               |  amp.capability.match           |
|                                |  match (sessionId)            |<--------------------------------|  (Registry + Matching)
     |                                |<-------------------------------|                                |
|                                |  publish mesh.tasks.<sessionId> { description: "What is 15 * 3?" }
     |                                |------------------------------->|                                |
|                                |                               |  subscribe mesh.tasks.<sessionId>
     |                                |                               |-------------------------------->|
|                                |                               |                                |  LLM (OpenAI) → "45"
|                                |                               |  publish mesh.results.<sessionId> { result: "45" }
     |                                |                               |<--------------------------------|
|                                |  subscribe mesh.results.<sessionId> → result "45"
     |                                |<-------------------------------|                                |
|  "The result is 45."           |                               |                                |
     |<-------------------------------|                               |                                |
```

### Prerequisites

- **Stack AMP** running: in the root of the repository, `docker compose up -d` (NATS, Postgres, Registry, Matching).
- **Node 18+**
- **OPENAI_API_KEY** (required for math-expert and agent-dumb).

### Installation

Na pasta `examples/nebula-mesh-demo`:

```bash
npm run install:all
```

(The script uses `--legacy-peer-deps` for `agent-math-expert` and `agent-dumb` because `@nebulaos/openai@0.1.0` declares peer `@nebulaos/core@0.1.1`; here we use core 0.2.6.)

### How to run

1. **Terminal 1 — Math Expert** (leave it running):

   ```bash
export OPENAI_API_KEY=sk-...
npm run run:math-expert
   ```

Expected output: `Registered: did:mesh:agent:math-expert` and `Listening for matches...`.

2. **Terminal 2 — Agent Dumb** (question by argument or pattern):

   ```bash
export OPENAI_API_KEY=sk-...
npm run run:dumb
npm run run:dumb -- "What is 15 * 3?"
npm run run:dumb -- "How much is (15 * 3) ^ 2?"
   ```

The agent calls the tool, receives the match, sends the question in `mesh.tasks.<sessionId>`, receives the answer in `mesh.results.<sessionId>` and returns the result to the user.

### Protocolo task/result (demo)

The official AMP Data Plane (gRPC) is not yet implemented. In this demo, the question/answer exchange between consumer and provider uses **NATS** with two subjects:

| Subject | Direction | Payload |
|---------|---------|---------|
| `mesh.tasks.<sessionId>` | Consumer → Provider | JSON `{ "description": "<user question>" }` |
| `mesh.results.<sessionId>` | Provider → Consumer | JSON `{ "result": "<LLM response>" }` or `{ "error": "..." }` |

The `sessionId` comes from the `amp.capability.match` event after `mesh.request()`. The consumer publishes the task and signs the result subject; the provider subscribes to the task subject, processes it with the LLM, and publishes it to the result subject.

---

## Environment variables

| Variable | Default | Usage |
|-----------------|-----------------------------|-----|
| `NATS_URL` | `nats://localhost:4222` | NATS Broker (Control Plane) |
| `REGISTRY_URL` | `http://localhost:8080` | Registry API (Agent Cards) |
| `OPENAI_API_KEY` | — | Required for agent-math-expert and agent-dumb |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model (optional) |

---

## Repository structure

```
examples/nebula-mesh-demo/
├── package.json              # Scripts: install:all, run:provider, run:consumer, run:math-expert, run:dumb
├── README.md # This documentation
├── agent-provider/           # Demo Echo: provider mock (assistant, demo.nebula)
├── agent-consumer/           # Demo Echo: consumer mock
├── agent-math-expert/        # Math Demo: provider OpenAI (calculator, demo.math)
└── agent-dumb/               # Math Demo: consumer OpenAI + tool request_math_from_mesh
```

Each agent has its own `package.json` and `node_modules`; `install:all` installs on everyone.

---

## Troubleshooting

| Problem | Verification |
|----------|-------------|
| **Consumer timeout** | Is Matching running? `docker compose ps` → `amp-matching` must be Up. Is the provider (math-expert) already running and registered? |
| **Reject "no_providers_available"** | Was math-expert started before consumer? The Agent Card is in the Registry (domain `demo.math`, capability `calculator`). |
| **OPENAI_API_KEY** | Must be defined in the environment when running `run:math-expert` and `run:dumb`. |
| **Peer dependency error** | Use `npm install --legacy-peer-deps` in projects that use `@nebulaos/openai`, or run `npm run install:all` (already applies to OpenAI agents). |

To inspect the Registry:

```bash
curl -s "http://localhost:8080/agents?domain=demo,math&capability=calculator"
```
