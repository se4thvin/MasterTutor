#!/usr/bin/env bash
# The server half of scripts/remote-test.sh: runs one suite in a throwaway runner container on the
# shared CI host, then removes everything this run created. Run over SSH from the synced worktree
# (~/mt-ci/<worktree>/); never on a laptop.
#
# Usage: run-on-host.sh <suite> <project> [vitest args...]
#        run-on-host.sh --cleanup <project>
#
# The host is SHARED with other people's production apps, so every resource is scoped to this run:
#   - containers carry mastertutor.ci=1 and mastertutor.ci.run=<project>;
#   - Compose stacks use the project name <project> (mt-<branch>-<rand>);
#   - cleanup removes only those labels and that project, never a global prune;
#   - nothing is published beyond 127.0.0.1.
# The runner uses the host network so suites reach their loopback-published containers on
# 127.0.0.1. The code is mounted at its host path, so Compose bind mounts the suites declare
# (relative to the repo) resolve to the same files for the host daemon.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
runs_dir="$HOME/mt-ci/.runs"
cpus=32 # a share of the host's 88 cores; the rest belong to production apps

die() { echo "remote-test: $*" >&2; exit 2; }

cleanup_run() {
  local project="$1" ids
  (cd / && docker compose -p "$project" down -v --remove-orphans) >/dev/null 2>&1 || true
  ids="$(docker ps -aq --filter "label=mastertutor.ci.run=$project")"
  [[ -z "$ids" ]] || docker rm -fv $ids >/dev/null
  ids="$(docker network ls -q --filter "label=mastertutor.ci.run=$project")"
  [[ -z "$ids" ]] || docker network rm $ids >/dev/null
  ids="$(docker volume ls -q --filter "label=mastertutor.ci.run=$project")"
  [[ -z "$ids" ]] || docker volume rm $ids >/dev/null
  docker image rm -f "mt-ci-agent-image-check:$project" >/dev/null 2>&1 || true
  rm -rf "${runs_dir:?}/$project" 2>/dev/null || true
}

if [[ "${1:-}" == "--cleanup" ]]; then
  [[ "${2:-}" =~ ^mt-[a-z0-9-]{1,60}$ ]] || die "bad project name"
  cleanup_run "$2"
  exit 0
fi

suite="${1:-}" project="${2:-}"
shift 2 || die "usage: run-on-host.sh <suite> <project> [vitest args...]"
[[ "$project" =~ ^mt-[a-z0-9-]{1,60}$ ]] || die "bad project name: $project"
cd "$root"

pnpm_version="$(sed -n 's/.*"packageManager": "pnpm@\([0-9.]*\)".*/\1/p' package.json)"
playwright_version="$(sed -n 's/.*"playwright-core": "\([0-9.]*\)".*/\1/p' package.json)"
[[ -n "$pnpm_version" && -n "$playwright_version" ]] || die "cannot read pnpm/playwright versions"
dockerfile=scripts/remote-test/runner.Dockerfile
image_hash="$(cat "$dockerfile" <(echo "$pnpm_version $playwright_version") | sha256sum | cut -c1-12)"
image="mt-ci-runner:$image_hash"

vitest_args=()
case "$suite" in
  unit | integration | security | behaviour)
    vitest_args=(--project "$suite" --maxWorkers="$cpus" "$@") ;;
  web-build | agent-image)
    [[ $# -eq 0 ]] || die "$suite takes no extra arguments" ;;
  *) die "unknown suite: $suite" ;;
esac

trap 'cleanup_run "$project"' EXIT
trap 'exit 130' INT TERM HUP

if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "remote-test: building runner image $image (first run only)" >&2
  docker build --quiet --label mastertutor.ci=1 \
    --build-arg "PNPM_VERSION=$pnpm_version" --build-arg "PLAYWRIGHT_VERSION=$playwright_version" \
    -t "$image" -f "$dockerfile" scripts/remote-test >/dev/null
fi
docker volume inspect mt-pnpm-store >/dev/null 2>&1 ||
  docker volume create --label mastertutor.ci=1 mt-pnpm-store >/dev/null

if [[ "$suite" == behaviour ]]; then
  # Chromium's sandbox in the slots needs user namespaces, which this host allows only to
  # containers under the mastertutor-slot AppArmor profile (infra/host/apparmor/README.md).
  if ! docker run --rm --label mastertutor.ci=1 --label "mastertutor.ci.run=$project" \
    --network none --security-opt apparmor=mastertutor-slot "$image" true >/dev/null 2>&1; then
    die "the behaviour suite needs the mastertutor-slot AppArmor profile, which is not loaded on this host. Load it first: see infra/host/apparmor/README.md"
  fi
fi

install="pnpm install --frozen-lockfile --prefer-offline --reporter=append-only"
preload="--import=$root/scripts/remote-test/testcontainers-ci.ts"
case "$suite" in
  unit | integration | security)
    command="$install && NODE_OPTIONS=$preload exec pnpm exec vitest run \"\$@\"" ;;
  behaviour)
    command="$install && docker build --quiet --label mastertutor.ci=1 -t mastertutor/browser-slot:local apps/browser-slot >/dev/null && NODE_OPTIONS=$preload exec pnpm exec vitest run \"\$@\"" ;;
  web-build)
    command="$install && pnpm --filter @mastertutor/web build && exec pnpm --filter @mastertutor/web check:bundle" ;;
  agent-image)
    command="AGENT_IMAGE_TAG=mt-ci-agent-image-check:$project exec bash scripts/check-agent-image.sh" ;;
esac

# The behaviour stack has fixed loopback ports and a fixed subnet: one run at a time per host.
lock=()
if [[ "$suite" == behaviour ]]; then
  mkdir -p "$runs_dir"
  lock=(flock "$runs_dir/behaviour.lock")
fi
mkdir -p "$runs_dir/$project"

set +e
"${lock[@]}" docker run --rm --init --name "$project-runner" \
  --label mastertutor.ci=1 --label "mastertutor.ci.run=$project" \
  --network host --cpus "$cpus" --memory 64g \
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$root:$root" -v "$runs_dir/$project:$runs_dir/$project" -w "$root" \
  -v mt-pnpm-store:/pnpm-store -e npm_config_store_dir=/pnpm-store \
  -e HOME=/tmp -e CI=1 \
  -e MT_CI_RUN_ID="$project" -e COMPOSE_PROJECT_NAME="$project" \
  -e TESTCONTAINERS_RYUK_DISABLED=true -e TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 \
  -e BEHAVIOUR_REMOTE_HOST=1 -e BEHAVIOUR_DOWNLOADS="$runs_dir/$project/downloads" \
  "$image" bash -c "$command" bash "${vitest_args[@]}"
status=$?
set -e
exit "$status"
