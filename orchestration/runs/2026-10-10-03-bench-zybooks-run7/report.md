# zyBooks benchmark run 7: run e96085b3 (D57 intent-driven capture, after F11)

**Task:** notes only on assignment 1, budget $10. **Result:** completed in 30 steps for **$2.13**, cached input 56%.

**Brief (derived by itself, no question needed):**
- keep: reading_text, definitions, figures, tables, worked_examples
- skip: activities, due_dates, scores, navigation, platform_chrome

| Check | Run 5 (before D57) | Run 7 |
|---|---|---|
| Due banners and scores in notes | 24 | **0** |
| Assignments overview saved as a note | yes | **no** |
| Note titles | "Section 1.x - CE 2310…", and one titled "zyBooks" | **"1.x <section heading>"** (F10 fixed) |
| Duplicate blocks | banner repeats | **0** |
| Cost | $3.15 | **$2.13** |

Recall spot check: in §1.5 the agent kept the heading and the reading paragraph, and dropped "Students/Activities/P/C", both due banners, "How was this section?" and the three interactive-activity placeholders (activities are skipped by the brief). Every kept block is the original verbatim block (D54).

**F6, F10 and F11 are fixed live.** Run 6 (edff512f, cancelled at $1.07) was the F11 regression: the model tried to filter with selectors and DevTools. It was fixed by system-owned selection plus a DevTools key guard.
