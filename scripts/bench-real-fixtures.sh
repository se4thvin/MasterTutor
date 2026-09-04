#!/usr/bin/env bash
# Fixture benchmark with the real model, on this Mac only (the key never leaves it; §3.5). It is capped by
# SUITE_DEFAULTS.fixtures ($10 total, $3 per run). It uses T1's test stack plus one overlay that points
# agent and web at OpenAI. It takes /tmp/mt-behaviour.lock through take_stack_lock (D46). It reads only the
# key from .env and never prints it. This is NOT the course-site benchmark: D47 applies to that one.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -z "${MT_CI_RUN_ID:-}" ]] || { echo "bench-real-fixtures runs on the Mac only" >&2; exit 2; }
# shellcheck source=lib/test-stack.sh
source scripts/lib/test-stack.sh
DC+=(-f compose.bench-real.yml)
OPENAI_API_KEY_REAL="$(sed -n 's/^OPENAI_API_KEY=//p' .env)"
[[ -n "$OPENAI_API_KEY_REAL" ]] || { echo "OPENAI_API_KEY is not set in .env" >&2; exit 2; }
export OPENAI_API_KEY_REAL
take_stack_lock
trap 'stop_stack --profile e2e --profile bench' EXIT
"${DC[@]}" --profile e2e --profile bench up -d --build --wait --wait-timeout 600
pnpm bench init --stack test
pnpm bench run --suite fixtures --only activities --track both "$@"
