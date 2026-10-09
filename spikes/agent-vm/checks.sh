#!/usr/bin/env bash
# Run repository checks in a named container on coursebite. Never sync env files.
set -euo pipefail
task="${1:?P0 task required}"
[[ "$task" =~ ^p0-[1-6]$ ]] || exit 2
root="$(git rev-parse --show-toplevel)"
remote_dir=mt-vm-p0/houndshark-vm-p0
ssh coursebite-build "mkdir -p $remote_dir"
rsync -az --delete --exclude='.env*' --filter=':- .gitignore' --exclude=.git --exclude=node_modules \
  --exclude=.superpowers --exclude=.next --exclude='*.tsbuildinfo' \
  --exclude=__pycache__ --exclude=fc/images --exclude='out/*.log' \
  "$root/" "coursebite-build:$remote_dir/"
ssh coursebite-build bash -s -- "$remote_dir" "$task" <<'REMOTE'
set -euo pipefail
work="$HOME/$1"
name="mt-vm-p0-check-$2"
# Reuse the existing CI runner; no host package installs or new unlabelled image.
image="$(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter reference='mt-ci-runner:*' | head -1)"
[[ -n "$image" ]] || { echo 'NO-GO: existing CI runner unavailable'; exit 2; }
docker run --rm --name "$name" --label mt-vm-p0=1 --label "mt-vm-p0.run=$name" \
  --cpus 16 --memory 32g --user "$(id -u):$(id -g)" \
  -v "$work:$work" -w "$work" -e HOME=/tmp -e CI=1 \
  "$image" bash -c '
    pnpm install --frozen-lockfile --prefer-offline --reporter=append-only || exit
    status=0
    pnpm typecheck; result=$?; echo "P0_CHECK typecheck=$result"; [[ "$result" == 0 ]] || status=1
    pnpm lint; result=$?; echo "P0_CHECK lint=$result"; [[ "$result" == 0 ]] || status=1
    # P0 touches no application package: repository units are an extra regression check.
    # These optional regression files read .env* directly or through Playwright config.
    # CLI --exclude is overridden by this repo's project config. Filter these test names.
    pnpm test --maxWorkers=8 -t "^(?!.*(deployment files|the committed \.env\.test|fixture UI config)).*$"
    result=$?; echo "P0_CHECK unit=$result"; [[ "$result" == 0 ]] || status=1
    exit "$status"
  '
REMOTE
