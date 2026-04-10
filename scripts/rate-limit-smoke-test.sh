#!/usr/bin/env bash
# Rate limit + memory bound smoke test.
#
# Runs packages/cli/scripts/rate-limit-demo.ts, which verifies:
# - Token bucket throttles a flood of 150 envelopes (burst = 100)
# - Tokens refill after an idle period
# - Oversized resource put is rejected by the 1 MiB cap

set -euo pipefail

PORT="${PORT:-19950}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$(mktemp -d)"
RELAY_LOG="$LOG_DIR/relay.log"

cleanup() {
    local status=$?
    [[ -n "${RELAY_PID:-}" ]] && kill "$RELAY_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    if [[ $status -ne 0 ]]; then
        echo "--- relay log ---" >&2
        cat "$RELAY_LOG" >&2 2>/dev/null || true
    fi
    rm -rf "$LOG_DIR"
    exit $status
}
trap cleanup EXIT

cd "$ROOT_DIR"

PORT="$PORT" pnpm --filter openroom-relay dev > "$RELAY_LOG" 2>&1 &
RELAY_PID=$!
sleep 1

OPENROOM_RELAY="ws://localhost:$PORT" \
    pnpm --filter openroom exec tsx scripts/rate-limit-demo.ts

echo "PASS: rate limit smoke test"
