#!/usr/bin/env bash
# Full-stack E2E (spec §12). It boots compose.test.yml with the e2e profile, runs the Playwright stack
# suite (apps/web/playwright.stack.config.ts) in the e2e container inside Traefik's network
# namespace, then tears the stack down. Remote (default for `pnpm e2e`): scripts/remote-test.sh e2e.
# Usage: bash scripts/e2e.sh [playwright args]
#   KEEP_STACK=1                  leave the stack (and the laptop lock) in place
#   E2E_PROJECTS="setup e2e"      Playwright projects to run
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/test-stack.sh
source scripts/lib/test-stack.sh

take_stack_lock
trap 'stop_stack --profile e2e --profile e2e-runner' EXIT

mkdir -p apps/web/e2e/.out
"${DC[@]}" --profile e2e up -d --build --wait --wait-timeout 420
"${DC[@]}" --profile e2e-runner build e2e
projects=()
for project in ${E2E_PROJECTS:-setup e2e}; do projects+=("--project=$project"); done
# The secret canary scan (spec §12, Task 6) runs even when a spec failed, before stop_stack.
set +e
"${DC[@]}" --profile e2e-runner run --rm --no-deps --user "$(id -u):$(id -g)" e2e \
  pnpm exec playwright test --config playwright.stack.config.ts "${projects[@]}" "$@"
tests_status=$?
node tests/security/stack-canary.ts "${DC[@]}" --profile e2e
scan_status=$?
set -e
[[ $tests_status -eq 0 && $scan_status -eq 0 ]] || exit 1
echo "E2E OK"
