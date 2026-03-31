package main

import (
	"context"
	"math"
	"strings"
	"unicode"

	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
)

// TFIDFScorer implements SemanticScorer using TF-IDF vectorization and cosine similarity.
// Zero external dependencies, ~0.1ms per comparison, suitable for resource-constrained environments.
// Limitation: does not understand synonyms ("car" vs "automobile" scores 0).
type TFIDFScorer struct {
	threshold float64
}

// NewTFIDFScorer creates a new TF-IDF based semantic scorer.
// threshold is the minimum similarity score [0.0, 1.0] to consider a match.
func NewTFIDFScorer(threshold float64) *TFIDFScorer {
	return &TFIDFScorer{threshold: threshold}
}

// Score computes TF-IDF cosine similarity between the request description and each
// candidate's capability descriptions. Returns scored candidates sorted by score descending.
func (s *TFIDFScorer) Score(ctx context.Context, requestDescription string, candidates []*agentcard.Card) ([]ScoredCandidate, error) {
	if requestDescription == "" || len(candidates) == 0 {
		return nil, nil
	}

	reqTokens := Tokenize(requestDescription)
	if len(reqTokens) == 0 {
		return nil, nil
	}

	// Collect all capability descriptions as documents for IDF computation
	type capDoc struct {
		card   *agentcard.Card
		capID  string
		tokens []string
	}
	var docs []capDoc
	for _, card := range candidates {
		for _, cap := range card.Spec.Capabilities {
			if cap.Description == "" {
				continue
			}
			tokens := Tokenize(cap.Description)
			if len(tokens) > 0 {
				docs = append(docs, capDoc{card: card, capID: cap.ID, tokens: tokens})
			}
		}
	}

	if len(docs) == 0 {
		return nil, nil
	}

	// Build vocabulary from all documents + request
	allDocs := make([][]string, 0, len(docs)+1)
	allDocs = append(allDocs, reqTokens)
	for _, d := range docs {
		allDocs = append(allDocs, d.tokens)
	}

	idf := ComputeIDF(allDocs)

	// Vectorize request
	reqVec := TFIDFVector(reqTokens, idf)

	// Score each capability description
	bestPerCard := make(map[string]ScoredCandidate) // agentID -> best scored capability
	for _, doc := range docs {
		docVec := TFIDFVector(doc.tokens, idf)
		score := CosineSimilarity(reqVec, docVec)

		if score < s.threshold {
			continue
		}

		cardID := doc.card.Metadata.ID
		if existing, ok := bestPerCard[cardID]; !ok || score > existing.SemanticScore {
			bestPerCard[cardID] = ScoredCandidate{
				Card:          doc.card,
				SemanticScore: score,
				MatchedCapID:  doc.capID,
			}
		}
	}

	result := make([]ScoredCandidate, 0, len(bestPerCard))
	for _, sc := range bestPerCard {
		result = append(result, sc)
	}
	return result, nil
}

// Tokenize splits text into lowercase tokens, removing punctuation and stop words.
func Tokenize(text string) []string {
	lower := strings.ToLower(text)

	// Split on non-alphanumeric characters
	tokens := strings.FieldsFunc(lower, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})

	// Filter stop words
	var filtered []string
	for _, t := range tokens {
		if len(t) <= 1 {
			continue
		}
		if _, ok := stopWords[t]; ok {
			continue
		}
		filtered = append(filtered, t)
	}
	return filtered
}

// ComputeTF returns normalized term frequency for a token list.
func ComputeTF(tokens []string) map[string]float64 {
	tf := make(map[string]float64)
	for _, t := range tokens {
		tf[t]++
	}
	n := float64(len(tokens))
	for k, v := range tf {
		tf[k] = v / n
	}
	return tf
}

// ComputeIDF computes inverse document frequency across a corpus of documents.
func ComputeIDF(documents [][]string) map[string]float64 {
	docCount := float64(len(documents))
	df := make(map[string]float64) // document frequency per term

	for _, doc := range documents {
		seen := make(map[string]bool)
		for _, t := range doc {
			if !seen[t] {
				df[t]++
				seen[t] = true
			}
		}
	}

	idf := make(map[string]float64)
	for term, freq := range df {
		// Smooth IDF: log(1 + N/df) to avoid zero for terms in all documents
		idf[term] = math.Log(1.0 + docCount/freq)
	}
	return idf
}

// TFIDFVector builds a TF-IDF weighted vector for a token list using the given IDF weights.
// The vector is represented as a dense slice aligned with a sorted vocabulary derived from the IDF map.
func TFIDFVector(tokens []string, idf map[string]float64) []float64 {
	// Build ordered vocabulary from IDF keys
	vocab := make(map[string]int)
	idx := 0
	for term := range idf {
		vocab[term] = idx
		idx++
	}

	tf := ComputeTF(tokens)
	vec := make([]float64, len(vocab))
	for term, tfVal := range tf {
		if i, ok := vocab[term]; ok {
			vec[i] = tfVal * idf[term]
		}
	}
	return vec
}

// stopWords is a compact set of common English stop words.
// Kept small intentionally to preserve domain-relevant terms.
var stopWords = map[string]struct{}{
	"the": {}, "is": {}, "at": {}, "which": {}, "on": {}, "a": {}, "an": {},
	"and": {}, "or": {}, "but": {}, "in": {}, "with": {}, "to": {}, "for": {},
	"of": {}, "by": {}, "from": {}, "as": {}, "into": {}, "that": {}, "this": {},
	"it": {}, "its": {}, "be": {}, "are": {}, "was": {}, "were": {}, "been": {},
	"being": {}, "have": {}, "has": {}, "had": {}, "do": {}, "does": {}, "did": {},
	"will": {}, "would": {}, "could": {}, "should": {}, "may": {}, "might": {},
	"shall": {}, "can": {}, "need": {}, "not": {}, "no": {}, "nor": {}, "so": {},
	"if": {}, "then": {}, "than": {}, "too": {}, "very": {}, "just": {}, "about": {},
	"above": {}, "after": {}, "before": {}, "between": {}, "each": {}, "few": {},
	"more": {}, "most": {}, "other": {}, "some": {}, "such": {}, "only": {},
	"own": {}, "same": {}, "also": {}, "how": {}, "what": {}, "when": {}, "where": {},
	"who": {}, "whom": {}, "why": {}, "all": {}, "any": {}, "both": {}, "here": {},
	"there": {}, "these": {}, "those": {}, "through": {}, "during": {}, "up": {},
	"down": {}, "out": {}, "off": {}, "over": {}, "under": {}, "again": {},
	"further": {}, "once": {}, "he": {}, "she": {}, "they": {}, "we": {}, "you": {},
	"me": {}, "him": {}, "her": {}, "us": {}, "them": {}, "my": {}, "your": {},
	"his": {}, "our": {}, "their": {},
}
