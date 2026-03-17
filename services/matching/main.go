package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
	"github.com/mesh-protocol-ai/amp/pkg/cloudevents"
	"github.com/mesh-protocol-ai/amp/pkg/events"
	"github.com/mesh-protocol-ai/amp/pkg/session"
	"github.com/nats-io/nats.go"
)

func main() {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = nats.DefaultURL
	}
	natsToken := os.Getenv("NATS_TOKEN")
	registryURL := os.Getenv("REGISTRY_URL")
	if registryURL == "" {
		registryURL = "http://localhost:8080"
	}
	registryURL = strings.TrimSuffix(registryURL, "/")
	sessionTokenSecret := []byte(strings.TrimSpace(os.Getenv("SESSION_TOKEN_SECRET")))
	if len(sessionTokenSecret) == 0 {
		log.Fatalf("SESSION_TOKEN_SECRET is required")
	}

	opts := []nats.Option{nats.Timeout(5 * time.Second)}
	if natsToken != "" {
		opts = append(opts, nats.Token(natsToken))
	}
	nc, err := nats.Connect(natsURL, opts...)
	if err != nil {
		log.Fatalf("nats connect: %v", err)
	}
	defer nc.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Subscribe to all capability requests
	sub, err := nc.Subscribe("mesh.requests.>", func(msg *nats.Msg) {
		handleRequest(ctx, msg, registryURL, sessionTokenSecret, nc)
	})
	if err != nil {
		log.Fatalf("subscribe: %v", err)
	}
	defer sub.Unsubscribe()

	log.Println("matching subscribed to mesh.requests.>")
	<-ctx.Done()
	log.Println("matching shutting down")
}

func handleRequest(ctx context.Context, msg *nats.Msg, registryURL string, sessionTokenSecret []byte, nc *nats.Conn) {
	ev, err := cloudevents.ParseJSON(msg.Data)
	if err != nil {
		log.Printf("parse cloudevent: %v", err)
		return
	}
	if ev.Type() != cloudevents.TypeCapabilityRequest {
		return
	}

	var reqData events.CapabilityRequestData
	if err := ev.DataAs(&reqData); err != nil || reqData.Task == nil {
		log.Printf("request data invalid: %v", err)
		return
	}

	consumerDID := ev.Source()
	requestID := ev.ID()
	correlationID := cloudevents.GetAMPExtensions(*ev).CorrelationID
	if correlationID == "" {
		correlationID = requestID
	}

	// Query registry for candidates
	candidates, err := listCandidates(ctx, registryURL, reqData.Task.Domain, reqData.Task.CapabilityID)
	if err != nil {
		log.Printf("registry list: %v", err)
		publishReject(nc, requestID, consumerDID, "registry_error")
		return
	}

	// Filter by data_residency (MVP: provider must declare at least one region in request list, or no constraint)
	var filtered []*agentcard.Card
	var dataResidency []string
	if reqData.Constraints != nil {
		dataResidency = reqData.Constraints.DataResidency
	}
	for _, c := range candidates {
		if len(dataResidency) > 0 {
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
			if !ok {
				continue
			}
		}
		filtered = append(filtered, c)
	}

	if len(filtered) == 0 {
		publishReject(nc, requestID, consumerDID, "no_providers_available")
		return
	}

	// Select one: MVP = first by lowest avg_latency_ms
	selected := selectProvider(filtered)

	// Build match
	sessionID := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()
	expires := now.Add(1 * time.Hour)
	sessionToken, err := session.IssueToken(session.Claims{
		SessionID:   sessionID,
		ConsumerDID: consumerDID,
		ProviderDID: selected.Metadata.ID,
		ExpiresAt:   expires,
	}, sessionTokenSecret, now)
	if err != nil {
		log.Printf("issue session token: %v", err)
		publishReject(nc, requestID, consumerDID, "session_token_issue_failed")
		return
	}
	maxLatency := 0
	if reqData.Constraints != nil {
		maxLatency = reqData.Constraints.MaxLatencyMs
	}
	matchData := events.CapabilityMatchData{
		RequestID:    requestID,
		WinningBidID: "direct",
		Parties: events.MatchParties{
			Consumer: consumerDID,
			Provider: selected.Metadata.ID,
		},
		AgreedTerms: events.AgreedTerms{
			MaxLatencyMs:  maxLatency,
			SecurityLevel: "STANDARD",
		},
		Session: events.MatchSession{
			SessionID:    sessionID,
			CreatedAt:    now.Format(time.RFC3339),
			ExpiresAt:    expires.Format(time.RFC3339),
			SessionToken: sessionToken,
		},
	}

	matchEv, err := cloudevents.NewEvent(
		cloudevents.TypeCapabilityMatch,
		"did:mesh:broker:local",
		matchData,
		cloudevents.AMPExtensions{CorrelationID: correlationID, SessionID: sessionID},
	)
	if err != nil {
		log.Printf("new match event: %v", err)
		return
	}
	payload, _ := cloudevents.SerializeJSON(matchEv)

	// Publish to subject where consumer and provider can subscribe
	subject := "mesh.matches"
	if err := nc.Publish(subject, payload); err != nil {
		log.Printf("publish match: %v", err)
		return
	}
	log.Printf("match published request=%s provider=%s session=%s", requestID, selected.Metadata.ID, sessionID)
}

func listCandidates(ctx context.Context, baseURL string, domain []string, capabilityID string) ([]*agentcard.Card, error) {
	url := baseURL + "/agents?"
	if len(domain) > 0 {
		url += "domain=" + strings.Join(domain, ",") + "&"
	}
	if capabilityID != "" {
		url += "capability=" + capabilityID
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("registry returned %d", resp.StatusCode)
	}
	var out struct {
		Agents []*agentcard.Card `json:"agents"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Agents, nil
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

func publishReject(nc *nats.Conn, requestID, consumerDID, reason string) {
	rejData := map[string]string{"request_id": requestID, "reason": reason}
	ev, err := cloudevents.NewEvent(
		cloudevents.TypeCapabilityReject,
		"did:mesh:broker:local",
		rejData,
		cloudevents.AMPExtensions{CorrelationID: requestID},
	)
	if err != nil {
		log.Printf("new reject event: %v", err)
		return
	}
	payload, _ := cloudevents.SerializeJSON(ev)
	_ = nc.Publish("mesh.matches", payload)
	log.Printf("reject published request=%s reason=%s", requestID, reason)
}
