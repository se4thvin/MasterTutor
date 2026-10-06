# Phases F1, F2 and F4: Frontend Core Implementation Plan

> **D36 (supersedes this plan):** OPENAI_EMBEDDINGS_KEY is removed; web uses OPENAI_API_KEY for query embeddings.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MasterTutor web frontend's design system and app shell (F1), the Library, folder tree and note reader/editor (F2), and the Vault and Settings/Usage/Audit screens (F4). All of it is built against the Phase 0 oRPC contracts, with an in-process fixture backend and seeded data. Every screen passes Playwright layout-QA and axe checks at 1440, 1180, 1024, 820 and 390 px, in light and dark.

**Architecture:**
- **Styling.** `apps/web` uses Tailwind v4. Its `@theme` maps semantic tokens from one `styles/tokens.css` file. The feature CSS files hold component classes, and breakpoints come from `@variant`. Glass is a CSS recipe, not a component.
- **Motion.** `motion` 14 runs through `LazyMotion` (strict) and `m.*`. One `lib/motion-tokens.ts` module is the single source for springs, durations and easings. A script generates `styles/motion.css` from it, including `linear()` springs. Custom ESLint and Stylelint rules forbid raw motion values and any animated property other than `transform` and `opacity`.
- **Data.** Each screen is a client component that talks to `/api/rpc` through a typed oRPC client and TanStack Query. In F phases the route serves an in-memory **fixture router** that implements the whole `apiContract`. It is enabled by `WEB_FIXTURE_API=1` and isolated per test through a cookie. Without the flag, the route serves a `liveRouter` whose procedures throw `NOT_IMPLEMENTED`. Phase 7 and B2/B3 replace those procedures one namespace at a time.
- **Adapted components.** React Bits components (SwipeToast, RubberSegment, SpringCheck) are copied, retokenised and made transform/opacity-only.

**Tech Stack:**

| Area | Packages |
|---|---|
| Framework | Next.js 16.3.8, React 19.3 |
| Styling | Tailwind CSS 4.3.3 with `@tailwindcss/postcss` |
| Animation | motion 14.0.0 |
| UI primitives and icons | @base-ui/react 1.8.0, lucide-react 1.52.0 |
| API | @orpc/{client,server,contract,tanstack-query} 1.15.4, @tanstack/react-query 5.104.1 |
| Editor | @tiptap/{core,pm,react,starter-kit,markdown} 3.31.4 |
| Markdown rendering | react-markdown 10.1.0, remark-gfm 4.0.1, remark-math 6.0.0, rehype-katex 7.0.1, katex 0.19.0, rehype-raw 7.0.0, rehype-sanitize 6.0.0, rehype-highlight 7.0.2, highlight.js 11.12.0 |
| Testing | @playwright/test 1.63.0, @axe-core/playwright 4.13.0 |
| Linting | stylelint 17.16.0, eslint-plugin-react-hooks 7.1.1 |

**Spec:** `docs/superpowers/specs/2026-10-05-agentic-notes-design.md`, especially §11, §12 ("UI validation swarm" automated backing) and §16 (F1, F2, F4).
- Decisions D21–D29 in `orchestration/STATE.md` override the spec.
- `CLAUDE.md` is mandatory.
- Phase 0's plan (`docs/superpowers/plans/2026-10-05-phase-0-foundations.md`) is the source of truth for contracts, file paths and env.
- Visual sources: `design/mock-d-apple.html`, `orchestration/runs/2026-10-05-12-design-apple-editorial/report.md` and `orchestration/runs/2026-10-05-18-research-reactbits/report.md`.

---

## Planning-time verification (done on 2026-10-05; do not re-litigate)

1. **motion 12 vs 14.**
   - `motion@14.0.0` (2026-10-02) has peers `react ^18 || ^19`.
   - The changelog lists two breaking changes since 12.x:
     - **13.0** removed the optional `@emotion/is-prop-valid` dependency;
     - **14.0** removed internal APIs only.
   - React Bits pins `motion@^12.23` but uses only public `motion/react` APIs, so the copied components work on 14.
   - Every API this plan uses was imported from `motion/react@14.0.0` and type-checked with TS 6.0.3: `LazyMotion`, `domAnimation`, `m`, `animate`, `useMotionValue`, `useTransform`, `useMotionValueEvent`, `useReducedMotion`, `MotionConfig` and `AnimatePresence`.
   - `spring({stiffness:400,damping:30})` settles at about 465 ms, which matches the spec's "about 450 ms".
   - **Pin: `motion@14.0.0`.** Fallback if Task 2's check fails: `13.5.1`.
2. **Base UI 1.8.0** (`@base-ui/react`) parts were checked against the installed package:
   - Dialog, AlertDialog, Popover, Menu and Switch all exist.
   - `Popup.initialFocus` exists.
   - `Switch.Root.onCheckedChange(checked, details)` is the callback signature.
   - Data attributes are `data-starting-style`, `data-ending-style` and `data-checked`.
3. **Tailwind 4.3.3:**
   - `--color-*: initial` removes the default palette (`bg-red-500` is not generated).
   - `duration-(--x)` emits `transition-duration: var(--x)`.
   - `@variant` works inside rules.
4. **The markdown pipeline was run under vitest** with the exact plugin order and schema below:
   - remark-gfm, remark-math, rehype-raw (tables only), rehype-sanitize, rehype-katex, rehype-highlight.
   - KaTeX renders `$$…$$` and `$…$`, and highlight.js tokenises Python.
   - `<script>`, `onerror` and `javascript:` hrefs are stripped.
   - `rowspan` and `colspan` survive.
5. **oRPC:** this combination type-checks:
   - `implement(contract).$context<C>().router({...})`, `createRouterClient` and `RPCHandler` from `@orpc/server/fetch`;
   - `createORPCClient(new RPCLink({ url: () => ... }))` typed `ContractRouterClient<ApiContract>`;
   - `createTanstackQueryUtils(...).x.queryOptions / infiniteOptions / key()`.
6. **Vitest 5 with Vite 8** renders `.tsx` imported from `.test.ts` using the automatic JSX runtime, with no plugin.
7. **Contrast on `#FAFAFA`.** Run 12's light semantic colours fail AA on their own washes:
   - ok on ok-wash: 4.32;
   - signal on signal-wash: 4.08.

   Adjusted values: ok `#17742F` (5.00), signal `#C22914` (4.94), warn `#A84B00` (4.96) and code-title `#326D74` (5.39 on bg-2). Dark `--danger` `#FF453A` with white text fails (3.5), so `--on-danger` is `#0B0B0C` in dark mode.

---

## Global Constraints

Every task implicitly includes all of these.

**Toolchain (from Phase 0)**
- Node ≥ 24.4. pnpm 10.34.6.
- TypeScript 6.0.3 with `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. Use ESM only.
- Relative and alias imports carry the `.ts`/`.tsx` extension.
- Pin exact versions only (`pnpm add -E`). Add no dependency that a step does not name.
- Type-only imports use `import type`.
- Use the Phase 0 names exactly: `@mastertutor/contracts` (`apiContract`, `ApiContract`, every DTO), `WebEnv`, `parseEnv`, `getWebEnv`, `getAuth`, `.env.test`.
- Commit at the end of each task. Do not push. End commit messages with the attribution lines from your session's system reminder.

**Design (spec §11, D17, D21–D29)**

| Area | Rule |
|---|---|
| Tokens | Colours, radii, shadows, fonts, durations and easings come only from `styles/tokens.css` and `styles/motion.css`, through Tailwind theme utilities or `var(--…)`. No raw hex or ms values appear in components. Breakpoints are `sm` > 420, `md` > 820, `lg` > 1180 px. |
| Background | `#FAFAFA` light and `#0B0B0C` dark. Follow the system appearance. There is no theme switch (HIG). |
| Type | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter (next/font), system-ui, sans-serif`. Mono is `ui-monospace, "SF Mono", "Geist Mono", Menlo, monospace`. Reading body is 17/1.65 at about 68ch. No serif. All sizes are in rem. |
| Glass | `backdrop-filter: saturate(180%) blur(24px)` at 72% fill. Use it on the sidebar and tab bar, toolbars, sheets, toasts and banners only. It becomes opaque under `prefers-reduced-transparency`. |
| Motion | `motion` is the only animation library: `LazyMotion` strict with `m.*`. Only `transform` and `opacity` (and the `scale`/`translate`/`rotate` longhands) animate. Press feedback is 0.96, or 0.92 for icon buttons, and starts in under 100 ms. Honour `prefers-reduced-motion` by swapping movement for fades. Skeletons, never spinners. |
| Icons | Every icon goes through `<Icon name>` from `components/ui/icon.tsx`. Lucide glyphs at stroke 1.6. Letter tiles are banned. Every icon has a text label or `aria-label`. |
| Targets | 44 px hit areas, through `::after` extensions and 44 px controls under `pointer: coarse`. |
| Accessibility | Semantic HTML first. Focus ring is 2 px `--tint-text` with a 2 px offset. Never convey state by colour alone (always icon plus word). Zero serious or critical axe violations in both colour schemes. |
| Writing | Sentence case for UI. Alert buttons use title-style verbs ("Delete Folder"); never "OK" for consequential actions. Destructive buttons are red and never the default focus. |
| Secrets (§9) | Vault values are never rendered, logged, stored client-side, kept in the query cache or echoed in errors. Inputs use `type="password"`, `autocomplete="new-password"` or `"off"`, `spellCheck={false}`, and are cleared on submit, close or unmount. |
| React Bits | Copied, not installed. Each file has a provenance and licence header. `components/bits/LICENSE-react-bits` holds the upstream licence. |
| Layout QA | Each screen's spec calls `expectCleanScreen(page)`, which runs the DOM layout detector and axe in light and dark, at all 5 Playwright projects. |

**Recorded deviations (justified)**
1. **Light semantic colours.** ok `#17742F`, signal `#C22914`, warn `#A84B00`, code-title `#326D74`; dark `--on-danger` is `#0B0B0C`. Reason: AA on `#FAFAFA` (D25 postdates run 12). The spec's rule "All text pairs meet WCAG AA" wins.
2. **No `data-theme` override.** Appearance follows the system only (HIG). Each dark value is defined once.
3. **`WEB_FIXTURE_API` flag added to `WebEnv`** (default off). A unit test asserts that `compose.yml` never sets it.
4. **Source | Note pane.** The left pane renders each block's captured text (`originalMarkdown ?? markdown`) as a read-only page. The Phase 0 contract has no endpoint for the MHTML or screenshot snapshot.
5. **Adapted React Bits components:**
   - RubberSegment's thumb uses `x` plus `scaleX` instead of an animated `clip-path`.
   - SpringCheck's tick uses opacity and scale instead of `stroke-dashoffset`.
   - SwipeToast's inline mode, which animates `grid-template-rows`, is removed.
6. **Folder actions** (new subfolder, rename, delete) live in the Library toolbar's folder menu and in the tree header. Tree rows stay a pure ARIA tree.
7. **Export.** `notes.export` produces one Obsidian `.md` file, with YAML provenance front-matter and `assets/<id>` links. Zipping the asset bytes belongs to the live implementation (Phase 7).

## Review Focus

1. **Untrusted note markdown.** Captured blocks can carry `<script>`, `onerror`, `javascript:` links, external `<img>` URLs and event-handler attributes in raw HTML tables. All of it must render inert, and nothing is fetched from third-party hosts. *Test: Task 17, `block-markdown.test.ts`.*
2. **Secrets typed into the Vault UI never persist on the client or echo back.** This covers the DOM after save, storage, the query cache, the console, error toasts, and fixture state and responses. *Tests: Task 5, `router.test.ts` ("vault never stores values"); Task 25, `vault.spec.ts` (canary).*
3. **Long unbroken content at 390 px** must never push the page sideways or clip controls: a 200-character title with no spaces, a very long origin, a 63-character alias, a wide table and long code. *Seeded in Task 5 (`n10`, `v5`). Asserted by `expectCleanScreen` in Tasks 14, 18 and 24.*
4. **Folder moves that would create a cycle or exceed depth 8** are refused before any request (no drop affordance), and a server rejection rolls back. *Tests: Task 5, `tree.test.ts`; Task 13, `folders.spec.ts`.*
5. **A failed optimistic action** (move, Mark verified) rolls back visibly and says so. Undo still works after navigating away. *Tests: Task 15, `move.spec.ts`; Task 21, `verify.spec.ts`.*

---

## File Structure

```
package.json                         (mod) lint runs stylelint; test:ui; devDeps stylelint, react-hooks
eslint.config.js                     (mod) react-hooks + motion plugin + import bans
stylelint.config.mjs                 motion/animation CSS rules
vitest.config.ts                     (mod) "@/" alias for apps/web, projects extend root
.gitignore / .prettierignore         (mod) Playwright output, generated motion.css
.github/workflows/ci.yml             (mod) "ui" job
packages/contracts/src/env.ts        (mod) WebEnv.WEB_FIXTURE_API
packages/contracts/src/env-fixture.test.ts
tests/compose/no-fixture-api.test.ts

apps/web/
  package.json (mod) · tsconfig.json (mod: paths) · postcss.config.mjs · components.json
  playwright.config.ts
  app/globals.css · layout.tsx (mod) · providers.tsx · page.tsx (mod: redirect)
  app/api/rpc/[[...rest]]/route.ts
  app/(auth)/layout.tsx · sign-in/page.tsx · sign-up/page.tsx
  app/(app)/layout.tsx · design/page.tsx · new/page.tsx · runs/page.tsx (F3 replaces)
  app/(app)/library/page.tsx · notes/[noteId]/page.tsx · vault/page.tsx
  app/(app)/settings/page.tsx · settings/usage/page.tsx · settings/audit/page.tsx
  styles/tokens.css · motion.css (generated) · base.css · components.css · overlays.css
  styles/shell.css · library.css · note.css · vault.css · settings.css
  scripts/generate-motion-css.ts
  lint/motion-eslint-plugin.ts (+ .test.ts) · lint/stylelint.test.ts
  lib/cx.ts · breakpoints.ts · motion-tokens.ts (+ .test.ts) · auth-client.ts (+ .test.ts)
  lib/hooks/use-media-query.ts · use-hotkey.ts
  lib/api/client.ts · errors.ts (+ .test.ts)
  lib/server/viewer.ts · rpc/live-router.ts
  lib/fixtures/cookies.ts · ids.ts · assets.ts · types.ts · seed.ts · store.ts · router.ts (+ router.test.ts)
  lib/folders/tree.ts (+ .test.ts) · drag.ts
  lib/library/params.ts (+ .test.ts)
  lib/notes/format.ts · cache.ts · provenance.ts (+ .test.ts) · callout-layout.ts (+ .test.ts)
  lib/export/note-markdown.ts (+ .test.ts)
  lib/vault/fields.ts (+ .test.ts)
  lib/usage/summary.ts (+ .test.ts)
  components/motion/motion-provider.tsx
  components/ui/icons.ts · icon.tsx (+ icons.test.ts) · button.tsx · badge.tsx · chip.tsx · skeleton.tsx
  components/ui/text-field.tsx · search-field.tsx · switch.tsx · toolbar.tsx · page-head.tsx · empty-state.tsx
  components/ui/controls.test.ts · sheet.tsx · confirm-dialog.tsx · popover.tsx · menu.tsx
  components/toast/toast-provider.tsx
  components/bits/LICENSE-react-bits · swipe-toast.tsx · rubber-segment.tsx · spring-check.tsx
  components/design/design-system-view.tsx · sections/*.tsx
  components/shell/app-shell.tsx · sidebar.tsx · nav-items.ts (+ .test.ts) · recent-notes.tsx · kill-banner.tsx · user-menu.tsx
  components/auth/auth-form.tsx
  components/library/*  (folder tree, sheets, view, card, move, search)
  components/note/*     (reader, blocks, markdown, provenance, callouts, source pane, verify, editor, export)
  components/vault/*    (view, cutaway, row, add sheet, secret sheet)
  components/settings/* (view, kill switch, defaults, usage, chart, audit)
  e2e/helpers/{breakpoints,layout-qa,a11y,test}.ts
  e2e/*.spec.ts
```

---

## F1: Design system

### Task 1: Tailwind v4, tokens and type

**Files:**
- Modify: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/app/layout.tsx`, `vitest.config.ts`
- Create: `apps/web/postcss.config.mjs`, `apps/web/styles/tokens.css`, `apps/web/styles/base.css`, `apps/web/app/globals.css`, `apps/web/lib/breakpoints.ts`
- Test: `apps/web/styles/tokens.test.ts`

**Interfaces:**
- Consumes: the Phase 0 `apps/web` skeleton (Task 13).
- Produces:
  - **CSS tokens on `:root`:** `--bg`, `--bg-2`, `--bg-3`, `--elevated`, `--label`, `--label-2`, `--label-3`, `--hairline`, `--sep`, `--fill`, `--fill-2`, `--tint`, `--tint-text`, `--on-tint`, `--tint-wash`, `--signal`, `--on-signal`, `--signal-wash`, `--navy`, `--ok`, `--ok-wash`, `--warn`, `--warn-wash`, `--danger`, `--on-danger`, `--danger-wash`, `--switch-on`, `--seg-thumb`, `--seg-thumb-shadow`, `--code-*`, `--glass`, `--glass-side`, `--glass-line`, `--blur`, `--scrim`, `--ambient`, `--e1..3`, `--font-ui`, `--font-display`, `--font-code`, `--r-xs|sm|md|lg|xl|pill|frame`, `--hit`, `--sidebar-w`, `--rail-w`, `--tabbar-h`, `--toolbar-h`, `--measure`, `--margin-col`, `--gutter`.
  - **Tailwind theme utilities:** `bg-bg`, `text-label`, `text-label-2`, `rounded-md`, `shadow-e2`, `font-display`, `ease-out`, `ease-spring` and so on. Breakpoint variants `sm:` / `md:` / `lg:` match `BREAKPOINTS_REM` (test-enforced).
  - **Type classes:** `.t-hero`, `.t-large`, `.t-title1..3`, `.t-callout`, `.t-foot`, `.eyebrow`, `.cap`, `.mono`, `.muted`, `.period`.
  - **`lib/breakpoints.ts`:** `BREAKPOINTS_REM`, `MEDIA` (`{sm, md, lg}` media-query strings).
  - **Import alias:** `@/*` resolves to `apps/web/*` in Next, `tsc` and vitest.

- [ ] **Step 1: Install Tailwind.**

Run:
```bash
pnpm --filter @mastertutor/web add -D -E tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3
```

`apps/web/postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`apps/web/tsconfig.json` (replace the file; it keeps Phase 0's options and adds `paths`):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "es2024"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "verbatimModuleSyntax": false,
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "test-results", "playwright-report"]
}
```

`vitest.config.ts` (replace the file):
```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const exclude = ["**/node_modules/**", "**/.next/**"];

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/", import.meta.url)) }],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "packages/**/*.test.ts",
            "apps/**/*.test.ts",
            "scripts/**/*.test.ts",
            "tests/**/*.test.ts",
          ],
          exclude: [...exclude, "**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["packages/**/*.int.test.ts", "apps/**/*.int.test.ts", "tests/**/*.int.test.ts"],
          exclude,
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
```

- [ ] **Step 2: Write the failing test.**

`apps/web/styles/tokens.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS_REM } from "../lib/breakpoints.ts";

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function blockAfter(marker: string): Record<string, string> {
  const at = tokens.indexOf(marker);
  if (at < 0) throw new Error(`missing ${marker}`);
  const open = tokens.indexOf(":root {", at);
  const body = tokens.slice(tokens.indexOf("{", open) + 1, tokens.indexOf("}", open));
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}

type Rgba = [number, number, number, number];
function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] ? Number(rgb[4]) : 1];
  throw new Error(`unparseable colour ${value}`);
}
const over = (fg: Rgba, bg: Rgba): Rgba => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  1,
];
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgba) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [text token, background token]; alpha backgrounds are composited over --bg. */
const PAIRS: Array<[string, string]> = [
  ["label", "bg"],
  ["label-2", "bg"],
  ["label-2", "bg-2"],
  ["label-2", "elevated"],
  ["label", "fill"],
  ["label", "fill-2"],
  ["tint-text", "bg"],
  ["tint-text", "tint-wash"],
  ["on-tint", "tint"],
  ["signal", "bg"],
  ["signal", "signal-wash"],
  ["on-signal", "signal"],
  ["ok", "bg"],
  ["ok", "ok-wash"],
  ["warn", "bg"],
  ["warn", "warn-wash"],
  ["danger", "bg"],
  ["danger", "danger-wash"],
  ["on-danger", "danger"],
  ["code-keyword", "bg-2"],
  ["code-number", "bg-2"],
  ["code-title", "bg-2"],
  ["code-string", "bg-2"],
  ["code-comment", "bg-2"],
];

describe.each([
  ["light", blockAfter("/* light */")],
  ["dark", blockAfter("prefers-color-scheme: dark")],
])("%s tokens", (_scheme, vars) => {
  it.each(PAIRS)("%s on %s meets WCAG AA (4.5:1)", (fg, bg) => {
    const base = parseColor(vars["bg"] ?? "");
    const back = over(parseColor(vars[bg] ?? ""), base);
    const text = over(parseColor(vars[fg] ?? ""), back);
    expect(contrast(text, back)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("tokens", () => {
  it("uses the D25 background", () => {
    expect(blockAfter("/* light */")["bg"]).toBe("#fafafa");
  });
  it("keeps Tailwind breakpoints equal to lib/breakpoints.ts", () => {
    for (const [name, rem] of Object.entries(BREAKPOINTS_REM)) {
      expect(globals).toContain(`--breakpoint-${name}: ${rem}rem;`);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/styles`
Expected: FAIL, because `tokens.css` and `lib/breakpoints.ts` are missing.

- [ ] **Step 4: Implement.**

`apps/web/lib/breakpoints.ts`:
```ts
/**
 * Width breakpoints in rem, mirrored by --breakpoint-* in app/globals.css (a test keeps them equal).
 * Each is 1px above a QA width: sm > 420, md > 820, lg > 1180 (spec §11.5).
 */
export const BREAKPOINTS_REM = { sm: 26.3125, md: 51.3125, lg: 73.8125 } as const;

export const MEDIA = {
  sm: `(min-width: ${BREAKPOINTS_REM.sm}rem)`,
  md: `(min-width: ${BREAKPOINTS_REM.md}rem)`,
  lg: `(min-width: ${BREAKPOINTS_REM.lg}rem)`,
} as const;
```

`apps/web/styles/tokens.css`:
```css
/* Design tokens: spec §11.1, run 12, D25. Components read these through Tailwind @theme or var(). */
/* light */
:root {
  color-scheme: light;
  --bg: #fafafa;
  --bg-2: #f5f5f7;
  --bg-3: #fbfbfd;
  --elevated: #ffffff;
  --label: #1d1d1f;
  --label-2: #6e6e73;
  --label-3: #86868b;
  --hairline: #d2d2d7;
  --sep: rgb(0 0 0 / 0.08);
  --fill: rgb(118 118 128 / 0.12);
  --fill-2: rgb(118 118 128 / 0.08);
  --tint: #0071e3;
  --tint-text: #0066cc;
  --on-tint: #ffffff;
  --tint-wash: rgb(0 113 227 / 0.09);
  --signal: #c22914;
  --on-signal: #ffffff;
  --signal-wash: rgb(217 48 26 / 0.08);
  --navy: #0b1a66;
  --ok: #17742f;
  --ok-wash: rgb(26 127 55 / 0.09);
  --warn: #a84b00;
  --warn-wash: rgb(255 159 10 / 0.14);
  --danger: #d70015;
  --on-danger: #ffffff;
  --danger-wash: rgb(215 0 21 / 0.08);
  --switch-on: #34c759;
  --seg-thumb: #ffffff;
  --seg-thumb-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.06), 0 2px 6px rgb(0 0 0 / 0.1);
  --code-keyword: #9b2393;
  --code-number: #1c00cf;
  --code-title: #326d74;
  --code-string: #c41a16;
  --code-comment: #6e6e73;
  --glass: rgb(255 255 255 / 0.72);
  --glass-side: rgb(246 246 248 / 0.78);
  --glass-line: rgb(0 0 0 / 0.07);
  --blur: saturate(180%) blur(24px);
  --scrim: rgb(0 0 0 / 0.18);
  --ambient: rgb(0 113 227 / 0.16);
  --e1: 0 0 0 0.5px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.05);
  --e2: 0 0 0 0.5px rgb(0 0 0 / 0.08), 0 6px 16px rgb(0 0 0 / 0.07), 0 1px 3px rgb(0 0 0 / 0.05);
  --e3: 0 0 0 0.5px rgb(0 0 0 / 0.1), 0 22px 48px rgb(0 0 0 / 0.14), 0 4px 10px rgb(0 0 0 / 0.06);
  --font-ui:
    -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", var(--font-inter), Inter,
    system-ui, sans-serif;
  --font-display:
    -apple-system, BlinkMacSystemFont, "SF Pro Display", var(--font-inter), Inter, system-ui,
    sans-serif;
  --font-code: ui-monospace, "SF Mono", "Geist Mono", Menlo, monospace;
  --r-xs: 0.375rem;
  --r-sm: 0.5rem;
  --r-md: 0.75rem;
  --r-lg: 1.125rem;
  --r-xl: 1.625rem;
  --r-pill: 62.4375rem;
  --r-frame: 0.875rem;
  --hit: 2.75rem;
  --sidebar-w: 15.5rem;
  --rail-w: 4.5rem;
  --tabbar-h: 3.5rem;
  --toolbar-h: 3.25rem;
  --measure: 42.5rem;
  --margin-col: 15rem;
  --gutter: 2.5rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #0b0b0c;
    --bg-2: #161617;
    --bg-3: #111112;
    --elevated: #1c1c1e;
    --label: #f5f5f7;
    --label-2: #a1a1a6;
    --label-3: #6e6e73;
    --hairline: #38383a;
    --sep: rgb(255 255 255 / 0.09);
    --fill: rgb(118 118 128 / 0.24);
    --fill-2: rgb(118 118 128 / 0.16);
    --tint: #0071e3;
    --tint-text: #2997ff;
    --on-tint: #ffffff;
    --tint-wash: rgb(41 151 255 / 0.14);
    --signal: #ff5533;
    --on-signal: #0b0b0c;
    --signal-wash: rgb(255 85 51 / 0.13);
    --navy: #2b3a8f;
    --ok: #30d158;
    --ok-wash: rgb(48 209 88 / 0.13);
    --warn: #ffb340;
    --warn-wash: rgb(255 179 64 / 0.13);
    --danger: #ff453a;
    --on-danger: #0b0b0c;
    --danger-wash: rgb(255 69 58 / 0.14);
    --switch-on: #30d158;
    --seg-thumb: #5a5a5e;
    --seg-thumb-shadow: 0 0 0 0.5px rgb(255 255 255 / 0.08);
    --code-keyword: #ff7ab2;
    --code-number: #d9c97c;
    --code-title: #78c2b3;
    --code-string: #fc6a5d;
    --code-comment: #a1a1a6;
    --glass: rgb(22 22 23 / 0.72);
    --glass-side: rgb(28 28 30 / 0.74);
    --glass-line: rgb(255 255 255 / 0.08);
    --scrim: rgb(0 0 0 / 0.45);
    --ambient: rgb(41 151 255 / 0.12);
    --e1: 0 0 0 0.5px rgb(255 255 255 / 0.1);
    --e2: 0 0 0 0.5px rgb(255 255 255 / 0.1), 0 8px 24px rgb(0 0 0 / 0.5);
    --e3: 0 0 0 0.5px rgb(255 255 255 / 0.12), 0 24px 60px rgb(0 0 0 / 0.65);
  }
}

@media (prefers-reduced-transparency: reduce) {
  :root {
    --glass: var(--bg);
    --glass-side: var(--bg-2);
    --blur: none;
  }
}
```

`apps/web/styles/base.css`:
```css
*,
*::before,
*::after {
  box-sizing: border-box;
}
html {
  font-size: 100%;
  -webkit-text-size-adjust: 100%;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--label);
  font: 400 0.875rem/1.43 var(--font-ui);
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.006em;
}
button,
input,
textarea,
select {
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
}
button {
  cursor: pointer;
  background: none;
  border: 0;
  padding: 0;
}
a {
  color: var(--tint-text);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
h1,
h2,
h3,
h4,
p,
figure,
blockquote {
  margin: 0;
}
:focus-visible {
  outline: 2px solid var(--tint-text);
  outline-offset: 2px;
  border-radius: var(--r-xs);
}
.t-hero {
  font: 700 clamp(2.75rem, 5.4vw, 4.5rem) / 1 var(--font-display);
  letter-spacing: -0.04em;
}
.t-large {
  font: 700 clamp(2.25rem, 4.6vw, 3.75rem) / 1.05 var(--font-display);
  letter-spacing: -0.04em;
}
.t-title1 {
  font: 600 1.75rem/1.15 var(--font-display);
  letter-spacing: -0.024em;
}
.t-title2 {
  font: 600 1.375rem/1.25 var(--font-display);
  letter-spacing: -0.018em;
}
.t-title3 {
  font: 600 1.0625rem/1.3 var(--font-ui);
  letter-spacing: -0.012em;
}
.t-callout {
  font-size: 0.8125rem;
  line-height: 1.38;
}
.t-foot {
  font-size: 0.75rem;
  line-height: 1.33;
  color: var(--label-2);
}
.eyebrow {
  font: 600 0.6875rem/1.2 var(--font-ui);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--label-2);
}
.cap {
  font: italic 400 0.75rem/1.42 var(--font-ui);
  color: var(--label-2);
  letter-spacing: 0;
}
.cap b {
  font-style: normal;
  font-weight: 600;
  color: var(--label);
}
.mono {
  font-family: var(--font-code);
  font-size: 0.75rem;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--label-2);
}
.period {
  color: var(--signal);
}
```

`apps/web/app/globals.css`:
```css
@import "tailwindcss";
@import "../styles/tokens.css";
@import "../styles/base.css";

@theme inline {
  --color-*: initial;
  --color-bg: var(--bg);
  --color-bg-2: var(--bg-2);
  --color-elevated: var(--elevated);
  --color-label: var(--label);
  --color-label-2: var(--label-2);
  --color-label-3: var(--label-3);
  --color-hairline: var(--hairline);
  --color-sep: var(--sep);
  --color-fill: var(--fill);
  --color-fill-2: var(--fill-2);
  --color-tint: var(--tint);
  --color-tint-text: var(--tint-text);
  --color-on-tint: var(--on-tint);
  --color-tint-wash: var(--tint-wash);
  --color-signal: var(--signal);
  --color-signal-wash: var(--signal-wash);
  --color-ok: var(--ok);
  --color-ok-wash: var(--ok-wash);
  --color-warn: var(--warn);
  --color-warn-wash: var(--warn-wash);
  --color-danger: var(--danger);
  --color-danger-wash: var(--danger-wash);
  --font-*: initial;
  --font-sans: var(--font-ui);
  --font-display: var(--font-display);
  --font-mono: var(--font-code);
  --text-*: initial;
  --radius-*: initial;
  --radius-xs: var(--r-xs);
  --radius-sm: var(--r-sm);
  --radius-md: var(--r-md);
  --radius-lg: var(--r-lg);
  --radius-xl: var(--r-xl);
  --radius-pill: var(--r-pill);
  --radius-frame: var(--r-frame);
  --shadow-*: initial;
  --shadow-e1: var(--e1);
  --shadow-e2: var(--e2);
  --shadow-e3: var(--e3);
  --inset-shadow-*: initial;
  --drop-shadow-*: initial;
  --text-shadow-*: initial;
  --blur-*: initial;
  --animate-*: initial;
  --breakpoint-*: initial;
  --breakpoint-sm: 26.3125rem;
  --breakpoint-md: 51.3125rem;
  --breakpoint-lg: 73.8125rem;
}
```

`apps/web/app/layout.tsx` (replace the file):
```tsx
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "MasterTutor", template: "%s · MasterTutor" },
  description: "Faithful notes, taken by an agent in its own browser.",
};

export const viewport: Viewport = { viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Run the tests and the build to verify they pass.**

Run: `pnpm test -- apps/web/styles && pnpm typecheck && pnpm --filter @mastertutor/web build`
Expected:
- 48 contrast cases pass (24 pairs × 2 schemes), plus the 2 token tests.
- The build succeeds.

- [ ] **Step 6: Commit.**

```bash
git add apps/web vitest.config.ts pnpm-lock.yaml
git commit -m "feat(web): Tailwind v4 theme from one tokens.css, AA-checked colours, type scale, @/ alias"
```

---

### Task 2: Motion foundation (pin, tokens, generated CSS, provider)

**Files:**
- Create: `apps/web/lib/motion-tokens.ts`, `apps/web/scripts/generate-motion-css.ts`, `apps/web/styles/motion.css` (generated), `apps/web/components/motion/motion-provider.tsx`, `apps/web/app/providers.tsx`
- Modify: `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/package.json`, `.prettierignore`
- Test: `apps/web/lib/motion-tokens.test.ts`

**Interfaces:**
- Consumes: Task 1's `globals.css`.
- Produces:
  - **`lib/motion-tokens.ts`:**
    - `springs.{spring,springSoft}` as `{type:"spring", stiffness, damping, mass}`;
    - `durations.{micro:120, base:200, panel:300, stagger:35, shimmer:1300, pulse:1600, toast:5000}` in ms;
    - `easings.{out,in,cursor}` as 4-tuples;
    - `press.{scale:0.96, iconScale:0.92, rowScale:0.98}`;
    - `transitions.{micro,base,panel,exit,spring,springSoft}`, ready for `motion`;
    - `fuse.easing`.
  - **`renderMotionCss(): string`** and `sampleSpring(...)` from `scripts/generate-motion-css.ts`.
  - **CSS variables:** `--motion-dur-<name>`, `--motion-ease-out|in|cursor|linear`, `--motion-spring`, `--motion-spring-dur`, `--motion-spring-soft`, `--motion-spring-soft-dur`, `--motion-press`, `--motion-press-icon`, `--motion-press-row`. A global reduced-motion block swaps transitions for opacity-only.
  - **Tailwind:** `ease-out`, `ease-in`, `ease-spring`, `ease-spring-soft`, `ease-cursor`.
  - **`<MotionProvider>`:** `LazyMotion strict` with `domAnimation`, plus `MotionConfig reducedMotion="user"`.
  - **`<Providers>`** in `app/providers.tsx`, wrapping `body`.
  - **Script:** `pnpm --filter @mastertutor/web motion:css`.

- [ ] **Step 1: Check the motion pin, then install.**

Run:
```bash
pnpm view motion@14.0.0 peerDependencies dependencies
```
Expected: peers `react: '^18.0.0 || ^19.0.0'`, and `framer-motion: '14.0.0'` among the dependencies. If the peers exclude React 19, stop and pin `13.5.1` instead, recording that in the commit message.

Run:
```bash
pnpm --filter @mastertutor/web add -E motion@14.0.0
```

- [ ] **Step 2: Write the failing test.**

`apps/web/lib/motion-tokens.test.ts`:
```ts
import { readFileSync } from "node:fs";
import * as motionReact from "motion/react";
import { describe, expect, it } from "vitest";
import { renderMotionCss, sampleSpring } from "../scripts/generate-motion-css.ts";
import { durations, springs, transitions } from "./motion-tokens.ts";

describe("motion tokens", () => {
  it("settles the main spring in about 450ms (spec §11.4)", () => {
    const { durationMs, values } = sampleSpring(springs.spring);
    expect(durationMs).toBeGreaterThanOrEqual(400);
    expect(durationMs).toBeLessThanOrEqual(520);
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(Math.max(...values)).toBeGreaterThan(1);
  });

  it("keeps the soft spring slower than the main one", () => {
    expect(sampleSpring(springs.springSoft).durationMs).toBeGreaterThan(
      sampleSpring(springs.spring).durationMs,
    );
  });

  it("expresses tween durations in seconds for motion", () => {
    expect(transitions.micro.duration).toBe(durations.micro / 1000);
    expect(transitions.spring).toBe(springs.spring);
  });

  it("matches the committed styles/motion.css (run motion:css after editing tokens)", () => {
    const committed = readFileSync(new URL("../styles/motion.css", import.meta.url), "utf8");
    expect(committed).toBe(renderMotionCss());
  });

  it("emits a linear() spring and a reduced-motion fallback", () => {
    const css = renderMotionCss();
    expect(css).toMatch(/--motion-spring: linear\(0, [^)]*, 1\);/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("still exports every motion API this app uses (motion 12 to 14 guard)", () => {
    for (const name of [
      "LazyMotion",
      "domAnimation",
      "m",
      "animate",
      "useMotionValue",
      "useTransform",
      "useMotionValueEvent",
      "useReducedMotion",
      "MotionConfig",
      "AnimatePresence",
    ]) {
      expect(motionReact, name).toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/lib/motion-tokens`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement.**

`apps/web/lib/motion-tokens.ts`:
```ts
/**
 * The single source of motion values (spec §11.4, D21, D28). CSS reads the generated
 * styles/motion.css; components pass `transitions.*` to motion. Lint forbids raw values elsewhere.
 */
export const springs = {
  /** Stiffness 400, damping 30: settles in about 465ms. Buttons, knobs, cards, toasts. */
  spring: { type: "spring", stiffness: 400, damping: 30, mass: 1 },
  /** Softer spring for sheets and the PiP. */
  springSoft: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
} as const;

/** Milliseconds. */
export const durations = {
  micro: 120,
  base: 200,
  panel: 300,
  stagger: 35,
  shimmer: 1300,
  pulse: 1600,
  toast: 5000,
} as const;

export const easings = {
  out: [0.16, 1, 0.3, 1],
  in: [0.4, 0, 1, 1],
  cursor: [0.2, 0.8, 0.2, 1],
} as const;

export const press = { scale: 0.96, iconScale: 0.92, rowScale: 0.98 } as const;

const seconds = (ms: number) => ms / 1000;

export const transitions = {
  micro: { duration: seconds(durations.micro), ease: easings.out },
  base: { duration: seconds(durations.base), ease: easings.out },
  panel: { duration: seconds(durations.panel), ease: easings.out },
  exit: { duration: seconds(durations.base), ease: easings.in },
  spring: springs.spring,
  springSoft: springs.springSoft,
} as const;

/** Toast countdown bar (WAAPI); it must burn at a constant rate. */
export const fuse = { easing: "linear" } as const;
```

`apps/web/scripts/generate-motion-css.ts`:
```ts
/**
 * Generates styles/motion.css from lib/motion-tokens.ts so CSS and motion share one source.
 * Usage: node scripts/generate-motion-css.ts        (writes the file)
 */
import { writeFileSync } from "node:fs";
import { spring } from "motion";
import { durations, easings, press, springs } from "../lib/motion-tokens.ts";

interface SpringToken {
  stiffness: number;
  damping: number;
  mass: number;
}

/** Samples a spring from 0 to 1 into evenly spaced points for CSS linear(). */
export function sampleSpring(token: SpringToken, points = 40): { durationMs: number; values: number[] } {
  const generator = spring({ ...token, keyframes: [0, 1] });
  let durationMs = 0;
  while (!generator.next(durationMs).done && durationMs < 5000) durationMs += 5;
  const values = Array.from({ length: points + 1 }, (_, i) =>
    i === points ? 1 : Number(generator.next((durationMs * i) / points).value.toFixed(4)),
  );
  return { durationMs, values };
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const bezier = (e: readonly number[]) => `cubic-bezier(${e.join(", ")})`;

export function renderMotionCss(): string {
  const main = sampleSpring(springs.spring);
  const soft = sampleSpring(springs.springSoft);
  const lines = [
    "/* Generated by scripts/generate-motion-css.ts from lib/motion-tokens.ts. Do not edit. */",
    ":root {",
    ...Object.entries(durations).map(([name, ms]) => `  --motion-dur-${kebab(name)}: ${ms}ms;`),
    `  --motion-ease-out: ${bezier(easings.out)};`,
    `  --motion-ease-in: ${bezier(easings.in)};`,
    `  --motion-ease-cursor: ${bezier(easings.cursor)};`,
    "  --motion-ease-linear: linear;",
    `  --motion-spring: linear(${main.values.join(", ")});`,
    `  --motion-spring-dur: ${main.durationMs}ms;`,
    `  --motion-spring-soft: linear(${soft.values.join(", ")});`,
    `  --motion-spring-soft-dur: ${soft.durationMs}ms;`,
    `  --motion-press: ${press.scale};`,
    `  --motion-press-icon: ${press.iconScale};`,
    `  --motion-press-row: ${press.rowScale};`,
    "}",
    "",
    "/* Reduced motion: movement becomes a short fade (spec §11.4). */",
    "@media (prefers-reduced-motion: reduce) {",
    "  *,",
    "  *::before,",
    "  *::after {",
    "    animation-duration: 1ms !important;",
    "    animation-iteration-count: 1 !important;",
    "    transition-property: opacity !important;",
    "    transition-duration: var(--motion-dur-micro) !important;",
    "    scroll-behavior: auto !important;",
    "  }",
    "}",
    "",
  ];
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL("../styles/motion.css", import.meta.url), renderMotionCss());
  console.log("wrote styles/motion.css");
}
```

Add to `apps/web/package.json` `"scripts"`: `"motion:css": "node scripts/generate-motion-css.ts"`. Then run:
```bash
pnpm --filter @mastertutor/web motion:css
```
Expected: `wrote styles/motion.css`.

Add `apps/web/styles/motion.css` to `.prettierignore`.

In `apps/web/app/globals.css`, insert `@import "../styles/motion.css";` after the tokens import. Then add these lines inside `@theme inline { … }`, after `--animate-*: initial;`:
```css
  --ease-*: initial;
  --ease-out: var(--motion-ease-out);
  --ease-in: var(--motion-ease-in);
  --ease-cursor: var(--motion-ease-cursor);
  --ease-spring: var(--motion-spring);
  --ease-spring-soft: var(--motion-spring-soft);
```

`apps/web/components/motion/motion-provider.tsx`:
```tsx
"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { ReactNode } from "react";
import { transitions } from "@/lib/motion-tokens.ts";

/** strict: rendering a full `motion.*` component throws, which keeps the bundle on `m.*`. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={transitions.spring}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
```

`apps/web/app/providers.tsx`:
```tsx
"use client";

import type { ReactNode } from "react";
import { MotionProvider } from "@/components/motion/motion-provider.tsx";

export function Providers({ children }: { children: ReactNode }) {
  return <MotionProvider>{children}</MotionProvider>;
}
```

In `apps/web/app/layout.tsx`, import `{ Providers } from "./providers.tsx"` and render `<body><Providers>{children}</Providers></body>`.

- [ ] **Step 5: Run the tests and the build to verify they pass.**

Run: `pnpm test -- apps/web/lib/motion-tokens && pnpm typecheck && pnpm --filter @mastertutor/web build`
Expected: 6 tests PASS and the build succeeds. If the API-export test fails on 14.0.0, pin `motion@13.5.1`, re-run, and record the reason in the commit message.

- [ ] **Step 6: Commit.**

```bash
git add apps/web .prettierignore pnpm-lock.yaml
git commit -m "feat(web): pin motion 14.0.0; motion tokens as single source, generated motion.css, LazyMotion provider"
```

---

### Task 3: Motion and import lint rules

**Files:**
- Create: `apps/web/lint/motion-eslint-plugin.ts`, `stylelint.config.mjs`
- Modify: `eslint.config.js`, `package.json`
- Test: `apps/web/lint/motion-eslint-plugin.test.ts`, `apps/web/lint/stylelint.test.ts`

**Interfaces:**
- Consumes: `lib/motion-tokens.ts` (the only file exempt from `no-raw-motion`).
- Produces:
  - **ESLint rules** `motion/no-raw-motion` and `motion/no-raw-motion-classes`, plus `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`.
  - **Import bans:**
    - `gsap`, `ogl`, `framer-motion`, `matter-js`, `@react-three/*` and `@hugeicons/*` everywhere;
    - `three` outside `components/hero/`;
    - `lucide-react` outside `components/ui/icons.ts`;
    - `motion` (the full component) from `motion/react`.
  - **Stylelint:**
    - no `ms`/`s` units, `cubic-bezier()` or `steps()` outside `motion.css`;
    - no `transition` shorthand;
    - `transition-property` limited to transform, opacity, scale, translate, rotate and visibility;
    - keyframes may set only those properties;
    - timing functions must be `var(--motion-…)`.
  - **Root `pnpm lint`** runs ESLint and Stylelint.

- [ ] **Step 1: Install.**

Run:
```bash
pnpm add -Dw -E stylelint@17.16.0 eslint-plugin-react-hooks@7.1.1
```

- [ ] **Step 2: Write the failing tests.**

`apps/web/lint/motion-eslint-plugin.test.ts`:
```ts
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import plugin from "./motion-eslint-plugin.ts";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-raw-motion", plugin.rules["no-raw-motion"], {
  valid: [
    "animate(x, 1, transitions.spring)",
    "const t = { duration: durations.micro / 1000 }",
    "const s = { name: 'x', delay: someValue }",
    "<Toast duration={durations.toast} />",
  ],
  invalid: [
    { code: "animate(x, 1, { stiffness: 400, damping: 30 })", errors: 2 },
    { code: "const t = { duration: 0.2, ease: [0.16, 1, 0.3, 1] }", errors: 2 },
    { code: "el.animate(k, { easing: 'linear' })", errors: 1 },
    { code: "<Toast duration={4000} />", errors: 1 },
  ],
});

tester.run("no-raw-motion-classes", plugin.rules["no-raw-motion-classes"], {
  valid: [
    '<div className="transition-transform duration-(--motion-dur-micro) ease-out" />',
    "cx('btn', active && 'scale-96')",
  ],
  invalid: [
    { code: '<div className="transition duration-200" />', errors: 2 },
    { code: '<div className="transition-colors ease-in-out" />', errors: 2 },
    { code: "<div className={`[transition:opacity_160ms_ease] ${x}`} />", errors: 1 },
    { code: "cx('animate-spin', 'delay-150')", errors: 2 },
  ],
});
```

`apps/web/lint/stylelint.test.ts`:
```ts
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";
import config from "../../../stylelint.config.mjs";

async function problems(code: string): Promise<string[]> {
  const { results } = await stylelint.lint({ code, config, codeFilename: "apps/web/styles/x.css" });
  return (results[0]?.warnings ?? []).map((w) => w.rule);
}

describe("stylelint motion rules", () => {
  it("accepts token-driven transform/opacity motion", async () => {
    expect(
      await problems(`.a { transition-property: transform, opacity; transition-duration: var(--motion-dur-micro);
        transition-timing-function: var(--motion-ease-out); }
        @keyframes k { from { opacity: 0; transform: translateY(1rem); } to { opacity: 1; } }`),
    ).toEqual([]);
  });

  it("rejects raw times, curves, shorthands and layout animation", async () => {
    const rules = await problems(`.a { transition: background 200ms ease; }
      .b { transition-property: width; animation-timing-function: cubic-bezier(.2,.8,.2,1); }
      .c { transition-timing-function: ease-in-out; }
      @keyframes k { from { height: 0; } }`);
    expect(rules).toEqual(
      expect.arrayContaining([
        "property-disallowed-list",
        "unit-disallowed-list",
        "declaration-property-value-allowed-list",
        "function-disallowed-list",
        "declaration-property-value-disallowed-list",
        "rule-selector-property-disallowed-list",
      ]),
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lint`
Expected: FAIL, because the plugin and config are missing.

- [ ] **Step 4: Implement.**

`apps/web/lint/motion-eslint-plugin.ts`:
```ts
import type { Rule } from "eslint";

/** Keys whose literal values are motion timing and must come from lib/motion-tokens.ts. */
const MOTION_KEYS = new Set([
  "stiffness",
  "damping",
  "mass",
  "bounce",
  "duration",
  "visualDuration",
  "ease",
  "easing",
  "delay",
  "restDelta",
  "restSpeed",
]);

interface AnyNode {
  type: string;
  [key: string]: unknown;
}

function isLiteralish(node: AnyNode | null | undefined): boolean {
  if (!node) return false;
  switch (node.type) {
    case "Literal":
      return typeof node.value === "number" || typeof node.value === "string";
    case "UnaryExpression":
      return isLiteralish(node.argument as AnyNode);
    case "ArrayExpression": {
      const elements = node.elements as AnyNode[];
      return elements.length > 0 && elements.every(isLiteralish);
    }
    case "TemplateLiteral":
      return (node.expressions as unknown[]).length === 0;
    case "JSXExpressionContainer":
      return isLiteralish(node.expression as AnyNode);
    default:
      return false;
  }
}

const noRawMotion: Rule.RuleModule = {
  meta: {
    type: "problem",
    messages: { raw: "Use a token from lib/motion-tokens.ts instead of a raw '{{key}}' value." },
    schema: [],
  },
  create(context) {
    const check = (key: string, value: AnyNode | null | undefined, node: Rule.Node) => {
      if (MOTION_KEYS.has(key) && isLiteralish(value)) context.report({ node, messageId: "raw", data: { key } });
    };
    return {
      Property(node) {
        if (node.computed) return;
        const key =
          node.key.type === "Identifier"
            ? node.key.name
            : node.key.type === "Literal"
              ? String(node.key.value)
              : null;
        if (key) check(key, node.value as unknown as AnyNode, node);
      },
      JSXAttribute(node: Rule.Node) {
        const attr = node as unknown as { name: AnyNode; value: AnyNode | null };
        if (attr.name.type !== "JSXIdentifier") return;
        check(String(attr.name.name), attr.value, node);
      },
    } as Rule.RuleListener;
  },
};

/** Tailwind tokens that would bypass the motion tokens. */
const BANNED_CLASS_PATTERNS: RegExp[] = [
  /^transition$/,
  /^transition-(all|colors|shadow|\[.*\])$/,
  /^duration-(\d|\[)/,
  /^ease-(linear|in-out|\[.*\])$/,
  /^delay-(\d|\[)/,
  /^animate-/,
];
const BANNED_ARBITRARY = [/\[(transition|animation)[^\]]*\]/, /\[[^\]]*\d(?:ms|s)\b[^\]]*\]/];

function badTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      if (BANNED_ARBITRARY.some((re) => re.test(token))) return true;
      const base = token.startsWith("[") ? token : (token.split(":").pop() ?? token);
      return BANNED_CLASS_PATTERNS.some((re) => re.test(base));
    });
}

const noRawMotionClasses: Rule.RuleModule = {
  meta: {
    type: "problem",
    messages: {
      raw: "Class '{{token}}' bypasses motion tokens; use transition-transform/opacity with duration-(--motion-dur-*) and ease-*.",
    },
    schema: [],
  },
  create(context) {
    const report = (node: Rule.Node, text: string) => {
      for (const token of badTokens(text)) context.report({ node, messageId: "raw", data: { token } });
    };
    const visit = (node: AnyNode | null | undefined, reportNode: Rule.Node) => {
      if (!node) return;
      if (node.type === "Literal" && typeof node.value === "string") report(reportNode, node.value);
      if (node.type === "TemplateLiteral") {
        for (const quasi of node.quasis as Array<{ value: { cooked: string | null } }>) {
          report(reportNode, quasi.value.cooked ?? "");
        }
      }
      if (node.type === "JSXExpressionContainer") visit(node.expression as AnyNode, reportNode);
      if (node.type === "LogicalExpression") visit(node.right as AnyNode, reportNode);
      if (node.type === "ConditionalExpression") {
        visit(node.consequent as AnyNode, reportNode);
        visit(node.alternate as AnyNode, reportNode);
      }
    };
    return {
      JSXAttribute(node: Rule.Node) {
        const attr = node as unknown as { name: AnyNode; value: AnyNode | null };
        if (attr.name.type === "JSXIdentifier" && attr.name.name === "className") visit(attr.value, node);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "cx") {
          for (const arg of node.arguments) visit(arg as unknown as AnyNode, node);
        }
      },
    } as Rule.RuleListener;
  },
};

const plugin = { rules: { "no-raw-motion": noRawMotion, "no-raw-motion-classes": noRawMotionClasses } };
export default plugin;
```

`eslint.config.js` (replace the file; the Phase 0 blocks are kept unchanged and the web block is added):
```js
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import motionPlugin from "./apps/web/lint/motion-eslint-plugin.ts";

const ANIMATION_BANS = {
  group: [
    "gsap",
    "gsap/*",
    "ogl",
    "framer-motion",
    "matter-js",
    "@react-three/*",
    "@hugeicons/*",
  ],
  message: "motion is the only animation library and icons come from components/ui/icons.ts (spec §11.3–11.4).",
};
const THREE_BAN = { group: ["three", "three/*"], message: "three may be imported only from components/hero/." };
const LUCIDE_BAN = { group: ["lucide-react"], message: "Use <Icon> from components/ui/icon.tsx." };
const MOTION_COMPONENT_BAN = {
  name: "motion/react",
  importNames: ["motion"],
  message: "Use m.* inside LazyMotion (spec §11.4).",
};
const webImports = (patterns) => [
  "error",
  { paths: [MOTION_COMPONENT_BAN], patterns: [ANIMATION_BANS, ...patterns] },
];

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "packages/db/migrations/**",
      "apps/web/test-results/**",
      "apps/web/playwright-report/**",
      "orchestration/**",
      "design/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["packages/contracts/src/**/*.ts"],
    ignores: ["packages/contracts/src/server/**", "packages/contracts/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "pino"],
              message:
                "The contracts root entry must stay browser-safe; put Node-only code in src/server/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, motion: motionPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "motion/no-raw-motion": "error",
      "motion/no-raw-motion-classes": "error",
      "no-restricted-imports": webImports([THREE_BAN, LUCIDE_BAN]),
    },
  },
  {
    files: [
      "apps/web/lib/motion-tokens.ts",
      "apps/web/scripts/generate-motion-css.ts",
      "apps/web/lint/**",
    ],
    rules: { "motion/no-raw-motion": "off", "motion/no-raw-motion-classes": "off" },
  },
  {
    files: ["apps/web/components/ui/icons.ts"],
    rules: { "no-restricted-imports": webImports([THREE_BAN]) },
  },
  {
    files: ["apps/web/components/hero/**"],
    rules: { "no-restricted-imports": webImports([LUCIDE_BAN]) },
  },
  prettier,
);
```

`stylelint.config.mjs`:
```js
/** Motion rules for CSS (spec §11.4, D28). styles/motion.css is the only place raw timing lives. */
const ANIMATABLE = "(transform|opacity|scale|translate|rotate|visibility)";
const RAW_TIMING_KEYWORD = "/(?<![-\\w])(ease|ease-in|ease-out|ease-in-out|linear)(?![-\\w(])/";
const RAW_LINEAR_FN = "/(?<![-\\w])linear\\(/";

export default {
  ignoreFiles: ["**/node_modules/**", "**/.next/**", "apps/web/styles/motion.css"],
  rules: {
    "unit-disallowed-list": [
      ["ms", "s"],
      { message: "Use a --motion-dur-* variable from styles/motion.css" },
    ],
    "function-disallowed-list": [
      ["cubic-bezier", "steps"],
      { message: "Use a --motion-ease-* or --motion-spring variable" },
    ],
    "property-disallowed-list": [
      ["transition"],
      { message: "Write transition-property/duration/timing-function longhands" },
    ],
    "declaration-property-value-allowed-list": [
      { "transition-property": [`/^(none|${ANIMATABLE}(\\s*,\\s*${ANIMATABLE})*)$/`] },
      { message: "Only transform and opacity may animate (spec §11.4)" },
    ],
    "declaration-property-value-disallowed-list": [
      {
        "/^(transition-timing-function|animation-timing-function|animation)$/": [
          RAW_TIMING_KEYWORD,
          RAW_LINEAR_FN,
        ],
      },
      { message: "Timing functions come from var(--motion-…)" },
    ],
    "rule-selector-property-disallowed-list": [
      {
        "/^(from|to|\\d+(\\.\\d+)?%)(\\s*,\\s*(from|to|\\d+(\\.\\d+)?%))*$/": [
          `/^(?!${ANIMATABLE}$)/`,
        ],
      },
      { message: "Keyframes may only change transform and opacity" },
    ],
  },
};
```

In the root `package.json`, set the `lint` script to `"eslint . && stylelint \"apps/web/**/*.css\""`.

- [ ] **Step 5: Run the tests and lint to verify they pass.**

Run: `pnpm test -- apps/web/lint && pnpm lint`
Expected: PASS, with no lint findings in existing files.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/lint eslint.config.js stylelint.config.mjs package.json pnpm-lock.yaml
git commit -m "feat(lint): motion-token ESLint rules, Stylelint transform/opacity-only rules, animation import bans"
```

---

### Task 4: Icon registry

**Files:**
- Create: `apps/web/components/ui/icons.ts`, `apps/web/components/ui/icon.tsx`, `apps/web/lib/cx.ts`
- Test: `apps/web/components/ui/icons.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `cx(...parts: Array<string | false | null | undefined>): string`.
  - `icons` (the typed registry), `type IconName`, and `SOURCE_KIND_ICON: Record<SourceKind, IconName>`.
  - `<Icon name size? label? className? />`, where `size` is `"sm" | "md" | "lg" | "xl"`. It is decorative (`aria-hidden`) unless `label` is given, in which case it renders `role="img"` plus `aria-label`.

- [ ] **Step 1: Install.**

Run:
```bash
pnpm --filter @mastertutor/web add -E lucide-react@1.52.0
```

- [ ] **Step 2: Write the failing test.**

`apps/web/components/ui/icons.test.ts`:
```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon } from "./icon.tsx";
import { SOURCE_KIND_ICON, icons, type IconName } from "./icons.ts";

const REQUIRED: IconName[] = [
  // source and type
  "web",
  "pdf",
  "video",
  // folders
  "folder",
  "folderOpen",
  "folderNested",
  "folderAdd",
  "unfiled",
  "allNotes",
  // status
  "verified",
  "partial",
  "needsReview",
  "edited",
  "agentNote",
  "live",
  // vault fields
  "username",
  "password",
  "totp",
  "pin",
  "emailOtp",
  "codeOtp",
  "passkey",
  "hidden",
  // actions
  "add",
  "search",
  "close",
  "more",
  "move",
  "delete",
  "export",
  "edit",
  "check",
  "undo",
  "external",
  "signOut",
  "stop",
];

describe("icon registry (spec §11.3)", () => {
  it("covers every required set", () => {
    for (const name of REQUIRED) expect(icons, name).toHaveProperty(name);
  });

  it("maps every source kind to an icon, never a letter tile", () => {
    expect(SOURCE_KIND_ICON).toEqual({ web: "web", pdf: "pdf", youtube: "video" });
  });

  it("renders decorative icons hidden with a 1.6 stroke", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "folder" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('stroke-width="1.6"');
    expect(html).toContain('class="ic ic-md');
  });

  it("names labelled icons", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "verified", label: "Verified" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Verified"');
    expect(html).not.toContain("aria-hidden");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/components/ui/icons`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement.**

`apps/web/lib/cx.ts`:
```ts
/** Joins class names, dropping falsy parts. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
```

`apps/web/components/ui/icons.ts`:
```ts
import type { SourceKind } from "@mastertutor/contracts";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Captions,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Code,
  Columns2,
  Command,
  Download,
  Ellipsis,
  EyeOff,
  FileText,
  Files,
  Film,
  Fingerprint,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Gauge,
  Globe,
  Hash,
  Image,
  Inbox,
  Info,
  KeyRound,
  LayoutGrid,
  LibraryBig,
  Link,
  List,
  Lock,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquareCode,
  MonitorPlay,
  OctagonX,
  PenLine,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Settings,
  Sigma,
  Sparkles,
  SquarePen,
  StickyNote,
  Table,
  Timer,
  Trash2,
  TriangleAlert,
  Undo2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

/** The only place a glyph library is imported (spec §11.3). Names describe meaning, not shape. */
export const icons = {
  // navigation
  newTask: SquarePen,
  runs: Activity,
  library: LibraryBig,
  vault: LockKeyhole,
  settings: Settings,
  // source and type
  web: Globe,
  pdf: FileText,
  video: MonitorPlay,
  note: StickyNote,
  image: Image,
  table: Table,
  code: Code,
  math: Sigma,
  transcript: Captions,
  keyframe: Film,
  // folders
  folder: Folder,
  folderOpen: FolderOpen,
  folderNested: FolderTree,
  folderAdd: FolderPlus,
  unfiled: Inbox,
  allNotes: Files,
  // status
  verified: BadgeCheck,
  partial: CircleAlert,
  needsReview: TriangleAlert,
  edited: PenLine,
  agentNote: Sparkles,
  live: Activity,
  ok: CircleCheck,
  info: Info,
  sealed: Lock,
  session: Clock,
  // vault fields
  username: UserRound,
  password: KeyRound,
  totp: Timer,
  pin: Hash,
  emailOtp: Mail,
  codeOtp: MessageSquareCode,
  passkey: Fingerprint,
  imap: Inbox,
  hidden: EyeOff,
  // actions
  add: Plus,
  search: Search,
  command: Command,
  close: X,
  more: Ellipsis,
  move: FolderInput,
  delete: Trash2,
  export: Download,
  link: Link,
  external: ArrowUpRight,
  edit: Pencil,
  check: Check,
  undo: Undo2,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  back: ChevronLeft,
  grid: LayoutGrid,
  list: List,
  split: Columns2,
  signOut: LogOut,
  stop: OctagonX,
  usage: ChartColumn,
  audit: ScrollText,
  model: Bot,
  budget: Gauge,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export const SOURCE_KIND_ICON: Record<SourceKind, IconName> = { web: "web", pdf: "pdf", youtube: "video" };
```

`apps/web/components/ui/icon.tsx`:
```tsx
import { cx } from "@/lib/cx.ts";
import { icons, type IconName } from "./icons.ts";

export type { IconName } from "./icons.ts";
export type IconSize = "sm" | "md" | "lg" | "xl";

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** When set, the icon is meaningful on its own; otherwise it is decorative. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = "md", label, className }: IconProps) {
  const Glyph = icons[name];
  return (
    <Glyph
      className={cx("ic", `ic-${size}`, className)}
      strokeWidth={1.6}
      focusable="false"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
```

Append to `apps/web/styles/base.css`:
```css
.ic {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}
.ic-sm {
  width: 0.875rem;
  height: 0.875rem;
}
.ic-lg {
  width: 1.5rem;
  height: 1.5rem;
}
.ic-xl {
  width: 2.5rem;
  height: 2.5rem;
}
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/components/ui && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): typed Lucide icon registry and Icon component (letter tiles banned)"
```

---

### Task 5: Fixture backend (seed, store, router) and the folder-tree model

**Files:**
- Create: `apps/web/lib/folders/tree.ts`, `apps/web/lib/fixtures/{cookies,ids,assets,types,seed,store,router}.ts`
- Modify: `apps/web/package.json` (oRPC server)
- Test: `apps/web/lib/folders/tree.test.ts`, `apps/web/lib/fixtures/router.test.ts`

**Interfaces:**
- Consumes: `apiContract` and the DTOs and enums from `@mastertutor/contracts`; `DEFAULT_BUDGET`, `EMPTY_USAGE` and `MODELS`.
- Produces:
  - **`lib/folders/tree.ts`:**
    - `MAX_FOLDER_DEPTH = 8`;
    - `interface FolderNode { folder: FolderView; depth: number; children: FolderNode[] }`;
    - `buildFolderTree(folders)`, `folderPath(folders, id)`, `folderDepth(folders, id|null)`, `descendantIds(folders, id)`;
    - `canMoveFolder(folders, folderId, newParentId)`, `canCreateFolder(folders, parentId)`;
    - `flattenVisible(nodes, expanded)`, `flattenAll(nodes)`.
  - **`lib/fixtures/cookies.ts`:** `FIXTURE_NS_COOKIE = "mt_fixture_ns"`, `FIXTURE_AUTH_COOKIE = "mt_fixture_auth"`, `fixtureNamespaceFrom(cookieHeader: string | null): string`.
  - **`lib/fixtures/ids.ts`:** `ids.{folder,note,block,source,asset,vault,audit,run}(n)`, which return valid v4 UUIDs.
  - **`lib/fixtures/types.ts`:** `NoteRecord`, `FixtureState`, `FixtureContext { ns: string }`.
  - **`lib/fixtures/store.ts`:** `stateFor(ns): FixtureState`, `usageReport(runs, from, to): UsageReport`.
  - **`lib/fixtures/router.ts`:** `fixtureRouter`, which implements every `apiContract` procedure.
    - `notes.export` and the run/benchmark mutations throw `NOT_IMPLEMENTED`. Task 23 and F3 fill them in.
  - **Seed:**
    - 7 folders, 3 levels deep;
    - 10 notes, one of them `n10` with a 200-character unbroken title;
    - note `n1` with every block type;
    - 5 vault items, including a 63-character alias;
    - 60 audit rows;
    - 2 runs.

- [ ] **Step 1: Install the oRPC server.**

Run:
```bash
pnpm --filter @mastertutor/web add -E @mastertutor/contracts@workspace:* @orpc/server@1.15.4 @orpc/contract@1.15.4
```
(`@mastertutor/contracts` is already a dependency from Phase 0. `pnpm` keeps it unchanged.)

- [ ] **Step 2: Write the failing tests.**

`apps/web/lib/folders/tree.test.ts`:
```ts
import type { FolderView } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import {
  MAX_FOLDER_DEPTH,
  buildFolderTree,
  canCreateFolder,
  canMoveFolder,
  descendantIds,
  flattenVisible,
  folderDepth,
  folderPath,
} from "./tree.ts";

const f = (id: string, parentId: string | null, name = id, sort = 0): FolderView => ({ id, parentId, name, sort });
const folders = [f("a", null, "Alpha", 1), f("b", "a"), f("c", "b"), f("d", null, "Delta", 0)];

describe("folder tree", () => {
  it("builds a sorted tree with depths", () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((n) => n.folder.id)).toEqual(["d", "a"]);
    expect(tree[1]?.children[0]?.children[0]).toMatchObject({ depth: 3, folder: { id: "c" } });
  });

  it("finds paths and depths", () => {
    expect(folderPath(folders, "c").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(folderDepth(folders, "c")).toBe(3);
    expect(folderDepth(folders, null)).toBe(0);
    expect([...descendantIds(folders, "a")].sort()).toEqual(["a", "b", "c"]);
  });

  it("refuses moving a folder into itself or a descendant (Review Focus 4)", () => {
    expect(canMoveFolder(folders, "a", "a")).toBe(false);
    expect(canMoveFolder(folders, "a", "c")).toBe(false);
    expect(canMoveFolder(folders, "c", "d")).toBe(true);
    expect(canMoveFolder(folders, "b", null)).toBe(true);
  });

  it("refuses moves and creates past depth 8", () => {
    const chain = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => f(`l${i}`, i === 0 ? null : `l${i - 1}`));
    expect(canCreateFolder(chain, "l7")).toBe(false);
    expect(canCreateFolder(chain, "l6")).toBe(true);
    // Moving the a→b→c subtree (3 levels) under l5 (depth 6) would reach depth 9.
    expect(canMoveFolder([...chain, ...folders], "a", "l5")).toBe(false);
    expect(canMoveFolder([...chain, ...folders], "a", "l4")).toBe(true);
  });

  it("survives a corrupt cycle without looping", () => {
    const cyclic = [f("x", "y"), f("y", "x")];
    expect(folderPath(cyclic, "x").length).toBeLessThanOrEqual(2);
    expect(() => buildFolderTree(cyclic)).not.toThrow();
  });

  it("flattens only expanded branches", () => {
    const tree = buildFolderTree(folders);
    expect(flattenVisible(tree, new Set()).map((n) => n.folder.id)).toEqual(["d", "a"]);
    expect(flattenVisible(tree, new Set(["a"])).map((n) => n.folder.id)).toEqual(["d", "a", "b"]);
  });
});
```

`apps/web/lib/fixtures/router.test.ts`:
```ts
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { fixtureNamespaceFrom } from "./cookies.ts";
import { ids } from "./ids.ts";
import { fixtureRouter } from "./router.ts";
import { stateFor } from "./store.ts";

let counter = 0;
function client() {
  counter += 1;
  const ns = `test-${counter}`;
  return { ns, api: createRouterClient(fixtureRouter, { context: { ns } }) };
}

describe("fixture notes", () => {
  it("lists by folder, unfiled and kind, newest first, with pagination", async () => {
    const { api } = client();
    const all = await api.notes.list({ limit: 4 });
    expect(all.items).toHaveLength(4);
    expect(all.nextCursor).toBe("4");
    const unfiled = await api.notes.list({ folder: "unfiled" });
    expect(unfiled.items.every((n) => n.folderId === null)).toBe(true);
    const pdfs = await api.notes.list({ kind: "pdf" });
    expect(pdfs.items.map((n) => n.sourceKinds)).toEqual([["pdf"]]);
    const opt = await api.notes.list({ folder: ids.folder(2) });
    expect(opt.items.map((n) => n.title)).toContain("Learning-rate warmup, explained");
  });

  it("returns a rich note with ordered blocks of every captured type", async () => {
    const { api } = client();
    const detail = await api.notes.get({ noteId: ids.note(1) });
    const types = new Set(detail.blocks.map((b) => b.type));
    for (const type of ["heading", "paragraph", "list", "quote", "code", "table", "math", "image", "figure", "commentary"]) {
      expect(types.has(type as never), type).toBe(true);
    }
    const positions = detail.blocks.map((b) => b.position);
    expect([...positions].sort()).toEqual(positions);
  });

  it("searches block text and returns a snippet", async () => {
    const { api } = client();
    const { items } = await api.notes.search({ q: "grad_norm" });
    expect(items[0]).toMatchObject({ noteId: ids.note(1) });
    expect(items[0]?.snippet).toContain("grad_norm");
  });

  it("keeps the original on edit and flips fidelity when the last review clears", async () => {
    const { api } = client();
    const detail = await api.notes.get({ noteId: ids.note(1) });
    const para = detail.blocks.find((b) => b.type === "paragraph" && !b.edited);
    const edited = await api.notes.updateBlock({ blockId: para!.id, markdown: "Changed." });
    expect(edited).toMatchObject({ edited: true, markdown: "Changed.", originalMarkdown: para!.markdown });
    const review = detail.blocks.find((b) => !b.verified)!;
    expect((await api.notes.markVerified({ blockId: review.id })).verified).toBe(true);
    expect((await api.notes.get({ noteId: ids.note(1) })).note.fidelity).toBe("verified");
  });

  it("moves notes and records the user as filer", async () => {
    const { api } = client();
    await api.notes.move({ noteId: ids.note(1), folderId: null });
    const { note } = await api.notes.get({ noteId: ids.note(1) });
    expect(note).toMatchObject({ folderId: null, filedBy: "user" });
    await expect(api.notes.move({ noteId: ids.note(1), folderId: ids.folder(999) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("fixture folders", () => {
  it("rejects cycles, depth and duplicate names", async () => {
    const { api } = client();
    await expect(api.folders.move({ folderId: ids.folder(1), parentId: ids.folder(3) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(api.folders.create({ name: "optimization", parentId: ids.folder(1) })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("deletes a subtree and unfiles its notes", async () => {
    const { api } = client();
    await api.folders.delete({ folderId: ids.folder(1) });
    const { folders } = await api.folders.tree({});
    expect(folders.map((x) => x.id)).not.toContain(ids.folder(3));
    expect((await api.notes.get({ noteId: ids.note(1) })).note.folderId).toBeNull();
  });
});

describe("fixture vault (Review Focus 2)", () => {
  it("keeps field names only, never values, and audits the create", async () => {
    const { api, ns } = client();
    const canary = "canary-secret-7f3a9c";
    const item = await api.vault.create({
      alias: "canary",
      origin: "learn.example.edu",
      label: "Canary",
      secrets: { username: "someone@example.test", password: canary },
    });
    expect(item).toMatchObject({ origin: "https://learn.example.edu", fields: ["username", "password"] });
    expect(JSON.stringify(stateFor(ns))).not.toContain(canary);
    expect(JSON.stringify(item)).not.toContain(canary);
    const audit = await api.vault.audit({ limit: 1 });
    expect(audit.items[0]).toMatchObject({ alias: "canary", action: "create" });
  });

  it("rejects duplicate aliases", async () => {
    const { api } = client();
    await expect(
      api.vault.create({ alias: "github", origin: "https://github.com", label: "x", secrets: {} }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("forgets a saved session", async () => {
    const { api } = client();
    await api.vault.forgetSession({ alias: "github", origin: "https://github.com" });
    const { items } = await api.vault.list({});
    expect(items.find((i) => i.alias === "github")?.sessionSaved).toBe(false);
  });
});

describe("fixture settings and isolation", () => {
  it("toggles the kill switch per namespace only", async () => {
    const a = client();
    const b = client();
    expect((await a.api.settings.setKillSwitch({ on: true })).killSwitch).toBe(true);
    expect((await b.api.settings.get({})).killSwitch).toBe(false);
  });

  it("reports usage for every day in range", async () => {
    const { api } = client();
    const report = await api.settings.usage({ from: "2026-09-01", to: "2026-09-30" });
    expect(report.perDay).toHaveLength(30);
    expect(report.perDay[0]?.day).toBe("2026-09-01");
  });

  it("reads the namespace from the cookie header", () => {
    expect(fixtureNamespaceFrom("a=1; mt_fixture_ns=abc-123")).toBe("abc-123");
    expect(fixtureNamespaceFrom("mt_fixture_ns=../../x")).toBe("default");
    expect(fixtureNamespaceFrom(null)).toBe("default");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/folders apps/web/lib/fixtures`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement.**

`apps/web/lib/folders/tree.ts`:
```ts
import type { FolderView } from "@mastertutor/contracts";

/** Root folders are depth 1; spec §4 allows at most 8 levels. */
export const MAX_FOLDER_DEPTH = 8;

export interface FolderNode {
  folder: FolderView;
  depth: number;
  children: FolderNode[];
}

const byOrder = (a: FolderView, b: FolderView) => a.sort - b.sort || a.name.localeCompare(b.name);

export function buildFolderTree(folders: readonly FolderView[]): FolderNode[] {
  const childrenOf = new Map<string | null, FolderView[]>();
  for (const folder of folders) {
    const list = childrenOf.get(folder.parentId) ?? [];
    list.push(folder);
    childrenOf.set(folder.parentId, list);
  }
  const known = new Set(folders.map((f) => f.id));
  // Orphans (missing parent) surface at the root instead of disappearing.
  const roots = folders.filter((f) => f.parentId === null || !known.has(f.parentId));
  const build = (list: readonly FolderView[], depth: number, seen: ReadonlySet<string>): FolderNode[] =>
    [...list]
      .sort(byOrder)
      .filter((f) => !seen.has(f.id))
      .map((folder) => ({
        folder,
        depth,
        children: build(childrenOf.get(folder.id) ?? [], depth + 1, new Set([...seen, folder.id])),
      }));
  return build(roots, 1, new Set());
}

export function folderPath(folders: readonly FolderView[], id: string): FolderView[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderView[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function folderDepth(folders: readonly FolderView[], id: string | null): number {
  return id === null ? 0 : folderPath(folders, id).length;
}

export function descendantIds(folders: readonly FolderView[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId !== null && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        grew = true;
      }
    }
  }
  return result;
}

function subtreeHeight(folders: readonly FolderView[], id: string, seen: Set<string> = new Set()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const heights = folders.filter((f) => f.parentId === id).map((c) => subtreeHeight(folders, c.id, seen));
  return 1 + Math.max(0, ...heights);
}

export function canMoveFolder(
  folders: readonly FolderView[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId !== null && descendantIds(folders, folderId).has(newParentId)) return false;
  return folderDepth(folders, newParentId) + subtreeHeight(folders, folderId) <= MAX_FOLDER_DEPTH;
}

export function canCreateFolder(folders: readonly FolderView[], parentId: string | null): boolean {
  return folderDepth(folders, parentId) + 1 <= MAX_FOLDER_DEPTH;
}

export function flattenVisible(nodes: readonly FolderNode[], expanded: ReadonlySet<string>): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (list: readonly FolderNode[]) => {
    for (const node of list) {
      out.push(node);
      if (expanded.has(node.folder.id)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function flattenAll(nodes: readonly FolderNode[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (list: readonly FolderNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
```

`apps/web/lib/fixtures/cookies.ts`:
```ts
/** Test-only fixture backend cookies (WEB_FIXTURE_API=1). Each Playwright test gets its own namespace. */
export const FIXTURE_NS_COOKIE = "mt_fixture_ns";
export const FIXTURE_AUTH_COOKIE = "mt_fixture_auth";

const NAMESPACE = /^[A-Za-z0-9-]{1,64}$/;

export function fixtureNamespaceFrom(cookieHeader: string | null): string {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === FIXTURE_NS_COOKIE) {
      const value = rest.join("=");
      return NAMESPACE.test(value) ? value : "default";
    }
  }
  return "default";
}
```

`apps/web/lib/fixtures/ids.ts`:
```ts
/** Deterministic v4-shaped UUIDs: group digit + counter, e.g. folder 1 → 00000000-0000-4000-8000-000001000001. */
const make = (group: number) => (n: number) =>
  `00000000-0000-4000-8000-${(group * 1_000_000 + n).toString().padStart(12, "0")}`;

export const ids = {
  folder: make(1),
  note: make(2),
  block: make(3),
  source: make(4),
  asset: make(5),
  vault: make(6),
  audit: make(7),
  run: make(8),
} as const;
```

`apps/web/lib/fixtures/assets.ts`:
```ts
import { ids } from "./ids.ts";

/** Fixture images as inline SVG. Real assets come from Garage through assets.url in Phase 7. */
const svg = (body: string, w = 640, h = 360) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

const FIGURE = svg(
  `<rect width="640" height="360" fill="#f5f5f7"/><path d="M60 40v280h540" fill="none" stroke="#d2d2d7" stroke-width="2"/>` +
    `<path d="M60 320 L100 50 C260 50 380 120 470 200 S600 290 600 290" fill="none" stroke="#1d1d1f" stroke-width="3"/>` +
    `<circle cx="100" cy="50" r="6" fill="#c22914"/>`,
);
const TRAINING_LOG = svg(
  `<rect width="640" height="200" fill="#111"/><text x="24" y="60" fill="#c8e6c9" font-family="monospace" font-size="20">step 1399 | loss 2.871</text>` +
    `<text x="24" y="100" fill="#c8e6c9" font-family="monospace" font-size="20">step 1400 | loss 2.913 | grad_norm 1.2e+04</text>` +
    `<text x="24" y="140" fill="#c8e6c9" font-family="monospace" font-size="20">step 1401 | loss nan</text>`,
  640,
  200,
);
const KEYFRAME = svg(
  `<rect width="640" height="360" fill="#0e1116"/><path d="M80 290 C120 290 130 80 160 70 S220 250 260 260 S560 270 600 280" fill="none" stroke="#ff5533" stroke-width="4"/>`,
);
const FAVICON = svg(`<rect width="32" height="32" rx="8" fill="#1d1d1f"/><circle cx="16" cy="16" r="7" fill="#fafafa"/>`, 32, 32);

const toDataUri = (markup: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

export const FIXTURE_ASSETS: ReadonlyMap<string, string> = new Map([
  [ids.asset(1), toDataUri(FIGURE)],
  [ids.asset(2), toDataUri(TRAINING_LOG)],
  [ids.asset(3), toDataUri(KEYFRAME)],
  [ids.asset(4), toDataUri(FAVICON)],
]);
```

`apps/web/lib/fixtures/types.ts`:
```ts
import type {
  FolderView,
  NoteBlock,
  NoteSummary,
  RunSummary,
  SettingsView,
  SourceView,
  VaultAuditView,
  VaultItemView,
} from "@mastertutor/contracts";

export interface NoteRecord {
  note: NoteSummary;
  blocks: NoteBlock[];
  sources: SourceView[];
}

/** Mutable per-namespace state. Vault items hold field names only; values are never kept. */
export interface FixtureState {
  folders: FolderView[];
  notes: NoteRecord[];
  vault: VaultItemView[];
  audit: VaultAuditView[];
  settings: SettingsView;
  runs: RunSummary[];
}

export interface FixtureContext {
  ns: string;
}
```

`apps/web/lib/fixtures/seed.ts`:
```ts
import { createHash } from "node:crypto";
import {
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  MODELS,
  type Anchor,
  type BlockOrigin,
  type BlockType,
  type Fidelity,
  type FolderView,
  type NoteBlock,
  type RunStatus,
  type RunSummary,
  type SourceKind,
  type SourceView,
  type VaultAuditAction,
  type VaultAuditView,
  type VaultItemView,
  type VaultSecretField,
} from "@mastertutor/contracts";
import { ids } from "./ids.ts";
import type { FixtureState, NoteRecord } from "./types.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const at = (day: string, time = "17:00:00") => `${day}T${time}.000Z`;
const anchor = (partial: Partial<Anchor> = {}): Anchor => ({
  selector: null,
  xpath: null,
  start: null,
  end: null,
  textFragment: null,
  ...partial,
});

interface BlockSeed {
  type: BlockType;
  markdown: string;
  origin?: BlockOrigin;
  verified?: boolean;
  anchor?: Anchor | null;
  assetId?: string;
  edited?: { original: string };
}

let blockCounter = 0;
function blocks(noteId: string, sourceId: string, capturedAt: string, seeds: BlockSeed[]): NoteBlock[] {
  return seeds.map((seed, i) => {
    blockCounter += 1;
    const origin = seed.origin ?? "dom";
    return {
      id: ids.block(blockCounter),
      noteId,
      position: `a${String(i).padStart(4, "0")}`,
      type: seed.type,
      markdown: seed.markdown,
      assetId: seed.assetId ?? null,
      sourceId: origin === "model" ? null : sourceId,
      origin,
      anchor: origin === "model" ? null : (seed.anchor ?? anchor()),
      contentSha256: sha(seed.edited?.original ?? seed.markdown),
      verified: seed.verified ?? origin !== "ocr_model",
      edited: Boolean(seed.edited),
      originalMarkdown: seed.edited?.original ?? null,
      createdAt: capturedAt,
    };
  });
}

function source(n: number, kind: SourceKind, url: string, title: string, capturedAt: string, faviconAssetId: string | null = null): SourceView {
  return { id: ids.source(n), kind, url, canonicalUrl: url, origin: new URL(url).origin, title, faviconAssetId, capturedAt };
}

interface NoteSeed {
  n: number;
  title: string;
  lede: string | null;
  folderId: string | null;
  fidelity: Fidelity;
  coverage: number | null;
  createdAt: string;
  source: SourceView;
  blocks: BlockSeed[];
  runId?: string;
}

function note(seed: NoteSeed): NoteRecord {
  const noteId = ids.note(seed.n);
  return {
    note: {
      id: noteId,
      folderId: seed.folderId,
      title: seed.title,
      lede: seed.lede,
      fidelity: seed.fidelity,
      coverage: seed.coverage,
      filedBy: "agent",
      runId: seed.runId ?? null,
      sourceKinds: [seed.source.kind],
      createdAt: seed.createdAt,
      updatedAt: seed.createdAt,
    },
    blocks: blocks(noteId, seed.source.id, seed.source.capturedAt, seed.blocks),
    sources: [seed.source],
  };
}

const para = (markdown: string, fragment?: string): BlockSeed => ({
  type: "paragraph",
  markdown,
  anchor: anchor({ selector: "article > p", textFragment: fragment ?? markdown.slice(0, 40) }),
});

const WARMUP: BlockSeed[] = [
  para(
    "Training a transformer with Adam at its full learning rate from step zero often diverges within the first few thousand steps. Warmup, a short ramp from near-zero to the peak rate, is the cheapest fix we know.",
    "Training a transformer with Adam",
  ),
  { type: "heading", markdown: "## The update rule", anchor: anchor({ selector: "article > h2:nth-of-type(1)", textFragment: "The update rule" }) },
  para(
    "Adam scales each step by a running estimate of the gradient's second moment. Early in training that estimate rests on a handful of samples, so the effective step can be huge.",
  ),
  {
    type: "math",
    markdown: "$$\n\\theta_{t+1} = \\theta_t - \\eta_t \\cdot \\frac{\\hat m_t}{\\sqrt{\\hat v_t} + \\epsilon}\n$$",
    anchor: anchor({ selector: "article > math#eq-1" }),
  },
  { type: "heading", markdown: "## Common schedules" },
  {
    type: "table",
    markdown:
      "| Schedule | Warmup | Decay | Typical use |\n| --- | --- | --- | --- |\n| Linear + cosine | 2,000 steps | cosine to 10% of peak | LLM pretraining |\n| Inverse square root | 4,000 steps | ∝ 1/√t | Original Transformer (2017) |\n| Warmup-stable-decay | 1% of steps | linear, final 10% | Continual pretraining |\n| Constant | none | none | Small fine-tunes |",
    anchor: anchor({ selector: "article > table:nth-of-type(1)" }),
  },
  { type: "heading", markdown: "## In code" },
  {
    type: "code",
    markdown:
      "```python\nimport math\n\ndef lr_at(step, max_lr=3e-4, warmup=2_000, total=100_000):\n    if step < warmup:\n        return max_lr * step / warmup\n    progress = (step - warmup) / (total - warmup)\n    return max_lr * (0.1 + 0.45 * (1 + math.cos(math.pi * progress)))\n```",
    anchor: anchor({ selector: "article > pre:nth-of-type(1)" }),
  },
  {
    type: "figure",
    markdown: "**Figure 2.** Warmup, then cosine decay. The rate climbs linearly for 2,000 steps, then falls to 10% of its peak by step 100k.",
    assetId: ids.asset(1),
    anchor: anchor({ selector: "article > figure#fig-2" }),
  },
  { type: "image", markdown: "Training log screenshot", assetId: ids.asset(2), anchor: anchor({ selector: "article > img[alt='training_log.png']" }) },
  {
    type: "code",
    markdown: "```text\nstep 1399 | loss 2.871\nstep 1400 | loss 2.913 | grad_norm 1.2e+04\nstep 1401 | loss nan\n```",
    origin: "ocr_model",
  },
  {
    type: "paragraph",
    markdown: "**In practice:** warm up for about 1–2% of total steps, longer if you raise the batch size or the peak rate.",
    edited: {
      original: "In practice: warm up for about 1–2% of total steps. Go longer if you raise the batch size or the peak rate, as most papers do.",
    },
  },
  {
    type: "list",
    markdown:
      "- Ramp linearly; the exact shape matters less than the length.\n- Scale warmup with batch size.\n- Re-warm after loading a checkpoint with a fresh optimizer.",
  },
  { type: "quote", markdown: "> Every large run you've read about uses warmup, and almost nobody says why." },
  {
    type: "table",
    markdown:
      '<table><thead><tr><th>Run</th><th>Warmup</th><th>Result</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>0</td><td>diverged at 1.4k</td></tr><tr><td>2k</td><td>converged</td></tr></tbody></table>',
  },
  { type: "commentary", markdown: "The talk in *Why warmup works* shows the same NaN at step 1,401, live.", origin: "model" },
];

const TALK: BlockSeed[] = [
  { type: "heading", markdown: "## Why warmup exists", origin: "captions", anchor: anchor({ tStart: 0, tEnd: 192 }) },
  { type: "transcript", markdown: "Every large run you've read about uses it, and almost nobody says why.", origin: "captions", anchor: anchor({ tStart: 4, tEnd: 9 }) },
  { type: "heading", markdown: "## Adam's second moment at t = 1", origin: "captions", anchor: anchor({ tStart: 192, tEnd: 465 }) },
  {
    type: "transcript",
    markdown: "With one sample, the second-moment estimate is just the squared gradient, so the denominator is noise.",
    origin: "captions",
    anchor: anchor({ tStart: 198, tEnd: 206 }),
  },
  { type: "keyframe", markdown: "Loss curve with a spike at step 1,400", assetId: ids.asset(3), anchor: anchor({ tStart: 768, tEnd: 768 }) },
  { type: "transcript", markdown: "Here's the NaN at step 1,401, on screen.", origin: "asr", anchor: anchor({ tStart: 770, tEnd: 774 }) },
];

const pdfBlock = (markdown: string, page: number): BlockSeed => ({
  type: markdown.startsWith("#") ? "heading" : "paragraph",
  markdown,
  origin: "pdf",
  anchor: anchor({ page, bbox: { x: 72, y: 120, width: 468, height: 64 } }),
});

const LONG_TITLE =
  "Pneumonoultramicroscopicsilicovolcanoconiosis_and_other_unbroken_strings_that_must_never_push_the_layout_sideways_even_on_a_phone_" +
  "x".repeat(70);

function folders(): FolderView[] {
  const f = (n: number, name: string, parent: number | null, sort: number): FolderView => ({
    id: ids.folder(n),
    parentId: parent === null ? null : ids.folder(parent),
    name,
    sort,
  });
  return [
    f(1, "Machine learning", null, 0),
    f(2, "Optimization", 1, 0),
    f(3, "Schedulers", 2, 0),
    f(4, "Papers", 1, 1),
    f(5, "Databases", null, 1),
    f(6, "Coursework", null, 2),
    f(7, "EE 2310", 6, 0),
  ];
}

function notes(): NoteRecord[] {
  blockCounter = 0;
  const simple = (lines: string[]): BlockSeed[] => lines.map((line) => (line.startsWith("##") ? { type: "heading", markdown: line } : para(line)));
  return [
    note({
      n: 1,
      title: "Learning-rate warmup, explained",
      lede: "Why a short ramp at the start keeps Adam from diverging, and how long to make it.",
      folderId: ids.folder(2),
      fidelity: "needs_review",
      coverage: 0.99,
      createdAt: at("2026-10-05", "17:10:00"),
      runId: ids.run(2),
      source: source(1, "web", "https://fieldnotes.ml/posts/learning-rate-warmup", "Learning-rate warmup, explained", at("2026-10-05", "17:09:41"), ids.asset(4)),
      blocks: WARMUP,
    }),
    note({
      n: 2,
      title: "Why warmup works (talk)",
      lede: "Optimization Reading Group, 24 minutes, chaptered with keyframes.",
      folderId: ids.folder(2),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-10-05", "16:40:00"),
      source: source(2, "youtube", "https://www.youtube.com/watch?v=k3Wm9xTq2aE", "Why warmup works", at("2026-10-05", "16:39:00")),
      blocks: TALK,
    }),
    note({
      n: 3,
      title: "Attention Is All You Need",
      lede: "The original Transformer paper, text and figures from the PDF.",
      folderId: ids.folder(4),
      fidelity: "partial",
      coverage: 0.96,
      createdAt: at("2026-10-04"),
      source: source(3, "pdf", "https://arxiv.org/pdf/1706.03762", "Attention Is All You Need", at("2026-10-04")),
      blocks: [
        pdfBlock("## Abstract", 1),
        pdfBlock("The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.", 1),
        pdfBlock("## 3 Model Architecture", 2),
        pdfBlock("Most competitive neural sequence transduction models have an encoder-decoder structure.", 2),
      ],
    }),
    note({
      n: 4,
      title: "FOR UPDATE SKIP LOCKED",
      lede: "Queue-style row claiming in PostgreSQL.",
      folderId: ids.folder(5),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-10-03"),
      source: source(4, "web", "https://www.postgresql.org/docs/17/sql-select.html", "SELECT", at("2026-10-03")),
      blocks: simple(["## The locking clause", "With SKIP LOCKED, any selected rows that cannot be immediately locked are skipped."]),
    }),
    note({
      n: 5,
      title: "Postgres LISTEN/NOTIFY",
      lede: "Asynchronous notifications between sessions.",
      folderId: ids.folder(5),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-10-02"),
      source: source(5, "web", "https://www.postgresql.org/docs/17/sql-notify.html", "NOTIFY", at("2026-10-02")),
      blocks: simple(["## Payloads", "The payload must be shorter than 8000 bytes in the default configuration."]),
    }),
    note({
      n: 6,
      title: "Reading 1: Introduction to circuits",
      lede: "Charge, current and voltage, with the participation activities' key facts.",
      folderId: ids.folder(7),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-10-01"),
      source: source(6, "web", "https://learn.example.edu/book/ee2310/chapter/1/section/1", "1.1 Circuits", at("2026-10-01")),
      blocks: simple(["## Charge", "Charge is measured in coulombs.", "## Current", "Current is the rate of flow of charge."]),
    }),
    note({
      n: 7,
      title: "Cosine schedules in practice",
      lede: "Where the decay floor matters.",
      folderId: ids.folder(3),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-09-30"),
      source: source(7, "web", "https://fieldnotes.ml/posts/cosine-schedules", "Cosine schedules", at("2026-09-30")),
      blocks: simple(["Cosine decay to 10% of peak is a safe default."]),
    }),
    note({
      n: 8,
      title: "Unfiled clipping",
      lede: "A page the agent could not place.",
      folderId: null,
      fidelity: "partial",
      coverage: 0.9,
      createdAt: at("2026-09-29"),
      source: source(8, "web", "https://example.org/clipping", "Clipping", at("2026-09-29")),
      blocks: simple(["Only part of this page could be verified."]),
    }),
    note({
      n: 9,
      title: "Kirchhoff's laws (lecture)",
      lede: "Lecture video with captions checked against audio.",
      folderId: ids.folder(7),
      fidelity: "needs_review",
      coverage: 0.99,
      createdAt: at("2026-09-28"),
      source: source(9, "youtube", "https://www.youtube.com/watch?v=Kirchhoff01", "Kirchhoff's laws", at("2026-09-28")),
      blocks: [{ type: "transcript", markdown: "The sum of currents into a node is zero.", origin: "asr", verified: false, anchor: anchor({ tStart: 61, tEnd: 66 }) }],
    }),
    note({
      n: 10,
      title: LONG_TITLE,
      lede: "https://a-really-long-subdomain-name-for-testing.example-university.edu/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all",
      folderId: null,
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-09-27"),
      source: source(10, "web", "https://a-really-long-subdomain-name-for-testing.example-university.edu/a/very/long/path/that/keeps/going", LONG_TITLE, at("2026-09-27")),
      blocks: [
        para(`Unbroken: ${"averyveryverylongwordwithoutanybreaks".repeat(6)}`),
        { type: "code", markdown: `\`\`\`text\n${"x".repeat(240)}\n\`\`\`` },
        { type: "table", markdown: `| ${Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`).join(" | ")} |\n| ${Array.from({ length: 12 }, () => "---").join(" | ")} |\n| ${Array.from({ length: 12 }, (_, i) => `value-${i + 1}-longish`).join(" | ")} |` },
      ],
    }),
  ];
}

function vault(): VaultItemView[] {
  const item = (n: number, alias: string, origin: string, label: string, fields: VaultSecretField[], hasImap: boolean, sessionSaved: boolean): VaultItemView => ({
    id: ids.vault(n),
    alias,
    origin,
    label,
    fields,
    hasImap,
    sessionSaved,
    createdAt: at("2026-09-20"),
  });
  return [
    item(1, "github", "https://github.com", "GitHub", ["username", "password", "totp"], false, true),
    item(2, "uni-portal", "https://portal.example.edu", "University portal", ["username", "pin"], false, false),
    item(3, "jstor", "https://www.jstor.org", "JSTOR", ["username", "password", "imap_password"], true, false),
    item(4, "medium", "https://medium.com", "Medium", ["passkey"], false, true),
    item(
      5,
      "a-very-long-alias-for-layout-testing-0123456789-abcdefghijklmnop",
      "https://a-really-long-subdomain-name-for-testing.example-university.edu",
      "Long names",
      ["username", "password"],
      false,
      false,
    ),
  ];
}

function audit(): VaultAuditView[] {
  const actions: VaultAuditAction[] = ["fill", "fill", "create", "update", "passkey", "otp_received", "denied", "delete"];
  const aliases = ["github", "uni-portal", "jstor", "medium"];
  const fields = ["password", "username", null, "pin", null, "otp", "password", null];
  return Array.from({ length: 60 }, (_, i) => {
    const action = actions[i % actions.length] ?? "fill";
    const alias = aliases[i % aliases.length] ?? "github";
    const minutes = String(59 - (i % 60)).padStart(2, "0");
    return {
      id: ids.audit(i + 1),
      alias,
      origin: alias === "github" ? "https://github.com" : null,
      field: fields[i % fields.length] ?? null,
      action,
      runId: action === "fill" || action === "denied" ? ids.run(1) : null,
      approvedBy: action === "fill" ? "Sam Lee" : null,
      outcome: action === "denied" ? "origin mismatch" : "ok",
      at: `2026-10-${String(5 - Math.floor(i / 20)).padStart(2, "0")}T16:${minutes}:00.000Z`,
    };
  });
}

function runs(): RunSummary[] {
  const run = (n: number, goal: string, status: RunStatus, usd: number, steps: number, createdAt: string, finishedAt: string | null, noteId: string | null): RunSummary => ({
    id: ids.run(n),
    goal,
    status,
    waitReason: null,
    controller: "agent",
    approvalMode: "ask",
    model: MODELS.agentPrimary,
    noteId,
    usage: { ...EMPTY_USAGE, steps, usd },
    budget: DEFAULT_BUDGET,
    createdAt,
    finishedAt,
  });
  return [
    run(1, "Take notes on week 3 of the ML course, every lecture, figure and table", "running", 0.84, 23, at("2026-10-05", "16:55:00"), null, null),
    run(2, "Capture the learning-rate warmup article verbatim", "completed", 1.12, 41, at("2026-10-05", "17:00:00"), at("2026-10-05", "17:10:00"), ids.note(1)),
  ];
}

export function createSeed(): FixtureState {
  return {
    folders: folders(),
    notes: notes(),
    vault: vault(),
    audit: audit(),
    settings: { killSwitch: false, defaultBudget: DEFAULT_BUDGET, defaultAllowedOrigins: [], concurrency: 6 },
    runs: runs(),
  };
}
```

`apps/web/lib/fixtures/store.ts`:
```ts
import type { RunSummary, UsageReport } from "@mastertutor/contracts";
import { createSeed } from "./seed.ts";
import type { FixtureState } from "./types.ts";

const MAX_NAMESPACES = 500;
const states = new Map<string, FixtureState>();

/** One seeded state per namespace (per Playwright test), created lazily, oldest evicted first. */
export function stateFor(ns: string): FixtureState {
  let state = states.get(ns);
  if (!state) {
    if (states.size >= MAX_NAMESPACES) {
      const oldest = states.keys().next().value;
      if (oldest !== undefined) states.delete(oldest);
    }
    state = createSeed();
    states.set(ns, state);
  }
  return state;
}

const hash = (text: string) => {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Deterministic usage for any date range so charts look real in fixture mode. */
export function usageReport(runs: readonly RunSummary[], from: string, to: string): UsageReport {
  const perDay: UsageReport["perDay"] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (const d = new Date(`${from}T00:00:00Z`); d <= end && perDay.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const h = hash(day);
    const count = h % 5;
    perDay.push({ day, runs: count, usd: Math.round(count * (0.6 + (h % 70) / 100) * 100) / 100, steps: count * (18 + (h % 40)) });
  }
  return {
    perDay,
    perRun: runs.map((r) => ({ runId: r.id, goal: r.goal, status: r.status, usd: r.usage.usd, steps: r.usage.steps })),
    stepLatencyMs: { p50: 840, p95: 2310 },
    openaiErrorRate: 0.012,
  };
}
```

`apps/web/lib/fixtures/router.ts`:
```ts
import {
  TYPED_SECRET_FIELDS,
  apiContract,
  type NoteBlock,
  type RunDetail,
  type VaultAuditView,
} from "@mastertutor/contracts";
import { ORPCError, implement } from "@orpc/server";
import { canCreateFolder, canMoveFolder, descendantIds } from "../folders/tree.ts";
import { FIXTURE_ASSETS } from "./assets.ts";
import { stateFor, usageReport } from "./store.ts";
import type { FixtureContext, FixtureState, NoteRecord } from "./types.ts";

const os = implement(apiContract).$context<FixtureContext>();

const now = () => new Date().toISOString();
const notFound = (what: string) => new ORPCError("NOT_FOUND", { message: `${what} not found` });
const notImplemented = (): never => {
  throw new ORPCError("NOT_IMPLEMENTED", { message: "Not available in fixture mode yet." });
};

function paginate<T>(items: readonly T[], input: { limit: number; cursor: string | null }) {
  const start = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
  const end = start + input.limit;
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
}

function findBlock(state: FixtureState, blockId: string): { record: NoteRecord; block: NoteBlock } {
  for (const record of state.notes) {
    const block = record.blocks.find((b) => b.id === blockId);
    if (block) return { record, block };
  }
  throw notFound("Block");
}

function findNote(state: FixtureState, noteId: string): NoteRecord {
  const record = state.notes.find((r) => r.note.id === noteId);
  if (!record) throw notFound("Note");
  return record;
}

function assertFolder(state: FixtureState, folderId: string | null): void {
  if (folderId !== null && !state.folders.some((f) => f.id === folderId)) throw notFound("Folder");
}

function assertUniqueName(state: FixtureState, parentId: string | null, name: string, exceptId?: string): void {
  const clash = state.folders.some(
    (f) => f.parentId === parentId && f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) throw new ORPCError("CONFLICT", { message: "A folder with that name already exists here." });
}

function snippetAround(markdown: string, q: string): string {
  const plain = markdown.replace(/[#*_`>|$\\]/g, "").replace(/\s+/g, " ").trim();
  const index = plain.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return plain.slice(0, 140);
  const start = Math.max(0, index - 60);
  const end = Math.min(plain.length, index + q.length + 80);
  return `${start > 0 ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}

function appendAudit(state: FixtureState, entry: Omit<VaultAuditView, "id" | "at" | "runId" | "approvedBy">): void {
  state.audit.unshift({ ...entry, id: crypto.randomUUID(), at: now(), runId: null, approvedBy: null });
}

export const fixtureRouter = os.router({
  runs: {
    create: os.runs.create.handler(notImplemented),
    list: os.runs.list.handler(({ input, context }) => {
      const runs = stateFor(context.ns).runs.filter((r) => input.status === null || r.status === input.status);
      return paginate(runs, input);
    }),
    get: os.runs.get.handler(({ input, context }): RunDetail => {
      const run = stateFor(context.ns).runs.find((r) => r.id === input.runId);
      if (!run) throw notFound("Run");
      return { ...run, plan: null, allowedOrigins: [], currentUrl: null, slotName: null, targetFolderId: null, pendingApprovals: [], lastEventId: null };
    }),
    steps: os.runs.steps.handler(() => ({ items: [] })),
    cancel: os.runs.cancel.handler(notImplemented),
    resume: os.runs.resume.handler(notImplemented),
    sendMessage: os.runs.sendMessage.handler(notImplemented),
    decideApproval: os.runs.decideApproval.handler(notImplemented),
    submitOtp: os.runs.submitOtp.handler(notImplemented),
    takeControl: os.runs.takeControl.handler(notImplemented),
    handBack: os.runs.handBack.handler(notImplemented),
    openLive: os.runs.openLive.handler(notImplemented),
  },
  notes: {
    list: os.notes.list.handler(({ input, context }) => {
      const notes = stateFor(context.ns)
        .notes.map((r) => r.note)
        .filter((n) =>
          input.folder === "all" ? true : input.folder === "unfiled" ? n.folderId === null : n.folderId === input.folder,
        )
        .filter((n) => input.kind === null || n.sourceKinds.includes(input.kind))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title));
      return paginate(notes, input);
    }),
    get: os.notes.get.handler(({ input, context }) => {
      const record = findNote(stateFor(context.ns), input.noteId);
      return {
        note: record.note,
        blocks: [...record.blocks].sort((a, b) => a.position.localeCompare(b.position)),
        sources: record.sources,
      };
    }),
    updateBlock: os.notes.updateBlock.handler(({ input, context }) => {
      const { record, block } = findBlock(stateFor(context.ns), input.blockId);
      if (!block.edited) block.originalMarkdown = block.markdown;
      block.markdown = input.markdown;
      block.edited = true;
      record.note.updatedAt = now();
      return { ...block };
    }),
    markVerified: os.notes.markVerified.handler(({ input, context }) => {
      const { record, block } = findBlock(stateFor(context.ns), input.blockId);
      block.verified = true;
      if (record.note.fidelity === "needs_review" && record.blocks.every((b) => b.verified)) {
        record.note.fidelity = (record.note.coverage ?? 1) >= 0.98 ? "verified" : "partial";
      }
      record.note.updatedAt = now();
      return { ...block };
    }),
    move: os.notes.move.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      assertFolder(state, input.folderId);
      const record = findNote(state, input.noteId);
      record.note.folderId = input.folderId;
      record.note.filedBy = "user";
      record.note.updatedAt = now();
      return { ok: true as const };
    }),
    delete: os.notes.delete.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      findNote(state, input.noteId);
      state.notes = state.notes.filter((r) => r.note.id !== input.noteId);
      return { ok: true as const };
    }),
    export: os.notes.export.handler(notImplemented),
    search: os.notes.search.handler(({ input, context }) => {
      const q = input.q.toLowerCase();
      const hits: Array<{ noteId: string; blockId: string | null; title: string; snippet: string; score: number }> = [];
      for (const record of stateFor(context.ns).notes) {
        if (input.kind !== null && !record.note.sourceKinds.includes(input.kind)) continue;
        const titleMatch = record.note.title.toLowerCase().includes(q);
        const blockHits = record.blocks.filter((b) => b.markdown.toLowerCase().includes(q));
        for (const block of blockHits) {
          hits.push({ noteId: record.note.id, blockId: block.id, title: record.note.title, snippet: snippetAround(block.markdown, input.q), score: titleMatch ? 2 : 1 });
        }
        if (titleMatch && blockHits.length === 0) {
          hits.push({ noteId: record.note.id, blockId: null, title: record.note.title, snippet: record.note.lede ?? "", score: 2 });
        }
      }
      return { items: hits.sort((a, b) => b.score - a.score).slice(0, input.limit) };
    }),
  },
  folders: {
    tree: os.folders.tree.handler(({ context }) => ({ folders: [...stateFor(context.ns).folders] })),
    create: os.folders.create.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      assertFolder(state, input.parentId);
      if (!canCreateFolder(state.folders, input.parentId)) {
        throw new ORPCError("BAD_REQUEST", { message: "Folders can nest at most 8 levels." });
      }
      assertUniqueName(state, input.parentId, input.name);
      const siblings = state.folders.filter((f) => f.parentId === input.parentId);
      const folder = { id: crypto.randomUUID(), parentId: input.parentId, name: input.name, sort: siblings.length };
      state.folders.push(folder);
      return folder;
    }),
    rename: os.folders.rename.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const folder = state.folders.find((f) => f.id === input.folderId);
      if (!folder) throw notFound("Folder");
      assertUniqueName(state, folder.parentId, input.name, folder.id);
      folder.name = input.name;
      return { ...folder };
    }),
    move: os.folders.move.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const folder = state.folders.find((f) => f.id === input.folderId);
      if (!folder) throw notFound("Folder");
      assertFolder(state, input.parentId);
      if (!canMoveFolder(state.folders, input.folderId, input.parentId)) {
        throw new ORPCError("BAD_REQUEST", { message: "A folder can't move into itself or deeper than 8 levels." });
      }
      assertUniqueName(state, input.parentId, folder.name, folder.id);
      folder.parentId = input.parentId;
      return { ...folder };
    }),
    delete: os.folders.delete.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      if (!state.folders.some((f) => f.id === input.folderId)) throw notFound("Folder");
      const removed = descendantIds(state.folders, input.folderId);
      state.folders = state.folders.filter((f) => !removed.has(f.id));
      for (const record of state.notes) {
        if (record.note.folderId !== null && removed.has(record.note.folderId)) record.note.folderId = null;
      }
      return { ok: true as const };
    }),
  },
  vault: {
    list: os.vault.list.handler(({ context }) => ({ items: [...stateFor(context.ns).vault] })),
    create: os.vault.create.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      if (state.vault.some((i) => i.alias === input.alias)) {
        throw new ORPCError("CONFLICT", { message: "That alias is already used." });
      }
      // Values are discarded here; the fixture stores which fields exist, never what they are.
      const fields = TYPED_SECRET_FIELDS.filter((field) => input.secrets[field] !== undefined);
      const item = { id: crypto.randomUUID(), alias: input.alias, origin: input.origin, label: input.label, fields, hasImap: input.imap !== null, sessionSaved: false, createdAt: now() };
      state.vault.push(item);
      appendAudit(state, { alias: item.alias, origin: item.origin, field: null, action: "create", outcome: "ok" });
      return item;
    }),
    setSecret: os.vault.setSecret.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const item = state.vault.find((i) => i.id === input.itemId);
      if (!item) throw notFound("Sign-in");
      if (!item.fields.includes(input.field)) item.fields = [...item.fields, input.field];
      appendAudit(state, { alias: item.alias, origin: item.origin, field: input.field, action: "update", outcome: "ok" });
      return { ok: true as const };
    }),
    removeSecret: os.vault.removeSecret.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const item = state.vault.find((i) => i.id === input.itemId);
      if (!item) throw notFound("Sign-in");
      item.fields = item.fields.filter((f) => f !== input.field);
      appendAudit(state, { alias: item.alias, origin: item.origin, field: input.field, action: "update", outcome: "removed" });
      return { ok: true as const };
    }),
    delete: os.vault.delete.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const item = state.vault.find((i) => i.id === input.itemId);
      if (!item) throw notFound("Sign-in");
      state.vault = state.vault.filter((i) => i.id !== input.itemId);
      appendAudit(state, { alias: item.alias, origin: item.origin, field: null, action: "delete", outcome: "ok" });
      return { ok: true as const };
    }),
    forgetSession: os.vault.forgetSession.handler(({ input, context }) => {
      const item = stateFor(context.ns).vault.find((i) => i.alias === input.alias && i.origin === input.origin);
      if (!item) throw notFound("Session");
      item.sessionSaved = false;
      return { ok: true as const };
    }),
    audit: os.vault.audit.handler(({ input, context }) =>
      paginate([...stateFor(context.ns).audit].sort((a, b) => b.at.localeCompare(a.at)), input),
    ),
  },
  settings: {
    get: os.settings.get.handler(({ context }) => ({ ...stateFor(context.ns).settings })),
    update: os.settings.update.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      if (input.concurrency !== undefined && input.concurrency > 6) {
        throw new ORPCError("BAD_REQUEST", { message: "Concurrency can't exceed the browser slots." });
      }
      state.settings = {
        ...state.settings,
        ...(input.defaultBudget ? { defaultBudget: input.defaultBudget } : {}),
        ...(input.defaultAllowedOrigins ? { defaultAllowedOrigins: input.defaultAllowedOrigins } : {}),
        ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
      };
      return { ...state.settings };
    }),
    setKillSwitch: os.settings.setKillSwitch.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      state.settings = { ...state.settings, killSwitch: input.on };
      return { ...state.settings };
    }),
    usage: os.settings.usage.handler(({ input, context }) => usageReport(stateFor(context.ns).runs, input.from, input.to)),
  },
  assets: {
    url: os.assets.url.handler(({ input }) => {
      const url = FIXTURE_ASSETS.get(input.assetId);
      if (!url) throw notFound("Asset");
      return { url, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
    }),
  },
  benchmarks: {
    list: os.benchmarks.list.handler(() => ({ items: [] })),
    create: os.benchmarks.create.handler(notImplemented),
    start: os.benchmarks.start.handler(notImplemented),
    runs: os.benchmarks.runs.handler(() => ({ items: [] })),
    grade: os.benchmarks.grade.handler(notImplemented),
  },
});
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/folders apps/web/lib/fixtures && pnpm typecheck && pnpm lint`
Expected: PASS. oRPC validates every output against the contract, so a seed that breaks a schema fails here.

- [ ] **Step 6: Commit.**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): fixture backend implementing apiContract with seeded folders, notes, vault, audit, usage"
```

---

### Task 6: API wiring (fixture flag, `/api/rpc`, live stub, typed client, query provider)

**Files:**
- Modify: `packages/contracts/src/env.ts`, `apps/web/app/providers.tsx`, `apps/web/package.json`
- Create: `apps/web/lib/server/viewer.ts`, `apps/web/lib/server/rpc/live-router.ts`, `apps/web/app/api/rpc/[[...rest]]/route.ts`, `apps/web/lib/api/client.ts`, `apps/web/lib/api/errors.ts`
- Test: `packages/contracts/src/env-fixture.test.ts`, `tests/compose/no-fixture-api.test.ts`, `apps/web/lib/api/errors.test.ts`

**Interfaces:**
- Consumes: `WebEnv`, `getWebEnv`, `getAuth` (Phase 0); `fixtureRouter`, `fixtureNamespaceFrom` and `FIXTURE_AUTH_COOKIE` (Task 5).
- Produces:
  - **`WebEnv.WEB_FIXTURE_API: boolean`**, default `false`.
  - **`lib/server/viewer.ts`:** `interface Viewer { id; name; email }`, `FIXTURE_VIEWER`, `getViewer(): Promise<Viewer | null>`.
  - **`lib/server/rpc/live-router.ts`:** `liveRouter`, which implements every procedure as `NOT_IMPLEMENTED`, and `LiveContext { viewer }`. **Phase 7 and B2/B3/B6 replace these per namespace.**
  - **Route:** `GET`/`POST /api/rpc/*` serves the fixture router when the flag is on. Otherwise it serves `liveRouter` behind a session (401 without one).
  - **`lib/api/client.ts`:** `api` (`ContractRouterClient<ApiContract>`) and `orpc` (TanStack Query utilities).
  - **`lib/api/errors.ts`:** `errorCopy(error, fallback?)`. It never echoes server messages or input.
  - **`<Providers>`:** QueryClient (staleTime 30 s, retry 1, no refetch on focus) plus MotionProvider.

- [ ] **Step 1: Install.**

Run:
```bash
pnpm --filter @mastertutor/web add -E @orpc/client@1.15.4 @orpc/tanstack-query@1.15.4 @tanstack/react-query@5.104.1
```

- [ ] **Step 2: Write the failing tests.**

`packages/contracts/src/env-fixture.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { WebEnv, parseEnv } from "./env.ts";

const web = {
  DATABASE_URL: "postgres://web:pw@postgres:5432/mastertutor",
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  VAULT_PUBLIC_KEY: "y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=",
  NEKO_MEMBER_SECRET: "neko-member-secret-for-tests-0123456789",
  LIVE_COOKIE_SECRET: "live-cookie-secret-for-tests-0123456789",
  TURN_SECRET: "turn-secret-for-tests-0123456789abcdef",
  OPENAI_EMBEDDINGS_KEY: "sk-test",
  S3_ENDPOINT: "http://garage:3900",
  S3_ACCESS_KEY_ID: "GK66316f1f1bd64a571eb1b439",
  S3_SECRET_ACCESS_KEY: "16b2df8b12b3996e4916bd7de64631b3aa2704355137354988fcc6ac4cb1ab82",
};

describe("WEB_FIXTURE_API", () => {
  it("is off unless explicitly enabled", () => {
    expect(parseEnv(WebEnv, web).WEB_FIXTURE_API).toBe(false);
    expect(parseEnv(WebEnv, { ...web, WEB_FIXTURE_API: "1" }).WEB_FIXTURE_API).toBe(true);
  });
});
```

`tests/compose/no-fixture-api.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deployment files", () => {
  it.each(["compose.yml", "compose.test.yml", ".env.example"])("%s never enables the fixture API", (file) => {
    expect(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")).not.toContain("WEB_FIXTURE_API");
  });
});
```

`apps/web/lib/api/errors.test.ts`:
```ts
import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { errorCopy } from "./errors.ts";

describe("errorCopy", () => {
  it("maps codes to fixed copy and never echoes the server message", () => {
    const err = new ORPCError("CONFLICT", { message: "alias hunter2 is taken" });
    expect(errorCopy(err)).toBe("That name is already taken.");
    expect(errorCopy(err)).not.toContain("hunter2");
  });
  it("falls back for unknown errors", () => {
    expect(errorCopy(new Error("boom secret"), "Couldn't save.")).toBe("Couldn't save.");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm test -- env-fixture no-fixture-api apps/web/lib/api`
Expected: FAIL. The flag is undefined, and `errors.ts` is missing.

- [ ] **Step 4: Implement.**

In `packages/contracts/src/env.ts`, add this as the last key of `WebEnv`, after `...S3Access`:
```ts
  /** Test-only: serve the in-memory fixture API (apps/web/lib/fixtures). Never set in compose files. */
  WEB_FIXTURE_API: Flag,
```

`apps/web/lib/server/viewer.ts`:
```ts
import { cookies, headers } from "next/headers";
import { FIXTURE_AUTH_COOKIE } from "../fixtures/cookies.ts";
import { getAuth } from "./auth.ts";
import { getWebEnv } from "./env.ts";

export interface Viewer {
  id: string;
  name: string;
  email: string;
}

export const FIXTURE_VIEWER: Viewer = { id: "fixture-user", name: "Sam Lee", email: "sam@example.test" };

/** The signed-in user, or null. Fixture mode signs in a fixed user unless the test sets "signed-out". */
export async function getViewer(): Promise<Viewer | null> {
  if (getWebEnv().WEB_FIXTURE_API) {
    const jar = await cookies();
    return jar.get(FIXTURE_AUTH_COOKIE)?.value === "signed-out" ? null : FIXTURE_VIEWER;
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null;
}
```

`apps/web/lib/server/rpc/live-router.ts`:
```ts
import { apiContract } from "@mastertutor/contracts";
import { ORPCError, implement } from "@orpc/server";
import type { Viewer } from "../viewer.ts";

export interface LiveContext {
  viewer: Viewer;
}

const os = implement(apiContract).$context<LiveContext>();

/** Phase 7 (with B2, B3 and B6) replaces these handlers, one namespace at a time, with DB-backed ones. */
const notWired = (): never => {
  throw new ORPCError("NOT_IMPLEMENTED", { message: "This endpoint is not wired to the backend yet." });
};

export const liveRouter = os.router({
  runs: {
    create: os.runs.create.handler(notWired),
    list: os.runs.list.handler(notWired),
    get: os.runs.get.handler(notWired),
    steps: os.runs.steps.handler(notWired),
    cancel: os.runs.cancel.handler(notWired),
    resume: os.runs.resume.handler(notWired),
    sendMessage: os.runs.sendMessage.handler(notWired),
    decideApproval: os.runs.decideApproval.handler(notWired),
    submitOtp: os.runs.submitOtp.handler(notWired),
    takeControl: os.runs.takeControl.handler(notWired),
    handBack: os.runs.handBack.handler(notWired),
    openLive: os.runs.openLive.handler(notWired),
  },
  notes: {
    list: os.notes.list.handler(notWired),
    get: os.notes.get.handler(notWired),
    updateBlock: os.notes.updateBlock.handler(notWired),
    markVerified: os.notes.markVerified.handler(notWired),
    move: os.notes.move.handler(notWired),
    delete: os.notes.delete.handler(notWired),
    export: os.notes.export.handler(notWired),
    search: os.notes.search.handler(notWired),
  },
  folders: {
    tree: os.folders.tree.handler(notWired),
    create: os.folders.create.handler(notWired),
    rename: os.folders.rename.handler(notWired),
    move: os.folders.move.handler(notWired),
    delete: os.folders.delete.handler(notWired),
  },
  vault: {
    list: os.vault.list.handler(notWired),
    create: os.vault.create.handler(notWired),
    setSecret: os.vault.setSecret.handler(notWired),
    removeSecret: os.vault.removeSecret.handler(notWired),
    delete: os.vault.delete.handler(notWired),
    forgetSession: os.vault.forgetSession.handler(notWired),
    audit: os.vault.audit.handler(notWired),
  },
  settings: {
    get: os.settings.get.handler(notWired),
    update: os.settings.update.handler(notWired),
    setKillSwitch: os.settings.setKillSwitch.handler(notWired),
    usage: os.settings.usage.handler(notWired),
  },
  assets: { url: os.assets.url.handler(notWired) },
  benchmarks: {
    list: os.benchmarks.list.handler(notWired),
    create: os.benchmarks.create.handler(notWired),
    start: os.benchmarks.start.handler(notWired),
    runs: os.benchmarks.runs.handler(notWired),
    grade: os.benchmarks.grade.handler(notWired),
  },
});
```

`apps/web/app/api/rpc/[[...rest]]/route.ts`:
```ts
import { RPCHandler } from "@orpc/server/fetch";
import type { FixtureContext } from "@/lib/fixtures/types.ts";
import { getWebEnv } from "@/lib/server/env.ts";
import type { LiveContext } from "@/lib/server/rpc/live-router.ts";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

const PREFIX = "/api/rpc";
let fixtureHandler: RPCHandler<FixtureContext> | undefined;
let liveHandler: RPCHandler<LiveContext> | undefined;

async function handle(request: Request): Promise<Response> {
  if (getWebEnv().WEB_FIXTURE_API) {
    const { fixtureRouter } = await import("@/lib/fixtures/router.ts");
    const { fixtureNamespaceFrom } = await import("@/lib/fixtures/cookies.ts");
    fixtureHandler ??= new RPCHandler(fixtureRouter);
    const { response } = await fixtureHandler.handle(request, {
      prefix: PREFIX,
      context: { ns: fixtureNamespaceFrom(request.headers.get("cookie")) },
    });
    return response ?? new Response("Not found", { status: 404 });
  }
  const viewer = await getViewer();
  if (!viewer) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const { liveRouter } = await import("@/lib/server/rpc/live-router.ts");
  liveHandler ??= new RPCHandler(liveRouter);
  const { response } = await liveHandler.handle(request, { prefix: PREFIX, context: { viewer } });
  return response ?? new Response("Not found", { status: 404 });
}

export const GET = handle;
export const POST = handle;
```

`apps/web/lib/api/client.ts`:
```ts
import type { ApiContract } from "@mastertutor/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

const link = new RPCLink({ url: () => `${window.location.origin}/api/rpc` });

/** Typed client for every apiContract procedure. Call directly for secret-bearing requests. */
export const api: ContractRouterClient<ApiContract> = createORPCClient(link);

/** TanStack Query helpers: orpc.notes.list.queryOptions({ input }), orpc.notes.key(), … */
export const orpc = createTanstackQueryUtils(api);
```

`apps/web/lib/api/errors.ts`:
```ts
const COPY: Record<string, string> = {
  BAD_REQUEST: "Check the highlighted fields and try again.",
  UNAUTHORIZED: "Your session ended. Sign in again.",
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "This item no longer exists.",
  CONFLICT: "That name is already taken.",
  TOO_MANY_REQUESTS: "Too many requests. Wait a moment and try again.",
  NOT_IMPLEMENTED: "This isn't available yet.",
};

/** User-facing copy for an API error. Server messages are never shown: they may echo input. */
export function errorCopy(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return COPY[error.code] ?? fallback;
  }
  return fallback;
}
```

`apps/web/app/providers.tsx` (replace the file):
```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MotionProvider } from "@/components/motion/motion-provider.tsx";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MotionProvider>{children}</MotionProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 5: Run the tests and the build to verify they pass.**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @mastertutor/web build`
Expected: PASS. The build lists `/api/rpc/[[...rest]]` as dynamic (ƒ).

- [ ] **Step 6: Commit.**

```bash
git add packages/contracts apps/web tests/compose pnpm-lock.yaml
git commit -m "feat(web): /api/rpc with fixture router behind WEB_FIXTURE_API, live stub router, typed oRPC + TanStack client"
```

---

### Task 7: Playwright harness, layout QA, axe, and the design-system page

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/helpers/{breakpoints,layout-qa,a11y,test}.ts`, `apps/web/e2e/layout-qa.spec.ts`, `apps/web/e2e/design.spec.ts`
- Create: `apps/web/app/(app)/design/page.tsx`, `apps/web/components/design/design-system-view.tsx`, `apps/web/components/design/sections/{foundations,icon-gallery}.tsx`
- Create: `apps/web/app/(app)/layout.tsx` (temporary pass-through; Task 11 replaces it)
- Modify: `apps/web/package.json`, `package.json`, `.gitignore`

**Interfaces:**
- Consumes: the fixture flag and server (Task 6); `.env.test` (Phase 0).
- Produces:
  - **`e2e/helpers/test.ts`:**
    - `test` adds a fresh `mt_fixture_ns` cookie per test, and an option `signedOut`;
    - `expect`;
    - `expectCleanScreen(page)` runs layout QA plus axe, light and dark;
    - `isCompact(page)` (≤ 820) and `isWide(page)` (> 1180).
  - **`e2e/helpers/layout-qa.ts`:** `findLayoutIssues(page): Promise<string[]>`. It checks:
    - sideways page scroll;
    - `nowrap` text spilling out of its box;
    - `[data-qa-single-line]` wrapping;
    - elements clipped by an `overflow: hidden|clip` ancestor;
    - `[data-qa-avoid]` overlapping `[data-qa-obstacle]`.

    Opt out with `[data-qa-allow-clip]`.
  - **`e2e/helpers/a11y.ts`:** `seriousA11yViolations(page): Promise<string[]>` (WCAG 2.0/2.1/2.2 A and AA).
  - **Five Playwright projects:** `w1440`, `w1180`, `w1024`, `w820` and `w390`.
  - **The `/design` page** has sections with `data-qa="design-section"`. Later tasks add sections to the `SECTIONS` array in `design-system-view.tsx`.
  - **Scripts:** `pnpm test:ui` (root) and `pnpm --filter @mastertutor/web test:ui`.

- [ ] **Step 1: Install and configure.**

Run:
```bash
pnpm --filter @mastertutor/web add -D -E @playwright/test@1.63.0 @axe-core/playwright@4.13.0
pnpm --filter @mastertutor/web exec playwright install chromium
```

- Add to `apps/web/package.json` `"scripts"`: `"test:ui": "playwright test"`.
- Add to the root `package.json` `"scripts"`: `"test:ui": "pnpm --filter @mastertutor/web test:ui"`.
- Append to `.gitignore`:
```gitignore
apps/web/test-results/
apps/web/playwright-report/
```

`apps/web/e2e/helpers/breakpoints.ts`:
```ts
/** The five QA widths (spec §11.5, D22). */
export const QA_VIEWPORTS = [
  { name: "w1440", width: 1440, height: 900 },
  { name: "w1180", width: 1180, height: 820 },
  { name: "w1024", width: 1024, height: 768 },
  { name: "w820", width: 820, height: 1180 },
  { name: "w390", width: 390, height: 844 },
] as const;
```

`apps/web/playwright.config.ts`:
```ts
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "@playwright/test";
import { QA_VIEWPORTS } from "./e2e/helpers/breakpoints.ts";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const testEnv = parseEnv(readFileSync(new URL("../../.env.test", import.meta.url), "utf8"));

/** WebEnv for the fixture server. The DB and S3 addresses are never contacted in fixture mode. */
const serverEnv: Record<string, string> = {
  DATABASE_URL: "postgres://web:unused@127.0.0.1:1/mastertutor",
  BETTER_AUTH_SECRET: testEnv["BETTER_AUTH_SECRET"] ?? "",
  BETTER_AUTH_URL: baseURL,
  VAULT_PUBLIC_KEY: testEnv["VAULT_PUBLIC_KEY"] ?? "",
  NEKO_MEMBER_SECRET: testEnv["NEKO_MEMBER_SECRET"] ?? "",
  LIVE_COOKIE_SECRET: testEnv["LIVE_COOKIE_SECRET"] ?? "",
  TURN_SECRET: testEnv["TURN_SECRET"] ?? "",
  OPENAI_EMBEDDINGS_KEY: testEnv["OPENAI_EMBEDDINGS_KEY"] ?? "",
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_ACCESS_KEY_ID: testEnv["S3_WEB_ACCESS_KEY_ID"] ?? "",
  S3_SECRET_ACCESS_KEY: testEnv["S3_WEB_SECRET_ACCESS_KEY"] ?? "",
  WEB_FIXTURE_API: "1",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, locale: "en-US", timezoneId: "UTC", trace: "retain-on-failure" },
  projects: QA_VIEWPORTS.map((vp) => ({
    name: vp.name,
    use: { browserName: "chromium", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width <= 820 },
  })),
  webServer: {
    command: process.env.PW_DEV
      ? `pnpm exec next dev -p ${PORT}`
      : `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `${baseURL}/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: serverEnv,
  },
});
```

Until Task 12 creates `/sign-in`, set `url: \`${baseURL}/design\`` in `webServer` and switch it back in Task 12. Step 1 of Task 12 says so.

- [ ] **Step 2: Write the helpers and the failing specs.**

`apps/web/e2e/helpers/layout-qa.ts`:
```ts
import type { Page } from "@playwright/test";

/**
 * DOM layout detector backing the D22 swarm. Returns human-readable issues; [] means clean.
 * Opt an element out of clipping checks with [data-qa-allow-clip] (for example deliberate masks).
 */
export async function findLayoutIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const TOL = 1;
    const issues: string[] = [];
    const describe = (el: Element): string => {
      const qa = el.getAttribute("data-qa");
      const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${qa ? `[data-qa="${qa}"]` : cls} "${text}"`;
    };
    const visible = (el: Element): boolean => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + TOL) {
      issues.push(`page scrolls sideways (${root.scrollWidth}px > ${root.clientWidth}px)`);
    }

    const elements = Array.from(document.body.querySelectorAll("*")).filter(
      (el) => !el.closest("[data-qa-allow-clip]") && !(el.parentElement?.closest("svg")) && visible(el),
    );
    for (const el of elements) {
      const style = getComputedStyle(el);
      if (
        style.display !== "inline" &&
        style.whiteSpace === "nowrap" &&
        style.overflowX === "visible" &&
        el.clientWidth > 0 &&
        el.scrollWidth > el.clientWidth + TOL
      ) {
        issues.push(`text overflows its box: ${describe(el)}`);
      }
      if (el.hasAttribute("data-qa-single-line")) {
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
        if (el.getBoundingClientRect().height > lineHeight * 1.5) issues.push(`wraps onto a second line: ${describe(el)}`);
      }
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const ps = getComputedStyle(parent);
        const clipX = ps.overflowX !== "visible";
        const clipY = ps.overflowY !== "visible";
        if (!clipX && !clipY) continue;
        const box = parent.getBoundingClientRect();
        const scrollable = /(auto|scroll)/.test(`${ps.overflowX} ${ps.overflowY}`);
        if (scrollable || ps.textOverflow === "ellipsis" || box.width <= TOL || box.height <= TOL) break;
        const r = el.getBoundingClientRect();
        const outX = clipX && (r.left < box.left - TOL || r.right > box.right + TOL);
        const outY = clipY && (r.top < box.top - TOL || r.bottom > box.bottom + TOL);
        if (outX || outY) issues.push(`clipped by ${describe(parent)}: ${describe(el)}`);
        break;
      }
    }

    const avoid = Array.from(document.querySelectorAll("[data-qa-avoid]")).filter(visible);
    const obstacles = Array.from(document.querySelectorAll("[data-qa-obstacle]")).filter(visible);
    for (const a of avoid) {
      for (const o of obstacles) {
        if (a === o || a.contains(o) || o.contains(a)) continue;
        const r1 = a.getBoundingClientRect();
        const r2 = o.getBoundingClientRect();
        const w = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
        const h = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
        if (w > TOL && h > TOL) issues.push(`overlaps ${describe(o)}: ${describe(a)}`);
      }
    }
    return [...new Set(issues)];
  });
}
```

`apps/web/e2e/helpers/a11y.ts`:
```ts
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** Serious and critical WCAG A/AA violations (spec §12: zero allowed). */
export async function seriousA11yViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
```

`apps/web/e2e/helpers/test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { FIXTURE_AUTH_COOKIE, FIXTURE_NS_COOKIE } from "../../lib/fixtures/cookies.ts";
import { seriousA11yViolations } from "./a11y.ts";
import { findLayoutIssues } from "./layout-qa.ts";

export const test = base.extend<{ signedOut: boolean }>({
  signedOut: [false, { option: true }],
  context: async ({ context, baseURL, signedOut }, use) => {
    const url = baseURL ?? "http://localhost:3100";
    const cookies = [{ name: FIXTURE_NS_COOKIE, value: randomUUID(), url }];
    if (signedOut) cookies.push({ name: FIXTURE_AUTH_COOKIE, value: "signed-out", url });
    await context.addCookies(cookies);
    await use(context);
  },
});

export { expect };

export const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) <= 820;
export const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) > 1180;

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

/** Layout QA plus axe in light and dark (D22). Reduced motion makes the settled layout immediate. */
export async function expectCleanScreen(page: Page): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await settle(page);
    expect(await findLayoutIssues(page), `${colorScheme} layout`).toEqual([]);
    expect(await seriousA11yViolations(page), `${colorScheme} accessibility`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
}
```

`apps/web/e2e/layout-qa.spec.ts`:
```ts
import { findLayoutIssues } from "./helpers/layout-qa.ts";
import { expect, test } from "./helpers/test.ts";

test.describe("layout detector self-test", () => {
  test.skip(({ viewport }) => viewport?.width !== 1440, "runs once");

  test("flags every class of defect", async ({ page }) => {
    await page.setContent(`
      <div style="width:3000px">wide</div>
      <div style="width:100px;overflow:hidden"><span style="display:inline-block;width:150px">clipped box</span></div>
      <div style="width:60px;white-space:nowrap">text that spills</div>
      <span data-qa-single-line style="display:inline-block;width:40px">two words here</span>
      <div data-qa-avoid style="position:absolute;top:0;left:0;width:50px;height:50px">a</div>
      <div data-qa-obstacle style="position:absolute;top:10px;left:10px;width:50px;height:50px">b</div>`);
    const issues = (await findLayoutIssues(page)).join("\n");
    expect(issues).toContain("page scrolls sideways");
    expect(issues).toContain("clipped by");
    expect(issues).toContain("text overflows its box");
    expect(issues).toContain("wraps onto a second line");
    expect(issues).toContain("overlaps");
  });

  test("accepts ellipsis, scroll containers and opted-out clips", async ({ page }) => {
    await page.setContent(`
      <div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>truncated label text</b></div>
      <div style="width:80px;overflow:auto"><div style="width:300px">scrolls</div></div>
      <div data-qa-allow-clip style="width:40px;overflow:hidden"><div style="width:90px">mask</div></div>`);
    expect(await findLayoutIssues(page)).toEqual([]);
  });
});
```

`apps/web/e2e/design.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("design-system page is clean at every breakpoint (F1 done-when)", async ({ page }) => {
  await page.goto("/design");
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await expect(page.locator('[data-qa="design-section"]').first()).toBeVisible();
  await expect(page.getByRole("img", { name: "verified" })).toBeVisible();
  await expectCleanScreen(page);
});
```

- [ ] **Step 3: Run the specs to verify they fail.**

Run: `pnpm test:ui -- --project=w1440`
Expected:
- The detector self-test PASSes (it uses `setContent`).
- `design.spec.ts` FAILs, because `/design` returns 404.

- [ ] **Step 4: Implement the design page.**

`apps/web/app/(app)/layout.tsx` (a temporary pass-through; Task 11 replaces it with the guarded shell):
```tsx
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <main id="main">{children}</main>;
}
```

`apps/web/app/(app)/design/page.tsx`:
```tsx
import type { Metadata } from "next";
import { DesignSystemView } from "@/components/design/design-system-view.tsx";

export const metadata: Metadata = { title: "Design system" };

export default function DesignPage() {
  return <DesignSystemView />;
}
```

`apps/web/components/design/design-system-view.tsx`:
```tsx
"use client";

import type { ComponentType } from "react";
import { FoundationsSection } from "./sections/foundations.tsx";
import { IconGallerySection } from "./sections/icon-gallery.tsx";

/** Later tasks append their section component here. */
const SECTIONS: ReadonlyArray<{ id: string; title: string; Section: ComponentType }> = [
  { id: "foundations", title: "Foundations", Section: FoundationsSection },
  { id: "icons", title: "Icons", Section: IconGallerySection },
];

export function DesignSystemView() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 md:px-6 lg:px-10">
      <h1 className="t-large pt-10 lg:pt-16">
        Design system<span className="period" aria-hidden="true">.</span>
      </h1>
      <p className="mt-3 max-w-xl text-label-2">Every token and shared component, at every breakpoint.</p>
      {SECTIONS.map(({ id, title, Section }) => (
        <section key={id} id={id} data-qa="design-section" aria-labelledby={`${id}-title`} className="mt-12">
          <h2 id={`${id}-title`} className="t-title2 mb-4">
            {title}
          </h2>
          <Section />
        </section>
      ))}
    </div>
  );
}
```

`apps/web/components/design/sections/foundations.tsx`:
```tsx
const COLORS = [
  "bg", "bg-2", "elevated", "label", "label-2", "hairline", "fill", "tint", "tint-text",
  "signal", "navy", "ok", "warn", "danger",
] as const;
const TYPE = [
  ["t-large", "Large title"],
  ["t-title1", "Title 1"],
  ["t-title2", "Title 2"],
  ["t-title3", "Title 3"],
  ["t-callout", "Callout"],
  ["t-foot", "Footnote"],
  ["eyebrow", "Eyebrow"],
  ["cap", "Caption"],
  ["mono", "Mono 12 · 0123456789"],
] as const;
const RADII = ["xs", "sm", "md", "lg", "xl", "frame"] as const;
const SHADOWS = ["e1", "e2", "e3"] as const;

export function FoundationsSection() {
  return (
    <div className="grid gap-10">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-label="Colour tokens">
        {COLORS.map((name) => (
          <li key={name} className="grid gap-1.5">
            <span className="h-12 rounded-md shadow-e1" style={{ background: `var(--${name})` }} />
            <code className="mono text-label-2">--{name}</code>
          </li>
        ))}
      </ul>
      <ul className="grid gap-3" aria-label="Type scale">
        {TYPE.map(([cls, label]) => (
          <li key={cls} className={cls}>
            {label}
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-4" aria-label="Radii and elevation">
        {RADII.map((r) => (
          <li key={r} className="grid size-20 place-items-center bg-elevated shadow-e1" style={{ borderRadius: `var(--r-${r})` }}>
            <span className="mono">{r}</span>
          </li>
        ))}
        {SHADOWS.map((s) => (
          <li key={s} className={`grid size-20 place-items-center rounded-lg bg-elevated shadow-${s}`}>
            <span className="mono">{s}</span>
          </li>
        ))}
      </ul>
      <div className="design-glass-demo rounded-xl p-6">
        <div className="glass rounded-lg p-4">
          <p className="t-title3">Glass</p>
          <p className="t-callout text-label-2">saturate(180%) blur(24px) at 72% fill. Opaque with reduced transparency.</p>
        </div>
      </div>
    </div>
  );
}
```

`apps/web/components/design/sections/icon-gallery.tsx`:
```tsx
import { Icon } from "@/components/ui/icon.tsx";
import { icons, type IconName } from "@/components/ui/icons.ts";

export function IconGallerySection() {
  const names = Object.keys(icons) as IconName[];
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8" aria-label="Icon registry">
      {names.map((name) => (
        <li key={name} className="grid min-w-0 justify-items-center gap-1 rounded-md bg-bg-2 p-3">
          <Icon name={name} size="lg" label={name} />
          <span className="t-foot w-full truncate text-center">{name}</span>
        </li>
      ))}
    </ul>
  );
}
```

Create `apps/web/styles/components.css` with only the glass recipe and the demo backdrop (Task 8 extends it), and import it in `globals.css` after `base.css`:
```css
.glass {
  background: var(--glass);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
}
.design-glass-demo {
  background:
    radial-gradient(circle at 20% 30%, var(--ambient), transparent 60%),
    linear-gradient(135deg, var(--tint-wash), var(--signal-wash));
}
```

- [ ] **Step 5: Run the specs to verify they pass.**

Run: `pnpm test:ui -- e2e/layout-qa.spec.ts e2e/design.spec.ts`
Expected:
- The layout self-test runs once and PASSes.
- `design.spec.ts` PASSes in all 5 projects.

- [ ] **Step 6: Commit.**

```bash
git add apps/web package.json .gitignore pnpm-lock.yaml
git commit -m "test(web): Playwright at 5 breakpoints with DOM layout detector + axe; design-system page"
```

---

### Task 8: Controls and surfaces

**Files:**
- Create: `apps/web/components/ui/{button,badge,chip,skeleton,text-field,search-field,switch,toolbar,page-head,empty-state}.tsx`, `apps/web/components/design/sections/controls.tsx`
- Modify: `apps/web/styles/components.css`, `apps/web/components/design/design-system-view.tsx`, `apps/web/e2e/design.spec.ts`, `apps/web/package.json`
- Test: `apps/web/components/ui/controls.test.ts`

**Interfaces:**
- Consumes: `Icon`, `cx`, tokens and motion CSS vars.
- Produces:

  | Component | Props / behaviour |
  |---|---|
  | `Button` | `{variant?: "primary"\|"gray"\|"plain"\|"danger"; size?: "md"\|"lg"; icon?: IconName; …button props}` |
  | `ButtonLink` | `{href, variant?, size?, icon?, children}` |
  | `IconButton` | `{icon: IconName; label: string; …}` (label required) |
  | `Badge` | `{tone: "ok"\|"warn"\|"neutral"\|"tint"\|"signal"\|"danger"; icon: IconName; children}` (icon is required: never colour alone) |
  | `Chip` | `{icon?, children, onRemove?, removeLabel?}` |
  | `Skeleton` | `{className?}` |
  | `TextField` | `{label, hint?, error?, …input props}` |
  | `SearchField` | `{label, value, onChange, placeholder?, shortcut?}` |
  | `Switch` | `{checked, onCheckedChange, label, tone?: "default"\|"danger", disabled?}` |
  | `Toolbar` | `{children}` (sticky glass header) |
  | `Crumbs` | `{items: Array<{label, href?}>}` |
  | `PageHead` | `{title, lede?}` (adds the signal period) |
  | `EmptyState` | `{icon, eyebrow?, title, body, actions?}` |

  - CSS classes: `.btn*`, `.icon-btn`, `.badge-*`, `.chip`, `.sk`, `.tf*`, `.search-field`, `.switch*`, `.toolbar`, `.crumbs`, `.pagehead`, `.wrap`, `.group`, `.row`, `.kbd`.

- [ ] **Step 1: Install Base UI.**

Run:
```bash
pnpm --filter @mastertutor/web add -E @base-ui/react@1.8.0
```

- [ ] **Step 2: Write the failing test.**

`apps/web/components/ui/controls.test.ts`:
```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge.tsx";
import { IconButton } from "./button.tsx";
import { PageHead } from "./page-head.tsx";
import { TextField } from "./text-field.tsx";

describe("controls", () => {
  it("names icon-only buttons", () => {
    const html = renderToStaticMarkup(createElement(IconButton, { icon: "more", label: "More actions" }));
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain('type="button"');
  });

  it("pairs every badge colour with an icon and a word", () => {
    const html = renderToStaticMarkup(createElement(Badge, { tone: "warn", icon: "needsReview" }, "Needs review"));
    expect(html).toContain("<svg");
    expect(html).toContain("Needs review");
    expect(html).toContain("badge-warn");
  });

  it("links text fields to their label, hint and error", () => {
    const html = renderToStaticMarkup(
      createElement(TextField, { id: "alias", label: "Alias", hint: "Lowercase", error: "Taken" }),
    );
    expect(html).toContain('for="alias"');
    expect(html).toContain('aria-describedby="alias-hint alias-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });

  it("ends page titles with a decorative signal period", () => {
    const html = renderToStaticMarkup(createElement(PageHead, { title: "Library" }));
    expect(html).toMatch(/Library<span class="period" aria-hidden="true">\.<\/span>/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/components/ui/controls`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement.**

`apps/web/components/ui/button.tsx`:
```tsx
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx.ts";
import { Icon, type IconName } from "./icon.tsx";

type Variant = "primary" | "gray" | "plain" | "danger";
interface Look {
  variant?: Variant;
  size?: "md" | "lg";
  icon?: IconName;
}

const classes = ({ variant = "gray", size = "md" }: Look, className?: string) =>
  cx("btn", `btn-${variant}`, size === "lg" && "btn-lg", className);

export function Button({ variant, size, icon, className, children, type = "button", ...rest }: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={classes({ variant, size }, className)} {...rest}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant, size, icon, className, children }: Look & { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={classes({ variant, size }, className)}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </Link>
  );
}

export function IconButton({ icon, label, className, type = "button", ...rest }: { icon: IconName; label: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">) {
  return (
    <button type={type} aria-label={label} className={cx("icon-btn", className)} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
```

`apps/web/components/ui/badge.tsx`:
```tsx
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export type BadgeTone = "ok" | "warn" | "neutral" | "tint" | "signal" | "danger";

/** Status never relies on colour alone: icon + word are required. */
export function Badge({ tone, icon, children }: { tone: BadgeTone; icon: IconName; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <Icon name={icon} size="sm" />
      {children}
    </span>
  );
}
```

`apps/web/components/ui/chip.tsx`:
```tsx
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export function Chip({ icon, children, onRemove, removeLabel }: { icon?: IconName; children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span className="chip">
      {icon ? <Icon name={icon} size="sm" /> : null}
      <span className="chip-text">{children}</span>
      {onRemove ? (
        <button type="button" className="chip-x" aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
          <Icon name="close" size="sm" />
        </button>
      ) : null}
    </span>
  );
}
```

`apps/web/components/ui/skeleton.tsx`:
```tsx
import { cx } from "@/lib/cx.ts";

/** Shimmer placeholder (transform-only). Wrap loading regions in aria-busy="true". */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("sk", className)} aria-hidden="true" />;
}
```

`apps/web/components/ui/text-field.tsx`:
```tsx
import { useId, type InputHTMLAttributes } from "react";
import { cx } from "@/lib/cx.ts";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "children"> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, id, className, ...input }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("tf", className)}>
      <label htmlFor={inputId} className="tf-label">
        {label}
      </label>
      <input id={inputId} className="tf-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {hint ? (
        <p id={hintId} className="tf-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="tf-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

`apps/web/components/ui/search-field.tsx`:
```tsx
import type { Ref } from "react";
import { Icon } from "./icon.tsx";

export function SearchField({ label, value, onChange, placeholder, shortcut, inputRef }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; shortcut?: string; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <div className="search-field" role="search">
      <Icon name="search" size="sm" />
      <input ref={inputRef} type="search" aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {shortcut ? (
        <kbd className="kbd" aria-hidden="true">
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
}
```

`apps/web/components/ui/switch.tsx`:
```tsx
"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cx } from "@/lib/cx.ts";

export function Switch({ checked, onCheckedChange, label, tone = "default", disabled }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; tone?: "default" | "danger"; disabled?: boolean }) {
  return (
    <BaseSwitch.Root
      className={cx("switch", tone === "danger" && "switch-danger")}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={(next) => onCheckedChange(next)}
    >
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  );
}
```

`apps/web/components/ui/toolbar.tsx`:
```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";

/** Sticky glass header for each screen; content scrolls beneath it. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <header className="toolbar glass">{children}</header>;
}

export function Crumbs({ items }: { items: ReadonlyArray<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className={last ? "crumb-current" : "crumb"}>
              {item.href && !last ? <Link href={item.href}>{item.label}</Link> : <span aria-current={last ? "page" : undefined}>{item.label}</span>}
              {last ? null : <Icon name="chevronRight" size="sm" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ToolbarSpacer() {
  return <span className="toolbar-spacer" />;
}
```

`apps/web/components/ui/page-head.tsx`:
```tsx
import type { ReactNode } from "react";

export function PageHead({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pagehead">
      <div className="min-w-0">
        <h1 className="t-large">
          {title}
          <span className="period" aria-hidden="true">
            .
          </span>
        </h1>
        {lede ? <p className="pagehead-lede">{lede}</p> : null}
      </div>
      {children ? <div className="pagehead-actions">{children}</div> : null}
    </div>
  );
}
```

`apps/web/components/ui/empty-state.tsx`:
```tsx
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export function EmptyState({ icon, eyebrow, title, body, actions }: { icon: IconName; eyebrow?: string; title: string; body: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <span className="empty-art">
        <Icon name={icon} size="xl" />
      </span>
      <div className="min-w-0">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2 className="t-title1 mt-2">
          {title}
          <span className="period" aria-hidden="true">
            .
          </span>
        </h2>
        <p className="empty-body">{body}</p>
        {actions ? <div className="empty-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
```

Append to `apps/web/styles/components.css`:
```css
.wrap {
  max-width: 84rem;
  margin: 0 auto;
  padding: 0 1rem;
  @variant md {
    padding: 0 1.5rem;
  }
  @variant lg {
    padding: 0 2.5rem;
  }
}
.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.25rem;
  padding: 0 0.95rem;
  border-radius: var(--r-pill);
  font-weight: 500;
  font-size: 0.8125rem;
  white-space: nowrap;
  text-decoration: none;
  transition-property: transform;
  transition-duration: var(--motion-dur-micro);
  transition-timing-function: var(--motion-ease-out);
  &::after {
    content: "";
    position: absolute;
    inset: -0.25rem;
  }
  &:hover {
    text-decoration: none;
  }
  &:active:not(:disabled) {
    transform: scale(var(--motion-press));
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}
.btn-primary {
  background: var(--tint);
  color: var(--on-tint);
  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--tint) 88%, black);
  }
}
.btn-gray {
  background: var(--fill);
  color: var(--label);
}
.btn-plain {
  color: var(--tint-text);
  padding: 0 0.6rem;
  &:hover {
    background: var(--tint-wash);
  }
}
.btn-danger {
  background: var(--danger);
  color: var(--on-danger);
}
.btn-lg {
  min-height: var(--hit);
  padding: 0 1.35rem;
  font-size: 0.9375rem;
}
.icon-btn {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  border-radius: var(--r-pill);
  color: var(--label-2);
  transition-property: transform;
  transition-duration: var(--motion-dur-micro);
  transition-timing-function: var(--motion-ease-out);
  &::after {
    content: "";
    position: absolute;
    inset: -0.25rem;
  }
  &:hover {
    background: var(--fill-2);
    color: var(--label);
  }
  &:active {
    transform: scale(var(--motion-press-icon));
  }
}
@media (pointer: coarse) {
  .btn {
    min-height: var(--hit);
  }
  .icon-btn {
    width: var(--hit);
    height: var(--hit);
  }
}
.kbd {
  font: 500 0.6875rem/1 var(--font-code);
  padding: 0.15rem 0.32rem;
  border-radius: 0.3125rem;
  background: var(--fill-2);
  box-shadow: inset 0 -1px 0 var(--sep);
}
.btn-primary .kbd {
  background: rgb(255 255 255 / 0.2);
  box-shadow: none;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
  border-radius: var(--r-pill);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.badge-ok {
  color: var(--ok);
  background: var(--ok-wash);
}
.badge-warn {
  color: var(--warn);
  background: var(--warn-wash);
}
.badge-neutral {
  color: var(--label);
  background: var(--fill-2);
}
.badge-tint {
  color: var(--tint-text);
  background: var(--tint-wash);
}
.badge-signal {
  color: var(--signal);
  background: var(--signal-wash);
}
.badge-danger {
  color: var(--danger);
  background: var(--danger-wash);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2rem;
  max-width: 100%;
  padding: 0 0.35rem 0 0.6rem;
  border-radius: var(--r-pill);
  background: var(--bg-2);
  font-size: 0.75rem;
  font-weight: 500;
}
.chip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-x {
  position: relative;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  color: var(--label-2);
  &::after {
    content: "";
    position: absolute;
    inset: -0.625rem;
  }
  &:hover {
    background: var(--fill);
  }
}
.sk {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: var(--r-xs);
  background: var(--fill-2);
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.45), transparent);
    transform: translateX(-100%);
    animation-name: shimmer;
    animation-duration: var(--motion-dur-shimmer);
    animation-timing-function: var(--motion-ease-out);
    animation-iteration-count: infinite;
  }
}
@media (prefers-color-scheme: dark) {
  .sk::after {
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.06), transparent);
  }
}
@keyframes shimmer {
  to {
    transform: translateX(100%);
  }
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: translateY(0.625rem) scale(0.96);
  }
}
.tf {
  display: grid;
  gap: 0.35rem;
}
.tf-label {
  font-size: 0.8125rem;
  font-weight: 500;
}
.tf-input {
  min-height: var(--hit);
  width: 100%;
  min-width: 0;
  padding: 0 0.75rem;
  border: 0;
  border-radius: 0.625rem;
  background: var(--fill-2);
  outline: none;
  &:focus-visible {
    box-shadow:
      0 0 0 3px var(--tint-wash),
      inset 0 0 0 1px var(--tint);
  }
  &[aria-invalid="true"] {
    box-shadow: inset 0 0 0 1px var(--danger);
  }
}
.tf-hint {
  font-size: 0.75rem;
  color: var(--label-2);
}
.tf-error {
  font-size: 0.75rem;
  color: var(--danger);
}
.search-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border-radius: 0.625rem;
  background: var(--fill-2);
  color: var(--label-2);
  &:focus-within {
    box-shadow:
      0 0 0 3px var(--tint-wash),
      inset 0 0 0 1px var(--tint);
  }
  & input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: none;
    color: var(--label);
  }
  & input::placeholder {
    color: var(--label-2);
  }
}
.switch {
  position: relative;
  flex: none;
  width: 2.375rem;
  height: 1.375rem;
  border-radius: var(--r-pill);
  background: var(--fill);
  &[data-checked] {
    background: var(--switch-on);
  }
  &.switch-danger[data-checked] {
    background: var(--danger);
  }
  &[data-disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }
  &::after {
    content: "";
    position: absolute;
    inset: -0.6875rem -0.1875rem;
  }
}
.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--e1);
  transition-property: transform;
  transition-duration: var(--motion-spring-dur);
  transition-timing-function: var(--motion-spring);
  &[data-checked] {
    transform: translateX(1rem);
  }
}
.toolbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: var(--toolbar-h);
  padding: 0 1rem;
  @variant md {
    gap: 0.75rem;
    padding: 0 1.5rem;
  }
  &::after {
    content: "";
    position: absolute;
    inset: auto 0 0;
    height: 1px;
    background: var(--glass-line);
    opacity: 0;
    animation-name: fade-in;
    animation-timing-function: var(--motion-ease-linear);
    animation-fill-mode: both;
    animation-timeline: scroll(nearest block);
    animation-range: 0 1rem;
  }
}
@keyframes fade-in {
  to {
    opacity: 1;
  }
}
.toolbar-spacer {
  flex: 1;
}
.crumbs {
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--label-2);
  & ol {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 0;
  }
  & .crumb {
    display: none;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
    @variant sm {
      display: flex;
    }
  }
  & .crumb a {
    color: var(--label-2);
  }
  & .crumb-current {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--label);
    font-weight: 600;
  }
}
.pagehead {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: end;
  gap: 1.5rem;
  padding: 2.5rem 0 1.5rem;
  @variant md {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  @variant lg {
    padding: 4rem 0 2rem;
  }
}
.pagehead-lede {
  margin-top: 0.75rem;
  max-width: 34rem;
  color: var(--label-2);
  font-size: 1.0625rem;
  line-height: 1.45;
  letter-spacing: -0.01em;
}
.group {
  border-radius: var(--r-lg);
  background: var(--elevated);
  box-shadow: var(--e1);
  overflow: hidden;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 3.5rem;
  padding: 0.6rem 1.1rem;
  font-size: 0.875rem;
  & + .row::before {
    content: "";
    position: absolute;
    top: 0;
    left: 1.1rem;
    right: 0;
    height: 1px;
    background: var(--sep);
  }
  & small {
    display: block;
    color: var(--label-2);
    font-size: 0.75rem;
  }
}
.empty {
  display: grid;
  gap: 2rem;
  align-items: center;
  padding: 3rem 0 5rem;
  @variant md {
    grid-template-columns: auto minmax(0, 1fr);
  }
}
.empty-art {
  display: grid;
  place-items: center;
  width: 6.5rem;
  height: 6.5rem;
  border-radius: var(--r-xl);
  background: var(--bg-2);
  color: var(--label-2);
}
.empty-body {
  margin-top: 0.75rem;
  max-width: 26rem;
  color: var(--label-2);
  font-size: 1rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.25rem;
}
```

`apps/web/components/design/sections/controls.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button, IconButton } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { SearchField } from "@/components/ui/search-field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { TextField } from "@/components/ui/text-field.tsx";

export function ControlsSection() {
  const [on, setOn] = useState(true);
  const [query, setQuery] = useState("");
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="add">New task</Button>
        <Button>Cancel</Button>
        <Button variant="plain">Learn more</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="primary" size="lg">Start</Button>
        <Button disabled>Disabled</Button>
        <IconButton icon="more" label="More actions" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge tone="ok" icon="verified">Verified</Badge>
        <Badge tone="warn" icon="needsReview">Needs review</Badge>
        <Badge tone="tint" icon="edited">Edited</Badge>
        <Badge tone="signal" icon="live">Live</Badge>
        <Badge tone="neutral" icon="agentNote">Agent note</Badge>
        <Badge tone="danger" icon="stop">Stopped</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip icon="web">learn.example.edu</Chip>
        <Chip icon="web" onRemove={() => undefined} removeLabel="Remove github.com">github.com</Chip>
      </div>
      <div className="grid max-w-md gap-4">
        <TextField label="Alias" hint="Lowercase letters, numbers, dash or underscore." placeholder="zybooks" />
        <TextField label="Website" error="Enter a website such as example.com." defaultValue="not a url" />
        <SearchField label="Search the library" value={query} onChange={setQuery} placeholder="Search every block" shortcut="⌘K" />
      </div>
      <label className="flex items-center gap-3">
        <Switch checked={on} onCheckedChange={setOn} label="Show callouts" />
        Show callouts
      </label>
      <div className="grid max-w-md gap-2" aria-busy="true" aria-label="Loading example">
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
```

In `design-system-view.tsx`, import `ControlsSection` and append `{ id: "controls", title: "Controls", Section: ControlsSection }` to `SECTIONS`.

Append to `apps/web/e2e/design.spec.ts`:
```ts
test("controls give press feedback and keep switches keyboard-operable", async ({ page }) => {
  await page.goto("/design#controls");
  const toggle = page.getByRole("switch", { name: "Show callouts" });
  await expect(toggle).toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("alert")).toHaveText("Enter a website such as example.com.");
});
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/components/ui && pnpm lint && pnpm test:ui -- e2e/design.spec.ts`
Expected: PASS in all 5 projects, with no layout or axe issues.

- [ ] **Step 6: Commit.**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): buttons, badges, chips, fields, switch, skeleton, toolbar, page head, empty state"
```

---

### Task 9: Overlays (sheet, alert, popover, menu)

**Files:**
- Create: `apps/web/components/ui/{sheet,confirm-dialog,popover,menu}.tsx`, `apps/web/styles/overlays.css`, `apps/web/components/design/sections/overlays.tsx`
- Modify: `apps/web/app/globals.css`, `apps/web/components/design/design-system-view.tsx`, `apps/web/e2e/design.spec.ts`

**Interfaces:**
- Consumes: Base UI and the controls from Task 8.
- Produces:
  - **`Sheet`:** `{open, onOpenChange, title, description?, children, footer?, initialFocus?}`. It is a bottom sheet at ≤ 820 px and a centred glass panel above that.
  - **`ConfirmDialog`:** `{open, onOpenChange, title, description, confirmLabel, cancelLabel?, destructive?, onConfirm}`. Cancel is leading and gets initial focus.
  - **`Popover`** (the Base UI namespace) and **`PopoverPanel`** `{children, side?, align?, label, className?}`.
  - **`Menu`** (namespace), **`MenuPanel`** `{children, align?}`, and **`MenuItem`** `{icon?, onSelect, destructive?, children}`.

- [ ] **Step 1: Write the failing spec.**

Append to `apps/web/e2e/design.spec.ts`:
```ts
test("overlays trap focus, default to the safe action, and close with Escape", async ({ page }) => {
  await page.goto("/design#overlays");
  await page.getByRole("button", { name: "Open sheet" }).click();
  const sheet = page.getByRole("dialog", { name: "Move to…" });
  await expect(sheet).toBeVisible();
  await expectCleanScreen(page);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByRole("button", { name: "Delete folder…" }).click();
  const alert = page.getByRole("alertdialog", { name: "Delete “Papers”?" });
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Delete Folder" }).click();
  await expect(page.getByText("Deleted")).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).first().click();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Show provenance" }).click();
  await expect(page.getByRole("dialog", { name: "Block provenance" })).toBeVisible();
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/design.spec.ts --project=w1440`
Expected: FAIL, because the overlays section is missing.

- [ ] **Step 3: Implement.**

`apps/web/components/ui/sheet.tsx`:
```tsx
"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode, RefObject } from "react";
import { Icon } from "./icon.tsx";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
}

/** Focused task: bottom sheet on compact widths, centred glass panel on regular widths (HIG). */
export function Sheet({ open, onOpenChange, title, description, children, footer, initialFocus }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="sheet-viewport">
          <Dialog.Popup className="sheet" initialFocus={initialFocus}>
            <div className="sheet-grabber" aria-hidden="true" />
            <div className="sheet-head">
              <Dialog.Title className="t-title2">{title}</Dialog.Title>
              <Dialog.Close className="icon-btn" aria-label="Close">
                <Icon name="close" />
              </Dialog.Close>
            </div>
            {description ? <Dialog.Description className="sheet-desc">{description}</Dialog.Description> : null}
            <div className="sheet-body">{children}</div>
            {footer ? <div className="sheet-foot">{footer}</div> : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

`apps/web/components/ui/confirm-dialog.tsx`:
```tsx
"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRef, type ReactNode } from "react";
import { cx } from "@/lib/cx.ts";

/** Critical decision. Cancel leads and is focused; a destructive action is red and never the default. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel = "Cancel", destructive = false, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: ReactNode; confirmLabel: string; cancelLabel?: string; destructive?: boolean; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="scrim" />
        <AlertDialog.Viewport className="alert-viewport">
          <AlertDialog.Popup className="alert" initialFocus={cancelRef}>
            <AlertDialog.Title className="t-title3">{title}</AlertDialog.Title>
            <AlertDialog.Description className="alert-desc">{description}</AlertDialog.Description>
            <div className="alert-actions">
              <AlertDialog.Close ref={cancelRef} className="btn btn-gray">
                {cancelLabel}
              </AlertDialog.Close>
              <button
                type="button"
                className={cx("btn", destructive ? "btn-danger" : "btn-primary")}
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
```

`apps/web/components/ui/popover.tsx`:
```tsx
"use client";

import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx.ts";

export { Popover };

export function PopoverPanel({ children, side = "bottom", align = "start", label, className }: { children: ReactNode; side?: "top" | "bottom" | "left" | "right"; align?: "start" | "center" | "end"; label: string; className?: string }) {
  return (
    <Popover.Portal>
      <Popover.Positioner side={side} align={align} sideOffset={8} collisionPadding={12} className="popover-positioner">
        <Popover.Popup className={cx("popover", className)} aria-label={label}>
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
```

`apps/web/components/ui/menu.tsx`:
```tsx
"use client";

import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx.ts";
import { Icon, type IconName } from "./icon.tsx";

export { Menu };

export function MenuPanel({ children, align = "end" }: { children: ReactNode; align?: "start" | "center" | "end" }) {
  return (
    <Menu.Portal>
      <Menu.Positioner align={align} sideOffset={6} collisionPadding={12} className="popover-positioner">
        <Menu.Popup className="menu">{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

/** Destructive items are red and go last (HIG). */
export function MenuItem({ icon, onSelect, destructive = false, children }: { icon?: IconName; onSelect: () => void; destructive?: boolean; children: ReactNode }) {
  return (
    <Menu.Item className={cx("menu-item", destructive && "menu-item-danger")} onClick={onSelect}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      <span>{children}</span>
    </Menu.Item>
  );
}
```

`apps/web/styles/overlays.css` (import it in `globals.css` after `components.css`):
```css
.scrim {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: var(--scrim);
  transition-property: opacity;
  transition-duration: var(--motion-dur-base);
  transition-timing-function: var(--motion-ease-out);
  &[data-starting-style],
  &[data-ending-style] {
    opacity: 0;
  }
}
.sheet-viewport,
.alert-viewport {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
}
.sheet-viewport {
  align-items: end;
  @variant md {
    align-items: center;
    justify-items: center;
    padding: 2rem;
  }
}
.sheet {
  position: relative;
  max-height: 90dvh;
  overflow: auto;
  padding: 0.5rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  background: var(--glass);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  box-shadow: var(--e3);
  outline: none;
  transition-property: transform, opacity;
  transition-duration: var(--motion-spring-soft-dur);
  transition-timing-function: var(--motion-spring-soft);
  &[data-starting-style],
  &[data-ending-style] {
    transform: translateY(100%);
  }
  @variant md {
    width: min(32rem, 100%);
    padding: 1.25rem;
    border-radius: var(--r-xl);
    &[data-starting-style],
    &[data-ending-style] {
      transform: translateY(1rem) scale(0.98);
      opacity: 0;
    }
  }
}
.sheet-grabber {
  width: 2.25rem;
  height: 0.3125rem;
  margin: 0 auto 0.75rem;
  border-radius: 0.1875rem;
  background: var(--label-3);
  opacity: 0.5;
  @variant md {
    display: none;
  }
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.sheet-desc {
  margin-top: 0.35rem;
  color: var(--label-2);
  font-size: 0.875rem;
  line-height: 1.45;
}
.sheet-body {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}
.sheet-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}
.alert-viewport {
  place-items: center;
  padding: 1rem;
}
.alert {
  width: min(22rem, 100%);
  padding: 1.25rem;
  border-radius: var(--r-lg);
  background: var(--elevated);
  box-shadow: var(--e3);
  outline: none;
  transition-property: transform, opacity;
  transition-duration: var(--motion-spring-dur);
  transition-timing-function: var(--motion-spring);
  &[data-starting-style],
  &[data-ending-style] {
    transform: scale(0.96);
    opacity: 0;
  }
}
.alert-desc {
  margin-top: 0.5rem;
  color: var(--label-2);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.alert-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 1.25rem;
}
.popover-positioner {
  z-index: 80;
}
.popover,
.menu {
  border-radius: var(--r-lg);
  background: var(--elevated);
  box-shadow: var(--e3);
  outline: none;
  transform-origin: var(--transform-origin);
  transition-property: transform, opacity;
  transition-duration: var(--motion-spring-dur);
  transition-timing-function: var(--motion-spring);
  &[data-starting-style],
  &[data-ending-style] {
    transform: scale(0.96);
    opacity: 0;
  }
}
.popover {
  width: min(21rem, calc(100vw - 1.5rem));
  padding: 1rem;
}
.menu {
  min-width: 12rem;
  padding: 0.35rem;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.25rem;
  padding: 0 0.65rem;
  border-radius: var(--r-sm);
  font-size: 0.8125rem;
  cursor: default;
  outline: none;
  &[data-highlighted] {
    background: var(--tint);
    color: var(--on-tint);
  }
  @media (pointer: coarse) {
    min-height: var(--hit);
  }
}
.menu-item-danger {
  color: var(--danger);
  &[data-highlighted] {
    background: var(--danger);
    color: var(--on-danger);
  }
}
```

`apps/web/components/design/sections/overlays.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { Popover, PopoverPanel } from "@/components/ui/popover.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";

export function OverlaysSection() {
  const [sheet, setSheet] = useState(false);
  const [alert, setAlert] = useState(false);
  const [result, setResult] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => setSheet(true)}>Open sheet</Button>
      <Sheet open={sheet} onOpenChange={setSheet} title="Move to…" description="Choose a folder for this note." footer={<Button variant="primary" onClick={() => setSheet(false)}>Done</Button>}>
        <p>Folders appear here.</p>
      </Sheet>
      <Button variant="danger" onClick={() => setAlert(true)}>Delete folder…</Button>
      <ConfirmDialog open={alert} onOpenChange={setAlert} title="Delete “Papers”?" description="Its subfolders are deleted too. Notes inside move to Unfiled." confirmLabel="Delete Folder" destructive onConfirm={() => setResult("Deleted")} />
      <Menu.Root>
        <Menu.Trigger render={<IconButton icon="more" label="More actions" />} />
        <MenuPanel>
          <MenuItem icon="edit" onSelect={() => setResult("Rename")}>Rename</MenuItem>
          <MenuItem icon="delete" destructive onSelect={() => setResult("Delete")}>Delete</MenuItem>
        </MenuPanel>
      </Menu.Root>
      <Popover.Root>
        <Popover.Trigger className="btn btn-gray">Show provenance</Popover.Trigger>
        <PopoverPanel label="Block provenance">
          <p className="t-callout">Exact DOM match · 46 words · 0 diffs.</p>
        </PopoverPanel>
      </Popover.Root>
      <span role="status" className="t-foot">{result}</span>
    </div>
  );
}
```

`Menu.Trigger render={…}` uses Base UI's render-prop composition: the trigger renders as our `IconButton` and keeps the menu ARIA attributes.

Add `{ id: "overlays", title: "Overlays", Section: OverlaysSection }` to `SECTIONS`.

- [ ] **Step 4: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm test:ui -- e2e/design.spec.ts`
Expected: PASS in 5 projects.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): sheet, confirm alert, popover and menu on Base UI with spring transitions"
```

---

### Task 10: SwipeToast (React Bits) and the toast provider

**Files:**
- Create: `apps/web/components/bits/LICENSE-react-bits`, `apps/web/components/bits/swipe-toast.tsx`, `apps/web/components/toast/toast-provider.tsx`, `apps/web/components/design/sections/toasts.tsx`, `apps/web/components.json`
- Modify: `apps/web/app/providers.tsx`, `apps/web/styles/overlays.css`, `apps/web/components/design/design-system-view.tsx`, `apps/web/e2e/design.spec.ts`

**Interfaces:**
- Consumes: `transitions`, `durations`, `fuse`; `Icon`.
- Produces:
  - `<SwipeToast title description? icon? actionLabel? onAction? tone? onClose(reason)>`.
  - `<ToastProvider>` (inside `Providers`), keeping at most 3 toasts.
  - `useToast(): (input: ToastInput) => void`, where `ToastInput = {title; description?; icon?; actionLabel?; onAction?; tone?: "neutral" | "danger"}`.
  - `components.json` with the `@react-bits` registry (spec §11.4).

- [ ] **Step 1: Fetch the upstream source and licence (provenance).**

Run:
```bash
curl -fsSL https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md -o apps/web/components/bits/LICENSE-react-bits
curl -fsSL https://reactbits.dev/r/SwipeToast-TS-TW.json | shasum -a 256
```
Expected:
- The licence text includes "MIT" and "Commons Clause".
- Record the printed SHA-256 in the `swipe-toast.tsx` header below, in place of `<sha256>`, and in the commit message.

`apps/web/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "ui": "@/components/ui", "lib": "@/lib", "utils": "@/lib/cx", "hooks": "@/lib/hooks" },
  "iconLibrary": "lucide",
  "registries": { "@react-bits": "https://reactbits.dev/r/{name}.json" }
}
```

- [ ] **Step 2: Write the failing spec.**

Append to `apps/web/e2e/design.spec.ts`:
```ts
test("undo toast runs its action, dismisses with Escape and announces politely", async ({ page }) => {
  await page.goto("/design#toasts");
  await page.getByRole("button", { name: "Show undo toast" }).click();
  const toast = page.getByRole("status").filter({ hasText: "Moved to Papers" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("aria-live", "polite");
  await expectCleanScreen(page);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undo pressed")).toBeVisible();
  await expect(toast).toBeHidden();

  await page.getByRole("button", { name: "Show undo toast" }).click();
  await page.getByRole("status").filter({ hasText: "Moved to Papers" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: "Moved to Papers" })).toBeHidden();
});
```

- [ ] **Step 3: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/design.spec.ts --project=w1440`
Expected: FAIL, because the toasts section is missing.

- [ ] **Step 4: Implement.**

`apps/web/components/bits/swipe-toast.tsx`:
```tsx
"use client";
/*
 * Adapted from React Bits "SwipeToast" (TS-TW), https://reactbits.dev/r/SwipeToast-TS-TW.json
 * (sha256 <sha256>, fetched 2026-10-05). Copyright (c) David Haz. MIT + Commons Clause; see
 * ./LICENSE-react-bits. Not for redistribution as a component kit.
 * Adaptations: tokens and <Icon>; shared springs; m.* under LazyMotion; reduced motion fades;
 * inline mode (grid-template-rows animation) removed; unused props stripped.
 */
import { animate, m, useMotionValue, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon.tsx";
import { cx } from "@/lib/cx.ts";
import { durations, fuse, transitions } from "@/lib/motion-tokens.ts";

export type SwipeToastCloseReason = "timeout" | "swipe" | "action" | "close" | "escape";

export interface SwipeToastProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "danger";
  onClose: (reason: SwipeToastCloseReason) => void;
}

type Sample = [time: number, y: number];
const FLICK = 0.11;
const DEAD_ZONE = 3;
const RESIST_PX = 24;
const SWIPE_DISTANCE = 40;
const rubberband = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
function velocityOf(hist: readonly Sample[]): number {
  const first = hist[0];
  const last = hist[hist.length - 1];
  if (!first || !last || hist.length < 2) return 0;
  return performance.now() - last[0] > 100 ? 0 : (last[1] - first[1]) / Math.max(1, last[0] - first[0]);
}

export function SwipeToast({ title, description, icon, actionLabel, onAction, tone = "neutral", onClose }: SwipeToastProps) {
  const reduce = useReducedMotion();
  const y = useMotionValue(0);
  const fade = useMotionValue(1);
  const cardRef = useRef<HTMLDivElement>(null);
  const fuseRef = useRef<HTMLElement>(null);
  const burn = useRef<Animation | null>(null);
  const drag = useRef<{ id: number; startY: number; grab: number | null; hist: Sample[] } | null>(null);
  const flags = useRef({ hover: false, focus: false, drag: false, hidden: false });
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const close = useCallback((reason: SwipeToastCloseReason) => {
    if (closed.current) return;
    closed.current = true;
    burn.current?.pause();
    onCloseRef.current(reason);
  }, []);

  const syncFuse = useCallback(() => {
    const a = burn.current;
    if (!a) return;
    const f = flags.current;
    if (f.hover || f.focus || f.drag || f.hidden) a.pause();
    else if (a.playState === "paused") a.play();
  }, []);

  useEffect(() => {
    const el = fuseRef.current;
    if (!el) return undefined;
    const a = el.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      duration: durations.toast,
      easing: fuse.easing,
      fill: "forwards",
    });
    a.onfinish = () => close("timeout");
    burn.current = a;
    const onVisibility = () => {
      flags.current.hidden = document.hidden;
      syncFuse();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      a.onfinish = null;
      a.cancel();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [close, syncFuse]);

  const swipeOut = (dy: number, v: number) => {
    if (!reduce && cardRef.current) {
      void animate(y, dy + cardRef.current.offsetHeight, { ...transitions.spring, velocity: v * 1000 });
    }
    void animate(fade, 0, transitions.exit).then(() => close("swipe"));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current || (e.target as HTMLElement).closest("button")) return;
    cardRef.current?.setPointerCapture(e.pointerId);
    y.stop();
    drag.current = { id: e.pointerId, startY: e.clientY, grab: null, hist: [[performance.now(), y.get()]] };
    flags.current.drag = true;
    syncFuse();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.grab === null) {
      if (Math.abs(e.clientY - d.startY) < DEAD_ZONE) return;
      d.grab = e.clientY - y.get();
    }
    const raw = e.clientY - d.grab;
    const next = raw >= 0 ? raw : rubberband(raw, RESIST_PX);
    y.set(reduce ? 0 : next);
    d.hist.push([performance.now(), next]);
    if (d.hist.length > 4) d.hist.shift();
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    flags.current.drag = false;
    const last = d.hist[d.hist.length - 1];
    const dy = last ? last[1] : 0;
    const v = velocityOf(d.hist);
    if (dy > 0 && (v > FLICK || (dy >= SWIPE_DISTANCE && v >= 0))) {
      swipeOut(dy, v);
      return;
    }
    void animate(y, 0, reduce ? transitions.micro : { ...transitions.spring, velocity: v * 1000 });
    syncFuse();
  };

  return (
    <m.div
      ref={cardRef}
      className={cx("toast", tone === "danger" && "toast-danger")}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      tabIndex={0}
      style={{ y, opacity: fade }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") {
          flags.current.hover = true;
          syncFuse();
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          flags.current.hover = false;
          syncFuse();
        }
      }}
      onFocus={() => {
        flags.current.focus = true;
        syncFuse();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          flags.current.focus = false;
          syncFuse();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close("escape");
        }
      }}
    >
      {icon ? <Icon name={icon} /> : null}
      <span className="toast-text">
        <span className="toast-title">{title}</span>
        {description ? <span className="toast-desc">{description}</span> : null}
      </span>
      {actionLabel ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            onAction?.();
            close("action");
          }}
        >
          {actionLabel}
        </button>
      ) : null}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => close("close")}>
        <Icon name="close" size="sm" />
      </button>
      <i ref={fuseRef} className="toast-fuse" aria-hidden="true" />
    </m.div>
  );
}
```

`apps/web/components/toast/toast-provider.tsx`:
```tsx
"use client";

import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { SwipeToast } from "@/components/bits/swipe-toast.tsx";
import type { IconName } from "@/components/ui/icon.tsx";
import { transitions } from "@/lib/motion-tokens.ts";

export interface ToastInput {
  title: string;
  description?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "danger";
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);
const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<ToastInput & { id: number }>>([]);
  const nextId = useRef(0);
  const show = useCallback((toast: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { ...toast, id }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  return (
    <ToastContext value={show}>
      {children}
      <section className="toast-region" aria-label="Notifications">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <m.div key={t.id} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={transitions.spring}>
              <SwipeToast {...t} onClose={() => dismiss(t.id)} />
            </m.div>
          ))}
        </AnimatePresence>
      </section>
    </ToastContext>
  );
}

export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
```

Append to `apps/web/styles/overlays.css`:
```css
.toast-region {
  position: fixed;
  z-index: 110;
  left: 1rem;
  right: 1rem;
  bottom: calc(var(--tabbar-h) + 1rem + env(safe-area-inset-bottom));
  display: grid;
  gap: 0.6rem;
  justify-items: center;
  pointer-events: none;
  @variant md {
    left: auto;
    right: 2rem;
    bottom: 2rem;
    width: min(22.25rem, calc(100vw - 4rem));
  }
}
.toast {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: min(22.25rem, 100%);
  overflow: hidden;
  padding: 0.9rem 0.6rem 0.9rem 1rem;
  border-radius: var(--r-md);
  background: var(--glass);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  box-shadow: var(--e3);
  font-size: 0.8125rem;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  cursor: grab;
  outline-offset: 2px;
}
.toast-danger {
  box-shadow:
    inset 0 0 0 1px var(--danger),
    var(--e3);
}
.toast-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.toast-title {
  font-weight: 500;
}
.toast-desc {
  color: var(--label-2);
}
.toast-action {
  position: relative;
  flex: none;
  min-height: 1.75rem;
  padding: 0 0.6rem;
  border-radius: var(--r-xs);
  background: var(--label);
  color: var(--bg);
  font-size: 0.75rem;
  font-weight: 600;
  transition-property: transform;
  transition-duration: var(--motion-dur-micro);
  transition-timing-function: var(--motion-ease-out);
  &::after {
    content: "";
    position: absolute;
    inset: -0.5rem -0.25rem;
  }
  &:active {
    transform: scale(var(--motion-press));
  }
}
.toast-close {
  position: relative;
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--r-xs);
  color: var(--label-2);
  &::after {
    content: "";
    position: absolute;
    inset: -0.5rem;
  }
}
.toast-fuse {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--tint);
  transform-origin: left center;
}
```

`apps/web/app/providers.tsx`: wrap `children` in `<ToastProvider>` inside `<MotionProvider>`:
```tsx
      <MotionProvider>
        <ToastProvider>{children}</ToastProvider>
      </MotionProvider>
```
Also add `import { ToastProvider } from "@/components/toast/toast-provider.tsx";`.

`apps/web/components/design/sections/toasts.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";

export function ToastsSection() {
  const toast = useToast();
  const [result, setResult] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => toast({ title: "Moved to Papers", icon: "move", actionLabel: "Undo", onAction: () => setResult("Undo pressed") })}>
        Show undo toast
      </Button>
      <Button onClick={() => toast({ title: "Couldn't move the note.", description: "Nothing changed.", icon: "needsReview", tone: "danger" })}>
        Show error toast
      </Button>
      <span className="t-foot" aria-live="polite">{result}</span>
    </div>
  );
}
```
Add `{ id: "toasts", title: "Toasts", Section: ToastsSection }` to `SECTIONS`.

- [ ] **Step 5: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/design.spec.ts`
Expected: PASS in 5 projects.

- [ ] **Step 6: Commit.**

```bash
git add apps/web
git commit -m "feat(web): adapted React Bits SwipeToast with undo provider (sha256 <upstream hash>)"
```

---

### Task 11: App shell (sidebar, icon rail, tab bar)

**Files:**
- Create: `apps/web/components/shell/{app-shell,sidebar,nav-items,recent-notes,kill-banner,user-menu}.tsx` (`nav-items` is `.ts`), `apps/web/lib/hooks/{use-media-query,use-hotkey}.ts`, `apps/web/lib/notes/format.ts`, `apps/web/styles/shell.css`, `apps/web/app/(app)/new/page.tsx`, `apps/web/app/(app)/runs/page.tsx`
- Modify: `apps/web/app/(app)/layout.tsx` (replaces Task 7's pass-through), `apps/web/app/page.tsx`, `apps/web/app/globals.css`
- Test: `apps/web/components/shell/nav-items.test.ts`, `apps/web/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `getViewer` and `Viewer`; `orpc`; the controls.
- Produces:
  - **`NAV_ITEMS`** (New task, Runs, Library, Vault, Settings; mockup D order) and `isNavActive(pathname, href)`.
  - **`<AppShell viewer>`**, rendered by `app/(app)/layout.tsx` behind the session guard. It contains:
    - `<Sidebar>`: full sidebar above 1180 px, icon rail at 821–1180, bottom tab bar at ≤ 820;
    - a skip link;
    - `<main id="main">`;
    - `<KillBanner>`.
  - `useMediaQuery(query)` and `useHotkey({key, meta?}, handler)`.
  - **`lib/notes/format.ts`:** `KIND_LABEL`, `noteKindIcon(note)`, `FIDELITY_META`, `formatDate(iso)`, `formatDateTime(iso)`, `hostOf(url)`, `pathOf(url)`, `formatTimestamp(seconds)`.
  - **`/` redirects to `/library`.** `/new` and `/runs` render a minimal page that F3 replaces.
  - **`Sidebar` exposes a `libraryTree` slot** (Task 13 passes the folder tree).

- [ ] **Step 1: Write the failing tests.**

`apps/web/components/shell/nav-items.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavActive } from "./nav-items.ts";

describe("navigation", () => {
  it("keeps mockup D's items and order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["New task", "Runs", "Library", "Vault", "Settings"]);
  });
  it("marks nested routes and notes as part of Library", () => {
    expect(isNavActive("/library", "/library")).toBe(true);
    expect(isNavActive("/notes/abc", "/library")).toBe(true);
    expect(isNavActive("/settings/usage", "/settings")).toBe(true);
    expect(isNavActive("/runs", "/library")).toBe(false);
  });
});
```

`apps/web/e2e/shell.spec.ts`:
```ts
import { expect, expectCleanScreen, isCompact, isWide, test } from "./helpers/test.ts";

test("shell adapts: sidebar, icon rail or tab bar, with every destination reachable", async ({ page }) => {
  await page.goto("/library");
  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const name of ["New task", "Runs", "Library", "Vault", "Settings"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  if (isWide(page)) {
    await expect(page.getByText("Recent notes")).toBeVisible();
  } else {
    await expect(page.getByText("Recent notes")).toBeHidden();
  }
  if (isCompact(page)) {
    const box = await nav.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan((page.viewportSize()?.height ?? 0) / 2);
  }
  await expectCleanScreen(page);
});

test("skip link moves focus to the main content", async ({ page }) => {
  await page.goto("/library");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("shows the kill-switch banner while the switch is on", async ({ page, request }) => {
  await request.post("/api/rpc/settings/setKillSwitch", { data: { json: { on: true } } });
  await page.goto("/library");
  await expect(page.getByRole("status").filter({ hasText: "Kill switch is on." })).toBeVisible();
});

test.describe("signed out", () => {
  test.use({ signedOut: true });
  test("redirects to sign-in", async ({ page }) => {
    await page.goto("/library");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
```

The kill-switch test posts through `request`, which shares the context cookies, so it hits the same fixture namespace. oRPC's RPC protocol wraps the input as `{ json: … }`.

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/components/shell && pnpm test:ui -- e2e/shell.spec.ts --project=w1440`
Expected: FAIL, because the modules and routes are missing. `/sign-in` is created in Task 12, so the redirect test FAILs until then.

- [ ] **Step 3: Implement.**

`apps/web/components/shell/nav-items.ts`:
```ts
import type { IconName } from "@/components/ui/icon.tsx";

export const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/new", label: "New task", icon: "newTask" },
  { href: "/runs", label: "Runs", icon: "runs" },
  { href: "/library", label: "Library", icon: "library" },
  { href: "/vault", label: "Vault", icon: "vault" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  return href === "/library" && pathname.startsWith("/notes/");
}
```

`apps/web/lib/hooks/use-media-query.ts`:
```ts
import { useCallback, useSyncExternalStore } from "react";

/** Live media-query match; false during SSR. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
```

`apps/web/lib/hooks/use-hotkey.ts`:
```ts
import { useEffect, useEffectEvent } from "react";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** ⌘/Ctrl+key (meta) or a bare key outside text fields. Never use browser-reserved combos (⌘N/T/W/L). */
export function useHotkey(combo: { key: string; meta?: boolean }, handler: (event: KeyboardEvent) => void): void {
  const onKey = useEffectEvent(handler);
  const { key, meta = false } = combo;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key) return;
      if ((event.metaKey || event.ctrlKey) !== meta) return;
      if (!meta && isTyping(event.target)) return;
      event.preventDefault();
      onKey(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [key, meta]);
}
```

`apps/web/lib/notes/format.ts`:
```ts
import type { Fidelity, NoteSummary, SourceKind } from "@mastertutor/contracts";
import type { BadgeTone } from "@/components/ui/badge.tsx";
import { SOURCE_KIND_ICON, type IconName } from "@/components/ui/icons.ts";

export const KIND_LABEL: Record<SourceKind, string> = { web: "Web page", pdf: "PDF", youtube: "Video" };

export function noteKindIcon(note: Pick<NoteSummary, "sourceKinds">): IconName {
  return SOURCE_KIND_ICON[note.sourceKinds[0] ?? "web"];
}

export const FIDELITY_META: Record<Fidelity, { label: string; tone: BadgeTone; icon: IconName }> = {
  verified: { label: "Verified", tone: "ok", icon: "verified" },
  partial: { label: "Partial", tone: "warn", icon: "partial" },
  needs_review: { label: "Needs review", tone: "warn", icon: "needsReview" },
};

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return "";
  }
}

/** 768 → "12:48"; 3725 → "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm.padStart(2, "0")}:${ss}`;
}
```

`apps/web/components/shell/recent-notes.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Icon } from "@/components/ui/icon.tsx";
import { orpc } from "@/lib/api/client.ts";
import { noteKindIcon } from "@/lib/notes/format.ts";

export function RecentNotes() {
  const { data } = useQuery(orpc.notes.list.queryOptions({ input: { limit: 5 } }));
  if (!data?.items.length) return null;
  return (
    <div className="sidebar-section">
      <h2 className="eyebrow sidebar-heading">Recent notes</h2>
      <ul className="recent">
        {data.items.map((note) => (
          <li key={note.id}>
            <Link href={`/notes/${note.id}`} className="recent-item">
              <Icon name={noteKindIcon(note)} size="sm" />
              <span className="recent-title">{note.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`apps/web/components/shell/user-menu.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import type { Viewer } from "@/lib/server/viewer.ts";

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

export function UserMenu({ viewer, onSignOut }: { viewer: Viewer; onSignOut: () => Promise<void> }) {
  const router = useRouter();
  return (
    <Menu.Root>
      <Menu.Trigger className="me" aria-label={`Account: ${viewer.name}`}>
        <span className="avatar" aria-hidden="true">
          {initials(viewer.name)}
        </span>
        <span className="me-text">
          <b>{viewer.name}</b>
          <small>{viewer.email}</small>
        </span>
      </Menu.Trigger>
      <MenuPanel align="start">
        <MenuItem icon="settings" onSelect={() => router.push("/settings")}>
          Settings
        </MenuItem>
        <MenuItem icon="signOut" onSelect={() => void onSignOut()}>
          Sign out
        </MenuItem>
      </MenuPanel>
    </Menu.Root>
  );
}
```

`Viewer` is a type-only import from a server module. `import type` erases it, so no server code reaches the client bundle.

`apps/web/components/shell/kill-banner.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Icon } from "@/components/ui/icon.tsx";
import { orpc } from "@/lib/api/client.ts";

export function KillBanner() {
  const { data } = useQuery(orpc.settings.get.queryOptions({ input: {} }));
  if (!data?.killSwitch) return null;
  return (
    <div className="kill-banner" role="status">
      <Icon name="stop" />
      <span>
        <b>Kill switch is on.</b> No run will start until you turn it off.
      </span>
      <Link href="/settings">Settings</Link>
    </div>
  );
}
```

`apps/web/components/shell/sidebar.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { orpc } from "@/lib/api/client.ts";
import type { Viewer } from "@/lib/server/viewer.ts";
import { NAV_ITEMS, isNavActive } from "./nav-items.ts";
import { RecentNotes } from "./recent-notes.tsx";
import { UserMenu } from "./user-menu.tsx";

export function Sidebar({ viewer, onSignOut, libraryTree }: { viewer: Viewer; onSignOut: () => Promise<void>; libraryTree?: ReactNode }) {
  const pathname = usePathname();
  const live = useQuery(orpc.runs.list.queryOptions({ input: { status: "running", limit: 20 } }));
  const liveCount = live.data?.items.length ?? 0;
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="agentNote" size="sm" />
        </span>
        <span className="brand-text">
          <b>MasterTutor</b>
          <small>Faithful notes, by agent</small>
        </span>
      </div>
      <nav className="nav" aria-label="Primary">
        <ul>
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} className="nav-item" aria-current={active ? "page" : undefined}>
                  <Icon name={item.icon} />
                  <span className="nav-label">{item.label}</span>
                  {item.href === "/runs" && liveCount > 0 ? (
                    <span className="nav-meta">
                      <span className="live-dot" aria-hidden="true" />
                      <span className="nav-meta-text">{liveCount} live</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {libraryTree ? <div className="sidebar-section">{libraryTree}</div> : null}
      <RecentNotes />
      <div className="sidebar-foot">
        <UserMenu viewer={viewer} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}
```

`apps/web/components/shell/app-shell.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { Viewer } from "@/lib/server/viewer.ts";
import { KillBanner } from "./kill-banner.tsx";
import { Sidebar } from "./sidebar.tsx";

export function AppShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const router = useRouter();
  const signOut = async () => {
    const { authClient } = await import("@/lib/auth-client.ts");
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar viewer={viewer} onSignOut={signOut} />
      <main id="main" className="main" tabIndex={-1}>
        <KillBanner />
        {children}
      </main>
    </div>
  );
}
```

`authClient` is created in Task 12. Until Task 12 lands, typecheck fails on that import, so Tasks 11 and 12 commit together if executed back-to-back. Otherwise create `apps/web/lib/auth-client.ts` in this task as written in Task 12, Step 3.

`apps/web/app/(app)/layout.tsx` (replace the file):
```tsx
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell.tsx";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
```

`apps/web/app/page.tsx` (replace the file):
```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/library");
}
```

`apps/web/app/(app)/new/page.tsx` (F3 replaces this file):
```tsx
import type { Metadata } from "next";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";

export const metadata: Metadata = { title: "New task" };

export default function NewTaskPage() {
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "New task" }]} />
      </Toolbar>
      <div className="wrap">
        <PageHead title="Take notes on" lede="Describe a source and the agent opens its own browser to capture it." />
      </div>
    </>
  );
}
```

`apps/web/app/(app)/runs/page.tsx` (F3 replaces this file):
```tsx
import type { Metadata } from "next";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";

export const metadata: Metadata = { title: "Runs" };

export default function RunsPage() {
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Runs" }]} />
      </Toolbar>
      <div className="wrap">
        <PageHead title="Runs" lede="Every task the agent has worked on." />
      </div>
    </>
  );
}
```

`apps/web/styles/shell.css` (import it in `globals.css` after `overlays.css`):
```css
.app {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100dvh;
  isolation: isolate;
  @variant md {
    grid-template-columns: var(--rail-w) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  @variant lg {
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
  }
  &::before {
    content: "";
    position: fixed;
    left: -6rem;
    top: -6rem;
    width: 26rem;
    height: 26rem;
    border-radius: 50%;
    background: radial-gradient(circle, var(--ambient), transparent 70%);
    pointer-events: none;
    z-index: -1;
  }
}
.skip-link {
  position: absolute;
  left: 0.75rem;
  top: 0.75rem;
  z-index: 200;
  padding: 0.5rem 0.75rem;
  border-radius: var(--r-sm);
  background: var(--elevated);
  box-shadow: var(--e2);
  opacity: 0;
  pointer-events: none;
  &:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }
}
.main {
  position: relative;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  outline: none;
}
.sidebar {
  order: 2;
  position: relative;
  z-index: 10;
  display: flex;
  padding: 0.25rem 0.5rem calc(0.25rem + env(safe-area-inset-bottom));
  background: var(--glass-side);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border-top: 0.5px solid var(--glass-line);
  @variant md {
    order: 0;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 1rem 0.5rem;
    overflow: auto;
    border-top: 0;
    border-right: 1px solid var(--glass-line);
  }
  @variant lg {
    align-items: stretch;
    padding: 1rem 0.75rem;
  }
}
.brand {
  display: none;
  @variant md {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.25rem 0 1rem;
  }
  @variant lg {
    padding: 0.25rem 0.5rem 1.1rem;
  }
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--r-sm);
  background: var(--label);
  color: var(--bg);
}
.brand-text {
  display: none;
  @variant lg {
    display: block;
  }
  & b {
    display: block;
    font: 700 1rem/1 var(--font-display);
    letter-spacing: -0.02em;
  }
  & small {
    display: block;
    margin-top: 0.15rem;
    font-size: 0.6875rem;
    color: var(--label-2);
  }
}
.nav {
  width: 100%;
  & ul {
    display: flex;
    justify-content: space-around;
    margin: 0;
    padding: 0;
    list-style: none;
    @variant md {
      flex-direction: column;
      gap: 2px;
    }
  }
}
.nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  min-width: var(--hit);
  min-height: 3.125rem;
  padding: 0.25rem;
  border-radius: var(--r-sm);
  color: var(--label-2);
  font-size: 0.625rem;
  font-weight: 500;
  text-decoration: none;
  transition-property: transform;
  transition-duration: var(--motion-dur-micro);
  transition-timing-function: var(--motion-ease-out);
  &:hover {
    text-decoration: none;
  }
  &:active {
    transform: scale(var(--motion-press-row));
  }
  &[aria-current="page"] {
    color: var(--tint-text);
  }
  @variant md {
    flex-direction: row;
    width: var(--hit);
    min-height: var(--hit);
    padding: 0;
    color: var(--label);
    & .ic {
      color: var(--tint-text);
    }
    &:hover {
      background: var(--fill-2);
    }
    &[aria-current="page"] {
      background: var(--fill);
      color: var(--label);
    }
  }
  @variant lg {
    justify-content: flex-start;
    width: 100%;
    min-height: 2.375rem;
    gap: 0.65rem;
    padding: 0 0.6rem;
    font-size: 0.8125rem;
  }
}
.nav-label {
  @variant md {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  @variant lg {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip: auto;
  }
}
.nav-meta {
  position: absolute;
  top: 0.35rem;
  right: calc(50% - 1.1rem);
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--label-2);
  @variant md {
    right: 0.35rem;
  }
  @variant lg {
    position: static;
    margin-left: auto;
  }
}
.nav-meta-text {
  display: none;
  @variant lg {
    display: inline;
  }
}
.live-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--signal);
  animation-name: pulse;
  animation-duration: var(--motion-dur-pulse);
  animation-timing-function: var(--motion-ease-out);
  animation-iteration-count: infinite;
}
.sidebar-section {
  display: none;
  @variant lg {
    display: block;
    margin-top: 1.25rem;
  }
}
.sidebar-heading {
  margin: 0 0.6rem 0.35rem;
}
.recent {
  margin: 0;
  padding: 0;
  list-style: none;
}
.recent-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.25rem;
  padding: 0 0.6rem;
  border-radius: var(--r-sm);
  color: var(--label);
  font-size: 0.78rem;
  &:hover {
    background: var(--fill-2);
    text-decoration: none;
  }
  & .ic {
    color: var(--label-2);
  }
}
.recent-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-foot {
  display: none;
  @variant md {
    display: block;
    margin-top: auto;
    padding-top: 0.75rem;
  }
  @variant lg {
    border-top: 1px solid var(--sep);
  }
}
.me {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  min-height: var(--hit);
  padding: 0.35rem;
  border-radius: var(--r-sm);
  text-align: left;
  &:hover {
    background: var(--fill-2);
  }
}
.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--label-2);
  color: var(--bg);
  font-size: 0.6875rem;
  font-weight: 600;
}
.me-text {
  display: none;
  min-width: 0;
  @variant lg {
    display: block;
  }
  & b {
    display: block;
    font-size: 0.78rem;
    font-weight: 600;
  }
  & small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6875rem;
    color: var(--label-2);
  }
}
.kill-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin: 0.75rem 1rem 0;
  padding: 0.7rem 1rem;
  border-radius: var(--r-md);
  background: var(--signal-wash);
  color: var(--label);
  font-size: 0.8125rem;
  & .ic {
    color: var(--signal);
  }
  & > span {
    flex: 1;
    min-width: 12rem;
  }
  @variant md {
    margin: 1rem 1.5rem 0;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/components/shell && pnpm lint && pnpm test:ui -- e2e/shell.spec.ts`
Expected: PASS in 5 projects, except the "signed out" redirect, which passes once Task 12 adds `/sign-in`.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): app shell with glass sidebar, icon rail and tab bar; session guard; kill-switch banner"
```

---

### Task 12: Auth screens

**Files:**
- Create: `apps/web/lib/auth-client.ts`, `apps/web/app/(auth)/layout.tsx`, `apps/web/app/(auth)/sign-in/page.tsx`, `apps/web/app/(auth)/sign-up/page.tsx`, `apps/web/components/auth/auth-form.tsx`
- Modify: `apps/web/playwright.config.ts` (`webServer.url` back to `/sign-in`), `apps/web/styles/shell.css`
- Test: `apps/web/lib/auth-client.test.ts`, `apps/web/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: Better Auth (Phase 0: email and password, minimum 12 characters, sign-up closed after the first user); `getViewer`.
- Produces:
  - **`authClient`** (`createAuthClient` from `better-auth/react`).
  - **`authErrorCopy(error: {status?: number; code?: string}): string`.**
  - **`/sign-in` and `/sign-up`.** They redirect to `/library` when already signed in.
  - **`<AuthForm mode>`.**

- [ ] **Step 1: Write the failing tests.**

Set `webServer.url` in `playwright.config.ts` back to `` `${baseURL}/sign-in` ``.

`apps/web/lib/auth-client.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { authErrorCopy } from "./auth-client.ts";

describe("authErrorCopy", () => {
  it("explains wrong credentials without blame", () => {
    expect(authErrorCopy({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("That email and password don't match.");
  });
  it("explains closed sign-up", () => {
    expect(authErrorCopy({ status: 403 })).toBe("Sign-up is closed. Ask the workspace owner to invite you.");
  });
  it("explains an existing account", () => {
    expect(authErrorCopy({ status: 422, code: "USER_ALREADY_EXISTS" })).toBe("An account with this email already exists. Sign in instead.");
  });
  it("falls back politely", () => {
    expect(authErrorCopy({ status: 500 })).toBe("Couldn't reach the server. Try again.");
  });
});
```

`apps/web/e2e/auth.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test.use({ signedOut: true });

test("sign-in screen is clean and labelled", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  await expectCleanScreen(page);
});

test("shows a calm error on wrong credentials and keeps the email", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({ status: 401, json: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } }),
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("sam@example.test");
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match.");
  await expect(page.getByLabel("Email")).toHaveValue("sam@example.test");
});

test("signs in and lands in the library", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 200,
      headers: { "set-cookie": "mt_fixture_auth=signed-in; Path=/" },
      json: { redirect: false, token: "t", user: { id: "fixture-user", email: "sam@example.test", name: "Sam Lee" } },
    }),
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("sam@example.test");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test("sign-up enforces 12-character passwords and explains closed sign-up", async ({ page }) => {
  await page.route("**/api/auth/sign-up/email", (route) => route.fulfill({ status: 403, json: { code: "FORBIDDEN" } }));
  await page.goto("/sign-up");
  await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "12");
  await page.getByLabel("Name").fill("Sam Lee");
  await page.getByLabel("Email").fill("sam@example.test");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toHaveText("Sign-up is closed. Ask the workspace owner to invite you.");
  await expectCleanScreen(page);
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/auth-client && pnpm test:ui -- e2e/auth.spec.ts --project=w1440`
Expected: FAIL, because the modules and routes are missing.

- [ ] **Step 3: Implement.**

`apps/web/lib/auth-client.ts`:
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

/** Fixed copy for auth failures; never echoes server messages. */
export function authErrorCopy(error: { status?: number; code?: string }): string {
  if (error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD") return "That email and password don't match.";
  if (error.status === 403) return "Sign-up is closed. Ask the workspace owner to invite you.";
  if (error.code === "USER_ALREADY_EXISTS" || error.status === 422) return "An account with this email already exists. Sign in instead.";
  if (error.code === "PASSWORD_TOO_SHORT") return "Use at least 12 characters.";
  return "Couldn't reach the server. Try again.";
}
```

`apps/web/components/auth/auth-form.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { authClient, authErrorCopy } from "@/lib/auth-client.ts";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signUp = mode === "sign-up";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    setPending(true);
    setError(null);
    const result = signUp
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(authErrorCopy(result.error));
      return;
    }
    router.replace("/library");
    router.refresh();
  }

  return (
    <form className="auth-card" onSubmit={onSubmit} noValidate={false}>
      <h1 className="t-title1">{signUp ? "Create account" : "Sign in"}</h1>
      <p className="t-callout muted">{signUp ? "The first account owns this workspace." : "Welcome back."}</p>
      <div className="auth-fields">
        {signUp ? <TextField name="name" label="Name" autoComplete="name" required /> : null}
        <TextField name="email" type="email" label="Email" autoComplete="email" inputMode="email" required />
        <TextField
          name="password"
          type="password"
          label="Password"
          autoComplete={signUp ? "new-password" : "current-password"}
          minLength={signUp ? 12 : undefined}
          hint={signUp ? "At least 12 characters." : undefined}
          required
        />
      </div>
      {error ? (
        <p className="tf-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {signUp ? "Create account" : "Sign in"}
      </Button>
      <p className="t-foot">
        {signUp ? (
          <>
            Have an account? <Link href="/sign-in">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/sign-up">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
```

`apps/web/app/(auth)/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getViewer()) redirect("/library");
  return (
    <main className="auth-page" id="main">
      <div className="auth-brand">
        <b>MasterTutor</b>
        <span className="muted">Faithful notes, by agent</span>
      </div>
      {children}
    </main>
  );
}
```

`apps/web/app/(auth)/sign-in/page.tsx`:
```tsx
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form.tsx";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <AuthForm mode="sign-in" />;
}
```

`apps/web/app/(auth)/sign-up/page.tsx`:
```tsx
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form.tsx";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
```

Append to `apps/web/styles/shell.css`:
```css
.auth-page {
  display: grid;
  place-content: center;
  gap: 1.5rem;
  min-height: 100dvh;
  padding: 2rem 1rem;
}
.auth-brand {
  display: grid;
  justify-items: center;
  gap: 0.2rem;
  & b {
    font: 700 1.25rem/1 var(--font-display);
    letter-spacing: -0.02em;
  }
}
.auth-card {
  display: grid;
  gap: 1rem;
  width: min(24rem, calc(100vw - 2rem));
  padding: 1.5rem;
  border-radius: var(--r-xl);
  background: var(--elevated);
  box-shadow: var(--e2);
}
.auth-fields {
  display: grid;
  gap: 0.9rem;
}
```

- [ ] **Step 4: Run all tests to verify they pass.**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/auth.spec.ts e2e/shell.spec.ts`
Expected: PASS in 5 projects, including the signed-out redirect.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): sign-in and sign-up screens on Better Auth with calm, non-echoing errors"
```

---

## F2: Library, folders and the note reader/editor

### Task 13: Folder tree (sidebar and sheet), folder CRUD, drag sources

**Files:**
- Create: `apps/web/lib/folders/drag.ts`, `apps/web/lib/library/params.ts`, `apps/web/components/library/{folder-tree,folder-name-sheet,folder-actions}.tsx`, `apps/web/styles/library.css`, `apps/web/app/(app)/library/page.tsx`, `apps/web/components/library/library-view.tsx`
- Modify: `apps/web/components/shell/app-shell.tsx`, `apps/web/app/globals.css`
- Test: `apps/web/lib/library/params.test.ts`, `apps/web/e2e/folders.spec.ts`

**Interfaces:**
- Consumes: `buildFolderTree`, `flattenVisible`, `folderPath`, `canMoveFolder` and `canCreateFolder` (Task 5); `orpc` and `api`; `useToast`; `Sheet`; `ConfirmDialog`; `Menu`.
- Produces:
  - **`lib/library/params.ts`:** `LibraryParams {folder: "all"|"unfiled"|string; kind: SourceKind|null; view: "grid"|"list"; q: string}`, `parseLibraryParams(search)`, `libraryHref(params)`.
  - **`lib/folders/drag.ts`:** `NOTE_DRAG_TYPE`, `FOLDER_DRAG_TYPE`, `setDragged(item|null)`, `getDragged()`.
  - **`<FolderTree onNavigate? onDropNote(noteId, folderId|null)>`.** It is a WAI-ARIA tree with roving focus and drop targets for notes and folders. Folder moves are optimistic, with an error rollback toast.
  - **`<FolderNameSheet mode="create"|"rename" …>`** and **`<FolderActions scope>`** (the library toolbar menu: New folder, New subfolder, Rename, Delete).
  - **`/library`:** this task gives a minimal `LibraryView` with toolbar and folder scope. Task 14 fills it.
  - **The sidebar shows `<FolderTree>` above 1180 px.** Notes drop through `onDropNote`, which Task 15 wires.

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/library/params.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { libraryHref, parseLibraryParams } from "./params.ts";

const parse = (qs: string) => parseLibraryParams(new URLSearchParams(qs));
const uuid = "00000000-0000-4000-8000-000001000002";

describe("library params", () => {
  it("defaults safely", () => {
    expect(parse("")).toEqual({ folder: "all", kind: null, view: "grid", q: "" });
  });
  it("accepts folder ids, unfiled, kinds and list view", () => {
    expect(parse(`folder=${uuid}&kind=pdf&view=list&q=warmup`)).toEqual({ folder: uuid, kind: "pdf", view: "list", q: "warmup" });
    expect(parse("folder=unfiled").folder).toBe("unfiled");
  });
  it("rejects junk", () => {
    expect(parse("folder=../etc&kind=exe&view=table")).toEqual({ folder: "all", kind: null, view: "grid", q: "" });
  });
  it("builds minimal hrefs", () => {
    expect(libraryHref({ folder: "all", kind: null, view: "grid", q: "" })).toBe("/library");
    expect(libraryHref({ folder: uuid, kind: "web", view: "list", q: "" })).toBe(`/library?folder=${uuid}&kind=web&view=list`);
  });
});
```

`apps/web/e2e/folders.spec.ts`:
```ts
import { expect, expectCleanScreen, isWide, test } from "./helpers/test.ts";

async function openTree(page: import("@playwright/test").Page) {
  if (!isWide(page)) await page.getByRole("button", { name: "Folders" }).click();
  return page.getByRole("tree", { name: "Folders" });
}

test("tree shows nested folders, navigates, and supports arrow keys", async ({ page }) => {
  await page.goto("/library");
  const tree = await openTree(page);
  await tree.getByRole("treeitem", { name: "Machine learning" }).click();
  await expect(page).toHaveURL(/folder=00000000-0000-4000-8000-000001000001/);
  const tree2 = await openTree(page);
  const ml = tree2.getByRole("treeitem", { name: "Machine learning" });
  await ml.focus();
  await page.keyboard.press("ArrowRight");
  await expect(ml).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(tree2.getByRole("treeitem", { name: "Optimization" })).toBeFocused();
  await expectCleanScreen(page);
});

test("creates, renames and deletes a folder with a safe default", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Reading list");
  await page.getByRole("button", { name: "Create" }).click();
  const tree = await openTree(page);
  await expect(tree.getByRole("treeitem", { name: "Reading list" })).toBeVisible();
  await tree.getByRole("treeitem", { name: "Reading list" }).click();

  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Folder name").fill("Reading");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Reading");

  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "Delete folder…" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Delete Folder" }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test("refuses a duplicate name with a field error", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("databases");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("alert")).toHaveText("A folder with that name already exists here.");
});

test("dragging a folder into its own subfolder is refused (Review Focus 4)", async ({ page }) => {
  test.skip(!isWide(page), "drag targets live in the wide sidebar");
  await page.goto("/library");
  const tree = page.getByRole("tree", { name: "Folders" });
  await tree.getByRole("treeitem", { name: "Machine learning" }).focus();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Machine learning" }).dragTo(tree.getByRole("treeitem", { name: "Optimization" }));
  await expect(tree.getByRole("treeitem", { name: "Machine learning" })).toHaveAttribute("aria-level", "1");
  await tree.getByRole("treeitem", { name: "Papers" }).dragTo(tree.getByRole("treeitem", { name: "Databases" }));
  await expect(tree.getByRole("treeitem", { name: "Papers" })).toHaveAttribute("aria-level", "2");
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/library && pnpm test:ui -- e2e/folders.spec.ts --project=w1440`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement.**

`apps/web/lib/library/params.ts`:
```ts
import { SourceKind, Uuid } from "@mastertutor/contracts";

export type LibraryScope = "all" | "unfiled" | (string & {});
export type LibraryViewMode = "grid" | "list";

export interface LibraryParams {
  folder: LibraryScope;
  kind: SourceKind | null;
  view: LibraryViewMode;
  q: string;
}

export function parseLibraryParams(search: { get(name: string): string | null }): LibraryParams {
  const folderRaw = search.get("folder");
  const folder: LibraryScope =
    folderRaw === "unfiled" ? "unfiled" : folderRaw !== null && Uuid.safeParse(folderRaw).success ? folderRaw : "all";
  const kind = SourceKind.safeParse(search.get("kind"));
  return {
    folder,
    kind: kind.success ? kind.data : null,
    view: search.get("view") === "list" ? "list" : "grid",
    q: (search.get("q") ?? "").slice(0, 500),
  };
}

export function libraryHref(params: Partial<LibraryParams>): string {
  const search = new URLSearchParams();
  if (params.folder && params.folder !== "all") search.set("folder", params.folder);
  if (params.kind) search.set("kind", params.kind);
  if (params.view === "list") search.set("view", "list");
  if (params.q) search.set("q", params.q);
  const qs = search.toString();
  return qs ? `/library?${qs}` : "/library";
}
```

`apps/web/lib/folders/drag.ts`:
```ts
/** Same-document drag payload (dataTransfer values are unreadable during dragover). */
export const NOTE_DRAG_TYPE = "application/x-mastertutor-note";
export const FOLDER_DRAG_TYPE = "application/x-mastertutor-folder";

export type DraggedItem = { kind: "note"; id: string } | { kind: "folder"; id: string };

let current: DraggedItem | null = null;
export const setDragged = (item: DraggedItem | null) => {
  current = item;
};
export const getDragged = () => current;
```

`apps/web/components/library/folder-tree.tsx`:
```tsx
"use client";

import type { FolderView } from "@mastertutor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/ui/icon.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { cx } from "@/lib/cx.ts";
import { FOLDER_DRAG_TYPE, NOTE_DRAG_TYPE, getDragged, setDragged } from "@/lib/folders/drag.ts";
import { buildFolderTree, canMoveFolder, flattenVisible, folderPath, type FolderNode } from "@/lib/folders/tree.ts";
import { libraryHref, parseLibraryParams, type LibraryScope } from "@/lib/library/params.ts";

type Row =
  | { key: "all" | "unfiled"; label: string; icon: IconName; level: 1; node: null }
  | { key: string; label: string; icon: IconName; level: number; node: FolderNode };

export function FolderTree({ onNavigate, onDropNote }: { onNavigate?: () => void; onDropNote: (noteId: string, folderId: string | null) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = parseLibraryParams(search);
  const scope: LibraryScope = pathname.startsWith("/library") ? params.folder : "";
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery(orpc.folders.tree.queryOptions({ input: {} }));
  const folders = useMemo(() => data?.folders ?? [], [data]);
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(scope !== "all" && scope !== "unfiled" ? folderPath(folders, scope).map((f) => f.id) : []),
  );
  const rows: Row[] = useMemo(
    () => [
      { key: "all", label: "All notes", icon: "allNotes", level: 1, node: null },
      { key: "unfiled", label: "Unfiled", icon: "unfiled", level: 1, node: null },
      ...flattenVisible(tree, expanded).map((node) => ({
        key: node.folder.id,
        label: node.folder.name,
        icon: (expanded.has(node.folder.id) ? "folderOpen" : node.children.length ? "folderNested" : "folder") as IconName,
        level: node.depth,
        node,
      })),
    ],
    [t```tsx
    [tree, expanded],
  );
  const [focusKey, setFocusKey] = useState<string>(scope === "" ? "all" : scope);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLLIElement>());

  const go = (key: string) => {
    router.push(libraryHref({ ...params, folder: key, q: "" }));
    onNavigate?.();
  };
  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setFocusKey(key);
    refs.current.get(key)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = rows.findIndex((r) => r.key === focusKey);
    const row = rows[index];
    if (!row) return;
    const handled = () => event.preventDefault();
    switch (event.key) {
      case "ArrowDown":
        handled();
        focusRow(rows[Math.min(rows.length - 1, index + 1)]?.key);
        break;
      case "ArrowUp":
        handled();
        focusRow(rows[Math.max(0, index - 1)]?.key);
        break;
      case "Home":
        handled();
        focusRow(rows[0]?.key);
        break;
      case "End":
        handled();
        focusRow(rows[rows.length - 1]?.key);
        break;
      case "ArrowRight":
        if (row.node?.children.length) {
          handled();
          if (!expanded.has(row.key)) toggle(row.key, true);
          else focusRow(row.node.children[0]?.folder.id);
        }
        break;
      case "ArrowLeft":
        if (row.node) {
          handled();
          if (expanded.has(row.key)) toggle(row.key, false);
          else if (row.node.folder.parentId) focusRow(row.node.folder.parentId);
        }
        break;
      case "Enter":
      case " ":
        handled();
        go(row.key);
        break;
    }
  };

  const moveFolder = async (folderId: string, parentId: string | null) => {
    const key = orpc.folders.tree.queryKey({ input: {} });
    const previous = qc.getQueryData<{ folders: FolderView[] }>(key);
    qc.setQueryData<{ folders: FolderView[] }>(key, (old) =>
      old ? { folders: old.folders.map((f) => (f.id === folderId ? { ...f, parentId } : f)) } : old,
    );
    try {
      await api.folders.move({ folderId, parentId });
    } catch {
      qc.setQueryData(key, previous);
      toast({ title: "Couldn't move the folder.", description: "Nothing changed.", icon: "needsReview", tone: "danger" });
    } finally {
      await qc.invalidateQueries({ queryKey: key });
    }
  };

  const accepts = (row: Row, event: DragEvent): boolean => {
    const dragged = getDragged();
    const types = event.dataTransfer.types;
    if (dragged?.kind === "note" && types.includes(NOTE_DRAG_TYPE)) return row.key !== "all";
    if (dragged?.kind === "folder" && types.includes(FOLDER_DRAG_TYPE)) {
      if (row.key === "unfiled") return false;
      const parentId = row.key === "all" ? null : row.key;
      return canMoveFolder(folders, dragged.id, parentId) && dragged.id !== row.key;
    }
    return false;
  };

  const onDrop = (row: Row, event: DragEvent) => {
    event.preventDefault();
    setDropKey(null);
    const dragged = getDragged();
    setDragged(null);
    if (!dragged || !accepts(row, event)) return;
    const target = row.key === "all" || row.key === "unfiled" ? null : row.key;
    if (dragged.kind === "note") onDropNote(dragged.id, target);
    else void moveFolder(dragged.id, target);
  };

  return (
    <ul role="tree" aria-label="Folders" className="tree" onKeyDown={onKeyDown}>
      {rows.map((row) => {
        const current = row.key === scope;
        const isFolder = row.node !== null;
        return (
          <li
            key={row.key}
            ref={(el) => {
              if (el) refs.current.set(row.key, el);
              else refs.current.delete(row.key);
            }}
            role="treeitem"
            aria-level={row.level}
            aria-selected={current}
            aria-expanded={row.node?.children.length ? expanded.has(row.key) : undefined}
            aria-label={row.label}
            tabIndex={row.key === focusKey ? 0 : -1}
            className={cx("tree-row", current && "tree-row-current", dropKey === row.key && "tree-row-drop")}
            style={{ paddingInlineStart: `${0.6 + (row.level - 1) * 0.875}rem` }}
            draggable={isFolder}
            onFocus={() => setFocusKey(row.key)}
            onClick={() => go(row.key)}
            onDragStart={(e) => {
              if (!isFolder) return;
              setDragged({ kind: "folder", id: row.key });
              e.dataTransfer.setData(FOLDER_DRAG_TYPE, row.key);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDragged(null)}
            onDragOver={(e) => {
              if (accepts(row, e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropKey(row.key);
              }
            }}
            onDragLeave={() => setDropKey((k) => (k === row.key ? null : k))}
            onDrop={(e) => onDrop(row, e)}
          >
            {row.node?.children.length ? (
              <span
                className="tree-disclosure"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(row.key);
                }}
              >
                <Icon name={expanded.has(row.key) ? "chevronDown" : "chevronRight"} size="sm" />
              </span>
            ) : (
              <span className="tree-disclosure" aria-hidden="true" />
            )}
            <Icon name={row.icon} size="sm" />
            <span className="tree-label">{row.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

`apps/web/components/library/folder-name-sheet.tsx`:
```tsx
"use client";

import { FolderName } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { errorCopy } from "@/lib/api/errors.ts";

export type FolderNameTarget =
  | { mode: "create"; parentId: string | null; parentName: string | null }
  | { mode: "rename"; folderId: string; name: string };

export function FolderNameSheet({ target, onClose, onDone }: { target: FolderNameTarget | null; onClose: () => void; onDone?: (folderId: string) => void }) {
  return target ? <FolderNameForm key={target.mode === "rename" ? target.folderId : `new-${target.parentId}`} target={target} onClose={onClose} onDone={onDone} /> : null;
}

function FolderNameForm({ target, onClose, onDone }: { target: FolderNameTarget; onClose: () => void; onDone?: (folderId: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(target.mode === "rename" ? target.name : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const creating = target.mode === "create";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = FolderName.safeParse(name);
    if (!parsed.success) {
      setError("Use 1–120 characters, without “/”.");
      return;
    }
    setPending(true);
    try {
      const folder = creating
        ? await api.folders.create({ name: parsed.data, parentId: target.parentId })
        : await api.folders.rename({ folderId: target.folderId, name: parsed.data });
      await qc.invalidateQueries({ queryKey: orpc.folders.key() });
      onDone?.(folder.id);
      onClose();
    } catch (err) {
      setError(errorCopy(err) === "That name is already taken." ? "A folder with that name already exists here." : errorCopy(err));
    } finally {
      setPending(false);
    }
  }

  const title = creating ? (target.parentName ? `New folder in ${target.parentName}` : "New folder") : "Rename folder";
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="folder-name-form" disabled={pending}>
            {creating ? "Create" : "Rename"}
          </Button>
        </>
      }
    >
      <form id="folder-name-form" onSubmit={submit}>
        <TextField label="Folder name" value={name} onChange={(e) => setName(e.target.value)} error={error} autoFocus maxLength={120} />
      </form>
    </Sheet>
  );
}
```

`apps/web/components/library/folder-actions.tsx`:
```tsx
"use client";

import type { FolderView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconButton } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { canCreateFolder } from "@/lib/folders/tree.ts";
import { libraryHref } from "@/lib/library/params.ts";
import { FolderNameSheet, type FolderNameTarget } from "./folder-name-sheet.tsx";

/** Folder actions for the current Library scope (keyboard- and touch-reachable everywhere). */
export function FolderActions({ folders, current }: { folders: FolderView[]; current: FolderView | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<FolderNameTarget | null>(null);
  const [confirm, setConfirm] = useState(false);

  const remove = async () => {
    if (!current) return;
    try {
      await api.folders.delete({ folderId: current.id });
      router.push(libraryHref({ folder: "all" }));
      toast({ title: `Deleted “${current.name}”`, icon: "delete" });
    } catch (err) {
      toast({ title: "Couldn't delete the folder.", description: err instanceof Error ? undefined : undefined, icon: "needsReview", tone: "danger" });
    } finally {
      await qc.invalidateQueries({ queryKey: orpc.folders.key() });
      await qc.invalidateQueries({ queryKey: orpc.notes.key() });
    }
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger render={<IconButton icon="more" label="Folder actions" />} />
        <MenuPanel>
          <MenuItem icon="folderAdd" onSelect={() => setSheet({ mode: "create", parentId: null, parentName: null })}>
            New folder
          </MenuItem>
          {current && canCreateFolder(folders, current.id) ? (
            <MenuItem icon="folderNested" onSelect={() => setSheet({ mode: "create", parentId: current.id, parentName: current.name })}>
              New subfolder
            </MenuItem>
          ) : null}
          {current ? (
            <MenuItem icon="edit" onSelect={() => setSheet({ mode: "rename", folderId: current.id, name: current.name })}>
              Rename
            </MenuItem>
          ) : null}
          {current ? (
            <MenuItem icon="delete" destructive onSelect={() => setConfirm(true)}>
              Delete folder…
            </MenuItem>
          ) : null}
        </MenuPanel>
      </Menu.Root>
      <FolderNameSheet target={sheet} onClose={() => setSheet(null)} onDone={(id) => sheet?.mode === "create" && router.push(libraryHref({ folder: id }))} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete “${current?.name ?? ""}”?`}
        description="Its subfolders are deleted too. Notes inside move to Unfiled."
        confirmLabel="Delete Folder"
        destructive
        onConfirm={() => void remove()}
      />
    </>
  );
}
```

Remove the dead `description` expression in `remove` while implementing: `toast({ title: "Couldn't delete the folder.", icon: "needsReview", tone: "danger" })`.

`apps/web/components/library/library-view.tsx` (minimal version; Task 14 replaces its body):
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { folderPath } from "@/lib/folders/tree.ts";
import { libraryHref, parseLibraryParams } from "@/lib/library/params.ts";
import { FolderActions } from "./folder-actions.tsx";
import { FolderTree } from "./folder-tree.tsx";

export function useLibraryScope() {
  const params = parseLibraryParams(useSearchParams());
  const { data } = useQuery(orpc.folders.tree.queryOptions({ input: {} }));
  const folders = data?.folders ?? [];
  const path = params.folder !== "all" && params.folder !== "unfiled" ? folderPath(folders, params.folder) : [];
  const current = path[path.length - 1] ?? null;
  const scopeLabel = params.folder === "unfiled" ? "Unfiled" : (current?.name ?? "Library");
  return { params, folders, path, current, scopeLabel };
}

export function LibraryHeader({ onDropNote }: { onDropNote: (noteId: string, folderId: string | null) => void }) {
  const { params, folders, path, current, scopeLabel } = useLibraryScope();
  const [sheet, setSheet] = useState(false);
  const crumbs = [
    { label: "Library", href: libraryHref({ ...params, folder: "all" }) },
    ...(params.folder === "unfiled" ? [{ label: "Unfiled" }] : path.map((f) => ({ label: f.name, href: libraryHref({ ...params, folder: f.id }) }))),
  ];
  return (
    <>
      <Toolbar>
        <Crumbs items={crumbs} />
        <ToolbarSpacer />
        <Button className="lg:hidden" icon="folder" onClick={() => setSheet(true)}>
          Folders
        </Button>
        <FolderActions folders={folders} current={current} />
      </Toolbar>
      <Sheet open={sheet} onOpenChange={setSheet} title="Folders">
        <FolderTree onNavigate={() => setSheet(false)} onDropNote={onDropNote} />
      </Sheet>
      <div className="wrap">
        <PageHead title={scopeLabel} lede="Every block traces back to the exact place it came from." />
      </div>
    </>
  );
}

export function LibraryView() {
  return <LibraryHeader onDropNote={() => undefined} />;
}
```

The "Folders" button uses `lg:hidden`, so it shows below 1180 px. Its accessible name is "Folders"; `openTree` in the spec relies on that.

`apps/web/app/(app)/library/page.tsx`:
```tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { LibraryView } from "@/components/library/library-view.tsx";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryView />
    </Suspense>
  );
}
```

Modify `apps/web/components/shell/app-shell.tsx` to pass the tree to the sidebar. Notes dropped there are wired in Task 15. Make these edits:
- add `import { Suspense } from "react";`;
- add `import { FolderTree } from "@/components/library/folder-tree.tsx";`;
- render `<Sidebar viewer={viewer} onSignOut={signOut} libraryTree={<Suspense><FolderTree onDropNote={() => undefined} /></Suspense>} />`.

`apps/web/styles/library.css` (import it in `globals.css` after `shell.css`):
```css
.tree {
  display: grid;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.25rem;
  padding-inline-end: 0.6rem;
  border-radius: var(--r-sm);
  font-size: 0.8125rem;
  cursor: default;
  outline-offset: -2px;
  &:hover {
    background: var(--fill-2);
  }
  & > .ic {
    color: var(--tint-text);
  }
  @media (pointer: coarse) {
    min-height: var(--hit);
  }
}
.tree-row-current {
  background: var(--fill);
}
.tree-row-drop {
  box-shadow: inset 0 0 0 2px var(--tint);
  background: var(--tint-wash);
}
.tree-disclosure {
  display: grid;
  flex: none;
  place-items: center;
  width: 1rem;
  color: var(--label-2);
}
.tree-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/library && pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/folders.spec.ts`
Expected: PASS in 5 projects. The drag test runs only at 1440.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): ARIA folder tree with drag targets, cycle/depth guards, folder create/rename/delete"
```

---

### Task 14: RubberSegment and the Library grid and list

**Files:**
- Create: `apps/web/components/bits/rubber-segment.tsx`, `apps/web/components/library/{note-card,fidelity-badge}.tsx`, `apps/web/lib/notes/cache.ts`
- Modify: `apps/web/components/library/library-view.tsx`, `apps/web/styles/library.css`, `apps/web/styles/components.css`
- Test: `apps/web/e2e/library.spec.ts`

**Interfaces:**
- Consumes: `useLibraryScope`, `LibraryHeader`, `libraryHref`, `FIDELITY_META`, `noteKindIcon`, `KIND_LABEL` and `formatDate`.
- Produces:
  - **`<RubberSegment items value onChange aria-label size?>`**, with `SegmentItem<V> {value; label; icon?; hideLabel?}`. It is a radiogroup with arrow, Home and End keys, and a drag or flick thumb.
  - **`<FidelityBadge fidelity coverage>`.**
  - **`<NoteCard note view onMove? onDelete? onDragNote?>`**, with `data-qa="note-card"`.
  - **`lib/notes/cache.ts`:** `NotesPage` type, `patchNoteLists(qc, fn)`, `patchNoteDetail(qc, noteId, fn)`.
  - **`LibraryView`:**
    - kind filter (All/Web/PDF/Video) and grid/list toggle, both kept in the URL;
    - `useInfiniteQuery` with "Load more";
    - skeletons while loading;
    - an empty state;
    - optimistic client-side scope filtering.

- [ ] **Step 1: Fetch the upstream source for provenance.**

Run: `curl -fsSL https://reactbits.dev/r/RubberSegment-TS-TW.json | shasum -a 256` and put the hash into the header.

- [ ] **Step 2: Write the failing spec.**

`apps/web/e2e/library.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("library lists notes as cards with icons and fidelity, clean at every width (Review Focus 3)", async ({ page }) => {
  await page.goto("/library");
  const cards = page.locator('[data-qa="note-card"]');
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(10);
  await expect(page.getByText("Needs review").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Pneumonoultramicroscopic/ })).toBeVisible();
  await expectCleanScreen(page);
});

test("kind filter and view toggle are segmented radios kept in the URL", async ({ page }) => {
  await page.goto("/library");
  const kinds = page.getByRole("radiogroup", { name: "Filter by type" });
  await kinds.getByRole("radio", { name: "PDF" }).click();
  await expect(page).toHaveURL(/kind=pdf/);
  await expect(page.locator('[data-qa="note-card"]')).toHaveCount(1);
  await kinds.getByRole("radio", { name: "PDF" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/kind=youtube/);
  await page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "List" }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page.locator('[data-view="list"]')).toBeVisible();
  await expectCleanScreen(page);
});

test("a folder scope shows only its notes and an empty state when there are none", async ({ page }) => {
  await page.goto("/library?folder=00000000-0000-4000-8000-000001000004");
  await expect(page.locator('[data-qa="note-card"]')).toHaveCount(1);
  await page.goto("/library?folder=00000000-0000-4000-8000-000001000006");
  await expect(page.getByRole("heading", { name: "Nothing here yet." })).toBeVisible();
  await expectCleanScreen(page);
});

test("shows skeletons, not spinners, while loading", async ({ page }) => {
  await page.route("**/api/rpc/notes/list", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await page.goto("/library");
  await expect(page.locator('[aria-busy="true"] .sk').first()).toBeVisible();
});
```

- [ ] **Step 3: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/library.spec.ts --project=w1440`
Expected: FAIL, because there are no cards yet.

- [ ] **Step 4: Implement.**

`apps/web/components/bits/rubber-segment.tsx`:
```tsx
"use client";
/*
 * Adapted from React Bits "RubberSegment" (TS-TW), https://reactbits.dev/r/RubberSegment-TS-TW.json
 * (sha256 <sha256>, fetched 2026-10-05). Copyright (c) David Haz. MIT + Commons Clause; see
 * ./LICENSE-react-bits. Adaptations: tokens and <Icon>; shared springs; m.* under LazyMotion;
 * the thumb moves with x + scaleX (transform-only) instead of an animated clip-path; equal slots only;
 * colour/speed/glide props removed.
 */
import { animate, m, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Icon, type IconName } from "@/components/ui/icon.tsx";
import { cx } from "@/lib/cx.ts";
import { durations, transitions } from "@/lib/motion-tokens.ts";

export interface SegmentItem<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
  hideLabel?: boolean;
}

export interface RubberSegmentProps<V extends string> {
  items: readonly SegmentItem<V>[];
  value: V;
  onChange: (value: V) => void;
  "aria-label": string;
  size?: "sm" | "md";
  className?: string;
}

type Drag = { id: number; x0: number; slot: number; onThumb: boolean; live: boolean; offset: number; width: number; hist: Array<[number, number]> };

const FLICK = 110;
const MAX_VELOCITY = 2000;
const DEADZONE = 4;
const SLOP = 10;
const RUBBER = 0.55;
const SQUASH = 3;
const GLIDE = 75;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rubber = (over: number, dim: number) => (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over));
const project = (v: number) => {
  const d = 1 - 0.1 * Math.pow(0.05, GLIDE / 100);
  return ((v / 1000) * d) / (1 - d);
};
function velocityOf(hist: ReadonlyArray<[number, number]>, now: number): number {
  const recent = hist.filter(([t]) => now - t <= 100);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last || recent.length < 2) return 0;
  return last[0] - first[0] >= 8 ? ((last[1] - first[1]) / (last[0] - first[0])) * 1000 : 0;
}

export function RubberSegment<V extends string>({ items, value, onChange, "aria-label": ariaLabel, size = "md", className }: RubberSegmentProps<V>) {
  const reduce = useReducedMotion();
  const count = items.length;
  const index = Math.max(0, items.findIndex((item) => item.value === value));
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const box = useRef<DOMRect | null>(null);
  const committed = useRef(index);
  const gen = useRef(0);
  const handoff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const inset = useRef(0);
  const edgeL = useMotionValue(0);
  const edgeR = useMotionValue(0);
  const slotW = useMotionValue(0);
  const scaleX = useTransform(() => {
    const w = slotW.get();
    return w > 0 ? (edgeR.get() - edgeL.get()) / w : 1;
  });

  const slot = (i: number) => ({ l: i * slotW.get(), r: (i + 1) * slotW.get() });
  const jumpTo = (i: number) => {
    clearTimeout(handoff.current);
    gen.current += 1;
    const s = slot(i);
    edgeL.jump(s.l);
    edgeR.jump(s.r);
  };

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const measure = () => {
      inset.current = Number.parseFloat(getComputedStyle(track).paddingLeft) || 0;
      box.current = track.getBoundingClientRect();
      slotW.set((track.clientWidth - inset.current * 2) / count);
      jumpTo(committed.current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpTo only touches refs and motion values
  }, [count]);

  useEffect(() => {
    if (!drag.current && committed.current !== index) {
      committed.current = index;
      jumpTo(index);
    }
  });

  useEffect(() => () => clearTimeout(handoff.current), []);

  const commit = (i: number) => {
    committed.current = i;
    const item = items[i];
    if (item && i !== index) onChange(item.value);
  };

  const land = (to: number, v: number | null, flick: boolean, withSquash: boolean) => {
    const b = slot(to);
    const g = ++gen.current;
    const dir = Math.sign((b.l + b.r) / 2 - (edgeL.get() + edgeR.get()) / 2) || 1;
    const [lead, leadTo, trail, trailTo]: [MotionValue<number>, number, MotionValue<number>, number] =
      dir > 0 ? [edgeR, b.r, edgeL, b.l] : [edgeL, b.l, edgeR, b.r];
    const velocity = (mv: MotionValue<number>) => clamp(v ?? mv.getVelocity(), -MAX_VELOCITY, MAX_VELOCITY);
    void animate(lead, leadTo, { ...(flick ? transitions.springSoft : transitions.spring), velocity: velocity(lead) });
    const trailVelocity = velocity(trail);
    if (!withSquash) {
      void animate(trail, trailTo, { ...transitions.spring, velocity: trailVelocity });
      return;
    }
    void animate(trail, trailTo + dir * SQUASH, { ...transitions.spring, velocity: trailVelocity }).then(() => {
      if (gen.current === g) void animate(trail, trailTo, transitions.micro);
    });
  };

  const travel = (from: number, to: number) => {
    const a = slot(from);
    const b = slot(to);
    clearTimeout(handoff.current);
    gen.current += 1;
    if (reduce) {
      jumpTo(to);
      return;
    }
    void animate(edgeL, Math.min(a.l, b.l), transitions.micro);
    void animate(edgeR, Math.max(a.r, b.r), transitions.micro);
    handoff.current = setTimeout(() => land(to, null, false, true), durations.micro);
  };

  const localX = (e: { clientX: number }) => e.clientX - (box.current?.left ?? 0) - inset.current;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, i: number) => {
    if (drag.current || e.button !== 0) return;
    box.current = trackRef.current?.getBoundingClientRect() ?? null;
    trackRef.current?.setPointerCapture(e.pointerId);
    const x = localX(e);
    const onThumb = x >= edgeL.get() && x <= edgeR.get();
    drag.current = { id: e.pointerId, x0: x, slot: i, onThumb, live: false, offset: 0, width: 0, hist: [[e.timeStamp, x]] };
    if (onThumb) {
      clearTimeout(handoff.current);
      gen.current += 1;
      edgeL.stop();
      edgeR.stop();
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id || !d.onThumb) return;
    const x = localX(e);
    d.hist.push([e.timeStamp, x]);
    if (d.hist.length > 8) d.hist.shift();
    if (!d.live) {
      if (Math.abs(x - d.x0) < DEADZONE) return;
      d.live = true;
      d.offset = x - edgeL.get();
      d.width = edgeR.get() - edgeL.get();
    }
    const total = slotW.get() * count;
    const l = x - d.offset;
    const maxL = total - d.width;
    if (reduce) {
      const c = clamp(l, 0, maxL);
      edgeL.set(c);
      edgeR.set(c + d.width);
    } else if (l < 0) {
      edgeL.set(0);
      edgeR.set(d.width - rubber(-l, d.width));
    } else if (l > maxL) {
      edgeR.set(total);
      edgeL.set(maxL + rubber(l - maxL, d.width));
    } else {
      edgeL.set(l);
      edgeR.set(l + d.width);
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const x = localX(e);
    if (!d.live) {
      if (Math.abs(x - d.x0) <= SLOP && d.slot !== committed.current) {
        const from = committed.current;
        commit(d.slot);
        travel(from, d.slot);
      }
      return;
    }
    const v = velocityOf(d.hist, e.timeStamp);
    const flick = Math.abs(v) > FLICK;
    const centre = (edgeL.get() + edgeR.get()) / 2 + project(v);
    let to = clamp(Math.floor(centre / Math.max(1, slotW.get())), 0, count - 1);
    if (flick && to === committed.current) to = clamp(to + Math.sign(v), 0, count - 1);
    commit(to);
    if (reduce) jumpTo(to);
    else land(to, v, flick, flick);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (d.live) land(committed.current, null, false, false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = count - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(last, index + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? Math.max(0, index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    if (next === index) return;
    commit(next);
    travel(index, next);
    itemRefs.current[next]?.focus();
  };

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx("rseg", `rseg-${size}`, className)}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      <m.span className="rseg-thumb" aria-hidden="true" style={{ x: edgeL, scaleX, width: slotW }} />
      {items.map((item, i) => (
        <button
          key={item.value}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          aria-label={item.hideLabel ? item.label : undefined}
          tabIndex={i === index ? 0 : -1}
          className="rseg-item"
          onPointerDown={(e) => onPointerDown(e, i)}
          onKeyDown={onKeyDown}
        >
          {item.icon ? <Icon name={item.icon} size="sm" /> : null}
          {item.hideLabel ? null : <span>{item.label}</span>}
        </button>
      ))}
    </div>
  );
}
```

A click without a drag commits through `onPointerUp` (SLOP), so add an `onClick` fallback for programmatic and assistive-tech activation. Add this prop to each button:
```tsx
          onClick={(e) => {
            if (e.detail === 0 && i !== index) {
              commit(i);
              travel(index, i);
            }
          }}
```
`detail === 0` means the click came from the keyboard or assistive tech, not from a pointer sequence that `onPointerUp` already handled.

Append to `apps/web/styles/components.css`:
```css
.rseg {
  position: relative;
  display: inline-grid;
  padding: 2px;
  border-radius: 0.5625rem;
  background: var(--fill-2);
  isolation: isolate;
  user-select: none;
  touch-action: pan-y;
}
.rseg-thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  border-radius: 0.4375rem;
  background: var(--seg-thumb);
  box-shadow: var(--seg-thumb-shadow);
  transform-origin: left center;
  z-index: -1;
}
.rseg-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-width: 2.75rem;
  min-height: 1.75rem;
  padding: 0 0.8rem;
  border-radius: 0.4375rem;
  color: var(--label);
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  transition-property: transform;
  transition-duration: var(--motion-dur-micro);
  transition-timing-function: var(--motion-ease-out);
  &::after {
    content: "";
    position: absolute;
    inset: -0.375rem 0;
  }
  &:active {
    transform: scale(var(--motion-press));
  }
  @media (pointer: coarse) {
    min-height: 2.5rem;
  }
}
.rseg-sm .rseg-item {
  padding: 0 0.55rem;
  font-size: 0.75rem;
}
```

`apps/web/components/library/fidelity-badge.tsx`:
```tsx
import type { Fidelity } from "@mastertutor/contracts";
import { Badge } from "@/components/ui/badge.tsx";
import { FIDELITY_META } from "@/lib/notes/format.ts";

export function FidelityBadge({ fidelity, coverage }: { fidelity: Fidelity; coverage: number | null }) {
  const meta = FIDELITY_META[fidelity];
  const percent = fidelity === "partial" && coverage !== null ? ` · ${Math.round(coverage * 100)}%` : "";
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {meta.label}
      {percent}
    </Badge>
  );
}
```

`apps/web/lib/notes/cache.ts`:
```ts
import type { NoteDetail, NoteSummary } from "@mastertutor/contracts";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api/client.ts";

export interface NotesPage {
  items: NoteSummary[];
  nextCursor: string | null;
}

/** Applies fn to every cached notes.list result, whether paged (useInfiniteQuery) or single (useQuery). */
export function patchNoteLists(qc: QueryClient, fn: (items: NoteSummary[]) => NoteSummary[]): void {
  qc.setQueriesData<InfiniteData<NotesPage> | NotesPage>({ queryKey: orpc.notes.list.key() }, (data) => {
    if (!data) return data;
    if ("pages" in data) return { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items) })) };
    return { ...data, items: fn(data.items) };
  });
}

export function patchNoteDetail(qc: QueryClient, noteId: string, fn: (detail: NoteDetail) => NoteDetail): NoteDetail | undefined {
  const key = orpc.notes.get.queryKey({ input: { noteId } });
  const previous = qc.getQueryData<NoteDetail>(key);
  if (previous) qc.setQueryData<NoteDetail>(key, fn(previous));
  return previous;
}
```

`apps/web/components/library/note-card.tsx`:
```tsx
"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import Link from "next/link";
import type { CSSProperties } from "react";
import { IconButton } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { NOTE_DRAG_TYPE, setDragged } from "@/lib/folders/drag.ts";
import type { LibraryViewMode } from "@/lib/library/params.ts";
import { KIND_LABEL, formatDate, noteKindIcon } from "@/lib/notes/format.ts";
import { FidelityBadge } from "./fidelity-badge.tsx";

export function NoteCard({ note, view, index, onMove, onDelete }: { note: NoteSummary; view: LibraryViewMode; index: number; onMove: (note: NoteSummary) => void; onDelete: (note: NoteSummary) => void }) {
  const kind = note.sourceKinds[0] ?? "web";
  return (
    <article
      className="card"
      data-qa="note-card"
      draggable
      style={{ "--i": Math.min(index, 12) } as CSSProperties}
      onDragStart={(e) => {
        setDragged({ kind: "note", id: note.id });
        e.dataTransfer.setData(NOTE_DRAG_TYPE, note.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => setDragged(null)}
    >
      <div className="card-cover">
        <Icon name={noteKindIcon(note)} size="xl" />
        {view === "grid" ? (
          <span className="card-badge">
            <FidelityBadge fidelity={note.fidelity} coverage={note.coverage} />
          </span>
        ) : null}
      </div>
      <div className="card-body">
        <p className="card-meta">
          <Icon name={noteKindIcon(note)} size="sm" />
          <span>{KIND_LABEL[kind]}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDate(note.createdAt)}</span>
        </p>
        <h3 className="card-title">
          <Link href={`/notes/${note.id}`} className="card-link">
            {note.title}
          </Link>
        </h3>
        {note.lede ? <p className="card-lede">{note.lede}</p> : null}
      </div>
      {view === "list" ? (
        <span className="card-list-badge">
          <FidelityBadge fidelity={note.fidelity} coverage={note.coverage} />
        </span>
      ) : null}
      <div className="card-menu">
        <Menu.Root>
          <Menu.Trigger render={<IconButton icon="more" label={`Actions for ${note.title}`} />} />
          <MenuPanel>
            <MenuItem icon="move" onSelect={() => onMove(note)}>
              Move to…
            </MenuItem>
            <MenuItem icon="delete" destructive onSelect={() => onDelete(note)}>
              Delete note…
            </MenuItem>
          </MenuPanel>
        </Menu.Root>
      </div>
    </article>
  );
}
```

`apps/web/components/library/library-view.tsx`: keep `useLibraryScope` and `LibraryHeader` as they are, and replace `LibraryView` with:
```tsx
export function LibraryView() {
  const router = useRouter();
  const { params } = useLibraryScope();
  const notes = useInfiniteQuery(
    orpc.notes.list.infiniteOptions({
      input: (cursor: string | null) => ({ folder: params.folder, kind: params.kind, limit: 50, cursor }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  const items = (notes.data?.pages.flatMap((p) => p.items) ?? []).filter((n) =>
    params.folder === "all" ? true : params.folder === "unfiled" ? n.folderId === null : n.folderId === params.folder,
  );
  const set = (patch: Partial<LibraryParams>) => router.replace(libraryHref({ ...params, ...patch }), { scroll: false });

  return (
    <>
      <LibraryHeader onDropNote={() => undefined} />
      <div className="wrap">
        <div className="libbar">
          <RubberSegment
            aria-label="Filter by type"
            items={KIND_ITEMS}
            value={params.kind ?? "all"}
            onChange={(v) => set({ kind: v === "all" ? null : v })}
          />
          <span className="toolbar-spacer" />
          <RubberSegment
            aria-label="View"
            size="sm"
            items={VIEW_ITEMS}
            value={params.view}
            onChange={(v) => set({ view: v })}
          />
        </div>
        {notes.isPending ? (
          <div className="notes" data-view={params.view} aria-busy="true" aria-label="Loading notes">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card">
                <Skeleton className="card-cover" />
                <Skeleton className="mt-4 h-4 w-1/3" />
                <Skeleton className="mt-2 h-5 w-3/4" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="allNotes"
            eyebrow={params.kind ? KIND_LABEL[params.kind] : undefined}
            title="Nothing here yet"
            body="Notes appear here when the agent files them, or when you move them in."
            actions={<ButtonLink href="/new" variant="primary" size="lg">New task</ButtonLink>}
          />
        ) : (
          <div className="notes" data-view={params.view}>
            {items.map((note, i) => (
              <NoteCard key={note.id} note={note} view={params.view} index={i} onMove={() => undefined} onDelete={() => undefined} />
            ))}
          </div>
        )}
        {notes.hasNextPage ? (
          <div className="flex justify-center pb-12">
            <Button onClick={() => void notes.fetchNextPage()} disabled={notes.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

const KIND_ITEMS: SegmentItem<"all" | SourceKind>[] = [
  { value: "all", label: "All" },
  { value: "web", label: "Web" },
  { value: "pdf", label: "PDF" },
  { value: "youtube", label: "Video" },
];
const VIEW_ITEMS: SegmentItem<LibraryViewMode>[] = [
  { value: "grid", label: "Grid", icon: "grid", hideLabel: true },
  { value: "list", label: "List", icon: "list", hideLabel: true },
];
```

Add these imports to the file:
- `useInfiniteQuery` (from `@tanstack/react-query`) and `useRouter` (from `next/navigation`);
- `type SourceKind` (from `@mastertutor/contracts`);
- `RubberSegment` and `type SegmentItem`;
- `NoteCard`, `Skeleton`, `EmptyState`, `ButtonLink`, `KIND_LABEL`;
- `type LibraryParams` and `type LibraryViewMode`.

Append to `apps/web/styles/library.css`:
```css
.libbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--sep);
}
.notes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(15rem, 100%), 1fr));
  gap: 2.5rem 1.5rem;
  padding: 2rem 0 5rem;
  @variant md {
    grid-template-columns: repeat(auto-fill, minmax(17.5rem, 1fr));
  }
  &[data-view="list"] {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: var(--r-lg);
  transition-property: transform;
  transition-duration: var(--motion-spring-dur);
  transition-timing-function: var(--motion-spring);
  animation-name: pop-in;
  animation-duration: var(--motion-spring-dur);
  animation-timing-function: var(--motion-spring);
  animation-fill-mode: both;
  animation-delay: calc(var(--i, 0) * var(--motion-dur-stagger));
  @media (hover: hover) and (pointer: fine) {
    &:hover {
      transform: translateY(-2px);
    }
  }
  &:active {
    transform: scale(var(--motion-press-row));
  }
}
.card-cover {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--r-lg);
  background: var(--bg-2);
  color: var(--label-2);
}
.card-badge {
  position: absolute;
  left: 0.75rem;
  top: 0.75rem;
}
.card-body {
  min-width: 0;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 1rem;
  font-size: 0.75rem;
  color: var(--label-2);
}
.card-title {
  margin-top: 0.35rem;
  font: 600 1.125rem/1.3 var(--font-display);
  letter-spacing: -0.018em;
  overflow-wrap: anywhere;
}
.card-link {
  color: var(--label);
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  &:hover {
    text-decoration: none;
  }
}
.card-lede {
  margin-top: 0.35rem;
  color: var(--label-2);
  font-size: 0.8125rem;
  line-height: 1.45;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.card-menu {
  position: absolute;
  right: 0.5rem;
  top: 0.5rem;
  z-index: 1;
}
.card-list-badge {
  display: none;
}
.notes[data-view="list"] .card {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem 3rem 0.9rem 0;
  border-bottom: 1px solid var(--sep);
  border-radius: 0;
  @variant md {
    grid-template-columns: 6.5rem minmax(0, 1fr) auto;
    gap: 1.25rem;
  }
  &:hover {
    transform: none;
  }
  & .card-cover {
    border-radius: 0.625rem;
  }
  & .card-meta {
    margin-top: 0;
  }
  & .card-title {
    font-size: 1rem;
  }
  & .card-list-badge {
    display: none;
    @variant md {
      display: block;
    }
  }
  & .card-menu {
    top: 50%;
    transform: translateY(-50%);
  }
}
```

- [ ] **Step 5: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/library.spec.ts`
Expected: PASS in 5 projects. At 390 px the long-title card has no sideways scroll, because `overflow-wrap: anywhere` breaks the title.

- [ ] **Step 6: Commit.**

```bash
git add apps/web
git commit -m "feat(web): Library grid/list with adapted RubberSegment filters, fidelity badges, skeletons, empty state"
```

---

### Task 15: Moving notes (drag, Move to…, optimistic with Undo) and deleting notes

**Files:**
- Create: `apps/web/components/library/{use-move-note.ts,move-sheet.tsx,use-delete-note.ts}`
- Modify: `apps/web/components/library/library-view.tsx`, `apps/web/components/shell/app-shell.tsx`
- Test: `apps/web/e2e/move.spec.ts`

**Interfaces:**
- Consumes: `patchNoteLists`, `patchNoteDetail`, `api`, `useToast`, `buildFolderTree`, `flattenAll`, `Sheet` and `ConfirmDialog`.
- Produces:
  - **`useMoveNote(): (noteId, toFolderId, fromFolderId, options?: {undo?: boolean}) => Promise<void>`.** It is optimistic and shows "Moved to X" with Undo. On failure it rolls back and shows a danger toast.
  - **`<MoveSheet note onClose>`.**
  - **`useDeleteNote(): (note) => Promise<void>`.** It is optimistic, with a rollback on error.
  - **Drops on the sidebar and sheet tree** call `useMoveNote`.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/move.spec.ts`:
```ts
import { expect, expectCleanScreen, isWide, test } from "./helpers/test.ts";

const OPT = "/library?folder=00000000-0000-4000-8000-000001000002";

test("Move to… moves optimistically and Undo restores it", async ({ page }) => {
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Learning-rate warmup" });
  await card.getByRole("button", { name: /Actions for Learning-rate/ }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const sheet = page.getByRole("dialog", { name: "Move to…" });
  await expectCleanScreen(page);
  await sheet.getByRole("button", { name: "Papers" }).click();
  await expect(card).toBeHidden();
  const toast = page.getByRole("status").filter({ hasText: "Moved to Papers" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(card).toBeVisible();
});

test("a failed move rolls back and says so (Review Focus 5)", async ({ page }) => {
  await page.route("**/api/rpc/notes/move", (route) => route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }));
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Learning-rate warmup" });
  await card.getByRole("button", { name: /Actions for Learning-rate/ }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page.getByRole("dialog", { name: "Move to…" }).getByRole("button", { name: "Unfiled" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Couldn't move the note." })).toBeVisible();
  await expect(card).toBeVisible();
});

test("Undo still works after navigating away", async ({ page }) => {
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Why warmup works" });
  await card.getByRole("button", { name: /Actions for Why warmup/ }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page.getByRole("dialog", { name: "Move to…" }).getByRole("button", { name: "Unfiled" }).click();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Vault" }).click();
  await page.getByRole("status").filter({ hasText: "Moved to Unfiled" }).getByRole("button", { name: "Undo" }).click();
  await page.goto(OPT);
  await expect(page.locator('[data-qa="note-card"]').filter({ hasText: "Why warmup works" })).toBeVisible();
});

test("dragging a card onto a sidebar folder moves it", async ({ page }) => {
  test.skip(!isWide(page), "sidebar tree is wide-only; compact uses Move to…");
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Learning-rate warmup" });
  await card.dragTo(page.getByRole("tree", { name: "Folders" }).getByRole("treeitem", { name: "Databases" }));
  await expect(page.getByRole("status").filter({ hasText: "Moved to Databases" })).toBeVisible();
  await expect(card).toBeHidden();
});

test("deleting a note asks first and keeps Cancel as the default", async ({ page }) => {
  await page.goto("/library?folder=unfiled");
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: "Unfiled clipping" });
  await card.getByRole("button", { name: /Actions for Unfiled clipping/ }).click();
  await page.getByRole("menuitem", { name: "Delete note…" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Delete Note" }).click();
  await expect(card).toBeHidden();
});
```

The Vault route exists after Task 24. Until then, the "after navigating away" test navigates to `/settings` instead, which is also created later. Run this spec in full after Task 24 and keep it in the suite.

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/move.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/components/library/use-move-note.ts`:
```ts
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteDetail, patchNoteLists } from "@/lib/notes/cache.ts";

export function useMoveNote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async function move(noteId: string, to: string | null, from: string | null, options: { undo?: boolean } = {}): Promise<void> {
      if (to === from) return;
      const apply = (folderId: string | null) => {
        patchNoteLists(qc, (items) => items.map((n) => (n.id === noteId ? { ...n, folderId, filedBy: "user" } : n)));
        patchNoteDetail(qc, noteId, (d) => ({ ...d, note: { ...d.note, folderId, filedBy: "user" } }));
      };
      apply(to);
      try {
        await api.notes.move({ noteId, folderId: to });
        if (!options.undo) {
          const folders = qc.getQueryData<{ folders: Array<{ id: string; name: string }> }>(orpc.folders.tree.queryKey({ input: {} }))?.folders ?? [];
          const name = to === null ? "Unfiled" : (folders.find((f) => f.id === to)?.name ?? "folder");
          toast({ title: `Moved to ${name}`, icon: "move", actionLabel: "Undo", onAction: () => void move(noteId, from, to, { undo: true }) });
        }
      } catch {
        apply(from);
        toast({ title: "Couldn't move the note.", description: "Nothing changed.", icon: "needsReview", tone: "danger" });
      } finally {
        await qc.invalidateQueries({ queryKey: orpc.notes.list.key() });
      }
    },
    [qc, toast],
  );
}
```

`apps/web/components/library/use-delete-note.ts`:
```ts
"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteLists } from "@/lib/notes/cache.ts";

export function useDeleteNote() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (note: NoteSummary) => {
      const snapshot = qc.getQueriesData({ queryKey: orpc.notes.list.key() });
      patchNoteLists(qc, (items) => items.filter((n) => n.id !== note.id));
      try {
        await api.notes.delete({ noteId: note.id });
        toast({ title: "Note deleted", icon: "delete" });
      } catch {
        for (const [key, data] of snapshot) qc.setQueryData(key, data);
        toast({ title: "Couldn't delete the note.", icon: "needsReview", tone: "danger" });
      } finally {
        await qc.invalidateQueries({ queryKey: orpc.notes.list.key() });
      }
    },
    [qc, toast],
  );
}
```

`apps/web/components/library/move-sheet.tsx`:
```tsx
"use client";

import type { NoteSummary } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/icon.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { orpc } from "@/lib/api/client.ts";
import { buildFolderTree, flattenAll } from "@/lib/folders/tree.ts";
import { useMoveNote } from "./use-move-note.ts";

export function MoveSheet({ note, onClose }: { note: NoteSummary | null; onClose: () => void }) {
  const { data } = useQuery(orpc.folders.tree.queryOptions({ input: {} }));
  const move = useMoveNote();
  const rows = flattenAll(buildFolderTree(data?.folders ?? []));
  const pick = (folderId: string | null) => {
    if (!note) return;
    onClose();
    void move(note.id, folderId, note.folderId);
  };
  return (
    <Sheet open={note !== null} onOpenChange={(open) => !open && onClose()} title="Move to…" description={note ? `Choose a folder for “${note.title}”.` : undefined}>
      <ul className="move-list">
        <li>
          <button type="button" className="move-row" aria-current={note?.folderId === null ? "true" : undefined} onClick={() => pick(null)}>
            <Icon name="unfiled" size="sm" />
            <span>Unfiled</span>
          </button>
        </li>
        {rows.map((node) => (
          <li key={node.folder.id}>
            <button
              type="button"
              className="move-row"
              style={{ paddingInlineStart: `${0.75 + (node.depth - 1) * 1}rem` }}
              aria-current={note?.folderId === node.folder.id ? "true" : undefined}
              onClick={() => pick(node.folder.id)}
            >
              <Icon name="folder" size="sm" />
              <span>{node.folder.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
```

Append to `apps/web/styles/library.css`:
```css
.move-list {
  display: grid;
  gap: 1px;
  max-height: 55dvh;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.move-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  min-height: var(--hit);
  padding-inline-end: 0.75rem;
  border-radius: var(--r-sm);
  text-align: left;
  &:hover {
    background: var(--fill-2);
  }
  &[aria-current="true"] {
    background: var(--fill);
    font-weight: 600;
  }
  & span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
```

In `library-view.tsx`, inside `LibraryView`:
```tsx
  const moveNote = useMoveNote();
  const deleteNote = useDeleteNote();
  const [moving, setMoving] = useState<NoteSummary | null>(null);
  const [deleting, setDeleting] = useState<NoteSummary | null>(null);
  const dropNote = (noteId: string, folderId: string | null) => {
    const note = items.find((n) => n.id === noteId);
    if (note) void moveNote(noteId, folderId, note.folderId);
  };
```
- Pass `onDropNote={dropNote}` to `LibraryHeader`.
- Pass `onMove={setMoving}` and `onDelete={setDeleting}` to each `NoteCard`.
- After the grid, render:
```tsx
        <MoveSheet note={moving} onClose={() => setMoving(null)} />
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete “${deleting?.title ?? ""}”?`}
          description="This removes the note and its blocks. Its captured sources stay with any other notes."
          confirmLabel="Delete Note"
          destructive
          onConfirm={() => deleting && void deleteNote(deleting)}
        />
```
Add the imports (`useState`, `NoteSummary`, `useMoveNote`, `useDeleteNote`, `MoveSheet`, `ConfirmDialog`).

In `app-shell.tsx`, replace the sidebar tree's `onDropNote={() => undefined}` with a component that has the hook available:
```tsx
function SidebarFolders() {
  const move = useMoveNote();
  const qc = useQueryClient();
  return (
    <FolderTree
      onDropNote={(noteId, folderId) => {
        const lists = qc.getQueriesData<InfiniteData<NotesPage> | NotesPage>({ queryKey: orpc.notes.list.key() });
        const from = lists
          .flatMap(([, d]) => (d ? ("pages" in d ? d.pages.flatMap((p) => p.items) : d.items) : []))
          .find((n) => n.id === noteId)?.folderId ?? null;
        void move(noteId, folderId, from);
      }}
    />
  );
}
```
Render `libraryTree={<Suspense><SidebarFolders /></Suspense>}` and import `useQueryClient`, `InfiniteData`, `orpc`, `NotesPage` and `useMoveNote`.

- [ ] **Step 4: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/move.spec.ts e2e/library.spec.ts`
Expected: PASS, except the "navigating away" case, which goes green after Task 24.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): optimistic note moves via drag and Move to… with Undo and rollback; note delete"
```

---

### Task 16: Search (library field and ⌘K palette)

**Files:**
- Create: `apps/web/components/library/{use-note-search.ts,search-results.tsx,search-palette.tsx}`
- Modify: `apps/web/components/library/library-view.tsx`, `apps/web/components/shell/app-shell.tsx`, `apps/web/styles/library.css`
- Test: `apps/web/e2e/search.spec.ts`

**Interfaces:**
- Consumes: `orpc.notes.search` and `useHotkey`.
- Produces:
  - **`useNoteSearch(q, kind)`** returns `{hits, isFetching}` (debounced 150 ms, disabled for an empty query).
  - **`<SearchResults hits query activeIndex? onPick?>`**: snippets with `<mark>` highlights, rendered as text nodes only.
  - **`<SearchPalette open onOpenChange>`**: a ⌘K / Ctrl-K dialog with a combobox, a listbox, arrow keys and Enter.
  - **The library field** sets `?q=`. Results replace the grid, and there is a no-results state with Clear search.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/search.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("library search shows block hits with highlights and a recovery path", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("searchbox", { name: "Search the library" }).fill("grad_norm");
  const results = page.getByRole("list", { name: "Search results" });
  await expect(results.getByRole("link", { name: /Learning-rate warmup/ })).toBeVisible();
  await expect(results.locator("mark").first()).toHaveText(/grad_norm/i);
  await expect(page).toHaveURL(/q=grad_norm/);
  await expectCleanScreen(page);
  await page.getByRole("searchbox", { name: "Search the library" }).fill("zzzz-nothing");
  await expect(page.getByRole("heading", { name: "No results." })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator('[data-qa="note-card"]').first()).toBeVisible();
});

test("⌘K opens the palette from anywhere and Enter opens the block", async ({ page }) => {
  await page.goto("/settings");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search notes" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("NaN");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await expectCleanScreen(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]+#block-/);
});

test("snippets render page text as text, never HTML", async ({ page }) => {
  await page.goto("/library?q=%3Ctable");
  await expect(page.getByRole("list", { name: "Search results" })).toContainText("<table");
});
```

`/settings` exists after Task 26. Until then, start the ⌘K test at `/library`; switch it to `/settings` in Task 26.

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/search.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/components/library/use-note-search.ts`:
```ts
"use client";

import type { SourceKind } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { orpc } from "@/lib/api/client.ts";

const DEBOUNCE_MS = 150;

export function useNoteSearch(q: string, kind: SourceKind | null) {
  const [debounced, setDebounced] = useState(q.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  const query = useQuery({
    ...orpc.notes.search.queryOptions({ input: { q: debounced || " ", kind, limit: 20 } }),
    enabled: debounced.length > 0,
  });
  return { hits: debounced ? (query.data?.items ?? []) : [], isFetching: query.isFetching, settledQuery: debounced };
}
```

`apps/web/components/library/search-results.tsx`:
```tsx
import type { SearchHit } from "@mastertutor/contracts";
import Link from "next/link";
import { Fragment } from "react";
import { cx } from "@/lib/cx.ts";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits plain text around query terms; React renders every part as text (never HTML). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(escape);
  if (!terms.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

export const hitHref = (hit: SearchHit) => `/notes/${hit.noteId}${hit.blockId ? `#block-${hit.blockId}` : ""}`;

export function SearchResults({ hits, query, activeIndex, idPrefix, onPick }: { hits: SearchHit[]; query: string; activeIndex?: number; idPrefix?: string; onPick?: () => void }) {
  return (
    <ul className="hits" aria-label="Search results">
      {hits.map((hit, i) => (
        <li key={`${hit.noteId}-${hit.blockId ?? "note"}-${i}`} id={idPrefix ? `${idPrefix}-${i}` : undefined} className={cx("hit", activeIndex === i && "hit-active")}>
          <Link href={hitHref(hit)} onClick={onPick} className="hit-link">
            <b className="hit-title">{hit.title}</b>
            <span className="hit-snippet">
              <Highlight text={hit.snippet} query={query} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

`apps/web/components/library/search-palette.tsx`:
```tsx
"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { cx } from "@/lib/cx.ts";
import { Highlight, hitHref } from "./search-results.tsx";
import { useNoteSearch } from "./use-note-search.ts";

export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="palette-viewport">
          <Dialog.Popup className="palette">{open ? <PaletteBody onDone={() => onOpenChange(false)} /> : null}</Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const { hits, settledQuery } = useNoteSearch(q, null);
  const choose = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    onDone();
    router.push(hitHref(hit));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active < 0 ? 0 : active);
    }
  };
  return (
    <>
      <Dialog.Title className="sr-only">Search notes</Dialog.Title>
      <div className="palette-field">
        <Icon name="search" />
        <input
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="palette-list"
          aria-activedescendant={active >= 0 ? `palette-${active}` : undefined}
          aria-label="Search every block"
          placeholder="Search every block"
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className="kbd" aria-hidden="true">
          esc
        </kbd>
      </div>
      <ul id="palette-list" role="listbox" aria-label="Results" className="palette-list">
        {hits.map((hit, i) => (
          <li
            key={`${hit.noteId}-${hit.blockId ?? "n"}-${i}`}
            id={`palette-${i}`}
            role="option"
            aria-selected={i === active}
            className={cx("hit", i === active && "hit-active")}
            onPointerEnter={() => setActive(i)}
            onClick={() => choose(i)}
          >
            <b className="hit-title">{hit.title}</b>
            <span className="hit-snippet">
              <Highlight text={hit.snippet} query={settledQuery} />
            </span>
          </li>
        ))}
        {settledQuery && hits.length === 0 ? <li className="palette-empty">No notes match “{settledQuery}”.</li> : null}
      </ul>
    </>
  );
}
```

`palette-empty` is a non-option `li` inside the listbox. Give it `role="presentation"` to keep axe's `aria-required-children` happy. If axe still flags it, move it out of the `ul`, below the list.

In `app-shell.tsx`, add:
```tsx
  const [searchOpen, setSearchOpen] = useState(false);
  useHotkey({ key: "k", meta: true }, () => setSearchOpen(true));
```
Render `<SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />` after `</main>`, and import `useState`, `useHotkey` and `SearchPalette`.

In `library-view.tsx` (`LibraryView`): put the search field first in the `.libbar`:
```tsx
          <div className="libbar-search">
            <SearchField label="Search the library" value={query} onChange={(v) => { setQuery(v); set({ q: v }); }} placeholder="Search every block" shortcut="⌘K" />
          </div>
```
Add the state `const [query, setQuery] = useState(params.q);` and `const search = useNoteSearch(query, params.kind);`.

When `query.trim()` is non-empty, render this instead of the grid:
```tsx
          search.hits.length ? (
            <SearchResults hits={search.hits} query={search.settledQuery} />
          ) : search.settledQuery && !search.isFetching ? (
            <EmptyState icon="search" eyebrow="Search" title="No results" body={`No notes match “${search.settledQuery}”. Search covers titles and every captured block.`}
              actions={<><ButtonLink href={`/new?goal=${encodeURIComponent(search.settledQuery)}`} variant="primary" size="lg">Take notes on this</ButtonLink>
                <Button size="lg" onClick={() => { setQuery(""); set({ q: "" }); }}>Clear search</Button></>} />
          ) : null
```

Append to `apps/web/styles/library.css`:
```css
.libbar-search {
  flex: 1 1 100%;
  @variant md {
    flex: 0 1 20rem;
  }
}
.hits {
  display: grid;
  margin: 0;
  padding: 1.5rem 0 5rem;
  list-style: none;
}
.hit {
  border-bottom: 1px solid var(--sep);
}
.hit-link,
.palette .hit {
  display: grid;
  gap: 0.25rem;
  padding: 0.85rem 0.5rem;
  border-radius: var(--r-sm);
  color: var(--label);
  &:hover {
    background: var(--fill-2);
    text-decoration: none;
  }
}
.hit-active {
  background: var(--fill-2);
}
.hit-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.hit-snippet {
  color: var(--label-2);
  font-size: 0.8125rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  & mark {
    border-radius: 3px;
    background: var(--tint-wash);
    color: var(--label);
  }
}
.palette-viewport {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  justify-items: center;
  align-items: start;
  padding: 10dvh 1rem 1rem;
}
.palette {
  width: min(36rem, 100%);
  max-height: 70dvh;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-radius: var(--r-xl);
  background: var(--glass);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  box-shadow: var(--e3);
  transition-property: transform, opacity;
  transition-duration: var(--motion-spring-dur);
  transition-timing-function: var(--motion-spring);
  &[data-starting-style],
  &[data-ending-style] {
    transform: scale(0.97);
    opacity: 0;
  }
}
.palette-field {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0 1rem;
  min-height: 3.5rem;
  border-bottom: 1px solid var(--sep);
  & input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font-size: 1.0625rem;
  }
}
.palette-list {
  margin: 0;
  padding: 0.5rem;
  overflow: auto;
  list-style: none;
}
.palette-empty {
  padding: 1rem;
  color: var(--label-2);
}
```

- [ ] **Step 4: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/search.spec.ts`
Expected: PASS in 5 projects. `ControlOrMeta+k` maps to Ctrl on Linux CI.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): library search with safe highlights and a ⌘K palette"
```

---

### Task 17: Block markdown rendering (KaTeX, code, tables; untrusted-safe)

**Files:**
- Create: `apps/web/components/note/{block-markdown.tsx,highlight-languages.ts}`, `apps/web/styles/note.css`
- Modify: `apps/web/app/globals.css`, `apps/web/package.json`
- Test: `apps/web/components/note/block-markdown.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - **`<BlockMarkdown markdown allowHtml?>`** with this pipeline:
    1. remark-gfm and remark-math;
    2. rehype-raw (only when `allowHtml`, used for captured HTML tables);
    3. rehype-sanitize with the GitHub schema plus `math-inline`/`math-display` classes;
    4. rehype-katex (`trust:false`);
    5. rehype-highlight with a fixed language set.

    Links open in a new tab with `rel="noopener noreferrer"`. Inline `<img>` never loads: it renders as text.
  - **`HIGHLIGHT_LANGUAGES`.**
  - **CSS:** `.prose`, `.hljs-*` token colours, and KaTeX sizing.

- [ ] **Step 1: Install.**

Run:
```bash
pnpm --filter @mastertutor/web add -E react-markdown@10.1.0 remark-gfm@4.0.1 remark-math@6.0.0 rehype-katex@7.0.1 katex@0.19.0 rehype-raw@7.0.0 rehype-sanitize@6.0.0 rehype-highlight@7.0.2 highlight.js@11.12.0
```

- [ ] **Step 2: Write the failing test (Review Focus 1).**

`apps/web/components/note/block-markdown.test.ts`:
```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockMarkdown } from "./block-markdown.tsx";

const render = (markdown: string, allowHtml = false) => renderToStaticMarkup(createElement(BlockMarkdown, { markdown, allowHtml }));

describe("BlockMarkdown on untrusted page content", () => {
  it("strips scripts, handlers and javascript: URLs even in raw-HTML tables", () => {
    const html = render('<table onclick="steal()"><tr><td><script>alert(1)</script><img src=x onerror=alert(1)>a</td></tr></table>', true);
    expect(html).not.toMatch(/<script|onerror|onclick/i);
    expect(render("[x](javascript:alert(1))")).not.toContain('href="javascript');
  });

  it("never loads third-party images", () => {
    const html = render("![tracker](https://evil.example/pixel.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("Image: tracker");
  });

  it("opens links safely in a new tab", () => {
    expect(render("[docs](https://example.com)")).toContain('rel="noopener noreferrer"');
  });

  it("keeps rowspan/colspan in captured HTML tables", () => {
    expect(render('<table><tr><td rowspan="2">A</td></tr></table>', true).toLowerCase()).toContain('rowspan="2"');
  });

  it("ignores raw HTML outside table blocks", () => {
    expect(render("<b>bold</b> text")).not.toContain("<b>");
  });

  it("typesets display and inline math with KaTeX", () => {
    expect(render("$$\n\\frac{a}{b}\n$$")).toContain("katex-display");
    expect(render("inline $x^2$")).toContain('class="katex"');
  });

  it("highlights fenced code by language and keeps unknown languages plain", () => {
    expect(render("```python\ndef f(): return 1\n```")).toContain("hljs-keyword");
    expect(render("```cobol\nDISPLAY 'HI'\n```")).toContain("DISPLAY");
  });

  it("renders GFM tables", () => {
    expect(render("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("<table>");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm test -- apps/web/components/note/block-markdown`
Expected: FAIL, because the module is missing.

- [ ] **Step 4: Implement.**

`apps/web/components/note/highlight-languages.ts`:
```ts
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

/** A fixed, small set keeps the bundle lean; other languages render plain (byte-exact either way). */
export const HIGHLIGHT_LANGUAGES = { bash, c, cpp, css, go, java, javascript, json, python, rust, sql, typescript, xml };
```

`apps/web/components/note/block-markdown.tsx`:
```tsx
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { HIGHLIGHT_LANGUAGES } from "./highlight-languages.ts";

const schema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, code: [["className", /^language-./, "math-inline", "math-display"]] },
};

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Captured images are asset blocks; inline <img> in page markdown could track the reader.
  img: ({ alt }) => <span className="inline-img">{alt ? `Image: ${alt}` : "Image"}</span>,
};

type Plugins = NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>;
const SAFE: Plugins = [
  [rehypeSanitize, schema],
  [rehypeKatex, { throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" }],
  [rehypeHighlight, { languages: HIGHLIGHT_LANGUAGES, detect: false }],
];
const WITH_HTML: Plugins = [rehypeRaw, ...SAFE];

/** Renders one block's Markdown. Page content is untrusted: sanitize runs before KaTeX and highlight. */
export function BlockMarkdown({ markdown, allowHtml = false }: { markdown: string; allowHtml?: boolean }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={allowHtml ? WITH_HTML : SAFE} components={components}>
      {markdown}
    </ReactMarkdown>
  );
}
```

`apps/web/styles/note.css` (import it in `globals.css` after `library.css`):
```css
.prose {
  font-size: 1.0625rem;
  line-height: 1.65;
  letter-spacing: -0.011em;
  overflow-wrap: anywhere;
  & p + p {
    margin-top: 0.75rem;
  }
  & h2 {
    font: 700 1.625rem/1.2 var(--font-display);
    letter-spacing: -0.025em;
    padding-top: 1.4rem;
  }
  & h3 {
    font: 600 1.25rem/1.3 var(--font-display);
    padding-top: 1rem;
  }
  & ul,
  & ol {
    margin: 0;
    padding-left: 1.4rem;
  }
  & blockquote {
    padding-left: 1rem;
    border-left: 3px solid var(--hairline);
    color: var(--label-2);
  }
  & pre {
    margin: 0;
    padding: 1rem 1.1rem;
    overflow-x: auto;
    border-radius: var(--r-md);
    background: var(--bg-2);
    font: 400 0.8125rem/1.65 var(--font-code);
    overflow-wrap: normal;
  }
  & :not(pre) > code {
    padding: 0.1rem 0.3rem;
    border-radius: 0.3rem;
    background: var(--fill-2);
    font: 0.875em var(--font-code);
  }
  & table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    overflow-wrap: normal;
  }
  & th {
    padding: 0.55rem 0.6rem;
    border-bottom: 1px solid var(--label);
    text-align: left;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--label-2);
  }
  & td {
    padding: 0.6rem;
    border-bottom: 1px solid var(--sep);
    font-variant-numeric: tabular-nums;
  }
  & .katex-display {
    margin: 0;
    padding: 1rem 0;
    overflow-x: auto;
    overflow-y: hidden;
  }
  & .inline-img {
    font-style: italic;
    color: var(--label-2);
  }
}
.hljs-keyword,
.hljs-built_in {
  color: var(--code-keyword);
}
.hljs-number,
.hljs-literal {
  color: var(--code-number);
}
.hljs-title,
.hljs-function {
  color: var(--code-title);
}
.hljs-string {
  color: var(--code-string);
}
.hljs-comment {
  color: var(--code-comment);
  font-style: italic;
}
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/components/note && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): sanitized block markdown with KaTeX, GFM/HTML tables and highlighted code"
```

---

### Task 18: Note reader (source strip, blocks, provenance popover)

**Files:**
- Create: `apps/web/lib/notes/provenance.ts`, `apps/web/components/note/{note-reader,block-view,asset-image,source-strip,provenance-popover}.tsx`, `apps/web/app/(app)/notes/[noteId]/page.tsx`
- Modify: `apps/web/styles/note.css`
- Test: `apps/web/lib/notes/provenance.test.ts`, `apps/web/e2e/note.spec.ts`

**Interfaces:**
- Consumes: `BlockMarkdown`, `orpc`, `FidelityBadge`, `formatTimestamp`, `hostOf`, `pathOf`, `Popover` and `PopoverPanel`.
- Produces:
  - **`provenanceOf(block, source?)`** returns `{status: "verified"|"needs_review"|"edited"|"model"; statusLabel; icon: IconName; tone: BadgeTone; originLabel; snippet; selector: string|null; hashShort: string|null; where: string|null; openUrl: string|null}`.
  - **`calloutFor(block)`** returns `{lead; text; status} | null`.
  - **`isRawHtmlTable(block)`.**
  - **`/notes/[noteId]` renders `<NoteReader noteId>`.** Blocks get `id="block-<id>"`, a gutter provenance button and a popover with these actions: View in source, Open on page, Edit block, Show original.
  - **NoteReader state** shared with later tasks: `activeBlockId`, `openBlockId`, `editingId` and `view` (`"note"|"source"`).
  - **The `BlockView` props contract** is:
```ts
interface BlockViewProps {
  block: NoteBlock; source: SourceView | undefined; index: number;
  active: boolean; onActivate: (id: string | null) => void;
  provenanceOpen: boolean; onProvenanceOpenChange: (open: boolean) => void;
  editing: boolean; onEdit: () => void; onEditDone: () => void;
  onViewInSource: () => void;
}
```

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/notes/provenance.test.ts`:
```ts
import type { NoteBlock, SourceView } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { calloutFor, isRawHtmlTable, provenanceOf } from "./provenance.ts";

const base: NoteBlock = {
  id: "00000000-0000-4000-8000-000003000001", noteId: "00000000-0000-4000-8000-000002000001", position: "a0",
  type: "paragraph", markdown: "Training a transformer with Adam", assetId: null, sourceId: "s", origin: "dom",
  anchor: { selector: "article > p", xpath: null, start: null, end: null, textFragment: "Training a transformer" },
  contentSha256: "9f2c41e0".padEnd(64, "0"), verified: true, edited: false, originalMarkdown: null, createdAt: "2026-10-05T17:09:41.000Z",
};
const source: SourceView = { id: "s", kind: "web", url: "https://fieldnotes.ml/posts/x", canonicalUrl: null, origin: "https://fieldnotes.ml", title: null, faviconAssetId: null, capturedAt: base.createdAt };

describe("provenance", () => {
  it("describes a verified DOM block with a text-fragment link", () => {
    const p = provenanceOf(base, source);
    expect(p).toMatchObject({ status: "verified", originLabel: "Page text", selector: "article > p", hashShort: "9f2c41e0…" });
    expect(p.openUrl).toBe("https://fieldnotes.ml/posts/x#:~:text=Training%20a%20transformer");
    expect(calloutFor(base)).toBeNull();
  });
  it("flags OCR blocks for review", () => {
    const ocr = { ...base, origin: "ocr_model" as const, verified: false, anchor: null };
    expect(provenanceOf(ocr, source).status).toBe("needs_review");
    expect(calloutFor(ocr)?.lead).toBe("Needs review.");
  });
  it("marks edits and agent notes", () => {
    expect(provenanceOf({ ...base, edited: true, originalMarkdown: "x" }, source).status).toBe("edited");
    expect(calloutFor({ ...base, origin: "model", type: "commentary" })?.lead).toBe("Agent's note.");
  });
  it("cites video time and PDF pages", () => {
    const t = { ...base, origin: "captions" as const, anchor: { ...base.anchor!, tStart: 768, tEnd: 774 } };
    expect(provenanceOf(t, { ...source, kind: "youtube", url: "https://www.youtube.com/watch?v=x" })).toMatchObject({ where: "12:48–12:54" });
    expect(provenanceOf(t, { ...source, kind: "youtube", url: "https://www.youtube.com/watch?v=x" }).openUrl).toBe("https://www.youtube.com/watch?v=x&t=768s");
    expect(provenanceOf({ ...base, origin: "pdf", anchor: { ...base.anchor!, page: 3 } }, source).where).toBe("Page 3");
  });
  it("detects raw HTML tables only for table blocks", () => {
    expect(isRawHtmlTable({ ...base, type: "table", markdown: "<table></table>" })).toBe(true);
    expect(isRawHtmlTable({ ...base, markdown: "<table></table>" })).toBe(false);
  });
});
```

`apps/web/e2e/note.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("reader shows source strip, title and every block type, clean everywhere", async ({ page }) => {
  await page.goto(NOTE);
  await expect(page.getByRole("heading", { level: 1, name: "Learning-rate warmup, explained" })).toBeVisible();
  await expect(page.getByText("fieldnotes.ml")).toBeVisible();
  await expect(page.locator(".katex-display")).toBeVisible();
  await expect(page.locator(".hljs-keyword").first()).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Figure 2/ })).toBeVisible();
  await expect(page.getByText("Agent's note").first()).toBeVisible();
  await expectCleanScreen(page);
});

test("gutter button opens the provenance popover with source details", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("button", { name: /Provenance for block 1/ }).click();
  const pop = page.getByRole("dialog", { name: "Block provenance" });
  await expect(pop).toContainText("Page text");
  await expect(pop).toContainText("article > p");
  await expect(pop.getByRole("link", { name: "Open on page" })).toHaveAttribute("href", /#:~:text=/);
  await expectCleanScreen(page);
});

test("long titles, wide tables and code never push the page sideways (Review Focus 3)", async ({ page }) => {
  await page.goto("/notes/00000000-0000-4000-8000-000002000010");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectCleanScreen(page);
});

test("a search hit scrolls to and highlights its block", async ({ page }) => {
  await page.goto("/library?q=grad_norm");
  await page.getByRole("list", { name: "Search results" }).getByRole("link").first().click();
  await expect(page.locator(".blk-flash")).toBeVisible();
});

test("a missing note shows a calm empty state", async ({ page }) => {
  await page.goto("/notes/00000000-0000-4000-8000-000002999999");
  await expect(page.getByRole("heading", { name: "This note isn't available." })).toBeVisible();
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/notes && pnpm test:ui -- e2e/note.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/lib/notes/provenance.ts`:
```ts
import type { BlockOrigin, NoteBlock, SourceView } from "@mastertutor/contracts";
import type { BadgeTone } from "@/components/ui/badge.tsx";
import type { IconName } from "@/components/ui/icons.ts";
import { formatTimestamp } from "./format.ts";

export type ProvenanceStatus = "verified" | "needs_review" | "edited" | "model";

const ORIGIN_LABEL: Record<BlockOrigin, string> = {
  dom: "Page text",
  pdf: "PDF text layer",
  captions: "Uploader captions",
  asr: "Transcribed audio",
  ocr_model: "Read from an image",
  model: "Written by the agent",
  user: "Written by you",
};

const STATUS: Record<ProvenanceStatus, { label: string; icon: IconName; tone: BadgeTone }> = {
  verified: { label: "Verified", icon: "verified", tone: "ok" },
  needs_review: { label: "Needs review", icon: "needsReview", tone: "warn" },
  edited: { label: "Edited by you", icon: "edited", tone: "tint" },
  model: { label: "Agent's note", icon: "agentNote", tone: "neutral" },
};

export function statusOf(block: NoteBlock): ProvenanceStatus {
  if (block.origin === "model") return "model";
  if (!block.verified) return "needs_review";
  if (block.edited) return "edited";
  return "verified";
}

export const isRawHtmlTable = (block: NoteBlock) => block.type === "table" && block.markdown.trimStart().startsWith("<");

export function provenanceOf(block: NoteBlock, source: SourceView | undefined) {
  const status = statusOf(block);
  const meta = STATUS[status];
  const a = block.anchor;
  const where =
    a?.tStart !== undefined
      ? `${formatTimestamp(a.tStart)}${a.tEnd !== undefined && a.tEnd !== a.tStart ? `–${formatTimestamp(a.tEnd)}` : ""}`
      : a?.page !== undefined
        ? `Page ${a.page}`
        : null;
  let openUrl: string | null = null;
  if (source && block.origin !== "model") {
    if (source.kind === "youtube" && a?.tStart !== undefined) {
      const url = new URL(source.url);
      url.searchParams.set("t", `${Math.floor(a.tStart)}s`);
      openUrl = url.toString();
    } else if (source.kind === "pdf" && a?.page !== undefined) {
      openUrl = `${source.url}#page=${a.page}`;
    } else if (a?.textFragment) {
      openUrl = `${source.url}#:~:text=${encodeURIComponent(a.textFragment)}`;
    } else {
      openUrl = source.url;
    }
  }
  const plain = (a?.textFragment ?? block.markdown).replace(/[#*_`>$|\\]/g, "").replace(/\s+/g, " ").trim();
  return {
    status,
    statusLabel: meta.label,
    icon: meta.icon,
    tone: meta.tone,
    originLabel: ORIGIN_LABEL[block.origin],
    snippet: plain.length > 180 ? `${plain.slice(0, 180)}…` : plain,
    selector: a?.selector ?? null,
    hashShort: block.contentSha256 ? `${block.contentSha256.slice(0, 8)}…` : null,
    where,
    openUrl,
  };
}

/** Margin callouts (cutaway device): only blocks whose provenance is worth a glance. */
export function calloutFor(block: NoteBlock): { lead: string; text: string; status: ProvenanceStatus } | null {
  const status = statusOf(block);
  if (status === "needs_review") return { lead: "Needs review.", text: "Read from an image by the model. Check it against the source.", status };
  if (status === "edited") return { lead: "Edited by you.", text: "The captured original is kept.", status };
  if (status === "model") return { lead: "Agent's note.", text: "Written by the agent, not captured.", status };
  if (block.anchor?.tStart !== undefined && block.type === "keyframe") return { lead: `Keyframe at ${formatTimestamp(block.anchor.tStart)}.`, text: "Captured from the player.", status };
  switch (block.type) {
    case "table": return { lead: "Table.", text: "Copied cell by cell from the page.", status };
    case "math": return { lead: "Math.", text: "Re-typeset from the page's markup.", status };
    case "code": return { lead: "Code.", text: "Byte-exact, whitespace kept.", status };
    case "figure":
    case "image": return { lead: "Figure.", text: "The original image, stored as captured.", status };
    default: return null;
  }
}
```

`apps/web/components/note/asset-image.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { orpc } from "@/lib/api/client.ts";

const FOUR_MINUTES = 4 * 60_000;

export function AssetImage({ assetId, alt, className }: { assetId: string; alt: string; className?: string }) {
  const { data, isError } = useQuery({ ...orpc.assets.url.queryOptions({ input: { assetId } }), staleTime: FOUR_MINUTES });
  if (isError) return <p className="t-foot">This image couldn't be loaded.</p>;
  if (!data) return <Skeleton className="aspect-video w-full rounded-lg" />;
  // eslint-disable-next-line @next/next/no-img-element -- presigned/data URLs, not optimisable
  return <img src={data.url} alt={alt} className={className} loading="lazy" decoding="async" />;
}
```

There is no Next ESLint plugin, so drop that disable comment. It is shown here only to explain why `<img>` is used.

`apps/web/components/note/provenance-popover.tsx`:
```tsx
"use client";

import type { NoteBlock, SourceView } from "@mastertutor/contracts";
import { useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Popover, PopoverPanel } from "@/components/ui/popover.tsx";
import { cx } from "@/lib/cx.ts";
import { provenanceOf } from "@/lib/notes/provenance.ts";

export function ProvenancePopover({ block, source, index, open, onOpenChange, onEdit, onViewInSource, editable }: { block: NoteBlock; source: SourceView | undefined; index: number; open: boolean; onOpenChange: (open: boolean) => void; onEdit: () => void; onViewInSource: () => void; editable: boolean }) {
  const p = provenanceOf(block, source);
  const [showOriginal, setShowOriginal] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Popover.Trigger className={cx("gutter-btn", `gutter-${p.status}`)} aria-label={`Provenance for block ${index + 1}: ${p.statusLabel}`}>
        <Icon name={p.icon} size="sm" />
      </Popover.Trigger>
      <PopoverPanel label="Block provenance" side="left" align="start">
        <div className="prov">
          <div className="prov-head">
            <Badge tone={p.tone} icon={p.icon}>{p.statusLabel}</Badge>
            <span className="t-foot">{p.originLabel}{p.where ? ` · ${p.where}` : ""}</span>
          </div>
          {p.snippet ? <blockquote className="prov-quote">{p.snippet}</blockquote> : null}
          <dl className="prov-kv">
            {p.selector ? (<><dt>Selector</dt><dd className="mono">{p.selector}</dd></>) : null}
            {p.hashShort ? (<><dt>SHA-256</dt><dd className="mono">{p.hashShort}</dd></>) : null}
          </dl>
          {block.edited && block.originalMarkdown ? (
            <div>
              <Button variant="plain" onClick={() => setShowOriginal((s) => !s)}>{showOriginal ? "Hide original" : "Show original"}</Button>
              {showOriginal ? <p className="prov-original">{block.originalMarkdown}</p> : null}
            </div>
          ) : null}
          <div className="prov-actions">
            {editable ? <Button onClick={() => { onOpenChange(false); onEdit(); }} icon="edit">Edit block</Button> : null}
            {block.origin !== "model" ? <Button onClick={() => { onOpenChange(false); onViewInSource(); }} icon="split">View in source</Button> : null}
            {p.openUrl ? (
              <a className="btn btn-plain" href={p.openUrl} target="_blank" rel="noopener noreferrer">
                Open on page <Icon name="external" size="sm" />
              </a>
            ) : null}
          </div>
        </div>
      </PopoverPanel>
    </Popover.Root>
  );
}
```

`apps/web/components/note/block-view.tsx`:
```tsx
"use client";

import type { NoteBlock, SourceView } from "@mastertutor/contracts";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cx } from "@/lib/cx.ts";
import { formatTimestamp } from "@/lib/notes/format.ts";
import { isRawHtmlTable, statusOf } from "@/lib/notes/provenance.ts";
import { AssetImage } from "./asset-image.tsx";
import { BlockMarkdown } from "./block-markdown.tsx";
import { ProvenancePopover } from "./provenance-popover.tsx";

export const EDITABLE_TYPES = new Set(["heading", "paragraph", "list", "quote", "commentary", "code", "math", "table", "transcript"]);

export interface BlockViewProps {
  block: NoteBlock;
  source: SourceView | undefined;
  index: number;
  active: boolean;
  onActivate: (id: string | null) => void;
  provenanceOpen: boolean;
  onProvenanceOpenChange: (open: boolean) => void;
  editing: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  onViewInSource: () => void;
}

export function BlockContent({ block }: { block: NoteBlock }) {
  const plainCaption = block.markdown.replace(/[*_`#>]/g, "").trim();
  switch (block.type) {
    case "image":
    case "figure":
    case "keyframe":
      return (
        <figure className="blk-figure">
          {block.assetId ? <AssetImage assetId={block.assetId} alt={plainCaption || "Captured image"} className="blk-img" /> : null}
          {block.type !== "image" && block.markdown ? (
            <figcaption className="cap">
              {block.type === "keyframe" && block.anchor?.tStart !== undefined ? <b>{formatTimestamp(block.anchor.tStart)} </b> : null}
              <BlockMarkdown markdown={block.markdown} />
            </figcaption>
          ) : null}
        </figure>
      );
    case "transcript":
      return (
        <p className="blk-transcript">
          {block.anchor?.tStart !== undefined ? <span className="mono blk-time">[{formatTimestamp(block.anchor.tStart)}]</span> : null}
          <span><BlockMarkdown markdown={block.markdown} /></span>
        </p>
      );
    case "commentary":
      return (
        <aside className="blk-commentary" aria-label="Agent's note">
          <span className="eyebrow">Agent's note</span>
          <BlockMarkdown markdown={block.markdown} />
        </aside>
      );
    default:
      return (
        <div className={cx(block.type === "table" && "blk-scroll")}>
          <BlockMarkdown markdown={block.markdown} allowHtml={isRawHtmlTable(block)} />
        </div>
      );
  }
}

const BlockEditor = dynamic(() => import("./block-editor.tsx").then((m) => m.BlockEditor), {
  ssr: false,
  loading: () => <Skeleton className="h-24 w-full rounded-md" />,
});

export function BlockView(props: BlockViewProps) {
  const { block, source, index, active, onActivate, provenanceOpen, onProvenanceOpenChange, editing, onEdit, onEditDone, onViewInSource } = props;
  const status = statusOf(block);
  return (
    <div
      id={`block-${block.id}`}
      data-block-id={block.id}
      className={cx("blk", active && "blk-hot", `blk-${status}`)}
      onPointerEnter={() => onActivate(block.id)}
      onPointerLeave={() => onActivate(null)}
    >
      <ProvenancePopover block={block} source={source} index={index} open={provenanceOpen} onOpenChange={onProvenanceOpenChange} onEdit={onEdit} onViewInSource={onViewInSource} editable={EDITABLE_TYPES.has(block.type)} />
      {editing ? <BlockEditor block={block} onDone={onEditDone} /> : <BlockContent block={block} />}
      {status === "needs_review" ? (
        <div className="blk-actions" data-qa="review-actions">
          <Badge tone="warn" icon="needsReview">Needs review</Badge>
        </div>
      ) : null}
    </div>
  );
}
```

`block-editor.tsx` is created in Task 22. Until then, create a placeholder-free minimal version so the import resolves:
```tsx
"use client";
import type { NoteBlock } from "@mastertutor/contracts";
import { BlockContent } from "./block-view.tsx";
export function BlockEditor({ block }: { block: NoteBlock; onDone: () => void }) {
  return <BlockContent block={block} />;
}
```
Task 22 replaces it.

`apps/web/components/note/source-strip.tsx`:
```tsx
"use client";

import type { NoteDetail } from "@mastertutor/contracts";
import Link from "next/link";
import { FidelityBadge } from "@/components/library/fidelity-badge.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { SOURCE_KIND_ICON } from "@/components/ui/icons.ts";
import { formatDateTime, hostOf, pathOf } from "@/lib/notes/format.ts";
import { AssetImage } from "./asset-image.tsx";

export function SourceStrip({ detail }: { detail: NoteDetail }) {
  const verified = detail.blocks.filter((b) => b.verified && b.origin !== "model").length;
  const captured = detail.blocks.filter((b) => b.origin !== "model").length;
  return (
    <div className="srcstrip">
      {detail.sources.map((s) => (
        <span key={s.id} className="srcstrip-source">
          {s.faviconAssetId ? <AssetImage assetId={s.faviconAssetId} alt="" className="srcstrip-fav" /> : <Icon name={SOURCE_KIND_ICON[s.kind]} />}
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="srcstrip-url">
            <b>{hostOf(s.url)}</b>
            <span className="srcstrip-path">{pathOf(s.url)}</span>
          </a>
          <span className="t-foot srcstrip-time">
            <Icon name="session" size="sm" /> Captured {formatDateTime(s.capturedAt)}
          </span>
        </span>
      ))}
      <span className="srcstrip-right">
        <FidelityBadge fidelity={detail.note.fidelity} coverage={detail.note.coverage} />
        <span className="t-foot">{verified} of {captured} verified</span>
        {detail.note.runId ? <Link href={`/runs/${detail.note.runId}`} className="t-foot">Run {detail.note.runId.slice(-6)}</Link> : null}
      </span>
    </div>
  );
}
```

`apps/web/components/note/note-reader.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { folderPath } from "@/lib/folders/tree.ts";
import { libraryHref } from "@/lib/library/params.ts";
import { formatDate } from "@/lib/notes/format.ts";
import { BlockView } from "./block-view.tsx";
import { SourceStrip } from "./source-strip.tsx";

export function NoteReader({ noteId }: { noteId: string }) {
  const { data, isPending, isError } = useQuery(orpc.notes.get.queryOptions({ input: { noteId } }));
  const folders = useQuery(orpc.folders.tree.queryOptions({ input: {} })).data?.folders ?? [];
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#block-")) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("blk-flash");
  }, [data]);

  if (isError) {
    return (
      <div className="wrap">
        <EmptyState icon="allNotes" title="This note isn't available" body="It may have been deleted or moved out of your workspace." actions={<ButtonLink href="/library" variant="primary">Back to Library</ButtonLink>} />
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="reader" aria-busy="true" aria-label="Loading note">
        <Skeleton className="mt-10 h-10 w-full rounded-md" />
        <Skeleton className="mt-12 h-12 w-3/4" />
        <Skeleton className="mt-8 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </div>
    );
  }

  const path = data.note.folderId ? folderPath(folders, data.note.folderId) : [];
  const sourceById = new Map(data.sources.map((s) => [s.id, s]));

  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Library", href: "/library" }, ...path.map((f) => ({ label: f.name, href: libraryHref({ folder: f.id }) })), { label: data.note.title }]} />
        <ToolbarSpacer />
      </Toolbar>
      <article className="reader" aria-labelledby="note-title">
        <SourceStrip detail={data} />
        <header className="reader-head">
          {path.length ? <p className="eyebrow reader-eyebrow">{path.map((f) => f.name).join(" · ")}</p> : null}
          <h1 id="note-title" className="reader-title">{data.note.title}</h1>
          {data.note.lede ? <p className="reader-lede">{data.note.lede}</p> : null}
          <p className="t-foot">{formatDate(data.note.createdAt)} · {data.blocks.length} blocks · filed by {data.note.filedBy === "agent" ? "the agent" : "you"}</p>
        </header>
        <div className="reader-body" ref={bodyRef}>
          <div className="reader-content prose" data-qa-obstacle>
            {data.blocks.map((block, i) => (
              <BlockView
                key={block.id}
                block={block}
                source={block.sourceId ? sourceById.get(block.sourceId) : undefined}
                index={i}
                active={activeBlockId === block.id}
                onActivate={setActiveBlockId}
                provenanceOpen={openBlockId === block.id}
                onProvenanceOpenChange={(open) => setOpenBlockId(open ? block.id : null)}
                editing={editingId === block.id}
                onEdit={() => setEditingId(block.id)}
                onEditDone={() => setEditingId(null)}
                onViewInSource={() => undefined}
              />
            ))}
          </div>
        </div>
      </article>
    </>
  );
}
```

`apps/web/app/(app)/notes/[noteId]/page.tsx`:
```tsx
import { Uuid } from "@mastertutor/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NoteReader } from "@/components/note/note-reader.tsx";

export const metadata: Metadata = { title: "Note" };

export default async function NotePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  if (!Uuid.safeParse(noteId).success) notFound();
  return (
    <Suspense>
      <NoteReader noteId={noteId} />
    </Suspense>
  );
}
```

Append to `apps/web/styles/note.css`:
```css
.reader {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  max-width: calc(var(--measure) + 2rem);
  margin: 0 auto;
  padding: 0 1rem 8rem;
  @variant md {
    max-width: calc(var(--gutter) * 2 + var(--measure));
    padding: 0 var(--gutter) 10rem;
  }
  @variant lg {
    max-width: calc(var(--gutter) * 3 + var(--measure) + var(--margin-col));
  }
}
.srcstrip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 0.85rem;
  margin-top: 1.5rem;
  padding: 0.7rem 0.9rem;
  border-radius: var(--r-md);
  background: var(--bg-2);
  font-size: 0.8125rem;
  @variant lg {
    margin-top: 2.5rem;
  }
}
.srcstrip-source {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex-wrap: wrap;
}
.srcstrip-fav {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.4375rem;
}
.srcstrip-url {
  min-width: 0;
  color: var(--label);
  overflow-wrap: anywhere;
}
.srcstrip-path {
  display: none;
  color: var(--label-2);
  @variant sm {
    display: inline;
  }
}
.srcstrip-time {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.srcstrip-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  @variant md {
    margin-left: auto;
  }
}
.reader-head {
  display: grid;
  gap: 0.75rem;
  margin: 2.5rem 0 2rem;
  @variant lg {
    margin-top: 3rem;
  }
}
.reader-eyebrow {
  color: var(--signal);
}
.reader-title {
  font: 700 clamp(2rem, 4vw, 3.25rem) / 1.04 var(--font-display);
  letter-spacing: -0.038em;
  overflow-wrap: anywhere;
}
.reader-lede {
  font-size: 1.3125rem;
  line-height: 1.5;
  letter-spacing: -0.017em;
  overflow-wrap: anywhere;
}
.reader-body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  @variant lg {
    grid-template-columns: minmax(0, var(--measure)) var(--gutter) var(--margin-col);
  }
}
.reader-content {
  min-width: 0;
}
.blk {
  position: relative;
  margin: 0 -0.9rem;
  padding: 0.35rem 2.75rem 0.35rem 0.9rem;
  border-radius: 0.625rem;
  @variant md {
    padding-right: 0.9rem;
  }
  & + .blk {
    margin-top: 1rem;
  }
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--tint-wash);
    opacity: 0;
    pointer-events: none;
  }
}
.blk-hot {
  background: var(--fill-2);
}
.blk-flash::before {
  animation-name: flash;
  animation-duration: var(--motion-dur-shimmer);
  animation-timing-function: var(--motion-ease-out);
}
@keyframes flash {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
.blk-edited {
  box-shadow: inset 3px 0 0 var(--tint);
}
.blk-needs_review {
  box-shadow: inset 3px 0 0 var(--warn);
}
.gutter-btn {
  position: absolute;
  top: 0.45rem;
  right: 0.35rem;
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  color: var(--label-2);
  &::after {
    content: "";
    position: absolute;
    inset: -0.5rem;
  }
  &:hover {
    background: var(--fill);
  }
  @variant md {
    left: calc(-1 * var(--gutter) + 0.4rem);
    right: auto;
  }
}
.gutter-verified {
  color: var(--ok);
}
.gutter-needs_review {
  color: var(--warn);
}
.gutter-edited {
  color: var(--tint-text);
}
.blk-figure {
  display: grid;
  gap: 0.75rem;
}
.blk-img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--r-lg);
  background: var(--bg-2);
}
.blk-transcript {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
}
.blk-time {
  padding-top: 0.25rem;
  color: var(--tint-text);
}
.blk-commentary {
  display: grid;
  gap: 0.35rem;
  padding: 0.75rem 1rem;
  border-radius: var(--r-md);
  background: var(--fill-2);
}
.blk-scroll {
  overflow-x: auto;
}
.blk-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.6rem;
}
.prov {
  display: grid;
  gap: 0.6rem;
}
.prov-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.prov-quote {
  padding: 0.6rem 0.75rem;
  border-radius: 0.625rem;
  background: var(--bg-2);
  font-size: 0.8125rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.prov-kv {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr);
  gap: 0.25rem 0.5rem;
  margin: 0;
  font-size: 0.75rem;
  & dt {
    color: var(--label-2);
  }
  & dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
}
.prov-original {
  padding: 0.5rem 0.75rem;
  border-left: 3px solid var(--hairline);
  color: var(--label-2);
  font-size: 0.8125rem;
}
.prov-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
```

Also put `.sr-only` in `base.css` if it is not already provided by Tailwind. Tailwind's `sr-only` utility class is available.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/notes && pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/note.spec.ts`
Expected: PASS in 5 projects.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): note reader with source strip, typed blocks, gutter provenance popovers"
```

---

### Task 19: Margin callouts with collision avoidance (D22)

**Files:**
- Create: `apps/web/lib/notes/callout-layout.ts`, `apps/web/components/note/margin-callouts.tsx`
- Modify: `apps/web/components/note/note-reader.tsx`, `apps/web/styles/note.css`
- Test: `apps/web/lib/notes/callout-layout.test.ts`, `apps/web/e2e/provenance.spec.ts`

**Interfaces:**
- Consumes: `calloutFor`, `useMediaQuery` and `MEDIA.lg`.
- Produces:
  - **`layoutCallouts(items: Array<{id; anchorTop; height}>, opts: {gap; containerHeight}): Array<{id; top; hidden}>`.** Captions keep their order, are pushed down on collision and shifted up at the bottom. Captions that cannot fit are hidden; their gutter button still carries the status.
  - **`<MarginCallouts blocks bodyRef activeBlockId onActivate onOpen>`**, rendered above 1180 px only. Leaders are drawn in the gutter column and never cross content. Callouts carry `data-qa-avoid` and `data-qa-obstacle`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/notes/callout-layout.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { layoutCallouts } from "./callout-layout.ts";

const opts = { gap: 12, containerHeight: 1000 };

describe("layoutCallouts", () => {
  it("keeps captions at their anchors when there is room", () => {
    expect(layoutCallouts([{ id: "a", anchorTop: 0, height: 40 }, { id: "b", anchorTop: 200, height: 40 }], opts)).toEqual([
      { id: "a", top: 0, hidden: false },
      { id: "b", top: 200, hidden: false },
    ]);
  });
  it("pushes colliding captions down in order", () => {
    const out = layoutCallouts([{ id: "a", anchorTop: 100, height: 60 }, { id: "b", anchorTop: 110, height: 40 }], opts);
    expect(out[1]).toEqual({ id: "b", top: 172, hidden: false });
  });
  it("sorts by anchor and shifts up when the last caption would overflow", () => {
    const out = layoutCallouts([{ id: "z", anchorTop: 980, height: 50 }, { id: "y", anchorTop: 900, height: 50 }], opts);
    expect(out.map((o) => o.id)).toEqual(["y", "z"]);
    expect(out[1]!.top + 50).toBeLessThanOrEqual(1000);
    expect(out[1]!.top - (out[0]!.top + 50)).toBeGreaterThanOrEqual(12);
  });
  it("hides captions that cannot fit rather than overlapping", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), anchorTop: i, height: 60 }));
    const out = layoutCallouts(many, { gap: 12, containerHeight: 300 });
    const shown = out.filter((o) => !o.hidden);
    for (let i = 1; i < shown.length; i++) expect(shown[i]!.top).toBeGreaterThanOrEqual(shown[i - 1]!.top + 72);
    expect(shown.every((o) => o.top >= 0 && o.top + 60 <= 300)).toBe(true);
    expect(out.some((o) => o.hidden)).toBe(true);
  });
});
```

`apps/web/e2e/provenance.spec.ts`:
```ts
import { expect, expectCleanScreen, isWide, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("wide reader shows margin callouts whose leaders never cross content", async ({ page }) => {
  await page.goto(NOTE);
  const callouts = page.locator('[data-qa="callout"]');
  if (isWide(page)) {
    await expect(callouts.filter({ hasText: "Needs review." })).toBeVisible();
    await expect(callouts.filter({ hasText: "Edited by you." })).toBeVisible();
    await expect(page.locator('[data-qa="leaders"]')).toBeVisible();
  } else {
    await expect(callouts).toHaveCount(0);
  }
  await expectCleanScreen(page);
});

test("clicking a callout opens that block's provenance", async ({ page }) => {
  test.skip(!isWide(page), "callouts are wide-only");
  await page.goto(NOTE);
  await page.locator('[data-qa="callout"]').filter({ hasText: "Edited by you." }).click();
  await expect(page.getByRole("dialog", { name: "Block provenance" })).toContainText("Edited by you");
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- callout-layout && pnpm test:ui -- e2e/provenance.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/lib/notes/callout-layout.ts`:
```ts
export interface CalloutItem {
  id: string;
  anchorTop: number;
  height: number;
}
export interface PlacedCallout {
  id: string;
  top: number;
  hidden: boolean;
}

/**
 * Places margin captions in anchor order without overlap (D22). Forward pass pushes down;
 * backward pass pulls up from the container bottom; captions that still cannot fit are hidden.
 */
export function layoutCallouts(items: readonly CalloutItem[], opts: { gap: number; containerHeight: number }): PlacedCallout[] {
  const sorted = [...items].sort((a, b) => a.anchorTop - b.anchorTop);
  const shown: Array<CalloutItem & { top: number }> = [];
  const hidden: CalloutItem[] = [];
  let cursor = 0;
  for (const item of sorted) {
    const top = Math.max(item.anchorTop, cursor);
    if (top + item.height > opts.containerHeight && shown.length > 0) {
      // Try to make room by sliding earlier captions up toward their own anchors' limit (0).
      const needed = top + item.height - opts.containerHeight;
      const slack = shown.reduce((room, s, i) => {
        const prevBottom = i === 0 ? 0 : (shown[i - 1]?.top ?? 0) + (shown[i - 1]?.height ?? 0) + opts.gap;
        return Math.min(room === Infinity ? s.top - prevBottom : room, s.top - prevBottom);
      }, Infinity);
      if (Number.isFinite(slack) && slack >= needed) {
        for (const s of shown) s.top -= needed;
        shown.push({ ...item, top: top - needed });
        cursor = top - needed + item.height + opts.gap;
      } else {
        hidden.push(item);
      }
      continue;
    }
    if (top + item.height > opts.containerHeight) {
      hidden.push(item);
      continue;
    }
    shown.push({ ...item, top });
    cursor = top + item.height + opts.gap;
  }
  // Backward pass: keep the last caption inside the container, keeping gaps.
  for (let i = shown.length - 1; i >= 0; i--) {
    const s = shown[i]!;
    const limit = i === shown.length - 1 ? opts.containerHeight - s.height : (shown[i + 1]?.top ?? 0) - opts.gap - s.height;
    s.top = Math.max(0, Math.min(s.top, limit));
  }
  const hiddenIds = new Set(hidden.map((h) => h.id));
  return sorted.map((item) => {
    const placed = shown.find((s) => s.id === item.id);
    return { id: item.id, top: placed?.top ?? item.anchorTop, hidden: hiddenIds.has(item.id) };
  });
}
```

The slack computation keeps the rule simple: shift every shown caption up by `needed`, but only if the smallest gap between consecutive captions (the first one counts its distance from 0) can absorb it. The unit tests pin the behaviour. If the "shifts up" test fails because a uniform shift breaks a gap, change the slack to `shown[0].top` (room above the first caption). That also satisfies the tests, because the backward pass enforces the gaps.

`apps/web/components/note/margin-callouts.tsx`:
```tsx
"use client";

import type { NoteBlock } from "@mastertutor/contracts";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { cx } from "@/lib/cx.ts";
import { layoutCallouts, type PlacedCallout } from "@/lib/notes/callout-layout.ts";
import { calloutFor } from "@/lib/notes/provenance.ts";

const GAP = 12;
const LEADER_Y = 14;
const CAPTION_Y = 9;

export function MarginCallouts({ blocks, bodyRef, activeBlockId, onActivate, onOpen }: { blocks: NoteBlock[]; bodyRef: RefObject<HTMLDivElement | null>; activeBlockId: string | null; onActivate: (id: string | null) => void; onOpen: (id: string) => void }) {
  const entries = blocks.flatMap((b) => {
    const c = calloutFor(b);
    return c ? [{ block: b, callout: c }] : [];
  });
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [placed, setPlaced] = useState<PlacedCallout[]>([]);
  const [anchors, setAnchors] = useState(new Map<string, number>());
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    const measure = () => {
      const bodyTop = body.getBoundingClientRect().top;
      const nextAnchors = new Map<string, number>();
      const items = entries.flatMap(({ block }) => {
        const el = document.getElementById(`block-${block.id}`);
        const caption = refs.current.get(block.id);
        if (!el || !caption) return [];
        const anchorTop = el.getBoundingClientRect().top - bodyTop;
        nextAnchors.set(block.id, anchorTop);
        return [{ id: block.id, anchorTop, height: caption.offsetHeight }];
      });
      setAnchors(nextAnchors);
      setHeight(body.offsetHeight);
      setPlaced(layoutCallouts(items, { gap: GAP, containerHeight: body.offsetHeight }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entries derive from blocks
  }, [blocks, bodyRef]);

  const byId = new Map(placed.map((p) => [p.id, p]));
  return (
    <>
      <svg className="leaders" data-qa="leaders" data-qa-avoid aria-hidden="true" height={height} preserveAspectRatio="none">
        {entries.map(({ block, callout }) => {
          const p = byId.get(block.id);
          const a = anchors.get(block.id);
          if (!p || p.hidden || a === undefined) return null;
          const y1 = a + LEADER_Y;
          const y2 = p.top + CAPTION_Y;
          return (
            <g key={block.id} className={cx(activeBlockId === block.id && "leader-on", callout.status === "needs_review" && "leader-signal")}>
              <path d={`M 4 ${y1} L 100% ${y2}`} />
              <circle cx="4" cy={y1} r="2.75" />
            </g>
          );
        })}
      </svg>
      <div className="callouts" data-qa-allow-clip>
        {entries.map(({ block, callout }) => {
          const p = byId.get(block.id);
          return (
            <button
              key={block.id}
              ref={(el) => {
                if (el) refs.current.set(block.id, el);
                else refs.current.delete(block.id);
              }}
              type="button"
              data-qa="callout"
              data-qa-avoid
              data-qa-obstacle
              className={cx("callout", activeBlockId === block.id && "callout-on")}
              style={{ top: p?.top ?? 0, visibility: !p || p.hidden ? "hidden" : "visible" }}
              onPointerEnter={() => onActivate(block.id)}
              onPointerLeave={() => onActivate(null)}
              onClick={() => onOpen(block.id)}
            >
              <span className="cap">
                <b>{callout.lead}</b> {callout.text}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
```

An SVG `path` `d` cannot use `100%`. Measure the gutter width instead: compute `const gutterWidth = body.querySelector(".leaders")?.getBoundingClientRect().width ?? 40` inside `measure`, store it in state as `w`, and draw `M 4 ${y1} L ${w} ${y2}`. Implement it that way.

The callouts container uses `data-qa-allow-clip` because hidden captions keep their natural position but are invisible.

In `note-reader.tsx`, add:
```tsx
  const wide = useMediaQuery(MEDIA.lg);
```
After `.reader-content`, render:
```tsx
          {wide ? (
            <MarginCallouts blocks={data.blocks} bodyRef={bodyRef} activeBlockId={activeBlockId} onActivate={setActiveBlockId} onOpen={(id) => setOpenBlockId(id)} />
          ) : null}
```
Import `useMediaQuery`, `MEDIA` and `MarginCallouts`. Move the `useMediaQuery` call above the early returns (rules of hooks).

Append to `apps/web/styles/note.css`:
```css
.leaders {
  position: relative;
  grid-column: 2;
  width: 100%;
  overflow: hidden;
  pointer-events: none;
  & path {
    fill: none;
    stroke: var(--label-3);
    stroke-width: 1.25;
    stroke-dasharray: 0 4;
    stroke-linecap: round;
  }
  & circle {
    fill: var(--label-3);
  }
  & .leader-on path {
    stroke: var(--label);
  }
  & .leader-on circle {
    fill: var(--label);
  }
  & .leader-signal path {
    stroke: var(--signal);
  }
  & .leader-signal circle {
    fill: var(--signal);
  }
}
.callouts {
  position: relative;
  grid-column: 3;
  overflow: hidden;
}
.callout {
  position: absolute;
  left: 0;
  width: 100%;
  padding: 0.35rem 0.5rem;
  border-radius: var(--r-sm);
  text-align: left;
  &:hover,
  &.callout-on {
    background: var(--fill-2);
  }
  &.callout-on .cap {
    color: var(--label);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- callout-layout && pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/provenance.spec.ts e2e/note.spec.ts`
Expected: PASS. The overlap detector confirms that callouts never overlap the content column or each other.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): cutaway margin callouts with collision-avoiding layout and gutter-only leaders"
```

---

### Task 20: Source | Note view

**Files:**
- Create: `apps/web/components/note/source-pane.tsx`
- Modify: `apps/web/components/note/note-reader.tsx`, `apps/web/styles/note.css`
- Test: `apps/web/e2e/source-note.spec.ts`

**Interfaces:**
- Consumes: `RubberSegment`, `BlockMarkdown`, `isRawHtmlTable`, and the NoteReader state.
- Produces:
  - **A layout toggle** in the toolbar: a "Layout" radiogroup with Note and Source | Note, stored in `?view=source`.
  - **`<SourcePane detail activeBlockId onPick>`**: a read-only "page" that renders `originalMarkdown ?? markdown` per captured block, in order.
  - **Sync.** Hovering a note block highlights its source block and scrolls it into view. Clicking a source block scrolls to and flashes the note block. "View in source" opens this view focused on the block.
  - **Layout.** At ≤ 820 px the two panes stack, source first; at 821 px and wider they sit side by side.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/source-note.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("Source | Note shows the captured text beside the note and stays in sync", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: "Source | Note" }).click();
  await expect(page).toHaveURL(/view=source/);
  const source = page.getByRole("region", { name: "Captured source" });
  await expect(source).toContainText("Go longer if you raise the batch size");
  await expectCleanScreen(page);
  await source.getByRole("button", { name: /The update rule/ }).click();
  await expect(page.locator(".blk-flash")).toContainText("The update rule");
});

test("View in source opens the split view on that block", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("button", { name: /Provenance for block 3/ }).click();
  await page.getByRole("dialog", { name: "Block provenance" }).getByRole("button", { name: "View in source" }).click();
  await expect(page).toHaveURL(/view=source/);
  await expect(page.locator(".src-block-hot")).toBeVisible();
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/source-note.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/components/note/source-pane.tsx`:
```tsx
"use client";

import type { NoteDetail } from "@mastertutor/contracts";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { cx } from "@/lib/cx.ts";
import { formatDateTime, hostOf } from "@/lib/notes/format.ts";
import { isRawHtmlTable } from "@/lib/notes/provenance.ts";
import { BlockMarkdown } from "./block-markdown.tsx";

export function SourcePane({ detail, activeBlockId, onPick }: { detail: NoteDetail; activeBlockId: string | null; onPick: (blockId: string) => void }) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (activeBlockId) refs.current.get(activeBlockId)?.scrollIntoView({ block: "nearest" });
  }, [activeBlockId]);
  const captured = detail.blocks.filter((b) => b.origin !== "model");
  const source = detail.sources[0];
  return (
    <section className="src-pane" aria-label="Captured source">
      <p className="src-bar t-foot">
        <Icon name="sealed" size="sm" />
        {source ? `${hostOf(source.url)} · captured ${formatDateTime(source.capturedAt)} · read-only` : "Captured text · read-only"}
      </p>
      <article className="src-page prose">
        {captured.map((block) => (
          <button
            key={block.id}
            ref={(el) => {
              if (el) refs.current.set(block.id, el);
              else refs.current.delete(block.id);
            }}
            type="button"
            className={cx("src-block", activeBlockId === block.id && "src-block-hot")}
            onClick={() => onPick(block.id)}
          >
            <BlockMarkdown markdown={block.originalMarkdown ?? block.markdown} allowHtml={isRawHtmlTable(block)} />
          </button>
        ))}
      </article>
    </section>
  );
}
```

Edits to `note-reader.tsx`:
- Read the view: `const search = useSearchParams(); const router = useRouter(); const pathname = usePathname(); const view = search.get("view") === "source" ? "source" : "note";`, plus `const setView = (v: "note" | "source") => router.replace(v === "source" ? \`${pathname}?view=source\` : pathname, { scroll: false });`. Put these hooks above the early returns.
- Add a helper:
```tsx
  const focusNoteBlock = (id: string) => {
    setActiveBlockId(id);
    const el = document.getElementById(`block-${id}`);
    el?.scrollIntoView({ block: "center" });
    el?.classList.remove("blk-flash");
    void el?.offsetWidth;
    el?.classList.add("blk-flash");
  };
```
- In the toolbar after `<ToolbarSpacer />`, add:
```tsx
        <RubberSegment aria-label="Layout" size="sm" items={LAYOUT_ITEMS} value={view} onChange={setView} />
```
  with this constant outside the component:
```ts
const LAYOUT_ITEMS: SegmentItem<"note" | "source">[] = [
  { value: "note", label: "Note", icon: "note" },
  { value: "source", label: "Source | Note", icon: "split" },
];
```
- Wrap the article in `<div className={cx("note-body", view === "source" && "note-body-split")}>`. When `view === "source"`, render `<SourcePane detail={data} activeBlockId={activeBlockId} onPick={focusNoteBlock} />` before it.
- Render margin callouts only when `wide && view === "note"`.
- Pass `onViewInSource={() => { setActiveBlockId(block.id); setView("source"); }}` to `BlockView`.

Append to `apps/web/styles/note.css`:
```css
.note-body-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  @variant md {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    height: calc(100dvh - var(--toolbar-h));
    & > * {
      overflow: auto;
    }
  }
  & .reader {
    max-width: none;
    padding-inline: 1rem;
    @variant md {
      padding-inline: 2rem 1rem;
    }
  }
  & .reader-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
.src-pane {
  padding: 1rem;
  background: var(--bg-2);
  @variant md {
    padding: 1.5rem 2rem 6rem;
    border-right: 1px solid var(--sep);
  }
}
.src-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  max-width: 38rem;
  margin: 0 auto 1rem;
}
.src-page {
  max-width: 38rem;
  margin: 0 auto;
  padding: 1.5rem;
  border-radius: 0.625rem;
  background: var(--elevated);
  box-shadow: var(--e2);
  font-size: 0.9375rem;
}
.src-block {
  display: block;
  width: 100%;
  margin: 0 -0.4rem;
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  text-align: left;
  &:hover {
    background: var(--fill-2);
  }
}
.src-block-hot {
  background: var(--tint-wash);
  box-shadow: inset 3px 0 0 var(--tint);
}
```

- [ ] **Step 4: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/source-note.spec.ts e2e/note.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): Source | Note side-by-side view with block sync and View in source"
```

---

### Task 21: SpringCheck and Mark verified

**Files:**
- Create: `apps/web/components/bits/spring-check.tsx`, `apps/web/components/note/verify-check.tsx`
- Modify: `apps/web/components/note/block-view.tsx`, `apps/web/styles/components.css`
- Test: `apps/web/e2e/verify.spec.ts`

**Interfaces:**
- Consumes: `transitions`, `patchNoteDetail`, `patchNoteLists`, `api` and `useToast`.
- Produces:
  - **`<SpringCheck label checked onCheckedChange disabled? doneLabel? strike?>`**, with `role="checkbox"`, transform and opacity only.
  - **`<VerifyCheck block>`**: an optimistic Mark verified. It recomputes the note's fidelity in the cache, and rolls back with a danger toast on failure. It is one-way (disabled once verified).

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/verify.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("Mark verified springs, clears the review state and updates fidelity", async ({ page }) => {
  await page.goto(NOTE);
  const check = page.getByRole("checkbox", { name: "Mark verified" });
  await expect(check).not.toBeChecked();
  await expectCleanScreen(page);
  await check.click();
  await expect(page.getByRole("checkbox", { name: "Verified" })).toBeChecked();
  await expect(page.locator(".srcstrip").getByText("Verified", { exact: true })).toBeVisible();
});

test("a failed verify rolls back and tells the user (Review Focus 5)", async ({ page }) => {
  await page.route("**/api/rpc/notes/markVerified", (route) => route.fulfill({ status: 500, json: { json: { code: "INTERNAL_SERVER_ERROR" } } }));
  await page.goto(NOTE);
  await page.getByRole("checkbox", { name: "Mark verified" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Couldn't mark the block verified." })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Mark verified" })).not.toBeChecked();
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/verify.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

Fetch provenance: `curl -fsSL https://reactbits.dev/r/SpringCheck-TS-TW.json | shasum -a 256`.

`apps/web/components/bits/spring-check.tsx`:
```tsx
"use client";
/*
 * Adapted from React Bits "SpringCheck" (TS-TW), https://reactbits.dev/r/SpringCheck-TS-TW.json
 * (sha256 <sha256>, fetched 2026-10-05). Copyright (c) David Haz. MIT + Commons Clause; see
 * ./LICENSE-react-bits. Adaptations: tokens; shared spring; m.* under LazyMotion; the tick fades and
 * scales (transform/opacity) instead of animating stroke-dashoffset; hugeicons removed; props trimmed.
 */
import { animate, m, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";
import { transitions } from "@/lib/motion-tokens.ts";

const SWELL = 0.35;
const RULE_END = 0.84;
const STRIKE_LAG = 0.12;
const DONE_OPACITY = 0.42;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function SpringCheck({ label, doneLabel, checked, onCheckedChange, disabled = false, strike = false }: { label: string; doneLabel?: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; strike?: boolean }) {
  const reduce = useReducedMotion();
  const t = useMotionValue(checked ? 1 : 0);
  const fill = useTransform(t, (v) => Math.max(v, 0));
  const box = useTransform(t, (v) => 1 + SWELL * Math.max(0, v - 1));
  const tickOpacity = useTransform(t, (v) => clamp01(v));
  const tickScale = useTransform(t, (v) => 0.6 + 0.4 * clamp01(v));
  const rule = useTransform(t, (v) => clamp01((clamp01(v) - STRIKE_LAG) / (RULE_END - STRIKE_LAG)));
  const word = useTransform(t, (v) => 1 - (1 - DONE_OPACITY) * clamp01(v));

  useEffect(() => {
    const target = checked ? 1 : 0;
    if (reduce) {
      t.jump(target);
      return undefined;
    }
    const controls = animate(t, target, transitions.spring);
    return () => controls.stop();
  }, [checked, reduce, t]);

  const text = checked && doneLabel ? doneLabel : label;
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={text} disabled={disabled} className="scheck" onClick={() => onCheckedChange(!checked)}>
      <m.span className="scheck-box" style={{ scale: box }}>
        <span className="scheck-ring" aria-hidden="true" />
        <m.span className="scheck-fill" aria-hidden="true" style={{ scale: fill }} />
        <m.svg className="scheck-tick" viewBox="0 0 24 24" aria-hidden="true" style={{ opacity: tickOpacity, scale: tickScale }}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </m.svg>
      </m.span>
      <span className="scheck-label">
        <m.span style={{ opacity: strike ? word : 1 }}>{text}</m.span>
        {strike ? <m.span className="scheck-rule" aria-hidden="true" style={{ scaleX: rule }} /> : null}
      </span>
    </button>
  );
}
```

Append to `apps/web/styles/components.css`:
```css
.scheck {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--hit);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--label);
  &:disabled {
    cursor: default;
  }
}
.scheck-box {
  position: relative;
  display: grid;
  place-items: center;
  width: 1.375rem;
  height: 1.375rem;
  overflow: hidden;
  border-radius: 0.4375rem;
}
.scheck-ring {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 2px var(--hairline);
}
.scheck-fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--ok);
}
.scheck-tick {
  position: relative;
  width: 70%;
  height: 70%;
  fill: none;
  stroke: var(--bg);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.scheck-label {
  position: relative;
}
.scheck-rule {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1.5px;
  background: currentColor;
  transform-origin: left center;
}
```

`apps/web/components/note/verify-check.tsx`:
```tsx
"use client";

import type { NoteBlock, NoteDetail } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { SpringCheck } from "@/components/bits/spring-check.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteDetail, patchNoteLists } from "@/lib/notes/cache.ts";

function withVerified(detail: NoteDetail, blockId: string): NoteDetail {
  const blocks = detail.blocks.map((b) => (b.id === blockId ? { ...b, verified: true } : b));
  const allVerified = blocks.every((b) => b.verified);
  const fidelity = detail.note.fidelity === "needs_review" && allVerified ? ((detail.note.coverage ?? 1) >= 0.98 ? "verified" : "partial") : detail.note.fidelity;
  return { ...detail, blocks, note: { ...detail.note, fidelity } };
}

export function VerifyCheck({ block }: { block: NoteBlock }) {
  const qc = useQueryClient();
  const toast = useToast();
  const verify = async () => {
    const previous = patchNoteDetail(qc, block.noteId, (d) => withVerified(d, block.id));
    try {
      await api.notes.markVerified({ blockId: block.id });
      toast({ title: "Marked verified", icon: "verified" });
    } catch {
      if (previous) qc.setQueryData(orpc.notes.get.queryKey({ input: { noteId: block.noteId } }), previous);
      toast({ title: "Couldn't mark the block verified.", description: "It still needs review.", icon: "needsReview", tone: "danger" });
    } finally {
      patchNoteLists(qc, (items) => items);
      await qc.invalidateQueries({ queryKey: orpc.notes.list.key() });
    }
  };
  return <SpringCheck label="Mark verified" doneLabel="Verified" checked={block.verified} disabled={block.verified} onCheckedChange={(next) => next && void verify()} />;
}
```

Remove the no-op `patchNoteLists(qc, (items) => items);` line when implementing; the invalidation alone refreshes the lists.

In `block-view.tsx`, replace the review actions content with:
```tsx
        <div className="blk-actions" data-qa="review-actions">
          {!block.verified ? <Badge tone="warn" icon="needsReview">Needs review</Badge> : null}
          <VerifyCheck block={block} />
        </div>
```
Render it when `block.origin === "ocr_model" || !block.verified`, so the check stays visible after verification. Import `VerifyCheck`.

- [ ] **Step 4: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/verify.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): adapted SpringCheck; optimistic Mark verified with fidelity update and rollback"
```

---

### Task 22: Tiptap 3 block editing

**Files:**
- Modify: `apps/web/components/note/block-editor.tsx` (replace), `apps/web/package.json`, `apps/web/styles/note.css`
- Test: `apps/web/e2e/edit.spec.ts`

**Interfaces:**
- Consumes: `EDITABLE_TYPES`, `api.notes.updateBlock` and `patchNoteDetail`.
- Produces:
  - **`<BlockEditor block onDone>`**, loaded lazily.
  - **Rich editing** with Tiptap StarterKit and Markdown for heading, paragraph, list, quote and commentary blocks.
  - **A raw monospace textarea** for code, math, table and transcript blocks, so they stay byte-faithful.
  - **Save** (button or ⌘↵) is optimistic. The server keeps `originalMarkdown`. **Cancel** (or Esc) discards the edit. A failure restores the block and shows a toast.

- [ ] **Step 1: Install.**

Run:
```bash
pnpm --filter @mastertutor/web add -E @tiptap/core@3.31.4 @tiptap/pm@3.31.4 @tiptap/react@3.31.4 @tiptap/starter-kit@3.31.4 @tiptap/markdown@3.31.4
```

- [ ] **Step 2: Write the failing spec.**

`apps/web/e2e/edit.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const NOTE = "/notes/00000000-0000-4000-8000-000002000001";

test("edits a paragraph in place and keeps the original", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("button", { name: /Provenance for block 3/ }).click();
  await page.getByRole("dialog", { name: "Block provenance" }).getByRole("button", { name: "Edit block" }).click();
  const editor = page.getByRole("textbox", { name: "Edit block" });
  await expect(editor).toBeVisible();
  await expectCleanScreen(page);
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("Adam rescales every step.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#main")).toContainText("Adam rescales every step.");
  await page.getByRole("button", { name: /Provenance for block 3: Edited by you/ }).click();
  await page.getByRole("button", { name: "Show original" }).click();
  await expect(page.getByRole("dialog", { name: "Block provenance" })).toContainText("second moment");
});

test("code blocks edit as raw text and Escape cancels", async ({ page }) => {
  await page.goto(NOTE);
  await page.getByRole("button", { name: /Provenance for block 8/ }).click();
  await page.getByRole("dialog", { name: "Block provenance" }).getByRole("button", { name: "Edit block" }).click();
  const raw = page.getByRole("textbox", { name: "Edit block" });
  await expect(raw).toHaveValue(/```python/);
  await raw.press("Escape");
  await expect(raw).toBeHidden();
});
```

- [ ] **Step 3: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/edit.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 4: Implement.**

`apps/web/components/note/block-editor.tsx`:
```tsx
"use client";

import type { NoteBlock, NoteDetail } from "@mastertutor/contracts";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteDetail } from "@/lib/notes/cache.ts";

const RAW_TYPES = new Set(["code", "math", "table", "transcript"]);

export function BlockEditor({ block, onDone }: { block: NoteBlock; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [raw, setRaw] = useState(block.markdown);
  const rich = !RAW_TYPES.has(block.type);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false } }), Markdown],
    content: block.markdown,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: { attributes: { "aria-label": "Edit block", role: "textbox", "aria-multiline": "true", class: "tiptap-editable" } },
  });

  const save = async () => {
    const markdown = rich ? (editor?.getMarkdown() ?? block.markdown) : raw;
    onDone();
    if (markdown === block.markdown) return;
    const previous = patchNoteDetail(qc, block.noteId, (d: NoteDetail) => ({
      ...d,
      blocks: d.blocks.map((b) => (b.id === block.id ? { ...b, markdown, edited: true, originalMarkdown: b.originalMarkdown ?? b.markdown } : b)),
    }));
    try {
      const updated = await api.notes.updateBlock({ blockId: block.id, markdown });
      patchNoteDetail(qc, block.noteId, (d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === updated.id ? updated : b)) }));
    } catch {
      if (previous) qc.setQueryData(orpc.notes.get.queryKey({ input: { noteId: block.noteId } }), previous);
      toast({ title: "Couldn't save your edit.", description: "The block is unchanged.", icon: "needsReview", tone: "danger" });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="blk-editor" onKeyDown={onKeyDown}>
      {rich ? (
        <EditorContent editor={editor} />
      ) : (
        <textarea className="blk-raw" aria-label="Edit block" value={raw} spellCheck={false} rows={Math.min(20, raw.split("\n").length + 1)} onChange={(e) => setRaw(e.target.value)} autoFocus />
      )}
      <div className="blk-editor-actions">
        <span className="t-foot">⌘↵ to save · Esc to cancel</span>
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()}>Save</Button>
      </div>
    </div>
  );
}
```

Append to `apps/web/styles/note.css`:
```css
.blk-editor {
  display: grid;
  gap: 0.6rem;
  padding: 0.5rem;
  border-radius: var(--r-md);
  background: var(--elevated);
  box-shadow:
    0 0 0 3px var(--tint-wash),
    inset 0 0 0 1px var(--tint);
}
.tiptap-editable {
  min-height: 3rem;
  outline: none;
}
.blk-raw {
  width: 100%;
  min-height: 6rem;
  padding: 0.75rem;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--bg-2);
  font: 400 0.8125rem/1.65 var(--font-code);
  outline: none;
  resize: vertical;
}
.blk-editor-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  & .t-foot {
    margin-right: auto;
  }
}
```

- [ ] **Step 5: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/edit.spec.ts`
Expected: PASS. If `StarterKit.configure({ link })` is rejected by the 3.31.4 types, drop the `link` key; StarterKit's defaults are acceptable.

- [ ] **Step 6: Commit.**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Tiptap 3 Markdown block editing with raw mode for code/math/tables; optimistic save"
```

---

### Task 23: Export (Obsidian Markdown with provenance front-matter)

**Files:**
- Create: `apps/web/lib/export/note-markdown.ts`, `apps/web/components/note/export-button.tsx`
- Modify: `apps/web/lib/fixtures/router.ts` (`notes.export`), `apps/web/components/note/note-reader.tsx`
- Test: `apps/web/lib/export/note-markdown.test.ts`, `apps/web/e2e/export.spec.ts`

**Interfaces:**
- Consumes: `NoteDetail`.
- Produces:
  - **`buildNoteMarkdown(detail: NoteDetail, folderPath?: string[]): string`.** The output is:
    - YAML front-matter (title, note_id, fidelity, coverage, folder, filed_by, created, sources with url, origin and captured_at);
    - the title as `#` and the lede as a quote;
    - one HTML provenance comment per block;
    - asset links as `assets/<assetId>`;
    - Obsidian callouts for agent notes and needs-review blocks.
  - **`exportFileName(title): string`** (a safe `.md` name).
  - **The fixture `notes.export`** returns a `data:text/markdown` URL. **Phase 7** serves the same text plus asset bytes in a zip.
  - **`<ExportButton detail>`** downloads the file. It is labelled "Export .md", or "Export" as an icon at compact widths.

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/export/note-markdown.test.ts`:
```ts
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { ids } from "../fixtures/ids.ts";
import { fixtureRouter } from "../fixtures/router.ts";
import { buildNoteMarkdown, exportFileName } from "./note-markdown.ts";

const api = createRouterClient(fixtureRouter, { context: { ns: "export-test" } });

describe("Obsidian export", () => {
  it("writes YAML front-matter with provenance and every block in order", async () => {
    const detail = await api.notes.get({ noteId: ids.note(1) });
    const md = buildNoteMarkdown(detail, ["Machine learning", "Optimization"]);
    expect(md.startsWith("---\ntitle: \"Learning-rate warmup, explained\"\n")).toBe(true);
    expect(md).toContain("fidelity: needs_review");
    expect(md).toContain('  - url: "https://fieldnotes.ml/posts/learning-rate-warmup"');
    expect(md).toContain('folder: "Machine learning/Optimization"');
    expect(md).toContain("# Learning-rate warmup, explained");
    expect(md).toContain(`![Training log screenshot](assets/${ids.asset(2)})`);
    expect(md).toContain("> [!warning] Needs review");
    expect(md).toContain("> [!note] Agent's note");
    expect(md).toMatch(/<!-- mt:block id=\S+ origin=dom sha256=[0-9a-f]{64} -->/);
    expect(md.indexOf("The update rule")).toBeLessThan(md.indexOf("Common schedules"));
  });

  it("escapes YAML and makes safe file names", () => {
    expect(exportFileName('A "quoted" / title: part 1')).toBe("A quoted title part 1.md");
    expect(exportFileName("   ")).toBe("note.md");
  });

  it("is served by the fixture notes.export as a data URL", async () => {
    const result = await api.notes.export({ noteId: ids.note(1) });
    expect(result.downloadUrl.startsWith("data:text/markdown;charset=utf-8,")).toBe(true);
  });
});
```

`apps/web/e2e/export.spec.ts`:
```ts
import { expect, test } from "./helpers/test.ts";

test("exports the note as Markdown", async ({ page }) => {
  await page.goto("/notes/00000000-0000-4000-8000-000002000001");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Learning-rate warmup, explained.md");
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/export`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/lib/export/note-markdown.ts`:
```ts
import type { NoteBlock, NoteDetail } from "@mastertutor/contracts";

/** YAML double-quoted scalar (JSON strings are valid YAML). */
const q = (value: string) => JSON.stringify(value);

export function exportFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${clean || "note"}.md`;
}

function blockBody(block: NoteBlock): string {
  if (block.type === "image" || block.type === "figure" || block.type === "keyframe") {
    const alt = block.markdown.replace(/[[\]*_`]/g, "").trim() || "image";
    const image = block.assetId ? `![${alt}](assets/${block.assetId})` : "";
    return block.type === "image" ? image : `${image}\n\n${block.markdown}`;
  }
  if (block.origin === "model") return `> [!note] Agent's note\n${block.markdown.split("\n").map((l) => `> ${l}`).join("\n")}`;
  if (!block.verified) return `> [!warning] Needs review\n> Read from an image by the model.\n\n${block.markdown}`;
  return block.markdown;
}

/** Obsidian-compatible Markdown with provenance (spec §1 v1 defaults). Assets are referenced as assets/<id>. */
export function buildNoteMarkdown(detail: NoteDetail, folderPath: readonly string[] = []): string {
  const { note, blocks, sources } = detail;
  const front = [
    "---",
    `title: ${q(note.title)}`,
    `note_id: ${note.id}`,
    `fidelity: ${note.fidelity}`,
    `coverage: ${note.coverage ?? "null"}`,
    ...(folderPath.length ? [`folder: ${q(folderPath.join("/"))}`] : []),
    `filed_by: ${note.filedBy}`,
    `created: ${note.createdAt}`,
    "sources:",
    ...sources.flatMap((s) => [`  - url: ${q(s.url)}`, `    origin: ${q(s.origin)}`, `    captured_at: ${s.capturedAt}`]),
    "---",
    "",
    `# ${note.title}`,
    "",
    ...(note.lede ? [`> ${note.lede}`, ""] : []),
  ];
  const body = [...blocks]
    .sort((a, b) => a.position.localeCompare(b.position))
    .map((block) => `<!-- mt:block id=${block.id} origin=${block.origin} sha256=${block.contentSha256 ?? "none"} -->\n${blockBody(block)}`);
  return `${[...front, body.join("\n\n")].join("\n")}\n`;
}
```

In `apps/web/lib/fixtures/router.ts`, add `import { buildNoteMarkdown } from "../export/note-markdown.ts";` and replace the export handler:
```ts
    export: os.notes.export.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const record = findNote(state, input.noteId);
      const markdown = buildNoteMarkdown({ note: record.note, blocks: record.blocks, sources: record.sources });
      return {
        downloadUrl: `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    }),
```

`apps/web/components/note/export-button.tsx`:
```tsx
"use client";

import type { NoteDetail } from "@mastertutor/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api } from "@/lib/api/client.ts";
import { exportFileName } from "@/lib/export/note-markdown.ts";

export function ExportButton({ detail }: { detail: NoteDetail }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const { downloadUrl } = await api.notes.export({ noteId: detail.note.id });
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = exportFileName(detail.note.title);
      a.click();
    } catch {
      toast({ title: "Couldn't export the note.", icon: "needsReview", tone: "danger" });
    } finally {
      setPending(false);
    }
  };
  return (
    <Button icon="export" onClick={() => void run()} disabled={pending} aria-label="Export as Markdown">
      <span className="hidden md:inline">Export .md</span>
    </Button>
  );
}
```

In `note-reader.tsx`, render `<ExportButton detail={data} />` after the layout segment in the toolbar.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/export apps/web/lib/fixtures && pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/export.spec.ts e2e/note.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): Obsidian Markdown export with YAML provenance front-matter and per-block comments"
```

---

## F4: Vault UI and Settings/Usage/Audit

### Task 24: Vault page (cutaway, sign-ins, sessions, "Secrets are never shown")

**Files:**
- Create: `apps/web/lib/vault/fields.ts`, `apps/web/components/vault/{vault-view,cutaway,vault-row}.tsx`, `apps/web/app/(app)/vault/page.tsx`, `apps/web/styles/vault.css`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/lib/vault/fields.test.ts`, `apps/web/e2e/vault.spec.ts`

**Interfaces:**
- Consumes: `orpc.vault.list`, `api.vault.forgetSession`, `hostOf` and `useToast`.
- Produces:
  - **`lib/vault/fields.ts`:**
    - `FIELD_META: Record<VaultSecretField, {label; icon; secret: boolean}>`;
    - `normalizeTotpSeed(raw): string | null`;
    - `isValidPin(raw): boolean`;
    - `suggestAlias(originInput): string`;
    - `type VaultForm`, `emptyVaultForm()`;
    - `toCreateInput(form): {ok:true; input: CreateVaultItemInput} | {ok:false; errors: Partial<Record<VaultFormField, string>>}`.
  - **`/vault`** with:
    - toolbar "Add sign-in" (wired in Task 25);
    - `PageHead`;
    - the `<Cutaway>` diagram;
    - `<VaultRow>` list items with field chips marked "sealed" and session status;
    - a "Sign out" action that is optimistic;
    - the "Secrets are never shown." panel;
    - an empty state.
  - **`VaultRow` props:** `{item; onReplace(item); onDelete(item)}` (wired in Task 25).

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/vault/fields.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { emptyVaultForm, isValidPin, normalizeTotpSeed, suggestAlias, toCreateInput } from "./fields.ts";

describe("vault field helpers", () => {
  it("normalises TOTP seeds from base32 or otpauth URIs", () => {
    expect(normalizeTotpSeed("jbsw y3dp ehpk 3pxp")).toBe("JBSWY3DPEHPK3PXP");
    expect(normalizeTotpSeed("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&issuer=x")).toBe("JBSWY3DPEHPK3PXP");
    expect(normalizeTotpSeed("not base32!")).toBeNull();
    expect(normalizeTotpSeed("ABC")).toBeNull();
  });
  it("accepts 4–12 digit PINs only", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("123")).toBe(false);
  });
  it("suggests an alias from the website", () => {
    expect(suggestAlias("https://learn.zybooks.com/signin")).toBe("zybooks");
    expect(suggestAlias("github.com")).toBe("github");
    expect(suggestAlias("")).toBe("");
  });
  it("builds the create input from enabled fields only", () => {
    const form = { ...emptyVaultForm(), label: "zyBooks", alias: "zybooks", origin: "learn.zybooks.com" };
    form.enabled.username = true;
    form.enabled.password = true;
    form.values.username = "me@example.test";
    form.values.password = "pw-canary";
    form.values.pin = "9999";
    const result = toCreateInput(form);
    expect(result.ok && result.input.secrets).toEqual({ username: "me@example.test", password: "pw-canary" });
    expect(result.ok && result.input.origin).toBe("https://learn.zybooks.com");
  });
  it("reports field errors without echoing values", () => {
    const form = { ...emptyVaultForm(), label: "", alias: "Bad Alias", origin: "javascript:alert(1)" };
    form.enabled.pin = true;
    form.values.pin = "12x";
    const result = toCreateInput(form);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["alias", "label", "origin", "pin"]);
      expect(JSON.stringify(result.errors)).not.toContain("12x");
    }
  });
});
```

`apps/web/e2e/vault.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("vault explains the model, lists sign-ins with sealed fields, and is clean everywhere", async ({ page }) => {
  await page.goto("/vault");
  await expect(page.getByRole("heading", { level: 1, name: /Vault/ })).toBeVisible();
  await expect(page.getByText("Sees an alias.")).toBeVisible();
  const rows = page.getByRole("list", { name: "Sign-ins" }).getByRole("listitem");
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: "github" })).toContainText("Password");
  await expect(rows.filter({ hasText: "github" })).toContainText("sealed");
  await expect(page.getByRole("heading", { name: "Secrets are never shown." })).toBeVisible();
  await expectCleanScreen(page);
});

test("signing out of a saved session is optimistic", async ({ page }) => {
  await page.goto("/vault");
  const row = page.getByRole("listitem").filter({ hasText: "github" });
  await expect(row).toContainText("Session saved");
  await row.getByRole("button", { name: "Sign out of github" }).click();
  await expect(row).toContainText("Signs in on next use");
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/vault && pnpm test:ui -- e2e/vault.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/lib/vault/fields.ts`:
```ts
import { Alias, CreateVaultItemInput, ImapConfig, OriginInput, type VaultSecretField } from "@mastertutor/contracts";
import type { IconName } from "@/components/ui/icons.ts";

export const FIELD_META: Record<VaultSecretField, { label: string; icon: IconName; secret: boolean }> = {
  username: { label: "Username", icon: "username", secret: false },
  password: { label: "Password", icon: "password", secret: true },
  totp: { label: "Authenticator code", icon: "totp", secret: true },
  pin: { label: "PIN", icon: "pin", secret: true },
  imap_password: { label: "Email codes", icon: "emailOtp", secret: true },
  passkey: { label: "Passkey", icon: "passkey", secret: true },
};

export function normalizeTotpSeed(raw: string): string | null {
  let value = raw.trim();
  if (value.toLowerCase().startsWith("otpauth://")) {
    try {
      value = new URL(value).searchParams.get("secret") ?? "";
    } catch {
      return null;
    }
  }
  value = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  return /^[A-Z2-7]{16,}$/.test(value) ? value : null;
}

export const isValidPin = (raw: string) => /^[0-9]{4,12}$/.test(raw);

export function suggestAlias(originInput: string): string {
  const parsed = OriginInput.safeParse(originInput);
  if (!parsed.success) return "";
  const labels = new URL(parsed.data).hostname.split(".").filter((l) => l !== "www");
  const base = labels.length >= 2 ? (labels[labels.length - 2] ?? "") : (labels[0] ?? "");
  return base.toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[-_]+/, "").slice(0, 63);
}

export type FieldToggle = "username" | "password" | "totp" | "pin" | "imap";
export type VaultFormField = "label" | "alias" | "origin" | "username" | "password" | "totp" | "pin" | "imap";

export interface VaultForm {
  label: string;
  alias: string;
  origin: string;
  enabled: Record<FieldToggle, boolean>;
  values: { username: string; password: string; totp: string; pin: string; imapPassword: string };
  imap: { host: string; port: string; user: string; senderFilter: string };
}

export const emptyVaultForm = (): VaultForm => ({
  label: "",
  alias: "",
  origin: "",
  enabled: { username: true, password: true, totp: false, pin: false, imap: false },
  values: { username: "", password: "", totp: "", pin: "", imapPassword: "" },
  imap: { host: "", port: "993", user: "", senderFilter: "" },
});

/** Validates the form; values of disabled fields never leave this function. Errors never contain values. */
export function toCreateInput(form: VaultForm): { ok: true; input: CreateVaultItemInput } | { ok: false; errors: Partial<Record<VaultFormField, string>> } {
  const errors: Partial<Record<VaultFormField, string>> = {};
  if (!form.label.trim()) errors.label = "Add a name you'll recognise.";
  if (!Alias.safeParse(form.alias).success) errors.alias = "Use lowercase letters, numbers, “-” or “_”.";
  const origin = OriginInput.safeParse(form.origin);
  if (!origin.success) errors.origin = "Enter a website such as example.com.";
  const secrets: Record<string, string> = {};
  if (form.enabled.username) {
    if (form.values.username) secrets.username = form.values.username;
    else errors.username = "Enter the username or email.";
  }
  if (form.enabled.password) {
    if (form.values.password) secrets.password = form.values.password;
    else errors.password = "Enter the password.";
  }
  if (form.enabled.totp) {
    const seed = normalizeTotpSeed(form.values.totp);
    if (seed) secrets.totp = seed;
    else errors.totp = "Paste the setup key or otpauth:// link (16+ characters).";
  }
  if (form.enabled.pin) {
    if (isValidPin(form.values.pin)) secrets.pin = form.values.pin;
    else errors.pin = "Use 4–12 digits.";
  }
  let imap = null;
  if (form.enabled.imap) {
    const parsed = ImapConfig.safeParse({ host: form.imap.host.trim(), port: Number(form.imap.port), user: form.imap.user.trim(), senderFilter: form.imap.senderFilter.trim() });
    if (parsed.success && form.values.imapPassword) {
      imap = parsed.data;
      secrets.imap_password = form.values.imapPassword;
    } else {
      errors.imap = "Fill in the mail server, port, user, sender and password.";
    }
  }
  if (Object.keys(errors).length || !origin.success) return { ok: false, errors };
  const parsed = CreateVaultItemInput.safeParse({ alias: form.alias, origin: origin.data, label: form.label.trim(), secrets, imap });
  if (!parsed.success) return { ok: false, errors: { label: "Check the highlighted fields." } };
  return { ok: true, input: parsed.data };
}
```

`apps/web/components/vault/cutaway.tsx`:
```tsx
import { Icon } from "@/components/ui/icon.tsx";

/** The vault "cutaway" (mockup D). Captions sit in flow under each object, so they can't collide. */
export function Cutaway() {
  const objects = [
    { icon: "agentNote" as const, title: "The agent", lead: "Sees an alias.", text: "The model asks for a sign-in by name. It never receives a value." },
    { icon: "vault" as const, title: "The vault", lead: "Sealed at rest.", text: "Sealed the moment you save. Only the browser executor opens it, for one fill." },
    { icon: "web" as const, title: "The website", lead: "Filled in place.", text: "Typed into the page on the pinned website only. Screenshots are masked." },
  ];
  return (
    <figure className="cutaway" aria-label="How the vault keeps secrets from the agent">
      {objects.map((o, i) => (
        <div key={o.title} className="cutaway-obj">
          <span className="cutaway-art">
            <Icon name={o.icon} size="xl" />
          </span>
          <b>{o.title}</b>
          <p className="cap">
            <b>{o.lead}</b> {o.text}
          </p>
          {i < objects.length - 1 ? <span className="cutaway-link" aria-hidden="true" /> : null}
        </div>
      ))}
    </figure>
  );
}
```

`apps/web/components/vault/vault-row.tsx`:
```tsx
"use client";

import type { VaultItemView } from "@mastertutor/contracts";
import { Button, IconButton } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { hostOf } from "@/lib/notes/format.ts";
import { FIELD_META } from "@/lib/vault/fields.ts";

export function VaultRow({ item, onSignOut, onReplace, onDelete }: { item: VaultItemView; onSignOut: (item: VaultItemView) => void; onReplace: (item: VaultItemView) => void; onDelete: (item: VaultItemView) => void }) {
  return (
    <li className="vrow">
      <span className="vrow-art">
        <Icon name="web" />
      </span>
      <div className="vrow-id">
        <span className="mono vrow-alias">{item.alias}</span>
        <span className="t-foot vrow-host">{item.label} · {hostOf(item.origin)}</span>
      </div>
      <ul className="ftypes" aria-label={`Fields for ${item.alias}`}>
        {item.fields.map((f) => (
          <li key={f} className="ft">
            <Icon name={FIELD_META[f].icon} size="sm" />
            {FIELD_META[f].label}
            {FIELD_META[f].secret ? <span className="ft-seal">sealed</span> : null}
          </li>
        ))}
        <li className="ft ft-tint">
          <Icon name="codeOtp" size="sm" />
          Codes you type in a run
        </li>
      </ul>
      <div className="vrow-session">
        <span className={item.sessionSaved ? "dot dot-ok" : "dot"} aria-hidden="true" />
        <span>{item.sessionSaved ? "Session saved" : "Signs in on next use"}</span>
      </div>
      <div className="vrow-actions">
        {item.sessionSaved ? (
          <Button variant="plain" aria-label={`Sign out of ${item.alias}`} onClick={() => onSignOut(item)}>
            Sign out
          </Button>
        ) : null}
        <Menu.Root>
          <Menu.Trigger render={<IconButton icon="more" label={`Actions for ${item.alias}`} />} />
          <MenuPanel>
            <MenuItem icon="password" onSelect={() => onReplace(item)}>Replace or add a value…</MenuItem>
            <MenuItem icon="delete" destructive onSelect={() => onDelete(item)}>Delete sign-in…</MenuItem>
          </MenuPanel>
        </Menu.Root>
      </div>
    </li>
  );
}
```

`apps/web/components/vault/vault-view.tsx`:
```tsx
"use client";

import type { VaultItemView } from "@mastertutor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { Cutaway } from "./cutaway.tsx";
import { VaultRow } from "./vault-row.tsx";

export function VaultView() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending } = useQuery(orpc.vault.list.queryOptions({ input: {} }));
  const key = orpc.vault.list.queryKey({ input: {} });

  const signOut = async (item: VaultItemView) => {
    const previous = qc.getQueryData<{ items: VaultItemView[] }>(key);
    qc.setQueryData<{ items: VaultItemView[] }>(key, (old) => old && { items: old.items.map((i) => (i.id === item.id ? { ...i, sessionSaved: false } : i)) });
    try {
      await api.vault.forgetSession({ alias: item.alias, origin: item.origin });
      toast({ title: `Signed out of ${item.alias}`, icon: "signOut" });
    } catch {
      qc.setQueryData(key, previous);
      toast({ title: "Couldn't sign out.", icon: "needsReview", tone: "danger" });
    }
  };

  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Vault" }]} />
        <ToolbarSpacer />
        <Button variant="primary" icon="add">Add sign-in</Button>
      </Toolbar>
      <div className="wrap">
        <PageHead title="Vault" lede="Sign-ins the agent can use by alias. Each one is bound to a single website." />
        <Cutaway />
        <div className="group-h">
          <h2 className="t-title3">Sign-ins <span className="muted">· {data?.items.length ?? 0}</span></h2>
          <span className="t-foot">Values are write-only. Replace or remove, never reveal.</span>
        </div>
        {isPending ? (
          <div className="group" aria-busy="true" aria-label="Loading sign-ins">
            <Skeleton className="m-4 h-12" />
            <Skeleton className="m-4 h-12" />
          </div>
        ) : data?.items.length ? (
          <ul className="group vlist" aria-label="Sign-ins">
            {data.items.map((item) => (
              <VaultRow key={item.id} item={item} onSignOut={(i) => void signOut(i)} onReplace={() => undefined} onDelete={() => undefined} />
            ))}
          </ul>
        ) : (
          <EmptyState icon="vault" title="No sign-ins yet" body="Add a sign-in so the agent can log in to a site without ever seeing the password." />
        )}
        <section className="never" aria-labelledby="never-title">
          <Icon name="hidden" size="lg" />
          <div>
            <h2 id="never-title" className="t-title3">Secrets are never shown.</h2>
            <p>
              <b>Not to the agent, and not to you after saving.</b> Passwords, authenticator keys and PINs are sealed the moment you save them. Codes you type during a run go straight to the browser; the model only learns that a code was entered. Screenshots are masked while a field is filled.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
```

`apps/web/app/(app)/vault/page.tsx`:
```tsx
import type { Metadata } from "next";
import { VaultView } from "@/components/vault/vault-view.tsx";

export const metadata: Metadata = { title: "Vault" };

export default function VaultPage() {
  return <VaultView />;
}
```

`apps/web/styles/vault.css` (import it in `globals.css` after `note.css`):
```css
.cutaway {
  display: grid;
  gap: 1.5rem;
  margin: 0 0 2.5rem;
  padding: 1.5rem;
  border-radius: var(--r-xl);
  background: var(--bg-2);
  @variant md {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 2.5rem 1.5rem;
  }
}
.cutaway-obj {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 0.6rem;
  text-align: center;
  & .cap {
    max-width: 16rem;
  }
}
.cutaway-art {
  display: grid;
  place-items: center;
  width: 5.5rem;
  height: 5.5rem;
  border-radius: 1.6rem;
  background: var(--elevated);
  box-shadow: var(--e2);
  color: var(--label);
}
.cutaway-link {
  display: none;
  @variant md {
    display: block;
    position: absolute;
    top: 2.75rem;
    left: calc(50% + 3.5rem);
    width: calc(100% - 7rem + 1.5rem);
    border-top: 1.5px dotted var(--label-3);
  }
}
.group-h {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  margin: 2rem 0.25rem 0.6rem;
}
.vlist {
  margin: 0;
  padding: 0;
  list-style: none;
}
.vrow {
  position: relative;
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr);
  gap: 0.75rem 1rem;
  align-items: center;
  padding: 0.9rem 1.1rem;
  & > :nth-child(n + 3) {
    grid-column: 2;
  }
  @variant lg {
    grid-template-columns: 2.5rem minmax(0, 1.3fr) minmax(0, 1.6fr) minmax(0, 1fr) auto;
    & > :nth-child(n + 3) {
      grid-column: auto;
    }
  }
  & + .vrow::before {
    content: "";
    position: absolute;
    top: 0;
    left: 4.6rem;
    right: 0;
    height: 1px;
    background: var(--sep);
  }
}
.vrow-art {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: var(--bg-2);
  color: var(--label-2);
}
.vrow-id {
  display: grid;
  min-width: 0;
}
.vrow-alias {
  font-weight: 600;
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
.vrow-host {
  overflow-wrap: anywhere;
}
.ftypes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ft {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 1.5rem;
  padding: 0 0.5rem;
  border-radius: var(--r-xs);
  background: var(--fill-2);
  color: var(--label);
  font-size: 0.6875rem;
  font-weight: 500;
}
.ft-seal {
  font-family: var(--font-code);
  letter-spacing: 0.05em;
}
.ft-tint {
  background: var(--tint-wash);
  color: var(--tint-text);
}
.vrow-session {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
}
.dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--label-3);
}
.dot-ok {
  background: var(--ok);
}
.vrow-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  @variant lg {
    justify-content: flex-end;
  }
}
.never {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  margin: 2rem 0 5rem;
  padding: 1.1rem 1.25rem;
  border-radius: var(--r-lg);
  background: var(--tint-wash);
  color: var(--tint-text);
  & p {
    margin-top: 0.2rem;
    color: var(--label);
    font-size: 0.8125rem;
    line-height: 1.5;
  }
  & h2 {
    color: var(--label);
  }
}
```

`.ft-seal` uses the inherited label colour, so it stays above AA. Drop the mockup's label-3 for that text.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/vault && pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/vault.spec.ts e2e/move.spec.ts`
Expected: PASS. The 63-character alias wraps rather than overflowing (Review Focus 3).

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): Vault page with cutaway, sealed field chips, session sign-out, never-shown panel"
```

---

### Task 25: Vault forms (add, replace, remove, delete) with secret hygiene

**Files:**
- Create: `apps/web/components/vault/{add-sign-in-sheet,secret-sheet}.tsx`
- Modify: `apps/web/components/vault/vault-view.tsx`, `apps/web/styles/vault.css`
- Test: `apps/web/e2e/vault-forms.spec.ts`

**Interfaces:**
- Consumes: `toCreateInput`, `emptyVaultForm`, `suggestAlias`, `normalizeTotpSeed`, `isValidPin`, `FIELD_META`, `TYPED_SECRET_FIELDS`, and `api.vault.{create,setSecret,removeSecret,delete}` (the B3 sealing endpoints in Phase 7).
- Produces:
  - **`<AddSignInSheet open onOpenChange>`.**
  - **`<SecretSheet item onClose>`**: pick a field, replace or add its value, or remove it after a confirm.
  - **A delete confirm** in `VaultView`.
- **Rules:**
  - Secret-bearing calls use `api.*` directly, never `useMutation`, so variables never enter the query cache.
  - Forms live in component state that is discarded on close.
  - Inputs use `type="password"`, `autoComplete="new-password"` or `"off"`, `spellCheck={false}`, `data-1p-ignore` and `data-lpignore`.
  - Errors use fixed copy.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/vault-forms.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

const CANARY = "canary-pw-7f3a9c51";

test("adds a sign-in without the secret persisting anywhere client-side (Review Focus 2)", async ({ page, request }) => {
  const consoleText: string[] = [];
  page.on("console", (m) => consoleText.push(m.text()));
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  await sheet.getByLabel("Website").fill("learn.zybooks.com");
  await sheet.getByLabel("Website").blur();
  await expect(sheet.getByLabel("Alias")).toHaveValue("zybooks");
  await sheet.getByLabel("Name").fill("zyBooks");
  await sheet.getByLabel("Username or email").fill("someone@example.test");
  const pw = sheet.getByLabel("Password", { exact: true });
  await expect(pw).toHaveAttribute("type", "password");
  await expect(pw).toHaveAttribute("autocomplete", "new-password");
  await pw.fill(CANARY);
  await expectCleanScreen(page);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Saved. Values are sealed." })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "zybooks" })).toContainText("sealed");

  expect(await page.content()).not.toContain(CANARY);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(storage).not.toContain(CANARY);
  expect(consoleText.join("\n")).not.toContain(CANARY);
  const list = await request.post("/api/rpc/vault/list", { data: { json: {} } });
  expect(await list.text()).not.toContain(CANARY);

  await page.getByRole("button", { name: "Add sign-in" }).click();
  await expect(page.getByRole("dialog", { name: "Add sign-in" }).getByLabel("Password", { exact: true })).toHaveValue("");
});

test("validates on submit with field errors that never echo values", async ({ page }) => {
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  await sheet.getByLabel("Website").fill("javascript:alert(1)");
  await sheet.getByRole("checkbox", { name: "PIN" }).check();
  await sheet.getByLabel("PIN", { exact: true }).fill("12x");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("Enter a website such as example.com.")).toBeVisible();
  await expect(sheet.getByText("Use 4–12 digits.")).toBeVisible();
  await expect(sheet).not.toContainText("12x");
});

test("replaces a value and removes a field, with confirmation", async ({ page }) => {
  await page.goto("/vault");
  const row = page.getByRole("listitem").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Actions for github" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  const sheet = page.getByRole("dialog", { name: "Replace or add a value" });
  await sheet.getByLabel("Field").selectOption("pin");
  await sheet.getByLabel("New value").fill("4821");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("PIN");

  await row.getByRole("button", { name: "Actions for github" }).click();
  await page.getByRole("menuitem", { name: "Replace or add a value…" }).click();
  await sheet.getByLabel("Field").selectOption("totp");
  await sheet.getByRole("button", { name: "Remove value…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove Value" }).click();
  await expect(row).not.toContainText("Authenticator code");
});

test("deletes a sign-in only after an explicit, non-default confirm", async ({ page }) => {
  await page.goto("/vault");
  const row = page.getByRole("listitem").filter({ hasText: "jstor" });
  await row.getByRole("button", { name: "Actions for jstor" }).click();
  await page.getByRole("menuitem", { name: "Delete sign-in…" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "Cancel" })).toBeFocused();
  await alert.getByRole("button", { name: "Delete Sign-in" }).click();
  await expect(row).toBeHidden();
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/vault-forms.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/components/vault/add-sign-in-sheet.tsx`:
```tsx
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { errorCopy } from "@/lib/api/errors.ts";
import { emptyVaultForm, suggestAlias, toCreateInput, type FieldToggle, type VaultForm, type VaultFormField } from "@/lib/vault/fields.ts";

/** Attributes every secret input carries: no autofill from the user's own manager, no spellcheck. */
export const SECRET_INPUT: InputHTMLAttributes<HTMLInputElement> & Record<"data-1p-ignore" | "data-lpignore", string> = {
  type: "password",
  autoComplete: "new-password",
  spellCheck: false,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
};

const TOGGLES: Array<{ key: FieldToggle; label: string }> = [
  { key: "username", label: "Username" },
  { key: "password", label: "Password" },
  { key: "totp", label: "Authenticator (TOTP)" },
  { key: "pin", label: "PIN" },
  { key: "imap", label: "Email codes (IMAP)" },
];

export function AddSignInSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Remounting on open discards every value typed previously.
  return open ? <AddSignInForm onClose={() => onOpenChange(false)} /> : null;
}

function AddSignInForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<VaultForm>(emptyVaultForm);
  const [errors, setErrors] = useState<Partial<Record<VaultFormField, string>>>({});
  const [pending, setPending] = useState(false);
  const [aliasTouched, setAliasTouched] = useState(false);
  const patch = (fn: (f: VaultForm) => VaultForm) => setForm((f) => fn(f));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = toCreateInput(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setPending(true);
    try {
      await api.vault.create(result.input);
      setForm(emptyVaultForm());
      await qc.invalidateQueries({ queryKey: orpc.vault.key() });
      toast({ title: "Saved. Values are sealed.", icon: "sealed" });
      onClose();
    } catch (err) {
      setErrors({ alias: errorCopy(err) === "That name is already taken." ? "That alias is already used." : errorCopy(err, "Couldn't save. Try again.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add sign-in"
      description="The agent will use this by alias. You won't be able to view these values again."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-sign-in" disabled={pending}>Save</Button>
        </>
      }
    >
      <form id="add-sign-in" className="vform" onSubmit={submit} autoComplete="off">
        <TextField
          label="Website"
          inputMode="url"
          autoComplete="off"
          value={form.origin}
          error={errors.origin}
          onChange={(e) => patch((f) => ({ ...f, origin: e.target.value }))}
          onBlur={() => !aliasTouched && patch((f) => ({ ...f, alias: suggestAlias(f.origin) || f.alias }))}
          hint="The agent may use this sign-in only on this website."
        />
        <TextField label="Name" autoComplete="off" value={form.label} error={errors.label} onChange={(e) => patch((f) => ({ ...f, label: e.target.value }))} />
        <TextField
          label="Alias"
          autoComplete="off"
          spellCheck={false}
          value={form.alias}
          error={errors.alias}
          onChange={(e) => {
            setAliasTouched(true);
            patch((f) => ({ ...f, alias: e.target.value }));
          }}
          hint="What the agent asks for. Lowercase letters, numbers, “-” or “_”."
        />
        <fieldset className="vform-fields">
          <legend className="tf-label">Sign-in uses</legend>
          {TOGGLES.map((t) => (
            <label key={t.key} className="vform-toggle">
              <input type="checkbox" checked={form.enabled[t.key]} onChange={(e) => patch((f) => ({ ...f, enabled: { ...f.enabled, [t.key]: e.target.checked } }))} />
              {t.label}
            </label>
          ))}
        </fieldset>
        {form.enabled.username ? <TextField label="Username or email" autoComplete="off" spellCheck={false} value={form.values.username} error={errors.username} onChange={(e) => patch((f) => ({ ...f, values: { ...f.values, username: e.target.value } }))} /> : null}
        {form.enabled.password ? <TextField label="Password" {...SECRET_INPUT} value={form.values.password} error={errors.password} onChange={(e) => patch((f) => ({ ...f, values: { ...f.values, password: e.target.value } }))} /> : null}
        {form.enabled.totp ? <TextField label="Authenticator setup key" {...SECRET_INPUT} value={form.values.totp} error={errors.totp} hint="Paste the key or otpauth:// link shown when you set up two-factor." onChange={(e) => patch((f) => ({ ...f, values: { ...f.values, totp: e.target.value } }))} /> : null}
        {form.enabled.pin ? <TextField label="PIN" {...SECRET_INPUT} inputMode="numeric" value={form.values.pin} error={errors.pin} hint="Filled across split boxes in order." onChange={(e) => patch((f) => ({ ...f, values: { ...f.values, pin: e.target.value } }))} /> : null}
        {form.enabled.imap ? (
          <fieldset className="vform-imap">
            <legend className="tf-label">Email codes</legend>
            <TextField label="Mail server" autoComplete="off" value={form.imap.host} onChange={(e) => patch((f) => ({ ...f, imap: { ...f.imap, host: e.target.value } }))} />
            <TextField label="Port" inputMode="numeric" autoComplete="off" value={form.imap.port} onChange={(e) => patch((f) => ({ ...f, imap: { ...f.imap, port: e.target.value } }))} />
            <TextField label="Mail user" autoComplete="off" value={form.imap.user} onChange={(e) => patch((f) => ({ ...f, imap: { ...f.imap, user: e.target.value } }))} />
            <TextField label="Codes come from" autoComplete="off" value={form.imap.senderFilter} hint="Sender address, e.g. no-reply@example.com" onChange={(e) => patch((f) => ({ ...f, imap: { ...f.imap, senderFilter: e.target.value } }))} />
            <TextField label="Mail password" {...SECRET_INPUT} value={form.values.imapPassword} error={errors.imap} onChange={(e) => patch((f) => ({ ...f, values: { ...f.values, imapPassword: e.target.value } }))} />
          </fieldset>
        ) : null}
        <p className="t-foot vform-note">
          <Icon name="passkey" size="sm" /> Passkeys are added during a run: take over the browser and register one on the site.
        </p>
      </form>
    </Sheet>
  );
}
```

`apps/web/components/vault/secret-sheet.tsx`:
```tsx
"use client";

import { TYPED_SECRET_FIELDS, type TypedSecretField, type VaultItemView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { FIELD_META, isValidPin, normalizeTotpSeed } from "@/lib/vault/fields.ts";
import { SECRET_INPUT } from "./add-sign-in-sheet.tsx";

export function SecretSheet({ item, onClose }: { item: VaultItemView | null; onClose: () => void }) {
  return item ? <SecretForm key={item.id} item={item} onClose={onClose} /> : null;
}

function SecretForm({ item, onClose }: { item: VaultItemView; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [field, setField] = useState<TypedSecretField>(TYPED_SECRET_FIELDS.find((f) => item.fields.includes(f)) ?? "password");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const exists = item.fields.includes(field);

  const refresh = () => qc.invalidateQueries({ queryKey: orpc.vault.key() });

  async function save(event: FormEvent) {
    event.preventDefault();
    const normalized = field === "totp" ? normalizeTotpSeed(value) : field === "pin" ? (isValidPin(value) ? value : null) : value || null;
    if (!normalized) {
      setError(field === "pin" ? "Use 4–12 digits." : field === "totp" ? "Paste the setup key or otpauth:// link." : "Enter a value.");
      return;
    }
    try {
      await api.vault.setSecret({ itemId: item.id, field, value: normalized });
      setValue("");
      await refresh();
      toast({ title: `${FIELD_META[field].label} ${exists ? "replaced" : "added"}. It's sealed.`, icon: "sealed" });
      onClose();
    } catch {
      setError("Couldn't save. Try again.");
    }
  }

  async function remove() {
    try {
      await api.vault.removeSecret({ itemId: item.id, field });
      await refresh();
      toast({ title: `${FIELD_META[field].label} removed`, icon: "delete" });
      onClose();
    } catch {
      toast({ title: "Couldn't remove the value.", icon: "needsReview", tone: "danger" });
    }
  }

  return (
    <>
      <Sheet
        open
        onOpenChange={(o) => !o && onClose()}
        title="Replace or add a value"
        description={`For ${item.alias}. The current value is never shown.`}
        footer={
          <>
            {exists ? <Button variant="plain" className="mr-auto" onClick={() => setConfirm(true)}>Remove value…</Button> : null}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="secret-form">Save</Button>
          </>
        }
      >
        <form id="secret-form" className="vform" onSubmit={save} autoComplete="off">
          <div className="tf">
            <label htmlFor="secret-field" className="tf-label">Field</label>
            <select id="secret-field" className="tf-input" value={field} onChange={(e) => { setField(e.target.value as TypedSecretField); setError(null); }}>
              {TYPED_SECRET_FIELDS.map((f) => (
                <option key={f} value={f}>{FIELD_META[f].label}{item.fields.includes(f) ? " (replace)" : " (add)"}</option>
              ))}
            </select>
          </div>
          <TextField label="New value" {...SECRET_INPUT} inputMode={field === "pin" ? "numeric" : undefined} value={value} error={error} onChange={(e) => setValue(e.target.value)} />
        </form>
      </Sheet>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Remove the ${FIELD_META[field].label.toLowerCase()}?`} description="The agent won't be able to use it until you add it again." confirmLabel="Remove Value" destructive onConfirm={() => void remove()} />
    </>
  );
}
```

The username field is not a secret, but it still uses `SECRET_INPUT`. Replacing it is uncommon, and masking it is harmless.

In `vault-view.tsx`:
- add the state `const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<VaultItemView | null>(null); const [deleting, setDeleting] = useState<VaultItemView | null>(null);`;
- set `onClick={() => setAdding(true)}` on "Add sign-in";
- pass `onReplace={setEditing}` and `onDelete={setDeleting}` to `VaultRow`;
- render:
```tsx
        <AddSignInSheet open={adding} onOpenChange={setAdding} />
        <SecretSheet item={editing} onClose={() => setEditing(null)} />
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete “${deleting?.label ?? ""}”?`}
          description="The agent loses this sign-in and its saved session. The audit history stays."
          confirmLabel="Delete Sign-in"
          destructive
          onConfirm={() => deleting && void deleteItem(deleting)}
        />
```
  with:
```tsx
  const deleteItem = async (item: VaultItemView) => {
    const previous = qc.getQueryData<{ items: VaultItemView[] }>(key);
    qc.setQueryData<{ items: VaultItemView[] }>(key, (old) => old && { items: old.items.filter((i) => i.id !== item.id) });
    try {
      await api.vault.delete({ itemId: item.id });
      toast({ title: `Deleted ${item.alias}`, icon: "delete" });
    } catch {
      qc.setQueryData(key, previous);
      toast({ title: "Couldn't delete the sign-in.", icon: "needsReview", tone: "danger" });
    }
  };
```

Append to `apps/web/styles/vault.css`:
```css
.vform {
  display: grid;
  gap: 0.9rem;
}
.vform-fields,
.vform-imap {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  border: 0;
}
.vform-imap {
  gap: 0.9rem;
}
.vform-toggle {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--hit);
  & input {
    width: 1.125rem;
    height: 1.125rem;
    accent-color: var(--tint);
  }
}
.vform-note {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
```

- [ ] **Step 4: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/vault-forms.spec.ts e2e/vault.spec.ts`
Expected: PASS in 5 projects.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): vault add/replace/remove/delete with write-only secret inputs and canary-tested hygiene"
```

---

### Task 26: Settings (kill switch, defaults, concurrency, account)

**Files:**
- Create: `apps/web/components/settings/{settings-view,kill-switch-row,defaults-form}.tsx`, `apps/web/app/(app)/settings/page.tsx`, `apps/web/styles/settings.css`
- Modify: `apps/web/app/globals.css`, `apps/web/e2e/search.spec.ts` (⌘K from `/settings`)
- Test: `apps/web/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `orpc.settings.get`, `api.settings.{setKillSwitch,update}`, `Budget`, `OriginInput`, `MODELS`, `Switch`, `ConfirmDialog`, `Chip` and `authClient`.
- Produces:
  - **`/settings`** with these groups:
    - **Safety:** the kill switch. Turning it on needs a confirm; turning it off does not. It is optimistic.
    - **Defaults for new tasks:** budget steps, USD and minutes, plus the allowed websites editor. Save and Revert appear only when the form is dirty.
    - **Agent:** model (read-only) and concurrency (read-only, "equal to browser slots").
    - **Activity:** links to Usage and Audit log.
    - **Account:** Sign out (needed on compact widths).

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/settings.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("settings groups are clean at every width", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: /Settings/ })).toBeVisible();
  for (const name of ["Safety", "Defaults for new tasks", "Agent", "Activity", "Account"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByText("6 browsers at once")).toBeVisible();
  await expectCleanScreen(page);
});

test("kill switch asks before stopping everything and shows the banner", async ({ page }) => {
  await page.goto("/settings");
  const kill = page.getByRole("switch", { name: "Kill switch" });
  await kill.click();
  const alert = page.getByRole("alertdialog", { name: "Stop all runs?" });
  await expect(alert.getByRole("button", { name: "Keep Running" })).toBeFocused();
  await expectCleanScreen(page);
  await alert.getByRole("button", { name: "Stop All Runs" }).click();
  await expect(kill).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Kill switch is on." })).toBeVisible();
  await kill.click();
  await expect(kill).not.toBeChecked();
});

test("edits default budget and allowed websites, normalising origins", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Max steps").fill("90");
  await page.getByLabel("Add a website").fill("Learn.ZyBooks.com/zybook/x");
  await page.getByLabel("Add a website").press("Enter");
  await expect(page.getByText("https://learn.zybooks.com")).toBeVisible();
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Defaults saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Max steps")).toHaveValue("90");
  await page.getByLabel("Max steps").fill("0");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Use 1–10,000 steps.")).toBeVisible();
});
```

Update `search.spec.ts`'s ⌘K test to start at `/settings`.

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/settings.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/components/settings/kill-switch-row.tsx`:
```tsx
"use client";

import type { SettingsView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";

export function KillSwitchRow({ settings }: { settings: SettingsView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const key = orpc.settings.get.queryKey({ input: {} });

  const apply = async (on: boolean) => {
    const previous = qc.getQueryData<SettingsView>(key);
    qc.setQueryData<SettingsView>(key, (old) => old && { ...old, killSwitch: on });
    try {
      qc.setQueryData(key, await api.settings.setKillSwitch({ on }));
      toast({ title: on ? "All runs stopped" : "Kill switch off. Runs can start again.", icon: on ? "stop" : "ok" });
    } catch {
      qc.setQueryData(key, previous);
      toast({ title: "Couldn't change the kill switch.", icon: "needsReview", tone: "danger" });
    }
  };

  return (
    <div className="row">
      <label htmlFor="kill-switch-label" className="min-w-0">
        <span id="kill-switch-label">Kill switch</span>
        <small>Stops every run within a second and blocks new ones until you turn it off.</small>
      </label>
      <Switch label="Kill switch" tone="danger" checked={settings.killSwitch} onCheckedChange={(on) => (on ? setConfirm(true) : void apply(false))} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Stop all runs?" description="Every run is cancelled within a second and no new run starts until you turn this off." cancelLabel="Keep Running" confirmLabel="Stop All Runs" destructive onConfirm={() => void apply(true)} />
    </div>
  );
}
```

`apps/web/components/settings/defaults-form.tsx`:
```tsx
"use client";

import { Budget, OriginInput, type SettingsView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { api, orpc } from "@/lib/api/client.ts";

export function DefaultsForm({ settings }: { settings: SettingsView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial = { steps: String(settings.defaultBudget.maxSteps), usd: String(settings.defaultBudget.maxUsd), minutes: String(settings.defaultBudget.maxActiveMinutes), origins: settings.defaultAllowedOrigins };
  const [draft, setDraft] = useState(initial);
  const [newOrigin, setNewOrigin] = useState("");
  const [errors, setErrors] = useState<{ steps?: string; usd?: string; minutes?: string; origin?: string }>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const addOrigin = () => {
    const parsed = OriginInput.safeParse(newOrigin);
    if (!parsed.success) {
      setErrors((e) => ({ ...e, origin: "Enter a website such as example.com." }));
      return;
    }
    setErrors((e) => ({ ...e, origin: undefined }));
    setDraft((d) => (d.origins.includes(parsed.data) ? d : { ...d, origins: [...d.origins, parsed.data] }));
    setNewOrigin("");
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const budget = Budget.safeParse({ maxSteps: Number(draft.steps), maxUsd: Number(draft.usd), maxActiveMinutes: Number(draft.minutes) });
    if (!budget.success) {
      const fields = new Set(budget.error.issues.map((i) => String(i.path[0])));
      setErrors({
        steps: fields.has("maxSteps") ? "Use 1–10,000 steps." : undefined,
        usd: fields.has("maxUsd") ? "Use more than $0 and at most $1,000." : undefined,
        minutes: fields.has("maxActiveMinutes") ? "Use 1–1,440 minutes." : undefined,
      });
      return;
    }
    setErrors({});
    try {
      qc.setQueryData(orpc.settings.get.queryKey({ input: {} }), await api.settings.update({ defaultBudget: budget.data, defaultAllowedOrigins: draft.origins }));
      toast({ title: "Defaults saved", icon: "check" });
    } catch {
      toast({ title: "Couldn't save the defaults.", icon: "needsReview", tone: "danger" });
    }
  }

  return (
    <form className="defaults" onSubmit={save}>
      <div className="defaults-budget">
        <TextField label="Max steps" inputMode="numeric" value={draft.steps} error={errors.steps} onChange={(e) => setDraft((d) => ({ ...d, steps: e.target.value }))} />
        <TextField label="Max spend (USD)" inputMode="decimal" value={draft.usd} error={errors.usd} onChange={(e) => setDraft((d) => ({ ...d, usd: e.target.value }))} />
        <TextField label="Max active minutes" inputMode="numeric" value={draft.minutes} error={errors.minutes} onChange={(e) => setDraft((d) => ({ ...d, minutes: e.target.value }))} />
      </div>
      <div className="grid gap-2">
        <span className="tf-label">Allowed websites</span>
        <div className="flex flex-wrap gap-2">
          {draft.origins.length ? draft.origins.map((o) => (
            <Chip key={o} icon="web" onRemove={() => setDraft((d) => ({ ...d, origins: d.origins.filter((x) => x !== o) }))} removeLabel={`Remove ${o}`}>{o}</Chip>
          )) : <span className="t-foot">None. Each task names its own websites.</span>}
        </div>
        <TextField
          label="Add a website"
          placeholder="example.com"
          value={newOrigin}
          error={errors.origin}
          onChange={(e) => setNewOrigin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOrigin();
            }
          }}
        />
      </div>
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button onClick={() => setDraft(initial)}>Revert</Button>
          <Button variant="primary" type="submit">Save defaults</Button>
        </div>
      ) : null}
    </form>
  );
}
```

After a successful save, `initial` recomputes from the updated query data on the next render, so `dirty` clears. Key the form on `JSON.stringify(settings)` in the parent so the draft resets to the saved values.

`apps/web/components/settings/settings-view.tsx`:
```tsx
"use client";

import { MODELS } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { authClient } from "@/lib/auth-client.ts";
import { DefaultsForm } from "./defaults-form.tsx";
import { KillSwitchRow } from "./kill-switch-row.tsx";

export function SettingsView() {
  const router = useRouter();
  const { data } = useQuery(orpc.settings.get.queryOptions({ input: {} }));
  const signOut = async () => {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Settings" }]} />
      </Toolbar>
      <div className="wrap slist">
        <PageHead title="Settings" lede="Safety, defaults for new tasks, and what the agent has used." />
        {!data ? (
          <div aria-busy="true" aria-label="Loading settings"><Skeleton className="h-40 rounded-lg" /></div>
        ) : (
          <>
            <h2 className="t-title3 group-title">Safety</h2>
            <div className="group"><KillSwitchRow settings={data} /></div>

            <h2 className="t-title3 group-title">Defaults for new tasks</h2>
            <div className="group group-pad"><DefaultsForm key={JSON.stringify(data)} settings={data} /></div>

            <h2 className="t-title3 group-title">Agent</h2>
            <div className="group">
              <div className="row"><span>Model<small>Planning and page understanding</small></span><span className="mono muted">{MODELS.agentPrimary} → {MODELS.agentFallback}</span></div>
              <div className="row"><span>Concurrency<small>Equal to the browser slots in the deployment</small></span><span className="muted">{data.concurrency} browsers at once</span></div>
            </div>

            <h2 className="t-title3 group-title">Activity</h2>
            <nav className="group" aria-label="Activity">
              <Link className="row row-link" href="/settings/usage"><span><Icon name="usage" /> Usage</span><Icon name="chevronRight" /></Link>
              <Link className="row row-link" href="/settings/audit"><span><Icon name="audit" /> Audit log</span><Icon name="chevronRight" /></Link>
            </nav>

            <h2 className="t-title3 group-title">Account</h2>
            <div className="group"><div className="row"><span>Signed in</span><Button icon="signOut" onClick={() => void signOut()}>Sign out</Button></div></div>
          </>
        )}
      </div>
    </>
  );
}
```

`apps/web/app/(app)/settings/page.tsx`:
```tsx
import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view.tsx";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsView />;
}
```

`apps/web/styles/settings.css` (import it in `globals.css` after `vault.css`):
```css
.slist {
  max-width: 48rem;
  padding-bottom: 5rem;
}
.group-title {
  margin: 2rem 0.25rem 0.6rem;
}
.group-pad {
  padding: 1.1rem;
}
.row-link {
  color: var(--label);
  &:hover {
    background: var(--fill-2);
    text-decoration: none;
  }
  & > span {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
  }
  & .ic {
    color: var(--label-2);
  }
}
.defaults {
  display: grid;
  gap: 1.25rem;
}
.defaults-budget {
  display: grid;
  gap: 0.9rem;
  @variant md {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```

- [ ] **Step 4: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/settings.spec.ts e2e/search.spec.ts e2e/move.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): Settings with confirmed kill switch, budget and allowed-website defaults, account"
```

---

### Task 27: Usage

**Files:**
- Create: `apps/web/lib/usage/summary.ts`, `apps/web/components/settings/{usage-view,usage-chart}.tsx`, `apps/web/app/(app)/settings/usage/page.tsx`
- Modify: `apps/web/styles/settings.css`
- Test: `apps/web/lib/usage/summary.test.ts`, `apps/web/e2e/usage.spec.ts`

**Interfaces:**
- Consumes: `orpc.settings.usage` and `RubberSegment`.
- Produces:
  - **`rangeFor(days, today: Date): {from; to}`** (UTC ISO dates, inclusive), `summarize(report)` returning `{usd; runs; steps}`, `niceCeiling(n)`, and `formatUsd(n)`.
  - **`/settings/usage`** with:
    - a range selector (7/30/90 days);
    - stat tiles;
    - a daily-spend bar chart: single series, accent hue, no legend, a hover/focus tooltip on each bar, heights set with CSS `height` (not animated), and a data-table fallback under "Show data";
    - a per-run table linking to runs.

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/usage/summary.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatUsd, niceCeiling, rangeFor, summarize } from "./summary.ts";

describe("usage summary", () => {
  it("builds inclusive UTC ranges", () => {
    expect(rangeFor(7, new Date("2026-10-05T23:30:00Z"))).toEqual({ from: "2026-09-29", to: "2026-10-05" });
  });
  it("totals a report", () => {
    expect(summarize({ perDay: [{ day: "a", runs: 2, usd: 1.25, steps: 30 }, { day: "b", runs: 1, usd: 0.5, steps: 10 }], perRun: [], stepLatencyMs: { p50: null, p95: null }, openaiErrorRate: null })).toEqual({ usd: 1.75, runs: 3, steps: 40 });
  });
  it("picks readable axis ceilings", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(3.2)).toBe(5);
    expect(niceCeiling(17)).toBe(20);
    expect(niceCeiling(240)).toBe(250);
  });
  it("formats money", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});
```

`apps/web/e2e/usage.spec.ts`:
```ts
import { expect, expectCleanScreen, test } from "./helpers/test.ts";

test("usage shows totals, an accessible daily chart and per-run spend", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await expect(page.getByRole("heading", { level: 1, name: /Usage/ })).toBeVisible();
  await expect(page.getByText("Spend")).toBeVisible();
  const chart = page.getByRole("figure", { name: "Daily spend" });
  await expect(chart.locator("[data-qa='bar']")).toHaveCount(30);
  await chart.locator("[data-qa='bar']").first().focus();
  await expect(chart.getByRole("tooltip")).toBeVisible();
  await page.getByText("Show data").click();
  await expect(page.getByRole("table", { name: "Daily spend data" })).toBeVisible();
  await expectCleanScreen(page);
  await page.getByRole("radiogroup", { name: "Range" }).getByRole("radio", { name: "7 days" }).click();
  await expect(chart.locator("[data-qa='bar']")).toHaveCount(7);
  await expect(page.getByRole("link", { name: /Capture the learning-rate warmup/ })).toBeVisible();
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test -- apps/web/lib/usage && pnpm test:ui -- e2e/usage.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/lib/usage/summary.ts`:
```ts
import type { UsageReport } from "@mastertutor/contracts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function rangeFor(days: number, today: Date): { from: string; to: string } {
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
}

export function summarize(report: UsageReport): { usd: number; runs: number; steps: number } {
  return report.perDay.reduce((t, d) => ({ usd: Math.round((t.usd + d.usd) * 100) / 100, runs: t.runs + d.runs, steps: t.steps + d.steps }), { usd: 0, runs: 0, steps: 0 });
}

export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= max) ?? 10;
  return step * magnitude;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatUsd = (n: number) => usd.format(n);
```

`apps/web/components/settings/usage-chart.tsx`:
```tsx
import type { UsageReport } from "@mastertutor/contracts";
import type { CSSProperties } from "react";
import { formatUsd, niceCeiling } from "@/lib/usage/summary.ts";

const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

export function UsageChart({ perDay }: { perDay: UsageReport["perDay"] }) {
  const max = niceCeiling(Math.max(0, ...perDay.map((d) => d.usd)));
  const ticks = [0, Math.floor(perDay.length / 2), perDay.length - 1];
  return (
    <figure className="chart" aria-label="Daily spend">
      <div className="chart-plot">
        <div className="chart-axis" aria-hidden="true">
          <span>{formatUsd(max)}</span>
          <span>{formatUsd(0)}</span>
        </div>
        <ol className="chart-bars">
          {perDay.map((d) => (
            <li key={d.day} className="chart-col">
              <span data-qa="bar" tabIndex={0} className="chart-bar" style={{ "--v": d.usd / max } as CSSProperties} aria-label={`${dayLabel(d.day)}: ${formatUsd(d.usd)}, ${d.runs} runs`} aria-describedby={`tip-${d.day}`} />
              <span id={`tip-${d.day}`} role="tooltip" className="chart-tip">
                <b>{dayLabel(d.day)}</b> {formatUsd(d.usd)} · {d.runs} runs · {d.steps} steps
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="chart-x t-foot" aria-hidden="true">
        {ticks.map((i) => (
          <span key={i}>{perDay[i] ? dayLabel(perDay[i].day) : ""}</span>
        ))}
      </div>
      <details className="chart-data">
        <summary className="btn btn-plain">Show data</summary>
        <table aria-label="Daily spend data">
          <thead><tr><th scope="col">Day</th><th scope="col">Spend</th><th scope="col">Runs</th><th scope="col">Steps</th></tr></thead>
          <tbody>
            {perDay.map((d) => (
              <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{formatUsd(d.usd)}</td><td>{d.runs}</td><td>{d.steps}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
```

`apps/web/components/settings/usage-view.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RubberSegment, type SegmentItem } from "@/components/bits/rubber-segment.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { formatUsd, rangeFor, summarize } from "@/lib/usage/summary.ts";
import { UsageChart } from "./usage-chart.tsx";

type RangeKey = "7" | "30" | "90";
const RANGES: SegmentItem<RangeKey>[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

export function UsageView() {
  const [range, setRange] = useState<RangeKey>("30");
  const input = useMemo(() => rangeFor(Number(range), new Date()), [range]);
  const { data } = useQuery(orpc.settings.usage.queryOptions({ input }));
  const totals = data ? summarize(data) : null;
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Settings", href: "/settings" }, { label: "Usage" }]} />
        <ToolbarSpacer />
        <RubberSegment aria-label="Range" size="sm" items={RANGES} value={range} onChange={setRange} />
      </Toolbar>
      <div className="wrap slist">
        <PageHead title="Usage" lede="What the agent spent, and how fast it worked." />
        {!data || !totals ? (
          <div aria-busy="true" aria-label="Loading usage"><Skeleton className="h-64 rounded-lg" /></div>
        ) : (
          <>
            <dl className="tiles">
              <div className="tile"><dt>Spend</dt><dd>{formatUsd(totals.usd)}</dd></div>
              <div className="tile"><dt>Runs</dt><dd>{totals.runs}</dd></div>
              <div className="tile"><dt>Steps</dt><dd>{totals.steps}</dd></div>
              <div className="tile"><dt>Step latency</dt><dd>{data.stepLatencyMs.p50 ?? "–"}<small> ms p50 · {data.stepLatencyMs.p95 ?? "–"} p95</small></dd></div>
              <div className="tile"><dt>OpenAI errors</dt><dd>{data.openaiErrorRate === null ? "–" : `${(data.openaiErrorRate * 100).toFixed(1)}%`}</dd></div>
            </dl>
            <h2 className="t-title3 group-title">Daily spend</h2>
            <div className="group group-pad"><UsageChart perDay={data.perDay} /></div>
            <h2 className="t-title3 group-title">By run</h2>
            <div className="group table-scroll">
              <table className="data-table" aria-label="Spend by run">
                <thead><tr><th scope="col">Run</th><th scope="col">Status</th><th scope="col">Steps</th><th scope="col">Spend</th></tr></thead>
                <tbody>
                  {data.perRun.map((r) => (
                    <tr key={r.runId}>
                      <td><Link href={`/runs/${r.runId}`}>{r.goal}</Link></td>
                      <td>{r.status}</td>
                      <td>{r.steps}</td>
                      <td>{formatUsd(r.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
```

`apps/web/app/(app)/settings/usage/page.tsx`:
```tsx
import type { Metadata } from "next";
import { UsageView } from "@/components/settings/usage-view.tsx";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return <UsageView />;
}
```

Append to `apps/web/styles/settings.css`:
```css
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0;
  @variant md {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
.tile {
  padding: 1rem;
  border-radius: var(--r-lg);
  background: var(--elevated);
  box-shadow: var(--e1);
  & dt {
    font-size: 0.75rem;
    color: var(--label-2);
  }
  & dd {
    margin: 0.25rem 0 0;
    font: 700 1.5rem/1.1 var(--font-display);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  & small {
    font: 400 0.75rem var(--font-ui);
    color: var(--label-2);
  }
}
.chart-plot {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.5rem;
  height: 12rem;
}
.chart-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font: 0.6875rem var(--font-code);
  color: var(--label-2);
}
.chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  margin: 0;
  padding: 0;
  border-bottom: 1px solid var(--sep);
  list-style: none;
}
.chart-col {
  position: relative;
  display: flex;
  flex: 1;
  align-items: flex-end;
  height: 100%;
}
.chart-bar {
  display: block;
  width: 100%;
  height: calc(var(--v) * 100%);
  min-height: 1px;
  border-radius: 4px 4px 0 0;
  background: var(--tint);
  outline-offset: 1px;
}
.chart-tip {
  position: absolute;
  bottom: calc(100% + 0.25rem);
  left: 50%;
  z-index: 5;
  width: max-content;
  max-width: 14rem;
  padding: 0.4rem 0.55rem;
  border-radius: var(--r-sm);
  background: var(--elevated);
  box-shadow: var(--e2);
  font-size: 0.75rem;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
  transition-property: opacity;
  transition-duration: var(--motion-dur-micro);
  transition-timing-function: var(--motion-ease-out);
}
.chart-col:hover .chart-tip,
.chart-bar:focus-visible + .chart-tip {
  opacity: 1;
}
.chart-col:first-child .chart-tip {
  left: 0;
  transform: none;
}
.chart-col:last-child .chart-tip {
  left: auto;
  right: 0;
  transform: none;
}
.chart-x {
  display: flex;
  justify-content: space-between;
  margin-top: 0.4rem;
  padding-left: 3.5rem;
}
.chart-data {
  margin-top: 0.75rem;
  & table {
    width: 100%;
    font-size: 0.8125rem;
    border-collapse: collapse;
  }
  & td,
  & th {
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--sep);
    text-align: left;
  }
}
.table-scroll {
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  & th {
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--sep);
    text-align: left;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--label-2);
    white-space: nowrap;
  }
  & td {
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--sep);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  & tr:last-child td {
    border-bottom: 0;
  }
}
```

The hidden tooltips sit at `opacity: 0` inside `.chart-col`, which has visible overflow, so the layout detector does not flag them as clipped. They are skipped as invisible anyway.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm test -- apps/web/lib/usage && pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/usage.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): Usage page with range selector, stat tiles, accessible daily-spend chart and per-run table"
```

---

### Task 28: Audit log

**Files:**
- Create: `apps/web/components/settings/audit-view.tsx`, `apps/web/app/(app)/settings/audit/page.tsx`
- Modify: `apps/web/styles/settings.css`
- Test: `apps/web/e2e/audit.spec.ts`

**Interfaces:**
- Consumes: `orpc.vault.audit.infiniteOptions` and `formatDateTime`.
- Produces:
  - **`/settings/audit`:** the vault audit, newest first, with "Load more" (50 per page).
  - **`ACTION_META`:** a label and icon per `VaultAuditAction`. "Denied" is warn-toned with an icon and a word.
  - **Layout.** A table at 821 px and wider; stacked rows at ≤ 820 px.

- [ ] **Step 1: Write the failing spec.**

`apps/web/e2e/audit.spec.ts`:
```ts
import { expect, expectCleanScreen, isCompact, test } from "./helpers/test.ts";

test("audit log lists vault events with paging, clean at every width", async ({ page }) => {
  await page.goto("/settings/audit");
  await expect(page.getByRole("heading", { level: 1, name: /Audit log/ })).toBeVisible();
  const entries = page.locator("[data-qa='audit-entry']");
  await expect(entries).toHaveCount(50);
  await expect(page.getByText("Denied").first()).toBeVisible();
  if (!isCompact(page)) await expect(page.getByRole("table", { name: "Vault audit" })).toBeVisible();
  await expectCleanScreen(page);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(entries).toHaveCount(60);
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();
});
```

- [ ] **Step 2: Run the spec to verify it fails.**

Run: `pnpm test:ui -- e2e/audit.spec.ts --project=w1440`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`apps/web/components/settings/audit-view.tsx`:
```tsx
"use client";

import type { VaultAuditAction, VaultAuditView } from "@mastertutor/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { IconName } from "@/components/ui/icon.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { MEDIA } from "@/lib/breakpoints.ts";
import { formatDateTime, hostOf } from "@/lib/notes/format.ts";

export const ACTION_META: Record<VaultAuditAction, { label: string; icon: IconName; tone: BadgeTone }> = {
  create: { label: "Added", icon: "add", tone: "neutral" },
  update: { label: "Changed", icon: "edit", tone: "neutral" },
  delete: { label: "Deleted", icon: "delete", tone: "neutral" },
  fill: { label: "Filled", icon: "password", tone: "ok" },
  passkey: { label: "Passkey used", icon: "passkey", tone: "ok" },
  otp_received: { label: "Code received", icon: "codeOtp", tone: "tint" },
  denied: { label: "Denied", icon: "needsReview", tone: "warn" },
};

const Action = ({ entry }: { entry: VaultAuditView }) => {
  const m = ACTION_META[entry.action];
  return <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>;
};

export function AuditView() {
  const wide = useMediaQuery(MEDIA.md);
  const audit = useInfiniteQuery(
    orpc.vault.audit.infiniteOptions({
      input: (cursor: string | null) => ({ limit: 50, cursor }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  const entries = audit.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Settings", href: "/settings" }, { label: "Audit log" }]} />
      </Toolbar>
      <div className="wrap slist">
        <PageHead title="Audit log" lede="Every time a sign-in was added, changed, used or refused. It can't be edited." />
        {audit.isPending ? (
          <div aria-busy="true" aria-label="Loading audit log"><Skeleton className="h-64 rounded-lg" /></div>
        ) : wide ? (
          <div className="group table-scroll">
            <table className="data-table" aria-label="Vault audit">
              <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Sign-in</th><th scope="col">Field</th><th scope="col">Run</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} data-qa="audit-entry">
                    <td className="whitespace-nowrap">{formatDateTime(e.at)}</td>
                    <td><Action entry={e} /></td>
                    <td><span className="mono">{e.alias}</span>{e.origin ? <span className="t-foot"> · {hostOf(e.origin)}</span> : null}</td>
                    <td>{e.field ?? "–"}</td>
                    <td>{e.runId ? <Link href={`/runs/${e.runId}`}>Run {e.runId.slice(-6)}</Link> : "–"}</td>
                    <td>{e.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="group audit-list" aria-label="Vault audit">
            {entries.map((e) => (
              <li key={e.id} data-qa="audit-entry" className="audit-item">
                <div className="flex flex-wrap items-center gap-2"><Action entry={e} /><span className="mono">{e.alias}</span></div>
                <span className="t-foot">{formatDateTime(e.at)}{e.field ? ` · ${e.field}` : ""} · {e.outcome}</span>
              </li>
            ))}
          </ul>
        )}
        {audit.hasNextPage ? (
          <div className="flex justify-center py-6">
            <Button onClick={() => void audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>Load more</Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
```

`apps/web/app/(app)/settings/audit/page.tsx`:
```tsx
import type { Metadata } from "next";
import { AuditView } from "@/components/settings/audit-view.tsx";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  return <AuditView />;
}
```

Append to `apps/web/styles/settings.css`:
```css
.audit-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.audit-item {
  display: grid;
  gap: 0.35rem;
  padding: 0.8rem 1.1rem;
  & + .audit-item {
    border-top: 1px solid var(--sep);
  }
}
```

- [ ] **Step 4: Run the spec to verify it passes.**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui -- e2e/audit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web
git commit -m "feat(web): vault audit log with paging, table on regular widths, stacked rows on compact"
```

---

### Task 29: CI job and full-suite verification

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm test:ui` and the Phase 0 CI jobs.
- Produces: a `ui` job named "UI (Playwright, 5 breakpoints, layout QA + axe)". It uploads the Playwright report on failure.

- [ ] **Step 1: Add the job.**

Append under `jobs:` in `.github/workflows/ci.yml`:
```yaml
  ui:
    name: UI (Playwright, 5 breakpoints, layout QA + axe)
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @mastertutor/web exec playwright install --with-deps chromium
      - run: pnpm test:ui
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: apps/web/playwright-report
          retention-days: 7
```

- [ ] **Step 2: Run everything locally.**

Run:
```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @mastertutor/web build && pnpm test:ui
```
Expected:
- Every unit test and every Playwright spec passes in `w1440`, `w1180`, `w1024`, `w820` and `w390`.
- `motion-tokens.test.ts` confirms that `styles/motion.css` is fresh.
- Then run `docker builder prune -f` only if Docker was used (it is not needed here).

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: Playwright UI job across five breakpoints with layout QA and axe"
```

---

## Notes for later phases

1. **F3 (New task, Run view):**
   - Replace `app/(app)/new/page.tsx` and `app/(app)/runs/page.tsx`.
   - Replace the `runs.*` fixture handlers in `lib/fixtures/router.ts`, using recorded `RunEvent`s and seeded runs.
   - Reuse `Toolbar`, `PageHead`, `Sheet`, `ConfirmDialog`, `RubberSegment`, `useToast`, `transitions` and `orpc`.
   - Add StatusMark, ThoughtLine, CountUp and CodeSlots to `components/bits/` with the same header and licence pattern.
   - Add a sidebar live-run status there.
   - **The PiP belongs to F3.**
   - `/` may redirect to `/new` once it exists.
2. **Phase 7 (integration):**
   - Replace `liveRouter`'s `notWired` handlers per namespace with DB-backed handlers. B2 owns notes, folders and search. B3 owns vault sealing (`vault.create` and `setSecret` seal with `VAULT_PUBLIC_KEY`). B6 owns `runs.openLive`.
   - Serve `notes.export` with `buildNoteMarkdown` plus asset bytes in a zip.
   - Asset URLs must be reachable by the browser (Phase 0 note 5).
   - Keep the fixture router for UI tests.
3. **Folder deletion semantics.** The fixture deletes the subtree and unfiles its notes, and the UI copy says so. B2's handler must match, or the copy in `FolderActions` must change in the same PR.
4. **Search scope.** The fixture searches block text. If B2 keeps title-and-lede only (Phase 0 note 6), the "grad_norm" search expectation must move to the integration suite with B2's block `tsvector`.
5. **Phase 8 QA.**
   - Visual-regression baselines (`toHaveScreenshot`) are deliberately not committed in F phases, because they are platform-specific. Phase 8 records them on the CI image.
   - The D28 animation auditor starts from `lib/motion-tokens.ts`, the three adapted React Bits files, and the CSS that uses `--motion-*`.
6. **Source snapshot.** A contract endpoint for the stored screenshot or MHTML (for example `sources.snapshotUrl`) would let the Source pane show the page as it looked. That needs a contracts change and is out of scope here.

---

## Self-Review

**1. Spec coverage** (spec §11, §16 F1/F2/F4, D21–D29, and the dispatch scope):

| Requirement | Task(s) |
|---|---|
| `tokens.css` mapped to Tailwind v4 `@theme`, `#FAFAFA`, glass recipe, reduced transparency | 1, 7 |
| `motion` + LazyMotion, `motion-tokens.ts`, generated `motion.css`, 12-vs-14 pin check | 2 |
| ESLint motion rules and import bans; Stylelint motion rules | 3 |
| Icon registry (Lucide, stroke 1.6, typed, no letter tiles) | 4 |
| CSS skeletons, controls and glass | 7, 8 |
| Overlays (sheets, alerts, popovers, menus) | 9 |
| SwipeToast (copied, adapted, licensed) | 10 |
| App shell: sidebar, icon rail, tab bar | 11 |
| Auth screens | 12 |
| Seeded data against Phase 0 contracts | 5, 6 |
| Folder tree, nested folders, drag-to-move, Move to… | 13, 15 |
| RubberSegment filters and view toggle, grid and list | 14 |
| ⌘K search | 16 |
| KaTeX, code and table rendering | 17 |
| Reader: source strip, provenance popovers | 18 |
| Margin callouts with collision avoidance (D22) | 19 |
| Source \| Note | 20 |
| SpringCheck Mark verified | 21 |
| Tiptap 3 editing | 22 |
| Export | 23 |
| Vault UI: add, rotate (replace), delete, field types, sessions, "never shown", B3 endpoints | 24, 25 |
| Settings: kill switch, defaults, concurrency (read-only) | 26 |
| Usage | 27 |
| Audit | 28 |
| Playwright at 5 breakpoints plus the DOM overflow detector plus axe on every screen | 7 and every UI task |
| CI | 29 |
| F1 done-when (token page clean at all breakpoints) | 7–10 |

**2. Placeholder scan.**
- Every code step has full code.
- The `<sha256>` markers in the React Bits headers are filled from a command output in the same step.
- Steps that point at a later task (for example Task 11's `authClient`, Task 15's Vault navigation, and Task 18's minimal `BlockEditor`) say exactly what to do until then.

**3. Type and name consistency:**
- `orpc` and `api` are the only client exports.
- These keep the same names throughout: `patchNoteLists` and `patchNoteDetail`; `useMoveNote(noteId, to, from)`; `FolderTree.onDropNote(noteId, folderId|null)`; `parseLibraryParams` and `libraryHref`; `provenanceOf`, `calloutFor`, `isRawHtmlTable` and `statusOf`; `layoutCallouts`; `toCreateInput` and `SECRET_INPUT`; `FIDELITY_META`; `ACTION_META`.
- Cookie names come only from `lib/fixtures/cookies.ts` (both the app and Playwright import it).
- `WEB_FIXTURE_API` is defined once in `WebEnv`.

**4. Review Focus mapping:**

| # | Concern | Test |
|---|---|---|
| 1 | Untrusted markdown | `block-markdown.test.ts` (Task 17) |
| 2 | Secret hygiene | `router.test.ts` (Task 5), `vault-forms.spec.ts` canary (Task 25) |
| 3 | Long unbroken content | `n10` and `v5` seeds plus `expectCleanScreen` in Tasks 14, 18, 24 |
| 4 | Folder cycles and depth | `tree.test.ts` (Task 5), `folders.spec.ts` (Task 13) |
| 5 | Optimistic rollback and Undo after navigation | `move.spec.ts` (Task 15), `verify.spec.ts` (Task 21) |

**5. Known risks for executors:**
- Base UI `render` composition on `Menu.Trigger`.
- `StarterKit.configure({link})` typing.
- The `useEffectEvent` export in React 19.3.

Each risk has a stated fallback in its step. If one of these APIs differs, fix it locally and keep the interface names unchanged.
