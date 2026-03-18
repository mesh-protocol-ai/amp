package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
)

// memStore is an in-memory store for testing Server handlers.
type memStore struct {
	cards   map[string]memCard
	status  map[string]string
}

type memCard struct {
	card   agentcard.Card
	status string
}

func newMemStore() *memStore {
	return &memStore{
		cards:  make(map[string]memCard),
		status: make(map[string]string),
	}
}

func (m *memStore) Upsert(ctx context.Context, card *agentcard.Card, status string) error {
	if status == "" {
		status = "active"
	}
	m.cards[card.Metadata.ID] = memCard{card: *card, status: status}
	m.status[card.Metadata.ID] = status
	return nil
}

func (m *memStore) Get(ctx context.Context, id string) (*agentcard.Card, string, error) {
	entry, ok := m.cards[id]
	if !ok {
		return nil, "", pgx.ErrNoRows
	}
	return &entry.card, entry.status, nil
}

func (m *memStore) List(ctx context.Context, statusFilter string) ([]*agentcard.Card, error) {
	var out []*agentcard.Card
	for _, entry := range m.cards {
		if statusFilter == "" || entry.status == statusFilter {
			c := entry.card
			out = append(out, &c)
		}
	}
	return out, nil
}

func (m *memStore) ListByDomainCapability(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error) {
	var out []*agentcard.Card
	for _, entry := range m.cards {
		if entry.status != "active" {
			continue
		}
		if len(domain) > 0 && !entry.card.HasDomain(domain) {
			continue
		}
		if capabilityID != "" && !entry.card.HasCapability(capabilityID) {
			continue
		}
		c := entry.card
		out = append(out, &c)
	}
	return out, nil
}

func (m *memStore) UpdateStatus(ctx context.Context, id, status string) error {
	_, ok := m.cards[id]
	if !ok {
		return pgx.ErrNoRows
	}
	entry := m.cards[id]
	entry.status = status
	m.cards[id] = entry
	m.status[id] = status
	return nil
}

func (m *memStore) Delete(ctx context.Context, id string) error {
	if _, ok := m.cards[id]; !ok {
		return pgx.ErrNoRows
	}
	delete(m.cards, id)
	delete(m.status, id)
	return nil
}

func validCard(id string) agentcard.Card {
	return agentcard.Card{
		Metadata: agentcard.Metadata{
			ID:      id,
			Name:    "test-agent",
			Version: "1.0.0",
			Owner:   "did:mesh:org:test",
		},
		Spec: agentcard.Spec{
			Domains: agentcard.Domains{Primary: []string{"test"}},
			Capabilities: []agentcard.Capability{
				{ID: "echo", Description: "Echo"},
			},
			Endpoints: agentcard.Endpoints{
				ControlPlane: agentcard.ControlPlaneEndpoint{NATSSubject: "mesh.agent.test"},
				DataPlane:    agentcard.DataPlaneEndpoint{GRPC: "grpc://localhost:50051"},
			},
		},
	}
}

func TestServer_Register_InvalidJSON(t *testing.T) {
	srv := NewServer(newMemStore())
	req := httptest.NewRequest(http.MethodPost, "/agents", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Register(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("Register invalid JSON: got status %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestServer_Register_ValidCard(t *testing.T) {
	store := newMemStore()
	srv := NewServer(store)
	card := validCard("did:mesh:agent:test-1")
	body, _ := json.Marshal(card)
	req := httptest.NewRequest(http.MethodPost, "/agents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Register(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("Register valid card: got status %d, want %d", rec.Code, http.StatusOK)
	}
	var res map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if res["id"] != card.Metadata.ID {
		t.Errorf("response id: got %q, want %q", res["id"], card.Metadata.ID)
	}
	_, st, _ := store.Get(context.Background(), card.Metadata.ID)
	if st != "active" {
		t.Errorf("stored status: got %q, want active", st)
	}
}

func TestServer_Get_EmptyID(t *testing.T) {
	srv := NewServer(newMemStore())
	req := httptest.NewRequest(http.MethodGet, "/agents/", nil)
	req.SetPathValue("id", "")
	rec := httptest.NewRecorder()
	srv.Get(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("Get empty id: got status %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestServer_Get_NotFound(t *testing.T) {
	store := newMemStore()
	req := httptest.NewRequest(http.MethodGet, "/agents/did:mesh:agent:nonexistent", nil)
	req.SetPathValue("id", "did:mesh:agent:nonexistent")
	rec := httptest.NewRecorder()
	srv := NewServer(store)
	srv.Get(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("Get nonexistent: got status %d, want %d", rec.Code, http.StatusNotFound)
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "agent not found" {
		t.Errorf("Get not found body: got %v", body)
	}
}

func TestServer_Get_Found(t *testing.T) {
	store := newMemStore()
	card := validCard("did:mesh:agent:found")
	_ = store.Upsert(context.Background(), &card, "active")
	srv := NewServer(store)
	req := httptest.NewRequest(http.MethodGet, "/agents/did:mesh:agent:found", nil)
	req.SetPathValue("id", "did:mesh:agent:found")
	rec := httptest.NewRecorder()
	srv.Get(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("Get found: got status %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestServer_List_ReturnsAgents(t *testing.T) {
	store := newMemStore()
	card := validCard("did:mesh:agent:list-1")
	_ = store.Upsert(context.Background(), &card, "active")
	srv := NewServer(store)
	req := httptest.NewRequest(http.MethodGet, "/agents?domain=test", nil)
	rec := httptest.NewRecorder()
	srv.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("List: got status %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestServer_Health(t *testing.T) {
	srv := NewServer(newMemStore())
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	srv.Health(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("Health: got status %d, want %d", rec.Code, http.StatusOK)
	}
}
