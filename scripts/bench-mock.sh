#!/usr/bin/env bash
# Harness self-test: the fixture suite against llm-mock, both tracks, then bypass mode (the course-site benchmark's mode).
# Runs on the shared CI host via `scripts/remote-test.sh bench-mock` (D45), which sets
# COMPOSE_PROJECT_NAME and takes the host stack lock. Never a benchmark result (D47).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/test-stack.sh
source scripts/lib/test-stack.sh   # T1: DC (+ tests/e2e/compose.remote.yml when MT_CI_RUN_ID is set), locks, stop_stack
take_stack_lock                    # no-op on the CI host (it holds ~/mt-ci/.runs/stack.lock); /tmp/mt-behaviour.lock on a Mac
trap 'stop_stack --profile e2e --profile bench' EXIT
# llm-mock, fixtures and vault-fixtures are in profile e2e; bench-fixtures is in profile bench (T1).
"${DC[@]}" --profile e2e --profile bench up -d --build --wait --wait-timeout 600
# On a CI slot the app is reached on the slot's TEST_HTTP_PORT, but its origin stays PUBLIC_URL (D48).
env_test() { grep -E "^$1=" .env.test | cut -d= -f2 || true; }
PORT="${TEST_HTTP_PORT:-$(env_test TEST_HTTP_PORT)}"
ORIGIN="${PUBLIC_URL:-$(env_test PUBLIC_URL)}"
pnpm bench init --stack test --base-url "http://localhost:${PORT:-18080}" \
  --origin "${ORIGIN:-http://localhost:18080}"
pnpm bench run --suite fixtures --mock --track both --max-total-usd 10
pnpm bench run --suite fixtures --mock --track computer_use \
  --approval-mode bypass --acknowledge-bypass --max-total-usd 10
