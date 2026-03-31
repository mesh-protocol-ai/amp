package main

import (
	"context"
	"math"

	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
)

// SemanticScorer scores candidates by semantic similarity to a request description.
// Implementations may use TF-IDF, external embeddings (OpenRouter/OpenAI), or local models.
type SemanticScorer interface {
	Score(ctx context.Context, requestDescription string, candidates []*agentcard.Card) ([]ScoredCandidate, error)
}

// ScoredCandidate holds a candidate card with its semantic similarity score.
type ScoredCandidate struct {
	Card          *agentcard.Card
	SemanticScore float64 // 0.0 to 1.0
	MatchedCapID  string  // which capability description matched best
}

// CosineSimilarity computes the cosine similarity between two float64 vectors.
// Returns 0.0 if either vector has zero magnitude.
func CosineSimilarity(a, b []float64) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0.0
	}
	var dot, magA, magB float64
	for i := range a {
		dot += a[i] * b[i]
		magA += a[i] * a[i]
		magB += b[i] * b[i]
	}
	if magA == 0 || magB == 0 {
		return 0.0
	}
	return dot / (math.Sqrt(magA) * math.Sqrt(magB))
}

// CosineSimilarityF32 computes cosine similarity between two float32 vectors.
// Used by embedding-based scorers that work with float32 vectors from APIs.
func CosineSimilarityF32(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0.0
	}
	var dot, magA, magB float64
	for i := range a {
		ai, bi := float64(a[i]), float64(b[i])
		dot += ai * bi
		magA += ai * ai
		magB += bi * bi
	}
	if magA == 0 || magB == 0 {
		return 0.0
	}
	return dot / (math.Sqrt(magA) * math.Sqrt(magB))
}
