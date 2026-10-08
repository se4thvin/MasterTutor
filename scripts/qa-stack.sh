#!/usr/bin/env bash
# The Phase 8 QA stack (P8-13, P8-33).
# Remote (default, D45): scripts/remote-test.sh qa <subcommand> [args] runs this in the CI runner
#   with KEEP_STACK=1 under the host stack lock; scripts/remote-test.sh qa --down removes it.
# Laptop: bash scripts/qa-stack.sh <subcommand> [args]; `up` takes /tmp/mt-behaviour.lock and keeps
#   it until `down` (D46).
#   up      fresh volumes, build, boot web + Traefik + their dependencies only (no agent, so seeded
#           runs stay frozen; no slots, so no live video: the pages stub the frame), sign the owner
#           up (T1's setup project), apply the deterministic seed as the database owner
#   wiring  the real-stack wiring smoke (Playwright args pass through, e.g. --grep "G3 ")
#   shoot   apps/web/e2e/stack/qa/shoot.ts --group G… --run <run-id> (Task 9)
#   ui      fe's fixture-mode Playwright suite with visual baselines (UI_VISUAL=1); needs no stack
#   down    laptop teardown; remote teardown is scripts/remote-test.sh qa --down
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/test-stack.sh
source scripts/lib/test-stack.sh
profiles=(--profile e2e --profile e2e-runner)
sub="${1:-}"
shift || true

# T1's Playwright runner container: Traefik's network namespace, ./apps/web/e2e mounted, cwd apps/web.
runner() { "${DC[@]}" "${profiles[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" e2e "$@"; }
need_stack() {
  "${DC[@]}" "${profiles[@]}" ps --status running --services | grep -qx traefik || {
    echo "qa-stack: the QA stack is down; run the up subcommand first" >&2
    exit 2
  }
}

case "$sub" in
  up)
    take_stack_lock
    # Long-lived on purpose: no stop_stack trap. A failure leaves the stack for inspection.
    trap 'echo "qa-stack: up failed. Tear down: scripts/remote-test.sh qa --down (laptop: bash scripts/qa-stack.sh down)" >&2' ERR
    "${DC[@]}" "${profiles[@]}" down -v --remove-orphans
    mkdir -p apps/web/e2e/.out
    "${DC[@]}" --profile e2e up -d --build --wait --wait-timeout 600 traefik
    "${DC[@]}" "${profiles[@]}" build e2e
    runner pnpm exec playwright test --config playwright.stack.config.ts --project=setup
    runner node e2e/stack/qa/seed.ts |
      "${DC[@]}" exec -T postgres psql -U owner -d mastertutor -v ON_ERROR_STOP=1 -q
    echo "qa-stack: seeded and ready on http://localhost:18080"
    ;;
  wiring)
    need_stack
    runner pnpm exec playwright test --config playwright.stack.config.ts --project=qa-w1440 --project=qa-w390 "$@"
    ;;
  shoot)
    need_stack
    # Each remote sync deletes apps/web/e2e/.out (git-ignored), so sign in again for AUTH_STATE.
    runner pnpm exec playwright test --config playwright.stack.config.ts --project=setup
    runner node e2e/stack/qa/shoot.ts "$@"
    ;;
  ui)
    # A browser run of its own: the laptop lock unless a QA stack already holds it (remote: no-op).
    [[ -d "$LOCAL_STACK_LOCK" && -z "${MT_CI_RUN_ID:-}" ]] || { take_stack_lock; trap release_stack_lock EXIT; }
    pnpm install --frozen-lockfile --prefer-offline --reporter=append-only
    # One next start serves every worker: Playwright's default (half the runner's CPUs) overloads
    # it and turns timing into failures; 8 workers run as fast (D48). A --workers arg overrides it.
    UI_VISUAL=1 pnpm --filter @mastertutor/web exec playwright test --workers=8 "$@"
    ;;
  down)
    [[ -z "${MT_CI_RUN_ID:-}" ]] || { echo "qa-stack: remote teardown is scripts/remote-test.sh qa --down" >&2; exit 2; }
    KEEP_STACK=0 STACK_LOCK_HELD=1
    stop_stack "${profiles[@]}"
    ;;
  *)
    echo "usage: scripts/qa-stack.sh <up|wiring|shoot|ui|down> [args...]" >&2
    exit 2
    ;;
esac
