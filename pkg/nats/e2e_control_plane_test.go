// Control plane E2E test (without SDK): request -> matching -> match.
// Requires running stack: docker compose up -d (NATS + Postgres + Registry + Matching).
// Skips if NATS or Registry are not reachable.

package nats

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/mesh-protocol-ai/amp/pkg/cloudevents"
	"github.com/mesh-protocol-ai/amp/pkg/events"
	"github.com/nats-io/nats.go"
)

const (
	e2eNATSConnectWait   = 2 * time.Second
	e2eMatchTimeout     = 8 * time.Second
	e2eRequestSubject   = "mesh.requests.demo.echo.global"
	e2eMatchSubject     = "mesh.matches"
	e2eExpectedProvider = "did:mesh:agent:echo-demo-001"
)

func TestE2EControlPlaneRequestMatch(t *testing.T) {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = nats.DefaultURL
	}
	registryURL := os.Getenv("REGISTRY_URL")
	if registryURL == "" {
		registryURL = "http://localhost:8080"
	}

	nc, err := nats.Connect(natsURL, nats.Timeout(e2eNATSConnectWait))
	if err != nil {
		t.Skipf("NATS not available (run: docker compose up -d): %v", err)
		return
	}
	defer nc.Close()

	if err := registerExampleAgent(t, registryURL); err != nil {
		t.Skipf("Registry not available or failed to register agent: %v", err)
		return
	}

	recv := make(chan *events.CapabilityMatchData, 2)
	reject := make(chan string, 1)
	sub, err := nc.Subscribe(e2eMatchSubject, func(msg *nats.Msg) {
		ev, err := cloudevents.ParseJSON(msg.Data)
		if err != nil {
			return
		}
		switch ev.Type() {
		case cloudevents.TypeCapabilityMatch:
			var data events.CapabilityMatchData
			if err := ev.DataAs(&data); err != nil {
				return
			}
			select {
			case recv <- &data:
			default:
			}
		case cloudevents.TypeCapabilityReject:
			var data map[string]string
			if err := ev.DataAs(&data); err == nil && data["reason"] != "" {
				select {
				case reject <- data["reason"]:
				default:
				}
			}
		}
	})
	if err != nil {
		t.Fatalf("subscribe mesh.matches: %v", err)
	}
	defer sub.Unsubscribe()

	reqData := events.CapabilityRequestData{
		Task: &events.RequestTask{
			CapabilityID: "echo",
			Domain:       []string{"demo", "echo"},
			Description:  "E2E test request",
		},
		Constraints: &events.RequestConstraints{
			MaxLatencyMs: 30000,
		},
	}
	ev, err := cloudevents.NewEvent(
		cloudevents.TypeCapabilityRequest,
		"did:mesh:agent:e2e-test-consumer",
		reqData,
		cloudevents.AMPExtensions{CorrelationID: "e2e-control-plane-test"},
	)
	if err != nil {
		t.Fatalf("NewEvent: %v", err)
	}
	payload, err := cloudevents.SerializeJSON(ev)
	if err != nil {
		t.Fatalf("SerializeJSON: %v", err)
	}
	if err := nc.Publish(e2eRequestSubject, payload); err != nil {
		t.Fatalf("Publish request: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), e2eMatchTimeout)
	defer cancel()
	select {
	case data := <-recv:
		if data.Parties.Provider != e2eExpectedProvider {
			t.Errorf("match provider = %q, want %q", data.Parties.Provider, e2eExpectedProvider)
		}
		if data.Parties.Consumer != "did:mesh:agent:e2e-test-consumer" {
			t.Errorf("match consumer = %q", data.Parties.Consumer)
		}
		if data.Session.SessionID == "" {
			t.Error("match session_id empty")
		}
		if data.RequestID != ev.ID() {
			t.Errorf("match request_id = %q, want %q", data.RequestID, ev.ID())
		}
		t.Logf("E2E OK: match session=%s provider=%s", data.Session.SessionID, data.Parties.Provider)
	case reason := <-reject:
		t.Fatalf("matching rejected the request: %s", reason)
	case <-ctx.Done():
		t.Fatal("timeout waiting for match or reject (is Matching running?)")
	}
}

func registerExampleAgent(t *testing.T, baseURL string) error {
	t.Helper()
	body, err := os.ReadFile("fixtures/example-agent-card.json")
	if err != nil {
		body, err = os.ReadFile("../../fixtures/example-agent-card.json")
		if err != nil {
			return err
		}
	}
	resp, err := http.Post(baseURL+"/agents", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return err
	}
	return nil
}

// TestE2EControlPlaneRequestNoProvider publishes a request for domain/capability
// that no agent in Registry provides and verifies Matching publishes reject.
func TestE2EControlPlaneRequestNoProvider(t *testing.T) {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = nats.DefaultURL
	}

	nc, err := nats.Connect(natsURL, nats.Timeout(e2eNATSConnectWait))
	if err != nil {
		t.Skipf("NATS not available (run: docker compose up -d): %v", err)
		return
	}
	defer nc.Close()

	rejectReason := make(chan string, 1)
	matchReceived := make(chan struct{}, 1)
	sub, err := nc.Subscribe(e2eMatchSubject, func(msg *nats.Msg) {
		ev, err := cloudevents.ParseJSON(msg.Data)
		if err != nil {
			return
		}
		switch ev.Type() {
		case cloudevents.TypeCapabilityReject:
			var data map[string]string
			if err := ev.DataAs(&data); err == nil && data["reason"] != "" {
				select {
				case rejectReason <- data["reason"]:
				default:
				}
			}
		case cloudevents.TypeCapabilityMatch:
			select {
			case matchReceived <- struct{}{}:
			default:
			}
		}
	})
	if err != nil {
		t.Fatalf("subscribe mesh.matches: %v", err)
	}
	defer sub.Unsubscribe()

	// Request for domain/capability that no registered agent offers
	reqData := events.CapabilityRequestData{
		Task: &events.RequestTask{
			CapabilityID: "capability-that-does-not-exist",
			Domain:       []string{"nonexistent", "domain"},
			Description:  "E2E test: no provider",
		},
		Constraints: &events.RequestConstraints{MaxLatencyMs: 30000},
	}
	ev, err := cloudevents.NewEvent(
		cloudevents.TypeCapabilityRequest,
		"did:mesh:agent:e2e-test-no-provider",
		reqData,
		cloudevents.AMPExtensions{CorrelationID: "e2e-no-provider-test"},
	)
	if err != nil {
		t.Fatalf("NewEvent: %v", err)
	}
	payload, err := cloudevents.SerializeJSON(ev)
	if err != nil {
		t.Fatalf("SerializeJSON: %v", err)
	}
	if err := nc.Publish(e2eRequestSubject, payload); err != nil {
		t.Fatalf("Publish request: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), e2eMatchTimeout)
	defer cancel()
	select {
	case reason := <-rejectReason:
		if reason != "no_providers_available" {
			t.Errorf("reject reason = %q, want no_providers_available", reason)
		}
		t.Logf("E2E OK: reject received with reason=%s", reason)
	case <-matchReceived:
		t.Fatal("should not have received match (no agent for this domain/capability)")
	case <-ctx.Done():
		t.Fatal("timeout waiting for reject (is Matching running?)")
	}
}