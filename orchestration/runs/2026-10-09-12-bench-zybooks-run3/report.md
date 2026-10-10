# zyBooks benchmark run 3: run 02544282 (full task, notes only)

**Task:** reading assignments 1–5, notes only, as the user chose after run 1. Bypass mode; allowed origin learn.zybooks.com; hard budget $45.
**Outcome:** **COMPLETED by itself.** 98 steps, **$22.10**, 15.1 active minutes, cached input **48%** (1.59M of 3.29M).

## Coverage
| Assignment | Sections captured | Score (unchanged) |
|---|---|---|
| 1 | 1.1–1.7 | 148/148 |
| 2 | 1.9–1.16 | 172/172 |
| 3 | 2.1–2.8 | 0/194 (past due; no activity submitted, per the user) |
| 4 | 4.1–4.5 | 165/165 |
| 5 | 4.4, 4.6–4.8 | 122/122 |

That makes 31 section notes, one per section, in source order. No activity was answered or submitted, and no extension was requested. The agent re-checked the scores at the end, and every one is unchanged.

## Loop summary (runs 1→3)
| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Scope | A1–A5 | A1 | A1–A5 |
| Result | cancelled at $47.62, §1.1–1.9 only | completed | **completed** |
| Input per step | ~70.6k | ~17.7k | ~33.6k |
| Cached share | 44% | 18% | 48% |
| Notes | one merged note with 373 duplicate blocks | one per section | one per section |

## Open findings (not blocking)
- **F6:** site chrome in notes (due banners; the "Assignments" overview page captured with "- P / C" list noise). The remaining repeated blocks inside sections are those banners. A fix is in progress on `bench-f67`.
- **F7:** the cache share is still below what a stable prefix would give. A fix is in progress on `bench-f67`.
- **F8:** the agent flagged that "some diagrams and math may not be fully" captured. The notes hold 19 image blocks and 6 math blocks across 31 sections, and 5 blocks are unverified. Audit figure and MathJax capture on zyBooks (activities are interactive SVG/canvas).
- **F9:** the final step caption is cut off at about 300 characters, so the summary is incomplete in the UI and events. Show the full text, or link to it.
