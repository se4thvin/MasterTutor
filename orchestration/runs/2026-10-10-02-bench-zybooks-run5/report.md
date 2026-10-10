# zyBooks benchmark run 5: run bb867f19 (F6 refined, still not effective live)

**Task:** notes only on assignment 1, budget $10. **Result:** completed in 36 steps for **$3.15**, cached input 56%. Notes are one per section and in order.

- **F6 is still open.** Both refined generic rules pass their fixtures but match nothing on the live zyBooks DOM: the 24 due-date banners and the Assignments overview note remain. Fixtures written from a description do not reproduce the real structure. The next fix needs the real section DOM. Keep it **local only and never committed** (it is the user's licensed course content); test the rules against it, then distil a synthetic fixture that has the same structure.
- **New, F10 (regression to check):** the §1.4 note is titled "zyBooks" rather than "Section 1.4 - …". The title comes from the document title at capture time, which on a SPA can be stale or generic. Prefer the main heading when the document title is generic.

Severity: both are cosmetic. The full task already completes end to end (run 3).
