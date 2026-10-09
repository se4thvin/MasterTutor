#!/usr/bin/env bash
# Scope every removal to this spike's label. Never prune mastertutor.ci globally.
set -euo pipefail
containers="$(docker ps -aq --filter label=mt-vm-p0=1)"
[[ -z "$containers" ]] || docker rm -f $containers
networks="$(docker network ls -q --filter label=mt-vm-p0=1)"
[[ -z "$networks" ]] || docker network rm $networks
volumes="$(docker volume ls -q --filter label=mt-vm-p0=1)"
[[ -z "$volumes" ]] || docker volume rm $volumes
if [[ "${1:-}" == --images ]]; then
  images="$(docker image ls -q --filter label=mt-vm-p0=1 | sort -u)"
  [[ -z "$images" ]] || docker image rm $images
fi
