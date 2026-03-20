package main

import (
    "context"
    "sync"
    "time"
)

// PresenceCache stores last-seen timestamps for agents and exposes TTL-based presence checks.
type PresenceCache struct {
    mu       sync.RWMutex
    lastSeen map[string]time.Time
    ttl      time.Duration
}

// NewPresenceCache creates a new PresenceCache with the given TTL.
func NewPresenceCache(ttl time.Duration) *PresenceCache {
    return &PresenceCache{
        lastSeen: make(map[string]time.Time),
        ttl:      ttl,
    }
}

// Update records a heartbeat for the given agent ID.
func (p *PresenceCache) Update(id string, t time.Time) {
    if id == "" {
        return
    }
    p.mu.Lock()
    p.lastSeen[id] = t
    p.mu.Unlock()
}

// IsPresent returns true when the agent has a recent heartbeat within TTL.
func (p *PresenceCache) IsPresent(id string) bool {
    if id == "" {
        return false
    }
    p.mu.RLock()
    ts, ok := p.lastSeen[id]
    p.mu.RUnlock()
    if !ok {
        return false
    }
    return time.Since(ts) <= p.ttl
}

// Prune removes entries older than TTL.
func (p *PresenceCache) Prune() {
    cutoff := time.Now().Add(-p.ttl)
    p.mu.Lock()
    for k, ts := range p.lastSeen {
        if ts.Before(cutoff) {
            delete(p.lastSeen, k)
        }
    }
    p.mu.Unlock()
}

// PruneLoop runs periodic pruning until the context is cancelled.
func (p *PresenceCache) PruneLoop(ctx context.Context, interval time.Duration) {
    ticker := time.NewTicker(interval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            p.Prune()
        }
    }
}
