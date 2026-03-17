# Public mesh + OpenAI demo (local only)

Example that runs **locally** but uses the **public AMP** (meshprotocol.dev): NATS, Registry, and Matching. Two agents with **real OpenAI** via NebulaOS:

- **Provider:** Math expert — registers `calculator` on the public registry, listens for matches, answers via LLM.
- **Consumer:** “Dumb” agent — asks a math question; uses the tool to request from the mesh and returns the specialist’s answer.

## Prerequisites

- Node 18+
- **NATS_TOKEN** for meshprotocol.dev — get it in [HOSTING.md](../../HOSTING.md)
- **OPENAI_API_KEY**

## Setup

```bash
cd examples/public-mesh-openai-demo
cp .env.example .env
# Edit .env: set NATS_TOKEN and OPENAI_API_KEY (and REGISTRY_URL / NATS_URL if different)
npm run install:all
```

## Run

1. **Terminal 1 — Provider** (leave running):

   ```bash
   npm run run:provider
   ```

   Registers on the public registry and listens for matches.

2. **Terminal 2 — Consumer** (one-shot, pass question as args):

   ```bash
   npm run run:consumer
   npm run run:consumer -- "What is 15 * 3?"
   ```

   The consumer calls the mesh, gets matched to your provider, sends the question via `mesh.tasks.<sessionId>`, receives the answer via `mesh.results.<sessionId>`, and returns it.

## Env vars

| Variable         | Example / default                    | Description                    |
|------------------|--------------------------------------|--------------------------------|
| NATS_URL         | `nats.meshprotocol.dev:4222`        | NATS host:port (no scheme)     |
| NATS_TOKEN       | *(required)*                         | Token for public NATS          |
| REGISTRY_URL     | `https://api.meshprotocol.dev`      | Public Registry API            |
| OPENAI_API_KEY   | *(required)*                         | OpenAI key for both agents     |
| OPENAI_MODEL     | `gpt-5-nano`                         | Optional model override        |

The scripts load `.env` via the runner; for Node you can use `dotenv` or export before running.
