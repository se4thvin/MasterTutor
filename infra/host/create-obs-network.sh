#!/usr/bin/env bash
# Creates mastertutor-obs: an internal network that only Traefik and OpenObserve join (D50, spec
# §12), so Traefik reaches OpenObserve without joining any other MasterTutor network. Compose
# never owns it (compose.prod.yml's observe-edge), so a redeploy cannot drop Traefik's attachment.
# --network observer prepares the separate internal Copilot ingress network.
# OPERATOR STEP on the Dokploy host, only after the user approves this host change (D41, D42).
# Without --yes it prints the command and changes nothing. An existing network is checked, never
# modified. Usage: bash infra/host/create-obs-network.sh [--yes]
set -euo pipefail
NETWORK=mastertutor-obs
APPLY=0
usage() { echo "usage: create-obs-network.sh [--network observer] [--yes]" >&2; exit 2; }
while (($# > 0)); do
  case "$1" in
    --yes) APPLY=1 ;;
    --network)
      [[ "${2:-}" == observer ]] || usage
      NETWORK=mastertutor-observer
      shift ;;
    *) usage ;;
  esac
  shift
done

if docker network inspect "$NETWORK" >/dev/null 2>&1; then
  if [[ "$(docker network inspect -f '{{.Internal}}' "$NETWORK")" != "true" ]]; then
    echo "$NETWORK exists but is not internal; not changing it (operator decision)" >&2
    exit 1
  fi
  echo "$NETWORK already exists (internal)"
  exit 0
fi

cmd=(docker network create --driver bridge --internal "$NETWORK")
if [[ "$APPLY" != "1" ]]; then
  echo "would run: ${cmd[*]}"
  echo "re-run with --yes once the user has approved this host change"
  exit 0
fi
"${cmd[@]}" >/dev/null
echo "created $NETWORK (internal)"
