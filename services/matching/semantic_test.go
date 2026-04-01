package main

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
	"github.com/mesh-protocol-ai/amp/pkg/events"
)

// --- CosineSimilarity tests ---

func TestCosineSimilarity_IdenticalVectors(t *testing.T) {
	a := []float64{1, 2, 3}
	b := []float64{1, 2, 3}
	score := CosineSimilarity(a, b)
	if math.Abs(score-1.0) > 0.001 {
		t.Errorf("identical vectors should have score ~1.0, got %.4f", score)
	}
}

func TestCosineSimilarity_OrthogonalVectors(t *testing.T) {
	a := []float64{1, 0, 0}
	b := []float64{0, 1, 0}
	score := CosineSimilarity(a, b)
	if math.Abs(score) > 0.001 {
		t.Errorf("orthogonal vectors should have score ~0.0, got %.4f", score)
	}
}

func TestCosineSimilarity_ZeroVector(t *testing.T) {
	a := []float64{1, 2, 3}
	b := []float64{0, 0, 0}
	score := CosineSimilarity(a, b)
	if score != 0.0 {
		t.Errorf("zero vector should return 0.0, got %.4f", score)
	}
}

func TestCosineSimilarity_DifferentLengths(t *testing.T) {
	a := []float64{1, 2}
	b := []float64{1, 2, 3}
	score := CosineSimilarity(a, b)
	if score != 0.0 {
		t.Errorf("different lengths should return 0.0, got %.4f", score)
	}
}

func TestCosineSimilarityF32(t *testing.T) {
	a := []float32{1, 0, 0}
	b := []float32{1, 0, 0}
	score := CosineSimilarityF32(a, b)
	if math.Abs(score-1.0) > 0.001 {
		t.Errorf("identical f32 vectors should have score ~1.0, got %.4f", score)
	}
}

// --- Tokenize tests ---

func TestTokenize_BasicText(t *testing.T) {
	tokens := Tokenize("Analyzes credit risk and generates financial reports")
	expected := map[string]bool{"analyzes": true, "credit": true, "risk": true, "generates": true, "financial": true, "reports": true}
	for _, tok := range tokens {
		if !expected[tok] {
			t.Errorf("unexpected token: %q", tok)
		}
		delete(expected, tok)
	}
	for k := range expected {
		t.Errorf("missing expected token: %q", k)
	}
}

func TestTokenize_RemovesStopWords(t *testing.T) {
	tokens := Tokenize("the quick and brown fox is in the forest")
	for _, tok := range tokens {
		if tok == "the" || tok == "and" || tok == "is" || tok == "in" {
			t.Errorf("stop word should have been removed: %q", tok)
		}
	}
}

func TestTokenize_EmptyAndShort(t *testing.T) {
	if len(Tokenize("")) != 0 {
		t.Error("empty string should return no tokens")
	}
	if len(Tokenize("a b c")) != 0 {
		t.Error("single-char tokens should be filtered out")
	}
}

// --- TF-IDF tests ---

func TestComputeTF(t *testing.T) {
	tokens := []string{"credit", "risk", "credit"}
	tf := ComputeTF(tokens)
	if math.Abs(tf["credit"]-2.0/3.0) > 0.001 {
		t.Errorf("TF for 'credit' should be ~0.667, got %.4f", tf["credit"])
	}
	if math.Abs(tf["risk"]-1.0/3.0) > 0.001 {
		t.Errorf("TF for 'risk' should be ~0.333, got %.4f", tf["risk"])
	}
}

func TestComputeIDF(t *testing.T) {
	docs := [][]string{
		{"credit", "risk"},
		{"credit", "analysis"},
		{"image", "processing"},
	}
	idf := ComputeIDF(docs)
	// "credit" appears in 2 of 3 docs: log(1 + 3/2) = log(2.5)
	expected := math.Log(1.0 + 3.0/2.0)
	if math.Abs(idf["credit"]-expected) > 0.001 {
		t.Errorf("IDF for 'credit': expected %.4f, got %.4f", expected, idf["credit"])
	}
	// "image" appears in 1 of 3: log(1 + 3/1) = log(4)
	expected = math.Log(1.0 + 3.0/1.0)
	if math.Abs(idf["image"]-expected) > 0.001 {
		t.Errorf("IDF for 'image': expected %.4f, got %.4f", expected, idf["image"])
	}
}

// --- TFIDFScorer tests ---

func cardWithDescription(id string, capID, description string, latencyMs int) *agentcard.Card {
	c := &agentcard.Card{
		Metadata: agentcard.Metadata{
			ID:      id,
			Name:    "agent-" + id,
			Version: "1.0.0",
			Owner:   "did:mesh:org:test",
		},
		Spec: agentcard.Spec{
			Domains: agentcard.Domains{Primary: []string{"test"}},
			Capabilities: []agentcard.Capability{
				{ID: capID, Description: description},
			},
			Endpoints: agentcard.Endpoints{
				ControlPlane: agentcard.ControlPlaneEndpoint{NATSSubject: "mesh.agent." + id},
				DataPlane:    agentcard.DataPlaneEndpoint{GRPC: "grpc://localhost:50051"},
			},
		},
	}
	if latencyMs > 0 {
		c.Spec.Operational = &agentcard.Operational{AvgLatencyMs: latencyMs}
	}
	return c
}

func TestTFIDFScorer_SimilarDescriptions(t *testing.T) {
	scorer := NewTFIDFScorer(0.1)
	candidates := []*agentcard.Card{
		cardWithDescription("agent-1", "credit-risk", "Analyzes credit risk and generates financial reports for loan applications", 100),
		cardWithDescription("agent-2", "image-proc", "Processes images and detects objects in photographs", 100),
	}

	scored, err := scorer.Score(context.Background(), "I need credit risk analysis for a loan application", candidates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(scored) == 0 {
		t.Fatal("expected at least one scored candidate")
	}

	// The credit risk agent should match
	found := false
	for _, sc := range scored {
		if sc.MatchedCapID == "credit-risk" {
			found = true
			if sc.SemanticScore < 0.3 {
				t.Errorf("credit-risk agent should have a high score, got %.4f", sc.SemanticScore)
			}
		}
	}
	if !found {
		t.Error("credit-risk agent should have been scored")
	}
}

func TestTFIDFScorer_NoOverlap(t *testing.T) {
	scorer := NewTFIDFScorer(0.3)
	candidates := []*agentcard.Card{
		cardWithDescription("agent-1", "weather", "Weather forecast temperature humidity precipitation", 100),
	}

	scored, err := scorer.Score(context.Background(), "credit risk analysis banking loans", candidates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Zero word overlap means zero score — should not appear in results with threshold 0.3
	if len(scored) != 0 {
		t.Errorf("completely dissimilar descriptions should not score above threshold, got %d results", len(scored))
	}
}

func TestTFIDFScorer_EmptyDescription(t *testing.T) {
	scorer := NewTFIDFScorer(0.1)
	candidates := []*agentcard.Card{
		cardWithDescription("agent-1", "echo", "", 100), // no description
	}

	scored, err := scorer.Score(context.Background(), "anything", candidates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(scored) != 0 {
		t.Error("candidates without descriptions should not be scored")
	}
}

func TestTFIDFScorer_EmptyRequest(t *testing.T) {
	scorer := NewTFIDFScorer(0.1)
	candidates := []*agentcard.Card{
		cardWithDescription("agent-1", "echo", "some description", 100),
	}

	scored, err := scorer.Score(context.Background(), "", candidates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(scored) != 0 {
		t.Error("empty request description should return no results")
	}
}

// --- EmbeddingCache tests ---

func TestEmbeddingCache_HitAndMiss(t *testing.T) {
	cache := NewEmbeddingCache(1 * time.Hour)

	// Miss
	_, ok := cache.Get("agent-1", "cap-1", "some description")
	if ok {
		t.Error("expected cache miss")
	}

	// Set and hit
	vec := []float32{0.1, 0.2, 0.3}
	cache.Set("agent-1", "cap-1", "some description", vec)

	got, ok := cache.Get("agent-1", "cap-1", "some description")
	if !ok {
		t.Fatal("expected cache hit")
	}
	if len(got) != 3 || got[0] != 0.1 {
		t.Errorf("unexpected cached vector: %v", got)
	}

	// Different description = miss (hash changed)
	_, ok = cache.Get("agent-1", "cap-1", "different description")
	if ok {
		t.Error("different description should be a cache miss")
	}
}

func TestEmbeddingCache_TTLExpiry(t *testing.T) {
	cache := NewEmbeddingCache(1 * time.Millisecond) // ultra-short TTL

	cache.Set("agent-1", "cap-1", "desc", []float32{1.0})
	time.Sleep(5 * time.Millisecond)

	_, ok := cache.Get("agent-1", "cap-1", "desc")
	if ok {
		t.Error("expired entry should not be returned")
	}
}

func TestEmbeddingCache_Prune(t *testing.T) {
	cache := NewEmbeddingCache(1 * time.Millisecond)
	cache.Set("agent-1", "cap-1", "desc", []float32{1.0})
	time.Sleep(5 * time.Millisecond)

	cache.Prune()

	cache.mu.RLock()
	count := len(cache.entries)
	cache.mu.RUnlock()
	if count != 0 {
		t.Errorf("expected 0 entries after prune, got %d", count)
	}
}

// --- Mock SemanticScorer for engine integration tests ---

type mockScorer struct {
	scores []ScoredCandidate
	err    error
	called bool
}

func (m *mockScorer) Score(ctx context.Context, desc string, candidates []*agentcard.Card) ([]ScoredCandidate, error) {
	m.called = true
	return m.scores, m.err
}

// --- Engine integration tests with semantic scoring ---

func TestSelectMatch_WithSemanticScoring(t *testing.T) {
	high := cardWithDescription("did:mesh:agent:high-semantic", "analysis", "Credit risk analysis for loans", 200)
	low := cardWithDescription("did:mesh:agent:low-semantic", "echo", "Simple echo service", 50)

	scorer := &mockScorer{
		scores: []ScoredCandidate{
			{Card: high, SemanticScore: 0.9, MatchedCapID: "analysis"},
			{Card: low, SemanticScore: 0.2, MatchedCapID: "echo"},
		},
	}

	engine := &MatchEngine{
		SessionTokenSecret: []byte("secret"),
		Semantic:           scorer,
		SemanticWeight:     0.7, // heavily favor semantic
	}
	lister := &mockLister{cards: []*agentcard.Card{high, low}}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{
			Domain:       []string{"test"},
			CapabilityID: "analysis",
			Description:  "I need credit risk analysis",
		},
	}

	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:c", "req-1", "corr-1")
	if result.RejectReason != "" {
		t.Fatalf("expected match, got reject %q", result.RejectReason)
	}
	if !scorer.called {
		t.Error("semantic scorer should have been called")
	}
	// With weight=0.7 and high semantic score, the high-semantic agent should win despite higher latency
	if result.MatchData.Parties.Provider != "did:mesh:agent:high-semantic" {
		t.Errorf("expected high-semantic provider, got %q", result.MatchData.Parties.Provider)
	}
	if result.MatchData.SemanticScore < 0.5 {
		t.Errorf("expected high semantic score, got %.4f", result.MatchData.SemanticScore)
	}
	if result.MatchData.MatchedCapabilityID != "analysis" {
		t.Errorf("expected matched_capability_id=analysis, got %q", result.MatchData.MatchedCapabilityID)
	}
}

func TestSelectMatch_NoDescription_SkipsSemantic(t *testing.T) {
	scorer := &mockScorer{}
	engine := &MatchEngine{
		SessionTokenSecret: []byte("secret"),
		Semantic:           scorer,
	}
	card := validCard("did:mesh:agent:p", 100)
	lister := &mockLister{cards: []*agentcard.Card{card}}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{
			Domain:       []string{"test"},
			CapabilityID: "echo",
			// No Description
		},
	}

	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:c", "req-1", "corr-1")
	if result.RejectReason != "" {
		t.Fatalf("expected match, got reject %q", result.RejectReason)
	}
	if scorer.called {
		t.Error("semantic scorer should NOT have been called when no description")
	}
}

func TestSelectMatch_SemanticDisabled(t *testing.T) {
	engine := &MatchEngine{
		SessionTokenSecret: []byte("secret"),
		// Semantic is nil
	}
	card := validCard("did:mesh:agent:p", 100)
	lister := &mockLister{cards: []*agentcard.Card{card}}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{
			Domain:       []string{"test"},
			CapabilityID: "echo",
			Description:  "some description",
		},
	}

	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:c", "req-1", "corr-1")
	if result.RejectReason != "" {
		t.Fatalf("expected match, got reject %q", result.RejectReason)
	}
	// Should fall back to pure latency selection
	if result.MatchData.Parties.Provider != "did:mesh:agent:p" {
		t.Errorf("expected provider p, got %q", result.MatchData.Parties.Provider)
	}
}

func TestSelectMatch_SemanticFallback(t *testing.T) {
	// Exact match returns empty (mockLister returns empty for "nonexistent" capability)
	// But broader search (empty capabilityID) returns candidates
	broadCard := cardWithDescription("did:mesh:agent:broad", "analysis", "Credit risk analysis service", 100)

	lister := &fallbackMockLister{
		exactCards:   nil,                              // no exact match
		broaderCards: []*agentcard.Card{broadCard},     // domain-only returns this
	}
	scorer := &mockScorer{
		scores: []ScoredCandidate{
			{Card: broadCard, SemanticScore: 0.8, MatchedCapID: "analysis"},
		},
	}

	engine := &MatchEngine{
		SessionTokenSecret: []byte("secret"),
		Semantic:           scorer,
		SemanticThreshold:  0.3,
	}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{
			Domain:       []string{"finance"},
			CapabilityID: "nonexistent",
			Description:  "I need credit risk analysis",
		},
	}

	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:c", "req-1", "corr-1")
	if result.RejectReason != "" {
		t.Fatalf("expected match via fallback, got reject %q", result.RejectReason)
	}
	if result.MatchData.Parties.Provider != "did:mesh:agent:broad" {
		t.Errorf("expected broad provider via fallback, got %q", result.MatchData.Parties.Provider)
	}
}

// fallbackMockLister returns different results based on whether capabilityID is empty.
type fallbackMockLister struct {
	exactCards   []*agentcard.Card
	broaderCards []*agentcard.Card
}

func (m *fallbackMockLister) ListCandidates(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error) {
	if capabilityID == "" {
		return m.broaderCards, nil
	}
	return m.exactCards, nil
}

// --- Semantic-only mode: no capabilityID, description drives selection ---

func TestSelectMatch_SemanticOnly_NoCapabilityID(t *testing.T) {
	// Consumer sends no capabilityID, only description + domain
	// Registry returns all agents in the domain, scorer ranks them
	algar := cardWithDescription("did:mesh:agent:algar", "assistant", "Assistente virtual da Algar Telecom para atendimento ao cliente", 100)
	other := cardWithDescription("did:mesh:agent:other", "billing", "Billing and invoice processing service", 100)

	scorer := &mockScorer{
		scores: []ScoredCandidate{
			{Card: algar, SemanticScore: 0.85, MatchedCapID: "assistant"},
			{Card: other, SemanticScore: 0.15, MatchedCapID: "billing"},
		},
	}

	engine := &MatchEngine{
		SessionTokenSecret: []byte("secret"),
		Semantic:           scorer,
		SemanticThreshold:  0.3,
	}
	lister := &mockLister{cards: []*agentcard.Card{algar, other}}
	reqData := &events.CapabilityRequestData{
		Task: &events.RequestTask{
			Domain:      []string{"assistant"},
			Description: "Suporte ao cliente da Algar Telecom",
			// No CapabilityID — semantic-only mode
		},
	}

	result := engine.SelectMatch(context.Background(), lister, reqData, "did:mesh:agent:consumer", "req-1", "corr-1")
	if result.RejectReason != "" {
		t.Fatalf("expected match, got reject %q", result.RejectReason)
	}
	if !scorer.called {
		t.Error("semantic scorer should have been called")
	}
	if result.MatchData.Parties.Provider != "did:mesh:agent:algar" {
		t.Errorf("expected algar provider (highest semantic score), got %q", result.MatchData.Parties.Provider)
	}
	if result.MatchData.SemanticScore < 0.5 {
		t.Errorf("expected high semantic score, got %.4f", result.MatchData.SemanticScore)
	}
	if result.MatchData.MatchedCapabilityID != "assistant" {
		t.Errorf("expected matched_capability_id=assistant, got %q", result.MatchData.MatchedCapabilityID)
	}
}

// --- selectBestScored tests ---

func TestSelectBestScored(t *testing.T) {
	scored := []ScoredCandidate{
		{Card: validCard("a", 100), SemanticScore: 0.5, MatchedCapID: "cap-a"},
		{Card: validCard("b", 100), SemanticScore: 0.9, MatchedCapID: "cap-b"},
		{Card: validCard("c", 100), SemanticScore: 0.2, MatchedCapID: "cap-c"},
	}

	best := selectBestScored(scored, 0.3)
	if best == nil {
		t.Fatal("expected a result")
	}
	if best.MatchedCapID != "cap-b" {
		t.Errorf("expected cap-b (highest score), got %q", best.MatchedCapID)
	}
}

func TestSelectBestScored_AllBelowThreshold(t *testing.T) {
	scored := []ScoredCandidate{
		{Card: validCard("a", 100), SemanticScore: 0.1, MatchedCapID: "cap-a"},
		{Card: validCard("b", 100), SemanticScore: 0.2, MatchedCapID: "cap-b"},
	}

	best := selectBestScored(scored, 0.5)
	if best != nil {
		t.Errorf("expected nil when all below threshold, got score=%.2f", best.SemanticScore)
	}
}
