#!/usr/bin/env bash
# Identity key + cross-session cap continuity smoke test.
#
# Runs packages/cli/scripts/identity-reconnect-demo.ts against a fresh relay.
# The demo asserts that an identity-rooted cap issued in session #1 still
# works after both parties disconnect and reconnect with fresh session keys
# in session #2, and that an agent without a valid identity attestation
# cannot use a cap audienced at someone else's identity pubkey.

set -euo pipefail

PORT="${PORT:-19300}"
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
    pnpm --filter openroom exec tsx scripts/identity-reconnect-demo.ts

echo "PASS: identity cross-session cap continuity smoke test"
