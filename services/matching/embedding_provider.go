package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// EmbeddingProvider generates vector embeddings from text.
// Implementations: OpenRouter API, OpenAI API, local models, etc.
type EmbeddingProvider interface {
	// Embed generates embeddings for one or more texts in a single batch call.
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	// Dimensions returns the embedding vector dimensionality.
	Dimensions() int
}

// HTTPEmbeddingProvider calls an OpenAI-compatible embedding API.
// Works with OpenAI, OpenRouter, and any provider that implements POST /v1/embeddings.
type HTTPEmbeddingProvider struct {
	apiURL     string // e.g. "https://openrouter.ai/api/v1/embeddings"
	apiKey     string
	model      string // e.g. "qwen/qwen3-embedding-0.6b" or "text-embedding-3-small"
	dimensions int
	client     *http.Client
}

// NewHTTPEmbeddingProvider creates an embedding provider that calls an OpenAI-compatible API.
func NewHTTPEmbeddingProvider(apiURL, apiKey, model string, dimensions int) *HTTPEmbeddingProvider {
	return &HTTPEmbeddingProvider{
		apiURL:     apiURL,
		apiKey:     apiKey,
		model:      model,
		dimensions: dimensions,
		client:     &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *HTTPEmbeddingProvider) Dimensions() int { return p.dimensions }

// embeddingRequest is the request body for the OpenAI-compatible embedding API.
type embeddingRequest struct {
	Model      string   `json:"model"`
	Input      []string `json:"input"`
	Dimensions int      `json:"dimensions,omitempty"`
}

// embeddingResponse is the response from the OpenAI-compatible embedding API.
type embeddingResponse struct {
	Data  []embeddingData `json:"data"`
	Error *apiError       `json:"error,omitempty"`
}

type embeddingData struct {
	Index     int       `json:"index"`
	Embedding []float32 `json:"embedding"`
}

type apiError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
}

// Embed calls the remote API to generate embeddings for the given texts.
func (p *HTTPEmbeddingProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	reqBody := embeddingRequest{
		Model: p.model,
		Input: texts,
	}
	if p.dimensions > 0 {
		reqBody.Dimensions = p.dimensions
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal embedding request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create embedding request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.apiKey)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embedding API call: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read embedding response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("embedding API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var embResp embeddingResponse
	if err := json.Unmarshal(respBody, &embResp); err != nil {
		return nil, fmt.Errorf("unmarshal embedding response: %w", err)
	}
	if embResp.Error != nil {
		return nil, fmt.Errorf("embedding API error: %s (%s)", embResp.Error.Message, embResp.Error.Type)
	}

	if len(embResp.Data) != len(texts) {
		return nil, fmt.Errorf("embedding count mismatch: got %d, expected %d", len(embResp.Data), len(texts))
	}

	// Sort by index to ensure correct ordering
	result := make([][]float32, len(texts))
	for _, d := range embResp.Data {
		if d.Index < 0 || d.Index >= len(texts) {
			return nil, fmt.Errorf("embedding index out of range: %d", d.Index)
		}
		result[d.Index] = d.Embedding
	}
	return result, nil
}

// EmbeddingCache caches embedding vectors for capability descriptions.
// Keyed by (agentID, capabilityID, descriptionHash) to invalidate on description change.
// Thread-safe. Follows the same pattern as MatchCache in cache_registry.go.
type EmbeddingCache struct {
	mu      sync.RWMutex
	entries map[string]*embeddingEntry
	ttl     time.Duration
}

type embeddingEntry struct {
	vector  []float32
	updated time.Time
}

// NewEmbeddingCache creates an embedding cache with the given TTL.
func NewEmbeddingCache(ttl time.Duration) *EmbeddingCache {
	return &EmbeddingCache{
		entries: make(map[string]*embeddingEntry),
		ttl:     ttl,
	}
}

// embeddingCacheKey builds the cache key incorporating a hash of the description
// so that cache is automatically invalidated when a description changes.
func embeddingCacheKey(agentID, capID, description string) string {
	h := sha256.Sum256([]byte(description))
	return fmt.Sprintf("%s|%s|%x", agentID, capID, h[:8])
}

// Get returns a cached embedding vector if fresh.
func (ec *EmbeddingCache) Get(agentID, capID, description string) ([]float32, bool) {
	key := embeddingCacheKey(agentID, capID, description)
	ec.mu.RLock()
	e, ok := ec.entries[key]
	ec.mu.RUnlock()
	if !ok || time.Since(e.updated) > ec.ttl {
		return nil, false
	}
	return e.vector, true
}

// Set stores an embedding vector in cache.
func (ec *EmbeddingCache) Set(agentID, capID, description string, vector []float32) {
	key := embeddingCacheKey(agentID, capID, description)
	ec.mu.Lock()
	ec.entries[key] = &embeddingEntry{vector: vector, updated: time.Now().UTC()}
	ec.mu.Unlock()
}

// Prune removes expired entries from the cache.
func (ec *EmbeddingCache) Prune() {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	for k, e := range ec.entries {
		if time.Since(e.updated) > ec.ttl {
			delete(ec.entries, k)
		}
	}
}
