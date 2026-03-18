package main

import (
	"context"
	"testing"

	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
	"github.com/mesh-protocol-ai/amp/pkg/events"
)

// mockLister implements RegistryLister for tests.
type mockLister struct {
	cards []*agentcard.Card
	err   error
}

func (m *mockLister) ListCandidates(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.cards, nil
}

func validCard(id string, avgLatencyMs int) *agentcard.Card {
	c := &agentcard.Card{
		Metadata: agentcard.Metadata{
			ID:      id,
			Name:    "test-agent",
			Version: "1.0.0",
			Owner:   "did:mesh:org:test",
		},
		Spec: agentcard.Spec{
			Domains: agentcard.Domains{Primary: []string{"test"}},
			Capabilities: []agentcard.Capability{
				{ID: "echo", Description: "Echo"},
			},
			Endpoints: agentcard.Endpoints{
				ControlPlane: agentcard.ControlPlaneEndpoint{NATSSubject: "mesh.agent.test"},
				DataPlane:    agentcard.DataPlaneEndpoint{GRPC: "grpc://localhost:50051"},
			},
		},
	}
	if avgLatencyMs > 0 {
		c.Spec.Operational = &agentcard.Operational{AvgLatencyMs: avgLatencyMs}
	}
	return c
}

func TestMatchEngine_SelectMatch_NoCandidates(t *testing.T) {
	engine := &MatchEngine{SessionTokenSecret: []byte("secret")}
	lister := &mockLister{cards: nil}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{Domain: []string{"test"}, CapabilityID: "echo"},
	}
	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:consumer", "req-1", "corr-1")
	if result.RejectReason != "no_providers_available" {
		t.Errorf("expected no_providers_available, got %q", result.RejectReason)
	}
	if result.MatchData != nil {
		t.Error("expected nil MatchData")
	}
}

func TestMatchEngine_SelectMatch_RegistryError(t *testing.T) {
	engine := &MatchEngine{SessionTokenSecret: []byte("secret")}
	lister := &mockLister{err: errRegistry}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{Domain: []string{"test"}, CapabilityID: "echo"},
	}
	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:consumer", "req-1", "corr-1")
	if result.RejectReason != "registry_error" {
		t.Errorf("expected registry_error, got %q", result.RejectReason)
	}
}

var errRegistry = &registryErr{}

type registryErr struct{}

func (e *registryErr) Error() string { return "registry error" }

func TestMatchEngine_SelectMatch_OneProvider(t *testing.T) {
	engine := &MatchEngine{SessionTokenSecret: []byte("test-secret")}
	card := validCard("did:mesh:agent:provider-1", 100)
	lister := &mockLister{cards: []*agentcard.Card{card}}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{Domain: []string{"test"}, CapabilityID: "echo"},
	}
	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:consumer", "req-1", "corr-1")
	if result.RejectReason != "" {
		t.Fatalf("expected match, got reject %q", result.RejectReason)
	}
	if result.MatchData == nil {
		t.Fatal("expected MatchData")
	}
	if result.MatchData.Parties.Provider != "did:mesh:agent:provider-1" {
		t.Errorf("Parties.Provider: got %q", result.MatchData.Parties.Provider)
	}
	if result.MatchData.Parties.Consumer != "did:mesh:agent:consumer" {
		t.Errorf("Parties.Consumer: got %q", result.MatchData.Parties.Consumer)
	}
	if result.MatchData.Session.SessionID == "" {
		t.Error("SessionID empty")
	}
	if result.MatchData.Session.SessionToken == "" {
		t.Error("SessionToken empty")
	}
	if result.MatchData.AgreedTerms.SecurityLevel != "OPEN" {
		t.Errorf("SecurityLevel: got %q", result.MatchData.AgreedTerms.SecurityLevel)
	}
}

func TestMatchEngine_SelectMatch_MultipleProviders_SelectsLowestLatency(t *testing.T) {
	engine := &MatchEngine{SessionTokenSecret: []byte("secret")}
	high := validCard("did:mesh:agent:high-latency", 500)
	low := validCard("did:mesh:agent:low-latency", 50)
	mid := validCard("did:mesh:agent:mid-latency", 200)
	lister := &mockLister{cards: []*agentcard.Card{high, low, mid}}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{Domain: []string{"test"}, CapabilityID: "echo"},
	}
	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:c", "req-1", "corr-1")
	if result.RejectReason != "" {
		t.Fatalf("expected match, got reject %q", result.RejectReason)
	}
	if result.MatchData.Parties.Provider != "did:mesh:agent:low-latency" {
		t.Errorf("expected lowest latency provider, got %q", result.MatchData.Parties.Provider)
	}
}

func TestMatchEngine_SelectMatch_InvalidRequest(t *testing.T) {
	engine := &MatchEngine{SessionTokenSecret: []byte("secret")}
	lister := &mockLister{cards: []*agentcard.Card{validCard("did:mesh:agent:p", 100)}}
	result := engine.SelectMatch(context.Background(), lister, nil, "did:c", "req-1", "corr-1")
	if result.RejectReason != "invalid_request" {
		t.Errorf("expected invalid_request, got %q", result.RejectReason)
	}
	reqData := &events.CapabilityRequestData{Task: nil}
	result = engine.SelectMatch(context.Background(), lister, reqData, "did:c", "req-1", "corr-1")
	if result.RejectReason != "invalid_request" {
		t.Errorf("expected invalid_request (nil task), got %q", result.RejectReason)
	}
}
