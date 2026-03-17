-- AMP Registry - agent_cards (Phase 1)
CREATE TABLE IF NOT EXISTS agent_cards (
    id          TEXT PRIMARY KEY,  -- DID, e.g. did:mesh:agent:foo
    version     TEXT NOT NULL,
    card        JSONB NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'pending', 'active', 'suspended', 'deprecated', 'retired', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_cards_status ON agent_cards(status);
CREATE INDEX IF NOT EXISTS idx_agent_cards_domain ON agent_cards USING GIN ((card->'spec'->'domains'->'primary'));
CREATE INDEX IF NOT EXISTS idx_agent_cards_capabilities ON agent_cards USING GIN ((card->'spec'->'capabilities'));
