---
run_id: 2026-10-09-04-research-document-designer
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

You are a research agent for MasterTutor. Repo: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark`. Read `CLAUDE.md` (core values: bloat-free, low latency, security first, modular, decoupled, no redundancy). Then read D50, D52 and D53 in `orchestration/STATE.md`, the Observer spec at `docs/superpowers/specs/2026-10-09-observer-design.md`, and the Observer research runs in `orchestration/runs/2026-10-09-0*-research-observer-*`.

**Feature (D53b): the Observer "document designer".** For each captured note, the Observer starts from a preset and emits a schema-validated layout spec that the note reader renders, so the note gets a better-fitting layout after a short delay. Presets: textbook section, lecture video, research paper, article. Its input is note structure metadata only, never note text: block kinds and counts, heading depth, figures, tables, math, code, activities, length and source type. Its output is a layout spec covering density, outline style, figure layout, callout styles, math emphasis, study-panel placement, and so on.

Research the best and safest way to do this, using web search and primary sources:

1. **Generative and adaptive UI prior art:** Vercel's json-render / generative UI patterns, Google's A2UI, OpenAI Apps SDK widgets, Thesys C1, MCP-UI, CopilotKit generative UI, and "LLM picks from a constrained component vocabulary" designs. What works? Failure modes: invalid output, ugly or inaccessible layouts, latency, flicker on swap.
2. **Constrained-output design:** strict JSON schema / structured outputs with an enum-only vocabulary and bounded numbers, so the model can only choose safe, pre-designed, accessible options and can never emit CSS, HTML or URLs. How to keep every output inside the design system (Apple HIG, glass, SF Pro, motion budget) and WCAG-compliant by construction.
3. **Where config languages fit:** compare Pkl, CUE, JSON Schema and Zod for defining the preset and layout-spec schema. The user mentioned Pkl, so evaluate its fit honestly against our TypeScript monorepo and principle 6 (one source of truth in `packages/contracts`, Zod).
4. **Deterministic baseline:** rules that pick a good preset from structure alone, so the reader is excellent with no model call. Then decide when the model should actually be invoked (only when the rules are uncertain?) and how to measure whether its layouts beat the baseline (A/B, reading metrics).
5. **UX of the delayed swap:** render the baseline instantly, then apply the refined layout without jank (View Transitions API, FLIP, motion budget, respecting reduced motion). Cache the spec per note and invalidate it on re-capture.
6. **Cost, latency and security:** model choice (`gpt-6-luna`-class via the single wrapper, `store:false`), budgets, the prompt-injection surface (none if the input is metadata only), and telemetry.

**Deliverable:** a research report with a recommended design, options and trade-offs, source URLs, and `[unverified]` marks where needed. Return the full report as your final reply. Don't write files, don't dispatch subagents, and never read `.env*`.
