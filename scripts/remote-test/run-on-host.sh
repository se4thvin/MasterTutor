#!/usr/bin/env bash
# The server half of scripts/remote-test.sh: runs one suite in a throwaway runner container on the
# shared CI host, then removes everything this run created. Run over SSH from the synced worktree
# (~/mt-ci/<worktree>/); never on a laptop.
#
# Usage: run-on-host.sh <suite> <project> [args...]
#        run-on-host.sh --cleanup <project>
#
# The host is SHARED with other people's production apps, so every resource is scoped to this run:
#   - containers carry mastertutor.ci=1 and mastertutor.ci.run=<project>;
#   - Compose stacks use the project name <project> (mt-<branch>-<rand>, or mt-qa-<worktree>);
#   - images a stack builds are tagged <project>, so concurrent runs never test each other's code;
#   - cleanup removes only those labels, that project and those tags, never a global prune;
#   - nothing is published beyond 127.0.0.1.
# The runner uses the host network so suites reach their loopback-published containers on
# 127.0.0.1. The code is mounted at its host path, so Compose bind mounts the suites declare
# (relative to the repo) resolve to the same files for the host daemon.
# Stack suites (behaviour, ui, e2e, smoke, bench-mock) run concurrently: each holds a stack slot
# (slots.sh) that gives it its own subnets and loopback ports, at most MT_CI_MAX_STACKS (default 6)
# at a time. qa's stack outlives the run, so it keeps ~/mt-ci/.runs/stack.lock (shared with branches
# that predate slots) and the reserved qa block, until `scripts/remote-test.sh qa --down`.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
runs_dir="$HOME/mt-ci/.runs"
stack_lock="$runs_dir/stack.lock"
cpus=32 # a share of the host's 88 cores; the rest belong to production apps
# shellcheck source=slots.sh
source "$root/scripts/remote-test/slots.sh"
# shellcheck source=snapshot.sh
source "$root/scripts/remote-test/snapshot.sh"

die() { echo "remote-test: $*" >&2; exit 2; }

release_stack_lock() {
  if [[ "$(cat "$stack_lock/owner" 2>/dev/null)" == "$1" ]]; then rm -rf "$stack_lock"; fi
}

cleanup_run() {
  local project="$1" ids
  (cd / && docker compose -p "$project" down -v --remove-orphans) >/dev/null 2>&1 || true
  ids="$(docker ps -aq --filter "label=mastertutor.ci.run=$project")"
  [[ -z "$ids" ]] || docker rm -fv $ids >/dev/null
  ids="$(docker network ls -q --filter "label=mastertutor.ci.run=$project")"
  [[ -z "$ids" ]] || docker network rm $ids >/dev/null
  ids="$(docker volume ls -q --filter "label=mastertutor.ci.run=$project")"
  [[ -z "$ids" ]] || docker volume rm $ids >/dev/null
  # By tag, not ID: concurrent runs that built the same content share an image ID.
  ids="$(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=mastertutor/*:$project")"
  [[ -z "$ids" ]] || docker image rm $ids >/dev/null 2>&1 || true
  docker image rm -f "mt-ci-agent-image-check:$project" >/dev/null 2>&1 || true
  docker image rm -f "mt-ci-drill-runtime:$project" >/dev/null 2>&1 || true
  rm -rf "${runs_dir:?}/$project" 2>/dev/null || true
  release_stack_lock "$project"
}

take_stack_lock() {
  mkdir -p "$runs_dir"
  until mkdir "$stack_lock" 2>/dev/null; do
    # A qa stack re-entering its own lock (a second `remote-test.sh qa`) goes straight on.
    [[ "$(cat "$stack_lock/owner" 2>/dev/null)" == "$project" ]] && return 0
    echo "remote-test: waiting for the stack lock (held by $(cat "$stack_lock/owner" 2>/dev/null || echo "a starting run"))" >&2
    sleep 15
  done
  echo "$project" >"$stack_lock/owner"
}

if [[ "${1:-}" == "--cleanup" ]]; then
  [[ "${2:-}" =~ ^mt-[a-z0-9-]{1,60}$ ]] || die "bad project name"
  cleanup_run "$2"
  exit 0
fi

suite="${1:-}" project="${2:-}"
shift 2 || die "usage: run-on-host.sh <suite> <project> [args...]"
[[ "$project" =~ ^mt-[a-z0-9-]{1,60}$ ]] || die "bad project name: $project"
max_stacks="${MT_CI_MAX_STACKS:-6}"
[[ "$max_stacks" =~ ^[1-9][0-9]?$ && "$max_stacks" -lt "$SLOT_QA" ]] || die "MT_CI_MAX_STACKS must be 1-$((SLOT_QA - 1))"
cd "$root"

suite_args=()
case "$suite" in
  unit | integration | security | behaviour)
    suite_args=(--project "$suite" --maxWorkers="$cpus" "$@") ;;
  ui)
    # One next start serves every worker: Playwright's default (half of 88 cores) overloads it and
    # turns timing into failures; 8 runs as fast (measured, D48). A --workers arg overrides it.
    suite_args=(--workers=8 "$@") ;;
  e2e | qa)
    suite_args=("$@") ;;
  web-build | agent-image | smoke | bench-mock)
    [[ $# -eq 0 ]] || die "$suite takes no extra arguments" ;;
  *) die "unknown suite: $suite" ;;
esac
case "$suite" in
  qa) [[ -f scripts/qa-stack.sh ]] || die "the qa suite runs scripts/qa-stack.sh, which Phase 8 Task 8 adds" ;;
  bench-mock) [[ -f scripts/bench-mock.sh ]] || die "the bench-mock suite runs scripts/bench-mock.sh, which Phase 10 Task 22 adds" ;;
esac

pnpm_version="$(sed -n 's/.*"packageManager": "pnpm@\([0-9.]*\)".*/\1/p' package.json)"
playwright_version="$(sed -n 's/.*"playwright-core": "\([0-9.]*\)".*/\1/p' package.json)"
[[ -n "$pnpm_version" && -n "$playwright_version" ]] || die "cannot read pnpm/playwright versions"
dockerfile=scripts/remote-test/runner.Dockerfile
image_hash="$(cat "$dockerfile" <(echo "$pnpm_version $playwright_version") | sha256sum | cut -c1-12)"
image="mt-ci-runner:$image_hash"

# The run executes from its own copy of the synced worktree (snapshot.sh), so a later sync from
# the same worktree never changes files under it. Results go back to the synced folder on exit.
base="$root"
run_dir="$runs_dir/$project"
sync_lock="$HOME/mt-ci/.sync/$(basename "$base").lock"
on_exit() {
  # A ui run may have rewritten the visual baselines (--update-snapshots): they come back too.
  local baselines=""
  [[ "$suite" != ui ]] || baselines="$SNAPSHOT_BASELINES"
  # shellcheck disable=SC2086 # a space-separated list of folders
  publish_results "$run_dir/src" "$base" "$sync_lock" $baselines || true
  # qa's stack (and its snapshot) outlives this script; everything else is removed when it exits.
  if [[ "$suite" != qa ]]; then cleanup_run "$project"; fi
}
trap on_exit EXIT
trap 'exit 130' INT TERM HUP
take_snapshot "$base" "$run_dir/src" "$sync_lock"
root="$run_dir/src"
cd "$root"

if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "remote-test: building runner image $image (first run only)" >&2
  docker build --quiet --label mastertutor.ci=1 \
    --build-arg "PNPM_VERSION=$pnpm_version" --build-arg "PLAYWRIGHT_VERSION=$playwright_version" \
    -t "$image" -f "$dockerfile" scripts/remote-test >/dev/null
fi
# The pnpm store lives beside the runs' snapshots in one mount, so each run's install hardlinks
# from it instead of copying every package (seconds, not most of a minute).
pnpm_store="$runs_dir/.pnpm-store"
mkdir -p "$pnpm_store"

case "$suite" in
  behaviour | e2e | smoke | qa | bench-mock)
    # Chromium's sandbox in the slots needs user namespaces, which this host allows only to
    # containers under the mastertutor-slot AppArmor profile (infra/host/apparmor/README.md).
    if ! docker run --rm --label mastertutor.ci=1 --label "mastertutor.ci.run=$project" \
      --network none --security-opt apparmor=mastertutor-slot "$image" true >/dev/null 2>&1; then
      die "the $suite suite needs the mastertutor-slot AppArmor profile, which is not loaded on this host. Load it first: see infra/host/apparmor/README.md"
    fi ;;
esac

install="pnpm install --frozen-lockfile --prefer-offline --reporter=append-only"
preload="--import=$root/scripts/remote-test/testcontainers-ci.ts"
case "$suite" in
  unit | integration | security)
    command="$install && NODE_OPTIONS=$preload exec pnpm exec vitest run \"\$@\"" ;;
  behaviour)
    command="$install && docker build --quiet --label mastertutor.ci=1 -t \"\$BEHAVIOUR_SLOT_IMAGE\" apps/browser-slot >/dev/null && NODE_OPTIONS=$preload exec pnpm exec vitest run \"\$@\"" ;;
  web-build)
    command="$install && pnpm --filter @mastertutor/web build && pnpm --filter @mastertutor/web check:bundle && exec pnpm --filter @mastertutor/web check:first-load" ;;
  ui)
    command="$install && exec pnpm --filter @mastertutor/web test:ui \"\$@\"" ;;
  agent-image)
    command="AGENT_IMAGE_TAG=mt-ci-agent-image-check:$project exec bash scripts/check-agent-image.sh" ;;
  e2e)
    command='exec bash scripts/e2e.sh "$@"' ;;
  smoke)
    # The compose smoke, then the Dokploy-format backup/restore drill (its own project, CI labels,
    # no fixed ports or subnet). Nothing may follow an exec (tests/deploy/drill.int.test.ts).
    command='bash scripts/compose-smoke.sh && exec bash scripts/deploy/restore-drill.sh' ;;
  qa)
    command='KEEP_STACK=1 exec bash scripts/qa-stack.sh "$@"' ;;
  bench-mock)
    command="$install && exec bash scripts/bench-mock.sh" ;;
esac

# Stack suites: a slot's subnets and ports (qa: the reserved block, legacy ports, legacy lock).
slot_env=()
case "$suite" in
  behaviour | ui | e2e | smoke | bench-mock)
    acquire_slot "$max_stacks" "$runs_dir"
    echo "remote-test: stack slot $SLOT of $max_stacks" >&2
    while IFS= read -r var; do slot_env+=(-e "$var"); done < <(slot_networks "$SLOT"; slot_ports "$SLOT") ;;
  qa)
    take_stack_lock
    while IFS= read -r var; do slot_env+=(-e "$var"); done < <(slot_networks "$SLOT_QA") ;;
esac
case "$suite" in
  e2e | smoke | qa | bench-mock)
    # Traefik's live-auth address follows the run's cdp subnet (tests/e2e/compose.remote.yml).
    prefix="$(slot_networks "${SLOT:-$SLOT_QA}" | sed -n 's/^CDP_SUBNET_PREFIX=//p')"
    sed "s/172\.30\.231\./$prefix./g" infra/traefik/test-dynamic.yml >"$run_dir/traefik-dynamic.yml" ;;
esac
set +e
docker run --rm --init --name "$project-runner" \
  --label mastertutor.ci=1 --label "mastertutor.ci.run=$project" \
  --network host --cpus "$cpus" --memory 64g \
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$runs_dir:$runs_dir" -w "$root" \
  -e npm_config_store_dir="$pnpm_store" \
  -e HOME=/tmp -e CI=1 \
  -e MT_CI_RUN_ID="$project" -e MT_CI_RUN_DIR="$run_dir" -e COMPOSE_PROJECT_NAME="$project" \
  -e TESTCONTAINERS_RYUK_DISABLED=true -e TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 \
  -e BEHAVIOUR_REMOTE_HOST=1 -e BEHAVIOUR_DOWNLOADS="$run_dir/downloads" \
  -e BEHAVIOUR_SLOT_IMAGE="mastertutor/browser-slot:$project" \
  "${slot_env[@]}" \
  "$image" bash -c "$command" bash "${suite_args[@]}"
status=$?
set -e
exit "$status"
