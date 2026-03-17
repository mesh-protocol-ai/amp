// Package events defines AMP event payloads (data) for request, bid, and match.
package events

// CapabilityRequestData is the "data" of event amp.capability.request (SPECS 7.4.1).
type CapabilityRequestData struct {
	Task        *RequestTask        `json:"task"`
	Constraints *RequestConstraints `json:"constraints,omitempty"`
	BidConfig   *BidConfig          `json:"bid_config,omitempty"`
}

type RequestTask struct {
	Description   string   `json:"description,omitempty"`
	CapabilityID string   `json:"capability_id"`
	Domain       []string `json:"domain"`
	Language     string   `json:"language,omitempty"`
	Priority     string   `json:"priority,omitempty"`
}

type RequestConstraints struct {
	MaxLatencyMs   int      `json:"max_latency_ms,omitempty"`
	MaxCostUSD    float64  `json:"max_cost_usd,omitempty"`
	MinTrustScore float64  `json:"min_trust_score,omitempty"`
	DataResidency []string `json:"data_residency,omitempty"`
}

type BidConfig struct {
	WindowMs          int    `json:"window_ms,omitempty"`
	MaxBids           int    `json:"max_bids,omitempty"`
	SelectionStrategy string `json:"selection_strategy,omitempty"`
}

// CapabilityMatchData is the "data" of event amp.capability.match (SPECS 7.4.3).
type CapabilityMatchData struct {
	RequestID    string       `json:"request_id"`
	WinningBidID string       `json:"winning_bid_id,omitempty"` // MVP: can be "direct"
	Parties      MatchParties `json:"parties"`
	AgreedTerms  AgreedTerms  `json:"agreed_terms"`
	Session      MatchSession `json:"session"`
}

type MatchParties struct {
	Consumer string `json:"consumer"`
	Provider string `json:"provider"`
}

type AgreedTerms struct {
	CostUSD        float64 `json:"cost_usd,omitempty"`
	MaxLatencyMs   int     `json:"max_latency_ms,omitempty"`
	Tier           string  `json:"tier,omitempty"`
	SecurityLevel  string  `json:"security_level,omitempty"`
	ContractHash   string  `json:"contract_hash,omitempty"`
	SlaPenalty     bool    `json:"sla_penalty_enabled,omitempty"`
}

type MatchSession struct {
	SessionID   string `json:"session_id"`
	CreatedAt   string `json:"created_at"`
	ExpiresAt   string `json:"expires_at"`
	SessionToken string `json:"session_token,omitempty"` // JWT or opaque token in MVP
}
