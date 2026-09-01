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
# The stack above is new, so an account file from an earlier run names a user it never had.
rm -f .env.bench-account
# On a CI slot the app is reached on the slot's TEST_HTTP_PORT, but its origin stays PUBLIC_URL (D48).
env_test() { grep -E "^$1=" .env.test | cut -d= -f2 || true; }
PORT="${TEST_HTTP_PORT:-$(env_test TEST_HTTP_PORT)}"
ORIGIN="${PUBLIC_URL:-$(env_test PUBLIC_URL)}"
pnpm bench init --stack test --base-url "http://localhost:${PORT:-18080}" \
  --origin "${ORIGIN:-http://localhost:18080}"
pnpm bench run --suite fixtures --mock --only activities --track both --max-total-usd 10
pnpm bench run --suite fixtures --mock --only activities --track computer_use \
  --approval-mode bypass --acknowledge-bypass --max-total-usd 10

# Section discovery (run 1's shape): a read-only grading run over the library finds readings 1-3 and
# their sections itself. They mix complete, incomplete, empty and unread sections, so it must not pass,
# and the record must grade every section with where and why; reading 4 is out of scope.
set +e
discovery="$(pnpm bench baseline --suite fixtures --mock --only readings --track browser_use \
  --max-total-usd 10 2>&1)"
status=$?
set -e
printf '%s\n' "$discovery"
[[ "$status" == 1 ]] || { echo "discovery: expected exit 1 (mixed completion), got $status" >&2; exit 1; }
record="$(sed -n 's/.* record: //p' <<<"$discovery" | tail -1)"
chapter=http://bench.fixtures.test:8080/library/chapter
expected=(
  "| 1 | 1.1 Variables | $chapter/1/section/1 | passed | 2/2 activities complete |"
  "| 1 | 1.2 Types | $chapter/1/section/2 | passed | 1/1 activities complete |"
  "| 2 | 2.1 Loops | $chapter/2/section/1 | **failed** | 1/2 activities complete |"
  "| 2 | 2.2 Functions | $chapter/2/section/2 | passed | 2/2 activities complete |"
  "| 3 | 3.1 Overview | $chapter/3/section/1 | **unknown** | no activity found on the page |"
  "| 3 | 3.2 Review | $chapter/3/section/2 | **unknown** | never read in the grading run |"
  "- Outcome: **failed**"
)
for line in "${expected[@]}"; do
  grep -qF -- "$line" "$record" || { echo "discovery: $record lacks: $line" >&2; exit 1; }
done
if grep -qF "4.1 Beyond" "$record"; then echo "discovery: graded reading 4, which is out of scope" >&2; exit 1; fi
echo "discovery: every section graded as expected ($record)"
