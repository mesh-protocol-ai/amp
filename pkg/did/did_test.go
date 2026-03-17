package did

import (
	"crypto/ed25519"
	"encoding/json"
	"testing"
)

func TestGenerateAgent(t *testing.T) {
	kp, err := GenerateAgent("test-agent-001")
	if err != nil {
		t.Fatalf("GenerateAgent: %v", err)
	}
	if kp.DID != "did:mesh:agent:test-agent-001" {
		t.Errorf("DID = %q, want did:mesh:agent:test-agent-001", kp.DID)
	}
	if len(kp.PubKey) != ed25519.PublicKeySize {
		t.Errorf("PubKey length = %d", len(kp.PubKey))
	}
	if len(kp.PrivKey) != ed25519.PrivateKeySize {
		t.Errorf("PrivKey length = %d", len(kp.PrivKey))
	}
	if kp.Document == nil || kp.Document.ID != kp.DID {
		t.Error("Document not set or ID mismatch")
	}
}

func TestSignVerify(t *testing.T) {
	kp, _ := GenerateAgent("sign-test")
	payload := []byte("hello amp")
	sig := kp.Sign(payload)
	if err := kp.Document.Verify(payload, sig); err != nil {
		t.Errorf("Verify: %v", err)
	}
	// wrong payload
	if err := kp.Document.Verify([]byte("wrong"), sig); err != ErrInvalidSig {
		t.Errorf("Verify(wrong payload): got %v", err)
	}
	// VerifyDID com pub key
	if err := VerifyDID(kp.DID, kp.PubKey, payload, sig); err != nil {
		t.Errorf("VerifyDID: %v", err)
	}
}

func TestParseAgentID(t *testing.T) {
	id, ok := ParseAgentID("did:mesh:agent:foo-bar")
	if !ok || id != "foo-bar" {
		t.Errorf("ParseAgentID = %q, %v", id, ok)
	}
	_, ok = ParseAgentID("did:mesh:org:acme")
	if ok {
		t.Error("ParseAgentID(org) should be false")
	}
}

func TestDocumentJSON(t *testing.T) {
	kp, _ := GenerateAgent("json-doc")
	b, err := json.Marshal(kp.Document)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var doc Document
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if doc.ID != kp.DID {
		t.Errorf("doc.ID = %q", doc.ID)
	}
}
