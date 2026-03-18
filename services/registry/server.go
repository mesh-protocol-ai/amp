package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
)

// storeInterface is satisfied by Store and by memStore in tests.
type storeInterface interface {
	Upsert(ctx context.Context, card *agentcard.Card, status string) error
	Get(ctx context.Context, id string) (*agentcard.Card, string, error)
	List(ctx context.Context, statusFilter string) ([]*agentcard.Card, error)
	ListByDomainCapability(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error)
	UpdateStatus(ctx context.Context, id, status string) error
	Delete(ctx context.Context, id string) error
}

// Server exposes the Registry HTTP API.
type Server struct {
	store      storeInterface
	writeToken string // non-empty → required on all mutating requests
}

// NewServer creates the server.
// writeToken is optional: if set, every mutating request (POST/PATCH/PUT/DELETE)
// must carry `Authorization: Bearer <writeToken>`. Set via REGISTRY_WRITE_TOKEN.
func NewServer(store storeInterface, writeToken string) *Server {
	return &Server{store: store, writeToken: writeToken}
}

// requireWriteAuth rejects the request with 401 when write auth is configured
// and the bearer token is missing or does not match.
// Returns true if the request is allowed to proceed.
func (s *Server) requireWriteAuth(w http.ResponseWriter, r *http.Request) bool {
	if s.writeToken == "" {
		return true // auth not configured — allow (dev/local mode)
	}
	const prefix = "Bearer "
	auth := r.Header.Get("Authorization")
	if len(auth) <= len(prefix) || auth[:len(prefix)] != prefix {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "missing or malformed Authorization header (expected: Bearer <token>)",
		})
		return false
	}
	if auth[len(prefix):] != s.writeToken {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "invalid registry write token",
		})
		return false
	}
	return true
}

// Register (POST /agents) - creates or updates an Agent Card.
func (s *Server) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireWriteAuth(w, r) {
		return
	}
	var card agentcard.Card
	if err := json.NewDecoder(r.Body).Decode(&card); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json: " + err.Error()})
		return
	}
	if err := agentcard.Validate(&card); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "active"
	}
	if err := s.store.Upsert(r.Context(), &card, status); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": card.Metadata.ID, "status": status})
}

// Get (GET /agents/:id) - returns an Agent Card.
func (s *Server) Get(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id required"})
		return
	}
	card, status, err := s.store.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"card":   card,
		"status": status,
	})
}

// List (GET /agents?domain=finance,credit-analysis&capability=echo) - lists agents (for matching).
func (s *Server) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	domain := splitComma(r.URL.Query().Get("domain"))
	capability := r.URL.Query().Get("capability")
	var cards []*agentcard.Card
	var err error
	if len(domain) > 0 || capability != "" {
		cards, err = s.store.ListByDomainCapability(r.Context(), domain, capability)
	} else {
		statusFilter := r.URL.Query().Get("status")
		cards, err = s.store.List(r.Context(), statusFilter)
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"agents": cards})
}

// UpdateStatus (PATCH /agents/:id/status) - updates status only.
func (s *Server) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPut {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireWriteAuth(w, r) {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id required"})
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if body.Status == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status required"})
		return
	}
	allowed := map[string]bool{"active": true, "suspended": true, "deprecated": true, "retired": true}
	if !allowed[body.Status] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid status"})
		return
	}
	if err := s.store.UpdateStatus(r.Context(), id, body.Status); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": body.Status})
}

// Delete (DELETE /agents/:id).
func (s *Server) Delete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireWriteAuth(w, r) {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id required"})
		return
	}
	if err := s.store.Delete(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "deleted": "true"})
}

// Health (GET /health).
func (s *Server) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func splitComma(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	for _, p := range split(s, ',') {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func split(s string, sep rune) []string {
	var out []string
	var cur string
	for _, r := range s {
		if r == sep {
			out = append(out, cur)
			cur = ""
		} else {
			cur += string(r)
		}
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
