# React Bits Delight Pass (D43) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add delight and efficiency motion to the existing F1/F2/F4 screens with adapted React Bits components. This covers:
- folder float and lid lift, folder tiles, and the move sheet's "receive" moment (the user's FolderFloat request);
- the review's strongest per-screen picks;
- the three parked items;
- a first-load JS budget that holds the whole pass to account.

**Architecture:**
- **React Bits code:** each component is copied from its registry JSON, adapted and kept under `apps/web/components/bits/` with a licence header.
- **Animation approach:** most motion is plain CSS that reads `motion.css` tokens, so it adds almost no JS. `motion` (`m.*` under `LazyMotion`) is used only where JS is needed.
- **Layout animation:** it needs motion's `domMax` feature bundle (about 14 kB gz). That bundle loads through one lazy `import()` boundary (`<LayoutMotion>`), which ESLint enforces.
- **Library bans:** gsap, ogl, matter-js and three stay banned, because nothing in this pass is worth them.
- **Budget:** a build-output script measures first-load JS per route and fails CI when any route grows more than 6 kB gz over the 546aedd baseline.

**Tech Stack:** Next.js 16.3.8 (Turbopack), React 19.3, motion 14.0.0 (`motion/react`), Tailwind v4 CSS layers, Base UI 1.8, Vitest 5, Playwright 1.63 with `@axe-core/playwright`, ESLint 10 and Stylelint 17.

**Spec:**
- `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` §11.3–11.5 (icons, motion and React Bits, responsiveness).
- `orchestration/STATE.md` D17, D21, D25, D28 and D43.
- The "React Bits delight opportunities (D43)" section of `.superpowers/sdd/2026-10-05-phase-f1-f2-f4-frontend-core/final-review.md`.
- The parked items in that folder's `progress.md`.
- Mockup: `design/mock-d-apple.html`.

## Global Constraints

These apply to every task.

**Bloat, dependencies and libraries**
- **What counts as needed (D43):** "bloat-free" means leaving out only what isn't needed. Delight and functional efficiency count as needed. Decoration that adds neither is left out.
- **No new npm dependencies.** `package.json` dependency lists do not change.
- **`motion` is the only animation runtime (D43).**
  - `gsap`, `ogl`, `matter-js`, `@react-three/*` and `three` outside `components/hero/` stay banned.
  - `ALL_BANNED` in `eslint.config.js` does not change. No component in this pass is worth a heavy library.
  - FolderFloat's matter-js physics only drag-flings floating pills, which the library does not need.
- **`domMax` loads only through `<LayoutMotion>`'s `import()`.** ESLint enforces this; see Task 2.

**Animation**
- **Only these properties animate:** `transform`, `translate`, `scale`, `rotate` and `opacity`. Never `width`, `height`, `top`, `left`, `filter`, `stroke-dash*`, `clip-path` or colours.
- **Timing comes only from tokens.**
  - In CSS, every duration and easing comes from a `--motion-*` variable in the generated `styles/motion.css`.
  - In TS, every duration and easing comes from `lib/motion-tokens.ts`. Use `transitions.*` and `durations.*`.
  - No `ms` literals, easing literals, `stiffness` or `damping` anywhere else. This is linted by `motion/no-raw-motion`, `motion/no-raw-motion-classes` and Stylelint.
  - After editing `lib/motion-tokens.ts`, run `pnpm --filter @mastertutor/web motion:css`.
- **Reduced motion:**
  - Nothing moves. Fades are allowed.
  - The global rule in `motion.css` already turns transitions into opacity-only and shortens animations to 1 ms.
  - Any end state that would still show as movement (a tilt, a lift, a flap) goes inside `@media (prefers-reduced-motion: no-preference)`.
- **Press feedback:**
  - Under 100 ms, through the one shared rule in `styles/components.css`.
  - Every new pressable class joins `PRESS_TARGETS` in `styles/press.test.ts` and the four selector lists in `components.css`.

**Accessibility and visual tokens**
- **Accessibility:** keyboard and screen-reader parity for every change.
  - Animated visuals are `aria-hidden`. Their meaning is always in text or ARIA.
  - Zero serious or critical axe violations.
- **Colours:** only from `styles/tokens.css`. `styles/raw-values.test.ts` enforces this. New text and background pairs join `PAIRS` in `styles/tokens.test.ts` (WCAG AA 4.5:1).
- **Sizes:** in rem, except SVG viewBox units.
- **Licence header:** every React Bits file in `components/bits/` starts with this header, in the existing format:
  ```
  Adapted from React Bits "<Name>" (TS-TW).
  Source:  https://reactbits.dev/r/<Name>-TS-TW.json
  sha256:  <hash of the registry JSON> (fetched <date>)
  Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits ...
  Adaptations: ...
  ```
  Patterns rebuilt without copying code (AnimatedList, AnimatedContent, the word stagger) need no header.

**Layout and layers**
- **D25:** the sidebar stays as in mockup D. Its vermilion live dot stays, now drawn by StatusMark's `running` state.
- **No polling (principle 2):** run status changes arrive through whatever already refreshes queries. F3's SSE will invalidate them.
- **QA widths:** 1440, 1180, 1024, 820 and 390. Each Playwright project is one width, so a test without a width `skip` runs at all five.
- **Layering:** `lib/` never imports `components/` (`lib/layering.test.ts`).

**First-load JS budget**
- After the pass, every route's first-load JS must be at most its 546aedd baseline plus **6 kB gzip** (measured below).
- `pnpm --filter @mastertutor/web check:first-load` enforces this in CI.

**Left out on purpose (decoration without delight or efficiency, or a regression)**
- **ElasticSlider (settings budget):** typed numbers are faster and exact for a budget. The source also animates `height` and margins and has no keyboard path.
- **HoldButton:** "Sign out" of a vault session has no confirm today, so there is nothing to replace. Delete keeps ConfirmDialog (HIG).
- **AnimatedContent (gsap):** rebuilt as a 6-line CSS reveal (Task 10).
- **CountUp:** it rewrites text every frame. Counter's transform-only digit roll replaces it (RollingNumber, Task 9).
- **FolderFloat's physics and floating pills:** see the bans above. The pill idea returns as one purposeful element, the note flying into its destination folder (Task 5).
- **Also avoided, per run 18:** SpotlightCard, Dock, GlassSurface/FluidGlass, Masonry, BlurText/SplitText, and any ogl or three background.

## Review Focus

These failure modes are implied by the spec but no task's main tests exercise them. Each line names its owning test.

1. **Drag-over flicker on a folder tile.**
   - Moving the pointer across the tile's own label fires `dragleave` and `dragenter` pairs.
   - The lid must stay lifted until the pointer truly leaves the tile.
   - Owner: Task 4, `folder-tiles.spec.ts`, "the lid stays up while the drag crosses the tile's label".
2. **Double pick during the move sheet's receive animation.**
   - A second click on another destination in the ~450 ms receive window must not send a second move or a second toast.
   - Owner: Task 5, `move.spec.ts`, "a second pick during the receive animation is ignored".
3. **RollingNumber with values whose shape changes.**
   - Cases: `$9.99` → `$10.00`, `–` → `4.2%`, `1,234` → `987`.
   - Text for assistive technology must always equal the formatted value. Columns must not overflow at 390.
   - Owner: Task 9, `rolling-number.test.ts` unit cases and `usage.spec.ts`, "switching ranges keeps the tiles clean".
4. **A long folder name in a folder tile at 390 px.**
   - The name ellipsizes on the flap.
   - The page never scrolls sideways.
   - Owner: Task 4, `folder-tiles.spec.ts`, "a 120-character folder name stays inside its tile".
5. **A finished run whose details cannot be fetched (deleted, or the request failed).**
   - The sidebar badge must clear quietly. No error toast, and no stale "running" dot.
   - When several runs finish at once, failure wins.
   - Owner: Task 6, `pulse.test.ts` and `shell.spec.ts`, "a finished run that can't be fetched clears the badge quietly".

---

## Measured baseline (546aedd, production build, no `WEB_FIXTURE_API`)

**How it was measured:**
- Root main files (`build-manifest.json` `rootMainFiles`) plus every `.js` in the route's `page_client-reference-manifest.js` `entryJSFiles`.
- Each file is gzipped with Node's default zlib level and counted once.
- Lazy chunks (`import()`) are excluded by construction.

| Route | First-load JS (kB gz) |
|---|---|
| `/` | 203.1 |
| `/design` | 387.5 |
| `/library` | 384.6 |
| `/new` | 374.2 |
| `/notes/[noteId]` | 438.6 |
| `/runs` | 374.2 |
| `/settings` | 381.0 |
| `/settings/audit` | 381.8 |
| `/settings/usage` | 379.4 |
| `/sign-in` | 220.1 |
| `/sign-up` | 220.1 |
| `/vault` | 385.2 |

Budget: **+6 kB gz per route** for the whole pass.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `apps/web/scripts/first-load.ts` | Measure first-load JS per route; compare against a baseline (pure functions) | 1 |
| `apps/web/scripts/check-first-load.ts` | CLI: print, check, or `--write-baseline` | 1 |
| `apps/web/scripts/first-load-baseline.json` | Committed baseline and budget | 1 |
| `apps/web/components/motion/layout-features.ts` | The only static home of `domMax` | 2 |
| `apps/web/components/motion/layout-motion.tsx` | `<LayoutMotion>`: nested `LazyMotion` that `import()`s layout-features | 2 |
| `apps/web/e2e/helpers/motion.ts` | `movingAnimations`, `startSampling` and `readSamples` for motion assertions | 2 |
| `apps/web/components/bits/bits-licence.test.ts` | Every bits file keeps its licence header | 2 |
| `apps/web/components/library/folder-mark.tsx` | Folder glyph that floats on hover and lifts its lid (glyph swap) | 3 |
| `apps/web/components/bits/folder-float.tsx` | Adapted FolderFloat: 3D folder with paper and a tilting front flap | 4 |
| `apps/web/components/library/folder-tiles.tsx` | Subfolder tiles in the library: navigate, drop target, receive | 4 |
| `apps/web/lib/folders/drag.ts` | + `acceptsDrop`, shared by tree rows and tiles | 4 |
| `apps/web/lib/folders/tree.ts` | + `childFolders` | 4 |
| `apps/web/components/library/folder-pick-list.tsx` | + receive animation (lid lifts, note pill flies in), then `onDone` | 5 |
| `apps/web/components/bits/status-mark.tsx` | Adapted StatusMark, CSS-only | 6 |
| `apps/web/lib/runs/pulse.ts` | `finishedIds`, `flashStatus` (pure) | 6 |
| `apps/web/components/shell/use-run-pulse.ts` | Live count, plus a finish flash for the Runs nav item | 6 |
| `apps/web/components/bits/rolling-number.tsx` | Adapted Counter: transform-only digit roll for formatted values | 9 |

---

### Task 1: First-load JS budget check

**Files:**
- Create: `apps/web/scripts/first-load.ts`
- Create: `apps/web/scripts/check-first-load.ts`
- Create: `apps/web/scripts/first-load-baseline.json`
- Test: `apps/web/scripts/first-load.test.ts`
- Modify: `apps/web/package.json` (add the `check:first-load` script)
- Modify: `.github/workflows/ci.yml:89-91`

**Interfaces:**
- Consumes: the `.next/` output of `next build` (Turbopack): `build-manifest.json` and `server/app/**/page_client-reference-manifest.js`.
- Produces:
  - `export interface FirstLoadBaseline { budgetKb: number; routes: Record<string, number> }`
  - `export function routeOf(manifestKey: string): string`
  - `export function measureFirstLoad(nextDir: string): Record<string, number>`: route to kB gz, one decimal; routes starting `/_` are skipped.
  - `export function compareFirstLoad(current: Record<string, number>, baseline: FirstLoadBaseline): string[]`: findings; `[]` means within budget.
  - CLI: `pnpm --filter @mastertutor/web check:first-load`, which exits 1 on findings. `-- --write-baseline` rewrites the routes and keeps `budgetKb`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/scripts/first-load.test.ts
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compareFirstLoad, measureFirstLoad, routeOf } from "./first-load.ts";

const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;

function fakeBuild() {
  const dir = mkdtempSync(join(tmpdir(), "first-load-"));
  mkdirSync(join(dir, "static/chunks"), { recursive: true });
  const files = {
    "static/chunks/root.js": randomBytes(6000).toString("hex"),
    "static/chunks/layout.js": randomBytes(3000).toString("hex"),
    "static/chunks/page.js": randomBytes(2000).toString("hex"),
    "static/chunks/lazy.js": randomBytes(9000).toString("hex"),
  };
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body);
  writeFileSync(
    join(dir, "build-manifest.json"),
    JSON.stringify({ rootMainFiles: ["static/chunks/root.js"] }),
  );
  const manifest = (key: string, entries: Record<string, string[]>) =>
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n` +
    `globalThis.__RSC_MANIFEST[${JSON.stringify(key)}] = ${JSON.stringify({ entryJSFiles: entries, entryCSSFiles: {} })};`;
  mkdirSync(join(dir, "server/app/(app)/library"), { recursive: true });
  writeFileSync(
    join(dir, "server/app/(app)/library/page_client-reference-manifest.js"),
    manifest("/(app)/library/page", {
      "[project]/apps/web/app/layout": ["static/chunks/layout.js"],
      "[project]/apps/web/app/(app)/library/page": [
        "static/chunks/layout.js",
        "static/chunks/page.js",
        "static/chunks/page.css",
      ],
    }),
  );
  mkdirSync(join(dir, "server/app/_not-found"), { recursive: true });
  writeFileSync(
    join(dir, "server/app/_not-found/page_client-reference-manifest.js"),
    manifest("/_not-found/page", { "[project]/x": ["static/chunks/page.js"] }),
  );
  const gz = (path: keyof typeof files) => gzipSync(files[path]).length;
  return { dir, gz };
}

describe("routeOf", () => {
  it.each([
    ["/(app)/library/page", "/library"],
    ["/(app)/notes/[noteId]/page", "/notes/[noteId]"],
    ["/(auth)/sign-in/page", "/sign-in"],
    ["/page", "/"],
  ])("%s → %s", (key, route) => expect(routeOf(key)).toBe(route));
});

describe("measureFirstLoad", () => {
  it("sums root and entry JS once each, skipping CSS, lazy chunks and /_ routes", () => {
    const { dir, gz } = fakeBuild();
    expect(measureFirstLoad(dir)).toEqual({
      "/library": kb(gz("static/chunks/root.js") + gz("static/chunks/layout.js") + gz("static/chunks/page.js")),
    });
  });
});

describe("compareFirstLoad", () => {
  const baseline = { budgetKb: 6, routes: { "/library": 384.6, "/vault": 385.2 } };
  it("passes growth within the budget", () => {
    expect(compareFirstLoad({ "/library": 390.5, "/vault": 385.2 }, baseline)).toEqual([]);
  });
  it("names a route that grew past the budget", () => {
    expect(compareFirstLoad({ "/library": 390.7, "/vault": 385.2 }, baseline)).toEqual([
      "/library: 390.7 kB gz exceeds baseline 384.6 kB + 6 kB budget (+6.1 kB)",
    ]);
  });
  it("asks for a baseline for a new route", () => {
    expect(compareFirstLoad({ "/library": 384.6, "/runs/[runId]": 400 }, baseline)).toEqual([
      "/runs/[runId]: no baseline (run check:first-load -- --write-baseline and commit it)",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test apps/web/scripts/first-load.test.ts`
Expected: FAIL, `Failed to resolve import "./first-load.ts"`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/scripts/first-load.ts
/**
 * First-load JS per App Router route, from a `next build` (Turbopack) output directory.
 * First load = the root main files + every JS file the route's client-reference manifest lists in
 * entryJSFiles (its layouts and page). Chunks reached only through import() are never listed there,
 * so lazy-loaded code (KaTeX, domMax, three) does not count. Sizes are gzip (Node default level).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

export interface FirstLoadBaseline {
  budgetKb: number;
  routes: Record<string, number>;
}

type RscManifest = Record<string, { entryJSFiles?: Record<string, string[]> }>;

function* manifestFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* manifestFiles(path);
    else if (entry.name === "page_client-reference-manifest.js") yield path;
  }
}

/** "/(app)/library/page" → "/library": route groups and the trailing /page are not in the URL. */
export function routeOf(manifestKey: string): string {
  const path = manifestKey.replace(/\/page$/, "").replace(/\/\([^)]+\)/g, "");
  return path === "" ? "/" : path;
}

const toKb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;

export function measureFirstLoad(nextDir: string): Record<string, number> {
  const build = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8")) as {
    rootMainFiles: string[];
  };
  const gzCache = new Map<string, number>();
  const gz = (file: string) => {
    let size = gzCache.get(file);
    if (size === undefined) {
      size = gzipSync(readFileSync(join(nextDir, file))).length;
      gzCache.set(file, size);
    }
    return size;
  };
  const result: Record<string, number> = {};
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
      result[route] = toKb([...files].reduce((sum, file) => sum + gz(file), 0));
    }
  }
  return result;
}

export function compareFirstLoad(
  current: Record<string, number>,
  baseline: FirstLoadBaseline,
): string[] {
  const findings: string[] = [];
  for (const [route, size] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
    const base = baseline.routes[route];
    if (base === undefined) {
      findings.push(
        `${route}: no baseline (run check:first-load -- --write-baseline and commit it)`,
      );
    } else if (size > base + baseline.budgetKb) {
      const growth = Math.round((size - base) * 10) / 10;
      findings.push(
        `${route}: ${size} kB gz exceeds baseline ${base} kB + ${baseline.budgetKb} kB budget (+${growth} kB)`,
      );
    }
  }
  return findings;
}
```

```ts
// apps/web/scripts/check-first-load.ts
/**
 * Fails when any route's first-load JS grew past its committed baseline + budget (D43 delight pass:
 * delight is welcome, unbounded weight is not). Run after a production `next build`.
 *   pnpm --filter @mastertutor/web check:first-load                     check
 *   pnpm --filter @mastertutor/web check:first-load -- --write-baseline  rewrite routes, keep budget
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { compareFirstLoad, measureFirstLoad, type FirstLoadBaseline } from "./first-load.ts";

const nextDir = new URL("../.next/", import.meta.url).pathname;
const baselineUrl = new URL("./first-load-baseline.json", import.meta.url);
const DEFAULT_BUDGET_KB = 6;

const current = measureFirstLoad(nextDir);
const previous: FirstLoadBaseline = existsSync(baselineUrl)
  ? (JSON.parse(readFileSync(baselineUrl, "utf8")) as FirstLoadBaseline)
  : { budgetKb: DEFAULT_BUDGET_KB, routes: {} };

for (const [route, size] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
  const base = previous.routes[route];
  const delta = base === undefined ? "new" : `${size - base >= 0 ? "+" : ""}${(size - base).toFixed(1)}`;
  console.log(`${route.padEnd(24)} ${size.toFixed(1).padStart(7)} kB gz  (${delta})`);
}

if (process.argv.includes("--write-baseline")) {
  const next: FirstLoadBaseline = { budgetKb: previous.budgetKb, routes: current };
  writeFileSync(baselineUrl, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Baseline written (${Object.keys(current).length} routes).`);
} else {
  const findings = compareFirstLoad(current, previous);
  if (findings.length) {
    console.error(`First-load JS budget exceeded (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(`First-load JS within budget (+${previous.budgetKb} kB gz per route).`);
}
```

In `apps/web/package.json`, add this after `"check:bundle"`:

```json
    "check:first-load": "node scripts/check-first-load.ts"
```

In `.github/workflows/ci.yml`, after line 91 (`pnpm --filter @mastertutor/web check:bundle`), add this step to the same job:

```yaml
      # D43: delight is welcome, unbounded weight is not. Each route may grow at most budgetKb.
      - run: pnpm --filter @mastertutor/web check:first-load
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test apps/web/scripts/first-load.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Measure and commit the baseline from a production build**

Run:
```bash
cd apps/web && pnpm exec next build && node scripts/check-first-load.ts --write-baseline && cat scripts/first-load-baseline.json
```
Expected:
- `budgetKb` is `6`.
- The routes match the "Measured baseline" table above to within ±0.2 kB: `/library` ≈ 384.6, `/notes/[noteId]` ≈ 438.6, `/sign-in` ≈ 220.1, and so on.
- If a value differs by more, stop. Report the difference to the controller before continuing, because the build is not the 546aedd production build.

Then run `node scripts/check-first-load.ts`.
Expected: `First-load JS within budget (+6 kB gz per route).`

- [ ] **Step 6: Lint, then commit**

Run: `pnpm exec eslint apps/web/scripts && pnpm typecheck`
Expected: no errors.

```bash
git add apps/web/scripts/first-load.ts apps/web/scripts/check-first-load.ts apps/web/scripts/first-load-baseline.json apps/web/scripts/first-load.test.ts apps/web/package.json .github/workflows/ci.yml
git commit -m "build(web): first-load JS budget per route (+6 kB gz over 546aedd) for the delight pass"
```

---

### Task 2: Lazy layout-motion boundary and library card reflow (parked item)

**Files:**
- Create: `apps/web/components/motion/layout-features.ts`
- Create: `apps/web/components/motion/layout-motion.tsx`
- Create: `apps/web/e2e/helpers/motion.ts`
- Create: `apps/web/components/bits/bits-licence.test.ts`
- Modify: `eslint.config.js` (the motion import bans, a static-import boundary, the `ANIMATION_BANS` message, and an override block)
- Modify: `apps/web/lint/import-bans.test.ts`
- Modify: `apps/web/lib/motion-tokens.test.ts:43-57` (the API guard list)
- Modify: `apps/web/components/library/library-view.tsx:259-276`
- Modify: `apps/web/styles/library.css` (`.notes` gets `position: relative`)
- Test: `apps/web/e2e/daylight.spec.ts`

**Interfaces:**
- Consumes: `transitions` from `@/lib/motion-tokens.ts`.
- Produces:
  - `export function LayoutMotion({ children }: { children: ReactNode }): JSX.Element`. It enables `layout` and `layoutId` on `m.*` inside it. The features arrive after first paint. It sets `document.documentElement.dataset.layoutMotion = "ready"` when loaded, as a test hook (like `data-hotkeys`).
  - From `e2e/helpers/motion.ts`:
    - `movingAnimations(page: Page, selector: string): Promise<string[]>` returns the running WAAPI or CSS animations and transitions longer than 1 ms on elements inside `selector` whose keyframes move something (`transform`, `translate`, `scale`, `rotate`).
    - `startSampling(page: Page, key: string, selector: string, property: string, frames?: number): Promise<void>` records a computed style of the first match once per frame (default 45 frames).
    - `readSamples(page: Page, key: string, frames?: number): Promise<string[]>` waits for the samples, then returns them.

- [ ] **Step 1: Write the failing lint and licence tests**

Append to `apps/web/lint/import-bans.test.ts`. Inside the existing `describe`, also add `BITS` to the loop: `for (const file of [WEB, HERO, ICONS, BITS])`.

```ts
const BITS = "apps/web/components/bits/x.tsx";
const MOTION_DIR = "apps/web/components/motion/x.tsx";
const LAYOUT_FEATURES = "apps/web/components/motion/layout-features.ts";

describe("D43 lazy layout-motion boundary", () => {
  it("bans the domMax bundle outside layout-features.ts", async () => {
    const code = `import { domMax } from "motion/react"; export default domMax;`;
    expect(await rules(code, WEB)).toContain("no-restricted-imports");
    expect(await rules(code, BITS)).toContain("no-restricted-imports");
    expect(await rules(code, LAYOUT_FEATURES)).toEqual([]);
  });

  it("still bans the full motion component in layout-features.ts", async () => {
    expect(
      await rules(`import { motion } from "motion/react"; export default motion;`, LAYOUT_FEATURES),
    ).toContain("no-restricted-imports");
  });

  it("reaches layout-features only through import()", async () => {
    expect(
      await rules(`import f from "@/components/motion/layout-features.ts"; export default f;`, WEB),
    ).toContain("no-restricted-imports");
    expect(await rules(`import f from "./layout-features.ts"; export default f;`, MOTION_DIR)).toContain(
      "no-restricted-imports",
    );
    expect(await rules(`export const l = () => import("./layout-features.ts");`, MOTION_DIR)).toEqual([]);
  });
});
```

Create `apps/web/components/bits/bits-licence.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

describe("React Bits copies keep their licence (spec §11.4, D43)", () => {
  it("ships the licence text next to the copies", () => {
    expect(readFileSync(new URL("LICENSE-react-bits", dir), "utf8")).toContain("Commons Clause");
  });

  it.each(files)("%s names its source, hash, licence and adaptations", (file) => {
    const head = readFileSync(new URL(file, dir), "utf8").slice(0, 3000);
    expect(head).toMatch(/Adapted from React Bits "[A-Za-z]+" \(TS-TW\)/);
    expect(head).toMatch(/https:\/\/reactbits\.dev\/r\/[A-Za-z]+-TS-TW\.json/);
    expect(head).toMatch(/sha256[: ]+[0-9a-f]{64}/);
    expect(head).toContain("LICENSE-react-bits");
    expect(head).toContain("Adaptations:");
  });
});
```

In `apps/web/lib/motion-tokens.test.ts`, add `"domMax"` to the list in "still exports every motion API this app uses".

- [ ] **Step 2: Run the tests to verify the lint ones fail**

Run: `pnpm test apps/web/lint/import-bans.test.ts apps/web/components/bits/bits-licence.test.ts apps/web/lib/motion-tokens.test.ts`
Expected:
- The "D43 lazy layout-motion boundary" tests FAIL: `domMax` is not yet banned, and the static import is allowed.
- The licence tests PASS: the three existing bits files already comply. This is the guard for later tasks.

- [ ] **Step 3: Implement the ESLint boundary**

In `eslint.config.js`, replace the `ANIMATION_BANS` message, `MOTION_COMPONENT_BAN` and `webImports` with the code below. Leave `ALL_BANNED` exactly as it is, and add the comment above it.

```js
const ANIMATION_BANS = {
  group: ["gsap", "gsap/*", "ogl", "framer-motion", "matter-js", "@react-three/*", "@hugeicons/*"],
  message:
    "motion is the animation library and icons come from components/ui/icons.ts (spec §11.3–11.4). D43 allows gsap/ogl/WebGL only when worth it, behind a reviewed import() boundary like layout-features.",
};
```

```js
/** `motion` defeats LazyMotion; `domMax` (layout animation, ~14 kB gz) must stay out of first-load JS (D43). */
const motionImportBan = (importNames) =>
  ["motion/react", "motion/react-client"].map((name) => ({
    name,
    importNames,
    message:
      "Use m.* inside LazyMotion; layout animation (domMax) loads only through <LayoutMotion> (spec §11.4, D43).",
  }));
const MOTION_COMPONENT_BAN = motionImportBan(["motion", "domMax"]);
/** The lazy boundary: layout-features is reached only by import() in components/motion/layout-motion.tsx. */
const LAYOUT_FEATURES_STATIC = {
  regex: "(^|/)layout-features(\\.ts)?$",
  message: "Load layout-features only with import(), inside <LayoutMotion> (D43 lazy boundary).",
};
const webImports = (patterns, paths = MOTION_COMPONENT_BAN) => [
  "error",
  { paths, patterns: [ANIMATION_BANS, LAYOUT_FEATURES_STATIC, ...patterns] },
];
```

```js
// D43: a library leaves this list only together with a lazy import() boundary like
// LAYOUT_FEATURES_STATIC. Nothing in the delight pass needs one.
const ALL_BANNED = ["gsap", "ogl", "framer-motion", "matter-js", "@react-three", "@hugeicons"];
```

Add this block directly after the `files: ["apps/web/**/*.{ts,tsx}"]` block:

```js
  {
    // The one static home of domMax; layout-motion.tsx reaches it only through import().
    files: ["apps/web/components/motion/layout-features.ts"],
    rules: {
      "no-restricted-imports": webImports([THREE_BAN, LUCIDE_BAN], motionImportBan(["motion"])),
    },
  },
```

Run: `pnpm test apps/web/lint/import-bans.test.ts`
Expected: PASS. If ESLint rejects the `regex` key, it is older than the version pinned (10.12). Stop and report; do not fall back to `group` globs, because `ignore` cannot match `./` paths.

- [ ] **Step 4: Write the LayoutMotion boundary**

```ts
// apps/web/components/motion/layout-features.ts
import { domMax } from "motion/react";

/** Layout animation (layout, layoutId). Reached only by import() in layout-motion.tsx (D43). */
export default domMax;
```

```tsx
// apps/web/components/motion/layout-motion.tsx
"use client";

import { LazyMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Turns on `layout` / `layoutId` for the m.* inside it. The root MotionProvider keeps domAnimation
 * (first-load JS); domMax (~14 kB gz) arrives after first paint through this import() — the only
 * way in (eslint.config.js LAYOUT_FEATURES_STATIC). Until it lands, layout changes simply jump.
 */
const loadLayoutFeatures = () =>
  import("./layout-features.ts").then((mod) => {
    // A marker for tests, like data-hotkeys: motion has no load callback.
    document.documentElement.dataset["layoutMotion"] = "ready";
    return mod.default;
  });

export function LayoutMotion({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadLayoutFeatures}>{children}</LazyMotion>;
}
```

- [ ] **Step 5: Write the motion e2e helpers**

```ts
// apps/web/e2e/helpers/motion.ts
import type { Page } from "@playwright/test";

const MOVING = ["transform", "translate", "scale", "rotate"];
type SampleStore = { __samples?: Record<string, string[]> };

/**
 * Animations and transitions (CSS or WAAPI) longer than 1ms, on elements inside `selector`, whose
 * keyframes move something. Under reduced motion this must be [] (motion.css cuts animations to
 * 1ms and transitions to opacity). Motion's rAF springs are not listed; sample those instead.
 */
export async function movingAnimations(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    ({ selector, moving }) => {
      const scopes = [...document.querySelectorAll(selector)];
      return document.getAnimations().flatMap((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target;
        if (!effect || !(target instanceof Element) || !scopes.some((s) => s.contains(target)))
          return [];
        if (Number(effect.getComputedTiming().duration ?? 0) <= 1) return [];
        const moves = effect
          .getKeyframes()
          .some((frame) => moving.some((p) => p in frame && frame[p] !== "none"));
        if (!moves) return [];
        const name =
          (animation as CSSAnimation).animationName ??
          (animation as CSSTransition).transitionProperty ??
          "script";
        return [`${name} on ${target.className}`];
      });
    },
    { selector, moving: MOVING },
  );
}

/** Records getComputedStyle(first match)[property] once per frame, `frames` times, under `key`. */
export async function startSampling(
  page: Page,
  key: string,
  selector: string,
  property: string,
  frames = 45,
): Promise<void> {
  await page.evaluate(
    ({ key, selector, property, frames }) => {
      const store = ((window as SampleStore).__samples ??= {});
      const out: string[] = (store[key] = []);
      const tick = () => {
        const el = document.querySelector(selector);
        out.push(el ? getComputedStyle(el).getPropertyValue(property) : "");
        if (out.length < frames) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { key, selector, property, frames },
  );
}

export async function readSamples(page: Page, key: string, frames = 45): Promise<string[]> {
  await page.waitForFunction(
    ({ key, frames }) => ((window as SampleStore).__samples?.[key]?.length ?? 0) >= frames,
    { key, frames },
  );
  return page.evaluate((key) => (window as SampleStore).__samples?.[key] ?? [], key);
}

/** A computed transform that is not the identity. */
export const moved = (value: string) =>
  value !== "" && value !== "none" && value !== "matrix(1, 0, 0, 1, 0, 0)";
```

- [ ] **Step 6: Write the failing reflow e2e tests**

Append to `apps/web/e2e/daylight.spec.ts`. Add the imports `import { expectCleanScreen } from "./helpers/test.ts";` and `import { moved, readSamples, startSampling } from "./helpers/motion.ts";` (merge with the existing import line).

```ts
test.describe("card reflow (parked: layout animation)", () => {
  async function deleteFirstCardWhileSampling(page: import("@playwright/test").Page) {
    await page.goto("/library");
    await page.locator("html[data-layout-motion=ready]").waitFor({ state: "attached" });
    const cards = page.locator('[data-qa="note-card"]');
    const title = (await cards.first().locator(".card-title").innerText()).trim();
    await cards.first().getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Delete note…" }).click();
    // The second slot is the card that has to move into the freed place.
    await startSampling(page, "reflow", ".card-slot:nth-child(2)", "transform", 40);
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete Note" }).click();
    await expect(cards.filter({ hasText: title })).toBeHidden();
    return readSamples(page, "reflow", 40);
  }

  test("the cards after a deleted one slide into place instead of jumping", async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
    const samples = await deleteFirstCardWhileSampling(page);
    expect(samples.some(moved), samples.join(" | ")).toBe(true);
  });

  test("under reduced motion the cards jump into place", async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const samples = await deleteFirstCardWhileSampling(page);
    expect(samples.filter(moved), samples.join(" | ")).toEqual([]);
  });

  test("the library stays clean once layout motion has loaded", async ({ page }) => {
    await page.goto("/library");
    await page.locator("html[data-layout-motion=ready]").waitFor({ state: "attached" });
    await expectCleanScreen(page);
  });
});
```

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/daylight.spec.ts`
Expected: FAIL. `html[data-layout-motion=ready]` never attaches (timeout), because nothing renders `<LayoutMotion>` yet.

- [ ] **Step 7: Use LayoutMotion in the library grid**

In `apps/web/components/library/library-view.tsx`:
- Import `LayoutMotion` from `@/components/motion/layout-motion.tsx`.
- Replace the final `<div className="notes" data-view={params.view}>…</div>` branch with:

```tsx
          <LayoutMotion>
            <div className="notes" data-view={params.view}>
              {/* A card that leaves fades and settles out; the cards after it glide into place
                  (layout, parked item). popLayout takes the leaver out of flow at once. */}
              <AnimatePresence initial={false} mode="popLayout">
                {items.map((note, i) => (
                  <m.div
                    key={note.id}
                    layout="position"
                    className="card-slot"
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ ...transitions.exit, layout: transitions.spring }}
                  >
                    <NoteCard
                      note={note}
                      view={params.view}
                      index={i}
                      onMove={setMoving}
                      onDelete={setDeleting}
                    />
                  </m.div>
                ))}
              </AnimatePresence>
            </div>
          </LayoutMotion>
```

In `apps/web/styles/library.css`, inside `.notes { … }`, add `position: relative;` as the first declaration, with this comment: `/* popLayout positions a leaving card absolutely against this box. */`

- [ ] **Step 8: Run all the tests and the budget**

Run:
```bash
pnpm test apps/web/lint apps/web/components/bits apps/web/lib/motion-tokens.test.ts apps/web/styles
pnpm --filter @mastertutor/web test:ui -- e2e/daylight.spec.ts e2e/library.spec.ts e2e/move.spec.ts
cd apps/web && pnpm exec next build && node scripts/check-first-load.ts
```
Expected:
- All tests PASS.
- The existing exit-fade test still passes.
- `/library` stays within budget: about +1 kB, because domMax is not in first-load JS.
- If `/library` grew by 10 kB or more, domMax leaked into first-load JS. Find the static import before continuing.

- [ ] **Step 9: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors.

```bash
git add eslint.config.js apps/web/lint/import-bans.test.ts apps/web/lib/motion-tokens.test.ts apps/web/components/motion apps/web/components/bits/bits-licence.test.ts apps/web/e2e/helpers/motion.ts apps/web/e2e/daylight.spec.ts apps/web/components/library/library-view.tsx apps/web/styles/library.css
git commit -m "feat(web): lazy LayoutMotion boundary (domMax off first load) and library card reflow"
```

---

### Task 3: FolderMark: tree rows float on hover and lift their lid on drag-over

**Files:**
- Create: `apps/web/components/library/folder-mark.tsx`
- Test: `apps/web/components/library/folder-mark.test.ts`
- Modify: `apps/web/components/library/folder-tree.tsx` (the row icon)
- Modify: `apps/web/styles/library.css` (`.fmark` and the `.tree-row > .ic` colour rule)
- Test: `apps/web/e2e/folders.spec.ts`

**Interfaces:**
- Consumes: `Icon` and `IconName` from `@/components/ui/icon.tsx`. The icon names `folder`, `folderOpen`, `folderNested`, `allNotes` and `unfiled` already exist.
- Produces: `export function FolderMark({ name, openName = "folderOpen", lift = false }: { name: IconName; openName?: IconName | null; lift?: boolean }): JSX.Element`.
  - It is decorative (`aria-hidden`).
  - `lift` swaps to the open glyph, raised. It is used on drag-over, and in Task 5 for "receiving".
  - Hovering a parent `.tree-row` or `.move-row` floats it, with no motion under reduced motion.
  - With `openName={null}`, the glyph only floats; it has no lid.

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/web/components/library/folder-mark.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FolderMark } from "./folder-mark.tsx";

describe("FolderMark", () => {
  it("is decorative and stacks a closed and an open glyph", () => {
    const html = renderToStaticMarkup(createElement(FolderMark, { name: "folder" }));
    expect(html).toMatch(/^<span class="fmark" aria-hidden="true">/);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain("fmark-shut");
    expect(html).toContain("fmark-open");
    expect(html).not.toContain("data-lift");
  });

  it("marks the lid lifted", () => {
    const html = renderToStaticMarkup(createElement(FolderMark, { name: "folder", lift: true }));
    expect(html).toContain('data-lift=""');
  });

  it("has no lid when there is no open glyph (All notes, Unfiled)", () => {
    const html = renderToStaticMarkup(
      createElement(FolderMark, { name: "unfiled", openName: null }),
    );
    expect(html.match(/<svg/g)).toHaveLength(1);
  });
});
```

Run: `pnpm test apps/web/components/library/folder-mark.test.ts`
Expected: FAIL, the import does not resolve.

- [ ] **Step 2: Write FolderMark and its CSS**

```tsx
// apps/web/components/library/folder-mark.tsx
import { Icon, type IconName } from "@/components/ui/icon.tsx";

/**
 * A folder glyph that floats when its row is hovered and lifts its lid (the closed glyph
 * cross-fades to the open one, raised) while something can drop into it. The motion idea is React
 * Bits' FolderFloat; no code is copied. Transform and opacity only, in library.css (.fmark).
 */
export function FolderMark({
  name,
  openName = "folderOpen",
  lift = false,
}: {
  name: IconName;
  openName?: IconName | null;
  lift?: boolean;
}) {
  return (
    <span className="fmark" aria-hidden="true" data-lift={lift ? "" : undefined}>
      <Icon name={name} size="sm" className="fmark-shut" />
      {openName ? <Icon name={openName} size="sm" className="fmark-open" /> : null}
    </span>
  );
}
```

In `apps/web/styles/library.css`, inside `.tree-row`, change `& > .ic {` to `& > :is(.ic, .fmark) {`. Then add, after the `.tree-row-drop` rule:

```css
  /* Folder glyph: floats on row hover, lifts its lid while it can take a drop (FolderMark). */
  .fmark {
    display: grid;
    flex: none;
    place-items: center;
    & > .ic {
      grid-area: 1 / 1;
      transition-property: opacity;
      transition-duration: var(--motion-dur-micro);
      transition-timing-function: var(--motion-ease-out);
    }
  }
  .fmark-open {
    opacity: 0;
  }
  .fmark[data-lift] {
    & .fmark-shut {
      opacity: 0;
    }
    & .fmark-open {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .fmark {
      transition-property: translate, rotate, scale;
      transition-duration: var(--motion-spring-dur);
      transition-timing-function: var(--motion-spring);
    }
    .fmark[data-lift] {
      translate: 0 -0.125rem;
      scale: 1.15;
    }
    @media (hover: hover) and (pointer: fine) {
      :is(.tree-row, .move-row):hover .fmark:not([data-lift]) {
        translate: 0 -0.0625rem;
        rotate: -8deg;
      }
    }
  }
```

- [ ] **Step 3: Use it in the tree**

In `apps/web/components/library/folder-tree.tsx`:
- Import `FolderMark` from `./folder-mark.tsx`.
- Replace `<Icon name={row.icon} size="sm" />` with:

```tsx
            <FolderMark
              name={row.icon}
              openName={row.node ? "folderOpen" : null}
              lift={dropKey === row.key}
            />
```

`Icon` is still used for the chevron, so keep that import.

Run: `pnpm test apps/web/components/library/folder-mark.test.ts apps/web/styles`
Expected: PASS. `daylight.test.ts` and `press.test.ts` are unaffected.

- [ ] **Step 4: Write the e2e tests**

Append to `apps/web/e2e/folders.spec.ts`. Add `import { movingAnimations } from "./helpers/motion.ts";`.

```ts
test.describe("folder rows float and lift their lid (D43 FolderFloat)", () => {
  test("hovering a folder row floats its glyph", async ({ page }) => {
    test.skip(!isWide(page), "the sidebar tree is hoverable only on wide layouts");
    await page.goto("/library");
    const row = page
      .getByRole("tree", { name: "Folders" })
      .getByRole("treeitem", { name: "Databases" });
    await row.hover();
    await expect(row.locator(".fmark")).toHaveCSS("rotate", "-8deg");
  });

  test("dragging a note over a folder row lifts the lid until the drag leaves", async ({ page }) => {
    test.skip(!isWide(page), "drag targets in the sidebar tree are wide-only");
    await page.goto("/library?folder=00000000-0000-4000-8000-000001000002");
    const card = page.locator('[data-qa="note-card"]').first();
    const row = page
      .getByRole("tree", { name: "Folders" })
      .getByRole("treeitem", { name: "Databases" });
    const mark = row.locator(".fmark");
    await card.hover();
    await page.mouse.down();
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await expect(mark).toHaveAttribute("data-lift", "");
    await expect(mark.locator(".fmark-open")).toHaveCSS("opacity", "1");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 4, { steps: 4 });
    await expect(mark).not.toHaveAttribute("data-lift", "");
    await page.mouse.up();
  });

  test("under reduced motion the lid still lifts but nothing moves", async ({ page }) => {
    test.skip(!isWide(page), "drag targets in the sidebar tree are wide-only");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/library?folder=00000000-0000-4000-8000-000001000002");
    const row = page
      .getByRole("tree", { name: "Folders" })
      .getByRole("treeitem", { name: "Databases" });
    await row.hover();
    await expect(row.locator(".fmark")).toHaveCSS("rotate", "none");
    await page.locator('[data-qa="note-card"]').first().hover();
    await page.mouse.down();
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await expect(row.locator(".fmark")).toHaveAttribute("data-lift", "");
    await expect(row.locator(".fmark")).toHaveCSS("translate", "none");
    expect(await movingAnimations(page, ".tree")).toEqual([]);
    await page.mouse.up();
  });

  test("the tree stays clean with folder marks at every width", async ({ page }) => {
    await page.goto("/library");
    await openTree(page);
    await expectCleanScreen(page);
  });
});
```

- [ ] **Step 5: Run the e2e tests**

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/folders.spec.ts e2e/move.spec.ts e2e/daylight.spec.ts`
Expected: PASS. If the drag tests fail only at the `data-lift` assertion, check that `onDragOver` still calls `setDropKey(row.key)`. Do not loosen the assertion.

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/library/folder-mark.tsx apps/web/components/library/folder-mark.test.ts apps/web/components/library/folder-tree.tsx apps/web/styles/library.css apps/web/e2e/folders.spec.ts
git commit -m "feat(web): folder rows float on hover and lift their lid on drag-over (D43)"
```

---

### Task 4: FolderFloat folder tiles in the library

**Files:**
- Create: `apps/web/components/bits/folder-float.tsx`
- Test: `apps/web/components/bits/folder-float.test.ts`
- Create: `apps/web/components/library/folder-tiles.tsx`
- Modify: `apps/web/lib/folders/drag.ts` (add `acceptsDrop`)
- Test: `apps/web/lib/folders/drag.test.ts`
- Modify: `apps/web/lib/folders/tree.ts` (add `childFolders`)
- Test: `apps/web/lib/folders/tree.test.ts`
- Modify: `apps/web/components/library/folder-tree.tsx` (use `acceptsDrop`)
- Modify: `apps/web/components/library/library-view.tsx` (render the tiles)
- Modify: `apps/web/lib/motion-tokens.ts` (`durations.receive`), then regenerate `apps/web/styles/motion.css`
- Modify: `apps/web/styles/tokens.css` (folder colours, light and dark)
- Modify: `apps/web/styles/tokens.test.ts` (`PAIRS`)
- Modify: `apps/web/styles/library.css` (`.ftiles`, `.ftile`, `.ff*`)
- Modify: `apps/web/styles/components.css` (add `.ftile` to the press rule)
- Modify: `apps/web/styles/press.test.ts` (`PRESS_TARGETS`)
- Test: `apps/web/e2e/folder-tiles.spec.ts`

**Interfaces:**
- Consumes:
  - `getDragged`, `setDragged`, `NOTE_DRAG_TYPE` and `FOLDER_DRAG_TYPE` from `drag.ts`.
  - `canMoveFolder` from `tree.ts`.
  - `useMoveFolder` from `components/library/use-move-folder.ts`.
  - `libraryHref` and `parseLibraryParams` from `lib/library/params.ts`.
- Produces:
  - `export function acceptsDrop(target: string, folders: readonly FolderView[], types: readonly string[]): boolean`. `target` is a folder id, `"all"` or `"unfiled"`.
  - `export function childFolders(folders: readonly FolderView[], parentId: string | null): FolderView[]`, in the tree's order.
  - `export const durations.receive = 450`. CSS reads it as `--motion-dur-receive`.
  - `export function FolderFloat({ label, sublabel, open, receiving }: { label: string; sublabel?: string; open?: boolean; receiving?: boolean }): JSX.Element`.
  - `export function FolderTiles({ folders, parentId, onDropNote }: { folders: FolderView[]; parentId: string | null; onDropNote: (noteId: string, folderId: string) => void }): JSX.Element | null`.

- [ ] **Step 1: Write the failing unit tests**

```ts
// apps/web/lib/folders/drag.test.ts
import type { FolderView } from "@mastertutor/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FOLDER_DRAG_TYPE, NOTE_DRAG_TYPE, acceptsDrop, setDragged } from "./drag.ts";

const f = (id: string, parentId: string | null): FolderView => ({ id, parentId, name: id, sort: 0 });
const folders = [f("a", null), f("b", "a"), f("c", "b"), f("d", null)];

afterEach(() => setDragged(null));

describe("acceptsDrop", () => {
  it("takes a note anywhere except All notes", () => {
    setDragged({ kind: "note", id: "n1" });
    expect(acceptsDrop("d", folders, [NOTE_DRAG_TYPE])).toBe(true);
    expect(acceptsDrop("unfiled", folders, [NOTE_DRAG_TYPE])).toBe(true);
    expect(acceptsDrop("all", folders, [NOTE_DRAG_TYPE])).toBe(false);
  });

  it("refuses a folder dropped into itself, its subtree, its current parent or Unfiled", () => {
    setDragged({ kind: "folder", id: "b" });
    expect(acceptsDrop("b", folders, [FOLDER_DRAG_TYPE])).toBe(false);
    expect(acceptsDrop("c", folders, [FOLDER_DRAG_TYPE])).toBe(false);
    expect(acceptsDrop("a", folders, [FOLDER_DRAG_TYPE])).toBe(false);
    expect(acceptsDrop("unfiled", folders, [FOLDER_DRAG_TYPE])).toBe(false);
    expect(acceptsDrop("d", folders, [FOLDER_DRAG_TYPE])).toBe(true);
    expect(acceptsDrop("all", folders, [FOLDER_DRAG_TYPE])).toBe(true);
  });

  it("refuses drags from outside the app (no matching type) and drags with nothing tracked", () => {
    setDragged({ kind: "note", id: "n1" });
    expect(acceptsDrop("d", folders, ["text/uri-list"])).toBe(false);
    setDragged(null);
    expect(acceptsDrop("d", folders, [NOTE_DRAG_TYPE])).toBe(false);
  });
});
```

Append to `apps/web/lib/folders/tree.test.ts`:

```ts
describe("childFolders", () => {
  const v = (id: string, parentId: string | null, sort: number, name = id): FolderView => ({
    id,
    parentId,
    name,
    sort,
  });
  const all = [v("x", null, 1), v("y", null, 0), v("z", "y", 0), v("w", null, 0, "a-first")];
  it("lists one level, in the tree's order (sort, then name)", () => {
    expect(childFolders(all, null).map((f) => f.id)).toEqual(["w", "y", "x"]);
    expect(childFolders(all, "y").map((f) => f.id)).toEqual(["z"]);
    expect(childFolders(all, "z")).toEqual([]);
  });
});
```

Add `childFolders` and `FolderView` to the existing imports in that file if they are missing.

```ts
// apps/web/components/bits/folder-float.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FolderFloat } from "./folder-float.tsx";

describe("FolderFloat", () => {
  it("keeps the name as real text and hides the drawing", () => {
    const html = renderToStaticMarkup(
      createElement(FolderFloat, { label: "Papers", sublabel: "2 folders" }),
    );
    expect(html).toContain('<span class="ff-label">Papers</span>');
    expect(html).toContain('<span class="ff-sub">2 folders</span>');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(html).not.toContain("data-open");
  });

  it("marks open and receiving states for CSS", () => {
    const html = renderToStaticMarkup(
      createElement(FolderFloat, { label: "Papers", open: true, receiving: true }),
    );
    expect(html).toContain('data-open=""');
    expect(html).toContain('data-receive=""');
    expect(html).not.toContain("ff-sub");
  });
});
```

Run: `pnpm test apps/web/lib/folders apps/web/components/bits/folder-float.test.ts`
Expected: FAIL. `acceptsDrop`, `childFolders` and `./folder-float.tsx` do not exist yet.

- [ ] **Step 2: Implement `acceptsDrop` and `childFolders`, and use `acceptsDrop` in the tree**

Append to `apps/web/lib/folders/drag.ts`, with `import type { FolderView } from "@mastertutor/contracts";` and `import { canMoveFolder } from "./tree.ts";` at the top:

```ts
/**
 * Whether the item being dragged may drop on `target` (a folder id, or the All notes / Unfiled
 * rows). One rule for tree rows and folder tiles; dropping a folder on its own parent is refused
 * because the request would be a no-op.
 */
export function acceptsDrop(
  target: string,
  folders: readonly FolderView[],
  types: readonly string[],
): boolean {
  const dragged = current;
  if (dragged?.kind === "note" && types.includes(NOTE_DRAG_TYPE)) return target !== "all";
  if (dragged?.kind === "folder" && types.includes(FOLDER_DRAG_TYPE)) {
    if (target === "unfiled") return false;
    const parentId = target === "all" ? null : target;
    const moving = folders.find((f) => f.id === dragged.id);
    if (!moving || moving.parentId === parentId) return false;
    return dragged.id !== target && canMoveFolder(folders, dragged.id, parentId);
  }
  return false;
}
```

Add to `apps/web/lib/folders/tree.ts`, after `buildFolderTree`:

```ts
/** One level of the tree under `parentId` (null = top level), in the tree's order. */
export function childFolders(
  folders: readonly FolderView[],
  parentId: string | null,
): FolderView[] {
  return folders.filter((f) => f.parentId === parentId).sort(byOrder);
}
```

In `apps/web/components/library/folder-tree.tsx`, replace the whole body of `accepts` with one line and fix the imports:
- Drop `FOLDER_DRAG_TYPE`, `NOTE_DRAG_TYPE` and `canMoveFolder` if they become unused.
- Import `acceptsDrop`.

```ts
  const accepts = (row: Row, event: DragEvent): boolean =>
    acceptsDrop(row.key, folders, event.dataTransfer.types);
```

Run: `pnpm test apps/web/lib/folders`
Expected: PASS.

- [ ] **Step 3: Add the receive token and the folder colour tokens**

In `apps/web/lib/motion-tokens.ts`, inside `durations`, after `toast: 5000`:

```ts
  /** A folder takes in a dropped or moved item: the lid gulps, the sheet then closes. */
  receive: 450,
```

Run: `pnpm --filter @mastertutor/web motion:css`
Expected: `styles/motion.css` gains `--motion-dur-receive: 450ms;`.

In `apps/web/styles/tokens.css`, add to the light `:root` block, after `--ambient`:

```css
  /* Folder tiles (FolderFloat): a light blue manila, Apple-folder tinted; ink meets AA on the flap. */
  --folder-back: #74aeeb;
  --folder-front: #8fc1f3;
  --folder-front-hi: #a9d0f7;
  --folder-paper: #ffffff;
  --folder-ink: #0b3a6b;
  --folder-ink-2: #1a4470;
  --folder-shadow: 0 -0.625rem 1.5rem rgb(0 0 0 / 0.12);
```

Add to the dark block:

```css
    --folder-back: #1b4a76;
    --folder-front: #245a8c;
    --folder-front-hi: #2f6aa0;
    --folder-paper: #e8e8ed;
    --folder-ink: #f5f5f7;
    --folder-ink-2: #dce6f2;
    --folder-shadow: 0 -0.625rem 1.5rem rgb(0 0 0 / 0.4);
```

In `apps/web/styles/tokens.test.ts`, append to `PAIRS`:

```ts
  ["folder-ink", "folder-front"],
  ["folder-ink-2", "folder-front"],
  ["folder-ink", "folder-front-hi"],
```

Run: `pnpm test apps/web/styles apps/web/lib/motion-tokens.test.ts`
Expected: PASS. The measured contrasts are:

| Pair | Light | Dark |
|---|---|---|
| `folder-ink` on `folder-front` | 6.05 | 6.61 |
| `folder-ink-2` on `folder-front` | 5.27 | 5.71 |
| `folder-ink` on `folder-front-hi` | 7.13 | 5.23 |

- [ ] **Step 4: Write FolderFloat (adapted) and its CSS**

```tsx
// apps/web/components/bits/folder-float.tsx
/*
 * Adapted from React Bits "FolderFloat" (TS-TW).
 * Source:  https://reactbits.dev/r/FolderFloat-TS-TW.json
 * sha256:  bf022a99900cdbe6963fdad3a3d5b722b11f3cd9cf2f5a1eb07a5fdecf8b5fba (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: the folder itself is kept (a tabbed back plate, paper sheets that rise, a front flap
 * that tilts open in 3D on perspective rotateX); the matter-js physics and the floating item pills
 * are removed (flinging pills is not a library task, and matter-js stays banned); the hover/click
 * trigger becomes an `open` prop the owner drives (hover and focus in CSS, drag-over by prop) plus
 * a `receiving` gulp after a drop; colours from tokens (--folder-*), sizes in rem, timing from
 * motion-tokens; the inline <style> keyframes and Tailwind arbitrary values moved to library.css
 * (.ff); only transform, translate, scale and opacity animate; under reduced motion the flap stays
 * at rest and the paper only fades; the label is real text, so the owning link is named by it.
 */
export function FolderFloat({
  label,
  sublabel,
  open = false,
  receiving = false,
}: {
  label: string;
  sublabel?: string;
  open?: boolean;
  receiving?: boolean;
}) {
  return (
    <span
      className="ff"
      data-open={open ? "" : undefined}
      data-receive={receiving ? "" : undefined}
    >
      <span className="ff-body">
        <span className="ff-back" aria-hidden="true" />
        <span className="ff-paper" aria-hidden="true" />
        <span className="ff-paper ff-paper-2" aria-hidden="true" />
        <span className="ff-front">
          <span className="ff-label">{label}</span>
          {sublabel ? <span className="ff-sub">{sublabel}</span> : null}
        </span>
      </span>
    </span>
  );
}
```

Append to `apps/web/styles/library.css` (inside `@layer components`):

```css
  /* Folder tiles: the current folder's subfolders (FolderFloat, D43). */
  .ftiles-title {
    margin: 1.75rem 0 0.75rem;
  }
  .ftiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(8.5rem, 100%), 1fr));
    gap: 1.25rem 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ftile {
    display: block;
    min-width: 0;
    border-radius: var(--r-lg);
    color: var(--folder-ink);
    outline-offset: 0.25rem;
    &:hover {
      text-decoration: none;
    }
  }
  .ff {
    --ff-tab: 0.875rem;
    display: block;
    padding-top: var(--ff-tab);
  }
  .ff-body {
    position: relative;
    display: block;
    aspect-ratio: 200 / 148;
  }
  .ff-back {
    position: absolute;
    inset: 0;
    border-radius: var(--r-lg);
    background: var(--folder-back);
    transform: perspective(37.5rem) rotateX(8deg);
    transform-origin: 50% 100%;
    &::before {
      content: "";
      position: absolute;
      top: calc(-1 * var(--ff-tab));
      left: 0;
      width: 42%;
      height: calc(var(--ff-tab) + var(--r-lg));
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      background: inherit;
    }
  }
  .ff-paper {
    position: absolute;
    top: 10%;
    inset-inline: 8%;
    height: 50%;
    border-radius: var(--r-sm);
    background: var(--folder-paper);
    box-shadow: var(--e1);
    opacity: 0;
    translate: 0 0.625rem;
    transition-property: opacity, translate;
    transition-duration: var(--motion-dur-base), var(--motion-spring-dur);
    transition-timing-function: var(--motion-ease-out), var(--motion-spring);
  }
  .ff-paper-2 {
    top: 16%;
    inset-inline: 14%;
    transition-delay: var(--motion-dur-stagger);
  }
  .ff-front {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 0.2rem;
    height: 76%;
    padding: 0.75rem 0.9rem;
    border-radius: var(--r-lg);
    background: linear-gradient(180deg, var(--folder-front-hi), var(--folder-front) 60%);
    box-shadow: var(--folder-shadow);
    transform: perspective(37.5rem) rotateX(-16deg);
    transform-origin: 50% 100%;
    transition-property: transform;
    transition-duration: var(--motion-spring-dur);
    transition-timing-function: var(--motion-spring);
  }
  .ff-label {
    min-width: 0;
    overflow: hidden;
    font-size: 0.8125rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ff-sub {
    font-size: 0.6875rem;
    color: var(--folder-ink-2);
  }
  /* Open: on hover or keyboard focus of the tile, or while a drop hovers it (data-open). */
  .ftile:focus-visible .ff-paper,
  .ff[data-open] .ff-paper {
    opacity: 1;
    translate: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .ftile:hover .ff-paper {
      opacity: 1;
      translate: none;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .ftile:focus-visible .ff-front,
    .ff[data-open] .ff-front {
      transform: perspective(37.5rem) rotateX(-34deg);
    }
    @media (hover: hover) and (pointer: fine) {
      .ftile:hover .ff-front {
        transform: perspective(37.5rem) rotateX(-34deg);
      }
    }
    .ff[data-receive] .ff-body {
      animation-name: ff-gulp;
      animation-duration: var(--motion-dur-receive);
      animation-timing-function: var(--motion-ease-out);
    }
  }
  @keyframes ff-gulp {
    40% {
      scale: 1.04;
    }
  }
```

In `apps/web/styles/components.css`, add `.ftile` to the four press lists:
- the `:is(.card, …)` list that sets `--press-scale: var(--motion-press-row)`;
- the `:where(…)` transition list;
- the `:is(…):active:not(…)` list;
- the reduced-motion `:is(…):active` list.

In `apps/web/styles/press.test.ts`, add `".ftile"` to the `"--motion-press-row"` array.

Run: `pnpm test apps/web/components/bits apps/web/styles`
Expected: PASS, including `bits-licence.test.ts` for the new file.

- [ ] **Step 5: Write FolderTiles and render it in the library**

```tsx
// apps/web/components/library/folder-tiles.tsx
"use client";

import type { FolderView } from "@mastertutor/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { FolderFloat } from "@/components/bits/folder-float.tsx";
import { acceptsDrop, getDragged, setDragged } from "@/lib/folders/drag.ts";
import { childFolders } from "@/lib/folders/tree.ts";
import { libraryHref, parseLibraryParams } from "@/lib/library/params.ts";
import { durations } from "@/lib/motion-tokens.ts";
import { useMoveFolder } from "./use-move-folder.ts";

const subfolderLabel = (n: number) => (n === 0 ? undefined : `${n} folder${n === 1 ? "" : "s"}`);

/**
 * The current folder's subfolders as tiles. Each is a link (Enter opens it) and a drop target for
 * notes and folders; the non-drag path is "Move to…" (WCAG 2.5.7). The lid lifts while a drop
 * hovers and the folder gulps when it takes one.
 */
export function FolderTiles({
  folders,
  parentId,
  onDropNote,
}: {
  folders: FolderView[];
  parentId: string | null;
  onDropNote: (noteId: string, folderId: string) => void;
}) {
  const params = parseLibraryParams(useSearchParams());
  const moveFolder = useMoveFolder();
  const [dropId, setDropId] = useState<string | null>(null);
  const [receivedId, setReceivedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const tiles = childFolders(folders, parentId);
  if (tiles.length === 0) return null;

  const onDrop = (folderId: string, event: DragEvent) => {
    event.preventDefault();
    setDropId(null);
    // Decide before clearing the dragged item: acceptsDrop reads it.
    const dragged = getDragged();
    const accepted = dragged !== null && acceptsDrop(folderId, folders, event.dataTransfer.types);
    setDragged(null);
    if (!dragged || !accepted) return;
    if (dragged.kind === "note") onDropNote(dragged.id, folderId);
    else void moveFolder(dragged.id, folderId);
    clearTimeout(timer.current);
    setReceivedId(folderId);
    timer.current = setTimeout(() => setReceivedId(null), durations.receive);
  };

  return (
    <section aria-labelledby="ftiles-title">
      <h2 id="ftiles-title" className="eyebrow ftiles-title">
        Folders
      </h2>
      <ul className="ftiles">
        {tiles.map((folder) => (
          <li key={folder.id}>
            <Link
              href={libraryHref({ ...params, folder: folder.id, q: "" })}
              className="ftile"
              data-qa="folder-tile"
              draggable={false}
              onDragOver={(e) => {
                if (!acceptsDrop(folder.id, folders, e.dataTransfer.types)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropId(folder.id);
              }}
              onDragLeave={(e) => {
                // Crossing the tile's own label fires leave/enter pairs; only a real exit counts.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDropId((id) => (id === folder.id ? null : id));
              }}
              onDrop={(e) => onDrop(folder.id, e)}
            >
              <FolderFloat
                label={folder.name}
                sublabel={subfolderLabel(childFolders(folders, folder.id).length)}
                open={dropId === folder.id}
                receiving={receivedId === folder.id}
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

In `apps/web/components/library/library-view.tsx`:
- In `LibraryView`, change `const { params } = useLibraryScope();` to `const { params, folders } = useLibraryScope();`.
- Import `FolderTiles` from `./folder-tiles.tsx`.
- Directly after the closing `</div>` of `.libbar`, add:

```tsx
        {!searching && params.folder !== "unfiled" ? (
          <FolderTiles
            folders={folders}
            parentId={params.folder === "all" ? null : params.folder}
            onDropNote={dropNote}
          />
        ) : null}
```

- [ ] **Step 6: Write the e2e tests**

```ts
// apps/web/e2e/folder-tiles.spec.ts
import type { Page } from "@playwright/test";
import { ids } from "../lib/fixtures/ids.ts";
import { movingAnimations } from "./helpers/motion.ts";
import { expect, expectCleanScreen, isCompact, test } from "./helpers/test.ts";

const ML = `/library?folder=${ids.folder(1)}`;
const tiles = (page: Page) => page.getByRole("region", { name: "Folders" }).locator('[data-qa="folder-tile"]');

test("a folder's subfolders show as tiles that open the folder", async ({ page }) => {
  await page.goto(ML);
  await expect(tiles(page)).toHaveText([/Optimization/, /Papers/]);
  await expect(tiles(page).first()).toContainText("1 folder");
  await expectCleanScreen(page);
  await tiles(page).filter({ hasText: "Papers" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${ids.folder(4)}`));
  await expect(page.getByRole("region", { name: "Folders" })).toHaveCount(0);
});

test("keyboard focus opens the folder visually and Enter navigates", async ({ page }) => {
  await page.goto(ML);
  const tile = tiles(page).filter({ hasText: "Optimization" });
  await tile.focus();
  await expect(tile.locator(".ff-paper").first()).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`folder=${ids.folder(2)}`));
});

async function dragCardOver(page: Page, cardTitle: string, tileName: string) {
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: cardTitle });
  const tile = tiles(page).filter({ hasText: tileName });
  await card.hover();
  await page.mouse.down();
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  return tile;
}

test("dropping a note on a tile moves it and the folder takes it in", async ({ page }) => {
  test.skip(isCompact(page), "card and tile drags are checked on regular widths");
  await page.goto("/library");
  const tile = await dragCardOver(page, "Unfiled clipping", "Databases");
  await expect(tile.locator(".ff")).toHaveAttribute("data-open", "");
  await page.mouse.up();
  await expect(tile.locator(".ff")).toHaveAttribute("data-receive", "");
  await expect(page.getByRole("group").filter({ hasText: "Moved to Databases" })).toBeVisible();
});

test("the lid stays up while the drag crosses the tile's label (Review Focus 1)", async ({
  page,
}) => {
  test.skip(isCompact(page), "card and tile drags are checked on regular widths");
  await page.goto("/library");
  const tile = await dragCardOver(page, "Unfiled clipping", "Databases");
  const label = (await tile.locator(".ff-label").boundingBox())!;
  for (const dx of [0.1, 0.5, 0.9]) {
    await page.mouse.move(label.x + label.width * dx, label.y + label.height / 2, { steps: 3 });
    await expect(tile.locator(".ff")).toHaveAttribute("data-open", "");
  }
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y - 200, { steps: 4 });
  await expect(tile.locator(".ff")).not.toHaveAttribute("data-open", "");
  await page.mouse.up();
});

test("under reduced motion the flap never tilts; the paper only fades", async ({ page }) => {
  test.skip(isCompact(page), "hover is checked on regular widths");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(ML);
  const tile = tiles(page).filter({ hasText: "Optimization" });
  const front = tile.locator(".ff-front");
  const rest = await front.evaluate((el) => getComputedStyle(el).transform);
  await tile.hover();
  await expect(tile.locator(".ff-paper").first()).toHaveCSS("opacity", "1");
  expect(await front.evaluate((el) => getComputedStyle(el).transform)).toBe(rest);
  expect(await movingAnimations(page, ".ftiles")).toEqual([]);
});

test("a 120-character folder name stays inside its tile (Review Focus 4)", async ({ page }) => {
  const name = `Lecture recordings, annotated slides and problem sets ${"x".repeat(66)}`.slice(0, 120);
  await page.goto("/library");
  const created = await page.request.post("/api/rpc/folders/create", {
    data: { json: { name, parentId: null } },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/library");
  const tile = tiles(page).filter({ hasText: name.slice(0, 20) });
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAccessibleName(new RegExp(name.slice(0, 20)));
  await expect(tile.locator(".ff-label")).toHaveCSS("text-overflow", "ellipsis");
  await expectCleanScreen(page);
});
```

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/folder-tiles.spec.ts`
Expected: PASS at all five widths. Compact skips apply only to the drag and hover tests.

- [ ] **Step 7: Run the neighbouring suites and the budget**

Run:
```bash
pnpm --filter @mastertutor/web test:ui -- e2e/library.spec.ts e2e/folders.spec.ts e2e/move.spec.ts e2e/states.spec.ts e2e/layout-qa.spec.ts e2e/search.spec.ts
cd apps/web && pnpm exec next build && node scripts/check-first-load.ts
```
Expected:
- PASS.
- If a neighbouring test now matches two elements (for example `getByText("Databases")` hitting both the tree and a tile), scope that locator to its role or region. Do not remove the tile.
- `/library` stays within budget.

- [ ] **Step 8: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/bits/folder-float.tsx apps/web/components/bits/folder-float.test.ts apps/web/components/library/folder-tiles.tsx apps/web/components/library/folder-tree.tsx apps/web/components/library/library-view.tsx apps/web/lib/folders apps/web/lib/motion-tokens.ts apps/web/styles apps/web/e2e/folder-tiles.spec.ts
git commit -m "feat(web): FolderFloat folder tiles in the library: open on hover, drop to move (D43)"
```

---

### Task 5: The move sheet's destination folder opens to receive the item

**Files:**
- Modify: `apps/web/components/library/folder-pick-list.tsx`
- Modify: `apps/web/components/library/move-sheet.tsx`
- Modify: `apps/web/components/library/folder-move-sheet.tsx`
- Modify: `apps/web/styles/library.css` (`.move-target`, `.move-pill`, `.move-row` position)
- Test: `apps/web/e2e/move.spec.ts`

**Interfaces:**
- Consumes:
  - `FolderMark` (Task 3).
  - `durations.receive` (Task 4).
  - `useReducedMotion` from `motion/react`.
- Produces: a new `FolderPickList` contract:
  - `onPick(folderId: string | null)` fires **immediately** and starts the optimistic move.
  - `onDone()` fires after the receive animation (`durations.receive`). It fires at once under reduced motion or when the pick is the current location.
  - `receiveLabel: string` is the text that flies into the folder.
  - While receiving, every row is `aria-disabled` and further picks are ignored.

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/web/e2e/move.spec.ts`. Add `import { movingAnimations } from "./helpers/motion.ts";`.

```ts
async function openMoveSheet(page: import("@playwright/test").Page, title: RegExp) {
  await page.goto(OPT);
  const card = page.locator('[data-qa="note-card"]').filter({ hasText: title });
  await card.getByRole("button", { name: new RegExp(`Actions for ${title.source}`) }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  return { card, sheet: page.getByRole("dialog", { name: "Move to…" }) };
}

test("the destination folder opens to receive the note, then the sheet closes", async ({
  page,
}) => {
  const { sheet } = await openMoveSheet(page, /Learning-rate warmup/);
  const papers = sheet.getByRole("button", { name: "Papers" });
  await papers.click();
  await expect(papers.locator(".fmark")).toHaveAttribute("data-lift", "");
  await expect(papers.locator(".move-pill")).toHaveText(/Learning-rate warmup/);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("group").filter({ hasText: "Moved to Papers" })).toBeVisible();
});

test("a second pick during the receive animation is ignored (Review Focus 2)", async ({ page }) => {
  let moves = 0;
  await page.route("**/api/rpc/notes/move", async (route) => {
    moves += 1;
    await route.continue();
  });
  const { sheet } = await openMoveSheet(page, /Learning-rate warmup/);
  await sheet.getByRole("button", { name: "Papers" }).click();
  await expect(sheet.getByRole("button", { name: "Databases" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await sheet.getByRole("button", { name: "Databases" }).click({ force: true });
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("group").filter({ hasText: "Moved to Papers" })).toBeVisible();
  expect(moves).toBe(1);
  await expect(page.getByRole("group").filter({ hasText: "Moved to Databases" })).toHaveCount(0);
});

test("under reduced motion the sheet closes at once and nothing flies", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { sheet } = await openMoveSheet(page, /Learning-rate warmup/);
  await page.evaluate(() => {
    const seen = { pill: false };
    (window as { __pill?: typeof seen }).__pill = seen;
    new MutationObserver(() => {
      if (document.querySelector(".move-pill")) seen.pill = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  await sheet.getByRole("button", { name: "Papers" }).click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => (window as { __pill?: { pill: boolean } }).__pill?.pill)).toBe(
    false,
  );
  expect(await movingAnimations(page, "body")).toEqual([]);
});

test("moving a folder plays the same receive moment", async ({ page }) => {
  await page.goto(`/library?folder=00000000-0000-4000-8000-000001000004`);
  await page.getByRole("button", { name: "Folder actions" }).click();
  await page.getByRole("menuitem", { name: /Move folder/ }).click();
  const sheet = page.getByRole("dialog", { name: "Move folder to…" });
  await expectCleanScreen(page);
  const target = sheet.getByRole("button", { name: "Databases" });
  await target.click();
  await expect(target.locator(".move-pill")).toHaveText("Papers");
  await expect(sheet).toBeHidden();
});
```

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/move.spec.ts`
Expected: the new tests FAIL. There is no `.fmark` in the pick list and no `.move-pill`. The double-pick test may also fail on `aria-disabled`.

If the "Move folder…" menu item label differs, take its exact text from `folder-actions.tsx` and use it. Do not change the product copy.

- [ ] **Step 2: Implement the receive in FolderPickList**

Replace `apps/web/components/library/folder-pick-list.tsx` with:

```tsx
"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { IconName } from "@/components/ui/icon.tsx";
import type { FolderNode } from "@/lib/folders/tree.ts";
import { durations } from "@/lib/motion-tokens.ts";
import { FolderMark } from "./folder-mark.tsx";

/**
 * The folder picker both move sheets use: an optional root destination (Unfiled or Top level),
 * then each folder indented by depth. The current location is marked with aria-current.
 * A pick starts the move at once (onPick); the chosen folder lifts its lid and the item flies in,
 * then onDone closes the sheet. Reduced motion, or picking where it already is, skips straight to
 * onDone. While receiving, further picks are ignored (one move, one toast).
 */
export function FolderPickList({
  root,
  folders,
  currentId,
  onPick,
  onDone,
  receiveLabel,
  empty,
}: {
  root?: { label: string; icon: IconName } | null;
  folders: FolderNode[];
  /** The folder the item is in now; null means the root. Undefined marks nothing. */
  currentId?: string | null;
  onPick: (folderId: string | null) => void;
  onDone: () => void;
  /** What flies into the chosen folder: the note title or the folder name. */
  receiveLabel: string;
  empty?: string;
}) {
  const reduce = useReducedMotion();
  const [receiving, setReceiving] = useState<{ id: string | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pick = (id: string | null) => {
    if (receiving) return;
    onPick(id);
    if (reduce || id === currentId) {
      onDone();
      return;
    }
    setReceiving({ id });
    timer.current = setTimeout(onDone, durations.receive);
  };

  const row = (
    id: string | null,
    label: string,
    icon: IconName,
    openIcon: IconName | null,
    indent?: string,
  ) => {
    const here = receiving !== null && receiving.id === id;
    return (
      <button
        type="button"
        className="move-row"
        style={indent ? { paddingInlineStart: indent } : undefined}
        aria-current={currentId === id ? "true" : undefined}
        aria-disabled={receiving ? true : undefined}
        onClick={() => pick(id)}
      >
        <span className="move-target">
          <FolderMark name={icon} openName={openIcon} lift={here} />
          {here ? (
            <span className="move-pill" aria-hidden="true">
              {receiveLabel}
            </span>
          ) : null}
        </span>
        <span>{label}</span>
      </button>
    );
  };

  return (
    <ul className="move-list">
      {root ? <li>{row(null, root.label, root.icon, null)}</li> : null}
      {folders.map((node) => (
        <li key={node.folder.id}>
          {row(
            node.folder.id,
            node.folder.name,
            "folder",
            "folderOpen",
            `${0.75 + (node.depth - 1) * 1}rem`,
          )}
        </li>
      ))}
      {!root && folders.length === 0 && empty ? <li className="move-empty">{empty}</li> : null}
    </ul>
  );
}
```

The accessible name stays the folder name: the pill is `aria-hidden` and FolderMark is `aria-hidden`.

In `apps/web/components/library/move-sheet.tsx`, replace `pick` and the `FolderPickList` usage:

```tsx
  return (
    <Sheet
      open={note !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Move to…"
      description={note ? `Choose a folder for “${note.title}”.` : undefined}
    >
      <FolderPickList
        root={{ label: "Unfiled", icon: "unfiled" }}
        folders={rows}
        currentId={note?.folderId}
        receiveLabel={note?.title ?? ""}
        onPick={(folderId) => {
          if (note) void move(note.id, folderId, note.folderId);
        }}
        onDone={onClose}
      />
    </Sheet>
  );
```

In `apps/web/components/library/folder-move-sheet.tsx`, remove `pick`. Then:

```tsx
      <FolderPickList
        root={topLevel ? { label: "Top level", icon: "library" } : null}
        folders={rows}
        receiveLabel={folder?.name ?? ""}
        onPick={(parentId) => {
          if (folder) void move(folder.id, parentId);
        }}
        onDone={onClose}
        empty="No other folder can hold this one."
      />
```

Append to `apps/web/styles/library.css`:

```css
  /* Move sheet receive: the item flies from the label into the opened folder (Task 5). */
  .move-target {
    position: relative;
    display: grid;
    flex: none;
  }
  .move-pill {
    position: absolute;
    top: 50%;
    inset-inline-start: 0;
    max-width: 10rem;
    overflow: hidden;
    padding: 0.2rem 0.6rem;
    border-radius: var(--r-pill);
    background: var(--elevated);
    box-shadow: var(--e2);
    color: var(--label);
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
    transform-origin: 0 50%;
    animation-name: pill-in;
    animation-duration: var(--motion-dur-receive);
    animation-timing-function: var(--motion-ease-in);
    animation-fill-mode: both;
  }
  @keyframes pill-in {
    from {
      opacity: 0;
      translate: 2.5rem -50%;
    }
    25% {
      opacity: 1;
      translate: 2rem -50%;
    }
    to {
      opacity: 0;
      translate: 0 -50%;
      scale: 0.2;
    }
  }
```

- [ ] **Step 3: Run the tests**

Run:
```bash
pnpm --filter @mastertutor/web test:ui -- e2e/move.spec.ts e2e/folders.spec.ts
pnpm test apps/web/styles apps/web/components
```
Expected: PASS at all widths. The existing first test's `expectCleanScreen` with the sheet open still passes.

- [ ] **Step 4: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/library/folder-pick-list.tsx apps/web/components/library/move-sheet.tsx apps/web/components/library/folder-move-sheet.tsx apps/web/styles/library.css apps/web/e2e/move.spec.ts
git commit -m "feat(web): move sheets: the destination folder opens to receive the item (D43)"
```

---

### Task 6: StatusMark: a run-finish moment on the Runs nav item (shell)

**Files:**
- Create: `apps/web/components/bits/status-mark.tsx`
- Test: `apps/web/components/bits/status-mark.test.ts`
- Create: `apps/web/lib/runs/pulse.ts`
- Test: `apps/web/lib/runs/pulse.test.ts`
- Create: `apps/web/components/shell/use-run-pulse.ts`
- Modify: `apps/web/components/shell/sidebar.tsx`
- Modify: `apps/web/lib/motion-tokens.ts` (`durations.flash`), then regenerate `motion.css`
- Modify: `apps/web/styles/components.css` (`.smark`)
- Modify: `apps/web/styles/shell.css` (remove `.live-dot`; add `.nav-meta .smark` size)
- Test: `apps/web/e2e/shell.spec.ts`

**Interfaces:**
- Consumes:
  - `orpc.runs.list` (input `{ status: "running", limit: 20 }`).
  - `orpc.runs.get` (input `{ runId }`; output `RunDetail`, which has `.status: RunStatus`).
  - `RunStatus` from `@mastertutor/contracts`.
- Produces:
  - `export type StatusMarkStatus = "pending" | "running" | "done" | "failed" | "cancelled"`
  - `export function StatusMark({ status, label, decorative }: { status: StatusMarkStatus; label?: string; decorative?: boolean }): JSX.Element`. It is `role="img"` with a spoken status, or `aria-hidden` when `decorative`.
  - `export type RunFlash = "done" | "failed" | "cancelled"`
  - `export function finishedIds(before: readonly string[], now: readonly string[]): string[]`
  - `export function flashStatus(statuses: readonly RunStatus[]): RunFlash | null`
  - `export type RunPulse = { status: "running"; count: number } | { status: RunFlash; count: 0 } | null`
  - `export function useRunPulse(): RunPulse`
  - `export const durations.flash = 2400`

- [ ] **Step 1: Write the failing unit tests**

```ts
// apps/web/lib/runs/pulse.test.ts
import { describe, expect, it } from "vitest";
import { finishedIds, flashStatus } from "./pulse.ts";

describe("finishedIds", () => {
  it("lists runs that left the running list", () => {
    expect(finishedIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    expect(finishedIds(["a"], ["a", "d"])).toEqual([]);
    expect(finishedIds([], [])).toEqual([]);
  });
});

describe("flashStatus (Review Focus 5)", () => {
  it("flashes the outcome; failure wins, then success, then a stop", () => {
    expect(flashStatus(["completed"])).toBe("done");
    expect(flashStatus(["completed", "failed"])).toBe("failed");
    expect(flashStatus(["cancelled", "completed"])).toBe("done");
    expect(flashStatus(["cancelled"])).toBe("cancelled");
  });
  it("does not flash a run that only paused (waiting, sleeping) or unknown runs", () => {
    expect(flashStatus(["waiting"])).toBeNull();
    expect(flashStatus(["sleeping", "queued"])).toBeNull();
    expect(flashStatus([])).toBeNull();
  });
});
```

```ts
// apps/web/components/bits/status-mark.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusMark } from "./status-mark.tsx";

describe("StatusMark", () => {
  it("speaks its status as an image by default", () => {
    const html = renderToStaticMarkup(createElement(StatusMark, { status: "done" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Completed"');
    expect(html).toContain('data-status="done"');
  });
  it("takes a custom label", () => {
    const html = renderToStaticMarkup(
      createElement(StatusMark, { status: "pending", label: "Signs in on next use" }),
    );
    expect(html).toContain('aria-label="Signs in on next use"');
  });
  it("is hidden when decorative (text beside it says the same)", () => {
    const html = renderToStaticMarkup(
      createElement(StatusMark, { status: "running", decorative: true }),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
  });
});
```

Run: `pnpm test apps/web/lib/runs apps/web/components/bits/status-mark.test.ts`
Expected: FAIL. The modules do not exist.

- [ ] **Step 2: Implement `pulse.ts`, StatusMark and its CSS**

```ts
// apps/web/lib/runs/pulse.ts
import type { RunStatus } from "@mastertutor/contracts";

/** The outcome a finished run flashes on the Runs nav item. */
export type RunFlash = "done" | "failed" | "cancelled";

export const finishedIds = (before: readonly string[], now: readonly string[]): string[] =>
  before.filter((id) => !now.includes(id));

/**
 * The flash for runs that just left the running list. A failure is the one the user must not miss,
 * so it wins; a run that only paused (waiting for approval, sleeping) does not flash.
 */
export function flashStatus(statuses: readonly RunStatus[]): RunFlash | null {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("completed")) return "done";
  if (statuses.includes("cancelled")) return "cancelled";
  return null;
}
```

```tsx
// apps/web/components/bits/status-mark.tsx
/*
 * Adapted from React Bits "StatusMark" (TS-TW).
 * Source:  https://reactbits.dev/r/StatusMark-TS-TW.json
 * sha256:  d0a5e2e19c4134098b56f0ab876fb649187c250e14230811c53eca77fe2d403e (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: CSS-only (no motion runtime). The ring that rewrote stroke-dasharray and
 * stroke-dashoffset every frame is gone: "running" is mockup D's pulsing signal dot (D25 keeps the
 * sidebar's live dot) and "pending" a static dashed ring; the check and cross scale and fade in
 * instead of drawing their stroke; the status changes cross-fade; colours from tokens; the
 * progress, label, strike, size and timing props are removed; a `decorative` mode for marks that
 * sit beside text; reduced motion keeps only the fades (motion.css).
 */
export type StatusMarkStatus = "pending" | "running" | "done" | "failed" | "cancelled";

const SPOKEN: Record<StatusMarkStatus, string> = {
  pending: "Pending",
  running: "In progress",
  done: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
const CHECK = "M7.5 12.25 10.5 15.25 16.75 8.75";
const CROSS = "M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5";

export function StatusMark({
  status,
  label,
  decorative = false,
}: {
  status: StatusMarkStatus;
  label?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className="smark"
      data-status={status}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (label ?? SPOKEN[status])}
      aria-hidden={decorative ? true : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle className="smark-ring" cx="12" cy="12" r="9" />
        <circle className="smark-disc" cx="12" cy="12" r="9" />
        <circle className="smark-dot" cx="12" cy="12" r="4.5" />
        <path className="smark-check" d={CHECK} />
        <path className="smark-cross" d={CROSS} />
      </svg>
    </span>
  );
}
```

Append to `apps/web/styles/components.css` (inside `@layer components`, after `@keyframes pulse`):

```css
  /* StatusMark: one mark, five states; only opacity and scale change (bits/status-mark.tsx). */
  .smark {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: var(--smark-size, 1rem);
    height: var(--smark-size, 1rem);
    color: var(--label-2);
    & svg {
      width: 100%;
      height: 100%;
      overflow: visible;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    & :is(circle, path) {
      transform-box: fill-box;
      transform-origin: center;
      transition-property: opacity, scale;
      transition-duration: var(--motion-dur-base), var(--motion-spring-dur);
      transition-timing-function: var(--motion-ease-out), var(--motion-spring);
    }
  }
  .smark-ring {
    stroke-dasharray: 2.4 3.3;
    opacity: 0.6;
  }
  .smark-disc,
  .smark-dot {
    fill: currentColor;
    stroke: none;
    opacity: 0;
    scale: 0.5;
  }
  .smark-check,
  .smark-cross {
    opacity: 0;
    scale: 0.6;
  }
  .smark:not([data-status="pending"]) .smark-ring {
    opacity: 0;
  }
  .smark[data-status="running"] {
    color: var(--signal);
    & .smark-dot {
      opacity: 1;
      scale: 1;
      animation-name: pulse;
      animation-duration: var(--motion-dur-pulse);
      animation-timing-function: var(--motion-ease-out);
      animation-iteration-count: infinite;
    }
  }
  .smark:is([data-status="done"], [data-status="failed"]) .smark-disc {
    opacity: 0.14;
    scale: 1;
  }
  .smark[data-status="done"] {
    color: var(--ok);
    & .smark-check {
      opacity: 1;
      scale: 1;
      transition-delay: var(--motion-dur-stagger);
    }
  }
  .smark[data-status="failed"] {
    color: var(--danger);
  }
  .smark:is([data-status="failed"], [data-status="cancelled"]) .smark-cross {
    opacity: 1;
    scale: 1;
    transition-delay: var(--motion-dur-stagger);
  }
```

In `apps/web/styles/shell.css`:
- Delete the `.live-dot { … }` rule.
- Add `.nav-meta .smark { --smark-size: 1rem; }` after `.nav-meta`.

In `apps/web/lib/motion-tokens.ts` `durations`, add:

```ts
  /** How long a finished run's outcome shows on the Runs nav item. */
  flash: 2400,
```

Run: `pnpm --filter @mastertutor/web motion:css && pnpm test apps/web/lib/runs apps/web/components/bits apps/web/styles apps/web/lib/motion-tokens.test.ts`
Expected: PASS.

- [ ] **Step 3: Write `useRunPulse` and use it in the sidebar**

```ts
// apps/web/components/shell/use-run-pulse.ts
"use client";

import type { RunStatus } from "@mastertutor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { orpc } from "@/lib/api/client.ts";
import { durations } from "@/lib/motion-tokens.ts";
import { finishedIds, flashStatus, type RunFlash } from "@/lib/runs/pulse.ts";

export type RunPulse = { status: "running"; count: number } | { status: RunFlash; count: 0 } | null;

/**
 * The Runs nav item's badge: the live count while runs are running, then, when runs leave the
 * running list, their outcome for `durations.flash`. It never polls: whatever refreshes the list
 * (a mount, a reconnect, F3's SSE invalidation) drives it. A run whose details cannot be fetched
 * simply does not flash.
 */
export function useRunPulse(): RunPulse {
  const qc = useQueryClient();
  const live = useQuery(orpc.runs.list.queryOptions({ input: { status: "running", limit: 20 } }));
  const ids = useMemo(() => live.data?.items.map((r) => r.id) ?? null, [live.data]);
  const previous = useRef<readonly string[] | null>(null);
  const [flash, setFlash] = useState<RunFlash | null>(null);

  useEffect(() => {
    if (ids === null) return undefined;
    const gone = previous.current ? finishedIds(previous.current, ids) : [];
    previous.current = ids;
    if (gone.length === 0) return undefined;
    let active = true;
    void Promise.all(
      gone.map((runId) =>
        qc.fetchQuery(orpc.runs.get.queryOptions({ input: { runId } })).then(
          (run): RunStatus | null => run.status,
          () => null,
        ),
      ),
    ).then((statuses) => {
      const next = flashStatus(statuses.filter((s): s is RunStatus => s !== null));
      if (active && next) setFlash(next);
    });
    return () => {
      active = false;
    };
  }, [ids, qc]);

  useEffect(() => {
    if (flash === null) return undefined;
    const timer = setTimeout(() => setFlash(null), durations.flash);
    return () => clearTimeout(timer);
  }, [flash]);

  if (ids && ids.length > 0) return { status: "running", count: ids.length };
  return flash ? { status: flash, count: 0 } : null;
}
```

In `apps/web/components/shell/sidebar.tsx`:
- Drop `useQuery` and `orpc` if they become unused.
- Import `StatusMark` from `@/components/bits/status-mark.tsx` and `useRunPulse` from `./use-run-pulse.ts`.
- Replace the `live` and `liveCount` lines with `const pulse = useRunPulse();`.
- Add the module constant `const PULSE_TEXT = { done: "Run finished", failed: "Run failed", cancelled: "Run stopped" } as const;`.
- Replace the `nav-meta` block with:

```tsx
                  {item.href === "/runs" && pulse ? (
                    <span className="nav-meta">
                      <StatusMark status={pulse.status} decorative />
                      <span className="nav-meta-text">
                        {pulse.status === "running"
                          ? `${pulse.count} live`
                          : PULSE_TEXT[pulse.status]}
                      </span>
                    </span>
                  ) : null}
```

- [ ] **Step 4: Write the e2e tests**

Append to `apps/web/e2e/shell.spec.ts`. Add `import { movingAnimations } from "./helpers/motion.ts";`.

```ts
test.describe("Runs badge (StatusMark)", () => {
  const runsLink = (page: import("@playwright/test").Page) =>
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Runs/ });

  test("pulses the live dot while a run is running, at every width", async ({ page }) => {
    await page.goto("/library");
    await expect(runsLink(page).locator('.smark[data-status="running"]')).toBeVisible();
    await expect(runsLink(page)).toContainText("1 live");
    await expectCleanScreen(page);
  });

  async function finishRun(
    page: import("@playwright/test").Page,
    runGet: (route: import("@playwright/test").Route) => Promise<void>,
  ) {
    await page.clock.install({ time: new Date("2026-10-05T17:00:00Z") });
    let lists = 0;
    await page.route("**/api/rpc/runs/list", async (route) => {
      lists += 1;
      if (lists === 1) return route.continue();
      return route.fulfill({ json: { json: { items: [], nextCursor: null } } });
    });
    await page.route("**/api/rpc/runs/get", runGet);
    await page.goto("/library");
    await expect(runsLink(page).locator('.smark[data-status="running"]')).toBeVisible();
    // Past staleTime, then a reconnect: React Query refetches the list (no polling involved).
    await page.clock.fastForward("00:31");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await expect.poll(() => lists).toBe(2);
  }

  test("when the run completes, the dot morphs into a check, then clears", async ({ page }) => {
    await finishRun(page, (route) =>
      route.fulfill({ json: { json: { id: "00000000-0000-4000-8000-000008000001", status: "completed" } } }),
    );
    await expect(runsLink(page).locator('.smark[data-status="done"]')).toBeVisible();
    await expect(runsLink(page)).toContainText("Run finished");
    await page.clock.fastForward(2500);
    await expect(runsLink(page).locator(".nav-meta")).toHaveCount(0);
  });

  test("a finished run that can't be fetched clears the badge quietly (Review Focus 5)", async ({
    page,
  }) => {
    await finishRun(page, (route) =>
      route.fulfill({ status: 404, json: { json: { code: "NOT_FOUND" } } }),
    );
    await expect(runsLink(page).locator(".nav-meta")).toHaveCount(0);
    await expect(page.getByRole("group").filter({ hasText: /Couldn't/ })).toHaveCount(0);
  });

  test("under reduced motion the live dot does not pulse", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/library");
    await expect(runsLink(page).locator('.smark[data-status="running"]')).toBeVisible();
    expect(await movingAnimations(page, ".nav")).toEqual([]);
    expect(
      await runsLink(page)
        .locator(".smark-dot")
        .evaluate((el) => getComputedStyle(el).animationDuration),
    ).toBe("0.001s");
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/shell.spec.ts e2e/runs-links.spec.ts e2e/layout-qa.spec.ts`
Expected: PASS at all widths. At ≤1180 the text is visually hidden (`.nav-meta-text`) but present, so `toContainText` holds.

If `expect.poll(() => lists).toBe(2)` times out, check that `@tanstack/react-query`'s onlineManager listens to `online` and `offline` (v5 does). Do not add polling to the app.

- [ ] **Step 6: Lint, typecheck, budget and commit**

Run:
```bash
pnpm lint && pnpm typecheck && grep -rn "live-dot" apps/web/components apps/web/styles
cd apps/web && pnpm exec next build && node scripts/check-first-load.ts
```
Expected: lint and typecheck are clean, there are no `live-dot` references, and every route is within budget.

```bash
git add apps/web/components/bits/status-mark.tsx apps/web/components/bits/status-mark.test.ts apps/web/lib/runs apps/web/components/shell apps/web/lib/motion-tokens.ts apps/web/styles apps/web/e2e/shell.spec.ts
git commit -m "feat(web): StatusMark run badge: live dot, then the outcome when a run finishes (D43)"
```

---

### Task 7: Vault: the session mark morphs on sign-out

**Files:**
- Modify: `apps/web/components/vault/vault-row.tsx:46-49`
- Modify: `apps/web/styles/vault.css` (remove `.dot` and `.dot-ok` if they become unused)
- Test: `apps/web/e2e/vault.spec.ts`

**Interfaces:**
- Consumes: `StatusMark` (Task 6).
- Produces: nothing new.

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/web/e2e/vault.spec.ts`. Add `import { movingAnimations } from "./helpers/motion.ts";`.

```ts
test("the session mark turns from saved to pending when you sign out", async ({ page }) => {
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await expect(row.locator('.vrow-session .smark[data-status="done"]')).toBeVisible();
  await row.getByRole("button", { name: "Sign out of github" }).click();
  await expect(row.locator('.vrow-session .smark[data-status="pending"]')).toBeVisible();
  await expect(row).toContainText("Signs in on next use");
  await expectCleanScreen(page);
});

test("under reduced motion the session mark only fades", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/vault");
  const row = page.locator(".vrow").filter({ hasText: "github" });
  await row.getByRole("button", { name: "Sign out of github" }).click();
  await expect(row.locator('.smark[data-status="pending"]')).toBeVisible();
  expect(await movingAnimations(page, ".vrow-session")).toEqual([]);
});
```

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/vault.spec.ts`
Expected: the two new tests FAIL, because there is no `.smark` in the row.

- [ ] **Step 2: Implement**

In `apps/web/components/vault/vault-row.tsx`, import `StatusMark` from `@/components/bits/status-mark.tsx` and replace the dot:

```tsx
      <div className="vrow-session">
        <StatusMark status={item.sessionSaved ? "done" : "pending"} decorative />
        <span>{item.sessionSaved ? "Session saved" : "Signs in on next use"}</span>
      </div>
```

Run `grep -rn '"dot\b\|dot-ok\|className="dot' apps/web/components`. If nothing else uses `.dot` or `.dot-ok`, delete both rules from `apps/web/styles/vault.css`.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/vault.spec.ts e2e/vault-forms.spec.ts && pnpm test apps/web/styles`
Expected: PASS at all widths.

- [ ] **Step 4: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/vault/vault-row.tsx apps/web/styles/vault.css apps/web/e2e/vault.spec.ts
git commit -m "feat(web): vault session mark morphs between saved and pending (D43)"
```

---

### Task 8: Search palette: staggered results and a highlight that glides

**Files:**
- Modify: `apps/web/components/library/search-palette.tsx`
- Modify: `apps/web/styles/library.css` (replace `.hit-active::before` and `@keyframes hit-select`; add `.hit-highlight` and `hit-in`)
- Modify: `apps/web/styles/daylight.test.ts:30-32`
- Test: `apps/web/e2e/search.spec.ts`

**Interfaces:**
- Consumes:
  - `LayoutMotion` (Task 2).
  - `transitions.spring`.
  - `startSampling`, `readSamples` and `moved` (Task 2).
- Produces: nothing new. The highlight is `<m.span layoutId="palette-hit" className="hit-highlight" />`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/styles/daylight.test.ts`, add `search-palette.tsx` as a source and replace the palette assertion:

```ts
const palette = readFileSync(
  new URL("../components/library/search-palette.tsx", import.meta.url),
  "utf8",
);
```

```ts
  it("the palette selection is one highlight that glides between rows", () => {
    expect(palette).toMatch(/layoutId="palette-hit"/);
    expect(palette).toMatch(/<LayoutMotion>/);
    expect(library).toMatch(/\.hit-highlight\s*\{/);
    expect(library).not.toMatch(/@keyframes hit-select/);
  });

  it("palette results ease in on a short stagger", () => {
    expect(library).toMatch(/\.palette \.hit[^{]*\{[^}]*animation-name:\s*hit-in/);
    expect(library).toMatch(/@keyframes hit-in/);
  });
```

Append to `apps/web/e2e/search.spec.ts`. Add `import { moved, movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";`.

```ts
async function openPaletteWith(page: import("@playwright/test").Page, query: string) {
  await page.goto("/library");
  await page.locator("html[data-hotkeys=ready]").waitFor({ state: "attached" });
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search notes" });
  await dialog.getByRole("combobox").fill(query);
  await expect(dialog.getByRole("option").nth(1)).toBeVisible();
  await page.locator("html[data-layout-motion=ready]").waitFor({ state: "attached" });
  return dialog;
}

test("the selection highlight glides between results", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
  const dialog = await openPaletteWith(page, "warmup");
  await page.keyboard.press("ArrowDown");
  await expect(dialog.locator(".hit-highlight")).toHaveCount(1);
  await startSampling(page, "glide", ".hit-highlight", "transform", 30);
  await page.keyboard.press("ArrowDown");
  const samples = await readSamples(page, "glide", 30);
  expect(samples.some(moved), samples.join(" | ")).toBe(true);
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
});

test("under reduced motion the highlight jumps and results do not slide", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialog = await openPaletteWith(page, "warmup");
  expect(await movingAnimations(page, ".palette-list")).toEqual([]);
  await page.keyboard.press("ArrowDown");
  await startSampling(page, "jump", ".hit-highlight", "transform", 20);
  await page.keyboard.press("ArrowDown");
  const samples = await readSamples(page, "jump", 20);
  expect(samples.filter(moved), samples.join(" | ")).toEqual([]);
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
});

test("the palette with results stays clean at every width", async ({ page }) => {
  await openPaletteWith(page, "warmup");
  await page.keyboard.press("ArrowDown");
  await expectCleanScreen(page);
});
```

Run: `pnpm test apps/web/styles/daylight.test.ts && pnpm --filter @mastertutor/web test:ui -- e2e/search.spec.ts`
Expected: the new unit assertions FAIL, and the glide test FAILS because there is no `.hit-highlight`.

- [ ] **Step 2: Implement**

In `apps/web/components/library/search-palette.tsx`:
- Import `m` from `motion/react`, `LayoutMotion` from `@/components/motion/layout-motion.tsx`, `transitions` from `@/lib/motion-tokens.ts` and `type CSSProperties` from `react`.
- Wrap the body: `{open ? <LayoutMotion><PaletteBody onDone={() => onOpenChange(false)} /></LayoutMotion> : null}`.
- Render each option like this:

```tsx
            <li
              key={`${hit.noteId}-${hit.blockId ?? "n"}-${i}`}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx("hit", i === active && "hit-active")}
              style={{ "--i": Math.min(i, 8) } as CSSProperties}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {i === active ? (
                // One highlight that glides to the selected row (layoutId), Spotlight-style.
                <m.span
                  layoutId="palette-hit"
                  className="hit-highlight"
                  aria-hidden="true"
                  transition={transitions.spring}
                />
              ) : null}
              <b className="hit-title">{hit.title}</b>
              <span className="hit-snippet">
                <Highlight text={hit.snippet} query={settledQuery} />
              </span>
            </li>
```

In `apps/web/styles/library.css`, delete the `.hit-active::before { … }` rule and `@keyframes hit-select { … }`, and add:

```css
  .hit-highlight {
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: var(--r-sm);
    background: var(--fill-2);
  }
  .palette .hit {
    animation-name: hit-in;
    animation-duration: var(--motion-dur-base);
    animation-timing-function: var(--motion-ease-out);
    animation-fill-mode: both;
    animation-delay: calc(var(--i, 0) * var(--motion-dur-stagger));
  }
  @keyframes hit-in {
    from {
      opacity: 0;
      translate: 0 0.25rem;
    }
  }
```

The existing `.palette .hit { position: relative; isolation: isolate; }` stays. The highlight sits behind the text.

- [ ] **Step 3: Run the tests**

Run: `pnpm test apps/web/styles && pnpm --filter @mastertutor/web test:ui -- e2e/search.spec.ts`
Expected: PASS. The existing "⌘K opens the palette … Enter opens the block" still passes.

- [ ] **Step 4: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/library/search-palette.tsx apps/web/styles/library.css apps/web/styles/daylight.test.ts apps/web/e2e/search.spec.ts
git commit -m "feat(web): ⌘K results stagger in and the selection glides between rows (D43)"
```

---

### Task 9: RollingNumber, plus usage tiles that roll and bars that grow; chart hint and group (parked)

**Files:**
- Create: `apps/web/components/bits/rolling-number.tsx`
- Test: `apps/web/components/bits/rolling-number.test.ts`
- Modify: `apps/web/styles/components.css` (`.rnum`)
- Modify: `apps/web/components/settings/usage-view.tsx` (tiles)
- Modify: `apps/web/components/settings/usage-chart.tsx` (group, hint, keyed bars)
- Modify: `apps/web/styles/settings.css` (`bar-grow`, `.chart-keys`)
- Test: `apps/web/e2e/usage.spec.ts`

**Interfaces:**
- Consumes:
  - `useReducedMotion` from `motion/react`.
  - `cx`.
  - `formatUsd` from `lib/usage/summary.ts`.
- Produces:
  - `export function rollingParts(value: string): Array<{ key: string; digit: number | null; char: string }>`. Keys are aligned from the right, and a key changes when a position changes between digit and non-digit.
  - `export function RollingNumber({ value, className }: { value: string; className?: string }): JSX.Element`.
    - Pass an already formatted string (`"$12.34"`, `"1,234"`, `"4.2%"`, `"–"`).
    - Digits roll on `translate`; other characters are static.
    - The text for assistive technology is always `value`.

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/web/components/bits/rolling-number.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RollingNumber, rollingParts } from "./rolling-number.tsx";

describe("rollingParts (Review Focus 3)", () => {
  it("splits digits from static characters, keyed from the right", () => {
    expect(rollingParts("$9.99")).toEqual([
      { key: "4-$", digit: null, char: "$" },
      { key: "3-d", digit: 9, char: "9" },
      { key: "2-.", digit: null, char: "." },
      { key: "1-d", digit: 9, char: "9" },
      { key: "0-d", digit: 9, char: "9" },
    ]);
  });
  it("keeps the cents columns' keys when the value grows a digit", () => {
    const before = rollingParts("$9.99").map((p) => p.key);
    const after = rollingParts("$10.00").map((p) => p.key);
    expect(after.slice(-3)).toEqual(before.slice(-3));
  });
  it("handles values with no digits and separators", () => {
    expect(rollingParts("–")).toEqual([{ key: "0-–", digit: null, char: "–" }]);
    expect(rollingParts("1,234").filter((p) => p.digit !== null)).toHaveLength(4);
  });
});

describe("RollingNumber", () => {
  it("gives assistive technology the exact value and hides the rolling columns", () => {
    const html = renderToStaticMarkup(createElement(RollingNumber, { value: "4.2%" }));
    expect(html).toContain('<span class="sr-only">4.2%</span>');
    expect(html).toMatch(/class="rnum-track" aria-hidden="true" data-qa-allow-clip=""/);
    expect(html.match(/class="rnum-col"/g)).toHaveLength(2);
    expect(html).toContain('<span class="rnum-char">%</span>');
  });
});
```

Run: `pnpm test apps/web/components/bits/rolling-number.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Implement RollingNumber and its CSS**

```tsx
// apps/web/components/bits/rolling-number.tsx
"use client";
/*
 * Adapted from React Bits "Counter" (TS-TW).
 * Source:  https://reactbits.dev/r/Counter-TS-TW.json
 * sha256:  ff178ab4aa0f591bcd76eb1417ca8941c907154b95283f2db9c138938a90d9a1 (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: takes an already formatted string (currency, separators, %, "–") instead of a
 * number and place values; each digit is a 0–9 strip moved with `translate` by a CSS spring
 * transition (no per-frame JS; Counter ran a useSpring per digit); on mount it rolls up from 0
 * (CountUp's entrance) unless reduced motion is on; the gradient masks, font-size, padding and
 * colour props are removed (tokens and tabular-nums in components.css .rnum); the value is given to
 * assistive technology once, as text, and the columns are aria-hidden.
 */
import { useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import { cx } from "@/lib/cx.ts";

const DIGITS = "0123456789";

export function rollingParts(
  value: string,
): Array<{ key: string; digit: number | null; char: string }> {
  const chars = [...value];
  return chars.map((char, i) => {
    const digit = DIGITS.indexOf(char);
    const fromRight = chars.length - 1 - i;
    return digit >= 0
      ? { key: `${fromRight}-d`, digit, char }
      : { key: `${fromRight}-${char}`, digit: null, char };
  });
}

export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const reduce = useReducedMotion();
  // First frame shows zeros, then the strips roll to the value (the entrance).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const live = mounted || reduce === true;
  return (
    <span className={cx("rnum", className)}>
      <span className="sr-only">{value}</span>
      <span className="rnum-track" aria-hidden="true" data-qa-allow-clip="">
        {rollingParts(value).map((part) =>
          part.digit === null ? (
            <span key={part.key} className="rnum-char">
              {part.char}
            </span>
          ) : (
            <span key={part.key} className="rnum-col">
              <span
                className="rnum-strip"
                style={{ "--d": live ? part.digit : 0 } as CSSProperties}
              >
                {[...DIGITS].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ),
        )}
      </span>
    </span>
  );
}
```

Append to `apps/web/styles/components.css` (inside `@layer components`):

```css
  /* RollingNumber: odometer digits that move on translate only (bits/rolling-number.tsx). */
  .rnum {
    display: inline-flex;
    font-variant-numeric: tabular-nums;
  }
  .rnum-track {
    display: inline-flex;
    height: 1.15em;
    line-height: 1.15em;
  }
  .rnum-col {
    display: inline-block;
    width: 1ch;
    height: 1.15em;
    overflow: hidden;
  }
  .rnum-strip {
    display: flex;
    flex-direction: column;
    translate: 0 calc(var(--d, 0) * -1.15em);
    transition-property: translate;
    transition-duration: var(--motion-spring-soft-dur);
    transition-timing-function: var(--motion-spring-soft);
    & > span {
      height: 1.15em;
      text-align: center;
    }
  }
```

Run: `pnpm test apps/web/components/bits apps/web/styles`
Expected: PASS.

- [ ] **Step 3: Use it in the usage tiles; grow the bars; add the chart hint and group**

In `apps/web/components/settings/usage-view.tsx`, import `RollingNumber` and replace the five `<dd>` contents:

```tsx
              <div className="tile">
                <dt>Spend</dt>
                <dd>
                  <RollingNumber value={formatUsd(totals.usd)} />
                </dd>
              </div>
              <div className="tile">
                <dt>Runs</dt>
                <dd>
                  <RollingNumber value={String(totals.runs)} />
                </dd>
              </div>
              <div className="tile">
                <dt>Steps</dt>
                <dd>
                  <RollingNumber value={String(totals.steps)} />
                </dd>
              </div>
              <div className="tile">
                <dt>Step latency</dt>
                <dd>
                  <RollingNumber value={String(data.stepLatencyMs.p50 ?? "–")} />
                  <small> ms p50 · {data.stepLatencyMs.p95 ?? "–"} p95</small>
                </dd>
              </div>
              <div className="tile">
                <dt>OpenAI errors</dt>
                <dd>
                  <RollingNumber
                    value={
                      data.openaiErrorRate === null
                        ? "–"
                        : `${(data.openaiErrorRate * 100).toFixed(1)}%`
                    }
                  />
                </dd>
              </div>
```

In `apps/web/components/settings/usage-chart.tsx`:
- Update the JSDoc's "Bar heights are static CSS, not animated" to "Bars grow from the baseline (scale) on a left-to-right wave".
- Then change the plot:

```tsx
      <div
        className="chart-plot"
        role="group"
        aria-label="Spend per day"
        aria-describedby="chart-keys"
      >
        <div className="chart-axis" aria-hidden="true">
          <span>{formatUsd(max)}</span>
          <span>{formatUsd(0)}</span>
        </div>
        {/* Keyed by range, so a new range replays the bars' growth. */}
        <ol className="chart-bars" key={`${perDay[0]?.day ?? ""}-${perDay.length}`}>
```

- After the closing `</div>` of `.chart-x`, add:

```tsx
      <p id="chart-keys" className="chart-keys t-foot">
        Use the arrow keys to move between days, and Home or End for the first or last.
      </p>
```

Append to `apps/web/styles/settings.css`:

```css
  .chart-bar {
    transform-origin: 50% 100%;
    animation-name: bar-grow;
    animation-duration: var(--motion-spring-dur);
    animation-timing-function: var(--motion-spring);
    animation-fill-mode: both;
    /* A left-to-right wave that never takes longer than one panel duration, even at 90 days. */
    animation-delay: calc(var(--x, 0) * var(--motion-dur-panel));
  }
  @keyframes bar-grow {
    from {
      scale: 1 0;
    }
  }
  /* The arrow-key hint: always in the accessibility tree (aria-describedby), shown on keyboard focus. */
  .chart-keys {
    margin: 0.35rem 0 0;
    opacity: 0;
    transition-property: opacity;
    transition-duration: var(--motion-dur-micro);
    transition-timing-function: var(--motion-ease-out);
  }
  .chart:has(.chart-bar:focus-visible) .chart-keys {
    opacity: 1;
  }
```

- [ ] **Step 4: Write the e2e tests**

Append to `apps/web/e2e/usage.spec.ts`. Add `import { movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";`.

```ts
test("the chart is a labelled group that tells keyboard users about the arrow keys (parked)", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  const group = page.getByRole("group", { name: "Spend per day" });
  await expect(group).toHaveAccessibleDescription(/arrow keys/);
  const hint = page.locator("#chart-keys");
  await expect(hint).toHaveCSS("opacity", "0");
  await group.locator("[data-qa='bar']").last().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(hint).toHaveCSS("opacity", "1");
  await expectCleanScreen(page);
});

test("tiles roll to their values and bars grow from the baseline", async ({ page }) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await expect(page.locator(".tile .rnum").first()).toBeVisible();
  await startSampling(page, "roll", ".tile .rnum-strip", "translate", 30);
  await page.getByRole("radiogroup", { name: "Range" }).getByRole("radio", { name: "7 days" }).click();
  await expect(page.locator("[data-qa='bar']")).toHaveCount(7);
  await expect(page.locator("[data-qa='bar']").first()).toHaveCSS("animation-name", "bar-grow");
  const rolled = await readSamples(page, "roll", 30);
  expect(new Set(rolled).size, rolled.join(" | ")).toBeGreaterThan(2);
});

test("switching ranges keeps the tiles clean and readable (Review Focus 3)", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  const spend = page.locator(".tile").filter({ hasText: "Spend" }).locator(".sr-only");
  for (const range of ["7 days", "90 days", "30 days"]) {
    await page.getByRole("radiogroup", { name: "Range" }).getByRole("radio", { name: range }).click();
    await expect(spend).toHaveText(/^\$\d[\d,]*\.\d{2}$/);
    await expectCleanScreen(page);
  }
});

test("under reduced motion the numbers and bars do not move", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await page.goto("/settings/usage");
  await expect(page.locator("[data-qa='bar']")).toHaveCount(30);
  await page.getByRole("radiogroup", { name: "Range" }).getByRole("radio", { name: "7 days" }).click();
  expect(await movingAnimations(page, ".slist")).toEqual([]);
  await expect(page.locator(".tile .rnum-strip").first()).toHaveCSS("transition-property", "opacity");
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/usage.spec.ts e2e/settings.spec.ts && pnpm test apps/web/components apps/web/styles`
Expected:
- PASS at all widths.
- If an existing test read a tile's number with `getByText("$…")`, it still finds the `sr-only` span. If it now matches two elements, scope it to `.sr-only`.

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/bits/rolling-number.tsx apps/web/components/bits/rolling-number.test.ts apps/web/components/settings/usage-view.tsx apps/web/components/settings/usage-chart.tsx apps/web/styles apps/web/e2e/usage.spec.ts
git commit -m "feat(web): usage tiles roll (RollingNumber), bars grow; chart group and arrow-key hint (D43, parked)"
```

---

### Task 10: Note reader: the verified count rolls and margin callouts ease in

**Files:**
- Modify: `apps/web/components/note/note-reader.tsx` (header `t-foot`)
- Modify: `apps/web/components/note/margin-callouts.tsx` (`--i` on each callout)
- Modify: `apps/web/styles/note.css` (`callout-in`)
- Test: `apps/web/e2e/verify.spec.ts`
- Test: `apps/web/e2e/provenance.spec.ts`

**Interfaces:**
- Consumes:
  - `RollingNumber` (Task 9).
  - `NoteBlock.verified: boolean` from the contracts.
- Produces: nothing new.

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/web/e2e/verify.spec.ts`. Add `import { movingAnimations, readSamples, startSampling } from "./helpers/motion.ts";`.

```ts
test("the note's verified count rolls up when a block is marked verified", async ({ page }) => {
  await page.goto(NOTE);
  const count = page.locator(".reader-head .rnum .sr-only");
  const before = Number(await count.innerText());
  await expectCleanScreen(page);
  await page.getByRole("checkbox", { name: "Mark verified" }).click();
  await expect(count).toHaveText(String(before + 1));
  await expect(page.locator(".reader-head")).toContainText("verified");
});

test("the verified count moves on a spring, and not at all under reduced motion", async ({
  page,
}) => {
  test.skip(page.viewportSize()?.width !== 1440, "motion sample runs once");
  await page.goto(NOTE);
  await startSampling(page, "count", ".reader-head .rnum-strip", "translate", 30);
  await page.getByRole("checkbox", { name: "Mark verified" }).click();
  const samples = await readSamples(page, "count", 30);
  expect(new Set(samples).size, samples.join(" | ")).toBeGreaterThan(2);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/notes/00000000-0000-4000-8000-000002000002");
  expect(await movingAnimations(page, ".reader-head")).toEqual([]);
});
```

Append to `apps/web/e2e/provenance.spec.ts`. Add `import { movingAnimations } from "./helpers/motion.ts";`.

```ts
test("margin callouts ease in beside their blocks", async ({ page }) => {
  test.skip(!isWide(page), "callouts are wide-only");
  await page.goto(NOTE);
  const first = page.locator('[data-qa="callout"]').first();
  await expect(first).toBeVisible();
  await expect(first).toHaveCSS("animation-name", "callout-in");
});

test("under reduced motion callouts appear without sliding", async ({ page }) => {
  test.skip(!isWide(page), "callouts are wide-only");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(NOTE);
  await expect(page.locator('[data-qa="callout"]').first()).toBeVisible();
  expect(await movingAnimations(page, ".callouts")).toEqual([]);
});
```

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/verify.spec.ts e2e/provenance.spec.ts`
Expected: the new tests FAIL. There is no `.rnum` in the header, and the callout `animation-name` is `none`.

- [ ] **Step 2: Implement**

In `apps/web/components/note/note-reader.tsx`:
- Import `RollingNumber` from `@/components/bits/rolling-number.tsx`.
- Before `return (` in the loaded branch, add `const verifiedCount = data.blocks.filter((b) => b.verified).length;`.
- Change the header foot:

```tsx
            <p className="t-foot">
              {formatDate(data.note.createdAt)} · {data.blocks.length} blocks ·{" "}
              <RollingNumber value={String(verifiedCount)} /> verified · filed by{" "}
              {data.note.filedBy === "agent" ? "the agent" : "you"}
            </p>
```

In `apps/web/components/note/margin-callouts.tsx`:
- Import `type CSSProperties`.
- Change the callouts `map` to take an index: `entries.map(({ block, callout }, i) => {`.
- Change the style:

```tsx
              style={
                {
                  top: p?.top ?? 0,
                  visibility: !p || p.hidden ? "hidden" : "visible",
                  "--i": Math.min(i, 8),
                } as CSSProperties
              }
```

In `apps/web/styles/note.css`, inside `.callout { … }`, add the lines below. Then add the keyframes after the rule. The animation uses `translate`, which is independent of `top` positioning and of the press rule's `scale`.

```css
    /* A hand-annotated reveal (AnimatedContent pattern, rebuilt in CSS; D43). */
    animation-name: callout-in;
    animation-duration: var(--motion-dur-panel);
    animation-timing-function: var(--motion-ease-out);
    animation-fill-mode: both;
    animation-delay: calc(var(--i, 0) * var(--motion-dur-stagger));
```

```css
  @keyframes callout-in {
    from {
      opacity: 0;
      translate: -0.5rem 0;
    }
  }
```

- [ ] **Step 3: Run the tests and the note weight check**

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/verify.spec.ts e2e/provenance.spec.ts e2e/note.spec.ts e2e/note-weight.spec.ts e2e/source-note.spec.ts`
Expected: PASS at all widths.

Then run: `cd apps/web && pnpm exec next build && node scripts/check-first-load.ts`
Expected: `/notes/[noteId]` is within 438.6 + 6 kB.

- [ ] **Step 4: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/note/note-reader.tsx apps/web/components/note/margin-callouts.tsx apps/web/styles/note.css apps/web/e2e/verify.spec.ts apps/web/e2e/provenance.spec.ts
git commit -m "feat(web): note verified count rolls; margin callouts ease in (D43)"
```

---

### Task 11: Settings: a busy switch keeps focus (parked); audit: appended rows stagger in

**Files:**
- Modify: `apps/web/components/ui/switch.tsx` (`busy` prop)
- Modify: `apps/web/components/settings/kill-switch-row.tsx` (`busy={pending}`)
- Modify: `apps/web/components/settings/audit-view.tsx` (mark appended rows)
- Modify: `apps/web/styles/settings.css` (`row-in`)
- Test: `apps/web/e2e/settings.spec.ts`
- Test: `apps/web/e2e/audit.spec.ts`

**Interfaces:**
- Consumes: Base UI `Switch.Root` props `readOnly` and `disabled`. Base UI 1.8 renders a non-native `<span role="switch">`. When `disabled`, it sets `tabIndex=-1` (see `useFocusableWhenDisabled`), which removes the switch from the tab order while a request is in flight.
- Produces: `Switch` gains `busy?: boolean`. A busy switch:
  - stays focusable (`tabIndex` 0);
  - is `aria-disabled="true"` and `aria-busy="true"`;
  - ignores Space, Enter and clicks (`readOnly`).

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/web/e2e/settings.spec.ts`. Add `import { movingAnimations } from "./helpers/motion.ts";` if it is used.

```ts
test("the kill switch keeps keyboard focus and its tab stop while a change is in flight (parked)", async ({
  page,
}) => {
  await page.request.post("/api/rpc/settings/setKillSwitch", { data: { json: { on: true } } });
  let calls = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/rpc/settings/setKillSwitch", async (route) => {
    calls += 1;
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  const sw = page.getByRole("switch", { name: "Kill switch" });
  await sw.focus();
  await page.keyboard.press("Space");
  await expect(sw).toBeFocused();
  await expect(sw).toHaveAttribute("tabindex", "0");
  await expect(sw).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Space");
  expect(calls).toBe(1);
  release();
  await expect(sw).not.toBeChecked();
  await expect(sw).toBeFocused();
  await expect(sw).not.toHaveAttribute("aria-disabled", "true");
});

test("after confirming Stop all runs, focus is back on the busy switch", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/rpc/settings/setKillSwitch", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  const sw = page.getByRole("switch", { name: "Kill switch" });
  await sw.focus();
  await page.keyboard.press("Space");
  await page.getByRole("alertdialog").getByRole("button", { name: "Stop All Runs" }).click();
  await expect(sw).toBeFocused();
  await expect(sw).toHaveAttribute("tabindex", "0");
  release();
  await expect(sw).toBeChecked();
  await expectCleanScreen(page);
});
```

Append to `apps/web/e2e/audit.spec.ts`. Add `import { movingAnimations } from "./helpers/motion.ts";`.

```ts
test("rows added by Load more stagger in; the first page does not", async ({ page }) => {
  await page.goto("/settings/audit");
  const entries = page.locator("[data-qa='audit-entry']");
  await expect(entries).toHaveCount(50);
  await expect(page.locator("[data-qa='audit-entry'][data-appended]")).toHaveCount(0);
  await page.getByRole("button", { name: "Load more" }).click();
  const appended = page.locator("[data-qa='audit-entry'][data-appended]");
  await expect(appended.first()).toBeVisible();
  await expect(appended.first()).toHaveCSS("animation-name", "row-in");
  await expectCleanScreen(page);
});

test("under reduced motion appended audit rows do not slide", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/settings/audit");
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.locator("[data-qa='audit-entry'][data-appended]").first()).toBeVisible();
  expect(await movingAnimations(page, ".slist")).toEqual([]);
});
```

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/settings.spec.ts e2e/audit.spec.ts`
Expected:
- The first kill-switch test FAILS on `tabindex` "0", because Base UI sets -1 when disabled.
- The audit tests FAIL because there is no `data-appended`.

- [ ] **Step 2: Implement the busy switch**

Replace `apps/web/components/ui/switch.tsx` with:

```tsx
"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cx } from "@/lib/cx.ts";

/**
 * `busy` is for a change in flight: the switch keeps its focus and tab stop (Base UI's `disabled`
 * would drop it from the tab order), says it is unavailable and busy, and ignores input (readOnly).
 * `disabled` stays for switches that cannot be used at all.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  tone = "default",
  disabled,
  busy = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <BaseSwitch.Root
      className={cx("switch", tone === "danger" && "switch-danger")}
      checked={checked}
      disabled={disabled}
      readOnly={busy}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      aria-label={label}
      onCheckedChange={(next) => onCheckedChange(next)}
    >
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  );
}
```

In `apps/web/components/settings/kill-switch-row.tsx`, change `disabled={pending}` to `busy={pending}`. The `apply()` early return stays as the backstop.

- [ ] **Step 3: Implement the audit stagger**

In `apps/web/components/settings/audit-view.tsx`, import `type CSSProperties` and replace `entries`:

```tsx
  // Rows from pages after the first are marked, so only what "Load more" added eases in.
  const entries =
    audit.data?.pages.flatMap((p, page) =>
      p.items.map((entry, i) => ({ entry, appended: page > 0, i })),
    ) ?? [];
```

Update both renderings to destructure `({ entry: e, appended, i })` and add to each row (`<tr>` and `<li>`):

```tsx
                    data-appended={appended ? "" : undefined}
                    style={appended ? ({ "--i": Math.min(i, 12) } as CSSProperties) : undefined}
```

Append to `apps/web/styles/settings.css`:

```css
  /* Audit rows "Load more" added ease in on a short stagger; this is a security log, so subtle. */
  [data-qa="audit-entry"][data-appended] {
    animation-name: row-in;
    animation-duration: var(--motion-dur-base);
    animation-timing-function: var(--motion-ease-out);
    animation-fill-mode: both;
    animation-delay: calc(var(--i, 0) * var(--motion-dur-stagger));
  }
  @keyframes row-in {
    from {
      opacity: 0;
      translate: 0 0.25rem;
    }
  }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/settings.spec.ts e2e/audit.spec.ts e2e/shell.spec.ts && pnpm test apps/web/components apps/web/styles`
Expected:
- PASS at all widths.
- The existing test that asserts the switch "is disabled and checked" while the request is held still passes: Playwright's `toBeDisabled` honours `aria-disabled` on `role=switch`.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/ui/switch.tsx apps/web/components/settings/kill-switch-row.tsx apps/web/components/settings/audit-view.tsx apps/web/styles/settings.css apps/web/e2e/settings.spec.ts apps/web/e2e/audit.spec.ts
git commit -m "fix(web): busy kill switch keeps focus and tab stop (parked); audit rows from Load more stagger in"
```

---

### Task 12: Auth: heading words and the card arrive on a spring

**Files:**
- Modify: `apps/web/components/auth/auth-form.tsx` (the heading)
- Modify: `apps/web/styles/shell.css` (`.auth-card` entrance, `.word`)
- Test: `apps/web/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: the `pop-in` keyframes (`components.css`) and the motion tokens.
- Produces: nothing exported. `Words` is local to `auth-form.tsx`, its only user.

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/web/e2e/auth.spec.ts` (the file already has `test.use({ signedOut: true })`). Add `import { movingAnimations } from "./helpers/motion.ts";`.

```ts
test("the heading's words and the card arrive with a spring, and the name is unchanged", async ({
  page,
}) => {
  for (const [path, name] of [
    ["/sign-in", "Sign in"],
    ["/sign-up", "Create account"],
  ] as const) {
    await page.goto(path);
    const heading = page.getByRole("heading", { level: 1, name });
    await expect(heading).toBeVisible();
    await expect(heading.locator(".word")).toHaveCount(2);
    await expect(heading.locator(".word").first()).toHaveCSS("animation-name", "word-in");
    await expect(page.locator(".auth-card")).toHaveCSS("animation-name", "pop-in");
    await expectCleanScreen(page);
  }
});

test("under reduced motion the sign-in screen does not move", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  expect(await movingAnimations(page, ".auth-page")).toEqual([]);
});
```

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/auth.spec.ts`
Expected: the two new tests FAIL, because there are no `.word` spans.

- [ ] **Step 2: Implement**

In `apps/web/components/auth/auth-form.tsx`, import `Fragment` and `type CSSProperties` from `react`, and add above `AuthForm`:

```tsx
/** The heading's words rise in on a short stagger (word-stagger pattern; not SplitText/BlurText). */
function Words({ text }: { text: string }) {
  return text.split(" ").map((word, i) => (
    <Fragment key={i}>
      {i > 0 ? " " : null}
      <span className="word" style={{ "--i": i } as CSSProperties}>
        {word}
      </span>
    </Fragment>
  ));
}
```

Change the heading to:

```tsx
      <h1 className="t-title1">
        <Words text={signUp ? "Create account" : "Sign in"} />
      </h1>
```

In `apps/web/styles/shell.css`, add to `.auth-card { … }`:

```css
    animation-name: pop-in;
    animation-duration: var(--motion-spring-soft-dur);
    animation-timing-function: var(--motion-spring-soft);
    animation-fill-mode: both;
```

Then add, after `.auth-card .t-foot a`:

```css
  .auth-card .word {
    display: inline-block;
    animation-name: word-in;
    animation-duration: var(--motion-spring-dur);
    animation-timing-function: var(--motion-spring);
    animation-fill-mode: both;
    animation-delay: calc(var(--motion-dur-micro) + var(--i, 0) * var(--motion-dur-stagger));
  }
  @keyframes word-in {
    from {
      opacity: 0;
      translate: 0 0.3em;
    }
  }
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @mastertutor/web test:ui -- e2e/auth.spec.ts e2e/session.spec.ts`
Expected: PASS at all widths. The existing `getByRole("heading", { name: "Sign in" })` still matches.

- [ ] **Step 4: Lint, typecheck and commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/web/components/auth/auth-form.tsx apps/web/styles/shell.css apps/web/e2e/auth.spec.ts
git commit -m "feat(web): auth heading words and card arrive on a spring (D43)"
```

---

### Task 13: Whole-pass verification, budget and spec update

**Files:**
- Modify: `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` §11.4 ("Library" bullet 4, the React Bits v1 table, "Avoid")

**Interfaces:**
- Consumes: everything above.
- Produces: the spec text matches what was built. `orchestration/` is left to the orchestrator.

- [ ] **Step 1: Update spec §11.4 to match D43 and this pass**

In §11.4 **Library**, replace the bullet that begins "ESLint `no-restricted-imports` bans" with:

```markdown
- ESLint `no-restricted-imports` bans `gsap`, `ogl`, `framer-motion`, `matter-js` and `@react-three/*`, statically and through `import()`; `three` may be imported only from `components/hero/`. D43 allows gsap or ogl/WebGL only when the delight is worth it and only behind a reviewed `import()` boundary; none is needed today.
- Layout animation (`domMax`, ~14 kB gz) is never in first-load JS: it loads through `<LayoutMotion>` (`components/motion/layout-motion.tsx`), and ESLint bans `domMax` and any static import of `layout-features` elsewhere.
- `pnpm --filter @mastertutor/web check:first-load` holds every route's first-load JS to its committed baseline plus `budgetKb` (6 kB gz).
```

In item 4 of **React Bits: copied, not installed**, append these rows to the table:

```markdown
   | FolderFloat (no physics, no pills) | Library folder tiles: lid lifts on hover, focus and drag-over; gulps on drop | Delight pass |
   | StatusMark (CSS-only) | Runs nav badge: live dot, then the run's outcome; vault session mark | Delight pass |
   | Counter → RollingNumber | Usage tiles, the note's verified count | Delight pass |
```

Below the table, add:

```markdown
   Patterns rebuilt without copying code: FolderMark (tree and move-sheet glyphs float and lift their lid), AnimatedList (card exit plus layout reflow, palette stagger, audit rows), AnimatedContent (callout reveal in CSS) and a heading word stagger.
```

In item 6 (**Avoid**), append:

```markdown
 Left out on purpose: ElasticSlider (typed budgets are faster and exact), HoldButton (nothing to replace) and CountUp (RollingNumber moves on transform instead of rewriting text).
```

- [ ] **Step 2: Run every gate on a clean tree**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @mastertutor/web test:ui
cd apps/web && pnpm exec next build && node scripts/check-prod-bundle.ts && node scripts/check-first-load.ts
```
Expected:
- Lint, typecheck and the unit tests are clean.
- Playwright passes at all five widths. Skips appear only where a test says why.
- `check:bundle` passes.
- `check:first-load` prints each route with its delta and ends `First-load JS within budget (+6 kB gz per route).`

Paste that table into the task report. Do **not** run `--write-baseline`: the 546aedd baseline stays, so the next phase sees this pass's total cost.

- [ ] **Step 3: Self-check the motion rules across the diff**

Run:
```bash
git diff 546aedd --stat -- apps/web
git diff 546aedd -- apps/web/styles apps/web/components | grep -nE "^\+.*(transition-property|@keyframes|animation-name)" 
git diff 546aedd -- apps/web/styles | grep -nE "^\+.*(width|height|top|left|filter|clip-path)\s*:" | grep -iE "transition|keyframes" || true
```
Expected:
- Every added `transition-property` lists only `opacity`, `translate`, `scale`, `rotate` or `transform`.
- Every added `@keyframes` moves only those properties.
- The last command prints nothing.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-05-agentic-notes-design.md
git commit -m "docs(spec): §11.4 records the D43 delight pass, the LayoutMotion boundary and the first-load budget"
```
