package main

import (
    "context"
    "log"
    "github.com/mesh-protocol-ai/amp/pkg/cloudevents"
    "github.com/cloudevents/sdk-go/v2/event"
    "github.com/nats-io/nats.go"
)

// AuditPublisher publishes match/reject events to JetStream-backed audit streams.
type AuditPublisher struct {
    js        nats.JetStreamContext
    enabled   bool
    stream    string
    matchSub  string
    rejectSub string
}

// NewAuditPublisher attempts to create or attach to a JetStream stream.
// If JetStream is not available or stream creation fails, the publisher will be returned
// with enabled=false so the caller can continue without fatal errors.
func NewAuditPublisher(nc *nats.Conn, stream string) *AuditPublisher {
    ap := &AuditPublisher{enabled: false}
    if nc == nil {
        return ap
    }
    js, err := nc.JetStream()
    if err != nil {
        log.Printf("jetstream: could not obtain JetStream context: %v", err)
        return ap
    }
    ap.js = js
    ap.stream = stream
    ap.matchSub = "mesh.audit.matches"
    ap.rejectSub = "mesh.audit.rejects"

    // Ensure stream exists (best-effort). If adding the stream fails, disable audits.
    if _, err := js.StreamInfo(stream); err != nil {
        cfg := &nats.StreamConfig{
            Name:     stream,
            Subjects: []string{"mesh.audit.>"},
            Storage:  nats.FileStorage,
        }
        if _, err := js.AddStream(cfg); err != nil {
            log.Printf("jetstream: add stream %s failed: %v", stream, err)
            return ap
        }
    }
    ap.enabled = true
    log.Printf("jetstream: audit stream ready=%s subjects=mesh.audit.>", stream)
    return ap
}

func (a *AuditPublisher) PublishMatch(ctx context.Context, ev *event.Event) error {
    if a == nil || !a.enabled || ev == nil {
        return nil
    }
    payload, err := cloudevents.SerializeJSON(ev)
    if err != nil {
        return err
    }
    _, err = a.js.Publish(a.matchSub, payload)
    if err != nil {
        log.Printf("jetstream: publish match failed: %v", err)
    }
    return err
}

func (a *AuditPublisher) PublishReject(ctx context.Context, ev *event.Event) error {
    if a == nil || !a.enabled || ev == nil {
        return nil
    }
    payload, err := cloudevents.SerializeJSON(ev)
    if err != nil {
        return err
    }
    _, err = a.js.Publish(a.rejectSub, payload)
    if err != nil {
        log.Printf("jetstream: publish reject failed: %v", err)
    }
    return err
}
