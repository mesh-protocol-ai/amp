package main

import (
	"context"
	"log"

	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
)

// EmbeddingScorer implements SemanticScorer using vector embeddings from an EmbeddingProvider.
// Embeddings for capability descriptions are cached; only the request embedding is computed per-request.
// Works with any OpenAI-compatible provider (OpenRouter, OpenAI, local endpoints).
type EmbeddingScorer struct {
	provider  EmbeddingProvider
	cache     *EmbeddingCache
	threshold float64
}

// NewEmbeddingScorer creates a scorer backed by an embedding provider and cache.
// threshold is the minimum cosine similarity [0.0, 1.0] to consider a match.
func NewEmbeddingScorer(provider EmbeddingProvider, cache *EmbeddingCache, threshold float64) *EmbeddingScorer {
	return &EmbeddingScorer{
		provider:  provider,
		cache:     cache,
		threshold: threshold,
	}
}

// Score computes embedding-based cosine similarity between the request description
// and each candidate's capability descriptions. Uses cache for capability embeddings
// and only calls the embedding provider for cache misses + the request itself.
func (s *EmbeddingScorer) Score(ctx context.Context, requestDescription string, candidates []*agentcard.Card) ([]ScoredCandidate, error) {
	if requestDescription == "" || len(candidates) == 0 {
		return nil, nil
	}

	// Collect capability descriptions that need embeddings
	type capRef struct {
		card        *agentcard.Card
		capID       string
		description string
		cached      bool
		vector      []float32
	}

	var refs []capRef
	var uncachedTexts []string
	var uncachedIndices []int

	for _, card := range candidates {
		for _, cap := range card.Spec.Capabilities {
			if cap.Description == "" {
				continue
			}
			ref := capRef{
				card:        card,
				capID:       cap.ID,
				description: cap.Description,
			}

			// Check cache first
			if vec, ok := s.cache.Get(card.Metadata.ID, cap.ID, cap.Description); ok {
				ref.cached = true
				ref.vector = vec
			} else {
				uncachedIndices = append(uncachedIndices, len(refs))
				uncachedTexts = append(uncachedTexts, cap.Description)
			}
			refs = append(refs, ref)
		}
	}

	if len(refs) == 0 {
		return nil, nil
	}

	// Build batch: request description + all uncached capability descriptions
	var batchTexts []string
	batchTexts = append(batchTexts, requestDescription)
	batchTexts = append(batchTexts, uncachedTexts...)

	embeddings, err := s.provider.Embed(ctx, batchTexts)
	if err != nil {
		log.Printf("embedding provider error: %v", err)
		return nil, err
	}

	if len(embeddings) != len(batchTexts) {
		log.Printf("embedding count mismatch: got %d, expected %d", len(embeddings), len(batchTexts))
		return nil, nil
	}

	// First embedding is the request
	requestVec := embeddings[0]

	// Cache and assign uncached capability embeddings
	for i, idx := range uncachedIndices {
		vec := embeddings[1+i] // offset by 1 for the request embedding
		refs[idx].vector = vec
		s.cache.Set(refs[idx].card.Metadata.ID, refs[idx].capID, refs[idx].description, vec)
	}

	// Compute cosine similarity for each capability and keep best per card
	bestPerCard := make(map[string]ScoredCandidate)
	for _, ref := range refs {
		if ref.vector == nil {
			continue
		}
		score := CosineSimilarityF32(requestVec, ref.vector)
		if score < s.threshold {
			continue
		}

		cardID := ref.card.Metadata.ID
		if existing, ok := bestPerCard[cardID]; !ok || score > existing.SemanticScore {
			bestPerCard[cardID] = ScoredCandidate{
				Card:          ref.card,
				SemanticScore: score,
				MatchedCapID:  ref.capID,
			}
		}
	}

	result := make([]ScoredCandidate, 0, len(bestPerCard))
	for _, sc := range bestPerCard {
		result = append(result, sc)
	}
	return result, nil
}
