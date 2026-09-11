# Brief: benchmark fix (one ticket)

Ticket: **{{TICKET}}** (`orchestration/benchmarks/tickets/{{TICKET}}.md`). Return your full report as your final reply;
the orchestrator persists it under `orchestration/runs/{{RUN_ID}}/` with `persist_run.py`. Do not write there yourself.

1. Read the ticket, the record it links and `orchestration/benchmarks/README.md`. The fix must be generic: nothing
   site-specific under `apps/` or `packages/` (`no-site-hacks.test.ts` enforces it). Generic cookie/consent-banner
   dismissal is the only site-adjacent behaviour allowed.
2. Reproduce the cause with a **failing test** first: a fixture page under `tests/fixtures/` with the same structural
   trait plus an agent-behaviour or unit test, or a unit test of the failing module.
3. Implement the smallest fix that makes it pass. Follow CLAUDE.md (bloat-free, security-first; no new dependency
   unless essential). Never read or print `.env`; never handle the zyBooks credential.
4. Run the gate: `pnpm typecheck && pnpm lint && scripts/remote-test.sh unit && scripts/remote-test.sh integration && scripts/remote-test.sh security && pnpm bench:mock`
   (plus `scripts/remote-test.sh e2e` when `apps/web` changed).
5. Commit with `fix(<area>): … (refs {{TICKET}})` and add the sha to the ticket.
6. Do not run real-model benchmarks or touch the bench stack; the orchestrator re-runs after review.
