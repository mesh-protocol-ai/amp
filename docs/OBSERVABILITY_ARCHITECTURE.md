# Observability Architecture

This document describes how AMP components expose, collect, and centralize data-plane metrics when running in global/regional hosted deployments while keeping a local interface available for on-prem or troubleshooting scenarios.

## Layered separation
1. **Instrumentation layer (SDK):** `createDataPlaneObservability` lives in `@meshprotocol/sdk` and instantiates a Prometheus `Registry` plus counters/histograms for handshake, transfer, latency, and bytes. It is the single source of truth for telemetry emitted by the DataPlaneConsumerClient and DataPlaneServer.
2. **Local collection layer (examples, on-prem agents):** the Prometheus registry can be exported via an HTTP `/metrics` endpoint (see `examples/public-mesh-openai-demo/consumer/index.js`). This remains the fallback path for agents running on-prem or for operators who want a self-hosted scrape target.
3. **Hosted forwarding layer (global/regional deployments):** when an agent is instantiated on the hosted NATS service, the default behavior is to *forward* metric snapshots from the registry to the global observability service instead of just exposing them locally. This keeps the hosted control plane as the authoritative metrics sink while eliminating extra sidecar scrape configuration.
4. **Global aggregator layer (control plane):** a centralized collection endpoint co-located with the hosted mesh receives pushes (or remote-write streams), normalizes metadata (agent DID, region, deployment tier), de-duplicates entries, and feeds the hosted Prometheus/Grafana dashboards, alerts, and audit pipelines.

## Deployment modes
- **Hosted agents (global/regional NATS):** clients auto-configure the exporter to push to the global aggregator. The registry stays in-memory but the default scrape target is disabled, preserving the familiar `/metrics` interface for debugging only. Forwarding includes authentication (token scoped to the agent) and region tags so dashboards can slice by control plane location.
- **On-prem agents (NATS on-prem or private registries):** the exporter defaults to exposing `/metrics` locally. Operators may optionally enable forwarding to the global service (for hybrid reporting) by configuring the exporter endpoint and credentials, but it is not required.

## Configuration knobs
- `METRICS_EXPORT_ENDPOINT`: when set in hosted agents, points to the global aggregator API/remote-write endpoint.
- `METRICS_EXPORT_TOKEN`: bearer token used to authenticate pushes from hosted agents.
- `METRICS_EXPORT_REGION`: hints which hosted region or tier the agent belongs to, allowing the aggregator to tag metrics consistently.
- `METRICS_EXPOSE_LOCAL`: boolean that keeps the HTTP `/metrics` server running even in hosted mode for diagnostics (default `false` when the exporter is active).

## Operational notes
- Keep local collectors light: streaming raw Prometheus text across a mesh network is unnecessary because the global aggregator already centralizes the canonical series.
- The aggregator should validate agent identity before ingesting metrics (re-use registry session tokens or agent credentials) to prevent injection by rogue agents.
- Document the fallback path for debugging so operators know they can still curl `:9096/metrics` on the agent if they temporarily disable exporting.

## Next steps for adoption
1. Extend the SDK exporter to accept `exportEndpoint`, `exportToken`, and `region` arguments so hosted agents can easily forward data structured for the aggregator.
2. Build the hosted aggregator service (ingestion endpoint, normalization logic, write buffers) that the global control plane will own.
3. Update README and example guides to describe how operators enable the hosted exporter vs. local HTTP server, along with the default behaviors outlined here.
