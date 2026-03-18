package main

import (
	"context"
	"log"
	"os"
	"os/signal"
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
	sessionTokenSecret := []byte(strings.TrimSpace(os.Getenv("SESSION_TOKEN_SECRET")))
	if len(sessionTokenSecret) == 0 {
		log.Fatalf("SESSION_TOKEN_SECRET is required")
	}

	engine := &MatchEngine{SessionTokenSecret: sessionTokenSecret}
	registry := newRegistryClient(registryURL)

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
		handleRequest(ctx, msg, engine, registry, nc)
	})
	if err != nil {
		log.Fatalf("subscribe: %v", err)
	}
	defer sub.Unsubscribe()

	log.Println("matching subscribed to mesh.requests.>")
	<-ctx.Done()
	log.Println("matching shutting down")
}

func handleRequest(ctx context.Context, msg *nats.Msg, engine *MatchEngine, registry RegistryLister, nc *nats.Conn) {
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
		publishReject(nc, requestID, consumerDID, result.RejectReason)
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

	if err := nc.Publish("mesh.matches", payload); err != nil {
		log.Printf("publish match: %v", err)
		return
	}
	log.Printf("match published request=%s provider=%s session=%s", requestID, result.MatchData.Parties.Provider, result.MatchData.Session.SessionID)
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
