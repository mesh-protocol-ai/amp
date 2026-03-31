package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/mesh-protocol-ai/amp/pkg/cloudevents"
	"github.com/mesh-protocol-ai/amp/pkg/events"
	"github.com/nats-io/nats.go"
)

func main() {
	natsURL := strings.TrimSpace(os.Getenv("NATS_URL"))
	if natsURL == "" {
		natsURL = nats.DefaultURL
	}
	if !strings.HasPrefix(natsURL, "nats://") && !strings.HasPrefix(natsURL, "tls://") {
		natsURL = "nats://" + natsURL
	}
	natsToken := os.Getenv("NATS_TOKEN")
	registryURL := os.Getenv("REGISTRY_URL")
	if registryURL == "" {
		registryURL = "http://localhost:8080"
	}
	safeMode := strings.TrimSpace(os.Getenv("AMP_SAFE_MODE")) == "1"

	sessionTokenSecret := []byte(strings.TrimSpace(os.Getenv("SESSION_TOKEN_SECRET")))
	if len(sessionTokenSecret) == 0 {
		log.Fatalf("SESSION_TOKEN_SECRET is required")
	}

	if safeMode {
		if natsToken == "" {
			log.Fatalf("FATAL: AMP_SAFE_MODE=1 requires NATS_TOKEN to be set.")
		}
		log.Println("AMP_SAFE_MODE=1: production security checks passed")
	}

	// Presence TTL (seconds) controls how long a heartbeat keeps an agent eligible
	hbTTL := 90
	if v := strings.TrimSpace(os.Getenv("HEARTBEAT_TTL_SECONDS")); v != "" {
		if iv, err := strconv.Atoi(v); err == nil && iv > 0 {
			hbTTL = iv
		}
	}
	presence := NewPresenceCache(time.Duration(hbTTL) * time.Second)

	engine := &MatchEngine{SessionTokenSecret: sessionTokenSecret, Presence: presence}

	// Semantic matching configuration
	if strings.TrimSpace(os.Getenv("SEMANTIC_ENABLED")) == "true" || strings.TrimSpace(os.Getenv("SEMANTIC_ENABLED")) == "1" {
		strategy := strings.TrimSpace(os.Getenv("SEMANTIC_STRATEGY"))
		if strategy == "" {
			strategy = "tfidf"
		}

		threshold := 0.3
		if v := strings.TrimSpace(os.Getenv("SEMANTIC_SCORE_THRESHOLD")); v != "" {
			if fv, err := strconv.ParseFloat(v, 64); err == nil && fv > 0 {
				threshold = fv
			}
		}

		weight := 0.5
		if v := strings.TrimSpace(os.Getenv("SEMANTIC_WEIGHT")); v != "" {
			if fv, err := strconv.ParseFloat(v, 64); err == nil && fv > 0 && fv <= 1.0 {
				weight = fv
			}
		}

		switch strategy {
		case "tfidf":
			engine.Semantic = NewTFIDFScorer(threshold)
			log.Printf("semantic matching enabled strategy=tfidf threshold=%.2f weight=%.2f", threshold, weight)

		case "embedding":
			apiURL := strings.TrimSpace(os.Getenv("EMBEDDING_API_URL"))
			apiKey := strings.TrimSpace(os.Getenv("EMBEDDING_API_KEY"))
			model := strings.TrimSpace(os.Getenv("EMBEDDING_MODEL"))
			if model == "" {
				model = "qwen/qwen3-embedding-0.6b"
			}
			dimensions := 512
			if v := strings.TrimSpace(os.Getenv("EMBEDDING_DIMENSIONS")); v != "" {
				if iv, err := strconv.Atoi(v); err == nil && iv > 0 {
					dimensions = iv
				}
			}
			cacheTTLEmb := 3600
			if v := strings.TrimSpace(os.Getenv("EMBEDDING_CACHE_TTL_SECONDS")); v != "" {
				if iv, err := strconv.Atoi(v); err == nil && iv > 0 {
					cacheTTLEmb = iv
				}
			}

			if apiURL == "" {
				log.Printf("WARNING: SEMANTIC_STRATEGY=embedding but EMBEDDING_API_URL not set; falling back to tfidf")
				engine.Semantic = NewTFIDFScorer(threshold)
			} else {
				provider := NewHTTPEmbeddingProvider(apiURL, apiKey, model, dimensions)
				cache := NewEmbeddingCache(time.Duration(cacheTTLEmb) * time.Second)
				engine.Semantic = NewEmbeddingScorer(provider, cache, threshold)
				log.Printf("semantic matching enabled strategy=embedding model=%s dimensions=%d cache_ttl=%ds", model, dimensions, cacheTTLEmb)
			}

		default:
			log.Printf("WARNING: unknown SEMANTIC_STRATEGY=%s; falling back to tfidf", strategy)
			engine.Semantic = NewTFIDFScorer(threshold)
		}

		engine.SemanticWeight = weight
		engine.SemanticThreshold = threshold
	}

	registry := newRegistryClient(registryURL)

	// Matching cache configuration (Phase 3)
	cacheTTL := 60
	if v := strings.TrimSpace(os.Getenv("MATCHING_CACHE_TTL_SECONDS")); v != "" {
		if iv, err := strconv.Atoi(v); err == nil && iv > 0 {
			cacheTTL = iv
		}
	}
	refreshSec := 30
	if v := strings.TrimSpace(os.Getenv("MATCHING_CACHE_REFRESH_SECONDS")); v != "" {
		if iv, err := strconv.Atoi(v); err == nil && iv > 0 {
			refreshSec = iv
		}
	}
	cachingRegistry := NewCachingRegistry(registry, time.Duration(cacheTTL)*time.Second, time.Duration(refreshSec)*time.Second)
	log.Printf("matching cache enabled ttl=%ds refresh=%ds", cacheTTL, refreshSec)

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

	// Optional JetStream audit publisher (Phase 5)
	enableJS := strings.TrimSpace(os.Getenv("ENABLE_JETSTREAM_AUDIT")) == "1"
	var audit *AuditPublisher
	if enableJS {
		auditStream := strings.TrimSpace(os.Getenv("JETSTREAM_AUDIT_STREAM"))
		if auditStream == "" {
			auditStream = "MESH_AUDIT"
		}
		audit = NewAuditPublisher(nc, auditStream)
		if audit != nil && audit.enabled {
			log.Printf("jetstream audit enabled stream=%s", auditStream)
		} else {
			log.Printf("jetstream audit not enabled or initialization failed")
		}
	}

	// Subscribe to agent heartbeats and update presence cache
	hbSub, err := nc.Subscribe("mesh.agents.heartbeat.>", func(msg *nats.Msg) {
		now := time.Now().UTC()
		// Try to parse as CloudEvent first
		if ev, err := cloudevents.ParseJSON(msg.Data); err == nil {
			did := ev.Source()
			presence.Update(did, now)
			return
		}
		// Try to parse as simple JSON payload {did: "..."}
		var payload struct{ Did string `json:"did"` }
		if err := json.Unmarshal(msg.Data, &payload); err == nil && payload.Did != "" {
			presence.Update(payload.Did, now)
			return
		}
		// Fallback: use subject token (sanitized id)
		parts := strings.Split(msg.Subject, ".")
		if len(parts) > 0 {
			token := parts[len(parts)-1]
			presence.Update(token, now)
		}
	})
	if err != nil {
		log.Fatalf("subscribe heartbeat: %v", err)
	}
	defer hbSub.Unsubscribe()

	// Start background prune loop for presence
	go presence.PruneLoop(ctx, time.Duration(hbTTL/3)*time.Second)

	// Subscribe to all capability requests
	sub, err := nc.Subscribe("mesh.requests.>", func(msg *nats.Msg) {
		handleRequest(ctx, msg, engine, cachingRegistry, nc, audit)
	})
	if err != nil {
		log.Fatalf("subscribe: %v", err)
	}
	defer sub.Unsubscribe()

	log.Println("matching subscribed to mesh.requests.>")
	<-ctx.Done()
	log.Println("matching shutting down")
}

func handleRequest(ctx context.Context, msg *nats.Msg, engine *MatchEngine, registry RegistryLister, nc *nats.Conn, audit *AuditPublisher) {
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

	result := engine.SelectMatch(ctx, registry, &reqData, consumerDID, requestID, correlationID)

	if result.RejectReason != "" {
		publishReject(ctx, nc, requestID, consumerDID, result.RejectReason, msg.Reply, audit)
		return
	}

	matchEv, err := cloudevents.NewEvent(
		cloudevents.TypeCapabilityMatch,
		"did:mesh:broker:local",
		result.MatchData,
		cloudevents.AMPExtensions{CorrelationID: correlationID, SessionID: result.MatchData.Session.SessionID},
	)
	if err != nil {
		log.Printf("new match event: %v", err)
		return
	}
	payload, _ := cloudevents.SerializeJSON(matchEv)

	// Publish to reply subject if provided (request-reply flow)
	var publishErr error
	if msg.Reply != "" {
		if err := nc.Publish(msg.Reply, payload); err != nil {
			log.Printf("publish match to reply %s: %v", msg.Reply, err)
			publishErr = err
		} else {
			log.Printf("match published to reply=%s request=%s session=%s", msg.Reply, requestID, result.MatchData.Session.SessionID)
		}
	}

	// Publish audit to JetStream (best-effort)
	if audit != nil && audit.enabled {
		if err := audit.PublishMatch(ctx, matchEv); err != nil {
			log.Printf("audit publish match failed: %v", err)
		}
	}

	// Also publish directed match subjects for provider and legacy global subject for compatibility/audit
	consumerSub := "mesh.matches." + sanitizeForSubject(consumerDID)
	if err := nc.Publish(consumerSub, payload); err != nil {
		log.Printf("publish match to %s: %v", consumerSub, err)
		publishErr = err
	}

	providerID := result.MatchData.Parties.Provider
	if providerID != "" {
		providerSub := "mesh.matches." + sanitizeForSubject(providerID)
		if err := nc.Publish(providerSub, payload); err != nil {
			log.Printf("publish match to %s: %v", providerSub, err)
			publishErr = err
		}
	}

	// Legacy compatibility path — publish to shared subject during rollout
	if err := nc.Publish("mesh.matches", payload); err != nil {
		log.Printf("publish legacy match: %v", err)
		publishErr = err
	}

	if publishErr != nil {
		log.Printf("match published with errors request=%s provider=%s session=%s: %v", requestID, providerID, result.MatchData.Session.SessionID, publishErr)
	} else {
		log.Printf("match published request=%s provider=%s session=%s", requestID, providerID, result.MatchData.Session.SessionID)
	}
}

func publishReject(ctx context.Context, nc *nats.Conn, requestID, consumerDID, reason, reply string, audit *AuditPublisher) {
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
	// Publish reject to the reply subject if available
	if reply != "" {
		if err := nc.Publish(reply, payload); err != nil {
			log.Printf("publish reject to reply %s: %v", reply, err)
		}
	}
	// Publish reject to the specific consumer subject and legacy subject for compatibility
	consumerSub := "mesh.matches." + sanitizeForSubject(consumerDID)
	if err := nc.Publish(consumerSub, payload); err != nil {
		log.Printf("publish reject to %s: %v", consumerSub, err)
	}
	if err := nc.Publish("mesh.matches", payload); err != nil {
		log.Printf("publish legacy reject: %v", err)
	}

	// Audit reject to JetStream (best-effort)
	if audit != nil && audit.enabled {
		if err := audit.PublishReject(ctx, ev); err != nil {
			log.Printf("audit publish reject failed: %v", err)
		}
	}

	log.Printf("reject published request=%s reason=%s", requestID, reason)
}

func sanitizeForSubject(id string) string {
	// make a best-effort sanitization for use in NATS subjects
	// replace characters that are unsafe or commonly present in DIDs
	r := strings.NewReplacer(":", "_", "/", "_", "#", "_", "@", "_", "?", "_", "=", "_", "&", "_")
	s := r.Replace(id)
	// collapse consecutive dots or underscores
	s = strings.ReplaceAll(s, "..", "_")
	return s
}
