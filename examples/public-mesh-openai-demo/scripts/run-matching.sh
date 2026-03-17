#!/usr/bin/env bash
# Run the Go matching service with .env from the demo. Requires Go and mesh_protocol repo root.
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$DEMO_DIR/../.." && pwd)"

if [ ! -f "$REPO_ROOT/go.mod" ]; then
  echo "[run-matching] Repo root not found (expected go.mod at $REPO_ROOT). Run from examples/public-mesh-openai-demo." >&2
  exit 1
fi

if [ -f "$DEMO_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$DEMO_DIR/.env"
  set +a
  export NATS_URL
  export NATS_TOKEN
  export REGISTRY_URL
  export SESSION_TOKEN_SECRET
fi

# Ensure NATS_URL has scheme for Go client
if [ -n "$NATS_URL" ] && [[ "$NATS_URL" != nats://* ]]; then
  export NATS_URL="nats://${NATS_URL}"
fi

if [ -z "$SESSION_TOKEN_SECRET" ]; then
  echo "[run-matching] SESSION_TOKEN_SECRET is required (set in .env)." >&2
  exit 1
fi

echo "[run-matching] Starting matching (NATS=$NATS_URL REGISTRY=$REGISTRY_URL)..."
cd "$REPO_ROOT"
go run ./services/matching
