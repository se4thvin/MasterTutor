# zyBooks benchmark run 1: run 39c06816 (2026-10-09)

**Task:** reading assignments 1–5 in UTDALLASCE2310EE2310AkourFall2026, run in Bypass mode with the vault login. After the first pause the user narrowed it to notes only: no activity submissions, no extension request.
**Stack:** local prod-like app (localhost:18080) running model gpt-6-astra. The agent container was stale: it was built at 20:55Z, before the D56 merge at 20:57Z.
**Outcome:** cancelled by the orchestrator at **$47.62** (the cap is $45–50 per run, D46). By then: 92 steps, 13.9 active minutes, and Chapter 1 §1.1–§1.9 read.

## What worked
- The goal URL became the run's source. The agent signed in from the vault with no manual sign-in and no start-up stall (the fixes from run fd46ae6e held).
- It read the assignment overview correctly: assignments 1, 2, 4 and 5 already had full points, and assignment 3 was 0/194 and past its 18 Sep deadline. It paused for a person instead of submitting late work, which was correct.

## Failures
| # | Failure | Evidence | Severity |
|---|---|---|---|
| F1 | **Context and cost grow quadratically.** read_page text and screenshots stay in context. Input per step reached about 150k tokens, and the cache hit rate was only 44%. | 6.49M input tokens over 92 steps; $0.86 at step 11, $13.8 at step 51, $47.4 at step 91. | Blocker: the whole task would cost over $500 |
| F2 | **Notes merged and duplicated.** Every section §1.1–§1.9 went into ONE note titled "Section 1.1". Headings are out of order (Figure 1.2.1 sits after §1.3; §1.6 figures after §1.7), and 373 of the 1142 blocks are duplicates (769 distinct content hashes). | notes and note_blocks for the run | High: faithful 1:1 notes broken |
| F3 | **Ineffective repetition.** The same click at (914,289) was repeated three times in a row, and CTRL+L navigation was repeated four times. | decide steps 22:58:06–22:58:33 and 23:08–23:10 | Medium (it adds cost) |
| F4 | **The local deploy left a stale agent.** `rebuild-local.sh web agent` after the D56 merge did not recreate the agent container, so the 10-minute human wait was missing and the run slept after 60 s. | container created 20:55Z, merge at 20:57Z | Medium (tooling) |
| F5 | **The watcher overshot the stop line**: it polls every 20 s, the stop line was $45, and the run ended at $47.6. A run-level max-spend of $50 should come from the run budget, not from the orchestrator. | | Low |

## Next
Fix F1–F4, rebuild the stack, and confirm the agent build time is after the merge. Then rerun notes-only on assignment 1 alone as a bounded validation, with a hard budget of $10, before going back to 1–5.
