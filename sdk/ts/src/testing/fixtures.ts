/**
 * Test/demo fixtures for Agent Card and session token.
 * Use in tests or demos; for production registration use real cards.
 */

import type { AgentCard } from '../contracts/agent-card.js';
import { issueSimpleToken } from '../session/simple.js';

/**
 * Returns a minimal valid Agent Card (Community) for tests or demos.
 * Aligned with schemas and Registry validation.
 */
export function getExampleAgentCard(overrides?: Partial<AgentCard>): AgentCard {
  const card: AgentCard = {
    metadata: {
      id: 'did:mesh:agent:echo-demo-001',
      name: 'EchoAgent',
      version: '1.0.0',
      owner: 'did:mesh:org:demo',
      annotations: { description: 'Example agent that returns the received payload (echo)' },
    },
    spec: {
      domains: { primary: ['demo', 'echo'], tags: ['mvp', 'test'] },
      capabilities: [
        { id: 'echo', description: 'Returns the received input', languages: ['pt-BR', 'en'] },
      ],
      endpoints: {
        control_plane: { nats_subject: 'mesh.agents.demo.echo' },
        data_plane: { grpc: 'grpc://echo-agent.demo.mesh:443' },
      },
    },
    status: { health: 'healthy', trust_score: 5 },
  };
  if (overrides) {
    return { ...card, ...overrides } as AgentCard;
  }
  return card;
}

/**
 * Convenience helper for tests: issues a Community (OPEN) session token.
 * Same as issueSimpleToken; use when building match fixtures or testing provider validation.
 */
export function createTestSessionToken(
  secret: string | Buffer,
  sessionId: string,
  consumerDid: string,
  providerDid: string
): string {
  return issueSimpleToken(secret, sessionId, consumerDid, providerDid);
}
