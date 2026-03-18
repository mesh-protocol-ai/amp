package session

import (
	"errors"
	"testing"
)

func TestIssueSimpleToken_Valid(t *testing.T) {
	secret := []byte("test-secret")
	token, err := IssueSimpleToken(secret, "s1", "did:mesh:agent:c", "did:mesh:agent:p")
	if err != nil {
		t.Fatalf("IssueSimpleToken: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
}

func TestIssueSimpleToken_SameInputSameToken(t *testing.T) {
	secret := []byte("secret")
	t1, err := IssueSimpleToken(secret, "s1", "did:c", "did:p")
	if err != nil {
		t.Fatalf("IssueSimpleToken: %v", err)
	}
	t2, err := IssueSimpleToken(secret, "s1", "did:c", "did:p")
	if err != nil {
		t.Fatalf("IssueSimpleToken: %v", err)
	}
	if t1 != t2 {
		t.Errorf("same input should yield same token: %q != %q", t1, t2)
	}
}

func TestIssueSimpleToken_EmptySecret(t *testing.T) {
	_, err := IssueSimpleToken(nil, "s1", "did:c", "did:p")
	if err == nil {
		t.Fatal("expected error for empty secret")
	}
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("expected ErrInvalidToken or wrapped: %v", err)
	}
}

func TestIssueSimpleToken_EmptySessionID(t *testing.T) {
	_, err := IssueSimpleToken([]byte("secret"), "", "did:c", "did:p")
	if err == nil {
		t.Fatal("expected error for empty sessionID")
	}
}

func TestValidateSimpleToken_Valid(t *testing.T) {
	secret := []byte("secret")
	token, err := IssueSimpleToken(secret, "s1", "did:mesh:agent:c", "did:mesh:agent:p")
	if err != nil {
		t.Fatalf("IssueSimpleToken: %v", err)
	}
	err = ValidateSimpleToken(token, secret, "s1", "did:mesh:agent:c", "did:mesh:agent:p")
	if err != nil {
		t.Fatalf("ValidateSimpleToken: %v", err)
	}
}

func TestValidateSimpleToken_InvalidToken(t *testing.T) {
	secret := []byte("secret")
	err := ValidateSimpleToken("wrong-token", secret, "s1", "did:c", "did:p")
	if err == nil {
		t.Fatal("expected error for invalid token")
	}
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("expected ErrInvalidToken or wrapped: %v", err)
	}
}

func TestValidateSimpleToken_EmptyToken(t *testing.T) {
	err := ValidateSimpleToken("", []byte("secret"), "s1", "did:c", "did:p")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestValidateSimpleToken_EmptySecret(t *testing.T) {
	token, _ := IssueSimpleToken([]byte("secret"), "s1", "did:c", "did:p")
	err := ValidateSimpleToken(token, nil, "s1", "did:c", "did:p")
	if err == nil {
		t.Fatal("expected error for empty secret")
	}
}

func TestValidateSimpleToken_WrongParties(t *testing.T) {
	secret := []byte("secret")
	token, err := IssueSimpleToken(secret, "s1", "did:consumer", "did:provider")
	if err != nil {
		t.Fatalf("IssueSimpleToken: %v", err)
	}
	err = ValidateSimpleToken(token, secret, "s1", "did:other", "did:provider")
	if err == nil {
		t.Fatal("expected error when consumer DID does not match")
	}
}
