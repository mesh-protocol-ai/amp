//go:build enterprise
// +build enterprise

// token_test.go tests JWT (Enterprise) session tokens. Build with -tags=enterprise when JWT implementation is present.

package session

import (
	"testing"
	"time"
)

func TestIssueAndValidateToken(t *testing.T) {
	secret := []byte("super-secret-key")
	now := time.Now().UTC()
	claims := Claims{
		SessionID:   "session-123",
		ConsumerDID: "did:mesh:agent:consumer",
		ProviderDID: "did:mesh:agent:provider",
		ExpiresAt:   now.Add(10 * time.Minute),
	}

	token, err := IssueToken(claims, secret, now)
	if err != nil {
		t.Fatalf("IssueToken() error = %v", err)
	}

	validated, err := ValidateToken(token, secret, now.Add(1*time.Minute))
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}
	if validated.SessionID != claims.SessionID {
		t.Fatalf("SessionID mismatch: got %q want %q", validated.SessionID, claims.SessionID)
	}
	if validated.ConsumerDID != claims.ConsumerDID {
		t.Fatalf("ConsumerDID mismatch: got %q want %q", validated.ConsumerDID, claims.ConsumerDID)
	}
	if validated.ProviderDID != claims.ProviderDID {
		t.Fatalf("ProviderDID mismatch: got %q want %q", validated.ProviderDID, claims.ProviderDID)
	}
}

func TestValidateTokenRejectsWrongPair(t *testing.T) {
	secret := []byte("super-secret-key")
	now := time.Now().UTC()
	token, err := IssueToken(Claims{
		SessionID:   "session-123",
		ConsumerDID: "did:mesh:agent:consumer",
		ProviderDID: "did:mesh:agent:provider",
		ExpiresAt:   now.Add(5 * time.Minute),
	}, secret, now)
	if err != nil {
		t.Fatalf("IssueToken() error = %v", err)
	}

	_, err = ValidateTokenForParties(token, secret, "did:mesh:agent:other", "did:mesh:agent:provider", now)
	if err == nil {
		t.Fatalf("ValidateTokenForParties() expected error for wrong consumer")
	}
}

func TestValidateTokenRejectsExpired(t *testing.T) {
	secret := []byte("super-secret-key")
	now := time.Now().UTC()
	token, err := IssueToken(Claims{
		SessionID:   "session-123",
		ConsumerDID: "did:mesh:agent:consumer",
		ProviderDID: "did:mesh:agent:provider",
		ExpiresAt:   now.Add(1 * time.Minute),
	}, secret, now)
	if err != nil {
		t.Fatalf("IssueToken() error = %v", err)
	}

	_, err = ValidateToken(token, secret, now.Add(2*time.Minute))
	if err == nil {
		t.Fatalf("ValidateToken() expected expiration error")
	}
}
