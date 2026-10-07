#!/usr/bin/env bash
# Phase 0 smoke test. It boots the stack with the test overlay and checks that:
#   - every service is healthy and the one-shots succeeded;
#   - migrations applied;
#   - auth works through Traefik;
#   - slot CDP is reachable only from the agent;
#   - the slot cannot reach backend services.
# Usage: bash scripts/compose-smoke.sh   (KEEP_STACK=1 leaves the stack running)
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=lib/test-stack.sh
source scripts/lib/test-stack.sh
BASE="$(stack_base_url)"

take_stack_lock
trap stop_stack EXIT
fail() { echo "SMOKE FAIL: $*" >&2; "${DC[@]}" ps -a >&2 || true; "${DC[@]}" logs --tail=60 >&2 || true; exit 1; }
pass() { echo "ok - $*"; }
psql_value() { "${DC[@]}" exec -T postgres psql -U owner -d mastertutor -tAc "$1"; }
signup() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/sign-up/email" \
    -H 'Content-Type: application/json' -H "Origin: $BASE" \
    -d "{\"email\":\"$1\",\"password\":\"correct-horse-battery-staple\",\"name\":\"Smoke\"}"
}

"${DC[@]}" up -d --build --wait --wait-timeout 300 || fail "stack did not become healthy"
pass "stack healthy"

for svc in migrate garage-init; do
  id="$("${DC[@]}" ps -a -q "$svc")"
  [[ "$(docker inspect -f '{{.State.ExitCode}}' "$id")" == "0" ]] || fail "$svc did not exit 0"
done
pass "migrate and garage-init completed"

expected_slots="$(grep -E '^BROWSER_SLOTS=' .env.test | cut -d= -f2 | tr ',' '\n' | grep -c .)"
[[ "$(psql_value "select count(*) from browser_slots")" == "$expected_slots" ]] || fail "browser_slots not synced to BROWSER_SLOTS"
[[ "$(psql_value "select count(*) from pg_extension where extname = 'vector'")" == "1" ]] || fail "pgvector missing"
pass "migrations applied"

curl -fsS "$BASE/healthz" | grep -q '"status":"ok"' || fail "web /healthz through Traefik"
pass "web healthy through Traefik"

[[ "$(signup owner@example.test)" == "200" ]] || fail "first sign-up"
[[ "$(signup intruder@example.test)" == "403" ]] || fail "sign-up stayed open after the first user"
# Closed sign-up answers a registered email exactly like an unknown one (no account enumeration).
[[ "$(signup owner@example.test)" == "403" ]] || fail "closed sign-up told a registered email apart"
[[ "$(psql_value "select role from workspace_members")" == "owner" ]] || fail "owner workspace not created"
pass "Better Auth sign-up and workspace bootstrap"

"${DC[@]}" exec -T agent node -e "fetch('http://127.0.0.1:8787/healthz').then(async (r) => { const b = await r.json(); process.exit(r.ok && b.status === 'ok' ? 0 : 1); }, () => process.exit(1))" \
  || fail "agent /healthz"
pass "agent healthy (db + storage)"

"${DC[@]}" exec -T agent node apps/agent/src/bin/probe-slot.ts browser-1 | grep -q '"browser":"Chrome/' \
  || fail "agent cannot reach slot CDP"
pass "slot CDP reachable from agent"

# Negative probes assert the blocked-connection outcome specifically (refused or timed out),
# never "any failure": a DNS error, a missing binary or a crashed exec must not pass.
# Node: ECONNREFUSED exits 0, a timeout exits 0, connect exits 1, any other error exits 2.
rc=0
"${DC[@]}" exec -T web node -e "const s = require('node:net').connect(9223, 'browser-1'); s.setTimeout(3000); s.on('connect', () => process.exit(1)); s.on('timeout', () => process.exit(0)); s.on('error', (e) => process.exit(e.code === 'ECONNREFUSED' ? 0 : 2));" || rc=$?
[[ "$rc" == "0" ]] || fail "slot CDP from web was not blocked by refusal or timeout (exit $rc)"
pass "slot CDP blocked for web (refused or timed out)"

"${DC[@]}" exec -T web node -e "fetch('http://browser-1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
  || fail "web cannot reach n.eko"
pass "n.eko reachable from web"

"${DC[@]}" exec -T agent node -e "fetch('http://browser-1:8080/health').then((r) => process.exit(r.status === 200 ? 0 : 1), () => process.exit(1))" \
  || fail "agent cannot reach n.eko"
pass "n.eko reachable from agent"

# curl exit 7 = connection refused, 28 = timed out. Anything else (6 = DNS, 127 = no curl) fails.
expect_blocked() {
  local label="$1" url="$2" rc=0
  "${DC[@]}" exec -T browser-1 curl -s -m 3 -o /dev/null "$url" || rc=$?
  [[ "$rc" == "7" || "$rc" == "28" ]] || fail "slot -> $label: expected curl exit 7 or 28, got $rc"
}
expect_blocked "web:3000" http://web:3000/healthz
expect_blocked "metadata address" http://169.254.169.254/
rc=0
"${DC[@]}" exec -T browser-1 getent hosts postgres >/dev/null || rc=$?
[[ "$rc" == "2" ]] || fail "slot name resolution of postgres: expected getent exit 2 (not found), got $rc"
pass "slot cannot reach web, metadata or backend"

for port in 9223 8080; do
  if "${DC[@]}" port browser-1 "$port" 2>/dev/null | grep -q ':[1-9]'; then fail "port $port published on the host"; fi
done
pass "CDP and n.eko not published on the host"

echo "SMOKE OK"
