# Control Plane Evolution Plan

This document captures the recommended production evolution path for AMP's control plane based on the current implementation in this repository.

It is intentionally pragmatic: preserve the working MVP, fix the main scalability and routing gaps first, then add presence, durability, and stronger operational guarantees in phases.

## Goals

- Keep the current AMP request-to-match flow working while improving production readiness.
- Preserve the Registry as the source of truth for capabilities and policy.
- Use NATS as the control-plane transport for requests, routing, presence, and session signaling.
- Avoid a premature migration to direct peer-to-peer data-plane routing for all traffic.
- Align implementation, SDK behavior, deployment guidance, and protocol documentation.

## Current State

The current repository implements the following flow:

1. Providers register Agent Cards in the Registry over HTTP.
2. Consumers publish `amp.capability.request` events to `mesh.requests.{domain}.{region}`.
3. The matching service subscribes to `mesh.requests.>`.
4. Matching queries the Registry by domain and capability.
5. Matching publishes `amp.capability.match` or `amp.capability.reject` to `mesh.matches`.
6. Consumers and providers filter messages by correlation ID and payload.
7. After a match, the consumer connects to the provider's gRPC endpoint using the issued session token.

This is a valid MVP. The main issues are operational, not conceptual.

## Key Gaps

### 1. Shared `mesh.matches` subject

Today the return path uses a shared subject. That creates unnecessary fan-out, forces SDK-side filtering, and becomes noisy as traffic grows.

### 2. Registry is authoritative but not availability-aware

The Registry knows what an agent can do, but the matching engine does not yet have a native presence layer to know whether the provider is currently alive.

### 3. Spec and implementation are slightly ahead/behind each other

The protocol spec already describes a richer NATS hierarchy, including directed match subjects and heartbeat-related subjects, while the implementation still uses the MVP flow.

### 4. No explicit migration path is documented

The repo documents the current flow and the target architecture in separate places, but does not yet document the staged path between them.

## Architecture Decision

The recommended production model is:

- Registry = authoritative catalog for identity, capabilities, endpoint metadata, and policy.
- NATS = control-plane transport for requests, matches, presence, and session signaling.
- Matching = orchestrator that combines Registry truth with NATS-delivered activity state.
- gRPC = data plane used after a successful match.

This keeps the current design intact while solving the routing and liveliness problems without introducing unnecessary complexity.

## Non-Goals

These items are explicitly out of scope for the next implementation cycle:

- Replacing the Registry with NATS-only discovery.
- Making direct peer-to-peer transport the default path for all production traffic.
- Routing all agent traffic through a central application backend relay.
- Rewriting the protocol spec around a new transport model.

## Recommended Phases

## Phase 0: Freeze and Document the Current Contract

Objective: make the current behavior explicit before evolving it.

Changes:

- Document the current request and match flow as implemented.
- Mark what is implemented now versus planned in the future.
- Record the current NATS subject usage and the intended target subject model.

Why first:

- Prevent drift between code, SDK behavior, deployment docs, and protocol text.
- Make subsequent pull requests easier to review.

Deliverables:

- This document.
- An implementation checklist.
- Links from README and existing docs.

## Phase 1: Directed Match Subjects

Objective: eliminate the shared match response path.

Changes:

- Matching publishes matches to `mesh.matches.{consumer_id}`.
- Optionally publish the provider notification to `mesh.matches.{provider_id}` as a second directed event.
- SDK consumers subscribe only to their own subject.
- SDK providers subscribe only to their own subject.
- Keep temporary compatibility with `mesh.matches` only during rollout.

Benefits:

- Lower fan-out.
- Cleaner SDK logic.
- Better isolation between tenants and agents.
- Easier NATS authorization by subject.

Required code areas:

- `services/matching/main.go`
- `sdk/ts/src/client.ts`
- tests under `pkg/nats/` and SDK integration coverage

## Phase 2: Presence and Heartbeats

Objective: make matching availability-aware.

Changes:

- Providers publish `amp.agent.register` for audit or secondary indexing.
- Providers publish `amp.agent.heartbeat` periodically.
- Providers publish `amp.agent.deregister` on shutdown when possible.
- Matching keeps a live in-memory presence cache with TTL.
- Matching selects only agents that are both registered and currently alive.

Recommended subject model:

- `mesh.agents.register`
- `mesh.agents.heartbeat.{agent_id}`
- `mesh.agents.deregister`

Benefits:

- Matching stops selecting stale providers.
- Presence is decoupled from catalog metadata.
- Availability becomes visible without querying the Registry on every decision.

Important constraint:

- The Registry remains authoritative for capabilities and policy.
- Heartbeats augment availability, but do not replace registration.

## Phase 3: Matching Cache and Fallback Strategy

Objective: reduce latency and preserve correctness.

Changes:

- Matching preloads or incrementally caches Registry-backed candidates.
- Heartbeat TTL controls whether a candidate is eligible.
- Registry remains the fallback when cache is cold or stale.
- Matching logs why a candidate was excluded: missing capability, wrong domain, no heartbeat, status not active, policy mismatch.

Benefits:

- Lower latency under load.
- Better debuggability.
- Safer rollout because the Registry stays as fallback.

## Phase 4: Request-Reply and Reply Subjects

Objective: improve request correlation and reduce shared subscription patterns.

Changes:

- Consumers publish requests with a NATS reply subject or inbox.
- Matching responds directly to the reply subject.
- Directed `mesh.matches.{agent_id}` can remain for provider-side notification and audit compatibility.

Benefits:

- More idiomatic NATS flow.
- Fewer global subscriptions.
- Clear request ownership.

Why not first:

- It changes the SDK contract more than Phase 1.
- Directed match subjects solve the largest immediate problem with lower rollout risk.

## Phase 5: JetStream for Audit and Durable Workflows

Objective: add durability only where it pays off.

Recommended durable streams:

- Agent lifecycle audit events.
- Match and reject audit events.
- Task lifecycle events.
- Settlement events.

Do not default everything to JetStream:

- High-frequency heartbeats usually do not need persistence.
- Low-latency request-reply flows do not automatically benefit from durability.

## Phase 6: Production Security Hardening

Objective: make the transport safe for public or semi-public production use.

Required controls:

- TLS on NATS.
- Short-lived credentials or NATS JWT/NKey.
- Subject-scoped ACLs.
- Authenticated Registry writes.
- Authenticated agent heartbeat and registration flows.
- Short TTL session tokens for the data plane.
- Metrics and alerting around matching, Registry latency, and NATS reconnect behavior.

## Target Subject Model

Recommended near-term subject model:

```text
mesh.
├── agents.
│   ├── register
│   ├── heartbeat.{agent_id}
│   └── deregister
├── requests.
│   └── {domain_l1}.{domain_l2}.{region}
├── matches.
│   ├── {consumer_id}
│   └── {provider_id}
├── tasks.
│   └── {session_id}.*
└── settlement.
    └── {session_id}.*
```

Current implementation note:

- `mesh.requests.{domain}.{region}` is already used.
- `mesh.matches` is still global and should be treated as a compatibility path during migration.

## Rollout Strategy

### Step 1

- Introduce directed match subjects in matching.
- Keep publishing to `mesh.matches` temporarily.

### Step 2

- Update SDK consumers/providers to use directed subjects.
- Release SDK and example updates.

### Step 3

- Add provider heartbeats and matching-side TTL cache.

### Step 4

- Observe production traffic and remove dependence on `mesh.matches` global.

### Step 5

- Introduce reply-subject support when the SDK and matching contracts are stable.

## Acceptance Criteria by Milestone

### Directed routing complete

- Consumers do not subscribe to the shared `mesh.matches` subject.
- Providers do not subscribe to the shared `mesh.matches` subject.
- Matching can route responses directly by DID.

### Presence complete

- Matching excludes providers without recent heartbeat.
- Registry still returns provider metadata and capability truth.
- Heartbeat TTL is documented and observable.

### Production-ready control plane

- TLS and NATS auth are mandatory.
- Subject permissions are documented and enforced.
- Deployment docs cover matching, Registry, NATS, and provider requirements.

## Documentation to Keep in Sync

The following files should be updated as each phase lands:

- `README.md`
- `SPECS.md`
- `docs/DEPLOY_MATCHING_AWS.md`
- `sdk/ts/docs/API_DESIGN.md`
- example READMEs that show the public-mesh flow

## Recommended Pull Request Sequence

1. Documentation PR: freeze current flow and record the migration plan.
2. Routing PR: directed `mesh.matches.{agent_id}` support in matching and SDK.
3. Presence PR: heartbeat publishing and matching cache with TTL.
4. Deployment PR: NATS auth/TLS docs, ACL examples, updated AWS deployment guide.
5. Reliability PR: JetStream-backed audit streams and operational metrics.

## Summary

The existing AMP architecture is on the right track. The correct next move is not a redesign; it is to evolve the current control plane in a staged way:

- Registry answers who can do the work.
- Heartbeat answers who is alive.
- Matching answers who was selected.
- gRPC handles the data plane after the match.

That path keeps the system understandable, deployable, and compatible with how the repository works today.