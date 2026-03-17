/**
 * Agent Card - contract aligned with Registry and SPECS 5.
 * Exported by SDK for whoever builds/validates cards.
 */

export interface AgentCard {
  metadata: AgentCardMetadata;
  spec: AgentCardSpec;
  status?: AgentCardStatus;
}

export interface AgentCardMetadata {
  id: string;
  name: string;
  version: string;
  created?: string;
  updated?: string;
  owner: string;
  labels?: Record<string, string>;
  annotations?: Record<string, unknown>;
  did_document?: {
    id: string;
    verification_method: Array<{
      id: string;
      type: string;
      controller: string;
      public_key_base64: string;
    }>;
    key_agreement?: Array<{
      id: string;
      type: string;
      controller: string;
      public_key_base64: string;
    }>;
  };
}

export interface AgentCardSpec {
  domains: AgentCardDomains;
  capabilities: AgentCapability[];
  operational?: AgentOperational;
  endpoints: AgentEndpoints;
  context_contract?: { ref?: string; hash?: string };
}

export interface AgentCardDomains {
  primary: string[];
  secondary?: string[];
  tags?: string[];
}

export interface AgentCapability {
  id: string;
  description?: string;
  languages?: string[];
}

export interface AgentOperational {
  max_concurrent_tasks?: number;
  avg_latency_ms?: number;
  regions?: { deployed?: string[]; data_residency?: string[] };
}

export interface AgentEndpoints {
  control_plane: { nats_subject: string };
  data_plane: { grpc: string; websocket?: string };
}

export interface AgentCardStatus {
  health?: string;
  last_heartbeat?: string;
  trust_score?: number;
  total_tasks?: number;
  success_rate?: number;
}

const DID_AGENT_REGEX = /^did:mesh:agent:[a-zA-Z0-9_-]+$/;
const DID_ORG_REGEX = /^did:mesh:org:[a-zA-Z0-9_-]+$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * Minimal Agent Card validation (MVP). Throws if invalid.
 */
export function validateAgentCard(card: AgentCard): void {
  if (!card?.metadata?.id || !DID_AGENT_REGEX.test(card.metadata.id)) {
    throw new Error('metadata.id must match did:mesh:agent:<id>');
  }
  if (!card.metadata.name?.trim()) {
    throw new Error('metadata.name is required');
  }
  if (!card.metadata.version || !SEMVER_REGEX.test(card.metadata.version)) {
    throw new Error('metadata.version must be semver (e.g. 1.0.0)');
  }
  if (!card.metadata.owner || !DID_ORG_REGEX.test(card.metadata.owner)) {
    throw new Error('metadata.owner must match did:mesh:org:<id>');
  }
  if (card.metadata.did_document) {
    if (card.metadata.did_document.id !== card.metadata.id) {
      throw new Error('metadata.did_document.id must equal metadata.id');
    }
    if (!card.metadata.did_document.verification_method?.length) {
      throw new Error('metadata.did_document.verification_method must be non-empty');
    }
    for (let i = 0; i < card.metadata.did_document.verification_method.length; i++) {
      const vm = card.metadata.did_document.verification_method[i];
      if (!vm.id?.trim() || !vm.type?.trim() || !vm.controller?.trim() || !vm.public_key_base64?.trim()) {
        throw new Error(`metadata.did_document.verification_method[${i}] is invalid`);
      }
    }
    if (card.metadata.did_document.key_agreement) {
      if (!card.metadata.did_document.key_agreement.length) {
        throw new Error("metadata.did_document.key_agreement must be non-empty when provided");
      }
      for (let i = 0; i < card.metadata.did_document.key_agreement.length; i++) {
        const vm = card.metadata.did_document.key_agreement[i];
        if (!vm.id?.trim() || !vm.type?.trim() || !vm.controller?.trim() || !vm.public_key_base64?.trim()) {
          throw new Error(`metadata.did_document.key_agreement[${i}] is invalid`);
        }
      }
    }
  }
  if (!card.spec?.domains?.primary?.length) {
    throw new Error('spec.domains.primary is required and non-empty');
  }
  if (!card.spec?.capabilities?.length) {
    throw new Error('spec.capabilities is required and non-empty');
  }
  for (let i = 0; i < card.spec.capabilities.length; i++) {
    if (!card.spec.capabilities[i].id?.trim()) {
      throw new Error(`spec.capabilities[${i}].id is required`);
    }
  }
  if (!card.spec?.endpoints?.control_plane?.nats_subject?.trim()) {
    throw new Error('spec.endpoints.control_plane.nats_subject is required');
  }
  if (!card.spec?.endpoints?.data_plane?.grpc?.trim()) {
    throw new Error('spec.endpoints.data_plane.grpc is required');
  }
}
