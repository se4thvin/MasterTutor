---
run_id: 2026-10-05-25-plan-f3-f5
date: 2026-10-05
agent_type: general-purpose
phase: plan
status: completed
depends_on: []
---

# Phases F3 and F5: New Task, Run View and the 3D Hero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two phases:
- **F3:** the New task composer and the Run view. The Run view has the mock browser with overlays above the n.eko iframe, 7 states, takeover and hand back, Full screen with keyboard lock, a timeline (StatusMark, ThoughtLine, CountUp, replay), the approval spotlight sheet, the CodeSlots OTP card, a message composer, the PiP, and an SSE client. Everything runs against Phase 0 contracts and a recorded `RunEvent` fixture.
- **F5:** the 3D "Capture Lens" hero, ported to raw `three`.

**Architecture:**
- **Run view data flow.** The Run view is a client component.
  1. It loads `runs.get` and `runs.steps` over oRPC.
  2. It folds `RunEventRecord`s from `GET /api/runs/:id/events` into a pure `RunModel` reducer.
  3. It derives one of 7 `BrowserState`s from the model plus local UI flags: takeover phase, replay, connection health and live-frame retry.
- **What is pure.** All decisions live in small pure modules with unit tests: reducer, state derivation, takeover machine, copy, cursor arc, callout placement, OTP slot logic and the draft-to-`CreateRunInput` builder. The React components only render and wire.
- **Testing.** Playwright drives the real pages:
  - oRPC is intercepted at `/api/rpc/*`, using the wire format verified against `@orpc/client` 1.15.4;
  - a fake `EventSource` is injected with an init script;
  - `/live/**` and step screenshots are stubbed with a fixed frame;
  - one spec uses the real `EventSource` to prove `?after=` and `Last-Event-ID` resume.
- **F5 hero.** It is one lazily imported module, `components/hero/hero-3d-scene.ts`, built from small pure helpers. The composer talks to it only through `hero:*` window events.

**Tech Stack:**
- Next.js 16.3.8 (App Router), React 19.3 and CSS Modules over F1's Tailwind v4 tokens.
- `motion` with `LazyMotion` and `m.*` (version pinned by F1).
- `@orpc/client` 1.15.4 and `@mastertutor/contracts`.
- Vitest 5.0.3 for unit tests; Playwright and `@axe-core/playwright` from F1's setup.
- F5 only: `three` 0.170.0 and `@types/three` 0.170.0.

**Spec:** `docs/superpowers/specs/2026-10-05-agentic-notes-design.md`, §6, §9 (CodeSlots), §10 (live view and takeover), §11.2–11.5 and §16 rows F3 and F5. Decisions D1–D35 in `orchestration/STATE.md` override the spec. `CLAUDE.md` is mandatory. The Phase 0 plan `docs/superpowers/plans/2026-10-05-phase-0-foundations.md` is the source of truth for contract names. Design sources:
- `design/mock-d-apple.html` (Run view);
- `orchestration/runs/2026-10-05-13-research-chatgpt-browser-ui/report.md` §6 (mock browser);
- `design/hero-3d-prototype.html` and `orchestration/runs/2026-10-05-16-design-3d-hero/report.md` (hero).

---

## Global Constraints

**Phase 0 rules (repeated, binding)**
- ESM only. Relative imports carry the `.ts`/`.tsx` extension.
- No TypeScript `enum`, `namespace` or parameter properties (`erasableSyntaxOnly`). Type-only imports use `import type`.
- Exact dependency versions only, with no `^`. Add only the dependencies named in a step:

  | Dependency | Version | Added in |
  |---|---|---|
  | `@orpc/client` | 1.15.4 | Task 1 |
  | `@orpc/contract` | 1.15.4 | Task 1 |
  | `three` | 0.170.0 | Task 19 |
  | `@types/three` | 0.170.0 | Task 19 |

- Every domain or API type is `z.infer` of a `@mastertutor/contracts` schema. Never redeclare a contract type in `apps/web`.
- Unit tests are `*.test.ts` and run in the root Vitest `unit` project in Node. **No `.test.ts` files under `apps/web/e2e/`**, because Playwright would pick them up. Playwright files are `apps/web/e2e/*.spec.ts`.
- Commit at the end of each task, on the current branch. Never push. End every commit message with the attribution lines from your session's system reminder.
- After any `next build`, keep disk lean. Run `rm -rf apps/web/.next/cache` when a build is no longer needed.

**F1 contract (F3 and F5 consume these exact names; Task 1's gate test enforces them)**

If F1 shipped a name differently, **F1's name wins**. Rename the usage in F3 or F5; never add an alias. These are the F1 exports this plan uses:

| F1 export | Exact name / path | Used as |
|---|---|---|
| Colour tokens (CSS vars from `apps/web/styles/tokens.css`, light and dark) | `--color-bg --color-bg-2 --color-elevated --color-label --color-label-2 --color-label-3 --color-hairline --color-separator --color-fill --color-fill-2 --color-tint --color-tint-text --color-tint-wash --color-on-tint --color-signal --color-on-signal --color-signal-wash --color-ok --color-ok-wash --color-warn --color-warn-wash --color-danger --color-glass --color-scrim` | `var(--…)` in CSS Modules |
| Shape, elevation, type and glass | `--radius-sm --radius-md --radius-lg --radius-xl --radius-pill --radius-frame --shadow-e1 --shadow-e2 --shadow-e3 --font-sans --font-mono --backdrop-glass --hit` | CSS Modules. `--backdrop-glass` is `saturate(180%) blur(24px)`, or `none` under `prefers-reduced-transparency` (where `--color-glass` is opaque) |
| Optional shell inset | `--shell-bottom-inset` (tab-bar height at ≤820px). F3 always writes a fallback: `var(--shell-bottom-inset, 0rem)` | Bottom sheets |
| Motion module | `apps/web/lib/motion-tokens.ts`: `spring` (`{type:"spring", stiffness:400, damping:30}`), `springSoft` (`{…260, 30}`), `durationMs` (`{micro:120, base:200, panel:300}`), `easing` (`{out:[.16,1,.3,1], in:[.4,0,1,1], cursor:[.2,.8,.2,1]}`) | TS animations |
| Generated motion CSS | `apps/web/styles/motion.css`, regenerated by `pnpm --filter @mastertutor/web gen:motion`. It emits `--spring --spring-duration --spring-soft --spring-soft-duration`, plus `--dur-<kebab key>` for every `durationMs` key and `--ease-<kebab key>` for every `easing` key | CSS timing |
| Icon | `apps/web/components/ui/icon.tsx` exports `Icon({ name: IconName; label?: string; className?: string })`. It is decorative unless given `label`. The registry `apps/web/components/ui/icons.ts` exports `icons` and `type IconName` | All icons |
| Button (shadcn) | `apps/web/components/ui/button.tsx` exports `Button`, with `variant: "default" \| "secondary" \| "ghost" \| "destructive" \| "outline" \| "link"` and `size: "default" \| "sm" \| "lg" \| "icon"`. It has the press-scale feedback built in | Buttons |
| Toast | `apps/web/components/bits/swipe-toast.tsx` exports `toast(opts: { message: string; action?: { label: string; onAction: () => void } }): void` | Optimistic feedback |
| Toolbar | `apps/web/components/shell/toolbar.tsx` exports `Toolbar({ title: ReactNode; children?: ReactNode })`, where `children` are the trailing actions | Page toolbars |
| App shell route group | `apps/web/app/(app)/layout.tsx` (shell plus auth guard). The sidebar "New task" item links to `/new` | Pages |
| Skeleton | Global CSS class `skeleton` (transform shimmer) | Loading |
| React Bits | `apps/web/components.json` has `"registries": {"@react-bits": …}`, and `apps/web/components/bits/LICENSE-react-bits` exists | Licence |
| E2E harness | `apps/web/playwright.config.ts` (`testDir: "e2e"`, web server on `baseURL`). `apps/web/e2e/support/fixtures.ts` exports `test` (with a signed-in `page`) and `expect`. `apps/web/e2e/support/qa.ts` exports `BREAKPOINTS` (`[1440,1180,1024,820,390]`), `expectNoOverflow(page)` and `expectNoSeriousAxe(page)`. The run script is `pnpm --filter @mastertutor/web e2e` | All Playwright specs |
| Lint | `pnpm lint` (ESLint, including the motion-literal rule and the `three` import restriction to `components/hero/`) and `pnpm --filter @mastertutor/web lint:css` (Stylelint, which bans raw timing functions and ms/s literals outside `motion.css`) | Every task |

**UI rules**
- **Tokens only.** No raw colour or timing values in components. Hero art colours are tokens added in Task 1.
- **Animation.** Only `transform` and `opacity` animate. Every motion honours `prefers-reduced-motion`.
- **Feedback.** Press feedback starts within 100ms. Spinners appear only in Reconnecting.
- **Units.** Sizes are in rem. Breakpoints are `73.75rem` (1180), `64rem` (1024), `51.25rem` (820) and `26.25rem` (420).
- **Targets.** 44px minimum (`--hit`).
- **Accessibility.** Every icon has a label or is `aria-hidden`. Every control is keyboard reachable. Approvals use `role="alertdialog"`. Captions use `aria-live="polite"`.
- **Shortcuts.** Never intercept browser shortcuts. Takeover has **no** shortcut (D27). The mock's `⌘⇧T` is dropped, because it is the browser's "reopen tab". Approval keys are single letters, active only when focus is not in a text field.
- **Untrusted text.** Page-derived strings (labels, captions, form summaries, URLs) are rendered as text only. They are never placed in `dangerouslySetInnerHTML`. Long values are truncated or wrapped, never overflowed.
- **Secrets.** OTP digits never reach logs, storage, the URL or the DOM after submit (§9, §11.4 #5).

**Platform values**
- Live frame: 1280×800 (`VIEWPORT`), 16:10, browser frame radius 14 (`--radius-frame`).
- Takeover confirmation timeout: **2s**. A sleeping-run takeover waits **30s**, because it must wake and lease a slot first.
- The SSE "lost" grace is 1.5s. Reconnect backoff is 500ms·2ⁿ, capped at 8s.
- Hero budget: at most 150KB gzip. DPR is capped at 2, stepping down to 1.5 and then 1.

## Review Focus

These inputs are implied by the spec, not exercised by its happy paths, and the likeliest to bite a real user. Each has a pinned test in its owning task.

1. **Duplicate or out-of-order events after a reconnect.** A `Last-Event-ID` replay overlaps the `runs.get` snapshot. Rows must not duplicate, and state must not regress. *Tests: Task 5 `run-model.test.ts` ("ignores ids at or below lastEventId"); Task 13 `sse.spec.ts`.*
2. **Rapid or double takeover clicks, and takeover while a hand back is in flight.** Expect exactly one `takeControl` RPC and no stuck "requesting". *Tests: Task 6 `takeover.test.ts` ("request while releasing is ignored"); Task 13 `takeover.spec.ts` ("double-click sends one takeControl").*
3. **Approval shortcut letters typed into the message composer or hand-back note.** These must not decide an approval, and Return must never approve. *Test: Task 14 `approval.spec.ts` ("letters typed in the composer never decide").*
4. **Hostile page strings in the approval sheet and caption.** This covers 2,000-character labels and zero-width or RTL text. The text must render inertly and never overflow the frame or the sheet at 390px. *Tests: Task 6 `approval-copy.test.ts` (truncation); Task 14 `approval.spec.ts` ("a 2,000-char label stays inside the sheet at 390px").*
5. **OTP entry variants.** This covers `"123 456"`, `"12-34-56"`, 8-digit codes, OS autofill arriving as one `input` event, and a failed submit. Each must submit the right code once, clear it, and never leave it in the DOM. *Tests: Task 10 `code-slots-logic.test.ts`; Task 15 `code-slots.spec.ts`.*

---

## File Structure

```
packages/contracts/src/
  run-stream.ts (+ run-stream.test.ts)   SSE wire format, events/screenshot paths, resume rule, id order   [Task 2]
  events.ts (modified)                   StepAction.pointer (optional) so the UI pulses only on clicks      [Task 2]
  index.ts (modified)                    export run-stream                                                 [Task 2]

apps/web/
  test/f1-contract.test.ts               gate: every F1 export F3/F5 consume                               [Task 1]
  lib/motion-tokens.ts (modified)        F3 + F5 durations/easings/hero springs                            [Tasks 1, 19]
  styles/tokens.css (modified)           cursor + hero art colour tokens                                   [Task 1]
  lib/api/client.ts (+ .test.ts)         oRPC client (`api()`, `createApiClient`)                          [Task 3]
  lib/easing.ts (+ .test.ts)             cubicBezier solver shared by cursor and hero                       [Task 8]
  components/bits/
    format.ts (+ .test.ts)               elapsed/count/token formatting                                     [Task 9]
    status-mark.tsx/.module.css          adapted React Bits StatusMark                                      [Task 9]
    thought-line.tsx/.module.css         adapted ThoughtLine (opacity, no blur/shimmer)                     [Task 9]
    count-up.tsx                         adapted CountUp (shared spring, tabular, reduced motion)           [Task 9]
    code-slots-logic.ts (+ .test.ts)     pure OTP slot logic                                                 [Task 10]
    code-slots.tsx/.module.css           adapted CodeSlots (security-reviewed)                              [Task 10]
    code-slots.security.test.ts          static security review                                              [Task 10]
  components/hero/
    hero-events.ts                       hero:* event names, emit, wait-for-capture (no three)              [Task 11]
    hero-poster.tsx, hero.module.css     CSS poster (F3) + canvas/live rules (F5)                            [Tasks 11, 19]
    hero-gate.ts (+ .test.ts)            should-load-3D decision                                             [Task 19]
    hero-3d.tsx                          poster → lazy 3D loader                                             [Task 19]
    scene/{motion,capture-timeline,lens-profile}.ts (+ tests), scene/{geometry,page-texture,studio}.ts (+ studio.test.ts) [Tasks 20–21]
    hero-3d-scene.ts                     createHero(el) → {destroy}                                          [Task 21]
  components/new-task/
    draft.ts (+ .test.ts)                sources, origins, budgets, folders → CreateRunInput                [Task 11]
    new-task-form.tsx, source-field.tsx, options-grid.tsx, new-task.module.css                              [Task 11]
  components/run/
    model/run-model.ts (+ .test.ts)      RunModel + reducer                                                  [Task 5]
    model/takeover.ts (+ .test.ts)       takeover machine                                                    [Task 6]
    model/browser-state.ts (+ .test.ts)  7-state derivation, canTakeOver                                     [Task 6]
    model/copy.ts (+ .test.ts)           captions, pills, labels                                             [Task 6]
    model/approval-copy.ts (+ .test.ts)  sheet copy per approval kind                                        [Task 6]
    model/timeline-items.ts (+ .test.ts) timeline rows, thinking row, pending messages                       [Task 6]
    model/callout.ts (+ .test.ts)        callout placement + leader                                          [Task 12]
    stream/run-events.ts (+ .test.ts)    SSE client with grace + backoff                                     [Task 7]
    stream/use-run.ts                    load + stream hook                                                  [Task 7]
    cursor/cursor-path.ts (+ .test.ts), cursor/agent-cursor.tsx/.module.css                                   [Task 8]
    use-element-size.ts, use-media-query.ts                                                                  [Tasks 12, 15]
    browser/{origin-pill,live-frame,caption,banners,fullscreen-button,step-callout,replay-scrubber}.tsx     [Tasks 12, 15]
    browser/fullscreen.ts (+ .test.ts), browser/browser-frame.tsx, browser/browser-frame.module.css          [Tasks 12, 13]
    approval/approval-sheet.tsx/.module.css                                                                   [Task 14]
    timeline/{timeline-panel,otp-card,budget-meters,message-composer}.tsx, timeline.module.css               [Task 15]
    callout-preference.ts, stop-dialog.tsx                                                                   [Task 16]
    pip/{watching.ts,run-pip.tsx,pip-dock.tsx,pip.module.css}                                                 [Task 17]
    run-view.tsx, run-header.tsx, run-view.module.css                                                         [Task 13+]
  app/(app)/new/page.tsx                                                                                      [Task 11]
  app/(app)/runs/[runId]/page.tsx                                                                             [Task 13]
  app/(app)/layout.tsx (modified)        mount <PipDock />                                                    [Task 17]
  e2e/fixtures/run-0142.recorded.json, run-fixture.ts, frame.svg                                              [Task 4]
  e2e/support/{rpc.ts,run-mocks.ts}                                                                           [Tasks 3, 4]
  e2e/{new-task,run-states,takeover,sse,approval,timeline,code-slots,layout,pip,run-qa,hero}.spec.ts
  scripts/check-hero-bundle.ts                                                                                [Task 22]
```

---

## Task 1: F1 contract gate, motion and colour token additions, oRPC client dependency

**Files:**
- Create: `apps/web/test/f1-contract.test.ts`
- Modify: `apps/web/lib/motion-tokens.ts`, `apps/web/styles/tokens.css`, `apps/web/components/ui/icons.ts` (only to add missing names), `apps/web/package.json`

**Interfaces:**
- Consumes: the F1 exports in Global Constraints.
- Produces:
  - **`durationMs` keys:** `cursorMin: 250`, `cursorMax: 450`, `clickPulse: 400`, `breathe: 1600`, `drift: 2600`, `spin: 1000`.
  - **`easing` key:** `linear: [0, 0, 1, 1]`.
  - **Generated CSS vars:** `--dur-cursor-min`, `--dur-cursor-max`, `--dur-click-pulse`, `--dur-breathe`, `--dur-drift`, `--dur-spin`, `--ease-linear`.
  - **Colour tokens:** `--color-cursor`, `--color-cursor-outline`, `--color-hero-aqua`, `--color-hero-aqua-deep`, `--color-hero-bondi`.
  - **Icon names:** `link video pdf doc x plus globe folder lock shield-key hand moon play pause stop clock chevron-right warning check maximize minimize send sparkles key passkey arrow-up-right`.
  - **Dependencies:** `@orpc/client` 1.15.4 and `@orpc/contract` 1.15.4 in `@mastertutor/web`.

- [ ] **Step 1: Write the failing gate test.**

`apps/web/test/f1-contract.test.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { icons } from "../components/ui/icons.ts";
import { durationMs, easing, spring, springSoft } from "../lib/motion-tokens.ts";

const web = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, web), "utf8");

const CSS_TOKENS = [
  "--color-bg", "--color-bg-2", "--color-elevated", "--color-label", "--color-label-2", "--color-label-3",
  "--color-hairline", "--color-separator", "--color-fill", "--color-fill-2", "--color-tint", "--color-tint-text",
  "--color-tint-wash", "--color-on-tint", "--color-signal", "--color-on-signal", "--color-signal-wash",
  "--color-ok", "--color-ok-wash", "--color-warn", "--color-warn-wash", "--color-danger", "--color-glass",
  "--color-scrim", "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-pill", "--radius-frame",
  "--shadow-e1", "--shadow-e2", "--shadow-e3", "--font-sans", "--font-mono", "--backdrop-glass", "--hit",
  "--color-cursor", "--color-cursor-outline", "--color-hero-aqua", "--color-hero-aqua-deep", "--color-hero-bondi",
] as const;

const MOTION_VARS = [
  "--spring", "--spring-duration", "--spring-soft", "--spring-soft-duration", "--dur-micro", "--dur-base",
  "--dur-panel", "--dur-cursor-min", "--dur-cursor-max", "--dur-click-pulse", "--dur-breathe", "--dur-drift",
  "--dur-spin", "--ease-out", "--ease-in", "--ease-cursor", "--ease-linear",
] as const;

export const F3_ICONS = [
  "link", "video", "pdf", "doc", "x", "plus", "globe", "folder", "lock", "shield-key", "hand", "moon", "play",
  "pause", "stop", "clock", "chevron-right", "warning", "check", "maximize", "minimize", "send", "sparkles",
  "key", "passkey", "arrow-up-right",
] as const;

const FILES: readonly (readonly [string, RegExp])[] = [
  ["components/ui/icon.tsx", /export (function|const) Icon\b/],
  ["components/ui/button.tsx", /\bButton\b/],
  ["components/bits/swipe-toast.tsx", /export (function|const) toast\b/],
  ["components/shell/toolbar.tsx", /export (function|const) Toolbar\b/],
  ["app/(app)/layout.tsx", /export default/],
  ["e2e/support/fixtures.ts", /\btest\b[\s\S]*\bexpect\b|\bexpect\b[\s\S]*\btest\b/],
  ["e2e/support/qa.ts", /BREAKPOINTS[\s\S]*expectNoOverflow[\s\S]*expectNoSeriousAxe|expectNoSeriousAxe/],
  ["components/bits/LICENSE-react-bits", /Commons Clause/],
  ["components.json", /@react-bits/],
];

describe("F1 exports consumed by F3 and F5", () => {
  it("defines every CSS token F3 and F5 use", () => {
    const css = read("styles/tokens.css");
    for (const name of CSS_TOKENS) expect(css, name).toContain(`${name}:`);
  });

  it("generates every motion variable from motion-tokens.ts", () => {
    const css = read("styles/motion.css");
    for (const name of MOTION_VARS) expect(css, name).toContain(`${name}:`);
  });

  it("keeps the D21 values and the F3 additions", () => {
    expect(spring).toMatchObject({ stiffness: 400, damping: 30 });
    expect(springSoft).toMatchObject({ stiffness: 260, damping: 30 });
    expect(durationMs).toMatchObject({
      micro: 120, base: 200, panel: 300, cursorMin: 250, cursorMax: 450, clickPulse: 400, breathe: 1600, drift: 2600, spin: 1000,
    });
    expect(easing.cursor).toEqual([0.2, 0.8, 0.2, 1]);
    expect(easing.linear).toEqual([0, 0, 1, 1]);
  });

  it("registers every icon F3 uses", () => {
    for (const name of F3_ICONS) expect(Object.keys(icons), name).toContain(name);
  });

  it("ships the shell, button, toast, QA helpers and React Bits licence", () => {
    for (const [file, pattern] of FILES) {
      expect(existsSync(new URL(file, web)), file).toBe(true);
      expect(read(file), file).toMatch(pattern);
    }
  });

  it("has a skeleton class somewhere in the global styles", () => {
    const sources = ["styles/tokens.css", "app/globals.css"].filter((f) => existsSync(new URL(f, web)));
    expect(sources.some((f) => read(f).includes(".skeleton"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/test/f1-contract.test.ts`

Expected: FAIL. At minimum `durationMs.cursorMin`, `easing.linear`, `--color-cursor` and the hero tokens are missing.
- If anything else is missing (for example `toast`, `Toolbar` or an F1 token), **stop**. F1 has not landed or uses other names. Reconcile names with F1's actual exports (F1 wins) by editing this test and every later F3/F5 import. Do not add aliases.

- [ ] **Step 3: Add the F3 tokens.**

In `apps/web/lib/motion-tokens.ts`, extend the existing `durationMs` and `easing` objects. Keep F1's entries and their `as const`:
```ts
// …inside durationMs, after panel:
  cursorMin: 250, // agent cursor travel floor (run 13 §6)
  cursorMax: 450, // agent cursor travel ceiling
  clickPulse: 400, // click ring 24→44px
  breathe: 1600, // acting ring and live dots, opacity loop
  drift: 2600, // idle cursor drift while thinking
  spin: 1000, // StatusMark running arc and the Reconnecting spinner, one turn
// …inside easing, after cursor:
  linear: [0, 0, 1, 1],
```

In `apps/web/styles/tokens.css`, add to the light `:root` block (or F1's `@theme` block, wherever `--color-tint` is defined). These values are the same in both themes:
```css
  /* Agent cursor drawn over remote web content (always light-on-dark arrow, any theme). */
  --color-cursor: #111111;
  --color-cursor-outline: #ffffff;
  /* 3D hero art palette (run 16). Used only by components/hero. */
  --color-hero-aqua: #e4f5f3;
  --color-hero-aqua-deep: #a9dcd8;
  --color-hero-bondi: #1f8f96;
```

If any `F3_ICONS` name is missing from `icons`, add it in F1's existing entry format. Use these Lucide glyphs (stroke 1.6, round caps, as F1 configures):

| Name | Glyph | Name | Glyph |
|---|---|---|---|
| `link` | `Link` | `video` | `Youtube` |
| `pdf` | `FileText` | `doc` | `NotebookText` |
| `x` | `X` | `plus` | `Plus` |
| `globe` | `Globe` | `folder` | `Folder` |
| `lock` | `Lock` | `shield-key` | `ShieldCheck` |
| `hand` | `Hand` | `moon` | `Moon` |
| `play` | `Play` | `pause` | `Pause` |
| `stop` | `Square` | `clock` | `Clock` |
| `chevron-right` | `ChevronRight` | `warning` | `TriangleAlert` |
| `check` | `Check` | `maximize` | `Maximize2` |
| `minimize` | `Minimize2` | `send` | `ArrowUp` |
| `sparkles` | `Sparkles` | `key` | `KeyRound` |
| `passkey` | `Fingerprint` | `arrow-up-right` | `ArrowUpRight` |

- [ ] **Step 4: Regenerate the motion CSS and add the client dependency.**

Run:
```bash
pnpm --filter @mastertutor/web gen:motion
pnpm --filter @mastertutor/web add --save-exact @orpc/client@1.15.4 @orpc/contract@1.15.4
```

Expected: `apps/web/styles/motion.css` now contains `--dur-click-pulse:` and `--ease-linear:`.
- If F1's generator does not emit `--dur-<kebab key>` for new keys, fix the generator's key-to-variable mapping so it does. This plan relies on that rule.

- [ ] **Step 5: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/test/f1-contract.test.ts && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/test apps/web/lib/motion-tokens.ts apps/web/styles apps/web/components/ui/icons.ts apps/web/package.json pnpm-lock.yaml
git commit -m "test(web): F1 contract gate for F3/F5; cursor, hero and motion token additions; oRPC client dep"
```

---

## Task 2: Contracts for the run event stream, and `StepAction.pointer`

**Files:**
- Create: `packages/contracts/src/run-stream.ts`, `packages/contracts/src/run-stream.test.ts`
- Modify: `packages/contracts/src/events.ts`, `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `RunEventRecord`, `Uuid`, `ToolName` (Phase 0).
- Produces (from `@mastertutor/contracts`):
  - `RUN_EVENT_SSE_NAME = "run_event"` and `LAST_EVENT_ID_HEADER = "last-event-id"`;
  - `EventId` (digit string);
  - `runEventsPath(runId: string, after?: string | null): string`, which builds `/api/runs/<id>/events[?after=<id>]`;
  - `stepScreenshotPath(runId: string, seq: number): string`, which builds `/api/runs/<id>/steps/<seq>/screenshot`;
  - `resumeAfter(header: string | null, query: string | null): string | null`;
  - `encodeRunEventSse(record: RunEventRecord): string` and `decodeRunEventData(data: string): RunEventRecord | null`;
  - `compareEventIds(a: string, b: string): number`;
  - `POINTER_KINDS` and the optional `StepAction.pointer?: "click" | "double_click" | "drag" | "move" | "scroll"`.

- [ ] **Step 1: Write the failing test.**

`packages/contracts/src/run-stream.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { RunEventRecord, StepAction } from "./events.ts";
import {
  compareEventIds,
  decodeRunEventData,
  encodeRunEventSse,
  resumeAfter,
  runEventsPath,
  stepScreenshotPath,
} from "./run-stream.ts";

const runId = "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d";
const record = RunEventRecord.parse({
  id: "42",
  runId,
  at: "2026-10-05T17:10:00.000Z",
  event: { type: "user_message", text: "line one\nline two" },
});

describe("run stream wire format", () => {
  it("builds the events and screenshot paths and validates their inputs", () => {
    expect(runEventsPath(runId)).toBe(`/api/runs/${runId}/events`);
    expect(runEventsPath(runId, "12")).toBe(`/api/runs/${runId}/events?after=12`);
    expect(() => runEventsPath("not-a-uuid")).toThrow();
    expect(() => runEventsPath(runId, "12; drop")).toThrow();
    expect(stepScreenshotPath(runId, 7)).toBe(`/api/runs/${runId}/steps/7/screenshot`);
    expect(() => stepScreenshotPath(runId, -1)).toThrow();
  });

  it("encodes one SSE message per record with exactly one data line", () => {
    const text = encodeRunEventSse(record);
    expect(text).toBe(`id: 42\nevent: run_event\ndata: ${JSON.stringify(record)}\n\n`);
    expect(text.split("\n").filter((line) => line.startsWith("data:"))).toHaveLength(1);
  });

  it("decodes valid data and returns null for junk", () => {
    expect(decodeRunEventData(JSON.stringify(record))).toEqual(record);
    expect(decodeRunEventData("{")).toBeNull();
    expect(decodeRunEventData(JSON.stringify({ ...record, id: "x" }))).toBeNull();
  });

  it("prefers Last-Event-ID over ?after=", () => {
    expect(resumeAfter("15", "12")).toBe("15");
    expect(resumeAfter(null, "12")).toBe("12");
    expect(resumeAfter("junk", "12")).toBe("12");
    expect(resumeAfter(null, null)).toBeNull();
  });

  it("orders bigserial ids numerically, beyond 2^53", () => {
    expect(compareEventIds("9", "10")).toBeLessThan(0);
    expect(compareEventIds("9007199254740993", "9007199254740992")).toBeGreaterThan(0);
    expect(compareEventIds("77", "77")).toBe(0);
  });
});

describe("StepAction.pointer", () => {
  it("is optional and limited to pointer kinds", () => {
    const base = { tool: "computer", summary: "Clicked Start", point: { x: 1, y: 2 } };
    expect(StepAction.parse(base)).not.toHaveProperty("pointer");
    expect(StepAction.parse({ ...base, pointer: "click" }).pointer).toBe("click");
    expect(StepAction.safeParse({ ...base, pointer: "type" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test -- packages/contracts/src/run-stream.test.ts`

Expected: FAIL, because `./run-stream.ts` is not found.

- [ ] **Step 3: Implement.**

In `packages/contracts/src/events.ts`, replace the `StepAction` definition with this. It is additive: `pointer` is optional, so existing producers stay valid.
```ts
/** Pointer kinds the UI animates. B1 sets `pointer` for computer actions that have a point. */
export const POINTER_KINDS = ["click", "double_click", "drag", "move", "scroll"] as const;

/** What the UI shows for a step; `point` drives the overlay cursor, `pointer` decides the click pulse. */
export const StepAction = z.object({
  tool: ToolName,
  summary: z.string().max(300),
  point: z.object({ x: z.number().int(), y: z.number().int() }).nullable(),
  pointer: z.enum(POINTER_KINDS).optional(),
});
export type StepAction = z.infer<typeof StepAction>;
```

`packages/contracts/src/run-stream.ts`:
```ts
import { z } from "zod";
import { RunEventRecord } from "./events.ts";
import { Uuid } from "./primitives.ts";

/**
 * SSE wire format for GET /api/runs/:id/events (spec §6). The server (owned by the integration
 * phase) writes `encodeRunEventSse` per record and resumes from `resumeAfter(header, ?after)`.
 */
export const RUN_EVENT_SSE_NAME = "run_event";
/** Browsers send this on automatic reconnect; it wins over the `after` query. */
export const LAST_EVENT_ID_HEADER = "last-event-id";
export const EventId = z.string().regex(/^[0-9]{1,19}$/);

export function runEventsPath(runId: string, after: string | null = null): string {
  const base = `/api/runs/${Uuid.parse(runId)}/events`;
  return after === null ? base : `${base}?after=${EventId.parse(after)}`;
}

/** Masked step screenshot (objectKeys.stepScreenshot), streamed by web with its read-only key. */
export function stepScreenshotPath(runId: string, seq: number): string {
  return `/api/runs/${Uuid.parse(runId)}/steps/${z.number().int().nonnegative().parse(seq)}/screenshot`;
}

export function resumeAfter(header: string | null, query: string | null): string | null {
  for (const candidate of [header, query]) {
    const parsed = EventId.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** JSON.stringify never emits raw newlines, so each record is exactly one `data:` line. */
export function encodeRunEventSse(record: RunEventRecord): string {
  const valid = RunEventRecord.parse(record);
  return `id: ${valid.id}\nevent: ${RUN_EVENT_SSE_NAME}\ndata: ${JSON.stringify(valid)}\n\n`;
}

export function decodeRunEventData(data: string): RunEventRecord | null {
  try {
    const parsed = RunEventRecord.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** bigserial ids as digit strings: longer is larger; equal length compares lexically. */
export function compareEventIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
```

Append to `packages/contracts/src/index.ts`:
```ts
export * from "./run-stream.ts";
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- packages/contracts && pnpm typecheck && pnpm lint`

Expected: PASS. This includes Phase 0's `events.test.ts`, because `pointer` is optional.

- [ ] **Step 5: Commit.**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): run event SSE wire format, step screenshot path and StepAction.pointer"
```

---

## Task 3: oRPC API client and RPC test helpers

**Files:**
- Create: `apps/web/lib/api/client.ts`, `apps/web/lib/api/client.test.ts`, `apps/web/e2e/support/rpc.ts`

**Interfaces:**
- Consumes: `ApiContract` (Phase 0) and `@orpc/client` 1.15.4.
- Produces:
  - `RPC_PATH = "/api/rpc"`;
  - `type ApiClient = ContractRouterClient<ApiContract>`;
  - `createApiClient({ baseUrl, fetch? }): ApiClient`;
  - `api(): ApiClient`, a browser singleton for same-origin calls. **F2 and F4 must import this file too, not create another client.**
  - e2e helpers `rpcBody(output)`, `rpcErrorBody(code, status, message)` and `rpcInput(body)`.
  - Wire format, verified on 1.15.4: `POST /api/rpc/<router>/<proc>` with body `{"json": input}`; success `{"json": output}`; error status 4xx/5xx with `{"json": {"defined": false, "code", "status", "message"}}`.

- [ ] **Step 1: Write the failing test.**

`apps/web/e2e/support/rpc.ts`:
```ts
/** oRPC 1.15.4 RPC wire format: request {json: input}; response {json: output}; error {json: {code,…}}. */
export function rpcBody(output: unknown): string {
  return JSON.stringify({ json: output });
}

export function rpcErrorBody(code: string, status: number, message: string): string {
  return JSON.stringify({ json: { defined: false, code, status, message } });
}

export function rpcInput(body: string | null): unknown {
  if (!body) return undefined;
  return (JSON.parse(body) as { json?: unknown }).json;
}
```

`apps/web/lib/api/client.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { rpcBody, rpcErrorBody, rpcInput } from "../../e2e/support/rpc.ts";
import { createApiClient } from "./client.ts";

const runId = "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d";
const json = { "content-type": "application/json" };

describe("api client", () => {
  it("posts {json: input} to /api/rpc/<router>/<procedure>", async () => {
    const seen: { url: string; method: string; body: string }[] = [];
    const client = createApiClient({
      baseUrl: "http://app.test",
      fetch: async (request) => {
        seen.push({ url: request.url, method: request.method, body: await request.text() });
        return new Response(rpcBody({ ok: true }), { headers: json });
      },
    });
    await expect(client.runs.takeControl({ runId })).resolves.toEqual({ ok: true });
    expect(seen).toEqual([
      { url: "http://app.test/api/rpc/runs/takeControl", method: "POST", body: JSON.stringify({ json: { runId } }) },
    ]);
    expect(rpcInput(seen[0]?.body ?? null)).toEqual({ runId });
  });

  it("surfaces typed errors", async () => {
    const client = createApiClient({
      baseUrl: "http://app.test",
      fetch: async () =>
        new Response(rpcErrorBody("CONFLICT", 409, "Already in control"), { status: 409, headers: json }),
    });
    await expect(client.runs.takeControl({ runId })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/lib/api`

Expected: FAIL, because `./client.ts` is not found.

- [ ] **Step 3: Implement.**

`apps/web/lib/api/client.ts`:
```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { ApiContract } from "@mastertutor/contracts";

/** The oRPC handler is mounted here by the integration phase (spec §6). */
export const RPC_PATH = "/api/rpc";
export type ApiClient = ContractRouterClient<ApiContract>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Tests inject a fake; the browser uses the global fetch with same-origin cookies. */
  fetch?: (request: Request) => Promise<Response>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const link = new RPCLink({
    url: new URL(RPC_PATH, options.baseUrl).toString(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return createORPCClient(link);
}

let browserClient: ApiClient | undefined;

/** Browser-only singleton. Call it inside effects and handlers, never during render. */
export function api(): ApiClient {
  browserClient ??= createApiClient({ baseUrl: window.location.origin });
  return browserClient;
}
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/lib/api && pnpm typecheck && pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/lib/api apps/web/e2e/support/rpc.ts
git commit -m "feat(web): typed oRPC client and verified RPC wire helpers for tests"
```

---

## Task 4: Recorded run fixture and Playwright run mocks

**Files:**
- Create: `apps/web/e2e/fixtures/run-0142.recorded.json`, `apps/web/e2e/fixtures/run-fixture.ts`, `apps/web/e2e/fixtures/frame.svg`, `apps/web/e2e/support/run-mocks.ts`

**Interfaces:**
- Consumes: `RunDetail`, `RunStepView`, `RunEventRecord`, `RunEvent`, `liveEmbedPath`, `DEFAULT_BUDGET` and `rpcBody`/`rpcErrorBody`.
- Produces:
  - **From `run-fixture.ts`:** `RUN_ID`, `APPROVAL_ID`, `OTHER_RUN_ID`, `CREATED_RUN_ID`, `fixtureDetail(over?)`, `fixtureSteps()`, `recordedEvents()` (ids 13–20) and `rec(event, runId?)` (ids from 100 upward).
    - Recorded stream: 13–14 act step 10 (click, started then done); 15 budget; 16–17 decide step 11; 18 approve step 12; 19 `approval_requested` (`risky_click`, "Start quiz"); 20 `status` waiting/approval.
  - **From `run-mocks.ts`:** `RpcCall`, `RpcHandler`, `RpcFailure`, `mockRpc(page, handlers)`, `runHandlers(opts)`, `newTaskHandlers(over?)`, `FOLDERS`, `installFakeEventSource(page)`, `emit(page, records)`, `stubLiveFrame(page)`, `gotoRun(page, opts)` and `frame(page)`.
  - **Window control:** `window.__sse` with `{sources, blockOpen, emit, fail, openAll}`.

- [ ] **Step 1: Write the fixture files.**

`apps/web/e2e/fixtures/run-0142.recorded.json`:
```json
{
  "detail": {
    "id": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d",
    "goal": "Week 2 of the course: every lecture, figure and table. Skip the quizzes.\n\nSources:\n- https://learn.example.edu/course/week-2",
    "status": "running",
    "waitReason": null,
    "controller": "agent",
    "approvalMode": "ask",
    "model": "gpt-6-astra",
    "noteId": "6f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
    "usage": { "steps": 9, "inputTokens": 182000, "cachedInputTokens": 120000, "outputTokens": 6400, "usd": 0.41, "activeMs": 372000 },
    "budget": { "maxSteps": 150, "maxUsd": 5, "maxActiveMinutes": 60 },
    "createdAt": "2026-10-05T17:04:00.000Z",
    "finishedAt": null,
    "plan": { "items": [{ "text": "Sign in", "done": true }, { "text": "Capture week 2", "done": false }] },
    "allowedOrigins": ["https://learn.example.edu", "https://www.learn.example.edu"],
    "currentUrl": "https://learn.example.edu/course/week-2/lecture-3",
    "slotName": "browser-1",
    "targetFolderId": null,
    "pendingApprovals": [],
    "lastEventId": "12"
  },
  "steps": [
    { "seq": 1, "phase": "observe", "state": "done", "caption": "Looking at the course home", "url": "https://learn.example.edu/course/week-2", "screenshotKey": "runs/0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d/steps/1.png", "action": null, "createdAt": "2026-10-05T17:04:02.000Z" },
    { "seq": 2, "phase": "decide", "state": "done", "caption": "Planning the sign-in", "url": null, "screenshotKey": null, "action": null, "createdAt": "2026-10-05T17:04:05.000Z" },
    { "seq": 3, "phase": "act", "state": "done", "caption": "Opening the sign-in page", "url": "https://learn.example.edu/login", "screenshotKey": "runs/0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d/steps/3.png", "action": { "tool": "computer", "summary": "Clicked “Log in”", "point": { "x": 1120, "y": 36 }, "pointer": "click" }, "createdAt": "2026-10-05T17:04:07.000Z" },
    { "seq": 4, "phase": "act", "state": "done", "caption": "Filling ada-learn securely", "url": "https://learn.example.edu/login", "screenshotKey": "runs/0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d/steps/4.png", "action": { "tool": "fill_credential", "summary": "Filled the password for ada-learn", "point": { "x": 640, "y": 380 } }, "createdAt": "2026-10-05T17:04:11.000Z" },
    { "seq": 5, "phase": "act", "state": "done", "caption": "Signing in", "url": "https://learn.example.edu/login", "screenshotKey": "runs/0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d/steps/5.png", "action": { "tool": "computer", "summary": "Clicked “Sign in”", "point": { "x": 640, "y": 452 }, "pointer": "click" }, "createdAt": "2026-10-05T17:04:14.000Z" },
    { "seq": 6, "phase": "observe", "state": "done", "caption": "Reading lecture 3", "url": "https://learn.example.edu/course/week-2/lecture-3", "screenshotKey": "runs/0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d/steps/6.png", "action": null, "createdAt": "2026-10-05T17:04:41.000Z" },
    { "seq": 7, "phase": "act", "state": "done", "caption": "Capturing the transcript", "url": "https://learn.example.edu/course/week-2/lecture-3", "screenshotKey": "runs/0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d/steps/7.png", "action": { "tool": "capture", "summary": "Transcript: 1,842 words, verified", "point": null }, "createdAt": "2026-10-05T17:05:58.000Z" },
    { "seq": 8, "phase": "act", "state": "done", "caption": "Capturing the convergence figure", "url": "https://learn.example.edu/course/week-2/lecture-3", "screenshotKey": "runs/0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d/steps/8.png", "action": { "tool": "capture", "summary": "Figure: cost vs. iterations", "point": { "x": 520, "y": 300 } }, "createdAt": "2026-10-05T17:07:20.000Z" },
    { "seq": 9, "phase": "decide", "state": "done", "caption": "Choosing what to capture next", "url": null, "screenshotKey": null, "action": null, "createdAt": "2026-10-05T17:09:47.000Z" }
  ],
  "events": [
    { "id": "13", "runId": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d", "at": "2026-10-05T17:10:01.000Z", "event": { "type": "step", "seq": 10, "phase": "act", "state": "started", "caption": "Ticking the Honor Code box", "url": "https://learn.example.edu/course/week-2/lecture-3", "screenshotKey": null, "action": { "tool": "computer", "summary": "Clicked the Honor Code checkbox", "point": { "x": 980, "y": 560 }, "pointer": "click" } } },
    { "id": "14", "runId": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d", "at": "2026-10-05T17:10:02.000Z", "event": { "type": "step", "seq": 10, "phase": "act", "state": "done", "caption": "Ticking the Honor Code box", "url": "https://learn.example.edu/course/week-2/lecture-3", "screenshotKey": "runs/0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d/steps/10.png", "action": { "tool": "computer", "summary": "Clicked the Honor Code checkbox", "point": { "x": 980, "y": 560 }, "pointer": "click" } } },
    { "id": "15", "runId": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d", "at": "2026-10-05T17:10:02.500Z", "event": { "type": "budget", "usage": { "steps": 10, "inputTokens": 190000, "cachedInputTokens": 124000, "outputTokens": 6700, "usd": 0.44, "activeMs": 380000 }, "budget": { "maxSteps": 150, "maxUsd": 5, "maxActiveMinutes": 60 } } },
    { "id": "16", "runId": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d", "at": "2026-10-05T17:10:03.000Z", "event": { "type": "step", "seq": 11, "phase": "decide", "state": "started", "caption": "Deciding whether to start the quiz", "url": null, "screenshotKey": null, "action": null } },
    { "id": "17", "runId": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d", "at": "2026-10-05T17:10:06.000Z", "event": { "type": "step", "seq": 11, "phase": "decide", "state": "done", "caption": "Deciding whether to start the quiz", "url": null, "screenshotKey": null, "action": null } },
    { "id": "18", "runId": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d", "at": "2026-10-05T17:10:06.200Z", "event": { "type": "step", "seq": 12, "phase": "approve", "state": "started", "caption": "Waiting for your approval to start the quiz", "url": "https://learn.example.edu/course/week-2/lecture-3", "screenshotKey": null, "action": null } },
    { "id": "19", "runId": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d", "at": "2026-10-05T17:10:06.300Z", "event": { "type": "approval_requested", "approvalId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "request": { "kind": "risky_click", "action": { "type": "click", "x": 1000, "y": 610, "button": "left" }, "label": "Start quiz", "url": "https://learn.example.edu/course/week-2/lecture-3", "screenshotKey": null } } },
    { "id": "20", "runId": "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d", "at": "2026-10-05T17:10:06.400Z", "event": { "type": "status", "status": "waiting", "waitReason": "approval", "reason": "Starting the quiz counts as an attempt." } }
  ]
}
```

`apps/web/e2e/fixtures/frame.svg` (a fixed 1280×800 "remote page"):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" width="1280" height="800" role="img" aria-label="Course lecture page">
  <rect width="1280" height="800" fill="#ffffff"/>
  <rect width="1280" height="56" fill="#f5f6f8"/>
  <text x="28" y="36" font-family="Arial" font-size="20" font-weight="700" fill="#0b4fa8">learn.example.edu</text>
  <text x="300" y="120" font-family="Arial" font-size="28" font-weight="700" fill="#1f1f1f">Week 2 · Lecture 3: Choosing the learning rate</text>
  <rect x="300" y="150" width="600" height="300" rx="8" fill="#0f1115"/>
  <path d="M320 420 C 420 200, 520 180, 880 170" stroke="#4ade80" stroke-width="4" fill="none"/>
  <rect x="300" y="480" width="560" height="10" rx="5" fill="#d2d2d7"/>
  <rect x="300" y="500" width="520" height="10" rx="5" fill="#d2d2d7"/>
  <rect x="940" y="520" width="300" height="140" rx="10" fill="#f7f8fa" stroke="#e1e4e8"/>
  <rect x="965" y="548" width="20" height="20" rx="4" fill="#0b4fa8"/>
  <text x="995" y="564" font-family="Arial" font-size="16" fill="#333">I agree to the Honor Code</text>
  <rect x="960" y="592" width="260" height="40" rx="6" fill="#0b4fa8"/>
  <text x="1048" y="618" font-family="Arial" font-size="16" font-weight="700" fill="#ffffff">Start quiz</text>
</svg>
```

`apps/web/e2e/fixtures/run-fixture.ts`:
```ts
import { readFileSync } from "node:fs";
import { RunDetail, RunEventRecord, RunStepView, type RunEvent } from "@mastertutor/contracts";

/**
 * A recorded run (spec §16: F phases use recorded RunEvents). Phase 7 may replace the JSON with a
 * real recording of the same shape; every consumer parses it through the contract schemas.
 */
const raw = JSON.parse(readFileSync(new URL("./run-0142.recorded.json", import.meta.url), "utf8")) as {
  detail: Record<string, unknown>;
  steps: unknown;
  events: unknown;
};

export const RUN_ID = "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d";
export const APPROVAL_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
export const OTHER_RUN_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const CREATED_RUN_ID = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";

export function fixtureDetail(over: Partial<RunDetail> = {}): RunDetail {
  return RunDetail.parse({ ...raw.detail, ...over });
}

export function fixtureSteps(): RunStepView[] {
  return RunStepView.array().parse(raw.steps);
}

export function recordedEvents(): RunEventRecord[] {
  return RunEventRecord.array().parse(raw.events);
}

let nextId = 100;

/** A follow-on event with a fresh id above the recorded stream. */
export function rec(event: RunEvent, runId: string = RUN_ID): RunEventRecord {
  const id = nextId++;
  return RunEventRecord.parse({
    id: String(id),
    runId,
    at: new Date(Date.UTC(2026, 9, 5, 17, 20, 0) + id * 1000).toISOString(),
    event,
  });
}
```

- [ ] **Step 2: Write the run mocks.**

`apps/web/e2e/support/run-mocks.ts`:
```ts
import { readFileSync } from "node:fs";
import {
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  liveEmbedPath,
  type RunDetail,
  type RunEventRecord,
  type RunStepView,
} from "@mastertutor/contracts";
import { expect, type Locator, type Page } from "@playwright/test";
import { CREATED_RUN_ID, fixtureDetail, fixtureSteps } from "../fixtures/run-fixture.ts";
import { rpcBody, rpcErrorBody } from "./rpc.ts";

export interface RpcCall {
  path: string;
  input: unknown;
}
export type RpcHandler = (input: unknown) => unknown;

export class RpcFailure extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Intercepts /api/rpc/<router>/<proc>; unknown procedures fall through to F1's own mocks or the server. */
export async function mockRpc(page: Page, handlers: Record<string, RpcHandler>): Promise<RpcCall[]> {
  const calls: RpcCall[] = [];
  await page.route("**/api/rpc/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/rpc\//, "");
    const handler = handlers[path];
    if (!handler) return route.fallback();
    const input = (route.request().postDataJSON() as { json?: unknown } | null)?.json;
    calls.push({ path, input });
    try {
      const output: unknown = await handler(input);
      await route.fulfill({ contentType: "application/json", body: rpcBody(output) });
    } catch (error) {
      const failure =
        error instanceof RpcFailure ? error : new RpcFailure("INTERNAL_SERVER_ERROR", 500, "Mock failure");
      await route.fulfill({
        status: failure.status,
        contentType: "application/json",
        body: rpcErrorBody(failure.code, failure.status, failure.message),
      });
    }
  });
  return calls;
}

const OK = { ok: true } as const;

export interface RunHandlerOptions {
  detail?: RunDetail;
  steps?: RunStepView[];
  extraRuns?: RunDetail[];
}

export function runHandlers(opts: RunHandlerOptions = {}): Record<string, RpcHandler> {
  const detail = opts.detail ?? fixtureDetail();
  const runs = new Map([detail, ...(opts.extraRuns ?? [])].map((d) => [d.id, d]));
  return {
    "runs/get": (input) => runs.get((input as { runId: string }).runId) ?? detail,
    "runs/steps": (input) => {
      const { runId, afterSeq } = input as { runId: string; afterSeq: number | null };
      return { items: runId === detail.id && afterSeq === null ? (opts.steps ?? fixtureSteps()) : [] };
    },
    "runs/openLive": (input) => ({
      sleeping: false,
      slotName: "browser-1",
      embedPath: liveEmbedPath((input as { runId: string }).runId),
      iceServers: [],
    }),
    "runs/takeControl": () => OK,
    "runs/handBack": () => OK,
    "runs/decideApproval": () => OK,
    "runs/submitOtp": () => OK,
    "runs/sendMessage": () => OK,
    "runs/cancel": () => OK,
    "runs/resume": () => OK,
  };
}

export const FOLDERS = [
  { id: "3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7", parentId: null, name: "Courses", sort: 0 },
  { id: "4f5a6b7c-8d9e-4f0a-b1c2-d3e4f5a6b7c8", parentId: "3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7", name: "Machine learning", sort: 0 },
] as const;

export function newTaskHandlers(over: Record<string, RpcHandler> = {}): Record<string, RpcHandler> {
  return {
    "settings/get": () => ({ killSwitch: false, defaultBudget: DEFAULT_BUDGET, defaultAllowedOrigins: [], concurrency: 6 }),
    "folders/tree": () => ({ folders: FOLDERS }),
    "runs/create": (input) => {
      const i = input as { goal: string; approvalMode: "ask" | "auto_within_allowlist"; budget?: unknown };
      return {
        id: CREATED_RUN_ID,
        goal: i.goal,
        status: "queued",
        waitReason: null,
        controller: "agent",
        approvalMode: i.approvalMode,
        model: "gpt-6-astra",
        noteId: null,
        usage: EMPTY_USAGE,
        budget: i.budget ?? DEFAULT_BUDGET,
        createdAt: "2026-10-05T17:30:00.000Z",
        finishedAt: null,
      };
    },
    ...over,
  };
}

interface FakeSource extends EventTarget {
  readyState: number;
  url: string;
  dispatch(event: Event): void;
}
interface SseControl {
  sources: FakeSource[];
  blockOpen: boolean;
  emit(records: { id: string }[]): void;
  fail(closed: boolean): void;
  openAll(): void;
}
declare global {
  interface Window {
    __sse: SseControl;
  }
}

/** Replaces window.EventSource with a test-controlled fake (open streams, scripted delivery). */
export async function installFakeEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const open = (source: FakeSource) => {
      source.readyState = 1;
      source.dispatch(new Event("open"));
    };
    const control: SseControl = {
      sources: [],
      blockOpen: false,
      emit(records) {
        for (const source of control.sources) {
          if (source.readyState !== 1) continue;
          for (const record of records) {
            source.dispatch(new MessageEvent("run_event", { data: JSON.stringify(record), lastEventId: record.id }));
          }
        }
      },
      fail(closed) {
        for (const source of control.sources) {
          if (source.readyState === 2) continue;
          source.readyState = closed ? 2 : 0;
          source.dispatch(new Event("error"));
        }
      },
      openAll() {
        control.blockOpen = false;
        for (const source of control.sources) if (source.readyState === 0) open(source);
      },
    };
    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly withCredentials = false;
      readonly url: string;
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: Event) => void) | null = null;
      constructor(url: string | URL) {
        super();
        this.url = String(url);
        control.sources.push(this);
        if (!control.blockOpen) setTimeout(() => open(this), 0);
      }
      dispatch(event: Event) {
        const handler = event.type === "open" ? this.onopen : event.type === "error" ? this.onerror : null;
        handler?.call(this, event);
        this.dispatchEvent(event);
      }
      close() {
        this.readyState = 2;
      }
    }
    window.__sse = control;
    window.EventSource = FakeEventSource as unknown as typeof EventSource;
  });
}

export async function emit(page: Page, records: RunEventRecord[]): Promise<void> {
  await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
  await page.evaluate((rs) => window.__sse.emit(rs), records);
}

const FRAME_SVG = readFileSync(new URL("../fixtures/frame.svg", import.meta.url), "utf8");

/** Stubs the n.eko embed and masked step screenshots with one fixed frame (spec §12 visual regression). */
export async function stubLiveFrame(page: Page): Promise<void> {
  await page.route("**/live/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Remote page</title><style>html,body{margin:0;height:100%}svg{display:block;width:100%;height:100%}</style></head><body>${FRAME_SVG}</body></html>`,
    }),
  );
  await page.route("**/api/runs/*/steps/*/screenshot", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: FRAME_SVG }),
  );
}

export const frame = (page: Page): Locator => page.getByTestId("browser-frame");

export interface GotoRunOptions extends RunHandlerOptions {
  handlers?: Record<string, RpcHandler>;
  realEventSource?: boolean;
  path?: string;
}

export async function gotoRun(page: Page, opts: GotoRunOptions = {}): Promise<RpcCall[]> {
  if (!opts.realEventSource) await installFakeEventSource(page);
  await stubLiveFrame(page);
  const calls = await mockRpc(page, { ...runHandlers(opts), ...opts.handlers });
  await page.goto(opts.path ?? `/runs/${(opts.detail ?? fixtureDetail()).id}`);
  await expect(frame(page)).toBeVisible();
  return calls;
}
```

- [ ] **Step 3: Typecheck and lint.**

Run: `pnpm typecheck && pnpm lint`

Expected: PASS. The fixture's schema validity is asserted by Task 5's unit test.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/e2e/fixtures apps/web/e2e/support/run-mocks.ts
git commit -m "test(web): recorded run event fixture, fake EventSource and live-frame stubs"
```

---

## Task 5: Run model reducer

**Files:**
- Create: `apps/web/components/run/model/run-model.ts`, `apps/web/components/run/model/run-model.test.ts`

**Interfaces:**
- Consumes: `RunDetail`, `RunStepView`, `RunEventRecord`, `compareEventIds`, `toOrigin` and `TERMINAL_RUN_STATUSES`.
- Produces:
  - **Types:** `StepRow`, `PendingApproval`, `ApprovalOutcome`, `UserMessage`, `DownloadItem` and `RunModel`.
  - **Functions:**
    - `initRunModel(detail, steps): RunModel`;
    - `applyRunEvent(model, record): RunModel` (pure; ignores other runs and ids at or below `lastEventId`);
    - `isTerminal(status)`, `latestStep(model)`, `latestPointerStep(model)` and `latestScreenshotSeq(model)`;
    - `captureCount(model)` and `originOf(url)`.

- [ ] **Step 1: Write the failing test.**

`apps/web/components/run/model/run-model.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  APPROVAL_ID,
  OTHER_RUN_ID,
  RUN_ID,
  fixtureDetail,
  fixtureSteps,
  rec,
  recordedEvents,
} from "../../../e2e/fixtures/run-fixture.ts";
import {
  applyRunEvent,
  captureCount,
  initRunModel,
  isTerminal,
  latestPointerStep,
  latestScreenshotSeq,
  type RunModel,
} from "./run-model.ts";

const fold = (model: RunModel, records = recordedEvents()) => records.reduce(applyRunEvent, model);
const base = () => initRunModel(fixtureDetail(), fixtureSteps());

describe("initRunModel", () => {
  it("parses the recorded fixture and derives captures and the secure-fill origin", () => {
    const model = base();
    expect(model.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(captureCount(model)).toBe(2);
    expect(model.secureFillOrigin).toBe("https://learn.example.edu");
    expect(model.lastEventId).toBe("12");
    expect(latestScreenshotSeq(model)).toBe(8);
  });
});

describe("applyRunEvent", () => {
  it("folds the recorded stream into an approval wait", () => {
    const model = fold(base());
    expect(model.status).toBe("waiting");
    expect(model.waitReason).toBe("approval");
    expect(model.approvals.map((a) => a.id)).toEqual([APPROVAL_ID]);
    expect(model.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(model.usage.steps).toBe(10);
    expect(latestPointerStep(model)?.seq).toBe(10);
    expect(model.lastEventId).toBe("20");
  });

  it("upserts a step's phases in place and keeps its first timestamp", () => {
    const [started, done] = recordedEvents();
    const once = applyRunEvent(base(), started!);
    const twice = applyRunEvent(once, done!);
    const row = twice.steps.find((s) => s.seq === 10);
    expect(row?.state).toBe("done");
    expect(row?.at).toBe(started!.at);
    expect(twice.steps.filter((s) => s.seq === 10)).toHaveLength(1);
  });

  it("ignores ids at or below lastEventId (reconnect replay overlap)", () => {
    const model = fold(base());
    expect(fold(model)).toBe(model);
    const stale = { ...rec({ type: "control", holder: "user" }), id: "12" };
    expect(applyRunEvent(base(), stale)).toBe(applyRunEvent(base(), stale));
    expect(applyRunEvent(base(), stale).controller).toBe("agent");
  });

  it("ignores events for another run", () => {
    const model = base();
    expect(applyRunEvent(model, rec({ type: "control", holder: "user" }, OTHER_RUN_ID))).toBe(model);
  });

  it("moves approvals to outcomes when resolved", () => {
    const model = fold(base(), [
      ...recordedEvents(),
      rec({ type: "approval_resolved", approvalId: APPROVAL_ID, status: "approved", decidedBy: "user-1" }),
    ]);
    expect(model.approvals).toEqual([]);
    expect(model.outcomes).toMatchObject([{ id: APPROVAL_ID, status: "approved", decidedBy: "user-1" }]);
    expect(model.outcomes[0]?.request?.kind).toBe("risky_click");
  });

  it("clears the secure-fill badge when the page leaves that origin", () => {
    const moved = applyRunEvent(
      base(),
      rec({
        type: "step", seq: 20, phase: "act", state: "done", caption: "Opening the docs",
        url: "https://docs.example.org/page", screenshotKey: null,
        action: { tool: "computer", summary: "Clicked Docs", point: null },
      }),
    );
    expect(moved.secureFillOrigin).toBeNull();
    expect(moved.currentUrl).toBe("https://docs.example.org/page");
  });

  it("tracks control, slot, messages, downloads, errors, filing and model fallback", () => {
    const model = fold(base(), [
      rec({ type: "control", holder: "user" }),
      rec({ type: "slot", slotName: null }),
      rec({ type: "user_message", text: "Skip the quiz" }),
      rec({ type: "download_ready", downloadId: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", filename: "slides.pdf", bytes: 2048 }),
      rec({ type: "error", code: "nav_timeout", message: "The page took too long" }),
      rec({ type: "filed", noteId: "6f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f", folderId: "3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7", path: ["Courses", "ML"], filedBy: "agent" }),
      rec({ type: "model_fallback", from: "gpt-6-astra", to: "gpt-6.1-sol" }),
    ]);
    expect(model.controller).toBe("user");
    expect(model.slotName).toBeNull();
    expect(model.messages.map((m) => m.text)).toEqual(["Skip the quiz"]);
    expect(model.downloads.map((d) => d.filename)).toEqual(["slides.pdf"]);
    expect(model.error).toEqual({ code: "nav_timeout", message: "The page took too long" });
    expect(model.filedPath).toEqual(["Courses", "ML"]);
    expect(model.model).toBe("gpt-6.1-sol");
  });

  it("knows terminal statuses", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("sleeping")).toBe(false);
  });

  it("keeps the run id from the detail", () => {
    expect(base().runId).toBe(RUN_ID);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/components/run/model/run-model.test.ts`

Expected: FAIL, because `./run-model.ts` is not found.

- [ ] **Step 3: Implement.**

`apps/web/components/run/model/run-model.ts`:
```ts
import {
  TERMINAL_RUN_STATUSES,
  compareEventIds,
  toOrigin,
  type ApprovalMode,
  type ApprovalRequest,
  type ApprovalStatus,
  type Budget,
  type Controller,
  type RunDetail,
  type RunEventRecord,
  type RunStatus,
  type RunStepView,
  type StepAction,
  type StepPhase,
  type StepState,
  type Usage,
  type WaitReason,
} from "@mastertutor/contracts";

export interface StepRow {
  seq: number;
  phase: StepPhase;
  state: StepState;
  caption: string | null;
  url: string | null;
  screenshotKey: string | null;
  action: StepAction | null;
  at: string;
}
export interface PendingApproval {
  id: string;
  request: ApprovalRequest;
  at: string;
}
export interface ApprovalOutcome {
  id: string;
  request: ApprovalRequest | null;
  status: ApprovalStatus;
  decidedBy: string;
  at: string;
}
export interface UserMessage {
  eventId: string;
  text: string;
  at: string;
}
export interface DownloadItem {
  id: string;
  filename: string;
  bytes: number;
  at: string;
}

/** Everything the Run view renders, folded from RunDetail + run_steps + RunEvents. */
export interface RunModel {
  runId: string;
  goal: string;
  status: RunStatus;
  waitReason: WaitReason | null;
  controller: Controller;
  approvalMode: ApprovalMode;
  model: string;
  slotName: string | null;
  currentUrl: string | null;
  usage: Usage;
  budget: Budget;
  noteId: string | null;
  createdAt: string;
  steps: StepRow[];
  approvals: PendingApproval[];
  outcomes: ApprovalOutcome[];
  messages: UserMessage[];
  downloads: DownloadItem[];
  /** Origin whose sign-in the vault filled; drives the "Filled securely" badge (run 13 §6). */
  secureFillOrigin: string | null;
  error: { code: string; message: string } | null;
  filedPath: string[] | null;
  lastEventId: string | null;
}

const SECURE_TOOLS: ReadonlySet<string> = new Set(["fill_credential", "use_passkey"]);
const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export function originOf(url: string | null): string | null {
  return url === null ? null : toOrigin(url);
}

function secureOriginAfter(prev: string | null, step: StepRow, currentUrl: string | null): string | null {
  const origin = originOf(step.url ?? currentUrl);
  const filled =
    step.phase === "act" && step.state === "done" && step.action !== null && SECURE_TOOLS.has(step.action.tool);
  if (filled) return origin;
  return prev !== null && origin !== null && origin !== prev ? null : prev;
}

function upsertStep(steps: StepRow[], row: StepRow): StepRow[] {
  const index = steps.findIndex((s) => s.seq === row.seq);
  if (index >= 0) {
    const next = steps.slice();
    next[index] = { ...row, at: steps[index]?.at ?? row.at };
    return next;
  }
  return [...steps, row].sort((a, b) => a.seq - b.seq);
}

function toRow(view: RunStepView): StepRow {
  return {
    seq: view.seq,
    phase: view.phase,
    state: view.state,
    caption: view.caption,
    url: view.url,
    screenshotKey: view.screenshotKey,
    action: view.action,
    at: view.createdAt,
  };
}

export function initRunModel(detail: RunDetail, views: RunStepView[]): RunModel {
  const steps = views.map(toRow).sort((a, b) => a.seq - b.seq);
  let secure: string | null = null;
  let url: string | null = null;
  for (const step of steps) {
    url = step.url ?? url;
    secure = secureOriginAfter(secure, step, url);
  }
  const current = originOf(detail.currentUrl);
  if (secure !== null && current !== null && current !== secure) secure = null;
  return {
    runId: detail.id,
    goal: detail.goal,
    status: detail.status,
    waitReason: detail.waitReason,
    controller: detail.controller,
    approvalMode: detail.approvalMode,
    model: detail.model,
    slotName: detail.slotName,
    currentUrl: detail.currentUrl,
    usage: detail.usage,
    budget: detail.budget,
    noteId: detail.noteId,
    createdAt: detail.createdAt,
    steps,
    approvals: detail.pendingApprovals
      .filter((a) => a.status === "pending")
      .map((a) => ({ id: a.id, request: a.request, at: a.createdAt })),
    outcomes: [],
    messages: [],
    downloads: [],
    secureFillOrigin: secure,
    error: null,
    filedPath: null,
    lastEventId: detail.lastEventId,
  };
}

export function applyRunEvent(model: RunModel, record: RunEventRecord): RunModel {
  if (record.runId !== model.runId) return model;
  if (model.lastEventId !== null && compareEventIds(record.id, model.lastEventId) <= 0) return model;
  const m: RunModel = { ...model, lastEventId: record.id };
  const e = record.event;
  switch (e.type) {
    case "status":
      return { ...m, status: e.status, waitReason: e.waitReason };
    case "step": {
      const row: StepRow = {
        seq: e.seq,
        phase: e.phase,
        state: e.state,
        caption: e.caption,
        url: e.url,
        screenshotKey: e.screenshotKey,
        action: e.action,
        at: record.at,
      };
      const currentUrl = e.url ?? m.currentUrl;
      return {
        ...m,
        steps: upsertStep(m.steps, row),
        currentUrl,
        secureFillOrigin: secureOriginAfter(m.secureFillOrigin, row, currentUrl),
      };
    }
    case "control":
      return { ...m, controller: e.holder };
    case "slot":
      return { ...m, slotName: e.slotName };
    case "approval_requested":
      return m.approvals.some((a) => a.id === e.approvalId)
        ? m
        : { ...m, approvals: [...m.approvals, { id: e.approvalId, request: e.request, at: record.at }] };
    case "approval_resolved": {
      const found = m.approvals.find((a) => a.id === e.approvalId);
      return {
        ...m,
        approvals: m.approvals.filter((a) => a.id !== e.approvalId),
        outcomes: [
          ...m.outcomes,
          { id: e.approvalId, request: found?.request ?? null, status: e.status, decidedBy: e.decidedBy, at: record.at },
        ],
      };
    }
    case "block_added":
      return { ...m, noteId: e.noteId };
    case "budget":
      return { ...m, usage: e.usage, budget: e.budget };
    case "user_message":
      return { ...m, messages: [...m.messages, { eventId: record.id, text: e.text, at: record.at }] };
    case "download_ready":
      return {
        ...m,
        downloads: [...m.downloads, { id: e.downloadId, filename: e.filename, bytes: e.bytes, at: record.at }],
      };
    case "error":
      return { ...m, error: { code: e.code, message: e.message } };
    case "filed":
      return { ...m, noteId: e.noteId, filedPath: e.path };
    case "model_fallback":
      return { ...m, model: e.to };
  }
}

export function latestStep(model: RunModel): StepRow | null {
  return model.steps.at(-1) ?? null;
}

export function latestPointerStep(model: RunModel): StepRow | null {
  for (let i = model.steps.length - 1; i >= 0; i--) {
    const step = model.steps[i];
    if (step?.action?.point) return step;
  }
  return null;
}

export function latestScreenshotSeq(model: RunModel): number | null {
  for (let i = model.steps.length - 1; i >= 0; i--) {
    const step = model.steps[i];
    if (step?.screenshotKey) return step.seq;
  }
  return null;
}

export function captureCount(model: RunModel): number {
  return model.steps.filter((s) => s.phase === "act" && s.state === "done" && s.action?.tool === "capture").length;
}
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/components/run/model && pnpm typecheck && pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/components/run/model
git commit -m "feat(web): pure RunModel reducer over the RunEvent stream with replay dedupe"
```

---

## Task 6: Takeover machine, browser-state derivation, captions, approval copy and timeline items

**Files:**
- Create in `apps/web/components/run/model/`:
  - `takeover.ts` (+ `takeover.test.ts`)
  - `browser-state.ts` (+ `browser-state.test.ts`)
  - `copy.ts` (+ `copy.test.ts`)
  - `approval-copy.ts` (+ `approval-copy.test.ts`)
  - `timeline-items.ts` (+ `timeline-items.test.ts`)

**Interfaces:**
- Consumes: `RunModel` and its helpers (Task 5), `ApprovalRequest` and `compareEventIds`.
- Produces:
  - **`takeover.ts`:**
    - `TakeoverState` (`{phase:"idle"} | {phase:"requesting"; wake:boolean} | {phase:"releasing"}`), `TakeoverAction` and `IDLE_TAKEOVER`;
    - `takeoverReducer`, `inControl(controller, state)` and `takeoverTimeoutMs(state)`;
    - `TAKEOVER_TIMEOUT_MS = 2000` and `WAKE_TAKEOVER_TIMEOUT_MS = 30000`.
  - **`browser-state.ts`:**
    - `BROWSER_STATES`, `BrowserState`, `Connection` (`"connecting" | "open" | "lost"`) and `ViewFlags`;
    - `deriveBrowserState(model, flags)` and `canTakeOver(model, state, takeover)`.
  - **`copy.ts`:**
    - `STATE_PILL`, `Tone`, `PausedCopy` and `pausedCopy(model)`;
    - `captionFor(state, model, takeover, replayStep)`, `statusLabel(state, model)` and `markFor(state, model)`;
    - `actCount(model)`, `actNumber(model, seq)`, `stepLabel(model)`, `hostAndPath(url)` and `shortRunId(id)`.
  - **`approval-copy.ts`:** `ApprovalCopy`, `approvalCopy(request)`, `requestSummary(request)` and `MAX_LABEL = 120`.
  - **`timeline-items.ts`:** `TimelineItem`, `PendingMessage`, `ThinkingState`, `timelineItems(model, pending)`, `thinkingState(model)`, `summaryLabel(model)` and `elapsedClock(from, at)`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/components/run/model/takeover.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { IDLE_TAKEOVER, inControl, takeoverReducer, takeoverTimeoutMs, type TakeoverState } from "./takeover.ts";

const requesting: TakeoverState = { phase: "requesting", wake: false };

describe("takeover machine", () => {
  it("requests optimistically and confirms on the user's control event", () => {
    const s = takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: false });
    expect(s).toEqual(requesting);
    expect(inControl("agent", s)).toBe(true);
    expect(takeoverReducer(s, { type: "holder", holder: "user" })).toEqual(IDLE_TAKEOVER);
    expect(inControl("user", IDLE_TAKEOVER)).toBe(true);
  });

  it("reverts on timeout or RPC failure", () => {
    expect(takeoverReducer(requesting, { type: "timeout" })).toEqual(IDLE_TAKEOVER);
    expect(takeoverReducer(requesting, { type: "request_failed" })).toEqual(IDLE_TAKEOVER);
  });

  it("waits 2s normally and 30s when it must wake a sleeping run", () => {
    expect(takeoverTimeoutMs(requesting)).toBe(2_000);
    expect(takeoverTimeoutMs({ phase: "requesting", wake: true })).toBe(30_000);
    expect(takeoverTimeoutMs(IDLE_TAKEOVER)).toBeNull();
  });

  it("hands back optimistically and settles on the agent's control event", () => {
    const s = takeoverReducer(IDLE_TAKEOVER, { type: "release" });
    expect(inControl("user", s)).toBe(false);
    expect(takeoverReducer(s, { type: "holder", holder: "agent" })).toEqual(IDLE_TAKEOVER);
    expect(takeoverReducer(s, { type: "release_failed" })).toEqual(IDLE_TAKEOVER);
  });

  it("ignores a request while releasing and a second request while requesting", () => {
    const releasing = takeoverReducer(IDLE_TAKEOVER, { type: "release" });
    expect(takeoverReducer(releasing, { type: "request", wake: false })).toBe(releasing);
    expect(takeoverReducer(requesting, { type: "request", wake: true })).toBe(requesting);
  });
});
```

`apps/web/components/run/model/browser-state.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fixtureDetail, fixtureSteps, rec, recordedEvents } from "../../../e2e/fixtures/run-fixture.ts";
import { canTakeOver, deriveBrowserState, type ViewFlags } from "./browser-state.ts";
import { applyRunEvent, initRunModel } from "./run-model.ts";
import { IDLE_TAKEOVER } from "./takeover.ts";

const flags: ViewFlags = { connection: "open", takeover: IDLE_TAKEOVER, replaying: false, liveRetrying: false };
const model = (over = {}) => initRunModel(fixtureDetail(over), fixtureSteps());

describe("deriveBrowserState", () => {
  it("is live while running and thinking, acting while an act step runs", () => {
    expect(deriveBrowserState(model(), flags)).toBe("live");
    const acting = applyRunEvent(model(), recordedEvents()[0]!);
    expect(deriveBrowserState(acting, flags)).toBe("acting");
  });

  it("shows approval while one is pending, even if the run went to sleep", () => {
    const waiting = recordedEvents().reduce(applyRunEvent, model());
    expect(deriveBrowserState(waiting, flags)).toBe("approval");
    const asleep = applyRunEvent(waiting, rec({ type: "status", status: "sleeping", waitReason: null, reason: null }));
    expect(deriveBrowserState(asleep, flags)).toBe("approval");
  });

  it("puts control above reconnecting, and replay above everything", () => {
    const user = model({ controller: "user" });
    expect(deriveBrowserState(user, { ...flags, connection: "lost" })).toBe("control");
    expect(deriveBrowserState(model(), { ...flags, takeover: { phase: "requesting", wake: false } })).toBe("control");
    expect(deriveBrowserState(user, { ...flags, replaying: true })).toBe("replay");
  });

  it("is reconnecting when the stream or live frame is lost", () => {
    expect(deriveBrowserState(model(), { ...flags, connection: "lost" })).toBe("reconnecting");
    expect(deriveBrowserState(model(), { ...flags, liveRetrying: true })).toBe("reconnecting");
  });

  it("is paused when sleeping, queued, slot-less or finished, and never reconnecting once finished", () => {
    expect(deriveBrowserState(model({ status: "sleeping", slotName: null }), flags)).toBe("paused");
    expect(deriveBrowserState(model({ status: "queued", slotName: null }), flags)).toBe("paused");
    expect(deriveBrowserState(model({ status: "completed" }), { ...flags, connection: "lost" })).toBe("paused");
  });
});

describe("canTakeOver", () => {
  it("allows live, acting and sleeping runs held by the agent", () => {
    expect(canTakeOver(model(), "live", IDLE_TAKEOVER)).toBe(true);
    expect(canTakeOver(model({ status: "sleeping", slotName: null }), "paused", IDLE_TAKEOVER)).toBe(true);
  });

  it("refuses finished, queued, user-held, approval-waiting or in-flight cases", () => {
    expect(canTakeOver(model({ status: "completed" }), "paused", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model({ status: "queued", slotName: null }), "paused", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model({ controller: "user" }), "control", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model(), "approval", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model(), "live", { phase: "releasing" })).toBe(false);
  });
});
```

`apps/web/components/run/model/copy.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fixtureDetail, fixtureSteps, recordedEvents } from "../../../e2e/fixtures/run-fixture.ts";
import { applyRunEvent, initRunModel } from "./run-model.ts";
import { actNumber, captionFor, hostAndPath, markFor, pausedCopy, shortRunId, statusLabel, stepLabel } from "./copy.ts";
import { IDLE_TAKEOVER } from "./takeover.ts";

const model = (over = {}) => initRunModel(fixtureDetail(over), fixtureSteps());

describe("copy", () => {
  it("captions each state verb-first", () => {
    expect(captionFor("live", model(), IDLE_TAKEOVER, null)).toBe("Thinking about the next step");
    const acting = applyRunEvent(model(), recordedEvents()[0]!);
    expect(captionFor("acting", acting, IDLE_TAKEOVER, null)).toBe("Ticking the Honor Code box");
    expect(captionFor("control", model(), { phase: "requesting", wake: true }, null)).toBe(
      "Waking the browser so you can take control…",
    );
    expect(captionFor("control", model({ controller: "user" }), IDLE_TAKEOVER, null)).toBe(
      "You're in control. Screenshots are off",
    );
    expect(captionFor("live", model({ status: "waiting", waitReason: "captcha" }), IDLE_TAKEOVER, null)).toBe(
      "Needs you: solve the CAPTCHA, then hand back",
    );
  });

  it("explains paused runs by status", () => {
    expect(pausedCopy(model({ status: "sleeping" }))).toEqual({
      title: "Paused",
      detail: "Sleeping. Context saved at step 5",
      canResume: true,
    });
    expect(pausedCopy(model({ status: "completed" })).title).toBe("Finished");
    expect(pausedCopy(model({ status: "queued" })).canResume).toBe(false);
  });

  it("labels status, step numbers and marks", () => {
    expect(statusLabel("approval", model())).toBe("Needs your approval");
    expect(stepLabel(model())).toBe("Step 5");
    expect(actNumber(model(), 8)).toBe(5);
    expect(markFor("paused", model({ status: "completed" }))).toBe("done");
    expect(markFor("live", model())).toBe("running");
  });

  it("splits URLs into host and path without www", () => {
    expect(hostAndPath("https://www.learn.example.edu/a/b?c=1")).toEqual({
      host: "learn.example.edu",
      path: "/a/b?c=1",
      secure: true,
    });
    expect(hostAndPath("not a url")).toBeNull();
    expect(shortRunId("0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d")).toBe("run_0b4c2a1e");
  });
});
```

`apps/web/components/run/model/approval-copy.test.ts`:
```ts
import { DEFAULT_BUDGET, EMPTY_USAGE, type ApprovalRequest } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { MAX_LABEL, approvalCopy, requestSummary } from "./approval-copy.ts";

const url = "https://www.learn.example.edu/course/week-2/lecture-3";

describe("approvalCopy", () => {
  it("titles a risky click and spotlights its point", () => {
    const request: ApprovalRequest = {
      kind: "risky_click",
      action: { type: "click", x: 1000, y: 610, button: "left" },
      label: "Start quiz",
      url,
      screenshotKey: null,
    };
    const copy = approvalCopy(request);
    expect(copy.title).toBe("Click “Start quiz” on learn.example.edu?");
    expect(copy.spotlight).toEqual({ x: 1000, y: 610 });
    expect(copy.budget).toBe(false);
    expect(requestSummary(request)).toBe("click “Start quiz”");
  });

  it("truncates hostile labels and strips invisible characters", () => {
    const long = `Pay\u200b${"x".repeat(2_000)}`;
    const copy = approvalCopy({
      kind: "risky_click",
      action: { type: "click", x: 1, y: 1, button: "left" },
      label: long,
      url,
      screenshotKey: null,
    });
    expect(copy.title.length).toBeLessThan(MAX_LABEL + 40);
    expect(copy.title).not.toContain("\u200b");
    expect(copy.title).toContain("…");
  });

  it("covers every approval kind", () => {
    expect(approvalCopy({ kind: "form_submit", url, formSummary: "Honor Code form", screenshotKey: null }).title).toBe(
      "Submit a form on learn.example.edu?",
    );
    expect(approvalCopy({ kind: "download", url, filename: "slides.pdf" }).title).toBe("Download slides.pdf?");
    expect(
      approvalCopy({ kind: "credential_first_use", alias: "ada-learn", origin: "https://learn.example.edu" }).title,
    ).toBe("Sign in to learn.example.edu as ada-learn?");
    expect(approvalCopy({ kind: "new_origin", origin: "https://docs.example.org", url: "https://docs.example.org/x" }).title).toBe(
      "Open docs.example.org?",
    );
    const budget = approvalCopy({
      kind: "budget",
      exceeded: "usd",
      usage: { ...EMPTY_USAGE, usd: 5 },
      budget: DEFAULT_BUDGET,
    });
    expect(budget.title).toBe("Spend limit reached");
    expect(budget.budget).toBe(true);
    expect(budget.body).toContain("$5.00 of $5.00");
  });
});
```

`apps/web/components/run/model/timeline-items.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { APPROVAL_ID, fixtureDetail, fixtureSteps, rec, recordedEvents } from "../../../e2e/fixtures/run-fixture.ts";
import { applyRunEvent, initRunModel } from "./run-model.ts";
import { elapsedClock, summaryLabel, thinkingState, timelineItems } from "./timeline-items.ts";

const base = () => initRunModel(fixtureDetail(), fixtureSteps());

describe("timelineItems", () => {
  it("lists act and approve steps with verbs, statuses and credential chips", () => {
    const items = timelineItems(recordedEvents().reduce(applyRunEvent, base()), []);
    const steps = items.filter((i) => i.kind === "step");
    expect(steps.map((s) => (s.kind === "step" ? s.verb : ""))).toEqual([
      "Click", "Fill", "Click", "Capture", "Capture", "Click", "Approve",
    ]);
    const fill = steps[1];
    expect(fill?.kind === "step" && fill.credential).toBe(true);
    const approve = steps.at(-1);
    expect(approve?.kind === "step" && approve.status).toBe("pending");
    expect(approve?.kind === "step" && approve.current).toBe(true);
  });

  it("merges messages, decisions and downloads in time order", () => {
    const model = [
      ...recordedEvents(),
      rec({ type: "approval_resolved", approvalId: APPROVAL_ID, status: "denied", decidedBy: "user-1" }),
      rec({ type: "user_message", text: "Skip it" }),
    ].reduce(applyRunEvent, base());
    const kinds = timelineItems(model, []).map((i) => i.kind);
    expect(kinds.slice(-2)).toEqual(["decision", "message"]);
    const decision = timelineItems(model, []).find((i) => i.kind === "decision");
    expect(decision?.kind === "decision" && decision.line).toBe("You denied: click “Start quiz”");
  });

  it("shows pending messages until their SSE echo arrives", () => {
    const model = base();
    const pending = [{ key: "k1", text: "Skip it", afterEventId: model.lastEventId }];
    expect(timelineItems(model, pending).filter((i) => i.kind === "message")).toMatchObject([{ pending: true }]);
    const echoed = applyRunEvent(model, rec({ type: "user_message", text: "Skip it" }));
    expect(timelineItems(echoed, pending).filter((i) => i.kind === "message")).toMatchObject([{ pending: false }]);
  });

  it("reports thinking, then settles while acting", () => {
    expect(thinkingState(base())).toMatchObject({ working: true, label: "Thinking about the next step" });
    const acting = applyRunEvent(base(), recordedEvents()[0]!);
    expect(thinkingState(acting)?.working).toBe(false);
    expect(thinkingState(initRunModel(fixtureDetail({ status: "completed" }), fixtureSteps()))).toBeNull();
  });

  it("summarises steps and captures and formats run-relative clocks", () => {
    expect(summaryLabel(base())).toBe("5 steps · 2 captures");
    expect(elapsedClock("2026-10-05T17:04:00.000Z", "2026-10-05T17:10:06.000Z")).toBe("06:06");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/components/run/model`

Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement.**

`apps/web/components/run/model/takeover.ts`:
```ts
import type { Controller } from "@mastertutor/contracts";

/** Spec §10.3: the UI flips immediately and reverts if `control` doesn't arrive in time. */
export const TAKEOVER_TIMEOUT_MS = 2_000;
/** A sleeping run must wake and lease a slot before it can hand over (spec §10.3 last paragraph). */
export const WAKE_TAKEOVER_TIMEOUT_MS = 30_000;

export type TakeoverState = { phase: "idle" } | { phase: "requesting"; wake: boolean } | { phase: "releasing" };
export type TakeoverAction =
  | { type: "request"; wake: boolean }
  | { type: "holder"; holder: Controller }
  | { type: "timeout" }
  | { type: "request_failed" }
  | { type: "release" }
  | { type: "release_failed" };

export const IDLE_TAKEOVER: TakeoverState = { phase: "idle" };

export function takeoverReducer(state: TakeoverState, action: TakeoverAction): TakeoverState {
  switch (action.type) {
    case "request":
      return state.phase === "idle" ? { phase: "requesting", wake: action.wake } : state;
    case "holder":
      if (action.holder === "user" && state.phase === "requesting") return IDLE_TAKEOVER;
      if (action.holder === "agent" && state.phase === "releasing") return IDLE_TAKEOVER;
      return state;
    case "timeout":
    case "request_failed":
      return state.phase === "requesting" ? IDLE_TAKEOVER : state;
    case "release":
      return state.phase === "idle" ? { phase: "releasing" } : state;
    case "release_failed":
      return state.phase === "releasing" ? IDLE_TAKEOVER : state;
  }
}

/** Effective control as the UI shows it: optimistic in both directions. */
export function inControl(controller: Controller, state: TakeoverState): boolean {
  if (state.phase === "requesting") return true;
  return controller === "user" && state.phase !== "releasing";
}

export function takeoverTimeoutMs(state: TakeoverState): number | null {
  if (state.phase !== "requesting") return null;
  return state.wake ? WAKE_TAKEOVER_TIMEOUT_MS : TAKEOVER_TIMEOUT_MS;
}
```

`apps/web/components/run/model/browser-state.ts`:
```ts
import { isTerminal, latestStep, type RunModel } from "./run-model.ts";
import { inControl, type TakeoverState } from "./takeover.ts";

/** Spec §10.4, run 12 and run 13 §6. */
export const BROWSER_STATES = ["live", "acting", "approval", "control", "paused", "reconnecting", "replay"] as const;
export type BrowserState = (typeof BROWSER_STATES)[number];
export type Connection = "connecting" | "open" | "lost";

export interface ViewFlags {
  connection: Connection;
  takeover: TakeoverState;
  replaying: boolean;
  liveRetrying: boolean;
}

export function deriveBrowserState(model: RunModel, flags: ViewFlags): BrowserState {
  if (flags.replaying) return "replay";
  const terminal = isTerminal(model.status);
  if (!terminal && inControl(model.controller, flags.takeover)) return "control";
  if (terminal) return "paused";
  if (flags.connection === "lost" || flags.liveRetrying) return "reconnecting";
  if (model.approvals.length > 0) return "approval";
  if (model.status === "sleeping" || model.status === "queued" || model.slotName === null) return "paused";
  const last = latestStep(model);
  if (model.status === "running" && last?.phase === "act" && last.state === "started") return "acting";
  return "live";
}

export function canTakeOver(model: RunModel, state: BrowserState, takeover: TakeoverState): boolean {
  return (
    !isTerminal(model.status) &&
    model.status !== "queued" &&
    model.controller === "agent" &&
    takeover.phase === "idle" &&
    (state === "live" || state === "acting" || state === "paused")
  );
}
```

`apps/web/components/run/model/copy.ts`:
```ts
import type { StatusMarkStatus } from "../../bits/status-mark.tsx";
import type { BrowserState } from "./browser-state.ts";
import { isTerminal, latestStep, type RunModel, type StepRow } from "./run-model.ts";
import type { TakeoverState } from "./takeover.ts";

export type Tone = "signal" | "tint" | "warn" | "muted" | "ok";

export const STATE_PILL: Record<BrowserState, { label: string; tone: Tone; pulse: boolean }> = {
  live: { label: "Live", tone: "signal", pulse: true },
  acting: { label: "Agent acting", tone: "tint", pulse: true },
  approval: { label: "Needs you", tone: "signal", pulse: true },
  control: { label: "You", tone: "tint", pulse: false },
  paused: { label: "Paused", tone: "muted", pulse: false },
  reconnecting: { label: "Reconnecting", tone: "warn", pulse: false },
  replay: { label: "Replay", tone: "muted", pulse: false },
};

export function actCount(model: RunModel): number {
  return model.steps.filter((s) => s.phase === "act").length;
}

export function actNumber(model: RunModel, seq: number): number {
  return model.steps.filter((s) => s.phase === "act" && s.seq <= seq).length;
}

export interface PausedCopy {
  title: string;
  detail: string;
  canResume: boolean;
}

export function pausedCopy(model: RunModel): PausedCopy {
  switch (model.status) {
    case "sleeping":
      return { title: "Paused", detail: `Sleeping. Context saved at step ${actCount(model)}`, canResume: true };
    case "queued":
      return { title: "Queued", detail: "Waiting for a free browser", canResume: false };
    case "completed":
      return {
        title: "Finished",
        detail: model.filedPath ? `Filed in ${model.filedPath.join(" › ")}` : "The note is in your library",
        canResume: false,
      };
    case "failed":
      return { title: "Stopped", detail: model.error?.message ?? "Something went wrong", canResume: false };
    case "cancelled":
      return { title: "Cancelled", detail: "You stopped this run", canResume: false };
    default:
      return { title: "Starting", detail: "Waiting for a browser", canResume: false };
  }
}

export function captionFor(
  state: BrowserState,
  model: RunModel,
  takeover: TakeoverState,
  replayStep: StepRow | null,
): string {
  switch (state) {
    case "replay":
      return replayStep?.caption ?? "Replaying";
    case "control":
      if (takeover.phase === "requesting") {
        return takeover.wake ? "Waking the browser so you can take control…" : "Handing you the controls…";
      }
      return "You're in control. Screenshots are off";
    case "reconnecting":
      return "Reconnecting to the browser…";
    case "approval":
      return "Waiting for your approval";
    case "paused": {
      const copy = pausedCopy(model);
      return `${copy.title}. ${copy.detail}`;
    }
    case "acting":
      return latestStep(model)?.caption ?? "Working";
    case "live": {
      if (model.status === "waiting" && model.waitReason === "captcha") return "Needs you: solve the CAPTCHA, then hand back";
      if (model.status === "waiting" && model.waitReason === "takeover") return "Needs you: the agent is stuck. Take over to help";
      if (model.status === "waiting" && model.waitReason === "otp") return "Waiting for the code sent to you";
      const last = latestStep(model);
      const thinking = last && (last.phase === "observe" || last.phase === "decide") && last.state === "started";
      return (thinking ? last.caption : null) ?? "Thinking about the next step";
    }
  }
}

export function statusLabel(state: BrowserState, model: RunModel): string {
  switch (state) {
    case "control":
      return "You have control";
    case "approval":
      return "Needs your approval";
    case "paused":
      return pausedCopy(model).title;
    case "reconnecting":
      return "Reconnecting";
    case "replay":
      return "Replaying";
    default:
      return model.status === "waiting" ? "Needs you" : "Running";
  }
}

export function markFor(state: BrowserState, model: RunModel): StatusMarkStatus {
  if (model.status === "completed") return "done";
  if (model.status === "failed") return "failed";
  if (model.status === "cancelled") return "cancelled";
  return state === "paused" ? "pending" : "running";
}

export function stepLabel(model: RunModel): string | null {
  const count = actCount(model);
  return count > 0 ? `Step ${count}` : null;
}

export function hostAndPath(url: string | null): { host: string; path: string; secure: boolean } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return {
    host: parsed.hostname.replace(/^www\./, ""),
    path: `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`,
    secure: parsed.protocol === "https:",
  };
}

export function shortRunId(runId: string): string {
  return `run_${runId.slice(0, 8)}`;
}

export function runIsLive(model: RunModel): boolean {
  return !isTerminal(model.status);
}
```

`apps/web/components/run/model/approval-copy.ts`:
```ts
import type { ApprovalRequest } from "@mastertutor/contracts";

/** Page-derived labels are untrusted (spec §5.5): strip format characters, cap length. */
export const MAX_LABEL = 120;

export interface ApprovalCopy {
  title: string;
  body: string;
  risk: string | null;
  details: readonly (readonly [string, string])[];
  /** In 1280×800 viewport space; the frame dims everything but this point. */
  spotlight: { x: number; y: number } | null;
  budget: boolean;
}

function clean(text: string): string {
  const visible = text.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
  return visible.length > MAX_LABEL ? `${visible.slice(0, MAX_LABEL - 1)}…` : visible;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return clean(url);
  }
}

const EXCEEDED = { steps: "Step", usd: "Spend", minutes: "Time" } as const;

export function requestSummary(request: ApprovalRequest): string {
  switch (request.kind) {
    case "risky_click":
      return `click “${clean(request.label)}”`;
    case "form_submit":
      return `submit a form on ${hostOf(request.url)}`;
    case "download":
      return `download ${request.filename ? clean(request.filename) : "a file"}`;
    case "credential_first_use":
      return `sign in as ${request.alias}`;
    case "new_origin":
      return `open ${hostOf(request.origin)}`;
    case "budget":
      return `${EXCEEDED[request.exceeded].toLowerCase()} budget`;
  }
}

export function approvalCopy(request: ApprovalRequest): ApprovalCopy {
  switch (request.kind) {
    case "risky_click": {
      const a = request.action;
      const point = "x" in a && "y" in a ? { x: a.x, y: a.y } : null;
      return {
        title: `Click “${clean(request.label)}” on ${hostOf(request.url)}?`,
        body: "This could buy, send, delete or submit something on your behalf.",
        risk: "It might not be undoable.",
        details: [["Page", request.url]],
        spotlight: point,
        budget: false,
      };
    }
    case "form_submit":
      return {
        title: `Submit a form on ${hostOf(request.url)}?`,
        body: clean(request.formSummary) || "The agent wants to submit this form.",
        risk: null,
        details: [["Page", request.url]],
        spotlight: null,
        budget: false,
      };
    case "download":
      return {
        title: `Download ${request.filename ? clean(request.filename) : "a file"}?`,
        body: `From ${hostOf(request.url)}. Downloads are kept with the run, not on your computer.`,
        risk: null,
        details: [["Link", request.url]],
        spotlight: null,
        budget: false,
      };
    case "credential_first_use":
      return {
        title: `Sign in to ${hostOf(request.origin)} as ${request.alias}?`,
        body: "The vault fills the sign-in. The agent only sees the alias, never the values.",
        risk: null,
        details: [["Site", request.origin], ["Alias", request.alias]],
        spotlight: null,
        budget: false,
      };
    case "new_origin":
      return {
        title: `Open ${hostOf(request.origin)}?`,
        body: "It's outside the domains you allowed for this run.",
        risk: null,
        details: [["Origin", request.origin], ["Page", request.url]],
        spotlight: null,
        budget: false,
      };
    case "budget": {
      const { usage, budget } = request;
      const used =
        request.exceeded === "steps"
          ? `${usage.steps} of ${budget.maxSteps} steps`
          : request.exceeded === "usd"
            ? `$${usage.usd.toFixed(2)} of $${budget.maxUsd.toFixed(2)}`
            : `${Math.round(usage.activeMs / 60_000)} of ${budget.maxActiveMinutes} minutes`;
      return {
        title: `${EXCEEDED[request.exceeded]} limit reached`,
        body: `Used ${used}. Extend by 50%, finish with what's captured, or cancel the run.`,
        risk: null,
        details: [],
        spotlight: null,
        budget: true,
      };
    }
  }
}
```

`apps/web/components/run/model/timeline-items.ts`:
```ts
import { compareEventIds } from "@mastertutor/contracts";
import type { StatusMarkStatus } from "../../bits/status-mark.tsx";
import { requestSummary } from "./approval-copy.ts";
import { captureCount, isTerminal, type ApprovalOutcome, type RunModel, type StepRow } from "./run-model.ts";

export interface PendingMessage {
  key: string;
  text: string;
  afterEventId: string | null;
}

export type TimelineItem =
  | {
      kind: "step";
      key: string;
      seq: number;
      verb: string;
      verbKind: "cred" | "sig" | null;
      line: string;
      status: StatusMarkStatus;
      ts: string;
      at: string;
      credential: boolean;
      hasShot: boolean;
      current: boolean;
    }
  | { kind: "message"; key: string; text: string; ts: string; at: string; pending: boolean }
  | { kind: "decision"; key: string; line: string; status: StatusMarkStatus; ts: string; at: string }
  | { kind: "download"; key: string; line: string; ts: string; at: string };

export interface ThinkingState {
  label: string;
  since: string;
  working: boolean;
}

const VERBS: Record<string, string> = {
  read_page: "Read",
  capture: "Capture",
  fill_credential: "Fill",
  use_passkey: "Passkey",
  video: "Video",
  annotate: "Note",
};

function verbFor(step: StepRow): string {
  if (step.phase === "approve") return "Approve";
  const tool = step.action?.tool;
  if (tool === "computer") {
    const pointer = step.action?.pointer;
    return pointer === "scroll" ? "Scroll" : pointer === "click" || pointer === "double_click" ? "Click" : "Act";
  }
  return (tool && VERBS[tool]) ?? "Act";
}

function stepStatus(step: StepRow): StatusMarkStatus {
  if (step.state === "done") return "done";
  if (step.state === "aborted" || step.state === "skipped") return "cancelled";
  return step.phase === "approve" ? "pending" : "running";
}

function decisionLine(outcome: ApprovalOutcome): string {
  const byPolicy = outcome.decidedBy === "policy";
  const lead =
    outcome.status === "approved"
      ? byPolicy ? "Approved by policy" : "You approved"
      : outcome.status === "denied"
        ? byPolicy ? "Blocked by policy" : "You denied"
        : outcome.status === "edited"
          ? "You redirected"
          : "No longer needed";
  return outcome.request ? `${lead}: ${requestSummary(outcome.request)}` : lead;
}

export function elapsedClock(from: string, at: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(at) - Date.parse(from)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function timelineItems(model: RunModel, pending: readonly PendingMessage[]): TimelineItem[] {
  const clock = (at: string) => elapsedClock(model.createdAt, at);
  const shown = model.steps.filter((s) => s.phase === "act" || s.phase === "approve");
  const lastSeq = shown.at(-1)?.seq ?? null;
  const live = !isTerminal(model.status);
  const items: TimelineItem[] = shown.map((step) => {
    const credential = step.action?.tool === "fill_credential" || step.action?.tool === "use_passkey";
    return {
      kind: "step",
      key: `step-${step.seq}`,
      seq: step.seq,
      verb: verbFor(step),
      verbKind: credential ? "cred" : step.phase === "approve" ? "sig" : null,
      line: step.action?.summary ?? step.caption ?? `Step ${step.seq}`,
      status: stepStatus(step),
      ts: clock(step.at),
      at: step.at,
      credential,
      hasShot: step.screenshotKey !== null,
      current: live && step.seq === lastSeq,
    };
  });
  for (const m of model.messages) {
    items.push({ kind: "message", key: `msg-${m.eventId}`, text: m.text, ts: clock(m.at), at: m.at, pending: false });
  }
  for (const p of pending) {
    const echoed = model.messages.some(
      (m) => m.text === p.text && (p.afterEventId === null || compareEventIds(m.eventId, p.afterEventId) > 0),
    );
    if (!echoed) {
      const at = new Date().toISOString();
      items.push({ kind: "message", key: `pending-${p.key}`, text: p.text, ts: clock(at), at, pending: true });
    }
  }
  for (const o of model.outcomes) {
    items.push({
      kind: "decision",
      key: `decision-${o.id}`,
      line: decisionLine(o),
      status: o.status === "approved" ? "done" : "cancelled",
      ts: clock(o.at),
      at: o.at,
    });
  }
  for (const d of model.downloads) {
    items.push({ kind: "download", key: `download-${d.id}`, line: `Downloaded ${d.filename}`, ts: clock(d.at), at: d.at });
  }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function thinkingState(model: RunModel): ThinkingState | null {
  if (model.status !== "running" || model.controller !== "agent") return null;
  const last = model.steps.at(-1);
  if (last?.phase === "act" && last.state === "started") {
    return { label: "Thinking about the next step", since: last.at, working: false };
  }
  if (last && (last.phase === "observe" || last.phase === "decide") && last.state === "started") {
    return { label: last.caption ?? "Thinking about the next step", since: last.at, working: true };
  }
  return { label: "Thinking about the next step", since: last?.at ?? model.createdAt, working: true };
}

export function summaryLabel(model: RunModel): string {
  const steps = model.steps.filter((s) => s.phase === "act").length;
  const captures = captureCount(model);
  return `${steps} ${steps === 1 ? "step" : "steps"} · ${captures} ${captures === 1 ? "capture" : "captures"}`;
}
```

`copy.ts` and `timeline-items.ts` import `type StatusMarkStatus` from `../../bits/status-mark.tsx`. That file lands in Task 9, but the import is type-only and erased at test time. To keep `tsc` green **now**, create the type stub that Task 9 extends:

`apps/web/components/bits/status-mark.tsx` (temporary; Task 9 replaces the whole file):
```tsx
export type StatusMarkStatus = "pending" | "running" | "done" | "failed" | "cancelled";
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/components/run/model && pnpm typecheck && pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/components/run/model apps/web/components/bits/status-mark.tsx
git commit -m "feat(web): takeover machine, 7-state derivation, captions, approval copy and timeline items"
```

---

## Task 7: SSE client and the `useRun` hook

**Files:**
- Create: `apps/web/components/run/stream/run-events.ts`, `apps/web/components/run/stream/run-events.test.ts`, `apps/web/components/run/stream/use-run.ts`

**Interfaces:**
- Consumes: `runEventsPath`, `decodeRunEventData`, `RUN_EVENT_SSE_NAME`, `Connection`, `api()` and the reducer (Task 5).
- Produces:
  - `LOST_GRACE_MS = 1500` and `reconnectDelayMs(attempt): number` (500·2ⁿ, capped at 8000);
  - `connectRunEvents(options: RunEventsOptions): { close(): void }`;
  - `useRun(runId): { model: RunModel | null; connection: Connection; loadError: boolean }`.
- **Resume behaviour:** the first connect uses `?after=<RunDetail.lastEventId>`. On browser-level retries the browser sends `Last-Event-ID` itself. On a CLOSED stream the client reconnects with `?after=<last delivered id>` after the backoff.

- [ ] **Step 1: Write the failing test.**

`apps/web/components/run/stream/run-events.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, recordedEvents } from "../../../e2e/fixtures/run-fixture.ts";
import { LOST_GRACE_MS, connectRunEvents, reconnectDelayMs } from "./run-events.ts";

class FakeSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
    FakeSource.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  send(data: string) {
    this.dispatchEvent(new MessageEvent("run_event", { data }));
  }
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.(new Event("error"));
  }
  close() {
    this.readyState = 2;
  }
}

const last = () => FakeSource.all.at(-1)!;

function connect(after: string | null = "12") {
  const records: string[] = [];
  const states: string[] = [];
  const stream = connectRunEvents({
    runId: RUN_ID,
    after,
    onRecord: (r) => records.push(r.id),
    onConnection: (s) => states.push(s),
    EventSourceImpl: FakeSource as unknown as typeof EventSource,
  });
  return { stream, records, states };
}

beforeEach(() => {
  FakeSource.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("connectRunEvents", () => {
  it("connects after the snapshot id and delivers valid records for this run only", () => {
    const { records, states } = connect();
    expect(last().url).toBe(`/api/runs/${RUN_ID}/events?after=12`);
    last().open();
    const [a, b] = recordedEvents();
    last().send(JSON.stringify(a));
    last().send("{not json");
    last().send(JSON.stringify({ ...b, runId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f" }));
    expect(records).toEqual([a!.id]);
    expect(states).toEqual(["open"]);
  });

  it("lets the browser retry (CONNECTING) and reports lost only after the grace", () => {
    const { states } = connect();
    last().open();
    last().fail(false);
    expect(FakeSource.all).toHaveLength(1);
    vi.advanceTimersByTime(LOST_GRACE_MS - 1);
    expect(states).toEqual(["open"]);
    vi.advanceTimersByTime(1);
    expect(states).toEqual(["open", "lost"]);
    last().open();
    expect(states).toEqual(["open", "lost", "open"]);
  });

  it("reopens a CLOSED stream after backoff, resuming from the last delivered id", () => {
    connect();
    last().open();
    last().send(JSON.stringify(recordedEvents()[2]));
    last().fail(true);
    vi.advanceTimersByTime(reconnectDelayMs(0));
    expect(FakeSource.all).toHaveLength(2);
    expect(last().url).toBe(`/api/runs/${RUN_ID}/events?after=15`);
    last().fail(true);
    vi.advanceTimersByTime(reconnectDelayMs(1) - 1);
    expect(FakeSource.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSource.all).toHaveLength(3);
  });

  it("backs off exponentially to 8s", () => {
    expect([0, 1, 2, 3, 4, 5].map(reconnectDelayMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it("stops everything on close", () => {
    const { stream, states } = connect();
    last().fail(true);
    stream.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSource.all).toHaveLength(1);
    expect(states).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/components/run/stream`

Expected: FAIL, because `./run-events.ts` is not found.

- [ ] **Step 3: Implement.**

`apps/web/components/run/stream/run-events.ts`:
```ts
import {
  RUN_EVENT_SSE_NAME,
  decodeRunEventData,
  runEventsPath,
  type RunEventRecord,
} from "@mastertutor/contracts";
import type { Connection } from "../model/browser-state.ts";

/** A blip shorter than this never flashes "Reconnecting". */
export const LOST_GRACE_MS = 1_500;

export function reconnectDelayMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt);
}

export interface RunEventsOptions {
  runId: string;
  /** RunDetail.lastEventId: resume right after the snapshot. */
  after: string | null;
  onRecord(record: RunEventRecord): void;
  onConnection(state: Connection): void;
  /** Tests inject a fake; production uses the browser's EventSource. */
  EventSourceImpl?: typeof EventSource;
}

/**
 * Streams RunEvents over SSE (spec §6). While the browser retries on its own (CONNECTING) it sends
 * Last-Event-ID; if the stream is CLOSED (HTTP error), we reopen with ?after=<last id> on backoff.
 */
export function connectRunEvents(options: RunEventsOptions): { close(): void } {
  const Impl = options.EventSourceImpl ?? EventSource;
  let lastId = options.after;
  let attempt = 0;
  let closed = false;
  let source: EventSource | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let state: Connection = "connecting";

  const report = (next: Connection) => {
    if (closed || next === state) return;
    state = next;
    options.onConnection(next);
  };

  const onMessage = (event: Event) => {
    const record = decodeRunEventData(String((event as MessageEvent).data));
    if (!record || record.runId !== options.runId) return;
    lastId = record.id;
    options.onRecord(record);
  };

  const open = () => {
    const current = new Impl(runEventsPath(options.runId, lastId));
    source = current;
    current.addEventListener(RUN_EVENT_SSE_NAME, onMessage);
    current.onopen = () => {
      attempt = 0;
      clearTimeout(graceTimer);
      graceTimer = undefined;
      report("open");
    };
    current.onerror = () => {
      if (closed) return;
      graceTimer ??= setTimeout(() => report("lost"), LOST_GRACE_MS);
      if (current.readyState === Impl.CLOSED) {
        current.close();
        source = null;
        retryTimer = setTimeout(open, reconnectDelayMs(attempt++));
      }
    };
  };

  open();
  return {
    close() {
      closed = true;
      clearTimeout(graceTimer);
      clearTimeout(retryTimer);
      source?.close();
    },
  };
}
```

`apps/web/components/run/stream/use-run.ts`:
```ts
"use client";

import type { RunEventRecord, RunStepView } from "@mastertutor/contracts";
import { useEffect, useReducer, useState } from "react";
import { api } from "../../../lib/api/client.ts";
import type { Connection } from "../model/browser-state.ts";
import { applyRunEvent, initRunModel, isTerminal, type RunModel } from "../model/run-model.ts";
import { connectRunEvents } from "./run-events.ts";

const STEP_PAGE = 500;

type Action = { type: "init"; model: RunModel } | { type: "event"; record: RunEventRecord };

function reducer(state: RunModel | null, action: Action): RunModel | null {
  if (action.type === "init") return action.model;
  return state === null ? null : applyRunEvent(state, action.record);
}

async function loadAllSteps(runId: string): Promise<RunStepView[]> {
  const all: RunStepView[] = [];
  let afterSeq: number | null = null;
  for (;;) {
    const { items } = await api().runs.steps({ runId, afterSeq, limit: STEP_PAGE });
    all.push(...items);
    const last = items.at(-1);
    if (items.length < STEP_PAGE || !last) return all;
    afterSeq = last.seq;
  }
}

export interface RunHandle {
  model: RunModel | null;
  connection: Connection;
  loadError: boolean;
}

/** Snapshot (runs.get + runs.steps), then the SSE stream from the snapshot's lastEventId. */
export function useRun(runId: string): RunHandle {
  const [model, dispatch] = useReducer(reducer, null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [loadError, setLoadError] = useState(false);
  const [after, setAfter] = useState<{ id: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api().runs.get({ runId }), loadAllSteps(runId)]).then(
      ([detail, steps]) => {
        if (cancelled) return;
        dispatch({ type: "init", model: initRunModel(detail, steps) });
        setAfter({ id: detail.lastEventId });
      },
      () => {
        if (!cancelled) setLoadError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const terminal = model !== null && isTerminal(model.status);
  useEffect(() => {
    if (after === null || terminal) return;
    const stream = connectRunEvents({
      runId,
      after: after.id,
      onRecord: (record) => dispatch({ type: "event", record }),
      onConnection: setConnection,
    });
    return () => stream.close();
  }, [runId, after, terminal]);

  return { model, connection, loadError };
}
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/components/run/stream && pnpm typecheck && pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/components/run/stream
git commit -m "feat(web): SSE run event client with grace, backoff and Last-Event-ID resume; useRun hook"
```

---

## Task 8: Shared easing, cursor arc and `AgentCursor`

**Files:**
- Create: `apps/web/lib/easing.ts` (+ `easing.test.ts`), `apps/web/components/run/cursor/cursor-path.ts` (+ `cursor-path.test.ts`), `apps/web/components/run/cursor/agent-cursor.tsx`, `apps/web/components/run/cursor/agent-cursor.module.css`

**Interfaces:**
- Consumes: `durationMs` and `easing` (Task 1), and `VIEWPORT`.
- Produces:
  - `type Bezier`, `cubicBezier(b): (x) => number` and `clamp01(v)` (also used by the F5 hero);
  - `Point`, `MS_PER_PX = 0.35`, `ARC_RATIO = 0.2` and `ARC_MAX_PX = 70`;
  - `travelMs(from, to)`, `arcControl(from, to)`, `pointOnArc(from, control, to, t)` and `toViewport(point, box)`;
  - `AgentCursor({ target: Point | null; pulseKey: number | null; hidden: boolean; thinking: boolean })`. It renders `data-testid="click-pulse"` when pulsing.

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/easing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { clamp01, cubicBezier } from "./easing.ts";

describe("cubicBezier", () => {
  it("matches CSS endpoints and the linear curve", () => {
    const linear = cubicBezier([0, 0, 1, 1]);
    expect(linear(0)).toBe(0);
    expect(linear(1)).toBe(1);
    expect(linear(0.3)).toBeCloseTo(0.3, 3);
  });

  it("is monotonic and front-loaded for the cursor curve", () => {
    const cursor = cubicBezier([0.2, 0.8, 0.2, 1]);
    let prev = 0;
    for (let x = 0.05; x <= 1; x += 0.05) {
      const y = cursor(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(cursor(0.5)).toBeGreaterThan(0.85);
  });

  it("clamps", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});
```

`apps/web/components/run/cursor/cursor-path.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ARC_MAX_PX, arcControl, pointOnArc, toViewport, travelMs } from "./cursor-path.ts";

describe("cursor path", () => {
  it("travels 250–450ms depending on distance", () => {
    expect(travelMs({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(250);
    expect(travelMs({ x: 0, y: 0 }, { x: 200, y: 0 })).toBe(320);
    expect(travelMs({ x: 0, y: 0 }, { x: 2000, y: 0 })).toBe(450);
  });

  it("bends perpendicular to the path, capped", () => {
    const c = arcControl({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(c).toEqual({ x: 50, y: 20 });
    const far = arcControl({ x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(far.y).toBe(ARC_MAX_PX);
  });

  it("starts and ends on the endpoints", () => {
    const from = { x: 10, y: 20 };
    const to = { x: 300, y: 400 };
    const c = arcControl(from, to);
    expect(pointOnArc(from, c, to, 0)).toEqual(from);
    expect(pointOnArc(from, c, to, 1)).toEqual(to);
  });

  it("scales 1280×800 points into the rendered viewport", () => {
    expect(toViewport({ x: 640, y: 400 }, { width: 640, height: 400 })).toEqual({ x: 320, y: 200 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/easing.test.ts apps/web/components/run/cursor`

Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement.**

`apps/web/lib/easing.ts`:
```ts
/** CSS cubic-bezier() solver, shared by the agent cursor and the 3D hero (one source of truth). */
export type Bezier = readonly [number, number, number, number];

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function cubicBezier([x1, y1, x2, y2]: Bezier): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= (sampleX(t) - x) / slope;
    }
    t = clamp01(t);
    if (Math.abs(sampleX(t) - x) > 1e-4) {
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        const value = sampleX(t);
        if (Math.abs(value - x) < 1e-6) break;
        if (value < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sampleY(t);
  };
}
```

`apps/web/components/run/cursor/cursor-path.ts`:
```ts
import { VIEWPORT } from "@mastertutor/contracts";
import { durationMs } from "../../../lib/motion-tokens.ts";

export interface Point {
  x: number;
  y: number;
}

/** Run 13 §6: 250–450ms depending on distance, with a slight arc. */
export const MS_PER_PX = 0.35;
export const ARC_RATIO = 0.2;
export const ARC_MAX_PX = 70;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function travelMs(from: Point, to: Point): number {
  return Math.min(durationMs.cursorMax, Math.max(durationMs.cursorMin, durationMs.cursorMin + distance(from, to) * MS_PER_PX));
}

export function arcControl(from: Point, to: Point): Point {
  const d = distance(from, to);
  if (d < 1) return { x: from.x, y: from.y };
  const offset = Math.min(ARC_MAX_PX, d * ARC_RATIO);
  return {
    x: (from.x + to.x) / 2 + (-(to.y - from.y) / d) * offset,
    y: (from.y + to.y) / 2 + ((to.x - from.x) / d) * offset,
  };
}

export function pointOnArc(from: Point, control: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

/** The live frame is always 16:10, so one scale maps both axes. */
export function toViewport(point: Point, box: { width: number; height: number }): Point {
  const scale = box.width / VIEWPORT.width;
  return { x: point.x * scale, y: point.y * scale };
}
```

`apps/web/components/run/cursor/agent-cursor.tsx`:
```tsx
"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { cubicBezier } from "../../../lib/easing.ts";
import { easing } from "../../../lib/motion-tokens.ts";
import { arcControl, pointOnArc, travelMs, type Point } from "./cursor-path.ts";
import styles from "./agent-cursor.module.css";

const ease = cubicBezier(easing.cursor);
const HOTSPOT = { x: 3, y: 2 };

export interface AgentCursorProps {
  /** Viewport pixels; null hides the cursor. */
  target: Point | null;
  /** A new value plays the click ring once (step seq of a finished click). */
  pulseKey: number | null;
  hidden: boolean;
  thinking: boolean;
}

/** The only agent cursor: CDP input never moves the X cursor (spec §10.2 #6). Driven by events, not frames. */
export function AgentCursor({ target, pulseKey, hidden, thinking }: AgentCursorProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef<Point | null>(null);
  const tx = target?.x ?? null;
  const ty = target?.y ?? null;

  useEffect(() => {
    const el = ref.current;
    if (!el || tx === null || ty === null) return;
    const to = { x: tx, y: ty };
    const place = (p: Point) => {
      at.current = p;
      el.style.transform = `translate(${p.x - HOTSPOT.x}px, ${p.y - HOTSPOT.y}px)`;
    };
    const from = at.current;
    if (!from || reduce) {
      place(to);
      return;
    }
    const control = arcControl(from, to);
    const total = travelMs(from, to);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / total);
      place(pointOnArc(from, control, to, ease(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tx, ty, reduce]);

  return (
    <div className={styles.layer} aria-hidden="true">
      <div ref={ref} className={styles.cursor} data-hidden={hidden || target === null || undefined}>
        <div className={styles.drift} data-thinking={thinking || undefined}>
          <svg viewBox="0 0 20 20" className={styles.arrow}>
            <path d="M3 2 L3 16.5 L7 12.8 L9.6 18.4 L12 17.3 L9.5 11.8 L15 11.8 Z" />
          </svg>
        </div>
        <span className={styles.who}>Agent</span>
      </div>
      {pulseKey !== null && target && !hidden ? (
        <span
          key={pulseKey}
          data-testid="click-pulse"
          className={styles.pulse}
          style={{ left: target.x, top: target.y }}
        />
      ) : null}
    </div>
  );
}
```

`apps/web/components/run/cursor/agent-cursor.module.css`:
```css
.layer { position: absolute; inset: 0; z-index: 5; overflow: hidden; pointer-events: none; }
.cursor {
  position: absolute; left: 0; top: 0; inline-size: 1.25rem; block-size: 1.25rem;
  will-change: transform; transition: opacity var(--dur-base) var(--ease-out);
}
.cursor[data-hidden] { opacity: 0; }
.drift[data-thinking] { animation: drift var(--dur-drift) var(--ease-out) infinite; }
.arrow {
  inline-size: 1.25rem; block-size: 1.25rem; overflow: visible;
  fill: var(--color-cursor); stroke: var(--color-cursor-outline); stroke-width: 1.5; stroke-linejoin: round;
}
.who {
  position: absolute; left: 1.0625rem; top: 1.0625rem; padding: .125rem .4375rem; border-radius: var(--radius-pill);
  background: var(--color-signal); color: var(--color-on-signal); font: 600 .625rem/1.4 var(--font-sans); white-space: nowrap;
}
.pulse {
  position: absolute; inline-size: 1.5rem; block-size: 1.5rem; margin: -.75rem 0 0 -.75rem; border-radius: 50%;
  border: .125rem solid var(--color-tint); opacity: 0;
  animation: pulse var(--dur-click-pulse) var(--ease-out) forwards;
}
@keyframes pulse { from { transform: scale(1); opacity: .35; } to { transform: scale(1.8333); opacity: 0; } }
@keyframes fade-dot { from { opacity: .35; } to { opacity: 0; } }
@keyframes drift {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(.125rem, -.0625rem); }
  50% { transform: translate(.0625rem, .125rem); }
  75% { transform: translate(-.125rem, .0625rem); }
}
@media (prefers-reduced-motion: reduce) {
  .drift[data-thinking] { animation: none; }
  .pulse { transform: scale(.5); animation-name: fade-dot; }
}
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/lib apps/web/components/run/cursor && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/lib/easing.ts apps/web/lib/easing.test.ts apps/web/components/run/cursor
git commit -m "feat(web): shared cubic-bezier, eased-arc agent cursor with click pulse and idle drift"
```

---

## Task 9: Adapted React Bits: StatusMark, ThoughtLine and CountUp

**Files:**
- Create: `apps/web/components/bits/format.ts` (+ `format.test.ts`), `thought-line.tsx`, `thought-line.module.css`, `count-up.tsx`, `status-mark.module.css`
- Modify (full replacement): `apps/web/components/bits/status-mark.tsx`

**Interfaces:**
- Consumes: `spring`, `Icon`, and `useReducedMotion`/`animate`/`useMotionValue` from `motion/react`.
- Produces:
  - `formatElapsed(ms)`, `spokenElapsed(ms)`, `formatCount(value, decimals, prefix?, suffix?)` and `compactNumber(n)`;
  - `StatusMark({ status: StatusMarkStatus; label?: ReactNode; strike?: boolean })` and `type StatusMarkStatus`;
  - `ThoughtLine({ label: string; working: boolean; since: string })`;
  - `CountUp({ value: number; decimals?: number; prefix?: string; suffix?: string; className?: string })`.
- **Provenance:** each file is adapted from the upstream TS-TW source, fetched for reference only. We do **not** use `shadcn add`, because it would install `@hugeicons/*`, which the adaptation removes. Each file carries the licence header. `LICENSE-react-bits` (F1) covers them.

- [ ] **Step 1: Fetch the upstream sources for reference (not committed).**

Run:
```bash
mkdir -p /tmp/react-bits && for n in StatusMark ThoughtLine CountUp CodeSlots; do curl -fsS "https://reactbits.dev/r/$n-TS-TW.json" -o "/tmp/react-bits/$n.json"; done && ls /tmp/react-bits
```

Expected: four JSON files. They are for reading only.

**Adaptation pass applied below (spec §11.4 #3):**
- tokens replace hard-coded colours;
- `Icon` replaces hugeicons;
- shared springs and durations come from the motion module;
- `useReducedMotion` or CSS reduced-motion handling is added;
- only transform and opacity animate: StatusMark's dash-offset spin becomes a rotate, ThoughtLine's blur and shimmer are removed;
- unused props are stripped.

- [ ] **Step 2: Write the failing test.**

`apps/web/components/bits/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { compactNumber, formatCount, formatElapsed, spokenElapsed } from "./format.ts";

describe("format", () => {
  it("formats elapsed thinking time to a tenth of a second", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(3_240)).toBe("3.2s");
    expect(formatElapsed(65_500)).toBe("1m 5.5s");
    expect(spokenElapsed(3_240)).toBe("3.2 seconds");
  });

  it("formats counts with fixed decimals and affixes", () => {
    expect(formatCount(0.4, 2, "$")).toBe("$0.40");
    expect(formatCount(1500, 0)).toBe("1,500");
    expect(formatCount(6.4, 0, "", " min")).toBe("6 min");
  });

  it("compacts token counts", () => {
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(188_400)).toBe("188k");
    expect(compactNumber(2_400_000)).toBe("2.4M");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/components/bits/format.test.ts`

Expected: FAIL, because `./format.ts` is not found.

- [ ] **Step 4: Implement.**

`apps/web/components/bits/format.ts`:
```ts
export function formatElapsed(ms: number): string {
  const ds = Math.floor(Math.max(0, ms) / 100);
  return ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;
}

export function spokenElapsed(ms: number): string {
  const ds = Math.floor(Math.max(0, ms) / 100);
  return ds < 600
    ? `${(ds / 10).toFixed(1)} seconds`
    : `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`;
}

export function formatCount(value: number, decimals: number, prefix = "", suffix = ""): string {
  const text = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${prefix}${text}${suffix}`;
}

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
```

`apps/web/components/bits/status-mark.tsx` (replaces the Task 6 stub):
```tsx
/*
 * Adapted from React Bits "StatusMark" (MIT + Commons Clause; see LICENSE-react-bits).
 * Changes: CSS-only, tokens for colour and timing, spin by rotate (transform) not dash offset,
 * check/cross by scale + opacity, reduced-motion variants, unused props removed.
 */
import type { ReactNode } from "react";
import styles from "./status-mark.module.css";

export type StatusMarkStatus = "pending" | "running" | "done" | "failed" | "cancelled";

const SPOKEN: Record<StatusMarkStatus, string> = {
  pending: "Pending",
  running: "In progress",
  done: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function StatusMark({
  status,
  label,
  strike = false,
}: {
  status: StatusMarkStatus;
  label?: ReactNode;
  strike?: boolean;
}) {
  const hasLabel = label !== undefined && label !== null;
  return (
    <span className={styles.root} data-status={status} data-strike={strike || undefined}>
      <svg
        className={styles.mark}
        viewBox="0 0 24 24"
        role={hasLabel ? undefined : "img"}
        aria-label={hasLabel ? undefined : SPOKEN[status]}
        aria-hidden={hasLabel || undefined}
      >
        <circle className={styles.track} cx="12" cy="12" r="9" />
        <circle className={styles.arc} cx="12" cy="12" r="9" pathLength={100} />
        <path className={styles.check} d="M7.5 12.25 10.5 15.25 16.75 8.75" />
        <path className={styles.cross} d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5" />
      </svg>
      {hasLabel ? (
        <>
          <span className="sr-only">{SPOKEN[status]}: </span>
          <span className={styles.label}>
            {label}
            <span className={styles.strikeLine} aria-hidden="true" />
          </span>
        </>
      ) : null}
    </span>
  );
}
```

`apps/web/components/bits/status-mark.module.css`:
```css
.root { display: inline-flex; align-items: flex-start; gap: .5rem; color: var(--color-label-2); min-inline-size: 0; }
.mark { flex: none; inline-size: 1.125rem; block-size: 1.125rem; margin-block-start: .0625rem; overflow: visible; }
.track, .arc, .check, .cross { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.track { stroke-dasharray: 3.53 3.53; opacity: .55; }
.arc { opacity: 0; stroke-dasharray: 68 32; transform-box: view-box; transform-origin: 12px 12px; }
.check, .cross {
  opacity: 0; transform-box: view-box; transform-origin: 12px 12px; transform: scale(.6);
  transition: opacity var(--dur-base) var(--ease-out), transform var(--spring-duration) var(--spring);
}
.label { position: relative; color: var(--color-label); min-inline-size: 0; overflow-wrap: anywhere; }
.strikeLine {
  position: absolute; inset-inline: 0; inset-block-start: 50%; block-size: .0625rem; background: currentColor;
  transform: scaleX(0); transform-origin: left; transition: transform var(--dur-panel) var(--ease-out);
}
.root[data-status="running"] { color: var(--color-tint); }
.root[data-status="running"] .track { stroke-dasharray: none; opacity: .2; }
.root[data-status="running"] .arc { opacity: 1; animation: spin var(--dur-spin) var(--ease-linear) infinite; }
.root[data-status="done"] { color: var(--color-ok); }
.root[data-status="done"] .track { stroke-dasharray: none; opacity: 1; }
.root[data-status="done"] .check { opacity: 1; transform: none; }
.root[data-status="failed"] { color: var(--color-danger); }
.root[data-status="failed"] .track { stroke-dasharray: none; opacity: 1; }
.root[data-status="failed"] .cross, .root[data-status="cancelled"] .cross { opacity: 1; transform: none; }
.root[data-status="cancelled"] { color: var(--color-label-3); }
.root[data-strike][data-status="done"] .strikeLine { transform: scaleX(1); }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) {
  .root[data-status="running"] .arc { animation: breathe var(--dur-breathe) var(--ease-out) infinite; }
  .check, .cross, .strikeLine { transform: none; transition: opacity var(--dur-base) var(--ease-out); }
}
```

`apps/web/components/bits/thought-line.tsx`:
```tsx
"use client";
/*
 * Adapted from React Bits "ThoughtLine" (MIT + Commons Clause; see LICENSE-react-bits).
 * Changes: blur crossfade → opacity, shimmer and step trace removed, glyph from our Icon set,
 * timing from motion tokens, reduced motion via CSS.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icon.tsx";
import { formatElapsed, spokenElapsed } from "./format.ts";
import styles from "./thought-line.module.css";

const TICK_MS = 100;

export function ThoughtLine({ label, working, since }: { label: string; working: boolean; since: string }) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const elapsed = useRef(0);
  const [announce, setAnnounce] = useState(label);

  useEffect(() => {
    const start = Date.parse(since);
    const paint = () => {
      elapsed.current = Math.max(0, Date.now() - start);
      if (timerRef.current) timerRef.current.textContent = formatElapsed(elapsed.current);
    };
    paint();
    if (!working) return;
    const id = setInterval(paint, TICK_MS);
    return () => clearInterval(id);
  }, [since, working]);

  useEffect(() => {
    setAnnounce(working ? label : `Thought for ${spokenElapsed(elapsed.current)}`);
  }, [working, label]);

  return (
    <div className={styles.root} data-working={working || undefined}>
      <span className={styles.glyph} aria-hidden="true">
        <Icon name="sparkles" />
      </span>
      <span className={styles.labels} aria-hidden="true">
        <span className={styles.work}>{label}</span>
        <span className={styles.done}>Thought for</span>
      </span>
      <span ref={timerRef} className={styles.timer} aria-hidden="true">
        0.0s
      </span>
      <span className="sr-only" role="status">
        {announce}
      </span>
    </div>
  );
}
```

`apps/web/components/bits/thought-line.module.css`:
```css
.root { display: flex; align-items: center; gap: .375rem; min-inline-size: 0; font: 500 .8125rem/1.3 var(--font-sans); color: var(--color-label-2); }
.glyph { display: inline-flex; flex: none; color: var(--color-tint); opacity: .55; transition: opacity var(--dur-panel) var(--ease-out); }
.root[data-working] .glyph { animation: breathe var(--dur-breathe) var(--ease-out) infinite; }
.labels { display: inline-grid; min-inline-size: 0; }
.work, .done { grid-area: 1 / 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: opacity var(--dur-panel) var(--ease-out); }
.work { opacity: 0; color: var(--color-label); }
.done { opacity: .6; }
.root[data-working] .work { opacity: 1; }
.root[data-working] .done { opacity: 0; }
.timer { flex: none; font-variant-numeric: tabular-nums; opacity: .6; }
@keyframes breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .root[data-working] .glyph { animation: none; opacity: 1; } }
```

`apps/web/components/bits/count-up.tsx`:
```tsx
"use client";
/*
 * Adapted from React Bits "CountUp" (MIT + Commons Clause; see LICENSE-react-bits).
 * Changes: animates between successive values on the shared D21 spring, tabular numerals,
 * reduced motion jumps, the final value is exposed to assistive tech once.
 */
import { animate, useMotionValue, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { spring } from "../../lib/motion-tokens.ts";
import { formatCount } from "./format.ts";

export interface CountUpProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function CountUp({ value, decimals = 0, prefix = "", suffix = "", className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(value);
  const reduce = useReducedMotion();
  const format = useCallback((v: number) => formatCount(v, decimals, prefix, suffix), [decimals, prefix, suffix]);

  useEffect(
    () =>
      motionValue.on("change", (v) => {
        if (ref.current) ref.current.textContent = format(v);
      }),
    [motionValue, format],
  );

  useEffect(() => {
    if (reduce) {
      motionValue.jump(value);
      return;
    }
    const controls = animate(motionValue, value, spring);
    return () => controls.stop();
  }, [value, reduce, motionValue]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true" style={{ fontVariantNumeric: "tabular-nums" }}>
        {format(motionValue.get())}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
```

- [ ] **Step 5: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/components/bits && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS. The visual behaviour is exercised by the Task 15 Playwright specs.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/components/bits
git commit -m "feat(web): adapted React Bits StatusMark, ThoughtLine and CountUp (tokens, transform/opacity, reduced motion)"
```

---

## Task 10: CodeSlots with its security review

**Files:**
- Create in `apps/web/components/bits/`: `code-slots-logic.ts` (+ `code-slots-logic.test.ts`), `code-slots.tsx`, `code-slots.module.css`, `code-slots.security.test.ts`

**Interfaces:**
- Consumes: `spring` and `m`/`useReducedMotion`.
- Produces:
  - `OTP_MIN_DIGITS = 4`, `OTP_MAX_DIGITS = 8` and `OTP_DEFAULT_DIGITS = 6`;
  - `SlotsState`, `digitsOf`, `emptySlots`, `typeDigits`, `pasteDigits`, `backspace` and `isComplete`;
  - `CodeSlots({ label: string; sealed: number | null; disabled?: boolean; onComplete(code: string): void })`. It clears its own state **before** calling `onComplete`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/components/bits/code-slots-logic.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { backspace, digitsOf, emptySlots, isComplete, pasteDigits, typeDigits } from "./code-slots-logic.ts";

const fresh = () => ({ slots: emptySlots(6), active: 0 });

describe("code slots logic", () => {
  it("types digits left to right and completes on the last box", () => {
    let s = fresh();
    for (const d of "48151") s = typeDigits(s, d);
    expect(s).toEqual({ slots: ["4", "8", "1", "5", "1", ""], active: 5 });
    expect(isComplete(s.slots)).toBe(false);
    s = typeDigits(s, "6");
    expect(isComplete(s.slots)).toBe(true);
    expect(s.slots.join("")).toBe("481516");
  });

  it("accepts pasted or autofilled codes with spaces or dashes", () => {
    expect(pasteDigits(fresh(), "123 456").slots.join("")).toBe("123456");
    expect(pasteDigits(fresh(), "12-34-56").slots.join("")).toBe("123456");
    expect(digitsOf("Your code: 9 9 1 2")).toBe("9912");
  });

  it("resizes for 4–8 digit codes", () => {
    const eight = pasteDigits(fresh(), "12345678");
    expect(eight.slots).toHaveLength(8);
    expect(isComplete(eight.slots)).toBe(true);
    expect(pasteDigits(fresh(), "4321").slots).toHaveLength(4);
  });

  it("fills from the caret when the paste is too short or too long to be a code", () => {
    expect(pasteDigits(fresh(), "12").slots.join("")).toBe("12");
    expect(pasteDigits(fresh(), "123456789").slots.join("")).toBe("123456");
  });

  it("deletes backwards", () => {
    let s = typeDigits(typeDigits(fresh(), "1"), "2");
    s = backspace(s);
    expect(s).toEqual({ slots: ["1", "", "", "", "", ""], active: 1 });
    s = backspace(s);
    expect(s).toEqual({ slots: emptySlots(6), active: 0 });
  });
});
```

`apps/web/components/bits/code-slots.security.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Spec §11.4 #5: CodeSlots must pass this review before merge. */
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const files = ["./code-slots.tsx", "./code-slots-logic.ts"].map(source).join("\n");
const css = source("./code-slots.module.css");

describe("CodeSlots security review", () => {
  it("uses one-time-code autofill and a numeric keypad", () => {
    expect(files).toContain('autoComplete="one-time-code"');
    expect(files).toContain('inputMode="numeric"');
  });

  it("never logs, persists or transmits the code itself", () => {
    for (const banned of ["console.", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "fetch(", "JSON.stringify"]) {
      expect(files, banned).not.toContain(banned);
    }
  });

  it("keeps the real input empty so the code never sits in the DOM value", () => {
    expect(files).toContain('value=""');
  });

  it("clears its state before handing the code over", () => {
    const body = files.slice(files.indexOf("const commit"));
    expect(body.indexOf("setState({ slots: emptySlots")).toBeLessThan(body.indexOf("onComplete(code)"));
  });

  it("seals to dots and fits six boxes at 390px", () => {
    expect(files).toContain('"•"');
    expect(css).toContain("repeat(var(--n), minmax(0, 3rem))");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/components/bits/code-slots`

Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement.**

`apps/web/components/bits/code-slots-logic.ts`:
```ts
/** SubmitOtpInput accepts 4–8 digits (Phase 0 dto.ts). */
export const OTP_MIN_DIGITS = 4;
export const OTP_MAX_DIGITS = 8;
export const OTP_DEFAULT_DIGITS = 6;

export interface SlotsState {
  slots: string[];
  active: number;
}

export function digitsOf(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function emptySlots(length: number): string[] {
  return Array.from({ length }, () => "");
}

export function typeDigits(state: SlotsState, raw: string): SlotsState {
  const digits = digitsOf(raw);
  if (!digits) return state;
  const slots = state.slots.slice();
  let i = state.active;
  for (const digit of digits) {
    if (i >= slots.length) break;
    slots[i] = digit;
    i++;
  }
  return { slots, active: Math.min(i, slots.length - 1) };
}

/** A whole code (paste or OS autofill) replaces the boxes and sizes them to the code. */
export function pasteDigits(state: SlotsState, raw: string): SlotsState {
  const digits = digitsOf(raw);
  if (digits.length >= OTP_MIN_DIGITS && digits.length <= OTP_MAX_DIGITS) {
    return { slots: digits.split(""), active: digits.length - 1 };
  }
  return typeDigits(state, digits);
}

export function backspace(state: SlotsState): SlotsState {
  const slots = state.slots.slice();
  if (slots[state.active]) {
    slots[state.active] = "";
    return { slots, active: state.active };
  }
  const prev = Math.max(0, state.active - 1);
  slots[prev] = "";
  return { slots, active: prev };
}

export function isComplete(slots: readonly string[]): boolean {
  return slots.length >= OTP_MIN_DIGITS && slots.every((s) => s !== "");
}
```

`apps/web/components/bits/code-slots.tsx`:
```tsx
"use client";
/*
 * Adapted from React Bits "CodeSlots" (MIT + Commons Clause; see LICENSE-react-bits).
 * Security review (spec §11.4 #5, enforced by code-slots.security.test.ts):
 *   - autocomplete="one-time-code", numeric keypad;
 *   - digits live only in this component's state and are cleared before onComplete runs;
 *   - nothing is logged or stored; the real <input> value is always "";
 *   - sealed boxes show dots;
 *   - the grid is repeat(N, minmax(0, 3rem)), so six boxes fit at 390px (fixes D22's clipped 6th box).
 */
import { m, useReducedMotion } from "motion/react";
import { useId, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from "react";
import { spring } from "../../lib/motion-tokens.ts";
import {
  OTP_DEFAULT_DIGITS,
  backspace,
  emptySlots,
  isComplete,
  pasteDigits,
  typeDigits,
  type SlotsState,
} from "./code-slots-logic.ts";
import styles from "./code-slots.module.css";

export interface CodeSlotsProps {
  label: string;
  /** Number of dots to show after submit; null while editable. */
  sealed: number | null;
  disabled?: boolean;
  onComplete(code: string): void;
}

export function CodeSlots({ label, sealed, disabled = false, onComplete }: CodeSlotsProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();
  const [state, setState] = useState<SlotsState>(() => ({ slots: emptySlots(OTP_DEFAULT_DIGITS), active: 0 }));
  const [focused, setFocused] = useState(false);
  const locked = disabled || sealed !== null;

  const commit = (next: SlotsState) => {
    if (isComplete(next.slots)) {
      const code = next.slots.join("");
      setState({ slots: emptySlots(next.slots.length), active: 0 });
      onComplete(code);
      return;
    }
    setState(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (locked || event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      commit(typeDigits(state, event.key));
    } else if (event.key === "Backspace") {
      event.preventDefault();
      setState(backspace(state));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setState({ ...state, active: Math.max(0, state.active - 1) });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setState({ ...state, active: Math.min(state.slots.length - 1, state.active + 1) });
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (locked) return;
    event.preventDefault();
    commit(pasteDigits(state, event.clipboardData.getData("text")));
  };

  // OS one-time-code autofill and mobile keyboards arrive as input events, not keydowns.
  const onChange = (value: string) => {
    if (locked || !value) return;
    commit(value.length > 1 ? pasteDigits(state, value) : typeDigits(state, value));
  };

  const shown = sealed !== null ? Array.from({ length: sealed }, () => "•") : state.slots;

  return (
    <div
      className={styles.root}
      data-sealed={sealed !== null || undefined}
      onMouseDown={(event) => {
        if (locked) return;
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <input
        ref={inputRef}
        id={id}
        className={styles.input}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        value=""
        aria-label={label}
        aria-describedby={`${id}-count`}
        disabled={locked}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div className={styles.row} style={{ "--n": shown.length } as CSSProperties} aria-hidden="true">
        {shown.map((char, i) => (
          <span
            key={i}
            className={styles.slot}
            data-active={(focused && !locked && i === state.active) || undefined}
            data-filled={char !== "" || undefined}
          >
            {char ? (
              <m.span
                key={`${i}-${char}`}
                className={styles.digit}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={reduce ? { type: false } : spring}
              >
                {char}
              </m.span>
            ) : null}
          </span>
        ))}
      </div>
      <span id={`${id}-count`} className="sr-only" aria-live="polite">
        {sealed !== null ? "Code sent" : `${state.slots.filter(Boolean).length} of ${state.slots.length} digits entered`}
      </span>
    </div>
  );
}
```

`apps/web/components/bits/code-slots.module.css`:
```css
.root { position: relative; display: block; max-inline-size: 100%; cursor: text; }
.input {
  position: absolute; inset: 0; z-index: 1; inline-size: 100%; block-size: 100%;
  margin: 0; padding: 0; border: 0; opacity: 0; font-size: 1rem; caret-color: transparent;
}
.row { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 3rem)); gap: .375rem; }
.slot {
  display: grid; place-items: center; min-inline-size: 0; aspect-ratio: 48 / 56; border-radius: .625rem;
  background: var(--color-fill-2); color: var(--color-label); font: 600 1.125rem/1 var(--font-mono);
}
.slot[data-active] { box-shadow: 0 0 0 .1875rem var(--color-tint-wash), inset 0 0 0 .09375rem var(--color-tint); }
.root[data-sealed] { cursor: default; }
.root[data-sealed] .slot { background: var(--color-ok-wash); color: var(--color-ok); }
.digit { display: inline-block; }
.root:has(.input:focus-visible) .row { outline: .125rem solid var(--color-tint); outline-offset: .25rem; border-radius: .75rem; }
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/components/bits && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS.
- If TypeScript rejects `{ type: false }`, the pinned `motion` has dropped instant transitions. Replace it with `{ ...spring, stiffness: spring.stiffness * 100 }`. Do not add a `duration` literal.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/components/bits
git commit -m "feat(web): CodeSlots OTP input adapted from React Bits with enforced security review"
```

---

## Task 11: New task page (composer, sources, 01/02/03 options, ⌘↵, `hero:*` events, CSS poster)

**Files:**
- Create:
  - `apps/web/components/hero/hero-events.ts`, `apps/web/components/hero/hero-poster.tsx`, `apps/web/components/hero/hero.module.css`
  - `apps/web/components/new-task/draft.ts` (+ `draft.test.ts`), `new-task-form.tsx`, `source-field.tsx`, `options-grid.tsx`, `new-task.module.css`
  - `apps/web/app/(app)/new/page.tsx`
  - `apps/web/e2e/new-task.spec.ts`

**Interfaces:**
- Consumes: `api()`, `toast`, `Toolbar`, `Button`, `Icon`, `CountUp`, `CreateRunInput`, `toOrigin`, `DEFAULT_BUDGET` and `FolderView`.
- Produces:
  - **`hero-events.ts`:** `HERO_EVENTS` (`hero:type`, `hero:focus`, `hero:start`, `hero:captured`), `emitHero(name, detail?)`, `isHeroLive()`, `waitForHeroCapture(maxMs?)` and `HERO_CAPTURE_WAIT_MS = 2600`. Events go to `window`.
  - **`hero-poster.tsx`:** `PosterArt` (inner composition) and `HeroPoster` (`[data-hero]` wrapper plus poster). F5 swaps `HeroPoster` for `Hero3D`.
  - **`draft.ts`:** `SourceChip`, `parseSource(input)`, `originVariants(origin)`, `BUDGET_PRESETS`, `BudgetPreset`, `TaskDraft`, `buildCreateRunInput(draft)`, `FolderOption` and `flattenFolders(folders)`.
  - **Route:** `/new`.

- [ ] **Step 1: Write the failing unit test.**

`apps/web/components/new-task/draft.test.ts`:
```ts
import { DEFAULT_BUDGET } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { FOLDERS } from "../../e2e/support/run-mocks.ts";
import { buildCreateRunInput, flattenFolders, originVariants, parseSource, type TaskDraft } from "./draft.ts";

const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  goal: "Every lecture and figure",
  sources: [],
  domains: [],
  budget: "standard",
  standardBudget: DEFAULT_BUDGET,
  approvalMode: "ask",
  targetFolderId: null,
  ...over,
});

describe("parseSource", () => {
  it("detects web, YouTube and PDF sources", () => {
    expect(parseSource("learn.example.edu/course/week-2")).toMatchObject({
      kind: "web",
      host: "learn.example.edu",
      label: "learn.example.edu/course/week-2",
      origin: "https://learn.example.edu",
    });
    expect(parseSource("https://www.youtube.com/watch?v=k3Wm9xTq2aE")?.kind).toBe("youtube");
    expect(parseSource("https://youtu.be/k3Wm9xTq2aE")?.kind).toBe("youtube");
    expect(parseSource("https://arxiv.org/pdf/1706.03762.PDF")?.kind).toBe("pdf");
  });

  it("rejects non-http schemes, credentials and junk", () => {
    expect(parseSource("javascript:alert(1)")).toBeNull();
    expect(parseSource("https://user:pw@example.com")).toBeNull();
    expect(parseSource("   ")).toBeNull();
    expect(parseSource("file:///etc/passwd")).toBeNull();
  });
});

describe("originVariants", () => {
  it("adds the www/apex twin, keeps ports, skips IPs and localhost", () => {
    expect(originVariants("https://youtube.com")).toEqual(["https://youtube.com", "https://www.youtube.com"]);
    expect(originVariants("https://www.example.com:8443")).toEqual([
      "https://www.example.com:8443",
      "https://example.com:8443",
    ]);
    expect(originVariants("http://localhost:3000")).toEqual(["http://localhost:3000"]);
    expect(originVariants("http://192.168.1.4")).toEqual(["http://192.168.1.4"]);
  });
});

describe("buildCreateRunInput", () => {
  it("lists sources in the goal and allows their origins plus extra domains", () => {
    const yt = parseSource("https://www.youtube.com/watch?v=k3Wm9xTq2aE")!;
    const input = buildCreateRunInput(draft({ sources: [yt], domains: ["https://github.com"] }));
    expect(input).toMatchObject({
      goal: `Every lecture and figure\n\nSources:\n- ${yt.url}`,
      allowedOrigins: ["https://www.youtube.com", "https://youtube.com", "https://github.com", "https://www.github.com"],
      budget: DEFAULT_BUDGET,
      approvalMode: "ask",
      targetFolderId: null,
    });
  });

  it("uses presets, auto mode and a target folder", () => {
    const input = buildCreateRunInput(
      draft({ domains: ["https://a.example"], budget: "deep", approvalMode: "auto_within_allowlist", targetFolderId: FOLDERS[1].id }),
    );
    expect(input).toMatchObject({
      budget: { maxSteps: 300, maxUsd: 10, maxActiveMinutes: 120 },
      approvalMode: "auto_within_allowlist",
      targetFolderId: FOLDERS[1].id,
    });
  });

  it("explains what is missing", () => {
    expect(buildCreateRunInput(draft({ goal: "  " }))).toEqual({ error: "Describe the task or add a source." });
    expect(buildCreateRunInput(draft())).toEqual({ error: "Add a source or an allowed domain." });
    expect(buildCreateRunInput(draft({ goal: "x".repeat(4_100), domains: ["https://a.example"] }))).toEqual({
      error: "That's too long. Keep the task under 4,000 characters.",
    });
  });
});

describe("flattenFolders", () => {
  it("orders depth-first with depth", () => {
    expect(flattenFolders([...FOLDERS])).toEqual([
      { id: FOLDERS[0].id, name: "Courses", depth: 0 },
      { id: FOLDERS[1].id, name: "Machine learning", depth: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Write the failing e2e spec.**

`apps/web/e2e/new-task.spec.ts`:
```ts
import { CREATED_RUN_ID } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { FOLDERS, RpcFailure, mockRpc, newTaskHandlers } from "./support/run-mocks.ts";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const log: [string, unknown][] = [];
    (window as unknown as { __heroLog: typeof log }).__heroLog = log;
    for (const name of ["hero:type", "hero:focus", "hero:start"]) {
      window.addEventListener(name, (e) => log.push([name, (e as CustomEvent).detail ?? null]));
    }
  });
});

test("composes a task with sources, options and ⌘↵", async ({ page }) => {
  const calls = await mockRpc(page, newTaskHandlers());
  await page.goto("/new");
  const goal = page.getByLabel("Describe the task");
  await goal.fill("Week 3: every lecture, figure and table. Skip the quizzes.");

  await page.getByRole("button", { name: "YouTube" }).click();
  await page.getByLabel("YouTube video address").fill("youtube.com/watch?v=k3Wm9xTq2aE");
  await page.getByLabel("YouTube video address").press("Enter");
  await page.getByRole("button", { name: "PDF" }).click();
  await page.getByLabel("PDF address").fill("https://arxiv.org/pdf/1706.03762.pdf");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Sources" }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove arxiv.org" }).click();
  await expect(page.getByRole("list", { name: "Sources" }).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: "Add domain" }).click();
  await page.getByLabel("Allowed domain").fill("github.com");
  await page.getByLabel("Allowed domain").press("Enter");
  await page.getByRole("radio", { name: "Deep" }).check();
  await expect(page.getByTestId("budget-steps")).toContainText("300");
  await page.getByRole("radio", { name: "Auto in allowed domains" }).check();
  await page.getByLabel("Save to").selectOption(FOLDERS[1].id);

  await goal.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(new RegExp(`/runs/${CREATED_RUN_ID}$`));
  const create = calls.find((c) => c.path === "runs/create");
  expect(create?.input).toMatchObject({
    goal: "Week 3: every lecture, figure and table. Skip the quizzes.\n\nSources:\n- https://youtube.com/watch?v=k3Wm9xTq2aE",
    allowedOrigins: ["https://youtube.com", "https://www.youtube.com", "https://github.com", "https://www.github.com"],
    budget: { maxSteps: 300, maxUsd: 10, maxActiveMinutes: 120 },
    approvalMode: "auto_within_allowlist",
    targetFolderId: FOLDERS[1].id,
  });
});

test("emits hero:type, hero:focus and hero:start without loading any 3D code", async ({ page }) => {
  await mockRpc(page, newTaskHandlers());
  await page.goto("/new");
  const goal = page.getByLabel("Describe the task");
  await goal.click();
  await goal.pressSequentially("abc");
  await page.getByRole("button", { name: /^Start/ }).focus();
  const log = await page.evaluate(() => (window as unknown as { __heroLog: [string, unknown][] }).__heroLog);
  expect(log.filter(([n]) => n === "hero:type")).toHaveLength(3);
  expect(log).toContainEqual(["hero:focus", true]);
  expect(log).toContainEqual(["hero:focus", false]);
});

test("validates before calling the API", async ({ page }) => {
  const calls = await mockRpc(page, newTaskHandlers());
  await page.goto("/new");
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByRole("alert")).toHaveText("Describe the task or add a source.");
  await expect(page.getByLabel("Describe the task")).toBeFocused();
  expect(calls.filter((c) => c.path === "runs/create")).toHaveLength(0);
});

test("keeps the draft and explains when starting fails", async ({ page }) => {
  await mockRpc(
    page,
    newTaskHandlers({
      "runs/create": () => {
        throw new RpcFailure("INTERNAL_SERVER_ERROR", 500, "down");
      },
    }),
  );
  await page.goto("/new");
  await page.getByLabel("Describe the task").fill("Capture this page");
  await page.getByRole("button", { name: "Add domain" }).click();
  await page.getByLabel("Allowed domain").fill("example.com");
  await page.getByLabel("Allowed domain").press("Enter");
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByText("Couldn't start the task. Check your connection and try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Start/ })).toBeEnabled();
  await expect(page.getByLabel("Describe the task")).toHaveValue("Capture this page");
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/components/new-task && pnpm --filter @mastertutor/web e2e -- new-task.spec.ts`

Expected: both FAIL. The unit test fails on the missing module; the e2e spec fails on the 404 at `/new`.

- [ ] **Step 4: Implement the hero events and poster.**

`apps/web/components/hero/hero-events.ts`:
```ts
/** The composer talks to the 3D hero only through these window events; it never imports three (spec §11.2). */
export const HERO_EVENTS = {
  type: "hero:type",
  focus: "hero:focus",
  start: "hero:start",
  captured: "hero:captured",
} as const;
export type HeroEventName = keyof typeof HERO_EVENTS;

/** Upper bound we wait for the capture sequence (~2.4s) before navigating. */
export const HERO_CAPTURE_WAIT_MS = 2_600;

export function emitHero(name: "type" | "start"): void;
export function emitHero(name: "focus", focused: boolean): void;
export function emitHero(name: HeroEventName, detail?: boolean): void {
  window.dispatchEvent(new CustomEvent(HERO_EVENTS[name], { detail }));
}

export function isHeroLive(): boolean {
  return document.querySelector("[data-hero][data-live]") !== null;
}

export function waitForHeroCapture(maxMs: number = HERO_CAPTURE_WAIT_MS): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener(HERO_EVENTS.captured, done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, maxMs);
    window.addEventListener(HERO_EVENTS.captured, done);
  });
}
```

`apps/web/components/hero/hero-poster.tsx`:
```tsx
import styles from "./hero.module.css";

/** Static composition (page → lens → note). The loading, reduced-motion and no-WebGL state (run 16). */
export function PosterArt() {
  return (
    <div className={styles.poster}>
      <div className={styles.page}><i /><i /><i /><i /><i /><i /></div>
      <div className={styles.shadow} />
      <div className={styles.puck}><i className={styles.band} /><i className={styles.dot} /></div>
      <div className={styles.note}><i /><i /><i /><i /><i /><i /><i /></div>
    </div>
  );
}

export function HeroPoster() {
  return (
    <div className={styles.hero} data-hero="" aria-hidden="true">
      <PosterArt />
    </div>
  );
}
```

`apps/web/components/hero/hero.module.css`:
```css
.hero { position: relative; inline-size: 100%; max-inline-size: 34rem; aspect-ratio: 1; justify-self: end; contain: layout paint; touch-action: pan-y; }
.poster { position: absolute; inset: 0; }
.page, .note { position: absolute; overflow: hidden; border-radius: 3.2% / 2.6%; background: var(--color-elevated); box-shadow: var(--shadow-e3); }
.page { left: 8%; top: 12%; width: 39%; height: 49%; transform: perspective(60rem) rotateY(16deg) rotateZ(1.5deg); }
.page::before { content: ""; position: absolute; inset: 0 0 auto; height: 8%; background: var(--color-bg-2); }
.page i, .note i { position: absolute; left: 8%; height: 2.4%; border-radius: var(--radius-pill); background: var(--color-fill); }
.page i:nth-child(1) { top: 14%; width: 70%; height: 5%; border-radius: .25rem; background: var(--color-label); }
.page i:nth-child(2) { top: 25%; width: 84%; height: 30%; border-radius: .375rem; background: linear-gradient(160deg, var(--color-hero-aqua), var(--color-hero-aqua-deep)); }
.page i:nth-child(3) { top: 61%; width: 84%; }
.page i:nth-child(4) { top: 67%; width: 78%; background: var(--color-signal-wash); }
.page i:nth-child(5) { top: 73%; width: 82%; }
.page i:nth-child(6) { top: 79%; width: 60%; }
.shadow { position: absolute; left: 20%; right: 12%; top: 84%; height: 7%; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--color-hero-bondi) 18%, transparent), transparent); }
.puck {
  position: absolute; left: 28%; top: 33%; width: 46%; aspect-ratio: 1; border-radius: 50%; transform: scaleY(.74);
  background: radial-gradient(120% 90% at 50% 16%, color-mix(in srgb, var(--color-elevated) 92%, transparent),
    color-mix(in srgb, var(--color-hero-aqua) 60%, transparent) 42%, color-mix(in srgb, var(--color-hero-aqua-deep) 50%, transparent) 100%);
  backdrop-filter: blur(.4375rem) saturate(150%);
  box-shadow: inset 0 -.875rem 1.75rem color-mix(in srgb, var(--color-hero-bondi) 38%, transparent),
    inset 0 .5rem 1rem color-mix(in srgb, var(--color-elevated) 95%, transparent),
    inset 0 0 0 .0625rem color-mix(in srgb, var(--color-elevated) 70%, transparent),
    0 2.125rem 3.75rem -1.625rem color-mix(in srgb, var(--color-hero-bondi) 45%, transparent);
}
.puck::after { content: ""; position: absolute; left: 16%; top: 8%; width: 46%; height: 22%; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--color-elevated) 95%, transparent), transparent); }
.band { position: absolute; inset: 11%; border-radius: 50%; border: .7rem solid color-mix(in srgb, var(--color-hero-bondi) 42%, transparent); filter: blur(.1875rem); }
.dot { position: absolute; left: 50%; top: 50%; width: 12%; aspect-ratio: 1; border-radius: 50%; translate: -50% -50%; background: var(--color-signal); filter: blur(.0625rem); transition: opacity var(--dur-base) var(--ease-out); }
.note { left: 62%; top: 50%; width: 27%; height: 33%; transform: perspective(60rem) rotateY(-16deg) rotateZ(-2deg); }
.note i:nth-child(1) { top: 9%; width: 22%; height: 4%; background: var(--color-tint); }
.note i:nth-child(2) { top: 18%; width: 72%; height: 6%; border-radius: .25rem; background: var(--color-label); }
.note i:nth-child(3) { top: 29%; width: 48%; height: 6%; border-radius: .25rem; background: var(--color-label); }
.note i:nth-child(4) { top: 41%; width: 84%; height: 26%; border-radius: .375rem; background: linear-gradient(160deg, var(--color-hero-aqua), var(--color-hero-aqua-deep)); }
.note i:nth-child(5) { top: 73%; width: 84%; }
.note i:nth-child(6) { top: 80%; width: 80%; }
.note i:nth-child(7) { top: 87%; width: 52%; }
@media (max-width: 64rem) { .hero { max-inline-size: 22rem; justify-self: center; } }
@media (max-width: 51.25rem) { .hero { max-inline-size: 18rem; } }
```

- [ ] **Step 5: Implement the draft model.**

`apps/web/components/new-task/draft.ts`:
```ts
import {
  CreateRunInput,
  DEFAULT_BUDGET,
  toOrigin,
  type ApprovalMode,
  type Budget,
  type FolderView,
  type SourceKind,
} from "@mastertutor/contracts";

export interface SourceChip {
  url: string;
  kind: SourceKind;
  host: string;
  label: string;
  origin: string;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function parseSource(input: string): SourceChip | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const origin = toOrigin(url.toString());
  if (origin === null) return null;
  const host = url.hostname.replace(/^www\./, "");
  const kind: SourceKind = /(^|\.)youtube\.com$|^youtu\.be$/.test(host)
    ? "youtube"
    : /\.pdf$/i.test(url.pathname)
      ? "pdf"
      : "web";
  const path = url.pathname === "/" ? "" : url.pathname;
  return { url: url.toString(), kind, host, label: `${host}${path}${url.search}`, origin };
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Sites bounce between apex and www; allow both so the first redirect isn't a new-origin approval. */
export function originVariants(origin: string): string[] {
  const url = new URL(origin);
  const host = url.hostname;
  if (host === "localhost" || IPV4.test(host) || host.includes(":") || !host.includes(".")) return [origin];
  const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [origin, `${url.protocol}//${twin}${url.port ? `:${url.port}` : ""}`];
}

export const BUDGET_PRESETS = {
  quick: { maxSteps: 50, maxUsd: 1.5, maxActiveMinutes: 20 },
  standard: DEFAULT_BUDGET,
  deep: { maxSteps: 300, maxUsd: 10, maxActiveMinutes: 120 },
} as const satisfies Record<string, Budget>;
export type BudgetPreset = keyof typeof BUDGET_PRESETS;

export interface TaskDraft {
  goal: string;
  sources: SourceChip[];
  /** Normalized origins typed into 01 Allowed domains. */
  domains: string[];
  budget: BudgetPreset;
  /** settings.defaultBudget; used for the Standard preset. */
  standardBudget: Budget;
  approvalMode: ApprovalMode;
  targetFolderId: string | null;
}

const GOAL_MAX = 4_000;
const ORIGINS_MAX = 50;

export function buildCreateRunInput(draft: TaskDraft): CreateRunInput | { error: string } {
  const text = draft.goal.trim();
  if (!text && draft.sources.length === 0) return { error: "Describe the task or add a source." };
  const list = draft.sources.map((s) => `- ${s.url}`).join("\n");
  const goal = draft.sources.length
    ? `${text || "Take notes on these sources."}\n\nSources:\n${list}`
    : text;
  if (goal.length > GOAL_MAX) return { error: "That's too long. Keep the task under 4,000 characters." };
  const origins = [...new Set([...draft.sources.map((s) => s.origin), ...draft.domains].flatMap(originVariants))];
  if (origins.length === 0) return { error: "Add a source or an allowed domain." };
  if (origins.length > ORIGINS_MAX) return { error: "Too many allowed domains (50 at most)." };
  return CreateRunInput.parse({
    goal,
    allowedOrigins: origins,
    budget: draft.budget === "standard" ? draft.standardBudget : BUDGET_PRESETS[draft.budget],
    targetFolderId: draft.targetFolderId,
    approvalMode: draft.approvalMode,
  });
}

export interface FolderOption {
  id: string;
  name: string;
  depth: number;
}

const MAX_DEPTH = 8;

export function flattenFolders(folders: readonly FolderView[]): FolderOption[] {
  const byParent = new Map<string | null, FolderView[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  const out: FolderOption[] = [];
  const visit = (parent: string | null, depth: number) => {
    const children = (byParent.get(parent) ?? []).slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    for (const child of children) {
      out.push({ id: child.id, name: child.name, depth });
      if (depth < MAX_DEPTH) visit(child.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
```

- [ ] **Step 6: Implement the form.**

`apps/web/components/new-task/source-field.tsx`:
```tsx
"use client";

import type { SourceKind } from "@mastertutor/contracts";
import { useId, useState } from "react";
import { Button } from "../ui/button.tsx";
import { parseSource, type SourceChip } from "./draft.ts";
import styles from "./new-task.module.css";

const LABEL: Record<SourceKind, string> = { web: "Web page address", youtube: "YouTube video address", pdf: "PDF address" };
const PLACEHOLDER: Record<SourceKind, string> = {
  web: "https://example.com/article",
  youtube: "https://youtube.com/watch?v=…",
  pdf: "https://example.com/paper.pdf",
};

export function SourceField({ kind, onAdd, onCancel }: { kind: SourceKind; onAdd(source: SourceChip): void; onCancel(): void }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const add = () => {
    const source = parseSource(value);
    if (!source) {
      setInvalid(true);
      return;
    }
    onAdd(source);
  };
  return (
    <div className={styles.inlineField}>
      <label htmlFor={id} className="sr-only">
        {LABEL[kind]}
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        autoFocus
        value={value}
        placeholder={PLACEHOLDER[kind]}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            add();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <Button type="button" variant="secondary" onClick={add}>
        Add
      </Button>
      {invalid ? (
        <p id={`${id}-error`} className={styles.fieldError}>
          Enter a web address that starts with http or https.
        </p>
      ) : null}
    </div>
  );
}
```

`apps/web/components/new-task/options-grid.tsx`:
```tsx
"use client";

import { toOrigin, type ApprovalMode, type Budget, type FolderView } from "@mastertutor/contracts";
import { useId, useState } from "react";
import { CountUp } from "../bits/count-up.tsx";
import { Button } from "../ui/button.tsx";
import { Icon } from "../ui/icon.tsx";
import { BUDGET_PRESETS, flattenFolders, type BudgetPreset, type SourceChip } from "./draft.ts";
import styles from "./new-task.module.css";

const PRESETS: readonly { id: BudgetPreset; label: string }[] = [
  { id: "quick", label: "Quick" },
  { id: "standard", label: "Standard" },
  { id: "deep", label: "Deep" },
];

const MODES: readonly { id: ApprovalMode; label: string; detail: string }[] = [
  {
    id: "ask",
    label: "Ask me",
    detail: "Risky clicks, form submits, downloads, first sign-ins and new domains always ask you first.",
  },
  {
    id: "auto_within_allowlist",
    label: "Auto in allowed domains",
    detail:
      "Risky clicks, forms and first sign-ins in your allowed domains go ahead and are logged. Downloads and new domains stay blocked, and budget limits still ask.",
  },
];

export interface OptionsGridProps {
  sources: SourceChip[];
  domains: string[];
  onDomains(next: string[]): void;
  budget: BudgetPreset;
  onBudget(next: BudgetPreset): void;
  standardBudget: Budget;
  approvalMode: ApprovalMode;
  onApprovalMode(next: ApprovalMode): void;
  folders: FolderView[];
  folderId: string | null;
  onFolder(next: string | null): void;
}

export function OptionsGrid(p: OptionsGridProps) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState("");
  const [invalid, setInvalid] = useState(false);
  const budget = p.budget === "standard" ? p.standardBudget : BUDGET_PRESETS[p.budget];
  const sourceHosts = [...new Set(p.sources.map((s) => new URL(s.origin).host))];
  const addDomain = () => {
    const origin = toOrigin(domain.trim());
    if (!origin) {
      setInvalid(true);
      return;
    }
    if (!p.domains.includes(origin)) p.onDomains([...p.domains, origin]);
    setDomain("");
    setAdding(false);
  };
  const mode = MODES.find((m) => m.id === p.approvalMode) ?? MODES[0]!;

  return (
    <div className={styles.opts}>
      <section className={styles.opt} aria-labelledby={`${id}-domains`}>
        <span className={styles.eyebrow}>01</span>
        <h2 id={`${id}-domains`} className={styles.optTitle}>Allowed domains</h2>
        <p className={styles.optText}>The agent stays on these. Leaving them asks you first.</p>
        <ul className={styles.domainChips} aria-label="Allowed domains">
          {sourceHosts.map((host) => (
            <li key={`src-${host}`} className={styles.chip}>
              <Icon name="link" />
              <span className={styles.chipText}>{host}</span>
            </li>
          ))}
          {p.domains.map((origin) => {
            const host = new URL(origin).host;
            return (
              <li key={origin} className={styles.chip}>
                <Icon name="globe" />
                <span className={styles.chipText}>{host}</span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Remove ${host}`}
                  onClick={() => p.onDomains(p.domains.filter((d) => d !== origin))}
                >
                  <Icon name="x" />
                </button>
              </li>
            );
          })}
        </ul>
        {adding ? (
          <div className={styles.inlineField}>
            <label htmlFor={`${id}-domain`} className="sr-only">
              Allowed domain
            </label>
            <input
              id={`${id}-domain`}
              autoFocus
              inputMode="url"
              placeholder="example.com"
              value={domain}
              aria-invalid={invalid || undefined}
              onChange={(e) => {
                setDomain(e.target.value);
                setInvalid(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  addDomain();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAdding(false);
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={addDomain}>
              Add
            </Button>
            {invalid ? <p className={styles.fieldError}>Enter a domain like example.com.</p> : null}
          </div>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Add domain
          </Button>
        )}
      </section>

      <fieldset className={styles.opt}>
        <span className={styles.eyebrow}>02</span>
        <legend className={styles.optTitle}>Budget</legend>
        <p className={styles.optText}>Pauses and asks when it hits a limit.</p>
        <div className={styles.segmented}>
          {PRESETS.map((preset) => (
            <label key={preset.id} className={styles.segment}>
              <input
                type="radio"
                name={`${id}-budget`}
                value={preset.id}
                checked={p.budget === preset.id}
                onChange={() => p.onBudget(preset.id)}
              />
              <span>{preset.label}</span>
            </label>
          ))}
        </div>
        <dl className={styles.numerals}>
          <div>
            <dd className={styles.num} data-testid="budget-steps"><CountUp value={budget.maxSteps} /></dd>
            <dt>steps</dt>
          </div>
          <div>
            <dd className={styles.num}>
              <CountUp value={budget.maxUsd} decimals={Number.isInteger(budget.maxUsd) ? 0 : 2} prefix="$" />
            </dd>
            <dt>max spend</dt>
          </div>
          <div>
            <dd className={styles.num}><CountUp value={budget.maxActiveMinutes} /></dd>
            <dt>minutes</dt>
          </div>
        </dl>
      </fieldset>

      <fieldset className={styles.opt}>
        <span className={styles.eyebrow}>03</span>
        <legend className={styles.optTitle}>Approvals</legend>
        <div className={styles.segmented}>
          {MODES.map((m) => (
            <label key={m.id} className={styles.segment}>
              <input
                type="radio"
                name={`${id}-mode`}
                value={m.id}
                checked={p.approvalMode === m.id}
                onChange={() => p.onApprovalMode(m.id)}
              />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
        <p className={styles.optText}>{mode.detail}</p>
        <label className={styles.selectRow} htmlFor={`${id}-folder`}>
          <span>Save to</span>
          <select
            id={`${id}-folder`}
            value={p.folderId ?? ""}
            onChange={(e) => p.onFolder(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">Let the agent file it</option>
            {flattenFolders(p.folders).map((f) => (
              <option key={f.id} value={f.id}>
                {`${"\u2003".repeat(f.depth)}${f.name}`}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
    </div>
  );
}
```

`apps/web/components/new-task/new-task-form.tsx`:
```tsx
"use client";

import { DEFAULT_BUDGET, type ApprovalMode, type Budget, type FolderView, type SourceKind } from "@mastertutor/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../lib/api/client.ts";
import { toast } from "../bits/swipe-toast.tsx";
import { emitHero, isHeroLive, waitForHeroCapture } from "../hero/hero-events.ts";
import { HeroPoster } from "../hero/hero-poster.tsx";
import { Toolbar } from "../shell/toolbar.tsx";
import { Button } from "../ui/button.tsx";
import { Icon } from "../ui/icon.tsx";
import { buildCreateRunInput, type BudgetPreset, type SourceChip } from "./draft.ts";
import { OptionsGrid } from "./options-grid.tsx";
import { SourceField } from "./source-field.tsx";
import styles from "./new-task.module.css";

const SUGGESTIONS = [
  "Capture this PDF verbatim, figures included",
  "Chapter notes for a YouTube lecture",
  "Every code listing from a docs page",
] as const;

const KIND_ICON = { web: "link", youtube: "video", pdf: "pdf" } as const;

export function NewTaskForm() {
  const router = useRouter();
  const goalId = useId();
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const [goal, setGoal] = useState("");
  const [sources, setSources] = useState<SourceChip[]>([]);
  const [adding, setAdding] = useState<SourceKind | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [budget, setBudget] = useState<BudgetPreset>("standard");
  const [standardBudget, setStandardBudget] = useState<Budget>(DEFAULT_BUDGET);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("ask");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Defaults only: if these fail, the built-in defaults stay and the task can still start.
    api().settings.get({}).then(
      (settings) => {
        if (cancelled) return;
        setStandardBudget(settings.defaultBudget);
        setDomains((current) => (current.length ? current : settings.defaultAllowedOrigins));
      },
      () => undefined,
    );
    api().folders.tree({}).then(
      (tree) => {
        if (!cancelled) setFolders(tree.folders);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function start() {
    if (busy) return;
    const input = buildCreateRunInput({ goal, sources, domains, budget, standardBudget, approvalMode, targetFolderId: folderId });
    if ("error" in input) {
      setError(input.error);
      goalRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    emitHero("start");
    const heroDone = isHeroLive() ? waitForHeroCapture() : Promise.resolve();
    try {
      const [run] = await Promise.all([api().runs.create(input), heroDone]);
      router.push(`/runs/${run.id}`);
    } catch {
      setBusy(false);
      toast({ message: "Couldn't start the task. Check your connection and try again." });
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void start();
    }
  };

  return (
    <>
      <Toolbar title="New task" />
      <form
        className={styles.page}
        aria-busy={busy || undefined}
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <section className={styles.intro} aria-labelledby={`${goalId}-title`}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>New task</p>
            <h1 id={`${goalId}-title`} className={styles.title}>
              Take notes on<span className={styles.ellipsis}>…</span>
            </h1>
            <p className={styles.lede}>
              I'll open my own browser, capture the source faithfully, and ask before anything consequential.
            </p>
            <div className={styles.composer}>
              <label className="sr-only" htmlFor={goalId}>
                Describe the task
              </label>
              <textarea
                id={goalId}
                ref={goalRef}
                className={styles.goal}
                value={goal}
                maxLength={4_000}
                placeholder="Week 3 of the ML course: every lecture, figure and table. Skip the quizzes."
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${goalId}-error` : undefined}
                onChange={(e) => setGoal(e.target.value)}
                onInput={() => emitHero("type")}
                onFocus={() => emitHero("focus", true)}
                onBlur={() => emitHero("focus", false)}
              />
              {sources.length ? (
                <ul className={styles.chips} aria-label="Sources">
                  {sources.map((source) => (
                    <li key={source.url} className={styles.chip}>
                      <Icon name={KIND_ICON[source.kind]} />
                      <span className={styles.chipText}>{source.label}</span>
                      <button
                        type="button"
                        className={styles.chipRemove}
                        aria-label={`Remove ${source.host}`}
                        onClick={() => setSources(sources.filter((s) => s.url !== source.url))}
                      >
                        <Icon name="x" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {adding ? (
                <SourceField
                  key={adding}
                  kind={adding}
                  onCancel={() => setAdding(null)}
                  onAdd={(source) => {
                    setSources((current) => (current.some((s) => s.url === source.url) ? current : [...current, source]));
                    setAdding(null);
                  }}
                />
              ) : null}
              <div className={styles.foot}>
                <Button type="button" variant="ghost" onClick={() => setAdding("web")}>
                  <Icon name="link" />
                  URL
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAdding("youtube")}>
                  <Icon name="video" />
                  YouTube
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAdding("pdf")}>
                  <Icon name="pdf" />
                  PDF
                </Button>
                <span className={styles.spacer} />
                <Button type="submit" size="lg" disabled={busy} aria-keyshortcuts="Meta+Enter Control+Enter">
                  {busy ? "Starting…" : "Start"}
                  <kbd className={styles.kbd} aria-hidden="true">⌘↵</kbd>
                </Button>
              </div>
            </div>
            {error ? (
              <p id={`${goalId}-error`} role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
            <div className={styles.suggest}>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setGoal(suggestion);
                    emitHero("type");
                    goalRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.heroColumn}>
            <HeroPoster />
          </div>
        </section>
        <OptionsGrid
          sources={sources}
          domains={domains}
          onDomains={setDomains}
          budget={budget}
          onBudget={setBudget}
          standardBudget={standardBudget}
          approvalMode={approvalMode}
          onApprovalMode={setApprovalMode}
          folders={folders}
          folderId={folderId}
          onFolder={setFolderId}
        />
      </form>
    </>
  );
}
```

`apps/web/components/new-task/new-task.module.css`:
```css
.page { max-inline-size: 76rem; margin-inline: auto; padding: 0 2rem 4rem; }
.intro { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 2.5rem; align-items: center; padding-block: 3.5rem 2rem; }
.copy, .heroColumn { min-inline-size: 0; }
.heroColumn { display: grid; }
.eyebrow { margin: 0; font: 600 .6875rem/1.2 var(--font-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--color-label-2); }
.title { margin: .75rem 0 0; font: 700 clamp(2.75rem, 5.4vw, 4.5rem)/1 var(--font-sans); letter-spacing: -.04em; color: var(--color-label); }
.ellipsis { color: var(--color-signal); }
.lede { margin: 1rem 0 0; max-inline-size: 32rem; font-size: 1.1875rem; line-height: 1.45; color: var(--color-label-2); }
.composer { margin-block-start: 2rem; padding: 1.1rem 1.1rem .9rem; border-radius: var(--radius-xl); background: var(--color-elevated); box-shadow: var(--shadow-e2); transition: box-shadow var(--dur-base) var(--ease-out); }
.composer:focus-within { box-shadow: 0 0 0 .25rem var(--color-tint-wash), 0 0 0 .0625rem var(--color-tint), var(--shadow-e2); }
.goal { inline-size: 100%; min-block-size: 5.5rem; border: 0; outline: 0; resize: none; background: none; color: var(--color-label); font: 400 1.1875rem/1.5 var(--font-sans); }
.goal::placeholder { color: var(--color-label-3); }
.chips, .domainChips { display: flex; flex-wrap: wrap; gap: .4rem; margin: .25rem 0 .75rem; padding: 0; list-style: none; }
.chip { display: inline-flex; align-items: center; gap: .35rem; max-inline-size: 100%; min-block-size: 2rem; padding: 0 .35rem 0 .55rem; border-radius: var(--radius-pill); background: var(--color-bg-2); font-size: .75rem; font-weight: 500; color: var(--color-label); }
.chipText { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chipRemove { position: relative; display: grid; place-items: center; flex: none; inline-size: 1.5rem; block-size: 1.5rem; border: 0; border-radius: 50%; background: none; color: var(--color-label-2); }
.chipRemove::after { content: ""; position: absolute; inset: -.625rem; }
.chipRemove:hover { background: var(--color-fill); }
.inlineField { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-block-end: .75rem; }
.inlineField input { flex: 1 1 14rem; min-inline-size: 0; min-block-size: var(--hit); padding: 0 .75rem; border: 0; border-radius: var(--radius-sm); background: var(--color-fill-2); color: var(--color-label); font: inherit; }
.inlineField input:focus-visible { outline: .125rem solid var(--color-tint); outline-offset: .125rem; }
.fieldError, .error { flex-basis: 100%; margin: .25rem 0 0; font-size: .8125rem; color: var(--color-danger); }
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; padding-block-start: .75rem; border-block-start: .0625rem solid var(--color-separator); }
.spacer { flex: 1; }
.kbd { margin-inline-start: .35rem; padding: .15rem .32rem; border-radius: .3125rem; background: color-mix(in srgb, var(--color-on-tint) 20%, transparent); font: 500 .6875rem/1 var(--font-mono); }
.suggest { display: flex; flex-wrap: wrap; gap: .5rem; margin-block-start: 1rem; }
.suggest button { min-block-size: 2.25rem; padding: 0 .9rem; border: 0; border-radius: var(--radius-pill); box-shadow: inset 0 0 0 .0625rem var(--color-hairline); background: none; color: var(--color-label-2); font: 400 .8125rem/1.2 var(--font-sans); transition: transform var(--dur-micro) var(--ease-out); }
.suggest button:hover { color: var(--color-label); background: var(--color-fill-2); }
.suggest button:active { transform: scale(.96); }
.opts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2rem; margin-block-start: 1.5rem; padding-block: 2rem; border-block-start: .0625rem solid var(--color-separator); }
.opt { min-inline-size: 0; margin: 0; padding: 0; border: 0; }
.optTitle { margin: .5rem 0 .3rem; padding: 0; font: 600 1.0625rem/1.3 var(--font-sans); letter-spacing: -.015em; color: var(--color-label); }
.optText { margin: 0 0 .75rem; font-size: .8125rem; line-height: 1.45; color: var(--color-label-2); }
.segmented { display: inline-flex; max-inline-size: 100%; padding: .125rem; border-radius: var(--radius-sm); background: var(--color-fill-2); }
.segment { position: relative; }
.segment input { position: absolute; inset: 0; opacity: 0; margin: 0; }
.segment span { display: grid; place-items: center; min-block-size: 2rem; padding: 0 .75rem; border-radius: calc(var(--radius-sm) - .125rem); font: 500 .8125rem/1.2 var(--font-sans); color: var(--color-label); white-space: nowrap; transition: transform var(--dur-micro) var(--ease-out); }
.segment input:checked + span { background: var(--color-elevated); box-shadow: var(--shadow-e1); }
.segment input:focus-visible + span { outline: .125rem solid var(--color-tint); }
.segment input:active + span { transform: scale(.96); }
.numerals { display: flex; gap: 1.5rem; margin: 1.25rem 0 0; }
.numerals div { display: flex; flex-direction: column-reverse; }
.numerals dt { font-size: .75rem; color: var(--color-label-2); }
.num { margin: 0; font: 600 2rem/1 var(--font-sans); letter-spacing: -.04em; color: var(--color-label); }
.selectRow { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin-block-start: 1rem; font-size: .8125rem; color: var(--color-label-2); }
.selectRow select { flex: 1 1 10rem; min-inline-size: 0; min-block-size: var(--hit); padding: 0 .5rem; border: 0; border-radius: var(--radius-sm); background: var(--color-fill-2); color: var(--color-label); font: inherit; }
@media (max-width: 64rem) {
  .intro { grid-template-columns: minmax(0, 1fr); padding-block-start: 1.5rem; gap: 0; }
  .heroColumn { order: -1; }
  .opts { grid-template-columns: minmax(0, 1fr); gap: 1.25rem; }
}
@media (max-width: 51.25rem) { .page { padding: 0 1rem 3rem; } }
@media (max-width: 26.25rem) { .segment span { padding: 0 .5rem; } .numerals { gap: 1rem; } }
```

`apps/web/app/(app)/new/page.tsx`:
```tsx
import type { Metadata } from "next";
import { NewTaskForm } from "../../../components/new-task/new-task-form.tsx";

export const metadata: Metadata = { title: "New task · MasterTutor" };

export default function NewTaskPage() {
  return <NewTaskForm />;
}
```

- [ ] **Step 7: Run the tests and checks to verify they pass.**

Run:
```bash
pnpm test -- apps/web/components/new-task && pnpm --filter @mastertutor/web e2e -- new-task.spec.ts
pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css
```

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/web/components/hero apps/web/components/new-task "apps/web/app/(app)/new" apps/web/e2e/new-task.spec.ts
git commit -m "feat(web): New task composer with sources, 01/02/03 options, ⌘↵, hero events and CSS poster"
```

---

## Task 12: Mock-browser parts (pills, live frame, caption, banners, Full screen, callout)

**Files:**
- Create:
  - `apps/web/components/run/use-element-size.ts`
  - `apps/web/components/run/model/callout.ts` (+ `callout.test.ts`)
  - `apps/web/components/run/browser/fullscreen.ts` (+ `fullscreen.test.ts`)
  - `apps/web/components/run/browser/{origin-pill,live-frame,caption,banners,fullscreen-button,step-callout}.tsx`
  - `apps/web/components/run/browser/browser-frame.module.css`

**Interfaces:**
- Consumes: the copy helpers, `stepScreenshotPath`, `api().runs.openLive`, `reconnectDelayMs`, `toast`, `Icon`, `Button`, and the motion tokens.
- Produces:
  - `useElementSize(ref): { width; height } | null`;
  - **`callout.ts`:** `Box`, `Placement`, `CALLOUT_GAP = 40` and `calloutPlacement(target, box, label)`;
  - **`fullscreen.ts`:** `KeyboardLock`, `enterFullscreen(el, keyboard): Promise<boolean>`, `exitFullscreen(doc, keyboard)` and `keyboardOf(nav)`;
  - **Components:**
    - `OriginPill({ url, secure })` and `StatePill({ label, tone, pulse })`;
    - `LiveFrame({ runId, slotName, title, interactive, onRetrying })`;
    - `Caption({ text, step, tone })`;
    - `Banners({ state, model, replayLabel, onHandBackOpen, onResume, onJumpLive })`;
    - `HandBackPopover({ open, onClose, onHandBack })`;
    - `FullscreenButton({ target })`;
    - `StepCallout({ text, number, target, box })`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/components/run/model/callout.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CALLOUT_GAP, calloutPlacement } from "./callout.ts";

const box = { width: 800, height: 500 };
const label = { width: 240, height: 48 };

describe("calloutPlacement", () => {
  it("sits above-right of the target with a leader ending on it", () => {
    const p = calloutPlacement({ x: 300, y: 300 }, box, label);
    expect(p.left).toBe(316);
    expect(p.top).toBe(300 - CALLOUT_GAP - 48);
    expect(p.line.x2).toBe(300);
    expect(p.line.y2).toBe(300);
    expect(p.line.y1).toBe(p.top + 48);
  });

  it("flips below near the top and left near the right edge", () => {
    const p = calloutPlacement({ x: 780, y: 20 }, box, label);
    expect(p.top).toBe(20 + CALLOUT_GAP);
    expect(p.left + label.width).toBeLessThanOrEqual(box.width - 8);
    expect(p.line.y1).toBe(p.top);
  });

  it("never leaves the frame", () => {
    for (const target of [{ x: 0, y: 0 }, { x: 800, y: 500 }, { x: 10, y: 490 }]) {
      const p = calloutPlacement(target, box, label);
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.left + label.width).toBeLessThanOrEqual(box.width - 8);
      expect(p.top + label.height).toBeLessThanOrEqual(box.height - 8);
    }
  });
});
```

`apps/web/components/run/browser/fullscreen.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { enterFullscreen, exitFullscreen } from "./fullscreen.ts";

describe("full screen with keyboard lock", () => {
  it("requests full screen, then locks the keyboard so ⌘T/⌘W/⌘N reach the page", async () => {
    const order: string[] = [];
    const el = { requestFullscreen: vi.fn(async () => void order.push("fullscreen")) };
    const keyboard = { lock: vi.fn(async () => void order.push("lock")), unlock: vi.fn() };
    await expect(enterFullscreen(el, keyboard)).resolves.toBe(true);
    expect(order).toEqual(["fullscreen", "lock"]);
  });

  it("still succeeds where keyboard.lock is missing or refused", async () => {
    const el = { requestFullscreen: vi.fn(async () => undefined) };
    await expect(enterFullscreen(el, undefined)).resolves.toBe(true);
    await expect(enterFullscreen(el, { lock: async () => Promise.reject(new Error("no")) })).resolves.toBe(true);
  });

  it("reports failure when full screen is refused", async () => {
    const el = { requestFullscreen: vi.fn(async () => Promise.reject(new Error("denied"))) };
    await expect(enterFullscreen(el, undefined)).resolves.toBe(false);
  });

  it("unlocks and exits", () => {
    const keyboard = { unlock: vi.fn() };
    const doc = { fullscreenElement: {} as Element, exitFullscreen: vi.fn(async () => undefined) };
    exitFullscreen(doc, keyboard);
    expect(keyboard.unlock).toHaveBeenCalled();
    expect(doc.exitFullscreen).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/components/run/model/callout.test.ts apps/web/components/run/browser`

Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement the pure helpers and the hook.**

`apps/web/components/run/model/callout.ts`:
```ts
import type { Point } from "../cursor/cursor-path.ts";

export interface Box {
  width: number;
  height: number;
}
export interface Placement {
  left: number;
  top: number;
  line: { x1: number; y1: number; x2: number; y2: number };
}

/** Leader length between label and target (cutaway style, mockup D). */
export const CALLOUT_GAP = 40;
const EDGE = 8;
const NUDGE = 16;

/** Keeps the label and its leader inside the frame, so the leader never crosses the timeline (D22). */
export function calloutPlacement(target: Point, box: Box, label: Box): Placement {
  let left = target.x + NUDGE;
  if (left + label.width > box.width - EDGE) left = target.x - NUDGE - label.width;
  left = Math.min(Math.max(left, EDGE), Math.max(EDGE, box.width - EDGE - label.width));
  let top = target.y - CALLOUT_GAP - label.height;
  const below = top < EDGE;
  if (below) top = target.y + CALLOUT_GAP;
  top = Math.min(Math.max(top, EDGE), Math.max(EDGE, box.height - EDGE - label.height));
  const anchorX = Math.min(Math.max(target.x, left), left + label.width);
  return { left, top, line: { x1: anchorX, y1: below ? top : top + label.height, x2: target.x, y2: target.y } };
}
```

`apps/web/components/run/browser/fullscreen.ts`:
```ts
/** Chromium's Keyboard Lock API; absent elsewhere (spec §10.3 Keyboard). */
export interface KeyboardLock {
  lock?: (keyCodes?: string[]) => Promise<void>;
  unlock?: () => void;
}
export interface FullscreenTarget {
  requestFullscreen(options?: FullscreenOptions): Promise<void>;
}
export interface FullscreenDocument {
  fullscreenElement: Element | null;
  exitFullscreen(): Promise<void>;
}

export async function enterFullscreen(el: FullscreenTarget, keyboard: KeyboardLock | undefined): Promise<boolean> {
  try {
    await el.requestFullscreen({ navigationUI: "hide" });
  } catch {
    return false;
  }
  try {
    await keyboard?.lock?.();
  } catch {
    // Best effort: without the lock, the host browser keeps ⌘T/⌘W/⌘N.
  }
  return true;
}

export function exitFullscreen(doc: FullscreenDocument, keyboard: KeyboardLock | undefined): void {
  keyboard?.unlock?.();
  if (doc.fullscreenElement) void doc.exitFullscreen();
}

export function keyboardOf(nav: Navigator): KeyboardLock | undefined {
  return (nav as Navigator & { keyboard?: KeyboardLock }).keyboard;
}
```

`apps/web/components/run/use-element-size.ts`:
```ts
"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export interface Size {
  width: number;
  height: number;
}

export function useElementSize(ref: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
```

- [ ] **Step 4: Implement the components.**

`apps/web/components/run/browser/origin-pill.tsx`:
```tsx
import { useId } from "react";
import { Icon } from "../../ui/icon.tsx";
import { hostAndPath, type Tone } from "../model/copy.ts";
import styles from "./browser-frame.module.css";

export function OriginPill({ url, secure }: { url: string | null; secure: boolean }) {
  const tipId = useId();
  const parts = hostAndPath(url);
  if (!parts) {
    return (
      <div className={styles.origin}>
        <span className={styles.host}>New tab</span>
      </div>
    );
  }
  return (
    <div className={styles.origin} data-testid="origin-pill">
      <Icon name={parts.secure ? "lock" : "globe"} label={parts.secure ? "Secure connection" : "Not secure"} />
      <span className={styles.host}>{parts.host}</span>
      <span className={styles.path}>{parts.path}</span>
      {secure ? (
        <button type="button" className={styles.keyshield} aria-label="Filled securely" aria-describedby={tipId}>
          <Icon name="shield-key" />
          <span role="tooltip" id={tipId} className={styles.tip}>
            <b>Filled securely.</b> A vault alias filled this sign-in. The values never reached the agent, and
            screenshots were masked during the fill.
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function StatePill({ label, tone, pulse }: { label: string; tone: Tone; pulse: boolean }) {
  return (
    <span className={styles.pill} data-tone={tone} data-pulse={pulse || undefined}>
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
```

`apps/web/components/run/browser/live-frame.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api/client.ts";
import { reconnectDelayMs } from "../stream/run-events.ts";
import styles from "./browser-frame.module.css";

export interface LiveFrameProps {
  runId: string;
  slotName: string | null;
  title: string;
  interactive: boolean;
  onRetrying(retrying: boolean): void;
}

/**
 * n.eko's own client in an iframe (spec §10.2 #6). `openLive` sets the HttpOnly cookies for /live/<runId>/;
 * it is called again on every slot change (#3). The overlay layer above receives all pointer input
 * until the user is in control.
 */
export function LiveFrame({ runId, slotName, title, interactive, onRetrying }: LiveFrameProps) {
  const [embed, setEmbed] = useState<string | null>(null);
  const ref = useRef<HTMLIFrameElement>(null);
  const retrying = useRef(onRetrying);
  retrying.current = onRetrying;

  useEffect(() => {
    if (slotName === null) {
      setEmbed(null);
      retrying.current(false);
      return;
    }
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = async () => {
      try {
        const result = await api().runs.openLive({ runId });
        if (cancelled) return;
        retrying.current(false);
        setEmbed(result.sleeping ? null : result.embedPath);
      } catch {
        if (cancelled) return;
        retrying.current(true);
        timer = setTimeout(() => void open(), reconnectDelayMs(attempt++));
      }
    };
    void open();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, slotName]);

  useEffect(() => {
    if (interactive) ref.current?.focus();
  }, [interactive, embed]);

  if (!embed) return null;
  return (
    <iframe
      ref={ref}
      className={styles.live}
      src={embed}
      title={title}
      allow="autoplay; clipboard-read; clipboard-write; fullscreen"
      tabIndex={interactive ? 0 : -1}
    />
  );
}
```

`apps/web/components/run/browser/caption.tsx`:
```tsx
"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { durationMs, easing } from "../../../lib/motion-tokens.ts";
import type { BrowserState } from "../model/browser-state.ts";
import styles from "./browser-frame.module.css";

/** One line pinned to the frame; crossfades per step (run 13 §6 Caption). */
export function Caption({ text, step, tone }: { text: string; step: string | null; tone: BrowserState }) {
  const reduce = useReducedMotion();
  const shift = reduce ? 0 : 6;
  return (
    <div className={styles.caption} data-tone={tone}>
      <span className={styles.captionDot} aria-hidden="true" />
      <div className={styles.captionLines} aria-live="polite">
        <AnimatePresence initial={false}>
          <m.span
            key={text}
            className={styles.captionLine}
            initial={{ opacity: 0, y: shift }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -shift }}
            transition={{ duration: durationMs.base / 1000, ease: easing.out }}
          >
            {text}
          </m.span>
        </AnimatePresence>
      </div>
      {step ? <span className={styles.stepNo}>{step}</span> : null}
    </div>
  );
}
```

`apps/web/components/run/browser/banners.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Button } from "../../ui/button.tsx";
import { Icon } from "../../ui/icon.tsx";
import type { BrowserState } from "../model/browser-state.ts";
import { pausedCopy } from "../model/copy.ts";
import type { RunModel } from "../model/run-model.ts";
import styles from "./browser-frame.module.css";

export interface BannersProps {
  state: BrowserState;
  model: RunModel;
  replayLabel: string;
  onHandBackOpen(open: boolean): void;
  onResume(): void;
  onJumpLive(): void;
}

function Banner({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div className={styles.banner} data-show={show || undefined} inert={!show} aria-hidden={!show || undefined}>
      {children}
    </div>
  );
}

export function Banners({ state, model, replayLabel, onHandBackOpen, onResume, onJumpLive }: BannersProps) {
  const paused = pausedCopy(model);
  return (
    <>
      <Banner show={state === "control"}>
        <Icon name="hand" />
        <span className={styles.bannerText}>
          <b>You're in control</b> · Agent paused · screenshots off
        </span>
        <button type="button" className={styles.bannerButton} onClick={() => onHandBackOpen(true)}>
          Hand back
        </button>
      </Banner>
      <Banner show={state === "paused"}>
        <Icon name="moon" />
        <span className={styles.bannerText}>
          <b>{paused.title}</b> · {paused.detail}
        </span>
        {paused.canResume ? (
          <button type="button" className={styles.bannerButton} onClick={onResume}>
            <Icon name="play" />
            Resume
          </button>
        ) : null}
      </Banner>
      <Banner show={state === "replay"}>
        <Icon name="clock" />
        <span className={styles.bannerText}>
          <b>Replay</b> · {replayLabel}
        </span>
        <button type="button" className={styles.bannerButton} onClick={onJumpLive}>
          Jump to live
        </button>
      </Banner>
      {state === "reconnecting" ? (
        <div className={styles.reconnect} role="status">
          <span className={styles.spinner} aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ transform: `rotate(${i * 45}deg)` }} />
            ))}
          </span>
          Reconnecting to the browser…
        </div>
      ) : null}
    </>
  );
}

export function HandBackPopover({
  open,
  onClose,
  onHandBack,
}: {
  open: boolean;
  onClose(): void;
  onHandBack(note: string | null): void;
}) {
  const [note, setNote] = useState("");
  if (!open) return null;
  const submit = () => {
    onHandBack(note.trim() || null);
    setNote("");
  };
  return (
    <div className={styles.handback} role="dialog" aria-label="Hand back to the agent">
      <label className={styles.handbackLabel}>
        Note to the agent <span className={styles.muted}>(optional)</span>
        <textarea
          autoFocus
          value={note}
          maxLength={4_000}
          placeholder="I closed the pop-up. Carry on from the quiz page, and don't start it."
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
      <div className={styles.handbackActions}>
        <Button type="button" variant="secondary" onClick={onClose}>
          Keep control
        </Button>
        <Button type="button" onClick={submit}>
          Hand back
        </Button>
      </div>
    </div>
  );
}
```

`apps/web/components/run/browser/fullscreen-button.tsx`:
```tsx
"use client";

import { useEffect, useState, type RefObject } from "react";
import { toast } from "../../bits/swipe-toast.tsx";
import { Icon } from "../../ui/icon.tsx";
import { enterFullscreen, exitFullscreen, keyboardOf } from "./fullscreen.ts";
import styles from "./browser-frame.module.css";

export function FullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement !== null && document.fullscreenElement === target.current;
      setOn(active);
      if (!active) keyboardOf(navigator)?.unlock?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [target]);

  const toggle = async () => {
    const el = target.current;
    if (!el) return;
    if (on) {
      exitFullscreen(document, keyboardOf(navigator));
      return;
    }
    if (await enterFullscreen(el, keyboardOf(navigator))) toast({ message: "Hold Esc to leave full screen." });
    else toast({ message: "Full screen isn't available in this browser." });
  };

  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-pressed={on}
      aria-label={on ? "Exit full screen" : "Full screen"}
      onClick={() => void toggle()}
    >
      <Icon name={on ? "minimize" : "maximize"} />
    </button>
  );
}
```

`apps/web/components/run/browser/step-callout.tsx`:
```tsx
"use client";

import { useRef } from "react";
import type { Point } from "../cursor/cursor-path.ts";
import { calloutPlacement, type Box } from "../model/callout.ts";
import { useElementSize } from "../use-element-size.ts";
import styles from "./browser-frame.module.css";

const FALLBACK_LABEL = { width: 240, height: 48 };

/** Cutaway callout with a dotted leader to the step's element (>1180px), or a gutter badge (≤1180px). */
export function StepCallout({ text, number, target, box }: { text: string; number: number; target: Point; box: Box }) {
  const ref = useRef<HTMLDivElement>(null);
  const label = useElementSize(ref);
  const placed = calloutPlacement(target, box, label ?? FALLBACK_LABEL);
  return (
    <div className={styles.callouts} aria-hidden="true" data-testid="step-callout">
      <svg className={styles.leader} width={box.width} height={box.height}>
        <line x1={placed.line.x1} y1={placed.line.y1} x2={placed.line.x2} y2={placed.line.y2} />
        <circle cx={target.x} cy={target.y} r={3} />
      </svg>
      <div ref={ref} className={styles.callout} style={{ transform: `translate(${placed.left}px, ${placed.top}px)` }}>
        <b>Step {number}.</b> {text}
      </div>
      <span className={styles.gutterBadge} data-testid="gutter-badge" style={{ transform: `translateY(${target.y}px)` }}>
        {number}
      </span>
    </div>
  );
}
```

`apps/web/components/run/browser/browser-frame.module.css`:
```css
/* Mock browser (run 13 §6, mockup D). Only transform and opacity animate. */
.frame {
  position: relative; overflow: hidden; border-radius: var(--radius-frame); background: var(--color-bg-2);
  box-shadow: 0 0 0 .03125rem var(--color-hairline), var(--shadow-e2);
  transform-origin: 50% 40%; transition: transform var(--spring-duration) var(--spring);
}
.frame[data-state="control"] { transform: scale(1.01); }
.frame:fullscreen { border-radius: 0; transform: none; display: flex; flex-direction: column; }
.frame:fullscreen .viewport { flex: 1; aspect-ratio: auto; }

.chrome {
  display: grid; grid-template-columns: 4.5rem minmax(0, 1fr) auto; align-items: center; gap: .5rem;
  block-size: 2.75rem; padding-inline: .75rem; background: var(--color-glass); backdrop-filter: var(--backdrop-glass);
  border-block-end: .03125rem solid var(--color-hairline);
}
.dots { display: flex; gap: .375rem; }
.dots i { inline-size: .625rem; block-size: .625rem; border-radius: 50%; background: var(--color-fill); }
.chromeEnd { display: flex; align-items: center; gap: .25rem; justify-self: end; }
.origin {
  justify-self: center; display: flex; align-items: center; gap: .45rem; min-inline-size: 0; max-inline-size: 34rem;
  block-size: 1.875rem; padding: 0 .4rem 0 .75rem; border-radius: var(--radius-pill); background: var(--color-fill-2);
  font: 400 .8125rem/1 var(--font-sans); color: var(--color-label-2);
}
.host { font-weight: 600; color: var(--color-label); white-space: nowrap; }
.path { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-label-3); }
.keyshield {
  position: relative; display: inline-grid; place-items: center; flex: none; inline-size: 1.375rem; block-size: 1.375rem;
  border: 0; border-radius: 50%; background: var(--color-ok-wash); color: var(--color-ok);
}
.keyshield::after { content: ""; position: absolute; inset: -.6875rem; }
.tip {
  position: absolute; inset-block-start: calc(100% + .625rem); inset-inline-end: -.5rem; z-index: 30; inline-size: 15rem;
  padding: .6rem .7rem; border-radius: .625rem; background: var(--color-elevated); box-shadow: var(--shadow-e3);
  color: var(--color-label); font: 400 .75rem/1.4 var(--font-sans); text-align: start;
  opacity: 0; transform: translateY(-.25rem); pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.keyshield:hover .tip, .keyshield:focus-visible .tip { opacity: 1; transform: none; }
.pill {
  display: inline-flex; align-items: center; gap: .35rem; block-size: 1.375rem; padding: 0 .55rem; border-radius: var(--radius-pill);
  background: var(--color-elevated); box-shadow: var(--shadow-e1); font: 600 .6875rem/1 var(--font-sans); color: var(--color-label); white-space: nowrap;
}
.pill i { inline-size: .45rem; block-size: .45rem; border-radius: 50%; background: var(--color-signal); }
.pill[data-tone="tint"] i { background: var(--color-tint); }
.pill[data-tone="warn"] i { background: var(--color-warn); }
.pill[data-tone="muted"] i { background: var(--color-label-3); }
.pill[data-pulse] i { animation: breathe var(--dur-breathe) var(--ease-out) infinite; }
.iconButton {
  position: relative; display: grid; place-items: center; inline-size: 2rem; block-size: 2rem; border: 0; border-radius: var(--radius-sm);
  background: none; color: var(--color-label-2); transition: transform var(--dur-micro) var(--ease-out);
}
.iconButton::after { content: ""; position: absolute; inset: -.375rem; }
.iconButton:hover { background: var(--color-fill-2); color: var(--color-label); }
.iconButton:active { transform: scale(.92); }

.viewport { position: relative; aspect-ratio: 16 / 10; overflow: hidden; background: var(--color-bg-2); }
.live { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; border: 0; pointer-events: none; }
.frame[data-state="control"] .live { pointer-events: auto; }
.shot { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; object-fit: contain; opacity: 0; transition: opacity var(--dur-panel) var(--ease-out); }
.frame[data-state="paused"] .shot, .frame[data-state="reconnecting"] .shot, .frame[data-state="replay"] .shot { opacity: 1; }
.frame[data-state="paused"] .shot { filter: grayscale(1) contrast(.9); }
.frame[data-state="reconnecting"] .shot { filter: blur(.5rem); }

.agentRing, .userRing { position: absolute; inset: 0; z-index: 4; opacity: 0; pointer-events: none; transition: opacity var(--dur-panel) var(--ease-out); }
.agentRing { box-shadow: inset 0 0 0 .125rem var(--color-signal), inset 0 0 1.75rem color-mix(in srgb, var(--color-signal) 30%, transparent); }
.userRing { box-shadow: inset 0 0 0 .1875rem var(--color-tint); }
.frame[data-state="acting"] .agentRing { opacity: 1; animation: breathe var(--dur-breathe) var(--ease-out) infinite; }
.frame[data-state="control"] .userRing { opacity: 1; }

.dim { position: absolute; inset: 0; z-index: 4; inline-size: 100%; block-size: 100%; opacity: 0; pointer-events: none; transition: opacity var(--dur-panel) var(--ease-out); }
.dim rect[data-scrim] { fill: var(--color-scrim); }
.frame[data-state="approval"] .dim { opacity: 1; }

.takeover { position: absolute; inset: 0; z-index: 6; inline-size: 100%; block-size: 100%; border: 0; background: transparent; cursor: pointer; }
.takeover:focus-visible { outline: .125rem solid var(--color-tint); outline-offset: -.25rem; }
.takeoverHint {
  position: absolute; inset-block-end: .75rem; inset-inline-start: 50%; translate: -50% 0; padding: .375rem .75rem; border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-label) 86%, transparent); color: var(--color-bg); font: 500 .8125rem/1.2 var(--font-sans);
  white-space: nowrap; opacity: 0; transition: opacity var(--dur-base) var(--ease-out);
}
.takeover:hover .takeoverHint, .takeover:focus-visible .takeoverHint { opacity: 1; }

.banner {
  position: absolute; inset-block-start: .75rem; inset-inline-start: 50%; z-index: 9; display: flex; align-items: center; gap: .75rem;
  max-inline-size: calc(100% - 1rem); padding: .35rem .4rem .35rem .9rem; border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-label) 86%, transparent); color: var(--color-bg); backdrop-filter: var(--backdrop-glass);
  box-shadow: var(--shadow-e3); font: 400 .8125rem/1.3 var(--font-sans); white-space: nowrap;
  opacity: 0; transform: translate(-50%, -150%);
  transition: transform var(--spring-duration) var(--spring), opacity var(--dur-base) var(--ease-out);
}
.banner[data-show] { opacity: 1; transform: translate(-50%, 0); }
.bannerText { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
.bannerText b { font-weight: 600; }
.bannerButton {
  display: inline-flex; align-items: center; gap: .3rem; min-block-size: 2rem; padding: 0 .8rem; border: 0; border-radius: var(--radius-pill);
  background: var(--color-bg); color: var(--color-label); font: 500 .8125rem/1 var(--font-sans); transition: transform var(--dur-micro) var(--ease-out);
}
.bannerButton:active { transform: scale(.96); }
.handback {
  position: absolute; inset-block-start: 3.9rem; inset-inline-start: 50%; z-index: 10; inline-size: min(22rem, calc(100% - 2rem));
  padding: .85rem; border-radius: var(--radius-lg); background: var(--color-elevated); box-shadow: var(--shadow-e3); translate: -50% 0;
}
.handbackLabel { display: grid; gap: .4rem; font: 600 .75rem/1.3 var(--font-sans); color: var(--color-label); }
.handbackLabel textarea {
  inline-size: 100%; min-block-size: 4.25rem; resize: vertical; border: 0; border-radius: .625rem; padding: .6rem .75rem;
  background: var(--color-fill-2); color: var(--color-label); font: 400 .8125rem/1.45 var(--font-sans);
}
.muted { font-weight: 400; color: var(--color-label-2); }
.handbackActions { display: flex; justify-content: flex-end; gap: .5rem; margin-block-start: .5rem; }

.reconnect {
  position: absolute; inset-block-start: 50%; inset-inline-start: 50%; z-index: 8; display: flex; flex-direction: column; align-items: center; gap: .6rem;
  padding: 1rem 1.25rem; border-radius: var(--radius-lg); background: var(--color-glass); backdrop-filter: var(--backdrop-glass);
  box-shadow: var(--sh```css
  box-shadow: var(--shadow-e2); color: var(--color-label); font: 500 .8125rem/1.3 var(--font-sans); translate: -50% -50%;
}
.spinner { position: relative; inline-size: 1.375rem; block-size: 1.375rem; animation: spin var(--dur-spin) var(--ease-linear) infinite; }
.spinner i { position: absolute; inset-inline-start: .625rem; inset-block-start: .0625rem; inline-size: .125rem; block-size: .375rem; border-radius: .0625rem; background: var(--color-label-2); transform-origin: .0625rem .625rem; }

.caption {
  display: flex; align-items: center; gap: .75rem; block-size: 2.75rem; padding: 0 .9rem;
  background: var(--color-glass); backdrop-filter: var(--backdrop-glass); border-block-start: .03125rem solid var(--color-hairline);
}
.captionDot { flex: none; inline-size: .5rem; block-size: .5rem; border-radius: 50%; background: var(--color-signal); }
.caption[data-tone="control"] .captionDot { background: var(--color-tint); }
.caption[data-tone="paused"] .captionDot, .caption[data-tone="replay"] .captionDot { background: var(--color-label-3); }
.caption[data-tone="reconnecting"] .captionDot { background: var(--color-warn); }
.captionLines { position: relative; flex: 1; min-inline-size: 0; block-size: 1.25rem; overflow: hidden; }
.captionLine { position: absolute; inset: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 .8125rem/1.25rem var(--font-sans); color: var(--color-label); }
.stepNo { flex: none; font: 400 .6875rem/1 var(--font-mono); color: var(--color-label-2); white-space: nowrap; }

.callouts { position: absolute; inset: 0; z-index: 5; overflow: hidden; pointer-events: none; }
.leader { position: absolute; inset: 0; overflow: hidden; }
.leader line { stroke: var(--color-label); stroke-width: 1; stroke-dasharray: 2 3; }
.leader circle { fill: var(--color-signal); }
.callout {
  position: absolute; left: 0; top: 0; max-inline-size: 15rem; padding: .5rem .65rem; border-radius: var(--radius-md);
  background: var(--color-glass); backdrop-filter: var(--backdrop-glass); box-shadow: var(--shadow-e2);
  color: var(--color-label); font: 400 .75rem/1.4 var(--font-sans); overflow-wrap: anywhere;
}
.gutterBadge {
  position: absolute; inset-inline-start: .375rem; top: -.625rem; display: none; place-items: center; inline-size: 1.25rem; block-size: 1.25rem;
  border-radius: 50%; background: var(--color-signal); color: var(--color-on-signal); font: 600 .6875rem/1 var(--font-sans);
}

.scrub { display: flex; align-items: center; gap: .75rem; block-size: 2.75rem; padding: 0 .9rem; background: var(--color-glass); border-block-start: .03125rem solid var(--color-hairline); }
.track { position: relative; flex: 1; display: flex; align-items: center; block-size: 2.75rem; }
.rail, .fill { position: absolute; inset-inline: 0; block-size: .1875rem; border-radius: .125rem; }
.rail { background: var(--color-fill); }
.fill { background: var(--color-label); transform-origin: left; transition: transform var(--dur-micro) var(--ease-out); }
.track input { position: absolute; inset: 0; inline-size: 100%; margin: 0; opacity: 0; cursor: pointer; }
.track:has(input:focus-visible) .rail { outline: .125rem solid var(--color-tint); outline-offset: .25rem; }
.scrubLabel { font: 400 .6875rem/1 var(--font-mono); color: var(--color-label-2); white-space: nowrap; }

@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 73.75rem) {
  .callout, .leader { display: none; }
  .gutterBadge { display: grid; }
}
@media (max-width: 51.25rem) { .banner { font-size: .75rem; } }
@media (max-width: 26.25rem) {
  .chrome { grid-template-columns: 2.5rem minmax(0, 1fr) auto; }
  .dots i:nth-child(n + 2) { display: none; }
  .path, .stepNo { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .frame, .banner { transition: opacity var(--dur-base) var(--ease-out); }
  .frame[data-state="control"] { transform: none; }
  .banner { transform: translate(-50%, 0); }
  .frame[data-state="acting"] .agentRing, .pill[data-pulse] i { animation: none; }
}
```

- [ ] **Step 5: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/components/run && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS. The components are exercised end to end in Task 13.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/components/run
git commit -m "feat(web): mock-browser parts: origin pill, live frame, caption, banners, full screen, step callout"
```

---

## Task 13: Run view assembly, page, 7 states, takeover and SSE e2e

**Files:**
- Create:
  - `apps/web/components/run/browser/browser-frame.tsx`
  - `apps/web/components/run/run-header.tsx`, `apps/web/components/run/run-view.tsx`, `apps/web/components/run/run-view.module.css`
  - `apps/web/app/(app)/runs/[runId]/page.tsx`
  - `apps/web/e2e/run-states.spec.ts`, `apps/web/e2e/takeover.spec.ts`, `apps/web/e2e/sse.spec.ts`

**Interfaces:**
- Consumes: Tasks 5–12.
- Produces:
  - `BrowserFrame(props: BrowserFrameProps)` (`data-testid="browser-frame"`, `data-state=<BrowserState>`). Optional `approval`, `spotlight` and `scrubber` slots are filled by Tasks 14–15.
  - `RunHeader({ model, state })`.
  - `RunView({ runId })`.
  - Route `/runs/[runId]`.
  - **RunView anchors that later tasks edit:**
    - the `useState(false)` line for `handBackOpen`;
    - `const view: RunModel | null = model;`;
    - the `onLiveRetrying={setLiveRetrying}` prop line;
    - the `showCallouts` prop line;
    - the `</section>` line;
    - the `{/* toolbar-extra */}` comment.

- [ ] **Step 1: Write the failing e2e specs.**

`apps/web/e2e/run-states.spec.ts`:
```ts
import { RUN_ID, fixtureDetail, rec, recordedEvents } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { emit, frame, gotoRun } from "./support/run-mocks.ts";

test("live: origin pill, secure-fill badge, caption and live iframe", async ({ page }) => {
  const calls = await gotoRun(page);
  await expect(frame(page)).toHaveAttribute("data-state", "live");
  await expect(page.getByTestId("origin-pill")).toContainText("learn.example.edu");
  await expect(page.getByRole("button", { name: "Filled securely" })).toBeVisible();
  await expect(page.getByText("Thinking about the next step")).toBeVisible();
  await expect(page.frameLocator("iframe[title^='Remote browser']").getByRole("img", { name: "Course lecture page" })).toBeVisible();
  expect(calls.some((c) => c.path === "runs/openLive")).toBe(true);
});

test("acting: inner ring and the cursor moves, then pulses on the click", async ({ page }) => {
  await gotoRun(page);
  const [started, done] = recordedEvents();
  await emit(page, [started!]);
  await expect(frame(page)).toHaveAttribute("data-state", "acting");
  await expect(page.getByText("Ticking the Honor Code box").first()).toBeVisible();
  await emit(page, [done!]);
  await expect(page.getByTestId("click-pulse")).toBeAttached();
});

test("approval: the viewport dims", async ({ page }) => {
  await gotoRun(page);
  await emit(page, recordedEvents());
  await expect(frame(page)).toHaveAttribute("data-state", "approval");
  await expect(page.getByText("Waiting for your approval").first()).toBeVisible();
});

test("control: banner reads 'You're in control · Agent paused · screenshots off'", async ({ page }) => {
  await gotoRun(page, { detail: fixtureDetail({ controller: "user", status: "waiting", waitReason: "takeover" }) });
  await expect(frame(page)).toHaveAttribute("data-state", "control");
  await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
});

test("paused: last masked screenshot, desaturated, with Resume", async ({ page }) => {
  const calls = await gotoRun(page, { detail: fixtureDetail({ status: "sleeping", slotName: null }) });
  await expect(frame(page)).toHaveAttribute("data-state", "paused");
  await expect(frame(page).locator("img[src$='/steps/8/screenshot']")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(() => calls.filter((c) => c.path === "runs/resume").length).toBe(1);
});

test("reconnecting: after the grace period, then recovers", async ({ page }) => {
  await gotoRun(page);
  await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
  await page.evaluate(() => {
    window.__sse.blockOpen = true;
    window.__sse.fail(true);
  });
  await expect(frame(page)).toHaveAttribute("data-state", "reconnecting", { timeout: 5_000 });
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting to the browser" })).toBeVisible();
  await page.evaluate(() => window.__sse.openAll());
  await expect(frame(page)).toHaveAttribute("data-state", "live");
});

test("finished runs show the outcome and offer no takeover", async ({ page }) => {
  await gotoRun(page, { detail: fixtureDetail({ status: "completed", slotName: null }) });
  await emit(page, [rec({ type: "status", status: "completed", waitReason: null, reason: null })]).catch(() => undefined);
  await expect(frame(page)).toHaveAttribute("data-state", "paused");
  await expect(page.getByText("Finished").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Take control of the browser" })).toHaveCount(0);
  expect(RUN_ID).toBeTruthy();
});
```
Finished runs never open SSE, so the `emit` in that last test is allowed to fail. That is why it carries `.catch`.

`apps/web/e2e/takeover.spec.ts`:
```ts
import { RUN_ID, fixtureDetail, rec } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { RpcFailure, emit, frame, gotoRun } from "./support/run-mocks.ts";

const overlay = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Take control of the browser" });

test("clicking into the preview takes control optimistically and focuses the stream", async ({ page }) => {
  const calls = await gotoRun(page);
  await overlay(page).dblclick();
  await expect(frame(page)).toHaveAttribute("data-state", "control");
  await expect.poll(() => calls.filter((c) => c.path === "runs/takeControl")).toEqual([
    { path: "runs/takeControl", input: { runId: RUN_ID } },
  ]);
  await emit(page, [rec({ type: "control", holder: "user" })]);
  await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
  await expect(page.locator("iframe")).toBeFocused();
});

test("reverts with an explanation when control isn't confirmed within 2s", async ({ page }) => {
  await page.clock.install();
  await gotoRun(page);
  await overlay(page).click();
  await expect(frame(page)).toHaveAttribute("data-state", "control");
  await page.clock.fastForward(2_100);
  await expect(frame(page)).toHaveAttribute("data-state", "live");
  await expect(page.getByText("The browser didn't respond, so the agent still has control.")).toBeVisible();
});

test("reverts immediately when takeControl fails", async ({ page }) => {
  await gotoRun(page, {
    handlers: {
      "runs/takeControl": () => {
        throw new RpcFailure("CONFLICT", 409, "busy");
      },
    },
  });
  await overlay(page).click();
  await expect(frame(page)).toHaveAttribute("data-state", "live");
  await expect(page.getByText("Couldn't take control. Try again.")).toBeVisible();
});

test("hands back with a note", async ({ page }) => {
  const calls = await gotoRun(page, { detail: fixtureDetail({ controller: "user", status: "waiting", waitReason: "takeover" }) });
  await page.getByRole("button", { name: "Hand back" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Hand back to the agent" });
  await dialog.getByLabel("Note to the agent (optional)").fill("I closed the survey. Carry on from the quiz page.");
  await dialog.getByRole("button", { name: "Hand back" }).click();
  await expect(frame(page)).not.toHaveAttribute("data-state", "control");
  await expect.poll(() => calls.find((c) => c.path === "runs/handBack")?.input).toEqual({
    runId: RUN_ID,
    note: "I closed the survey. Carry on from the quiz page.",
  });
});

test("taking over a sleeping run wakes it, then hands over", async ({ page }) => {
  const calls = await gotoRun(page, { detail: fixtureDetail({ status: "sleeping", slotName: null }) });
  await overlay(page).click();
  await expect(page.getByText("Waking the browser so you can take control…")).toBeVisible();
  await expect.poll(() => calls.filter((c) => c.path === "runs/takeControl").length).toBe(1);
  await emit(page, [rec({ type: "slot", slotName: "browser-1" }), rec({ type: "control", holder: "user" })]);
  await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
});

test("Full screen requests full screen and locks the keyboard", async ({ page }) => {
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __fs: string[] }).__fs = log;
    Element.prototype.requestFullscreen = async function () {
      log.push("fullscreen");
    };
    Object.defineProperty(navigator, "keyboard", {
      value: { lock: async () => void log.push("lock"), unlock: () => log.push("unlock") },
    });
  });
  await gotoRun(page);
  await page.getByRole("button", { name: "Full screen" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fs: string[] }).__fs)).toEqual(["fullscreen", "lock"]);
});
```

`apps/web/e2e/sse.spec.ts`:
```ts
import { encodeRunEventSse } from "@mastertutor/contracts";
import { recordedEvents } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { frame, gotoRun } from "./support/run-mocks.ts";

test("streams from the snapshot id, then resumes with Last-Event-ID", async ({ page }) => {
  const events = recordedEvents();
  const first = events.slice(0, 3);
  const second = events.slice(3);
  const seen: { url: string; lastEventId: string | undefined }[] = [];
  await page.route("**/api/runs/*/events*", async (route) => {
    const request = route.request();
    seen.push({ url: request.url(), lastEventId: request.headers()["last-event-id"] });
    const batch = seen.length === 1 ? first : seen.length === 2 ? second : [];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      body: `retry: 100\n\n${batch.map(encodeRunEventSse).join("")}`,
    });
  });
  await gotoRun(page, { realEventSource: true });
  await expect(frame(page)).toHaveAttribute("data-state", "approval");
  expect(new URL(seen[0]!.url).searchParams.get("after")).toBe("12");
  expect(seen[1]!.lastEventId).toBe(first.at(-1)!.id);
});
```

- [ ] **Step 2: Run the specs to verify they fail.**

Run: `pnpm --filter @mastertutor/web e2e -- run-states.spec.ts takeover.spec.ts sse.spec.ts`

Expected: FAIL. `/runs/<id>` is a 404.

- [ ] **Step 3: Implement the frame, header and view.**

`apps/web/components/run/browser/browser-frame.tsx`:
```tsx
"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { useRef, useId, type ReactNode } from "react";
import { AgentCursor } from "../cursor/agent-cursor.tsx";
import { toViewport, type Point } from "../cursor/cursor-path.ts";
import { canTakeOver, type BrowserState } from "../model/browser-state.ts";
import { STATE_PILL, actNumber, captionFor, hostAndPath, pausedCopy, stepLabel } from "../model/copy.ts";
import { latestPointerStep, latestScreenshotSeq, originOf, type RunModel, type StepRow } from "../model/run-model.ts";
import type { TakeoverState } from "../model/takeover.ts";
import { useElementSize } from "../use-element-size.ts";
import { Banners, HandBackPopover } from "./banners.tsx";
import { Caption } from "./caption.tsx";
import { FullscreenButton } from "./fullscreen-button.tsx";
import { LiveFrame } from "./live-frame.tsx";
import { OriginPill, StatePill } from "./origin-pill.tsx";
import { StepCallout } from "./step-callout.tsx";
import styles from "./browser-frame.module.css";

export interface BrowserFrameProps {
  runId: string;
  model: RunModel;
  state: BrowserState;
  takeover: TakeoverState;
  replayStep: StepRow | null;
  replayLabel: string;
  showCallouts: boolean;
  handBackOpen: boolean;
  onHandBackOpen(open: boolean): void;
  onHandBack(note: string | null): void;
  onTakeControl(): void;
  onResume(): void;
  onJumpLive(): void;
  onLiveRetrying(retrying: boolean): void;
  approval?: ReactNode;
  spotlight?: Point | null;
  scrubber?: ReactNode;
}

const SPOT = { w: 96, h: 56, r: 12 };

export function BrowserFrame(p: BrowserFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(viewportRef);
  const maskId = `spot-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { model, state } = p;
  const replaying = state === "replay";
  const shown = replaying ? p.replayStep : latestPointerStep(model);
  const url = replaying ? (p.replayStep?.url ?? model.currentUrl) : model.currentUrl;
  const host = hostAndPath(url)?.host ?? "new tab";
  const target = shown?.action?.point && size ? toViewport(shown.action.point, size) : null;
  const pointer = shown?.action?.pointer;
  const pulseKey =
    !replaying && shown?.state === "done" && (pointer === "click" || pointer === "double_click") ? shown.seq : null;
  const shotSeq = replaying ? (p.replayStep?.seq ?? null) : latestScreenshotSeq(model);
  const pill = STATE_PILL[state];
  const spot = p.spotlight && size ? toViewport(p.spotlight, size) : null;
  const callout =
    p.showCallouts && shown && target && size && (state === "live" || state === "acting" || replaying) ? shown : null;

  return (
    <div ref={frameRef} className={styles.frame} data-state={state} data-testid="browser-frame">
      <div className={styles.chrome}>
        <span className={styles.dots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <OriginPill url={url} secure={model.secureFillOrigin !== null && originOf(url) === model.secureFillOrigin} />
        <div className={styles.chromeEnd}>
          <StatePill label={state === "paused" ? pausedCopy(model).title : pill.label} tone={pill.tone} pulse={pill.pulse} />
          <FullscreenButton target={frameRef} />
        </div>
      </div>
      <div ref={viewportRef} className={styles.viewport}>
        <LiveFrame
          runId={p.runId}
          slotName={model.slotName}
          title={`Remote browser, ${host}`}
          interactive={state === "control"}
          onRetrying={p.onLiveRetrying}
        />
        {shotSeq !== null ? (
          <img
            className={styles.shot}
            src={stepScreenshotPath(p.runId, shotSeq)}
            alt={replaying ? `Screenshot of step: ${p.replayStep?.caption ?? host}` : ""}
          />
        ) : null}
        <div className={styles.agentRing} aria-hidden="true" />
        <div className={styles.userRing} aria-hidden="true" />
        <svg className={styles.dim} aria-hidden="true">
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {spot ? (
                <rect x={spot.x - SPOT.w / 2} y={spot.y - SPOT.h / 2} width={SPOT.w} height={SPOT.h} rx={SPOT.r} fill="black" />
              ) : null}
            </mask>
          </defs>
          <rect data-scrim="" width="100%" height="100%" mask={`url(#${maskId})`} />
        </svg>
        {callout && target && size ? (
          <StepCallout
            text={callout.action?.summary ?? callout.caption ?? ""}
            number={actNumber(model, callout.seq)}
            target={target}
            box={size}
          />
        ) : null}
        <AgentCursor
          target={target}
          pulseKey={pulseKey}
          hidden={state === "control" || state === "reconnecting" || state === "paused"}
          thinking={state === "live"}
        />
        {canTakeOver(model, state, p.takeover) ? (
          <button type="button" className={styles.takeover} aria-label="Take control of the browser" onClick={p.onTakeControl}>
            <span className={styles.takeoverHint} aria-hidden="true">
              Click to take control
            </span>
          </button>
        ) : null}
        <Banners
          state={state}
          model={model}
          replayLabel={p.replayLabel}
          onHandBackOpen={p.onHandBackOpen}
          onResume={p.onResume}
          onJumpLive={p.onJumpLive}
        />
        <HandBackPopover
          open={p.handBackOpen && state === "control"}
          onClose={() => p.onHandBackOpen(false)}
          onHandBack={p.onHandBack}
        />
        {p.approval}
      </div>
      {replaying ? p.scrubber : null}
      <Caption
        text={captionFor(state, model, p.takeover, p.replayStep)}
        step={replaying ? p.replayLabel : stepLabel(model)}
        tone={state}
      />
    </div>
  );
}
```

`apps/web/components/run/run-header.tsx`:
```tsx
import Link from "next/link";
import { StatusMark } from "../bits/status-mark.tsx";
import { Icon } from "../ui/icon.tsx";
import type { BrowserState } from "./model/browser-state.ts";
import { STATE_PILL, hostAndPath, markFor, shortRunId, statusLabel } from "./model/copy.ts";
import type { RunModel } from "./model/run-model.ts";
import styles from "./run-view.module.css";

export function RunHeader({ model, state }: { model: RunModel; state: BrowserState }) {
  const host = hostAndPath(model.currentUrl)?.host ?? "no page yet";
  const started = new Date(model.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const title = model.goal.split("\n")[0] ?? model.goal;
  return (
    <header className={styles.head}>
      <div className={styles.headText}>
        <p className={styles.eyebrow}>
          <span className={styles.status} data-tone={STATE_PILL[state].tone}>
            <StatusMark status={markFor(state, model)} label={statusLabel(state, model)} />
          </span>
          <span className={styles.meta}>
            {shortRunId(model.runId)} · {host} · {model.model} ·{" "}
            {model.approvalMode === "ask" ? "asks first" : "auto in allowed domains"} · started {started}
          </span>
        </p>
        <h1 className={styles.title}>{title}</h1>
      </div>
      {model.noteId ? (
        <Link className={styles.noteLink} href={`/notes/${model.noteId}`}>
          <Icon name="doc" />
          Open draft note
        </Link>
      ) : null}
    </header>
  );
}
```

`apps/web/components/run/run-view.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { api } from "../../lib/api/client.ts";
import { toast } from "../bits/swipe-toast.tsx";
import { Toolbar } from "../shell/toolbar.tsx";
import { Button } from "../ui/button.tsx";
import { Icon } from "../ui/icon.tsx";
import { BrowserFrame } from "./browser/browser-frame.tsx";
import { canTakeOver, deriveBrowserState } from "./model/browser-state.ts";
import { shortRunId } from "./model/copy.ts";
import type { RunModel } from "./model/run-model.ts";
import { IDLE_TAKEOVER, inControl, takeoverReducer, takeoverTimeoutMs } from "./model/takeover.ts";
import { RunHeader } from "./run-header.tsx";
import { useRun } from "./stream/use-run.ts";
import styles from "./run-view.module.css";

export function RunView({ runId }: { runId: string }) {
  const { model, connection, loadError } = useRun(runId);
  const [takeover, dispatchTakeover] = useReducer(takeoverReducer, IDLE_TAKEOVER);
  const [replaySeq, setReplaySeq] = useState<number | null>(null);
  const [liveRetrying, setLiveRetrying] = useState(false);
  const [handBackOpen, setHandBackOpen] = useState(false);

  const controller = model?.controller ?? null;
  useEffect(() => {
    if (controller !== null) dispatchTakeover({ type: "holder", holder: controller });
  }, [controller]);

  const timeoutMs = takeoverTimeoutMs(takeover);
  useEffect(() => {
    if (timeoutMs === null) return;
    const timer = setTimeout(() => {
      dispatchTakeover({ type: "timeout" });
      toast({ message: "The browser didn't respond, so the agent still has control." });
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs]);

  const view: RunModel | null = model;
  const shotSteps = useMemo(() => (view ? view.steps.filter((s) => s.screenshotKey !== null) : []), [view]);
  const replayIndex = shotSteps.findIndex((s) => s.seq === replaySeq);
  const replayStep = replayIndex >= 0 ? (shotSteps[replayIndex] ?? null) : null;
  const replayLabel = replayStep ? `step ${replayIndex + 1}/${shotSteps.length}` : "";
  const state = view
    ? deriveBrowserState(view, { connection, takeover, replaying: replayStep !== null, liveRetrying })
    : null;

  const takeControl = useCallback(() => {
    if (!view || !state || !canTakeOver(view, state, takeover)) return;
    setReplaySeq(null);
    dispatchTakeover({ type: "request", wake: view.status === "sleeping" });
    api()
      .runs.takeControl({ runId })
      .catch(() => {
        dispatchTakeover({ type: "request_failed" });
        toast({ message: "Couldn't take control. Try again." });
      });
  }, [view, state, takeover, runId]);

  const handBack = useCallback(
    (note: string | null) => {
      setHandBackOpen(false);
      dispatchTakeover({ type: "release" });
      api()
        .runs.handBack({ runId, note })
        .catch(() => {
          dispatchTakeover({ type: "release_failed" });
          toast({ message: "Couldn't hand back. You're still in control." });
        });
    },
    [runId],
  );

  const resume = useCallback(() => {
    api()
      .runs.resume({ runId })
      .catch(() => toast({ message: "Couldn't resume the run. Try again." }));
  }, [runId]);

  if (loadError) {
    return (
      <>
        <Toolbar title="Run" />
        <p className={styles.loadError} role="alert">
          This run couldn't be loaded. It may have been deleted, or you may be offline.
        </p>
      </>
    );
  }
  if (!view || !state) {
    return (
      <div className={styles.wrap} aria-busy="true" aria-label="Loading run">
        <div className={`skeleton ${styles.skelHead}`} />
        <div className={`skeleton ${styles.skelFrame}`} />
      </div>
    );
  }

  const userHasControl = inControl(view.controller, takeover);
  return (
    <>
      <Toolbar
        title={
          <span className={styles.crumb}>
            Runs <Icon name="chevron-right" /> <b>{shortRunId(runId)}</b>
          </span>
        }
      >
        {/* toolbar-extra */}
        {userHasControl ? (
          <Button onClick={() => setHandBackOpen(true)}>
            <Icon name="hand" />
            Hand back
          </Button>
        ) : (
          <Button variant="secondary" onClick={takeControl} disabled={!canTakeOver(view, state, takeover)}>
            <Icon name="hand" />
            Take over
          </Button>
        )}
      </Toolbar>
      <div className={styles.wrap}>
        <RunHeader model={view} state={state} />
        <div className={styles.body}>
          <section className={styles.stage} aria-label="Agent browser">
            <BrowserFrame
              runId={runId}
              model={view}
              state={state}
              takeover={takeover}
              replayStep={replayStep}
              replayLabel={replayLabel}
              showCallouts
              handBackOpen={handBackOpen}
              onHandBackOpen={setHandBackOpen}
              onHandBack={handBack}
              onTakeControl={takeControl}
              onResume={resume}
              onJumpLive={() => setReplaySeq(null)}
              onLiveRetrying={setLiveRetrying}
            />
          </section>
        </div>
      </div>
    </>
  );
}
```

`apps/web/components/run/run-view.module.css`:
```css
.wrap { max-inline-size: 90rem; margin-inline: auto; padding: 0 2rem 4rem; }
.crumb { display: inline-flex; align-items: center; gap: .25rem; color: var(--color-label-2); }
.crumb b { color: var(--color-label); font-weight: 600; }
.head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 1.5rem; padding-block: 2.5rem 1.5rem; }
.headText { min-inline-size: 0; }
.eyebrow { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; margin: 0 0 .6rem; }
.status { font: 600 .8125rem/1.2 var(--font-sans); }
.meta { font: 400 .6875rem/1.4 var(--font-mono); color: var(--color-label-2); overflow-wrap: anywhere; }
.title { margin: 0; font: 700 clamp(1.75rem, 3.4vw, 2.5rem)/1.08 var(--font-sans); letter-spacing: -.03em; color: var(--color-label); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.noteLink { display: inline-flex; align-items: center; gap: .4rem; min-block-size: var(--hit); padding: 0 1rem; border-radius: var(--radius-pill); background: var(--color-fill-2); color: var(--color-label); font: 500 .8125rem/1 var(--font-sans); text-decoration: none; }
.body { display: grid; grid-template-columns: minmax(0, 1fr) 23.5rem; gap: 2rem; align-items: start; }
.stage { display: flex; flex-direction: column; gap: 2rem; min-inline-size: 0; }
.loadError { max-inline-size: 40rem; margin: 3rem auto; padding: 0 1rem; color: var(--color-label-2); }
.skelHead { block-size: 4rem; margin-block: 2.5rem 1.5rem; border-radius: var(--radius-md); }
.skelFrame { aspect-ratio: 16 / 10; border-radius: var(--radius-frame); }
.calloutToggle { }
@media (max-width: 73.75rem) { .body { grid-template-columns: minmax(0, 1fr); } .calloutToggle { display: none; } }
@media (max-width: 51.25rem) { .wrap { padding: 0 1rem 6rem; } .head { grid-template-columns: minmax(0, 1fr); padding-block: 1.5rem 1rem; } }
@media (max-width: 26.25rem) { .meta { display: none; } }
```

`apps/web/app/(app)/runs/[runId]/page.tsx`:
```tsx
import { Uuid } from "@mastertutor/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunView } from "../../../../components/run/run-view.tsx";

export const metadata: Metadata = { title: "Run · MasterTutor" };

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!Uuid.safeParse(runId).success) notFound();
  return <RunView runId={runId} />;
}
```

- [ ] **Step 4: Run the specs and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web e2e -- run-states.spec.ts takeover.spec.ts sse.spec.ts && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/components/run "apps/web/app/(app)/runs" apps/web/e2e/run-states.spec.ts apps/web/e2e/takeover.spec.ts apps/web/e2e/sse.spec.ts
git commit -m "feat(web): Run view with mock browser, 7 states, optimistic takeover, hand back, full screen and SSE resume"
```

---

## Task 14: Approval spotlight sheet (Deny / Edit / Approve, keyboard, bottom sheet ≤820px)

**Files:**
- Create: `apps/web/components/run/approval/approval-sheet.tsx`, `approval-sheet.module.css`, `apps/web/e2e/approval.spec.ts`
- Modify: `apps/web/components/run/run-view.tsx`

**Interfaces:**
- Consumes: `approvalCopy`, `PendingApproval`, `ApprovalDecisionInput`, `Button` and `Icon`.
- Produces: `ApprovalSheet({ approval, count, onDecide(input: ApprovalDecisionInput) })`. It renders `role="alertdialog"` and takes focus on mount, with no default button.
  - Standard keys: `a` approves, `d` denies, `e` edits.
  - Budget keys: `a` extends +50%, `f` finishes now, `d` cancels.
  - Keys are ignored with modifiers, or when focus is in an input, textarea, select or contentEditable.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/approval.spec.ts`:
```ts
import { DEFAULT_BUDGET, EMPTY_USAGE } from "@mastertutor/contracts";
import { APPROVAL_ID, RUN_ID, rec, recordedEvents } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { RpcFailure, emit, frame, gotoRun } from "./support/run-mocks.ts";

const decisions = (calls: { path: string; input: unknown }[]) => calls.filter((c) => c.path === "runs/decideApproval");

test("A approves, the sheet leaves at once, and Return never approves", async ({ page }) => {
  const calls = await gotoRun(page);
  await emit(page, recordedEvents());
  const sheet = page.getByRole("alertdialog", { name: "Click “Start quiz” on learn.example.edu?" });
  await expect(sheet).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  expect(decisions(calls)).toHaveLength(0);
  await page.keyboard.press("a");
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => decisions(calls).map((c) => c.input)).toEqual([
    { approvalId: APPROVAL_ID, decision: "approved", instruction: null, budgetChoice: null },
  ]);
});

test("E opens the edit box and Send instead sends the instruction", async ({ page }) => {
  const calls = await gotoRun(page);
  await emit(page, recordedEvents());
  await page.keyboard.press("e");
  const box = page.getByLabel("Tell the agent what to do instead");
  await expect(box).toBeFocused();
  await box.fill("Don't start the quiz. Copy the visible prompts.");
  await page.getByRole("button", { name: "Send instead" }).click();
  await expect.poll(() => decisions(calls)[0]?.input).toEqual({
    approvalId: APPROVAL_ID,
    decision: "edited",
    instruction: "Don't start the quiz. Copy the visible prompts.",
    budgetChoice: null,
  });
});

test("a failed decision brings the sheet back with an explanation", async ({ page }) => {
  await gotoRun(page, {
    handlers: {
      "runs/decideApproval": () => {
        throw new RpcFailure("INTERNAL_SERVER_ERROR", 500, "down");
      },
    },
  });
  await emit(page, recordedEvents());
  await page.getByRole("button", { name: /^Deny/ }).click();
  await expect(page.getByText("Couldn't send your answer. The approval is still waiting for you.")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("budget approvals offer Extend +50%, Finish now and Cancel", async ({ page }) => {
  const calls = await gotoRun(page);
  const budgetId = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
  await emit(page, [
    rec({ type: "approval_requested", approvalId: budgetId, request: { kind: "budget", exceeded: "steps", usage: { ...EMPTY_USAGE, steps: 150 }, budget: DEFAULT_BUDGET } }),
  ]);
  await expect(page.getByRole("alertdialog", { name: "Step limit reached" })).toBeVisible();
  await page.keyboard.press("f");
  await expect.poll(() => decisions(calls)[0]?.input).toEqual({
    approvalId: budgetId, decision: "approved", instruction: null, budgetChoice: "finish_now",
  });
});

test("letters typed in the composer never decide (Review Focus 3)", async ({ page }) => {
  const calls = await gotoRun(page);
  await emit(page, recordedEvents());
  await page.getByLabel("Message the agent").fill("");
  await page.getByLabel("Message the agent").pressSequentially("a dead end");
  await page.waitForTimeout(200);
  expect(decisions(calls)).toHaveLength(0);
});

test("a 2,000-char label stays inside the sheet at 390px (Review Focus 4)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoRun(page);
  await emit(page, [
    rec({ type: "approval_requested", approvalId: APPROVAL_ID, request: { kind: "risky_click", action: { type: "click", x: 10, y: 10, button: "left" }, label: `Pay\u200b${"W".repeat(2_000)}`, url: "https://learn.example.edu/x", screenshotKey: null } }),
  ]);
  const sheet = page.getByRole("alertdialog");
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
  await expect(frame(page)).toHaveAttribute("data-state", "approval");
  expect(RUN_ID).toBeTruthy();
});
```
The composer test depends on Task 15's `Message the agent` field. **Mark it `test.fixme` in this task and remove the `fixme` in Task 15, Step 4.**

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm --filter @mastertutor/web e2e -- approval.spec.ts`

Expected: FAIL, because no alertdialog renders.

- [ ] **Step 3: Implement the sheet.**

`apps/web/components/run/approval/approval-sheet.tsx`:
```tsx
"use client";

import type { ApprovalDecisionInput } from "@mastertutor/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../ui/button.tsx";
import { Icon } from "../../ui/icon.tsx";
import { approvalCopy } from "../model/approval-copy.ts";
import type { PendingApproval } from "../model/run-model.ts";
import styles from "./approval-sheet.module.css";

type Choice = "approve" | "deny" | "edit" | "extend" | "finish";
const STANDARD_KEYS: Record<string, Choice> = { a: "approve", d: "deny", e: "edit" };
const BUDGET_KEYS: Record<string, Choice> = { a: "extend", f: "finish", d: "deny" };

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export interface ApprovalSheetProps {
  approval: PendingApproval;
  count: number;
  onDecide(input: ApprovalDecisionInput): void;
}

export function ApprovalSheet({ approval, count, onDecide }: ApprovalSheetProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const copy = approvalCopy(approval.request);

  const decide = (choice: Choice) => {
    const base = { approvalId: approval.id, instruction: null, budgetChoice: null } as const;
    if (choice === "edit") return setEditing(true);
    if (choice === "approve") return onDecide({ ...base, decision: "approved" });
    if (choice === "deny") return onDecide({ ...base, decision: "denied" });
    if (choice === "extend") return onDecide({ ...base, decision: "approved", budgetChoice: "extend" });
    return onDecide({ ...base, decision: "approved", budgetChoice: "finish_now" });
  };
  const sendInstead = () => {
    const text = instruction.trim();
    if (text) onDecide({ approvalId: approval.id, decision: "edited", instruction: text, budgetChoice: null });
  };

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (editing) return;
    const keys = copy.budget ? BUDGET_KEYS : STANDARD_KEYS;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTextField(event.target)) return;
      const choice = keys[event.key.toLowerCase()];
      if (!choice) return;
      event.preventDefault();
      decide(choice);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div
      ref={ref}
      className={styles.sheet}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      tabIndex={-1}
    >
      <span className={styles.handle} aria-hidden="true" />
      <div className={styles.top}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="hand" />
        </span>
        <div className={styles.text}>
          <h3 id={`${id}-title`} className={styles.title}>{copy.title}</h3>
          <p id={`${id}-body`} className={styles.body}>{copy.body}</p>
        </div>
      </div>
      {copy.risk ? (
        <p className={styles.risk}>
          <Icon name="warning" />
          {copy.risk}
        </p>
      ) : null}
      {copy.details.length ? (
        <details className={styles.details}>
          <summary>
            <Icon name="chevron-right" />
            Details
          </summary>
          <dl>
            {copy.details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {editing ? (
        <div className={styles.edit}>
          <label htmlFor={`${id}-edit`} className="sr-only">Tell the agent what to do instead</label>
          <textarea
            id={`${id}-edit`}
            autoFocus
            maxLength={2_000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
                ref.current?.focus();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendInstead();
              }
            }}
          />
          <div className={styles.editActions}>
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={sendInstead} disabled={!instruction.trim()}>Send instead</Button>
          </div>
        </div>
      ) : copy.budget ? (
        <div className={styles.acts}>
          <Button variant="secondary" aria-keyshortcuts="D" onClick={() => decide("deny")}>Cancel run <kbd>D</kbd></Button>
          <Button variant="secondary" aria-keyshortcuts="F" onClick={() => decide("finish")}>Finish now <kbd>F</kbd></Button>
          <Button aria-keyshortcuts="A" onClick={() => decide("extend")}>Extend +50% <kbd>A</kbd></Button>
        </div>
      ) : (
        <div className={styles.acts}>
          <Button variant="secondary" aria-keyshortcuts="D" onClick={() => decide("deny")}>Deny <kbd>D</kbd></Button>
          <Button variant="secondary" aria-keyshortcuts="E" onClick={() => decide("edit")}>Edit <kbd>E</kbd></Button>
          <Button className={styles.approve} aria-keyshortcuts="A" onClick={() => decide("approve")}>Approve <kbd>A</kbd></Button>
        </div>
      )}
      {count > 1 ? <p className={styles.more}>{count - 1} more waiting after this</p> : null}
    </div>
  );
}
```

`apps/web/components/run/approval/approval-sheet.module.css`:
```css
.sheet {
  position: absolute; inset-block-start: 50%; inset-inline-start: 50%; z-index: 8; inline-size: min(25rem, calc(100% - 2rem));
  max-block-size: calc(100% - 2rem); overflow: auto; padding: 1.25rem; border-radius: var(--radius-lg);
  background: var(--color-elevated); box-shadow: var(--shadow-e3); color: var(--color-label); translate: -50% -50%;
  animation: rise var(--spring-soft-duration) var(--spring-soft) both;
}
.sheet:focus-visible { outline: .125rem solid var(--color-tint); outline-offset: .125rem; }
.handle { display: none; }
.top { display: flex; align-items: flex-start; gap: .75rem; }
.icon { display: grid; place-items: center; flex: none; inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; background: var(--color-signal); color: var(--color-on-signal); }
.text { min-inline-size: 0; }
.title { margin: .1rem 0 .3rem; font: 600 1.0625rem/1.25 var(--font-sans); overflow-wrap: anywhere; }
.body { margin: 0; font-size: .8125rem; line-height: 1.45; color: var(--color-label-2); overflow-wrap: anywhere; }
.risk { display: flex; gap: .5rem; margin: .85rem 0 .25rem; padding: .6rem .7rem; border-radius: .625rem; background: var(--color-warn-wash); font-size: .75rem; }
.details { margin-block-start: .6rem; font-size: .75rem; }
.details summary { display: inline-flex; align-items: center; gap: .25rem; min-block-size: 1.75rem; color: var(--color-tint-text); cursor: pointer; list-style: none; }
.details dl { display: grid; gap: .35rem; margin: .5rem 0 0; }
.details dl div { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); gap: .75rem; }
.details dt { color: var(--color-label-2); }
.details dd { margin: 0; font: 400 .6875rem/1.5 var(--font-mono); overflow-wrap: anywhere; }
.acts { display: grid; grid-template-columns: 1fr 1fr 1.35fr; gap: .5rem; margin-block-start: 1rem; }
.acts > * { min-block-size: var(--hit); }
.edit { margin-block-start: .85rem; }
.edit textarea { inline-size: 100%; min-block-size: 4.5rem; resize: vertical; border: 0; border-radius: .625rem; padding: .6rem .75rem; background: var(--color-fill-2); color: var(--color-label); font: 400 .8125rem/1.45 var(--font-sans); }
.editActions { display: flex; justify-content: flex-end; gap: .5rem; margin-block-start: .5rem; }
.more { margin: .75rem 0 0; font-size: .75rem; color: var(--color-label-2); }
@keyframes rise { from { opacity: 0; transform: translateY(1rem) scale(.98); } to { opacity: 1; transform: none; } }
@media (max-width: 51.25rem) {
  .sheet {
    position: fixed; inset: auto 0 0 0; z-index: 120; inline-size: auto; max-block-size: 80dvh; translate: none;
    padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom)); border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }
  .handle { display: block; inline-size: 2.25rem; block-size: .3125rem; margin: -.5rem auto .9rem; border-radius: .1875rem; background: var(--color-label-3); opacity: .5; }
  .acts { grid-template-columns: 1fr 1fr; }
  .approve { grid-column: 1 / -1; order: -1; }
}
@media (prefers-reduced-motion: reduce) { .sheet { animation: fade var(--dur-base) var(--ease-out) both; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
```

- [ ] **Step 4: Wire the sheet into `run-view.tsx` (exact edits).**

1. Add these imports after the `BrowserFrame` import:
```tsx
import type { ApprovalDecisionInput } from "@mastertutor/contracts";
import { ApprovalSheet } from "./approval/approval-sheet.tsx";
import { approvalCopy } from "./model/approval-copy.ts";
```
2. After `const [handBackOpen, setHandBackOpen] = useState(false);` add:
```tsx
  const [deciding, setDeciding] = useState<ReadonlySet<string>>(() => new Set());
```
3. Replace `const view: RunModel | null = model;` with:
```tsx
  const view: RunModel | null = useMemo(
    () => (model ? { ...model, approvals: model.approvals.filter((a) => !deciding.has(a.id)) } : null),
    [model, deciding],
  );
```
4. After the `resume` callback, add:
```tsx
  const decide = useCallback((input: ApprovalDecisionInput) => {
    setDeciding((s) => new Set(s).add(input.approvalId));
    api()
      .runs.decideApproval(input)
      .catch(() => {
        setDeciding((s) => {
          const next = new Set(s);
          next.delete(input.approvalId);
          return next;
        });
        toast({ message: "Couldn't send your answer. The approval is still waiting for you." });
      });
  }, []);
```
5. Below the line `              onLiveRetrying={setLiveRetrying}`, insert:
```tsx
              approval={
                state === "approval" && view.approvals[0] ? (
                  <ApprovalSheet
                    key={view.approvals[0].id}
                    approval={view.approvals[0]}
                    count={view.approvals.length}
                    onDecide={decide}
                  />
                ) : null
              }
              spotlight={state === "approval" && view.approvals[0] ? approvalCopy(view.approvals[0].request).spotlight : null}
```

- [ ] **Step 5: Run the spec and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web e2e -- approval.spec.ts && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS. The composer test is skipped as `fixme` until Task 15.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/components/run apps/web/e2e/approval.spec.ts
git commit -m "feat(web): approval spotlight sheet with D/E/A keys, edit, budget choices and optimistic decisions"
```

---

## Task 15: Timeline, OTP card, budget meters, message composer and replay

**Files:**
- Create in `apps/web/components/run/`:
  - `use-media-query.ts`
  - `timeline/timeline-panel.tsx`, `timeline/otp-card.tsx`, `timeline/budget-meters.tsx`, `timeline/message-composer.tsx`, `timeline/timeline.module.css`
  - `browser/replay-scrubber.tsx`
- Create: `apps/web/e2e/timeline.spec.ts`, `apps/web/e2e/code-slots.spec.ts`
- Modify: `apps/web/components/run/run-view.tsx`, `apps/web/e2e/approval.spec.ts` (remove the `fixme`)

**Interfaces:**
- Consumes: `timelineItems`, `thinkingState`, `summaryLabel`, `StatusMark`, `ThoughtLine`, `CountUp`, `CodeSlots`, `stepScreenshotPath` and `compactNumber`.
- Produces:
  - `useMediaQuery(query): boolean`;
  - `TimelinePanel(props)`, which is a bottom sheet at ≤820px (`data-open`, inert content when collapsed);
  - `OtpCard({ runId, host })`, `BudgetMeters({ usage, budget })`, `MessageComposer({ disabled, onSend })` and `ReplayScrubber({ steps, seq, playing, onSeq, onTogglePlay })`;
  - `REPLAY_INTERVAL_MS = 1000`.

- [ ] **Step 1: Write the failing specs.**

`apps/web/e2e/timeline.spec.ts`:
```ts
import { RUN_ID, fixtureDetail, rec, recordedEvents } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { RpcFailure, emit, frame, gotoRun } from "./support/run-mocks.ts";

test("lists steps with status marks, a credential chip and a summary", async ({ page }) => {
  await gotoRun(page);
  const steps = page.getByRole("complementary", { name: "Steps" });
  await expect(steps.getByText("5 steps · 2 captures")).toBeVisible();
  await expect(steps.getByText("Filled the password for ada-learn")).toBeVisible();
  await expect(steps.getByText("Vault fill")).toBeVisible();
  await expect(steps.getByText("Completed:").first()).toBeAttached();
});

test("ThoughtLine thinks during decide, then settles while acting", async ({ page }) => {
  await gotoRun(page);
  const [act, , , decideStart] = recordedEvents();
  await emit(page, [decideStart!]);
  await expect(page.getByRole("status").filter({ hasText: "Deciding whether to start the quiz" })).toBeAttached();
  await emit(page, [rec({ type: "step", seq: 13, phase: "act", state: "started", caption: "Opening the quiz", url: null, screenshotKey: null, action: null })]);
  await expect(page.getByRole("status").filter({ hasText: /^Thought for/ })).toBeAttached();
  expect(act).toBeTruthy();
});

test("budget meters count up to new usage", async ({ page }) => {
  await gotoRun(page);
  await emit(page, [recordedEvents()[2]!]);
  await expect(page.getByTestId("meter-steps").locator(".sr-only")).toHaveText("10");
  await expect(page.getByTestId("meter-spend").locator(".sr-only")).toHaveText("$0.44");
});

test("messages send optimistically, dedupe on echo, and restore on failure", async ({ page }) => {
  let fail = false;
  await gotoRun(page, {
    handlers: {
      "runs/sendMessage": () => {
        if (fail) throw new RpcFailure("INTERNAL_SERVER_ERROR", 500, "down");
        return { ok: true };
      },
    },
  });
  const box = page.getByLabel("Message the agent");
  await box.fill("Skip the quiz");
  await box.press("Enter");
  await expect(page.getByText("Skip the quiz")).toHaveCount(1);
  await emit(page, [rec({ type: "user_message", text: "Skip the quiz" })]);
  await expect(page.getByText("Skip the quiz")).toHaveCount(1);
  fail = true;
  await box.fill("Second note");
  await box.press("Enter");
  await expect(page.getByText("Couldn't send your message. It's back in the box.")).toBeVisible();
  await expect(box).toHaveValue("Second note");
});

test("replay: a step with a screenshot opens the scrubber, play advances, Jump to live returns", async ({ page }) => {
  await gotoRun(page);
  await page.getByRole("button", { name: "Replay step: Clicked “Log in”" }).click();
  await expect(frame(page)).toHaveAttribute("data-state", "replay");
  await expect(page.getByRole("slider", { name: "Replay position" })).toHaveValue("2");
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect(page.getByRole("slider", { name: "Replay position" })).toHaveValue("3", { timeout: 3_000 });
  await page.getByRole("button", { name: "Jump to live" }).click();
  await expect(frame(page)).toHaveAttribute("data-state", "live");
});

test("≤820px: the timeline is a bottom sheet that opens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoRun(page, { detail: fixtureDetail() });
  const toggle = page.getByRole("button", { name: /Steps/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const panel = page.getByRole("complementary", { name: "Steps" });
  expect(await panel.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText("Filled the password for ada-learn")).toBeInViewport();
  expect(RUN_ID).toBeTruthy();
});
```

`apps/web/e2e/code-slots.spec.ts`:
```ts
import { RUN_ID, rec } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { RpcFailure, emit, gotoRun } from "./support/run-mocks.ts";

const otpWait = () => rec({ type: "status", status: "waiting", waitReason: "otp", reason: null });

test("the code goes to submitOtp once and never stays in the page (security review)", async ({ page }) => {
  const consoleText: string[] = [];
  page.on("console", (m) => consoleText.push(m.text()));
  const calls = await gotoRun(page);
  await emit(page, [otpWait()]);
  const input = page.getByLabel("One-time code");
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await input.focus();
  await page.keyboard.type("481516");
  await expect(page.getByText("Sent to the browser. The agent only saw “code entered”.")).toBeVisible();
  expect(calls.filter((c) => c.path === "runs/submitOtp").map((c) => c.input)).toEqual([{ runId: RUN_ID, code: "481516" }]);
  await expect(input).toHaveValue("");
  expect(await page.content()).not.toContain("481516");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain("481516");
  expect(consoleText.join("\n")).not.toContain("481516");
});

test("pasting an 8-digit code with separators submits all 8", async ({ page }) => {
  const calls = await gotoRun(page);
  await emit(page, [otpWait()]);
  const input = page.getByLabel("One-time code");
  await input.focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text", "1234-5678");
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });
  await expect.poll(() => calls.find((c) => c.path === "runs/submitOtp")?.input).toEqual({ runId: RUN_ID, code: "12345678" });
});

test("six boxes fit the card at 390px (D22)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoRun(page);
  await emit(page, [otpWait()]);
  await page.getByRole("button", { name: /Steps/ }).click();
  const card = page.getByTestId("otp-card");
  const cardBox = (await card.boundingBox())!;
  const slots = card.locator("[data-filled], [aria-hidden='true'] > span");
  for (const box of await Promise.all((await slots.all()).map((s) => s.boundingBox()))) {
    expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
  }
});

test("a failed submit clears the boxes and asks again", async ({ page }) => {
  await gotoRun(page, { handlers: { "runs/submitOtp": () => { throw new RpcFailure("BAD_REQUEST", 400, "expired"); } } });
  await emit(page, [otpWait()]);
  await page.getByLabel("One-time code").focus();
  await page.keyboard.type("111111");
  await expect(page.getByText("Couldn't send the code. Enter it again.")).toBeVisible();
  await expect(page.getByLabel("One-time code")).toBeEnabled();
});
```

- [ ] **Step 2: Run the specs to verify they fail.**

Run: `pnpm --filter @mastertutor/web e2e -- timeline.spec.ts code-slots.spec.ts`

Expected: FAIL, because there is no "Steps" panel yet.

- [ ] **Step 3: Implement the components.**

`apps/web/components/run/use-media-query.ts`:
```ts
"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
```

`apps/web/components/run/browser/replay-scrubber.tsx`:
```tsx
"use client";

import { Icon } from "../../ui/icon.tsx";
import type { StepRow } from "../model/run-model.ts";
import styles from "./browser-frame.module.css";

export const REPLAY_INTERVAL_MS = 1_000;

export interface ReplayScrubberProps {
  steps: StepRow[];
  seq: number | null;
  playing: boolean;
  onSeq(seq: number): void;
  onTogglePlay(): void;
}

export function ReplayScrubber({ steps, seq, playing, onSeq, onTogglePlay }: ReplayScrubberProps) {
  const index = Math.max(0, steps.findIndex((s) => s.seq === seq));
  const ratio = steps.length > 1 ? index / (steps.length - 1) : 0;
  return (
    <div className={styles.scrub}>
      <button type="button" className={styles.iconButton} aria-label={playing ? "Pause replay" : "Play replay"} onClick={onTogglePlay}>
        <Icon name={playing ? "pause" : "play"} />
      </button>
      <div className={styles.track}>
        <div className={styles.rail} />
        <div className={styles.fill} style={{ transform: `scaleX(${ratio})` }} />
        <input
          type="range"
          min={1}
          max={steps.length}
          value={index + 1}
          aria-label="Replay position"
          aria-valuetext={`Step ${index + 1} of ${steps.length}`}
          onChange={(e) => {
            const step = steps[Number(e.target.value) - 1];
            if (step) onSeq(step.seq);
          }}
        />
      </div>
      <span className={styles.scrubLabel}>
        {index + 1} / {steps.length}
      </span>
    </div>
  );
}
```

`apps/web/components/run/timeline/budget-meters.tsx`:
```tsx
import type { Budget, Usage } from "@mastertutor/contracts";
import { CountUp } from "../../bits/count-up.tsx";
import { compactNumber, formatCount } from "../../bits/format.ts";
import styles from "./timeline.module.css";

export function BudgetMeters({ usage, budget }: { usage: Usage; budget: Budget }) {
  const rows = [
    { id: "steps", label: "Steps", value: usage.steps, max: budget.maxSteps, decimals: 0, prefix: "", suffix: "", foot: "Pauses and asks at the limit" },
    { id: "spend", label: "Spend", value: usage.usd, max: budget.maxUsd, decimals: 2, prefix: "$", suffix: "", foot: `${compactNumber(usage.inputTokens + usage.outputTokens)} tokens` },
    { id: "time", label: "Time", value: usage.activeMs / 60_000, max: budget.maxActiveMinutes, decimals: 0, prefix: "", suffix: " min", foot: "Counts while the agent works" },
  ];
  return (
    <dl className={styles.meters} aria-label="Budget">
      {rows.map((r) => (
        <div key={r.id} className={styles.meter} data-testid={`meter-${r.id}`}>
          <dt className={styles.eyebrow}>{r.label}</dt>
          <dd className={styles.meterValue}>
            <span className={styles.num}>
              <CountUp value={r.value} decimals={r.decimals} prefix={r.prefix} suffix={r.suffix} />
              <small> / {formatCount(r.max, r.decimals, r.prefix, r.suffix)}</small>
            </span>
            <span className={styles.bar} aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(1, r.value / r.max)})` }} />
            </span>
            <span className={styles.foot}>{r.foot}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
```

`apps/web/components/run/timeline/message-composer.tsx`:
```tsx
"use client";

import { useId, useState } from "react";
import { Icon } from "../../ui/icon.tsx";
import styles from "./timeline.module.css";

export function MessageComposer({ disabled, onSend }: { disabled: boolean; onSend(text: string): Promise<boolean> }) {
  const id = useId();
  const [text, setText] = useState("");
  const send = async () => {
    const value = text.trim();
    if (!value || disabled) return;
    setText("");
    if (!(await onSend(value))) setText(value);
  };
  return (
    <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label htmlFor={id} className="sr-only">Message the agent</label>
      <textarea
        id={id}
        rows={1}
        maxLength={4_000}
        value={text}
        disabled={disabled}
        placeholder={disabled ? "This run has ended" : "Message the agent"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button type="submit" className={styles.send} disabled={disabled || !text.trim()} aria-label="Send message">
        <Icon name="send" />
      </button>
    </form>
  );
}
```

`apps/web/components/run/timeline/otp-card.tsx`:
```tsx
"use client";

import { useId, useState } from "react";
import { api } from "../../../lib/api/client.ts";
import { CodeSlots } from "../../bits/code-slots.tsx";
import styles from "./timeline.module.css";

type Phase = "entering" | "sending" | "sent" | "failed";
const PHASE_TEXT: Record<Phase, string> = {
  entering: "Goes straight to the browser. Never to the model.",
  sending: "Sending to the browser…",
  sent: "Sent to the browser. The agent only saw “code entered”.",
  failed: "Couldn't send the code. Enter it again.",
};

/** The code exists only in this closure until web seals it (spec §9 Fields → otp). */
export function OtpCard({ runId, host }: { runId: string; host: string }) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>("entering");
  const [sealed, setSealed] = useState<number | null>(null);
  const submit = (code: string) => {
    setSealed(code.length);
    setPhase("sending");
    api()
      .runs.submitOtp({ runId, code })
      .then(
        () => setPhase("sent"),
        () => {
          setSealed(null);
          setPhase("failed");
        },
      );
  };
  return (
    <section className={styles.codecard} aria-labelledby={`${id}-title`} data-testid="otp-card">
      <h3 id={`${id}-title`} className={styles.cardTitle}>Enter the code sent to you</h3>
      <p className={styles.cardFoot}>{host} asked for a one-time code.</p>
      <CodeSlots label="One-time code" sealed={sealed} onComplete={submit} />
      <p className={styles.otpState} data-phase={phase} role="status">{PHASE_TEXT[phase]}</p>
      <p className={styles.flow}>
        <span className="sr-only">Where the code goes: you, then the browser, never the model.</span>
        <span aria-hidden="true">You → Browser · <s>model</s></span>
      </p>
    </section>
  );
}
```

`apps/web/components/run/timeline/timeline-panel.tsx`:
```tsx
"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { StatusMark } from "../../bits/status-mark.tsx";
import { ThoughtLine } from "../../bits/thought-line.tsx";
import { Icon } from "../../ui/icon.tsx";
import type { ThinkingState, TimelineItem } from "../model/timeline-items.ts";
import { useMediaQuery } from "../use-media-query.ts";
import { MessageComposer } from "./message-composer.tsx";
import { OtpCard } from "./otp-card.tsx";
import styles from "./timeline.module.css";

export interface TimelinePanelProps {
  runId: string;
  items: TimelineItem[];
  summary: string;
  thinking: ThinkingState | null;
  otpHost: string | null;
  otpKey: string;
  replaySeq: number | null;
  onReplay(seq: number): void;
  canMessage: boolean;
  onSend(text: string): Promise<boolean>;
}

function Row({ item, runId, selected, onReplay }: { item: TimelineItem; runId: string; selected: boolean; onReplay(seq: number): void }) {
  if (item.kind === "step") {
    const body = (
      <>
        {item.hasShot ? (
          <img className={styles.thumb} src={stepScreenshotPath(runId, item.seq)} alt="" loading="lazy" />
        ) : (
          <span className={styles.thumb} aria-hidden="true" />
        )}
        <span className={styles.text}>
          <span className={styles.verb} data-kind={item.verbKind ?? undefined}>{item.verb}</span>
          <StatusMark status={item.status} label={item.line} />
          {item.credential ? (
            <span className={styles.alias}>
              <Icon name="key" />
              Vault fill
            </span>
          ) : null}
        </span>
        <time className={styles.ts} dateTime={item.at}>{item.ts}</time>
      </>
    );
    return (
      <li className={styles.row} data-current={item.current || undefined} data-selected={selected || undefined}>
        {item.hasShot ? (
          <button type="button" className={styles.rowBody} aria-label={`Replay step: ${item.line}`} onClick={() => onReplay(item.seq)}>
            {body}
          </button>
        ) : (
          <div className={styles.rowBody}>{body}</div>
        )}
      </li>
    );
  }
  if (item.kind === "message") {
    return (
      <li className={styles.row}>
        <div className={styles.message} data-pending={item.pending || undefined}>
          <span className={styles.verb}>You</span>
          <p>{item.text}</p>
        </div>
      </li>
    );
  }
  return (
    <li className={styles.row}>
      <div className={styles.rowBody}>
        <span className={styles.thumb} aria-hidden="true" />
        <span className={styles.text}>
          {item.kind === "decision" ? <StatusMark status={item.status} label={item.line} /> : <span>{item.line}</span>}
        </span>
        <time className={styles.ts} dateTime={item.at}>{item.ts}</time>
      </div>
    </li>
  );
}

export function TimelinePanel(p: TimelinePanelProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const compact = useMediaQuery("(max-width: 51.25rem)");
  const listRef = useRef<HTMLOListElement>(null);
  const hidden = compact && !open;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 160) list.scrollTop = list.scrollHeight;
  }, [p.items.length, p.otpHost]);

  return (
    <aside className={styles.panel} data-open={open || undefined} aria-labelledby={`${id}-title`}>
      <div className={styles.head}>
        <h2 id={`${id}-title`} className={styles.headTitle}>Steps</h2>
        <button type="button" className={styles.sheetToggle} aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen((o) => !o)}>
          <span className={styles.handle} aria-hidden="true" />
          Steps · {p.summary}
        </button>
        <span className={styles.summary}>{p.summary}</span>
      </div>
      <ol ref={listRef} id={`${id}-list`} className={styles.list} inert={hidden}>
        {p.items.map((item) => (
          <Row key={item.key} item={item} runId={p.runId} selected={item.kind === "step" && item.seq === p.replaySeq} onReplay={p.onReplay} />
        ))}
        {p.thinking ? (
          <li className={styles.row}>
            <ThoughtLine label={p.thinking.label} working={p.thinking.working} since={p.thinking.since} />
          </li>
        ) : null}
        {p.otpHost ? (
          <li className={styles.row}>
            <OtpCard key={p.otpKey} runId={p.runId} host={p.otpHost} />
          </li>
        ) : null}
      </ol>
      <div inert={hidden}>
        <MessageComposer disabled={!p.canMessage} onSend={p.onSend} />
      </div>
    </aside>
  );
}
```
`h2` "Steps" names the aside. On ≤820px the `h2` is visually hidden (`.headTitle` is `sr-only`-like), so the landmark name stays "Steps".

`apps/web/components/run/timeline/timeline.module.css`:
```css
.panel { position: sticky; inset-block-start: 4.25rem; align-self: start; display: flex; flex-direction: column; gap: .75rem; min-inline-size: 0; max-block-size: calc(100dvh - 8rem); }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; }
.headTitle { margin: 0; font: 600 1.25rem/1.2 var(--font-sans); color: var(--color-label); }
.sheetToggle { display: none; }
.summary { font-size: .75rem; color: var(--color-label-2); }
.list { flex: 1; min-block-size: 12rem; margin: 0; padding: 0; overflow: auto; list-style: none; scrollbar-width: thin; }
.row { position: relative; }
.row + .row { border-block-start: .0625rem solid var(--color-separator); }
.rowBody { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; gap: .75rem; inline-size: 100%; padding: .7rem .5rem; border: 0; border-radius: var(--radius-md); background: none; color: inherit; font: inherit; text-align: start; }
button.rowBody { cursor: pointer; transition: transform var(--dur-micro) var(--ease-out); }
button.rowBody:hover { background: var(--color-fill-2); }
button.rowBody:active { transform: scale(.98); }
.row[data-selected] .rowBody { background: var(--color-tint-wash); }
.thumb { inline-size: 3.5rem; block-size: 2.1875rem; border-radius: .375rem; background: var(--color-bg-2); box-shadow: var(--shadow-e1); object-fit: cover; }
.row[data-current] .thumb { box-shadow: 0 0 0 .09375rem var(--color-signal); }
.text { display: flex; flex-direction: column; gap: .25rem; min-inline-size: 0; font: 500 .8125rem/1.38 var(--font-sans); }
.verb { font: 600 .625rem/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--color-label-2); }
.verb[data-kind="cred"] { color: var(--color-tint-text); }
.verb[data-kind="sig"] { color: var(--color-signal); }
.alias { display: inline-flex; align-items: center; gap: .3rem; inline-size: fit-content; padding: .125rem .5rem; border-radius: var(--radius-pill); background: var(--color-tint-wash); color: var(--color-tint-text); font-size: .6875rem; }
.ts { font: 400 .6875rem/1.4 var(--font-mono); color: var(--color-label-2); }
.message { margin: .5rem; padding: .6rem .75rem; border-radius: var(--radius-md); background: var(--color-tint-wash); }
.message p { margin: .25rem 0 0; font-size: .8125rem; overflow-wrap: anywhere; }
.message[data-pending] { opacity: .6; }
.composer { display: flex; align-items: flex-end; gap: .5rem; padding: .5rem; border-radius: var(--radius-lg); background: var(--color-fill-2); }
.composer textarea { flex: 1; min-inline-size: 0; min-block-size: 2.25rem; max-block-size: 8rem; field-sizing: content; resize: none; border: 0; padding: .5rem; background: none; color: var(--color-label); font: 400 .875rem/1.4 var(--font-sans); }
.composer textarea:focus-visible { outline: none; }
.composer:focus-within { box-shadow: 0 0 0 .125rem var(--color-tint); }
.send { display: grid; place-items: center; flex: none; inline-size: var(--hit); block-size: var(--hit); border: 0; border-radius: 50%; background: var(--color-tint); color: var(--color-on-tint); transition: transform var(--dur-micro) var(--ease-out); }
.send:disabled { background: var(--color-fill); color: var(--color-label-3); }
.send:active { transform: scale(.92); }
.codecard { margin: .5rem; padding: .85rem; border-radius: var(--radius-md); background: var(--color-elevated); box-shadow: var(--shadow-e2); }
.cardTitle { margin: 0; font: 600 .8125rem/1.3 var(--font-sans); }
.cardFoot { margin: .15rem 0 .65rem; font-size: .75rem; color: var(--color-label-2); }
.otpState { margin: .65rem 0 0; font: 500 .75rem/1.3 var(--font-sans); color: var(--color-label-2); }
.otpState[data-phase="sent"] { color: var(--color-ok); }
.otpState[data-phase="failed"] { color: var(--color-danger); }
.flow { margin: .5rem 0 0; font-size: .6875rem; color: var(--color-label-2); white-space: nowrap; }
.flow s { text-decoration-color: var(--color-signal); white-space: nowrap; }
.meters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem; margin: 0; padding-block-start: 1.5rem; border-block-start: .0625rem solid var(--color-separator); }
.meter { min-inline-size: 0; }
.eyebrow { font: 600 .6875rem/1.2 var(--font-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--color-label-2); }
.meterValue { display: grid; gap: .45rem; margin: .45rem 0 0; }
.num { font: 600 2.25rem/1 var(--font-sans); letter-spacing: -.04em; color: var(--color-label); white-space: nowrap; }
.num small { font-size: .875rem; font-weight: 500; letter-spacing: -.01em; color: var(--color-label-2); }
.bar { position: relative; block-size: .125rem; overflow: hidden; background: var(--color-fill); }
.bar i { position: absolute; inset: 0; background: var(--color-label); transform-origin: left; transition: transform var(--dur-panel) var(--ease-out); }
.foot { font-size: .75rem; color: var(--color-label-2); }
@media (max-width: 73.75rem) { .panel { position: relative; inset-block-start: auto; max-block-size: none; } .list { overflow: visible; } }
@media (max-width: 51.25rem) {
  .panel {
    position: fixed; inset-inline: 0; inset-block-end: calc(var(--shell-bottom-inset, 0rem) + env(safe-area-inset-bottom)); z-index: 40;
    max-block-size: 72dvh; padding: .5rem 1rem 1rem; border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    background: var(--color-glass); backdrop-filter: var(--backdrop-glass); box-shadow: var(--shadow-e3);
    transform: translateY(calc(100% - 3.75rem)); transition: transform var(--spring-soft-duration) var(--spring-soft);
  }
  .panel[data-open] { transform: none; }
  .headTitle { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
  .summary { display: none; }
  .sheetToggle { display: flex; flex-direction: column; align-items: center; gap: .4rem; inline-size: 100%; min-block-size: var(--hit); border: 0; background: none; color: var(--color-label); font: 600 .875rem/1.2 var(--font-sans); }
  .handle { inline-size: 2.25rem; block-size: .3125rem; border-radius: .1875rem; background: var(--color-label-3); opacity: .5; }
  .list { overflow: auto; }
  .meters { grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .num { font-size: 1.75rem; }
}
@media (prefers-reduced-motion: reduce) { .panel { transition: opacity var(--dur-base) var(--ease-out); } }
```

- [ ] **Step 4: Wire into `run-view.tsx` (exact edits) and un-fixme the approval test.**

1. Add these imports:
```tsx
import { hostAndPath } from "./model/copy.ts";
import { summaryLabel, thinkingState, timelineItems, type PendingMessage } from "./model/timeline-items.ts";
import { isTerminal } from "./model/run-model.ts";
import { ReplayScrubber, REPLAY_INTERVAL_MS } from "./browser/replay-scrubber.tsx";
import { BudgetMeters } from "./timeline/budget-meters.tsx";
import { TimelinePanel } from "./timeline/timeline-panel.tsx";
```
2. After the `deciding` state line, add:
```tsx
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [playing, setPlaying] = useState(false);
```
3. After the `replayLabel` line, add:
```tsx
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setReplaySeq((seq) => {
        const next = shotSteps[shotSteps.findIndex((s) => s.seq === seq) + 1];
        if (!next) {
          setPlaying(false);
          return null;
        }
        return next.seq;
      });
    }, REPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, shotSteps]);
  const items = useMemo(() => (view ? timelineItems(view, pending) : []), [view, pending]);
  const lastEventId = view?.lastEventId ?? null;
  const send = useCallback(
    async (text: string) => {
      const entry = { key: crypto.randomUUID(), text, afterEventId: lastEventId };
      setPending((p) => [...p, entry]);
      try {
        await api().runs.sendMessage({ runId, text });
        return true;
      } catch {
        setPending((p) => p.filter((m) => m.key !== entry.key));
        toast({ message: "Couldn't send your message. It's back in the box." });
        return false;
      }
    },
    [runId, lastEventId],
  );
```
4. Below the `spotlight=` prop line, add:
```tsx
              scrubber={
                <ReplayScrubber
                  steps={shotSteps}
                  seq={replaySeq}
                  playing={playing}
                  onSeq={setReplaySeq}
                  onTogglePlay={() => setPlaying((p) => !p)}
                />
              }
```
5. Replace the `</section>` line with:
```tsx
            <BudgetMeters usage={view.usage} budget={view.budget} />
          </section>
          <TimelinePanel
            runId={runId}
            items={items}
            summary={summaryLabel(view)}
            thinking={thinkingState(view)}
            otpHost={view.status === "waiting" && view.waitReason === "otp" ? (hostAndPath(view.currentUrl)?.host ?? "The site") : null}
            otpKey={String(view.steps.at(-1)?.seq ?? 0)}
            replaySeq={replaySeq}
            onReplay={(seq) => {
              setPlaying(false);
              setReplaySeq(seq);
            }}
            canMessage={!isTerminal(view.status)}
            onSend={send}
          />
```
6. In `onJumpLive={() => setReplaySeq(null)}`, change the handler to `() => { setPlaying(false); setReplaySeq(null); }`.

In `apps/web/e2e/approval.spec.ts`, change `test.fixme("letters typed in the composer…` back to `test(`.

- [ ] **Step 5: Run the specs and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web e2e -- timeline.spec.ts code-slots.spec.ts approval.spec.ts && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/components/run apps/web/e2e/timeline.spec.ts apps/web/e2e/code-slots.spec.ts apps/web/e2e/approval.spec.ts
git commit -m "feat(web): timeline with StatusMark/ThoughtLine, CodeSlots OTP card, CountUp budgets, composer and replay"
```

---

## Task 16: Stop, the callouts toggle and responsive layouts (1440 → 390)

**Files:**
- Create: `apps/web/components/run/callout-preference.ts`, `apps/web/components/run/stop-dialog.tsx`, `apps/web/e2e/layout.spec.ts`
- Modify: `apps/web/components/run/run-view.tsx`, `apps/web/components/run/run-view.module.css`

**Interfaces:**
- Produces:
  - `useCalloutsPreference(): [boolean, (on: boolean) => void]`, stored in `localStorage["mt.callouts"]` with try/catch, as a per-viewer convenience;
  - `StopDialog({ open, onClose, onStop })`, a native `<dialog role="alertdialog">` whose default focus is "Keep Running".

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/layout.spec.ts`:
```ts
import { recordedEvents } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { emit, frame, gotoRun } from "./support/run-mocks.ts";

const steps = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Steps" });

test("1440: timeline beside the browser; callout and leader stay inside the frame (D22)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoRun(page);
  await emit(page, [recordedEvents()[0]!]);
  const f = (await frame(page).boundingBox())!;
  const s = (await steps(page).boundingBox())!;
  expect(s.x).toBeGreaterThanOrEqual(f.x + f.width);
  const callout = page.getByTestId("step-callout");
  await expect(callout.locator("div").first()).toBeVisible();
  const c = (await callout.boundingBox())!;
  expect(c.x + c.width).toBeLessThanOrEqual(f.x + f.width + 0.5);
  await page.getByRole("button", { name: "Callouts" }).click();
  await expect(callout).toHaveCount(0);
});

test("1024: stacked, callouts become gutter badges", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await gotoRun(page);
  await emit(page, [recordedEvents()[0]!]);
  const f = (await frame(page).boundingBox())!;
  const s = (await steps(page).boundingBox())!;
  expect(s.y).toBeGreaterThanOrEqual(f.y + f.height);
  await expect(page.getByTestId("gutter-badge")).toBeVisible();
});

test("390: path trimmed, approval is a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoRun(page);
  await emit(page, recordedEvents());
  const sheet = (await page.getByRole("alertdialog").boundingBox())!;
  expect(Math.round(sheet.y + sheet.height)).toBeGreaterThanOrEqual(843);
  await expect(page.getByTestId("origin-pill").locator("span").nth(1)).toBeHidden();
});

test("Stop asks first, defaults to Keep Running, then cancels", async ({ page }) => {
  const calls = await gotoRun(page);
  await page.getByRole("button", { name: "Stop" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Stop this run?" });
  await expect(dialog.getByRole("button", { name: "Keep Running" })).toBeFocused();
  await dialog.getByRole("button", { name: "Stop Run" }).click();
  await expect.poll(() => calls.filter((c) => c.path === "runs/cancel").length).toBe(1);
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm --filter @mastertutor/web e2e -- layout.spec.ts`

Expected: FAIL, because there are no Callouts or Stop buttons.

- [ ] **Step 3: Implement.**

`apps/web/components/run/callout-preference.ts`:
```ts
"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "mt.callouts";

/** Per-viewer convenience only; storage can be blocked, so default to on. */
export function useCalloutsPreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      setOn(localStorage.getItem(KEY) !== "off");
    } catch {
      // Storage blocked: keep the default.
    }
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // Not persisted; the in-memory choice still applies.
    }
  }, []);
  return [on, set];
}
```

`apps/web/components/run/stop-dialog.tsx`:
```tsx
"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "../ui/button.tsx";
import styles from "./run-view.module.css";

export function StopDialog({ open, onClose, onStop }: { open: boolean; onClose(): void; onStop(): void }) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={styles.dialog} role="alertdialog" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onClose={onClose}>
      <h2 id={`${id}-t`} className={styles.dialogTitle}>Stop this run?</h2>
      <p id={`${id}-d`} className={styles.dialogText}>The agent stops now. Everything it captured stays in the draft note.</p>
      <div className={styles.dialogActions}>
        <Button variant="secondary" autoFocus onClick={onClose}>Keep Running</Button>
        <Button variant="destructive" onClick={onStop}>Stop Run</Button>
      </div>
    </dialog>
  );
}
```

Append to `run-view.module.css`:
```css
.dialog { inline-size: min(24rem, calc(100% - 2rem)); padding: 1.25rem; border: 0; border-radius: var(--radius-lg); background: var(--color-elevated); color: var(--color-label); box-shadow: var(--shadow-e3); }
.dialog::backdrop { background: var(--color-scrim); }
.dialogTitle { margin: 0 0 .4rem; font: 600 1.0625rem/1.3 var(--font-sans); }
.dialogText { margin: 0; font-size: .875rem; line-height: 1.45; color: var(--color-label-2); }
.dialogActions { display: flex; justify-content: flex-end; gap: .5rem; margin-block-start: 1.25rem; }
```

Edits to `run-view.tsx`:
1. Add these imports:
```tsx
import { useCalloutsPreference } from "./callout-preference.ts";
import { StopDialog } from "./stop-dialog.tsx";
```
2. After the `playing` state, add:
```tsx
  const [callouts, setCallouts] = useCalloutsPreference();
  const [stopOpen, setStopOpen] = useState(false);
  const stop = useCallback(() => {
    setStopOpen(false);
    api()
      .runs.cancel({ runId })
      .catch(() => toast({ message: "Couldn't stop the run. Try again." }));
  }, [runId]);
```
3. Replace `{/* toolbar-extra */}` with:
```tsx
        <Button variant="ghost" className={styles.calloutToggle} aria-pressed={callouts} onClick={() => setCallouts(!callouts)}>
          Callouts
        </Button>
```
4. After the take-over/hand-back ternary (before `</Toolbar>`), add:
```tsx
        <Button variant="ghost" onClick={() => setStopOpen(true)} disabled={isTerminal(view.status)}>
          <Icon name="stop" />
          Stop
        </Button>
```
5. Replace the line `              showCallouts` with `              showCallouts={callouts}`.
6. Before the final `</>`, add `<StopDialog open={stopOpen} onClose={() => setStopOpen(false)} onStop={stop} />`.

- [ ] **Step 4: Run the spec and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web e2e -- layout.spec.ts && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/components/run apps/web/e2e/layout.spec.ts
git commit -m "feat(web): Stop confirmation, callouts toggle and responsive run layouts with D22 leader clipping"
```

---

## Task 17: PiP mini browser

**Files:**
- Create: `apps/web/components/run/pip/{watching.ts,run-pip.tsx,pip-dock.tsx,pip.module.css}`, `apps/web/e2e/pip.spec.ts`
- Modify: `apps/web/components/run/run-view.tsx`, `apps/web/app/(app)/layout.tsx`

**Interfaces:**
- Produces:
  - `rememberWatchedRun(id)`, `forgetWatchedRun(id)` and `watchedRun()` (sessionStorage `mt.watchedRun`, wrapped in try/catch);
  - `RunPip({ runId, onGone })`;
  - `PipDock()`. It shows the watched, non-terminal run on every `(app)` route except that run's own page and `/new`. It is hidden at ≤820px.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/pip.spec.ts`:
```ts
import { OTHER_RUN_ID, fixtureDetail, rec } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { emit, gotoRun } from "./support/run-mocks.ts";

test("follows the watched run elsewhere, expands into the stream, and leaves when it finishes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const other = fixtureDetail({ id: OTHER_RUN_ID, status: "completed", slotName: null, goal: "Old run" });
  await gotoRun(page, { extraRuns: [other] });
  await page.goto(`/runs/${OTHER_RUN_ID}`);
  const expand = page.getByRole("button", { name: "Live run, learn.example.edu. Expand mini browser" });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(page.getByRole("link", { name: "Open run" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Mini browser" }).locator("iframe")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(expand).toBeVisible();
  await emit(page, [rec({ type: "status", status: "completed", waitReason: null, reason: null })]);
  await expect(page.getByRole("complementary", { name: "Mini browser" })).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm --filter @mastertutor/web e2e -- pip.spec.ts`

Expected: FAIL, because the expand button is not found.

- [ ] **Step 3: Implement.**

`apps/web/components/run/pip/watching.ts`:
```ts
const KEY = "mt.watchedRun";

export function rememberWatchedRun(runId: string): void {
  try {
    sessionStorage.setItem(KEY, runId);
  } catch {
    // Storage blocked: no PiP this session.
  }
}

export function forgetWatchedRun(runId: string): void {
  try {
    if (sessionStorage.getItem(KEY) === runId) sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

export function watchedRun(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
```

`apps/web/components/run/pip/run-pip.tsx`:
```tsx
"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { springSoft } from "../../../lib/motion-tokens.ts";
import { Icon } from "../../ui/icon.tsx";
import { LiveFrame } from "../browser/live-frame.tsx";
import { deriveBrowserState } from "../model/browser-state.ts";
import { STATE_PILL, captionFor, hostAndPath } from "../model/copy.ts";
import { isTerminal, latestScreenshotSeq } from "../model/run-model.ts";
import { IDLE_TAKEOVER } from "../model/takeover.ts";
import { useRun } from "../stream/use-run.ts";
import styles from "./pip.module.css";

/** 15rem of a 35rem stage: the mock's compact scale. */
const SMALL_SCALE = 0.4286;
const noop = () => undefined;

export function RunPip({ runId, onGone }: { runId: string; onGone(): void }) {
  const { model, connection, loadError } = useRun(runId);
  const [big, setBig] = useState(false);
  const reduce = useReducedMotion();
  const ended = loadError || (model !== null && isTerminal(model.status));

  useEffect(() => {
    if (ended) onGone();
  }, [ended, onGone]);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBig(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [big]);

  if (!model || ended) return null;
  const state = deriveBrowserState(model, { connection, takeover: IDLE_TAKEOVER, replaying: false, liveRetrying: false });
  const host = hostAndPath(model.currentUrl)?.host ?? "new tab";
  const shot = latestScreenshotSeq(model);
  return (
    <aside className={styles.pip} aria-label="Mini browser">
      <m.div
        className={styles.screen}
        initial={false}
        animate={{ scale: big ? 1 : SMALL_SCALE }}
        transition={reduce ? { type: false } : springSoft}
      >
        {shot !== null ? <img className={styles.shot} src={stepScreenshotPath(runId, shot)} alt="" /> : null}
        {big ? <LiveFrame runId={runId} slotName={model.slotName} title={`Remote browser, ${host}`} interactive={false} onRetrying={noop} /> : null}
        {big ? (
          <div className={styles.bigbar}>
            <span className={styles.bigText}>{captionFor(state, model, IDLE_TAKEOVER, null)}</span>
            <Link className={styles.open} href={`/runs/${runId}`}>Open run</Link>
            <button type="button" className={styles.shrink} aria-label="Shrink mini browser" onClick={() => setBig(false)}>
              <Icon name="minimize" />
            </button>
          </div>
        ) : (
          <button type="button" className={styles.expand} aria-label={`Live run, ${host}. Expand mini browser`} onClick={() => setBig(true)} />
        )}
      </m.div>
      <div className={styles.caption} data-hidden={big || undefined}>
        <i data-tone={STATE_PILL[state].tone} aria-hidden="true" />
        <span>{captionFor(state, model, IDLE_TAKEOVER, null)}</span>
      </div>
    </aside>
  );
}
```

`apps/web/components/run/pip/pip-dock.tsx`:
```tsx
"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RunPip } from "./run-pip.tsx";
import { forgetWatchedRun, watchedRun } from "./watching.ts";

export function PipDock() {
  const pathname = usePathname();
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    setRunId(watchedRun());
  }, [pathname]);
  const gone = useCallback(() => {
    if (runId) forgetWatchedRun(runId);
    setRunId(null);
  }, [runId]);
  if (!runId || pathname === `/runs/${runId}` || pathname === "/new") return null;
  return <RunPip key={runId} runId={runId} onGone={gone} />;
}
```

`apps/web/components/run/pip/pip.module.css`:
```css
.pip { position: fixed; inset-inline-end: 1.25rem; inset-block-end: 4.5rem; z-index: 60; pointer-events: none; }
.pip > * { pointer-events: auto; }
.screen { position: relative; inline-size: 35rem; aspect-ratio: 16 / 10; overflow: hidden; border-radius: var(--radius-frame); background: var(--color-bg-2); box-shadow: var(--shadow-e3); transform-origin: 100% 100%; }
.shot { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; object-fit: contain; }
.expand { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; border: 0; background: transparent; cursor: pointer; }
.expand:focus-visible { outline: .3rem solid var(--color-tint); outline-offset: -.5rem; }
.bigbar { position: absolute; inset: auto 0 0; z-index: 2; display: flex; align-items: center; gap: .6rem; padding: .6rem .75rem; background: var(--color-glass); backdrop-filter: var(--backdrop-glass); font-size: .8125rem; }
.bigText { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.open { display: inline-grid; place-items: center; min-block-size: 2rem; padding: 0 .9rem; border-radius: var(--radius-pill); background: var(--color-tint); color: var(--color-on-tint); text-decoration: none; font-weight: 500; }
.shrink { display: grid; place-items: center; inline-size: 2rem; block-size: 2rem; border: 0; border-radius: 50%; background: var(--color-fill); color: var(--color-label); }
.caption { position: absolute; inset-inline-end: 0; inset-block-end: -3.25rem; display: flex; align-items: center; gap: .5rem; inline-size: 15rem; padding: .5rem .75rem; border-radius: var(--radius-md); background: var(--color-glass); backdrop-filter: var(--backdrop-glass); box-shadow: var(--shadow-e2); font-size: .75rem; transition: opacity var(--dur-base) var(--ease-out); }
.caption span { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.caption i { flex: none; inline-size: .45rem; block-size: .45rem; border-radius: 50%; background: var(--color-signal); }
.caption i[data-tone="tint"] { background: var(--color-tint); }
.caption i[data-tone="muted"] { background: var(--color-label-3); }
.caption[data-hidden] { opacity: 0; pointer-events: none; }
@media (max-width: 51.25rem) { .pip { display: none; } }
```

Edit `run-view.tsx`:
1. Add the import `import { forgetWatchedRun, rememberWatchedRun } from "./pip/watching.ts";`.
2. After the `controller` effect, add:
```tsx
  const status = model?.status ?? null;
  useEffect(() => {
    if (status === null) return;
    if (isTerminal(status)) forgetWatchedRun(runId);
    else rememberWatchedRun(runId);
  }, [runId, status]);
```

Edit F1's `apps/web/app/(app)/layout.tsx`. Add `import { PipDock } from "../../components/run/pip/pip-dock.tsx";`, then render `<PipDock />` as the last child of the shell's main content element.

- [ ] **Step 4: Run the spec and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web e2e -- pip.spec.ts && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/components/run "apps/web/app/(app)/layout.tsx" apps/web/e2e/pip.spec.ts
git commit -m "feat(web): PiP mini browser following the watched run, expanding into the live stream"
```

---

## Task 18: F3 QA matrix (5 breakpoints × light/dark, overflow and axe)

**Files:**
- Create: `apps/web/e2e/run-qa.spec.ts`

**Interfaces:**
- Consumes: `BREAKPOINTS`, `expectNoOverflow` and `expectNoSeriousAxe` (F1), plus the run mocks.

- [ ] **Step 1: Write the spec.**

`apps/web/e2e/run-qa.spec.ts`:
```ts
import type { RunEventRecord } from "@mastertutor/contracts";
import { fixtureDetail, rec, recordedEvents } from "./fixtures/run-fixture.ts";
import { expect, test } from "./support/fixtures.ts";
import { BREAKPOINTS, expectNoOverflow, expectNoSeriousAxe } from "./support/qa.ts";
import { emit, frame, gotoRun, mockRpc, newTaskHandlers } from "./support/run-mocks.ts";

const SCENARIOS: { name: string; detail?: Parameters<typeof fixtureDetail>[0]; events?: () => RunEventRecord[]; state: string }[] = [
  { name: "live", state: "live" },
  { name: "approval", events: recordedEvents, state: "approval" },
  { name: "control", detail: { controller: "user", status: "waiting", waitReason: "takeover" }, state: "control" },
  { name: "paused", detail: { status: "sleeping", slotName: null }, state: "paused" },
  { name: "otp", events: () => [rec({ type: "status", status: "waiting", waitReason: "otp", reason: null })], state: "live" },
];

for (const width of BREAKPOINTS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${width}px ${scheme}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: width <= 420 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: scheme });
      });

      test("new task", async ({ page }) => {
        await mockRpc(page, newTaskHandlers());
        await page.goto("/new");
        await expect(page.getByRole("heading", { name: /Take notes on/ })).toBeVisible();
        await expectNoOverflow(page);
        await expectNoSeriousAxe(page);
      });

      for (const s of SCENARIOS) {
        test(`run ${s.name}`, async ({ page }) => {
          await gotoRun(page, s.detail ? { detail: fixtureDetail(s.detail) } : {});
          if (s.events) await emit(page, s.events());
          await expect(frame(page)).toHaveAttribute("data-state", s.state);
          await expectNoOverflow(page);
          await expectNoSeriousAxe(page);
        });
      }
    });
  }
}
```

- [ ] **Step 2: Run the matrix and fix every finding.**

Run: `pnpm --filter @mastertutor/web e2e -- run-qa.spec.ts`

Expected: all 60 tests PASS. If a test fails, fix the CSS or markup in the owning component; do not loosen the check. Typical fixes:
- add `min-inline-size: 0` and ellipsis where text overflows;
- raise contrast with `--color-label-2`;
- add a missing label.

- [ ] **Step 3: Run the whole F3 suite and the checks.**

Run: `pnpm test && pnpm --filter @mastertutor/web e2e && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css && pnpm format:check`

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/web
git commit -m "test(web): F3 QA matrix across 5 breakpoints in light and dark with overflow and axe"
```

---

## Task 19 (F5): Hero gate, `Hero3D` loader and the `three` dependency

**Files:**
- Create: `apps/web/components/hero/hero-gate.ts` (+ `hero-gate.test.ts`), `apps/web/components/hero/hero-3d.tsx`, `apps/web/e2e/hero.spec.ts`
- Modify:
  - `apps/web/components/hero/hero.module.css` (canvas, live and blink rules)
  - `apps/web/components/new-task/new-task-form.tsx` (`HeroPoster` becomes `Hero3D`)
  - `apps/web/lib/motion-tokens.ts` (F5 tokens)
  - `apps/web/package.json`

**Interfaces:**
- Produces:
  - `shouldLoad3D({ reducedMotion, hasWebGL2, forcePoster }): boolean`;
  - `Hero3D()`, which renders `[data-hero]`, gains `data-live` when the 3D scene is revealed, and gains `data-blink` on `hero:start` while the poster is showing;
  - **motion tokens:** `durationMs.heroReveal: 700`, `easing.standard: [0.4, 0, 0.2, 1]` and `heroSprings = { parallax: {stiffness:60, damping:13}, attention: {stiffness:170, damping:22} }`;
  - **dependencies:** `three` 0.170.0 and `@types/three` 0.170.0 (dev).

- [ ] **Step 1: Write the failing tests.**

`apps/web/components/hero/hero-gate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { shouldLoad3D } from "./hero-gate.ts";

describe("shouldLoad3D", () => {
  it("loads only with WebGL2, motion allowed and no poster override", () => {
    expect(shouldLoad3D({ reducedMotion: false, hasWebGL2: true, forcePoster: false })).toBe(true);
    expect(shouldLoad3D({ reducedMotion: true, hasWebGL2: true, forcePoster: false })).toBe(false);
    expect(shouldLoad3D({ reducedMotion: false, hasWebGL2: false, forcePoster: false })).toBe(false);
    expect(shouldLoad3D({ reducedMotion: false, hasWebGL2: true, forcePoster: true })).toBe(false);
  });
});
```

`apps/web/e2e/hero.spec.ts`:
```ts
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures.ts";
import { mockRpc, newTaskHandlers } from "./support/run-mocks.ts";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

function threeLoads(page: Page): string[] {
  const hits: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    const body = await response.text().catch(() => "");
    if (body.includes("isWebGLRenderer")) hits.push(response.url());
  });
  return hits;
}

test("reduced motion keeps the poster and never downloads three", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const hits = threeLoads(page);
  await mockRpc(page, newTaskHandlers());
  await page.goto("/new");
  await page.waitForTimeout(2_500);
  await expect(page.locator("[data-hero]")).not.toHaveAttribute("data-live", "");
  expect(hits).toEqual([]);
});

test("?hero=poster forces the poster", async ({ page }) => {
  const hits = threeLoads(page);
  await mockRpc(page, newTaskHandlers());
  await page.goto("/new?hero=poster");
  await page.waitForTimeout(2_500);
  expect(hits).toEqual([]);
});

test("loads three lazily and crossfades to the live scene", async ({ page }) => {
  const hits = threeLoads(page);
  await mockRpc(page, newTaskHandlers());
  await page.goto("/new?debug");
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
  expect(hits.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/components/hero && pnpm --filter @mastertutor/web e2e -- hero.spec.ts`

Expected: FAIL. The gate module is missing, and the third e2e test never sees `data-live`. The first two e2e tests already pass, which is correct: the poster is static.

- [ ] **Step 3: Implement the gate, tokens and loader.**

Run: `pnpm --filter @mastertutor/web add --save-exact three@0.170.0 && pnpm --filter @mastertutor/web add -D --save-exact @types/three@0.170.0`

In `apps/web/lib/motion-tokens.ts`:
- add `heroReveal: 700, // poster → 3D crossfade (run 16)` to `durationMs`;
- add `standard: [0.4, 0, 0.2, 1],` to `easing`;
- add this export:
```ts
/** 3D hero springs (run 16): calm parallax and a lean toward the composer. */
export const heroSprings = {
  parallax: { stiffness: 60, damping: 13 },
  attention: { stiffness: 170, damping: 22 },
} as const;
```
Then run `pnpm --filter @mastertutor/web gen:motion`. Add `"--dur-hero-reveal"` and `"--ease-standard"` to `MOTION_VARS` in `apps/web/test/f1-contract.test.ts`.

`apps/web/components/hero/hero-gate.ts`:
```ts
export interface HeroEnvironment {
  reducedMotion: boolean;
  hasWebGL2: boolean;
  /** `?hero=poster` (QA switch from run 16). */
  forcePoster: boolean;
}

/** Under reduced motion or without WebGL2, three is never downloaded (spec §11.2). */
export function shouldLoad3D(env: HeroEnvironment): boolean {
  return env.hasWebGL2 && !env.reducedMotion && !env.forcePoster;
}
```

`apps/web/components/hero/hero-3d.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";
import { durationMs } from "../../lib/motion-tokens.ts";
import { HERO_EVENTS } from "./hero-events.ts";
import { shouldLoad3D } from "./hero-gate.ts";
import { PosterArt } from "./hero-poster.tsx";
import styles from "./hero.module.css";

interface HeroInstance {
  destroy(): void;
}

const idle = (fn: () => void) =>
  "requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 800 }) : window.setTimeout(fn, 1);

/** CSS poster first; the 3D scene is imported only near the viewport, when idle (spec §11.2). */
export function Hero3D() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const params = new URLSearchParams(window.location.search);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let instance: HeroInstance | null = null;
    let loading = false;
    let disposed = false;

    const load = () => {
      const env = { reducedMotion: reduce.matches, hasWebGL2: "WebGL2RenderingContext" in window, forcePoster: params.get("hero") === "poster" };
      if (loading || instance || !shouldLoad3D(env)) return;
      loading = true;
      import("./hero-3d-scene.ts")
        .then((scene) => scene.createHero(el, { debug: params.has("debug") }))
        .then((created) => {
          loading = false;
          if (disposed) created?.destroy();
          else instance = created;
        })
        .catch(() => {
          loading = false; // The poster stays; a failed scene is never fatal.
        });
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        idle(load);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);

    const onReduce = () => {
      if (reduce.matches) {
        instance?.destroy();
        instance = null;
      } else load();
    };
    reduce.addEventListener("change", onReduce);

    let blink: ReturnType<typeof setTimeout> | undefined;
    const onStart = () => {
      if (el.dataset.live !== undefined) return;
      el.dataset.blink = "";
      clearTimeout(blink);
      blink = setTimeout(() => delete el.dataset.blink, durationMs.panel);
    };
    window.addEventListener(HERO_EVENTS.start, onStart);

    return () => {
      disposed = true;
      io.disconnect();
      reduce.removeEventListener("change", onReduce);
      window.removeEventListener(HERO_EVENTS.start, onStart);
      clearTimeout(blink);
      instance?.destroy();
    };
  }, []);

  return (
    <div ref={ref} className={styles.hero} data-hero="" aria-hidden="true">
      <PosterArt />
      <canvas className={styles.canvas} />
    </div>
  );
}
```

Append to `hero.module.css`:
```css
.poster { transition: opacity var(--dur-hero-reveal) var(--ease-out); }
.canvas { position: absolute; inset: 0; display: block; inline-size: 100%; block-size: 100%; opacity: 0; transition: opacity var(--dur-hero-reveal) var(--ease-out); }
.hero[data-live] .canvas { opacity: 1; }
.hero[data-live] .poster { opacity: 0; }
.hero[data-blink] .dot { opacity: .35; }
.hud { position: absolute; inset-block-start: .5rem; inset-inline-end: .5rem; padding: .3rem .5rem; border-radius: .375rem; background: var(--color-elevated); box-shadow: var(--shadow-e2); color: var(--color-label-2); font: 500 .6875rem/1.4 var(--font-mono); white-space: pre; }
```

In `new-task-form.tsx`:
- replace `import { HeroPoster } from "../hero/hero-poster.tsx";` with `import { Hero3D } from "../hero/hero-3d.tsx";`;
- replace `<HeroPoster />` with `<Hero3D />`.

Create a temporary `apps/web/components/hero/hero-3d-scene.ts` so the dynamic import resolves. Task 21 replaces it:
```ts
export interface HeroOptions {
  debug?: boolean;
}
export async function createHero(_el: HTMLElement, _options: HeroOptions = {}): Promise<{ destroy(): void } | null> {
  return null;
}
```

- [ ] **Step 4: Run the tests to verify progress.**

Run: `pnpm test -- apps/web/components/hero apps/web/test && pnpm --filter @mastertutor/web e2e -- hero.spec.ts new-task.spec.ts`

Expected:
- The unit tests and the first two e2e tests PASS.
- "loads three lazily" still FAILS. Task 21 makes it pass.
- `new-task.spec.ts` still passes, because the hero is not live.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): Hero3D gated loader (reduced motion, WebGL2, near-viewport idle) and hero tokens"
```

---

## Task 20 (F5): Pure scene modules (springs, capture timeline, lens profile, studio tones)

**Files:**
- Create in `apps/web/components/hero/scene/`:
  - `motion.ts` (+ `motion.test.ts`)
  - `capture-timeline.ts` (+ `capture-timeline.test.ts`)
  - `lens-profile.ts` (+ `lens-profile.test.ts`)
  - `studio.ts` (+ `studio.test.ts`)

**Interfaces:**
- Produces:
  - **`motion.ts`:** `Spring`, `createSpring(x, {stiffness, damping})`, `stepSpring(s, dt)`, `stepSprings(list, dt)` (fixed 1/240s substeps) and `smoothstep(a, b, x)`;
  - **`capture-timeline.ts`:**
    - `CueKey`, `captureCues(lineCount)` and `dueCues(cues, t, fired)`;
    - `CAPTURE_END_S = 2.4`, `LINE_STAGGER_S = 0.035`, `PAGE_FLOW = {start: 0.14, length: 0.64}` and `RIPPLE_S = 0.75`;
  - **`lens-profile.ts`:** `LensDims`, `LENS` and `lensProfile(dims?)`;
  - **`studio.ts`:** `isDarkColor(css)`, `studioTones(dark)`, `readSceneTokens()` and `buildStudio(renderer, bgCss)`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/components/hero/scene/motion.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { spring } from "../../../lib/motion-tokens.ts";
import { createSpring, smoothstep, stepSprings } from "./motion.ts";

describe("hero springs", () => {
  it("settles the D21 spring in ~450ms with ~3% overshoot", () => {
    const s = createSpring(0, spring);
    s.target = 1;
    let peak = 0;
    for (let t = 0; t < 0.6; t += 1 / 60) {
      stepSprings([s], 1 / 60);
      peak = Math.max(peak, s.x);
    }
    expect(Math.abs(s.x - 1)).toBeLessThan(0.01);
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.05);
  });

  it("stays stable on a long 1/20s frame", () => {
    const s = createSpring(0, spring);
    s.target = 1;
    stepSprings([s], 1 / 20);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeLessThan(1.2);
  });

  it("smoothsteps", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
});
```

`apps/web/components/hero/scene/capture-timeline.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CAPTURE_END_S, LINE_STAGGER_S, captureCues, dueCues } from "./capture-timeline.ts";

describe("capture timeline", () => {
  it("fires inhale → shower → gulp → note → lines at 35ms → page, inside 2.4s", () => {
    const cues = captureCues(8);
    expect(cues.slice(0, 4).map((c) => c.key)).toEqual(["inhale", "shower", "gulp", "note"]);
    const lines = cues.filter((c) => c.key.startsWith("line"));
    expect(lines).toHaveLength(8);
    expect(lines[1]!.at - lines[0]!.at).toBeCloseTo(LINE_STAGGER_S, 6);
    expect(Math.max(...cues.map((c) => c.at))).toBeLessThan(CAPTURE_END_S);
  });

  it("fires each cue once as time passes", () => {
    const cues = captureCues(2);
    const fired = new Set<string>();
    expect(dueCues(cues, 0, fired)).toEqual(["inhale"]);
    expect(dueCues(cues, 0.8, fired)).toEqual(["shower", "gulp"]);
    expect(dueCues(cues, 0.8, fired)).toEqual([]);
    expect(dueCues(cues, 2, fired)).toEqual(["note", "line0", "line1", "page"]);
  });
});
```

`apps/web/components/hero/scene/lens-profile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { LENS, lensProfile } from "./lens-profile.ts";

describe("lens profile", () => {
  it("runs axis-bottom → rounded rim → domed top-axis", () => {
    const pts = lensProfile();
    expect(pts).toHaveLength(37);
    expect(pts[0]).toEqual([0.001, -LENS.halfHeight]);
    expect(Math.max(...pts.map(([x]) => x))).toBeCloseTo(LENS.radius, 6);
    const [x, y] = pts.at(-1)!;
    expect(x).toBe(0.001);
    expect(y).toBeCloseTo(LENS.halfHeight + LENS.dome, 3);
  });
});
```

`apps/web/components/hero/scene/studio.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isDarkColor, studioTones } from "./studio.ts";

describe("studio tones", () => {
  it("detects the theme background and dims the room for dark mode", () => {
    expect(isDarkColor("rgb(250, 250, 250)")).toBe(false);
    expect(isDarkColor("#0B0B0C")).toBe(true);
    expect(studioTones(true).wall).toBeLessThan(studioTones(false).wall);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/components/hero/scene`

Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement.**

`apps/web/components/hero/scene/motion.ts`:
```ts
/** Damped spring with unit mass, ported from the run 16 prototype. Parameters come from motion-tokens. */
export interface Spring {
  x: number;
  v: number;
  target: number;
  stiffness: number;
  damping: number;
}

export function createSpring(x: number, p: { stiffness: number; damping: number }): Spring {
  return { x, v: 0, target: x, stiffness: p.stiffness, damping: p.damping };
}

export function stepSpring(s: Spring, dt: number): void {
  s.v += (-s.stiffness * (s.x - s.target) - s.damping * s.v) * dt;
  s.x += s.v * dt;
}

const SUBSTEP = 1 / 240;

/** Fixed substeps keep k=400 stable on long frames. */
export function stepSprings(springs: readonly Spring[], dt: number): void {
  const n = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / n;
  for (let i = 0; i < n; i++) for (const s of springs) stepSpring(s, h);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
```

`apps/web/components/hero/scene/capture-timeline.ts`:
```ts
/** The ~2.4s Start sequence (run 16): choreography offsets in seconds. */
export const CAPTURE_END_S = 2.4;
export const LINE_STAGGER_S = 0.035;
export const PAGE_FLOW = { start: 0.14, length: 0.64 } as const;
export const RIPPLE_S = 0.75;

export type CueKey = "inhale" | "shower" | "gulp" | "note" | "page" | `line${number}`;
export interface Cue {
  key: CueKey;
  at: number;
}

export function captureCues(lineCount: number): Cue[] {
  return [
    { key: "inhale", at: 0 },
    { key: "shower", at: 0.12 },
    { key: "gulp", at: 0.78 },
    { key: "note", at: 0.86 },
    ...Array.from({ length: lineCount }, (_, i) => ({ key: `line${i}` as CueKey, at: 0.98 + i * LINE_STAGGER_S })),
    { key: "page", at: 1.55 },
  ];
}

export function dueCues(cues: readonly Cue[], t: number, fired: Set<string>): CueKey[] {
  const due: CueKey[] = [];
  for (const cue of cues) {
    if (t >= cue.at && !fired.has(cue.key)) {
      fired.add(cue.key);
      due.push(cue.key);
    }
  }
  return due;
}
```

`apps/web/components/hero/scene/lens-profile.ts`:
```ts
export interface LensDims {
  radius: number;
  halfHeight: number;
  edge: number;
  dome: number;
}
export const LENS: LensDims = { radius: 1, halfHeight: 0.22, edge: 0.17, dome: 0.06 };

/** Lathe profile of the Capture Lens puck: flat base, rounded rim, slightly domed top. */
export function lensProfile({ radius: R, halfHeight: H, edge: E, dome: D }: LensDims = LENS): [number, number][] {
  const pts: [number, number][] = [[0.001, -H]];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * (Math.PI / 2);
    pts.push([R - E + E * Math.cos(a), -H + E + E * Math.sin(a)]);
  }
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    pts.push([R - E + E * Math.cos(a), H - E + E * Math.sin(a)]);
  }
  for (let i = 1; i <= 14; i++) {
    const x = (R - E) * (1 - i / 14);
    pts.push([Math.max(x, 0.001), H + D * (1 - (x / (R - E)) ** 2)]);
  }
  return pts;
}
```

`apps/web/components/hero/scene/studio.ts`:
```ts
import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  type Material,
  type Texture,
  type WebGLRenderer,
} from "three";

export function isDarkColor(css: string): boolean {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(css).getHSL(hsl);
  return hsl.l < 0.5;
}

export function studioTones(dark: boolean): { wall: number; floor: number } {
  return dark ? { wall: 0.16, floor: 0.04 } : { wall: 0.42, floor: 0.1 };
}

/** Theme colours the scene mirrors (the body background and the accent/signal tokens). */
export function readSceneTokens(): { bg: string; tint: string; signal: string; aqua: string; bondi: string } {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim();
  return {
    bg: getComputedStyle(document.body).backgroundColor,
    tint: v("--color-tint"),
    signal: v("--color-signal"),
    aqua: v("--color-hero-aqua-deep"),
    bondi: v("--color-hero-bondi"),
  };
}

/** Code-built studio environment (no HDR download), re-tinted for dark mode. */
export function buildStudio(renderer: WebGLRenderer, bgCss: string): Texture {
  const tones = studioTones(isDarkColor(bgCss));
  const grey = (v: number) => new Color(v, v, v);
  const room = new Scene();
  room.add(new Mesh(new BoxGeometry(12, 12, 12), new MeshBasicMaterial({ color: grey(tones.wall), side: BackSide })));
  const floor = new Mesh(new PlaneGeometry(12, 12), new MeshBasicMaterial({ color: grey(tones.floor) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -5.9;
  room.add(floor);
  const panel = (w: number, h: number, v: number, x: number, y: number, z: number, tint?: string) => {
    const color = tint ? new Color(tint).multiplyScalar(v) : grey(v);
    const mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color, side: DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel(9, 3, 7, 0, 5.8, 0.6);
  panel(1.4, 8, 5, -5.8, 0.6, 1.8);
  panel(1.4, 8, 2.6, 5.8, 0.6, 1.2);
  panel(6, 3, 2, 0, 0.4, 5.8);
  panel(4, 1.2, 4, 2.5, 2.6, -5.8, readSceneTokens().aqua);
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.035).texture;
  room.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as Material).dispose();
    }
  });
  pmrem.dispose();
  return texture;
}
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test -- apps/web/components/hero && pnpm typecheck && pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/components/hero/scene
git commit -m "feat(web): pure hero scene modules: D21 springs, capture timeline, lens profile, studio tones"
```

---

## Task 21 (F5): Port the Capture Lens scene to raw `three`

**Files:**
- Create: `apps/web/components/hero/scene/geometry.ts`, `apps/web/components/hero/scene/page-texture.ts`
- Modify (full replacement): `apps/web/components/hero/hero-3d-scene.ts`
- Modify: `apps/web/e2e/hero.spec.ts` (add reaction and pause tests)

**Interfaces:**
- Consumes: Task 20 modules, `spring`, `heroSprings`, `easing`, `cubicBezier`, `clamp01` and `HERO_EVENTS`.
- Produces:
  - `createHero(el, { debug? }): Promise<HeroInstance | null>`. The scene listens for `hero:type`, `hero:focus` and `hero:start` on `window`, and emits `hero:captured`.
  - It sets `el.dataset.live` after `compileAsync`.
  - It pauses offscreen, on a hidden tab and on context loss.
  - DPR is capped at 2 and steps down to 1.5, then 1.
  - Dark mode re-reads `--color-bg` on `prefers-color-scheme` changes and on `data-theme` mutations.
  - With `?debug`, it exposes `window.__heroStats` (`{frames, fps, dpr, captures}`).
  - Helpers: `slab`, `bar`, `lathe` and `pageTexture(maxAnisotropy)`.

- [ ] **Step 1: Add the failing e2e tests.**

Append to `apps/web/e2e/hero.spec.ts`:
```ts
test("hero:start plays the capture and emits hero:captured", async ({ page }) => {
  await mockRpc(page, newTaskHandlers());
  await page.goto("/new?debug");
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
  const captured = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        window.addEventListener("hero:captured", () => resolve(true), { once: true });
        window.dispatchEvent(new CustomEvent("hero:start"));
        setTimeout(() => resolve(false), 6_000);
      }),
  );
  expect(captured).toBe(true);
});

test("Start waits for the capture before opening the run", async ({ page }) => {
  await mockRpc(page, newTaskHandlers());
  await page.goto("/new");
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
  await page.getByLabel("Describe the task").fill("Capture example.com");
  await page.getByRole("button", { name: "Add domain" }).click();
  await page.getByLabel("Allowed domain").fill("example.com");
  await page.getByLabel("Allowed domain").press("Enter");
  const t0 = Date.now();
  await page.getByRole("button", { name: /^Start/ }).click();
  await page.waitForURL(/\/runs\//);
  expect(Date.now() - t0).toBeGreaterThan(1_500);
});

test("pauses rendering offscreen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await mockRpc(page, newTaskHandlers());
  await page.goto("/new?debug");
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => (window as unknown as { __heroStats: { frames: number } }).__heroStats.frames);
  await page.waitForTimeout(800);
  const b = await page.evaluate(() => (window as unknown as { __heroStats: { frames: number } }).__heroStats.frames);
  expect(b - a).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm --filter @mastertutor/web e2e -- hero.spec.ts`

Expected: the live and reaction tests FAIL, because the stub returns null.

- [ ] **Step 3: Implement the helpers.**

`apps/web/components/hero/scene/geometry.ts`:
```ts
import { ExtrudeGeometry, LatheGeometry, Shape, Vector2 } from "three";

/** Rounded-rectangle slab centred on z, with face-spanning UVs (prototype `slab`). */
export function slab(w: number, h: number, r: number, depth: number, bevel: number): ExtrudeGeometry {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  return g;
}

/** Left-anchored pill so scale.x grows it like a line being written. */
export function bar(w: number, h: number, depth = 0.012): ExtrudeGeometry {
  const g = slab(w, h, Math.min(h / 2, 0.05), depth, 0);
  g.translate(w / 2, 0, 0);
  return g;
}

export function lathe(points: readonly (readonly [number, number])[], segments = 128): LatheGeometry {
  return new LatheGeometry(points.map(([x, y]) => new Vector2(x, y)), segments);
}
```

`apps/web/components/hero/scene/page-texture.ts`:
```ts
import { CanvasTexture, SRGBColorSpace } from "three";

/**
 * Procedural "web page" (run 16): browser chrome, heading, sigmoid figure, captured region.
 * Hard-coded art colours are the page being captured, not UI tokens; the remote page is always light.
 */
export function pageTexture(maxAnisotropy: number, accent: { tint: string; signal: string; bondi: string; aqua: string }): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 640;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const rr = (x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fillStyle = fill;
    g.fill();
  };
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 512, 640);
  g.fillStyle = "#F2F2F5";
  g.fillRect(0, 0, 512, 54);
  for (const x of [26, 46, 66]) {
    g.beginPath();
    g.arc(x, 27, 6.5, 0, Math.PI * 2);
    g.fillStyle = "#D2D2D7";
    g.fill();
  }
  rr(150, 14, 230, 26, 13, "#ffffff");
  g.font = "600 14px -apple-system, Inter, Helvetica, sans-serif";
  g.fillStyle = "#1D1D1F";
  g.fillText("learn.example.edu", 196, 32);
  rr(36, 84, 70, 10, 5, accent.tint);
  g.font = "700 38px -apple-system, Inter, Helvetica, sans-serif";
  g.fillText("Logistic regression", 34, 140);
  [470, 400].forEach((w, i) => rr(36, 160 + i * 18, w * 0.9, 8, 4, "#C7C7CC"));
  const grd = g.createLinearGradient(36, 210, 476, 410);
  grd.addColorStop(0, "#E8F7F5");
  grd.addColorStop(1, accent.aqua);
  rr(36, 210, 440, 200, 14, grd);
  g.strokeStyle = accent.bondi;
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(60, 380);
  g.lineTo(456, 380);
  g.moveTo(256, 230);
  g.lineTo(256, 392);
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const x = 60 + i * 6.6;
    const s = 1 / (1 + Math.exp(-(i - 30) / 5));
    if (i === 0) g.moveTo(x, 372 - s * 128);
    else g.lineTo(x, 372 - s * 128);
  }
  g.stroke();
  g.globalAlpha = 0.09;
  rr(28, 432, 456, 62, 10, accent.signal);
  g.globalAlpha = 1;
  rr(28, 432, 5, 62, 2, accent.signal);
  [440, 410, 430].forEach((w, i) => rr(46, 446 + i * 16, w * 0.92, 7, 3.5, "#B8B8BE"));
  [440, 420, 445, 300].forEach((w, i) => rr(36, 520 + i * 22, w * 0.95, 8, 4, "#D2D2D7"));
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}
```

- [ ] **Step 4: Implement the scene (full port of `design/hero-3d-prototype.html`).**

`apps/web/components/hero/hero-3d-scene.ts`:
```ts
import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { clamp01, cubicBezier } from "../../lib/easing.ts";
import { easing, heroSprings, spring } from "../../lib/motion-tokens.ts";
import { HERO_EVENTS } from "./hero-events.ts";
import { CAPTURE_END_S, PAGE_FLOW, RIPPLE_S, captureCues, dueCues, type CueKey } from "./scene/capture-timeline.ts";
import { bar, lathe, slab } from "./scene/geometry.ts";
import { LENS, lensProfile } from "./scene/lens-profile.ts";
import { createSpring, smoothstep, stepSprings } from "./scene/motion.ts";
import { pageTexture } from "./scene/page-texture.ts";
import { buildStudio, readSceneTokens } from "./scene/studio.ts";

export interface HeroOptions {
  debug?: boolean;
}
export interface HeroInstance {
  destroy(): void;
}
export interface HeroStats {
  frames: number;
  fps: number;
  dpr: number;
  captures: number;
}
declare global {
  interface Window {
    __heroStats?: HeroStats;
  }
}

const MAX_DPR = 2;
const SLOW_FRAME_MS = 24;
const FRAGMENTS = 14;
const ease = { flow: cubicBezier(easing.standard), arc: cubicBezier(easing.cursor) };

export async function createHero(el: HTMLElement, options: HeroOptions = {}): Promise<HeroInstance | null> {
  const canvas = el.querySelector("canvas");
  if (!canvas) return null;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.toneMapping = NeutralToneMapping;
  let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  renderer.setPixelRatio(dpr);

  const bin: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(item: T): T => {
    bin.push(item);
    return item;
  };
  const std = (p: ConstructorParameters<typeof MeshStandardMaterial>[0]) => keep(new MeshStandardMaterial(p));
  const tokens = readSceneTokens();

  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 1, 0.1, 60);
  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(-3, 5, 6);
  scene.add(key);

  // Page (the web source)
  const paper = std({ color: 0xffffff, roughness: 0.62 });
  const pageMap = keep(pageTexture(renderer.capabilities.getMaxAnisotropy(), tokens));
  const page = new Mesh(keep(slab(2.0, 2.5, 0.09, 0.03, 0.012)), [std({ map: pageMap, roughness: 0.6 }), paper]);

  // Capture Lens: frosted aqua puck with a Bondi band and signal dot inside
  const glass = keep(
    new MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.17, transmission: 1, thickness: 1.1, ior: 1.46, dispersion: 0.25,
      attenuationColor: new Color(tokens.aqua), attenuationDistance: 1.15, clearcoat: 1, clearcoatRoughness: 0.03,
      specularIntensity: 1, envMapIntensity: 1.25,
    }),
  );
  const shell = new Mesh(keep(lathe(lensProfile())), glass);
  const band = new Mesh(keep(new TorusGeometry(0.73, 0.1, 24, 96)), keep(new MeshPhysicalMaterial({ color: tokens.bondi, roughness: 0.28, clearcoat: 0.8 })));
  band.rotation.x = Math.PI / 2;
  band.scale.z = 1.25;
  const dotMat = std({ color: tokens.signal, emissive: tokens.signal, emissiveIntensity: 0.3, roughness: 0.35 });
  const dot = new Mesh(keep(new CylinderGeometry(0.13, 0.13, 0.05, 48)), dotMat);
  dot.position.y = LENS.halfHeight - 0.06;
  const ringMat = keep(new MeshBasicMaterial({ color: tokens.bondi, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
  const ring = new Mesh(keep(new RingGeometry(0.93, 1.0, 96)), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = LENS.halfHeight + LENS.dome + 0.01;
  const body = new Group();
  body.add(shell, band, dot, ring);
  const puck = new Group();
  puck.add(body);

  // Note card with lines that spring in one by one
  const note = new Group();
  note.add(new Mesh(keep(slab(1.35, 1.7, 0.08, 0.03, 0.012)), keep(new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, clearcoat: 0.4 }))));
  const ink = std({ color: 0x1d1d1f, roughness: 0.5 });
  const grey = std({ color: 0xd2d2d7, roughness: 0.6 });
  const blue = std({ color: tokens.tint, roughness: 0.5 });
  const aqua = std({ color: tokens.aqua, roughness: 0.45 });
  const lineSpec: [number, number, number, number, MeshStandardMaterial][] = [
    [0.28, 0.05, -0.55, 0.68, blue], [0.95, 0.09, -0.55, 0.53, ink], [0.6, 0.09, -0.55, 0.39, ink],
    [1.1, 0.42, -0.55, 0.05, aqua], [1.1, 0.045, -0.55, -0.34, grey], [1.04, 0.045, -0.55, -0.44, grey],
    [1.1, 0.045, -0.55, -0.54, grey], [0.68, 0.045, -0.55, -0.64, grey],
  ];
  const lines = lineSpec.map(([w, h, x, y, m]) => {
    const l = new Mesh(keep(bar(w, h)), m);
    l.position.set(x, y, 0.03);
    note.add(l);
    return l;
  });

  // Fragments pulled from the page into the lens
  const fragGeo = keep(slab(0.34, 0.15, 0.04, 0.02, 0.008));
  const fragMats = [paper, aqua, std({ color: 0xf3d6d1, roughness: 0.6 })];
  const frags = Array.from({ length: FRAGMENTS }, (_, i) => ({
    mesh: new Mesh(fragGeo, fragMats[i % 3]),
    active: false, t: 0, dur: 0.6, p0: new Vector3(), p1: new Vector3(), r0: new Vector3(),
  }));

  // Contact shadow
  const sc = document.createElement("canvas");
  sc.width = sc.height = 128;
  const sg = sc.getContext("2d");
  if (sg) {
    const r = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(18,60,66,.55)");
    r.addColorStop(1, "rgba(18,60,66,0)");
    sg.fillStyle = r;
    sg.fillRect(0, 0, 128, 128);
  }
  const shadowMat = keep(new MeshBasicMaterial({ map: keep(new CanvasTexture(sc)), transparent: true, depthWrite: false, opacity: 0.55 }));
  const shadow = new Mesh(keep(new PlaneGeometry(4.6, 2.2)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.2, -1.7, 0.4);

  // Composition
  const SLOT = {
    page: { p: new Vector3(-0.95, 0.42, -1.0), r: new Euler(-0.04, 0.3, 0.03) },
    puck: { p: new Vector3(0.12, -0.2, 0.55), rx: 0.86 },
    note: { p: new Vector3(1.32, -0.62, 1.45), r: new Euler(0.02, -0.34, -0.05) },
  };
  const rig = new Group();
  page.position.copy(SLOT.page.p);
  page.rotation.copy(SLOT.page.r);
  puck.position.copy(SLOT.puck.p);
  note.position.copy(SLOT.note.p);
  note.rotation.copy(SLOT.note.r);
  for (const f of frags) f.mesh.visible = false;
  rig.add(page, puck, note, shadow, ...frags.map((f) => f.mesh));
  scene.add(rig);

  // Theme (light/dark): background and studio follow --color-bg
  const applyTheme = () => {
    const t = readSceneTokens();
    scene.background = new Color(t.bg);
    scene.environment?.dispose();
    scene.environment = buildStudio(renderer, t.bg);
    dotMat.color.set(t.signal);
    dotMat.emissive.set(t.signal);
    blue.color.set(t.tint);
  };
  applyTheme();
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", applyTheme);
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

  // Motion state
  const S = {
    px: createSpring(0, heroSprings.parallax), py: createSpring(0, heroSprings.parallax),
    breath: createSpring(0, spring), attn: createSpring(0, heroSprings.attention),
    note: createSpring(1, spring), page: createSpring(1, spring),
  };
  const lineS = lines.map(() => createSpring(1, spring));
  const springs = [...Object.values(S), ...lineS];
  const cues = captureCues(lines.length);
  let flash = 0;
  let ringT = 1;
  let noteFromLens = false;
  let cap: { t: number; fired: Set<string> } | null = null;
  const stats: HeroStats = { frames: 0, fps: 0, dpr, captures: 0 };
  if (options.debug) window.__heroStats = stats;
  const tmp = new Vector3();

  const spawnFragment = (delay = 0) => {
    const f = frags.find((x) => !x.active);
    if (!f) return;
    page.updateMatrix();
    f.active = true;
    f.t = -delay;
    f.dur = 0.55 + Math.random() * 0.15;
    f.p0.set((Math.random() - 0.5) * 1.5, (Math.random() - 0.35) * 1.8, 0.06).applyMatrix4(page.matrix);
    f.p1.copy(f.p0).lerp(SLOT.puck.p, 0.5).add(new Vector3(0.25 + Math.random() * 0.3, 0.8 + Math.random() * 0.4, 0.9));
    f.r0.set(Math.random() - 0.5, page.rotation.y + Math.random() - 0.5, Math.random() - 0.5);
  };

  const fire = (cue: CueKey) => {
    if (cue === "inhale") {
      S.breath.target = -0.045;
      S.note.target = 0;
      noteFromLens = false;
      for (const l of lineS) l.target = 0;
    } else if (cue === "shower") {
      for (let i = 0; i < 6; i++) spawnFragment(i * 0.045);
    } else if (cue === "gulp") {
      S.breath.target = 0;
      S.breath.v += 2.4;
      flash = 1;
      ringT = 0;
    } else if (cue === "note") {
      noteFromLens = true;
      S.note.x = 0;
      S.note.v = 0;
      S.note.target = 1;
    } else if (cue === "page") {
      S.page.x = 0;
      S.page.v = 0;
      S.page.target = 1;
    } else {
      const line = lineS[Number(cue.slice(4))];
      if (line) line.target = 1;
    }
  };

  // Events from the composer (window, decoupled)
  let lastType = 0;
  const onType = () => {
    const now = performance.now();
    S.breath.v += 0.7;
    if (now - lastType > 80) {
      lastType = now;
      spawnFragment();
    }
    sync();
  };
  const onFocus = (e: Event) => {
    S.attn.target = (e as CustomEvent<boolean>).detail ? 1 : 0;
    sync();
  };
  const onStart = () => {
    cap ??= { t: 0, fired: new Set() };
    sync();
  };
  const onPointer = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    S.px.target = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
    S.py.target = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
  };
  const onLeave = () => {
    S.px.target = 0;
    S.py.target = 0;
  };
  window.addEventListener(HERO_EVENTS.type, onType);
  window.addEventListener(HERO_EVENTS.focus, onFocus);
  window.addEventListener(HERO_EVENTS.start, onStart);
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);

  // Per-frame update
  const fit = { dist: 11, cx: 0.15, cy: 0 };
  let clock = 0;
  const update = (dt: number) => {
    clock += dt;
    if (cap) {
      cap.t += dt;
      for (const cue of dueCues(cues, cap.t, cap.fired)) fire(cue);
      if (cap.t > CAPTURE_END_S) {
        cap = null;
        stats.captures++;
        window.dispatchEvent(new CustomEvent(HERO_EVENTS.captured));
      }
    }
    stepSprings(springs, dt);
    const t = clock;
    camera.position.set(fit.cx + S.px.x * 0.75, fit.cy + 0.35 - S.py.x * 0.45, fit.dist);
    camera.lookAt(fit.cx, fit.cy - 0.05, 0);
    rig.rotation.y = S.px.x * 0.1 + Math.sin(t * 0.21) * 0.035;
    rig.rotation.x = S.py.x * 0.05;

    puck.position.set(SLOT.puck.p.x, SLOT.puck.p.y + Math.sin(t * 0.8) * 0.07, SLOT.puck.p.z);
    puck.rotation.set(SLOT.puck.rx + Math.sin(t * 0.55) * 0.035 + S.attn.x * 0.1, 0, Math.sin(t * 0.4) * 0.04 + S.attn.x * 0.08);
    body.scale.setScalar(1 + Math.sin(t * 1.2) * 0.008 + S.breath.x);
    flash *= Math.exp(-dt * 3.2);
    dotMat.emissiveIntensity = 0.3 + S.attn.x * 0.25 + flash * 2.6;
    if (ringT < 1) {
      ringT = Math.min(1, ringT + dt / RIPPLE_S);
      const e = ease.arc(ringT);
      ring.scale.setScalar(1 + e * 0.55);
      ringMat.opacity = 0.5 * (1 - e);
    } else ringMat.opacity = 0;
    shadowMat.opacity = 0.5 - Math.sin(t * 0.8) * 0.06;

    const flowing = cap !== null && cap.t >= PAGE_FLOW.start && !cap.fired.has("page");
    if (flowing && cap) {
      const f = ease.flow(clamp01((cap.t - PAGE_FLOW.start) / PAGE_FLOW.length));
      page.position.lerpVectors(SLOT.page.p, puck.position, f);
      page.rotation.set(SLOT.page.r.x * (1 - f) + 0.6 * f, SLOT.page.r.y * (1 - f), SLOT.page.r.z + f * 0.5);
      page.scale.setScalar(Math.max(0.001, 1 - 0.97 * f));
    } else {
      page.position.set(SLOT.page.p.x, SLOT.page.p.y + Math.sin(t * 0.7 + 1.3) * 0.05, SLOT.page.p.z);
      page.rotation.set(SLOT.page.r.x, SLOT.page.r.y + Math.sin(t * 0.3) * 0.03, SLOT.page.r.z);
      page.scale.setScalar(Math.max(0.001, S.page.x));
    }

    tmp.set(SLOT.note.p.x, SLOT.note.p.y + Math.sin(t * 0.75 + 2.6) * 0.06, SLOT.note.p.z);
    if (noteFromLens) note.position.lerpVectors(puck.position, tmp, S.note.x);
    else note.position.copy(tmp);
    note.rotation.set(SLOT.note.r.x, SLOT.note.r.y, SLOT.note.r.z + Math.sin(t * 0.5 + 1) * 0.02);
    note.scale.setScalar(Math.max(0.001, S.note.x));
    lines.forEach((l, i) => {
      l.scale.x = Math.max(0.001, lineS[i]?.x ?? 1);
    });

    for (const f of frags) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t < 0) {
        f.mesh.visible = false;
        continue;
      }
      const u = Math.min(1, f.t / f.dur);
      const e = ease.flow(u);
      const o = 1 - e;
      f.mesh.position.copy(f.p0).multiplyScalar(o * o).addScaledVector(f.p1, 2 * o * e).addScaledVector(puck.position, e * e);
      f.mesh.rotation.set(f.r0.x * o + 0.86 * e, f.r0.y * o, f.r0.z * o);
      f.mesh.scale.setScalar(Math.max(0.001, smoothstep(0, 0.18, u) * (1 - smoothstep(0.62, 1, u))));
      f.mesh.visible = true;
      if (u >= 1) {
        f.active = false;
        f.mesh.visible = false;
        S.breath.v -= 0.35;
      }
    }
  };

  // Sizing: keep the ~4.7 × 3.9 composition box in frame
  const resize = () => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tan = Math.tan(MathUtils.degToRad(camera.fov / 2));
    fit.dist = Math.max(1.95 / tan, 2.35 / (tan * camera.aspect));
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  // Loop: pause offscreen, on hidden tabs and on context loss; adaptive DPR
  let raf = 0;
  let last = 0;
  let running = false;
  let onScreen = true;
  let lost = false;
  let acc = 0;
  let downgrades = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const interval = now - last;
    last = now;
    update(Math.min(interval / 1000, 1 / 20));
    renderer.render(scene, camera);
    stats.frames++;
    acc += interval;
    if (stats.frames % 60 === 0) {
      stats.fps = 60_000 / acc;
      if (stats.frames > 120 && acc / 60 > SLOW_FRAME_MS && dpr > 1 && downgrades < 2) {
        dpr = Math.max(1, dpr - 0.5);
        renderer.setPixelRatio(dpr);
        resize();
        downgrades++;
        stats.dpr = dpr;
      }
      acc = 0;
    }
  };
  function sync() {
    const want = onScreen && !document.hidden && !lost;
    if (want === running) return;
    running = want;
    if (want) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else cancelAnimationFrame(raf);
  }
  const vis = new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? false;
    sync();
  });
  vis.observe(el);
  document.addEventListener("visibilitychange", sync);
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    delete el.dataset.live;
    sync();
  };
  const onRestored = () => {
    lost = false;
    el.dataset.live = "";
    sync();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  // Compile shaders before revealing so the crossfade never hitches
  await renderer.compileAsync(scene, camera);
  update(0);
  renderer.render(scene, camera);
  requestAnimationFrame(() => {
    el.dataset.live = "";
  });
  sync();

  return {
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      vis.disconnect();
      ro.disconnect();
      themeObserver.disconnect();
      scheme.removeEventListener("change", applyTheme);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener(HERO_EVENTS.type, onType);
      window.removeEventListener(HERO_EVENTS.focus, onFocus);
      window.removeEventListener(HERO_EVENTS.start, onStart);
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      delete el.dataset.live;
      if (options.debug) delete window.__heroStats;
      for (const item of bin) item.dispose();
      scene.environment?.dispose();
      renderer.dispose();
    },
  };
}
```
`page-texture.ts` and the contact shadow draw raw art colours onto canvases. These are pixels of the depicted remote page, which is always light, not UI chrome. Theme-dependent colours (tint, signal, aqua and Bondi) come from tokens.

- [ ] **Step 5: Run the specs and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web e2e -- hero.spec.ts new-task.spec.ts && pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css`

Expected: PASS. `new-task.spec.ts` still passes: under the test browser the hero becomes live, the Start wait applies and URL assertions still hold.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/components/hero apps/web/e2e/hero.spec.ts
git commit -m "feat(web): Capture Lens 3D hero ported to raw three with springs, capture sequence, pausing and dark mode"
```

---

## Task 22 (F5): Bundle budget check and final verification

**Files:**
- Create: `apps/web/scripts/check-hero-bundle.ts`
- Modify: `apps/web/package.json` (add the `check:hero-bundle` script)

**Interfaces:**
- Produces: `pnpm --filter @mastertutor/web check:hero-bundle`. It fails if:
  - no build chunk contains `three`;
  - the chunks containing `three` exceed 150KB gzip in total;
  - a `three` chunk also contains page or loader code (marked by `data-hero`), meaning `three` leaked into a non-lazy chunk.

- [ ] **Step 1: Write the check, which fails before a build.**

`apps/web/scripts/check-hero-bundle.ts`:
```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** Spec §11.2: raw three, tree-shaken, ≤150KB gzip, only in the lazily imported hero chunk. */
const LIMIT = 150 * 1024;
const THREE_MARKER = "isWebGLRenderer";
const PAGE_MARKER = "data-hero";
const root = new URL("../.next/static/", import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".js") ? [path] : [];
  });
}

const chunks = walk(root).map((path) => ({ path, text: readFileSync(path, "utf8") }));
const hits = chunks.filter((c) => c.text.includes(THREE_MARKER));
if (hits.length === 0) throw new Error("No chunk contains three; is the hero import wired?");
const leaked = hits.filter((c) => c.text.includes(PAGE_MARKER));
if (leaked.length) throw new Error(`three leaked into a page chunk: ${leaked.map((c) => c.path).join(", ")}`);
const gz = hits.reduce((sum, c) => sum + gzipSync(c.text).length, 0);
console.log(`hero chunks: ${hits.length}, ${(gz / 1024).toFixed(1)}KB gzip (limit ${LIMIT / 1024}KB)`);
if (gz > LIMIT) throw new Error(`Hero bundle is ${(gz / 1024).toFixed(1)}KB gzip, over the ${LIMIT / 1024}KB budget`);
```

Add to `apps/web/package.json` scripts: `"check:hero-bundle": "node scripts/check-hero-bundle.ts"`.

Run: `pnpm --filter @mastertutor/web check:hero-bundle`

Expected: FAIL with ENOENT on `.next/static` if there is no build yet, or with an error message.

- [ ] **Step 2: Build and check.**

Run:
```bash
pnpm --filter @mastertutor/web build && pnpm --filter @mastertutor/web check:hero-bundle
rm -rf apps/web/.next/cache
```

Expected: PASS, printing about 139KB gzip.
- If the total is over 150KB, check that every `three` import in `components/hero/` is a named import (no `import * as`).
- If `three` leaked, check that `hero-3d.tsx` reaches the scene only via `import("./hero-3d-scene.ts")`.

- [ ] **Step 3: Run the full suite.**

Run: `pnpm test && pnpm --filter @mastertutor/web e2e && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web lint:css && pnpm format:check`

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/scripts apps/web/package.json
git commit -m "test(web): enforce the 3D hero bundle budget (≤150KB gzip, lazy chunk only)"
```

---

## Notes for later phases

1. **Phase 7 (integration) owns these server routes.** The contracts already fix their wire format.
   - `GET /api/runs/:id/events`: resume from `resumeAfter(req.headers["last-event-id"], ?after)`, write `encodeRunEventSse(record)` per row, and send `retry:`. Close the stream after a terminal `status`.
   - `GET /api/runs/:id/steps/:seq/screenshot`: stream `objectKeys.stepScreenshot` from Garage with the read-only key, after checking workspace membership.
   - The oRPC handler at `RPC_PATH`.
2. **B1** should set `StepAction.pointer` for computer actions that have a point. Without it, the cursor still moves but never pulses.
3. **F2 and F4** must reuse `apps/web/lib/api/client.ts` (`api()`). They must not create a second client.
4. **Download links.** `download_ready` carries `downloadId`, but there is no procedure that turns it into a link. The timeline shows the filename only. Phase 7 should add `downloads.url` if links are wanted.
5. **OTP length.** OTP length is not in any contract. CodeSlots defaults to 6 boxes and resizes to 4–8 boxes on paste or autofill.
6. **n.eko connection loss inside the iframe** is not observable from outside. "Reconnecting" is driven by SSE loss and `openLive` failure. If B6 finds n.eko client events, emit them through `onRetrying`.

## Self-Review

**1. Spec coverage**

| Requirement (§10.4, §11.2, §11.4, §11.5, §16 F3/F5, dispatch) | Task |
|---|---|
| Composer, source chips, ⌘↵ | 11 |
| 01/02/03 options (domains, CountUp budget, `approvalMode`, target folder) | 11 |
| `hero:*` events | 11 |
| Mock browser overlays above the n.eko iframe, with an iframe stub in tests | 4, 12, 13 |
| Origin pill and "filled securely" badge | 5, 12, 13 |
| Agent cursor (arc, click pulse, drift) | 8, 13 |
| Caption | 12 |
| 7 states | 6, 13 |
| Takeover transition: optimistic, 2s revert, hand back with a note, sleeping wake | 6, 13 |
| Full screen with `keyboard.lock` | 12, 13 |
| Timeline: StatusMark, ThoughtLine, CountUp, replay | 9, 15 |
| Approval spotlight sheet with D/E/A, no Return default, budget variant | 6, 14 |
| CodeSlots and its security review | 10, 15 |
| Message composer | 15 |
| PiP | 17 |
| SSE client with `Last-Event-ID` | 2, 7, 13 |
| Responsive layouts (1180 stack, ≤820 sheets, ≤420 trims) | 13–16 |
| Cutaway callout with clipped leader and gutter badges (D22) | 12, 16 |
| Playwright at 5 breakpoints with overflow and axe | 18 |
| 3D hero: raw `three`, poster, gated lazy load, motion, DPR, pausing, dark mode, compile-before-reveal, ≤150KB | 19–22 |

**2. Placeholders.** None. The temporary `status-mark.tsx` stub (Task 6) and the `hero-3d-scene.ts` stub (Task 19) are explicit, compiling code that later tasks replace in full.

**3. Type and name consistency.**
- `RunModel`, `StepRow`, `TakeoverState`, `BrowserState` and `Connection` are each defined once and imported everywhere.
- `api()` and `RPC_PATH` come from one client file.
- `stepScreenshotPath` and `runEventsPath` come from contracts.
- The F1 names listed in Global Constraints are the only F1 references, and Task 1's gate test checks them.

**4. Review Focus.** All five items have pinned tests in Tasks 5, 6, 10, 13, 14 and 15.

**5. Recorded deviations.**
- **`⌘⇧T` dropped.** The mock's `⌘⇧T` takeover shortcut is removed, because it conflicts with the browser's own shortcut. D27 requires no shortcut.
- **React Bits fetched, not installed.** Sources are fetched by URL for reference rather than with `shadcn add`. The CLI would install the hugeicons dependencies that the adaptation removes.
- **Sleeping takeover timeout.** A takeover on a sleeping run waits 30s instead of 2s, because it must wake and lease a slot first.
- **CSS Modules over F1's Tailwind tokens.** These stateful components use CSS Modules rather than utility classes, for readability.
