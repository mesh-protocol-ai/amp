#!/usr/bin/env bash
# Test public AMP services and subdomains.
# Usage: ./test-services.sh [domain]
#   domain defaults to meshprotocol.dev (e.g. api.<domain>, registry.<domain>, nats.<domain>)
# Env overrides: DOMAIN, REGISTRY_URL, NATS_HOST, NATS_PORT

set -e

DOMAIN="${1:-${DOMAIN:-meshprotocol.dev}}"
REGISTRY_URL="${REGISTRY_URL:-https://api.${DOMAIN}}"
REGISTRY_ALT_URL="${REGISTRY_ALT_URL:-https://registry.${DOMAIN}}"
NATS_HOST="${NATS_HOST:-nats.${DOMAIN}}"
NATS_PORT="${NATS_PORT:-4222}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()  { echo -e "${GREEN}OK${NC}   $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; }

echo "Testing AMP public services (domain: $DOMAIN)"
echo "  Registry (API): $REGISTRY_URL"
echo "  Registry (alt):  $REGISTRY_ALT_URL"
echo "  NATS:            $NATS_HOST:$NATS_PORT"
echo ""

# --- Registry (api subdomain) ---
echo -n "  [1/4] $REGISTRY_URL/health ... "
code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$REGISTRY_URL/health" 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
  ok "HTTP $code"
else
  fail "HTTP $code (expected 200)"
fi

# --- Registry (registry subdomain) ---
echo -n "  [2/4] $REGISTRY_ALT_URL/health ... "
code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$REGISTRY_ALT_URL/health" 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
  ok "HTTP $code"
else
  fail "HTTP $code (expected 200)"
fi

# --- NATS TCP ---
echo -n "  [3/4] $NATS_HOST:$NATS_PORT (TCP) ... "
if (command -v nc >/dev/null 2>&1); then
  if nc -z -w 3 "$NATS_HOST" "$NATS_PORT" 2>/dev/null; then
    ok "reachable"
  else
    fail "connection failed (nc)"
  fi
elif (command -v python3 >/dev/null 2>&1); then
  if python3 -c "import socket; socket.create_connection(('$NATS_HOST', $NATS_PORT), timeout=3)" 2>/dev/null; then
    ok "reachable"
  else
    fail "connection failed (python)"
  fi
else
  warn "skipped (no nc or python3)"
fi

# --- Registry GET /agents (smoke) ---
echo -n "  [4/4] $REGISTRY_URL/agents (GET) ... "
code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$REGISTRY_URL/agents" 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
  ok "HTTP $code"
else
  # 200 = list (maybe empty); 4xx/5xx = still a response from our service
  if [ "$code" != "000" ]; then
    ok "HTTP $code (service responding)"
  else
    fail "no response"
  fi
fi

echo ""
echo -e "${GREEN}All checks passed.${NC} Subdomains and services are up."
echo ""
echo "SDK usage:"
echo "  export REGISTRY_URL=\"$REGISTRY_URL\""
echo "  export NATS_URL=\"nats://<YOUR_TOKEN>@$NATS_HOST:$NATS_PORT\""
