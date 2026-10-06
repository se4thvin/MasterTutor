---
run_id: 2026-10-05-25-plan-f3-f5
date: 2026-10-05
agent_type: general-purpose
phase: plan
status: completed
depends_on: []
---

Repo: /Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark. First read `orchestration/briefs/plan-writer-common.md`; it applies to you in full. You are a frontend expert. Use the `anthropic-skills:apple-hig-designer` skill.

Your phases are **F3, New task + Run view**, and **F5, 3D hero** (spec §10.4, §11, §16).

Design sources:
- `design/mock-d-apple.html`, its run view and mock browser. Read it.
- Run 13's mock-browser spec in `orchestration/runs/2026-10-05-13-research-chatgpt-browser-ui/report.md`.
- `design/hero-3d-prototype.html`. Port this to raw `three`, per the spec's 3D hero section.

F3 scope:
- **New task composer:** source chips, the 01/02/03 options including `approvalMode` and a target folder, ⌘↵ to submit, and the `hero:*` events.
- **Run view mock browser:** overlays above the n.eko iframe, with an iframe stub in tests. Origin pill and "filled securely" badge. Agent cursor that moves along an arc and pulses on click. Caption.
- **The 7 states and the takeover transition:** optimistic `runs.takeControl`, revert after a 2s timeout, and hand back with a note.
- **Full screen** using `keyboard.lock`.
- **Timeline:** StatusMark, ThoughtLine and CountUp budgets, with replay.
- **Approval spotlight sheet:** Deny / Edit / Approve, with keyboard shortcuts.
- **CodeSlots OTP card:** including its security review.
- **Message composer.**
- **PiP.**
- **SSE client:** consumes `GET /api/runs/:id/events` with `Last-Event-ID`.
- **Responsive layouts:** bottom sheets at ≤820px.

Build F3 against the Phase 0 contracts with a recorded `RunEvent` stream fixture. Assume F1 provides tokens, motion-tokens, `Icon`, glass and the app shell. Its plan is being written in parallel, so name the exact F1 exports you consume.

Tests: Playwright at 5 breakpoints, plus overflow and axe checks.

Your final reply will be saved to `docs/superpowers/plans/2026-10-05-phase-f3-f5-run-view-hero.md`.
