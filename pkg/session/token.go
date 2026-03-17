package session

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrInvalidToken   = errors.New("invalid session token")
	ErrTokenExpired   = errors.New("session token expired")
	ErrPartiesMismatch = errors.New("session token parties mismatch")
)

type Claims struct {
	SessionID   string
	ConsumerDID string
	ProviderDID string
	ExpiresAt   time.Time
	JTI         string
}

type jwtClaims struct {
	SessionID   string `json:"session_id"`
	ConsumerDID string `json:"consumer_did"`
	ProviderDID string `json:"provider_did"`
	jwt.RegisteredClaims
}

func IssueToken(c Claims, secret []byte, now time.Time) (string, error) {
	if len(secret) == 0 {
		return "", fmt.Errorf("%w: missing secret", ErrInvalidToken)
	}
	if c.SessionID == "" || c.ConsumerDID == "" || c.ProviderDID == "" {
		return "", fmt.Errorf("%w: missing required claims", ErrInvalidToken)
	}
	if c.ExpiresAt.IsZero() || !c.ExpiresAt.After(now) {
		return "", fmt.Errorf("%w: invalid expiration", ErrInvalidToken)
	}
	jti := c.JTI
	if jti == "" {
		jti = uuid.NewString()
	}
	claims := jwtClaims{
		SessionID:   c.SessionID,
		ConsumerDID: c.ConsumerDID,
		ProviderDID: c.ProviderDID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(c.ExpiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        jti,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

func ValidateToken(tokenString string, secret []byte, now time.Time) (Claims, error) {
	return validate(tokenString, secret, "", "", now)
}

func ValidateTokenForParties(tokenString string, secret []byte, consumerDID, providerDID string, now time.Time) (Claims, error) {
	return validate(tokenString, secret, consumerDID, providerDID, now)
}

func validate(tokenString string, secret []byte, consumerDID, providerDID string, now time.Time) (Claims, error) {
	if tokenString == "" || len(secret) == 0 {
		return Claims{}, ErrInvalidToken
	}

	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithTimeFunc(func() time.Time {
		return now
	}))
	var parsedClaims jwtClaims
	token, err := parser.ParseWithClaims(tokenString, &parsedClaims, func(token *jwt.Token) (interface{}, error) {
		return secret, nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return Claims{}, ErrTokenExpired
		}
		return Claims{}, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	if token == nil || !token.Valid {
		return Claims{}, ErrInvalidToken
	}
	if parsedClaims.SessionID == "" || parsedClaims.ConsumerDID == "" || parsedClaims.ProviderDID == "" {
		return Claims{}, ErrInvalidToken
	}
	if consumerDID != "" && providerDID != "" {
		if parsedClaims.ConsumerDID != consumerDID || parsedClaims.ProviderDID != providerDID {
			return Claims{}, ErrPartiesMismatch
		}
	}
	out := Claims{
		SessionID:   parsedClaims.SessionID,
		ConsumerDID: parsedClaims.ConsumerDID,
		ProviderDID: parsedClaims.ProviderDID,
		JTI:         parsedClaims.ID,
	}
	if parsedClaims.ExpiresAt != nil {
		out.ExpiresAt = parsedClaims.ExpiresAt.Time
	}
	return out, nil
}
