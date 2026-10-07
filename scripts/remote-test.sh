#!/usr/bin/env bash
# Runs a test suite on the shared CI host (SSH alias coursebite-build) instead of this machine.
# Syncs the current worktree to ~/mt-ci/<worktree>/ there (honouring .gitignore; never node_modules,
# .env*, .superpowers, orchestration or .next; .env.test and .env.example are the only env files
# sent), then runs scripts/remote-test/run-on-host.sh, streaming its output. Exits with the suite's
# exit code. See scripts/README.md.
#
# Usage: scripts/remote-test.sh <suite> [vitest args...]
#   suites: unit integration security web-build agent-image behaviour smoke
set -euo pipefail

host=coursebite-build
suites="unit integration security web-build agent-image behaviour smoke"

suite="${1:-}"
if [[ -z "$suite" || " $suites " != *" $suite "* ]]; then
  echo "usage: scripts/remote-test.sh <suite> [vitest args...]   (suites: $suites)" >&2
  exit 2
fi
shift

root="$(git rev-parse --show-toplevel)"
name="$(basename "$root" | tr -c 'A-Za-z0-9._\n-' '-')"
branch="$(git -C "$root" branch --show-current | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | cut -c1-30)"
project="mt-${branch:-detached}-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
remote_dir="mt-ci/$name"
remote_script="$remote_dir/scripts/remote-test/run-on-host.sh"

echo "remote-test: syncing $name to $host:~/$remote_dir" >&2
rsync -az --delete \
  --filter=':- .gitignore' \
  --include=/.env.test --include=/.env.example --exclude='.env*' \
  --exclude=/.git --exclude=node_modules --exclude=.superpowers --exclude=orchestration \
  --exclude=.next --exclude=/.worktrees \
  --rsync-path="mkdir -p $remote_dir && rsync" \
  "$root/" "$host:$remote_dir/"

echo "remote-test: $suite as $project" >&2
start=$SECONDS
# SSH runs in the background so a signal interrupts `wait` at once (bash defers traps while a
# foreground child runs). Dropping the session alone would leave the remote run going, so the
# trap tears it down explicitly.
ssh "$host" "bash $(printf '%q ' "$remote_script" "$suite" "$project" "$@")" &
ssh_pid=$!
cancel() {
  kill "$ssh_pid" 2>/dev/null || true
  echo "remote-test: cancelled; removing $project on $host" >&2
  ssh "$host" "bash $remote_script --cleanup $project" || true
  exit 130
}
trap cancel INT TERM HUP
status=0
wait "$ssh_pid" || status=$?
echo "remote-test: $suite exited $status after $((SECONDS - start))s" >&2
exit "$status"
