/**
 * Example: consumer publishes request and waits for match or reject.
 * Requires: docker compose up -d (NATS + Registry + Matching)
 *
 * node examples/request.js
 */

import { MeshClient } from '../dist/index.js';

const client = new MeshClient({
  natsUrl: process.env.NATS_URL ?? 'nats://localhost:4222',
  registryUrl: process.env.REGISTRY_URL ?? 'http://localhost:8080',
  did: 'did:mesh:agent:example-consumer',
  region: 'global',
});

const result = await client.request({
  domain: ['demo', 'echo'],
  capabilityId: 'echo',
  description: 'Example request from SDK',
  timeoutMs: 15_000,
});

if (result.kind === 'match') {
  console.log('Match:', result.parties.provider, result.sessionId);
} else {
  console.log('Reject:', result.reason);
}
await client.close();
