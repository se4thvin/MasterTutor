#!/usr/bin/env bash
# Proves the production agent image carries no test code (review M7): no *.test.ts files, no
# testing/ helpers (local Chromium launcher, fakes) and no testing.ts entries. Builds the
# node-runtime stage, lists offenders inside it, and exits 1 when there are any.
# Usage: bash scripts/check-agent-image.sh
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="mastertutor-agent-image-check:local"
cleanup() { docker image rm -f "$IMAGE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build --quiet --target node-runtime -t "$IMAGE" . >/dev/null
offenders="$(docker run --rm --entrypoint sh "$IMAGE" -c \
  "find /app/apps /app/packages -path '*/node_modules' -prune -o \
     \\( -name '*.test.ts' -o -name testing -o -name testing.ts \\) -print")"
if [[ -n "$offenders" ]]; then
  echo "agent image ships test code:" >&2
  echo "$offenders" >&2
  exit 1
fi
docker run --rm --entrypoint sh "$IMAGE" -c "test -f /app/apps/agent/src/main.ts" \
  || { echo "agent image lost its entry point" >&2; exit 1; }
echo "ok - agent image carries no test code"
