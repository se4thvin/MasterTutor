# D56/D57 capture regression fixes

Follow the Global Constraints and Review Focus in [the merged intent-capture plan](2026-10-10-intent-capture.md). The user's regression specification supersedes that plan/spec's wording that the browsing model should exclude skipped categories itself. The capture pipeline owns block selection; kept text remains verbatim (D54). No migration or UI change is needed.

Execute in order, test-first. After every task run `pnpm typecheck`, `pnpm lint`, remote agent unit tests and relevant remote DB integration tests, then commit with explicit paths and the Codex co-author trailer. No push, merge, stash, credentials, `.env*` reads or other worktrees.

1. Test both instruction profiles and llm-mock turn context (including compaction), then clarify whole-section/page capture and system-owned keep/skip selection. Prohibit selector filtering, DevTools, view-source and DOM inspection for finding content.
2. Test executor refusal and zero keyboard dispatch for F12, CTRL+SHIFT+I/J/C/K and CTRL+U, including normalized aliases and active omnibox; implement before browser dispatch. Preserve useful shortcuts.
3. Test element capture's `selector_not_found` feedback; suggest page capture and system selection while preserving the typed error.
4. Add llm-mock run regression with skip-activities/chrome brief. Verify explicit page-level capture calls, no DevTools keys, real persisted capture and verbatim kept text. Verify remote unit/integration and capture behaviour suites. Report each task SHA, results and deviations.
