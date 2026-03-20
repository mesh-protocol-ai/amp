# Control Plane Implementation Checklist

This checklist breaks the control-plane evolution into reviewable implementation slices.

## Phase 0: Documentation Baseline

- [ ] Document the current request-to-match flow as implemented today.
- [ ] Document the current NATS subjects and the target subject hierarchy.
- [ ] Mark current versus planned behavior in `SPECS.md`.
- [ ] Link the plan from `README.md`, deployment docs, and SDK docs.

## Phase 1: Directed Match Routing

- [ ] Update matching to publish to `mesh.matches.{consumer_id}`.
- [ ] Decide whether provider notifications also use `mesh.matches.{provider_id}`.
- [ ] Keep temporary compatibility publishing to legacy `mesh.matches`.
- [ ] Update the TypeScript SDK consumer flow to subscribe only to the caller DID subject.
- [ ] Update the TypeScript SDK provider flow to subscribe only to the provider DID subject.
- [ ] Add tests for match routing by DID.
- [ ] Add rollout notes for removing legacy `mesh.matches`.

## Phase 2: Presence and Heartbeats

- [ ] Define the heartbeat payload contract.
- [ ] Define heartbeat TTL and expiration behavior.
- [ ] Publish `amp.agent.register` for audit or warm-cache workflows.
- [ ] Publish `amp.agent.heartbeat` from providers.
- [ ] Publish `amp.agent.deregister` on graceful shutdown.
- [ ] Add an in-memory presence cache to matching.
- [ ] Exclude stale providers from candidate selection.
- [ ] Add metrics for live providers and expired heartbeats.

## Phase 3: Registry and Matching Coordination

- [ ] Keep Registry as source of truth for capability and policy.
- [ ] Make matching use Registry plus presence cache.
- [ ] Add explicit logging for candidate exclusion reasons.
- [ ] Add fallback behavior when the cache is cold.
- [ ] Add tests for: active in Registry but no heartbeat, heartbeat but no Registry record, and inactive status.

## Phase 4: Request-Reply Evolution

- [ ] Decide whether to keep directed match subjects as audit/provider channels after inbox support.
- [ ] Add NATS reply-subject support to the consumer SDK.
- [ ] Update matching to respond to reply subjects.
- [ ] Add tests for inbox timeout, reject path, and successful reply path.
- [ ] Document compatibility with the previous subscription model.

## Phase 5: Durability and Audit

- [ ] Define which events must be durable.
- [ ] Create JetStream stream names and retention policy.
- [ ] Add durable consumers where replay matters.
- [ ] Keep heartbeats ephemeral unless a strong use case appears.
- [ ] Document audit retrieval and replay expectations.

## Phase 6: Security and Operations

- [ ] Require TLS for production NATS connections.
- [ ] Define NATS auth model: token, JWT/NKey, or both.
- [ ] Define subject ACLs for consumers, providers, and matching.
- [ ] Require authenticated Registry writes in all public deployments.
- [ ] Define session token TTL and validation rules.
- [ ] Add dashboards for matching latency, Registry lookup latency, and NATS reconnects.
- [ ] Add alerts for matching not subscribed, Registry unavailable, and heartbeat expiry anomalies.

## Documentation Checklist

- [ ] `README.md` links to the control-plane plan.
- [ ] `docs/DEPLOY_MATCHING_AWS.md` describes the phased production model.
- [ ] `sdk/ts/docs/API_DESIGN.md` documents current and target routing behavior.
- [ ] `SPECS.md` differentiates implemented behavior from target hierarchy.
- [ ] Example READMEs reflect the routing model in use.

## Rollout Checklist

- [ ] Deploy matching with dual publish support.
- [ ] Release SDK with directed subject support.
- [ ] Migrate consumers to directed subjects.
- [ ] Migrate providers to directed subjects.
- [ ] Confirm no production consumers depend on global `mesh.matches`.
- [ ] Enable heartbeat processing in matching.
- [ ] Confirm stale agents stop receiving matches.
- [ ] Remove legacy routing path only after observability confirms safety.

## Review Gates

- [ ] Product review: contract and migration path are understandable.
- [ ] Platform review: NATS topology and auth model are acceptable.
- [ ] Security review: subject permissions and session token model are acceptable.
- [ ] SDK review: migration preserves a stable developer experience.
- [ ] Operations review: alerting and dashboards are sufficient for production rollout.