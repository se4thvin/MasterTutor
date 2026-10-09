#!/usr/bin/env bash
# The prod-like benchmark stack on this Mac (D46, D47): compose.yml + compose.prod.yml + the local
# override; production builds; real model; real auth, vault and sandbox. One heavy stack at a time
# (/tmp/mt-behaviour.lock). On exit the stack is stopped (volumes kept) and the lock is released.
# Usage: scripts/bench-local.sh smoke                       (T15's pnpm prod:smoke, $1)
#        scripts/bench-local.sh bench <pnpm bench args...>  (waits up to 60 min for the Vault item)
#        scripts/bench-local.sh regrade <record.md>         (re-grades from stored traces: no run, no spend)
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f compose.prod.yml ]] || { echo "compose.prod.yml (Task 12) is required" >&2; exit 2; }
[[ -f .env.bench ]] || { echo "first run: pnpm env:init --out .env.bench (Task 14)" >&2; exit 2; }
for key in DOMAIN=localhost TRAEFIK_ENTRYPOINT=web TRAEFIK_TLS=false PUBLIC_URL=http://localhost:18080 PUBLIC_IP=127.0.0.1; do
  grep -qx "$key" .env.bench || { echo ".env.bench needs the line $key" >&2; exit 2; }
done
unset WEB_FIXTURE_API AGENT_TEST_MODE OPENAI_BASE_URL # compose.prod.yml pins them; nothing may override (D47)
until mkdir /tmp/mt-behaviour.lock 2>/dev/null; do sleep 15; done
DC=(docker compose -p mastertutor-bench --env-file .env --env-file .env.bench --profile pdf --profile observability -f compose.yml -f compose.prod.yml -f tests/bench/compose.local.yml)
trap '"${DC[@]}" stop >/dev/null 2>&1 || true; rmdir /tmp/mt-behaviour.lock' EXIT
"${DC[@]}" up -d --build --wait --wait-timeout 900
curl -fsS http://localhost:18080/healthz >/dev/null
pnpm bench init --stack local # T21 init: real Better Auth sign-up the first time, sign-in afterwards
case "${1:-}" in
  smoke)
    # T15's smoke is THE smoke (capture + takeover, $1, no retry). The account file is mode 600 and is
    # read into this process's environment only; nothing is echoed.
    SMOKE_EMAIL="$(sed -n 's/^BENCH_EMAIL=//p' .env.bench-account)" \
    SMOKE_PASSWORD="$(sed -n 's/^BENCH_PASSWORD=//p' .env.bench-account)" \
      pnpm prod:smoke --max-usd 1 ;;
  bench)
    shift
    # The vault check covers the suite being run (no site name in scripts/, P10b-1).
    suite=""
    prev=""
    for arg in "$@"; do
      [[ "$prev" == --suite ]] && suite="$arg"
      prev="$arg"
    done
    [[ -n "$suite" ]] || { echo "bench needs --suite <name>" >&2; exit 2; }
    ready=0
    for _ in $(seq 1 120); do
      # T21's vault-check starts no run: exit 0 = ready (BENCH_EXIT.ok), 3 = not ready yet (vaultNotReady).
      if pnpm --silent bench vault-check --suite "$suite"; then ready=1; break; fi
      sleep 30
    done
    [[ "$ready" == 1 ]] || { echo "Vault item not ready after 60 min; stopping" >&2; exit 3; }
    pnpm bench "$@" ;;
  regrade)
    shift
    pnpm bench regrade "$@" ;;
  *)
    echo "usage: scripts/bench-local.sh smoke | bench <pnpm bench args...> | regrade <record.md>" >&2; exit 2 ;;
esac
