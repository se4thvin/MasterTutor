# Intent-driven Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement D57 without changing captured source text.

**Architecture:** Shared validated contracts and run persistence feed one intent initializer and ID-only capture selector. A dedicated person-only scope question uses the existing wait lifecycle, with authenticated answer/edit endpoints. D56 carries live brief changes into planning.

**Tech Stack:** TypeScript, Zod 4, Drizzle/Postgres, OpenAI stateless factory, Next.js/React/oRPC, Vitest and Playwright.

**Spec:** docs/superpowers/specs/2026-10-10-intent-capture-design.md

## Global Constraints
- Follow CLAUDE.md: bloat-free, low latency, security first, modular, decoupled, one source of truth.
- One self-hosted Docker Compose app; OpenAI is the only paid service.
- D54/D55: selection returns IDs only; source text, anchors and order never come from model output.
- D38: the shared stateless OpenAI factory, store:false, strict JSON, no identifiers, no hosted state, masked minimal previews.
- Tests use llm-mock or injected fakes, never real OpenAI; all suites run through scripts/remote-test.sh.
- Never read .env* files, print secrets, write credentials, push, merge, stash or touch another worktree.
- Apple HIG: keyboard-accessible choices, clear labels, solid content surfaces; glass only for chrome and floating layers.
- Commit after each task using explicit paths and the Codex co-author trailer.

## Review Focus
1. Empty selection must not create an empty note or retain a due-banner description (Task 3).
2. Mode switch, takeover, restore or generic Resume must never answer scope or bypass its wait (Task 2).
3. Private PSL tenants and workspaces must never share defaults; explicit goals override defaults (Tasks 1–2).
4. Unknown IDs, injection text, duplicate/reordered IDs and late windows cannot rewrite/drop unreviewed content (Task 3).
5. Mid-run editing and narrow-screen keyboard input must preserve choices and refresh turn context (Tasks 2–4).

## Task 1: Contracts, site identity and migration
**Files:** create packages/contracts/src/capture-intent.ts and capture-intent.test.ts; modify index.ts, events.ts, tools.ts, api/dto.ts, api/contract.ts; create packages/contracts/src/server/site.ts; modify agent browser/navigation-scope.ts; modify packages/db/src/schema/runs.ts and workspace.ts; create migrations/0019_intent_capture.sql and meta/0019_snapshot.json, modify meta/_journal.json; create packages/db/src/capture-intent.int.test.ts.
**Interfaces:** CaptureBrief, CaptureIntent, CaptureQuestion, CaptureSelection, SetCaptureBriefInput and SitePreference; siteKey(url): string; runs.captureBrief/captureQuestion; capturePreferences workspace/domain primary key. RPC runs.setCaptureBrief and settings.capturePreferences/setCapturePreference.
- [ ] Write failing contracts and DB tests: `expect(CaptureBrief.safeParse({keep:['reading_text'],skip:['reading_text'],scopeNote:''}).success).toBe(false)`; `expect(siteKey('https://a.github.io')).not.toBe(siteKey('https://b.github.io'))`; round-trip a run brief and assert duplicate workspace/domain upserts do not duplicate rows.
- [ ] Run `scripts/remote-test.sh unit capture-intent` and `scripts/remote-test.sh integration capture-intent`; observe missing schemas/table failures.
- [ ] Implement bounded strict schemas, nullable capture result noteId for skipped captures, count events, nullable/default DTO fields for historical snapshots, canonical shared PSL helper and migration 0019 with journal/snapshot consistency.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `scripts/remote-test.sh unit packages/contracts packages/db apps/agent/src/browser`, and `scripts/remote-test.sh integration packages/db`.
- [ ] Commit explicit Task 1 paths with `feat(contracts): define capture intent and site preferences` and co-author trailer.

## Task 2: Intent initialization, person-only question and preference service
**Files:** create apps/agent/src/capture/intent-model.ts and intent-model.test.ts; create apps/agent/src/loop/capture-intent.ts and capture-intent.int.test.ts; modify library.ts, loop/hooks.ts, run-loop.ts, run-state.ts, turn-context.ts; create apps/web/lib/server/runs/capture-intent.ts and capture-intent.int.test.ts; modify runs/service.ts, rpc/runs.ts and rpc/settings.ts; modify lib/fixtures/router.ts.
**Interfaces:** createIntentModel(openai).derive(goal, preferences, {step,signal}); initializeCaptureIntent(db,model,run,step,signal,mask); prepareCapture hook returns brief/question; setCaptureBrief(db,scope,input) authenticated person answer/edit; list/set preferences scoped by workspace.
- [ ] Write failing intent request tests with fake stateless client and llm-mock integration: strict JSON, bounded/redacted input, usage charged even invalid output, explicit goals override defaults.
- [ ] Write DB/loop tests in all three modes: before first observation ambiguous input creates one question; subsequent step/restore remains waiting; mode switches and Resume leave question pending; a person answer clears it, saves defaults, and a live TurnContext emits a brief delta.
- [ ] Run `scripts/remote-test.sh unit intent-model` and `scripts/remote-test.sh integration capture-intent`; observe missing initializer/service behavior.
- [ ] Implement the hook before observation, atomic brief/question/usage events, scoped person answer/upsert, and D56 brief/preference facts plus planUpdate instructions. Reuse existing notifyRunWake and lease-aware StepStore commits. Repeated tasks use saved defaults; incompatible sites still ask once.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `scripts/remote-test.sh unit apps/agent apps/web/lib/server`, and `scripts/remote-test.sh integration capture-intent turn-context run-loop`.
- [ ] Commit explicit Task 2 paths with `feat(agent): derive capture scope and wait for person answers` and co-author trailer.

## Task 3: Verbatim selection and source titles
**Files:** create apps/agent/src/capture/selection.ts and selection.test.ts; create tests/fixtures/site/intent-capture.html; modify capture/capture-tool.ts, library.ts, capture/page/extract.ts; modify capture-tool.behaviour.test.ts and chrome.behaviour.test.ts; add tests to web-capture.test.ts or page-functions.test.ts as appropriate.
**Interfaces:** createSelectionModel(openai).select(brief, blocks, options) returns IDs; selectBlocks preserves original objects/order, counts, skips unknown IDs; persistCapture returns skipped null noteId if empty.
- [ ] Write failing selection tests: a run-5 synthetic widget fixture has repeated due banners and verbatim prose; fake IDs are duplicate/reversed/unknown and only original prose is kept in order. Overview selection yields no note; injection previews cannot return text; final window is reviewed; cap stops next call; billed failures charge usage.
- [ ] Write failing extraction title test with generic/stale document.title and visible main heading; no heading falls back.
- [ ] Run `scripts/remote-test.sh unit selection` and `scripts/remote-test.sh behaviour chrome`; observe missing selection/title behavior.
- [ ] Implement bounded ID-only strict luna selection using shared factory, masked previews, budget accounting and fail-closed errors. Screen before selection; apply it at shared persistence, emit counts, clear filtered lede, suppress empty note/upload. Prefer main heading deterministically, retain structural prefilter.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `scripts/remote-test.sh unit apps/agent packages/contracts`, `scripts/remote-test.sh integration persist-capture`, `scripts/remote-test.sh behaviour capture chrome`.
- [ ] Commit explicit Task 3 paths with `feat(capture): select intent-matching blocks verbatim` and co-author trailer.

## Task 4: Accessible brief/question UI and final verification
**Files:** create apps/web/components/capture/brief-editor.tsx and brief-editor.test.ts; create components/settings/capture-preferences.tsx; modify settings/settings-view.tsx, new-task/new-task-form.tsx, run/run-view.tsx, run/model/run-model.ts and run-model.test.ts; modify lib/fixtures/router.ts; create apps/web/e2e/capture-intent.spec.ts; modify styles/run.css only if existing utility classes cannot express layout.
**Interfaces:** BriefEditor uses shared CaptureBrief choices and explicit save; RunModel retains brief/question across SSE and reload; CapturePreferences uses settings RPC. Brief edits save site defaults through runs.setCaptureBrief.
- [ ] Write failing reducer and editor tests: ask/answer events retain/clear exactly one question; overlap-free chips and free text; pending errors keep draft. Playwright verifies keyboard changes, solid content and no overflow at 390/820/1440 light/dark.
- [ ] Run `scripts/remote-test.sh unit brief-editor run-model` and `scripts/remote-test.sh ui capture-intent`; observe absent UI.
- [ ] Implement solid inline question/brief editor in the run view (available with thread), Settings preferences, and /new explanatory copy. Use labels, aria-pressed chips, 44px targets, existing motion/tokens and escaped text. No glass content, no extra dependency.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `scripts/remote-test.sh unit apps/web`, `scripts/remote-test.sh ui capture-intent`, relevant integration tests, then `scripts/remote-test.sh all`. Fix failures caused by D57; document unrelated failures with evidence.
- [ ] Commit explicit Task 4 paths with `feat(web): edit capture scope and site preferences` and co-author trailer.

## Completion report
List each task commit SHA, RED/GREEN and regression results, deviations from exact file seams and unresolved work. Do not claim suites passed without their observed exit status. Do not push or merge.
