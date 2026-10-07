#!/usr/bin/env bash
# Connects Dokploy's Traefik to mastertutor-cdp at .12, so the /live routers reach slot n.eko on
# 8080 (spec §10.2). Slots accept 8080 only from .10 (agent), .11 (web) and .12 (Traefik), so any
# other address silently breaks live view: this script refuses it.
# OPERATOR STEP, only after the user approves this host change (D41, D42). Re-run whenever Dokploy
# recreates its Traefik container. Without --yes it prints the command and changes nothing.
# Usage: bash infra/host/attach-traefik.sh [--yes]
set -euo pipefail
TRAEFIK_CONTAINER="${TRAEFIK_CONTAINER:-dokploy-traefik}"
NETWORK=mastertutor-cdp
PREFIX="${CDP_SUBNET_PREFIX:-172.30.231}"
IFS=. read -r a b c extra <<<"$PREFIX"
for octet in "$a" "$b" "$c"; do
  [[ "$octet" =~ ^[0-9]{1,3}$ && "$octet" -le 255 && -z "${extra:-}" ]] || {
    echo "invalid CDP_SUBNET_PREFIX" >&2
    exit 2
  }
done
WANT="$PREFIX.12"
APPLY=0
case "$*" in
  "") ;;
  --yes) APPLY=1 ;;
  *)
    echo "usage: attach-traefik.sh [--yes]" >&2
    exit 2
    ;;
esac

current="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$NETWORK\"}}{{.IPAddress}}{{end}}" "$TRAEFIK_CONTAINER")"
if [[ -n "$current" ]]; then
  if [[ "$current" != "$WANT" ]]; then
    echo "$TRAEFIK_CONTAINER is on $NETWORK at $current, not $WANT; disconnect it first (operator decision)" >&2
    exit 1
  fi
  echo "$TRAEFIK_CONTAINER already attached to $NETWORK at $WANT"
  exit 0
fi

cmd=(docker network connect --ip "$WANT" "$NETWORK" "$TRAEFIK_CONTAINER")
if [[ "$APPLY" != "1" ]]; then
  echo "would run: ${cmd[*]}"
  echo "re-run with --yes once the user has approved this host change"
  exit 0
fi
"${cmd[@]}"
echo "attached $TRAEFIK_CONTAINER to $NETWORK at $WANT"
