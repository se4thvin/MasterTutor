# Observer Track C security fixes

Scope: the independent MERGE-AFTER-FIXES review's two P1 findings, in order.

Ruling: the explicit requested integration merge is the sole exception to the no-merge rule. A pre-existing remote-test lock patch was preserved outside the repository, then reapplied after merging; integration already contained it and the resulting file was clean.

Ruling: C2's regex SQL guard and in-process OSS admin credential are superseded by the security-fix request. Use a strict tokenizer for the restricted SELECT envelope (standard doubled single/double quotes, balanced expressions, a single unqualified source); no SQL dependency is needed. Source validation precedes query execution and any trusted result.

No migrations, captured content or UI changes are required. The plan's old migration/cache-retention guidance is superseded by the user's current instructions and D52/D54/D55.

## Task 1 — SQL stream confinement

RED: remote SQL regression suite failed three tests, including the reviewer's exact quoted-alias/comma-source exploit and malformed quotes.
GREEN: remote observer unit suite passed 36 tests before adding the tool-level no-query/no-result regression. Root typecheck and lint passed. Final remote unit/integration results recorded below when complete.

Task 1 final verification: `pnpm typecheck` and `pnpm lint` exited 0; `scripts/remote-test.sh unit` passed 2,415 tests (1 skipped); `scripts/remote-test.sh integration apps/observer` passed 18 database integration tests. No task failures remain.
