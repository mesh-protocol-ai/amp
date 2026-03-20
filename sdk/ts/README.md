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

## Data plane observability (Prometheus)

`@meshprotocol/sdk` agora oferece helpers opcionais para métricas de DataPlane (Handshake / Transfer / fase de processamento) via `prom-client`.

- `createDataPlaneObservability({ prefix?: string, register?: client.Registry })`
- `DataPlaneServerOptions.metrics` (hooks compatíveis com clientes do `prom-client`)
- `DataPlaneConsumerOptions.metrics`

Exemplo provider:

```js
import { DataPlaneServer, createDataPlaneObservability, createServerCredentials } from '@meshprotocol/sdk';
import http from 'node:http';

const { register, handshakeCounter, transferCounter, phaseLatency } = createDataPlaneObservability({ prefix: 'mesh_provider_' });

const metricsServer = http.createServer(async (req, res) => {
  if (req.url !== '/metrics') {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': register.contentType });
  res.end(await register.metrics());
});
metricsServer.listen(9095);

const dpServer = new DataPlaneServer({
  sessionTokenSecret: process.env.SESSION_TOKEN_SECRET,
  providerDid: 'did:mesh:provider:xyz',
  metrics: { handshakeCounter, transferCounter, phaseLatency },
});

// ... register on mesh, listen for matches, addSession etc ...
```

Em `DataPlaneServer`, métricas são atualizadas automaticamente:
- handshake success/failure + reason
- transfer success/failure + reason
- fases: handshake, transfer, processing

## Provider data-plane resolution helper

`resolveProviderDataPlaneEndpoint` simplifica o caminho de consumo: basta informar o DID do provider, a URL do registry e as credenciais (token/API key) que o helper já faz o `GET /agents/:id`, valida a card e retorna o `data_plane.grpc` com um `serverName` pronto para o `DataPlaneConsumerClient`.

Importar `RegistryAuth`/`ResolveProviderDataPlaneOptions` permite sobrescrever `tlsServerName`, passar `fetch` customizado (útil em testes) ou anexar um `AbortSignal`.

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
