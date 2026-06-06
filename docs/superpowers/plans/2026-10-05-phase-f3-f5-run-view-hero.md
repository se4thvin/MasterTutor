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


---

# Amendment — reconciliation with the built frontend, delight pass, B3 E and B6 (2026-10-06)

# Amendment R — reconciliation (Phases F3 and F5: Run view and 3D hero)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docs/superpowers/plans/2026-10-05-phase-f3-f5-run-view-hero.md` (the "base plan") executable against the code that is actually built on `fe-track`. That code is the merged F1/F2/F4 plus the React Bits delight pass (D43). The F3/F5 deliverables stay the same: the New task composer, the Run view (mock browser, 7 states, takeover and hand back, approvals, OTP, timeline, PiP) and the lazy 3D Capture Lens hero.

**Architecture:**
- **One of each.** One RPC link (`api` and `orpc` from `apps/web/lib/api/client.ts`, which carries the R29-4 UNAUTHORIZED interceptor). One StatusMark and one RollingNumber (both delight-owned). One untrusted-text cleaner. One first-load budget script (delight-owned, extended here for the hero).
- **Pure model, thin views.** Pure modules decide everything and carry the unit tests: the reducer, takeover machine, state derivation, copy, approval copy, timeline rows, cursor arc, callout placement, OTP slots and the draft builder. React components only render and wire.
- **CSS is global and layered.** Three new sheets, `styles/run.css`, `styles/new-task.css` and `styles/hero.css`, sit inside `@layer components` and are imported from `app/globals.css`. There are no CSS Modules.
- **Tests run on the fixture server.** F1's Playwright server (`WEB_FIXTURE_API=1`) serves a recorded run through the fixture router. `page.route` stubs only the control RPCs whose calls a test asserts, the SSE stream (a fake `EventSource`), `/live/**` and the screenshot routes.

**Tech Stack:** Next.js 16.3.8 (Turbopack), React 19.3, Tailwind v4 CSS layers, Base UI 1.8, `motion` 14.0.0 (`m.*` under `LazyMotion`), `@orpc/client` and `@orpc/tanstack-query` 1.15.4 (already installed), TanStack Query 5.104.1, Vitest 5.0.3, Playwright 1.63.0 with `@axe-core/playwright` 4.13.0. F5 only: `three` 0.170.0 and `@types/three` 0.170.0.

**Spec:** `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` §5, §10.3–10.4 and §11. Binding inputs:
- `.superpowers/sdd/2026-10-05-phase-f3-f5-run-view-hero/preflight.md` and its ledger `progress.md`. Every proposed ruling is accepted.
- `.superpowers/sdd/2026-10-06-delight-pass/preflight.md` (X1–X7, I3).
- The delight-pass plan `docs/superpowers/plans/2026-10-06-delight-pass.md`.
- B3 Amendment E, Task 0 (contracts 0.1, R-E13, R-E14, R-E15) in `docs/superpowers/plans/2026-10-05-phase-b3-vault.md`.
- The B6 amendment in `docs/superpowers/plans/2026-10-05-phase-b6-live-view.md` (§3, A3, A9, §7 and §8).
- `orchestration/STATE.md`: D19, D21–D28 and D33–D43.
- `CLAUDE.md`.

---

## R.0 How to apply this amendment

1. **Precedence.** This amendment is appended to the base plan and **overrides it wherever they differ**. Base-plan text it does not mention stays binding.
2. **Each task below has one of three markers.** Base Tasks 1–22 keep their numbers; Task 0 is new.
   - **"Unchanged"** means: run the base task as written, applying only the R.2 gate rules.
   - **"Replaced"** means the base task's files, tests, steps and code are void. Run only the text given here.
   - **"Changed"** means: run the base task, except for the parts given here. Each such part is either a complete file, or a complete function or block whose old text is named exactly. Anything not mentioned stays verbatim.
3. **Run order.**
   1. Task 0 (gate and rebaseline).
   2. Tasks 1, 2 and 4–18 (F3), in order. **Task 3 is deleted.**
   3. Tasks 19–22 (F5).
4. **Ownership boundaries.**
   - The delight pass owns `StatusMark`, `RollingNumber`, `bits-licence.test.ts`, `scripts/first-load.ts` and `check-first-load.ts`, `<LayoutMotion>`, `e2e/helpers/motion.ts`, `durations.flash`, `durations.receive` and `lib/runs/pulse.ts`. F3/F5 import these and never redefine them. Task 22 extends `first-load.ts`: it extracts `routeFiles` from `measureFirstLoad` with identical behaviour, so the delight tests stay green, and adds the hero measurement. It also adds the hero check to `check-first-load.ts`'s check mode.
   - B3 Amendment E Task 0.1 owns `POINTER_KINDS`, `PointerKind`, `pointerOf`, `StepAction.pointer`, `risky_click.context` and `form_submit.action`/`context`.
   - The B6 amendment's Task A3 owns `liveEmbedPath`, `OpenLiveResult` and `download_ready.assetId`.
   - F3 imports all of these and redefines none of them.
5. **Never read `.env`.** Test values come from `.env.test` only through `playwright.config.ts`, which already reads it.

## R.1 Where each pre-flight ruling is applied

**F3/F5 pre-flight** (`.superpowers/sdd/2026-10-05-phase-f3-f5-run-view-hero/preflight.md`):

| IDs | Ruling, in short | Applied in |
|---|---|---|
| E1 | F1 token and motion names win: one rename map, no aliases, no gate test | R.2 name map; Tasks 1, 8–21 |
| E2 | F1 component and icon APIs; only the truly new icons are added | R.2; Task 1 (icons); Tasks 11–17 |
| E3 / S9 | No second client: `api`/`orpc` from `lib/api/client.ts` | Task 3 deleted; Tasks 7, 11–17; `takeover.spec.ts` "an ended session…" |
| E4 | E2E paths are `e2e/helpers/*`; scripts are `test:ui`, `motion:css` and `pnpm lint` | R.2; every e2e step |
| E5 | The fixture router serves `runs.create/get/steps`; `page.route` only for asserted control RPCs | Task 4 |
| E6 | `/new` exists: edit it, keep `metadata` | Task 11 |
| E7 | Reuse `useMediaQuery`/`MEDIA`, `Sheet`, `ConfirmDialog`, `Chip`, `RubberSegment`, `IconButton` | Tasks 12, 15, 16 |
| E8 | CSS in `styles/*.css` inside `@layer components`; `.glass`; no CSS Modules | R.2; Tasks 1, 8–21 |
| X1 | (superseded by delight X1) | — |
| X2 | `/runs` lists runs; run references become links; invert `runs-links.spec.ts` | Task 13 |
| A1 / W1 | `pointer` comes from B3 E; an unpointered step shows "Act" and no pulse | Tasks 0, 2, 4, 6, 13 |
| A2 / S3 | Approval copy branches on action type; shows safety checks; injection gets warn tone; spotlight only for point actions | Tasks 6, 14 |
| A3 / S4 | Show the `context` excerpt (cleaned); show the request screenshot through `approvalScreenshotPath` | Tasks 2, 6, 14 |
| A4 | "You" only when `decidedBy === viewer.id`, otherwise "Someone else" | Tasks 6, 13 |
| A5 | Takeover is allowed while an approval waits | Tasks 6, 13, 14 |
| A6 | `holder:"agent"` or `error{takeover_failed}` while requesting fails at once; 5 s hand-back timeout with resync; a late `control{user}` re-applies | Tasks 5, 6, 7, 13 |
| A7 | Informational errors never become the "Stopped" reason; `download_blocked` maps to "Take over to download files" | Tasks 5, 6, 13 |
| A8 | Fixture screenshot keys use the real `-<nonce>` shape | Task 4 |
| A9 / P1 | Records are applied once per animation frame; a resolved-in-batch approval never mounts the sheet | Tasks 5, 7, 14 |
| L1 | `openLive`: retry only on network or 5xx; `CONFLICT` shows "Open in another tab"; `FORBIDDEN`/`NOT_IMPLEMENTED` show the last screenshot; one frame per run per tab | Tasks 12, 17 |
| L2 | Keep 2 s | Task 6 |
| L3 | Consume only `liveEmbedPath`/`embedPath` | Tasks 4, 12 |
| L4 | Server-side ownership is Phase 7/B6 | R.6 Notes |
| S1 / S2 / W5 | Approval keys arm 600 ms after mount; `event.repeat` is ignored, as are keys in fullscreen or inside another dialog; no key cancels a run (budget Cancel opens `ConfirmDialog`) | Task 14 |
| S5 | `inert` wrapper while not in control; `referrerPolicy="same-origin"`; no `fullscreen` in `allow` | Task 12 |
| S6 | One `untrustedText()` for every page- or model-derived string, rendered in `<bdi>` | Tasks 6, 12–17 |
| S7 | The pill shows the full hostname at full weight; the path is de-emphasised and truncated first | Tasks 6, 12 |
| S8 | No links or inputs inside agent speech | Tasks 12, 15 (unchanged behaviour) |
| S10 | "Ask me" is the default, never remembered; Auto shows its risk line inline | Task 11 |
| P2 | `saveData` and `deviceMemory < 4` gates; `createHero` returns `null` when a WebGL2 context cannot be created | Tasks 19, 21 |
| P3 | Navigate once `create` resolves **and** at least 1.2 s of the capture has played | Task 11 |
| P4 / W4 | Hero budget and leak test run inside `check:first-load` (CI), measured from the first-load manifests | Task 22 |
| G1 | Gate test dropped; existing token/motion/icon tests extended | Task 1 |
| G2 | Longhand transitions only | R.2; all CSS |
| G3 / W2 | One QA test per scenario per F1 project, through `expectCleanScreen`; adds acting, reconnecting, replay; asserts the leader stays clear of the timeline at 1440 | Task 18 |
| G4 | `pnpm exec prettier --write` before each commit | R.2 |
| G5 | `pnpm test <path>` (no `--`) | R.2 |
| G6 | No unit test imports Playwright code; shared data lives in `lib/fixtures/` | Tasks 4, 11 |
| W3 | Accepted (Phase 7 stack test) | R.6 |

**Delight-pass pre-flight** (`.superpowers/sdd/2026-10-06-delight-pass/preflight.md`):

| IDs | Ruling | Applied in |
|---|---|---|
| X1 | The delight pass owns `StatusMark` (`{status, label?, decorative?}`); F3 composes `<StatusMark decorative />` with its own label | Tasks 6, 9, 13, 15 |
| X2 | `RollingNumber{value: string}` replaces CountUp; `count-up.tsx` is not created | Tasks 9, 11, 15 |
| X3 | F3 bits headers use the delight format (TS-TW, Source, sha256, `LICENSE-react-bits`, Adaptations) | Tasks 9, 10 |
| X4 | Rebaseline on the delight HEAD; route-adding tasks commit their route's entry; the hero reuses `measureFirstLoad` | Tasks 0, 11, 13, 17, 22 |
| X5 | Spec §11.4 rows are edited in place by delight Task 13 | — (nothing for F3) |
| X6 | SSE invalidates `orpc.runs.list.key()` by prefix and patches a cached `runs.get` on terminal status | Task 7 |
| X7 | Reuse `e2e/helpers/motion.ts` and `<LayoutMotion>`; no gsap or ogl exception | Tasks 15, 18 |
| I3 | `useRunPulse` reads with `staleTime: 0` | Task 0 checks that it landed |

**B3 Amendment E and the B6 amendment:**

| Source | Item | Applied in |
|---|---|---|
| B3 E R-E13 | `pointerOf`/`POINTER_KINDS`/`StepAction.pointer` are imported, never redefined | Task 2 |
| B3 E R-E14 | `risky_click.context`, `form_submit.action`, `form_submit.context` (≤240) shown on the card only | Tasks 6, 14 |
| B3 E R-E15 | Takeover during a pending approval: the approval is superseded server-side; the sheet leaves on `control{user}` | Tasks 6, 13, 14 |
| B6 §3 | Failed takeover: `error{takeover_failed}` + `control{agent}`; a pending approval stays pending and the run returns to `waiting(approval)` | Tasks 6, 13 |
| B6 A9 | Error codes: `NOT_FOUND`; `CONFLICT` (in use, or a finished run); `SERVICE_UNAVAILABLE`; `FORBIDDEN` (another member holds control); `UNAUTHORIZED` (handled by the link) | Tasks 12, 13 |
| B6 §7.1 / A3 | `liveEmbedPath` carries `usr=user&pwd=cookie`; `download_ready.assetId` | Tasks 0, 4, 5 |
| B6 §8 | `idle_hand_back` is an info toast; `download_blocked` reads "Take over to download files"; `openLive` is called again on every `slot` event and after Reconnecting | Tasks 6, 12, 13 |

## R.2 Global Constraints (replaces the base plan's "F1 contract" table and amends its rules)

The base plan's Phase 0 rules still apply: ESM, `.ts`/`.tsx` extensions, no `enum`, exact versions, contract types by `z.infer`. Its **"F1 contract" table is void**; the table below replaces it. Every task implicitly includes this section.

**Commands (G4, G5, E4)**
- Unit tests: `pnpm test <path…>`, with **no** `--`. This is `vitest run --project unit`.
- E2E tests: `pnpm --filter @mastertutor/web test:ui -- <spec…>`.
- Lint covers ESLint and Stylelint: `pnpm lint`. Type check: `pnpm typecheck`. There is no `lint:css` script.
- Motion CSS after editing `lib/motion-tokens.ts`: `pnpm --filter @mastertutor/web motion:css`.
- Before every commit run `pnpm exec prettier --write <every file the task created or modified>`. The final gate of every task runs `pnpm format:check`.
- After a `next build`, run `rm -rf apps/web/.next/cache`.

**Shipped names (F1/F2/F4 plus the delight pass). F3/F5 use exactly these.**

| Need | Use | From |
|---|---|---|
| RPC | `api` (typed client, a const, never `api()`), `orpc` (TanStack helpers: `orpc.x.y.queryOptions({ input })`, `.queryKey({ input })`, `orpc.x.key()`) | `@/lib/api/client.ts` |
| Error code and copy | `errorCode(error): string \| null`, `errorCopy(error, fallback)` | `@/lib/api/errors.ts` |
| Toast | `const toast = useToast(); toast({ title, description?, tone?: "neutral" \| "danger" })` | `@/components/toast/toast-provider.tsx` |
| Buttons | `Button({ variant?: "primary" \| "gray" \| "plain" \| "danger"; size?: "md" \| "lg"; icon? })`, `IconButton({ icon, label })`, `ButtonLink` | `@/components/ui/button.tsx` |
| Icon | `Icon({ name: IconName; size?: "sm" \| "md" \| "lg" \| "xl"; label? })`; names are semantic camelCase, typed by `IconName` | `@/components/ui/icon.tsx`, `@/lib/ui/vocabulary.ts`, `@/components/ui/icons.ts` |
| Page chrome | `Toolbar({ children })`, `Crumbs({ items })`, `ToolbarSpacer`, `PageHead({ title, lede?, children? })`, class `wrap` | `@/components/ui/toolbar.tsx`, `@/components/ui/page-head.tsx` |
| Overlays | `Sheet({ open, onOpenChange, title, description?, children, footer?, initialFocus? })`, `ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel?, destructive?, onConfirm })` | `@/components/ui/sheet.tsx`, `@/components/ui/confirm-dialog.tsx` |
| Small parts | `Chip({ icon?, children, onRemove?, removeLabel? })`, `Skeleton({ className? })`, `LoadError({ title, onRetry, retrying? })`, `EmptyState` | `@/components/ui/*` |
| Segmented control | `RubberSegment<V>({ items: { value; label; icon?; hideLabel? }[]; value; onChange; "aria-label"; size?; fit? })`; items are radios | `@/components/bits/rubber-segment.tsx` |
| Status | `StatusMark({ status: StatusMarkStatus; label?: string; decorative?: boolean })`, `type StatusMarkStatus = "pending" \| "running" \| "done" \| "failed" \| "cancelled"`; CSS `.smark`, sized by `--smark-size` | `@/components/bits/status-mark.tsx` (delight Task 6) |
| Numerals | `RollingNumber({ value: string; className? })`: pass an already formatted string | `@/components/bits/rolling-number.tsx` (delight Task 9) |
| Media queries | `useMediaQuery(query)`, `MEDIA.sm/md/lg` (mobile-first, 1px above each QA width), `BREAKPOINTS_REM` | `@/lib/hooks/use-media-query.ts`, `@/lib/breakpoints.ts` |
| Motion (TS) | `springs.spring`, `springs.springSoft`, `transitions.{micro, base, panel, exit, spring, springSoft}`, `durations.*`, `easings.{out, in, cursor}`, `press` | `@/lib/motion-tokens.ts` |
| Motion (CSS) | `--motion-dur-<kebab key>` for every `durations` key, `--motion-ease-out/in/cursor/linear`, `--motion-spring` + `--motion-spring-dur`, `--motion-spring-soft` + `--motion-spring-soft-dur` | `styles/motion.css` (generated) |
| Colour and shape tokens | `--bg --bg-2 --elevated --label --label-2 --label-3 --hairline --sep --fill --fill-2 --tint --tint-text --on-tint --tint-wash --signal --on-signal --signal-wash --ok --ok-wash --warn --warn-wash --danger --on-danger --danger-wash --glass --scrim`, `--r-xs/sm/md/lg/xl/pill/frame`, `--e1/e2/e3`, `--font-ui --font-display --font-code`, `--hit`, `--z-scrim/sheet/toast/popover`, `--toolbar-h`, `--tabbar-h` | `styles/tokens.css` |
| Glass | class `glass` (the only `backdrop-filter`) | `styles/components.css` |
| E2E | `test`, `expect`, `expectCleanScreen(page)`, `isCompact(page)`, `isWide(page)` from `e2e/helpers/test.ts`; `QA_VIEWPORTS` from `e2e/helpers/breakpoints.ts`; `movingAnimations`, `startSampling`, `readSamples` from `e2e/helpers/motion.ts` | `apps/web/e2e/helpers/` |
| Fixture IDs | `ids.run(n)`, `ids.folder(n)`, … | `@/lib/fixtures/ids.ts` |

**Rename map (E1, E2).** Apply it to any base-plan text that this amendment keeps.

| Base plan | Shipped |
|---|---|
| `var(--color-X)` | `var(--X)`, except: `--color-separator` → `--sep`, `--color-glass` → `.glass` class |
| `--radius-*`, `--shadow-eN`, `--font-sans`, `--font-mono`, `--backdrop-glass` | `--r-*`, `--eN`, `--font-ui`, `--font-code`, `.glass` |
| `--dur-*`, `--ease-*`, `--spring`/`--spring-duration`, `--spring-soft`/`--spring-soft-duration` | `--motion-dur-*`, `--motion-ease-*`, `--motion-spring`/`--motion-spring-dur`, `--motion-spring-soft`/`--motion-spring-soft-dur` |
| `spring`, `springSoft`, `durationMs`, `easing` | `springs.spring` / `transitions.spring`, `springs.springSoft` / `transitions.springSoft`, `durations`, `easings` |
| `api()` | `api` |
| `toast({ message })` | `useToast()({ title })` |
| `Button variant="secondary" / "ghost" / "destructive"` | `"gray"` / `"plain"` / `"danger"` |
| `<Toolbar title=…>` | `<Toolbar><Crumbs items=… /></Toolbar>` |
| icons `x plus globe lock clock chevron-right warning sparkles key arrow-up-right doc stop link video pdf folder check passkey` | `close add web sealed session chevronRight needsReview agentNote password external note stop link video pdf folder check passkey` |
| icons `shield-key moon hand play pause maximize minimize send` | new in Task 1: `filledSecurely sleeping hand play pause maximize minimize send` |
| `e2e/support/fixtures.ts`, `e2e/support/qa.ts`, `e2e/support/run-mocks.ts` | `e2e/helpers/test.ts`, `expectCleanScreen`, `e2e/helpers/run.ts` |
| `/tmp/...` | the session scratchpad directory |

**CSS rules (E8, G2)**
- F3/F5 CSS lives in three new sheets: `apps/web/styles/run.css`, `new-task.css` and `hero.css`. Each file's only top-level statement is `@layer components { … }`. Each is imported from `app/globals.css` after `settings.css`, and each is added to `SHEETS` in `styles/layers.test.ts` (unless the delight pass already generalised that list).
- **Prefixes:** `run-` (Run view, PiP, timeline, approval), `acur-` (agent cursor), `tline-` (ThoughtLine), `cslots-` (CodeSlots), `nt-` (New task) and `hero-` (hero). Never reuse `.callout`, `.chip`, `.sheet` or `.row` for new rules; those are F1/F2 classes.
- **Layout is mobile-first:** `@variant md { … }` or `@variant lg { … }` inside a rule (as F1 does). Never `max-width` media queries.
- **Transitions:** `transition-property` + `transition-duration` + `transition-timing-function` longhands. Only `transform`, `translate`, `scale`, `rotate` and `opacity` may animate. Durations and easings come only from `--motion-*`. Keyframes change only `transform`/`opacity`. There are no `ms` or `s` literals. Under reduced motion, any end state that would still show as movement goes inside `@media (prefers-reduced-motion: no-preference)`.
- **Colours:** tokens only (`styles/raw-values.test.ts`), including inside `color-mix()`. `backdrop-filter` appears only in `.glass`.
- **Press feedback:** new pressables reuse existing press classes (`btn`, `icon-btn`, `chip-x`, `row-link`, `rseg-item`). No new `:active` transform rules.
- **Sizes:** rem. The exceptions are SVG viewBox units and type-relative `em` (delight C4).

**Security rules (S1–S8)**
- **Untrusted text.** Every string that comes from a page or the model is cleaned by `untrustedText(text, max)` (Task 6) and rendered inside `<bdi>`. This covers labels, captions, summaries, URLs, paths, filenames, form summaries, record context, safety-check messages, error messages, `filed.path` and ThoughtLine labels. Nothing goes into `dangerouslySetInnerHTML`; nothing becomes a link.
- **Keys.** No single keystroke may cancel a run or decide an approval before it is armed (Task 14). Takeover has no shortcut (D27).
- **OTP.** The code never reaches logs, storage, the URL or the DOM after submit.

**Budgets (X4)**
- First-load JS: `pnpm --filter @mastertutor/web check:first-load` after a production build (`cd apps/web && pnpm exec next build`, with no `WEB_FIXTURE_API`).
- A task that adds a route (`/runs/[runId]`, Task 13) or knowingly grows one (`/new` Task 11, `/runs` Task 13) runs `node scripts/check-first-load.ts --write-baseline`. It commits only that route's changed entry and pastes the delta table into the ledger for orchestrator approval.
- Any other route growing past `budgetKb` (6) is a defect to fix, not to rebaseline.
- Hero: at most 150 kB gz, never in any route's first-load files (Task 22).

## R.3 Review Focus (amended)

The base plan's five lines stay, with their tests moved as the tasks below say. These are added; each test lives in the named task.

6. **The user takes over while an approval is waiting.**
   - Expect exactly one `takeControl`. The sheet leaves when `control{user}` arrives, and `decideApproval` is never sent.
   - A later `approval_resolved{superseded}` shows "No longer needed" in the timeline.
   - If the takeover fails (`error{takeover_failed}` + `control{agent}`), the sheet comes back.
   - *Tests:* Task 6 `browser-state.test.ts`, `takeover.test.ts`; Task 14 `approval.spec.ts` "taking over while an approval waits…".
7. **A model safety check or a prompt-injection warning arrives as a `risky_click` whose action is a keypress.**
   - Expect the card to read "The model flagged this step", list every cleaned message, use the warn tone and the steering warning for `malicious_instructions`, and show no spotlight.
   - *Tests:* Task 6 `approval-copy.test.ts`; Task 14 `approval.spec.ts` "a safety check…".
8. **A key pressed in the instant the sheet appears, or a key held down.**
   - Expect nothing to be decided until 600 ms after mount, and `event.repeat` never to decide.
   - The budget sheet has no Cancel key; Cancel needs a confirm.
   - *Tests:* Task 14 `approval.spec.ts` "keys arm after 600 ms…", "the budget sheet has no cancel key".
9. **The live view is already open in another tab, or the live view is not wired yet.**
   - `CONFLICT` shows "Open in another tab" and calls `openLive` once (no loop).
   - `NOT_IMPLEMENTED` shows the last screenshot and never "Reconnecting".
   - *Tests:* Task 13 `run-states.spec.ts` "the live view open in another tab…", "an unwired live view…".
10. **Bidi and invisible characters in a filename, URL path or caption** (`\u202Egpj.exe`, zero-width joiners).
    - Expect them stripped and the text isolated in `<bdi>`.
    - The host is never truncated before the path.
    - *Tests:* Task 6 `untrusted-text.test.ts`, `copy.test.ts`; Task 13 `run-states.spec.ts` "a spoofed path…".

## R.4 File structure (replaces the base plan's)

```
packages/contracts/src/
  run-stream.ts (+ run-stream.test.ts)  SSE wire format, events/step/approval screenshot paths   [Task 2]
  index.ts (modified)                    export run-stream                                       [Task 2]
apps/web/
  lib/motion-tokens.ts (modified)        cursor + hero durations, hero springs, easings.standard [Tasks 1, 19]
  styles/tokens.css (modified)           --cursor, --cursor-outline, --hero-*, --z-pip           [Task 1]
  styles/{run,new-task,hero}.css (new)   all F3/F5 CSS, @layer components                         [Tasks 1, 8–21]
  app/globals.css (modified)             imports the three sheets                                 [Task 1]
  styles/layers.test.ts (modified)       SHEETS += the three sheets                               [Task 1]
  lib/ui/vocabulary.ts, components/ui/icons.ts, icons.test.ts (modified)  8 new icons             [Task 1]
  lib/fixtures/run-recording.ts (new)    recorded run: detail, steps, events, rec()               [Task 4]
  lib/fixtures/{seed,router}.ts (+ router.test.ts) (modified)  run 1 = the recording; runs.create/get/steps [Task 4]
  e2e/helpers/run.ts, e2e/helpers/frame.svg (new)  mockRpc, fake EventSource, live stubs, gotoRun [Task 4]
  components/run/model/
    untrusted-text.ts, run-model.ts, takeover.ts, browser-state.ts, copy.ts,
    approval-copy.ts, timeline-items.ts, callout.ts (+ tests)                                     [Tasks 5, 6, 12]
  components/run/stream/{run-events.ts (+ test), query-sync.ts (+ test), use-run.ts}             [Task 7]
  lib/easing.ts (+ test); components/run/cursor/{cursor-path.ts (+ test), agent-cursor.tsx}       [Task 8]
  components/bits/{format.ts (+ test), thought-line.tsx}                                          [Task 9]
  components/bits/{code-slots-logic.ts (+ test), code-slots.tsx, code-slots.security.test.ts}     [Task 10]
  components/hero/{hero-events.ts, hero-poster.tsx}                                               [Task 11]
  components/new-task/{draft.ts (+ test), new-task-form.tsx, source-field.tsx, options-grid.tsx}  [Task 11]
  app/(app)/new/page.tsx (modified)                                                               [Task 11]
  components/run/browser/{fullscreen.ts (+ test), live-policy.ts (+ test), origin-pill.tsx, live-frame.tsx, caption.tsx,
    banners.tsx, hand-back-sheet.tsx, fullscreen-button.tsx, step-callout.tsx}                    [Task 12]
  components/run/use-element-size.ts                                                              [Task 12]
  components/run/{browser/browser-frame.tsx, run-header.tsx, run-view.tsx, use-takeover.ts, runs-list.tsx} [Task 13]
  app/(app)/runs/page.tsx (modified), app/(app)/runs/[runId]/page.tsx (new)                       [Task 13]
  components/settings/usage-view.tsx, components/settings/audit-view.tsx, components/note/source-strip.tsx (modified) [Task 13]
  components/run/approval/approval-sheet.tsx                                                      [Task 14]
  components/run/{browser/replay-scrubber.tsx, timeline/*.tsx}                                    [Task 15]
  components/run/callout-preference.ts                                                            [Task 16]
  components/run/pip/{watching.ts, run-pip.tsx, pip-dock.tsx}; components/shell/app-shell.tsx (modified) [Task 17]
  components/hero/{hero-gate.ts (+ test), hero-3d.tsx, hero-3d-scene.ts (+ test), scene/*}      [Tasks 19–21]
  scripts/{first-load.ts, check-first-load.ts, first-load.test.ts} (modified)                     [Task 22]
  e2e/{new-task,run-states,takeover,sse,approval,timeline,code-slots,layout,pip,run-qa,hero,runs}.spec.ts, runs-links.spec.ts (modified)
```

**Not created** (the base plan's files that are dropped):
- `apps/web/test/f1-contract.test.ts`, base Task 3's second `lib/api/client.ts` (the shipped one is kept and used), `e2e/support/*`, `e2e/fixtures/*`.
- `components/bits/{status-mark.tsx stub, status-mark.module.css, count-up.tsx}`.
- Every `*.module.css`, `components/run/use-media-query.ts`, `components/run/stop-dialog.tsx`, `scripts/check-hero-bundle.ts`.

---

## R.5 Tasks

### Task 0 (new): Prerequisite gate and first-load rebaseline

**Files:**
- Modify: `apps/web/scripts/first-load-baseline.json` (rewritten by the script)

**Interfaces:**
- Consumes: the delight-pass HEAD; B3 E Task 0.1 and B6 A3 contract commits on `fe-track`.
- Produces: a first-load baseline measured on the delight HEAD, which every later F3/F5 budget check compares against.

- [ ] **Step 1: Check that the delight pass landed.**

Run:
```bash
cd apps/web && for f in components/bits/status-mark.tsx components/bits/rolling-number.tsx components/bits/bits-licence.test.ts scripts/first-load.ts scripts/check-first-load.ts components/motion/layout-motion.tsx e2e/helpers/motion.ts lib/runs/pulse.ts components/shell/use-run-pulse.ts; do test -f "$f" || echo "MISSING $f"; done; grep -c "staleTime: 0" components/shell/use-run-pulse.ts
```
Expected: no `MISSING` line, and a count of at least `1` (delight I3).
- If anything is missing, **stop** and report to the orchestrator. F3/F5 consumes these files and must not recreate them.

- [ ] **Step 2: Check that the backend contract items are on this branch.**

Run:
```bash
cd packages/contracts/src && grep -c "export function pointerOf" events.ts; grep -c "assetId" events.ts; grep -c "context: RecordExcerpt" approval.ts; grep -c "usr=user&pwd=cookie" live.ts
```
Expected: every count is at least `1`.
- If any count is `0`, **stop**. Ask the orchestrator to merge the B3 Amendment E commit `feat(contracts): step pointer kinds, approval action and record excerpt for the run view` and the B6 A3 contracts commit into `fe-track`.
- Never re-implement these items here (R-E13, principle 6).

- [ ] **Step 3: Confirm the base is green.**

Run: `pnpm test packages/contracts apps/web && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Rebaseline first-load JS on the delight HEAD (X4b).**

Run:
```bash
cd apps/web && pnpm exec next build && node scripts/check-first-load.ts --write-baseline && git diff --stat scripts/first-load-baseline.json && rm -rf .next/cache
```
Expected:
- `budgetKb` stays `6`.
- Every route is within ±0.2 kB of the delight pass's final delta table. Paste the printed table into the F3/F5 ledger.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write apps/web/scripts/first-load-baseline.json
git add apps/web/scripts/first-load-baseline.json
git commit -m "build(web): rebaseline first-load JS on the delight-pass HEAD for F3/F5"
```

---

### Task 1: Motion and colour tokens, icons and the three stylesheets — **Replaced**

The base gate test (`apps/web/test/f1-contract.test.ts`) is dropped (G1). F1's own tests are extended instead. No dependency is added: `@orpc/client`, `@orpc/contract` and `@orpc/tanstack-query` are already pinned in `apps/web/package.json`.

**Files:**
- Modify: `apps/web/lib/motion-tokens.ts`, `apps/web/styles/motion.css` (regenerated), `apps/web/styles/tokens.css`, `apps/web/lib/ui/vocabulary.ts`, `apps/web/components/ui/icons.ts`, `apps/web/app/globals.css`, `apps/web/styles/layers.test.ts`
- Create: `apps/web/styles/run.css`, `apps/web/styles/new-task.css`, `apps/web/styles/hero.css`
- Test (modify): `apps/web/lib/motion-tokens.test.ts`, `apps/web/styles/tokens.test.ts`, `apps/web/components/ui/icons.test.ts`

**Interfaces:**
- Produces:
  - **`durations`:** `cursorMin: 250`, `cursorMax: 450`, `clickPulse: 400`, `drift: 2600`, `spin: 1000`. They generate `--motion-dur-cursor-min`, `--motion-dur-cursor-max`, `--motion-dur-click-pulse`, `--motion-dur-drift` and `--motion-dur-spin`.
  - **"Breathe":** reuses F1's `pulse` (1600) and `@keyframes pulse`. No new token.
  - **CSS tokens:** `--cursor`, `--cursor-outline`, `--hero-aqua`, `--hero-aqua-deep`, `--hero-bondi` and `--z-pip`.
  - **Icons:** `filledSecurely` (ShieldCheck), `sleeping` (Moon), `hand` (Hand), `play` (Play), `pause` (Pause), `maximize` (Maximize2), `minimize` (Minimize2) and `send` (ArrowUp).
  - **Stylesheets:** `styles/run.css`, `styles/new-task.css` and `styles/hero.css`, each holding only `@layer components { … }`.

- [ ] **Step 1: Write the failing tests.**

Append to `apps/web/lib/motion-tokens.test.ts`, inside `describe("motion tokens", …)`:
```ts
  it("has the F3 agent cursor and spinner durations (run 13 §6)", () => {
    expect(durations).toMatchObject({
      cursorMin: 250,
      cursorMax: 450,
      clickPulse: 400,
      drift: 2600,
      spin: 1000,
    });
    const css = renderMotionCss();
    for (const name of ["cursor-min", "cursor-max", "click-pulse", "drift", "spin"]) {
      expect(css).toContain(`--motion-dur-${name}:`);
    }
  });
```

Append to `apps/web/styles/tokens.test.ts`:
```ts
describe("F3/F5 art tokens", () => {
  it("defines the agent cursor, hero palette and PiP layer once, in the light block", () => {
    const light = blockAfter("/* light */");
    for (const name of ["cursor", "cursor-outline", "hero-aqua", "hero-aqua-deep", "hero-bondi"]) {
      expect(light[name], name).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(Number(light["z-pip"])).toBeLessThan(Number(light["z-scrim"]));
  });
});
```

In `apps/web/components/ui/icons.test.ts`, add these names to the end of `REQUIRED`, after `"stop",`:
```ts
  // run view (F3)
  "filledSecurely",
  "sleeping",
  "hand",
  "play",
  "pause",
  "maximize",
  "minimize",
  "send",
```

In `apps/web/styles/layers.test.ts`, change the `SHEETS` array to:
```ts
  const SHEETS = [
    "components.css",
    "overlays.css",
    "shell.css",
    "library.css",
    "note.css",
    "vault.css",
    "settings.css",
    "run.css",
    "new-task.css",
    "hero.css",
  ];
```
If the delight pass already replaced `SHEETS` with a directory scan (delight C6), leave the scan as it is.

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test apps/web/lib/motion-tokens.test.ts apps/web/styles apps/web/components/ui/icons.test.ts`
Expected: FAIL. The new durations are missing, `light["cursor"]` is undefined, the icons are missing, and `run.css` is not found.

- [ ] **Step 3: Implement.**

In `apps/web/lib/motion-tokens.ts`, append to the end of the `durations` object (after the last delight key):
```ts
  /** Agent cursor travel: 250–450ms by distance, on easings.cursor (run 13 §6). */
  cursorMin: 250,
  cursorMax: 450,
  /** Click ring 24→44px. */
  clickPulse: 400,
  /** The idle cursor's drift loop while the agent thinks. */
  drift: 2600,
  /** One turn of the Reconnecting spinner (the only spinner, spec §11.4). */
  spin: 1000,
```
Run `pnpm --filter @mastertutor/web motion:css`.

In `apps/web/styles/tokens.css`, inside the light `:root` block, add after `--ambient: …;`:
```css
  /* Agent cursor over remote web content: dark arrow, white outline, in either theme. */
  --cursor: #111111;
  --cursor-outline: #ffffff;
  /* 3D hero art palette (run 16). components/hero only. */
  --hero-aqua: #e4f5f3;
  --hero-aqua-deep: #a9dcd8;
  --hero-bondi: #1f8f96;
```
After `--z-scrim: 90;` add:
```css
  --z-pip: 80;
```

In `apps/web/lib/ui/vocabulary.ts`, add to the `IconName` union after `| "budget"`:
```ts
  | "filledSecurely"
  | "sleeping"
  | "hand"
  | "play"
  | "pause"
  | "maximize"
  | "minimize"
  | "send";
```
Remove the `;` that ended the old last line (`| "budget";` becomes `| "budget"`).

In `apps/web/components/ui/icons.ts`:
- add `ArrowUp`, `Hand`, `Maximize2`, `Minimize2`, `Moon`, `Pause`, `Play` and `ShieldCheck` to the `lucide-react` import, in alphabetical order;
- append these entries after `budget: Gauge,`:
```ts
  // run view (F3)
  filledSecurely: ShieldCheck,
  sleeping: Moon,
  hand: Hand,
  play: Play,
  pause: Pause,
  maximize: Maximize2,
  minimize: Minimize2,
  send: ArrowUp,
```

Create `apps/web/styles/run.css`:
```css
/* Run view, PiP and runs list (F3). Rules are added by Tasks 8, 10, 12–17. */
@layer components {
}
```
Create `apps/web/styles/new-task.css`:
```css
/* New task composer and options (F3 Task 11). */
@layer components {
}
```
Create `apps/web/styles/hero.css`:
```css
/* Capture Lens hero: CSS poster (F3 Task 11) and the 3D canvas (F5 Task 19). */
@layer components {
}
```

In `apps/web/app/globals.css`, add after `@import "../styles/settings.css";`:
```css
@import "../styles/run.css";
@import "../styles/new-task.css";
@import "../styles/hero.css";
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/lib apps/web/styles apps/web/components/ui && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write apps/web/lib/motion-tokens.ts apps/web/lib/motion-tokens.test.ts apps/web/styles apps/web/lib/ui/vocabulary.ts apps/web/components/ui/icons.ts apps/web/components/ui/icons.test.ts apps/web/app/globals.css
git add apps/web/lib/motion-tokens.ts apps/web/lib/motion-tokens.test.ts apps/web/styles apps/web/lib/ui/vocabulary.ts apps/web/components/ui/icons.ts apps/web/components/ui/icons.test.ts apps/web/app/globals.css
git commit -m "feat(web): F3 cursor and hero tokens, run-view icons, layered run/new-task/hero stylesheets"
```

---

### Task 2: Run event stream contract — **Replaced**

`StepAction.pointer` and `POINTER_KINDS` already exist (B3 E 0.1, R-E13). This task adds only the SSE wire format and the screenshot paths. `approvalScreenshotPath` is new (A3c): the browser never names an object key, so the route looks the key up server-side (Phase 7).

**Files:**
- Create: `packages/contracts/src/run-stream.ts`, `packages/contracts/src/run-stream.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `RunEventRecord`, `Uuid`.
- Produces (from `@mastertutor/contracts`):
  - `RUN_EVENT_SSE_NAME = "run_event"`, `LAST_EVENT_ID_HEADER = "last-event-id"` and `EventId`;
  - `runEventsPath(runId, after?)`, `stepScreenshotPath(runId, seq)` and `approvalScreenshotPath(runId, approvalId)`;
  - `resumeAfter(header, query)`, `encodeRunEventSse(record)`, `decodeRunEventData(data)` and `compareEventIds(a, b)`.

- [ ] **Step 1: Write the failing test.**

`packages/contracts/src/run-stream.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { RunEventRecord } from "./events.ts";
import {
  approvalScreenshotPath,
  compareEventIds,
  decodeRunEventData,
  encodeRunEventSse,
  resumeAfter,
  runEventsPath,
  stepScreenshotPath,
} from "./run-stream.ts";

const runId = "0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d";
const approvalId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
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
    expect(approvalScreenshotPath(runId, approvalId)).toBe(
      `/api/runs/${runId}/approvals/${approvalId}/screenshot`,
    );
    expect(() => approvalScreenshotPath(runId, "../keys")).toThrow();
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
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test packages/contracts/src/run-stream.test.ts`
Expected: FAIL, because `./run-stream.ts` is not found.

- [ ] **Step 3: Implement.**

`packages/contracts/src/run-stream.ts`:
```ts
import { z } from "zod";
import { RunEventRecord } from "./events.ts";
import { Uuid } from "./primitives.ts";

/**
 * SSE wire format for GET /api/runs/:id/events (spec §6). The server (Phase 7) writes
 * `encodeRunEventSse` per record and resumes from `resumeAfter(header, ?after)`.
 */
export const RUN_EVENT_SSE_NAME = "run_event";
/** Browsers send this on automatic reconnect; it wins over the `after` query. */
export const LAST_EVENT_ID_HEADER = "last-event-id";
export const EventId = z.string().regex(/^[0-9]{1,19}$/);

export function runEventsPath(runId: string, after: string | null = null): string {
  const base = `/api/runs/${Uuid.parse(runId)}/events`;
  return after === null ? base : `${base}?after=${EventId.parse(after)}`;
}

/** Masked step screenshot; the route resolves the object key by seq (keys carry a nonce). */
export function stepScreenshotPath(runId: string, seq: number): string {
  const n = z.number().int().nonnegative().parse(seq);
  return `/api/runs/${Uuid.parse(runId)}/steps/${n}/screenshot`;
}

/** The screenshot an approval was requested on; the route reads approvals.request.screenshotKey. */
export function approvalScreenshotPath(runId: string, approvalId: string): string {
  return `/api/runs/${Uuid.parse(runId)}/approvals/${Uuid.parse(approvalId)}/screenshot`;
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

Run: `pnpm test packages/contracts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write packages/contracts/src/run-stream.ts packages/contracts/src/run-stream.test.ts packages/contracts/src/index.ts
git add packages/contracts/src/run-stream.ts packages/contracts/src/run-stream.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): run event SSE wire format and step/approval screenshot paths"
```

---

### Task 3: oRPC API client — **Deleted** (E3, S9)

Nothing is created. Every RPC uses `api` or `orpc` from `apps/web/lib/api/client.ts`. That module's single `RPCLink` carries the R29-4 `onError` interceptor, which ends the session on `UNAUTHORIZED`. Task 13 adds an e2e test proving that a Run-view call goes through it. The base plan's wire helpers (`rpcBody`, `rpcErrorBody`) move into Task 4's `e2e/helpers/run.ts`.

---

### Task 4: Recorded run in the fixture backend, and the Playwright run helpers — **Replaced** (E4, E5, A8, W1, G6)

The recording becomes fixture-mode **run 1**. That is the seeded running run, so the sidebar's "1 live" is unchanged. The fixture router now serves `runs.create`, `runs.get` and `runs.steps` for it, so `/new` → `/runs/<id>` works without mocks. Unit tests and Playwright both read the recording from `lib/fixtures/` (pure data, no Playwright import). Playwright stubs only:
- the control RPCs whose calls a test asserts;
- per-test `runs.get` variants (a sleeping run, a user-held run, …);
- the SSE stream, `/live/**` and the screenshot routes, which belong to Phase 7.

**Files:**
- Create: `apps/web/lib/fixtures/run-recording.ts`, `apps/web/e2e/helpers/run.ts`, `apps/web/e2e/helpers/frame.svg`
- Modify: `apps/web/lib/fixtures/ids.ts`, `apps/web/lib/fixtures/seed.ts`, `apps/web/lib/fixtures/router.ts`
- Test (modify): `apps/web/lib/fixtures/router.test.ts`

**Interfaces:**
- Consumes: `RunDetail`, `RunSummary`, `RunStepView`, `RunEventRecord`, `RunEvent`, `MODELS`, `DEFAULT_BUDGET`, `EMPTY_USAGE`, `liveEmbedPath`.
- Produces:
  - **`ids.approval(n)`.**
  - **From `@/lib/fixtures/run-recording.ts`:**
    - `RECORDED_RUN_ID` (= `ids.run(1)`), `RECORDED_APPROVAL_ID` (= `ids.approval(1)`) and `OTHER_RUN_ID` (= `ids.run(2)`, the seeded completed run);
    - `recordedDetail(over?)`, `recordedSummary()`, `recordedSteps()` (seq 1–9) and `recordedEvents()` (ids 13–20);
    - `rec(event, runId?)`, which issues fresh ids from 100 upward.
  - **Recorded stream:**
    - 13–14: act step 10 (click, started then done);
    - 15: budget;
    - 16–17: decide step 11;
    - 18: approve step 12;
    - 19: `approval_requested` (`risky_click`, "Start quiz", with a `context` excerpt);
    - 20: `status` waiting/approval.
  - Step 5 is a computer click **without** `pointer` (W1). Screenshot keys have the real `<seq>-<nonce>.png` shape (A8).
  - **From `e2e/helpers/run.ts`:** `RpcCall`, `RpcHandler`, `RpcFailure`, `mockRpc(page, handlers)`, `controlHandlers()`, `installFakeEventSource(page)`, `emit(page, records)`, `stubLiveFrame(page)`, `frame(page)`, `gotoRun(page, opts?)` and `rpcCalls(calls, path)`.
  - **Window control:** `window.__sse` = `{ sources, blockOpen, emit, fail, openAll }`.

- [ ] **Step 1: Write the failing test.**

Add `RECORDED_RUN_ID, recordedEvents, recordedSteps` to the imports of `apps/web/lib/fixtures/router.test.ts` (`import { RECORDED_RUN_ID, recordedEvents, recordedSteps } from "./run-recording.ts";`) and append:
```ts
describe("fixture runs (F3)", () => {
  it("serves the recorded run's detail and steps", async () => {
    const { api } = client();
    const detail = await api.runs.get({ runId: RECORDED_RUN_ID });
    expect(detail).toMatchObject({ status: "running", slotName: "browser-1", lastEventId: "12" });
    const { items } = await api.runs.steps({ runId: RECORDED_RUN_ID });
    expect(items.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect((await api.runs.steps({ runId: RECORDED_RUN_ID, afterSeq: 9 })).items).toEqual([]);
    const running = await api.runs.list({ status: "running", limit: 20 });
    expect(running.items.map((r) => r.id)).toEqual([RECORDED_RUN_ID]);
  });

  it("creates a queued run that get and list then serve", async () => {
    const { api } = client();
    const created = await api.runs.create({
      goal: "Capture example.com",
      allowedOrigins: ["https://example.com"],
    });
    expect(created).toMatchObject({ status: "queued", approvalMode: "ask", controller: "agent" });
    expect((await api.runs.get({ runId: created.id })).goal).toBe("Capture example.com");
    expect((await api.runs.list({ status: null, limit: 20 })).items[0]?.id).toBe(created.id);
  });

  it("records real step screenshot keys and one unpointered computer step (A8, W1)", () => {
    const keys = recordedSteps().flatMap((s) => (s.screenshotKey ? [s.screenshotKey] : []));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^runs\/[0-9a-f-]{36}\/steps\/\d+-[a-z0-9]+\.png$/);
    const computer = recordedSteps().filter((s) => s.action?.tool === "computer");
    expect(computer.some((s) => s.action?.pointer === undefined)).toBe(true);
    expect(recordedEvents().map((r) => r.id)).toEqual(["13", "14", "15", "16", "17", "18", "19", "20"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm test apps/web/lib/fixtures/router.test.ts`
Expected: FAIL, because `./run-recording.ts` is not found.

- [ ] **Step 3: Implement the recording and the router.**

In `apps/web/lib/fixtures/ids.ts`, add after `run: make(8),`:
```ts
  approval: make(9),
```

`apps/web/lib/fixtures/run-recording.ts`:
```ts
import {
  DEFAULT_BUDGET,
  MODELS,
  RunDetail,
  RunEventRecord,
  RunStepView,
  RunSummary,
  type RunEvent,
} from "@mastertutor/contracts";
import { ids } from "./ids.ts";

/**
 * A recorded run (spec §16: F phases use recorded RunEvents). It is fixture-mode run 1 and the
 * unit tests' source. Phase 7 may swap in a real recording of the same shape; every consumer
 * parses it through the contract schemas.
 */
export const RECORDED_RUN_ID = ids.run(1);
export const RECORDED_APPROVAL_ID = ids.approval(1);
/** The seeded completed run (fixture run 2). */
export const OTHER_RUN_ID = ids.run(2);

const COURSE = "https://learn.example.edu/course/week-2";
const LECTURE = `${COURSE}/lecture-3`;
const LOGIN = "https://learn.example.edu/login";
const t = (time: string) => `2026-10-05T${time}.000Z`;
/** The real key shape: runs/<id>/steps/<seq>-<nonce>.png (objectKeys.stepScreenshot). */
const shot = (seq: number) => `runs/${RECORDED_RUN_ID}/steps/${seq}-r${seq}k7.png`;

const DETAIL = {
  id: RECORDED_RUN_ID,
  goal: `Week 2 of the course: every lecture, figure and table. Skip the quizzes.\n\nSources:\n- ${COURSE}`,
  status: "running",
  waitReason: null,
  controller: "agent",
  approvalMode: "ask",
  model: MODELS.agentPrimary,
  noteId: null,
  usage: {
    steps: 9,
    inputTokens: 182_000,
    cachedInputTokens: 120_000,
    outputTokens: 6_400,
    usd: 0.41,
    activeMs: 372_000,
  },
  budget: DEFAULT_BUDGET,
  createdAt: t("17:04:00"),
  finishedAt: null,
  plan: {
    items: [
      { text: "Sign in", done: true },
      { text: "Capture week 2", done: false },
    ],
  },
  allowedOrigins: ["https://learn.example.edu"],
  currentUrl: LECTURE,
  slotName: "browser-1",
  targetFolderId: null,
  pendingApprovals: [],
  lastEventId: "12",
};

const click = (summary: string, x: number, y: number) => ({
  tool: "computer",
  summary,
  point: { x, y },
  pointer: "click",
});

const STEPS = [
  { seq: 1, phase: "observe", state: "done", caption: "Looking at the course home", url: COURSE, screenshotKey: shot(1), action: null, createdAt: t("17:04:02") },
  { seq: 2, phase: "decide", state: "done", caption: "Planning the sign-in", url: null, screenshotKey: null, action: null, createdAt: t("17:04:05") },
  { seq: 3, phase: "act", state: "done", caption: "Opening the sign-in page", url: LOGIN, screenshotKey: shot(3), action: click("Clicked “Log in”", 1120, 36), createdAt: t("17:04:07") },
  { seq: 4, phase: "act", state: "done", caption: "Filling ada-learn securely", url: LOGIN, screenshotKey: shot(4), action: { tool: "fill_credential", summary: "Filled the password for ada-learn", point: { x: 640, y: 380 } }, createdAt: t("17:04:11") },
  // Recorded before the agent set `pointer` (A1): the UI must say "Act" and never pulse (W1).
  { seq: 5, phase: "act", state: "done", caption: "Signing in", url: LOGIN, screenshotKey: shot(5), action: { tool: "computer", summary: "Clicked “Sign in”", point: { x: 640, y: 452 } }, createdAt: t("17:04:14") },
  { seq: 6, phase: "observe", state: "done", caption: "Reading lecture 3", url: LECTURE, screenshotKey: shot(6), action: null, createdAt: t("17:04:41") },
  { seq: 7, phase: "act", state: "done", caption: "Capturing the transcript", url: LECTURE, screenshotKey: shot(7), action: { tool: "capture", summary: "Transcript: 1,842 words, verified", point: null }, createdAt: t("17:05:58") },
  { seq: 8, phase: "act", state: "done", caption: "Capturing the convergence figure", url: LECTURE, screenshotKey: shot(8), action: { tool: "capture", summary: "Figure: cost vs. iterations", point: { x: 520, y: 300 } }, createdAt: t("17:07:20") },
  { seq: 9, phase: "decide", state: "done", caption: "Choosing what to capture next", url: null, screenshotKey: null, action: null, createdAt: t("17:09:47") },
];

const honor = click("Clicked the Honor Code checkbox", 980, 560);
const ev = (id: number, at: string, event: unknown) => ({ id: String(id), runId: RECORDED_RUN_ID, at: t(at), event });

const EVENTS = [
  ev(13, "17:10:01", { type: "step", seq: 10, phase: "act", state: "started", caption: "Ticking the Honor Code box", url: LECTURE, screenshotKey: null, action: honor }),
  ev(14, "17:10:02", { type: "step", seq: 10, phase: "act", state: "done", caption: "Ticking the Honor Code box", url: LECTURE, screenshotKey: shot(10), action: honor }),
  ev(15, "17:10:02", {
    type: "budget",
    usage: { steps: 10, inputTokens: 190_000, cachedInputTokens: 124_000, outputTokens: 6_700, usd: 0.44, activeMs: 380_000 },
    budget: DEFAULT_BUDGET,
  }),
  ev(16, "17:10:03", { type: "step", seq: 11, phase: "decide", state: "started", caption: "Deciding whether to start the quiz", url: null, screenshotKey: null, action: null }),
  ev(17, "17:10:06", { type: "step", seq: 11, phase: "decide", state: "done", caption: "Deciding whether to start the quiz", url: null, screenshotKey: null, action: null }),
  ev(18, "17:10:07", { type: "step", seq: 12, phase: "approve", state: "started", caption: "Waiting for your approval to start the quiz", url: LECTURE, screenshotKey: null, action: null }),
  ev(19, "17:10:08", {
    type: "approval_requested",
    approvalId: RECORDED_APPROVAL_ID,
    request: {
      kind: "risky_click",
      action: { type: "click", x: 1000, y: 610, button: "left" },
      label: "Start quiz",
      url: LECTURE,
      screenshotKey: null,
      context: "Week 2 quiz. Attempt 1 of 1",
    },
  }),
  ev(20, "17:10:09", { type: "status", status: "waiting", waitReason: "approval", reason: "Starting the quiz counts as an attempt." }),
];

export function recordedDetail(over: Partial<RunDetail> = {}): RunDetail {
  return RunDetail.parse({ ...DETAIL, ...over });
}

export function recordedSummary(): RunSummary {
  return RunSummary.parse(DETAIL);
}

export function recordedSteps(): RunStepView[] {
  return RunStepView.array().parse(STEPS);
}

export function recordedEvents(): RunEventRecord[] {
  return RunEventRecord.array().parse(EVENTS);
}

let nextId = 100;

/** A follow-on event with a fresh id above the recorded stream. */
export function rec(event: RunEvent, runId: string = RECORDED_RUN_ID): RunEventRecord {
  const id = nextId++;
  return RunEventRecord.parse({
    id: String(id),
    runId,
    at: new Date(Date.UTC(2026, 9, 5, 17, 20, 0) + id * 1000).toISOString(),
    event,
  });
}
```
In `apps/web/lib/fixtures/seed.ts`:
- add `import { recordedSummary } from "./run-recording.ts";`;
- in `runs()`, replace the whole `run(1, "Take notes on week 3 of the ML course, every lecture, figure and table", "running", 0.84, 23, at("2026-10-05", "16:55:00"), null, null),` call with `recordedSummary(),`.

In `apps/web/lib/fixtures/router.ts`:
- add `EMPTY_USAGE`, `MODELS` and `type RunSummary` to the `@mastertutor/contracts` import;
- add `import { ids } from "./ids.ts";` and `import { RECORDED_RUN_ID, recordedDetail, recordedSteps } from "./run-recording.ts";`;
- replace the `create`, `get` and `steps` handlers of `runs` with:
```ts
    create: os.runs.create.handler(({ input, context }): RunSummary => {
      const state = stateFor(context.ns);
      const run: RunSummary = {
        id: ids.run(100 + state.runs.length),
        goal: input.goal,
        status: "queued",
        waitReason: null,
        controller: "agent",
        approvalMode: input.approvalMode,
        model: MODELS.agentPrimary,
        noteId: null,
        usage: EMPTY_USAGE,
        budget: input.budget ?? state.settings.defaultBudget,
        createdAt: now(),
        finishedAt: null,
      };
      state.runs.unshift(run);
      return run;
    }),
```
```ts
    get: os.runs.get.handler(({ input, context }): RunDetail => {
      if (input.runId === RECORDED_RUN_ID) return recordedDetail();
      const run = stateFor(context.ns).runs.find((r) => r.id === input.runId);
      if (!run) throw notFound("Run");
      return {
        ...run,
        plan: null,
        allowedOrigins: [],
        currentUrl: null,
        slotName: null,
        targetFolderId: null,
        pendingApprovals: [],
        lastEventId: null,
      };
    }),
    steps: os.runs.steps.handler(({ input }) => ({
      items: input.runId === RECORDED_RUN_ID && input.afterSeq === null ? recordedSteps() : [],
    })),
```

- [ ] **Step 4: Write the Playwright run helpers.**

`apps/web/e2e/helpers/frame.svg`: copy the base plan's `frame.svg` (Task 4, Step 1) verbatim. It is a fixed 1280×800 "remote page" with the Honor Code box and the Start quiz button.

`apps/web/e2e/helpers/run.ts`:
```ts
import { readFileSync } from "node:fs";
import { liveEmbedPath, type RunDetail, type RunEventRecord } from "@mastertutor/contracts";
import { expect, type Locator, type Page } from "@playwright/test";
import { RECORDED_RUN_ID } from "../../lib/fixtures/run-recording.ts";

export interface RpcCall {
  path: string;
  input: unknown;
}
export type RpcHandler = (input: unknown) => unknown;

/** Thrown by a handler to answer with an oRPC error (status + code), as the server would. */
export class RpcFailure extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Intercepts /api/rpc/<router>/<proc> for the given procedures only; everything else falls through
 * to the fixture server. oRPC 1.15.4 wire: request {json: input}; response {json: output}.
 */
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
      await route.fulfill({ json: { json: output } });
    } catch (error) {
      const failure =
        error instanceof RpcFailure ? error : new RpcFailure("INTERNAL_SERVER_ERROR", 500);
      await route.fulfill({
        status: failure.status,
        json: {
          json: { defined: false, code: failure.code, status: failure.status, message: failure.message },
        },
      });
    }
  });
  return calls;
}

export const rpcCalls = (calls: readonly RpcCall[], path: string): unknown[] =>
  calls.filter((c) => c.path === path).map((c) => c.input);

const OK = { ok: true } as const;

/** The control RPCs a run test asserts; the fixture router does not implement them (Phase 7/B6 do). */
export function controlHandlers(): Record<string, RpcHandler> {
  return {
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
```
Then append the base plan's `FakeSource`, `SseControl`, `declare global { interface Window { __sse: SseControl } }`, `installFakeEventSource` and `emit` **verbatim** (base Task 4, Step 2). After them, append:
```ts
const FRAME_SVG = readFileSync(new URL("./frame.svg", import.meta.url), "utf8");

/** Stubs the n.eko embed and the masked step and approval screenshots with one fixed frame. */
export async function stubLiveFrame(page: Page): Promise<void> {
  await page.route("**/live/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Remote page</title><style>html,body{margin:0;height:100%}svg{display:block;width:100%;height:100%}</style></head><body>${FRAME_SVG}</body></html>`,
    }),
  );
  for (const pattern of ["**/api/runs/*/steps/*/screenshot", "**/api/runs/*/approvals/*/screenshot"]) {
    await page.route(pattern, (route) => route.fulfill({ contentType: "image/svg+xml", body: FRAME_SVG }));
  }
}

export const frame = (page: Page): Locator => page.getByTestId("browser-frame");

export interface GotoRunOptions {
  /** A runs.get variant (sleeping, user-held, finished, …); default: the fixture's recorded run. */
  detail?: RunDetail;
  handlers?: Record<string, RpcHandler>;
  realEventSource?: boolean;
}

export async function gotoRun(page: Page, opts: GotoRunOptions = {}): Promise<RpcCall[]> {
  if (!opts.realEventSource) await installFakeEventSource(page);
  await stubLiveFrame(page);
  const detail = opts.detail;
  const calls = await mockRpc(page, {
    ...controlHandlers(),
    ...(detail ? { "runs/get": () => detail } : {}),
    ...opts.handlers,
  });
  await page.goto(`/runs/${detail?.id ?? RECORDED_RUN_ID}`);
  await expect(frame(page)).toBeVisible();
  return calls;
}
```

- [ ] **Step 5: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/lib/fixtures && pnpm typecheck && pnpm lint`
Expected: PASS. Then run `pnpm --filter @mastertutor/web test:ui -- shell.spec.ts usage.spec.ts`; it is expected to PASS, because "1 live" and the usage tables still hold.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/lib/fixtures apps/web/e2e/helpers/run.ts
git add apps/web/lib/fixtures apps/web/e2e/helpers/run.ts apps/web/e2e/helpers/frame.svg
git commit -m "test(web): recorded run as fixture run 1 (runs.create/get/steps) and Playwright run helpers"
```

---

### Task 5: Run model reducer — **Replaced** (A6, A7, A9, G6)

**Changes from the base task:**
- **A7.** Errors are kept as a list. `failureOf(model)` ignores informational codes, so a `download_blocked` never becomes the "Stopped" reason.
- **A6.** `lastControl` records each `control` event with its id, so the view reacts to every event, even one that repeats the current holder.
- **A9.** `applyRunEvents(model, batch)` folds a frame's worth of records into one model.
- **A6 resync.** `syncRunModel(model, detail)` settles a model from a re-read `runs.get`.
- `DownloadItem` carries `assetId` (B6 A3).
- Fixtures come from `@/lib/fixtures/run-recording.ts` (G6).

**Files:**
- Create: `apps/web/components/run/model/run-model.ts`, `apps/web/components/run/model/run-model.test.ts`

**Interfaces:**
- Consumes: `RunDetail`, `RunStepView`, `RunEventRecord`, `compareEventIds` (Task 2), `toOrigin`, `TERMINAL_RUN_STATUSES`.
- Produces:
  - **Types:** `StepRow`, `PendingApproval`, `ApprovalOutcome`, `UserMessage`, `DownloadItem`, `RunError` (`{eventId, code, message, at}`), `ControlChange` (`{eventId, holder}`) and `RunModel`.
  - **Constant:** `INFORMATIONAL_ERRORS` (`takeover_failed`, `idle_hand_back`, `download_blocked`, `download_too_large`).
  - **Functions:**
    - `initRunModel(detail, steps)`, `applyRunEvent(model, record)`, `applyRunEvents(model, records)` and `syncRunModel(model, detail)`;
    - `isTerminal(status)` and `isInformational(code)`;
    - `failureOf(model): RunError | null` and `latestError(model): RunError | null`;
    - `latestStep(model)`, `latestPointerStep(model)` and `latestScreenshotSeq(model)`;
    - `captureCount(model)` and `originOf(url)`.

- [ ] **Step 1: Write the failing test.**

`apps/web/components/run/model/run-model.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ids } from "@/lib/fixtures/ids.ts";
import {
  OTHER_RUN_ID,
  RECORDED_APPROVAL_ID,
  RECORDED_RUN_ID,
  rec,
  recordedDetail,
  recordedEvents,
  recordedSteps,
} from "@/lib/fixtures/run-recording.ts";
import {
  applyRunEvent,
  applyRunEvents,
  captureCount,
  failureOf,
  initRunModel,
  isTerminal,
  latestError,
  latestPointerStep,
  latestScreenshotSeq,
  syncRunModel,
} from "./run-model.ts";

const base = () => initRunModel(recordedDetail(), recordedSteps());

describe("initRunModel", () => {
  it("parses the recording and derives captures and the secure-fill origin", () => {
    const model = base();
    expect(model.runId).toBe(RECORDED_RUN_ID);
    expect(model.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(captureCount(model)).toBe(2);
    expect(model.secureFillOrigin).toBe("https://learn.example.edu");
    expect(model.lastEventId).toBe("12");
    expect(latestScreenshotSeq(model)).toBe(8);
    expect(model.lastControl).toBeNull();
  });

  it("keeps only pending approvals from the snapshot", () => {
    const request = recordedEvents()[6]!.event;
    if (request.type !== "approval_requested") throw new Error("fixture order changed");
    const view = (status: "pending" | "approved") => ({
      id: RECORDED_APPROVAL_ID,
      runId: RECORDED_RUN_ID,
      stepSeq: 12,
      kind: "risky_click" as const,
      request: request.request,
      status,
      decidedBy: null,
      decidedAt: null,
      createdAt: "2026-10-05T17:10:08.000Z",
    });
    const pending = initRunModel(recordedDetail({ pendingApprovals: [view("pending")] }), []);
    expect(pending.approvals.map((a) => a.id)).toEqual([RECORDED_APPROVAL_ID]);
    const done = initRunModel(recordedDetail({ pendingApprovals: [view("approved")] }), []);
    expect(done.approvals).toEqual([]);
  });
});

describe("applyRunEvent", () => {
  it("folds the recorded stream into an approval wait", () => {
    const model = applyRunEvents(base(), recordedEvents());
    expect(model.status).toBe("waiting");
    expect(model.waitReason).toBe("approval");
    expect(model.approvals.map((a) => a.id)).toEqual([RECORDED_APPROVAL_ID]);
    expect(model.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(model.usage.steps).toBe(10);
    expect(latestPointerStep(model)?.seq).toBe(10);
    expect(model.lastEventId).toBe("20");
  });

  it("upserts a step's phases in place and keeps its first timestamp", () => {
    const [started, done] = recordedEvents();
    const twice = applyRunEvent(applyRunEvent(base(), started!), done!);
    const rows = twice.steps.filter((s) => s.seq === 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("done");
    expect(rows[0]?.at).toBe(started!.at);
  });

  it("ignores ids at or below lastEventId (reconnect replay overlap)", () => {
    const model = applyRunEvents(base(), recordedEvents());
    expect(applyRunEvents(model, recordedEvents())).toBe(model);
    const stale = { ...rec({ type: "control", holder: "user" }), id: "12" };
    expect(applyRunEvent(base(), stale).controller).toBe("agent");
  });

  it("ignores events for another run", () => {
    const model = base();
    expect(applyRunEvent(model, rec({ type: "control", holder: "user" }, OTHER_RUN_ID))).toBe(model);
  });

  it("moves approvals to outcomes when resolved, even within one batch (A9)", () => {
    const requested = recordedEvents()[6]!;
    const resolved = rec({
      type: "approval_resolved",
      approvalId: RECORDED_APPROVAL_ID,
      status: "approved",
      decidedBy: "policy",
    });
    const model = applyRunEvents(base(), [requested, resolved]);
    expect(model.approvals).toEqual([]);
    expect(model.outcomes).toMatchObject([
      { id: RECORDED_APPROVAL_ID, status: "approved", decidedBy: "policy" },
    ]);
    expect(model.outcomes[0]?.request?.kind).toBe("risky_click");
  });

  it("clears the secure-fill badge when the page leaves that origin", () => {
    const moved = applyRunEvent(
      base(),
      rec({
        type: "step",
        seq: 20,
        phase: "act",
        state: "done",
        caption: "Opening the docs",
        url: "https://docs.example.org/page",
        screenshotKey: null,
        action: { tool: "computer", summary: "Clicked Docs", point: null },
      }),
    );
    expect(moved.secureFillOrigin).toBeNull();
    expect(moved.currentUrl).toBe("https://docs.example.org/page");
  });

  it("tracks control events by id, slot, messages, downloads, filing and model fallback", () => {
    const control = rec({ type: "control", holder: "user" });
    const model = applyRunEvents(base(), [
      control,
      rec({ type: "slot", slotName: null }),
      rec({ type: "user_message", text: "Skip the quiz" }),
      rec({
        type: "download_ready",
        downloadId: ids.asset(9),
        assetId: ids.asset(10),
        filename: "slides.pdf",
        bytes: 2048,
      }),
      rec({
        type: "filed",
        noteId: ids.note(1),
        folderId: ids.folder(1),
        path: ["Courses", "ML"],
        filedBy: "agent",
      }),
      rec({ type: "model_fallback", from: "gpt-6-astra", to: "gpt-6.1-sol" }),
    ]);
    expect(model.controller).toBe("user");
    expect(model.lastControl).toEqual({ eventId: control.id, holder: "user" });
    expect(model.slotName).toBeNull();
    expect(model.messages.map((m) => m.text)).toEqual(["Skip the quiz"]);
    expect(model.downloads.map((d) => d.filename)).toEqual(["slides.pdf"]);
    expect(model.filedPath).toEqual(["Courses", "ML"]);
    expect(model.model).toBe("gpt-6.1-sol");
  });

  it("never lets an informational error become the failure reason (A7)", () => {
    const model = applyRunEvents(base(), [
      rec({ type: "error", code: "nav_timeout", message: "The page took too long" }),
      rec({ type: "error", code: "download_blocked", message: "Download cancelled" }),
    ]);
    expect(failureOf(model)?.code).toBe("nav_timeout");
    expect(latestError(model)?.code).toBe("download_blocked");
    const onlyInfo = applyRunEvent(base(), rec({ type: "error", code: "takeover_failed", message: "x" }));
    expect(failureOf(onlyInfo)).toBeNull();
  });

  it("knows terminal statuses", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("sleeping")).toBe(false);
  });
});

describe("syncRunModel (A6 hand-back resync)", () => {
  it("settles status, controller and slot from a re-read detail and keeps the stream position", () => {
    const model = applyRunEvents(base(), recordedEvents());
    const synced = syncRunModel(
      model,
      recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover", slotName: "browser-2" }),
    );
    expect(synced).toMatchObject({ controller: "user", status: "waiting", waitReason: "takeover", slotName: "browser-2" });
    expect(synced.lastEventId).toBe("20");
    expect(synced.steps).toBe(model.steps);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm test apps/web/components/run/model/run-model.test.ts`
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
  assetId: string;
  filename: string;
  bytes: number;
  at: string;
}
export interface RunError {
  eventId: string;
  code: string;
  message: string;
  at: string;
}
/** One `control` event; the id lets the view react to every event, even a repeated holder. */
export interface ControlChange {
  eventId: string;
  holder: Controller;
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
  errors: RunError[];
  lastControl: ControlChange | null;
  /** Origin whose sign-in the vault filled; drives the "Filled securely" badge (run 13 §6). */
  secureFillOrigin: string | null;
  filedPath: string[] | null;
  lastEventId: string | null;
}

/** Errors that inform but never end a run (B6 §7.10); never the "Stopped" reason (A7). */
export const INFORMATIONAL_ERRORS: ReadonlySet<string> = new Set([
  "takeover_failed",
  "idle_hand_back",
  "download_blocked",
  "download_too_large",
]);

const SECURE_TOOLS: ReadonlySet<string> = new Set(["fill_credential", "use_passkey"]);
const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export function isInformational(code: string): boolean {
  return INFORMATIONAL_ERRORS.has(code);
}

export function originOf(url: string | null): string | null {
  return url === null ? null : toOrigin(url);
}

function secureOriginAfter(prev: string | null, step: StepRow, currentUrl: string | null): string | null {
  const origin = originOf(step.url ?? currentUrl);
  const filled =
    step.phase === "act" &&
    step.state === "done" &&
    step.action !== null &&
    SECURE_TOOLS.has(step.action.tool);
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

function pendingFrom(detail: RunDetail): PendingApproval[] {
  return detail.pendingApprovals
    .filter((a) => a.status === "pending")
    .map((a) => ({ id: a.id, request: a.request, at: a.createdAt }));
}

export function initRunModel(detail: RunDetail, views: RunStepView[]): RunModel {
  const steps = views
    .map(
      (v): StepRow => ({
        seq: v.seq,
        phase: v.phase,
        state: v.state,
        caption: v.caption,
        url: v.url,
        screenshotKey: v.screenshotKey,
        action: v.action,
        at: v.createdAt,
      }),
    )
    .sort((a, b) => a.seq - b.seq);
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
    approvals: pendingFrom(detail),
    outcomes: [],
    messages: [],
    downloads: [],
    errors: [],
    lastControl: null,
    secureFillOrigin: secure,
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
      return { ...m, controller: e.holder, lastControl: { eventId: record.id, holder: e.holder } };
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
          {
            id: e.approvalId,
            request: found?.request ?? null,
            status: e.status,
            decidedBy: e.decidedBy,
            at: record.at,
          },
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
        downloads: [
          ...m.downloads,
          { id: e.downloadId, assetId: e.assetId, filename: e.filename, bytes: e.bytes, at: record.at },
        ],
      };
    case "error":
      return {
        ...m,
        errors: [...m.errors, { eventId: record.id, code: e.code, message: e.message, at: record.at }],
      };
    case "filed":
      return { ...m, noteId: e.noteId, filedPath: e.path };
    case "model_fallback":
      return { ...m, model: e.to };
  }
}

/** One frame's worth of records, folded into one model: one render per batch (A9). */
export function applyRunEvents(model: RunModel, records: readonly RunEventRecord[]): RunModel {
  return records.reduce(applyRunEvent, model);
}

/** Settles the model on a re-read RunDetail (A6: a hand back whose control event never came). */
export function syncRunModel(model: RunModel, detail: RunDetail): RunModel {
  if (detail.id !== model.runId) return model;
  return {
    ...model,
    status: detail.status,
    waitReason: detail.waitReason,
    controller: detail.controller,
    slotName: detail.slotName,
    currentUrl: detail.currentUrl ?? model.currentUrl,
    usage: detail.usage,
    budget: detail.budget,
    approvals: pendingFrom(detail),
  };
}

export function latestError(model: RunModel): RunError | null {
  return model.errors.at(-1) ?? null;
}

/** The error that explains a failed run: the last one that is not merely informational (A7). */
export function failureOf(model: RunModel): RunError | null {
  for (let i = model.errors.length - 1; i >= 0; i--) {
    const error = model.errors[i];
    if (error && !isInformational(error.code)) return error;
  }
  return null;
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
  return model.steps.filter(
    (s) => s.phase === "act" && s.state === "done" && s.action?.tool === "capture",
  ).length;
}
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/components/run/model && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run/model
git add apps/web/components/run/model
git commit -m "feat(web): RunModel reducer with batched apply, error list, control ids and resync"
```

---

### Task 6: Takeover machine, state derivation, copy, approval copy, timeline rows and untrusted text — **Replaced** (A2, A3, A4, A5, A6, A7, S6, S7, X1)

**Changes from the base task:**
- **S6.** New `untrusted-text.ts`, the one cleaner for page- and model-derived text.
- **A5, A6.** The takeover machine fails at once on `holder:"agent"` or `takeover_failed`, times out a hand back after 5 s, re-applies a late `control{user}` and reports one-shot notices. `canTakeOver` allows the approval state.
- **S7.** The pill keeps the full hostname; only the path is cleaned and truncated.
- **A7.** `pausedCopy` reads `failureOf`; informational errors have their own copy.
- **A2, A3.** Approval copy branches on action type and shows safety checks, the injection warning and the record `context`. It spotlights only point actions.
- **A4.** Decisions say "You" only for the viewer.
- **X1.** There is no StatusMark stub: `StatusMarkStatus` comes from the delight pass's `bits/status-mark.tsx`.

**Files:**
- Create in `apps/web/components/run/model/`:
  - `untrusted-text.ts` (+ `untrusted-text.test.ts`)
  - `takeover.ts` (+ `takeover.test.ts`)
  - `browser-state.ts` (+ `browser-state.test.ts`)
  - `copy.ts` (+ `copy.test.ts`)
  - `approval-copy.ts` (+ `approval-copy.test.ts`)
  - `timeline-items.ts` (+ `timeline-items.test.ts`)

**Interfaces:**
- Consumes: `RunModel` and its helpers (Task 5); `ApprovalRequest`, `ComputerAction`, `POLICY_DECIDER`, `compareEventIds`; `StatusMarkStatus` (delight).
- Produces:
  - **`untrusted-text.ts`:** `untrustedText(text: string | null | undefined, max?: number): string` and `MAX_UNTRUSTED = 300`.
  - **`takeover.ts`:**
    - constants `TAKEOVER_TIMEOUT_MS = 2000`, `WAKE_TAKEOVER_TIMEOUT_MS = 30000` and `HANDBACK_TIMEOUT_MS = 5000`;
    - types `TakeoverPhase`, `TakeoverNotice` (`"failed" | "timed_out" | "now_in_control"`), `TakeoverState` (`{phase, wake, notice, timedOut}`) and `TakeoverAction`;
    - `IDLE_TAKEOVER`, `takeoverReducer`, `inControl(controller, state)` and `takeoverTimeoutMs(state)`.
  - **`browser-state.ts`:** `BROWSER_STATES`, `BrowserState`, `Connection`, `ViewFlags`, `deriveBrowserState(model, flags)` and `canTakeOver(model, state, takeover)`.
  - **`copy.ts`:**
    - `Tone`, `STATE_PILL`, `UrlParts`, `hostAndPath(url)` and `pageHost(url)`;
    - `PausedCopy`, `pausedCopy(model)`, `captionFor(state, model, takeover, replayStep)`, `statusLabel(state, model)` and `markFor(state, model)`;
    - `actCount`, `actNumber`, `stepLabel` and `shortRunId`;
    - `INFO_ERROR_COPY`, `errorLine(error)`, `TAKEOVER_NOTICE`, `takeControlErrorCopy(code)` and `handBackErrorCopy(code)`.
  - **`approval-copy.ts`:** `MAX_LABEL = 120`, `MAX_CONTEXT = 240`, `INJECTION_CHECK`, `ApprovalCopy`, `actionPhrase(action, label)`, `pointOf(action)`, `approvalCopy(request)` and `requestSummary(request)`.
  - **`timeline-items.ts`:** `PendingMessage`, `TimelineItem` (kinds `step | message | decision | download | notice`), `ThinkingState`, `timelineItems(model, pending, viewerId)`, `thinkingState(model)`, `summaryLabel(model)` and `elapsedClock(from, at)`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/components/run/model/untrusted-text.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MAX_UNTRUSTED, untrustedText } from "./untrusted-text.ts";

describe("untrustedText (S6)", () => {
  it("strips bidi overrides, isolates and zero-width characters", () => {
    expect(untrustedText("\u202Egpj.exe")).toBe("gpj.exe");
    expect(untrustedText("a\u200Bb\u2066c\u2069d\uFEFF")).toBe("abcd");
  });

  it("turns control characters and runs of whitespace into single spaces", () => {
    expect(untrustedText("  line\none\ttab\u0000end  ")).toBe("line one tab end");
  });

  it("folds compatibility forms (NFKC)", () => {
    expect(untrustedText("\uFB01le \uFF21")).toBe("file A");
  });

  it("caps by code point, never splitting a surrogate pair", () => {
    const capped = untrustedText("😀".repeat(500), 10);
    expect([...capped]).toHaveLength(10);
    expect(capped.endsWith("…")).toBe(true);
    expect(untrustedText("x".repeat(2_000)).length).toBe(MAX_UNTRUSTED);
  });

  it("returns an empty string for nothing", () => {
    expect(untrustedText(null)).toBe("");
    expect(untrustedText(undefined)).toBe("");
    expect(untrustedText("\u200B")).toBe("");
  });
});
```

`apps/web/components/run/model/takeover.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  HANDBACK_TIMEOUT_MS,
  IDLE_TAKEOVER,
  inControl,
  takeoverReducer,
  takeoverTimeoutMs,
  type TakeoverState,
} from "./takeover.ts";

const requesting = takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: false });
const releasing = takeoverReducer(IDLE_TAKEOVER, { type: "release" });

describe("takeover machine", () => {
  it("requests optimistically and confirms on control{user}", () => {
    expect(requesting).toMatchObject({ phase: "requesting", wake: false, notice: null });
    expect(inControl("agent", requesting)).toBe(true);
    expect(takeoverReducer(requesting, { type: "holder", holder: "user" })).toEqual(IDLE_TAKEOVER);
    expect(inControl("user", IDLE_TAKEOVER)).toBe(true);
  });

  it("fails at once on control{agent} or takeover_failed while requesting (A6, B6 §3)", () => {
    expect(takeoverReducer(requesting, { type: "holder", holder: "agent" })).toEqual({
      ...IDLE_TAKEOVER,
      notice: "failed",
    });
    expect(takeoverReducer(requesting, { type: "takeover_failed" }).notice).toBe("failed");
    expect(takeoverReducer(IDLE_TAKEOVER, { type: "takeover_failed" })).toBe(IDLE_TAKEOVER);
  });

  it("reverts on timeout, then re-applies a late control{user} with a notice (B6 E5)", () => {
    const timedOut = takeoverReducer(requesting, { type: "timeout" });
    expect(timedOut).toMatchObject({ phase: "idle", notice: "timed_out", timedOut: true });
    const seen = takeoverReducer(timedOut, { type: "seen" });
    expect(seen.notice).toBeNull();
    expect(takeoverReducer(seen, { type: "holder", holder: "user" })).toMatchObject({
      phase: "idle",
      notice: "now_in_control",
      timedOut: false,
    });
    expect(takeoverReducer(seen, { type: "holder", holder: "agent" }).timedOut).toBe(false);
  });

  it("reverts silently when the RPC itself fails (the view shows the code's copy)", () => {
    expect(takeoverReducer(requesting, { type: "request_failed" })).toEqual(IDLE_TAKEOVER);
  });

  it("waits 2s normally, 30s to wake a sleeping run, 5s for a hand back", () => {
    expect(takeoverTimeoutMs(requesting)).toBe(2_000);
    expect(takeoverTimeoutMs(takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: true }))).toBe(30_000);
    expect(takeoverTimeoutMs(releasing)).toBe(HANDBACK_TIMEOUT_MS);
    expect(takeoverTimeoutMs(IDLE_TAKEOVER)).toBeNull();
  });

  it("hands back optimistically and settles on control{agent}, failure or timeout", () => {
    expect(inControl("user", releasing)).toBe(false);
    for (const action of [
      { type: "holder", holder: "agent" },
      { type: "release_failed" },
      { type: "release_timeout" },
    ] as const) {
      expect(takeoverReducer(releasing, action)).toEqual(IDLE_TAKEOVER);
    }
  });

  it("ignores a request while releasing and a second request while requesting (Review Focus 2)", () => {
    expect(takeoverReducer(releasing, { type: "request", wake: false })).toBe(releasing);
    expect(takeoverReducer(requesting, { type: "request", wake: true })).toBe(requesting);
    const stale: TakeoverState = takeoverReducer(releasing, { type: "holder", holder: "user" });
    expect(stale).toBe(releasing);
  });
});
```

`apps/web/components/run/model/browser-state.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { rec, recordedDetail, recordedEvents, recordedSteps } from "@/lib/fixtures/run-recording.ts";
import { canTakeOver, deriveBrowserState, type ViewFlags } from "./browser-state.ts";
import { applyRunEvent, applyRunEvents, initRunModel } from "./run-model.ts";
import { IDLE_TAKEOVER, takeoverReducer } from "./takeover.ts";

const flags: ViewFlags = { connection: "open", takeover: IDLE_TAKEOVER, replaying: false, liveRetrying: false };
const model = (over = {}) => initRunModel(recordedDetail(over), recordedSteps());
const requesting = takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: false });

describe("deriveBrowserState", () => {
  it("is live while running and thinking, acting while an act step runs", () => {
    expect(deriveBrowserState(model(), flags)).toBe("live");
    expect(deriveBrowserState(applyRunEvent(model(), recordedEvents()[0]!), flags)).toBe("acting");
  });

  it("shows approval while one is pending, even if the run went to sleep", () => {
    const waiting = applyRunEvents(model(), recordedEvents());
    expect(deriveBrowserState(waiting, flags)).toBe("approval");
    const asleep = applyRunEvent(waiting, rec({ type: "status", status: "sleeping", waitReason: null, reason: null }));
    expect(deriveBrowserState(asleep, flags)).toBe("approval");
  });

  it("puts control above approval and reconnecting, and replay above everything (A5)", () => {
    const waiting = applyRunEvents(model(), recordedEvents());
    expect(deriveBrowserState(waiting, { ...flags, takeover: requesting })).toBe("control");
    expect(deriveBrowserState(model({ controller: "user" }), { ...flags, connection: "lost" })).toBe("control");
    expect(deriveBrowserState(model({ controller: "user" }), { ...flags, replaying: true })).toBe("replay");
  });

  it("is reconnecting when the stream or live frame is lost", () => {
    expect(deriveBrowserState(model(), { ...flags, connection: "lost" })).toBe("reconnecting");
    expect(deriveBrowserState(model(), { ...flags, liveRetrying: true })).toBe("reconnecting");
  });

  it("is paused when sleeping, queued, slot-less or finished, never reconnecting once finished", () => {
    expect(deriveBrowserState(model({ status: "sleeping", slotName: null }), flags)).toBe("paused");
    expect(deriveBrowserState(model({ status: "queued", slotName: null }), flags)).toBe("paused");
    expect(deriveBrowserState(model({ status: "completed" }), { ...flags, connection: "lost" })).toBe("paused");
  });
});

describe("canTakeOver", () => {
  it("allows live, acting, sleeping and approval-waiting runs held by the agent (A5, D19)", () => {
    expect(canTakeOver(model(), "live", IDLE_TAKEOVER)).toBe(true);
    expect(canTakeOver(model({ status: "sleeping", slotName: null }), "paused", IDLE_TAKEOVER)).toBe(true);
    expect(canTakeOver(applyRunEvents(model(), recordedEvents()), "approval", IDLE_TAKEOVER)).toBe(true);
  });

  it("refuses finished, queued, user-held, replaying or in-flight cases", () => {
    expect(canTakeOver(model({ status: "completed" }), "paused", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model({ status: "queued", slotName: null }), "paused", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model({ controller: "user" }), "control", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model(), "replay", IDLE_TAKEOVER)).toBe(false);
    expect(canTakeOver(model(), "live", takeoverReducer(IDLE_TAKEOVER, { type: "release" }))).toBe(false);
  });
});
```

`apps/web/components/run/model/copy.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { rec, recordedDetail, recordedEvents, recordedSteps } from "@/lib/fixtures/run-recording.ts";
import {
  INFO_ERROR_COPY,
  actNumber,
  captionFor,
  errorLine,
  handBackErrorCopy,
  hostAndPath,
  pageHost,
  markFor,
  pausedCopy,
  shortRunId,
  statusLabel,
  stepLabel,
  takeControlErrorCopy,
} from "./copy.ts";
import { applyRunEvent, applyRunEvents, initRunModel } from "./run-model.ts";
import { IDLE_TAKEOVER, takeoverReducer } from "./takeover.ts";

const model = (over = {}) => initRunModel(recordedDetail(over), recordedSteps());

describe("captions", () => {
  it("captions each state verb-first and cleans model captions", () => {
    expect(captionFor("live", model(), IDLE_TAKEOVER, null)).toBe("Thinking about the next step");
    const acting = applyRunEvent(model(), recordedEvents()[0]!);
    expect(captionFor("acting", acting, IDLE_TAKEOVER, null)).toBe("Ticking the Honor Code box");
    const waking = takeoverReducer(IDLE_TAKEOVER, { type: "request", wake: true });
    expect(captionFor("control", model(), waking, null)).toBe("Waking the browser so you can take control…");
    expect(captionFor("control", model({ controller: "user" }), IDLE_TAKEOVER, null)).toBe(
      "You're in control. Screenshots are off",
    );
    expect(captionFor("live", model({ status: "waiting", waitReason: "captcha" }), IDLE_TAKEOVER, null)).toBe(
      "Needs you: solve the CAPTCHA, then hand back",
    );
    const hostile = applyRunEvent(
      model(),
      rec({ type: "step", seq: 30, phase: "act", state: "started", caption: "Pay\u202E now\n\n", url: null, screenshotKey: null, action: null }),
    );
    expect(captionFor("acting", hostile, IDLE_TAKEOVER, null)).toBe("Pay now");
  });
});

describe("paused copy", () => {
  it("explains paused runs by status", () => {
    expect(pausedCopy(model({ status: "sleeping" }))).toEqual({
      title: "Paused",
      detail: "Sleeping. Context saved at step 5",
      canResume: true,
    });
    expect(pausedCopy(model({ status: "completed" })).title).toBe("Finished");
    expect(pausedCopy(model({ status: "queued" })).canResume).toBe(false);
  });

  it("states a failure by its real cause, never an informational error (A7)", () => {
    const failed = applyRunEvents(model(), [
      rec({ type: "error", code: "nav_timeout", message: "The page took too long" }),
      rec({ type: "error", code: "download_blocked", message: "cancelled" }),
      rec({ type: "status", status: "failed", waitReason: null, reason: null }),
    ]);
    expect(pausedCopy(failed)).toMatchObject({ title: "Stopped", detail: "The page took too long" });
    const onlyInfo = applyRunEvents(model(), [
      rec({ type: "error", code: "takeover_failed", message: "x" }),
      rec({ type: "status", status: "failed", waitReason: null, reason: null }),
    ]);
    expect(pausedCopy(onlyInfo).detail).toBe("Something went wrong");
  });
});

describe("labels", () => {
  it("labels status, step numbers and marks", () => {
    expect(statusLabel("approval", model())).toBe("Needs your approval");
    expect(stepLabel(model())).toBe("Step 5");
    expect(actNumber(model(), 8)).toBe(5);
    expect(markFor("paused", model({ status: "completed" }))).toBe("done");
    expect(markFor("live", model())).toBe("running");
    expect(markFor("paused", model({ status: "sleeping" }))).toBe("pending");
    expect(shortRunId("0b4c2a1e-5d6f-4a8b-9c0d-1e2f3a4b5c6d")).toBe("run_0b4c2a1e");
  });

  it("words informational errors and takeover RPC failures", () => {
    expect(INFO_ERROR_COPY["download_blocked"]).toBe("Take over to download files.");
    expect(errorLine({ eventId: "1", code: "x", message: "Bad\u202E thing", at: "" })).toBe("Bad thing");
    expect(takeControlErrorCopy("FORBIDDEN")).toBe("Someone else is in control of this browser.");
    expect(takeControlErrorCopy("CONFLICT")).toBe("This run has finished, so there is nothing to take over.");
    expect(takeControlErrorCopy(null)).toBe("Couldn't take control. Try again.");
    expect(handBackErrorCopy("FORBIDDEN")).toBe("Someone else is in control, so only they can hand back.");
    expect(handBackErrorCopy(null)).toBe("Couldn't hand back. You're still in control.");
  });
});

describe("URLs (S7)", () => {
  it("keeps the full hostname and puts only the path through the cleaner", () => {
    expect(hostAndPath("https://www.learn.example.edu/a/b?c=1")).toEqual({
      host: "www.learn.example.edu",
      path: "/a/b?c=1",
      secure: true,
    });
    expect(hostAndPath("https://evil.example/learn.example.edu/login")).toMatchObject({
      host: "evil.example",
      path: "/learn.example.edu/login",
    });
    expect(hostAndPath("https://ex\u0430mple.com/")?.host).toMatch(/^xn--/);
    expect(hostAndPath("javascript:alert(1)")).toBeNull();
    expect(hostAndPath("not a url")).toBeNull();
    expect(pageHost("https://learn.example.edu:8443/x")).toBe("learn.example.edu:8443");
  });
});
```

`apps/web/components/run/model/approval-copy.test.ts`:
```ts
import { ApprovalRequest, DEFAULT_BUDGET, EMPTY_USAGE } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { MAX_LABEL, approvalCopy, requestSummary } from "./approval-copy.ts";

const url = "https://learn.example.edu/course/week-2/lecture-3";
const risky = (over: Record<string, unknown>) =>
  ApprovalRequest.parse({
    kind: "risky_click",
    action: { type: "click", x: 1000, y: 610, button: "left" },
    label: "Start quiz",
    url,
    screenshotKey: null,
    ...over,
  });

describe("approvalCopy: risky clicks by action type (A2)", () => {
  it("titles a click, spotlights its point and quotes the record context (A3)", () => {
    const copy = approvalCopy(risky({ context: "Delete — Alice\u202E Smith" }));
    expect(copy.title).toBe("Click “Start quiz” on learn.example.edu?");
    expect(copy.spotlight).toEqual({ x: 1000, y: 610 });
    expect(copy.context).toBe("Delete — Alice Smith");
    expect(copy.tone).toBe("signal");
    expect(requestSummary(risky({}))).toBe("click “Start quiz”");
  });

  it("names a keypress as a key, with no spotlight", () => {
    const copy = approvalCopy(risky({ action: { type: "keypress", keys: ["ENTER"] }, label: "Pay" }));
    expect(copy.title).toBe("Press Enter on learn.example.edu?");
    expect(copy.spotlight).toBeNull();
  });

  it("names typing as typing", () => {
    expect(approvalCopy(risky({ action: { type: "type", text: "x" }, label: "" })).title).toBe(
      "Type into the page on learn.example.edu?",
    );
  });

  it("shows a model safety check as a flagged step with every cleaned message (Review Focus 7)", () => {
    const copy = approvalCopy(
      risky({
        action: { type: "keypress", keys: ["ENTER"] },
        label: "Safety check: The page asks to ignore you",
        safetyChecks: [
          { code: "malicious_instructions", message: "The page asks to\u200B ignore your instructions" },
          { code: "irrelevant_domain", message: null },
        ],
      }),
    );
    expect(copy.title).toBe("The model flagged this step");
    expect(copy.checks).toEqual(["The page asks to ignore your instructions", "irrelevant_domain"]);
    expect(copy.tone).toBe("warn");
    expect(copy.risk).toBe("The page may be trying to steer the agent. Deny unless you expected this.");
    expect(copy.spotlight).toBeNull();
    expect(copy.body).not.toContain("Safety check:");
  });

  it("truncates hostile labels and strips invisible characters (Review Focus 4)", () => {
    const copy = approvalCopy(risky({ label: `Pay\u200B${"x".repeat(400)}` }));
    expect(copy.title.length).toBeLessThan(MAX_LABEL + 40);
    expect(copy.title).not.toContain("\u200B");
    expect(copy.title).toContain("…");
  });
});

describe("approvalCopy: the other kinds", () => {
  it("covers form submits, with the trigger and context", () => {
    const copy = approvalCopy(
      ApprovalRequest.parse({
        kind: "form_submit",
        action: { type: "keypress", keys: ["ENTER"] },
        url,
        formSummary: "Honor Code form",
        screenshotKey: null,
        context: "Quiz attempt",
      }),
    );
    expect(copy.title).toBe("Submit a form on learn.example.edu?");
    expect(copy.body).toBe("Honor Code form");
    expect(copy.details).toContainEqual(["Trigger", "Press Enter"]);
    expect(copy.context).toBe("Quiz attempt");
  });

  it("covers downloads, first sign-ins, new origins and budgets", () => {
    expect(approvalCopy({ kind: "download", url, filename: "\u202Egpj.exe" }).title).toBe("Download gpj.exe?");
    expect(
      approvalCopy({ kind: "credential_first_use", alias: "ada-learn", origin: "https://learn.example.edu" }).title,
    ).toBe("Sign in to learn.example.edu as ada-learn?");
    expect(
      approvalCopy({ kind: "new_origin", origin: "https://docs.example.org", url: "https://docs.example.org/x" }).title,
    ).toBe("Open docs.example.org?");
    const budget = approvalCopy({
      kind: "budget",
      exceeded: "usd",
      usage: { ...EMPTY_USAGE, usd: 5 },
      budget: DEFAULT_BUDGET,
    });
    expect(budget).toMatchObject({ title: "Spend limit reached", budget: true });
    expect(budget.body).toContain("$5.00 of $5.00");
  });
});
```

`apps/web/components/run/model/timeline-items.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  RECORDED_APPROVAL_ID,
  rec,
  recordedDetail,
  recordedEvents,
  recordedSteps,
} from "@/lib/fixtures/run-recording.ts";
import { applyRunEvent, applyRunEvents, initRunModel } from "./run-model.ts";
import { elapsedClock, summaryLabel, thinkingState, timelineItems } from "./timeline-items.ts";

const VIEWER = "fixture-user";
const base = () => initRunModel(recordedDetail(), recordedSteps());
const resolved = (status: "approved" | "denied" | "superseded", decidedBy: string) =>
  rec({ type: "approval_resolved", approvalId: RECORDED_APPROVAL_ID, status, decidedBy });

describe("timelineItems", () => {
  it("lists act and approve steps; an unpointered computer step says Act (W1)", () => {
    const items = timelineItems(applyRunEvents(base(), recordedEvents()), [], VIEWER);
    const steps = items.filter((i) => i.kind === "step");
    expect(steps.map((s) => (s.kind === "step" ? s.verb : ""))).toEqual([
      "Click", "Fill", "Act", "Capture", "Capture", "Click", "Approve",
    ]);
    const fill = steps[1];
    expect(fill?.kind === "step" && fill.credential).toBe(true);
    const approve = steps.at(-1);
    expect(approve?.kind === "step" && approve.status).toBe("pending");
    expect(approve?.kind === "step" && approve.current).toBe(true);
  });

  it("says You only for the viewer, Someone else for another member, policy for policy (A4)", () => {
    const line = (status: "approved" | "denied" | "superseded", by: string) => {
      const model = applyRunEvents(base(), [...recordedEvents(), resolved(status, by)]);
      const d = timelineItems(model, [], VIEWER).find((i) => i.kind === "decision");
      return d?.kind === "decision" ? d.line : null;
    };
    expect(line("denied", VIEWER)).toBe("You denied: click “Start quiz”");
    expect(line("approved", "someone-else")).toBe("Someone else approved: click “Start quiz”");
    expect(line("approved", "policy")).toBe("Approved by policy: click “Start quiz”");
    expect(line("superseded", "agent")).toBe("No longer needed: click “Start quiz”");
  });

  it("merges messages, decisions, downloads and notices in time order, cleaning page text", () => {
    const model = applyRunEvents(base(), [
      ...recordedEvents(),
      resolved("denied", VIEWER),
      rec({ type: "user_message", text: "Skip it" }),
      rec({ type: "download_ready", downloadId: RECORDED_APPROVAL_ID, assetId: RECORDED_APPROVAL_ID, filename: "\u202Egpj.exe", bytes: 1 }),
      rec({ type: "error", code: "download_blocked", message: "cancelled" }),
    ]);
    const items = timelineItems(model, [], VIEWER);
    expect(items.slice(-4).map((i) => i.kind)).toEqual(["decision", "message", "download", "notice"]);
    const download = items.find((i) => i.kind === "download");
    expect(download?.kind === "download" && download.line).toBe("Downloaded gpj.exe");
    const notice = items.at(-1);
    expect(notice).toMatchObject({ kind: "notice", tone: "info", line: "Take over to download files." });
  });

  it("shows pending messages until their SSE echo arrives", () => {
    const model = base();
    const pending = [{ key: "k1", text: "Skip it", afterEventId: model.lastEventId }];
    expect(timelineItems(model, pending, VIEWER).filter((i) => i.kind === "message")).toMatchObject([
      { pending: true },
    ]);
    const echoed = applyRunEvent(model, rec({ type: "user_message", text: "Skip it" }));
    expect(timelineItems(echoed, pending, VIEWER).filter((i) => i.kind === "message")).toMatchObject([
      { pending: false },
    ]);
  });

  it("reports thinking, then settles while acting", () => {
    expect(thinkingState(base())).toMatchObject({ working: true, label: "Thinking about the next step" });
    expect(thinkingState(applyRunEvent(base(), recordedEvents()[0]!))?.working).toBe(false);
    expect(thinkingState(initRunModel(recordedDetail({ status: "completed" }), recordedSteps()))).toBeNull();
  });

  it("summarises steps and captures and formats run-relative clocks", () => {
    expect(summaryLabel(base())).toBe("5 steps · 2 captures");
    expect(elapsedClock("2026-10-05T17:04:00.000Z", "2026-10-05T17:10:06.000Z")).toBe("06:06");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test apps/web/components/run/model`
Expected: FAIL, because the five new modules are not found.

- [ ] **Step 3: Implement.**

`apps/web/components/run/model/untrusted-text.ts`:
```ts
/**
 * Page- and model-derived text is untrusted (spec §5.5; CLAUDE.md principle 3). This is the one
 * cleaner for every surface that shows it (S6): NFKC, no format characters (bidi overrides,
 * isolates, zero-width), control characters become spaces, whitespace collapses, and the result
 * is capped by code point. Callers render it inside <bdi> so it cannot reorder our own text.
 */
export const MAX_UNTRUSTED = 300;

export function untrustedText(text: string | null | undefined, max: number = MAX_UNTRUSTED): string {
  if (!text) return "";
  const clean = text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : clean;
}
```

`apps/web/components/run/model/takeover.ts`:
```ts
import type { Controller } from "@mastertutor/contracts";

/** Spec §10.3: the UI flips at once and reverts if control{user} has not arrived in time. */
export const TAKEOVER_TIMEOUT_MS = 2_000;
/** A sleeping run must wake and lease a slot before it can hand over. */
export const WAKE_TAKEOVER_TIMEOUT_MS = 30_000;
/** A hand back that never sees control{agent} re-reads the run after this (A6). */
export const HANDBACK_TIMEOUT_MS = 5_000;

export type TakeoverPhase = "idle" | "requesting" | "releasing";
/** Shown once by the view, then cleared with {type: "seen"}. */
export type TakeoverNotice = "failed" | "timed_out" | "now_in_control";

export interface TakeoverState {
  phase: TakeoverPhase;
  wake: boolean;
  notice: TakeoverNotice | null;
  /** The last request timed out; a late control{user} re-applies control (B6 E5). */
  timedOut: boolean;
}

export type TakeoverAction =
  | { type: "request"; wake: boolean }
  | { type: "holder"; holder: Controller }
  | { type: "takeover_failed" }
  | { type: "timeout" }
  | { type: "request_failed" }
  | { type: "release" }
  | { type: "release_failed" }
  | { type: "release_timeout" }
  | { type: "seen" };

export const IDLE_TAKEOVER: TakeoverState = {
  phase: "idle",
  wake: false,
  notice: null,
  timedOut: false,
};

export function takeoverReducer(state: TakeoverState, action: TakeoverAction): TakeoverState {
  switch (action.type) {
    case "request":
      return state.phase === "idle"
        ? { phase: "requesting", wake: action.wake, notice: null, timedOut: false }
        : state;
    case "holder":
      if (state.phase === "requesting") {
        return action.holder === "user" ? IDLE_TAKEOVER : { ...IDLE_TAKEOVER, notice: "failed" };
      }
      if (state.phase === "releasing") return action.holder === "agent" ? IDLE_TAKEOVER : state;
      if (!state.timedOut) return state;
      return action.holder === "user"
        ? { ...IDLE_TAKEOVER, notice: "now_in_control" }
        : { ...state, timedOut: false };
    case "takeover_failed":
      return state.phase === "requesting" ? { ...IDLE_TAKEOVER, notice: "failed" } : state;
    case "timeout":
      return state.phase === "requesting"
        ? { ...IDLE_TAKEOVER, notice: "timed_out", timedOut: true }
        : state;
    case "request_failed":
      return state.phase === "requesting" ? IDLE_TAKEOVER : state;
    case "release":
      return state.phase === "idle" ? { ...IDLE_TAKEOVER, phase: "releasing" } : state;
    case "release_failed":
    case "release_timeout":
      return state.phase === "releasing" ? IDLE_TAKEOVER : state;
    case "seen":
      return state.notice === null ? state : { ...state, notice: null };
  }
}

/** Effective control as the UI shows it: optimistic in both directions. */
export function inControl(controller: Controller, state: TakeoverState): boolean {
  if (state.phase === "requesting") return true;
  if (state.phase === "releasing") return false;
  return controller === "user";
}

export function takeoverTimeoutMs(state: TakeoverState): number | null {
  if (state.phase === "requesting") return state.wake ? WAKE_TAKEOVER_TIMEOUT_MS : TAKEOVER_TIMEOUT_MS;
  if (state.phase === "releasing") return HANDBACK_TIMEOUT_MS;
  return null;
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

/** D19: take over at any time, including while an approval waits (A5; B3 E R-E15 supersedes it). */
export function canTakeOver(model: RunModel, state: BrowserState, takeover: TakeoverState): boolean {
  return (
    !isTerminal(model.status) &&
    model.status !== "queued" &&
    model.controller === "agent" &&
    takeover.phase === "idle" &&
    (state === "live" || state === "acting" || state === "approval" || state === "paused")
  );
}
```

`apps/web/components/run/model/copy.ts`:
```ts
import { safePageUrl } from "@/lib/notes/provenance.ts";
import type { StatusMarkStatus } from "../../bits/status-mark.tsx";
import type { BrowserState } from "./browser-state.ts";
import { failureOf, latestStep, type RunError, type RunModel, type StepRow } from "./run-model.ts";
import type { TakeoverNotice, TakeoverState } from "./takeover.ts";
import { untrustedText } from "./untrusted-text.ts";

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

export interface UrlParts {
  /** As the URL parser returns it: lower case, punycode, with any port. Never truncated (S7). */
  host: string;
  /** Path and query, cleaned and capped; the view truncates this first. */
  path: string;
  secure: boolean;
}

export function hostAndPath(url: string | null): UrlParts | null {
  const parsed = url ? safePageUrl(url) : null;
  if (!parsed) return null;
  return {
    host: parsed.host,
    path: untrustedText(`${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`, 200),
    secure: parsed.protocol === "https:",
  };
}

/**
 * The host alone, for approval titles. Unlike lib/notes/format.ts `hostOf` (note sources), it keeps
 * `www.` and the port, because here the host is the security signal (S7).
 */
export function pageHost(url: string): string {
  return hostAndPath(url)?.host ?? untrustedText(url, 60);
}

export function actCount(model: RunModel): number {
  return model.steps.filter((s) => s.phase === "act").length;
}

export function actNumber(model: RunModel, seq: number): number {
  return model.steps.filter((s) => s.phase === "act" && s.seq <= seq).length;
}

/** Informational run errors (B6 §8): shown as toasts and timeline notices, never as the failure. */
export const INFO_ERROR_COPY: Readonly<Record<string, string>> = {
  takeover_failed: "Couldn't take control. The agent kept it.",
  idle_hand_back: "You were idle for 15 minutes, so the agent took the controls back.",
  download_blocked: "Take over to download files.",
  download_too_large: "That download was too large to keep.",
};

export function errorLine(error: RunError): string {
  return INFO_ERROR_COPY[error.code] ?? (untrustedText(error.message, 200) || "Something went wrong");
}

export const TAKEOVER_NOTICE: Record<TakeoverNotice, string> = {
  failed: "Couldn't take control. The agent kept it.",
  timed_out: "The browser didn't respond, so the agent still has control.",
  now_in_control: "You're in control now.",
};

/** B6 A9 codes: FORBIDDEN = another member holds control; CONFLICT = the run has finished. */
export function takeControlErrorCopy(code: string | null): string {
  if (code === "FORBIDDEN") return "Someone else is in control of this browser.";
  if (code === "CONFLICT") return "This run has finished, so there is nothing to take over.";
  return "Couldn't take control. Try again.";
}

export function handBackErrorCopy(code: string | null): string {
  if (code === "FORBIDDEN") return "Someone else is in control, so only they can hand back.";
  return "Couldn't hand back. You're still in control.";
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
        detail: model.filedPath
          ? `Filed in ${model.filedPath.map((p) => untrustedText(p, 60)).join(" › ")}`
          : "The note is in your library",
        canResume: false,
      };
    case "failed":
      return {
        title: "Stopped",
        detail: untrustedText(failureOf(model)?.message, 160) || "Something went wrong",
        canResume: false,
      };
    case "cancelled":
      return { title: "Cancelled", detail: "This run was stopped", canResume: false };
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
      return untrustedText(replayStep?.caption, 160) || "Replaying";
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
      return untrustedText(latestStep(model)?.caption, 160) || "Working";
    case "live": {
      if (model.status === "waiting" && model.waitReason === "captcha") {
        return "Needs you: solve the CAPTCHA, then hand back";
      }
      if (model.status === "waiting" && model.waitReason === "takeover") {
        return "Needs you: the agent is stuck. Take over to help";
      }
      if (model.status === "waiting" && model.waitReason === "otp") return "Waiting for the code sent to you";
      const last = latestStep(model);
      const thinking = last && (last.phase === "observe" || last.phase === "decide") && last.state === "started";
      return (thinking ? untrustedText(last.caption, 160) : "") || "Thinking about the next step";
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

export function shortRunId(runId: string): string {
  return `run_${runId.slice(0, 8)}`;
}
```

`apps/web/components/run/model/approval-copy.ts`:
```ts
import type { ApprovalRequest, ComputerAction } from "@mastertutor/contracts";
import { pageHost } from "./copy.ts";
import { untrustedText } from "./untrusted-text.ts";

/** Page-derived labels are untrusted (spec §5.5): cleaned and capped. */
export const MAX_LABEL = 120;
/** The record excerpt the agent read under the target (R29-3, B3 E R-E14). */
export const MAX_CONTEXT = 240;
/** The safety-check code for a page that may be steering the agent (prompt injection). */
export const INJECTION_CHECK = "malicious_instructions";

export interface ApprovalCopy {
  title: string;
  body: string;
  tone: "signal" | "warn";
  risk: string | null;
  /** The model's safety-check messages, cleaned; empty unless the request is a safety check. */
  checks: readonly string[];
  /** "On this record": the cleaned excerpt, or null. */
  context: string | null;
  details: readonly (readonly [string, string])[];
  /** In 1280×800 viewport space; only for actions that point somewhere. */
  spotlight: { x: number; y: number } | null;
  budget: boolean;
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ENTER: "Enter",
  RETURN: "Enter",
  SPACE: "Space",
  TAB: "Tab",
  ESC: "Esc",
  ESCAPE: "Esc",
  BACKSPACE: "Backspace",
  DELETE: "Delete",
};
const keyName = (key: string) => KEY_NAMES[key.toUpperCase()] ?? untrustedText(key, 16);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** What the action does, verb first ("Click “Delete”", "Press Enter"). Labels are page text. */
export function actionPhrase(action: ComputerAction, label: string | null): string {
  const target = label ? ` “${untrustedText(label, MAX_LABEL)}”` : "";
  switch (action.type) {
    case "click":
    case "double_click":
      return `Click${target}`;
    case "keypress":
      return `Press ${action.keys.map(keyName).join("+")}`;
    case "type":
      return "Type into the page";
    case "scroll":
      return "Scroll the page";
    case "drag":
      return "Drag on the page";
    case "move":
      return "Move the pointer";
    case "wait":
    case "screenshot":
      return "Continue";
  }
}

/** Only actions aimed at one point are spotlit (A2). */
export function pointOf(action: ComputerAction | undefined): { x: number; y: number } | null {
  if (!action) return null;
  switch (action.type) {
    case "click":
    case "double_click":
    case "move":
    case "scroll":
      return { x: action.x, y: action.y };
    default:
      return null;
  }
}

const EXCEEDED = { steps: "Step", usd: "Spend", minutes: "Time" } as const;
const pageDetail = (url: string) => ["Page", untrustedText(url, 300)] as const;

export function requestSummary(request: ApprovalRequest): string {
  switch (request.kind) {
    case "risky_click":
      return request.safetyChecks?.length
        ? "a step the model flagged"
        : lowerFirst(actionPhrase(request.action, request.label || null));
    case "form_submit":
      return `submit a form on ${pageHost(request.url)}`;
    case "download":
      return `download ${untrustedText(request.filename, MAX_LABEL) || "a file"}`;
    case "credential_first_use":
      return `sign in as ${untrustedText(request.alias, 64)}`;
    case "new_origin":
      return `open ${pageHost(request.origin)}`;
    case "budget":
      return `${EXCEEDED[request.exceeded].toLowerCase()} budget`;
  }
}

export function approvalCopy(request: ApprovalRequest): ApprovalCopy {
  const none = { tone: "signal", risk: null, checks: [], context: null, spotlight: null, budget: false } as const;
  switch (request.kind) {
    case "risky_click": {
      const host = pageHost(request.url);
      const context = untrustedText(request.context, MAX_CONTEXT) || null;
      const spotlight = pointOf(request.action);
      if (request.safetyChecks?.length) {
        const injected = request.safetyChecks.some((c) => c.code === INJECTION_CHECK);
        return {
          ...none,
          title: "The model flagged this step",
          body: `It wants to ${lowerFirst(actionPhrase(request.action, null))} on ${host}. Read the warning before you decide.`,
          tone: "warn",
          risk: injected
            ? "The page may be trying to steer the agent. Deny unless you expected this."
            : "Check the warning before you approve.",
          checks: request.safetyChecks
            .map((c) => untrustedText(c.message ?? c.code, 300))
            .filter((text) => text !== ""),
          context,
          details: [pageDetail(request.url)],
          spotlight: null,
        };
      }
      return {
        ...none,
        title: `${actionPhrase(request.action, request.label || null)} on ${host}?`,
        body: "This could buy, send, delete or submit something on your behalf.",
        risk: "It might not be undoable.",
        context,
        details: [pageDetail(request.url)],
        spotlight,
      };
    }
    case "form_submit": {
      const details: (readonly [string, string])[] = [pageDetail(request.url)];
      if (request.action) details.push(["Trigger", actionPhrase(request.action, null)]);
      return {
        ...none,
        title: `Submit a form on ${pageHost(request.url)}?`,
        body: untrustedText(request.formSummary, 300) || "The agent wants to submit this form.",
        context: untrustedText(request.context, MAX_CONTEXT) || null,
        details,
        spotlight: pointOf(request.action),
      };
    }
    case "download":
      return {
        ...none,
        title: `Download ${untrustedText(request.filename, MAX_LABEL) || "a file"}?`,
        body: `From ${pageHost(request.url)}. Downloads are kept with the run, not on your computer.`,
        details: [["Link", untrustedText(request.url, 300)]],
      };
    case "credential_first_use":
      return {
        ...none,
        title: `Sign in to ${pageHost(request.origin)} as ${untrustedText(request.alias, 64)}?`,
        body: "The vault fills the sign-in. The agent only sees the alias, never the values.",
        details: [
          ["Site", request.origin],
          ["Alias", untrustedText(request.alias, 64)],
        ],
      };
    case "new_origin":
      return {
        ...none,
        title: `Open ${pageHost(request.origin)}?`,
        body: "It's outside the domains you allowed for this run.",
        details: [
          ["Origin", request.origin],
          pageDetail(request.url),
        ],
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
        ...none,
        title: `${EXCEEDED[request.exceeded]} limit reached`,
        body: `Used ${used}. Extend by 50%, finish with what's captured, or cancel the run.`,
        details: [],
        budget: true,
      };
    }
  }
}
```

`apps/web/components/run/model/timeline-items.ts`:
```ts
import { POLICY_DECIDER, compareEventIds } from "@mastertutor/contracts";
import type { StatusMarkStatus } from "../../bits/status-mark.tsx";
import { requestSummary } from "./approval-copy.ts";
import { errorLine } from "./copy.ts";
import {
  captureCount,
  isInformational,
  isTerminal,
  type ApprovalOutcome,
  type RunModel,
  type StepRow,
} from "./run-model.ts";
import { untrustedText } from "./untrusted-text.ts";

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
  | { kind: "download"; key: string; line: string; ts: string; at: string }
  | { kind: "notice"; key: string; line: string; tone: "info" | "warn"; ts: string; at: string };

export interface ThinkingState {
  label: string;
  since: string;
  working: boolean;
}

const VERBS: Readonly<Record<string, string>> = {
  read_page: "Read",
  capture: "Capture",
  fill_credential: "Fill",
  use_passkey: "Passkey",
  video: "Video",
  annotate: "Note",
};

/** A computer step without `pointer` (recorded before A1 landed, or a keyboard action) says "Act". */
function verbFor(step: StepRow): string {
  if (step.phase === "approve") return "Approve";
  const tool = step.action?.tool;
  if (tool === "computer") {
    const pointer = step.action?.pointer;
    if (pointer === "scroll") return "Scroll";
    if (pointer === "click" || pointer === "double_click") return "Click";
    return "Act";
  }
  return (tool && VERBS[tool]) ?? "Act";
}

function stepStatus(step: StepRow): StatusMarkStatus {
  if (step.state === "done") return "done";
  if (step.state === "aborted" || step.state === "skipped") return "cancelled";
  return step.phase === "approve" ? "pending" : "running";
}

/** "You" only for the viewer; another member is "Someone else"; policy is named (A4, D4). */
function decisionLine(outcome: ApprovalOutcome, viewerId: string | null): string {
  let lead: string;
  if (outcome.status === "superseded" || outcome.status === "pending") {
    lead = "No longer needed";
  } else {
    const policy = outcome.decidedBy === POLICY_DECIDER;
    const who = viewerId !== null && outcome.decidedBy === viewerId ? "You" : "Someone else";
    lead =
      outcome.status === "approved"
        ? policy ? "Approved by policy" : `${who} approved`
        : outcome.status === "denied"
          ? policy ? "Blocked by policy" : `${who} denied`
          : `${who} redirected`;
  }
  return outcome.request ? `${lead}: ${requestSummary(outcome.request)}` : lead;
}

export function elapsedClock(from: string, at: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(at) - Date.parse(from)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function timelineItems(
  model: RunModel,
  pending: readonly PendingMessage[],
  viewerId: string | null,
): TimelineItem[] {
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
      line: untrustedText(step.action?.summary ?? step.caption, 200) || `Step ${step.seq}`,
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
      line: decisionLine(o, viewerId),
      status: o.status === "approved" || o.status === "edited" ? "done" : "cancelled",
      ts: clock(o.at),
      at: o.at,
    });
  }
  for (const d of model.downloads) {
    items.push({
      kind: "download",
      key: `download-${d.id}`,
      line: `Downloaded ${untrustedText(d.filename, 120) || "a file"}`,
      ts: clock(d.at),
      at: d.at,
    });
  }
  for (const e of model.errors) {
    items.push({
      kind: "notice",
      key: `error-${e.eventId}`,
      line: errorLine(e),
      tone: isInformational(e.code) ? "info" : "warn",
      ts: clock(e.at),
      at: e.at,
    });
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
    return { label: untrustedText(last.caption, 160) || "Thinking about the next step", since: last.at, working: true };
  }
  return { label: "Thinking about the next step", since: last?.at ?? model.createdAt, working: true };
}

export function summaryLabel(model: RunModel): string {
  const steps = model.steps.filter((s) => s.phase === "act").length;
  const captures = captureCount(model);
  return `${steps} ${steps === 1 ? "step" : "steps"} · ${captures} ${captures === 1 ? "capture" : "captures"}`;
}
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/components/run/model && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run/model
git add apps/web/components/run/model
git commit -m "feat(web): takeover machine, state derivation, untrusted text, approval and timeline copy (A2-A7, S6, S7)"
```

---

### Task 7: SSE client and the `useRun` hook — **Changed** (E3, A6, A9, P1, X6)

**What stays:**
- `apps/web/components/run/stream/run-events.ts`, as base Task 7 Step 3, verbatim.
- `run-events.test.ts`, as base Task 7 Step 1, except its fixture import. Replace `import { RUN_ID, recordedEvents } from "../../../e2e/fixtures/run-fixture.ts";` with:
```ts
import { RECORDED_RUN_ID as RUN_ID, recordedEvents } from "@/lib/fixtures/run-recording.ts";
```
- Its assertions still hold: `recordedEvents()[2]` is id `15`, and the snapshot id is `12`.

**What changes:**
- **`use-run.ts` is replaced.** It uses the shared `api`; buffers SSE records and applies them once per animation frame (A9, P1); exposes `resync()` (A6); and keeps the query cache honest (X6).
- **New `query-sync.ts`.** It holds the cache rule, as a pure function with its own test.

**Files:**
- Create: `apps/web/components/run/stream/run-events.ts`, `run-events.test.ts` (as above), `apps/web/components/run/stream/query-sync.ts`, `query-sync.test.ts`, `apps/web/components/run/stream/use-run.ts`

**Interfaces:**
- Consumes: `api` and `orpc` (`@/lib/api/client.ts`); `runEventsPath`, `decodeRunEventData` and `RUN_EVENT_SSE_NAME` (Task 2); `applyRunEvents`, `syncRunModel` and `initRunModel` (Task 5).
- Produces:
  - from `run-events.ts`: `LOST_GRACE_MS`, `reconnectDelayMs` and `connectRunEvents` (base);
  - `syncRunQueries(qc: QueryClient, runId: string, records: readonly RunEventRecord[]): void`;
  - `useRun(runId): { model: RunModel | null; connection: Connection; loadError: boolean; resync(): void }`.

- [ ] **Step 1: Write the failing tests.**

Create `run-events.test.ts` as described above, then `apps/web/components/run/stream/query-sync.test.ts`:
```ts
import type { RunDetail, RunSummary } from "@mastertutor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { orpc } from "@/lib/api/client.ts";
import { RECORDED_RUN_ID, rec, recordedDetail } from "@/lib/fixtures/run-recording.ts";
import { syncRunQueries } from "./query-sync.ts";

const getKey = orpc.runs.get.queryKey({ input: { runId: RECORDED_RUN_ID } });
const listKey = orpc.runs.list.queryKey({ input: { status: "running", limit: 20 } });

function seeded() {
  const qc = new QueryClient();
  qc.setQueryData<RunDetail>(getKey, recordedDetail());
  qc.setQueryData(listKey, { items: [] as RunSummary[], nextCursor: null });
  return qc;
}

describe("syncRunQueries (delight X6, I3)", () => {
  it("patches a cached runs.get when the run finishes and invalidates every runs.list", () => {
    const qc = seeded();
    syncRunQueries(qc, RECORDED_RUN_ID, [
      rec({ type: "status", status: "completed", waitReason: null, reason: null }),
    ]);
    expect(qc.getQueryData<RunDetail>(getKey)?.status).toBe("completed");
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("invalidates the lists but leaves runs.get alone for a non-terminal status", () => {
    const qc = seeded();
    syncRunQueries(qc, RECORDED_RUN_ID, [
      rec({ type: "status", status: "waiting", waitReason: "approval", reason: null }),
    ]);
    expect(qc.getQueryData<RunDetail>(getKey)?.status).toBe("running");
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("does nothing for a batch without a status event", () => {
    const qc = seeded();
    syncRunQueries(qc, RECORDED_RUN_ID, [rec({ type: "user_message", text: "hi" })]);
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test apps/web/components/run/stream`
Expected: FAIL, because `./run-events.ts` and `./query-sync.ts` are not found.

- [ ] **Step 3: Implement.**

Create `run-events.ts` verbatim from base Task 7 Step 3.

`apps/web/components/run/stream/query-sync.ts`:
```ts
import type { RunDetail, RunEventRecord, RunEvent } from "@mastertutor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api/client.ts";
import { isTerminal } from "../model/run-model.ts";

type StatusEvent = Extract<RunEvent, { type: "status" }>;

/**
 * Keeps other screens' run queries honest from the stream, without polling (delight X6):
 * any status change invalidates every runs.list (the sidebar badge refetches), and a terminal
 * status patches a cached runs.get, so useRunPulse never reads a stale "running" (delight I3).
 */
export function syncRunQueries(
  qc: QueryClient,
  runId: string,
  records: readonly RunEventRecord[],
): void {
  let status: StatusEvent | null = null;
  for (const record of records) {
    if (record.runId === runId && record.event.type === "status") status = record.event;
  }
  if (status === null) return;
  void qc.invalidateQueries({ queryKey: orpc.runs.list.key() });
  if (!isTerminal(status.status)) return;
  const finished = status;
  qc.setQueryData<RunDetail>(orpc.runs.get.queryKey({ input: { runId } }), (old) =>
    old ? { ...old, status: finished.status, waitReason: finished.waitReason } : old,
  );
}
```

`apps/web/components/run/stream/use-run.ts`:
```ts
"use client";

import type { RunDetail, RunEventRecord, RunStepView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { Connection } from "../model/browser-state.ts";
import {
  applyRunEvents,
  initRunModel,
  isTerminal,
  syncRunModel,
  type RunModel,
} from "../model/run-model.ts";
import { syncRunQueries } from "./query-sync.ts";
import { connectRunEvents } from "./run-events.ts";

const STEP_PAGE = 500;

type Action =
  | { type: "init"; model: RunModel }
  | { type: "events"; records: RunEventRecord[] }
  | { type: "sync"; detail: RunDetail };

function reducer(state: RunModel | null, action: Action): RunModel | null {
  if (action.type === "init") return action.model;
  if (state === null) return null;
  return action.type === "events"
    ? applyRunEvents(state, action.records)
    : syncRunModel(state, action.detail);
}

async function loadAllSteps(runId: string): Promise<RunStepView[]> {
  const all: RunStepView[] = [];
  let afterSeq: number | null = null;
  for (;;) {
    const { items } = await api.runs.steps({ runId, afterSeq, limit: STEP_PAGE });
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
  /** Re-reads runs.get and settles controller, status and slot on it (A6). */
  resync(): void;
}

/**
 * Snapshot (runs.get + runs.steps), then the SSE stream from the snapshot's lastEventId. Records
 * are applied once per animation frame: a policy's approval_requested + approval_resolved pair
 * lands in one render, so the sheet never mounts and never steals focus (A9).
 */
export function useRun(runId: string): RunHandle {
  const qc = useQueryClient();
  const [model, dispatch] = useReducer(reducer, null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [loadError, setLoadError] = useState(false);
  const [after, setAfter] = useState<{ id: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.runs.get({ runId }), loadAllSteps(runId)]).then(
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
    if (after === null || terminal) return undefined;
    let queue: RunEventRecord[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const records = queue;
      queue = [];
      if (records.length === 0) return;
      dispatch({ type: "events", records });
      syncRunQueries(qc, runId, records);
    };
    const stream = connectRunEvents({
      runId,
      after: after.id,
      onRecord: (record) => {
        queue.push(record);
        if (frame === 0) frame = requestAnimationFrame(flush);
      },
      onConnection: setConnection,
    });
    return () => {
      stream.close();
      cancelAnimationFrame(frame);
      flush();
    };
  }, [runId, after, terminal, qc]);

  const resync = useCallback(() => {
    api.runs.get({ runId }).then(
      (detail) => dispatch({ type: "sync", detail }),
      () => undefined,
    );
  }, [runId]);

  return { model, connection, loadError, resync };
}
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/components/run/stream && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run/stream
git add apps/web/components/run/stream
git commit -m "feat(web): SSE run client, frame-batched useRun with resync, and stream-driven run query sync"
```

---

### Task 8: Shared easing, cursor arc and `AgentCursor` — **Changed** (E1, E8, G2)

**What stays:** `apps/web/lib/easing.ts`, `easing.test.ts` and `cursor-path.test.ts`, verbatim from base Task 8.

**What changes:**
- `cursor-path.ts` reads `durations`.
- `agent-cursor.tsx` reads `easings` and uses global `acur-*` classes.
- The CSS moves into `styles/run.css`.
- `agent-cursor.module.css` is not created.

**Files:**
- Create: `apps/web/lib/easing.ts` (+ test, verbatim), `apps/web/components/run/cursor/cursor-path.ts` (+ test, verbatim), `apps/web/components/run/cursor/agent-cursor.tsx`
- Modify: `apps/web/styles/run.css`

**Interfaces:** as in base Task 8. Plus the CSS classes `acur-layer`, `acur`, `acur-drift`, `acur-arrow`, `acur-who` and `acur-pulse`.

- [ ] **Step 1: Write the failing tests** (verbatim from base Task 8 Step 1).

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test apps/web/lib/easing.test.ts apps/web/components/run/cursor`
Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement.**

Create `apps/web/lib/easing.ts` verbatim from base Task 8.

`apps/web/components/run/cursor/cursor-path.ts`:
```ts
import { VIEWPORT } from "@mastertutor/contracts";
import { durations } from "@/lib/motion-tokens.ts";

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
  return Math.min(
    durations.cursorMax,
    Math.max(durations.cursorMin, durations.cursorMin + distance(from, to) * MS_PER_PX),
  );
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
import { cubicBezier } from "@/lib/easing.ts";
import { easings } from "@/lib/motion-tokens.ts";
import { arcControl, pointOnArc, travelMs, type Point } from "./cursor-path.ts";

const ease = cubicBezier(easings.cursor);
const HOTSPOT = { x: 3, y: 2 };

export interface AgentCursorProps {
  /** Viewport pixels; null hides the cursor. */
  target: Point | null;
  /** A new value plays the click ring once (the seq of a finished click with `pointer`). */
  pulseKey: number | null;
  hidden: boolean;
  thinking: boolean;
}

/** The only agent cursor: CDP input never moves the X cursor (spec §10.2). Event-driven, not per frame. */
export function AgentCursor({ target, pulseKey, hidden, thinking }: AgentCursorProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef<Point | null>(null);
  const tx = target?.x ?? null;
  const ty = target?.y ?? null;

  useEffect(() => {
    const el = ref.current;
    if (!el || tx === null || ty === null) return undefined;
    const to = { x: tx, y: ty };
    const place = (p: Point) => {
      at.current = p;
      el.style.transform = `translate(${p.x - HOTSPOT.x}px, ${p.y - HOTSPOT.y}px)`;
    };
    const from = at.current;
    if (!from || reduce) {
      place(to);
      return undefined;
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
    <div className="acur-layer" aria-hidden="true">
      <div ref={ref} className="acur" data-hidden={hidden || target === null || undefined}>
        <div className="acur-drift" data-thinking={thinking || undefined}>
          <svg viewBox="0 0 20 20" className="acur-arrow">
            <path d="M3 2 L3 16.5 L7 12.8 L9.6 18.4 L12 17.3 L9.5 11.8 L15 11.8 Z" />
          </svg>
        </div>
        <span className="acur-who">Agent</span>
      </div>
      {pulseKey !== null && target && !hidden ? (
        <span
          key={pulseKey}
          data-testid="click-pulse"
          className="acur-pulse"
          style={{ left: target.x, top: target.y }}
        />
      ) : null}
    </div>
  );
}
```

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* Agent cursor (Task 8). Only transform and opacity change. */
  .acur-layer {
    position: absolute;
    inset: 0;
    z-index: 5;
    overflow: hidden;
    pointer-events: none;
  }
  .acur {
    position: absolute;
    top: 0;
    left: 0;
    width: 1.25rem;
    height: 1.25rem;
    will-change: transform;
    transition-property: opacity;
    transition-duration: var(--motion-dur-base);
    transition-timing-function: var(--motion-ease-out);
    &[data-hidden] {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .acur-drift[data-thinking] {
      animation-name: acur-drift;
      animation-duration: var(--motion-dur-drift);
      animation-timing-function: var(--motion-ease-out);
      animation-iteration-count: infinite;
    }
  }
  .acur-arrow {
    width: 1.25rem;
    height: 1.25rem;
    overflow: visible;
    fill: var(--cursor);
    stroke: var(--cursor-outline);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .acur-who {
    position: absolute;
    top: 1.0625rem;
    left: 1.0625rem;
    padding: 0.125rem 0.4375rem;
    border-radius: var(--r-pill);
    background: var(--signal);
    color: var(--on-signal);
    font: 600 0.625rem/1.4 var(--font-ui);
    white-space: nowrap;
  }
  .acur-pulse {
    position: absolute;
    width: 1.5rem;
    height: 1.5rem;
    margin: -0.75rem 0 0 -0.75rem;
    border: 0.125rem solid var(--tint);
    border-radius: 50%;
    opacity: 0;
    animation-name: acur-pulse;
    animation-duration: var(--motion-dur-click-pulse);
    animation-timing-function: var(--motion-ease-out);
    animation-fill-mode: forwards;
  }
  @keyframes acur-pulse {
    from {
      transform: scale(1);
      opacity: 0.35;
    }
    to {
      transform: scale(1.8333);
      opacity: 0;
    }
  }
  @keyframes acur-drift {
    0%,
    100% {
      transform: translate(0, 0);
    }
    25% {
      transform: translate(0.125rem, -0.0625rem);
    }
    50% {
      transform: translate(0.0625rem, 0.125rem);
    }
    75% {
      transform: translate(-0.125rem, 0.0625rem);
    }
  }
```

- [ ] **Step 4: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/lib apps/web/components/run/cursor apps/web/styles && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write apps/web/lib/easing.ts apps/web/lib/easing.test.ts apps/web/components/run/cursor apps/web/styles/run.css
git add apps/web/lib/easing.ts apps/web/lib/easing.test.ts apps/web/components/run/cursor apps/web/styles/run.css
git commit -m "feat(web): shared cubic-bezier, eased-arc agent cursor with click pulse and idle drift"
```

---

### Task 9: ThoughtLine and number formatting — **Replaced** (X1, X2, X3)

StatusMark is delight-owned (X1): no stub, no replacement, no module CSS. CountUp is not created (X2): F3 numerals use `RollingNumber` with a `formatCount(…)` string. This task keeps `format.ts` and adapts ThoughtLine with the delight licence header (X3).

**Files:**
- Create: `apps/web/components/bits/format.ts`, `format.test.ts` (both verbatim from base Task 9 Steps 2 and 4), `apps/web/components/bits/thought-line.tsx`
- Modify: `apps/web/styles/run.css`

**Interfaces:**
- Consumes: `Icon` (`agentNote`).
- Produces:
  - `formatElapsed(ms)`, `spokenElapsed(ms)`, `formatCount(value, decimals, prefix?, suffix?)` and `compactNumber(n)`;
  - `ThoughtLine({ label: string; working: boolean; since: string })`, where `label` is already cleaned by `untrustedText`;
  - CSS classes `tline`, `tline-glyph`, `tline-labels`, `tline-work`, `tline-done` and `tline-timer`.

- [ ] **Step 1: Re-fetch the upstream source and confirm its hash.**

Run (`$SCRATCH` is your session scratchpad directory; never `/tmp`):
```bash
curl -fsS "https://reactbits.dev/r/ThoughtLine-TS-TW.json" -o "$SCRATCH/ThoughtLine.json" && shasum -a 256 "$SCRATCH/ThoughtLine.json"
```
Expected: `a0499120d803a9da926163c3172f8f1e6a4df8726fa5aac32fa611dc9e9e70d9`.
- If the hash differs, put the new hash and today's date in the header below.
- Read the upstream diff for licence changes, and stop if the licence changed.

- [ ] **Step 2: Write the failing test.**

`format.test.ts`, verbatim from base Task 9 Step 2. `bits-licence.test.ts` (delight) is the header test for `thought-line.tsx` and already exists.

- [ ] **Step 3: Run it to verify it fails.**

Run: `pnpm test apps/web/components/bits`
Expected: FAIL, because `./format.ts` is not found.

- [ ] **Step 4: Implement.**

Create `format.ts` verbatim from base Task 9 Step 4.

`apps/web/components/bits/thought-line.tsx`:
```tsx
"use client";
/*
 * Adapted from React Bits "ThoughtLine" (TS-TW).
 * Source:  https://reactbits.dev/r/ThoughtLine-TS-TW.json
 * sha256:  a0499120d803a9da926163c3172f8f1e6a4df8726fa5aac32fa611dc9e9e70d9 (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: the blur crossfade between "thinking" and "thought for" becomes an opacity
 * crossfade; the shimmer and the step trace are removed; the glyph is our Icon (agentNote) and
 * breathes on F1's opacity-only `pulse` keyframes; the elapsed timer writes textContent through a
 * ref every 100ms (no React render per tick); the label is untrusted model text, so it arrives
 * cleaned and renders inside <bdi>; one polite status line speaks the change; timing and colours
 * from tokens (run.css .tline); reduced motion keeps only the fades (motion.css).
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { formatElapsed, spokenElapsed } from "./format.ts";

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
    if (!working) return undefined;
    const id = setInterval(paint, TICK_MS);
    return () => clearInterval(id);
  }, [since, working]);

  useEffect(() => {
    setAnnounce(working ? label : `Thought for ${spokenElapsed(elapsed.current)}`);
  }, [working, label]);

  return (
    <div className="tline" data-working={working || undefined}>
      <span className="tline-glyph" aria-hidden="true">
        <Icon name="agentNote" size="sm" />
      </span>
      <span className="tline-labels" aria-hidden="true">
        <bdi className="tline-work">{label}</bdi>
        <span className="tline-done">Thought for</span>
      </span>
      <span ref={timerRef} className="tline-timer" aria-hidden="true">
        0.0s
      </span>
      <span className="sr-only" role="status">
        {announce}
      </span>
    </div>
  );
}
```

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* ThoughtLine (Task 9): opacity crossfade only. */
  .tline {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    font: 500 0.8125rem/1.3 var(--font-ui);
    color: var(--label-2);
  }
  .tline-glyph {
    display: inline-flex;
    flex: none;
    color: var(--tint);
  }
  .tline[data-working] .tline-glyph {
    animation-name: pulse;
    animation-duration: var(--motion-dur-pulse);
    animation-timing-function: var(--motion-ease-out);
    animation-iteration-count: infinite;
  }
  .tline-labels {
    display: inline-grid;
    min-width: 0;
  }
  .tline-work,
  .tline-done {
    grid-area: 1 / 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition-property: opacity;
    transition-duration: var(--motion-dur-panel);
    transition-timing-function: var(--motion-ease-out);
  }
  .tline-work {
    opacity: 0;
    color: var(--label);
  }
  .tline[data-working] .tline-work {
    opacity: 1;
  }
  .tline[data-working] .tline-done {
    opacity: 0;
  }
  .tline-timer {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
```

- [ ] **Step 5: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/components/bits apps/web/styles && pnpm typecheck && pnpm lint`
Expected: PASS, including `bits-licence.test.ts` for `thought-line.tsx`.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/components/bits/format.ts apps/web/components/bits/format.test.ts apps/web/components/bits/thought-line.tsx apps/web/styles/run.css
git add apps/web/components/bits/format.ts apps/web/components/bits/format.test.ts apps/web/components/bits/thought-line.tsx apps/web/styles/run.css
git commit -m "feat(web): adapted React Bits ThoughtLine and run number formatting (StatusMark and RollingNumber reused)"
```

---

### Task 10: CodeSlots with its security review — **Changed** (E1, E8, X3)

**What stays:** `code-slots-logic.ts` and `code-slots-logic.test.ts`, verbatim from base Task 10.

**What changes:**
- `code-slots.tsx` gets the delight-format header, global `cslots-*` classes and `transitions.spring`. `MotionConfig reducedMotion="user"` already turns the digit's transform into a fade, so the `{ type: false }` branch goes.
- The CSS moves into `styles/run.css`. `code-slots.module.css` is not created.
- The security test reads `run.css` for the grid rule.

**Files:**
- Create: `apps/web/components/bits/code-slots-logic.ts` (+ test, verbatim), `apps/web/components/bits/code-slots.tsx`, `apps/web/components/bits/code-slots.security.test.ts`
- Modify: `apps/web/styles/run.css`

**Interfaces:** as in base Task 10 (`CodeSlots({ label, sealed, disabled?, onComplete })`), plus the CSS classes `cslots`, `cslots-input`, `cslots-row`, `cslots-slot` and `cslots-digit`.

- [ ] **Step 1: Re-fetch the upstream source and confirm its hash.**

Run:
```bash
curl -fsS "https://reactbits.dev/r/CodeSlots-TS-TW.json" -o "$SCRATCH/CodeSlots.json" && shasum -a 256 "$SCRATCH/CodeSlots.json"
```
Expected: `0373c74030a344f56008cad563f1c410afc0ce3dde2f2c0509fa5053a0ac1273`. If the hash differs, handle it as in Task 9 Step 1.

- [ ] **Step 2: Write the failing tests.**

Copy `code-slots-logic.test.ts` verbatim from base Task 10 Step 1. Then write `apps/web/components/bits/code-slots.security.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Spec §11.4 #5: CodeSlots must pass this review before merge. */
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const files = ["./code-slots.tsx", "./code-slots-logic.ts"].map(source).join("\n");
const css = source("../../styles/run.css");

describe("CodeSlots security review", () => {
  it("uses one-time-code autofill and a numeric keypad", () => {
    expect(files).toContain('autoComplete="one-time-code"');
    expect(files).toContain('inputMode="numeric"');
  });

  it("never logs, persists or transmits the code itself", () => {
    for (const banned of [
      "console.",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "fetch(",
      "JSON.stringify",
    ]) {
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

  it("seals to dots and fits six boxes at 390px (D22)", () => {
    expect(files).toContain('"•"');
    expect(css).toMatch(/\.cslots-row\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--n\), minmax\(0, 3rem\)\)/);
  });
});
```

- [ ] **Step 3: Run them to verify they fail.**

Run: `pnpm test apps/web/components/bits/code-slots`
Expected: FAIL, because the modules are not found.

- [ ] **Step 4: Implement.**

Create `code-slots-logic.ts` verbatim from base Task 10 Step 3.

`apps/web/components/bits/code-slots.tsx`:
```tsx
"use client";
/*
 * Adapted from React Bits "CodeSlots" (TS-TW).
 * Source:  https://reactbits.dev/r/CodeSlots-TS-TW.json
 * sha256:  0373c74030a344f56008cad563f1c410afc0ce3dde2f2c0509fa5053a0ac1273 (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: one real <input> whose value is always "" carries focus, paste and OS one-time-code
 * autofill; the digits live only in this component's state and are cleared before onComplete runs
 * (spec §11.4 #5, enforced by code-slots.security.test.ts); 4–8 digit codes resize the boxes;
 * sealed boxes show dots; digits enter on transitions.spring (MotionConfig turns that into a fade
 * under reduced motion); colours and sizes from tokens (run.css .cslots); the grid is
 * repeat(N, minmax(0, 3rem)), so six boxes fit at 390px (fixes D22's clipped sixth box).
 */
import { m } from "motion/react";
import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { transitions } from "@/lib/motion-tokens.ts";
import {
  OTP_DEFAULT_DIGITS,
  backspace,
  emptySlots,
  isComplete,
  pasteDigits,
  typeDigits,
  type SlotsState,
} from "./code-slots-logic.ts";

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
  const [state, setState] = useState<SlotsState>(() => ({
    slots: emptySlots(OTP_DEFAULT_DIGITS),
    active: 0,
  }));
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
      className="cslots"
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
        className="cslots-input"
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
      <div className="cslots-row" style={{ "--n": shown.length } as CSSProperties} aria-hidden="true">
        {shown.map((char, i) => (
          <span
            key={i}
            className="cslots-slot"
            data-active={(focused && !locked && i === state.active) || undefined}
            data-filled={char !== "" || undefined}
          >
            {char ? (
              <m.span
                key={`${i}-${char}`}
                className="cslots-digit"
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={transitions.spring}
              >
                {char}
              </m.span>
            ) : null}
          </span>
        ))}
      </div>
      <span id={`${id}-count`} className="sr-only" aria-live="polite">
        {sealed !== null
          ? "Code sent"
          : `${state.slots.filter(Boolean).length} of ${state.slots.length} digits entered`}
      </span>
    </div>
  );
}
```

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* CodeSlots (Task 10). The grid keeps six boxes inside the card at 390px (D22). */
  .cslots {
    position: relative;
    display: block;
    max-width: 100%;
    cursor: text;
    &[data-sealed] {
      cursor: default;
    }
  }
  .cslots-input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    font-size: 1rem;
    caret-color: transparent;
  }
  .cslots-row {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 3rem));
    gap: 0.375rem;
  }
  .cslots-slot {
    display: grid;
    place-items: center;
    min-width: 0;
    aspect-ratio: 48 / 56;
    border-radius: var(--r-sm);
    background: var(--fill-2);
    color: var(--label);
    font: 600 1.125rem/1 var(--font-code);
    &[data-active] {
      box-shadow:
        0 0 0 0.1875rem var(--tint-wash),
        inset 0 0 0 0.09375rem var(--tint);
    }
  }
  .cslots[data-sealed] .cslots-slot {
    background: var(--ok-wash);
    color: var(--ok);
  }
  .cslots-digit {
    display: inline-block;
  }
  .cslots:has(.cslots-input:focus-visible) .cslots-row {
    outline: 0.125rem solid var(--tint);
    outline-offset: 0.25rem;
    border-radius: var(--r-md);
  }
```

- [ ] **Step 5: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/components/bits apps/web/styles && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/components/bits/code-slots* apps/web/styles/run.css
git add apps/web/components/bits/code-slots-logic.ts apps/web/components/bits/code-slots-logic.test.ts apps/web/components/bits/code-slots.tsx apps/web/components/bits/code-slots.security.test.ts apps/web/styles/run.css
git commit -m "feat(web): CodeSlots OTP input adapted from React Bits with enforced security review"
```

---

### Task 11: New task page — **Replaced** (E2, E3, E5, E6, E8, G6, P3, S10, X2)

**Changes from the base task:**
- **E6.** Edit the existing `/new` page (keep `metadata`). It renders `Toolbar` and `Crumbs`, then the form.
- **E3.** Settings and folders come from the shared query cache (`orpc.settings.get`, `orpc.folders.tree`), so the page and Settings share one source.
- **The kill switch disables Start** with an explanation, instead of surfacing as "check your connection".
- **E2, E7.** Shipped parts: `Chip`, `RubberSegment`, `Button`, `useToast`.
- **X2.** Budget numerals use `RollingNumber`.
- **Principle 6.** The folder list reuses `buildFolderTree` and `flattenAll` from `lib/folders/tree.ts`; `flattenFolders` is not created.
- **S10.** "Ask me" is the default and is never remembered. Choosing Auto shows its risk line inline.
- **P3.** Navigation waits for `create` **and** `HERO_MIN_CAPTURE_MS` (1.2 s), and only when the 3D hero is live.
- **E8.** CSS lives in `styles/new-task.css` and `styles/hero.css`.
- **E5.** The e2e tests use the fixture server: `runs.create` is real fixture code, and its input is read from the request.

**Files:**
- Create:
  - `apps/web/components/hero/hero-events.ts`, `apps/web/components/hero/hero-poster.tsx`
  - `apps/web/components/new-task/draft.ts` (+ `draft.test.ts`), `source-field.tsx`, `options-grid.tsx`, `new-task-form.tsx`
  - `apps/web/e2e/new-task.spec.ts`
- Modify: `apps/web/app/(app)/new/page.tsx`, `apps/web/styles/new-task.css`, `apps/web/styles/hero.css`, `apps/web/scripts/first-load-baseline.json` (the `/new` entry only)

**Interfaces:**
- Consumes: `api`, `orpc`, `errorCode`, `errorCopy`, `useToast`, `Toolbar`, `Crumbs`, `Button`, `Chip`, `Icon`, `RubberSegment`, `RollingNumber`, `formatCount` (Task 9), `buildFolderTree`, `flattenAll`, `SOURCE_KIND_ICON`, `CreateRunInput`, `toOrigin`, `DEFAULT_BUDGET`.
- Produces:
  - **`hero-events.ts`:** `HERO_EVENTS` (`hero:type`, `hero:focus`, `hero:start`, `hero:captured`), `HeroEventName`, `emitHero`, `isHeroLive()`, `HERO_MIN_CAPTURE_MS = 1200` and `heroCaptureFloor(): Promise<void>`.
  - **`hero-poster.tsx`:** `PosterArt` and `HeroPoster` (`.hero[data-hero]`).
  - **`draft.ts`:** `SourceChip`, `parseSource`, `originVariants`, `BUDGET_PRESETS`, `BudgetPreset`, `TaskDraft`, `buildCreateRunInput` and `startErrorCopy(error)`.
  - **Route `/new`** with `NewTaskForm`.

- [ ] **Step 1: Write the failing unit test.**

`apps/web/components/new-task/draft.test.ts`: copy base Task 11 Step 1 with these changes.
- Delete the line `import { FOLDERS } from "../../e2e/support/run-mocks.ts";`.
- Delete `flattenFolders` from the `./draft.ts` import.
- Delete the whole `describe("flattenFolders", …)` block. `lib/folders/tree.test.ts` already covers the ordering.
- In the test "uses presets, auto mode and a target folder", replace both `FOLDERS[1].id` with `ids.folder(2)`, and add `import { ids } from "@/lib/fixtures/ids.ts";`.
- Add `startErrorCopy` to the `./draft.ts` import, and append:
```ts
describe("startErrorCopy", () => {
  it("names a bad request and a rate limit; anything else just says it failed", () => {
    expect(startErrorCopy({ code: "BAD_REQUEST" })).toBe("Check the task details and try again.");
    expect(startErrorCopy({ code: "TOO_MANY_REQUESTS" })).toBe("Too many requests. Wait a moment and try again.");
    expect(startErrorCopy({ code: "CONFLICT" })).toBe("Couldn't start the task. Try again.");
    expect(startErrorCopy(new TypeError("Failed to fetch"))).toBe("Couldn't start the task. Try again.");
  });
});
```

- [ ] **Step 2: Write the failing e2e spec.**

`apps/web/e2e/new-task.spec.ts`:
```ts
import { DEFAULT_BUDGET } from "@mastertutor/contracts";
import { ids } from "../lib/fixtures/ids.ts";
import { mockRpc } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

type Logged = [string, unknown][];
const createBody = (body: unknown) => (body as { json: unknown }).json;

test.describe("New task", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "content checks run once; layout is Task 18");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const log: [string, unknown][] = [];
      (window as unknown as { __heroLog: typeof log }).__heroLog = log;
      for (const name of ["hero:type", "hero:focus", "hero:start"]) {
        window.addEventListener(name, (e) => log.push([name, (e as CustomEvent).detail ?? null]));
      }
    });
  });

  test("composes a task with sources, options and ⌘↵, then opens the run", async ({ page }) => {
    await page.goto("/new");
    await expect(page.getByRole("radio", { name: "Ask me" })).toHaveAttribute("aria-checked", "true");
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
    await page.getByRole("radio", { name: "Deep" }).click();
    await expect(page.getByTestId("budget-steps").locator(".sr-only")).toHaveText("300");
    await page.getByRole("radio", { name: "Auto in allowed domains" }).click();
    await expect(page.getByText("Purchases, deletions and posts on these domains go ahead without asking.")).toBeVisible();
    await page.getByLabel("Save to").selectOption(ids.folder(2));

    const request = page.waitForRequest("**/api/rpc/runs/create");
    await goal.press("ControlOrMeta+Enter");
    expect(createBody((await request).postDataJSON())).toMatchObject({
      goal: "Week 3: every lecture, figure and table. Skip the quizzes.\n\nSources:\n- https://youtube.com/watch?v=k3Wm9xTq2aE",
      allowedOrigins: ["https://youtube.com", "https://www.youtube.com", "https://github.com", "https://www.github.com"],
      budget: { maxSteps: 300, maxUsd: 10, maxActiveMinutes: 120 },
      approvalMode: "auto_within_allowlist",
      targetFolderId: ids.folder(2),
    });
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  });

  test("Auto is never remembered: a fresh page starts on Ask me (S10)", async ({ page }) => {
    await page.goto("/new");
    await page.getByRole("radio", { name: "Auto in allowed domains" }).click();
    await page.reload();
    await expect(page.getByRole("radio", { name: "Ask me" })).toHaveAttribute("aria-checked", "true");
  });

  test("emits hero:type, hero:focus and hero:start without loading any 3D code", async ({ page }) => {
    await page.goto("/new");
    const goal = page.getByLabel("Describe the task");
    await goal.click();
    await goal.pressSequentially("abc");
    await page.getByRole("button", { name: /^Start/ }).focus();
    const log = await page.evaluate(() => (window as unknown as { __heroLog: Logged }).__heroLog);
    expect(log.filter(([n]) => n === "hero:type")).toHaveLength(3);
    expect(log).toContainEqual(["hero:focus", true]);
    expect(log).toContainEqual(["hero:focus", false]);
  });

  test("validates before calling the API", async ({ page }) => {
    let creates = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/rpc/runs/create")) creates += 1;
    });
    await page.goto("/new");
    await page.getByRole("button", { name: /^Start/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Describe the task or add a source.");
    await expect(page.getByLabel("Describe the task")).toBeFocused();
    expect(creates).toBe(0);
  });

  test("keeps the draft and explains when starting fails", async ({ page }) => {
    await page.route("**/api/rpc/runs/create", (route) =>
      route.fulfill({
        status: 500,
        json: { json: { defined: false, code: "INTERNAL_SERVER_ERROR", status: 500, message: "down" } },
      }),
    );
    await page.goto("/new");
    await page.getByLabel("Describe the task").fill("Capture this page");
    await page.getByRole("button", { name: "Add domain" }).click();
    await page.getByLabel("Allowed domain").fill("example.com");
    await page.getByLabel("Allowed domain").press("Enter");
    await page.getByRole("button", { name: /^Start/ }).click();
    await expect(page.getByText("Couldn't start the task. Try again.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Start/ })).toBeEnabled();
    await expect(page.getByLabel("Describe the task")).toHaveValue("Capture this page");
  });

  test("the kill switch disables Start and says why", async ({ page }) => {
    await mockRpc(page, {
      "settings/get": () => ({
        killSwitch: true,
        defaultBudget: DEFAULT_BUDGET,
        defaultAllowedOrigins: [],
        concurrency: 6,
      }),
    });
    await page.goto("/new");
    await expect(page.getByRole("button", { name: /^Start/ })).toBeDisabled();
    await expect(page.getByText("The kill switch is on. Turn it off in Settings to start tasks.")).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm test apps/web/components/new-task && pnpm --filter @mastertutor/web test:ui -- new-task.spec.ts`
Expected: both FAIL. The unit test is missing its module, and `/new` has no composer.

- [ ] **Step 4: Implement the hero events and the poster.**

`apps/web/components/hero/hero-events.ts`:
```ts
/** The composer talks to the 3D hero only through these window events; it never imports three. */
export const HERO_EVENTS = {
  type: "hero:type",
  focus: "hero:focus",
  start: "hero:start",
  captured: "hero:captured",
} as const;
export type HeroEventName = keyof typeof HERO_EVENTS;

/** Start waits for at least this much of the ~2.4s capture before opening the run (P3). */
export const HERO_MIN_CAPTURE_MS = 1_200;

export function emitHero(name: "type" | "start"): void;
export function emitHero(name: "focus", focused: boolean): void;
export function emitHero(name: HeroEventName, detail?: boolean): void {
  window.dispatchEvent(new CustomEvent(HERO_EVENTS[name], { detail }));
}

export function isHeroLive(): boolean {
  return document.querySelector("[data-hero][data-live]") !== null;
}

/** Resolves after HERO_MIN_CAPTURE_MS when the 3D hero is live; at once otherwise. */
export function heroCaptureFloor(): Promise<void> {
  if (!isHeroLive()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, HERO_MIN_CAPTURE_MS));
}
```

`apps/web/components/hero/hero-poster.tsx`:
```tsx
/** Static composition (page → lens → note): the loading, reduced-motion and no-WebGL state (run 16). */
export function PosterArt() {
  return (
    <div className="hero-poster">
      <div className="hero-page">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="hero-shadow" />
      <div className="hero-puck">
        <i className="hero-band" />
        <i className="hero-dot" />
      </div>
      <div className="hero-note">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

export function HeroPoster() {
  return (
    <div className="hero" data-hero="" aria-hidden="true">
      <PosterArt />
    </div>
  );
}
```

Replace the body of `apps/web/styles/hero.css` with:
```css
/* Capture Lens hero: CSS poster (F3 Task 11) and the 3D canvas (F5 Task 19). */
@layer components {
  .hero {
    position: relative;
    justify-self: center;
    width: 100%;
    max-width: 18rem;
    aspect-ratio: 1;
    contain: layout paint;
    touch-action: pan-y;
    @variant md {
      max-width: 22rem;
    }
    @variant lg {
      justify-self: end;
      max-width: 34rem;
    }
  }
  .hero-poster {
    position: absolute;
    inset: 0;
  }
  .hero-page,
  .hero-note {
    position: absolute;
    overflow: hidden;
    border-radius: 3.2% / 2.6%;
    background: var(--elevated);
    box-shadow: var(--e3);
    & i {
      position: absolute;
      left: 8%;
      height: 2.4%;
      border-radius: var(--r-pill);
      background: var(--fill);
    }
  }
  .hero-page {
    top: 12%;
    left: 8%;
    width: 39%;
    height: 49%;
    transform: perspective(60rem) rotateY(16deg) rotateZ(1.5deg);
    &::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 8%;
      background: var(--bg-2);
    }
    & i:nth-child(1) {
      top: 14%;
      width: 70%;
      height: 5%;
      border-radius: var(--r-xs);
      background: var(--label);
    }
    & i:nth-child(2) {
      top: 25%;
      width: 84%;
      height: 30%;
      border-radius: var(--r-xs);
      background: linear-gradient(160deg, var(--hero-aqua), var(--hero-aqua-deep));
    }
    & i:nth-child(3) {
      top: 61%;
      width: 84%;
    }
    & i:nth-child(4) {
      top: 67%;
      width: 78%;
      background: var(--signal-wash);
    }
    & i:nth-child(5) {
      top: 73%;
      width: 82%;
    }
    & i:nth-child(6) {
      top: 79%;
      width: 60%;
    }
  }
  .hero-shadow {
    position: absolute;
    top: 84%;
    right: 12%;
    left: 20%;
    height: 7%;
    border-radius: 50%;
    background: radial-gradient(
      closest-side,
      color-mix(in srgb, var(--hero-bondi) 18%, transparent),
      transparent
    );
  }
  .hero-puck {
    position: absolute;
    top: 33%;
    left: 28%;
    width: 46%;
    aspect-ratio: 1;
    border-radius: 50%;
    transform: scaleY(0.74);
    background: radial-gradient(
      120% 90% at 50% 16%,
      color-mix(in srgb, var(--elevated) 92%, transparent),
      color-mix(in srgb, var(--hero-aqua) 60%, transparent) 42%,
      color-mix(in srgb, var(--hero-aqua-deep) 50%, transparent) 100%
    );
    box-shadow:
      inset 0 -0.875rem 1.75rem color-mix(in srgb, var(--hero-bondi) 38%, transparent),
      inset 0 0.5rem 1rem color-mix(in srgb, var(--elevated) 95%, transparent),
      inset 0 0 0 0.0625rem color-mix(in srgb, var(--elevated) 70%, transparent),
      0 2.125rem 3.75rem -1.625rem color-mix(in srgb, var(--hero-bondi) 45%, transparent);
    &::after {
      content: "";
      position: absolute;
      top: 8%;
      left: 16%;
      width: 46%;
      height: 22%;
      border-radius: 50%;
      background: radial-gradient(
        closest-side,
        color-mix(in srgb, var(--elevated) 95%, transparent),
        transparent
      );
    }
  }
  .hero-band {
    position: absolute;
    inset: 11%;
    border: 0.7rem solid color-mix(in srgb, var(--hero-bondi) 42%, transparent);
    border-radius: 50%;
    filter: blur(0.1875rem);
  }
  .hero-dot {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 12%;
    aspect-ratio: 1;
    border-radius: 50%;
    translate: -50% -50%;
    background: var(--signal);
    filter: blur(0.0625rem);
    transition-property: opacity;
    transition-duration: var(--motion-dur-base);
    transition-timing-function: var(--motion-ease-out);
  }
  .hero-note {
    top: 50%;
    left: 62%;
    width: 27%;
    height: 33%;
    transform: perspective(60rem) rotateY(-16deg) rotateZ(-2deg);
    & i:nth-child(1) {
      top: 9%;
      width: 22%;
      height: 4%;
      background: var(--tint);
    }
    & i:nth-child(2) {
      top: 18%;
      width: 72%;
      height: 6%;
      border-radius: var(--r-xs);
      background: var(--label);
    }
    & i:nth-child(3) {
      top: 29%;
      width: 48%;
      height: 6%;
      border-radius: var(--r-xs);
      background: var(--label);
    }
    & i:nth-child(4) {
      top: 41%;
      width: 84%;
      height: 26%;
      border-radius: var(--r-xs);
      background: linear-gradient(160deg, var(--hero-aqua), var(--hero-aqua-deep));
    }
    & i:nth-child(5) {
      top: 73%;
      width: 84%;
    }
    & i:nth-child(6) {
      top: 80%;
      width: 80%;
    }
    & i:nth-child(7) {
      top: 87%;
      width: 52%;
    }
  }
}
```
The base poster's `backdrop-filter` on the puck is dropped: `.glass` is the only blur recipe (`raw-values.test.ts`), and the gradient carries the look.

- [ ] **Step 5: Implement the draft model.**

`apps/web/components/new-task/draft.ts` is base Task 11 Step 5's `draft.ts`, with these changes:
- delete `FolderOption`, `MAX_DEPTH` and `flattenFolders`;
- delete `type FolderView` from the import;
- add `import { errorCode, errorCopy } from "@/lib/api/errors.ts";` and append:
```ts
/** Copy for a failed runs.create. Server messages are never shown (they may echo input). */
export function startErrorCopy(error: unknown): string {
  const code = errorCode(error);
  if (code === "BAD_REQUEST") return "Check the task details and try again.";
  if (code === "TOO_MANY_REQUESTS") return errorCopy(error);
  return "Couldn't start the task. Try again.";
}
```

- [ ] **Step 6: Implement the form.**

`apps/web/components/new-task/source-field.tsx`:
```tsx
"use client";

import type { SourceKind } from "@mastertutor/contracts";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { parseSource, type SourceChip } from "./draft.ts";

const LABEL: Record<SourceKind, string> = {
  web: "Web page address",
  youtube: "YouTube video address",
  pdf: "PDF address",
};
const PLACEHOLDER: Record<SourceKind, string> = {
  web: "https://example.com/article",
  youtube: "https://youtube.com/watch?v=…",
  pdf: "https://example.com/paper.pdf",
};

export function SourceField({
  kind,
  onAdd,
  onCancel,
}: {
  kind: SourceKind;
  onAdd(source: SourceChip): void;
  onCancel(): void;
}) {
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
    <div className="nt-field">
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
      <Button onClick={add}>Add</Button>
      {invalid ? (
        <p id={`${id}-error`} className="nt-error">
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
import { formatCount } from "@/components/bits/format.ts";
import { RollingNumber } from "@/components/bits/rolling-number.tsx";
import { RubberSegment } from "@/components/bits/rubber-segment.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { buildFolderTree, flattenAll } from "@/lib/folders/tree.ts";
import { BUDGET_PRESETS, type BudgetPreset, type SourceChip } from "./draft.ts";

const PRESETS = [
  { value: "quick", label: "Quick" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
] as const satisfies readonly { value: BudgetPreset; label: string }[];

const MODES = [
  { value: "ask", label: "Ask me" },
  { value: "auto_within_allowlist", label: "Auto in allowed domains" },
] as const satisfies readonly { value: ApprovalMode; label: string }[];

const MODE_TEXT: Record<ApprovalMode, string> = {
  ask: "Risky clicks, form submits, downloads, first sign-ins and new domains always ask you first.",
  auto_within_allowlist:
    "Risky clicks, forms and first sign-ins in your allowed domains go ahead and are logged.",
};

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

  return (
    <div className="nt-opts">
      <section className="nt-opt" aria-labelledby={`${id}-domains`}>
        <span className="eyebrow">01</span>
        <h2 id={`${id}-domains`} className="nt-opt-title">
          Allowed domains
        </h2>
        <p className="nt-opt-text">The agent stays on these. Leaving them asks you first.</p>
        <ul className="nt-chips" aria-label="Allowed domains">
          {sourceHosts.map((host) => (
            <li key={`src-${host}`}>
              <Chip icon="link">{host}</Chip>
            </li>
          ))}
          {p.domains.map((origin) => {
            const host = new URL(origin).host;
            return (
              <li key={origin}>
                <Chip
                  icon="web"
                  removeLabel={`Remove ${host}`}
                  onRemove={() => p.onDomains(p.domains.filter((d) => d !== origin))}
                >
                  {host}
                </Chip>
              </li>
            );
          })}
        </ul>
        {adding ? (
          <div className="nt-field">
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
            <Button onClick={addDomain}>Add</Button>
            {invalid ? <p className="nt-error">Enter a domain like example.com.</p> : null}
          </div>
        ) : (
          <Button variant="plain" icon="add" onClick={() => setAdding(true)}>
            Add domain
          </Button>
        )}
      </section>

      <section className="nt-opt" aria-labelledby={`${id}-budget`}>
        <span className="eyebrow">02</span>
        <h2 id={`${id}-budget`} className="nt-opt-title">
          Budget
        </h2>
        <p className="nt-opt-text">Pauses and asks when it hits a limit.</p>
        <RubberSegment items={PRESETS} value={p.budget} onChange={p.onBudget} aria-label="Budget" />
        <dl className="nt-numerals">
          <div>
            <dd data-testid="budget-steps">
              <RollingNumber value={formatCount(budget.maxSteps, 0)} />
            </dd>
            <dt>steps</dt>
          </div>
          <div>
            <dd>
              <RollingNumber
                value={formatCount(budget.maxUsd, Number.isInteger(budget.maxUsd) ? 0 : 2, "$")}
              />
            </dd>
            <dt>max spend</dt>
          </div>
          <div>
            <dd>
              <RollingNumber value={formatCount(budget.maxActiveMinutes, 0)} />
            </dd>
            <dt>minutes</dt>
          </div>
        </dl>
      </section>

      <section className="nt-opt" aria-labelledby={`${id}-mode`}>
        <span className="eyebrow">03</span>
        <h2 id={`${id}-mode`} className="nt-opt-title">
          Approvals
        </h2>
        <RubberSegment
          items={MODES}
          value={p.approvalMode}
          onChange={p.onApprovalMode}
          aria-label="Approvals"
          fit="content"
        />
        <p className="nt-opt-text">{MODE_TEXT[p.approvalMode]}</p>
        {p.approvalMode === "auto_within_allowlist" ? (
          <p className="nt-risk">
            <Icon name="needsReview" size="sm" />
            <span>
              Purchases, deletions and posts on these domains go ahead without asking. Downloads
              and new domains stay blocked, and budget limits still ask.
            </span>
          </p>
        ) : null}
        <label className="nt-select" htmlFor={`${id}-folder`}>
          <span>Save to</span>
          <select
            id={`${id}-folder`}
            value={p.folderId ?? ""}
            onChange={(e) => p.onFolder(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">Let the agent file it</option>
            {flattenAll(buildFolderTree(p.folders)).map((node) => (
              <option key={node.folder.id} value={node.folder.id}>
                {`${"\u2003".repeat(node.depth - 1)}${node.folder.name}`}
              </option>
            ))}
          </select>
        </label>
      </section>
    </div>
  );
}
```
The risk line reads "…go ahead without asking." In the e2e test, `getByText` matches the substring "Purchases, deletions and posts on these domains go ahead without asking." as written.

`apps/web/components/new-task/new-task-form.tsx`:
```tsx
"use client";

import { DEFAULT_BUDGET, type ApprovalMode, type SourceKind } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { emitHero, heroCaptureFloor } from "@/components/hero/hero-events.ts";
import { HeroPoster } from "@/components/hero/hero-poster.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { SOURCE_KIND_ICON } from "@/lib/ui/vocabulary.ts";
import { buildCreateRunInput, startErrorCopy, type BudgetPreset, type SourceChip } from "./draft.ts";
import { OptionsGrid } from "./options-grid.tsx";
import { SourceField } from "./source-field.tsx";

const SUGGESTIONS = [
  "Capture this PDF verbatim, figures included",
  "Chapter notes for a YouTube lecture",
  "Every code listing from a docs page",
] as const;

export function NewTaskForm() {
  const router = useRouter();
  const toast = useToast();
  const goalId = useId();
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const settings = useQuery(orpc.settings.get.queryOptions({ input: {} }));
  const folders = useQuery(orpc.folders.tree.queryOptions({ input: {} })).data?.folders ?? [];
  const [goal, setGoal] = useState("");
  const [sources, setSources] = useState<SourceChip[]>([]);
  const [adding, setAdding] = useState<SourceKind | null>(null);
  // null until the user edits the list: until then the Settings default shows through.
  const [domainEdits, setDomainEdits] = useState<string[] | null>(null);
  const [budget, setBudget] = useState<BudgetPreset>("standard");
  // "Ask me" is the default and never remembered (S10).
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("ask");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const domains = domainEdits ?? settings.data?.defaultAllowedOrigins ?? [];
  const standardBudget = settings.data?.defaultBudget ?? DEFAULT_BUDGET;
  const killed = settings.data?.killSwitch === true;

  async function start() {
    if (busy || killed) return;
    const input = buildCreateRunInput({
      goal,
      sources,
      domains,
      budget,
      standardBudget,
      approvalMode,
      targetFolderId: folderId,
    });
    if ("error" in input) {
      setError(input.error);
      goalRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    emitHero("start");
    try {
      const [run] = await Promise.all([api.runs.create(input), heroCaptureFloor()]);
      router.push(`/runs/${run.id}`);
    } catch (failure) {
      setBusy(false);
      toast({ title: startErrorCopy(failure), tone: "danger" });
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void start();
    }
  };

  return (
    <form
      className="wrap nt"
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <section className="nt-intro" aria-labelledby={`${goalId}-title`}>
        <div className="nt-copy">
          <p className="eyebrow">New task</p>
          <h1 id={`${goalId}-title`} className="nt-title">
            Take notes on<span className="period">…</span>
          </h1>
          <p className="nt-lede">
            I'll open my own browser, capture the source faithfully, and ask before anything
            consequential.
          </p>
          <div className="nt-composer">
            <label className="sr-only" htmlFor={goalId}>
              Describe the task
            </label>
            <textarea
              id={goalId}
              ref={goalRef}
              className="nt-goal"
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
              <ul className="nt-chips" aria-label="Sources">
                {sources.map((source) => (
                  <li key={source.url}>
                    <Chip
                      icon={SOURCE_KIND_ICON[source.kind]}
                      removeLabel={`Remove ${source.host}`}
                      onRemove={() => setSources(sources.filter((s) => s.url !== source.url))}
                    >
                      <bdi>{source.label}</bdi>
                    </Chip>
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
                  setSources((current) =>
                    current.some((s) => s.url === source.url) ? current : [...current, source],
                  );
                  setAdding(null);
                }}
              />
            ) : null}
            <div className="nt-foot">
              <Button variant="plain" icon="link" onClick={() => setAdding("web")}>
                URL
              </Button>
              <Button variant="plain" icon="video" onClick={() => setAdding("youtube")}>
                YouTube
              </Button>
              <Button variant="plain" icon="pdf" onClick={() => setAdding("pdf")}>
                PDF
              </Button>
              <span className="nt-spacer" />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={busy || killed}
                aria-keyshortcuts="Meta+Enter Control+Enter"
              >
                {busy ? "Starting…" : "Start"}
                <kbd className="kbd" aria-hidden="true">
                  ⌘↵
                </kbd>
              </Button>
            </div>
          </div>
          {killed ? (
            <p className="nt-note" role="status">
              The kill switch is on. Turn it off in Settings to start tasks.
            </p>
          ) : null}
          {error ? (
            <p id={`${goalId}-error`} role="alert" className="nt-error">
              {error}
            </p>
          ) : null}
          <div className="nt-suggest">
            {SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                onClick={() => {
                  setGoal(suggestion);
                  emitHero("type");
                  goalRef.current?.focus();
                }}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
        <div className="nt-hero">
          <HeroPoster />
        </div>
      </section>
      <OptionsGrid
        sources={sources}
        domains={domains}
        onDomains={setDomainEdits}
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
  );
}
```

`apps/web/app/(app)/new/page.tsx` (edit: keep `metadata`, drop `PageHead`, render the form):
```tsx
import type { Metadata } from "next";
import { NewTaskForm } from "@/components/new-task/new-task-form.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";

export const metadata: Metadata = { title: "New task" };

export default function NewTaskPage() {
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "New task" }]} />
      </Toolbar>
      <NewTaskForm />
    </>
  );
}
```

Replace the body of `apps/web/styles/new-task.css` with:
```css
/* New task composer and options (F3 Task 11). Mobile first. */
@layer components {
  .nt {
    padding-bottom: 4rem;
  }
  .nt-intro {
    display: grid;
    gap: 1.5rem;
    align-items: center;
    padding-block: 1.5rem 2rem;
    @variant lg {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
      gap: 2.5rem;
      padding-top: 3.5rem;
    }
  }
  .nt-copy,
  .nt-hero {
    min-width: 0;
  }
  .nt-hero {
    display: grid;
    order: -1;
    @variant lg {
      order: 0;
    }
  }
  .nt-title {
    margin: 0.75rem 0 0;
    font: 700 clamp(2.5rem, 5.4vw, 4.5rem) / 1 var(--font-display);
    letter-spacing: -0.04em;
    color: var(--label);
    overflow-wrap: anywhere;
  }
  .nt-lede {
    max-width: 32rem;
    margin: 1rem 0 0;
    color: var(--label-2);
    font-size: 1.1875rem;
    line-height: 1.45;
  }
  .nt-composer {
    margin-top: 2rem;
    padding: 1.1rem 1.1rem 0.9rem;
    border-radius: var(--r-xl);
    background: var(--elevated);
    box-shadow: var(--e2);
    &:focus-within {
      box-shadow:
        0 0 0 0.25rem var(--tint-wash),
        0 0 0 0.0625rem var(--tint),
        var(--e2);
    }
  }
  .nt-goal {
    width: 100%;
    min-height: 5.5rem;
    border: 0;
    outline: 0;
    resize: none;
    background: none;
    color: var(--label);
    font: 400 1.1875rem/1.5 var(--font-ui);
    &::placeholder {
      color: var(--label-2);
    }
  }
  .nt-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0.25rem 0 0.75rem;
    padding: 0;
    list-style: none;
    & > li {
      min-width: 0;
      max-width: 100%;
    }
  }
  .nt-field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    & input {
      flex: 1 1 14rem;
      min-width: 0;
      min-height: var(--hit);
      padding: 0 0.75rem;
      border: 0;
      border-radius: var(--r-sm);
      background: var(--fill-2);
      color: var(--label);
      font: inherit;
      &:focus-visible {
        outline: 0.125rem solid var(--tint);
        outline-offset: 0.125rem;
      }
    }
  }
  .nt-error {
    flex-basis: 100%;
    margin: 0.25rem 0 0;
    color: var(--danger);
    font-size: 0.8125rem;
  }
  .nt-note {
    margin: 0.75rem 0 0;
    color: var(--label-2);
    font-size: 0.8125rem;
  }
  .nt-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    padding-top: 0.75rem;
    border-top: 0.0625rem solid var(--sep);
  }
  .nt-spacer {
    flex: 1;
  }
  .nt-suggest {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
    & .btn {
      max-width: 100%;
      white-space: normal;
    }
  }
  .nt-opts {
    display: grid;
    gap: 1.25rem;
    margin-top: 1.5rem;
    padding-block: 2rem;
    border-top: 0.0625rem solid var(--sep);
    @variant lg {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 2rem;
    }
  }
  .nt-opt {
    min-width: 0;
  }
  .nt-opt-title {
    margin: 0.5rem 0 0.3rem;
    color: var(--label);
    font: 600 1.0625rem/1.3 var(--font-ui);
    letter-spacing: -0.015em;
  }
  .nt-opt-text {
    margin: 0.75rem 0;
    color: var(--label-2);
    font-size: 0.8125rem;
    line-height: 1.45;
  }
  .nt-risk {
    display: flex;
    gap: 0.5rem;
    margin: 0 0 0.75rem;
    padding: 0.6rem 0.7rem;
    border-radius: var(--r-sm);
    background: var(--warn-wash);
    color: var(--label);
    font-size: 0.75rem;
    line-height: 1.4;
    & .ic {
      color: var(--warn);
    }
  }
  .nt-numerals {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 1.5rem;
    margin: 1.25rem 0 0;
    & > div {
      display: flex;
      flex-direction: column-reverse;
      min-width: 0;
    }
    & dt {
      color: var(--label-2);
      font-size: 0.75rem;
    }
    & dd {
      margin: 0;
      color: var(--label);
      font: 600 2rem/1 var(--font-display);
      letter-spacing: -0.04em;
    }
  }
  .nt-select {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
    color: var(--label-2);
    font-size: 0.8125rem;
    & select {
      flex: 1 1 10rem;
      min-width: 0;
      min-height: var(--hit);
      padding: 0 0.5rem;
      border: 0;
      border-radius: var(--r-sm);
      background: var(--fill-2);
      color: var(--label);
      font: inherit;
    }
  }
}
```

- [ ] **Step 7: Run the tests and checks to verify they pass.**

Run:
```bash
pnpm test apps/web/components/new-task && pnpm --filter @mastertutor/web test:ui -- new-task.spec.ts
pnpm typecheck && pnpm lint
```
Expected: PASS. The created run's URL opens a 404 until Task 13; the test asserts only the URL.

- [ ] **Step 8: Budget for `/new` (X4b).**

Run: `cd apps/web && pnpm exec next build && node scripts/check-first-load.ts; rm -rf .next/cache`
- If `/new` exceeds its baseline by more than 6 kB, re-run with `--write-baseline`.
- Revert every changed entry except `/new`.
- Paste the delta line into the ledger for orchestrator approval.
- Every other route must pass unchanged.

- [ ] **Step 9: Commit.**

```bash
pnpm exec prettier --write apps/web/components/hero apps/web/components/new-task "apps/web/app/(app)/new/page.tsx" apps/web/styles/new-task.css apps/web/styles/hero.css apps/web/e2e/new-task.spec.ts
git add apps/web/components/hero apps/web/components/new-task "apps/web/app/(app)/new/page.tsx" apps/web/styles/new-task.css apps/web/styles/hero.css apps/web/e2e/new-task.spec.ts apps/web/scripts/first-load-baseline.json
git commit -m "feat(web): New task composer with sources, 01/02/03 options, ⌘↵, hero events and CSS poster"
```

---

### Task 12: Mock-browser parts — **Replaced** (E1, E2, E7, E8, G2, L1, L3, S5, S6, S7)

**Changes from the base task:**
- **L1.** `LiveFrame` retries `openLive` only on network or 5xx errors. `CONFLICT` reports `in_use` ("Open in another tab", no loop). `FORBIDDEN`, `NOT_IMPLEMENTED` and `NOT_FOUND` report `unavailable` (the frame shows the last screenshot). `UNAUTHORIZED` stops, because the link interceptor has already ended the session.
- **B6 §8.** `LiveFrame` re-opens on every slot change and whenever its `epoch` prop changes; the view bumps `epoch` after a Reconnecting episode.
- **S5.** While not in control the iframe sits in an `inert` wrapper (the video still renders; there is no focus and no input). It has `referrerPolicy="same-origin"`, and `allow` has no `fullscreen` (our Full screen control owns keyboard lock). There is no `sandbox`: it cannot isolate a same-origin scripted client (B6 S4 accepts that risk).
- **S6, S7.** Host and path render in `<bdi>`; the path is cleaned and truncated first, never the host.
- **E7.** The hand-back note uses F1's `Sheet` (`HandBackSheet`), not a hand-made popover. Full screen uses `IconButton`.
- **E8.** The CSS is in `styles/run.css`.

**Files:**
- Create:
  - `apps/web/components/run/model/callout.ts`, `callout.test.ts` (verbatim from base Task 12)
  - `apps/web/components/run/browser/fullscreen.ts`, `fullscreen.test.ts` (verbatim from base Task 12)
  - `apps/web/components/run/use-element-size.ts` (verbatim from base Task 12)
  - `apps/web/components/run/browser/live-policy.ts`, `live-policy.test.ts`
  - `apps/web/components/run/browser/{origin-pill,live-frame,caption,banners,hand-back-sheet,fullscreen-button,step-callout}.tsx`
- Modify: `apps/web/styles/run.css`

**Interfaces:**
- Consumes: `api`, `errorCode`, `reconnectDelayMs` (Task 7), `hostAndPath`, `pausedCopy`, `Tone` (Task 6), `Sheet`, `Button`, `IconButton`, `Icon`, `useToast`, `transitions`.
- Produces:
  - `useElementSize(ref)`; `Box`, `Placement`, `CALLOUT_GAP` and `calloutPlacement` (base);
  - `KeyboardLock`, `enterFullscreen`, `exitFullscreen` and `keyboardOf` (base);
  - `LiveStatus = "off" | "connecting" | "live" | "retrying" | "in_use" | "unavailable"` and `liveFailure(code: string | null): "retry" | "in_use" | "unavailable" | "off"`;
  - **components:**
    - `OriginPill({ url, secure })` and `StatePill({ label, tone, pulse })`;
    - `LiveFrame({ runId, slotName, epoch, title, interactive, onStatus })`;
    - `Caption({ text, step, tone })`;
    - `Banners({ state, model, replayLabel, live, onHandBack, onResume, onJumpLive })`;
    - `HandBackSheet({ open, onOpenChange, onHandBack })`;
    - `FullscreenButton({ target })`;
    - `StepCallout({ text, number, target, box })`.

- [ ] **Step 1: Write the failing tests.**

Copy `callout.test.ts` and `fullscreen.test.ts` verbatim from base Task 12 Step 1. Then write `apps/web/components/run/browser/live-policy.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { liveFailure } from "./live-policy.ts";

describe("liveFailure (L1, B6 A9)", () => {
  it("retries only network failures and server errors", () => {
    expect(liveFailure(null)).toBe("retry");
    expect(liveFailure("SERVICE_UNAVAILABLE")).toBe("retry");
    expect(liveFailure("INTERNAL_SERVER_ERROR")).toBe("retry");
  });

  it("never loops on a live view held by another tab", () => {
    expect(liveFailure("CONFLICT")).toBe("in_use");
  });

  it("gives up quietly on refusals and on an unwired backend", () => {
    for (const code of ["FORBIDDEN", "NOT_IMPLEMENTED", "NOT_FOUND", "BAD_REQUEST"]) {
      expect(liveFailure(code), code).toBe("unavailable");
    }
  });

  it("stops on an ended session (the RPC link already signs out)", () => {
    expect(liveFailure("UNAUTHORIZED")).toBe("off");
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test apps/web/components/run/model/callout.test.ts apps/web/components/run/browser`
Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement the pure helpers and the hook.**

Create `callout.ts`, `fullscreen.ts` and `use-element-size.ts` verbatim from base Task 12 Step 3.

`apps/web/components/run/browser/live-policy.ts`:
```ts
/** How the live frame treats a failed runs.openLive (L1; B6 A9 error mapping). */
export type LiveFailure = "retry" | "in_use" | "unavailable" | "off";

const RETRY: ReadonlySet<string> = new Set([
  "SERVICE_UNAVAILABLE",
  "INTERNAL_SERVER_ERROR",
  "BAD_GATEWAY",
  "GATEWAY_TIMEOUT",
  "TIMEOUT",
]);

export function liveFailure(code: string | null): LiveFailure {
  if (code === null || RETRY.has(code)) return "retry";
  if (code === "CONFLICT") return "in_use";
  if (code === "UNAUTHORIZED") return "off";
  return "unavailable";
}
```

- [ ] **Step 4: Implement the components.**

`apps/web/components/run/browser/origin-pill.tsx`:
```tsx
import { useId } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { hostAndPath, type Tone } from "../model/copy.ts";

/** The host is shown whole; only the path is truncated (S7). Both are page-derived text (S6). */
export function OriginPill({ url, secure }: { url: string | null; secure: boolean }) {
  const tipId = useId();
  const parts = hostAndPath(url);
  if (!parts) {
    return (
      <div className="run-origin">
        <span className="run-host">New tab</span>
      </div>
    );
  }
  return (
    <div className="run-origin" data-testid="origin-pill">
      <Icon
        name={parts.secure ? "sealed" : "web"}
        size="sm"
        label={parts.secure ? "Secure connection" : "Not secure"}
      />
      <bdi className="run-host">{parts.host}</bdi>
      {parts.path ? <bdi className="run-path">{parts.path}</bdi> : null}
      {secure ? (
        <button type="button" className="run-keyshield" aria-label="Filled securely" aria-describedby={tipId}>
          <Icon name="filledSecurely" size="sm" />
          <span role="tooltip" id={tipId} className="run-tip">
            <b>Filled securely.</b> A vault alias filled this sign-in. The values never reached the
            agent, and screenshots were masked during the fill.
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function StatePill({ label, tone, pulse }: { label: string; tone: Tone; pulse: boolean }) {
  return (
    <span className="run-pill" data-tone={tone} data-pulse={pulse || undefined}>
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
```

`apps/web/components/run/browser/live-frame.tsx`:
```tsx
"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { errorCode } from "@/lib/api/errors.ts";
import { reconnectDelayMs } from "../stream/run-events.ts";
import { liveFailure } from "./live-policy.ts";

export type LiveStatus = "off" | "connecting" | "live" | "retrying" | "in_use" | "unavailable";

export interface LiveFrameProps {
  runId: string;
  slotName: string | null;
  /** Bumped by the view after a Reconnecting episode: open the live view again (B6 §8). */
  epoch: number;
  title: string;
  interactive: boolean;
  onStatus(status: LiveStatus): void;
}

/**
 * n.eko's client in an iframe (spec §10.2). runs.openLive sets the HttpOnly cookies for
 * /live/<runId>/ and is called again on every slot change. One frame per run per tab: the PiP
 * never mounts on the run's own page (L1).
 * Isolation (S5): while not in control the frame is inert (no focus, no input; the video still
 * plays). `sandbox` is left out on purpose: it cannot isolate a same-origin scripted client.
 */
export function LiveFrame({ runId, slotName, epoch, title, interactive, onStatus }: LiveFrameProps) {
  const [embed, setEmbed] = useState<string | null>(null);
  const ref = useRef<HTMLIFrameElement>(null);
  const report = useEffectEvent(onStatus);

  useEffect(() => {
    if (slotName === null) {
      setEmbed(null);
      report("off");
      return undefined;
    }
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = async () => {
      report(attempt === 0 ? "connecting" : "retrying");
      try {
        const result = await api.runs.openLive({ runId });
        if (cancelled) return;
        setEmbed(result.sleeping ? null : result.embedPath);
        report(result.sleeping ? "off" : "live");
      } catch (error) {
        if (cancelled) return;
        const next = liveFailure(errorCode(error));
        if (next === "retry") {
          report("retrying");
          timer = setTimeout(() => void open(), reconnectDelayMs(attempt++));
          return;
        }
        setEmbed(null);
        report(next);
      }
    };
    void open();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, slotName, epoch]);

  useEffect(() => {
    if (interactive) ref.current?.focus();
  }, [interactive, embed]);

  if (!embed) return null;
  return (
    <div className="run-live" inert={!interactive}>
      <iframe
        ref={ref}
        src={embed}
        title={title}
        allow="autoplay; clipboard-read; clipboard-write"
        referrerPolicy="same-origin"
        tabIndex={interactive ? 0 : -1}
      />
    </div>
  );
}
```

`apps/web/components/run/browser/caption.tsx`:
```tsx
"use client";

import { AnimatePresence, m } from "motion/react";
import { transitions } from "@/lib/motion-tokens.ts";
import type { BrowserState } from "../model/browser-state.ts";

/** One line pinned to the frame; crossfades per step (run 13 §6). The text arrives cleaned. */
export function Caption({ text, step, tone }: { text: string; step: string | null; tone: BrowserState }) {
  return (
    <div className="run-caption glass" data-tone={tone}>
      <span className="run-caption-dot" aria-hidden="true" />
      <div className="run-caption-lines" aria-live="polite">
        <AnimatePresence initial={false}>
          <m.span
            key={text}
            className="run-caption-line"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: transitions.exit }}
            transition={transitions.base}
          >
            <bdi>{text}</bdi>
          </m.span>
        </AnimatePresence>
      </div>
      {step ? <span className="run-step-no">{step}</span> : null}
    </div>
  );
}
```

`apps/web/components/run/browser/banners.tsx`:
```tsx
"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import type { BrowserState } from "../model/browser-state.ts";
import { pausedCopy } from "../model/copy.ts";
import type { RunModel } from "../model/run-model.ts";
import type { LiveStatus } from "./live-frame.tsx";

export interface BannersProps {
  state: BrowserState;
  model: RunModel;
  replayLabel: string;
  live: LiveStatus;
  onHandBack(): void;
  onResume(): void;
  onJumpLive(): void;
}

function Banner({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className="run-banner glass" data-show={show || undefined} inert={!show} aria-hidden={!show || undefined}>
      {children}
    </div>
  );
}

export function Banners({ state, model, replayLabel, live, onHandBack, onResume, onJumpLive }: BannersProps) {
  const paused = pausedCopy(model);
  const liveIssue = state !== "control" && state !== "replay" && state !== "paused" ? live : "off";
  return (
    <>
      <Banner show={state === "control"}>
        <Icon name="hand" size="sm" />
        <span className="run-banner-text">
          <b>You're in control</b> · Agent paused · screenshots off
        </span>
        <button type="button" className="btn btn-gray run-banner-btn" onClick={onHandBack}>
          Hand back
        </button>
      </Banner>
      <Banner show={state === "paused"}>
        <Icon name="sleeping" size="sm" />
        <span className="run-banner-text">
          <b>{paused.title}</b> · <bdi>{paused.detail}</bdi>
        </span>
        {paused.canResume ? (
          <button type="button" className="btn btn-gray run-banner-btn" onClick={onResume}>
            <Icon name="play" size="sm" />
            Resume
          </button>
        ) : null}
      </Banner>
      <Banner show={state === "replay"}>
        <Icon name="session" size="sm" />
        <span className="run-banner-text">
          <b>Replay</b> · {replayLabel}
        </span>
        <button type="button" className="btn btn-gray run-banner-btn" onClick={onJumpLive}>
          Jump to live
        </button>
      </Banner>
      <Banner show={liveIssue === "in_use"}>
        <Icon name="external" size="sm" />
        <span className="run-banner-text">
          <b>Open in another tab</b> · Close it there to watch here
        </span>
      </Banner>
      <Banner show={liveIssue === "unavailable"}>
        <Icon name="info" size="sm" />
        <span className="run-banner-text">
          <b>Live view unavailable</b> · Showing the last screenshot
        </span>
      </Banner>
      {state === "reconnecting" ? (
        <div className="run-reconnect glass" role="status">
          <span className="run-spinner" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ rotate: `${i * 45}deg` }} />
            ))}
          </span>
          Reconnecting to the browser…
        </div>
      ) : null}
    </>
  );
}
```

`apps/web/components/run/browser/hand-back-sheet.tsx`:
```tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";

/** Hand back with an optional note (spec §10.3). F1's Sheet: bottom sheet compact, panel regular. */
export function HandBackSheet({
  open,
  onOpenChange,
  onHandBack,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onHandBack(note: string | null): void;
}) {
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    onHandBack(note.trim() || null);
    setNote("");
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Hand back to the agent"
      initialFocus={noteRef}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Keep control</Button>
          <Button variant="primary" onClick={submit}>
            Hand back
          </Button>
        </>
      }
    >
      <label className="run-note-label">
        Note to the agent <span className="muted">(optional)</span>
        <textarea
          ref={noteRef}
          className="run-note"
          value={note}
          maxLength={4_000}
          placeholder="I closed the pop-up. Carry on from the quiz page, and don't start it."
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Sheet>
  );
}
```

`apps/web/components/run/browser/fullscreen-button.tsx`:
```tsx
"use client";

import { useEffect, useState, type RefObject } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { IconButton } from "@/components/ui/button.tsx";
import { enterFullscreen, exitFullscreen, keyboardOf } from "./fullscreen.ts";

export function FullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const toast = useToast();
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
    if (await enterFullscreen(el, keyboardOf(navigator))) toast({ title: "Hold Esc to leave full screen." });
    else toast({ title: "Full screen isn't available in this browser." });
  };

  return (
    <IconButton
      icon={on ? "minimize" : "maximize"}
      label={on ? "Exit full screen" : "Full screen"}
      aria-pressed={on}
      onClick={() => void toggle()}
    />
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

const FALLBACK_LABEL = { width: 240, height: 48 };

/**
 * Cutaway callout with a dotted leader to the step's element (wide), or a gutter badge (≤1180px).
 * Placement keeps label and leader inside the frame, so the leader never crosses the timeline (D22).
 */
export function StepCallout({ text, number, target, box }: { text: string; number: number; target: Point; box: Box }) {
  const ref = useRef<HTMLDivElement>(null);
  const label = useElementSize(ref);
  const placed = calloutPlacement(target, box, label ?? FALLBACK_LABEL);
  return (
    <div className="run-callouts" aria-hidden="true" data-testid="step-callout">
      <svg className="run-leader" width={box.width} height={box.height}>
        <line x1={placed.line.x1} y1={placed.line.y1} x2={placed.line.x2} y2={placed.line.y2} />
        <circle cx={target.x} cy={target.y} r={3} />
      </svg>
      <div
        ref={ref}
        className="run-callout glass"
        style={{ transform: `translate(${placed.left}px, ${placed.top}px)` }}
      >
        <b>Step {number}.</b> <bdi>{text}</bdi>
      </div>
      <span
        className="run-gutter-badge"
        data-testid="gutter-badge"
        style={{ transform: `translateY(${target.y}px)` }}
      >
        {number}
      </span>
    </div>
  );
}
```

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* Mock browser (Task 12; run 13 §6, mockup D). Only transform, scale and opacity animate. */
  .run-frame {
    position: relative;
    overflow: hidden;
    border-radius: var(--r-frame);
    background: var(--bg-2);
    box-shadow:
      0 0 0 0.03125rem var(--hairline),
      var(--e2);
    transform-origin: 50% 40%;
    transition-property: scale;
    transition-duration: var(--motion-spring-dur);
    transition-timing-function: var(--motion-spring);
    &:fullscreen {
      display: flex;
      flex-direction: column;
      border-radius: 0;
      scale: none;
    }
    &:fullscreen .run-viewport {
      flex: 1;
      aspect-ratio: auto;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .run-frame[data-state="control"] {
      scale: 1.01;
    }
  }
  .run-chrome {
    display: grid;
    grid-template-columns: 2.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--hit);
    padding-inline: 0.75rem;
    border-bottom: 0.03125rem solid var(--hairline);
    @variant sm {
      grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    }
  }
  .run-dots {
    display: flex;
    gap: 0.375rem;
    & i {
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 50%;
      background: var(--fill);
    }
    & i:nth-child(n + 2) {
      display: none;
      @variant sm {
        display: block;
      }
    }
  }
  .run-chrome-end {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    justify-self: end;
  }
  .run-origin {
    display: flex;
    align-items: center;
    justify-self: center;
    gap: 0.45rem;
    min-width: 0;
    max-width: 34rem;
    height: 1.875rem;
    padding: 0 0.4rem 0 0.75rem;
    border-radius: var(--r-pill);
    background: var(--fill-2);
    color: var(--label-2);
    font: 400 0.8125rem/1 var(--font-ui);
  }
  .run-host {
    flex: none;
    color: var(--label);
    font-weight: 600;
    white-space: nowrap;
  }
  .run-path {
    display: none;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @variant sm {
      display: block;
    }
  }
  .run-keyshield {
    position: relative;
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 1.375rem;
    height: 1.375rem;
    border: 0;
    border-radius: 50%;
    background: var(--ok-wash);
    color: var(--ok);
    &::after {
      content: "";
      position: absolute;
      inset: -0.6875rem;
    }
  }
  .run-tip {
    position: absolute;
    top: calc(100% + 0.625rem);
    right: -0.5rem;
    z-index: 30;
    width: 15rem;
    padding: 0.6rem 0.7rem;
    border-radius: var(--r-sm);
    background: var(--elevated);
    box-shadow: var(--e3);
    color: var(--label);
    font: 400 0.75rem/1.4 var(--font-ui);
    text-align: start;
    white-space: normal;
    opacity: 0;
    pointer-events: none;
    translate: 0 -0.25rem;
    transition-property: opacity, translate;
    transition-duration: var(--motion-dur-base);
    transition-timing-function: var(--motion-ease-out);
  }
  .run-keyshield:is(:hover, :focus-visible) .run-tip {
    opacity: 1;
    translate: 0 0;
  }
  .run-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 1.375rem;
    padding: 0 0.55rem;
    border-radius: var(--r-pill);
    background: var(--elevated);
    box-shadow: var(--e1);
    color: var(--label);
    font: 600 0.6875rem/1 var(--font-ui);
    white-space: nowrap;
    & i {
      width: 0.45rem;
      height: 0.45rem;
      border-radius: 50%;
      background: var(--signal);
    }
    &[data-tone="tint"] i {
      background: var(--tint);
    }
    &[data-tone="warn"] i {
      background: var(--warn);
    }
    &[data-tone="muted"] i {
      background: var(--label-3);
    }
    &[data-pulse] i {
      animation-name: pulse;
      animation-duration: var(--motion-dur-pulse);
      animation-timing-function: var(--motion-ease-out);
      animation-iteration-count: infinite;
    }
  }
  .run-viewport {
    position: relative;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: var(--bg-2);
  }
  .run-live {
    position: absolute;
    inset: 0;
    & iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
    }
  }
  .run-shot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    transition-property: opacity;
    transition-duration: var(--motion-dur-panel);
    transition-timing-function: var(--motion-ease-out);
  }
  .run-viewport[data-shot] .run-shot {
    opacity: 1;
  }
  .run-frame[data-state="paused"] .run-shot {
    filter: grayscale(1) contrast(0.9);
  }
  .run-frame[data-state="reconnecting"] .run-shot {
    filter: blur(0.5rem);
  }
  .run-agent-ring,
  .run-user-ring {
    position: absolute;
    inset: 0;
    z-index: 4;
    opacity: 0;
    pointer-events: none;
    transition-property: opacity;
    transition-duration: var(--motion-dur-panel);
    transition-timing-function: var(--motion-ease-out);
  }
  .run-agent-ring {
    box-shadow:
      inset 0 0 0 0.125rem var(--signal),
      inset 0 0 1.75rem color-mix(in srgb, var(--signal) 30%, transparent);
  }
  .run-user-ring {
    box-shadow: inset 0 0 0 0.1875rem var(--tint);
  }
  .run-frame[data-state="acting"] .run-agent-ring {
    opacity: 1;
    animation-name: pulse;
    animation-duration: var(--motion-dur-pulse);
    animation-timing-function: var(--motion-ease-out);
    animation-iteration-count: infinite;
  }
  .run-frame[data-state="control"] .run-user-ring {
    opacity: 1;
  }
  .run-dim {
    position: absolute;
    inset: 0;
    z-index: 4;
    width: 100%;
    height: 100%;
    opacity: 0;
    pointer-events: none;
    transition-property: opacity;
    transition-duration: var(--motion-dur-panel);
    transition-timing-function: var(--motion-ease-out);
    & rect[data-scrim] {
      fill: var(--scrim);
    }
  }
  .run-frame[data-state="approval"] .run-dim {
    opacity: 1;
  }
  .run-takeover {
    position: absolute;
    inset: 0;
    z-index: 6;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    cursor: pointer;
    &:focus-visible {
      outline: 0.125rem solid var(--tint);
      outline-offset: -0.25rem;
    }
  }
  .run-takeover-hint {
    position: absolute;
    bottom: 0.75rem;
    left: 50%;
    padding: 0.375rem 0.75rem;
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--label) 86%, transparent);
    color: var(--bg);
    font: 500 0.8125rem/1.2 var(--font-ui);
    white-space: nowrap;
    translate: -50% 0;
    opacity: 0;
    transition-property: opacity;
    transition-duration: var(--motion-dur-base);
    transition-timing-function: var(--motion-ease-out);
  }
  .run-takeover:is(:hover, :focus-visible) .run-takeover-hint {
    opacity: 1;
  }
  .run-banner {
    --glass-bg: color-mix(in srgb, var(--label) 86%, transparent);
    position: absolute;
    top: 0.75rem;
    left: 50%;
    z-index: 9;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: calc(100% - 1rem);
    padding: 0.35rem 0.4rem 0.35rem 0.9rem;
    border-radius: var(--r-pill);
    box-shadow: var(--e3);
    color: var(--bg);
    font: 400 0.75rem/1.3 var(--font-ui);
    white-space: nowrap;
    translate: -50% -150%;
    opacity: 0;
    transition-property: translate, opacity;
    transition-duration: var(--motion-spring-dur), var(--motion-dur-base);
    transition-timing-function: var(--motion-spring), var(--motion-ease-out);
    @variant md {
      font-size: 0.8125rem;
    }
    &[data-show] {
      translate: -50% 0;
      opacity: 1;
    }
  }
  .run-banner-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    & b {
      font-weight: 600;
    }
  }
  .run-banner-btn {
    flex: none;
    min-height: 2rem;
    background: var(--bg);
    color: var(--label);
  }
  .run-reconnect {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 8;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 1.25rem;
    border-radius: var(--r-lg);
    box-shadow: var(--e2);
    color: var(--label);
    font: 500 0.8125rem/1.3 var(--font-ui);
    translate: -50% -50%;
  }
  .run-spinner {
    position: relative;
    width: 1.375rem;
    height: 1.375rem;
    animation-name: run-spin;
    animation-duration: var(--motion-dur-spin);
    animation-timing-function: var(--motion-ease-linear);
    animation-iteration-count: infinite;
    & i {
      position: absolute;
      top: 0.0625rem;
      left: 0.625rem;
      width: 0.125rem;
      height: 0.375rem;
      border-radius: 0.0625rem;
      background: var(--label-2);
      transform-origin: 0.0625rem 0.625rem;
    }
  }
  @keyframes run-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .run-caption {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: var(--hit);
    padding: 0 0.9rem;
    border-top: 0.03125rem solid var(--hairline);
  }
  .run-caption-dot {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--signal);
  }
  .run-caption[data-tone="control"] .run-caption-dot {
    background: var(--tint);
  }
  .run-caption:is([data-tone="paused"], [data-tone="replay"]) .run-caption-dot {
    background: var(--label-3);
  }
  .run-caption[data-tone="reconnecting"] .run-caption-dot {
    background: var(--warn);
  }
  .run-caption-lines {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 1.25rem;
    overflow: hidden;
  }
  .run-caption-line {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--label);
    font: 500 0.8125rem/1.25rem var(--font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .run-step-no {
    display: none;
    flex: none;
    color: var(--label-2);
    font: 400 0.6875rem/1 var(--font-code);
    white-space: nowrap;
    @variant sm {
      display: block;
    }
  }
  .run-callouts {
    position: absolute;
    inset: 0;
    z-index: 5;
    overflow: hidden;
    pointer-events: none;
  }
  .run-leader {
    position: absolute;
    inset: 0;
    display: none;
    overflow: hidden;
    @variant lg {
      display: block;
    }
    & line {
      stroke: var(--label);
      stroke-width: 1;
      stroke-dasharray: 2 3;
    }
    & circle {
      fill: var(--signal);
    }
  }
  .run-callout {
    position: absolute;
    top: 0;
    left: 0;
    display: none;
    max-width: 15rem;
    padding: 0.5rem 0.65rem;
    border-radius: var(--r-md);
    box-shadow: var(--e2);
    color: var(--label);
    font: 400 0.75rem/1.4 var(--font-ui);
    overflow-wrap: anywhere;
    @variant lg {
      display: block;
    }
  }
  .run-gutter-badge {
    position: absolute;
    top: -0.625rem;
    left: 0.375rem;
    display: grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: var(--signal);
    color: var(--on-signal);
    font: 600 0.6875rem/1 var(--font-ui);
    @variant lg {
      display: none;
    }
  }
  .run-note-label {
    display: grid;
    gap: 0.4rem;
    color: var(--label);
    font: 600 0.75rem/1.3 var(--font-ui);
  }
  .run-note {
    width: 100%;
    min-height: 4.25rem;
    padding: 0.6rem 0.75rem;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--fill-2);
    color: var(--label);
    font: 400 0.8125rem/1.45 var(--font-ui);
    resize: vertical;
  }
```

- [ ] **Step 5: Run the tests and checks to verify they pass.**

Run: `pnpm test apps/web/components/run apps/web/styles && pnpm typecheck && pnpm lint`
Expected: PASS. The components are exercised end to end in Task 13.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run apps/web/styles/run.css
git add apps/web/components/run apps/web/styles/run.css
git commit -m "feat(web): mock-browser parts: origin pill, inert live frame with openLive policy, caption, banners, hand-back sheet, full screen, callout"
```

---

### Task 13: Run view assembly, runs list, run links and the core e2e specs — **Replaced** (E2–E5, E7, X2, A4, A5, A6, A7, L1, S6, S7)

**Changes from the base task:**
- **Toolbar.** `Toolbar` + `Crumbs` (`Runs › run_xxxxxxxx`), `ToolbarSpacer`, `Button`/`ButtonLink`.
- **Run header.** `StatusMark` is `decorative` and sits beside visible label text (X1). The goal and host render in `<bdi>`.
- **`use-takeover.ts`.** It owns the takeover RPCs and effects:
  - one RPC per click, guarded by a ref;
  - `control` events by id;
  - `takeover_failed`;
  - timeouts, including the 5 s hand-back resync;
  - one-shot notices;
  - code-specific RPC failure copy: `FORBIDDEN` means another member, `CONFLICT` a finished run.
- **A4.** The page passes `viewerId` from `getViewer()`.
- **A7.** Informational run errors become toasts.
- **L1, B6 §8.** The live frame reports its status; `in_use` and `unavailable` show banners and the last screenshot, never a retry loop. The view bumps the live `epoch` after a Reconnecting episode.
- **X2.**
  - `/runs` lists runs (`RunsList`).
  - Usage, the audit log and the note source strip link to `/runs/<id>`.
  - `runs-links.spec.ts` is inverted.
- **E5.** The e2e specs run against the fixture's recorded run (`RECORDED_RUN_ID`).

**Files:**
- Create:
  - `apps/web/components/run/browser/browser-frame.tsx`
  - `apps/web/components/run/run-header.tsx`, `apps/web/components/run/use-takeover.ts`, `apps/web/components/run/run-view.tsx`, `apps/web/components/run/runs-list.tsx`
  - `apps/web/app/(app)/runs/[runId]/page.tsx`
  - `apps/web/e2e/run-states.spec.ts`, `apps/web/e2e/takeover.spec.ts`, `apps/web/e2e/sse.spec.ts`, `apps/web/e2e/runs.spec.ts`
- Modify:
  - `apps/web/app/(app)/runs/page.tsx`
  - `apps/web/components/settings/usage-view.tsx`, `apps/web/components/settings/audit-view.tsx`, `apps/web/components/note/source-strip.tsx`
  - `apps/web/e2e/runs-links.spec.ts`
  - `apps/web/styles/run.css`
  - `apps/web/scripts/first-load-baseline.json` (only the `/runs` and `/runs/[runId]` entries)

**Interfaces:**
- Consumes: Tasks 5–12, `StatusMark` (delight), `LoadError`, `Skeleton`, `EmptyState`, `useToast`, `getViewer`.
- Produces:
  - **Frame:** `BrowserFrame(props)` (`data-testid="browser-frame"`, `data-state=<BrowserState>`). Its optional `approval`, `spotlight` and `scrubber` slots are filled by Tasks 14–15.
  - **Header:** `RunHeader({ model, state })`.
  - **Takeover hook:** `useTakeover(runId, model, resync): { takeover; takeControl(wake: boolean): void; handBack(note: string | null): void }`.
  - **View:** `RunView({ runId, viewerId })` and route `/runs/[runId]`.
  - **List:** `RunsList()`; `/runs` renders it.
  - **RunView anchors that Tasks 14–16 edit (exact lines):**
    - `  const view: RunModel | null = model;`
    - `              onLiveStatus={setLiveStatus}`
    - `              showCallouts`
    - `          </section>`
    - `        {/* toolbar-extra */}`
    - `      {/* page-extra */}`

- [ ] **Step 1: Write the failing e2e specs.**

`apps/web/e2e/run-states.spec.ts`:
```ts
import { RECORDED_RUN_ID, rec, recordedDetail, recordedEvents } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

test.describe("Run view states", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "state checks run once; layout is Tasks 16 and 18");

  test("live: origin pill, secure-fill badge, caption and the live iframe", async ({ page }) => {
    const calls = await gotoRun(page);
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("origin-pill")).toContainText("learn.example.edu");
    await expect(page.getByRole("button", { name: "Filled securely" })).toBeVisible();
    await expect(page.getByText("Thinking about the next step")).toBeVisible();
    await expect(page.frameLocator("iframe[title^='Remote browser']").locator("svg")).toBeVisible();
    expect(rpcCalls(calls, "runs/openLive")).toEqual([{ runId: RECORDED_RUN_ID }]);
  });

  test("acting: inner ring and the cursor moves, then pulses on a click", async ({ page }) => {
    await gotoRun(page);
    const [started, done] = recordedEvents();
    await emit(page, [started!]);
    await expect(frame(page)).toHaveAttribute("data-state", "acting");
    await expect(page.getByText("Ticking the Honor Code box").first()).toBeVisible();
    await emit(page, [done!]);
    await expect(page.getByTestId("click-pulse")).toBeAttached();
  });

  test("a computer step without a pointer kind never pulses (W1)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [
      rec({
        type: "step",
        seq: 13,
        phase: "act",
        state: "done",
        caption: "Signing in",
        url: null,
        screenshotKey: null,
        action: { tool: "computer", summary: "Clicked “Go”", point: { x: 100, y: 100 } },
      }),
    ]);
    await expect(page.getByTestId("click-pulse")).toHaveCount(0);
  });

  test("approval: the viewport dims", async ({ page }) => {
    await gotoRun(page);
    await emit(page, recordedEvents());
    await expect(frame(page)).toHaveAttribute("data-state", "approval");
    await expect(page.getByText("Waiting for your approval").first()).toBeVisible();
  });

  test("control: banner reads 'You're in control · Agent paused · screenshots off'", async ({ page }) => {
    await gotoRun(page, { detail: recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover" }) });
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
  });

  test("paused: last masked screenshot, desaturated, with Resume", async ({ page }) => {
    const calls = await gotoRun(page, { detail: recordedDetail({ status: "sleeping", slotName: null }) });
    await expect(frame(page)).toHaveAttribute("data-state", "paused");
    await expect(frame(page).locator("img[src$='/steps/8/screenshot']")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.getByRole("button", { name: "Resume" }).click();
    await expect.poll(() => rpcCalls(calls, "runs/resume").length).toBe(1);
  });

  test("reconnecting: after the grace period, then recovers and re-opens the live view", async ({ page }) => {
    const calls = await gotoRun(page);
    await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
    await page.evaluate(() => {
      window.__sse.blockOpen = true;
      window.__sse.fail(true);
    });
    await expect(frame(page)).toHaveAttribute("data-state", "reconnecting", { timeout: 5_000 });
    await expect(page.getByRole("status").filter({ hasText: "Reconnecting to the browser" })).toBeVisible();
    await page.evaluate(() => window.__sse.openAll());
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect.poll(() => rpcCalls(calls, "runs/openLive").length).toBe(2);
  });

  test("finished runs show the outcome and offer no takeover", async ({ page }) => {
    await gotoRun(page, { detail: recordedDetail({ status: "completed", slotName: null }) });
    await expect(frame(page)).toHaveAttribute("data-state", "paused");
    await expect(page.getByText("Finished").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Take control of the browser" })).toHaveCount(0);
  });

  test("the live view open in another tab says so and never loops (Review Focus 9)", async ({ page }) => {
    await page.clock.install();
    const calls = await gotoRun(page, {
      handlers: {
        "runs/openLive": () => {
          throw new RpcFailure("CONFLICT", 409);
        },
      },
    });
    await expect(page.getByText("Open in another tab")).toBeVisible();
    await page.clock.runFor(10_000);
    expect(rpcCalls(calls, "runs/openLive")).toHaveLength(1);
    await expect(frame(page)).not.toHaveAttribute("data-state", "reconnecting");
  });

  test("an unwired live view shows the last screenshot, never Reconnecting (Review Focus 9)", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/openLive": () => {
          throw new RpcFailure("NOT_IMPLEMENTED", 501);
        },
      },
    });
    await expect(page.getByText("Live view unavailable")).toBeVisible();
    await expect(frame(page).locator("img[src$='/steps/8/screenshot']")).toBeVisible();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
  });

  test("a spoofed path never hides the real host (Review Focus 10)", async ({ page }) => {
    await gotoRun(page, {
      detail: recordedDetail({ currentUrl: "https://evil.example/learn.example.edu/login?\u202Eexe" }),
    });
    const pill = page.getByTestId("origin-pill");
    await expect(pill.locator(".run-host")).toHaveText("evil.example");
    expect(await pill.textContent()).not.toContain("\u202E");
  });

  test("an informational error becomes a toast, not the failure (A7)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [rec({ type: "error", code: "download_blocked", message: "cancelled" })]);
    await expect(page.getByText("Take over to download files.").first()).toBeVisible();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
  });
});
```

`apps/web/e2e/takeover.spec.ts`:
```ts
import type { Page } from "@playwright/test";
import { RECORDED_RUN_ID, rec, recordedDetail } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const overlay = (page: Page) => page.getByRole("button", { name: "Take control of the browser" });
const userHeld = () => recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover" });

test.describe("Takeover and hand back", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "behaviour checks run once");

  test("clicking into the preview takes control optimistically, once, and focuses the stream (Review Focus 2)", async ({ page }) => {
    const calls = await gotoRun(page);
    await overlay(page).dblclick();
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect.poll(() => rpcCalls(calls, "runs/takeControl")).toEqual([{ runId: RECORDED_RUN_ID }]);
    await emit(page, [rec({ type: "control", holder: "user" })]);
    await expect(page.getByText("Agent paused · screenshots off")).toBeVisible();
    await expect(page.locator("iframe")).toBeFocused();
  });

  test("reverts when control isn't confirmed within 2s, then re-applies a late control event (B6 E5)", async ({ page }) => {
    await page.clock.install();
    await gotoRun(page);
    await overlay(page).click();
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await page.clock.runFor(2_100);
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect(page.getByText("The browser didn't respond, so the agent still has control.")).toBeVisible();
    await emit(page, [rec({ type: "control", holder: "user" })]);
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect(page.getByText("You're in control now.")).toBeVisible();
  });

  test("reverts at once when the agent reports takeover_failed (B6 §3, A6)", async ({ page }) => {
    await gotoRun(page);
    await overlay(page).click();
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await emit(page, [
      rec({ type: "error", code: "takeover_failed", message: "The live view was not connected" }),
      rec({ type: "control", holder: "agent" }),
    ]);
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect(page.getByText("Couldn't take control. The agent kept it.")).toBeVisible();
  });

  test("names another member's control when takeControl is FORBIDDEN", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/takeControl": () => {
          throw new RpcFailure("FORBIDDEN", 403);
        },
      },
    });
    await overlay(page).click();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
    await expect(page.getByText("Someone else is in control of this browser.")).toBeVisible();
  });

  test("an ended session goes through the shared RPC link to sign-in (E3, R29-4)", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/takeControl": () => {
          throw new RpcFailure("UNAUTHORIZED", 401);
        },
      },
    });
    await overlay(page).click();
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(`/runs/${RECORDED_RUN_ID}`)}$`));
  });

  test("hands back with a note", async ({ page }) => {
    const calls = await gotoRun(page, { detail: userHeld() });
    await frame(page).getByRole("button", { name: "Hand back" }).click();
    const dialog = page.getByRole("dialog", { name: "Hand back to the agent" });
    await dialog.getByLabel("Note to the agent (optional)").fill("I closed the survey. Carry on from the quiz page.");
    await dialog.getByRole("button", { name: "Hand back" }).click();
    await expect(frame(page)).not.toHaveAttribute("data-state", "control");
    await expect.poll(() => rpcCalls(calls, "runs/handBack")).toEqual([
      { runId: RECORDED_RUN_ID, note: "I closed the survey. Carry on from the quiz page." },
    ]);
  });

  test("a hand back whose control event never comes re-reads the run after 5s (A6)", async ({ page }) => {
    await page.clock.install();
    const calls = await gotoRun(page, { detail: userHeld() });
    await frame(page).getByRole("button", { name: "Hand back" }).click();
    await page.getByRole("dialog", { name: "Hand back to the agent" }).getByRole("button", { name: "Hand back" }).click();
    await expect(frame(page)).not.toHaveAttribute("data-state", "control");
    const gets = rpcCalls(calls, "runs/get").length;
    await page.clock.runFor(5_100);
    await expect.poll(() => rpcCalls(calls, "runs/get").length).toBe(gets + 1);
    await expect(frame(page)).toHaveAttribute("data-state", "control");
  });

  test("taking over a sleeping run wakes it, then hands over", async ({ page }) => {
    const calls = await gotoRun(page, { detail: recordedDetail({ status: "sleeping", slotName: null }) });
    await overlay(page).click();
    await expect(page.getByText("Waking the browser so you can take control…")).toBeVisible();
    await expect.poll(() => rpcCalls(calls, "runs/takeControl").length).toBe(1);
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
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __fs: string[] }).__fs))
      .toEqual(["fullscreen", "lock"]);
  });
});
```
In "hand back… re-reads the run", the `runs/get` handler returns the user-held detail. The re-read therefore settles back on `control`, which proves the resync happened.

`apps/web/e2e/sse.spec.ts`:
```ts
import { encodeRunEventSse } from "@mastertutor/contracts";
import { recordedEvents } from "../lib/fixtures/run-recording.ts";
import { frame, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

test.skip(({ viewport }) => viewport?.width !== 1440, "stream check runs once");

test("streams from the snapshot id, then resumes with Last-Event-ID (Review Focus 1)", async ({ page }) => {
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

`apps/web/e2e/runs.spec.ts`:
```ts
import { OTHER_RUN_ID, RECORDED_RUN_ID } from "../lib/fixtures/run-recording.ts";
import { expect, test } from "./helpers/test.ts";

test("/runs lists every run with its status, each linking to its run view (X2)", async ({ page }) => {
  await page.goto("/runs");
  const list = page.getByRole("navigation", { name: "Runs" });
  await expect(list.locator(`a[href="/runs/${RECORDED_RUN_ID}"]`)).toContainText("Week 2 of the course");
  await expect(list.locator(`a[href="/runs/${RECORDED_RUN_ID}"]`)).toContainText("Running");
  await expect(list.locator(`a[href="/runs/${OTHER_RUN_ID}"]`)).toContainText("Finished");
  await expect(list.locator(".smark").first()).toHaveAttribute("aria-hidden", "true");
});
```
This test runs at every width (no skip), so it is also the list's layout check.

`apps/web/e2e/runs-links.spec.ts` (replace the whole file; the run view now exists):
```ts
import { ids } from "../lib/fixtures/ids.ts";
import { expect, test } from "./helpers/test.ts";

test.describe("run references link to the run view (X2)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "content check runs once");

  for (const [where, path, href] of [
    ["usage", "/settings/usage", `/runs/${ids.run(2)}`],
    ["audit log", "/settings/audit", `/runs/${ids.run(1)}`],
    ["note source strip", `/notes/${ids.note(1)}`, `/runs/${ids.run(2)}`],
  ] as const) {
    test(`the ${where} links runs to /runs/<id>`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
    });
  }
});
```

- [ ] **Step 2: Run the specs to verify they fail.**

Run: `pnpm --filter @mastertutor/web test:ui -- run-states.spec.ts takeover.spec.ts sse.spec.ts runs.spec.ts runs-links.spec.ts`
Expected: FAIL. `/runs/<id>` is a 404, `/runs` has no list, and the references are still plain text.

- [ ] **Step 3: Implement the frame, header, takeover hook and view.**

`apps/web/components/run/browser/browser-frame.tsx`:
```tsx
"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { useId, useRef, type ReactNode } from "react";
import { AgentCursor } from "../cursor/agent-cursor.tsx";
import { toViewport, type Point } from "../cursor/cursor-path.ts";
import { canTakeOver, type BrowserState } from "../model/browser-state.ts";
import { STATE_PILL, actNumber, captionFor, hostAndPath, pausedCopy, stepLabel } from "../model/copy.ts";
import {
  latestPointerStep,
  latestScreenshotSeq,
  originOf,
  type RunModel,
  type StepRow,
} from "../model/run-model.ts";
import type { TakeoverState } from "../model/takeover.ts";
import { untrustedText } from "../model/untrusted-text.ts";
import { useElementSize } from "../use-element-size.ts";
import { Banners } from "./banners.tsx";
import { Caption } from "./caption.tsx";
import { FullscreenButton } from "./fullscreen-button.tsx";
import { LiveFrame, type LiveStatus } from "./live-frame.tsx";
import { OriginPill, StatePill } from "./origin-pill.tsx";
import { StepCallout } from "./step-callout.tsx";

export interface BrowserFrameProps {
  runId: string;
  model: RunModel;
  state: BrowserState;
  takeover: TakeoverState;
  replayStep: StepRow | null;
  replayLabel: string;
  showCallouts: boolean;
  liveEpoch: number;
  liveStatus: LiveStatus;
  onLiveStatus(status: LiveStatus): void;
  onHandBack(): void;
  onTakeControl(): void;
  onResume(): void;
  onJumpLive(): void;
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
  // Only a finished click with a pointer kind pulses; a step without one (pre-A1) never does (W1).
  const pulseKey =
    !replaying && shown?.state === "done" && (pointer === "click" || pointer === "double_click")
      ? shown.seq
      : null;
  const shotSeq = replaying ? (p.replayStep?.seq ?? null) : latestScreenshotSeq(model);
  const showShot = replaying || state === "paused" || state === "reconnecting" || p.liveStatus !== "live";
  const pill = STATE_PILL[state];
  const spot = p.spotlight && size ? toViewport(p.spotlight, size) : null;
  const callout =
    p.showCallouts && shown && target && size && (state === "live" || state === "acting" || replaying)
      ? shown
      : null;

  return (
    <div ref={frameRef} className="run-frame" data-state={state} data-testid="browser-frame">
      <div className="run-chrome glass">
        <span className="run-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <OriginPill
          url={url}
          secure={model.secureFillOrigin !== null && originOf(url) === model.secureFillOrigin}
        />
        <div className="run-chrome-end">
          <StatePill
            label={state === "paused" ? pausedCopy(model).title : pill.label}
            tone={pill.tone}
            pulse={pill.pulse}
          />
          <FullscreenButton target={frameRef} />
        </div>
      </div>
      <div ref={viewportRef} className="run-viewport" data-shot={showShot || undefined}>
        <LiveFrame
          runId={p.runId}
          slotName={model.slotName}
          epoch={p.liveEpoch}
          title={`Remote browser, ${host}`}
          interactive={state === "control"}
          onStatus={p.onLiveStatus}
        />
        {shotSeq !== null ? (
          <img
            className="run-shot"
            src={stepScreenshotPath(p.runId, shotSeq)}
            alt={replaying ? `Screenshot of step: ${untrustedText(p.replayStep?.caption, 120) || host}` : ""}
          />
        ) : null}
        <div className="run-agent-ring" aria-hidden="true" />
        <div className="run-user-ring" aria-hidden="true" />
        <svg className="run-dim" aria-hidden="true">
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {spot ? (
                <rect
                  x={spot.x - SPOT.w / 2}
                  y={spot.y - SPOT.h / 2}
                  width={SPOT.w}
                  height={SPOT.h}
                  rx={SPOT.r}
                  fill="black"
                />
              ) : null}
            </mask>
          </defs>
          <rect data-scrim="" width="100%" height="100%" mask={`url(#${maskId})`} />
        </svg>
        {callout && target && size ? (
          <StepCallout
            text={untrustedText(callout.action?.summary ?? callout.caption, 160)}
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
          <button
            type="button"
            className="run-takeover"
            aria-label="Take control of the browser"
            onClick={p.onTakeControl}
          >
            <span className="run-takeover-hint" aria-hidden="true">
              Click to take control
            </span>
          </button>
        ) : null}
        <Banners
          state={state}
          model={model}
          replayLabel={p.replayLabel}
          live={p.liveStatus}
          onHandBack={p.onHandBack}
          onResume={p.onResume}
          onJumpLive={p.onJumpLive}
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
The `fill="white"` and `fill="black"` attributes are SVG mask luminance values (opaque and transparent), not UI colours. `raw-values.test.ts` matches only `#hex`, `rgb()` and `hsl()`, so these stay as they are.

`apps/web/components/run/run-header.tsx`:
```tsx
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import type { BrowserState } from "./model/browser-state.ts";
import { STATE_PILL, hostAndPath, markFor, shortRunId, statusLabel } from "./model/copy.ts";
import type { RunModel } from "./model/run-model.ts";

export function RunHeader({ model, state }: { model: RunModel; state: BrowserState }) {
  const host = hostAndPath(model.currentUrl)?.host ?? "no page yet";
  const started = new Date(model.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const title = model.goal.split("\n")[0] ?? model.goal;
  return (
    <header className="run-head">
      <div className="run-head-text">
        <p className="run-eyebrow">
          <span className="run-status" data-tone={STATE_PILL[state].tone}>
            <StatusMark status={markFor(state, model)} decorative />
            {statusLabel(state, model)}
          </span>
          <span className="run-meta">
            {shortRunId(model.runId)} · <bdi>{host}</bdi> · {model.model} ·{" "}
            {model.approvalMode === "ask" ? "asks first" : "auto in allowed domains"} · started {started}
          </span>
        </p>
        <h1 className="run-title">
          <bdi>{title}</bdi>
        </h1>
      </div>
      {model.noteId ? (
        <ButtonLink href={`/notes/${model.noteId}`} icon="note">
          Open draft note
        </ButtonLink>
      ) : null}
    </header>
  );
}
```

`apps/web/components/run/use-takeover.ts`:
```ts
"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api } from "@/lib/api/client.ts";
import { errorCode } from "@/lib/api/errors.ts";
import { TAKEOVER_NOTICE, handBackErrorCopy, takeControlErrorCopy } from "./model/copy.ts";
import { latestError, type RunModel } from "./model/run-model.ts";
import {
  IDLE_TAKEOVER,
  takeoverReducer,
  takeoverTimeoutMs,
  type TakeoverState,
} from "./model/takeover.ts";

export interface TakeoverControls {
  takeover: TakeoverState;
  takeControl(wake: boolean): void;
  handBack(note: string | null): void;
}

/**
 * Takeover and hand back (spec §10.3, D19, D27): optimistic in both directions, settled by the
 * agent's events. Each `control` event and `takeover_failed` error is acted on by its event id, so
 * a repeated holder still counts (A6). A hand back that never sees control{agent} re-reads the run.
 */
export function useTakeover(runId: string, model: RunModel | null, resync: () => void): TakeoverControls {
  const toast = useToast();
  const [takeover, dispatch] = useReducer(takeoverReducer, IDLE_TAKEOVER);
  const sending = useRef(false);

  const controlId = model?.lastControl?.eventId ?? null;
  const holder = model?.lastControl?.holder ?? null;
  useEffect(() => {
    if (controlId !== null && holder !== null) dispatch({ type: "holder", holder });
  }, [controlId, holder]);

  const error = model ? latestError(model) : null;
  const failedId = error?.code === "takeover_failed" ? error.eventId : null;
  useEffect(() => {
    if (failedId !== null) dispatch({ type: "takeover_failed" });
  }, [failedId]);

  const timeoutMs = takeoverTimeoutMs(takeover);
  const releasing = takeover.phase === "releasing";
  useEffect(() => {
    if (timeoutMs === null) return undefined;
    const timer = setTimeout(() => {
      if (releasing) {
        dispatch({ type: "release_timeout" });
        resync();
      } else {
        dispatch({ type: "timeout" });
      }
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs, releasing, resync]);

  const notice = takeover.notice;
  useEffect(() => {
    if (notice === null) return;
    toast({ title: TAKEOVER_NOTICE[notice] });
    dispatch({ type: "seen" });
  }, [notice, toast]);

  const takeControl = useCallback(
    (wake: boolean) => {
      if (sending.current) return;
      sending.current = true;
      dispatch({ type: "request", wake });
      api.runs
        .takeControl({ runId })
        .catch((failure: unknown) => {
          dispatch({ type: "request_failed" });
          toast({ title: takeControlErrorCopy(errorCode(failure)) });
        })
        .finally(() => {
          sending.current = false;
        });
    },
    [runId, toast],
  );

  const handBack = useCallback(
    (note: string | null) => {
      dispatch({ type: "release" });
      api.runs.handBack({ runId, note }).catch((failure: unknown) => {
        dispatch({ type: "release_failed" });
        toast({ title: handBackErrorCopy(errorCode(failure)) });
      });
    },
    [runId, toast],
  );

  return { takeover, takeControl, handBack };
}
```

`apps/web/components/run/run-view.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { api } from "@/lib/api/client.ts";
import { BrowserFrame } from "./browser/browser-frame.tsx";
import { HandBackSheet } from "./browser/hand-back-sheet.tsx";
import type { LiveStatus } from "./browser/live-frame.tsx";
import { canTakeOver, deriveBrowserState } from "./model/browser-state.ts";
import { INFO_ERROR_COPY, shortRunId } from "./model/copy.ts";
import { isInformational, latestError, type RunModel } from "./model/run-model.ts";
import { inControl } from "./model/takeover.ts";
import { RunHeader } from "./run-header.tsx";
import { useRun } from "./stream/use-run.ts";
import { useTakeover } from "./use-takeover.ts";

export function RunView({ runId }: { runId: string; viewerId: string | null }) {
  const toast = useToast();
  const { model, connection, loadError, resync } = useRun(runId);
  const { takeover, takeControl, handBack } = useTakeover(runId, model, resync);
  const [replaySeq, setReplaySeq] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("off");
  const [handBackOpen, setHandBackOpen] = useState(false);

  // After a Reconnecting episode, open the live view again (B6 §8).
  const [liveEpoch, setLiveEpoch] = useState(0);
  const wasLost = useRef(false);
  useEffect(() => {
    if (connection === "lost") wasLost.current = true;
    else if (connection === "open" && wasLost.current) {
      wasLost.current = false;
      setLiveEpoch((n) => n + 1);
    }
  }, [connection]);

  // Informational run errors are toasts, never the failure reason (A7). takeover_failed is the
  // takeover hook's notice.
  const lastError = model ? latestError(model) : null;
  const infoKey = lastError && isInformational(lastError.code) ? lastError.eventId : null;
  const infoCode = lastError?.code ?? null;
  useEffect(() => {
    if (infoKey === null || infoCode === null || infoCode === "takeover_failed") return;
    toast({ title: INFO_ERROR_COPY[infoCode] ?? "The agent reported a problem." });
  }, [infoKey, infoCode, toast]);

  const view: RunModel | null = model;
  const shotSteps = useMemo(() => (view ? view.steps.filter((s) => s.screenshotKey !== null) : []), [view]);
  const replayIndex = shotSteps.findIndex((s) => s.seq === replaySeq);
  const replayStep = replayIndex >= 0 ? (shotSteps[replayIndex] ?? null) : null;
  const replayLabel = replayStep ? `step ${replayIndex + 1}/${shotSteps.length}` : "";
  const state = view
    ? deriveBrowserState(view, {
        connection,
        takeover,
        replaying: replayStep !== null,
        liveRetrying: liveStatus === "retrying",
      })
    : null;

  const startTakeover = useCallback(() => {
    if (!view || !state || !canTakeOver(view, state, takeover)) return;
    setReplaySeq(null);
    takeControl(view.status === "sleeping");
  }, [view, state, takeover, takeControl]);

  const resume = useCallback(() => {
    api.runs.resume({ runId }).catch(() => toast({ title: "Couldn't resume the run. Try again." }));
  }, [runId, toast]);

  const crumbs = [{ label: "Runs", href: "/runs" }, { label: shortRunId(runId) }];
  if (loadError) {
    return (
      <>
        <Toolbar>
          <Crumbs items={crumbs} />
        </Toolbar>
        <div className="wrap run">
          <LoadError title="This run couldn't be loaded." onRetry={() => window.location.reload()} />
        </div>
      </>
    );
  }
  if (!view || !state) {
    return (
      <>
        <Toolbar>
          <Crumbs items={crumbs} />
        </Toolbar>
        <div className="wrap run" aria-busy="true" aria-label="Loading run">
          <Skeleton className="run-skel-head" />
          <Skeleton className="run-skel-frame" />
        </div>
      </>
    );
  }

  const userHasControl = inControl(view.controller, takeover);
  return (
    <>
      <Toolbar>
        <Crumbs items={crumbs} />
        <ToolbarSpacer />
        {/* toolbar-extra */}
        {userHasControl ? (
          <Button
            variant="primary"
            icon="hand"
            disabled={takeover.phase !== "idle"}
            onClick={() => setHandBackOpen(true)}
          >
            Hand back
          </Button>
        ) : (
          <Button icon="hand" disabled={!canTakeOver(view, state, takeover)} onClick={startTakeover}>
            Take over
          </Button>
        )}
      </Toolbar>
      <div className="wrap run">
        <RunHeader model={view} state={state} />
        <div className="run-body">
          <section className="run-stage" aria-label="Agent browser">
            <BrowserFrame
              runId={runId}
              model={view}
              state={state}
              takeover={takeover}
              replayStep={replayStep}
              replayLabel={replayLabel}
              liveEpoch={liveEpoch}
              liveStatus={liveStatus}
              onLiveStatus={setLiveStatus}
              showCallouts
              onHandBack={() => setHandBackOpen(true)}
              onTakeControl={startTakeover}
              onResume={resume}
              onJumpLive={() => setReplaySeq(null)}
            />
          </section>
        </div>
      </div>
      <HandBackSheet
        open={handBackOpen && userHasControl}
        onOpenChange={setHandBackOpen}
        onHandBack={(note) => {
          setHandBackOpen(false);
          handBack(note);
        }}
      />
      {/* page-extra */}
    </>
  );
}
```
`viewerId` is part of the props now (the page passes it), and Task 15 starts reading it for the timeline's decision lines (A4).

`apps/web/app/(app)/runs/[runId]/page.tsx`:
```tsx
import { Uuid } from "@mastertutor/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunView } from "@/components/run/run-view.tsx";
import { getViewer } from "@/lib/server/viewer.ts";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!Uuid.safeParse(runId).success) notFound();
  // The layout already redirected a signed-out visitor; the id names "You" in decisions (A4).
  const viewer = await getViewer();
  return <RunView runId={runId} viewerId={viewer?.id ?? null} />;
}
```

`apps/web/components/run/runs-list.tsx`:
```tsx
"use client";

import type { RunStatus } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { StatusMark, type StatusMarkStatus } from "@/components/bits/status-mark.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { orpc } from "@/lib/api/client.ts";
import { formatDateTime } from "@/lib/notes/format.ts";

const MARK: Record<RunStatus, StatusMarkStatus> = {
  queued: "pending",
  running: "running",
  waiting: "running",
  sleeping: "pending",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled",
};
const TEXT: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Needs you",
  sleeping: "Paused",
  completed: "Finished",
  failed: "Stopped",
  cancelled: "Cancelled",
};

/** Every run, newest first, each a link to its run view (X2). */
export function RunsList() {
  const runs = useQuery(orpc.runs.list.queryOptions({ input: { status: null, limit: 50 } }));
  if (runs.isError) {
    return (
      <LoadError title="Couldn't load your runs." onRetry={() => void runs.refetch()} retrying={runs.isFetching} />
    );
  }
  if (!runs.data) {
    return (
      <div className="group" aria-busy="true">
        <Skeleton className="run-list-skel" />
      </div>
    );
  }
  if (runs.data.items.length === 0) {
    return (
      <EmptyState
        icon="runs"
        title="No runs yet"
        body="Start a task and the agent's runs show up here."
        actions={
          <ButtonLink href="/new" variant="primary" icon="newTask">
            New task
          </ButtonLink>
        }
      />
    );
  }
  return (
    <nav className="group" aria-label="Runs">
      {runs.data.items.map((run) => (
        <Link key={run.id} className="row row-link" href={`/runs/${run.id}`}>
          <span className="min-w-0">
            <StatusMark status={MARK[run.status]} decorative />
            <span className="min-w-0 run-list-text">
              <bdi className="run-list-goal">{run.goal.split("\n")[0]}</bdi>
              <small>
                {TEXT[run.status]} · {formatDateTime(run.createdAt)}
              </small>
            </span>
          </span>
          <Icon name="chevronRight" />
        </Link>
      ))}
    </nav>
  );
}
```

`apps/web/app/(app)/runs/page.tsx` (render the list under the existing head):
```tsx
import type { Metadata } from "next";
import { RunsList } from "@/components/run/runs-list.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";

export const metadata: Metadata = { title: "Runs" };

export default function RunsPage() {
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Runs" }]} />
      </Toolbar>
      <div className="wrap run-list">
        <PageHead title="Runs" lede="Every task the agent has worked on." />
        <RunsList />
      </div>
    </>
  );
}
```

**Run references become links (X2).** In each file below, add `import Link from "next/link";` and make the one replacement shown.
- **`components/settings/usage-view.tsx`.** Replace the comment line `{/* Plain text until F3 builds /runs/<id>. */}` and the line `{r.goal}` after it with `<Link href={`/runs/${r.runId}`}>{r.goal}</Link>`.
- **`components/settings/audit-view.tsx`.** Replace `<span className="mono">Run {e.runId.slice(-6)}</span>` with `<Link className="mono" href={`/runs/${e.runId}`}>Run {e.runId.slice(-6)}</Link>`.
- **`components/note/source-strip.tsx`.**
  - Replace the comment `// Plain text until F3 builds /runs/<id>; then this becomes a link.` and the `<span className="t-foot">Run {detail.note.runId.slice(-6)}</span>` after it with:
```tsx
          <Link className="t-foot" href={`/runs/${detail.note.runId}`}>
            Run {detail.note.runId.slice(-6)}
          </Link>
```

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* Run view page (Task 13). */
  .run {
    padding-bottom: 6rem;
    @variant md {
      padding-bottom: 4rem;
    }
  }
  .run-head {
    display: grid;
    align-items: end;
    gap: 1rem;
    padding-block: 1.5rem 1rem;
    @variant md {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 1.5rem;
      padding-block: 2.5rem 1.5rem;
    }
  }
  .run-head-text {
    min-width: 0;
  }
  .run-eyebrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin: 0 0 0.6rem;
  }
  .run-status {
    --smark-size: 1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--label);
    font: 600 0.8125rem/1.2 var(--font-ui);
  }
  .run-meta {
    display: none;
    color: var(--label-2);
    font: 400 0.6875rem/1.4 var(--font-code);
    overflow-wrap: anywhere;
    @variant sm {
      display: inline;
    }
  }
  .run-title {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    color: var(--label);
    font: 700 clamp(1.75rem, 3.4vw, 2.5rem) / 1.08 var(--font-display);
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .run-body {
    display: grid;
    align-items: start;
    gap: 2rem;
    @variant lg {
      grid-template-columns: minmax(0, 1fr) 23.5rem;
    }
  }
  .run-stage {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    min-width: 0;
  }
  .run-skel-head {
    display: block;
    height: 4rem;
    margin-block: 2.5rem 1.5rem;
    border-radius: var(--r-md);
  }
  .run-skel-frame {
    display: block;
    aspect-ratio: 16 / 10;
    border-radius: var(--r-frame);
  }
  /* Runs list (Task 13, X2). */
  .run-list {
    padding-bottom: 5rem;
  }
  .run-list-text {
    display: grid;
  }
  .run-list-goal {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .run-list-skel {
    display: block;
    height: 3.5rem;
  }
```

- [ ] **Step 4: Run the specs and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web test:ui -- run-states.spec.ts takeover.spec.ts sse.spec.ts runs.spec.ts runs-links.spec.ts shell.spec.ts && pnpm test apps/web && pnpm typecheck && pnpm lint`
Expected: PASS. `shell.spec.ts` (delight) proves the sidebar's "1 live" still holds with run 1 as the recording.

- [ ] **Step 5: Budget for `/runs` and `/runs/[runId]` (X4b).**

Run: `cd apps/web && pnpm exec next build && node scripts/check-first-load.ts; rm -rf .next/cache`
- The output names `/runs/[runId]` with "no baseline".
- Run with `--write-baseline` and keep only the `/runs/[runId]` entry, plus `/runs` if it grew past 6 kB. Revert every other changed entry.
- Paste both lines into the ledger for orchestrator approval. Every other route must pass unchanged.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run "apps/web/app/(app)/runs" apps/web/components/settings/usage-view.tsx apps/web/components/settings/audit-view.tsx apps/web/components/note/source-strip.tsx apps/web/e2e/run-states.spec.ts apps/web/e2e/takeover.spec.ts apps/web/e2e/sse.spec.ts apps/web/e2e/runs.spec.ts apps/web/e2e/runs-links.spec.ts apps/web/styles/run.css
git add apps/web/components/run "apps/web/app/(app)/runs" apps/web/components/settings/usage-view.tsx apps/web/components/settings/audit-view.tsx apps/web/components/note/source-strip.tsx apps/web/e2e/run-states.spec.ts apps/web/e2e/takeover.spec.ts apps/web/e2e/sse.spec.ts apps/web/e2e/runs.spec.ts apps/web/e2e/runs-links.spec.ts apps/web/styles/run.css apps/web/scripts/first-load-baseline.json
git commit -m "feat(web): Run view with 7 states, takeover/hand back, live-view policy, runs list and run links"
```

---

### Task 14: Approval spotlight sheet — **Replaced** (A2, A3, A5, A9, S1, S2, S3, S4, S6, W5)

**Changes from the base task:**
- **S1, Review Focus 8.** Keys and buttons arm 600 ms after the sheet mounts. The sheet is keyed by approval id, so a queued second approval re-arms.
- **S1, key filter.** Keys are ignored when:
  - `event.repeat` is set, or any modifier is held;
  - the event comes from a text field;
  - an element is fullscreen;
  - the event comes from inside another dialog (Stop, hand back, the cancel confirm).
- **No Return default.**
- **S2.** The budget sheet has no Cancel key. "Cancel run" opens F1's `ConfirmDialog` ("Keep running" is focused).
- **A2, S3, Review Focus 7.** The card shows:
  - the action-type title;
  - the model's safety-check messages;
  - the injection warning in the warn tone;
  - a spotlight only for point actions.
- **A3, S4.** The card shows the record excerpt ("On this record") and, when the request carries a `screenshotKey`, the request screenshot from `approvalScreenshotPath`.
- **A5, Review Focus 6.** "Take over instead" is on the card. Taking over hides the sheet (the state becomes `control`); a failed takeover brings it back.
- **A9.** A policy request and its resolution in one batch never mount the sheet.

**Files:**
- Create: `apps/web/components/run/approval/approval-sheet.tsx`, `apps/web/e2e/approval.spec.ts`
- Modify: `apps/web/components/run/run-view.tsx`, `apps/web/styles/run.css`

**Interfaces:**
- Consumes: `approvalCopy` (Task 6), `PendingApproval`, `ApprovalDecisionInput`, `approvalScreenshotPath` (Task 2), `VIEWPORT`, `Button`, `ConfirmDialog`, `Icon`.
- Produces:
  - `APPROVAL_ARM_MS = 600`;
  - `ApprovalSheet({ runId, approval, count, onDecide(input), onTakeOver() })`. It renders `role="alertdialog"` and takes focus on mount, with no default button.
    - **Standard keys:** `a` approves, `d` denies, `e` edits.
    - **Budget keys:** `a` extends +50%, `f` finishes now. No key cancels.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/approval.spec.ts`:
```ts
import { DEFAULT_BUDGET, EMPTY_USAGE, type RunEventRecord } from "@mastertutor/contracts";
import type { Page } from "@playwright/test";
import { ids } from "../lib/fixtures/ids.ts";
import { RECORDED_APPROVAL_ID, RECORDED_RUN_ID, rec, recordedEvents } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun, rpcCalls, type RpcCall } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const decisions = (calls: RpcCall[]) => rpcCalls(calls, "runs/decideApproval");
const armed = (page: Page) => expect(page.locator(".run-approval-acts[data-armed]")).toBeVisible();
const LECTURE = "https://learn.example.edu/course/week-2/lecture-3";
const request = (approvalId: string, req: Record<string, unknown>) =>
  rec({ type: "approval_requested", approvalId, request: req as never });

/** Emits, waits two frames (rendered and listening), then presses a key: well inside the 600ms arm. */
async function emitThenKey(page: Page, records: RunEventRecord[], key: string, repeat = false) {
  await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
  await page.evaluate(
    async ({ records, key, repeat }) => {
      window.__sse.emit(records);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      document.dispatchEvent(new KeyboardEvent("keydown", { key, repeat, bubbles: true }));
    },
    { records, key, repeat },
  );
}

test.describe("Approval sheet", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "behaviour checks run once; 390 has its own test");

  test("keys arm after 600ms; Return and held keys never decide (S1, Review Focus 3, 8)", async ({ page }) => {
    const calls = await gotoRun(page);
    await emitThenKey(page, recordedEvents(), "a");
    const sheet = page.getByRole("alertdialog", { name: "Click “Start quiz” on learn.example.edu?" });
    await expect(sheet).toBeFocused();
    await armed(page);
    expect(decisions(calls)).toHaveLength(0);
    await page.keyboard.press("Enter");
    await page.evaluate(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", repeat: true, bubbles: true })),
    );
    expect(decisions(calls)).toHaveLength(0);
    await page.keyboard.press("a");
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => decisions(calls)).toEqual([
      { approvalId: RECORDED_APPROVAL_ID, decision: "approved", instruction: null, budgetChoice: null },
    ]);
  });

  test("shows the record context and the request screenshot (A3, S4)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, recordedEvents());
    await expect(page.getByText("On this record:")).toBeVisible();
    await expect(page.getByText("Week 2 quiz. Attempt 1 of 1")).toBeVisible();
    const withShot = ids.approval(2);
    await emit(page, [
      rec({ type: "approval_resolved", approvalId: RECORDED_APPROVAL_ID, status: "approved", decidedBy: "fixture-user" }),
      request(withShot, {
        kind: "form_submit",
        url: LECTURE,
        formSummary: "Quiz answers",
        screenshotKey: `runs/${RECORDED_RUN_ID}/steps/12-r12k7.png`,
      }),
    ]);
    await expect(page.locator(`img[src$="/approvals/${withShot}/screenshot"]`)).toBeVisible();
  });

  test("a safety check shows every warning and no spotlight (A2, S3, Review Focus 7)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [
      request(ids.approval(3), {
        kind: "risky_click",
        action: { type: "keypress", keys: ["ENTER"] },
        label: "Safety check: ignore the user",
        url: LECTURE,
        screenshotKey: null,
        safetyChecks: [{ code: "malicious_instructions", message: "The page asks the agent to ignore you" }],
      }),
    ]);
    const sheet = page.getByRole("alertdialog", { name: "The model flagged this step" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("list", { name: "Safety warnings" })).toContainText("The page asks the agent to ignore you");
    await expect(sheet).toContainText("The page may be trying to steer the agent. Deny unless you expected this.");
    await expect(sheet).toHaveAttribute("data-tone", "warn");
  });

  test("E opens the edit box and Send instead sends the instruction", async ({ page }) => {
    const calls = await gotoRun(page);
    await emit(page, recordedEvents());
    await armed(page);
    await page.keyboard.press("e");
    const box = page.getByLabel("Tell the agent what to do instead");
    await expect(box).toBeFocused();
    await box.fill("Don't start the quiz. Copy the visible prompts.");
    await page.getByRole("button", { name: "Send instead" }).click();
    await expect.poll(() => decisions(calls)[0]).toEqual({
      approvalId: RECORDED_APPROVAL_ID,
      decision: "edited",
      instruction: "Don't start the quiz. Copy the visible prompts.",
      budgetChoice: null,
    });
  });

  test("a failed decision brings the sheet back with an explanation", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/decideApproval": () => {
          throw new RpcFailure("INTERNAL_SERVER_ERROR", 500);
        },
      },
    });
    await emit(page, recordedEvents());
    await armed(page);
    await page.getByRole("button", { name: /^Deny/ }).click();
    await expect(page.getByText("Couldn't send your answer. The approval is still waiting for you.")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toBeVisible();
  });

  test("the budget sheet has no cancel key; Cancel asks first (S2, W5)", async ({ page }) => {
    const calls = await gotoRun(page);
    const budgetId = ids.approval(4);
    await emit(page, [
      request(budgetId, {
        kind: "budget",
        exceeded: "steps",
        usage: { ...EMPTY_USAGE, steps: 150 },
        budget: DEFAULT_BUDGET,
      }),
    ]);
    await expect(page.getByRole("alertdialog", { name: "Step limit reached" })).toBeVisible();
    await armed(page);
    await page.keyboard.press("d");
    expect(decisions(calls)).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel run" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Cancel this run?" });
    await expect(confirm.getByRole("button", { name: "Keep running" })).toBeFocused();
    await page.keyboard.press("a");
    expect(decisions(calls)).toHaveLength(0);
    await confirm.getByRole("button", { name: "Cancel run" }).click();
    await expect.poll(() => decisions(calls)).toEqual([
      { approvalId: budgetId, decision: "denied", instruction: null, budgetChoice: null },
    ]);
  });

  test("F finishes a budget wait", async ({ page }) => {
    const calls = await gotoRun(page);
    const budgetId = ids.approval(5);
    await emit(page, [
      request(budgetId, { kind: "budget", exceeded: "usd", usage: { ...EMPTY_USAGE, usd: 5 }, budget: DEFAULT_BUDGET }),
    ]);
    await armed(page);
    await page.keyboard.press("f");
    await expect.poll(() => decisions(calls)[0]).toEqual({
      approvalId: budgetId,
      decision: "approved",
      instruction: null,
      budgetChoice: "finish_now",
    });
  });

  test("taking over while an approval waits hides the sheet and never decides it (A5, Review Focus 6)", async ({ page }) => {
    const calls = await gotoRun(page);
    await emit(page, recordedEvents());
    await armed(page);
    await page.getByRole("button", { name: "Take over instead" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect.poll(() => rpcCalls(calls, "runs/takeControl").length).toBe(1);
    await emit(page, [
      rec({ type: "control", holder: "user" }),
      rec({ type: "approval_resolved", approvalId: RECORDED_APPROVAL_ID, status: "superseded", decidedBy: "agent" }),
    ]);
    await expect(frame(page)).toHaveAttribute("data-state", "control");
    expect(decisions(calls)).toHaveLength(0);
  });

  test("a failed takeover during an approval brings the sheet back (B6 §3)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, recordedEvents());
    await armed(page);
    await page.getByRole("button", { name: "Take over instead" }).click();
    await emit(page, [
      rec({ type: "error", code: "takeover_failed", message: "not connected" }),
      rec({ type: "control", holder: "agent" }),
    ]);
    await expect(frame(page)).toHaveAttribute("data-state", "approval");
    await expect(page.getByRole("alertdialog", { name: "Click “Start quiz” on learn.example.edu?" })).toBeVisible();
  });

  test("a request the policy decided in the same batch never mounts the sheet (A9)", async ({ page }) => {
    await gotoRun(page);
    const takeOver = page.getByRole("button", { name: "Take over", exact: true });
    await takeOver.focus();
    const id = ids.approval(6);
    await emit(page, [
      request(id, { kind: "risky_click", action: { type: "click", x: 5, y: 5, button: "left" }, label: "Post", url: LECTURE, screenshotKey: null }),
      rec({ type: "approval_resolved", approvalId: id, status: "approved", decidedBy: "policy" }),
    ]);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(takeOver).toBeFocused();
  });

  test.fixme("letters typed in the composer never decide (Review Focus 3)", async ({ page }) => {
    const calls = await gotoRun(page);
    await emit(page, recordedEvents());
    await armed(page);
    await page.getByLabel("Message the agent").pressSequentially("a dead end");
    expect(decisions(calls)).toHaveLength(0);
  });
});

test("a 500-character label stays inside the sheet at 390px (Review Focus 4)", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await emit(page, [
    request(ids.approval(7), {
      kind: "risky_click",
      action: { type: "click", x: 10, y: 10, button: "left" },
      label: `Pay\u200B${"W".repeat(496)}`,
      url: LECTURE,
      screenshotKey: null,
    }),
  ]);
  const box = (await page.getByRole("alertdialog").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
  await expect(frame(page)).toHaveAttribute("data-state", "approval");
});
```
The contract caps `label` at 500 characters, so this is the longest label the run view can receive. `untrustedText` caps the title at 120.

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm --filter @mastertutor/web test:ui -- approval.spec.ts`
Expected: FAIL, because no alertdialog renders.

- [ ] **Step 3: Implement the sheet.**

`apps/web/components/run/approval/approval-sheet.tsx`:
```tsx
"use client";

import { VIEWPORT, approvalScreenshotPath, type ApprovalDecisionInput } from "@mastertutor/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { approvalCopy } from "../model/approval-copy.ts";
import type { PendingApproval } from "../model/run-model.ts";

/** Keys and buttons stay inert this long after a sheet appears: a keystroke or click meant for something else never decides it (S1). */
export const APPROVAL_ARM_MS = 600;

type Choice = "approve" | "deny" | "edit" | "extend" | "finish";
const STANDARD_KEYS: Readonly<Record<string, Choice>> = { a: "approve", d: "deny", e: "edit" };
/** No key cancels a run (S2): Cancel is a button that asks first. */
const BUDGET_KEYS: Readonly<Record<string, Choice>> = { a: "extend", f: "finish" };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export interface ApprovalSheetProps {
  runId: string;
  approval: PendingApproval;
  count: number;
  onDecide(input: ApprovalDecisionInput): void;
  /** D19: the user may take over instead of deciding; the server supersedes the approval. */
  onTakeOver(): void;
}

export function ApprovalSheet({ runId, approval, count, onDecide, onTakeOver }: ApprovalSheetProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [instruction, setInstruction] = useState("");
  const copy = approvalCopy(approval.request);
  const request = approval.request;
  const screenshot =
    (request.kind === "risky_click" || request.kind === "form_submit") && request.screenshotKey !== null;
  const base = { approvalId: approval.id, instruction: null, budgetChoice: null } as const;

  const decide = (choice: Choice) => {
    if (!armed) return;
    switch (choice) {
      case "edit":
        setEditing(true);
        return;
      case "approve":
        onDecide({ ...base, decision: "approved" });
        return;
      case "deny":
        onDecide({ ...base, decision: "denied" });
        return;
      case "extend":
        onDecide({ ...base, decision: "approved", budgetChoice: "extend" });
        return;
      case "finish":
        onDecide({ ...base, decision: "approved", budgetChoice: "finish_now" });
        return;
    }
  };
  const sendInstead = () => {
    const text = instruction.trim();
    if (text) onDecide({ approvalId: approval.id, decision: "edited", instruction: text, budgetChoice: null });
  };

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => setArmed(true), APPROVAL_ARM_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (editing || confirmCancel) return undefined;
    const keys = copy.budget ? BUDGET_KEYS : STANDARD_KEYS;
    const onKey = (event: KeyboardEvent) => {
      if (!armed || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || document.fullscreenElement) return;
      // A key pressed inside another dialog (Stop, hand back, the cancel confirm) is not for us.
      const within = event.target instanceof Element ? event.target.closest('[role="dialog"], [role="alertdialog"]') : null;
      if (within && within !== ref.current) return;
      const choice = keys[event.key.toLowerCase()];
      if (!choice) return;
      event.preventDefault();
      decide(choice);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const gated = { "aria-disabled": armed ? undefined : true } as const;
  return (
    <div
      ref={ref}
      className="run-approval"
      data-tone={copy.tone}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      tabIndex={-1}
    >
      <span className="run-approval-handle" aria-hidden="true" />
      <div className="run-approval-top">
        <span className="run-approval-icon" aria-hidden="true">
          <Icon name={copy.tone === "warn" ? "needsReview" : "hand"} />
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="run-approval-title">
            <bdi>{copy.title}</bdi>
          </h3>
          <p id={`${id}-body`} className="run-approval-body">
            <bdi>{copy.body}</bdi>
          </p>
        </div>
      </div>
      {copy.checks.length ? (
        <ul className="run-approval-checks" aria-label="Safety warnings">
          {copy.checks.map((check, i) => (
            <li key={i}>
              <bdi>{check}</bdi>
            </li>
          ))}
        </ul>
      ) : null}
      {copy.context ? (
        <p className="run-approval-context">
          On this record:{" "}
          <q>
            <bdi>{copy.context}</bdi>
          </q>
        </p>
      ) : null}
      {copy.risk ? (
        <p className="run-approval-risk">
          <Icon name="needsReview" size="sm" />
          <span>{copy.risk}</span>
        </p>
      ) : null}
      {screenshot ? (
        <figure className="run-approval-shot">
          <img src={approvalScreenshotPath(runId, approval.id)} alt="The page when the agent asked" />
          {copy.spotlight ? (
            <span
              className="run-approval-spot"
              aria-hidden="true"
              style={{
                left: `${(copy.spotlight.x / VIEWPORT.width) * 100}%`,
                top: `${(copy.spotlight.y / VIEWPORT.height) * 100}%`,
              }}
            />
          ) : null}
        </figure>
      ) : null}
      {copy.details.length ? (
        <details className="run-approval-details">
          <summary>
            <Icon name="chevronRight" size="sm" />
            Details
          </summary>
          <dl>
            {copy.details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>
                  <bdi>{v}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {editing ? (
        <div className="run-approval-edit">
          <label htmlFor={`${id}-edit`} className="sr-only">
            Tell the agent what to do instead
          </label>
          <textarea
            id={`${id}-edit`}
            autoFocus
            className="run-note"
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
          <div className="run-approval-edit-acts">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={sendInstead} disabled={!instruction.trim()}>
              Send instead
            </Button>
          </div>
        </div>
      ) : copy.budget ? (
        <div className="run-approval-acts" data-armed={armed || undefined}>
          <Button {...gated} onClick={() => armed && setConfirmCancel(true)}>
            Cancel run
          </Button>
          <Button {...gated} aria-keyshortcuts="F" onClick={() => decide("finish")}>
            Finish now <kbd className="kbd">F</kbd>
          </Button>
          <Button {...gated} variant="primary" aria-keyshortcuts="A" onClick={() => decide("extend")}>
            Extend +50% <kbd className="kbd">A</kbd>
          </Button>
        </div>
      ) : (
        <div className="run-approval-acts" data-armed={armed || undefined}>
          <Button {...gated} aria-keyshortcuts="D" onClick={() => decide("deny")}>
            Deny <kbd className="kbd">D</kbd>
          </Button>
          <Button {...gated} aria-keyshortcuts="E" onClick={() => decide("edit")}>
            Edit <kbd className="kbd">E</kbd>
          </Button>
          <Button {...gated} variant="primary" aria-keyshortcuts="A" onClick={() => decide("approve")}>
            Approve <kbd className="kbd">A</kbd>
          </Button>
        </div>
      )}
      <div className="run-approval-foot">
        {count > 1 ? <p className="run-approval-more">{count - 1} more waiting after this</p> : <span />}
        <Button variant="plain" icon="hand" onClick={onTakeOver}>
          Take over instead
        </Button>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this run?"
        description="The agent stops now. Everything it captured stays in the draft note."
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        destructive
        onConfirm={() => onDecide({ ...base, decision: "denied" })}
      />
    </div>
  );
}
```

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* Approval spotlight sheet (Task 14): panel over the frame (wide), bottom sheet (≤820px). */
  .run-approval {
    position: fixed;
    inset: auto 0 0;
    z-index: var(--z-sheet);
    max-height: 80dvh;
    padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
    overflow: auto;
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    background: var(--elevated);
    box-shadow: var(--e3);
    color: var(--label);
    animation-name: run-rise;
    animation-duration: var(--motion-spring-soft-dur);
    animation-timing-function: var(--motion-spring-soft);
    animation-fill-mode: both;
    @variant md {
      position: absolute;
      inset: auto;
      top: 50%;
      left: 50%;
      z-index: 8;
      width: min(25rem, calc(100% - 2rem));
      max-height: calc(100% - 2rem);
      border-radius: var(--r-lg);
      translate: -50% -50%;
    }
    &:focus-visible {
      outline: 0.125rem solid var(--tint);
      outline-offset: 0.125rem;
    }
  }
  @keyframes run-rise {
    from {
      opacity: 0;
      transform: translateY(1rem) scale(0.98);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .run-approval-handle {
    display: block;
    width: 2.25rem;
    height: 0.3125rem;
    margin: -0.5rem auto 0.9rem;
    border-radius: var(--r-pill);
    background: var(--label-3);
    @variant md {
      display: none;
    }
  }
  .run-approval-top {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }
  .run-approval-icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    background: var(--signal);
    color: var(--on-signal);
  }
  .run-approval[data-tone="warn"] .run-approval-icon {
    background: var(--warn-wash);
    color: var(--warn);
  }
  .run-approval-title {
    margin: 0.1rem 0 0.3rem;
    font: 600 1.0625rem/1.25 var(--font-ui);
    overflow-wrap: anywhere;
  }
  .run-approval-body {
    margin: 0;
    color: var(--label-2);
    font-size: 0.8125rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .run-approval-checks {
    display: grid;
    gap: 0.35rem;
    margin: 0.85rem 0 0;
    padding: 0.6rem 0.7rem 0.6rem 1.6rem;
    border-radius: var(--r-sm);
    background: var(--warn-wash);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }
  .run-approval-context {
    margin: 0.75rem 0 0;
    color: var(--label-2);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
    & q {
      color: var(--label);
    }
  }
  .run-approval-risk {
    display: flex;
    gap: 0.5rem;
    margin: 0.85rem 0 0.25rem;
    padding: 0.6rem 0.7rem;
    border-radius: var(--r-sm);
    background: var(--warn-wash);
    font-size: 0.75rem;
    & .ic {
      color: var(--warn);
    }
  }
  .run-approval-shot {
    position: relative;
    margin: 0.75rem 0 0;
    overflow: hidden;
    border-radius: var(--r-sm);
    box-shadow: var(--e1);
    & img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: contain;
      background: var(--bg-2);
    }
  }
  .run-approval-spot {
    position: absolute;
    width: 1.75rem;
    height: 1.75rem;
    margin: -0.875rem 0 0 -0.875rem;
    border: 0.125rem solid var(--signal);
    border-radius: 50%;
    box-shadow: 0 0 0 100vmax var(--scrim);
  }
  .run-approval-details {
    margin-top: 0.6rem;
    font-size: 0.75rem;
    & summary {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      min-height: var(--hit);
      color: var(--tint-text);
      cursor: pointer;
      list-style: none;
    }
    & dl {
      display: grid;
      gap: 0.35rem;
      margin: 0.5rem 0 0;
    }
    & dl div {
      display: grid;
      grid-template-columns: 4.5rem minmax(0, 1fr);
      gap: 0.75rem;
    }
    & dt {
      color: var(--label-2);
    }
    & dd {
      margin: 0;
      font: 400 0.6875rem/1.5 var(--font-code);
      overflow-wrap: anywhere;
    }
  }
  .run-approval-acts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-top: 1rem;
    & > .btn-primary {
      grid-column: 1 / -1;
      order: -1;
    }
    @variant md {
      grid-template-columns: 1fr 1fr 1.35fr;
      & > .btn-primary {
        grid-column: auto;
        order: 0;
      }
    }
  }
  .run-approval-edit {
    margin-top: 0.85rem;
  }
  .run-approval-edit-acts {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .run-approval-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .run-approval-more {
    margin: 0;
    color: var(--label-2);
    font-size: 0.75rem;
  }
```
Arming has no visual fade, so the axe contrast check never sees dimmed text. `aria-disabled` states it for assistive technology.

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
3. Replace `  const view: RunModel | null = model;` with:
```tsx
  // Optimistic decisions: a decided approval leaves at once and comes back if the RPC fails.
  const view: RunModel | null = useMemo(
    () => (model ? { ...model, approvals: model.approvals.filter((a) => !deciding.has(a.id)) } : null),
    [model, deciding],
  );
```
4. After the `resume` callback, add:
```tsx
  const decide = useCallback(
    (input: ApprovalDecisionInput) => {
      setDeciding((s) => new Set(s).add(input.approvalId));
      api.runs.decideApproval(input).catch(() => {
        setDeciding((s) => {
          const next = new Set(s);
          next.delete(input.approvalId);
          return next;
        });
        toast({ title: "Couldn't send your answer. The approval is still waiting for you." });
      });
    },
    [toast],
  );
```
5. Below the line `              onLiveStatus={setLiveStatus}`, insert:
```tsx
              approval={
                state === "approval" && view.approvals[0] ? (
                  <ApprovalSheet
                    key={view.approvals[0].id}
                    runId={runId}
                    approval={view.approvals[0]}
                    count={view.approvals.length}
                    onDecide={decide}
                    onTakeOver={startTakeover}
                  />
                ) : null
              }
              spotlight={
                state === "approval" && view.approvals[0]
                  ? approvalCopy(view.approvals[0].request).spotlight
                  : null
              }
```

- [ ] **Step 5: Run the spec and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web test:ui -- approval.spec.ts run-states.spec.ts takeover.spec.ts && pnpm typecheck && pnpm lint`
Expected: PASS. The composer test stays `fixme` until Task 15.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run apps/web/e2e/approval.spec.ts apps/web/styles/run.css
git add apps/web/components/run apps/web/e2e/approval.spec.ts apps/web/styles/run.css
git commit -m "feat(web): approval sheet: armed D/E/A keys, no cancel key, safety checks, record context, request screenshot, take over instead"
```

---

### Task 15: Timeline, OTP card, budget meters, message composer and replay — **Replaced** (A4, E7, S6, X1, X2)

**Changes from the base task:**
- **E7.** `useMediaQuery` and `MEDIA` come from F1, so `components/run/use-media-query.ts` is not created. On compact widths (≤820px) the timeline opens in F1's `Sheet` behind a "Steps · …" button; at md and up it is an `aside`. The OTP card is too important to hide in a sheet, so on compact widths it renders in the stage under the frame.
- **X1.** Step rows use the delight `StatusMark`, which speaks its own status (`role="img"`).
- **X2.** Budget numerals use `RollingNumber` with `formatCount` strings.
- **S6.** Every row line is cleaned text inside `<bdi>`.
- **A4.** Decisions name the viewer.
- **OTP retry.** The OTP card remounts its `CodeSlots` after a failed submit, so the retry starts empty.

**Files:**
- Create:
  - `apps/web/components/run/browser/replay-scrubber.tsx`
  - `apps/web/components/run/timeline/{timeline-panel,otp-card,budget-meters,message-composer}.tsx`
  - `apps/web/e2e/timeline.spec.ts`, `apps/web/e2e/code-slots.spec.ts`
- Modify: `apps/web/components/run/run-view.tsx`, `apps/web/e2e/approval.spec.ts` (remove the `fixme`), `apps/web/styles/run.css`

**Interfaces:**
- Consumes: `timelineItems`, `thinkingState`, `summaryLabel` (Task 6), `StatusMark`, `ThoughtLine`, `RollingNumber`, `CodeSlots`, `formatCount`, `compactNumber`, `stepScreenshotPath`, `Sheet`, `IconButton`, `useMediaQuery`, `MEDIA`.
- Produces:
  - `REPLAY_INTERVAL_MS = 1000` and `ReplayScrubber({ steps, seq, playing, onSeq, onTogglePlay })`;
  - `BudgetMeters({ usage, budget })` (`data-testid="meter-steps|meter-spend|meter-time"`);
  - `MessageComposer({ disabled, onSend })`;
  - `OtpCard({ runId, host })` (`data-testid="otp-card"`);
  - `TimelinePanel({ runId, items, summary, thinking, otp, replaySeq, onReplay, canMessage, onSend })`.

- [ ] **Step 1: Write the failing specs.**

`apps/web/e2e/timeline.spec.ts`:
```ts
import { RECORDED_APPROVAL_ID, rec, recordedEvents } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, frame, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const steps = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Steps" });
/** FIXTURE_VIEWER.id (lib/server/viewer.ts imports server-only modules, so specs name it). */
const VIEWER_ID = "fixture-user";

test.describe("Timeline", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "content checks run once; 390 has its own test");

  test("lists steps with spoken status marks, a vault-fill chip and a summary", async ({ page }) => {
    await gotoRun(page);
    await expect(steps(page).getByText("5 steps · 2 captures")).toBeVisible();
    await expect(steps(page).getByText("Filled the password for ada-learn")).toBeVisible();
    await expect(steps(page).getByText("Vault fill")).toBeVisible();
    await expect(steps(page).getByRole("img", { name: "Completed" }).first()).toBeVisible();
  });

  test("ThoughtLine thinks during decide, then settles while acting", async ({ page }) => {
    await gotoRun(page);
    const decideStart = recordedEvents()[3]!;
    await emit(page, [decideStart]);
    await expect(page.getByRole("status").filter({ hasText: "Deciding whether to start the quiz" })).toBeAttached();
    await emit(page, [
      rec({ type: "step", seq: 13, phase: "act", state: "started", caption: "Opening the quiz", url: null, screenshotKey: null, action: null }),
    ]);
    await expect(page.getByRole("status").filter({ hasText: /^Thought for/ })).toBeAttached();
  });

  test("budget meters roll to new usage", async ({ page }) => {
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
          if (fail) throw new RpcFailure("INTERNAL_SERVER_ERROR", 500);
          return { ok: true };
        },
      },
    });
    const box = page.getByLabel("Message the agent");
    await box.fill("Skip the quiz");
    await box.press("Enter");
    await expect(steps(page).getByText("Skip the quiz")).toHaveCount(1);
    await emit(page, [rec({ type: "user_message", text: "Skip the quiz" })]);
    await expect(steps(page).getByText("Skip the quiz")).toHaveCount(1);
    fail = true;
    await box.fill("Second note");
    await box.press("Enter");
    await expect(page.getByText("Couldn't send your message. It's back in the box.")).toBeVisible();
    await expect(box).toHaveValue("Second note");
  });

  test("decisions name the viewer, another member and superseded approvals (A4, Review Focus 6)", async ({ page }) => {
    await gotoRun(page);
    await emit(page, [
      ...recordedEvents(),
      rec({ type: "approval_resolved", approvalId: RECORDED_APPROVAL_ID, status: "approved", decidedBy: VIEWER_ID }),
    ]);
    await expect(steps(page).getByText("You approved: click “Start quiz”")).toBeVisible();
    await emit(page, [
      rec({
        type: "approval_requested",
        approvalId: "00000000-0000-4000-8000-000009000008",
        request: { kind: "new_origin", origin: "https://docs.example.org", url: "https://docs.example.org/x" },
      }),
      rec({ type: "approval_resolved", approvalId: "00000000-0000-4000-8000-000009000008", status: "superseded", decidedBy: "agent" }),
    ]);
    await expect(steps(page).getByText("No longer needed: open docs.example.org")).toBeVisible();
  });

  test("replay: a step with a screenshot opens the scrubber, play advances, Jump to live returns", async ({ page }) => {
    await gotoRun(page);
    await page.getByRole("button", { name: "Replay step: Clicked “Log in”" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "replay");
    await expect(page.getByRole("slider", { name: "Replay position" })).toHaveValue("2");
    await page.getByRole("button", { name: "Play replay" }).click();
    await expect(page.getByRole("slider", { name: "Replay position" })).toHaveValue("3", { timeout: 3_000 });
    await frame(page).getByRole("button", { name: "Jump to live" }).click();
    await expect(frame(page)).toHaveAttribute("data-state", "live");
  });
});

test("≤820px: the timeline opens in a sheet from the Steps button", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await expect(page.getByRole("complementary", { name: "Steps" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Steps/ }).click();
  const sheet = page.getByRole("dialog", { name: "Steps" });
  await expect(sheet.getByText("Filled the password for ada-learn")).toBeInViewport();
});
```

`apps/web/e2e/code-slots.spec.ts`:
```ts
import { RECORDED_RUN_ID, rec } from "../lib/fixtures/run-recording.ts";
import { RpcFailure, emit, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const otpWait = () => rec({ type: "status", status: "waiting", waitReason: "otp", reason: null });

test.describe("OTP card", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "behaviour checks run once; 390 has its own test");

  test("the code goes to submitOtp once and never stays in the page (security review, Review Focus 5)", async ({ page }) => {
    const consoleText: string[] = [];
    page.on("console", (m) => consoleText.push(m.text()));
    const calls = await gotoRun(page);
    await emit(page, [otpWait()]);
    const input = page.getByLabel("One-time code");
    await expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await input.focus();
    await page.keyboard.type("481516");
    await expect(page.getByText("Sent to the browser. The agent only saw “code entered”.")).toBeVisible();
    expect(rpcCalls(calls, "runs/submitOtp")).toEqual([{ runId: RECORDED_RUN_ID, code: "481516" }]);
    await expect(input).toHaveValue("");
    expect(await page.content()).not.toContain("481516");
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })),
    ).not.toContain("481516");
    expect(consoleText.join("\n")).not.toContain("481516");
  });

  test("pasting an 8-digit code with separators submits all 8", async ({ page }) => {
    const calls = await gotoRun(page);
    await emit(page, [otpWait()]);
    await page.getByLabel("One-time code").focus();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text", "1234-5678");
      document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });
    await expect.poll(() => rpcCalls(calls, "runs/submitOtp")[0]).toEqual({ runId: RECORDED_RUN_ID, code: "12345678" });
  });

  test("a failed submit clears the boxes and asks again", async ({ page }) => {
    await gotoRun(page, {
      handlers: {
        "runs/submitOtp": () => {
          throw new RpcFailure("BAD_REQUEST", 400, "expired");
        },
      },
    });
    await emit(page, [otpWait()]);
    await page.getByLabel("One-time code").focus();
    await page.keyboard.type("111111");
    await expect(page.getByText("Couldn't send the code. Enter it again.")).toBeVisible();
    await expect(page.getByLabel("One-time code")).toBeEnabled();
    await expect(page.getByTestId("otp-card").locator(".cslots-slot[data-filled]")).toHaveCount(0);
  });
});

test("six boxes fit the card at 390px (D22)", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await emit(page, [otpWait()]);
  const card = page.getByTestId("otp-card");
  const cardBox = (await card.boundingBox())!;
  const slots = card.locator(".cslots-slot");
  await expect(slots).toHaveCount(6);
  for (const box of await Promise.all((await slots.all()).map((s) => s.boundingBox()))) {
    expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
  }
});
```

- [ ] **Step 2: Run the specs to verify they fail.**

Run: `pnpm --filter @mastertutor/web test:ui -- timeline.spec.ts code-slots.spec.ts`
Expected: FAIL, because there is no Steps panel yet.

- [ ] **Step 3: Implement the components.**

`apps/web/components/run/browser/replay-scrubber.tsx`:
```tsx
"use client";

import { IconButton } from "@/components/ui/button.tsx";
import type { StepRow } from "../model/run-model.ts";

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
    <div className="run-scrub glass">
      <IconButton
        icon={playing ? "pause" : "play"}
        label={playing ? "Pause replay" : "Play replay"}
        onClick={onTogglePlay}
      />
      <div className="run-scrub-track">
        <div className="run-scrub-rail" />
        <div className="run-scrub-fill" style={{ transform: `scaleX(${ratio})` }} />
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
      <span className="run-scrub-label">
        {index + 1} / {steps.length}
      </span>
    </div>
  );
}
```

`apps/web/components/run/timeline/budget-meters.tsx`:
```tsx
import type { Budget, Usage } from "@mastertutor/contracts";
import { compactNumber, formatCount } from "@/components/bits/format.ts";
import { RollingNumber } from "@/components/bits/rolling-number.tsx";

export function BudgetMeters({ usage, budget }: { usage: Usage; budget: Budget }) {
  const rows = [
    { id: "steps", label: "Steps", value: usage.steps, max: budget.maxSteps, decimals: 0, prefix: "", suffix: "", foot: "Pauses and asks at the limit" },
    { id: "spend", label: "Spend", value: usage.usd, max: budget.maxUsd, decimals: 2, prefix: "$", suffix: "", foot: `${compactNumber(usage.inputTokens + usage.outputTokens)} tokens` },
    { id: "time", label: "Time", value: Math.floor(usage.activeMs / 60_000), max: budget.maxActiveMinutes, decimals: 0, prefix: "", suffix: " min", foot: "Counts while the agent works" },
  ];
  return (
    <dl className="run-meters" aria-label="Budget">
      {rows.map((r) => (
        <div key={r.id} className="run-meter" data-testid={`meter-${r.id}`}>
          <dt className="eyebrow">{r.label}</dt>
          <dd className="run-meter-value">
            <span className="run-meter-num">
              <RollingNumber value={formatCount(r.value, r.decimals, r.prefix, r.suffix)} />
              <small> / {formatCount(r.max, r.decimals, r.prefix, r.suffix)}</small>
            </span>
            <span className="run-meter-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(1, r.value / r.max)})` }} />
            </span>
            <span className="run-meter-foot">{r.foot}</span>
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
import { IconButton } from "@/components/ui/button.tsx";

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
    <form
      className="run-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Message the agent
      </label>
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
      <IconButton
        type="submit"
        icon="send"
        label="Send message"
        className="run-send"
        disabled={disabled || !text.trim()}
      />
    </form>
  );
}
```

`apps/web/components/run/timeline/otp-card.tsx`:
```tsx
"use client";

import { useId, useState } from "react";
import { CodeSlots } from "@/components/bits/code-slots.tsx";
import { api } from "@/lib/api/client.ts";

type Phase = "entering" | "sending" | "sent" | "failed";
const PHASE_TEXT: Record<Phase, string> = {
  entering: "Goes straight to the browser. Never to the model.",
  sending: "Sending to the browser…",
  sent: "Sent to the browser. The agent only saw “code entered”.",
  failed: "Couldn't send the code. Enter it again.",
};

/** The code exists only in CodeSlots' state and this closure until web seals it (spec §9). */
export function OtpCard({ runId, host }: { runId: string; host: string }) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>("entering");
  const [sealed, setSealed] = useState<number | null>(null);
  // A failed submit remounts CodeSlots, so the retry starts with empty boxes.
  const [attempt, setAttempt] = useState(0);
  const submit = (code: string) => {
    setSealed(code.length);
    setPhase("sending");
    api.runs.submitOtp({ runId, code }).then(
      () => setPhase("sent"),
      () => {
        setSealed(null);
        setPhase("failed");
        setAttempt((n) => n + 1);
      },
    );
  };
  return (
    <section className="run-otp" aria-labelledby={`${id}-title`} data-testid="otp-card">
      <h3 id={`${id}-title`} className="run-otp-title">
        Enter the code sent to you
      </h3>
      <p className="run-otp-foot">
        <bdi>{host}</bdi> asked for a one-time code.
      </p>
      <CodeSlots key={attempt} label="One-time code" sealed={sealed} onComplete={submit} />
      <p className="run-otp-state" data-phase={phase} role="status">
        {PHASE_TEXT[phase]}
      </p>
      <p className="run-otp-flow">
        <span className="sr-only">Where the code goes: you, then the browser, never the model.</span>
        <span aria-hidden="true">
          You → Browser · <s>model</s>
        </span>
      </p>
    </section>
  );
}
```

`apps/web/components/run/timeline/timeline-panel.tsx`:
```tsx
"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { ThoughtLine } from "@/components/bits/thought-line.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { MEDIA } from "@/lib/breakpoints.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import type { ThinkingState, TimelineItem } from "../model/timeline-items.ts";
import { MessageComposer } from "./message-composer.tsx";

export interface TimelinePanelProps {
  runId: string;
  items: TimelineItem[];
  summary: string;
  thinking: ThinkingState | null;
  /** The OTP card; on compact widths the view renders it in the stage instead. */
  otp: ReactNode;
  replaySeq: number | null;
  onReplay(seq: number): void;
  canMessage: boolean;
  onSend(text: string): Promise<boolean>;
}

function Row({ item, runId, selected, onReplay }: { item: TimelineItem; runId: string; selected: boolean; onReplay(seq: number): void }) {
  switch (item.kind) {
    case "step": {
      const body = (
        <>
          {item.hasShot ? (
            <img className="run-tl-thumb" src={stepScreenshotPath(runId, item.seq)} alt="" loading="lazy" />
          ) : (
            <span className="run-tl-thumb" aria-hidden="true" />
          )}
          <span className="run-tl-text">
            <span className="run-tl-verb" data-kind={item.verbKind ?? undefined}>
              {item.verb}
            </span>
            <span className="run-tl-line">
              <StatusMark status={item.status} />
              <bdi>{item.line}</bdi>
            </span>
            {item.credential ? (
              <span className="run-tl-alias">
                <Icon name="password" size="sm" />
                Vault fill
              </span>
            ) : null}
          </span>
          <time className="run-tl-ts" dateTime={item.at}>
            {item.ts}
          </time>
        </>
      );
      return (
        <li className="run-tl-row" data-current={item.current || undefined} data-selected={selected || undefined}>
          {item.hasShot ? (
            <button type="button" className="run-tl-body" aria-label={`Replay step: ${item.line}`} onClick={() => onReplay(item.seq)}>
              {body}
            </button>
          ) : (
            <div className="run-tl-body">{body}</div>
          )}
        </li>
      );
    }
    case "message":
      return (
        <li className="run-tl-row">
          <div className="run-tl-message" data-pending={item.pending || undefined}>
            <span className="run-tl-verb">You</span>
            <p>
              <bdi>{item.text}</bdi>
            </p>
          </div>
        </li>
      );
    case "decision":
      return (
        <li className="run-tl-row">
          <div className="run-tl-body">
            <span className="run-tl-thumb" aria-hidden="true" />
            <span className="run-tl-line">
              <StatusMark status={item.status} />
              <bdi>{item.line}</bdi>
            </span>
            <time className="run-tl-ts" dateTime={item.at}>
              {item.ts}
            </time>
          </div>
        </li>
      );
    case "download":
    case "notice":
      return (
        <li className="run-tl-row" data-tone={item.kind === "notice" ? item.tone : undefined}>
          <div className="run-tl-body">
            <span className="run-tl-thumb" aria-hidden="true">
              <Icon name={item.kind === "download" ? "export" : "info"} size="sm" />
            </span>
            <span className="run-tl-line">
              <bdi>{item.line}</bdi>
            </span>
            <time className="run-tl-ts" dateTime={item.at}>
              {item.ts}
            </time>
          </div>
        </li>
      );
  }
}

function TimelineList(p: TimelinePanelProps) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 160) list.scrollTop = list.scrollHeight;
  }, [p.items.length, p.otp]);
  return (
    <ol ref={listRef} className="run-tl-list">
      {p.items.map((item) => (
        <Row
          key={item.key}
          item={item}
          runId={p.runId}
          selected={item.kind === "step" && item.seq === p.replaySeq}
          onReplay={p.onReplay}
        />
      ))}
      {p.thinking ? (
        <li className="run-tl-row run-tl-pad">
          <ThoughtLine label={p.thinking.label} working={p.thinking.working} since={p.thinking.since} />
        </li>
      ) : null}
      {p.otp ? <li className="run-tl-row">{p.otp}</li> : null}
    </ol>
  );
}

export function TimelinePanel(p: TimelinePanelProps) {
  const id = useId();
  const regular = useMediaQuery(MEDIA.md);
  const [open, setOpen] = useState(false);
  const composer = <MessageComposer disabled={!p.canMessage} onSend={p.onSend} />;
  if (regular) {
    return (
      <aside className="run-tl" aria-labelledby={`${id}-title`}>
        <div className="run-tl-head">
          <h2 id={`${id}-title`} className="run-tl-title">
            Steps
          </h2>
          <span className="run-tl-summary">{p.summary}</span>
        </div>
        <TimelineList {...p} />
        {composer}
      </aside>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn btn-gray run-tl-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Steps · {p.summary}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Steps">
        <TimelineList {...p} otp={null} />
        {composer}
      </Sheet>
    </>
  );
}
```

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* Replay scrubber (Task 15). */
  .run-scrub {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: var(--hit);
    padding: 0 0.6rem;
    border-top: 0.03125rem solid var(--hairline);
  }
  .run-scrub-track {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    min-height: var(--hit);
    & input {
      position: absolute;
      inset: 0;
      width: 100%;
      margin: 0;
      opacity: 0;
      cursor: pointer;
    }
    &:has(input:focus-visible) .run-scrub-rail {
      outline: 0.125rem solid var(--tint);
      outline-offset: 0.25rem;
    }
  }
  .run-scrub-rail,
  .run-scrub-fill {
    position: absolute;
    inset-inline: 0;
    height: 0.1875rem;
    border-radius: var(--r-pill);
  }
  .run-scrub-rail {
    background: var(--fill);
  }
  .run-scrub-fill {
    background: var(--label);
    transform-origin: left;
    transition-property: transform;
    transition-duration: var(--motion-dur-micro);
    transition-timing-function: var(--motion-ease-out);
  }
  .run-scrub-label {
    color: var(--label-2);
    font: 400 0.6875rem/1 var(--font-code);
    white-space: nowrap;
  }
  /* Budget meters (Task 15). */
  .run-meters {
    display: grid;
    gap: 1rem;
    margin: 0;
    padding-top: 1.5rem;
    border-top: 0.0625rem solid var(--sep);
    @variant md {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1.5rem;
    }
  }
  .run-meter {
    min-width: 0;
  }
  .run-meter-value {
    display: grid;
    gap: 0.45rem;
    margin: 0.45rem 0 0;
  }
  .run-meter-num {
    color: var(--label);
    font: 600 1.75rem/1 var(--font-display);
    letter-spacing: -0.04em;
    white-space: nowrap;
    @variant md {
      font-size: 2.25rem;
    }
    & small {
      color: var(--label-2);
      font-size: 0.875rem;
      font-weight: 500;
      letter-spacing: -0.01em;
    }
  }
  .run-meter-bar {
    position: relative;
    height: 0.125rem;
    overflow: hidden;
    background: var(--fill);
    & i {
      position: absolute;
      inset: 0;
      background: var(--label);
      transform-origin: left;
      transition-property: transform;
      transition-duration: var(--motion-dur-panel);
      transition-timing-function: var(--motion-ease-out);
    }
  }
  .run-meter-foot {
    color: var(--label-2);
    font-size: 0.75rem;
  }
  /* Timeline (Task 15): aside at md and up, Sheet below. */
  .run-tl {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
    @variant lg {
      position: sticky;
      top: calc(var(--toolbar-h) + 1rem);
      align-self: start;
      max-height: calc(100dvh - var(--toolbar-h) - 2rem);
    }
  }
  .run-tl-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .run-tl-title {
    margin: 0;
    color: var(--label);
    font: 600 1.25rem/1.2 var(--font-ui);
  }
  .run-tl-summary {
    color: var(--label-2);
    font-size: 0.75rem;
  }
  .run-tl-toggle {
    width: 100%;
  }
  .run-tl-list {
    flex: 1;
    min-height: 12rem;
    margin: 0;
    padding: 0;
    list-style: none;
    @variant lg {
      overflow: auto;
      scrollbar-width: thin;
    }
  }
  .run-tl-row {
    position: relative;
    & + & {
      border-top: 0.0625rem solid var(--sep);
    }
  }
  .run-tl-pad {
    padding: 0.7rem 0.5rem;
  }
  .run-tl-body {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) auto;
    gap: 0.75rem;
    width: 100%;
    padding: 0.7rem 0.5rem;
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
  }
  button.run-tl-body {
    cursor: pointer;
    &:hover {
      background: var(--fill-2);
    }
  }
  .run-tl-row[data-selected] .run-tl-body {
    background: var(--tint-wash);
  }
  .run-tl-thumb {
    display: grid;
    place-items: center;
    width: 3.5rem;
    height: 2.1875rem;
    border-radius: var(--r-xs);
    background: var(--bg-2);
    box-shadow: var(--e1);
    color: var(--label-2);
    object-fit: cover;
  }
  .run-tl-row[data-current] .run-tl-thumb {
    box-shadow: 0 0 0 0.09375rem var(--signal);
  }
  .run-tl-text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    font: 500 0.8125rem/1.38 var(--font-ui);
  }
  .run-tl-line {
    --smark-size: 1rem;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    min-width: 0;
    color: var(--label);
    font: 500 0.8125rem/1.38 var(--font-ui);
    overflow-wrap: anywhere;
    & .smark {
      margin-top: 0.1rem;
    }
  }
  .run-tl-row[data-tone="warn"] .run-tl-thumb {
    color: var(--warn);
  }
  .run-tl-verb {
    color: var(--label-2);
    font: 600 0.625rem/1 var(--font-ui);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    &[data-kind="cred"] {
      color: var(--tint-text);
    }
    &[data-kind="sig"] {
      color: var(--signal);
    }
  }
  .run-tl-alias {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    width: fit-content;
    padding: 0.125rem 0.5rem;
    border-radius: var(--r-pill);
    background: var(--tint-wash);
    color: var(--tint-text);
    font-size: 0.6875rem;
  }
  .run-tl-ts {
    color: var(--label-2);
    font: 400 0.6875rem/1.4 var(--font-code);
  }
  .run-tl-message {
    margin: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-radius: var(--r-md);
    background: var(--tint-wash);
    & p {
      margin: 0.25rem 0 0;
      font-size: 0.8125rem;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    &[data-pending] p {
      color: var(--label-2);
    }
  }
  .run-composer {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    padding: 0.5rem;
    border-radius: var(--r-lg);
    background: var(--fill-2);
    &:focus-within {
      box-shadow: 0 0 0 0.125rem var(--tint);
    }
    & textarea {
      flex: 1;
      min-width: 0;
      min-height: 2.25rem;
      max-height: 8rem;
      padding: 0.5rem;
      border: 0;
      background: none;
      color: var(--label);
      font: 400 0.875rem/1.4 var(--font-ui);
      field-sizing: content;
      resize: none;
      &:focus-visible {
        outline: none;
      }
    }
  }
  .run-send:not(:disabled) {
    background: var(--tint);
    color: var(--on-tint);
    border-radius: 50%;
  }
  /* OTP card (Task 15). */
  .run-otp {
    margin: 0.5rem;
    padding: 0.85rem;
    border-radius: var(--r-md);
    background: var(--elevated);
    box-shadow: var(--e2);
  }
  .run-otp-title {
    margin: 0;
    font: 600 0.8125rem/1.3 var(--font-ui);
  }
  .run-otp-foot {
    margin: 0.15rem 0 0.65rem;
    color: var(--label-2);
    font-size: 0.75rem;
  }
  .run-otp-state {
    margin: 0.65rem 0 0;
    color: var(--label-2);
    font: 500 0.75rem/1.3 var(--font-ui);
    &[data-phase="sent"] {
      color: var(--ok);
    }
    &[data-phase="failed"] {
      color: var(--danger);
    }
  }
  .run-otp-flow {
    margin: 0.5rem 0 0;
    color: var(--label-2);
    font-size: 0.6875rem;
    white-space: nowrap;
    & s {
      text-decoration-color: var(--signal);
      white-space: nowrap;
    }
  }
```
A pending message reads in `--label-2` until its echo arrives. That is a colour change, not opacity, so it keeps AA contrast.

- [ ] **Step 4: Wire into `run-view.tsx` (exact edits) and un-fixme the approval test.**

1. Replace `import { INFO_ERROR_COPY, shortRunId } from "./model/copy.ts";` with `import { INFO_ERROR_COPY, hostAndPath, shortRunId } from "./model/copy.ts";`.
2. Replace `import { isInformational, latestError, type RunModel } from "./model/run-model.ts";` with `import { isInformational, isTerminal, latestError, type RunModel } from "./model/run-model.ts";`.
3. Add these imports:
```tsx
import { MEDIA } from "@/lib/breakpoints.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { REPLAY_INTERVAL_MS, ReplayScrubber } from "./browser/replay-scrubber.tsx";
import { summaryLabel, thinkingState, timelineItems, type PendingMessage } from "./model/timeline-items.ts";
import { BudgetMeters } from "./timeline/budget-meters.tsx";
import { OtpCard } from "./timeline/otp-card.tsx";
import { TimelinePanel } from "./timeline/timeline-panel.tsx";
```
4. Replace `export function RunView({ runId }: { runId: string; viewerId: string | null }) {` with `export function RunView({ runId, viewerId }: { runId: string; viewerId: string | null }) {`.
5. After the `deciding` state line, add:
```tsx
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [playing, setPlaying] = useState(false);
  const regular = useMediaQuery(MEDIA.md);
```
6. After the `replayLabel` line, add:
```tsx
  useEffect(() => {
    if (!playing) return undefined;
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
  const items = useMemo(() => (view ? timelineItems(view, pending, viewerId) : []), [view, pending, viewerId]);
  const lastEventId = view?.lastEventId ?? null;
  const send = useCallback(
    async (text: string) => {
      const entry = { key: crypto.randomUUID(), text, afterEventId: lastEventId };
      setPending((p) => [...p, entry]);
      try {
        await api.runs.sendMessage({ runId, text });
        return true;
      } catch {
        setPending((p) => p.filter((m) => m.key !== entry.key));
        toast({ title: "Couldn't send your message. It's back in the box." });
        return false;
      }
    },
    [runId, lastEventId, toast],
  );
```
7. Immediately before `  const userHasControl = inControl(view.controller, takeover);`, add:
```tsx
  const otp =
    view.status === "waiting" && view.waitReason === "otp" ? (
      <OtpCard
        key={`otp-${view.steps.at(-1)?.seq ?? 0}`}
        runId={runId}
        host={hostAndPath(view.currentUrl)?.host ?? "The site"}
      />
    ) : null;
```
8. Below the `spotlight={…}` prop (added in Task 14), add:
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
9. Replace `              onJumpLive={() => setReplaySeq(null)}` with:
```tsx
              onJumpLive={() => {
                setPlaying(false);
                setReplaySeq(null);
              }}
```
10. Replace the line `          </section>` with:
```tsx
            {regular ? null : otp}
            <BudgetMeters usage={view.usage} budget={view.budget} />
          </section>
          <TimelinePanel
            runId={runId}
            items={items}
            summary={summaryLabel(view)}
            thinking={thinkingState(view)}
            otp={regular ? otp : null}
            replaySeq={replaySeq}
            onReplay={(seq) => {
              setPlaying(false);
              setReplaySeq(seq);
            }}
            canMessage={!isTerminal(view.status)}
            onSend={send}
          />
```

In `apps/web/e2e/approval.spec.ts`, change `test.fixme("letters typed in the composer never decide (Review Focus 3)"` to `test("letters typed in the composer never decide (Review Focus 3)"`.

- [ ] **Step 5: Run the specs and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web test:ui -- timeline.spec.ts code-slots.spec.ts approval.spec.ts run-states.spec.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run apps/web/e2e/timeline.spec.ts apps/web/e2e/code-slots.spec.ts apps/web/e2e/approval.spec.ts apps/web/styles/run.css
git add apps/web/components/run apps/web/e2e/timeline.spec.ts apps/web/e2e/code-slots.spec.ts apps/web/e2e/approval.spec.ts apps/web/styles/run.css
git commit -m "feat(web): timeline with StatusMark/ThoughtLine, CodeSlots OTP card, RollingNumber budgets, composer and replay"
```

---

### Task 16: Stop, the callouts toggle and responsive layouts — **Replaced** (E2, E7, G3, W2, D22)

**Changes from the base task:**
- **E7.** Stop uses F1's `ConfirmDialog`: "Keep running" is focused and "Stop run" is destructive. `stop-dialog.tsx` is not created.
- **Callouts toggle.** It is a `plain` button with `aria-pressed`, shown only at lg (>1180), where callouts exist.
- **G3.** The layout spec uses the F1 projects' widths through `test.skip`, never `setViewportSize`, which would drop `hasTouch`.
- **W2, D22.** At 1440 the callout leader must not intersect the timeline. At 1180 the leader is hidden and the gutter badge shows.

**Files:**
- Create: `apps/web/components/run/callout-preference.ts` (verbatim from base Task 16), `apps/web/e2e/layout.spec.ts`
- Modify: `apps/web/components/run/run-view.tsx`, `apps/web/styles/run.css`

**Interfaces:**
- Consumes: `ConfirmDialog`, `Button`, `isTerminal`.
- Produces: `useCalloutsPreference(): [boolean, (on: boolean) => void]`, where `localStorage["mt.callouts"]` is wrapped in try/catch (base).

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/layout.spec.ts`:
```ts
import type { Page } from "@playwright/test";
import { recordedEvents } from "../lib/fixtures/run-recording.ts";
import { emit, frame, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const steps = (page: Page) => page.getByRole("complementary", { name: "Steps" });
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const intersects = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("1440: timeline beside the browser; the callout and leader stay in the frame, clear of the timeline (D22)", async ({ page }) => {
  test.skip(width(page) !== 1440, "wide layout");
  await gotoRun(page);
  await emit(page, [recordedEvents()[0]!]);
  const f = (await frame(page).boundingBox())!;
  const s = (await steps(page).boundingBox())!;
  expect(s.x).toBeGreaterThanOrEqual(f.x + f.width);
  const label = page.locator(".run-callout");
  await expect(label).toBeVisible();
  const c = (await label.boundingBox())!;
  expect(c.x + c.width).toBeLessThanOrEqual(f.x + f.width + 0.5);
  const leader = (await page.locator(".run-leader line").boundingBox())!;
  expect(intersects(leader, s)).toBe(false);
  await page.getByRole("button", { name: "Callouts" }).click();
  await expect(page.getByTestId("step-callout")).toHaveCount(0);
});

for (const w of [1180, 1024] as const) {
  test(`${w}: stacked; callouts become gutter badges and the leader is hidden (D22)`, async ({ page }) => {
    test.skip(width(page) !== w, "stacked layout");
    await gotoRun(page);
    await emit(page, [recordedEvents()[0]!]);
    const f = (await frame(page).boundingBox())!;
    const s = (await steps(page).boundingBox())!;
    expect(s.y).toBeGreaterThanOrEqual(f.y + f.height);
    await expect(page.getByTestId("gutter-badge")).toBeVisible();
    await expect(page.locator(".run-leader")).toBeHidden();
    await expect(page.getByRole("button", { name: "Callouts" })).toBeHidden();
  });
}

test("390: the path is trimmed and the approval is a bottom sheet", async ({ page }) => {
  test.skip(width(page) !== 390, "phone layout");
  await gotoRun(page);
  await emit(page, recordedEvents());
  const sheet = (await page.getByRole("alertdialog").boundingBox())!;
  expect(Math.round(sheet.y + sheet.height)).toBeGreaterThanOrEqual(843);
  await expect(page.getByTestId("origin-pill").locator(".run-path")).toBeHidden();
});

test("Stop asks first, focuses Keep running, then cancels", async ({ page }) => {
  test.skip(width(page) !== 1440, "behaviour check runs once");
  const calls = await gotoRun(page);
  await page.getByRole("button", { name: "Stop" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Stop this run?" });
  await expect(dialog.getByRole("button", { name: "Keep running" })).toBeFocused();
  await dialog.getByRole("button", { name: "Stop run" }).click();
  await expect.poll(() => rpcCalls(calls, "runs/cancel").length).toBe(1);
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm --filter @mastertutor/web test:ui -- layout.spec.ts`
Expected: FAIL, because there are no Callouts or Stop buttons.

- [ ] **Step 3: Implement.**

Create `apps/web/components/run/callout-preference.ts` verbatim from base Task 16.

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* Callouts exist only at lg; so does their toggle (Task 16). */
  .run-callout-toggle {
    display: none;
    @variant lg {
      display: inline-flex;
    }
  }
```

Edits to `apps/web/components/run/run-view.tsx`:
1. Add these imports:
```tsx
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { useCalloutsPreference } from "./callout-preference.ts";
```
2. After `  const regular = useMediaQuery(MEDIA.md);` (Task 15), add:
```tsx
  const [callouts, setCallouts] = useCalloutsPreference();
  const [stopOpen, setStopOpen] = useState(false);
  const stop = useCallback(() => {
    api.runs.cancel({ runId }).catch(() => toast({ title: "Couldn't stop the run. Try again." }));
  }, [runId, toast]);
```
3. Replace `        {/* toolbar-extra */}` with:
```tsx
        <Button
          variant="plain"
          className="run-callout-toggle"
          aria-pressed={callouts}
          onClick={() => setCallouts(!callouts)}
        >
          Callouts
        </Button>
```
4. Replace the two lines `        )}` + `      </Toolbar>` that close the take-over/hand-back ternary in the main return with:
```tsx
        )}
        <Button
          variant="plain"
          icon="stop"
          disabled={isTerminal(view.status)}
          onClick={() => setStopOpen(true)}
        >
          Stop
        </Button>
      </Toolbar>
```
5. Replace the line `              showCallouts` with `              showCallouts={callouts}`.
6. Replace `      {/* page-extra */}` with:
```tsx
      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title="Stop this run?"
        description="The agent stops now. Everything it captured stays in the draft note."
        confirmLabel="Stop run"
        cancelLabel="Keep running"
        destructive
        onConfirm={stop}
      />
      {/* page-extra */}
```

- [ ] **Step 4: Run the spec and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web test:ui -- layout.spec.ts approval.spec.ts && pnpm typecheck && pnpm lint`
Expected: PASS at every project width; tests for the other widths are skipped.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run apps/web/e2e/layout.spec.ts apps/web/styles/run.css
git add apps/web/components/run apps/web/e2e/layout.spec.ts apps/web/styles/run.css
git commit -m "feat(web): Stop confirmation, callouts toggle and responsive run layouts with D22 leader checks"
```

---

### Task 17: PiP mini browser — **Replaced** (E8, L1, X4, D21)

**Changes from the base task:**
- **E8.** The anchor is `AppShell`'s `<main>` (`components/shell/app-shell.tsx`), not `(app)/layout.tsx`. The PiP layer uses the new `--z-pip` (80), below scrims and sheets, instead of a raw `z-index: 60`.
- **X4, D21.** `PipDock` reaches `RunPip` (with its stream and live frame) only through `React.lazy(import())`, and only on regular widths when there is a run to watch. Every route's first-load JS stays within budget.
- **L1.** One live frame per run per tab. The PiP never mounts on its own run's page, and "Open run" navigates there, which unmounts the PiP and its frame first.
- **S6.** Captions and the host render in `<bdi>`.
- **Checkpoint.** After this task, `run-view.tsx` must equal the full file given below.

**Files:**
- Create: `apps/web/components/run/pip/watching.ts` (verbatim from base Task 17), `apps/web/components/run/pip/run-pip.tsx`, `apps/web/components/run/pip/pip-dock.tsx`, `apps/web/e2e/pip.spec.ts`
- Modify: `apps/web/components/shell/app-shell.tsx`, `apps/web/components/run/run-view.tsx`, `apps/web/styles/run.css`

**Interfaces:**
- Produces:
  - `rememberWatchedRun(id)`, `forgetWatchedRun(id)` and `watchedRun()` (base; sessionStorage `mt.watchedRun`, try/catch);
  - `RunPip({ runId, onGone })`;
  - `PipDock()`. It shows the watched, non-terminal run on every `(app)` route except that run's own page and `/new`, and only at md and up.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/pip.spec.ts`:
```ts
import { rec } from "../lib/fixtures/run-recording.ts";
import { emit, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

const mini = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Mini browser" });

test("follows the watched run elsewhere, expands into the stream, and leaves when it finishes", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "behaviour check runs once");
  await gotoRun(page);
  await page.goto("/library");
  const expand = page.getByRole("button", { name: "Live run, learn.example.edu. Expand mini browser" });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(page.getByRole("link", { name: "Open run" })).toBeVisible();
  await expect(mini(page).locator("iframe")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(expand).toBeVisible();
  await emit(page, [rec({ type: "status", status: "completed", waitReason: null, reason: null })]);
  await expect(mini(page)).toHaveCount(0);
});

test("never loads on a phone", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 390, "phone width only");
  await gotoRun(page);
  await page.goto("/library");
  await expect(page.locator("h1")).toBeVisible();
  await expect(mini(page)).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm --filter @mastertutor/web test:ui -- pip.spec.ts`
Expected: FAIL, because the expand button is not found.

- [ ] **Step 3: Implement.**

Create `watching.ts` verbatim from base Task 17.

`apps/web/components/run/pip/run-pip.tsx`:
```tsx
"use client";

import { stepScreenshotPath } from "@mastertutor/contracts";
import { m } from "motion/react";
import { useEffect, useState } from "react";
import { ButtonLink, IconButton } from "@/components/ui/button.tsx";
import { transitions } from "@/lib/motion-tokens.ts";
import { LiveFrame } from "../browser/live-frame.tsx";
import { deriveBrowserState } from "../model/browser-state.ts";
import { STATE_PILL, captionFor, hostAndPath } from "../model/copy.ts";
import { isTerminal, latestScreenshotSeq } from "../model/run-model.ts";
import { IDLE_TAKEOVER } from "../model/takeover.ts";
import { useRun } from "../stream/use-run.ts";

/** 15rem of a 35rem stage: the mock's compact scale. */
const SMALL_SCALE = 0.4286;
const ignoreStatus = () => undefined;

export function RunPip({ runId, onGone }: { runId: string; onGone(): void }) {
  const { model, connection, loadError } = useRun(runId);
  const [big, setBig] = useState(false);
  const ended = loadError || (model !== null && isTerminal(model.status));

  useEffect(() => {
    if (ended) onGone();
  }, [ended, onGone]);
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBig(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [big]);

  if (!model || ended) return null;
  const state = deriveBrowserState(model, {
    connection,
    takeover: IDLE_TAKEOVER,
    replaying: false,
    liveRetrying: false,
  });
  const host = hostAndPath(model.currentUrl)?.host ?? "new tab";
  const shot = latestScreenshotSeq(model);
  const caption = captionFor(state, model, IDLE_TAKEOVER, null);
  return (
    <aside className="run-pip" aria-label="Mini browser">
      <m.div
        className="run-pip-screen"
        initial={false}
        animate={{ scale: big ? 1 : SMALL_SCALE }}
        transition={transitions.springSoft}
      >
        {shot !== null ? <img className="run-pip-shot" src={stepScreenshotPath(runId, shot)} alt="" /> : null}
        {big ? (
          <LiveFrame
            runId={runId}
            slotName={model.slotName}
            epoch={0}
            title={`Remote browser, ${host}`}
            interactive={false}
            onStatus={ignoreStatus}
          />
        ) : null}
        {big ? (
          <div className="run-pip-bar glass">
            <bdi className="run-pip-text">{caption}</bdi>
            <ButtonLink href={`/runs/${runId}`} variant="primary">
              Open run
            </ButtonLink>
            <IconButton icon="minimize" label="Shrink mini browser" onClick={() => setBig(false)} />
          </div>
        ) : (
          <button
            type="button"
            className="run-pip-expand"
            aria-label={`Live run, ${host}. Expand mini browser`}
            onClick={() => setBig(true)}
          />
        )}
      </m.div>
      <div className="run-pip-caption glass" data-hidden={big || undefined}>
        <i data-tone={STATE_PILL[state].tone} aria-hidden="true" />
        <bdi>{caption}</bdi>
      </div>
    </aside>
  );
}
```

`apps/web/components/run/pip/pip-dock.tsx`:
```tsx
"use client";

import { usePathname } from "next/navigation";
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { MEDIA } from "@/lib/breakpoints.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { forgetWatchedRun, watchedRun } from "./watching.ts";

/** The PiP (stream, live frame, motion) loads only when there is a run to watch: off every route's first load. */
const RunPip = lazy(() => import("./run-pip.tsx").then((mod) => ({ default: mod.RunPip })));

export function PipDock() {
  const pathname = usePathname();
  const regular = useMediaQuery(MEDIA.md);
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    setRunId(watchedRun());
  }, [pathname]);
  const gone = useCallback(() => {
    if (runId) forgetWatchedRun(runId);
    setRunId(null);
  }, [runId]);
  if (!regular || !runId || pathname === `/runs/${runId}` || pathname === "/new") return null;
  return (
    <Suspense fallback={null}>
      <RunPip key={runId} runId={runId} onGone={gone} />
    </Suspense>
  );
}
```

In `apps/web/components/shell/app-shell.tsx`, add `import { PipDock } from "@/components/run/pip/pip-dock.tsx";` and replace:
```tsx
        <KillBanner />
        {children}
      </main>
```
with:
```tsx
        <KillBanner />
        {children}
        <PipDock />
      </main>
```

Inside `@layer components { … }` of `apps/web/styles/run.css`, add:
```css
  /* PiP mini browser (Task 17). Hit testing follows the scale, so the unscaled box never blocks clicks. */
  .run-pip {
    position: fixed;
    right: 1.25rem;
    bottom: 4.5rem;
    z-index: var(--z-pip);
    pointer-events: none;
    & > * {
      pointer-events: auto;
    }
  }
  .run-pip-screen {
    position: relative;
    width: 35rem;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    border-radius: var(--r-frame);
    background: var(--bg-2);
    box-shadow: var(--e3);
    transform-origin: 100% 100%;
  }
  .run-pip-shot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .run-pip-expand {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    cursor: pointer;
    &:focus-visible {
      outline: 0.3rem solid var(--tint);
      outline-offset: -0.5rem;
    }
  }
  .run-pip-bar {
    position: absolute;
    inset: auto 0 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.75rem;
    font-size: 0.8125rem;
  }
  .run-pip-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .run-pip-caption {
    position: absolute;
    right: 0;
    bottom: -3.25rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 15rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--r-md);
    box-shadow: var(--e2);
    font-size: 0.75rem;
    transition-property: opacity;
    transition-duration: var(--motion-dur-base);
    transition-timing-function: var(--motion-ease-out);
    & bdi {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    & i {
      flex: none;
      width: 0.45rem;
      height: 0.45rem;
      border-radius: 50%;
      background: var(--signal);
    }
    & i[data-tone="tint"] {
      background: var(--tint);
    }
    & i[data-tone="muted"] {
      background: var(--label-3);
    }
    &[data-hidden] {
      opacity: 0;
      pointer-events: none;
    }
  }
```

In `apps/web/components/run/run-view.tsx`:
- add `import { forgetWatchedRun, rememberWatchedRun } from "./pip/watching.ts";`;
- after `  const { takeover, takeControl, handBack } = useTakeover(runId, model, resync);`, add:
```tsx
  const status = model?.status ?? null;
  useEffect(() => {
    if (status === null) return;
    if (isTerminal(status)) forgetWatchedRun(runId);
    else rememberWatchedRun(runId);
  }, [runId, status]);
```

**Checkpoint.** After Tasks 13–17, `apps/web/components/run/run-view.tsx` must read exactly as follows. If it does not, replace it with this text.
```tsx
"use client";

import type { ApprovalDecisionInput } from "@mastertutor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { api } from "@/lib/api/client.ts";
import { MEDIA } from "@/lib/breakpoints.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { ApprovalSheet } from "./approval/approval-sheet.tsx";
import { BrowserFrame } from "./browser/browser-frame.tsx";
import { HandBackSheet } from "./browser/hand-back-sheet.tsx";
import type { LiveStatus } from "./browser/live-frame.tsx";
import { REPLAY_INTERVAL_MS, ReplayScrubber } from "./browser/replay-scrubber.tsx";
import { useCalloutsPreference } from "./callout-preference.ts";
import { approvalCopy } from "./model/approval-copy.ts";
import { canTakeOver, deriveBrowserState } from "./model/browser-state.ts";
import { INFO_ERROR_COPY, hostAndPath, shortRunId } from "./model/copy.ts";
import { isInformational, isTerminal, latestError, type RunModel } from "./model/run-model.ts";
import { inControl } from "./model/takeover.ts";
import { summaryLabel, thinkingState, timelineItems, type PendingMessage } from "./model/timeline-items.ts";
import { forgetWatchedRun, rememberWatchedRun } from "./pip/watching.ts";
import { RunHeader } from "./run-header.tsx";
import { useRun } from "./stream/use-run.ts";
import { BudgetMeters } from "./timeline/budget-meters.tsx";
import { OtpCard } from "./timeline/otp-card.tsx";
import { TimelinePanel } from "./timeline/timeline-panel.tsx";
import { useTakeover } from "./use-takeover.ts";

export function RunView({ runId, viewerId }: { runId: string; viewerId: string | null }) {
  const toast = useToast();
  const { model, connection, loadError, resync } = useRun(runId);
  const { takeover, takeControl, handBack } = useTakeover(runId, model, resync);
  const status = model?.status ?? null;
  useEffect(() => {
    if (status === null) return;
    if (isTerminal(status)) forgetWatchedRun(runId);
    else rememberWatchedRun(runId);
  }, [runId, status]);
  const [replaySeq, setReplaySeq] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("off");
  const [handBackOpen, setHandBackOpen] = useState(false);
  const [deciding, setDeciding] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [playing, setPlaying] = useState(false);
  const regular = useMediaQuery(MEDIA.md);
  const [callouts, setCallouts] = useCalloutsPreference();
  const [stopOpen, setStopOpen] = useState(false);
  const stop = useCallback(() => {
    api.runs.cancel({ runId }).catch(() => toast({ title: "Couldn't stop the run. Try again." }));
  }, [runId, toast]);

  // After a Reconnecting episode, open the live view again (B6 §8).
  const [liveEpoch, setLiveEpoch] = useState(0);
  const wasLost = useRef(false);
  useEffect(() => {
    if (connection === "lost") wasLost.current = true;
    else if (connection === "open" && wasLost.current) {
      wasLost.current = false;
      setLiveEpoch((n) => n + 1);
    }
  }, [connection]);

  // Informational run errors are toasts, never the failure reason (A7). takeover_failed is the
  // takeover hook's notice.
  const lastError = model ? latestError(model) : null;
  const infoKey = lastError && isInformational(lastError.code) ? lastError.eventId : null;
  const infoCode = lastError?.code ?? null;
  useEffect(() => {
    if (infoKey === null || infoCode === null || infoCode === "takeover_failed") return;
    toast({ title: INFO_ERROR_COPY[infoCode] ?? "The agent reported a problem." });
  }, [infoKey, infoCode, toast]);

  // Optimistic decisions: a decided approval leaves at once and comes back if the RPC fails.
  const view: RunModel | null = useMemo(
    () => (model ? { ...model, approvals: model.approvals.filter((a) => !deciding.has(a.id)) } : null),
    [model, deciding],
  );
  const shotSteps = useMemo(() => (view ? view.steps.filter((s) => s.screenshotKey !== null) : []), [view]);
  const replayIndex = shotSteps.findIndex((s) => s.seq === replaySeq);
  const replayStep = replayIndex >= 0 ? (shotSteps[replayIndex] ?? null) : null;
  const replayLabel = replayStep ? `step ${replayIndex + 1}/${shotSteps.length}` : "";
  useEffect(() => {
    if (!playing) return undefined;
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
  const items = useMemo(() => (view ? timelineItems(view, pending, viewerId) : []), [view, pending, viewerId]);
  const lastEventId = view?.lastEventId ?? null;
  const send = useCallback(
    async (text: string) => {
      const entry = { key: crypto.randomUUID(), text, afterEventId: lastEventId };
      setPending((p) => [...p, entry]);
      try {
        await api.runs.sendMessage({ runId, text });
        return true;
      } catch {
        setPending((p) => p.filter((m) => m.key !== entry.key));
        toast({ title: "Couldn't send your message. It's back in the box." });
        return false;
      }
    },
    [runId, lastEventId, toast],
  );
  const state = view
    ? deriveBrowserState(view, {
        connection,
        takeover,
        replaying: replayStep !== null,
        liveRetrying: liveStatus === "retrying",
      })
    : null;

  const startTakeover = useCallback(() => {
    if (!view || !state || !canTakeOver(view, state, takeover)) return;
    setReplaySeq(null);
    takeControl(view.status === "sleeping");
  }, [view, state, takeover, takeControl]);

  const resume = useCallback(() => {
    api.runs.resume({ runId }).catch(() => toast({ title: "Couldn't resume the run. Try again." }));
  }, [runId, toast]);

  const decide = useCallback(
    (input: ApprovalDecisionInput) => {
      setDeciding((s) => new Set(s).add(input.approvalId));
      api.runs.decideApproval(input).catch(() => {
        setDeciding((s) => {
          const next = new Set(s);
          next.delete(input.approvalId);
          return next;
        });
        toast({ title: "Couldn't send your answer. The approval is still waiting for you." });
      });
    },
    [toast],
  );

  const crumbs = [{ label: "Runs", href: "/runs" }, { label: shortRunId(runId) }];
  if (loadError) {
    return (
      <>
        <Toolbar>
          <Crumbs items={crumbs} />
        </Toolbar>
        <div className="wrap run">
          <LoadError title="This run couldn't be loaded." onRetry={() => window.location.reload()} />
        </div>
      </>
    );
  }
  if (!view || !state) {
    return (
      <>
        <Toolbar>
          <Crumbs items={crumbs} />
        </Toolbar>
        <div className="wrap run" aria-busy="true" aria-label="Loading run">
          <Skeleton className="run-skel-head" />
          <Skeleton className="run-skel-frame" />
        </div>
      </>
    );
  }

  const otp =
    view.status === "waiting" && view.waitReason === "otp" ? (
      <OtpCard
        key={`otp-${view.steps.at(-1)?.seq ?? 0}`}
        runId={runId}
        host={hostAndPath(view.currentUrl)?.host ?? "The site"}
      />
    ) : null;
  const userHasControl = inControl(view.controller, takeover);
  return (
    <>
      <Toolbar>
        <Crumbs items={crumbs} />
        <ToolbarSpacer />
        <Button
          variant="plain"
          className="run-callout-toggle"
          aria-pressed={callouts}
          onClick={() => setCallouts(!callouts)}
        >
          Callouts
        </Button>
        {userHasControl ? (
          <Button
            variant="primary"
            icon="hand"
            disabled={takeover.phase !== "idle"}
            onClick={() => setHandBackOpen(true)}
          >
            Hand back
          </Button>
        ) : (
          <Button icon="hand" disabled={!canTakeOver(view, state, takeover)} onClick={startTakeover}>
            Take over
          </Button>
        )}
        <Button
          variant="plain"
          icon="stop"
          disabled={isTerminal(view.status)}
          onClick={() => setStopOpen(true)}
        >
          Stop
        </Button>
      </Toolbar>
      <div className="wrap run">
        <RunHeader model={view} state={state} />
        <div className="run-body">
          <section className="run-stage" aria-label="Agent browser">
            <BrowserFrame
              runId={runId}
              model={view}
              state={state}
              takeover={takeover}
              replayStep={replayStep}
              replayLabel={replayLabel}
              liveEpoch={liveEpoch}
              liveStatus={liveStatus}
              onLiveStatus={setLiveStatus}
              approval={
                state === "approval" && view.approvals[0] ? (
                  <ApprovalSheet
                    key={view.approvals[0].id}
                    runId={runId}
                    approval={view.approvals[0]}
                    count={view.approvals.length}
                    onDecide={decide}
                    onTakeOver={startTakeover}
                  />
                ) : null
              }
              spotlight={
                state === "approval" && view.approvals[0]
                  ? approvalCopy(view.approvals[0].request).spotlight
                  : null
              }
              scrubber={
                <ReplayScrubber
                  steps={shotSteps}
                  seq={replaySeq}
                  playing={playing}
                  onSeq={setReplaySeq}
                  onTogglePlay={() => setPlaying((p) => !p)}
                />
              }
              showCallouts={callouts}
              onHandBack={() => setHandBackOpen(true)}
              onTakeControl={startTakeover}
              onResume={resume}
              onJumpLive={() => {
                setPlaying(false);
                setReplaySeq(null);
              }}
            />
            {regular ? null : otp}
            <BudgetMeters usage={view.usage} budget={view.budget} />
          </section>
          <TimelinePanel
            runId={runId}
            items={items}
            summary={summaryLabel(view)}
            thinking={thinkingState(view)}
            otp={regular ? otp : null}
            replaySeq={replaySeq}
            onReplay={(seq) => {
              setPlaying(false);
              setReplaySeq(seq);
            }}
            canMessage={!isTerminal(view.status)}
            onSend={send}
          />
        </div>
      </div>
      <HandBackSheet
        open={handBackOpen && userHasControl}
        onOpenChange={setHandBackOpen}
        onHandBack={(note) => {
          setHandBackOpen(false);
          handBack(note);
        }}
      />
      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title="Stop this run?"
        description="The agent stops now. Everything it captured stays in the draft note."
        confirmLabel="Stop run"
        cancelLabel="Keep running"
        destructive
        onConfirm={stop}
      />
    </>
  );
}
```
The `{/* toolbar-extra */}` and `{/* page-extra */}` anchors are gone. They existed only so Tasks 14–16 could find their insertion points.

In Task 15, the playback effect and `items` are inserted right after `replayLabel`, and that places them before `const state`. The checkpoint keeps that order.

- [ ] **Step 4: Run the specs and checks to verify they pass.**

Run: `pnpm --filter @mastertutor/web test:ui -- pip.spec.ts run-states.spec.ts takeover.spec.ts approval.spec.ts timeline.spec.ts layout.spec.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Budget check (X4).**

Run: `cd apps/web && pnpm exec next build && node scripts/check-first-load.ts; rm -rf .next/cache`
Expected: every route within budget, because the PiP is lazy. A route that grew past 6 kB means `run-pip.tsx` leaked into first load; fix the import, do not rebaseline.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/components/run apps/web/components/shell/app-shell.tsx apps/web/e2e/pip.spec.ts apps/web/styles/run.css
git add apps/web/components/run apps/web/components/shell/app-shell.tsx apps/web/e2e/pip.spec.ts apps/web/styles/run.css
git commit -m "feat(web): lazy PiP mini browser following the watched run, expanding into the live stream"
```

---

### Task 18: F3 QA — **Replaced** (G3, W2, X7, D22)

The base loop (5 widths × 2 schemes inside each of F1's 5 projects) is dropped: it made 300 runs and broke `hasTouch` (G3). Instead, there is one test per scenario. F1's five projects supply the widths, and `expectCleanScreen` checks light and dark, layout (`findLayoutIssues`) and axe after reduced-motion settling. W2 adds the acting, reconnecting and replay scenarios. The D22 leader check lives in Task 16.

**Files:**
- Create: `apps/web/e2e/run-qa.spec.ts`

- [ ] **Step 1: Write the spec.**

`apps/web/e2e/run-qa.spec.ts`:
```ts
import type { Page } from "@playwright/test";
import { rec, recordedDetail, recordedEvents } from "../lib/fixtures/run-recording.ts";
import { movingAnimations } from "./helpers/motion.ts";
import { emit, frame, gotoRun } from "./helpers/run.ts";
import { expect, expectCleanScreen, isCompact, test } from "./helpers/test.ts";

async function openReplay(page: Page) {
  if (isCompact(page)) await page.getByRole("button", { name: /^Steps/ }).click();
  await page.getByRole("button", { name: "Replay step: Clicked “Log in”" }).click();
  if (isCompact(page)) await page.keyboard.press("Escape");
}

const SCENARIOS: { name: string; state: string; setup(page: Page): Promise<void> }[] = [
  { name: "live", state: "live", setup: async (page) => void (await gotoRun(page)) },
  {
    name: "acting",
    state: "acting",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, [recordedEvents()[0]!]);
    },
  },
  {
    name: "approval",
    state: "approval",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, recordedEvents());
    },
  },
  {
    name: "control",
    state: "control",
    setup: async (page) =>
      void (await gotoRun(page, {
        detail: recordedDetail({ controller: "user", status: "waiting", waitReason: "takeover" }),
      })),
  },
  {
    name: "paused",
    state: "paused",
    setup: async (page) => void (await gotoRun(page, { detail: recordedDetail({ status: "sleeping", slotName: null }) })),
  },
  {
    name: "reconnecting",
    state: "reconnecting",
    setup: async (page) => {
      await gotoRun(page);
      await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
      await page.evaluate(() => {
        window.__sse.blockOpen = true;
        window.__sse.fail(true);
      });
    },
  },
  {
    name: "replay",
    state: "replay",
    setup: async (page) => {
      await gotoRun(page);
      await openReplay(page);
    },
  },
  {
    name: "otp",
    state: "live",
    setup: async (page) => {
      await gotoRun(page);
      await emit(page, [rec({ type: "status", status: "waiting", waitReason: "otp", reason: null })]);
    },
  },
];

test.describe("F3 QA (D22): every width from the project, light and dark, layout and axe", () => {
  test("new task", async ({ page }) => {
    await page.goto("/new");
    await expect(page.getByRole("heading", { name: /Take notes on/ })).toBeVisible();
    await expectCleanScreen(page);
  });

  test("runs list", async ({ page }) => {
    await page.goto("/runs");
    await expect(page.getByRole("navigation", { name: "Runs" })).toBeVisible();
    await expectCleanScreen(page);
  });

  for (const s of SCENARIOS) {
    test(`run ${s.name}`, async ({ page }) => {
      await s.setup(page);
      await expect(frame(page)).toHaveAttribute("data-state", s.state, { timeout: 5_000 });
      await expectCleanScreen(page);
    });
  }
});

test("reduced motion: nothing in the run frame moves while the agent acts (X7)", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion check runs once");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoRun(page);
  await emit(page, [recordedEvents()[0]!]);
  await expect(frame(page)).toHaveAttribute("data-state", "acting");
  expect(await movingAnimations(page, ".run-frame")).toEqual([]);
});
```

- [ ] **Step 2: Run the QA spec and fix every finding.**

Run: `pnpm --filter @mastertutor/web test:ui -- run-qa.spec.ts`
Expected: all scenarios pass in all 5 projects, plus the one motion test.
- If a test fails, fix the CSS or markup in the owning component. Do not loosen the check.
- Typical fixes:
  - add `min-width: 0` and ellipsis where text overflows;
  - use `--label-2` for secondary text;
  - add a missing label;
  - add `data-qa-allow-clip` only for deliberate masks (the RollingNumber track already has it).

- [ ] **Step 3: Run the whole F3 suite and the gates.**

Run: `pnpm test && pnpm --filter @mastertutor/web test:ui && pnpm typecheck && pnpm lint && pnpm format:check`
Then run `cd apps/web && pnpm exec next build && node scripts/check-first-load.ts && node scripts/check-prod-bundle.ts; rm -rf .next/cache`.
Expected: PASS. The production bundle check still finds no fixture code; the recording reaches only fixture builds through the router's dynamic import.

- [ ] **Step 4: Commit.**

```bash
pnpm exec prettier --write apps/web/e2e/run-qa.spec.ts
git add apps/web
git commit -m "test(web): F3 QA across the five project widths with light/dark layout and axe, plus reduced-motion check"
```

---

### Task 19 (F5): Hero gate, `Hero3D` loader and the `three` dependency — **Changed** (E1, E8, G2, P2)

**What stays:** the `three` and `@types/three` 0.170.0 install command, and the overall loader flow (IntersectionObserver near the viewport, then idle, then `import("./hero-3d-scene.ts")`).

**What changes:**
- **P2.** `shouldLoad3D` also refuses Save-Data and `deviceMemory < 4`.
- **E1.** Motion tokens use the shipped names:
  - `durations.heroReveal`;
  - `easings.standard`, TS only and not emitted to CSS;
  - `springs.heroParallax` and `springs.heroAttention`.
- **E8.** CSS goes into `styles/hero.css`.
- **No F1 gate test.** There is nothing to add to `test/f1-contract.test.ts`; that file does not exist.

**Files:**
- Create: `apps/web/components/hero/hero-gate.ts` (+ `hero-gate.test.ts`), `apps/web/components/hero/hero-3d.tsx`, `apps/web/components/hero/hero-3d-scene.ts` (temporary stub), `apps/web/e2e/hero.spec.ts`
- Modify: `apps/web/lib/motion-tokens.ts`, `apps/web/styles/motion.css` (regenerated), `apps/web/styles/hero.css`, `apps/web/components/new-task/new-task-form.tsx`, `apps/web/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces:
  - `HeroEnvironment` and `shouldLoad3D(env): boolean`;
  - `Hero3D()`. It renders `.hero[data-hero]`, gains `data-live` when the 3D scene is revealed, and gains `data-blink` on `hero:start` while the poster shows;
  - `durations.heroReveal = 700` (CSS `--motion-dur-hero-reveal`), `easings.standard = [0.4, 0, 0.2, 1]`;
  - `springs.heroParallax = { type: "spring", stiffness: 60, damping: 13, mass: 1 }` and `springs.heroAttention = { type: "spring", stiffness: 170, damping: 22, mass: 1 }`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/components/hero/hero-gate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { shouldLoad3D, type HeroEnvironment } from "./hero-gate.ts";

const ok: HeroEnvironment = {
  reducedMotion: false,
  hasWebGL2: true,
  forcePoster: false,
  saveData: false,
  lowMemory: false,
};

describe("shouldLoad3D", () => {
  it("loads only with WebGL2, motion allowed and no poster override", () => {
    expect(shouldLoad3D(ok)).toBe(true);
    expect(shouldLoad3D({ ...ok, reducedMotion: true })).toBe(false);
    expect(shouldLoad3D({ ...ok, hasWebGL2: false })).toBe(false);
    expect(shouldLoad3D({ ...ok, forcePoster: true })).toBe(false);
  });

  it("respects Save-Data and low-memory devices (P2)", () => {
    expect(shouldLoad3D({ ...ok, saveData: true })).toBe(false);
    expect(shouldLoad3D({ ...ok, lowMemory: true })).toBe(false);
  });
});
```

`apps/web/e2e/hero.spec.ts`:
```ts
import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/test.ts";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });
test.skip(({ viewport }) => viewport?.width !== 1440, "hero checks run once");

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
  await page.goto("/new");
  await page.waitForTimeout(2_500);
  await expect(page.locator("[data-hero]")).not.toHaveAttribute("data-live", "");
  expect(hits).toEqual([]);
});

test("?hero=poster forces the poster", async ({ page }) => {
  const hits = threeLoads(page);
  await page.goto("/new?hero=poster");
  await page.waitForTimeout(2_500);
  expect(hits).toEqual([]);
});

test("Save-Data keeps the poster and never downloads three (P2)", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true } });
  });
  const hits = threeLoads(page);
  await page.goto("/new");
  await page.waitForTimeout(2_500);
  expect(hits).toEqual([]);
});

test("loads three lazily and crossfades to the live scene", async ({ page }) => {
  const hits = threeLoads(page);
  await page.goto("/new?debug");
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-live", "", { timeout: 15_000 });
  expect(hits.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test apps/web/components/hero && pnpm --filter @mastertutor/web test:ui -- hero.spec.ts`
Expected:
- FAIL for the gate module and for "loads three lazily".
- The poster tests already pass. That is correct, because the poster is static.

- [ ] **Step 3: Implement the gate, tokens and loader.**

Run: `pnpm --filter @mastertutor/web add --save-exact three@0.170.0 && pnpm --filter @mastertutor/web add -D --save-exact @types/three@0.170.0`

In `apps/web/lib/motion-tokens.ts`:
- append `heroReveal: 700,` (with the comment `/** Poster → 3D crossfade (run 16). */`) to the end of `durations`;
- add `standard: [0.4, 0, 0.2, 1],` to `easings`, after `cursor`;
- add to `springs`, after `springSoft`:
```ts
  /** 3D hero (run 16): calm pointer parallax. */
  heroParallax: { type: "spring", stiffness: 60, damping: 13, mass: 1 },
  /** 3D hero: the lens leans toward the focused composer. */
  heroAttention: { type: "spring", stiffness: 170, damping: 22, mass: 1 },
```
Then run `pnpm --filter @mastertutor/web motion:css`. The generator emits `--motion-dur-hero-reveal`. Easings and extra springs stay TS only.

`apps/web/components/hero/hero-gate.ts`:
```ts
export interface HeroEnvironment {
  reducedMotion: boolean;
  hasWebGL2: boolean;
  /** `?hero=poster` (QA switch from run 16). */
  forcePoster: boolean;
  /** navigator.connection.saveData (P2). */
  saveData: boolean;
  /** navigator.deviceMemory below 4 GB (P2). */
  lowMemory: boolean;
}

/** Under reduced motion, without WebGL2, on Save-Data or a low-memory device, three is never downloaded. */
export function shouldLoad3D(env: HeroEnvironment): boolean {
  return env.hasWebGL2 && !env.reducedMotion && !env.forcePoster && !env.saveData && !env.lowMemory;
}
```

`apps/web/components/hero/hero-3d.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";
import { durations } from "@/lib/motion-tokens.ts";
import { HERO_EVENTS } from "./hero-events.ts";
import { shouldLoad3D, type HeroEnvironment } from "./hero-gate.ts";
import { PosterArt } from "./hero-poster.tsx";

interface HeroInstance {
  destroy(): void;
}

type HintedNavigator = Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };

const idle = (fn: () => void) =>
  "requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 800 }) : window.setTimeout(fn, 1);

function environment(params: URLSearchParams, reduce: MediaQueryList): HeroEnvironment {
  const nav = navigator as HintedNavigator;
  return {
    reducedMotion: reduce.matches,
    hasWebGL2: "WebGL2RenderingContext" in window,
    forcePoster: params.get("hero") === "poster",
    saveData: nav.connection?.saveData === true,
    lowMemory: nav.deviceMemory !== undefined && nav.deviceMemory < 4,
  };
}

/** CSS poster first; the 3D scene is imported only near the viewport, when idle (spec §11.2). */
export function Hero3D() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const params = new URLSearchParams(window.location.search);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let instance: HeroInstance | null = null;
    let loading = false;
    let disposed = false;

    const load = () => {
      if (loading || instance || !shouldLoad3D(environment(params, reduce))) return;
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
      if (el.dataset["live"] !== undefined) return;
      el.dataset["blink"] = "";
      clearTimeout(blink);
      blink = setTimeout(() => delete el.dataset["blink"], durations.panel);
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
    <div ref={ref} className="hero" data-hero="" aria-hidden="true">
      <PosterArt />
      <canvas className="hero-canvas" />
    </div>
  );
}
```

Inside `@layer components { … }` of `apps/web/styles/hero.css`, append:
```css
  /* 3D hero (F5 Task 19): the poster crossfades to the canvas once the scene is compiled. */
  .hero-poster,
  .hero-canvas {
    transition-property: opacity;
    transition-duration: var(--motion-dur-hero-reveal);
    transition-timing-function: var(--motion-ease-out);
  }
  .hero-canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0;
  }
  .hero[data-live] .hero-canvas {
    opacity: 1;
  }
  .hero[data-live] .hero-poster {
    opacity: 0;
  }
  .hero[data-blink] .hero-dot {
    opacity: 0.35;
  }
```

In `apps/web/components/new-task/new-task-form.tsx`:
- replace `import { HeroPoster } from "@/components/hero/hero-poster.tsx";` with `import { Hero3D } from "@/components/hero/hero-3d.tsx";`;
- replace `<HeroPoster />` with `<Hero3D />`.
`HeroPoster` remains exported for any static use; delete it if nothing imports it after this task (principle 1).

Create the temporary `apps/web/components/hero/hero-3d-scene.ts`, so the dynamic import resolves. Task 21 replaces it:
```ts
export interface HeroOptions {
  debug?: boolean;
}
export async function createHero(
  _el: HTMLElement,
  _options: HeroOptions = {},
): Promise<{ destroy(): void } | null> {
  return null;
}
```

- [ ] **Step 4: Run the tests to verify progress.**

Run: `pnpm test apps/web/components/hero apps/web/lib && pnpm --filter @mastertutor/web test:ui -- hero.spec.ts new-task.spec.ts`
Expected:
- The unit tests and the three poster e2e tests PASS.
- "loads three lazily" still FAILS; Task 21 makes it pass.
- `new-task.spec.ts` passes.

- [ ] **Step 5: Commit.**

```bash
pnpm exec prettier --write apps/web/components/hero apps/web/components/new-task/new-task-form.tsx apps/web/lib/motion-tokens.ts apps/web/styles apps/web/e2e/hero.spec.ts
git add apps/web/components/hero apps/web/components/new-task/new-task-form.tsx apps/web/lib/motion-tokens.ts apps/web/styles apps/web/e2e/hero.spec.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): Hero3D gated loader (reduced motion, WebGL2, Save-Data, memory, near-viewport idle) and hero tokens"
```

---

### Task 20 (F5): Pure scene modules — **Changed** (E1)

**What stays:** everything in base Task 20 (files, tests and code) is verbatim, except two parts.

**Part 1: imports in `scene/motion.test.ts`.** Replace `import { spring } from "../../../lib/motion-tokens.ts";` with:
```ts
import { springs } from "@/lib/motion-tokens.ts";

const spring = springs.spring;
```

**Part 2: `readSceneTokens` in `scene/studio.ts`.** Replace the whole function with this version, which reads the shipped token names (E1):
```ts
/** Theme colours the scene mirrors: the body background and the tint, signal and hero tokens. */
export function readSceneTokens(): { bg: string; tint: string; signal: string; aqua: string; bondi: string } {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim();
  return {
    bg: getComputedStyle(document.body).backgroundColor,
    tint: v("--tint"),
    signal: v("--signal"),
    aqua: v("--hero-aqua-deep"),
    bondi: v("--hero-bondi"),
  };
}
```

**Commands.** The test command is `pnpm test apps/web/components/hero/scene`. Commit with `pnpm exec prettier --write apps/web/components/hero/scene` first.

---

### Task 21 (F5): Port the Capture Lens scene to raw `three` — **Changed** (E1, E4, P2, P3)

**What stays:** `scene/geometry.ts`, `scene/page-texture.ts`, and the body of `createHero` in `hero-3d-scene.ts`, verbatim from base Task 21. The exceptions are the four blocks below.

**Block 1: the module imports and the easing constant.** Replace the two lines `import { clamp01, cubicBezier } from "../../lib/easing.ts";` and `import { easing, heroSprings, spring } from "../../lib/motion-tokens.ts";` with:
```ts
import { clamp01, cubicBezier } from "@/lib/easing.ts";
import { easings, springs } from "@/lib/motion-tokens.ts";
```
Replace the line `const ease = { flow: cubicBezier(easing.standard), arc: cubicBezier(easing.cursor) };` with:
```ts
const ease = { flow: cubicBezier(easings.standard), arc: cubicBezier(easings.cursor) };
```

**Block 2: renderer creation (P2).** `"WebGL2RenderingContext" in window` does not prove a context can be created. Replace the lines from `let renderer: WebGLRenderer;` through the closing `}` of its `try … catch { return null; }` with:
```ts
  // A WebGL2 constructor does not prove a context can be created (P2): ask, and keep the poster if not.
  const context = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
  if (!context) return null;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
```

**Block 3: the motion springs.** Replace the `const S = { … };` and `const lineS = …;` statements with:
```ts
  const S = {
    px: createSpring(0, springs.heroParallax),
    py: createSpring(0, springs.heroParallax),
    breath: createSpring(0, springs.spring),
    attn: createSpring(0, springs.heroAttention),
    note: createSpring(1, springs.spring),
    page: createSpring(1, springs.spring),
  };
  const lineS = lines.map(() => createSpring(1, springs.spring));
```

**Block 4: the theme comment.** Replace `// Theme (light/dark): background and studio follow --color-bg` with `// Theme (light/dark): background and studio follow --bg`.

**New unit test** (P2): `apps/web/components/hero/hero-3d-scene.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createHero } from "./hero-3d-scene.ts";

describe("createHero", () => {
  it("returns null, keeping the poster, when no WebGL2 context can be created (P2)", async () => {
    const canvas = { getContext: () => null };
    const el = { querySelector: () => canvas } as unknown as HTMLElement;
    await expect(createHero(el)).resolves.toBeNull();
  });

  it("returns null without a canvas", async () => {
    const el = { querySelector: () => null } as unknown as HTMLElement;
    await expect(createHero(el)).resolves.toBeNull();
  });
});
```

**E2E additions.** Append base Task 21 Step 1's three tests to `apps/web/e2e/hero.spec.ts`, with these changes:
- delete every `await mockRpc(page, newTaskHandlers());` line: the fixture server serves `/new`;
- in "Start waits for the capture before opening the run", replace `expect(Date.now() - t0).toBeGreaterThan(1_500);` with `expect(Date.now() - t0).toBeGreaterThanOrEqual(1_100);`. Navigation now waits for `HERO_MIN_CAPTURE_MS` (1.2 s), not the whole capture (P3); 100 ms covers timer jitter;
- the "pauses rendering offscreen" test sets its viewport with `page.setViewportSize`. Replace that line with `test.skip(page.viewportSize()?.width !== 390, "phone width only");`, and keep the rest.

**Commands.**
- Unit tests: `pnpm test apps/web/components/hero`.
- E2E: `pnpm --filter @mastertutor/web test:ui -- hero.spec.ts new-task.spec.ts`.
- Lint: `pnpm lint`, which allows `three` under `components/hero/` only.
- Prettier the touched files before committing.

---

### Task 22 (F5): Hero bundle budget inside the delight first-load check — **Replaced** (P4, W4, X4c)

There is no second script and no `app-build-manifest.json`; that manifest does not exist in this Next 16.3.8 Turbopack build. The hero check extends the delight pass's `scripts/first-load.ts`, which already reads every route's first-load files from the client-reference manifests, and runs inside `check:first-load`. CI runs that check after every production build. Hero budget: **150 kB gz**. Leak test: no route's first-load file may contain `isWebGLRenderer`.

**Files:**
- Modify: `apps/web/scripts/first-load.ts`, `apps/web/scripts/check-first-load.ts`
- Test (modify): `apps/web/scripts/first-load.test.ts`

**Interfaces:**
- Consumes: delight's `measureFirstLoad`, `routeOf`, `compareFirstLoad` and the manifest walk.
- Produces:
  - `routeFiles(nextDir): Record<string, string[]>`, extracted from `measureFirstLoad` with behaviour unchanged;
  - `HeroBundle` (`{ files: string[]; kb: number; leaked: string[] }`);
  - `measureHeroBundle(nextDir, marker?): HeroBundle`;
  - `compareHeroBundle(hero, budgetKb): string[]`;
  - `HERO_BUDGET_KB = 150`.

- [ ] **Step 1: Write the failing tests.**

Add `writeFileSync` (already imported), `HERO_BUDGET_KB`, `compareHeroBundle` and `measureHeroBundle` to the imports of `apps/web/scripts/first-load.test.ts`, then append:
```ts
describe("measureHeroBundle (F5 P4)", () => {
  it("finds the lazy three chunk and reports one that leaked into first load", () => {
    const { dir } = fakeBuild();
    writeFileSync(join(dir, "static/chunks/hero.js"), `isWebGLRenderer ${randomBytes(4000).toString("hex")}`);
    const lazy = measureHeroBundle(dir);
    expect(lazy.files).toEqual(["static/chunks/hero.js"]);
    expect(lazy.leaked).toEqual([]);
    expect(lazy.kb).toBeGreaterThan(0);
    writeFileSync(join(dir, "static/chunks/page.js"), "isWebGLRenderer");
    expect(measureHeroBundle(dir).leaked).toEqual(["static/chunks/page.js"]);
  });
});

describe("compareHeroBundle", () => {
  it("passes a lazy chunk within the budget", () => {
    expect(compareHeroBundle({ files: ["a.js"], kb: 139.2, leaked: [] }, HERO_BUDGET_KB)).toEqual([]);
  });
  it("names a missing, oversized or leaked hero", () => {
    expect(compareHeroBundle({ files: [], kb: 0, leaked: [] }, 150)).toEqual([
      "hero: no chunk contains three (is the lazy hero import wired?)",
    ]);
    expect(compareHeroBundle({ files: ["a.js"], kb: 151.3, leaked: [] }, 150)).toEqual([
      "hero: 151.3 kB gz exceeds the 150 kB budget",
    ]);
    expect(compareHeroBundle({ files: ["a.js"], kb: 10, leaked: ["a.js"] }, 150)).toEqual([
      "hero: three is in first-load JS (a.js)",
    ]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `pnpm test apps/web/scripts/first-load.test.ts`
Expected: FAIL, because `measureHeroBundle` is not exported.

- [ ] **Step 3: Implement.**

In `apps/web/scripts/first-load.ts`:
1. Replace `measureFirstLoad` with these two functions. The behaviour is identical, and the delight tests stay green:
```ts
/** Every route's first-load JS files (root main files + entryJSFiles), relative to nextDir. */
export function routeFiles(nextDir: string): Record<string, string[]> {
  const build = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8")) as {
    rootMainFiles: string[];
  };
  const result: Record<string, string[]> = {};
  for (const path of manifestFiles(join(nextDir, "server", "app"))) {
    // The manifest is a script that assigns globalThis.__RSC_MANIFEST; run it in an empty context.
    const context: { __RSC_MANIFEST?: RscManifest } = {};
    runInNewContext(readFileSync(path, "utf8"), context);
    for (const [key, manifest] of Object.entries(context.__RSC_MANIFEST ?? {})) {
      const route = routeOf(key);
      if (route.startsWith("/_")) continue;
      const files = new Set(build.rootMainFiles);
      for (const list of Object.values(manifest.entryJSFiles ?? {})) {
        for (const file of list) if (file.endsWith(".js")) files.add(file.replace(/^\//, ""));
      }
      result[route] = [...files];
    }
  }
  return result;
}

export function measureFirstLoad(nextDir: string): Record<string, number> {
  const gzCache = new Map<string, number>();
  const gz = (file: string) => {
    let size = gzCache.get(file);
    if (size === undefined) {
      size = gzipSync(readFileSync(join(nextDir, file))).length;
      gzCache.set(file, size);
    }
    return size;
  };
  return Object.fromEntries(
    Object.entries(routeFiles(nextDir)).map(([route, files]) => [
      route,
      toKb(files.reduce((sum, file) => sum + gz(file), 0)),
    ]),
  );
}
```
2. Add `relative` to the `node:path` import (`import { join, relative } from "node:path";`), then append:
```ts
/** Spec §11.2: raw three, tree-shaken, at most 150 kB gz, and only ever loaded lazily. */
export const HERO_BUDGET_KB = 150;

export interface HeroBundle {
  /** Static chunks that contain three (relative to nextDir), sorted. */
  files: string[];
  kb: number;
  /** Hero chunks that some route loads on first load: three leaked out of the lazy import. */
  leaked: string[];
}

function* staticJs(dir: string, base: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* staticJs(path, base);
    else if (entry.name.endsWith(".js")) yield relative(base, path);
  }
}

export function measureHeroBundle(nextDir: string, marker = "isWebGLRenderer"): HeroBundle {
  const firstLoad = new Set(Object.values(routeFiles(nextDir)).flat());
  const files = [...staticJs(join(nextDir, "static"), nextDir)]
    .filter((file) => readFileSync(join(nextDir, file), "utf8").includes(marker))
    .sort();
  const bytes = files.reduce((sum, file) => sum + gzipSync(readFileSync(join(nextDir, file))).length, 0);
  return { files, kb: toKb(bytes), leaked: files.filter((file) => firstLoad.has(file)) };
}

export function compareHeroBundle(hero: HeroBundle, budgetKb: number): string[] {
  if (hero.files.length === 0) return ["hero: no chunk contains three (is the lazy hero import wired?)"];
  const findings = hero.leaked.map((file) => `hero: three is in first-load JS (${file})`);
  if (hero.kb > budgetKb) findings.push(`hero: ${hero.kb} kB gz exceeds the ${budgetKb} kB budget`);
  return findings;
}
```

In `apps/web/scripts/check-first-load.ts`:
- add `HERO_BUDGET_KB`, `compareHeroBundle` and `measureHeroBundle` to the `./first-load.ts` import;
- replace the `else { … }` branch (the check mode) with:
```ts
} else {
  const hero = measureHeroBundle(nextDir);
  console.log(`hero (lazy three)          ${hero.kb.toFixed(1).padStart(7)} kB gz  (${hero.files.length} chunk(s), budget ${HERO_BUDGET_KB} kB)`);
  const findings = [...compareFirstLoad(current, previous), ...compareHeroBundle(hero, HERO_BUDGET_KB)];
  if (findings.length) {
    console.error(`First-load JS budget exceeded (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(`First-load JS within budget (+${previous.budgetKb} kB gz per route); hero within ${HERO_BUDGET_KB} kB.`);
}
```

- [ ] **Step 4: Run the tests, build, and check.**

Run:
```bash
pnpm test apps/web/scripts/first-load.test.ts
cd apps/web && pnpm exec next build && node scripts/check-first-load.ts && node scripts/check-prod-bundle.ts; rm -rf .next/cache
```
Expected:
- PASS. The hero line prints about 139 kB gz with no leak.
- If the hero exceeds 150 kB, make sure every `three` import in `components/hero/` is a named import (no `import * as`).
- If three leaked, make sure `hero-3d.tsx` reaches the scene only through `import("./hero-3d-scene.ts")`.

- [ ] **Step 5: Run the full suite.**

Run: `pnpm test && pnpm --filter @mastertutor/web test:ui && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
pnpm exec prettier --write apps/web/scripts/first-load.ts apps/web/scripts/check-first-load.ts apps/web/scripts/first-load.test.ts
git add apps/web/scripts/first-load.ts apps/web/scripts/check-first-load.ts apps/web/scripts/first-load.test.ts
git commit -m "build(web): hero bundle budget (≤150 kB gz, never first-load) inside the first-load check"
```

---

## R.6 Notes for later phases (replaces the base plan's list)

1. **Phase 7 (integration) owns these server routes.** Their wire format is fixed by Task 2.
   - `GET /api/runs/:id/events`.
     - Resume from `resumeAfter(req.headers[LAST_EVENT_ID_HEADER], ?after)` and write `encodeRunEventSse(record)` per row.
     - Send `retry:`, and close the stream after a terminal `status`.
     - Forward `control`, `status`, `error` and `download_ready`; B6 §8 depends on them.
   - `GET /api/runs/:id/steps/:seq/screenshot`. Look the object key up by seq (keys end `<seq>-<nonce>.png`), stream it with the read-only key, and check workspace membership first.
   - `GET /api/runs/:id/approvals/:approvalId/screenshot` (A3c). Read `approvals.request.screenshotKey` server-side. The browser never names an object key.
   - `liveRouter.runs.create/list/get/steps/cancel/resume/sendMessage/decideApproval` replace `notWired`. The fixture router already serves create, list, get and steps with the same shapes.
2. **Server-side authority (L4).** The overlay and the `inert` wrapper are UX, not a boundary. The web procedures must enforce three rules. B6 A9 and B3 E.8 note 3 implement them:
   - the viewer's workspace owns the run;
   - `takeControl` is idempotent;
   - `handBack` is accepted only from the current controller.
3. **A4.** `decidedBy` must be the viewer's user id (Better Auth `user.id`) for human decisions. The run page passes `viewer.id` as `viewerId`, and the timeline says "You" only on an exact match.
4. **Uploads during takeover (B6 §8, A10).** After B6's `apps/web/lib/live/upload.ts` lands on `fe-track`, an F3 follow-up task adds an Upload control to the browser chrome, shown only in `control`:
   - it calls `uploadToFileDialog` or `dropFiles`;
   - `no_file_dialog` reads "Click the site's upload button first";
   - `signed_out` goes through `endSession()`.
   It is left out here because it needs a B6 file that is not on this branch.
5. **Download links.** `download_ready.assetId` exists (B6 A3). The timeline shows the filename only. A link needs `assets.url` with B2's 300 s TTL; that is a Phase 7 item.
6. **OTP length** is not in any contract. CodeSlots defaults to 6 boxes and resizes to 4–8 on paste or autofill.
7. **Real n.eko behaviour (W3).** Auth, the `/live/<id>/` prefix and `CONFLICT` are stubbed in F3 e2e. Phase 7 owns a stack e2e against a real slot (B6 A15).
8. **`pointer` before B3 E 0.2 lands.** The UI already says "Act" and never pulses for an unpointered computer step (W1), so old recordings and pre-A1 agents render correctly.

## R.7 Recorded deviations (replaces the base plan's list)

1. **`⌘⇧T` dropped.** Unchanged from the base plan (D27: takeover has no shortcut).
2. **React Bits fetched by URL, not installed.** `shadcn add` would install `@hugeicons/*` (banned). The sha256 of each registry JSON is pinned in each file's header (X3).
3. **Sleeping takeover waits 30 s.** Unchanged. The hand back now has a 5 s resync (A6).
4. **CSS lives in global layered sheets, not CSS Modules (E8).** All F3/F5 rules sit in `@layer components` in `styles/run.css`, `new-task.css` and `hero.css`, under the `run-`/`acur-`/`tline-`/`cslots-`/`nt-`/`hero-` prefixes. That keeps them under F1's layer, raw-value and glass tests.
5. **Approval keys arm after 600 ms, and no key cancels a run (S1, S2).** This goes beyond the spec's "no Return default".
6. **The A7 failure reason is the last non-informational error, not "an error at or after the terminal status".** The agent's emit order between `error` and `status` is not guaranteed. A fixed set of informational codes (B6 §7.10) gives the same result without depending on order.
7. **Timeline on compact widths opens in F1's modal `Sheet`, not a peeking drawer (E7).** The OTP card stays in the stage on compact widths, so a code request is never hidden.
8. **No `sandbox` on the live iframe (S5).** It cannot isolate a same-origin scripted client. `inert` and `referrerPolicy`, plus B6's server-side checks, carry the weight; B6 S4 accepts the risk.
9. **Approval screenshot route.** `approvalScreenshotPath` is a new contract path that Phase 7 serves (A3c).
10. **The hero waits 1.2 s, not the whole capture (P3).** The capture keeps playing during the route change.

## R.8 Self-Review

**1. Ruling coverage.** Every pre-flight ID has a row in R.1 with the task that applies it.
- E1–E8, X1, X2, A1–A9, L1–L4, S1–S10, P1–P4, G1–G6 and W1–W5 come from the F3/F5 pre-flight; W3 and L4 are notes.
- X1–X7 and I3 come from the delight pre-flight.
- R-E13–R-E15 come from B3 E, and §3, A3, A9, §7 and §8 from B6.
- The user's checklist maps as follows:

| Requirement | Where |
|---|---|
| Every pre-flight ruling applied | R.1 |
| Shipped frontend-core names and helpers | R.2 table and rename map; every task's code |
| A single RPC link carrying the R29-4 interceptor | Task 3 deleted; `api`/`orpc` everywhere; `takeover.spec.ts` "an ended session…" |
| CSS inside `@layer components` | R.2; Task 1 (sheets plus `layers.test.ts`); every CSS block |
| Approval cards cover every action kind, safety checks and record context | Task 6 `approval-copy.ts` and tests; Task 14 sheet and spec |
| Deliberate keyboard shortcuts, no instant destructive keys | Task 14: arming, repeat, fullscreen and dialog filters; budget Cancel through `ConfirmDialog` |
| Page-derived text sanitised everywhere | Task 6 `untrustedText`; `<bdi>` in Tasks 11–17 |
| Hero lazy, with its 150 kB budget in the delight bundle check | Tasks 19, 21, 22 |
| Takeover during a pending approval | Task 6 `canTakeOver`; Task 14 "Take over instead" and its specs |

**2. Placeholder scan.** No TBD or "similar to Task N". Where a base file is kept, the amendment says "verbatim from base Task N, Step M". Those files are pure and still correct against the shipped code: `easing.ts`, `callout.ts`, `fullscreen.ts`, `use-element-size.ts`, `format.ts`, `code-slots-logic.ts`, `callout-preference.ts`, `watching.ts`, `run-events.ts`, the scene modules and `frame.svg`.

**3. Name consistency.**
- **Shared types.** `RunModel`, `StepRow`, `RunError`, `ControlChange`, `TakeoverState`, `TakeoverNotice`, `BrowserState`, `Connection`, `LiveStatus` and `TimelineItem` are each defined once.
- **Contract names.** `StatusMarkStatus` and `RollingNumber` are delight's; `pointerOf`, `context`, `assetId` and `liveEmbedPath` are the backend contracts'.
- **Fixtures.** Every spec and unit test imports `RECORDED_RUN_ID`, `RECORDED_APPROVAL_ID`, `OTHER_RUN_ID`, `recordedDetail`, `recordedSteps`, `recordedEvents` and `rec` from `lib/fixtures/run-recording.ts`.
- **Live frame wiring.** `BrowserFrame`'s `liveEpoch`, `liveStatus` and `onLiveStatus` match `RunView`. `LiveFrame`'s `epoch` and `onStatus` match both `BrowserFrame` and `RunPip`.
- **Hosts.** `pageHost` (run view) is distinct from `lib/notes/format.ts`'s `hostOf` (note sources) on purpose, and the code comment says why.

**4. Review Focus.**
- Lines 1–5 keep their base intent; their tests moved to `run-model.test.ts`, `takeover.test.ts`, `approval.spec.ts`, `approval-copy.test.ts`, `code-slots-logic.test.ts` and `code-slots.spec.ts`.
- Lines 6–10 have tests in Tasks 6, 13 and 14.

**Execution note.**
- Tasks 0–2 and 4–10 are independent of the UI and can be reviewed one at a time.
- Tasks 13–17 edit `run-view.tsx` in sequence. The Task 17 checkpoint is the reviewer's single source for that file.
