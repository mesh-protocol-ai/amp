// Package did implements DID generation and verification in did:mesh format (SPECS 4.1).
package did

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const (
	// PrefixAgent is the prefix for agent DIDs.
	PrefixAgent = "did:mesh:agent:"
	// PrefixOrg is the prefix for organization DIDs.
	PrefixOrg = "did:mesh:org:"
)

var (
	ErrInvalidDID   = errors.New("invalid DID format")
	ErrInvalidSig   = errors.New("invalid signature")
	ErrWrongKeyType = errors.New("wrong key type")
)

// Document is a minimal DID Document (SPECS 4.2): id + verificationMethod for Ed25519.
type Document struct {
	Context            []string         `json:"@context"`
	ID                 string           `json:"id"`
	VerificationMethod []VerificationKey `json:"verificationMethod"`
	Authentication     []string         `json:"authentication"`
}

// VerificationKey represents a verification key in a DID Document.
type VerificationKey struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	Controller      string `json:"controller"`
	PublicKeyBase64 string `json:"publicKeyMultibase,omitempty"`
	PublicKeyBase58 string `json:"publicKeyBase58,omitempty"`
}

// Keypair stores DID and Ed25519 keypair.
type Keypair struct {
	DID      string
	PubKey   ed25519.PublicKey
	PrivKey  ed25519.PrivateKey
	Document *Document
}

// GenerateAgent creates a new did:mesh:agent:<id> DID and Ed25519 keypair.
func GenerateAgent(id string) (*Keypair, error) {
	if id == "" || strings.Contains(id, ":") {
		return nil, fmt.Errorf("%w: id must be non-empty and not contain ':'", ErrInvalidDID)
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	did := PrefixAgent + id
	doc := &Document{
		Context: []string{"https://www.w3.org/ns/did/v1", "https://amp.protocol/ns/v1"},
		ID:     did,
		VerificationMethod: []VerificationKey{{
			ID:         did + "#key-1",
			Type:       "Ed25519VerificationKey2020",
			Controller: did,
			PublicKeyBase64: base64.StdEncoding.EncodeToString(pub),
		}},
		Authentication: []string{did + "#key-1"},
	}
	return &Keypair{DID: did, PubKey: pub, PrivKey: priv, Document: doc}, nil
}

// Sign signs payload with the keypair private key (raw Ed25519).
func (k *Keypair) Sign(payload []byte) []byte {
	return ed25519.Sign(k.PrivKey, payload)
}

// Verify checks signature using DID Document public key.
func (d *Document) Verify(payload, signature []byte) error {
	if len(d.VerificationMethod) == 0 {
		return ErrInvalidDID
	}
	pub, err := base64.StdEncoding.DecodeString(d.VerificationMethod[0].PublicKeyBase64)
	if err != nil {
		return fmt.Errorf("decode public key: %w", err)
	}
	if len(pub) != ed25519.PublicKeySize {
		return ErrWrongKeyType
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), payload, signature) {
		return ErrInvalidSig
	}
	return nil
}

// VerifyDID checks signature given DID and public key (e.g., from Registry).
func VerifyDID(did string, publicKey ed25519.PublicKey, payload, signature []byte) error {
	if len(publicKey) != ed25519.PublicKeySize {
		return ErrWrongKeyType
	}
	if !ed25519.Verify(publicKey, payload, signature) {
		return ErrInvalidSig
	}
	return nil
}

// ParseAgentID extracts agent id from did:mesh:agent:<id>.
func ParseAgentID(did string) (string, bool) {
	if !strings.HasPrefix(did, PrefixAgent) {
		return "", false
	}
	return strings.TrimPrefix(did, PrefixAgent), true
}
