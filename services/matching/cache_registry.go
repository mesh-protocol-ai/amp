package main

import (
    "context"
    "log"
    "strings"
    "sync"
    "time"

    "github.com/mesh-protocol-ai/amp/pkg/agentcard"
)

type cacheEntry struct {
    candidates []*agentcard.Card
    updated    time.Time
}

// MatchCache holds cached candidate lists keyed by domain+capability.
type MatchCache struct {
    mu      sync.RWMutex
    entries map[string]*cacheEntry
    ttl     time.Duration
}

func NewMatchCache(ttl time.Duration) *MatchCache {
    return &MatchCache{entries: make(map[string]*cacheEntry), ttl: ttl}
}

func cacheKey(domain []string, capabilityID string) string {
    return strings.Join(domain, ".") + "|" + capabilityID
}

// Get returns candidates when present and fresh.
func (mc *MatchCache) Get(domain []string, capabilityID string) ([]*agentcard.Card, bool) {
    k := cacheKey(domain, capabilityID)
    mc.mu.RLock()
    e, ok := mc.entries[k]
    mc.mu.RUnlock()
    if !ok {
        return nil, false
    }
    if time.Since(e.updated) > mc.ttl {
        return nil, false
    }
    return e.candidates, true
}

// GetStale returns candidates even if expired (used as fallback when registry calls fail).
func (mc *MatchCache) GetStale(domain []string, capabilityID string) ([]*agentcard.Card, bool) {
    k := cacheKey(domain, capabilityID)
    mc.mu.RLock()
    e, ok := mc.entries[k]
    mc.mu.RUnlock()
    if !ok {
        return nil, false
    }
    return e.candidates, true
}

func (mc *MatchCache) Set(domain []string, capabilityID string, candidates []*agentcard.Card) {
    k := cacheKey(domain, capabilityID)
    mc.mu.Lock()
    mc.entries[k] = &cacheEntry{candidates: candidates, updated: time.Now().UTC()}
    mc.mu.Unlock()
}

// CachingRegistry wraps a RegistryLister and serves cached responses, falling back to registry.
type CachingRegistry struct {
    underlying     RegistryLister
    cache          *MatchCache
    refreshSeconds time.Duration
}

func NewCachingRegistry(l RegistryLister, cacheTTL time.Duration, refreshInterval time.Duration) *CachingRegistry {
    return &CachingRegistry{underlying: l, cache: NewMatchCache(cacheTTL), refreshSeconds: refreshInterval}
}

func (cr *CachingRegistry) ListCandidates(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error) {
    // Try fresh cache first
    if cands, ok := cr.cache.Get(domain, capabilityID); ok {
        return cands, nil
    }

    // Miss: query registry
    cands, err := cr.underlying.ListCandidates(ctx, domain, capabilityID)
    if err != nil {
        // try stale cache as fallback
        if stale, ok := cr.cache.GetStale(domain, capabilityID); ok {
            log.Printf("registry error, returning stale cache for domain=%v capability=%s: %v", domain, capabilityID, err)
            return stale, nil
        }
        return nil, err
    }
    cr.cache.Set(domain, capabilityID, cands)
    return cands, nil
}
