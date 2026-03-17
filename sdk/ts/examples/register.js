/**
 * Example: register an Agent Card in the Registry.
 * Requires: docker compose up -d (Registry at http://localhost:8080)
 *
 * node examples/register.js
 */

import { MeshClient } from '../dist/index.js';
import agentCard from './example-agent-card.json' with { type: 'json' };

const client = new MeshClient({
  natsUrl: process.env.NATS_URL ?? 'nats://localhost:4222',
  registryUrl: process.env.REGISTRY_URL ?? 'http://localhost:8080',
  did: agentCard.metadata.id,
  region: 'global',
});

const result = await client.register(agentCard);
console.log('Registered:', result);
await client.close();
