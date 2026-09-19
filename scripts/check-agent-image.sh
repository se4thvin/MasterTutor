#!/usr/bin/env bash
# Proves the production agent image carries no test code (T7-9 review M7, carry-over 5). Builds
# the node-runtime stage and runs scripts/scan-test-code.ts inside it: no *.test.ts, no testing/
# directory, no file that loads a test framework. The scanner's rules are its own, independent of
# how the Dockerfile prunes. Exits 1 with the offenders. Then the audio-capture image (B4 review
# I7): no test code, parec present, the service answering under compose's hardening, and
# apps/browser-slot/test/verify-pulse.sh against a real slot.
# Usage: bash scripts/check-agent-image.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# scripts/remote-test.sh sets a per-run tag, so concurrent runs on the shared CI host never collide.
IMAGE="${AGENT_IMAGE_TAG:-mastertutor-agent-image-check:local}"
# The run's own tags (scripts/remote-test.sh removes mastertutor/*:<run> at exit).
RUN="${MT_CI_RUN_ID:-local}"
AUDIO_IMAGE="mastertutor/audio-capture:$RUN"
SLOT_IMAGE="mastertutor/browser-slot:$RUN"
cleanup() {
  docker image rm -f "$IMAGE" >/dev/null 2>&1 || true
  if [[ "$RUN" == local ]]; then docker image rm -f "$AUDIO_IMAGE" "$SLOT_IMAGE" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

docker build --quiet --label mastertutor.ci=1 --target node-runtime -t "$IMAGE" . >/dev/null
docker build --quiet --label mastertutor.ci=1 --target audio-capture -t "$AUDIO_IMAGE" . >/dev/null
for image in "$IMAGE" "$AUDIO_IMAGE"; do
  if ! offenders="$(docker run --rm --label mastertutor.ci=1 --entrypoint node \
    -v "$PWD/scripts/scan-test-code.ts:/scan-test-code.ts:ro" "$image" /scan-test-code.ts /app)"; then
    echo "$image ships test code:" >&2
    echo "$offenders" >&2
    exit 1
  fi
  # The scanner ends every run with a sentinel line; without it the scan did not run (fail loudly).
  if ! grep -Eq '^scan-test-code: scanned [1-9][0-9]* files, 0 offenders$' <<<"$offenders"; then
    echo "agent image check: the scanner did not report a scan of $image" >&2
    echo "$offenders" >&2
    exit 1
  fi
done
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
# Only the OCR assets Node loads ship (QA-093): no browser-only .wasm.js core copies and no
# legacy 4.0.0 model; the worker still starts offline from what is left.
extra="$(docker run --rm --label mastertutor.ci=1 --entrypoint sh "$IMAGE" -c "
    find /app/node_modules/.pnpm -path '*/node_modules/tesseract.js-core/*.wasm.js'
    find /app/node_modules/.pnpm -path '*/node_modules/@tesseract.js-data/eng/4.0.0'")"
if [[ -n "$extra" ]]; then
  echo "agent image ships unused OCR assets:" >&2
  echo "$extra" >&2
  exit 1
fi
docker run --rm --label mastertutor.ci=1 --entrypoint node --read-only --tmpfs /tmp \
  --user 1000:1000 --network none "$IMAGE" --input-type=module -e "
    const { createRequire } = await import('node:module');
    const sharp = createRequire('/app/apps/agent/src/main.ts')('sharp');
    const { createLocalOcr } = await import('/app/apps/agent/src/browser/local-ocr.ts');
    const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#fff' } }).png().toBuffer();
    const ocr = createLocalOcr();
    await ocr.text(new Uint8Array(png));
    await ocr.close();" \
  || { echo "agent image cannot start local OCR offline" >&2; exit 1; }
echo "ok - agent image carries no test code, runs the pdf-worker pipeline and local OCR"

# audio-capture as compose runs it (read-only, uid 1000, no capabilities, tmpfs): parec is there
# and the service answers on its port.
docker run --rm --label mastertutor.ci=1 --entrypoint parec "$AUDIO_IMAGE" --version >/dev/null \
  || { echo "audio-capture image has no parec" >&2; exit 1; }
docker run --rm --label mastertutor.ci=1 --read-only --tmpfs /tmp --user 1000:1000 --network none \
  --cap-drop ALL --security-opt no-new-privileges:true --entrypoint sh "$AUDIO_IMAGE" -c '
    node apps/agent/src/audio/server.ts & for _ in $(seq 1 50); do
      node -e "fetch(\"http://127.0.0.1:5003/healthz\").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" && exit 0
      sleep 0.2
    done; exit 1' || { echo "audio-capture service does not start hardened" >&2; exit 1; }
echo "ok - audio-capture image carries no test code, has parec and starts hardened"
docker build --quiet --label mastertutor.ci=1 -t "$SLOT_IMAGE" apps/browser-slot >/dev/null
SLOT_IMAGE="$SLOT_IMAGE" AUDIO_IMAGE="$AUDIO_IMAGE" bash apps/browser-slot/test/verify-pulse.sh
