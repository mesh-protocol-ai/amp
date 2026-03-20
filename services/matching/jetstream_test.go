package main

import (
    "context"
    "testing"
    "time"

    natsserver "github.com/nats-io/nats-server/v2/server"
    natsservertest "github.com/nats-io/nats-server/v2/test"
    "github.com/nats-io/nats.go"
    "github.com/mesh-protocol-ai/amp/pkg/cloudevents"
)

// TestJetStreamAuditPublishing verifies that when JetStream is available the AuditPublisher
// creates the stream and publishes match/reject events into it.
func TestJetStreamAuditPublishing(t *testing.T) {
    // Start an in-memory NATS server with JetStream enabled
    dir := t.TempDir()
    s := natsservertest.RunServer(&natsserver.Options{Port: -1, JetStream: true, StoreDir: dir})
    defer s.Shutdown()

    nc, err := nats.Connect(s.ClientURL())
    if err != nil {
        t.Fatalf("nats connect: %v", err)
    }
    defer nc.Close()

    // Create audit publisher which should create the stream on-demand
    ap := NewAuditPublisher(nc, "TEST_AUDIT")
    if ap == nil || !ap.enabled {
        t.Fatalf("audit publisher not enabled or failed to initialize")
    }

    js, err := nc.JetStream()
    if err != nil {
        t.Fatalf("jetstream context: %v", err)
    }

    // Publish a match event
    matchEv, err := cloudevents.NewEvent(cloudevents.TypeCapabilityMatch, "did:mesh:broker:test", map[string]string{"hello": "world"}, cloudevents.AMPExtensions{})
    if err != nil {
        t.Fatalf("new match event: %v", err)
    }
    if err := ap.PublishMatch(context.Background(), matchEv); err != nil {
        t.Fatalf("publish match: %v", err)
    }

    // Allow JetStream to process
    time.Sleep(100 * time.Millisecond)

    si, err := js.StreamInfo("TEST_AUDIT")
    if err != nil {
        t.Fatalf("stream info: %v", err)
    }
    if si.State.Msgs == 0 {
        t.Fatalf("expected messages in stream, got 0")
    }

    // Publish a reject event and ensure stream msg count increases
    rejEv, err := cloudevents.NewEvent(cloudevents.TypeCapabilityReject, "did:mesh:broker:test", map[string]string{"reason": "none"}, cloudevents.AMPExtensions{})
    if err != nil {
        t.Fatalf("new reject event: %v", err)
    }
    if err := ap.PublishReject(context.Background(), rejEv); err != nil {
        t.Fatalf("publish reject: %v", err)
    }
    time.Sleep(100 * time.Millisecond)
    si2, err := js.StreamInfo("TEST_AUDIT")
    if err != nil {
        t.Fatalf("stream info after reject: %v", err)
    }
    if si2.State.Msgs < 2 {
        t.Fatalf("expected at least 2 messages in stream, got %d", si2.State.Msgs)
    }
}
