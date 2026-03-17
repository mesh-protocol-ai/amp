/**
 * @mesh-protocol/sdk — Agent Mesh Protocol SDK for Node.js
 */

export { MeshClient } from './client.js';
export type {
  MeshClientOptions,
  RegisterOptions,
  RegisterResult,
  RequestOptions,
  MatchHandler,
  ListenSubscription,
} from './client.js';

export type {
  AgentCard,
  AgentCardMetadata,
  AgentCardSpec,
  AgentCardDomains,
  AgentCapability,
  AgentOperational,
  AgentEndpoints,
  AgentCardStatus,
} from './contracts/agent-card.js';
export { validateAgentCard } from './contracts/agent-card.js';

export type {
  CapabilityRequestData,
  CapabilityMatchData,
  CapabilityRejectData,
  MatchResult,
  RejectResult,
  RequestTask,
  RequestConstraints,
  MatchParties,
  AgreedTerms,
  MatchSession,
} from './contracts/events.js';
export { matchDataToResult } from './contracts/events.js';

export {
  newCloudEvent,
  parseCloudEvent,
  serializeCloudEvent,
  getAMPExtensions,
  AMP_VERSION,
  EVENT_TYPES,
} from './cloudevents.js';
export type { CloudEvent, AMPExtensions } from './cloudevents.js';
