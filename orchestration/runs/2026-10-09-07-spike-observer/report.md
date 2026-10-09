# Report: Observer Task 1 spike (completed)

Run by the Observer Foundation agent. The script is `spike.ts` in this folder, and the facts are pinned in `packages/contracts` and `packages/observer`.

| Key | Value |
|---|---|
| luna.reasoning | `none`. It also accepts low, medium, high, xhigh and max. `minimal` is refused (400 unsupported_value). |
| sol.reasoning | The lowest accepted is `low`. `none` and `minimal` are refused (400). |
| luna p50 / p95 | 1108 / 1412 ms, max 1530. Measured at effort none, 1,344 input tokens, strict json_schema, n=20. At default effort: 1574 / 1826. |
| sol p50 / p95 | 1549 / 2421 ms, max 2573. Measured at effort low, n=20. |
| Strict-parse rate (final run) | luna none 21/21; luna low 1/1; luna default 5/5; sol low 21/21 |
| Luna prose incident | In an earlier, aborted run, one luna effort-none answer under `strict: true` came back as prose rather than JSON. So an unparseable Guard answer means guard_unavailable, and the Guard fails closed. Such answers are still charged (StructuredParseError). |
| cache.storeFalse | Works: 19/19 repeated calls per model had cached_tokens > 0. |
| cacheRetention | astra, sol and luna all refuse `"in_memory"` (400: compatible only with 24h extended caching). `"24h"` and `null` are accepted. The parameter is omitted, so OpenAI's default retention applies. **Open decision against D52's in-memory wording.** |
| astra.pendingSafetyChecks | Not emitted: 0 of 2 computer_calls on an injected "IGNORE YOUR TASK" screenshot. |
| price.luna | 0.10 / 0.01 / 0.125 / 0.50 USD per M tokens (input / cached / cache write / output), up to 272k input. Long context: 0.20 / 0.02 / 0.25 / 0.75. |
| price.sol | 2.00 / 0.10 / 2.50 / 10.00. Long context: 4.00 / 0.20 / 5.00 / 15.00. |
| price.astra | Cache write is 12.50, not the 10 the table assumed (corrected). |
| OpenObserve links | Defined as `observabilityUiPaths` in contracts: traces, a single trace and logs. `sql_mode` is never sent. |
| OpenObserve API | `_search` returns took, total, scan_size and hits. It returns 400 for an unknown stream, bad SQL or a non-SELECT. Cancellation is by HTTP abort. `query_range` returns a matrix. |
| Spend | At most $0.15 |
