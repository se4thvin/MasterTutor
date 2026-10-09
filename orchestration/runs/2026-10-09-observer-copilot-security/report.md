# Observer Track C security fixes

Scope: the independent MERGE-AFTER-FIXES review's two P1 findings, in order.

Ruling: the explicit requested integration merge is the sole exception to the no-merge rule. A pre-existing remote-test lock patch was preserved outside the repository, then reapplied after merging; integration already contained it and the resulting file was clean.

Ruling: C2's regex SQL guard and in-process OSS admin credential are superseded by the security-fix request. Use a strict tokenizer for the restricted SELECT envelope (standard doubled single/double quotes, balanced expressions, a single unqualified source); no SQL dependency is needed. Source validation precedes query execution and any trusted result.

No migrations, captured content or UI changes are required. The plan's old migration/cache-retention guidance is superseded by the user's current instructions and D52/D54/D55.

## Task 1 — SQL stream confinement

RED: remote SQL regression suite failed three tests, including the reviewer's exact quoted-alias/comma-source exploit and malformed quotes.
GREEN: remote observer unit suite passed 36 tests before adding the tool-level no-query/no-result regression. Root typecheck and lint passed. Final remote unit/integration results recorded below when complete.

Task 1 final verification: `pnpm typecheck` and `pnpm lint` exited 0; `scripts/remote-test.sh unit` passed 2,415 tests (1 skipped); `scripts/remote-test.sh integration apps/observer` passed 18 database integration tests. No task failures remain.

## Task 2 — isolated read proxy

RED: ObserverEnv test rejected missing O2 password; new proxy module did not exist; production network/credential tests, production-rules test and the new host-script dry-run test failed against the old configuration.

Implementation: one image, two commands. The proxy reuses `createO2Query`, `checkSql` and `checkPromql`; wire schemas, stream allowlist and bounded table contract live once in contracts. Observer's env and runtime hold only the internal proxy URL. The credential remains in the proxy and the one-shot provisioning job. Proxy listens only on its observer-facing network alias; it cannot be reached on its shared O2-facing interface. SQL and PromQL requests have strict schemas, ranges/points/rows/cells/timeouts and cancellation; errors never echo upstream content.

Ruling: the observer needs separate ingress as well as a private query network: the original `observe-edge` also hosts OpenObserve and would bypass the boundary. Prepare `mastertutor-observer` using the existing dry-run/operator network scripts, and mirror it in isolated local/remote stacks. Host creation/Traefik attachment remain deployment operator steps (D41/D42); no host settings were changed.

Ruling: `/query` uses the existing matrix adapter with a one-point range at the supplied timestamp, rather than duplicating vector response handling. It is a bounded instant PromQL evaluation.

Verification notes: an initial broad integration run caught an outdated external-network assertion and a test-only root package import (the production image intentionally only installs the observer dependency graph). Corrected those assertions/imports and reran the affected checks. The initial full unit run during parallel heavy work timed out in two unrelated PDF tests (`renders text-only pages too: vector drawings there can show a secret`; `reads a page of outlined text like a scanned page and counts it missing when OCR finds nothing`). Rerun with 8 workers preserves the original timeouts/assertions. A mistaken security-project filter on the unit inventory test selected no tests; the complete security suite and unit inventory are run instead.

Task 1 commit: `72d19412`.

Task 2 final verification:
- `pnpm typecheck` and `pnpm lint`: exit 0.
- `scripts/remote-test.sh unit --maxWorkers=8`: 2,421 passed, 1 skipped; both PDF timeouts cleared. The final observer/core unit run separately passed 88 tests, including HTTP cancellation and safe error handling.
- `scripts/remote-test.sh security`: 35 passed.
- Remote focused integration run: 89 passed and two test assertions failed; corrected production-overlay and image checks each passed their reruns (36 and 1 tests). All 91 selected integration tests have passing final evidence, including 18 observer database tests and 21 OpenObserve API/provisioning/dashboard/alert tests.
- `scripts/remote-test.sh observability`: exit 0, OBSERVABILITY OK; 22 checks across all five files, including real SQL through the proxy, the exact attack denied, administrator routes absent, no observer O2 secret/direct access, and no access to the proxy's O2-facing interface.
- `git diff --check`: clean.

No implementation work remains. No pushes, further merges, other-worktree changes, migrations, captured-content changes or UI changes. Deployment and its two operator network setup steps remain deferred; the runbook has the concrete previews. No actual credentials or `.env*` contents were inspected or printed by this session.
