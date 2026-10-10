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
- [x] Write failing contracts and DB tests: `expect(CaptureBrief.safeParse({keep:['reading_text'],skip:['reading_text'],scopeNote:''}).success).toBe(false)`; `expect(siteKey('https://a.github.io')).not.toBe(siteKey('https://b.github.io'))`; round-trip a run brief and assert duplicate workspace/domain upserts do not duplicate rows.
- [x] Run `scripts/remote-test.sh unit capture-intent` and `scripts/remote-test.sh integration capture-intent`; observe missing schemas/table failures.
- [x] Implement bounded strict schemas, nullable capture result noteId for skipped captures, count events, nullable/default DTO fields for historical snapshots, canonical shared PSL helper and migration 0019 with journal/snapshot consistency.
- [x] Run `pnpm typecheck`, `pnpm lint`, `scripts/remote-test.sh unit packages/contracts packages/db apps/agent/src/browser`, and `scripts/remote-test.sh integration packages/db`.
- [x] Commit explicit Task 1 paths with `feat(contracts): define capture intent and site preferences` and co-author trailer.

## Task 2: Intent initialization, person-only question and preference service
**Files:** create apps/agent/src/capture/intent-model.ts and intent-model.test.ts; create apps/agent/src/loop/capture-intent.ts and capture-intent.int.test.ts; modify library.ts, loop/hooks.ts, run-loop.ts, run-state.ts, turn-context.ts, worker.ts and worker.int.test.ts; modify tests/llm-mock/src/server.ts and packages/contracts/src/api/contract.ts; create apps/web/lib/server/runs/capture-intent.ts (service integration coverage lives in loop/capture-intent.int.test.ts); modify runs/service.ts, rpc/runs.ts and rpc/settings.ts; modify lib/fixtures/router.ts.
**Interfaces:** createIntentModel(openai).derive(goal, preferences, {step,signal}); initializeCaptureIntent(db,model,run,step,signal,mask); prepareCapture hook returns brief/question; setCaptureBrief(db,scope,input) authenticated person answer/edit; list/set preferences scoped by workspace.
- [x] Write failing intent request tests with fake stateless client and llm-mock integration: strict JSON, bounded/redacted input, usage charged even invalid output, explicit goals override defaults.
- [x] Write DB/loop tests in all three modes: before first observation ambiguous input creates one question; subsequent step/restore remains waiting; mode switches and Resume leave question pending; a person answer clears it, saves defaults, and a live TurnContext emits a brief delta.
- [x] Run `scripts/remote-test.sh unit intent-model` and `scripts/remote-test.sh integration capture-intent`; observe missing initializer/service behavior.
- [x] Implement the hook before observation, atomic brief/question/usage events, scoped person answer/upsert, and D56 brief/preference facts plus planUpdate instructions. Reuse existing notifyRunWake and lease-aware StepStore commits. Repeated tasks use saved defaults; incompatible sites still ask once.
- [x] Run `pnpm typecheck`, `pnpm lint`, `scripts/remote-test.sh unit apps/agent apps/web/lib/server`, and `scripts/remote-test.sh integration capture-intent turn-context run-loop`.
- [x] Commit explicit Task 2 paths with `feat(agent): derive capture scope and wait for person answers` and co-author trailer.

## Task 3: Verbatim selection and source titles
**Files:** create apps/agent/src/capture/selection.ts and selection.test.ts; create tests/fixtures/sites/site/capture/intent-capture.html; modify capture/capture-tool.ts, library.ts, capture/page/extract.ts, video/source.ts, video/video-tool.ts and video/video-tool.behaviour.test.ts; create capture/model-budget.ts; modify capture-tool.behaviour.test.ts and chrome.behaviour.test.ts, and capture/persist-capture.int.test.ts; modify contracts/tools.ts and api/contract.test.ts and llm-mock/server.ts. Title coverage lives in chrome.behaviour.test.ts.
**Interfaces:** createSelectionModel(openai).select(brief, blocks, options) returns IDs; selectBlocks preserves original objects/order, counts, skips unknown IDs; persistCapture returns skipped null noteId if empty.
- [x] Write failing selection tests: a run-5 synthetic widget fixture has repeated due banners and verbatim prose; fake IDs are duplicate/reversed/unknown and only original prose is kept in order. Overview selection yields no note; injection previews cannot return text; final window is reviewed; cap stops next call; billed failures charge usage.
- [x] Write failing extraction title test with generic/stale document.title and visible main heading; no heading falls back.
- [x] Run `scripts/remote-test.sh unit selection` and `scripts/remote-test.sh behaviour chrome`; observe missing selection/title behavior.
- [x] Implement bounded ID-only strict luna selection using shared factory, masked previews, budget accounting and fail-closed errors. Screen before selection; apply it at shared persistence, emit counts, clear filtered lede, suppress empty note/upload. Prefer main heading deterministically, retain structural prefilter.
- [x] Run `pnpm typecheck`, `pnpm lint`, `scripts/remote-test.sh unit apps/agent packages/contracts`, `scripts/remote-test.sh integration persist-capture`, `scripts/remote-test.sh behaviour capture chrome`.
- [x] Commit explicit Task 3 paths with `feat(capture): select intent-matching blocks verbatim` and co-author trailer.

## Task 4: Accessible brief/question UI and final verification
**Files:** create apps/web/components/capture/brief-editor.tsx, brief-editor.test.ts and run-capture-scope.tsx; create components/settings/capture-preferences.tsx; modify settings/settings-view.tsx, new-task/new-task-form.tsx, run/run-view.tsx, run/model/run-model.ts, run-model.test.ts and run/thread/thread-body.tsx; modify lib/fixtures/router.ts, router.test.ts, types.ts and seed.ts; create apps/web/e2e/capture-intent.spec.ts; modify styles/run.css for wrapped accessible chips; modify eslint.config.js to classify only the fixture RPC router as server code. Review additions: packages/contracts/src/capture-intent.ts shares the scope limit and marks schema constructors pure; capture/brief.ts and selection.ts share redaction; capture-intent.ts, run-loop.ts and library.ts remember confirmed scope for later sites; runs.ts, grants.sql and migration 0020_capture_confirmed_at with journal/snapshot; corresponding capture-intent integration tests; worker.int.test.ts gates the fake idle clock to keep the scope wait observable. Update exhaustive probes in rpc/router-parity.int.test.ts and e2e/stack/specs/api-conformance.spec.ts; reconcile tests/compose/compose-config.int.test.ts with the existing Observer DB network. Lazy-load capture editors; refresh /new visual goldens and three first-load baselines to measured pre-D57 sizes (budget remains 6 kB).
**Interfaces:** BriefEditor uses shared CaptureBrief choices and explicit save; RunModel retains brief/question across SSE and reload; CapturePreferences uses settings RPC. Brief edits save site defaults through runs.setCaptureBrief.
- [x] Write failing reducer and editor tests: ask/answer events retain/clear exactly one question; overlap-free chips and free text; pending errors keep draft. Playwright verifies keyboard changes, solid content and no overflow at 390/820/1440 light/dark.
- [x] Run `scripts/remote-test.sh unit brief-editor run-model` and `scripts/remote-test.sh ui capture-intent`; observe absent UI.
- [x] Implement solid inline question/brief editor in the run view (available with thread), Settings preferences, and /new explanatory copy. Use labels, aria-pressed chips, 44px targets, existing motion/tokens and escaped text. No glass content, no extra dependency.
- [x] Test the late-source case and mask person-edited scope before model input/checkpoints; preserve newer Settings edits and avoid repeated hot-path writes.
- [x] Run `pnpm typecheck`, `pnpm lint`, `scripts/remote-test.sh unit apps/web`, `scripts/remote-test.sh ui capture-intent`, relevant integration tests, then `scripts/remote-test.sh all`. Fix failures caused by D57; document unrelated failures with evidence.
- [x] Commit explicit Task 4 paths with `feat(web): edit capture scope and site preferences` and co-author trailer.

## Completion report
List each task commit SHA, RED/GREEN and regression results, deviations from exact file seams and unresolved work. Do not claim suites passed without their observed exit status. Do not push or merge.

## Verification adjustment
The clean pre-D57 revision bfaebbc4 already exceeded the Audit/Vault first-load guard (392.2/395.9 kB); its run page was 409.0 kB, within 0.2 kB of the old limit. A separate CI source archive measured those sizes without modifying any worktree. Rebase only those three route baselines to those pre-D57 measurements, preserving the 6 kB limit. Lazy-loaded D57 controls add 1.6 kB to the run route. Refresh /new goldens for the intentional explanatory copy change. The initial full UI run had one takeover motion paint failure; the focused motion suite subsequently passed. Final `scripts/remote-test.sh all` exited 1: 2479 unit, 809 integration, 35 security, 70 E2E and 8 observability tests passed; build, image (6 checks), smoke (12 checks) and canary scans passed. Behaviour had 345 passes and two failures; UI had 1375 passes and one failure; bench-mock failed discovery interaction grading. Focused D57 UI coverage passed all 25 tests.

Remaining failures, with observed evidence:
- Navigation `sso-other` bypass/auto scenario: mock expected bypass wording absent. The focused scenario also fails on clean pre-D57 source bfaebbc4.
- Takeover motion: one paint under full-suite load. Focused current motion tests pass; clean pre-D57 full UI reproduces the one-paint failure under concurrent load and passes in isolation. Motion implementation and thresholds are unchanged.
- ComputerExecutor `/widget.html?swap=15` positive control: zero Cancel clicks; zero Delete clicks satisfies its safety assertion. This direct executor test does not invoke intent capture, and earlier full runs passed with the same product code. The timing failure remains unresolved.
- Benchmark discovery interaction grading: incomplete main-run question/animation evidence. Two earlier full runs passed with the same product code, and clean pre-D57 bench-mock passed. The final intermittent failure remains unresolved; no claim that it is proven inherited.

All failures caused by D57 found during verification were fixed: API inventories, intentional visual goldens, scope-wait fake-clock race, and the existing Observer network expectation. No timing thresholds, retries or safety assertions were weakened. Temporary parent source archives were removed; no other worktree was touched.
