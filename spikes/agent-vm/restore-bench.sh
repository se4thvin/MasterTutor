#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/guest"
docker build --label mt-vm-p0=1 -t mt-vm-p0-restore:local -f runtime.Dockerfile .
docker compose --env-file /dev/null -f compose.yml up --abort-on-container-exit --exit-code-from fc
