# zyBooks benchmark run 2: run 387daaba (validation after F1–F4)

**Task:** notes only, reading assignment 1. Bypass mode; allowed origin learn.zybooks.com; hard budget $10.
**Outcome:** **completed by itself.** Sections 1.1–1.7 were captured in **32 steps, $5.76, 3.4 active minutes**. The agent checked that the assignment was still 148/148 and left every activity untouched.

| Metric | Run 1 (before) | Run 2 (after) |
|---|---|---|
| Input tokens per step (mean) | ~70,600 | ~17,700 |
| Notes | 1 merged note for §1.1–1.9 | 1 note per section (§1.1–§1.7), plus the assignments page |
| Duplicate blocks | 373 of 1142 | 0 duplicates from capture. The remaining repeats are zyBooks' own due-date banner, which the page shows twice |

**F1, F2, F3 and F4 are fixed in a live run.**

## New findings
| # | Finding | Severity |
|---|---|---|
| F6 | Site chrome gets into notes: the per-section "Due: …" and "due date has passed" banners, and the assignments list page itself captured as a note (bare list items "P"). These are verbatim, but they are not content. Capture should drop course-platform chrome, and a navigation-only page shouldn't become a note. | Low |
| F7 | The cached-input ratio is only 18% (103k of 568k). The prompt prefix is probably not stable enough between steps for OpenAI's cache. Cost could fall by roughly 2–4× if the prefix were stable. | Medium (cost) |
