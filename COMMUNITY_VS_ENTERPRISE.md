# Community vs Enterprise

This document defines the boundary between the **open source (Community)** edition and the **Enterprise** edition of AMP.

## Community Objective

Deliver a functional and auditable core for development, POCs and basic self-hosted use, without promises of enterprise operation.

## Feature matrix

| Area | Community (open source) | Enterprise (commercial) |
|---|---|---|
| Protocol and schemas | `SPECS.md`, `proto/`, `schemas/` | Compatibility + enterprise extensions |
| Control Plane | NATS/JetStream base, local setup | Managed operation, HA, tuning, hardening |
| Registry | CRUD of Agent Cards, basic filters | Robust multi-tenant, strong insulation, quotas |
| Matching | Filter/select MVP (domain/capability/latency) | Advanced matching by cost, trust, SLA, reputation |
| SDK | Base SDK (`register`, `request`, `listen`) | Enterprise SDK with enterprise auth and native observability |
| AuthN/AuthZ | Basic for controlled environment | SSO (OIDC/SAML), RBAC/ABAC, policy engine |
| Observability | Logs and basic metrics | Dashboards, distributed tracing, alerts and SLOs |
| Security | Good baseline practices | KMS/HSM, key rotation, immutable trail, private networking |
| Compliance | Out of scope for Community | Corporate requirements (auditability and governance) |
| Operation | No SLA, best effort | Contractual SLA, support, runbooks, DR and backup |
| Support | Community (issues/discussions) | Dedicated support and agreed response times |

## Explicit limits of the Community edition

- No availability/performance SLA.
- No secure multi-tenant guarantee for regulated environments.
- No advanced compliance and corporate audit resources.
- No official support with guaranteed response time.
- Scalability and tuning on a best effort basis.

## Distribution policy

- Everything that defines protocol interoperability remains open.
- Everything that combines enterprise operations, corporate security and commercial support can be closed.
- Community remains usable end-to-end for unregulated cases and development/prototype environments.

## Contribution criteria to keep in OSS

A feature tends to stay in the Community when:
1. Increases protocol interoperability.
2. Improves DX (developer experience) without creating commercial dependence.
3. Does not require business operation/support to be sustainable.

## What will not be promised in OSS

- "Ready for any enterprise production" without additional layers.
- Legal guarantees/compliance without dedicated controls.
- High scale without tuning and operation architecture.
