#!/usr/bin/env bash
# Proves a slot serves PulseAudio on 4713 to audio-capture's address only, and that the
# audio-capture image's parec records it there (spec §8 transcribe; B4 review I7).
# Safe on the shared CI host (D45): every name carries the run id, everything is labelled
# mastertutor.ci=1 and removed at exit, and the subnet is a free one Docker accepts.
# Usage: bash apps/browser-slot/test/verify-pulse.sh
# Env: MT_CI_RUN_ID (set by scripts/remote-test.sh), SLOT_IMAGE and AUDIO_IMAGE (images already
# built; built here when unset), BEHAVIOUR_REMOTE_HOST=1 (slots take the host's AppArmor profile).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUN="${MT_CI_RUN_ID:-local}"
SLOT_IMAGE="${SLOT_IMAGE:-}"
AUDIO_IMAGE="${AUDIO_IMAGE:-}"
NET="mt-pulse-verify-$RUN"
SLOT="mt-pulse-verify-slot-$RUN"
LABELS=(--label mastertutor.ci=1 --label "mastertutor.ci.run=$RUN")
SLOT_OPTS=()
[[ "${BEHAVIOUR_REMOTE_HOST:-}" == 1 ]] && SLOT_OPTS+=(--security-opt apparmor=mastertutor-slot)
BUILT=()

cleanup() {
  docker rm -f "$SLOT" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  for image in ${BUILT[@]+"${BUILT[@]}"}; do docker image rm -f "$image" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT
fail() { echo "VERIFY FAIL: $*" >&2; docker logs --tail 60 "$SLOT" >&2 2>/dev/null || true; exit 1; }

if [[ -z "$SLOT_IMAGE" ]]; then
  SLOT_IMAGE="mastertutor/browser-slot:verify-$RUN"
  docker build -q "${LABELS[@]}" -t "$SLOT_IMAGE" "$ROOT/apps/browser-slot" >/dev/null
  BUILT+=("$SLOT_IMAGE")
fi
if [[ -z "$AUDIO_IMAGE" ]]; then
  AUDIO_IMAGE="mastertutor/audio-capture:verify-$RUN"
  docker build -q "${LABELS[@]}" --target audio-capture -t "$AUDIO_IMAGE" "$ROOT" >/dev/null
  BUILT+=("$AUDIO_IMAGE")
fi

cleanup
# Static addresses need a configured subnet: take a free /24 (Docker refuses one that overlaps a
# network another run holds, so concurrent runs never share one).
prefix=""
for _ in $(seq 1 30); do
  candidate="10.214.$((RANDOM % 250)).0"
  if docker network create --internal "${LABELS[@]}" --subnet "$candidate/24" "$NET" >/dev/null 2>&1; then
    prefix="${candidate%.0}"
    break
  fi
done
[[ -n "$prefix" ]] || fail "no free subnet for $NET"
capture_ip="$prefix.10" slot_ip="$prefix.20" other_ip="$prefix.30"

slot_env=(-e SLOT_NAME=browser-1 -e NEKO_ADMIN_SECRET=verify-admin-secret-0123456789abcdef
  -e NEKO_MEMBER_SECRET=verify-member-secret-0123456789abcdef -e NEKO_WEBRTC_NAT1TO1=127.0.0.1
  -e CDP_ALLOWED_IP="$prefix.11" -e NEKO_ALLOWED_IPS="$prefix.11")
docker run -d --name "$SLOT" "${LABELS[@]}" --network "$NET" --ip "$slot_ip" ${SLOT_OPTS[@]+"${SLOT_OPTS[@]}"} \
  --cap-add NET_ADMIN --security-opt "seccomp=$ROOT/apps/browser-slot/seccomp/chromium.json" \
  --shm-size 2g --tmpfs /tmp/chromium-profile:uid=1000,gid=1000,mode=0700 \
  "${slot_env[@]}" -e PULSE_ALLOWED_IP="$capture_ip" "$SLOT_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$SLOT" bash -c 'echo > /dev/tcp/127.0.0.1/4713' 2>/dev/null && break
  sleep 1
done

# 3 s of 16 kHz mono s16le (32 000 B/s) from the slot's output monitor, recorded from $1 as
# audio-capture runs (read-only, uid 1000, no capabilities); prints the byte count. A fresh slot's
# first stream can take over two seconds to start, so the bar is a quarter second of audio.
record_from() {
  docker run --rm "${LABELS[@]}" --network "$NET" --ip "$1" --read-only --tmpfs /tmp \
    --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
    --entrypoint sh "$AUDIO_IMAGE" -c \
    "timeout 3 parec --server=tcp:$slot_ip:4713 --device=audio_output.monitor --raw --format=s16le --rate=16000 --channels=1 2>/dev/null | wc -c"
}

bytes="$(record_from "$capture_ip")"
[[ "$bytes" -ge 8000 ]] || fail "audio-capture's address recorded only $bytes bytes"
echo "ok - audio-capture's address records audio ($bytes bytes)"
bytes="$(record_from "$other_ip")"
[[ "$bytes" -eq 0 ]] || fail "another address recorded $bytes bytes"
echo "ok - other addresses are refused"
bytes="$(record_from "$prefix.11")"
[[ "$bytes" -eq 0 ]] || fail "the CDP (agent) address recorded $bytes bytes"
echo "ok - the agent's CDP address is refused too"

# An address or CIDR is accepted; anything else stops the slot (exit 64), for either variable.
for bad in CDP_ALLOWED_IP PULSE_ALLOWED_IP; do
  code="$(docker run --rm "${LABELS[@]}" --network none --cap-add NET_ADMIN "${slot_env[@]}" \
    -e PULSE_ALLOWED_IP="$capture_ip" -e "$bad=1.2.3.4;load-module x" \
    "$SLOT_IMAGE" true >/dev/null 2>&1; echo $?)"
  [[ "$code" == 64 ]] || fail "an invalid $bad gave exit $code, not 64"
done
echo "ok - an invalid CDP_ALLOWED_IP or PULSE_ALLOWED_IP is refused"
echo "verify-pulse: all checks passed"
