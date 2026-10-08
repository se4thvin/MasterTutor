#!/usr/bin/env bash
# Proves the production agent image carries no test code (T7-9 review M7, carry-over 5). Builds
# the node-runtime stage and runs scripts/scan-test-code.ts inside it: no *.test.ts, no testing/
# directory, no file that loads a test framework. The scanner's rules are its own, independent of
# how the Dockerfile prunes. Exits 1 with the offenders.
# Usage: bash scripts/check-agent-image.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# scripts/remote-test.sh sets a per-run tag, so concurrent runs on the shared CI host never collide.
IMAGE="${AGENT_IMAGE_TAG:-mastertutor-agent-image-check:local}"
cleanup() { docker image rm -f "$IMAGE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build --quiet --label mastertutor.ci=1 --target node-runtime -t "$IMAGE" . >/dev/null
if ! offenders="$(docker run --rm --label mastertutor.ci=1 --entrypoint node \
  -v "$PWD/scripts/scan-test-code.ts:/scan-test-code.ts:ro" "$IMAGE" /scan-test-code.ts /app)"; then
  echo "agent image ships test code:" >&2
  echo "$offenders" >&2
  exit 1
fi
# The scanner ends every run with a sentinel line; without it the scan did not run (fail loudly).
if ! grep -Eq '^scan-test-code: scanned [1-9][0-9]* files, 0 offenders$' <<<"$offenders"; then
  echo "agent image check: the scanner did not report a scan" >&2
  echo "$offenders" >&2
  exit 1
fi
docker run --rm --label mastertutor.ci=1 --entrypoint sh "$IMAGE" -c "test -f /app/apps/agent/src/main.ts" \
  || { echo "agent image lost its entry point" >&2; exit 1; }
# The pdf-worker service's pipeline runs in the image as compose runs it (read-only, uid 1000, no
# network, no capabilities): node --permission roots, the native canvas binary, layout.
docker run --rm --label mastertutor.ci=1 --entrypoint node --read-only --tmpfs /tmp \
  --user 1000:1000 --network none --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$PWD/tests/fixtures/sites/site/pdf/paper.pdf:/paper.pdf:ro" "$IMAGE" --input-type=module -e "
    const { readFileSync } = await import('node:fs');
    const { analyzeDocument } = await import('/app/apps/agent/src/pdf/worker/server.ts');
    const pdf = new Uint8Array(readFileSync('/paper.pdf'));
    const out = await analyzeDocument({ render: 'auto', scale: 2 }, pdf, new AbortController().signal);
    process.exit(out.ok && out.pages.length === 3 && out.renders.length === 3 && out.blocks.length > 0 ? 0 : 1);" \
  || { echo "agent image cannot run the pdf-worker pipeline" >&2; exit 1; }
echo "ok - agent image carries no test code and runs the pdf-worker pipeline"
