# AMP Public Endpoint — meshprotocol.dev

A live instance of the AMP control plane is available for developers to test against — no setup required. Free tier, rate-limited.

## Endpoints

| Service | URL | Protocol |
|---------|-----|----------|
| Registry API | `https://api.meshprotocol.dev` | HTTPS |
| Registry (alt) | `https://registry.meshprotocol.dev` | HTTPS |
| NATS / JetStream | `nats.meshprotocol.dev:4222` | TCP |

## Quick start

### 1. Get the dev token

The public NATS token is published on the [GitHub Releases](https://github.com/mesh-protocol-ai/amp/releases) page and updated periodically.

### 2. Set environment variables

```bash
export REGISTRY_URL="https://api.meshprotocol.dev"
export NATS_URL="nats://<DEV_TOKEN>@nats.meshprotocol.dev:4222"
```

### 3. Run an example

With the stack variables set, the examples in this repo work out of the box — no local Docker needed:

```bash
# Enterprise multi-department demo
cd examples/enterprise-mesh-demo
npm install
npm run run:hr &
npm run run:finance &
npm run run:legal &
npm run run:executive
```

```bash
# NebulaOS math demo (requires OPENAI_API_KEY)
cd examples/nebula-mesh-demo
npm install
node agent-math-expert/index.js &
node agent-dumb/index.js
```

## Registry API reference

### Register an agent

```bash
curl -s -X POST https://api.meshprotocol.dev/agents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "did:mesh:agent:my-agent-001",
    "name": "My Agent",
    "version": "1.0.0",
    "domains": ["my.domain"],
    "capabilities": [{ "id": "my-capability", "description": "Does something" }],
    "endpoint": { "grpc": "my-host:50051" },
    "data_residency": ["global"]
  }'
```

### List agents

```bash
# All agents
curl -s https://api.meshprotocol.dev/agents | jq

# Filter by domain
curl -s "https://api.meshprotocol.dev/agents?domain=company.hr" | jq

# Filter by capability
curl -s "https://api.meshprotocol.dev/agents?capability=hr-query" | jq
```

### Health check

```bash
curl -s https://api.meshprotocol.dev/health
# → {"status":"ok"}
```

## Connecting via SDK

```typescript
import { MeshClient } from "@meshprotocol/sdk";

const mesh = new MeshClient({
  natsUrl: process.env.NATS_URL,   // nats://<token>@nats.meshprotocol.dev:4222
  registryUrl: process.env.REGISTRY_URL,
  agentDid: "did:mesh:agent:my-agent",
});

await mesh.register(myAgentCard);

// Request a capability from the mesh
const { sessionId } = await mesh.request({
  domain: "company.hr",
  capabilityId: "hr-query",
  dataResidency: "global",
});
```

## Rate limits (free tier)

| Resource | Limit |
|----------|-------|
| Registry registrations | 100 agents / IP / day |
| Registry GET requests | 1000 req / IP / hour |
| NATS connections | 50 concurrent / token |
| NATS message payload | 1 MB |
| NATS subscriptions | 100 / connection |

Limits are designed to support real development workloads. If you hit them during a legitimate use case, open an issue.

## Self-hosting

To run your own AMP control plane (full stack: NATS + Registry + Matching + Caddy):

```bash
git clone https://github.com/mesh-protocol-ai/amp.git
cd amp/deployments/public
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD and NATS_TOKEN
docker compose up -d --build
```

See [deployments/public/README.md](./deployments/public/README.md) for full instructions including DNS setup and Oracle VM configuration.

## Status

Check endpoint health at any time:

```bash
cd deployments/public && ./test-services.sh
```

---

Issues or questions? Open a [GitHub issue](https://github.com/mesh-protocol-ai/amp/issues).
