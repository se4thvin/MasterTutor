#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker build --label mt-vm-p0=1 -t mt-vm-p0-rootfs:local guest
bash guest/build-rootfs.sh
docker build --label mt-vm-p0=1 -t mt-vm-p0-restore:local -f guest/runtime.Dockerfile guest
docker build --label mt-vm-p0=1 -t mt-vm-p0-net:local net
docker build --label mt-vm-p0=1 -t mt-vm-p0-traefik:3.7.13 -f net/traefik.Dockerfile net
docker compose --env-file /dev/null -f net/compose.override.yml up -d
