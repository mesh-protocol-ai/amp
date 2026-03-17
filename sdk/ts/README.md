# @meshprotocol/sdk (TypeScript)

Official Agent Mesh Protocol SDK for Node.js. Published as `@meshprotocol/sdk`.

- **Monorepo:** root in `mesh_protocol/`; contracts and protocols aligned with core Go.

## Usage

```ts
import { MeshClient } from '@meshprotocol/sdk';

const client = new MeshClient({
  natsUrl: process.env.NATS_URL ?? 'nats://localhost:4222',
  registryUrl: process.env.REGISTRY_URL ?? 'http://localhost:8080',
  did: 'did:mesh:agent:my-agent-001',
  auth: { type: 'api_key', apiKey: process.env.REGISTRY_API_KEY },
  region: 'global',
});

// Provider: register agent
await client.register(agentCard);

// Provider: listen for matches
await client.listen(async (match) => {
  console.log('Match received', match.sessionId);
});

// Consumer: request capability
const result = await client.request({
  domain: ['demo', 'echo'],
  capabilityId: 'echo',
  timeoutMs: 10_000,
});
if (result.kind === 'match') {
  console.log('Matched with', result.parties.provider);
}
```

## Development

- Node 18+.
- TypeScript; build output in `dist/`.

```bash
cd sdk/ts
npm install
npm run build
```

For full runnable examples (agents on the mesh), see the [nebula-mesh-demo](../../examples/nebula-mesh-demo/) in the monorepo root.
