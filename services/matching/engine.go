package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
	"github.com/mesh-protocol-ai/amp/pkg/events"
	"github.com/mesh-protocol-ai/amp/pkg/session"
)

// RegistryLister returns candidate agents for a domain and capability (used by MatchEngine and by tests).
type RegistryLister interface {
	ListCandidates(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error)
}

// MatchEngine selects a provider and builds match data (Community: simple HMAC session token).
type MatchEngine struct {
	SessionTokenSecret []byte
	Presence           PresenceProvider // optional; if set, only present agents are eligible
	Semantic           SemanticScorer   // optional; if set, uses semantic scoring when description is provided
	SemanticWeight     float64          // weight of semantic score in composite ranking [0.0, 1.0]; default 0.5
	SemanticThreshold  float64          // minimum semantic score to accept in fallback mode; default 0.3
}

// PresenceProvider is an optional interface that MatchEngine can consult to ensure
// a provider has a recent heartbeat.
type PresenceProvider interface {
	IsPresent(id string) bool
}

// SelectMatchResult is the result of SelectMatch: either Match or Reject.
type SelectMatchResult struct {
	MatchData     *events.CapabilityMatchData
	RejectReason  string
}

// SelectMatch finds candidates via the lister, filters by constraints, selects one provider, and builds match data.
// If no provider is available or token issue fails, RejectReason is set.
func (e *MatchEngine) SelectMatch(
	ctx context.Context,
	lister RegistryLister,
	reqData *events.CapabilityRequestData,
	consumerDID, requestID, correlationID string,
) SelectMatchResult {
	if reqData == nil || reqData.Task == nil {
		return SelectMatchResult{RejectReason: "invalid_request"}
	}

	candidates, err := lister.ListCandidates(ctx, reqData.Task.Domain, reqData.Task.CapabilityID)
	if err != nil {
		return SelectMatchResult{RejectReason: "registry_error"}
	}

	initialCount := len(candidates)

	var dataResidency []string
	if reqData.Constraints != nil {
		dataResidency = reqData.Constraints.DataResidency
	}
	afterResidency := filterByDataResidency(candidates, dataResidency)

	var afterPresence []*agentcard.Card
	if e.Presence != nil {
		afterPresence = filterByPresence(afterResidency, e.Presence)
	} else {
		afterPresence = afterResidency
	}

	// Log counts and reasons for exclusion to help debugging
	log.Printf("match selection counts: registry=%d after_residency=%d after_presence=%d", initialCount, len(afterResidency), len(afterPresence))

	// Semantic scoring: if description is provided and scorer is available, rank by similarity
	description := ""
	if reqData.Task != nil {
		description = reqData.Task.Description
	}

	if len(afterPresence) == 0 && description != "" && e.Semantic != nil {
		// Fallback: no exact match, but description available — try broader search
		log.Printf("semantic fallback: exact match empty, trying domain-only search")
		broader, err := lister.ListCandidates(ctx, reqData.Task.Domain, "")
		if err == nil && len(broader) > 0 {
			broader = filterByDataResidency(broader, dataResidency)
			if e.Presence != nil {
				broader = filterByPresence(broader, e.Presence)
			}
			if len(broader) > 0 {
				scored, serr := e.Semantic.Score(ctx, description, broader)
				if serr == nil && len(scored) > 0 {
					threshold := e.SemanticThreshold
					if threshold == 0 {
						threshold = 0.3
					}
					best := selectBestScored(scored, threshold)
					if best != nil {
						log.Printf("semantic fallback matched: provider=%s cap=%s score=%.3f", best.Card.Metadata.ID, best.MatchedCapID, best.SemanticScore)
						afterPresence = []*agentcard.Card{best.Card}
					}
				}
			}
		}
	}

	if len(afterPresence) == 0 {
		reason := fmt.Sprintf("no_providers_available: registry=%d after_residency=%d after_presence=%d", initialCount, len(afterResidency), len(afterPresence))
		return SelectMatchResult{RejectReason: reason}
	}

	// Apply semantic ranking if description is present and we have multiple candidates
	var semanticScore float64
	var matchedCapID string
	selected := selectProvider(afterPresence)

	if description != "" && e.Semantic != nil && len(afterPresence) > 0 {
		scored, err := e.Semantic.Score(ctx, description, afterPresence)
		if err == nil && len(scored) > 0 {
			selected, semanticScore, matchedCapID = selectProviderComposite(scored, afterPresence, e.semanticWeight())
		}
	}
	sessionID := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()
	expires := now.Add(1 * time.Hour)
	sessionToken, err := session.IssueSimpleToken(e.SessionTokenSecret, sessionID, consumerDID, selected.Metadata.ID)
	if err != nil {
		return SelectMatchResult{RejectReason: "session_token_issue_failed"}
	}

	maxLatency := 0
	if reqData.Constraints != nil {
		maxLatency = reqData.Constraints.MaxLatencyMs
	}
	matchData := &events.CapabilityMatchData{
		RequestID:    requestID,
		WinningBidID: "direct",
		Parties: events.MatchParties{
			Consumer: consumerDID,
			Provider: selected.Metadata.ID,
		},
		AgreedTerms: events.AgreedTerms{
			MaxLatencyMs:  maxLatency,
			SecurityLevel: "OPEN",
		},
		Session: events.MatchSession{
			SessionID:    sessionID,
			CreatedAt:    now.Format(time.RFC3339),
			ExpiresAt:    expires.Format(time.RFC3339),
			SessionToken: sessionToken,
		},
		SemanticScore:       semanticScore,
		MatchedCapabilityID: matchedCapID,
	}
	return SelectMatchResult{MatchData: matchData}
}

// semanticWeight returns the configured semantic weight or the default (0.5).
func (e *MatchEngine) semanticWeight() float64 {
	if e.SemanticWeight > 0 {
		return e.SemanticWeight
	}
	return 0.5
}

// selectProviderComposite selects the best provider using a composite score
// that combines semantic similarity and latency.
func selectProviderComposite(scored []ScoredCandidate, allCards []*agentcard.Card, semanticWeight float64) (*agentcard.Card, float64, string) {
	if len(scored) == 0 {
		return selectProvider(allCards), 0, ""
	}

	// Find max latency for normalization
	maxLatency := 10000.0
	for _, sc := range scored {
		lat := float64(sc.Card.AvgLatencyMs())
		if lat > maxLatency {
			maxLatency = lat
		}
	}

	var bestCard *agentcard.Card
	var bestScore float64
	var bestSemantic float64
	var bestCapID string

	for _, sc := range scored {
		latencyScore := 1.0 - (float64(sc.Card.AvgLatencyMs()) / maxLatency)
		if latencyScore < 0 {
			latencyScore = 0
		}
		composite := (semanticWeight * sc.SemanticScore) + ((1 - semanticWeight) * latencyScore)

		if bestCard == nil || composite > bestScore {
			bestCard = sc.Card
			bestScore = composite
			bestSemantic = sc.SemanticScore
			bestCapID = sc.MatchedCapID
		}
	}

	// Also consider candidates that weren't semantically scored (no description) — they get semantic=0
	scoredIDs := make(map[string]bool)
	for _, sc := range scored {
		scoredIDs[sc.Card.Metadata.ID] = true
	}
	for _, card := range allCards {
		if scoredIDs[card.Metadata.ID] {
			continue
		}
		// Candidates without descriptions get pure latency score
		latencyScore := 1.0 - (float64(card.AvgLatencyMs()) / maxLatency)
		composite := (1 - semanticWeight) * latencyScore
		if composite > bestScore {
			bestCard = card
			bestScore = composite
			bestSemantic = 0
			bestCapID = ""
		}
	}

	return bestCard, bestSemantic, bestCapID
}

// selectBestScored returns the highest-scoring candidate above the threshold.
func selectBestScored(scored []ScoredCandidate, threshold float64) *ScoredCandidate {
	var best *ScoredCandidate
	for i := range scored {
		if scored[i].SemanticScore >= threshold {
			if best == nil || scored[i].SemanticScore > best.SemanticScore {
				best = &scored[i]
			}
		}
	}
	return best
}

func filterByDataResidency(candidates []*agentcard.Card, dataResidency []string) []*agentcard.Card {
	if len(dataResidency) == 0 {
		return candidates
	}
	var filtered []*agentcard.Card
	for _, c := range candidates {
		providerResidency := c.DataResidency()
		if len(providerResidency) == 0 {
			filtered = append(filtered, c)
			continue
		}
		ok := false
		for _, r := range dataResidency {
			for _, pr := range providerResidency {
				if r == pr {
					ok = true
					break
				}
			}
		}
		if ok {
			filtered = append(filtered, c)
		}
	}
	return filtered
}

func filterByPresence(candidates []*agentcard.Card, presence PresenceProvider) []*agentcard.Card {
	if presence == nil {
		return candidates
	}
	var filtered []*agentcard.Card
	for _, c := range candidates {
		if presence.IsPresent(c.Metadata.ID) {
			filtered = append(filtered, c)
		}
	}
	return filtered
}

// selectProvider chooses a provider (MVP: lowest avg_latency_ms).
func selectProvider(cards []*agentcard.Card) *agentcard.Card {
	if len(cards) == 0 {
		return nil
	}
	best := cards[0]
	for _, c := range cards[1:] {
		if c.AvgLatencyMs() < best.AvgLatencyMs() {
			best = c
		}
	}
	return best
}
