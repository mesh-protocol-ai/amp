# Public mesh + OpenAI demo (Community / OPEN)

Example that uses **NATS** and **Registry** (e.g. meshprotocol.dev or your own infra). Two agents with **OpenAI** via NebulaOS:

- **Provider:** Math expert — registers `calculator` on the registry, listens for matches, answers via LLM.
- **Consumer:** Agent that asks a math question; uses the tool to request from the mesh and returns the specialist’s answer.

**Security level: OPEN** (Community): simple HMAC session token, gRPC over TLS, payload sent as raw bytes (no E2E encryption). For E2E (STANDARD) and enterprise features, see the Enterprise edition in a separate private repo.

For the consumer to receive a match, a **matching** service must be subscribed on the **same NATS**. In production this is the **matching on AWS**. See [Deploy matching on AWS](../../docs/DEPLOY_MATCHING_AWS.md) for infra and env alignment.

## Prerequisites

- Node 18+
- **NATS_TOKEN** for the NATS server (e.g. meshprotocol.dev) — see [HOSTING.md](../../HOSTING.md)
- **OPENAI_API_KEY**
- **SESSION_TOKEN_SECRET** — same value in matching and provider (generate once, put in `.env` and in your matching deployment)
- For **local matching**: Go and the mesh_protocol repo root (so `go run ./services/matching` can run)

## Setup

```bash
cd examples/public-mesh-openai-demo
cp .env.example .env
# Edit .env: NATS_TOKEN, OPENAI_API_KEY, SESSION_TOKEN_SECRET, TLS paths if using TLS
npm run install:all
npm run certs:dev   # optional, for TLS data plane
```

## Run (full flow with local matching)

If the consumer times out with “Request timeout after 25000ms”, no matching is delivering a match on your NATS. Run **matching** locally:

1. **Terminal 1 — Matching** (leave running; requires Go and repo root):

   ```bash
   npm run run:matching
   ```

   Subscribes to `mesh.requests.>`, queries the registry, responds on the request `reply` subject when present, and also publishes compatibility events to `mesh.matches.<consumer_id>`, `mesh.matches.<provider_id>` and legacy `mesh.matches` using `SESSION_TOKEN_SECRET` from `.env` (simple HMAC token).

2. **Terminal 2 — Provider** (leave running):

   ```bash
   npm run run:provider
   ```

   Registers on the registry and listens for matches.

   MVP note: heartbeat support already exists in the SDK (`mesh.startHeartbeat()`), but this example provider does not start it automatically yet. If your matching deployment is filtering providers by heartbeat, add that call before `mesh.listen(...)`.

3. **Terminal 3 — Consumer** (one-shot, optional question as args):

   ```bash
   npm run run:consumer
   npm run run:consumer -- "What is 15 * 3?"
   ```

   The consumer publishes a request, receives the match, then does Handshake (session_id + token) + Transfer + Result over gRPC with the provider (OPEN: raw bytes, no E2E encryption).

## Run with matching on AWS

If **matching** is already running on AWS (or another host) on the **same NATS** as this demo:

1. Configure matching on AWS as in [DEPLOY_MATCHING_AWS.md](../../docs/DEPLOY_MATCHING_AWS.md) (NATS_URL, NATS_TOKEN, REGISTRY_URL, SESSION_TOKEN_SECRET).
2. In the demo `.env` use the **same** NATS_URL, NATS_TOKEN and REGISTRY_URL. On the provider use the **same** SESSION_TOKEN_SECRET as the matching on AWS.
3. Run only the provider and consumer (no local matching):

   ```bash
   npm run run:provider
   npm run run:consumer
   ```

## Validate data plane (TLS + auth)

With the provider running:

```bash
npm run validate:dataplane
```

Expect: Handshake with a fake token is rejected (session_not_found or invalid_session_token). That confirms TLS and gRPC connectivity.

## Observability (Prometheus + Grafana)

This example now uses the SDK helper `createDataPlaneObservability()` and passes its counters into `DataPlaneServer`.

Provider snippet:

```js
import { createDataPlaneObservability, DataPlaneServer } from '@meshprotocol/sdk';

const { register, handshakeCounter, transferCounter, phaseLatency } = createDataPlaneObservability({ prefix: 'mesh_provider_' });
const dpServer = new DataPlaneServer({
  sessionTokenSecret: process.env.SESSION_TOKEN_SECRET,
  providerDid: agentCardJson.metadata.id,
  metrics: { handshakeCounter, transferCounter, phaseLatency },
});
```

With the provider running:

```bash
npm run obs:up
```

- Grafana: `http://localhost:3000` (user: `admin`, password: `admin`)
- Prometheus: `http://localhost:9090`
- Dashboard: **Mesh Provider Latency & Errors**

```bash
npm run obs:down
```

## Load test (spawn consumers)

```bash
npm run load:consumers -- 30 6 "What is 22 + 18?"
```

Output: summary with avg/p50/p95/p99 and JSON report under `observability/results/`.

## Env vars

| Variable              | Example / default              | Description |
|-----------------------|--------------------------------|-------------|
| NATS_URL              | `nats.meshprotocol.dev:4222`   | NATS host:port (no scheme) |
| NATS_TOKEN            | *(required)*                  | NATS token (same as matching on AWS) |
| REGISTRY_URL          | `https://api.meshprotocol.dev`| Registry API (same as matching) |
| SESSION_TOKEN_SECRET  | *(required on provider)*      | Same value as **matching on AWS**; see [DEPLOY_MATCHING_AWS.md](../../docs/DEPLOY_MATCHING_AWS.md) |
| OPENAI_API_KEY        | *(required)*                  | OpenAI key for both agents |
| OPENAI_MODEL          | `gpt-5-nano`                  | Optional model override |

For the flow with matching on AWS, NATS, REGISTRY and SESSION_TOKEN_SECRET must match the matching deployment.

## Current routing note (MVP)

Today this repo is in a migration phase:

- consumer `request()` uses request-reply first
- matching also publishes directed events for consumer and provider
- legacy `mesh.matches` is still emitted for compatibility

The SDK hides most of this rollout detail, but deployment and debugging should assume all three paths can appear while migration is in progress.
