# Control Plane Gaps (MVP)

This note re-checks the current implementation against [CONTROL_PLANE_CHECKLIST.md](./CONTROL_PLANE_CHECKLIST.md) using a pragmatic MVP rule:

- if it is already implemented and registered somewhere in the repo, count it as covered
- if it works in code but is not clearly recorded, count it as a documentation gap
- if it is clearly a later-phase concern, keep it open without blocking MVP

## Snapshot

### Covered enough for current MVP

- `README.md` already links the control-plane plan and rollout checklist.
- `docs/CONTROL_PLANE_EVOLUTION.md` and `docs/CONTROL_PLANE_CHECKLIST.md` exist and capture the phased plan.
- Matching now publishes to directed subjects and keeps legacy `mesh.matches` for compatibility.
- The TypeScript SDK already has directed-subject support and request-reply support.
- Matching already responds to reply subjects.
- Matching already has an in-memory presence cache and a registry-backed cache.
- There are tests for directed match publishing and the successful reply-subject path.

### Closed in this documentation pass

- `SPECS.md` now marks the current MVP behavior separately from the target hierarchy.
- `docs/DEPLOY_MATCHING_AWS.md` now describes the active reply-subject plus directed-subject behavior.
- `sdk/ts/docs/API_DESIGN.md` now documents request-reply, directed routing, and provider heartbeat.
- The current heartbeat contract is now documented.
- The reference public example README now reflects the routing model in use.

### Still open as real gaps

- Provider lifecycle events (`amp.agent.register`, `amp.agent.deregister`) are still planned, not implemented as part of the current MVP flow.
- Example providers still do not start heartbeat automatically in code.
- The rollout note for removing legacy `mesh.matches` is still missing.
- Presence edge cases and request-reply failure cases still lack explicit tests.
- There is still no recorded migration evidence showing that all consumers/providers stopped depending on global `mesh.matches`.
- Reject reasons are still free-form strings in the current implementation; when stricter SDK behavior matters, this should become a stable code contract.

### Not a blocker for MVP right now

- Phase 5 durability and audit stream design.
- Phase 6 production hardening items like TLS enforcement, ACLs, dashboards, and alerts.

These remain valid roadmap items, but they do not need to be treated as blockers for the current MVP slice.

## Checklist Review

## Phase 0: Documentation Baseline

- Covered: current flow and target direction are described in [CONTROL_PLANE_EVOLUTION.md](./CONTROL_PLANE_EVOLUTION.md).
- Covered: `README.md`, deployment docs, and SDK docs link to the plan.
- Covered: `SPECS.md` now marks current versus planned behavior.

Status: covered enough for MVP

## Phase 1: Directed Match Routing

- Covered: matching publishes to `mesh.matches.{consumer_id}`.
- Covered: matching also publishes to `mesh.matches.{provider_id}`.
- Covered: legacy `mesh.matches` publishing remains in place.
- Covered in code: SDK supports directed routing.
- Covered in tests: matching has tests for directed publish.
- Gap: rollout notes for fully removing legacy `mesh.matches` are still missing.

Status: mostly covered

## Phase 2: Presence and Heartbeats

- Covered in code: in-memory presence cache exists.
- Covered in code: stale providers are filtered out.
- Covered in code: TTL exists through `HEARTBEAT_TTL_SECONDS`.
- Covered: heartbeat payload contract is now documented.
- Covered: docs now note that providers must call heartbeat explicitly today.
- Gap: `amp.agent.register` and `amp.agent.deregister` are still not implemented as part of the current flow.
- Gap: metrics for live providers and expired heartbeats do not appear to be registered.

Status: partial

## Phase 3: Registry and Matching Coordination

- Covered: Registry remains the source of truth for candidate lookup.
- Covered: matching uses Registry plus presence cache.
- Covered: candidate exclusion logging was added.
- Covered enough for MVP: stale cache fallback exists in code.
- Gap: tests for `no heartbeat`, `heartbeat but no Registry record`, and `inactive status` are still missing.

Status: mostly covered

## Phase 4: Request-Reply Evolution

- Covered: consumer SDK uses request-reply.
- Covered: matching responds to reply subjects.
- Covered in tests: successful reply-subject path exists.
- Gap: timeout path and reject path are not explicitly covered by tests.
- Covered: compatibility with the previous subscription model is now documented in deploy and SDK docs.
- Gap: there is still no explicit decision note saying whether directed subjects remain only for rollout or stay permanently for provider/audit use.

Status: partial

## Phase 5: Durability and Audit

- No strong evidence of completion for the checklist items in this phase.
- This is acceptable for MVP and should stay as roadmap work.

Status: intentionally open

## Phase 6: Security and Operations

- No strong evidence of completion for the checklist items in this phase beyond basic token handling already present in the repo.
- This is acceptable for MVP and should stay as roadmap work.

Status: intentionally open

## Documentation Checklist Review

- Covered: `README.md` links to the control-plane plan.
- Covered: `docs/DEPLOY_MATCHING_AWS.md` links to the phased model.
- Covered: `sdk/ts/docs/API_DESIGN.md` now describes the current routing behavior.
- Covered: `SPECS.md` now differentiates current behavior from target hierarchy.
- Partial: the public reference example is aligned, but provider code still does not auto-start heartbeat.

Status: partial

## Rollout Checklist Review

- Covered: matching has dual publish support.
- Covered: SDK has directed subject support and the docs now present the migration clearly.
- Gap: no recorded evidence that consumers were migrated.
- Gap: no recorded evidence that providers were migrated.
- Gap: no recorded evidence that production no longer depends on global `mesh.matches`.
- Covered in code: heartbeat processing exists in matching.
- Gap: there is not enough test or rollout evidence yet to claim stale agents reliably stop receiving matches in all edge cases.
- Gap: no explicit removal criteria for the legacy routing path are documented.

Status: partial

## MVP Recommendation

For the current MVP, the implementation is directionally correct and already covers the important functional pieces:

- directed match routing
- legacy compatibility
- request-reply support
- presence cache
- registry cache

The main remaining work is documentation and a small set of missing validation cases, not a redesign.

If the goal is to keep moving without over-engineering, the practical next step is:

1. add `mesh.startHeartbeat()` to provider examples or make presence filtering explicitly opt-in
2. add the missing failure-path tests for reply timeout, reject reply, and missing heartbeat
3. document the removal rule for legacy `mesh.matches`
4. keep `amp.agent.register` / `amp.agent.deregister` as roadmap unless a real MVP use case appears
5. normalize reject reasons only when a stable SDK contract becomes more important than debug detail

After that, this control-plane slice can be treated as good enough for MVP.