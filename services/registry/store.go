package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
)

// Store persists Agent Cards in PostgreSQL.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates store with connection string.
func NewStore(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close closes the pool.
func (s *Store) Close() {
	s.pool.Close()
}

// Upsert inserts or updates an Agent Card. id = card.Metadata.ID.
func (s *Store) Upsert(ctx context.Context, card *agentcard.Card, status string) error {
	if status == "" {
		status = "active"
	}
	cardJSON, err := json.Marshal(card)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO agent_cards (id, version, card, status, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (id) DO UPDATE SET
			version = EXCLUDED.version,
			card = EXCLUDED.card,
			status = EXCLUDED.status,
			updated_at = NOW()
	`, card.Metadata.ID, card.Metadata.Version, cardJSON, status)
	return err
}

// Get returns Agent Card by ID (DID).
func (s *Store) Get(ctx context.Context, id string) (*agentcard.Card, string, error) {
	var version, status string
	var cardJSON []byte
	err := s.pool.QueryRow(ctx, `SELECT version, card, status FROM agent_cards WHERE id = $1`, id).Scan(&version, &cardJSON, &status)
	if err != nil {
		return nil, "", err
	}
	var card agentcard.Card
	if err := json.Unmarshal(cardJSON, &card); err != nil {
		return nil, "", err
	}
	return &card, status, nil
}

// ListByDomainCapability returns active cards matching domain and capability (optional filters).
func (s *Store) ListByDomainCapability(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error) {
	// Query by status and JSONB filter. domain and capability are applied in-memory for MVP (simplified).
	rows, err := s.pool.Query(ctx, `SELECT card FROM agent_cards WHERE status = 'active'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*agentcard.Card
	for rows.Next() {
		var cardJSON []byte
		if err := rows.Scan(&cardJSON); err != nil {
			return nil, err
		}
		var card agentcard.Card
		if err := json.Unmarshal(cardJSON, &card); err != nil {
			continue
		}
		if len(domain) > 0 && !card.HasDomain(domain) {
			continue
		}
		if capabilityID != "" && !card.HasCapability(capabilityID) {
			continue
		}
		out = append(out, &card)
	}
	return out, rows.Err()
}

// List returns all cards (optionally filtered by status).
func (s *Store) List(ctx context.Context, statusFilter string) ([]*agentcard.Card, error) {
	q := `SELECT card FROM agent_cards`
	args := []interface{}{}
	if statusFilter != "" {
		q += ` WHERE status = $1`
		args = append(args, statusFilter)
	}
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*agentcard.Card
	for rows.Next() {
		var cardJSON []byte
		if err := rows.Scan(&cardJSON); err != nil {
			return nil, err
		}
		var card agentcard.Card
		if err := json.Unmarshal(cardJSON, &card); err != nil {
			continue
		}
		out = append(out, &card)
	}
	return out, rows.Err()
}

// UpdateStatus updates only card status.
func (s *Store) UpdateStatus(ctx context.Context, id, status string) error {
	_, err := s.pool.Exec(ctx, `UPDATE agent_cards SET status = $1, updated_at = NOW() WHERE id = $2`, status, id)
	return err
}

// Delete removes the card (or marks as retired per policy).
func (s *Store) Delete(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM agent_cards WHERE id = $1`, id)
	return err
}
