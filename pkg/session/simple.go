package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
)

var ErrInvalidToken = errors.New("invalid session token")

// IssueSimpleToken produces an opaque HMAC-SHA256 token for the given session and parties.
// Token = base64(HMAC-SHA256(secret, session_id|consumer_did|provider_did)).
// Used by Community edition (security_level OPEN, no JWT).
func IssueSimpleToken(secret []byte, sessionID, consumerDID, providerDID string) (string, error) {
	if len(secret) == 0 {
		return "", fmt.Errorf("%w: missing secret", ErrInvalidToken)
	}
	if sessionID == "" || consumerDID == "" || providerDID == "" {
		return "", fmt.Errorf("%w: missing session_id, consumer_did or provider_did", ErrInvalidToken)
	}
	payload := sessionID + "|" + consumerDID + "|" + providerDID
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	sum := mac.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(sum), nil
}

// ValidateSimpleToken verifies that the token matches HMAC-SHA256(secret, session_id|consumer_did|provider_did).
// Uses constant-time comparison. Returns nil if valid.
func ValidateSimpleToken(tokenString string, secret []byte, sessionID, consumerDID, providerDID string) error {
	if tokenString == "" || len(secret) == 0 {
		return ErrInvalidToken
	}
	if sessionID == "" || consumerDID == "" || providerDID == "" {
		return ErrInvalidToken
	}
	expected, err := IssueSimpleToken(secret, sessionID, consumerDID, providerDID)
	if err != nil {
		return err
	}
	got, err1 := base64.RawURLEncoding.DecodeString(tokenString)
	exp, err2 := base64.RawURLEncoding.DecodeString(expected)
	if err1 != nil || err2 != nil {
		// Compare as raw strings if decode fails (e.g. token stored without padding)
		if hmac.Equal([]byte(tokenString), []byte(expected)) {
			return nil
		}
		return ErrInvalidToken
	}
	if !hmac.Equal(got, exp) {
		return ErrInvalidToken
	}
	return nil
}
