// E2E test: publish and receive AMP event via NATS (Phase 0).
// Requires NATS running: docker compose up -d nats
// Skips if NATS is not reachable (CI without service).

package nats

import (
	"context"
	"testing"
	"time"

	"github.com/mesh-protocol-ai/amp/pkg/cloudevents"
	"github.com/nats-io/nats.go"
)

const (
	testSubject = "mesh.events.test"
	connectWait = 2 * time.Second
)

func TestPublishSubscribeAMPEvent(t *testing.T) {
	nc, err := nats.Connect(nats.DefaultURL, nats.Timeout(connectWait))
	if err != nil {
		t.Skipf("NATS not available (run: docker compose up -d nats): %v", err)
		return
	}
	defer nc.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Subscriber
	sub, err := nc.SubscribeSync(testSubject)
	if err != nil {
		t.Fatalf("SubscribeSync: %v", err)
	}
	defer sub.Unsubscribe()

	// Publisher: AMP event
	ev, err := cloudevents.NewEvent(
		cloudevents.TypeCapabilityRequest,
		"did:mesh:agent:test-consumer",
		map[string]string{"capability": "echo"},
		cloudevents.AMPExtensions{CorrelationID: "e2e-1"},
	)
	if err != nil {
		t.Fatalf("NewEvent: %v", err)
	}
	payload, err := cloudevents.SerializeJSON(ev)
	if err != nil {
		t.Fatalf("SerializeJSON: %v", err)
	}

	if err := nc.Publish(testSubject, payload); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	// Receive
	msg, err := sub.NextMsgWithContext(ctx)
	if err != nil {
		t.Fatalf("NextMsgWithContext: %v", err)
	}
	parsed, err := cloudevents.ParseJSON(msg.Data)
	if err != nil {
		t.Fatalf("ParseJSON: %v", err)
	}
	ext := cloudevents.GetAMPExtensions(*parsed)
	if ext.CorrelationID != "e2e-1" {
		t.Errorf("CorrelationID = %q", ext.CorrelationID)
	}
	if parsed.Type() != cloudevents.TypeCapabilityRequest {
		t.Errorf("Type = %q", parsed.Type())
	}
	_ = parsed
}
