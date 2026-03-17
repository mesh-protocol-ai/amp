// Package agentcard defines the Agent Card model (SPECS 5) used by Registry and Matching.
package agentcard

import "encoding/json"

// Card is the Go representation of Agent Card (MVP).
type Card struct {
	Metadata Metadata `json:"metadata"`
	Spec     Spec     `json:"spec"`
	Status   *Status  `json:"status,omitempty"`
}

// Agent Card metadata.
type Metadata struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Version     string            `json:"version"`
	Created     string            `json:"created,omitempty"`
	Updated     string            `json:"updated,omitempty"`
	Owner       string            `json:"owner"`
	Labels      map[string]string  `json:"labels,omitempty"`
	Annotations map[string]any    `json:"annotations,omitempty"`
}

// Agent Card spec.
type Spec struct {
	Domains       Domains       `json:"domains"`
	Capabilities  []Capability  `json:"capabilities"`
	Operational   *Operational  `json:"operational,omitempty"`
	Endpoints     Endpoints     `json:"endpoints"`
	ContextContract *ContextContractRef `json:"context_contract,omitempty"`
}

// Domains (primary/secondary/tags).
type Domains struct {
	Primary   []string `json:"primary"`
	Secondary []string `json:"secondary,omitempty"`
	Tags      []string `json:"tags,omitempty"`
}

// Capability provided by the agent.
type Capability struct {
	ID          string   `json:"id"`
	Description string   `json:"description,omitempty"`
	Languages   []string `json:"languages,omitempty"`
}

// Operational limits.
type Operational struct {
	MaxConcurrentTasks int      `json:"max_concurrent_tasks,omitempty"`
	AvgLatencyMs       int      `json:"avg_latency_ms,omitempty"`
	Regions            *Regions `json:"regions,omitempty"`
}

// Regions (deployed, data_residency).
type Regions struct {
	Deployed    []string `json:"deployed,omitempty"`
	DataResidency []string `json:"data_residency,omitempty"`
}

// Endpoints (control plane + data plane).
type Endpoints struct {
	ControlPlane ControlPlaneEndpoint `json:"control_plane"`
	DataPlane    DataPlaneEndpoint    `json:"data_plane"`
}

// ControlPlaneEndpoint (NATS subject).
type ControlPlaneEndpoint struct {
	NATSSubject string `json:"nats_subject"`
}

// DataPlaneEndpoint (gRPC, etc).
type DataPlaneEndpoint struct {
	GRPC      string `json:"grpc"`
	WebSocket string `json:"websocket,omitempty"`
}

// ContextContractRef points to the contract.
type ContextContractRef struct {
	Ref  string `json:"ref,omitempty"`
	Hash string `json:"hash,omitempty"`
}

// Agent status (health, trust_score, etc).
type Status struct {
	Health        string  `json:"health,omitempty"`
	LastHeartbeat string  `json:"last_heartbeat,omitempty"`
	TrustScore    float64 `json:"trust_score,omitempty"`
	TotalTasks    int     `json:"total_tasks,omitempty"`
	SuccessRate   float64 `json:"success_rate,omitempty"`
}

// HasDomain checks whether the card matches the domain (primary or secondary).
func (c *Card) HasDomain(domain []string) bool {
	if len(domain) == 0 {
		return true
	}
	// request domain is a hierarchical list, e.g. ["finance", "credit-analysis"]
	// card primary is e.g. ["finance", "credit-analysis"]
	for _, p := range c.Spec.Domains.Primary {
		for _, d := range domain {
			if p == d {
				return true
			}
		}
	}
	for _, s := range c.Spec.Domains.Secondary {
		for _, d := range domain {
			if s == d {
				return true
			}
		}
	}
	return false
}

// HasCapability checks whether the card provides capability_id.
func (c *Card) HasCapability(capabilityID string) bool {
	for _, cap := range c.Spec.Capabilities {
		if cap.ID == capabilityID {
			return true
		}
	}
	return false
}

// DataResidency returns card data residency regions (e.g. ["BR"]).
func (c *Card) DataResidency() []string {
	if c.Spec.Operational != nil && c.Spec.Operational.Regions != nil {
		return c.Spec.Operational.Regions.DataResidency
	}
	return nil
}

// AvgLatencyMs returns declared average latency (for matching ranking).
func (c *Card) AvgLatencyMs() int {
	if c.Spec.Operational != nil && c.Spec.Operational.AvgLatencyMs > 0 {
		return c.Spec.Operational.AvgLatencyMs
	}
	return 10000
}

// CardFromJSON parses an Agent Card from JSON.
func CardFromJSON(b []byte) (*Card, error) {
	var c Card
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}
