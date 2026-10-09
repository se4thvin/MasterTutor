#!/usr/bin/env bash
# The observability suite (D50, spec §16): the e2e test stack plus the telemetry profile, an https
# origin and a stub push service (tests/observability/compose.suite.yml), then
# tests/observability/*.int.test.ts against it, in name order. Remote: scripts/remote-test.sh observability.
# Usage: bash scripts/observability-stack.sh [vitest args]   (KEEP_STACK=1 keeps the stack)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/test-stack.sh
source scripts/lib/test-stack.sh

take_stack_lock
obs_env="$(obs_env_file)"
# The stub push service's throwaway certificate. The Docker daemon mounts it, so on the CI host it
# lives in the run's folder (shared with the host), not in the runner's /tmp.
MT_OBS_TLS_DIR="$(mktemp -d "${MT_CI_RUN_DIR:-${TMPDIR:-/tmp}}/mt-obs-tls.XXXXXX")"
export MT_OBS_TLS_DIR
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 \
  -subj "/CN=stub.push.services.mozilla.com" \
  -addext "subjectAltName=DNS:stub.push.services.mozilla.com" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -keyout "$MT_OBS_TLS_DIR/key.pem" -out "$MT_OBS_TLS_DIR/cert.pem" 2>/dev/null
chmod 644 "$MT_OBS_TLS_DIR/key.pem" "$MT_OBS_TLS_DIR/cert.pem"
DC+=(--env-file "$obs_env" -f tests/observability/compose.observability.yml
  -f tests/observability/compose.suite.yml --profile observability --profile e2e)
trap 'stop_stack; rm -rf "$obs_env" "$MT_OBS_TLS_DIR"' EXIT
# The access test signs up the owner, then a member.
export AUTH_SIGNUP_OPEN=1
"${DC[@]}" up -d --build --wait --wait-timeout 420
# The owner's browser check runs in the e2e image, in Traefik's network namespace (ui-check.mjs).
"${DC[@]}" --profile e2e-runner build e2e
# One file at a time, in name order: each leaves state for the next, and resilience stops services.
export MT_OBS_DC="$(printf '%s\n' "${DC[@]}")" MT_OBS_ENV="$obs_env" RUN_OBSERVABILITY_STACK=1
for file in tests/observability/stack/*.int.test.ts; do
  pnpm exec vitest run --project integration "$file" "$@"
done
echo "OBSERVABILITY OK"
