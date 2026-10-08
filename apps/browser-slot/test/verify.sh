#!/usr/bin/env bash
# Verifies the browser-slot image in isolation:
#   - Chromium runs with its sandbox on;
#   - CDP is reachable only from the agent IP, and n.eko only from allowed IPs;
#   - private egress is blocked;
#   - the display is 1280x800;
#   - n.eko passwords are derived from the shared secrets;
#   - downloads fail closed without the agent, and File System Access is blocked;
#   - the profile is fresh after Chromium exits.
# Usage: bash apps/browser-slot/test/verify.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="mastertutor/browser-slot:verify"
NET="mt-slot-verify"
PREFIX="172.30.239"
SLOT="mt-slot-verify-slot"
PEER="mt-slot-verify-peer"
CURL="curlimages/curl:8.22.0"
ADMIN_SECRET="neko-admin-secret-for-tests-0123456789"
MEMBER_SECRET="neko-member-secret-for-tests-0123456789"

cleanup() {
  docker rm -f "$SLOT" "$PEER" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() { echo "VERIFY FAIL: $*" >&2; docker logs --tail 60 "$SLOT" >&2 2>/dev/null || true; exit 1; }
pass() { echo "ok - $*"; }
from_ip() { local ip="$1"; shift; docker run --rm --network "$NET" --ip "$ip" "$CURL" -s -m 4 "$@"; }
wait_healthy() {
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$SLOT" 2>/dev/null)" == "healthy" ]] && return 0
    sleep 1
  done
  return 1
}
hmac() { printf '%s' browser-1 | openssl dgst -sha256 -hmac "$1" -r | cut -d' ' -f1; }
login() {
  from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" "http://$PREFIX.20:8080/api/login"
}

docker build -q -t "$IMAGE" "$HERE" >/dev/null
cleanup
docker network create --internal --subnet "$PREFIX.0/24" "$NET" >/dev/null
docker run -d --name "$PEER" --network "$NET" --ip "$PREFIX.40" busybox:1.37 httpd -f -p 80 -h /tmp >/dev/null
docker run -d --name "$SLOT" --network "$NET" --ip "$PREFIX.20" \
  --cap-add NET_ADMIN --cap-add SYS_PTRACE --security-opt "seccomp=$HERE/seccomp/chromium.json" \
  --shm-size 2g --tmpfs /tmp/chromium-profile:uid=1000,gid=1000,mode=0700 \
  -e SLOT_NAME=browser-1 -e NEKO_ADMIN_SECRET="$ADMIN_SECRET" -e NEKO_MEMBER_SECRET="$MEMBER_SECRET" \
  -e CDP_ALLOWED_IP="$PREFIX.10" -e PULSE_ALLOWED_IP="$PREFIX.13" \
  -e NEKO_ALLOWED_IPS="$PREFIX.11,$PREFIX.12" \
  -e NEKO_WEBRTC_NAT1TO1=127.0.0.1 \
  "$IMAGE" >/dev/null

wait_healthy || fail "slot did not become healthy"
pass "healthy"

from_ip "$PREFIX.10" "http://$PREFIX.20:9223/json/version" | grep -q '"Browser"' || fail "CDP not reachable from the agent IP"
pass "CDP reachable from the agent IP"
if from_ip "$PREFIX.11" "http://$PREFIX.20:9223/json/version" >/dev/null; then fail "CDP reachable from a non-agent IP"; fi
pass "CDP blocked for other IPs"

[[ "$(from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' "http://$PREFIX.20:8080/health")" == "200" ]] || fail "n.eko not reachable from the web IP"
pass "n.eko reachable from the web IP"
if from_ip "$PREFIX.30" -o /dev/null "http://$PREFIX.20:8080/health"; then fail "n.eko reachable from an unlisted IP"; fi
pass "n.eko blocked for other IPs"

[[ "$(login agent "$(hmac "$ADMIN_SECRET")")" == "200" ]] || fail "agent member login"
[[ "$(login user "$(hmac "$MEMBER_SECRET")")" == "200" ]] || fail "user member login"
[[ "$(login user wrong-password)" == "401" ]] || fail "wrong password accepted"
pass "n.eko member passwords derived from the secrets"
# A1 (S2): the user member cannot host until the agent grants it, so a live iframe can never send
# X input while the agent drives over CDP. The whoami and admin checks keep the 403s meaningful:
# the user session is authenticated, and hosting itself works for a member that has the right.
neko_as() { # member password method path -> HTTP status, using that member's own session
  docker run --rm -i --network "$NET" --ip "$PREFIX.11" --entrypoint sh "$CURL" -s -- \
    "$1" "$2" "$3" "$4" "http://$PREFIX.20:8080" <<'SH'
body=$(curl -s -m 4 -c /tmp/jar -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"password\":\"$2\"}" "$5/api/login") || exit 1
tok=$(printf '%s' "$body" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -n "$tok" ]; then
  curl -s -m 4 -b /tmp/jar -H "Authorization: Bearer $tok" -o /dev/null -w '%{http_code}' -X "$3" "$5$4"
else
  curl -s -m 4 -b /tmp/jar -o /dev/null -w '%{http_code}' -X "$3" "$5$4"
fi
SH
}
user_pw="$(hmac "$MEMBER_SECRET")"
admin_pw="$(hmac "$ADMIN_SECRET")"
[[ "$(neko_as user "$user_pw" GET /api/whoami)" == "200" ]] || fail "user member session is not authenticated"
[[ "$(neko_as user "$user_pw" POST /api/room/control/request)" == "403" ]] \
  || fail "user member can request host control at boot (can_host must be false)"
[[ "$(neko_as user "$user_pw" GET /api/room/control)" == "403" ]] \
  || fail "user member can read host control at boot (can_host must be false)"
[[ "$(neko_as agent "$admin_pw" GET /api/room/control)" == "200" ]] \
  || fail "control: the agent member cannot use host control"
pass "user member cannot host until the agent grants it"

# The environ read must itself succeed and be non-empty (as root), so an unreadable
# or missing process can never make this check pass vacuously.
neko_environ="$(docker exec -u root "$SLOT" sh -c 'pid=$(pgrep -o -f "neko serve") && test -n "$pid" && tr "\0" "\n" < "/proc/$pid/environ"')" \
  || fail "could not read the n.eko process environment"
[[ -n "$neko_environ" ]] || fail "n.eko process environment is empty"
grep -q -E '^NEKO_MEMBER_PROVIDER=' <<<"$neko_environ" || fail "n.eko environment lacks the expected control variable (read is not meaningful)"
if grep -q -E '^NEKO_(ADMIN|MEMBER)_SECRET=' <<<"$neko_environ"; then
  fail "raw secrets reached the n.eko process"
fi
pass "raw secrets scrubbed before supervisord"

# A5: legacy client, cookie auth, chat off, implicit hosting off (read from the n.eko process itself).
for setting in NEKO_LEGACY=true NEKO_SESSION_COOKIE_ENABLED=true NEKO_SESSION_COOKIE_SECURE=false \
  NEKO_SESSION_IMPLICIT_HOSTING=false NEKO_DESKTOP_FILE_CHOOSER_DIALOG=true \
  NEKO_DESKTOP_UPLOAD_DROP=true NEKO_CHAT_ENABLED=false; do
  grep -qx "$setting" <<<"$neko_environ" || fail "n.eko runs without $setting"
done
pass "n.eko legacy, cookie, hosting, upload and chat settings"
# 400: the endpoint exists and wants a websocket upgrade (404 without NEKO_LEGACY; 000 if unreachable).
ws_code="$(from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' "http://$PREFIX.20:8080/ws")"
[[ "$ws_code" == "400" ]] || fail "legacy client endpoint /ws missing (NEKO_LEGACY): HTTP $ws_code"
from_ip "$PREFIX.11" -o /dev/null -D - -X POST -H 'Content-Type: application/json' \
  -d "{\"username\":\"user\",\"password\":\"$(hmac "$MEMBER_SECRET")\"}" \
  "http://$PREFIX.20:8080/api/login" | grep -qi '^set-cookie: NEKO_SESSION=' \
  || fail "n.eko login does not set the NEKO_SESSION cookie (cookie auth off)"
pass "legacy /ws endpoint and cookie auth enabled"
# S5: the legacy side endpoints never answer without credentials.
for path in /stats /screenshot.jpg /file; do
  # Exactly 403: a failed request (000) or a wrong path must not pass this check.
  code="$(from_ip "$PREFIX.11" -o /dev/null -w '%{http_code}' "http://$PREFIX.20:8080$path")"
  [[ "$code" == "403" ]] || fail "n.eko $path without credentials answered HTTP $code, not 403"
done
pass "legacy side endpoints need credentials"

# A5: X idle probe on 9224, agent IP only; it grows without input and XTest (n.eko's path) resets it.
idle_ms() { from_ip "$PREFIX.10" "http://$PREFIX.20:9224/" | tr -d '\r\n'; }
first="$(idle_ms)"
[[ "$first" =~ ^[0-9]+$ ]] || fail "idle probe did not return milliseconds ($first)"
if from_ip "$PREFIX.11" "http://$PREFIX.20:9224/" >/dev/null; then fail "idle probe reachable from a non-agent IP"; fi
grown=""
for _ in $(seq 1 20); do
  now_ms="$(idle_ms)"
  if [[ "$now_ms" =~ ^[0-9]+$ ]] && (( now_ms >= first + 1500 )); then grown=1; break; fi
  sleep 0.5
done
[[ -n "$grown" ]] || fail "X idle time does not grow without input"
docker exec -u neko "$SLOT" sh -c 'DISPLAY=:99.0 xdotool mousemove 37 41 && DISPLAY=:99.0 xdotool mousemove 51 63'
reset=""
for _ in $(seq 1 10); do
  now_ms="$(idle_ms)"
  if [[ "$now_ms" =~ ^[0-9]+$ ]] && (( now_ms < 1000 )); then reset=1; break; fi
  sleep 0.3
done
[[ -n "$reset" ]] || fail "XTest input did not reset the X idle time"
pass "idle probe measures XTest input and is agent-only"

[[ "$(docker exec -u neko "$SLOT" sh -c 'DISPLAY=:99.0 xdotool getdisplaygeometry')" == "1280 800" ]] || fail "display is not 1280x800"
pass "display 1280x800"

chromium_cmdlines="$(docker exec "$SLOT" sh -c 'for p in $(pgrep -f "^/usr/lib/chromium/chromium"); do tr "\0" " " < /proc/$p/cmdline; echo; done')" \
  || fail "could not read Chromium command lines"
[[ -n "$chromium_cmdlines" ]] || fail "no Chromium process matched (sandbox check would be vacuous)"
if grep -q -- '--no-sandbox' <<<"$chromium_cmdlines"; then fail "Chromium runs with --no-sandbox"; fi
docker exec "$SLOT" sh -c 'r=$(pgrep -f "type=renderer" | head -1); test -n "$r" && a=$(readlink /proc/1/ns/user) && b=$(readlink /proc/$r/ns/user) && test -n "$a" && test -n "$b" && test "$a" != "$b"' \
  || fail "renderer shares the container user namespace or its ns link is unreadable (sandbox off)"
pass "Chromium sandbox on"

# Downloads fail closed when no agent holds the browser (I3): Chromium itself blocks every
# download (DownloadRestrictions 3), into a throwaway default folder so it never falls back to a
# native "Save File" dialog a person in the live view could use. Only the agent's CDP
# allowAndName into /downloads/<runId> saves a file (the behaviour suite drives both).
# The File System Access API (a native save dialog writing anywhere) is blocked (m1).
policies="$(docker exec "$SLOT" cat /etc/chromium/policies/managed/policies.json)"
grep -q '"DownloadRestrictions": 3' <<<"$policies" || fail "downloads not blocked by policy"
grep -q '"DownloadDirectory": "/tmp"' <<<"$policies" || fail "no throwaway default download folder"
grep -q '"PromptForDownloadLocation": false' <<<"$policies" || fail "downloads may prompt for a location"
grep -q '"DefaultFileSystemWriteGuardSetting": 2' <<<"$policies" || fail "File System Access writes not blocked"
grep -q '"DefaultFileSystemReadGuardSetting": 2' <<<"$policies" || fail "File System Access reads not blocked"
pass "downloads fail closed without the agent; File System Access blocked"

from_ip "$PREFIX.10" -o /dev/null "http://$PREFIX.40/" || fail "control: peer not reachable from the test network"
if docker exec "$SLOT" curl -s -m 3 -o /dev/null "http://$PREFIX.40/"; then fail "slot reached a private address"; fi
pass "private egress blocked"
# curl exit 7 = connection refused/unreachable (REJECT); 28 would mean a silent drop or timeout.
for entry in 169.254.169.254:169.254.0.0/16 10.255.255.1:10.0.0.0/8; do
  target="${entry%%:*}"; range="${entry#*:}"
  docker exec "$SLOT" iptables -C OUTPUT -d "$range" -j REJECT || fail "no REJECT rule for $range"
  rc=0; docker exec "$SLOT" curl -s -m 3 -o /dev/null "http://$target/" || rc=$?
  [[ "$rc" == "7" ]] || fail "egress to $target did not fail with a connection error (curl exit $rc)"
done
pass "metadata and 10/8 egress rejected"

ipv6_state="$(docker exec -u root "$SLOT" sh -c 'if [ ! -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ] || [ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" = 1 ]; then echo sysctl; elif [ "$(ip6tables -S | grep -c -E "^-P (INPUT|OUTPUT|FORWARD) DROP")" = 3 ]; then echo ip6tables; else echo open; fi')" \
  || fail "could not read the IPv6 state"
[[ "$ipv6_state" == "sysctl" || "$ipv6_state" == "ip6tables" ]] || fail "IPv6 is neither disabled nor default-drop"
if [[ "$ipv6_state" == "ip6tables" ]] && docker exec "$SLOT" curl -s -6 -m 3 -o /dev/null "http://[fd00:ec2::254]/"; then fail "slot reached an IPv6 address"; fi
pass "IPv6 closed ($ipv6_state)"

docker exec "$SLOT" touch /tmp/chromium-profile/previous-run-marker /tmp/previous-run-marker
docker exec -u neko "$SLOT" sh -c 'mkdir -p /home/neko/.pki && touch /home/neko/.pki/previous-run-marker'
docker exec "$SLOT" pkill -INT -f '^/usr/lib/chromium/chromium' || true
for _ in $(seq 1 20); do
  [[ "$(docker inspect -f '{{.State.Status}}' "$SLOT")" == "exited" ]] && break
  sleep 1
done
[[ "$(docker inspect -f '{{.State.Status}}' "$SLOT")" == "exited" ]] || fail "container kept running after Chromium exited"
pass "container exits with Chromium"
docker start "$SLOT" >/dev/null
wait_healthy || fail "slot did not come back healthy"
for marker in /tmp/chromium-profile /home/neko/.pki /tmp; do
  if docker exec "$SLOT" test -e "$marker/previous-run-marker"; then fail "previous-run state survived the restart in $marker"; fi
done
pass "fresh profile after restart"

docker image rm -f "$IMAGE" >/dev/null 2>&1 || true
echo "browser-slot verify: all checks passed"
