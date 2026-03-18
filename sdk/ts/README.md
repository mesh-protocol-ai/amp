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

## Community (OPEN) session token

In the **Community** edition (security level `OPEN`), the session token is a simple HMAC, not a JWT. The format is:

- **Algorithm:** `HMAC-SHA256(secret, session_id|consumer_did|provider_did)`, output **base64url**.
- **Contract:** Aligned with `pkg/session/simple.go` in the core repo; the matching service issues the token, and the data-plane provider validates it in the Handshake.

**SDK exports:**

- `issueSimpleToken(secret, sessionId, consumerDid, providerDid)` — issues a token (e.g. for tests or tooling that emulates the matcher).
- `validateSimpleToken(tokenString, secret, sessionId, consumerDid, providerDid)` — returns `true` if the token is valid; use this in the gRPC Handshake handler to verify the token sent by the consumer.

For OPEN vs STANDARD/Enterprise (JWT, E2E encryption), see [COMMUNITY_VS_ENTERPRISE.md](../../COMMUNITY_VS_ENTERPRISE.md) in the repo root.

## Development

- Node 18+.
- TypeScript; build output in `dist/`.

```bash
cd sdk/ts
npm install
npm run build
npm test
```

For full runnable examples (agents on the mesh), see the [nebula-mesh-demo](../../examples/nebula-mesh-demo/) and [public-mesh-openai-demo](../../examples/public-mesh-openai-demo/) in the monorepo root. The public-mesh-openai-demo includes unit tests for the SDK surface (security, dataplane, session token).
