#!/usr/bin/env bash
# Backup/restore drill (spec §13 backups, P9-19 to P9-22). It:
#   1. boots postgres and runs migrate in a throwaway project;
#   2. writes marker data, then dumps it in Dokploy's compose-database backup format
#      (pg_dump -Fc --no-acl --no-owner, gzipped);
#   3. destroys every volume, boots a fresh postgres and proves the marker is gone;
#   4. restores the dump, re-runs migrate (grants), and proves the marker, its folder and
#      web_role's grants came back.
# Runs on the shared CI host via `scripts/remote-test.sh smoke` (project mt-<branch>-<rand>, CI
# labels, no slots, no fixed subnet or ports); locally it uses mt-drill-<rand>.
set -euo pipefail
cd "$(dirname "$0")/../.."
PROJECT="${COMPOSE_PROJECT_NAME:-mt-drill-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')}"
DC=(docker compose -p "$PROJECT" --env-file .env.test -f compose.yml -f scripts/deploy/compose.drill.yml)
WORK="$(mktemp -d)"
trap '"${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
q() { "${DC[@]}" exec -T postgres psql -U owner -d mastertutor -tAc "$1"; }
fail() {
  echo "DRILL FAIL: $*" >&2
  exit 1
}
MARK="restore-drill-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"

"${DC[@]}" up -d --wait --wait-timeout 300 postgres
"${DC[@]}" run --rm --build migrate >/dev/null
q "with w as (insert into workspaces (name) values ('$MARK') returning id)
   insert into folders (workspace_id, name) select id, '$MARK' from w" >/dev/null

# Dokploy v0.30's compose database backup for postgres (custom format, no ACLs/owners, gzipped).
"${DC[@]}" exec -T postgres sh -c 'pg_dump -Fc --no-acl --no-owner -U owner -d mastertutor | gzip' >"$WORK/drill.sql.gz"
[[ -s "$WORK/drill.sql.gz" ]] || fail "empty dump"

"${DC[@]}" down -v >/dev/null
"${DC[@]}" up -d --wait --wait-timeout 300 postgres
[[ "$(q "select count(*) from pg_tables where tablename = 'workspaces'")" == "0" ]] || fail "volume survived down -v"

# Dokploy's restore: gunzip into pg_restore --clean --if-exists, then our migrate re-applies grants.
gunzip -c "$WORK/drill.sql.gz" | "${DC[@]}" exec -T postgres pg_restore -U owner -d mastertutor --clean --if-exists --no-acl --no-owner
"${DC[@]}" run --rm migrate >/dev/null

[[ "$(q "select count(*) from workspaces where name = '$MARK'")" == "1" ]] || fail "marker workspace not restored"
[[ "$(q "select count(*) from folders where name = '$MARK'")" == "1" ]] || fail "marker folder not restored"
[[ "$(q "select has_table_privilege('web_role', 'folders', 'select')")" == "t" ]] || fail "web_role grants"
[[ "$(q "select has_table_privilege('agent_role', 'workspaces', 'select')")" == "t" ]] || fail "agent_role grants"
echo "RESTORE DRILL OK"
