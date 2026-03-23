#!/usr/bin/env bash
set -euo pipefail

# Usage: ./publish_crates.sh [--dry-run]
# Requires: run `cargo login <TOKEN>` beforehand or set CARGO_REGISTRY_TOKEN env var

DRY=0
if [ "${1-}" = "--dry-run" ]; then
  DRY=1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATES=(
  "mesh-proto"
  "mesh-types"
  "mesh-session"
  "mesh-client"
  "mesh-relay"
  "mesh-dataplane"
  "mesh-sdk"
)

publish_one() {
  local crate="$1"
  local manifest="$ROOT/$crate/Cargo.toml"
  echo "\n==> Packaging $crate"
  if [ $DRY -eq 1 ]; then
    cargo publish --manifest-path "$manifest" --dry-run
  else
    cargo publish --manifest-path "$manifest"
  fi
}

# Check git is clean
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "Error: git working tree not clean. Commit or stash changes before publishing." >&2
  exit 1
fi

# Confirm cargo login / token
if [ -z "${CARGO_REGISTRY_TOKEN-}" ]; then
  echo "Warning: CARGO_REGISTRY_TOKEN not set. Ensure you've run 'cargo login <TOKEN>' or set the env var."
fi

for c in "${CRATES[@]}"; do
  publish_one "$c"
done

echo "\nAll done. If you ran with --dry-run, remove the flag to actually publish." 
