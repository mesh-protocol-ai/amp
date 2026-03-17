/**
 * AMP event payloads (CloudEvent data).
 * Aligned with Go pkg/events and SPECS 7.4.
 */

// ----- Request (amp.capability.request) -----

export interface CapabilityRequestData {
  task: RequestTask;
  constraints?: RequestConstraints;
  bid_config?: BidConfig;
}

export interface RequestTask {
  description?: string;
  capability_id: string;
  domain: string[];
  language?: string;
  priority?: string;
}

export interface RequestConstraints {
  max_latency_ms?: number;
  max_cost_usd?: number;
  min_trust_score?: number;
  data_residency?: string[];
}

export interface BidConfig {
  window_ms?: number;
  max_bids?: number;
  selection_strategy?: string;
}

// ----- Match (amp.capability.match) -----

export interface CapabilityMatchData {
  request_id: string;
  winning_bid_id?: string;
  parties: MatchParties;
  agreed_terms: AgreedTerms;
  session: MatchSession;
}

export interface MatchParties {
  consumer: string;
  provider: string;
}

export interface AgreedTerms {
  cost_usd?: number;
  max_latency_ms?: number;
  tier?: string;
  security_level?: string;
  contract_hash?: string;
  sla_penalty_enabled?: boolean;
}

export interface MatchSession {
  session_id: string;
  created_at: string;
  expires_at: string;
  session_token?: string;
}

// ----- Reject (amp.capability.reject) -----

export interface CapabilityRejectData {
  request_id: string;
  reason: string;
}

// ----- SDK result types (normalized) -----

export interface MatchResult {
  kind: 'match';
  requestId: string;
  sessionId: string;
  sessionToken: string;
  parties: { consumer: string; provider: string };
  agreedTerms: AgreedTerms;
}

export interface RejectResult {
  kind: 'reject';
  requestId: string;
  reason: string;
}

export function matchDataToResult(data: CapabilityMatchData): MatchResult {
  return {
    kind: 'match',
    requestId: data.request_id,
    sessionId: data.session.session_id,
    sessionToken: data.session.session_token ?? '',
    parties: data.parties,
    agreedTerms: data.agreed_terms,
  };
}
