# Per-run snapshots of a synced worktree on the shared CI host. Sourced by run-on-host.sh and by
# scripts/remote-test.test.ts.
#
# remote-test.sh rsyncs a worktree into ~/mt-ci/<worktree>/ while holding that worktree's sync
# lock (~/mt-ci/.sync/<worktree>.lock), so syncs from concurrent runs never interleave. A later
# sync still rewrites that folder, so no run executes from it: each takes, under the same lock, a
# full copy of the synced sources (about 16 MB, well under a second) into its own run folder, and
# runs, installs and builds there. The copy dies with the run folder (run-on-host.sh cleanup_run).
# node_modules and build output are never copied: each run installs its own.

# Folders a suite writes results to, which remote-test.sh fetches from ~/mt-ci/<worktree>/.
SNAPSHOT_RESULTS="apps/web/playwright-report apps/web/test-results apps/web/e2e/.out tests/bench/.out"

# take_snapshot <synced dir> <snapshot dir> <sync lock>: the snapshot becomes an exact copy of
# the synced sources, as of one moment between syncs.
take_snapshot() {
  local base=$1 snap=$2 lock=$3 path excludes=()
  for path in $SNAPSHOT_RESULTS; do excludes+=("--exclude=./$path"); done
  mkdir -p "$snap" "$(dirname "$lock")"
  # A re-run (qa) refreshes its snapshot in place but keeps the node_modules it installed.
  find "$snap" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  flock "$lock" tar -C "$base" --exclude=node_modules --exclude=.next --exclude=./.mt-install.lock \
    "${excludes[@]}" -cf - . | tar -C "$snap" -xf -
}

# Playwright baselines a run may rewrite on purpose (--update-snapshots): every
# <spec>.spec.ts-snapshots/*.png under apps/web/e2e.
SNAPSHOT_BASELINES="apps/web/e2e"

# publish_baselines <snapshot dir> <synced dir> <sync lock>: copies the baselines a run wrote or
# changed back to the synced folder, for remote-test.sh to fetch, and names each one. Unchanged
# baselines are left alone. Nothing is committed: the person reviews and commits them.
publish_baselines() {
  local snap=$1 base=$2 lock=$3 path
  [[ -d "$snap/$SNAPSHOT_BASELINES" ]] || return 0
  while IFS= read -r path; do
    cmp -s "$snap/$path" "$base/$path" && continue
    flock "$lock" bash -c 'mkdir -p "$(dirname "$2")" && cp -p "$1" "$2"' bash "$snap/$path" "$base/$path"
    echo "remote-test: baseline updated: $path" >&2
  done < <(cd "$snap" && find "$SNAPSHOT_BASELINES" -path '*.spec.ts-snapshots/*.png' -type f | sort)
}

# publish_results <snapshot dir> <synced dir> <sync lock>: copies the result folders a run made
# back to where remote-test.sh fetches them (the last run of a suite wins, as before snapshots).
publish_results() {
  local snap=$1 base=$2 lock=$3 path
  for path in $SNAPSHOT_RESULTS; do
    [[ -d "$snap/$path" ]] || continue
    mkdir -p "$(dirname "$base/$path")"
    flock "$lock" bash -c 'rm -rf "$2" && cp -a "$1" "$2"' bash "$snap/$path" "$base/$path"
  done
}
