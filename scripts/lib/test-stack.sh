# Shared by the scripts that boot the full test stack (scripts/e2e.sh, scripts/compose-smoke.sh).
# Sourced from the repo root, never run.
#
# DC: the Compose command. On the shared CI host (scripts/remote-test.sh sets MT_CI_RUN_ID) it adds
# tests/e2e/compose.remote.yml: CI labels, the slot AppArmor profile, no published media ports.
# The project is named per worktree (mt-<worktree dir>), so one worktree's `down -v` never removes
# another's kept stack. A name the caller set wins: the remote runner sets its per-run project.
# Stacks still cannot run side by side (fixed subnets and the Traefik port): the lock stays.
worktree="$(basename "$PWD" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9_\n-' '-')"
: "${COMPOSE_PROJECT_NAME:=mt-${worktree}}"
# Not exported: DC carries it (-p), and a shell that sourced this must not move other compose
# tools (the behaviour stack) onto this project.
DC=(docker compose -p "$COMPOSE_PROJECT_NAME" --env-file .env.test -f compose.yml -f compose.test.yml)
if [[ -n "${MT_CI_RUN_ID:-}" ]]; then DC+=(-f tests/e2e/compose.remote.yml); fi

# The app's origin: an exported TEST_HTTP_PORT wins, as in Compose's interpolation; then .env.test.
stack_base_url() {
  local port="${TEST_HTTP_PORT:-$(grep -E '^TEST_HTTP_PORT=' .env.test 2>/dev/null | cut -d= -f2)}"
  echo "http://localhost:${port:-18080}"
}

# One heavy stack at a time on a laptop (D46): the same lock as the behaviour suite. The CI host
# serialises full-stack suites with its own lock (~/mt-ci/.runs/stack.lock, run-on-host.sh).
LOCAL_STACK_LOCK=/tmp/mt-behaviour.lock
STACK_LOCK_HELD=0

take_stack_lock() {
  [[ -n "${MT_CI_RUN_ID:-}" ]] && return 0
  until mkdir "$LOCAL_STACK_LOCK" 2>/dev/null; do
    echo "waiting for $LOCAL_STACK_LOCK (another heavy stack is running)" >&2
    sleep 15
  done
  STACK_LOCK_HELD=1
}

release_stack_lock() {
  if [[ "$STACK_LOCK_HELD" == "1" ]]; then
    rmdir "$LOCAL_STACK_LOCK" 2>/dev/null || true
    STACK_LOCK_HELD=0
  fi
}

# Tears the stack down and frees the lock. KEEP_STACK=1 keeps both and says how to free them.
# Arguments go before `down` (for example --profile e2e).
stop_stack() {
  if [[ "${KEEP_STACK:-0}" == "1" ]]; then
    echo "stack kept. When done: ${DC[*]} $* down -v --remove-orphans" >&2
    [[ "$STACK_LOCK_HELD" == "1" ]] && echo "then: rmdir $LOCAL_STACK_LOCK" >&2
    return 0
  fi
  "${DC[@]}" "$@" down -v --remove-orphans >/dev/null 2>&1 || true
  release_stack_lock
}
