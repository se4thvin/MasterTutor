#!/usr/bin/env bash
# Shoots one QA screen group on the remote QA stack and files the shots under the swarm run's
# artifacts (orchestration/README.md). Usage: pnpm qa:shoot --group G3 --run 2026-10-08-01-test-qa-swarm-g3
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
run=""
args=("$@")
while [[ $# -gt 0 ]]; do
  [[ "$1" == --run ]] && run="${2:-}"
  shift
done
[[ "$run" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-test-qa-[a-z0-9-]+$ ]] || {
  echo "qa:shoot: --run <YYYY-MM-DD-NN-test-qa-…> is required" >&2
  exit 2
}
"$root/scripts/remote-test.sh" qa shoot "${args[@]}"
mkdir -p "$root/orchestration/runs/$run/artifacts/shots"
rsync -a "$root/apps/web/e2e/.out/qa/$run/" "$root/orchestration/runs/$run/artifacts/shots/"
echo "qa:shoot: shots in orchestration/runs/$run/artifacts/shots" >&2
