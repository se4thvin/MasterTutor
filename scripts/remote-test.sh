#!/usr/bin/env bash
# Runs a test suite on the shared CI host (SSH alias coursebite-build) instead of this machine.
# Syncs the current worktree to ~/mt-ci/<worktree>/ there (honouring .gitignore; never node_modules,
# .env*, .superpowers, orchestration or .next; .env.test and .env.example are the only env files
# sent), then runs scripts/remote-test/run-on-host.sh, streaming its output. Exits with the suite's
# exit code. Results of e2e and qa (apps/web/e2e/.out/) and bench-mock (tests/bench/.out/)
# come back to the same paths here. See scripts/README.md.
#
# Usage: scripts/remote-test.sh <suite> [args...]
#   suites: unit integration security web-build agent-image behaviour e2e smoke qa bench-mock
#   Vitest suites take Vitest args; e2e and qa take Playwright args; smoke and bench-mock take none.
#   scripts/remote-test.sh qa --down   removes the long-lived QA stack and frees the stack lock.
set -euo pipefail

host=coursebite-build
suites="unit integration security web-build agent-image behaviour e2e smoke qa bench-mock"

suite="${1:-}"
if [[ -z "$suite" || " $suites " != *" $suite "* ]]; then
  echo "usage: scripts/remote-test.sh <suite> [args...]   (suites: $suites)" >&2
  exit 2
fi
shift

root="$(git rev-parse --show-toplevel)"
name="$(basename "$root" | tr -c 'A-Za-z0-9._\n-' '-')"
branch="$(git -C "$root" branch --show-current | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | cut -c1-30)"
if [[ "$suite" == qa ]]; then
  # One long-lived QA stack per worktree: a stable project name, so later runs and --down find it.
  project="mt-qa-$(printf '%s' "$name" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | cut -c1-50)"
else
  project="mt-${branch:-detached}-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
fi
remote_dir="mt-ci/$name"
remote_script="$remote_dir/scripts/remote-test/run-on-host.sh"

if [[ "$suite" == qa && "${1:-}" == "--down" ]]; then
  echo "remote-test: removing the QA stack $project on $host" >&2
  exec ssh "$host" "bash $(printf '%q ' "$remote_script" --cleanup "$project")"
fi

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
# trap tears it down explicitly (except qa, whose stack is meant to outlive the run).
ssh "$host" "bash $(printf '%q ' "$remote_script" "$suite" "$project" "$@")" &
ssh_pid=$!
cancel() {
  kill "$ssh_pid" 2>/dev/null || true
  if [[ "$suite" == qa ]]; then
    echo "remote-test: cancelled; the QA stack $project stays up (scripts/remote-test.sh qa --down)" >&2
  else
    echo "remote-test: cancelled; removing $project on $host" >&2
    ssh "$host" "bash $remote_script --cleanup $project" || true
  fi
  exit 130
}
trap cancel INT TERM HUP
status=0
wait "$ssh_pid" || status=$?

# Both result folders are git-ignored or excluded from the sync, so --delete never touches them.
fetch() { rsync -az "$host:$remote_dir/$1/" "$root/$1/" 2>/dev/null || echo "remote-test: no $1 to fetch" >&2; }
case "$suite" in
  e2e) fetch apps/web/e2e/.out ;;
  # qa ui (fixture mode, Task 8) writes baselines and its report beside the fixture suite.
  qa) fetch apps/web/e2e/.out; fetch apps/web/e2e/visual.spec.ts-snapshots; fetch apps/web/test-results; fetch apps/web/playwright-report ;;
  bench-mock) fetch tests/bench/.out ;;
esac
echo "remote-test: $suite exited $status after $((SECONDS - start))s" >&2
exit "$status"
