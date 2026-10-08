#!/usr/bin/env bash
# Runs a test suite on the shared CI host (SSH alias coursebite-build) instead of this machine.
# Syncs the current worktree to ~/mt-ci/<worktree>/ there (honouring .gitignore; never node_modules,
# .env*, .superpowers, orchestration or .next; .env.test and .env.example are the only env files
# sent), then runs scripts/remote-test/run-on-host.sh, streaming its output. Exits with the suite's
# exit code. Results of ui (apps/web/playwright-report/, apps/web/test-results/), e2e and qa
# (apps/web/e2e/.out/) and bench-mock (tests/bench/.out/) come back to the same paths here.
# See scripts/README.md.
#
# Usage: scripts/remote-test.sh <suite> [args...]
#        scripts/remote-test.sh all
#   suites: unit integration security web-build agent-image behaviour ui e2e smoke qa bench-mock
#   Vitest suites take Vitest args; ui, e2e and qa take Playwright args (both take --shard=i/n);
#   web-build, agent-image, smoke and bench-mock take none.
#   `all` runs every suite but qa at once, each in its own isolated project, and prints one table.
#   scripts/remote-test.sh qa --down   removes the long-lived QA stack and frees the stack lock.
#   MT_CI_MAX_STACKS (default 6): how many stack suites may run on the host at once.
set -euo pipefail

host=coursebite-build
suites="unit integration security web-build agent-image behaviour ui e2e smoke qa bench-mock"
# Every suite but qa, whose stack is meant to outlive the run.
all_suites="unit integration security web-build agent-image behaviour ui e2e smoke bench-mock"

suite="${1:-}"
if [[ -z "$suite" || " $suites all " != *" $suite "* ]]; then
  echo "usage: scripts/remote-test.sh <suite> [args...] | all   (suites: $suites)" >&2
  exit 2
fi
shift
if [[ "$suite" == all && $# -gt 0 ]]; then
  echo "remote-test: all takes no arguments" >&2
  exit 2
fi
if [[ -n "${MT_CI_MAX_STACKS:-}" && ! "$MT_CI_MAX_STACKS" =~ ^[1-9][0-9]?$ ]]; then
  echo "remote-test: MT_CI_MAX_STACKS must be a number from 1 to 30" >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
name="$(basename "$root" | tr -c 'A-Za-z0-9._\n-' '-')"
branch="$(git -C "$root" branch --show-current | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | cut -c1-30)"
remote_dir="mt-ci/$name"
remote_script="$remote_dir/scripts/remote-test/run-on-host.sh"
new_project() { echo "mt-${branch:-detached}-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"; }
# The remote command for run-on-host.sh with these arguments.
remote() { echo "${MT_CI_MAX_STACKS:+MT_CI_MAX_STACKS=$MT_CI_MAX_STACKS }bash $(printf '%q ' "$remote_script" "$@")"; }

if [[ "$suite" == qa ]]; then
  # One long-lived QA stack per worktree: a stable project name, so later runs and --down find it.
  project="mt-qa-$(printf '%s' "$name" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | cut -c1-50)"
else
  project="$(new_project)"
fi

if [[ "$suite" == qa && "${1:-}" == "--down" ]]; then
  echo "remote-test: removing the QA stack $project on $host" >&2
  exec ssh "$host" "$(remote --cleanup "$project")"
fi

echo "remote-test: syncing $name to $host:~/$remote_dir" >&2
# .mt-install.lock is the host's per-worktree install lock (run-on-host.sh); --delete leaves it.
rsync -az --delete \
  --filter=':- .gitignore' \
  --include=/.env.test --include=/.env.example --exclude='.env*' \
  --exclude=/.git --exclude=node_modules --exclude=.superpowers --exclude=orchestration \
  --exclude=.next --exclude=/.worktrees --exclude=/.mt-install.lock \
  --rsync-path="mkdir -p $remote_dir && rsync" \
  "$root/" "$host:$remote_dir/"

# Result folders are git-ignored or excluded from the sync, so --delete never touches them.
fetch() { rsync -az "$host:$remote_dir/$1/" "$root/$1/" 2>/dev/null || echo "remote-test: no $1 to fetch" >&2; }
fetch_results() {
  case "$1" in
    # ui also brings back visual baselines that an explicit --update-snapshots wrote (Task 8).
    ui) fetch apps/web/playwright-report && fetch apps/web/test-results && fetch apps/web/e2e/visual.spec.ts-snapshots ;;
    e2e | qa) fetch apps/web/e2e/.out ;;
    bench-mock) fetch tests/bench/.out ;;
  esac
}

# The test counts in a suite's log: Vitest's "Tests" line, Playwright's totals, or smoke's checks.
test_counts() {
  local log vitest playwright smoke
  log="$(sed $'s/\e\\[[0-9;]*m//g' "$1")" # without colour codes
  vitest="$(grep -E '^ +Tests +[0-9]' <<<"$log" | tail -1 | sed -E 's/^ +Tests +//')"
  playwright="$(grep -E '^ +[0-9]+ (passed|failed|flaky|skipped|interrupted|did not run)' <<<"$log" |
    sed -E 's/^ +//; s/ \(.*\)$//' | paste -sd, - | sed 's/,/, /g')"
  smoke="$(grep -cE '^ok - ' <<<"$log" || true)"
  if [[ -n "$vitest" ]]; then echo "$vitest"
  elif [[ -n "$playwright" ]]; then echo "$playwright"
  elif [[ "$smoke" != 0 ]]; then echo "$smoke checks ok"
  else echo "-"; fi
}

if [[ "$suite" == all ]]; then
  logs="$(mktemp -d "${TMPDIR:-/tmp}/mt-remote-all.XXXXXX")"
  echo "remote-test: all suites at once; logs in $logs" >&2
  start=$SECONDS
  ran=() pids=() projects=()
  for s in $all_suites; do
    if [[ "$s" == bench-mock && ! -f "$root/scripts/bench-mock.sh" ]]; then continue; fi
    p="$(new_project)"
    (
      t=$SECONDS status=0
      ssh "$host" "$(remote "$s" "$p")" >"$logs/$s.log" 2>&1 </dev/null || status=$?
      echo "$status $((SECONDS - t))" >"$logs/$s.status"
    ) &
    ran+=("$s") pids+=($!) projects+=("$p")
    echo "remote-test: $s as $p" >&2
  done
  cancel_all() {
    for pid in "${pids[@]}"; do pkill -P "$pid" 2>/dev/null || true; done
    echo "remote-test: cancelled; removing ${projects[*]} on $host" >&2
    for p in "${projects[@]}"; do ssh "$host" "$(remote --cleanup "$p")" || true; done
    exit 130
  }
  trap cancel_all INT TERM HUP
  wait
  trap - INT TERM HUP
  failed=0
  printf '\n%-12s %-5s %6s  %s\n' suite result time tests
  for s in "${ran[@]}"; do
    read -r status secs <"$logs/$s.status"
    [[ "$status" == 0 ]] && result=pass || { result=FAIL failed=1; }
    printf '%-12s %-5s %5ss  %s\n' "$s" "$result" "$secs" "$(test_counts "$logs/$s.log")"
    fetch_results "$s"
  done
  [[ -f "$root/scripts/bench-mock.sh" ]] || printf '%-12s %-5s\n' bench-mock "n/a (scripts/bench-mock.sh not added yet)"
  echo "remote-test: all finished in $((SECONDS - start))s; logs in $logs" >&2
  exit "$failed"
fi

echo "remote-test: $suite as $project" >&2
start=$SECONDS
# SSH runs in the background so a signal interrupts `wait` at once (bash defers traps while a
# foreground child runs). Dropping the session alone would leave the remote run going, so the
# trap tears it down explicitly (except qa, whose stack is meant to outlive the run).
ssh "$host" "$(remote "$suite" "$project" "$@")" &
ssh_pid=$!
cancel() {
  kill "$ssh_pid" 2>/dev/null || true
  if [[ "$suite" == qa ]]; then
    echo "remote-test: cancelled; the QA stack $project stays up (scripts/remote-test.sh qa --down)" >&2
  else
    echo "remote-test: cancelled; removing $project on $host" >&2
    ssh "$host" "$(remote --cleanup "$project")" || true
  fi
  exit 130
}
trap cancel INT TERM HUP
status=0
wait "$ssh_pid" || status=$?
fetch_results "$suite"
echo "remote-test: $suite exited $status after $((SECONDS - start))s" >&2
exit "$status"
