---
run_id: 2026-10-05-22-plan-b2-b4-b5
date: 2026-10-05
agent_type: general-purpose
phase: plan
status: completed
depends_on: []
---

Repo: /Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark. Read `orchestration/briefs/plan-writer-common.md` first; it applies to you in full.

Your phases are **B2 Capture + notes**, **B4 Video** and **B5 PDF** (spec §7, §8, §16).

**B2 Capture + notes**
- The snapshot step: MHTML plus a full-page capture.
- Page preparation, with Defuddle running in a CDP isolated world and Readability as the fallback.
- Assets: srcset images, SVG, canvas, and element shots.
- Verification: coverage, anchors, text fragments.
- The `capture` and `annotate` tools.
- `NoteWriter`, folders, and auto-filing with `gpt-6-luna`.
- Embeddings and the hybrid search API.
- Obsidian Markdown export.
- Phase 0 left a decision open about object reads, since Garage is internal-only. Decide it here; proxying through `web` is the likely choice.

**B4 Video**
- `captions` via timedtext capture.
- `chapters`.
- `keyframes` with a pHash computed in `sharp`.
- `transcribe` via remote PulseAudio, `ffmpeg` in `agent` and `gpt-4o-transcribe-diarize`. Phase 0 notes say the slot reserves port 4713 for this.

**B5 PDF**
- The pdf.js path.
- The docling-serve compose profile.

Fixtures: fill in the article/docs, YouTube-fake and PDF fixture sites. Assume B1 provides `BrowserSession`, the tool registry `Tool<A,R>`, and the step transaction. Name the exact B1 interfaces you consume. B1's plan is being written in parallel, so define the seams you need explicitly.

The orchestrator will save your final reply to `docs/superpowers/plans/2026-10-05-phase-b2-b4-b5-capture-video-pdf.md`.
