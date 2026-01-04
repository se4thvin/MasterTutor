# agent: node-runtime + ffmpeg for remote-PulseAudio capture (spec §8 transcribe).
FROM node-runtime AS agent
USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ffmpeg; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*
USER node
CMD ["node", "apps/agent/src/main.ts"]
```

In `compose.yml`, inside `agent:` and after `<<: *node-runtime`, override:
```yaml
    image: mastertutor/agent:local
    build:
      context: .
      target: agent
```

Run: `docker compose --env-file .env.test -f compose.yml build agent && docker run --rm --entrypoint ffmpeg mastertutor/agent:local -hide_banner -formats 2>/dev/null | grep -E ' pulse|segment' && docker builder prune -f`
Expected: the output lists ` D  pulse` and ` E segment`.

- [ ] **Step 2: Write the fixture generator and the fixture pages.**

`tests/fixtures/sites/youtube/make-video.ts`:
```ts
// Regenerates video.webm (4 distinct 5s slides + 440 Hz tone) and black.webm (DRM stand-in).
// Run: node tests/fixtures/sites/youtube/make-video.ts   (needs the mastertutor/agent:local image)
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const W = 640;
const H = 360;

function ppm(name: string, paint: (x: number, y: number) => [number, number, number]): string {
  const header = Buffer.from(`P6\n${W} ${H}\n255\n`, "ascii");
  const pixels = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels.set(paint(x, y), (y * W + x) * 3);
  const file = join(dir, name);
  writeFileSync(file, Buffer.concat([header, pixels]));
  return name;
}

const slides = [
  ppm("slide-1.ppm", (x) => (Math.floor(x / 80) % 2 ? [30, 90, 200] : [240, 240, 240])),
  ppm("slide-2.ppm", (_x, y) => (Math.floor(y / 45) % 2 ? [200, 60, 40] : [250, 230, 200])),
  ppm("slide-3.ppm", (x, y) => ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [20, 140, 60] : [230, 250, 230])),
  ppm("slide-4.ppm", (x, y) => ((x - W / 2) ** 2 + (y - H / 2) ** 2 < 120 ** 2 ? [240, 180, 0] : [40, 40, 60])),
];

const ffmpeg = (args: string[]) => {
  const result = spawnSync("docker", ["run", "--rm", "-v", `${dir}:/work`, "-w", "/work", "--entrypoint", "ffmpeg", "mastertutor/agent:local", "-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`ffmpeg failed (${result.status})`);
};

ffmpeg([
  ...slides.flatMap((s) => ["-loop", "1", "-t", "5", "-i", s]),
  "-f", "lavfi", "-t", "20", "-i", "sine=frequency=440:sample_rate=48000",
  "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,fps=25,format=yuv420p[v]",
  "-map", "[v]", "-map", "4:a", "-c:v", "libvpx", "-b:v", "300k", "-g", "25", "-c:a", "libopus", "-b:a", "48k", "-shortest", "video.webm",
]);
ffmpeg([
  "-f", "lavfi", "-i", "color=c=black:s=640x360:d=6:r=25", "-f", "lavfi", "-t", "6", "-i", "sine=frequency=440",
  "-c:v", "libvpx", "-b:v", "50k", "-g", "25", "-c:a", "libopus", "-shortest", "black.webm",
]);
for (const s of slides) rmSync(join(dir, s));
```

Run: `node tests/fixtures/sites/youtube/make-video.ts && ls -l tests/fixtures/sites/youtube/*.webm`
Expected: `video.webm` (roughly 100–800 KB) and `black.webm` exist. Commit both binaries.

`tests/fixtures/sites/youtube/api/timedtext` (no extension, JSON3):
```json
{"wireMagic":"pb3","events":[
{"tStartMs":0,"dDurationMs":2500,"segs":[{"utf8":"Welcome to a short tour of photosynthesis."}]},
{"tStartMs":2500,"dDurationMs":2500,"segs":[{"utf8":"Plants turn light into chemical energy."}]},
{"tStartMs":5000,"dDurationMs":2500,"segs":[{"utf8":"First come the light reactions"},{"utf8":" in the thylakoid membranes."}]},
{"tStartMs":7500,"dDurationMs":2500,"segs":[{"utf8":"Water is split and oxygen is released."}]},
{"tStartMs":9000,"aAppend":1,"segs":[{"utf8":"\n"}]},
{"tStartMs":10000,"dDurationMs":2500,"segs":[{"utf8":"Next, the Calvin cycle fixes carbon dioxide."}]},
{"tStartMs":12500,"dDurationMs":2500,"segs":[{"utf8":"It builds sugars using ATP and NADPH."}]},
{"tStartMs":15000,"dDurationMs":2500,"segs":[{"utf8":"In summary, light energy becomes stored sugar."}]},
{"tStartMs":17500,"dDurationMs":2500,"segs":[{"utf8":"Thanks for watching."}]}
]}
```

`tests/fixtures/sites/youtube/player.js`:
```js
(() => {
  const button = document.querySelector(".ytp-subtitles-button");
  const video = document.querySelector("video");
  const box = document.querySelector(".caption-window");
  if (!button || !video) return;
  let events = [];
  button.addEventListener("click", async () => {
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    if (!on) { box.textContent = ""; return; }
    const res = await fetch("api/timedtext?v=fakevid0001&lang=en&fmt=json3", { credentials: "include" });
    events = (await res.json()).events ?? [];
  });
  video.addEventListener("timeupdate", () => {
    if (button.getAttribute("aria-pressed") !== "true") return;
    const ms = video.currentTime * 1000;
    const ev = events.find((e) => e.segs && ms >= e.tStartMs && ms < e.tStartMs + (e.dDurationMs ?? 0));
    box.textContent = ev ? ev.segs.map((s) => s.utf8).join("") : "";
  });
})();
```

`tests/fixtures/sites/youtube/watch.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Photosynthesis in 20 seconds - YouTube</title>
<meta name="description" content="A four-part tour of photosynthesis: intro, light reactions, the Calvin cycle and a summary.">
<link rel="canonical" href="https://www.youtube.com/watch?v=fakevid0001">
<style>
  body{margin:0;font-family:sans-serif}
  #movie_player{position:relative;width:640px;height:360px;margin:16px}
  video{width:640px;height:360px;display:block;background:#000}
  .caption-window{position:absolute;bottom:24px;left:0;right:0;text-align:center;color:#fff;font-size:18px}
  #description{white-space:pre-line;margin:16px}
</style>
<script>var ytInitialData = {"playerOverlays":{"playerOverlayRenderer":{"decoratedPlayerBarRenderer":{"decoratedPlayerBarRenderer":{"playerBar":{"multiMarkersPlayerBarRenderer":{"markersMap":[{"key":"DESCRIPTION_CHAPTERS","value":{"chapters":[
{"chapterRenderer":{"title":{"simpleText":"Intro"},"timeRangeStartMillis":0}},
{"chapterRenderer":{"title":{"simpleText":"Light reactions"},"timeRangeStartMillis":5000}},
{"chapterRenderer":{"title":{"simpleText":"Calvin cycle"},"timeRangeStartMillis":10000}},
{"chapterRenderer":{"title":{"simpleText":"Summary"},"timeRangeStartMillis":15000}}]}}]}}}}}}};</script>
</head>
<body>
<div id="movie_player" class="html5-video-player">
  <video class="html5-main-video" src="video.webm" preload="auto" playsinline></video>
  <div class="caption-window" aria-live="polite"></div>
</div>
<button class="ytp-subtitles-button ytp-button" aria-pressed="false" title="Subtitles/closed captions (c)">CC</button>
<div id="description">Photosynthesis in four short chapters.
0:00 Intro
0:05 Light reactions
0:10 Calvin cycle
0:15 Summary</div>
<script src="player.js"></script>
</body>
</html>
```

`tests/fixtures/sites/youtube/watch-nocc.html`: copy `watch.html`, then remove the `ytInitialData` `<script>`, the CC `<button>` and the `player.js` script tag. Keep the `#description` timestamps (they exercise the description fallback). Change the canonical to `?v=fakevid0002`.

`tests/fixtures/sites/youtube/drm.html`: copy `watch-nocc.html` with `src="black.webm"` and canonical `?v=fakevid0003`.

- [ ] **Step 3: Write the failing tests.**

`apps/agent/src/video/timecode.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatTimecode, parseTimecode } from "./timecode.ts";

describe("timecodes", () => {
  it("formats [mm:ss] and [h:mm:ss]", () => {
    expect(formatTimecode(0)).toBe("[00:00]");
    expect(formatTimecode(65.9)).toBe("[01:05]");
    expect(formatTimecode(3_725)).toBe("[1:02:05]");
  });
  it("parses description timestamps", () => {
    expect(parseTimecode("0:05")).toBe(5);
    expect(parseTimecode("1:02:03")).toBe(3_723);
    expect(parseTimecode("12:3")).toBeNull();
    expect(parseTimecode("abc")).toBeNull();
  });
});
```

`apps/agent/src/video/player.int.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { IsolatedWorld, mainFrameId } from "../capture/cdp-world.ts";
import { type BrowserHarness, startBrowserHarness } from "../testing/browser-harness.ts";
import { pageCaptionsState, pageVideoPause, pageVideoReveal, pageVideoSeek, pageVideoState, pageYoutubeData } from "./page/player.ts";

let harness: BrowserHarness;
let session: BrowserSession;
beforeAll(async () => {
  harness = await startBrowserHarness();
  session = await harness.openSession({ runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", workspaceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302" });
});
afterAll(async () => {
  await harness?.stop();
});

describe("player page functions", () => {
  it("finds, seeks and reads the fake player", async () => {
    await session.page.goto(`${harness.fixturesUrl}/youtube/watch.html`);
    const cdp = await session.cdp();
    const world = await IsolatedWorld.create(cdp, await mainFrameId(cdp), { libraries: false });
    const revealed = await world.call(pageVideoReveal);
    expect(revealed).toMatchObject({ found: true, duration: expect.closeTo(20, 0) });
    expect(await world.call(pageVideoSeek, 7)).toBe(true);
    await world.call(pageVideoPause);
    expect((await world.call(pageVideoState)).currentTime).toBeCloseTo(7, 0);
    expect(await world.call(pageCaptionsState)).toEqual({ present: true, pressed: false, disabled: false });
    const data = await world.call(pageYoutubeData);
    expect(data.initialDataScript).toContain("chapterRenderer");
    expect(data.description).toContain("0:10 Calvin cycle");
  });
});
```

Add to `apps/agent/src/notes/note-writer.int.test.ts`:
```ts
import { timeAnchor } from "./note-writer.ts";

describe("appendTimedBlocks", () => {
  it("interleaves by time with headings before keyframes before text", async () => {
    const scope = await seedRun(h.db);
    const writer = new NoteWriter({ db: h.db, embedder: createEmbedder(fakeEmbeddingsClient(), testLogger) });
    const s1 = new RecordingStep();
    const noteId = await writer.ensureNote(scope, s1, { title: "V", lede: null });
    const sourceId = writer.stageSource(scope, s1, { noteId, kind: "youtube", url: "https://www.youtube.com/watch?v=a", canonicalUrl: null, title: null, faviconAssetId: null, mhtmlKey: null, screenshotKey: null, snapshotSha256: null, meta: {} });
    const t = (type: BlockDraft["type"], markdown: string, at: number) => ({ type, markdown, origin: "captions" as const, assetId: null, verified: true, anchor: timeAnchor(at, at + 1) });
    await writer.appendTimedBlocks(scope, s1, { noteId, sourceId, blocks: [t("transcript", "t0", 0), t("transcript", "t5", 5), t("transcript", "t10", 10)] });
    await s1.commit(h.db, scope.runId);
    const s2 = new RecordingStep();
    await writer.appendTimedBlocks(scope, s2, { noteId, sourceId, blocks: [t("heading", "## Two", 5), t("keyframe", "k6", 6), t("heading", "## One", 0)] });
    await s2.commit(h.db, scope.runId);
    const s3 = new RecordingStep();
    await writer.appendBlocks(scope, s3, { noteId, sourceId: null, afterBlockId: null, blocks: [block("after video")] });
    await s3.commit(h.db, scope.runId);
    const s4 = new RecordingStep();
    await writer.appendTimedBlocks(scope, s4, { noteId, sourceId, blocks: [t("keyframe", "k12", 12)] });
    await s4.commit(h.db, scope.runId);
    const order = await h.db.select({ markdown: noteBlocks.markdown }).from(noteBlocks).where(eq(noteBlocks.noteId, noteId)).orderBy(sql`${noteBlocks.position} collate "C"`);
    expect(order.map((r) => r.markdown)).toEqual(["## One", "t0", "## Two", "t5", "k6", "t10", "k12", "after video"]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video/timecode.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 5: Implement.**

`apps/agent/src/video/timecode.ts`:
```ts
const pad = (n: number) => String(n).padStart(2, "0");

/** spec §8: cite times as [mm:ss] ([h:mm:ss] past one hour). */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return h > 0 ? `[${h}:${pad(m)}:${pad(s)}]` : `[${pad(m)}:${pad(s)}]`;
}

export function parseTimecode(text: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1] ?? 0) * 3_600 + Number(match[2]) * 60 + Number(match[3]);
}
```

`apps/agent/src/video/page/player.ts`:
```ts
/** Isolated-world player helpers (spec §8). Each function must stay self-contained. */
export interface VideoState {
  found: boolean;
  duration: number;
  currentTime: number;
  paused: boolean;
  muted: boolean;
  ended: boolean;
  rect: { x: number; y: number; width: number; height: number } | null;
}

export function pageVideoState(): VideoState {
  const videos = [...document.querySelectorAll("video")].filter((v) => v.getBoundingClientRect().width > 0);
  const video = videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!video) return { found: false, duration: 0, currentTime: 0, paused: true, muted: false, ended: false, rect: null };
  const r = video.getBoundingClientRect();
  const rect = r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  return { found: true, duration: Number.isFinite(video.duration) ? video.duration : 0, currentTime: video.currentTime, paused: video.paused, muted: video.muted, ended: video.ended, rect };
}

export async function pageVideoReveal(): Promise<{ found: boolean; duration: number }> {
  const video = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!video) return { found: false, duration: 0 };
  video.scrollIntoView({ block: "center", behavior: "instant" });
  if (video.readyState < 1) await new Promise((resolve) => { video.addEventListener("loadedmetadata", resolve, { once: true }); setTimeout(resolve, 10_000); });
  return { found: true, duration: Number.isFinite(video.duration) ? video.duration : 0 };
}

export async function pageVideoSeek(t: number): Promise<boolean> {
  const video = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!video) return false;
  const seeked = new Promise<boolean>((resolve) => {
    video.addEventListener("seeked", () => resolve(true), { once: true });
    setTimeout(() => resolve(false), 5_000);
  });
  video.currentTime = t;
  if (!(await seeked)) return false;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return true;
}

export async function pageVideoPlay(): Promise<boolean> {
  const video = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!video) return false;
  video.playbackRate = 1;
  video.muted = false;
  if (video.volume === 0) video.volume = 1;
  try {
    await video.play();
    return true;
  } catch {
    return false;
  }
}

export function pageVideoPause(): void {
  for (const video of document.querySelectorAll("video")) video.pause();
}

export function pageCaptionsState(): { present: boolean; pressed: boolean; disabled: boolean } {
  const button = document.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (!button || button.offsetParent === null) return { present: false, pressed: false, disabled: false };
  return { present: true, pressed: button.getAttribute("aria-pressed") === "true", disabled: button.getAttribute("aria-disabled") === "true" };
}

export function pageCaptionsClick(): boolean {
  const button = document.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (!button) return false;
  button.click();
  return true;
}

export function pageYoutubeData(): { initialDataScript: string | null; description: string | null } {
  const script = [...document.scripts].find((s) => (s.textContent ?? "").includes("ytInitialData"));
  const text = script?.textContent ?? null;
  const description = document.querySelector<HTMLElement>("#description, ytd-text-inline-expander, #description-inline-expander");
  return {
    initialDataScript: text && text.length <= 5_000_000 ? text : null,
    description: description ? description.innerText.slice(0, 20_000) : null,
  };
}
```

In `apps/agent/src/notes/note-writer.ts`, add `TimedBlockDraft`, `timeAnchor` and `appendTimedBlocks`:
```ts
export type TimedBlockDraft = BlockDraft & { anchor: Anchor & { tStart: number } };

export function timeAnchor(tStart: number, tEnd: number): Anchor & { tStart: number } {
  return { selector: null, xpath: null, start: null, end: null, textFragment: null, tStart, tEnd: Math.max(tEnd, tStart) };
}

const TYPE_RANK: Partial<Record<BlockType, number>> = { heading: 0, keyframe: 1 };
const rankOf = (type: BlockType) => TYPE_RANK[type] ?? 2;
const timedKey = (t: number, type: BlockType) => t * 10 + rankOf(type) / 10;
```
Then add this method to the `NoteWriter` class:
```ts
  /** Video layout (spec §8): blocks of one source ordered by (tStart, heading < keyframe < text). */
  async appendTimedBlocks(
    scope: RunScope,
    step: StepWriter,
    options: { noteId: string; sourceId: string; blocks: readonly TimedBlockDraft[]; signal?: AbortSignal },
  ): Promise<string[]> {
    const ordered = await this.db
      .select({ id: noteBlocks.id, position: noteBlocks.position, sourceId: noteBlocks.sourceId, anchor: noteBlocks.anchor, type: noteBlocks.type })
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, options.noteId))
      .orderBy(positionOrder);
    const mine = ordered
      .map((row, index) => ({ ...row, index }))
      .filter((row) => row.sourceId === options.sourceId && typeof row.anchor?.tStart === "number")
      .map((row) => ({ ...row, key: timedKey(row.anchor!.tStart!, row.type) }));
    const incoming = options.blocks
      .map((draft) => ({ draft, key: timedKey(draft.anchor.tStart, draft.type) }))
      .sort((a, b) => a.key - b.key);
    const gapOf = (key: number) => mine.filter((row) => row.key <= key).length;
    const bounds = (gap: number): [string | null, string | null] => {
      if (mine.length === 0) return [ordered.at(-1)?.position ?? null, null];
      const before = gap > 0 ? mine[gap - 1]!.position : (ordered[mine[0]!.index - 1]?.position ?? null);
      const after = gap < mine.length ? mine[gap]!.position : (ordered[mine.at(-1)!.index + 1]?.position ?? null);
      return [before, after];
    };
    const items: { draft: BlockDraft; position: string }[] = [];
    for (let i = 0; i < incoming.length; ) {
      const gap = gapOf(incoming[i]!.key);
      let j = i;
      while (j < incoming.length && gapOf(incoming[j]!.key) === gap) j++;
      const [before, after] = bounds(gap);
      const keys = keysBetween(before, after, j - i);
      incoming.slice(i, j).forEach((item, k) => items.push({ draft: item.draft, position: keys[k]! }));
      i = j;
    }
    return this.stageBlockRows(scope, step, options.noteId, options.sourceId, items, options.signal);
  }
```

`apps/agent/src/video/source.ts`:
```ts
import type { CDPSession } from "playwright-core";
import { IsolatedWorld, mainFrameId } from "../capture/cdp-world.ts";
import type { LibraryServices } from "../library.ts";
import type { ToolContext } from "../tools/types.ts";
import { ToolError } from "../tools/types.ts";
import { pageVideoReveal } from "./page/player.ts";

export interface VideoContext {
  world: IsolatedWorld;
  cdp: CDPSession;
  noteId: string;
  sourceId: string;
  url: string;
  duration: number;
  meta: Record<string, unknown>;
}

/** Shared by every video op: the run's note and one `youtube` source per watched URL. */
export async function openVideoContext(services: LibraryServices, ctx: ToolContext): Promise<VideoContext> {
  const cdp = await ctx.session.cdp();
  const world = await IsolatedWorld.create(cdp, await mainFrameId(cdp), { libraries: false });
  const revealed = await world.call(pageVideoReveal);
  if (!revealed.found) throw new ToolError("no_video", "There is no video on this page");
  const scope = { runId: ctx.runId, workspaceId: ctx.workspaceId };
  const page = ctx.session.page;
  const title = (await page.title()) || page.url();
  const lede = await page.locator('meta[name="description"]').first().getAttribute("content", { timeout: 500 }).catch(() => null);
  const noteId = await services.writer.ensureNote(scope, ctx.step, { title, lede });
  const url = page.url();
  const existing = await services.writer.findSource(scope, noteId, "youtube", url);
  if (existing) return { world, cdp, noteId, sourceId: existing.sourceId, url, duration: revealed.duration, meta: existing.meta };
  const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href", { timeout: 500 }).catch(() => null);
  const sourceId = services.writer.stageSource(scope, ctx.step, {
    noteId, kind: "youtube", url, canonicalUrl: canonical && /^https?:/.test(canonical) ? canonical : null, title,
    faviconAssetId: null, mhtmlKey: null, screenshotKey: null, snapshotSha256: null, meta: { duration: revealed.duration },
  });
  return { world, cdp, noteId, sourceId, url, duration: revealed.duration, meta: {} };
}
```
`page.title()` and `locator(...).getAttribute` read DOM state through Playwright's utility world; they inject nothing into the page and run no page JS. They comply with the "no `evaluate`" rule.

Add the page-function self-containment checks to `apps/agent/src/capture/cdp-world.test.ts` for all of `./video/page/player.ts`'s exports.

- [ ] **Step 6: Run the tests to verify they pass.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video apps/agent/src/capture/cdp-world.test.ts && pnpm exec vitest run --project integration apps/agent/src/video/player.int.test.ts apps/agent/src/notes && pnpm typecheck && pnpm lint && docker builder prune -f`
Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add Dockerfile compose.yml apps/agent tests/fixtures/sites/youtube
git commit -m "feat(video): agent image with ffmpeg, YouTube fixture, player helpers and time-ordered blocks"
```

---

### Task 17: Chapters

**Files:**
- Create: `apps/agent/src/video/chapters.ts`
- Test: `apps/agent/src/video/chapters.test.ts`

**Interfaces:**
- Consumes: Task 16 `parseTimecode`, `pageYoutubeData`, `VideoContext` and `timeAnchor`.
- Produces:
  - `Chapter {title, start}`.
  - `extractInitialData(script): unknown | null`.
  - `chaptersFromInitialData(data): Chapter[]`, which reads `chapterRenderer` and `macroMarkersListItemRenderer`.
  - `chaptersFromDescription(text): Chapter[]`. It requires the first timestamp to be 0:00, at least 3 entries, and strictly increasing times.
  - `readChapters(world): Promise<Chapter[]>`.
  - `chapterBlocks(chapters, existingStarts: Set<number>): TimedBlockDraft[]`, giving `## title` headings with `origin: "dom"`.

- [ ] **Step 1: Write the failing test.**

`apps/agent/src/video/chapters.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { chapterBlocks, chaptersFromDescription, chaptersFromInitialData, extractInitialData } from "./chapters.ts";

describe("chapters", () => {
  it("reads chapterRenderer and macro markers from ytInitialData", () => {
    const script = 'var ytInitialData = {"a":{"chapterRenderer":{"title":{"simpleText":"Intro"},"timeRangeStartMillis":0}},"b":[{"chapterRenderer":{"title":{"simpleText":"Body } with brace"},"timeRangeStartMillis":65000}}],"c":{"macroMarkersListItemRenderer":{"title":{"runs":[{"text":"End"}]},"timeDescription":"2:00"}}};var other = 1;';
    expect(chaptersFromInitialData(extractInitialData(script))).toEqual([
      { title: "Intro", start: 0 },
      { title: "Body } with brace", start: 65 },
      { title: "End", start: 120 },
    ]);
    expect(extractInitialData("var nothing = 1")).toBeNull();
  });
  it("falls back to description timestamps only when they form a chapter list", () => {
    expect(chaptersFromDescription("Intro text\n0:00 Intro\n0:05 Light reactions\n1:02:03 - Late")).toEqual([
      { title: "Intro", start: 0 },
      { title: "Light reactions", start: 5 },
      { title: "Late", start: 3_723 },
    ]);
    expect(chaptersFromDescription("0:10 a\n0:20 b\n0:30 c")).toEqual([]);
    expect(chaptersFromDescription("0:00 a\n0:20 b")).toEqual([]);
  });
  it("makes heading blocks for chapters not yet in the note", () => {
    const blocks = chapterBlocks([{ title: "Intro", start: 0 }, { title: "Next", start: 5 }], new Set([0]));
    expect(blocks).toEqual([expect.objectContaining({ type: "heading", markdown: "## Next", origin: "dom", anchor: expect.objectContaining({ tStart: 5 }) })]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video/chapters.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement.**

`apps/agent/src/video/chapters.ts`:
```ts
import { escapeMarkdownText } from "../capture/markdown-blocks.ts";
import type { IsolatedWorld } from "../capture/cdp-world.ts";
import { timeAnchor, type TimedBlockDraft } from "../notes/note-writer.ts";
import { pageYoutubeData } from "./page/player.ts";
import { parseTimecode } from "./timecode.ts";

export interface Chapter {
  title: string;
  start: number;
}

/** Extracts the JSON object assigned to ytInitialData with a string-aware brace matcher. */
export function extractInitialData(script: string): unknown | null {
  const at = script.search(/ytInitialData\s*=\s*\{/);
  if (at < 0) return null;
  const start = script.indexOf("{", at);
  let depth = 0;
  let inString = false;
  for (let i = start; i < script.length; i++) {
    const char = script[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return JSON.parse(script.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

type Json = Record<string, unknown>;
const textOf = (title: unknown): string => {
  const t = title as { simpleText?: string; runs?: { text?: string }[] } | undefined;
  return (t?.simpleText ?? t?.runs?.map((r) => r.text ?? "").join("") ?? "").trim();
};

function normalize(chapters: Chapter[]): Chapter[] {
  const seen = new Set<number>();
  return chapters
    .filter((c) => c.title && Number.isFinite(c.start) && c.start >= 0)
    .sort((a, b) => a.start - b.start)
    .filter((c) => (seen.has(c.start) ? false : (seen.add(c.start), true)))
    .map((c) => ({ title: c.title.slice(0, 500), start: c.start }));
}

export function chaptersFromInitialData(data: unknown): Chapter[] {
  const found: Chapter[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 64 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, depth + 1));
    const obj = node as Json;
    const chapter = obj.chapterRenderer as Json | undefined;
    if (chapter) found.push({ title: textOf(chapter.title), start: Number(chapter.timeRangeStartMillis) / 1_000 });
    const marker = obj.macroMarkersListItemRenderer as Json | undefined;
    if (marker) {
      const start = (marker.onTap as { watchEndpoint?: { startTimeSeconds?: number } } | undefined)?.watchEndpoint?.startTimeSeconds ?? parseTimecode(String(marker.timeDescription ?? ""));
      if (start !== null && start !== undefined) found.push({ title: textOf(marker.title), start: Number(start) });
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  };
  visit(data, 0);
  return normalize(found);
}

export function chaptersFromDescription(text: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:]?\s+(.+?)\s*$/.exec(line);
    const start = match ? parseTimecode(match[1]!) : null;
    if (match && start !== null) chapters.push({ title: match[2]!, start });
  }
  const increasing = chapters.every((c, i) => i === 0 || c.start > chapters[i - 1]!.start);
  return chapters.length >= 3 && chapters[0]!.start === 0 && increasing ? normalize(chapters) : [];
}

/** spec §8: ytInitialData first, description timestamps as the fallback. */
export async function readChapters(world: IsolatedWorld): Promise<Chapter[]> {
  const data = await world.call(pageYoutubeData);
  const fromData = data.initialDataScript ? chaptersFromInitialData(extractInitialData(data.initialDataScript)) : [];
  return fromData.length > 0 ? fromData : chaptersFromDescription(data.description ?? "");
}

export function chapterBlocks(chapters: readonly Chapter[], existingStarts: ReadonlySet<number>): TimedBlockDraft[] {
  return chapters
    .filter((c) => !existingStarts.has(c.start))
    .map((c, i, all) => ({
      type: "heading",
      markdown: `## ${escapeMarkdownText(c.title)}`,
      origin: "dom",
      assetId: null,
      verified: true,
      anchor: timeAnchor(c.start, all[i + 1]?.start ?? c.start),
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video/chapters.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/agent/src/video
git commit -m "feat(video): chapters from ytInitialData with description fallback"
```

---

### Task 18: Captions via timedtext capture

**Files:**
- Create: `apps/agent/src/video/json3.ts`, `apps/agent/src/video/transcript-blocks.ts`, `apps/agent/src/video/captions.ts`
- Test: `apps/agent/src/video/json3.test.ts`, `apps/agent/src/video/transcript-blocks.test.ts`, `apps/agent/src/video/captions.int.test.ts`

**Interfaces:**
- Consumes: Tasks 16–17 and B1's `BrowserSession.cdp()`.
- Produces:
  - **Parsing:** `CaptionSegment {start, end, text, speaker?}` and `parseJson3(body): CaptionSegment[] | null`.
  - **Transcript blocks:**
    - `groupSegments(segments, boundaries: number[], {maxSeconds = 30, maxChars = 600}?)`, which never crosses a chapter start;
    - `transcriptBlocks(groups, origin: "captions" | "asr", verified): TimedBlockDraft[]`, giving Markdown `[mm:ss] text` (with `**Speaker X:** ` for ASR).
  - **Capture:** `captureTimedtext(cdp, world, {timeoutMs?, signal}): Promise<{body; url; language} | null>`. It toggles CC on through the page's own button and records the player's `/api/timedtext` response with `Network.getResponseBody`.

- [ ] **Step 1: Write the failing tests.**

`apps/agent/src/video/json3.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseJson3 } from "./json3.ts";

describe("parseJson3", () => {
  it("joins segments, skips append newlines and empty events", () => {
    const body = JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Hello" }, { utf8: " world" }] },
      { tStartMs: 1500, aAppend: 1, segs: [{ utf8: "\n" }] },
      { tStartMs: 2000, dDurationMs: 1000 },
      { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "  again\n" }] },
    ] });
    expect(parseJson3(body)).toEqual([{ start: 0, end: 2, text: "Hello world" }, { start: 3, end: 4, text: "again" }]);
  });
  it("returns null for non-JSON3 bodies", () => {
    expect(parseJson3("<transcript/>")).toBeNull();
    expect(parseJson3('{"x":1}')).toBeNull();
  });
});
```

`apps/agent/src/video/transcript-blocks.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupSegments, transcriptBlocks } from "./transcript-blocks.ts";

const seg = (start: number, text: string, speaker?: string) => ({ start, end: start + 2.5, text, ...(speaker ? { speaker } : {}) });

describe("groupSegments", () => {
  it("breaks at chapter starts, duration, size and speaker", () => {
    const groups = groupSegments([seg(0, "a."), seg(2.5, "b."), seg(5, "c."), seg(7.5, "d.", "B")], [0, 5]);
    expect(groups.map((g) => [g.start, g.text])).toEqual([[0, "a. b."], [5, "c."], [7.5, "d."]]);
    expect(groupSegments(Array.from({ length: 20 }, (_, i) => seg(i * 2.5, "x")), []).length).toBeGreaterThan(1);
  });
  it("renders timecoded Markdown with speakers for ASR", () => {
    const [caption] = transcriptBlocks([{ start: 65, end: 70, text: "Hi *there*" }], "captions", true);
    expect(caption).toMatchObject({ type: "transcript", markdown: "[01:05] Hi \\*there\\*", origin: "captions", verified: true, anchor: { tStart: 65, tEnd: 70 } });
    const [asr] = transcriptBlocks([{ start: 0, end: 1, text: "Yes", speaker: "A" }], "asr", false);
    expect(asr?.markdown).toBe("[00:00] **Speaker A:** Yes");
  });
});
```

`apps/agent/src/video/captions.int.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { IsolatedWorld, mainFrameId } from "../capture/cdp-world.ts";
import { type BrowserHarness, startBrowserHarness } from "../testing/browser-harness.ts";
import { captureTimedtext } from "./captions.ts";
import { parseJson3 } from "./json3.ts";

let harness: BrowserHarness;
let session: BrowserSession;
beforeAll(async () => {
  harness = await startBrowserHarness();
  session = await harness.openSession({ runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", workspaceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302" });
});
afterAll(async () => {
  await harness?.stop();
});

async function worldFor(path: string) {
  await session.page.goto(`${harness.fixturesUrl}/youtube/${path}`);
  const cdp = await session.cdp();
  return { cdp, world: await IsolatedWorld.create(cdp, await mainFrameId(cdp), { libraries: false }) };
}

describe("captureTimedtext", () => {
  it("records the player's own caption response", async () => {
    const { cdp, world } = await worldFor("watch.html");
    const captured = await captureTimedtext(cdp, world, { signal: new AbortController().signal });
    expect(captured?.language).toBe("en");
    expect(parseJson3(captured!.body)).toHaveLength(8);
    const again = await captureTimedtext(cdp, world, { signal: new AbortController().signal });
    expect(again?.body).toBe(captured?.body);
  });
  it("returns null when the player has no captions", async () => {
    const { cdp, world } = await worldFor("watch-nocc.html");
    expect(await captureTimedtext(cdp, world, { signal: new AbortController().signal })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video/json3.test.ts apps/agent/src/video/transcript-blocks.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement.**

`apps/agent/src/video/json3.ts`:
```ts
import { z } from "zod";

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

const Json3 = z.object({
  events: z.array(
    z.object({
      tStartMs: z.number().nonnegative().default(0),
      dDurationMs: z.number().nonnegative().default(0),
      segs: z.array(z.object({ utf8: z.string().default("") })).optional(),
    }),
  ),
});

/** YouTube `fmt=json3` caption tracks (spec §8). Null when the body is not JSON3. */
export function parseJson3(body: string): CaptionSegment[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = Json3.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.events.flatMap((event) => {
    const text = (event.segs ?? []).map((s) => s.utf8).join("").replace(/\s+/g, " ").trim();
    if (!text) return [];
    return [{ start: event.tStartMs / 1_000, end: (event.tStartMs + event.dDurationMs) / 1_000, text }];
  });
}
```

`apps/agent/src/video/transcript-blocks.ts`:
```ts
import { escapeMarkdownText } from "../capture/markdown-blocks.ts";
import { timeAnchor, type TimedBlockDraft } from "../notes/note-writer.ts";
import type { CaptionSegment } from "./json3.ts";
import { formatTimecode } from "./timecode.ts";

/** Merges consecutive segments into readable paragraphs without crossing a chapter start or a speaker change. */
export function groupSegments(
  segments: readonly CaptionSegment[],
  boundaries: readonly number[],
  limits: { maxSeconds?: number; maxChars?: number } = {},
): CaptionSegment[] {
  const maxSeconds = limits.maxSeconds ?? 30;
  const maxChars = limits.maxChars ?? 600;
  const groups: CaptionSegment[] = [];
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const last = groups.at(-1);
    const crossesChapter = last ? boundaries.some((b) => b > last.start && b <= segment.start) : false;
    const tooLong = last ? segment.end - last.start > maxSeconds || last.text.length + segment.text.length > maxChars : false;
    if (!last || crossesChapter || tooLong || last.speaker !== segment.speaker) {
      groups.push({ ...segment });
    } else {
      last.text = `${last.text} ${segment.text}`;
      last.end = Math.max(last.end, segment.end);
    }
  }
  return groups;
}

export function transcriptBlocks(groups: readonly CaptionSegment[], origin: "captions" | "asr", verified: boolean): TimedBlockDraft[] {
  return groups.map((group) => ({
    type: "transcript",
    markdown: `${formatTimecode(group.start)} ${group.speaker ? `**Speaker ${escapeMarkdownText(group.speaker)}:** ` : ""}${escapeMarkdownText(group.text)}`,
    origin,
    assetId: null,
    verified,
    anchor: timeAnchor(group.start, group.end),
  }));
}
```

`apps/agent/src/video/captions.ts`:
```ts
import type { CDPSession } from "playwright-core";
import type { IsolatedWorld } from "../capture/cdp-world.ts";
import { pageCaptionsClick, pageCaptionsState } from "./page/player.ts";

const TIMEDTEXT_PATH = /\/api\/timedtext(\/|$)/;

/** Turns CC on via the page's own button and records the player's timedtext response (spec §8). */
export async function captureTimedtext(
  cdp: CDPSession,
  world: IsolatedWorld,
  options: { timeoutMs?: number; signal: AbortSignal },
): Promise<{ body: string; url: string; language: string | null } | null> {
  const state = await world.call(pageCaptionsState);
  if (!state.present || state.disabled) return null;
  await cdp.send("Network.enable");
  const tracked = new Map<string, string>();
  const response = new Promise<{ requestId: string; url: string } | null>((resolve) => {
    const timer = setTimeout(() => finish(null), options.timeoutMs ?? 10_000);
    const onResponse = (event: { requestId: string; response: { url: string; status: number } }) => {
      try {
        if (event.response.status === 200 && TIMEDTEXT_PATH.test(new URL(event.response.url).pathname)) tracked.set(event.requestId, event.response.url);
      } catch {
        // ignore unparsable URLs
      }
    };
    const onFinished = (event: { requestId: string }) => {
      const url = tracked.get(event.requestId);
      if (url) finish({ requestId: event.requestId, url });
    };
    const onAbort = () => finish(null);
    function finish(value: { requestId: string; url: string } | null) {
      clearTimeout(timer);
      cdp.off("Network.responseReceived", onResponse);
      cdp.off("Network.loadingFinished", onFinished);
      options.signal.removeEventListener("abort", onAbort);
      resolve(value);
    }
    cdp.on("Network.responseReceived", onResponse);
    cdp.on("Network.loadingFinished", onFinished);
    options.signal.addEventListener("abort", onAbort, { once: true });
  });
  if (state.pressed) await world.call(pageCaptionsClick);
  await world.call(pageCaptionsClick);
  const hit = await response;
  options.signal.throwIfAborted();
  if (!hit) return null;
  const { body, base64Encoded } = await cdp.send("Network.getResponseBody", { requestId: hit.requestId });
  const text = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  const params = new URL(hit.url).searchParams;
  return { body: text, url: hit.url, language: params.get("tlang") ?? params.get("lang") };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video && pnpm exec vitest run --project integration apps/agent/src/video/captions.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/agent/src/video
git commit -m "feat(video): timedtext caption capture, JSON3 parsing and chapter-aware transcript blocks"
```

---

### Task 19: Keyframes with pHash computed in `sharp`

**Files:**
- Create: `apps/agent/src/video/phash.ts`, `apps/agent/src/video/keyframes.ts`
- Test: `apps/agent/src/video/phash.test.ts`, `apps/agent/src/video/keyframes.test.ts`, `apps/agent/src/video/keyframes.int.test.ts`

**Interfaces:**
- Consumes: Task 16 (player page functions, `pageCaptionsState`/`pageCaptionsClick`) and B1's `captureScreenshot`.
- Produces:
  - `pHash(png): Promise<bigint>` (a 64-bit DCT hash), `hamming(a, b): number` and `meanLuminance(png): Promise<number>` (0–1).
  - `KEYFRAME_INTERVAL_S = 2`, `PHASH_DUPLICATE_DISTANCE = 6`, `DRM_LUMINANCE = 0.03`, `DRM_PROBE_FRAMES = 5`.
  - `KeyframeSampler`, a pure state machine: `push({t, hash, png})` and `finish(): Keyframe[]`. It keeps the last frame before each change.
  - `Keyframe {t, segmentStart, png}`.
  - `sampleKeyframes(session, world, range: {start; end}, signal): Promise<{frames: Keyframe[]; dropped; drm}>`. It turns CC off during sampling and restores both CC and the playback position afterwards.

- [ ] **Step 1: Write the failing tests.**

`apps/agent/src/video/phash.test.ts`:
```ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hamming, meanLuminance, pHash } from "./phash.ts";

const stripes = (vertical: boolean, shift = 0) =>
  sharp(Buffer.from(Array.from({ length: 64 * 64 }, (_, i) => {
    const x = i % 64;
    const y = Math.floor(i / 64);
    return Math.floor(((vertical ? x : y) + shift) / 8) % 2 ? 255 : 0;
  })), { raw: { width: 64, height: 64, channels: 1 } }).png().toBuffer();

describe("pHash", () => {
  it("is stable for near-identical frames and far for different ones", async () => {
    const a = await pHash(new Uint8Array(await stripes(true)));
    const aJpeg = await pHash(new Uint8Array(await sharp(await stripes(true)).jpeg({ quality: 60 }).toBuffer()));
    const b = await pHash(new Uint8Array(await stripes(false)));
    expect(hamming(a, aJpeg)).toBeLessThanOrEqual(6);
    expect(hamming(a, b)).toBeGreaterThan(6);
  });
  it("measures luminance", async () => {
    const black = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer();
    const white = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
    expect(await meanLuminance(new Uint8Array(black))).toBeLessThan(0.03);
    expect(await meanLuminance(new Uint8Array(white))).toBeGreaterThan(0.9);
  });
});
```

`apps/agent/src/video/keyframes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { KeyframeSampler } from "./keyframes.ts";

const png = (n: number) => new Uint8Array([n]);

describe("KeyframeSampler", () => {
  it("keeps the last frame before each change, measured against the segment's first frame", () => {
    const s = new KeyframeSampler(6);
    const hashes = [0n, 1n, 3n, 0xffffn, 0xfffen, 0xff00ff00n];
    hashes.forEach((hash, i) => s.push({ t: i * 2, hash, png: png(i) }));
    const frames = s.finish();
    expect(frames.map((f) => [f.segmentStart, f.t])).toEqual([[0, 4], [6, 8], [10, 10]]);
    expect(s.dropped).toBe(3);
  });
});
```

`apps/agent/src/video/keyframes.int.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { IsolatedWorld, mainFrameId } from "../capture/cdp-world.ts";
import { type BrowserHarness, startBrowserHarness } from "../testing/browser-harness.ts";
import { sampleKeyframes } from "./keyframes.ts";
import { pageCaptionsClick, pageCaptionsState, pageVideoReveal } from "./page/player.ts";

let harness: BrowserHarness;
let session: BrowserSession;
beforeAll(async () => {
  harness = await startBrowserHarness();
  session = await harness.openSession({ runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", workspaceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302" });
});
afterAll(async () => {
  await harness?.stop();
});

async function open(path: string) {
  await session.page.goto(`${harness.fixturesUrl}/youtube/${path}`);
  const cdp = await session.cdp();
  const world = await IsolatedWorld.create(cdp, await mainFrameId(cdp), { libraries: false });
  return { world, duration: (await world.call(pageVideoReveal)).duration };
}

describe("sampleKeyframes", () => {
  it("keeps one frame per slide and restores captions", async () => {
    const { world, duration } = await open("watch.html");
    await world.call(pageCaptionsClick);
    const result = await sampleKeyframes(session, world, { start: 0, end: duration }, new AbortController().signal);
    expect(result.drm).toBe(false);
    expect(result.frames.map((f) => f.segmentStart)).toEqual([0, 6, 10, 16]);
    expect(result.frames.map((f) => Math.round(f.t))).toEqual([4, 8, 14, 20]);
    expect((await world.call(pageCaptionsState)).pressed).toBe(true);
  }, 120_000);
  it("flags DRM-black video and keeps nothing", async () => {
    const { world, duration } = await open("drm.html");
    const result = await sampleKeyframes(session, world, { start: 0, end: duration }, new AbortController().signal);
    expect(result).toMatchObject({ drm: true, frames: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video/phash.test.ts apps/agent/src/video/keyframes.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement.**

`apps/agent/src/video/phash.ts`:
```ts
import sharp from "sharp";

const N = 32;
const COS: number[][] = Array.from({ length: N }, (_, k) => Array.from({ length: N }, (_, n) => Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N))));

/** 64-bit perceptual hash: 32×32 greyscale → 2-D DCT → 8×8 low frequencies vs their median. */
export async function pHash(png: Uint8Array): Promise<bigint> {
  const pixels = await sharp(png).greyscale().resize(N, N, { fit: "fill" }).raw().toBuffer();
  const rows: number[][] = Array.from({ length: N }, (_, y) =>
    Array.from({ length: N }, (_, k) => {
      let sum = 0;
      for (let x = 0; x < N; x++) sum += (pixels[y * N + x] ?? 0) * COS[k]![x]!;
      return sum;
    }),
  );
  const low: number[] = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < N; y++) sum += rows[y]![u]! * COS[v]![y]!;
      low.push(sum);
    }
  }
  const median = [...low.slice(1)].sort((a, b) => a - b)[31]!;
  return low.reduce((hash, value, i) => (value > median ? hash | (1n << BigInt(i)) : hash), 0n);
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

export async function meanLuminance(png: Uint8Array): Promise<number> {
  const stats = await sharp(png).greyscale().stats();
  return (stats.channels[0]?.mean ?? 0) / 255;
}
```

`apps/agent/src/video/keyframes.ts`:
```ts
import type { BrowserSession } from "../browser/session.ts";
import type { IsolatedWorld } from "../capture/cdp-world.ts";
import { pageCaptionsClick, pageCaptionsState, pageVideoPause, pageVideoPlay, pageVideoSeek, pageVideoState } from "./page/player.ts";
import { hamming, meanLuminance, pHash } from "./phash.ts";

export const KEYFRAME_INTERVAL_S = 2;
export const PHASH_DUPLICATE_DISTANCE = 6;
export const DRM_LUMINANCE = 0.03;
export const DRM_PROBE_FRAMES = 5;

export interface Keyframe {
  t: number;
  segmentStart: number;
  png: Uint8Array;
}

/** spec §8: drop frames within the threshold of the segment's reference; keep the last frame before a change. */
export class KeyframeSampler {
  readonly #threshold: number;
  #reference: bigint | null = null;
  #segmentStart = 0;
  #last: { t: number; png: Uint8Array } | null = null;
  readonly #kept: Keyframe[] = [];
  dropped = 0;

  constructor(threshold: number = PHASH_DUPLICATE_DISTANCE) {
    this.#threshold = threshold;
  }

  push(frame: { t: number; hash: bigint; png: Uint8Array }): void {
    if (this.#reference !== null && hamming(this.#reference, frame.hash) <= this.#threshold) {
      this.dropped++;
      this.#last = { t: frame.t, png: frame.png };
      return;
    }
    if (this.#last) this.#kept.push({ t: this.#last.t, segmentStart: this.#segmentStart, png: this.#last.png });
    this.#reference = frame.hash;
    this.#segmentStart = frame.t;
    this.#last = { t: frame.t, png: frame.png };
  }

  finish(): Keyframe[] {
    if (this.#last) this.#kept.push({ t: this.#last.t, segmentStart: this.#segmentStart, png: this.#last.png });
    this.#last = null;
    return this.#kept;
  }
}

export async function sampleKeyframes(
  session: Pick<BrowserSession, "captureScreenshot">,
  world: IsolatedWorld,
  range: { start: number; end: number },
  signal: AbortSignal,
): Promise<{ frames: Keyframe[]; dropped: number; drm: boolean }> {
  const before = await world.call(pageVideoState);
  if (!before.found) return { frames: [], dropped: 0, drm: false };
  const captions = await world.call(pageCaptionsState);
  if (captions.pressed) await world.call(pageCaptionsClick);
  await world.call(pageVideoPause);
  const end = Math.min(range.end, before.duration);
  const sampler = new KeyframeSampler();
  let sampled = 0;
  let dark = 0;
  try {
    for (let t = range.start; t <= end + 1e-6; t += KEYFRAME_INTERVAL_S) {
      signal.throwIfAborted();
      const target = Math.min(t, Math.max(range.start, end - 0.05));
      if (!(await world.call(pageVideoSeek, target))) continue;
      const rect = (await world.call(pageVideoState)).rect;
      if (!rect) break;
      const png = await session.captureScreenshot({ clip: rect, scale: 1 });
      sampled++;
      if (sampled <= DRM_PROBE_FRAMES && (await meanLuminance(png)) < DRM_LUMINANCE) dark++;
      if (dark === DRM_PROBE_FRAMES || (sampled === DRM_PROBE_FRAMES && dark === sampled)) return { frames: [], dropped: 0, drm: true };
      sampler.push({ t: target, hash: await pHash(png), png });
    }
    if (sampled > 0 && dark === sampled) return { frames: [], dropped: 0, drm: true };
    return { frames: sampler.finish(), dropped: sampler.dropped, drm: false };
  } finally {
    await world.call(pageVideoSeek, before.currentTime).catch(() => false);
    if (captions.pressed) await world.call(pageCaptionsClick).catch(() => false);
    if (!before.paused) await world.call(pageVideoPlay).catch(() => false);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video && pnpm exec vitest run --project integration apps/agent/src/video/keyframes.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/agent/src/video
git commit -m "feat(video): keyframe sampling with sharp pHash, last-frame-before-change and DRM detection"
```

---

### Task 20: Transcribe via remote PulseAudio, ffmpeg and `gpt-4o-transcribe-diarize`

**Files:**
- Modify: `apps/browser-slot/Dockerfile` and `apps/browser-slot/bin/slot-entrypoint`
- Create: `apps/browser-slot/test/verify-pulse.sh`
- Create: `apps/agent/src/video/audio-recorder.ts`, `apps/agent/src/video/transcriber.ts`, `apps/agent/src/video/transcribe.ts`
- Create: `tests/llm-mock/src/routes/transcriptions.ts`, and modify `tests/llm-mock/src/routes.ts`
- Modify: `apps/agent/src/library.ts` and `apps/agent/src/testing/capture-env.ts` (add `transcriber`)
- Test: `apps/agent/src/video/audio-recorder.test.ts`, `apps/agent/src/video/transcriber.test.ts`, `tests/llm-mock/src/routes/transcriptions.test.ts`

**Interfaces:**
- Consumes: `PULSE_TCP_PORT`, `MODELS.transcription`, Task 18 `CaptionSegment`, Task 16 player functions, and `slotCdpBaseUrl` (from Phase 0).
- Produces:
  - **Slot audio:** each slot loads `module-native-protocol-tcp port=4713 auth-ip-acl=<CDP_ALLOWED_IP>`, so the capture source is `audio_output.monitor`.
  - **Recording:**
    - `CHUNK_SECONDS = 600`;
    - `AudioRecording {onChunk(cb: (file, index) => void); stop(): Promise<void>; readonly startedAt: number}`;
    - `startAudioRecording({server, dir, ffmpegPath?, chunkSeconds?}): AudioRecording`.
  - **Transcription:**
    - `Transcriber {transcribe(file, signal): Promise<CaptionSegment[]>}`, with chunk-relative times and an optional `speaker`;
    - `createTranscriber(openai)`;
    - `transcribeVideo(services, ctx, world, range): Promise<{segments: CaptionSegment[]; seconds: number}>`, with absolute times. Audio is deleted in `afterCommit`, and also on failure.
  - **Mock:** `handleTranscriptions: MockHandler`.

- [ ] **Step 1: Write the slot audio change and its verification script.**

In `apps/browser-slot/Dockerfile`, after the xorg `RUN`, add:
```dockerfile
# Keep a pristine copy: the entrypoint regenerates default.pa with the agent-only TCP module each start.
RUN cp /etc/pulse/default.pa /etc/pulse/default.pa.orig
```

In `apps/browser-slot/bin/slot-entrypoint`, before `exec "$@"`, add:
```bash
# PulseAudio TCP for the agent's ffmpeg (spec §8). Module loading is disallowed at runtime,
# so it must be in default.pa before supervisord starts PulseAudio.
if [[ ! "$CDP_ALLOWED_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then echo "slot-entrypoint: invalid CDP_ALLOWED_IP" >&2; exit 64; fi
{ cat /etc/pulse/default.pa.orig; echo "load-module module-native-protocol-tcp port=4713 listen=0.0.0.0 auth-ip-acl=${CDP_ALLOWED_IP}"; } > /etc/pulse/default.pa
```

`apps/browser-slot/test/verify-pulse.sh`:
```bash
#!/bin/bash
# Proves the slot serves PulseAudio on 4713 to the agent IP only, and that the agent image's ffmpeg records it.
set -euo pipefail
cd "$(dirname "$0")/../../.."
net=mt-pulse-verify
prefix=172.30.239
cleanup() { docker rm -f mt-pulse-slot >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create --subnet "$prefix.0/24" "$net" >/dev/null
docker run -d --name mt-pulse-slot --network "$net" --ip "$prefix.20" \
  --cap-add NET_ADMIN --security-opt seccomp=apps/browser-slot/seccomp/chromium.json --shm-size 2g \
  --tmpfs /tmp/chromium-profile:uid=1000,gid=1000,mode=0700 \
  -e SLOT_NAME=browser-1 -e NEKO_ADMIN_SECRET=verify-admin-secret-0123456789abcdef -e NEKO_MEMBER_SECRET=verify-member-secret-0123456789abcdef \
  -e CDP_ALLOWED_IP="$prefix.10" -e NEKO_ALLOWED_IPS="$prefix.11" mastertutor/browser-slot:local >/dev/null
for _ in $(seq 1 60); do docker exec mt-pulse-slot sh -c 'ss -ltn | grep -q ":4713 "' && break; sleep 1; done
docker run --rm --network "$net" --ip "$prefix.10" -v "$PWD/.verify-pulse:/out" --entrypoint ffmpeg mastertutor/agent:local \
  -hide_banner -loglevel error -f pulse -server "tcp:$prefix.20:4713" -i audio_output.monitor -t 2 -ac 1 -ar 16000 -c:a pcm_s16le -y /out/probe.wav
size=$(stat -c %s .verify-pulse/probe.wav 2>/dev/null || stat -f %z .verify-pulse/probe.wav)
rm -rf .verify-pulse
[ "$size" -gt 32000 ] && echo "ok - agent IP records audio ($size bytes)" || { echo "not ok - recording too small"; exit 1; }
if docker run --rm --network "$net" --ip "$prefix.30" --entrypoint ffmpeg mastertutor/agent:local \
  -hide_banner -loglevel error -f pulse -server "tcp:$prefix.20:4713" -i audio_output.monitor -t 1 -f null - 2>/dev/null; then
  echo "not ok - another IP could record"; exit 1
fi
echo "ok - other IPs are refused"
echo "verify-pulse: all checks passed"
```

Run: `chmod +x apps/browser-slot/test/verify-pulse.sh && docker compose --env-file .env.test -f compose.yml build browser-1 agent && bash apps/browser-slot/test/verify-pulse.sh && docker builder prune -f`
Expected: both `ok -` lines, then `verify-pulse: all checks passed`. Also rerun Phase 0's `bash apps/browser-slot/test/verify.sh`, which must still pass.

- [ ] **Step 2: Write the failing tests.**

`apps/agent/src/video/audio-recorder.test.ts`:
```ts
import { chmod, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startAudioRecording } from "./audio-recorder.ts";

// A stand-in ffmpeg: writes a chunk every 200ms into the segment pattern, finishes on "q".
const FAKE = `#!/usr/bin/env node
const fs = require("node:fs");
const out = process.argv.at(-1);
let i = 0;
const write = () => fs.writeFileSync(out.replace("%03d", String(i++).padStart(3, "0")), "RIFF");
write();
const timer = setInterval(write, 200);
process.stdin.on("data", (d) => { if (String(d).includes("q")) { clearInterval(timer); process.exit(0); } });
`;

describe("startAudioRecording", () => {
  it("emits each chunk once it is complete and the last on stop", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mt-rec-"));
    const ffmpeg = join(dir, "fake-ffmpeg.cjs");
    await writeFile(ffmpeg, FAKE);
    await chmod(ffmpeg, 0o755);
    const chunks: number[] = [];
    const rec = startAudioRecording({ server: "tcp:127.0.0.1:4713", dir, ffmpegPath: ffmpeg, chunkSeconds: 1 });
    rec.onChunk((_file, index) => chunks.push(index));
    await new Promise((r) => setTimeout(r, 700));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    await rec.stop();
    const files = (await readdir(dir)).filter((f) => f.startsWith("chunk-"));
    expect(chunks).toEqual(files.map((_, i) => i));
  });
});
```

`apps/agent/src/video/transcriber.test.ts`:
```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranscriber } from "./transcriber.ts";

describe("createTranscriber", () => {
  it("requests diarized JSON and validates the response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mt-tr-"));
    const file = join(dir, "chunk-000.wav");
    await writeFile(file, "RIFF");
    let body: Record<string, unknown> = {};
    const openai = { audio: { transcriptions: { create: async (b: Record<string, unknown>) => ((body = b), { segments: [{ start: 1, end: 2, text: " Hi ", speaker: "A" }, { start: 2, end: 3, text: "" }] }) } } };
    const out = await createTranscriber(openai as never).transcribe(file, new AbortController().signal);
    expect(body).toMatchObject({ model: "gpt-4o-transcribe-diarize", response_format: "diarized_json", chunking_strategy: "auto" });
    expect(out).toEqual([{ start: 1, end: 2, text: "Hi", speaker: "A" }]);
    const bad = { audio: { transcriptions: { create: async () => ({ text: "no segments" }) } } };
    await expect(createTranscriber(bad as never).transcribe(file, new AbortController().signal)).rejects.toThrow();
  });
});
```

`tests/llm-mock/src/routes/transcriptions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { handleTranscriptions } from "./transcriptions.ts";

describe("POST /v1/audio/transcriptions", () => {
  it("returns a scripted diarized transcript", async () => {
    const res = await handleTranscriptions({ body: {}, headers: {} });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ segments: [{ speaker: "A", start: 0 }, { speaker: "B" }] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video/audio-recorder.test.ts apps/agent/src/video/transcriber.test.ts tests/llm-mock/src/routes/transcriptions.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 4: Implement.**

`apps/agent/src/video/audio-recorder.ts`:
```ts
import { spawn } from "node:child_process";
import { readdirSync, watch } from "node:fs";
import { join } from "node:path";

export const CHUNK_SECONDS = 600;

export interface AudioRecording {
  readonly startedAt: number;
  onChunk(callback: (file: string, index: number) => void): void;
  stop(): Promise<void>;
}

const CHUNK = /^chunk-(\d{3})\.wav$/;

/** ffmpeg pulls the slot's monitor source over Pulse TCP and writes 10-minute 16 kHz mono WAV chunks. */
export function startAudioRecording(options: { server: string; dir: string; ffmpegPath?: string; chunkSeconds?: number }): AudioRecording {
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-f", "pulse", "-server", options.server, "-name", "mastertutor", "-i", "audio_output.monitor",
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    "-f", "segment", "-segment_time", String(options.chunkSeconds ?? CHUNK_SECONDS), "-reset_timestamps", "1",
    join(options.dir, "chunk-%03d.wav"),
  ];
  const child = spawn(options.ffmpegPath ?? "ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-4_096);
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  const callbacks: ((file: string, index: number) => void)[] = [];
  let emitted = -1;
  const emitThrough = (last: number) => {
    while (emitted < last) {
      emitted++;
      const file = join(options.dir, `chunk-${String(emitted).padStart(3, "0")}.wav`);
      for (const callback of callbacks) callback(file, emitted);
    }
  };
  const highest = () => Math.max(-1, ...readdirSync(options.dir).flatMap((name) => (CHUNK.test(name) ? [Number(CHUNK.exec(name)![1])] : [])));
  const watcher = watch(options.dir, () => emitThrough(highest() - 1));
  return {
    startedAt: Date.now(),
    onChunk(callback) {
      callbacks.push(callback);
    },
    async stop() {
      if (child.exitCode === null) child.stdin.end("q");
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      const code = await exited;
      clearTimeout(timer);
      watcher.close();
      if (code !== 0 && code !== 255) throw new Error(`ffmpeg exited with ${code}: ${stderr.split("\n").at(-2) ?? ""}`);
      emitThrough(highest());
    },
  };
}
```

`apps/agent/src/video/transcriber.ts`:
```ts
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { MODELS } from "@mastertutor/contracts";
import { toFile } from "openai";
import type OpenAI from "openai";
import { z } from "zod";
import type { CaptionSegment } from "./json3.ts";

export interface Transcriber {
  /** Segments with times relative to the chunk. */
  transcribe(file: string, signal: AbortSignal): Promise<CaptionSegment[]>;
}

const Diarized = z.object({
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string(), speaker: z.string().nullish() })),
});

export function createTranscriber(openai: OpenAI): Transcriber {
  return {
    async transcribe(file, signal) {
      const upload = await toFile(await readFile(file), basename(file), { type: "audio/wav" });
      const response = await openai.audio.transcriptions.create(
        { file: upload, model: MODELS.transcription, response_format: "diarized_json", chunking_strategy: "auto" } as never,
        { signal },
      );
      return Diarized.parse(response).segments.flatMap((s) => {
        const text = s.text.trim();
        return text ? [{ start: s.start, end: s.end, text, ...(s.speaker ? { speaker: s.speaker } : {}) }] : [];
      });
    },
  };
}
```

`apps/agent/src/video/transcribe.ts`:
```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PULSE_TCP_PORT } from "@mastertutor/contracts";
import type { IsolatedWorld } from "../capture/cdp-world.ts";
import { slotCdpBaseUrl } from "../slots/probe.ts";
import type { ToolContext } from "../tools/types.ts";
import { ToolError } from "../tools/types.ts";
import { CHUNK_SECONDS, startAudioRecording } from "./audio-recorder.ts";
import type { CaptionSegment } from "./json3.ts";
import { pageVideoPause, pageVideoPlay, pageVideoSeek, pageVideoState } from "./page/player.ts";
import type { Transcriber } from "./transcriber.ts";

const STALL_LIMIT_MS = 30_000;

async function waitForPlayback(world: IsolatedWorld, end: number, signal: AbortSignal): Promise<void> {
  let lastTime = -1;
  let stalledSince = Date.now();
  for (;;) {
    signal.throwIfAborted();
    const state = await world.call(pageVideoState);
    if (state.ended || state.currentTime >= end - 0.25) return;
    if (state.currentTime !== lastTime) {
      lastTime = state.currentTime;
      stalledSince = Date.now();
    } else if (Date.now() - stalledSince > STALL_LIMIT_MS) {
      throw new ToolError("playback_stalled", "The video stopped playing");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** spec §8 transcribe: play at 1×, record the slot's monitor over Pulse TCP, transcribe 10-minute chunks in parallel. */
export async function transcribeVideo(
  deps: { transcriber: Transcriber; ffmpegPath?: string },
  ctx: Pick<ToolContext, "session" | "step" | "signal">,
  world: IsolatedWorld,
  range: { start: number; end: number },
): Promise<{ segments: CaptionSegment[]; seconds: number }> {
  const slotHost = new URL(await slotCdpBaseUrl(ctx.session.slotName)).hostname;
  const dir = await mkdtemp(join(tmpdir(), "mt-audio-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  ctx.step.afterCommit(cleanup);
  try {
    await world.call(pageVideoSeek, range.start);
    const recording = startAudioRecording({ server: `tcp:${slotHost}:${PULSE_TCP_PORT}`, dir, ffmpegPath: deps.ffmpegPath });
    const pending: Promise<CaptionSegment[]>[] = [];
    let lag = 0;
    recording.onChunk((file, index) => {
      pending.push(
        deps.transcriber.transcribe(file, ctx.signal).then((segments) =>
          segments.map((s) => {
            const offset = range.start + index * CHUNK_SECONDS - lag;
            return { ...s, start: Math.max(range.start, s.start + offset), end: Math.max(range.start, s.end + offset) };
          }),
        ),
      );
    });
    try {
      if (!(await world.call(pageVideoPlay))) throw new ToolError("playback_blocked", "The video would not play");
      lag = (Date.now() - recording.startedAt) / 1_000;
      await waitForPlayback(world, range.end, ctx.signal);
    } finally {
      await world.call(pageVideoPause).catch(() => undefined);
      await recording.stop();
    }
    const segments = (await Promise.all(pending)).flat().filter((s) => s.start < range.end);
    return { segments, seconds: range.end - range.start };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
```

`tests/llm-mock/src/routes/transcriptions.ts`:
```ts
import type { MockHandler } from "../routes.ts";

/** Scripted gpt-4o-transcribe-diarize answer; the multipart audio is ignored. */
export const handleTranscriptions: MockHandler = async () => ({
  status: 200,
  json: {
    task: "transcribe",
    duration: 6,
    text: "Welcome to the lecture. Today we study photosynthesis.",
    segments: [
      { id: "seg_0", type: "transcript.text.segment", start: 0, end: 3, speaker: "A", text: "Welcome to the lecture." },
      { id: "seg_1", type: "transcript.text.segment", start: 3, end: 6, speaker: "B", text: "Today we study photosynthesis." },
    ],
  },
});
```
In `tests/llm-mock/src/routes.ts`, register `"POST /v1/audio/transcriptions": handleTranscriptions`.

Extend `LibraryServices` with `transcriber: Transcriber`. In `createLibraryServices`, add `transcriber: createTranscriber(deps.openai)`. In `startCaptureEnv`, add `transcriber: { transcribe: async () => [{ start: 0, end: 3, text: "Welcome to the lecture.", speaker: "A" }] }`. Add the same fake to the annotate test's `services` literal.

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm exec vitest run --project unit apps/agent/src/video tests/llm-mock && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add apps/browser-slot apps/agent tests/llm-mock
git commit -m "feat(video): agent-only Pulse TCP in slots, chunked ffmpeg recording and diarized transcription"
```

---

### Task 21: The `video` tool and the B4 done-when test

**Files:**
- Create: `apps/agent/src/video/video-tool.ts`
- Modify: `apps/agent/src/tools/index.ts` (B1), registering `createVideoTool(library)`
- Test: `apps/agent/src/video/video-tool.int.test.ts`

**Interfaces:**
- Consumes: Tasks 16–20, contracts `VideoArgs`/`VideoResult`/`assetUri`, and B1's `Tool`/`ToolError`.
- Produces: `createVideoTool(services): Tool<VideoArgs, VideoResult>`, with these ops:

  | Op | Behaviour |
  |---|---|
  | `chapters` | Heading blocks for new chapters; `meta.chapters` |
  | `captions` | Transcript blocks (`origin: captions`, verified); `meta.captions {segments, language}` |
  | `keyframes` | `keyframe` blocks (`![Keyframe [mm:ss]](asset:…)`); `meta.drm` |
  | `transcribe` | Refused with `captions_available` when `meta.captions.segments > 0`; otherwise ASR transcript blocks (needs_review) |

  Every op calls `stageQuality(step, noteId, null)`.

- [ ] **Step 1: Write the failing test.**

`apps/agent/src/video/video-tool.int.test.ts`:
```ts
import { noteBlocks, notes } from "@mastertutor/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CaptureEnv, startCaptureEnv } from "../testing/capture-env.ts";
import { RecordingStep, seedRun } from "../testing/notes.ts";
import { createVideoTool } from "./video-tool.ts";

let env: CaptureEnv;
beforeAll(async () => {
  env = await startCaptureEnv();
}, 300_000);
afterAll(async () => {
  await env?.stop();
});

async function session(path: string) {
  const scope = await seedRun(env.handle.db);
  const s = await env.harness.openSession(scope);
  await s.page.goto(`${env.harness.fixturesUrl}/youtube/${path}`);
  return { scope, s };
}

async function op(scope: { runId: string; workspaceId: string }, s: Awaited<ReturnType<CaptureEnv["harness"]["openSession"]>>, args: Parameters<ReturnType<typeof createVideoTool>["run"]>[1]) {
  const step = new RecordingStep();
  const result = await createVideoTool(env.services).run(env.context(scope, s, step), args);
  await step.commit(env.handle.db, scope.runId);
  return result;
}

describe("video tool (B4 done-when: the YouTube fixture produces a chaptered note)", () => {
  it("lays out chapters with interleaved transcript and keyframes", async () => {
    const { scope, s } = await session("watch.html");
    const chapters = await op(scope, s, { op: "chapters", range: null });
    expect(chapters).toEqual({ op: "chapters", chapters: [{ title: "Intro", start: 0 }, { title: "Light reactions", start: 5 }, { title: "Calvin cycle", start: 10 }, { title: "Summary", start: 15 }] });
    const captions = await op(scope, s, { op: "captions", range: null });
    expect(captions).toMatchObject({ op: "captions", segments: 8, language: "en" });
    const keyframes = await op(scope, s, { op: "keyframes", range: null });
    expect(keyframes).toMatchObject({ op: "keyframes", kept: 4, drm: false });
    expect(await op(scope, s, { op: "chapters", range: null })).toMatchObject({ op: "chapters" });

    const [run] = await env.handle.db.execute(sql`select note_id from runs where id = ${scope.runId}`);
    const rows = await env.handle.db
      .select({ type: noteBlocks.type, markdown: noteBlocks.markdown, anchor: noteBlocks.anchor })
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, String(run!.note_id)))
      .orderBy(sql`${noteBlocks.position} collate "C"`);
    const sections: string[][] = [];
    for (const row of rows) {
      if (row.type === "heading") sections.push([row.markdown]);
      else sections.at(-1)!.push(row.type);
    }
    expect(sections.map((sec) => sec[0])).toEqual(["## Intro", "## Light reactions", "## Calvin cycle", "## Summary"]);
    for (const sec of sections) {
      expect(sec).toContain("transcript");
      expect(sec).toContain("keyframe");
    }
    const starts = rows.map((r) => r.anchor!.tStart!);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(rows.find((r) => r.type === "transcript")?.markdown).toBe("[00:00] Welcome to a short tour of photosynthesis. Plants turn light into chemical energy.");
    const [note] = await env.handle.db.select({ fidelity: notes.fidelity }).from(notes).where(eq(notes.id, String(run!.note_id)));
    expect(note?.fidelity).toBe("verified");
  }, 180_000);

  it("refuses transcribe when captions exist and reports DRM", async () => {
    const { scope, s } = await session("watch.html");
    await op(scope, s, { op: "captions", range: null });
    await expect(op(scope, s, { op: "transcribe", range: null })).rejects.toMatchObject({ code: "captions_available" });
    const drm = await session("drm.html");
    expect(await op(drm.scope, drm.s, { op: "keyframes", range: null })).toMatchObject({ drm: true, kept: 0 });
  }, 120_000);

  it("uses description chapters and returns zero captions when the player has none", async () => {
    const { scope, s } = await session("watch-nocc.html");
    expect((await op(scope, s, { op: "chapters", range: null })).op).toBe("chapters");
    expect(await op(scope, s, { op: "captions", range: null })).toEqual({ op: "captions", blockIds: [], segments: 0, language: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm exec vitest run --project integration apps/agent/src/video/video-tool.int.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement.**

`apps/agent/src/video/video-tool.ts`:
```ts
import { assetUri, VideoArgs, VideoResult } from "@mastertutor/contracts";
import { noteBlocks } from "@mastertutor/db";
import { and, eq } from "drizzle-orm";
import type { LibraryServices } from "../library.ts";
import { timeAnchor, type TimedBlockDraft } from "../notes/note-writer.ts";
import { type Tool, type ToolContext, ToolError } from "../tools/types.ts";
import { captureTimedtext } from "./captions.ts";
import { chapterBlocks, readChapters } from "./chapters.ts";
import { parseJson3 } from "./json3.ts";
import { sampleKeyframes } from "./keyframes.ts";
import { openVideoContext, type VideoContext } from "./source.ts";
import { formatTimecode } from "./timecode.ts";
import { transcribeVideo } from "./transcribe.ts";
import { groupSegments, transcriptBlocks } from "./transcript-blocks.ts";

const inRange = (t: number, range: { start: number; end: number }) => t >= range.start && t <= range.end;

export function createVideoTool(services: LibraryServices): Tool<VideoArgs, VideoResult> {
  const append = (ctx: ToolContext, video: VideoContext, blocks: TimedBlockDraft[]) =>
    services.writer.appendTimedBlocks({ runId: ctx.runId, workspaceId: ctx.workspaceId }, ctx.step, {
      noteId: video.noteId,
      sourceId: video.sourceId,
      blocks,
      signal: ctx.signal,
    });

  return {
    name: "video",
    args: VideoArgs,
    result: VideoResult,
    async run(ctx, args): Promise<VideoResult> {
      const video = await openVideoContext(services, ctx);
      const range = args.range ?? { start: 0, end: video.duration };
      const chapters = await readChapters(video.world);
      const boundaries = chapters.map((c) => c.start);
      try {
        switch (args.op) {
          case "chapters": {
            const existing = await services.db
              .select({ anchor: noteBlocks.anchor })
              .from(noteBlocks)
              .where(and(eq(noteBlocks.noteId, video.noteId), eq(noteBlocks.sourceId, video.sourceId), eq(noteBlocks.type, "heading")));
            const starts = new Set(existing.flatMap((row) => (typeof row.anchor?.tStart === "number" ? [row.anchor.tStart] : [])));
            await append(ctx, video, chapterBlocks(chapters, starts));
            services.writer.stageSourceMeta(ctx.step, video.sourceId, { chapters });
            return { op: "chapters", chapters };
          }
          case "captions": {
            const captured = await captureTimedtext(video.cdp, video.world, { signal: ctx.signal });
            const segments = captured ? parseJson3(captured.body) : null;
            if (!captured || !segments) {
              services.writer.stageSourceMeta(ctx.step, video.sourceId, { captions: { segments: 0, language: null, format: captured ? "unsupported" : "none" } });
              return { op: "captions", blockIds: [], segments: 0, language: null };
            }
            const selected = segments.filter((s) => inRange(s.start, range));
            const blockIds = await append(ctx, video, transcriptBlocks(groupSegments(selected, boundaries), "captions", true));
            services.writer.stageSourceMeta(ctx.step, video.sourceId, { captions: { segments: selected.length, language: captured.language } });
            return { op: "captions", blockIds, segments: selected.length, language: captured.language };
          }
          case "keyframes": {
            const sampled = await sampleKeyframes(ctx.session, video.world, range, ctx.signal);
            services.writer.stageSourceMeta(ctx.step, video.sourceId, { drm: sampled.drm });
            const blocks: TimedBlockDraft[] = [];
            for (const frame of sampled.frames) {
              const asset = await services.assets.put(ctx.workspaceId, { bytes: frame.png, mime: "image/png", width: null, height: null, sourceUrl: null });
              blocks.push({
                type: "keyframe",
                markdown: `![Keyframe ${formatTimecode(frame.t)}](${assetUri(asset.assetId)})`,
                origin: "dom",
                assetId: asset.assetId,
                verified: true,
                anchor: timeAnchor(frame.segmentStart, frame.t),
              });
            }
            const blockIds = await append(ctx, video, blocks);
            return { op: "keyframes", blockIds, kept: blocks.length, dropped: sampled.dropped, drm: sampled.drm };
          }
          case "transcribe": {
            const captions = video.meta.captions as { segments?: number } | undefined;
            if ((captions?.segments ?? 0) > 0) throw new ToolError("captions_available", "Captions exist; use op captions instead");
            const result = await transcribeVideo({ transcriber: services.transcriber }, ctx, video.world, range);
            const blockIds = await append(ctx, video, transcriptBlocks(groupSegments(result.segments, boundaries), "asr", false));
            return { op: "transcribe", blockIds, seconds: result.seconds };
          }
        }
      } finally {
        services.writer.stageQuality(ctx.step, video.noteId, null);
      }
    },
  };
}
```

In `apps/agent/src/tools/index.ts`, add `import { createVideoTool } from "../video/video-tool.ts";` and `createVideoTool(library)` to the returned list, replacing any B1 placeholder. The tool count stays 7.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm exec vitest run --project integration apps/agent/src/video && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. This is the B4 "done when".

- [ ] **Step 5: Commit.**
```bash
git add apps/agent
git commit -m "feat(video): video tool with chapters, captions, keyframes and transcribe; chaptered-note test"
```

---

## B5: PDF

### Task 22: pdf.js text extraction, layout into blocks and the PDF fixture

**Files:**
- Modify: `apps/agent/package.json` (add `pdfjs-dist@6.4.299`) and the root `package.json` (devDependency `pdf-lib@1.17.1`)
- Create: `apps/agent/src/pdf/pdfjs.ts`, `apps/agent/src/pdf/layout.ts`
- Create: `tests/fixtures/sites/pdf/make-pdf.ts` and the generated `tests/fixtures/sites/pdf/paper.pdf`
- Test: `apps/agent/src/pdf/layout.test.ts`, `apps/agent/src/pdf/pdfjs.test.ts`

**Interfaces:**
- Consumes: Task 3's `escapeMarkdownText`.
- Produces:
  - **pdf.js wrapper:**
    - `MAX_PDF_BYTES = 100 MiB`;
    - `PdfTextItem {str, x, y, width, height, hasEOL}`, in points with a top-left origin;
    - `PdfPageText {page, width, height, items, hasImages}`;
    - `loadPdf(bytes)`, `readPdfPages(doc)`, `pdfReferenceText(pages): string`, `renderPdfPage(doc, page, scale): Promise<Uint8Array>` and `pdfTitle(doc, url): Promise<string>`.
  - **Layout:**
    - `PdfBlock {type: "heading" | "paragraph" | "list"; markdown; page; bbox; text}`;
    - `pdfBlocks(pages): PdfBlock[]`, which groups lines into paragraphs, detects headings by font size and recognises list markers.

- [ ] **Step 1: Install the dependencies and generate the fixture.**

Run: `pnpm --filter @mastertutor/agent add --save-exact pdfjs-dist@6.4.299 && pnpm add -w -D --save-exact pdf-lib@1.17.1`

`tests/fixtures/sites/pdf/make-pdf.ts`:
```ts
// Regenerates paper.pdf. Run: node tests/fixtures/sites/pdf/make-pdf.ts
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const doc = await PDFDocument.create();
doc.setTitle("Photosynthesis: A Short Primer");
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const figure = await doc.embedPng(png(240, 140, (x, y) => ((x - 120) ** 2 / 100 ** 2 + (y - 70) ** 2 / 55 ** 2 < 1 ? [80, 160, 90] : [235, 245, 235])));
const scan = await doc.embedPng(png(400, 300, (x, y) => (Math.floor(x / 20 + y / 20) % 2 ? [30, 30, 30] : [250, 250, 250])));

function writer(page: ReturnType<typeof doc.addPage>) {
  let y = 740;
  return {
    heading(text: string, size: number) {
      y -= size + 10;
      page.drawText(text, { x: 72, y, size, font: bold });
      y -= 6;
    },
    paragraph(text: string, size = 11) {
      const words = text.split(" ");
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > 468) {
          y -= size + 4;
          page.drawText(line, { x: 72, y, size, font });
          line = word;
        } else line = next;
      }
      y -= size + 4;
      page.drawText(line, { x: 72, y, size, font });
      y -= 10;
    },
    bullet(text: string) {
      y -= 15;
      page.drawText(`• ${text}`, { x: 84, y, size: 11, font });
    },
    gap(points: number) {
      y -= points;
    },
    image(img: typeof figure, w: number, h: number) {
      y -= h;
      page.drawImage(img, { x: 72, y, width: w, height: h });
      y -= 8;
    },
    row(cells: string[], boldRow = false) {
      y -= 16;
      cells.forEach((cell, i) => page.drawText(cell, { x: 72 + i * 150, y, size: 11, font: boldRow ? bold : font }));
      page.drawLine({ start: { x: 72, y: y - 4 }, end: { x: 522, y: y - 4 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    },
  };
}

const p1 = writer(doc.addPage([612, 792]));
p1.heading("Photosynthesis: A Short Primer", 22);
p1.paragraph("Prepared as a fixture for faithful note capture.", 10);
p1.heading("1. Introduction", 15);
p1.paragraph("Photosynthesis is the process by which plants, algae and some bacteria convert light energy into chemical energy. The energy is stored in sugars that power nearly every food chain on Earth.");
p1.paragraph("The process takes place in chloroplasts and has two linked stages: the light reactions and the Calvin cycle.");
p1.bullet("Light reactions capture energy from photons.");
p1.bullet("The Calvin cycle fixes carbon dioxide into sugar.");
p1.bullet("Oxygen is released as a by-product.");
p1.gap(10);
p1.heading("2. Light reactions", 15);
p1.paragraph("In the thylakoid membranes, chlorophyll absorbs light and drives electrons through a transport chain. Water is split to replace those electrons, and the energy is stored as ATP and NADPH.");
p1.image(figure, 240, 140);
p1.paragraph("Figure 1. Schematic chloroplast with stacked thylakoids.", 9);

const p2 = writer(doc.addPage([612, 792]));
p2.heading("3. Calvin cycle", 15);
p2.paragraph("In the stroma, the enzyme rubisco attaches carbon dioxide to a five carbon sugar. ATP and NADPH from the light reactions then reduce the product into three carbon sugars that the plant uses to build glucose.");
p2.row(["Input", "Output", "Location"], true);
p2.row(["Carbon dioxide", "Glucose", "Stroma"]);
p2.row(["ATP", "ADP", "Stroma"]);
p2.row(["NADPH", "NADP+", "Stroma"]);
p2.gap(16);
p2.heading("4. Summary", 15);
p2.paragraph("Light energy becomes chemical energy in two stages, and the oxygen we breathe is a side effect of splitting water.");

const p3 = writer(doc.addPage([612, 792]));
p3.image(scan, 400, 300);

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "paper.pdf"), await doc.save());
```

Run: `node tests/fixtures/sites/pdf/make-pdf.ts && ls -l tests/fixtures/sites/pdf/paper.pdf`
Expected: the file exists (a few KB to a few hundred KB).

- [ ] **Step 2: Write the failing tests.**

`apps/agent/src/pdf/pdfjs.test.ts`:
```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadPdf, pdfReferenceText, pdfTitle, readPdfPages, renderPdfPage } from "./pdfjs.ts";

const bytes = async () => new Uint8Array(await readFile(new URL("../../../../tests/fixtures/sites/pdf/paper.pdf", import.meta.url)));

describe("pdf.js wrapper", () => {
  it("reads text with top-left coordinates and image flags", async () => {
    const doc = await loadPdf(await bytes());
    const pages = await readPdfPages(doc);
    expect(pages.map((p) => [p.page, p.hasImages, p.items.length > 0])).toEqual([[1, true, true], [2, false, true], [3, true, false]]);
    const title = pages[0]!.items.find((i) => i.str.startsWith("Photosynthesis: A Short"))!;
    expect(title.y).toBeLessThan(80);
    expect(title.height).toBeGreaterThan(20);
    expect(pdfReferenceText(pages)).toContain("rubisco attaches carbon dioxide");
    expect(await pdfTitle(doc, "https://x.test/paper.pdf")).toBe("Photosynthesis: A Short Primer");
    const png = await renderPdfPage(doc, 1, 1);
    expect(png.slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  });
  it("rejects non-PDF bytes", async () => {
    await expect(loadPdf(new TextEncoder().encode("<html>"))).rejects.toThrow();
  });
});
```

`apps/agent/src/pdf/layout.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { pdfBlocks } from "./layout.ts";
import type { PdfPageText } from "./pdfjs.ts";

const item = (str: string, y: number, height = 11, x = 72) => ({ str, x, y, width: str.length * 5, height, hasEOL: true });

describe("pdfBlocks", () => {
  it("groups lines into headings, paragraphs and lists with page bboxes", () => {
    const page: PdfPageText = {
      page: 1, width: 612, height: 792, hasImages: false,
      items: [
        item("Big Title", 50, 22),
        item("First line of a para-", 100),
        item("graph continues here.", 115),
        item("Second paragraph after a gap.", 160),
        item("• one", 200),
        item("• two #1", 215),
        item("1. numbered", 240),
      ],
    };
    const blocks = pdfBlocks([page]);
    expect(blocks.map((b) => [b.type, b.markdown])).toEqual([
      ["heading", "# Big Title"],
      ["paragraph", "First line of a para-graph continues here."],
      ["paragraph", "Second paragraph after a gap."],
      ["list", "- one\n- two #1"],
      ["list", "1. numbered"],
    ]);
    expect(blocks[1]).toMatchObject({ page: 1, bbox: { x: 72, y: expect.closeTo(89, 0), width: expect.any(Number), height: expect.any(Number) } });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `pnpm exec vitest run --project unit apps/agent/src/pdf`
Expected: FAIL with module-not-found errors.

- [ ] **Step 4: Implement.**

`apps/agent/src/pdf/pdfjs.ts`:
```ts
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export interface PdfTextItem {
  str: string;
  x: number;
  /** Top of the glyph box, PDF points from the page top. */
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}
export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
  hasImages: boolean;
}

const IMAGE_OPS = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
}

export async function readPdfPages(doc: PDFDocumentProxy): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    const items = content.items.flatMap((raw) => {
      if (!("str" in raw) || raw.str.length === 0) return [];
      const [, , , , x, baseline] = raw.transform as number[];
      return [{ str: raw.str, x: x!, y: viewport.height - baseline! - raw.height, width: raw.width, height: raw.height, hasEOL: raw.hasEOL }];
    });
    pages.push({ page: n, width: viewport.width, height: viewport.height, items, hasImages: ops.fnArray.some((op) => IMAGE_OPS.has(op)) });
    page.cleanup();
  }
  return pages;
}

/** The verification reference (spec §7.6): every pdf.js text item, in order. */
export function pdfReferenceText(pages: readonly PdfPageText[]): string {
  return pages.map((page) => page.items.map((item) => item.str).join(" ")).join("\n");
}

export async function renderPdfPage(doc: PDFDocumentProxy, pageNumber: number, scale: number): Promise<Uint8Array> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
  page.cleanup();
  return new Uint8Array(canvas.toBuffer("image/png"));
}

export async function pdfTitle(doc: PDFDocumentProxy, url: string): Promise<string> {
  const meta = await doc.getMetadata().catch(() => null);
  const title = (meta?.info as { Title?: string } | undefined)?.Title?.trim();
  if (title) return title.slice(0, 500);
  return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || "PDF";
}
```

Add `@napi-rs/canvas` as an explicit agent dependency at the version `pdfjs-dist` resolves (`pnpm --filter @mastertutor/agent add --save-exact @napi-rs/canvas@1.0.10`), because the agent imports it directly.

`apps/agent/src/pdf/layout.ts`:
```ts
import type { BBox } from "@mastertutor/contracts";
import { escapeMarkdownText } from "../capture/markdown-blocks.ts";
import type { PdfPageText, PdfTextItem } from "./pdfjs.ts";

export interface PdfBlock {
  type: "heading" | "paragraph" | "list";
  markdown: string;
  text: string;
  page: number;
  bbox: BBox;
}

interface Line {
  text: string;
  size: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const LIST = /^\s*([•◦▪‣\-–*]|\d{1,3}[.)])\s+/;

function lines(items: readonly PdfTextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: (Line & { items: PdfTextItem[] })[] = [];
  for (const item of sorted) {
    const line = out.find((l) => Math.abs(l.top - item.y) < Math.max(item.height, 1) * 0.5);
    if (line) line.items.push(item);
    else out.push({ text: "", size: 0, top: item.y, bottom: item.y + item.height, left: item.x, right: item.x + item.width, items: [item] });
  }
  return out.map((line) => {
    const parts = line.items.sort((a, b) => a.x - b.x);
    let text = "";
    let prevRight = -Infinity;
    for (const part of parts) {
      const gap = part.x - prevRight;
      if (text && gap > part.height * 0.25 && !text.endsWith(" ") && !part.str.startsWith(" ")) text += " ";
      text += part.str;
      prevRight = part.x + part.width;
    }
    return {
      text: text.replace(/\s+/g, " ").trim(),
      size: Math.max(...parts.map((p) => p.height)),
      top: Math.min(...parts.map((p) => p.y)),
      bottom: Math.max(...parts.map((p) => p.y + p.height)),
      left: Math.min(...parts.map((p) => p.x)),
      right: Math.max(...parts.map((p) => p.x + p.width)),
    };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 11;
}

const union = (ls: readonly Line[]): BBox => {
  const x = Math.min(...ls.map((l) => l.left));
  const y = Math.min(...ls.map((l) => l.top));
  return { x, y, width: Math.max(...ls.map((l) => l.right)) - x, height: Math.max(...ls.map((l) => l.bottom)) - y };
};

/** pdf.js path (spec §7.6): lines → headings by size, paragraphs by gap, lists by marker. */
export function pdfBlocks(pages: readonly PdfPageText[]): PdfBlock[] {
  const all = pages.flatMap((p) => lines(p.items));
  const body = median(all.flatMap((l) => Array(Math.max(1, l.text.length)).fill(l.size) as number[]));
  const blocks: PdfBlock[] = [];
  for (const page of pages) {
    let group: Line[] = [];
    let kind: PdfBlock["type"] = "paragraph";
    const flush = () => {
      if (group.length === 0) return;
      const text = kind === "list" ? group.map((l) => l.text).join("\n") : group.map((l) => l.text).join(" ").replace(/- (?=\p{Ll})/gu, "-");
      const markdown =
        kind === "heading"
          ? `${"#".repeat(group[0]!.size >= body * 1.6 ? 1 : group[0]!.size >= body * 1.35 ? 2 : 3)} ${escapeMarkdownText(text)}`
          : kind === "list"
            ? group.map((l) => (/^\d/.test(l.text) ? l.text.replace(/^(\d{1,3})[.)]\s+/, "$1. ") : `- ${escapeMarkdownText(l.text.replace(LIST, ""))}`)).join("\n")
            : escapeMarkdownText(text);
      blocks.push({ type: kind, markdown, text: group.map((l) => l.text).join(" "), page: page.page, bbox: union(group) });
      group = [];
    };
    for (const line of lines(page.items)) {
      if (!line.text) continue;
      const lineKind: PdfBlock["type"] = line.size >= body * 1.2 && line.text.length < 200 ? "heading" : LIST.test(line.text) ? "list" : "paragraph";
      const prev = group.at(-1);
      const sameRun =
        prev !== undefined &&
        lineKind === kind &&
        kind !== "heading" &&
        Math.abs(line.size - prev.size) < 0.5 &&
        line.top - prev.bottom < prev.size * 1.0 &&
        (kind !== "list" || /^\d/.test(line.text) === /^\d/.test(group[0]!.text));
      if (!sameRun) {
        flush();
        kind = lineKind;
      }
      group.push(line);
    }
    flush();
  }
  return blocks;
}
```

The list case keeps numbered items literal, because the digits are source text. Bullet items are normalized to `- `. `blockPlainText` drops the bullet marker, which the reference text also contains as a non-token character.

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `pnpm exec vitest run --project unit apps/agent/src/pdf && pnpm typecheck && pnpm lint`
Expected: PASS. If a `layout.test.ts` expectation differs only in heading level, adjust the size thresholds in code. The test's sizes (22 vs 11) must give `#`.

- [ ] **Step 6: Commit.**
```bash
git add apps/agent package.json pnpm-lock.yaml tests/fixtures/sites/pdf
git commit -m "feat(pdf): pdf.js text extraction, layout into blocks and the PDF fixture"
```

---

### Task 23: PDF capture via the `capture` tool (pdf.js path)

**Files:**
- Create: `apps/agent/src/pdf/pdf-capture.ts`
- Modify: `apps/agent/src/capture/capture-tool.ts` (route `kind: "pdf"`)
- Test: `apps/agent/src/pdf/pdf-capture.test.ts`, `apps/agent/src/pdf/pdf-capture.int.test.ts`

**Interfaces:**
- Consumes: Task 22, Task 7 `fetchInBrowser`, Task 8 `persistCapture`/`OcrModel`/`AssetStore`, and Task 3 `coverageOf`/`blockPrecision`/`blockPlainText`.
- Produces:
  - `PdfCaptureDeps {assets, ocr, docling: DoclingClient | null, log}`, where `DoclingClient` is defined in Task 24. Until then the type is `null`, imported as a type-only forward declaration from `./docling.ts`.
  - `PdfCapture {title; blocks: BlockDraft[]; coverage; contentSha256; engine: "pdfjs" | "docling"; pagePng: Uint8Array | null; pdfAssetId; pages}`.
  - `buildPdfCapture(deps, workspaceId, bytes, url, signal): Promise<PdfCapture>`.
  - `capturePdf(deps, session, workspaceId, signal): Promise<PdfCapture & {url}>`.
  - **Behaviour:**
    - a page with images gets a page-render `figure` block after its text;
    - a page with no text but with images gets an image block plus an `ocr_model` transcript (`verified: false`);
    - anchors carry `page` and `bbox`.

- [ ] **Step 1: Write the failing tests.**

`apps/agent/src/pdf/pdf-capture.test.ts`:
```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AssetStore } from "../notes/assets.ts";
import { testLogger } from "../testing/notes.ts";
import { buildPdfCapture } from "./pdf-capture.ts";

const fixture = async () => new Uint8Array(await readFile(new URL("../../../../tests/fixtures/sites/pdf/paper.pdf", import.meta.url)));
const assets: AssetStore = { put: async (_ws, input) => ({ assetId: crypto.randomUUID(), sha256: "x", mime: input.mime, bytes: input.bytes.length, width: input.width, height: input.height }) };

describe("buildPdfCapture (pdf.js path)", () => {
  it("verifies the fixture against the pdf.js text and flags the scanned page", async () => {
    const ocrCalls: number[] = [];
    const capture = await buildPdfCapture(
      { assets, ocr: { transcribe: async (png) => (ocrCalls.push(png.length), "Scanned page text") }, docling: null, log: testLogger },
      "w", await fixture(), "https://x.test/paper.pdf", new AbortController().signal,
    );
    expect(capture.engine).toBe("pdfjs");
    expect(capture.title).toBe("Photosynthesis: A Short Primer");
    expect(capture.coverage).toBeGreaterThanOrEqual(0.98);
    expect(capture.blocks.map((b) => b.type)).toEqual(expect.arrayContaining(["heading", "paragraph", "list", "figure", "image"]));
    const para = capture.blocks.find((b) => b.markdown.startsWith("In the stroma"))!;
    expect(para).toMatchObject({ origin: "pdf", verified: true, anchor: { page: 2, bbox: expect.objectContaining({ x: expect.any(Number) }) } });
    const page1Figure = capture.blocks.findIndex((b) => b.type === "figure" && b.anchor?.page === 1);
    const page2First = capture.blocks.findIndex((b) => b.anchor?.page === 2);
    expect(page1Figure).toBeLessThan(page2First);
    expect(capture.blocks.find((b) => b.origin === "ocr_model")).toMatchObject({ verified: false, anchor: { page: 3 } });
    expect(ocrCalls).toHaveLength(1);
    expect(capture.pagePng?.slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  });
  it("refuses bytes that are not a PDF", async () => {
    await expect(
      buildPdfCapture({ assets, ocr: { transcribe: async () => "" }, docling: null, log: testLogger }, "w", new TextEncoder().encode("<html>"), "https://x.test/a.pdf", new AbortController().signal),
    ).rejects.toMatchObject({ code: "pdf_unavailable" });
  });
});
```

`apps/agent/src/pdf/pdf-capture.int.test.ts`:
```ts
import { sources } from "@mastertutor/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCaptureTool } from "../capture/capture-tool.ts";
import { type CaptureEnv, startCaptureEnv } from "../testing/capture-env.ts";
import { RecordingStep, seedRun } from "../testing/notes.ts";

let env: CaptureEnv;
beforeAll(async () => {
  env = await startCaptureEnv();
}, 300_000);
afterAll(async () => {
  await env?.stop();
});

describe("capture tool on a PDF in the slot's viewer", () => {
  it("auto-detects the PDF, fetches it through the browser and stores a pdf source", async () => {
    const scope = await seedRun(env.handle.db);
    const session = await env.harness.openSession(scope);
    await session.page.goto(`${env.harness.fixturesUrl}/pdf/paper.pdf`);
    const step = new RecordingStep();
    const result = await createCaptureTool(env.services).run(env.context(scope, session, step), { scope: "page", selector: null, kind: null });
    await step.commit(env.handle.db, scope.runId);
    expect(result.coverage).toBeGreaterThanOrEqual(0.98);
    expect(result.fidelity).toBe("needs_review");
    const [source] = await env.handle.db.select().from(sources).where(sql`${sources.meta}->>'noteId' = ${result.noteId}`);
    expect(source).toMatchObject({ kind: "pdf", screenshotKey: expect.stringMatching(/page\.png$/), mhtmlKey: null });
    expect(source?.meta).toMatchObject({ engine: "pdfjs", pages: 3, pdfAssetId: expect.any(String) });
  }, 120_000);
});
```

The fixture's scanned page 3 makes this note `needs_review` by design. The ≥ 0.98 coverage is measured on pages 1–2's text layer.

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm exec vitest run --project unit apps/agent/src/pdf/pdf-capture.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement.**

Create a placeholder type file so this task compiles before Task 24. Task 24 replaces it entirely.

`apps/agent/src/pdf/docling.ts`:
```ts
import type { BBox } from "@mastertutor/contracts";

export interface DoclingBlock {
  type: "heading" | "paragraph" | "list" | "code" | "table" | "math" | "figure";
  markdown: string;
  page: number;
  bbox: BBox;
  /** Picture/formula region to crop from the page render instead of text. */
  crop: boolean;
}
export interface DoclingClient {
  convert(bytes: Uint8Array, filename: string, signal: AbortSignal): Promise<DoclingBlock[]>;
}
```

`apps/agent/src/pdf/pdf-capture.ts`:
```ts
import { assetUri, type BBox } from "@mastertutor/contracts";
import type { createLogger } from "@mastertutor/contracts/server";
import sharp from "sharp";
import type { BrowserSession } from "../browser/session.ts";
import { mainFrameId } from "../capture/cdp-world.ts";
import { fetchInBrowser } from "../capture/fetch-resource.ts";
import { blockPlainText } from "../capture/markdown-blocks.ts";
import type { OcrModel } from "../capture/opaque.ts";
import { blockPrecision, coverageOf } from "../capture/text.ts";
import type { AssetStore } from "../notes/assets.ts";
import { sha256Hex } from "../notes/hash.ts";
import type { BlockDraft } from "../notes/note-writer.ts";
import { ToolError } from "../tools/types.ts";
import type { DoclingBlock, DoclingClient } from "./docling.ts";
import { pdfBlocks } from "./layout.ts";
import { loadPdf, MAX_PDF_BYTES, pdfReferenceText, pdfTitle, readPdfPages, renderPdfPage } from "./pdfjs.ts";

export interface PdfCaptureDeps {
  assets: AssetStore;
  ocr: OcrModel;
  docling: DoclingClient | null;
  log: ReturnType<typeof createLogger>;
}
export interface PdfCapture {
  title: string;
  blocks: BlockDraft[];
  coverage: number;
  contentSha256: string;
  engine: "pdfjs" | "docling";
  pagePng: Uint8Array | null;
  pdfAssetId: string;
  pages: number;
}

const RENDER_SCALE = 2;
const anchor = (page: number, bbox: BBox | null) => ({ selector: null, xpath: null, start: null, end: null, textFragment: null, page, ...(bbox ? { bbox } : {}) });

/** spec §7.6: docling when profile `pdf` is up, else pdf.js; both verified against the pdf.js text. */
export async function buildPdfCapture(deps: PdfCaptureDeps, workspaceId: string, bytes: Uint8Array, url: string, signal: AbortSignal): Promise<PdfCapture> {
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new ToolError("pdf_unavailable", "The document is not a PDF");
  const doc = await loadPdf(bytes).catch(() => {
    throw new ToolError("pdf_unavailable", "The PDF could not be parsed");
  });
  try {
    const pdfAsset = await deps.assets.put(workspaceId, { bytes, mime: "application/pdf", width: null, height: null, sourceUrl: url });
    const pages = await readPdfPages(doc);
    const reference = pdfReferenceText(pages);
    const textPages = new Set(pages.filter((p) => p.items.length > 0).map((p) => p.page));
    const renders = new Map<number, Uint8Array>();
    const render = async (page: number) => {
      if (!renders.has(page)) renders.set(page, await renderPdfPage(doc, page, RENDER_SCALE));
      return renders.get(page)!;
    };
    const storePng = async (png: Uint8Array) => {
      const meta = await sharp(png).metadata();
      return (await deps.assets.put(workspaceId, { bytes: png, mime: "image/png", width: meta.width ?? null, height: meta.height ?? null, sourceUrl: null })).assetId;
    };
    const crop = async (block: DoclingBlock) => {
      const png = await render(block.page);
      const meta = await sharp(png).metadata();
      const left = Math.max(0, Math.floor(block.bbox.x * RENDER_SCALE));
      const top = Math.max(0, Math.floor(block.bbox.y * RENDER_SCALE));
      const width = Math.max(1, Math.min((meta.width ?? 1) - left, Math.ceil(block.bbox.width * RENDER_SCALE)));
      const height = Math.max(1, Math.min((meta.height ?? 1) - top, Math.ceil(block.bbox.height * RENDER_SCALE)));
      return storePng(new Uint8Array(await sharp(png).extract({ left, top, width, height }).png().toBuffer()));
    };

    let engine: PdfCapture["engine"] = "pdfjs";
    const blocks: BlockDraft[] = [];
    if (deps.docling) {
      try {
        const converted = await deps.docling.convert(bytes, "document.pdf", signal);
        for (const block of converted) {
          signal.throwIfAborted();
          const ocrPage = !textPages.has(block.page);
          if (block.crop) {
            const id = await crop(block);
            blocks.push({ type: "figure", markdown: `![${block.markdown}](${assetUri(id)})`, origin: "pdf", assetId: id, anchor: anchor(block.page, block.bbox), verified: true });
          } else {
            const plain = blockPlainText(block);
            blocks.push({
              type: block.type,
              markdown: block.markdown,
              origin: ocrPage ? "ocr_model" : "pdf",
              assetId: null,
              anchor: anchor(block.page, block.bbox),
              verified: !ocrPage && (plain === "" || blockPrecision(plain, reference) >= 0.98),
            });
          }
        }
        engine = "docling";
      } catch (error) {
        if (signal.aborted) throw error;
        deps.log.warn({ errName: (error as Error).name }, "docling failed; falling back to pdf.js");
        blocks.length = 0;
      }
    }
    if (engine === "pdfjs") {
      const laid = pdfBlocks(pages);
      for (const page of pages) {
        signal.throwIfAborted();
        for (const block of laid.filter((b) => b.page === page.page)) {
          blocks.push({ type: block.type, markdown: block.markdown, origin: "pdf", assetId: null, anchor: anchor(page.page, block.bbox), verified: true });
        }
        if (!page.hasImages) continue;
        const png = await render(page.page);
        const id = await storePng(png);
        const whole = { x: 0, y: 0, width: page.width, height: page.height };
        if (page.items.length > 0) {
          blocks.push({ type: "figure", markdown: `![Page ${page.page}](${assetUri(id)})`, origin: "pdf", assetId: id, anchor: anchor(page.page, whole), verified: true });
        } else {
          blocks.push({ type: "image", markdown: `![Page ${page.page}](${assetUri(id)})`, origin: "pdf", assetId: id, anchor: anchor(page.page, whole), verified: true });
          const text = await deps.ocr.transcribe(png, signal);
          if (text) blocks.push({ type: "paragraph", markdown: text, origin: "ocr_model", assetId: null, anchor: anchor(page.page, whole), verified: false });
        }
      }
    }
    const capturedText = blocks.filter((b) => b.origin !== "ocr_model").map((b) => blockPlainText(b)).join("\n");
    const pagePng = pages.length > 0 ? await renderPdfPage(doc, 1, 1) : null;
    return {
      title: await pdfTitle(doc, url),
      blocks,
      coverage: coverageOf(reference, capturedText).coverage,
      contentSha256: sha256Hex(bytes),
      engine,
      pagePng,
      pdfAssetId: pdfAsset.assetId,
      pages: pages.length,
    };
  } finally {
    await doc.destroy();
  }
}

export async function capturePdf(deps: PdfCaptureDeps, session: BrowserSession, workspaceId: string, signal: AbortSignal): Promise<PdfCapture & { url: string }> {
  const url = session.page.url();
  const cdp = await session.cdp();
  const fetched = await fetchInBrowser(cdp, await mainFrameId(cdp), url, MAX_PDF_BYTES);
  if (!fetched) throw new ToolError("pdf_unavailable", "The PDF could not be downloaded in the browser");
  return { ...(await buildPdfCapture(deps, workspaceId, fetched.bytes, url, signal)), url };
}
```

`blockPlainText` accepts `{type: string; markdown: string}` (Task 8's change), so `BlockDraft` and `DoclingBlock` pass directly.

In `apps/agent/src/capture/capture-tool.ts`, replace the `pdf_unsupported` line with:
```ts
      if (kind === "pdf") {
        const pdf = await capturePdf({ assets: services.assets, ocr: services.ocr, docling: services.docling, log: services.log }, ctx.session, ctx.workspaceId, ctx.signal);
        return persistCapture(services, ctx, {
          kind: "pdf",
          url: pdf.url,
          canonicalUrl: null,
          title: pdf.title,
          lede: null,
          faviconUrl: null,
          blocks: pdf.blocks,
          coverage: pdf.coverage,
          contentSha256: pdf.contentSha256,
          snapshot: pdf.pagePng
            ? { mhtml: null, png: pdf.pagePng, mhtmlSha256: null, pngSha256: sha256Hex(pdf.pagePng), skipped: ["mhtml:pdf"] }
            : null,
          meta: { engine: pdf.engine, pages: pdf.pages, pdfAssetId: pdf.pdfAssetId },
          dedupe: true,
        });
      }
```
Add the imports `import { capturePdf } from "../pdf/pdf-capture.ts";` and `import { sha256Hex } from "../notes/hash.ts";`.

Add `docling: DoclingClient | null` to `LibraryServices`. Set it to `null` in `createLibraryServices` (Task 24 wires it), in `startCaptureEnv`, and in the annotate test's literal.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm exec vitest run --project unit apps/agent/src/pdf && pnpm exec vitest run --project integration apps/agent/src/pdf apps/agent/src/capture/capture-tool.int.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/agent
git commit -m "feat(pdf): pdf.js capture path with page images, scanned-page OCR and capture-tool routing"
```

---

### Task 24: The docling-serve profile, its client, and the B5 done-when test (both paths)

**Files:**
- Modify: `packages/contracts/src/env.ts` (add `DOCLING_URL: z.url().optional()` to `AgentEnv`), plus `env.test.ts`
- Modify: `compose.yml` (service `docling`, profile `pdf`; `agent` gets `DOCLING_URL` and an optional dependency) and `.env.example`
- Modify: `apps/agent/src/pdf/docling.ts` (full client), `apps/agent/src/library.ts`
- Test: `apps/agent/src/pdf/docling.test.ts`, `apps/agent/src/pdf/both-paths.int.test.ts`

**Interfaces:**
- Consumes: Task 23 (`DoclingBlock`, `DoclingClient`, `buildPdfCapture`) and `escapeMarkdownText`.
- Produces:
  - `DoclingDocument` (Zod, loose) and `doclingBlocks(doc): DoclingBlock[]`, which walks `body` in reading order, merges list items, renders GFM or raw-HTML tables, and turns pictures and empty formulas into crops.
  - `createDoclingClient(baseUrl, {timeoutMs = 180_000}?)`, which posts to `/v1/convert/file` with `to_formats=json`.
  - In `AgentEnv`, the optional `DOCLING_URL`.

- [ ] **Step 1: Write the failing tests.**

`apps/agent/src/pdf/docling.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DoclingDocument, doclingBlocks } from "./docling.ts";

const prov = (page: number, t = 700) => [{ page_no: page, bbox: { l: 72, t, r: 300, b: t - 20, coord_origin: "BOTTOMLEFT" } }];
const doc = DoclingDocument.parse({
  body: { children: [{ $ref: "#/texts/0" }, { $ref: "#/texts/1" }, { $ref: "#/groups/0" }, { $ref: "#/tables/0" }, { $ref: "#/tables/1" }, { $ref: "#/pictures/0" }, { $ref: "#/texts/5" }, { $ref: "#/texts/6" }] },
  texts: [
    { self_ref: "#/texts/0", label: "title", text: "Primer", prov: prov(1) },
    { self_ref: "#/texts/1", label: "text", text: "Plants *use* light.", prov: prov(1, 650) },
    { self_ref: "#/texts/2", label: "list_item", text: "one", prov: prov(1, 600) },
    { self_ref: "#/texts/3", label: "list_item", text: "two", prov: prov(1, 585) },
    { self_ref: "#/texts/4", label: "caption", text: "Figure 1. Chloroplast.", prov: prov(1, 300) },
    { self_ref: "#/texts/5", label: "page_footer", text: "Page 1", prov: prov(1, 30) },
    { self_ref: "#/texts/6", label: "formula", text: "", prov: prov(2, 500) },
  ],
  groups: [{ self_ref: "#/groups/0", label: "list", children: [{ $ref: "#/texts/2" }, { $ref: "#/texts/3" }] }],
  tables: [
    { self_ref: "#/tables/0", label: "table", prov: prov(2), data: { grid: [[{ text: "Input" }, { text: "Out|put" }], [{ text: "CO2" }, { text: "Glucose" }]] } },
    { self_ref: "#/tables/1", label: "table", prov: prov(2, 400), data: { grid: [[{ text: "A", row_span: 2 }, { text: "B" }], [{ text: "A", row_span: 2 }, { text: "C" }]] } },
  ],
  pictures: [{ self_ref: "#/pictures/0", label: "picture", prov: prov(1, 400), captions: [{ $ref: "#/texts/4" }] }],
  pages: { "1": { size: { width: 612, height: 792 }, page_no: 1 }, "2": { size: { width: 612, height: 792 }, page_no: 2 } },
});

describe("doclingBlocks", () => {
  it("renders reading order, lists, tables, pictures and skips furniture", () => {
    const blocks = doclingBlocks(doc);
    expect(blocks.map((b) => [b.type, b.crop ? "crop" : b.markdown])).toEqual([
      ["heading", "# Primer"],
      ["paragraph", "Plants \\*use\\* light."],
      ["list", "- one\n- two"],
      ["table", "| Input | Out\\|put |\n| --- | --- |\n| CO2 | Glucose |"],
      ["table", '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>'],
      ["figure", "crop"],
      ["paragraph", "Figure 1. Chloroplast."],
      ["math", "crop"],
    ]);
    expect(blocks[0]!.bbox).toEqual({ x: 72, y: 92, width: 228, height: 20 });
    expect(blocks.find((b) => b.type === "figure")!.markdown).toBe("Figure 1. Chloroplast.");
  });
});
```

The test expects the formula crop with type `math`, but `buildPdfCapture` stores every crop as a `figure` block with the label as alt text. That is consistent, because the stored block type for crops is decided in `buildPdfCapture`.

`apps/agent/src/pdf/both-paths.int.test.ts`:
```ts
import { readFile } from "node:fs/promises";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AssetStore } from "../notes/assets.ts";
import { testLogger } from "../testing/notes.ts";
import { createDoclingClient } from "./docling.ts";
import { buildPdfCapture } from "./pdf-capture.ts";

const DOCLING_IMAGE = "quay.io/docling-project/docling-serve-cpu:v1.36.0";
const fixture = async () => new Uint8Array(await readFile(new URL("../../../../tests/fixtures/sites/pdf/paper.pdf", import.meta.url)));
const assets: AssetStore = { put: async (_ws, input) => ({ assetId: crypto.randomUUID(), sha256: "x", mime: input.mime, bytes: input.bytes.length, width: input.width, height: input.height }) };
const ocr = { transcribe: async () => "Scanned page text" };

let docling: StartedTestContainer | undefined;
beforeAll(async () => {
  docling = await new GenericContainer(DOCLING_IMAGE)
    .withEnvironment({ DOCLING_SERVE_ENABLE_UI: "false" })
    .withExposedPorts(5001)
    .withWaitStrategy(Wait.forHttp("/health", 5001).forStatusCode(200))
    .withStartupTimeout(600_000)
    .start();
}, 900_000);
afterAll(async () => {
  await docling?.stop();
});

describe("B5 done-when: the PDF fixture is verified on both paths", () => {
  it("pdf.js path", async () => {
    const capture = await buildPdfCapture({ assets, ocr, docling: null, log: testLogger }, "w", await fixture(), "https://x.test/paper.pdf", new AbortController().signal);
    expect(capture).toMatchObject({ engine: "pdfjs" });
    expect(capture.coverage).toBeGreaterThanOrEqual(0.98);
  });
  it("docling path", async () => {
    const client = createDoclingClient(`http://${docling!.getHost()}:${docling!.getMappedPort(5001)}`);
    const capture = await buildPdfCapture({ assets, ocr, docling: client, log: testLogger }, "w", await fixture(), "https://x.test/paper.pdf", new AbortController().signal);
    expect(capture.engine).toBe("docling");
    expect(capture.coverage).toBeGreaterThanOrEqual(0.98);
    expect(capture.blocks.some((b) => b.type === "heading" && b.anchor?.page === 1)).toBe(true);
    expect(capture.blocks.every((b) => typeof b.anchor?.page === "number" && b.anchor.bbox !== undefined)).toBe(true);
  }, 600_000);
});
```

Add to `packages/contracts/src/env.test.ts`:
```ts
it("accepts an optional DOCLING_URL for the agent", () => {
  expect(parseEnv(AgentEnv, { ...agentSource, DOCLING_URL: "http://docling:5001" }).DOCLING_URL).toBe("http://docling:5001");
  expect(parseEnv(AgentEnv, { ...agentSource, DOCLING_URL: "" }).DOCLING_URL).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm exec vitest run --project unit apps/agent/src/pdf/docling.test.ts packages/contracts/src/env.test.ts`
Expected: FAIL. `DoclingDocument` is not exported, and `DOCLING_URL` is stripped.

- [ ] **Step 3: Implement.**

In `packages/contracts/src/env.ts`, inside `AgentEnv`, after `OPENAI_BASE_URL`, add:
```ts
  /** docling-serve base URL; set only with COMPOSE_PROFILES containing `pdf` (spec §7.6). */
  DOCLING_URL: z.url().optional(),
```

Replace `apps/agent/src/pdf/docling.ts` entirely:
```ts
import type { BBox } from "@mastertutor/contracts";
import { z } from "zod";
import { escapeMarkdownText } from "../capture/markdown-blocks.ts";

export interface DoclingBlock {
  type: "heading" | "paragraph" | "list" | "code" | "table" | "math" | "figure";
  markdown: string;
  page: number;
  bbox: BBox;
  /** Picture/formula region cropped from the page render; `markdown` is then its alt text. */
  crop: boolean;
}
export interface DoclingClient {
  convert(bytes: Uint8Array, filename: string, signal: AbortSignal): Promise<DoclingBlock[]>;
}

const Ref = z.object({ $ref: z.string() });
const Prov = z.object({
  page_no: z.number().int().positive(),
  bbox: z.object({ l: z.number(), t: z.number(), r: z.number(), b: z.number(), coord_origin: z.string().default("BOTTOMLEFT") }),
});
const Common = { self_ref: z.string(), label: z.string(), prov: z.array(Prov).default([]), children: z.array(Ref).default([]) };
const Cell = z.object({ text: z.string().default(""), row_span: z.number().default(1), col_span: z.number().default(1) });

export const DoclingDocument = z.object({
  body: z.object({ children: z.array(Ref) }),
  texts: z.array(z.object({ ...Common, text: z.string().default(""), level: z.number().optional(), enumerated: z.boolean().optional(), marker: z.string().optional(), code_language: z.string().nullish() })).default([]),
  tables: z.array(z.object({ ...Common, captions: z.array(Ref).default([]), data: z.object({ grid: z.array(z.array(Cell)).default([]) }) })).default([]),
  pictures: z.array(z.object({ ...Common, captions: z.array(Ref).default([]) })).default([]),
  groups: z.array(z.object({ self_ref: z.string(), label: z.string(), children: z.array(Ref).default([]) })).default([]),
  pages: z.record(z.string(), z.object({ size: z.object({ width: z.number(), height: z.number() }), page_no: z.number() })).default({}),
});
export type DoclingDocument = z.infer<typeof DoclingDocument>;

const ConvertResponse = z.object({
  status: z.string(),
  document: z.object({ json_content: z.unknown().nullable().optional() }),
});

const FURNITURE = new Set(["page_header", "page_footer"]);
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function tableMarkdown(grid: z.infer<typeof Cell>[][]): string {
  const complex = grid.some((row) => row.some((cell) => cell.row_span > 1 || cell.col_span > 1));
  if (!complex && grid.length > 0) {
    const row = (cells: z.infer<typeof Cell>[]) => `| ${cells.map((c) => c.text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()).join(" | ")} |`;
    return [row(grid[0]!), `| ${grid[0]!.map(() => "---").join(" | ")} |`, ...grid.slice(1).map(row)].join("\n");
  }
  // Docling repeats spanned cells in the grid; emit each origin cell once with its spans.
  const seen = new Set<string>();
  const rows = grid.map((cells, r) => {
    const tds = cells.flatMap((cell, c) => {
      const key = `${cell.text}|${cell.row_span}|${cell.col_span}`;
      const spanned = (r > 0 && cell.row_span > 1 && seen.has(`${key}@c${c}`)) || (c > 0 && cell.col_span > 1 && seen.has(`${key}@r${r}`));
      if (cell.row_span > 1) seen.add(`${key}@c${c}`);
      if (cell.col_span > 1) seen.add(`${key}@r${r}`);
      if (spanned) return [];
      const attrs = `${cell.row_span > 1 ? ` rowspan="${cell.row_span}"` : ""}${cell.col_span > 1 ? ` colspan="${cell.col_span}"` : ""}`;
      return [`<td${attrs}>${escapeHtml(cell.text)}</td>`];
    });
    return `<tr>${tds.join("")}</tr>`;
  });
  return `<table>${rows.join("")}</table>`;
}

/** Walks docling's reading order (body tree) into blocks with page + top-left bbox anchors. */
export function doclingBlocks(doc: DoclingDocument): DoclingBlock[] {
  const out: DoclingBlock[] = [];
  const visited = new Set<string>();
  let list: { lines: string[]; page: number; boxes: BBox[] } | null = null;
  const bboxOf = (prov: z.infer<typeof Prov>[]): { page: number; bbox: BBox } => {
    const first = prov[0];
    if (!first) return { page: 1, bbox: { x: 0, y: 0, width: 0, height: 0 } };
    const height = doc.pages[String(first.page_no)]?.size.height ?? 792;
    const { l, t, r, b, coord_origin } = first.bbox;
    const top = coord_origin === "TOPLEFT" ? t : height - t;
    return { page: first.page_no, bbox: { x: l, y: top, width: r - l, height: Math.abs(t - b) } };
  };
  const flushList = () => {
    if (!list) return;
    const x = Math.min(...list.boxes.map((b) => b.x));
    const y = Math.min(...list.boxes.map((b) => b.y));
    const width = Math.max(...list.boxes.map((b) => b.x + b.width)) - x;
    const height = Math.max(...list.boxes.map((b) => b.y + b.height)) - y;
    out.push({ type: "list", markdown: list.lines.join("\n"), page: list.page, bbox: { x, y, width, height }, crop: false });
    list = null;
  };
  const resolve = (ref: string) => {
    const match = /^#\/(texts|tables|pictures|groups)\/(\d+)$/.exec(ref);
    if (!match) return null;
    const index = Number(match[2]);
    switch (match[1]) {
      case "texts": return { kind: "text" as const, item: doc.texts[index] };
      case "tables": return { kind: "table" as const, item: doc.tables[index] };
      case "pictures": return { kind: "picture" as const, item: doc.pictures[index] };
      default: return { kind: "group" as const, item: doc.groups[index] };
    }
  };
  const visit = (ref: string): void => {
    if (visited.has(ref)) return;
    visited.add(ref);
    const node = resolve(ref);
    if (!node?.item) return;
    if (node.kind === "group") {
      for (const child of node.item.children) visit(child.$ref);
      flushList();
      return;
    }
    if (node.kind === "text") {
      const text = node.item;
      if (FURNITURE.has(text.label)) return;
      const { page, bbox } = bboxOf(text.prov);
      if (text.label === "list_item") {
        const marker = text.enumerated ? `${text.marker?.replace(/[^\d]/g, "") || (list?.lines.length ?? 0) + 1}. ` : "- ";
        list ??= { lines: [], page, boxes: [] };
        list.lines.push(`${marker}${escapeMarkdownText(text.text.trim())}`);
        list.boxes.push(bbox);
      } else {
        flushList();
        if (text.label === "title") out.push({ type: "heading", markdown: `# ${escapeMarkdownText(text.text.trim())}`, page, bbox, crop: false });
        else if (text.label === "section_header") out.push({ type: "heading", markdown: `${"#".repeat(Math.min(6, (text.level ?? 1) + 1))} ${escapeMarkdownText(text.text.trim())}`, page, bbox, crop: false });
        else if (text.label === "code") out.push({ type: "code", markdown: `\`\`\`${text.code_language ?? ""}\n${text.text}\n\`\`\``, page, bbox, crop: false });
        else if (text.label === "formula") out.push(text.text.trim() ? { type: "math", markdown: `$$\n${text.text.trim()}\n$$`, page, bbox, crop: false } : { type: "math", markdown: "Formula", page, bbox, crop: true });
        else if (text.text.trim()) out.push({ type: "paragraph", markdown: escapeMarkdownText(text.text.trim()), page, bbox, crop: false });
      }
      for (const child of text.children) visit(child.$ref);
      return;
    }
    flushList();
    const { page, bbox } = bboxOf(node.item.prov);
    if (node.kind === "table") {
      out.push({ type: "table", markdown: tableMarkdown(node.item.data.grid), page, bbox, crop: false });
    } else {
      const caption = node.item.captions.map((c) => resolve(c.$ref)).find((n) => n?.kind === "text")?.item as { text?: string } | undefined;
      out.push({ type: "figure", markdown: (caption?.text ?? "Figure").trim(), page, bbox, crop: true });
    }
    for (const caption of node.item.captions) visit(caption.$ref);
    for (const child of node.item.children) visit(child.$ref);
  };
  for (const child of doc.body.children) visit(child.$ref);
  flushList();
  return out;
}

export function createDoclingClient(baseUrl: string, options: { timeoutMs?: number } = {}): DoclingClient {
  return {
    async convert(bytes, filename, signal) {
      const form = new FormData();
      form.append("files", new Blob([bytes], { type: "application/pdf" }), filename);
      form.append("to_formats", "json");
      form.append("image_export_mode", "placeholder");
      form.append("do_ocr", "true");
      const response = await fetch(new URL("/v1/convert/file", baseUrl), {
        method: "POST",
        body: form,
        signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 180_000)]),
      });
      if (!response.ok) throw new Error(`docling HTTP ${response.status}`);
      const body = ConvertResponse.parse(await response.json());
      if (body.status === "failure" || !body.document.json_content) throw new Error(`docling status ${body.status}`);
      return doclingBlocks(DoclingDocument.parse(body.document.json_content));
    },
  };
}
```

Agent → docling is the one Node `fetch` the agent makes. Its target is the internal `DOCLING_URL` from env, never a page URL, so Global Constraint 1 still holds.

In `apps/agent/src/library.ts`, set `docling: deps.env.DOCLING_URL ? createDoclingClient(deps.env.DOCLING_URL) : null`.

In `compose.yml`, add the service (before `browser-1`):
```yaml
  docling:
    image: quay.io/docling-project/docling-serve-cpu:v1.36.0
    profiles: ["pdf"]
    restart: unless-stopped
    environment:
      DOCLING_SERVE_ENABLE_UI: "false"
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5001/health', timeout=3).status == 200 else 1)"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 120s
    networks:
      - backend
```
In `agent.environment`, add `DOCLING_URL: ${DOCLING_URL:-}`. In `agent.depends_on`, add:
```yaml
      docling:
        condition: service_healthy
        required: false
```
In `.env.example`, add:
```
# Set only when COMPOSE_PROFILES includes "pdf" (docling-serve, high-fidelity PDF path).
DOCLING_URL=
```
If Phase 0's `compose-config.int.test.ts` lists the expected agent env keys, add `DOCLING_URL` there.

- [ ] **Step 4: Run the tests to verify they pass, checking disk first.**

Run: `pnpm exec vitest run --project unit apps/agent/src/pdf packages/contracts && pnpm typecheck && pnpm lint`
Expected: PASS.

Then check that there is room for the docling image before pulling it:
Run: `df -h / | tail -1 && docker system df`
Expected: at least 10 GB free. If there is less, report a blocking issue to the orchestrator instead of continuing.

Run: `pnpm exec vitest run --project integration apps/agent/src/pdf/both-paths.int.test.ts`
Expected: PASS for both cases. This is the B5 "done when". The first run pulls the image, which takes several minutes.

Run: `docker compose --env-file .env.test -f compose.yml --profile pdf config --quiet && docker image rm quay.io/docling-project/docling-serve-cpu:v1.36.0 && docker builder prune -f`
Expected: the Compose config validates. The image is removed afterwards to reclaim dev-box disk; CI and production pull it under profile `pdf`.

- [ ] **Step 5: Commit.**
```bash
git add packages/contracts apps/agent compose.yml .env.example tests/compose
git commit -m "feat(pdf): docling-serve profile and client; PDF fixture verified on pdf.js and docling paths"
```

---

## Notes for later phases (decisions made here that they must follow)

1. **Block order.** Order `note_blocks` with `position COLLATE "C"`. Fractional keys are base62 in ASCII order, so the default collation misorders them. This applies to F2, Phase 7 and every SQL ordering.
2. **Asset references.** Blocks reference assets as `asset:<uuid>` inside Markdown link and image targets. F2 renders them with `replaceAssetUris(md, id => "/api/assets/" + id)`. Export does its own mapping.
3. **Object reads go through `web`.**
   - The routes are `/api/assets/:id`, `/api/sources/:id/snapshot/page.png|page.mhtml` and `/api/notes/:id/export`.
   - They need the session cookie and send CSP `sandbox` and `nosniff`. B6 downloads should reuse `OBJECT_HEADERS` and the same pattern.
   - No presigned Garage URL leaves `web`.
4. **Handlers ready for the oRPC binder (Phase 7).** Library handlers live in `apps/web/lib/server/library/*`:

   | Procedure | Handler |
   |---|---|
   | `notes.search` | `searchNotes` |
   | `notes.export` | `exportNote` |
   | `assets.url` | `assetUrl` |
   | `folders.*` | `folderTree`, `createFolderHandler`, `renameFolderHandler`, `moveFolderHandler`, `deleteFolderHandler` |
   | `notes.move` | `moveNoteHandler` |

   They take `LibraryCtx` and throw `LibraryError` with codes that map 1:1 to `ORPCError` codes. `notes.list`, `get`, `updateBlock`, `markVerified` and `delete` are not implemented here. `markVerified` must recompute fidelity with the contracts rule `noteFidelity`.
5. **Fidelity.** Unverified `ocr_model` and `asr` blocks force `needs_review` (`REVIEW_ORIGINS`). "Mark verified" in F2 sets `verified=true` and recomputes.
6. **Video checkpoint (B1).** The `video_time` checkpoint can read `pageVideoState().currentTime` from `apps/agent/src/video/page/player.ts`, run through an isolated world.
7. **Docling.** It is enabled only with `COMPOSE_PROFILES=pdf` plus `DOCLING_URL=http://docling:5001` (Phase 9 deploy). Without it, PDFs use pdf.js.
8. **Slot audio.** Every slot now loads Pulse TCP on 4713 for `CDP_ALLOWED_IP` only. B6's SSRF test list (spec §12) already covers 4713 from other slots.
9. **One `LibraryServices` per agent process.** It is shared by `createFunctionTools(deps, library)` and `createRunHooks(library)`.

---

## Self-Review

**1. Spec coverage:**

| Requirement (spec §7, §8, §16 B2/B4/B5; brief) | Task(s) |
|---|---|
| Snapshot: MHTML + full-page capture, hashed, `snapshots/<sourceId>/` | 7, 8 |
| Prepare: scroll until stable (cap 50), network idle, eager loading, iframes per frame, closed shadow roots via CDP | 5, 6, 8 |
| Defuddle in a CDP isolated world, Readability fallback; LaTeX math, code language, raw-HTML complex tables | 5, 6 |
| Assets: largest srcset/currentSrc, inline SVG with computed styles, canvas `toDataURL` with screenshot fallback, chart element shots at `clip.scale: 2`, content-addressed | 6, 7 |
| Verify: NFKC, coverage ≥ 98% gives verified, `content_sha256`, selector/xpath/offsets/text fragment per block | 3, 6, 8 |
| Opaque content: image plus `gpt-6-astra` transcription, `ocr_model`, needs_review | 8, 23 |
| `capture` and `annotate` tools | 8, 9 |
| `NoteWriter`, one note per run, `original_markdown`/`edited` left to F2 | 4 |
| Folders and auto-filing with `gpt-6-luna`, at most one new leaf, target folder | 1, 10, 14 |
| Embeddings (agent embeds blocks) and hybrid search API (web embeds queries, RRF) | 2, 4, 12, 15 |
| Obsidian Markdown export | 13 |
| Object-read decision (Phase 0 note 5) | 11, decision 1 |
| Block full-text (Phase 0 note 6) | 1 |
| `captions` via timedtext + `Network.getResponseBody` | 18, 21 |
| `chapters` from `ytInitialData` with description fallback | 17, 21 |
| `keyframes`: 2 s seek + `seeked`, clipped CDP screenshot, `sharp` pHash ≤ 6, last frame before change, DRM < 3% | 19, 21 |
| `transcribe`: remote Pulse on 4713, ffmpeg in the agent, 10-minute chunks, `gpt-4o-transcribe-diarize`, audio deleted after commit | 16, 20, 21 |
| Note layout: per chapter, transcript interleaved with keyframes, `[mm:ss]` | 16, 18, 21 |
| PDF: pdf.js text layer plus page images; docling-serve profile; both verified against pdf.js text; anchors with page and bbox | 22–24 |
| Fixtures: article, docs (tables, code, math, lazy images, iframe, shadow DOM), fake YouTube, PDF | 5, 6, 8, 16, 22 |
| Done-whens: B2 coverage on fixtures, B4 chaptered note, B5 both paths | 8, 21, 24 |

**2. Placeholder scan.**
- There is no "TBD", "add validation" or "similar to Task N".
- Two fixtures are described as copy-and-edit of a complete file, with the exact edits listed: `watch-nocc.html`/`drm.html` and the article's `hero-1280.svg`.
- B1-owned files (`tools/index.ts`, `main.ts`, `llm-mock/src/routes.ts`) get precise insertion instructions, because their surrounding content belongs to B1.
- The temporary `docling.ts` in Task 23 is fully replaced in Task 24.

**3. Type consistency:**
- `BlockDraft`, `TimedBlockDraft`, `timeAnchor`, `appendBlocks`/`appendTimedBlocks`/`stageBlockRows`, `stageQuality(step, noteId, coverage | null)` and `stageSourceMeta` are used identically in Tasks 4, 8, 9, 16, 21 and 23.
- `LibraryServices` grows by exactly these fields, and every construction site (`createLibraryServices`, `startCaptureEnv`, the annotate test literal) is updated in each task that adds one:
  - `filing` and `db` (Task 10);
  - `transcriber` (Task 20);
  - `docling` (Task 23 sets it to `null`, Task 24 wires it).
- `blockPlainText` takes `{type: string; markdown: string}` from Task 8 onward, and `figure` is handled.
- `DoclingBlock` and `DoclingClient` keep the same shape across Tasks 23 and 24.
- `CaptureResult`, `AnnotateResult` and `VideoResult` are exactly Phase 0's contracts.

**4. Review Focus mapping:**

| # | Concern | Test |
|---|---|---|
| 1 | SSRF through asset URLs | Task 7 `fetch-resource.test.ts` and `media.test.ts` |
| 2 | Stored SVG XSS | Task 7 `images.test.ts`; Task 11 `objects.int.test.ts` |
| 3 | Cross-run annotate | Task 9 `annotate-tool.int.test.ts` (also Task 4 `assertRunNote`) |
| 4 | Garbage from the filing model | Task 10 `filing.test.ts` |
| 5 | Hostile export titles and URLs | Task 13 `export.test.ts` |

Also covered:
- tsquery syntax in search (Task 12);
- infinite scroll cap and abort (Task 5);
- duplicate captures (Task 8);
- PDF magic-byte check (Task 23);
- DRM-black video (Tasks 19 and 21).

**5. Recorded deviations from the spec:**
- Asset fetching uses `Network.loadNetworkResource` instead of `page.request` (decision 3).
- The order is prepare → snapshot (decision 4).
- MHTML is skipped when the page has secret fields (decision 5).
- Assets are written outside the step transaction (decision 6).
- ASR counts as a review origin (decision 8).
- Cross-site iframes are skipped (decision 10).

---

**Execution:** Per D30/D35 the method is already chosen: subagent-driven development. Please review the plan and confirm it captures what you want.
