#!/usr/bin/env bash
# Proves a slot serves PulseAudio on 4713 to the agent IP only, and that the agent image's parec
# records its audio output there (spec §8 transcribe).
# Usage: bash apps/browser-slot/test/verify-pulse.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SLOT_IMAGE="mastertutor/browser-slot:verify"
AGENT_IMAGE="mastertutor/agent:verify"
NET="mt-pulse-verify"
PREFIX="172.30.238"
SLOT="mt-pulse-verify-slot"

cleanup() {
  docker rm -f "$SLOT" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() { echo "VERIFY FAIL: $*" >&2; docker logs --tail 60 "$SLOT" >&2 2>/dev/null || true; exit 1; }
# 3 s of 16 kHz mono s16le (32 000 B/s) from the slot's output monitor, recorded from $1; prints
# the byte count. A fresh slot's first stream can take over two seconds to start, so the bar is
# a quarter second of audio: enough to prove the stream flows.
record_from() {
  docker run --rm --network "$NET" --ip "$1" --entrypoint sh "$AGENT_IMAGE" -c \
    "timeout 3 parec --server=tcp:$PREFIX.20:4713 --device=audio_output.monitor --raw --format=s16le --rate=16000 --channels=1 2>/dev/null | wc -c"
}

docker build -q -t "$SLOT_IMAGE" "$ROOT/apps/browser-slot" >/dev/null
docker build -q --target agent -t "$AGENT_IMAGE" "$ROOT" >/dev/null
cleanup
docker network create --internal --subnet "$PREFIX.0/24" "$NET" >/dev/null
docker run -d --name "$SLOT" --network "$NET" --ip "$PREFIX.20" \
  --cap-add NET_ADMIN --security-opt "seccomp=$ROOT/apps/browser-slot/seccomp/chromium.json" \
  --shm-size 2g --tmpfs /tmp/chromium-profile:uid=1000,gid=1000,mode=0700 \
  -e SLOT_NAME=browser-1 -e NEKO_ADMIN_SECRET=verify-admin-secret-0123456789abcdef \
  -e NEKO_MEMBER_SECRET=verify-member-secret-0123456789abcdef \
  -e CDP_ALLOWED_IP="$PREFIX.10" -e NEKO_ALLOWED_IPS="$PREFIX.11" \
  -e NEKO_WEBRTC_NAT1TO1=127.0.0.1 "$SLOT_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$SLOT" bash -c 'echo > /dev/tcp/127.0.0.1/4713' 2>/dev/null && break
  sleep 1
done

bytes="$(record_from "$PREFIX.10")"
[[ "$bytes" -ge 8000 ]] || fail "the agent IP recorded only $bytes bytes"
echo "ok - the agent IP records audio ($bytes bytes)"
bytes="$(record_from "$PREFIX.30")"
[[ "$bytes" -eq 0 ]] || fail "another IP recorded $bytes bytes"
echo "ok - other IPs are refused"

# A CIDR (the behaviour stack's 0.0.0.0/0) is accepted; anything else stops the slot (exit 64).
code="$(docker run --rm --network none -e SLOT_NAME=browser-1 \
  -e NEKO_ADMIN_SECRET=verify-admin-secret-0123456789abcdef \
  -e NEKO_MEMBER_SECRET=verify-member-secret-0123456789abcdef \
  -e CDP_ALLOWED_IP="1.2.3.4;load-module x" -e NEKO_ALLOWED_IPS=1.2.3.4 --cap-add NET_ADMIN \
  "$SLOT_IMAGE" true >/dev/null 2>&1; echo $?)"
[[ "$code" == 64 ]] || fail "an invalid CDP_ALLOWED_IP gave exit $code, not 64"
echo "ok - an invalid CDP_ALLOWED_IP is refused"
echo "verify-pulse: all checks passed"
