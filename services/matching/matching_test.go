package main

import (
    "context"
    "testing"
    "time"

    natsserver "github.com/nats-io/nats-server/v2/server"
    natsservertest "github.com/nats-io/nats-server/v2/test"
    "github.com/nats-io/nats.go"

    "github.com/mesh-protocol-ai/amp/pkg/agentcard"
    "github.com/mesh-protocol-ai/amp/pkg/cloudevents"
    "github.com/mesh-protocol-ai/amp/pkg/events"
)

type testRegistry struct{}

func (r *testRegistry) ListCandidates(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error) {
    card := &agentcard.Card{
        Metadata: agentcard.Metadata{ID: "did:mesh:provider:1", Name: "provider-1", Owner: "owner"},
        Spec: agentcard.Spec{
            Domains: agentcard.Domains{Primary: []string{"demo"}},
            Capabilities: []agentcard.Capability{{ID: "cap-math", Description: "math"}},
            Endpoints: agentcard.Endpoints{
                ControlPlane: agentcard.ControlPlaneEndpoint{NATSSubject: "mesh.agent.provider1"},
                DataPlane:    agentcard.DataPlaneEndpoint{GRPC: "localhost:50051"},
            },
            Operational: &agentcard.Operational{AvgLatencyMs: 50},
        },
    }
    return []*agentcard.Card{card}, nil
}

func TestDirectedMatchPublishing(t *testing.T) {
    // Start an in-memory NATS server
    s := natsservertest.RunServer(&natsserver.Options{Port: -1})
    defer s.Shutdown()

    nc, err := nats.Connect(s.ClientURL())
    if err != nil {
        t.Fatalf("nats connect: %v", err)
    }
    defer nc.Close()

    // Prepare capture channels
    globalCh := make(chan *nats.Msg, 4)
    consumerCh := make(chan *nats.Msg, 4)
    providerCh := make(chan *nats.Msg, 4)

    if _, err := nc.Subscribe("mesh.matches", func(m *nats.Msg) { globalCh <- m }); err != nil {
        t.Fatalf("subscribe global: %v", err)
    }

    consumerDID := "did:mesh:consumer:1"
    consumerSub := "mesh.matches." + sanitizeForSubject(consumerDID)
    if _, err := nc.Subscribe(consumerSub, func(m *nats.Msg) { consumerCh <- m }); err != nil {
        t.Fatalf("subscribe consumer: %v", err)
    }

    providerID := "did:mesh:provider:1"
    providerSub := "mesh.matches." + sanitizeForSubject(providerID)
    if _, err := nc.Subscribe(providerSub, func(m *nats.Msg) { providerCh <- m }); err != nil {
        t.Fatalf("subscribe provider: %v", err)
    }

    // ensure subscriptions are registered
    nc.Flush()
    time.Sleep(50 * time.Millisecond)

    engine := &MatchEngine{SessionTokenSecret: []byte("test-secret")}
    registry := &testRegistry{}

    reqData := &events.CapabilityRequestData{
        Task: &events.RequestTask{CapabilityID: "cap-math", Domain: []string{"demo"}},
    }

    ev, err := cloudevents.NewEvent(cloudevents.TypeCapabilityRequest, consumerDID, reqData, cloudevents.AMPExtensions{})
    if err != nil {
        t.Fatalf("new event: %v", err)
    }
    payload, err := cloudevents.SerializeJSON(ev)
    if err != nil {
        t.Fatalf("serialize event: %v", err)
    }

    // Call handler which should publish directed and legacy matches
    handleRequest(context.Background(), &nats.Msg{Data: payload}, engine, registry, nc, nil)

    // Wait for all three deliveries
    deadline := time.After(2 * time.Second)
    got := 0
    for got < 3 {
        select {
        case m := <-consumerCh:
            e, err := cloudevents.ParseJSON(m.Data)
            if err != nil {
                t.Fatalf("parse consumer event: %v", err)
            }
            if e.Type() != cloudevents.TypeCapabilityMatch {
                t.Fatalf("expected capability.match, got %s", e.Type())
            }
            var d events.CapabilityMatchData
            if err := e.DataAs(&d); err != nil {
                t.Fatalf("consumer DataAs: %v", err)
            }
            if d.Parties.Consumer != consumerDID {
                t.Fatalf("consumer mismatch: %s", d.Parties.Consumer)
            }
            got++
        case m := <-providerCh:
            e, err := cloudevents.ParseJSON(m.Data)
            if err != nil {
                t.Fatalf("parse provider event: %v", err)
            }
            var d events.CapabilityMatchData
            if err := e.DataAs(&d); err != nil {
                t.Fatalf("provider DataAs: %v", err)
            }
            if d.Parties.Provider != providerID {
                t.Fatalf("provider mismatch: %s", d.Parties.Provider)
            }
            got++
        case m := <-globalCh:
            e, err := cloudevents.ParseJSON(m.Data)
            if err != nil {
                t.Fatalf("parse global event: %v", err)
            }
            if e.Type() != cloudevents.TypeCapabilityMatch {
                t.Fatalf("expected capability.match on global, got %s", e.Type())
            }
            got++
        case <-deadline:
            t.Fatalf("timeout waiting for published matches (got %d)", got)
        }
    }
}

func TestReplySubjectPublishing(t *testing.T) {
    s := natsservertest.RunServer(&natsserver.Options{Port: -1})
    defer s.Shutdown()

    nc, err := nats.Connect(s.ClientURL())
    if err != nil {
        t.Fatalf("nats connect: %v", err)
    }
    defer nc.Close()

    replyCh := make(chan *nats.Msg, 2)
    providerCh := make(chan *nats.Msg, 2)
    globalCh := make(chan *nats.Msg, 2)

    // subscribe to provider and global
    providerID := "did:mesh:provider:1"
    providerSub := "mesh.matches." + sanitizeForSubject(providerID)
    if _, err := nc.Subscribe(providerSub, func(m *nats.Msg) { providerCh <- m }); err != nil {
        t.Fatalf("subscribe provider: %v", err)
    }
    if _, err := nc.Subscribe("mesh.matches", func(m *nats.Msg) { globalCh <- m }); err != nil {
        t.Fatalf("subscribe global: %v", err)
    }

    // create reply inbox
    replyInbox := nats.NewInbox()
    if _, err := nc.Subscribe(replyInbox, func(m *nats.Msg) { replyCh <- m }); err != nil {
        t.Fatalf("subscribe reply: %v", err)
    }

    // ensure subscriptions registered
    nc.Flush()
    time.Sleep(20 * time.Millisecond)

    engine := &MatchEngine{SessionTokenSecret: []byte("test-secret")}
    registry := &testRegistry{}

    consumerDID := "did:mesh:consumer:1"
    reqData := &events.CapabilityRequestData{
        Task: &events.RequestTask{CapabilityID: "cap-math", Domain: []string{"demo"}},
    }
    ev, err := cloudevents.NewEvent(cloudevents.TypeCapabilityRequest, consumerDID, reqData, cloudevents.AMPExtensions{})
    if err != nil {
        t.Fatalf("new event: %v", err)
    }
    payload, err := cloudevents.SerializeJSON(ev)
    if err != nil {
        t.Fatalf("serialize event: %v", err)
    }

    // Call handler with Reply set
    handleRequest(context.Background(), &nats.Msg{Data: payload, Reply: replyInbox}, engine, registry, nc, nil)

    deadline := time.After(2 * time.Second)
    gotReply := false
    for !(gotReply) {
        select {
        case m := <-replyCh:
            e, err := cloudevents.ParseJSON(m.Data)
            if err != nil {
                t.Fatalf("parse reply event: %v", err)
            }
            if e.Type() != cloudevents.TypeCapabilityMatch {
                t.Fatalf("expected capability.match on reply, got %s", e.Type())
            }
            gotReply = true
        case <-deadline:
            t.Fatalf("timeout waiting for reply subject message")
        }
    }

    // also ensure provider and global receive messages
    select {
    case <-providerCh:
    case <-time.After(500 * time.Millisecond):
        t.Fatalf("timeout waiting for provider message")
    }
    select {
    case <-globalCh:
    case <-time.After(500 * time.Millisecond):
        t.Fatalf("timeout waiting for global message")
    }
}
