package cloudevents

import (
	"encoding/json"
	"testing"
)

func TestNewEvent(t *testing.T) {
	data := map[string]string{"task": "test"}
	ext := AMPExtensions{CorrelationID: "corr-123", AMPVersion: "0.1.0"}
	e, err := NewEvent(TypeCapabilityRequest, "did:mesh:agent:consumer-1", data, ext)
	if err != nil {
		t.Fatalf("NewEvent: %v", err)
	}
	if e.Type() != TypeCapabilityRequest {
		t.Errorf("Type = %q", e.Type())
	}
	if e.Source() != "did:mesh:agent:consumer-1" {
		t.Errorf("Source = %q", e.Source())
	}
	got := GetAMPExtensions(*e)
	if got.CorrelationID != "corr-123" {
		t.Errorf("CorrelationID = %q", got.CorrelationID)
	}
}

func TestSerializeParseRoundtrip(t *testing.T) {
	e, _ := NewEvent(TypeCapabilityMatch, "did:mesh:broker:local", nil, AMPExtensions{SessionID: "sess-1"})
	b, err := SerializeJSON(e)
	if err != nil {
		t.Fatalf("SerializeJSON: %v", err)
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if raw["type"] != TypeCapabilityMatch {
		t.Errorf("type = %v", raw["type"])
	}
	parsed, err := ParseJSON(b)
	if err != nil {
		t.Fatalf("ParseJSON: %v", err)
	}
	if parsed.Type() != e.Type() || parsed.Source() != e.Source() {
		t.Error("roundtrip mismatch")
	}
}
