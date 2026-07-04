#!/usr/bin/env bash
# Creates the external network compose.prod.yml joins (D41, P9-5): Compose never owns it, so a
# redeploy cannot drop Traefik's attachment. Settings mirror compose.yml's cdp network exactly
# (tests/deploy/host-scripts.int.test.ts).
# OPERATOR STEP on the Dokploy host, only after the user approves this host change (D41, D42).
# Without --yes it prints the command and changes nothing. An existing network is checked, never
# modified. Usage: CDP_SUBNET_PREFIX=172.30.231 bash infra/host/create-cdp-network.sh [--yes]
set -euo pipefail
NETWORK=mastertutor-cdp
PREFIX="${CDP_SUBNET_PREFIX:-172.30.231}"
IFS=. read -r a b c extra <<<"$PREFIX"
for octet in "$a" "$b" "$c"; do
  [[ "$octet" =~ ^[0-9]{1,3}$ && "$octet" -le 255 && -z "${extra:-}" ]] || {
    echo "invalid CDP_SUBNET_PREFIX" >&2
    exit 2
  }
done
SUBNET="$PREFIX.0/24"
IP_RANGE="$PREFIX.128/25"
APPLY=0
case "$*" in
  "") ;;
  --yes) APPLY=1 ;;
  *)
    echo "usage: create-cdp-network.sh [--yes]" >&2
    exit 2
    ;;
esac

if docker network inspect "$NETWORK" >/dev/null 2>&1; then
  actual="$(docker network inspect -f '{{.Internal}} {{range .IPAM.Config}}{{.Subnet}} {{.IPRange}}{{end}}' "$NETWORK")"
  if [[ "$actual" != "true $SUBNET $IP_RANGE" ]]; then
    echo "$NETWORK exists but does not match (want internal, $SUBNET, ip-range $IP_RANGE); not changing it" >&2
    exit 1
  fi
  echo "$NETWORK already exists and matches"
  exit 0
fi

cmd=(docker network create --driver bridge --internal --subnet "$SUBNET" --ip-range "$IP_RANGE" "$NETWORK")
if [[ "$APPLY" != "1" ]]; then
  echo "would run: ${cmd[*]}"
  echo "re-run with --yes once the user has approved this host change"
  exit 0
fi
"${cmd[@]}" >/dev/null
echo "created $NETWORK (internal, $SUBNET, ip-range $IP_RANGE)"
