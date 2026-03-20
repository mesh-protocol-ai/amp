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

	if len(afterPresence) == 0 {
		reason := fmt.Sprintf("no_providers_available: registry=%d after_residency=%d after_presence=%d", initialCount, len(afterResidency), len(afterPresence))
		return SelectMatchResult{RejectReason: reason}
	}

	selected := selectProvider(afterPresence)
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
			MaxLatencyMs:   maxLatency,
			SecurityLevel: "OPEN",
		},
		Session: events.MatchSession{
			SessionID:    sessionID,
			CreatedAt:    now.Format(time.RFC3339),
			ExpiresAt:    expires.Format(time.RFC3339),
			SessionToken: sessionToken,
		},
	}
	return SelectMatchResult{MatchData: matchData}
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
