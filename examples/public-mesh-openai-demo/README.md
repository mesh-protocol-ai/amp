# Public mesh + OpenAI demo

Example that uses **NATS** e **Registry** (ex.: meshprotocol.dev ou sua infra na AWS). Dois agentes com **OpenAI** via NebulaOS:

- **Provider:** Math expert — registra `calculator` no registry, escuta matches e responde via LLM.
- **Consumer:** Agente que pergunta uma conta; usa a tool para pedir ao mesh e devolve a resposta do especialista.

Para o consumer receber um match, um serviço de **matching** precisa estar inscrito no **mesmo NATS**. Em produção isso é o **matching na AWS**. Ver [Deploy do matching na AWS](../../docs/DEPLOY_MATCHING_AWS.md) para configurar a infra e fazer consumidores e provedores funcionarem.

## Prerequisites

- Node 18+
- **NATS_TOKEN** for the NATS server (e.g. meshprotocol.dev) — get it in [HOSTING.md](../../HOSTING.md)
- **OPENAI_API_KEY**
- **SESSION_TOKEN_SECRET** — same value in matching and provider (generate once, put in `.env` and in your matching deployment)
- For **local matching**: Go and the mesh_protocol repo root (so `go run ./services/matching` can run)

## Setup

```bash
cd examples/public-mesh-openai-demo
cp .env.example .env
# Edit .env: NATS_TOKEN, OPENAI_API_KEY, SESSION_TOKEN_SECRET, provider/consumer Ed25519 keys, TLS paths
npm run install:all
npm run keys:provider && npm run keys:consumer   # if not done yet
npm run certs:dev                                 # for TLS data plane
```

## Run (full flow with local matching)

If the consumer times out with “Request timeout after 25000ms”, no matching is delivering a match on your NATS. Run the **matching** locally so it receives the consumer’s request and publishes the match:

1. **Terminal 1 — Matching** (leave running; requires Go and repo root):

   ```bash
   npm run run:matching
   ```

   Subscribes to `mesh.requests.>`, queries the registry, and publishes matches to `mesh.matches` using `SESSION_TOKEN_SECRET` from `.env`.

2. **Terminal 2 — Provider** (leave running):

   ```bash
   npm run run:provider
   ```

   Registers on the registry and listens for matches.

3. **Terminal 3 — Consumer** (one-shot, optional question as args):

   ```bash
   npm run run:consumer
   npm run run:consumer -- "What is 15 * 3?"
   ```

   The consumer publishes a request, receives the match from the matching, then does Handshake + Transfer + Result over gRPC with the provider.

## Run com matching na AWS

Se o **matching já está rodando na AWS** (ou em outro host) no **mesmo NATS** que o demo:

1. Configure o matching na AWS com as variáveis descritas em [DEPLOY_MATCHING_AWS.md](../../docs/DEPLOY_MATCHING_AWS.md) (NATS_URL, NATS_TOKEN, REGISTRY_URL, SESSION_TOKEN_SECRET).
2. No `.env` do demo use o **mesmo** NATS_URL, NATS_TOKEN e REGISTRY_URL. No provider use o **mesmo** SESSION_TOKEN_SECRET que o matching na AWS.
3. Rode só o provider e o consumer (sem matching local):

   ```bash
   # Terminal 1
   npm run run:provider
   # Terminal 2
   npm run run:consumer
   ```

Assim qualquer pessoa com o mesmo NATS_TOKEN e REGISTRY_URL pode rodar o consumer e ser atendida pelo seu matching na AWS e pelos provedores registrados.

## Observability (Prometheus + Grafana with P99)

Com o provider rodando, você pode subir um Grafana pronto com dashboard provisionado:

```bash
npm run obs:up
```

- Grafana: `http://localhost:3000` (user: `admin`, senha: `admin`)
- Prometheus: `http://localhost:9090`
- Dashboard: **Mesh Provider Latency & Errors**

Painéis incluídos:
- P50/P95/**P99** de `llm_execute`
- P50/P95/**P99** de `transfer_total`
- P50/P95/**P99** de `handshake`
- **P99 por subetapa** de handshake (`session_lookup`, `jwt_verify`, `consumer_registry_fetch`, etc.)
- **P99 por subetapa** de processing (`parse_payload`, `agent_add_message`, `llm_execute`, `build_response_payload`, `encrypt_result`)
- taxa de falhas por motivo (handshake e transfer)

Para encerrar:

```bash
npm run obs:down
```

Observação: esse dashboard usa as métricas expostas pelo provider em `:9095/metrics`.

## Load test simples (spawn de consumers)

Para gerar volume e estabilizar P95/P99:

```bash
# total=30, concorrencia=6
npm run load:consumers -- 30 6 "Quanto e 22 + 18 ^ 4?"
```

Saída:
- resumo com avg/p50/p95/p99 por etapa do consumer (`match_ms`, `handshake_ms`, `transfer_ack_ms`, etc.)
- relatório JSON salvo em `observability/results/load-<timestamp>.json`

## Env vars

| Variable         | Example / default                    | Description                    |
|------------------|--------------------------------------|--------------------------------|
| NATS_URL         | `nats.meshprotocol.dev:4222`        | NATS host:port (no scheme)     |
| NATS_TOKEN       | *(required)*                         | Token do NATS (mesmo do matching na AWS) |
| REGISTRY_URL     | `https://api.meshprotocol.dev`      | Registry API (mesmo do matching) |
| SESSION_TOKEN_SECRET | *(required no provider)*        | Mesmo valor configurado no **matching na AWS**; ver [DEPLOY_MATCHING_AWS.md](../../docs/DEPLOY_MATCHING_AWS.md) |
| OPENAI_API_KEY   | *(required)*                         | OpenAI key for both agents     |
| OPENAI_MODEL     | `gpt-5-nano`                         | Optional model override        |

Os scripts carregam `.env` pelo runner. Para o fluxo com matching na AWS, todas as variáveis acima (NATS, REGISTRY, SESSION_TOKEN_SECRET) devem estar alinhadas com o que está configurado no matching.
