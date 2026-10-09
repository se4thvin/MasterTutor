import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  type Texture,
} from "three";
import { PIP_CONTEXT } from "../pip-gate.ts";
import type { PipAccessory, PipPoint, PipSize, PipState } from "../pip-types.ts";
import { lookToward, type Look } from "../motion/look.ts";
import { PipInstance, posterInstance } from "./instance.ts";
import { measureRig } from "./rig.ts";
import { FRAMING } from "./shape.ts";
import { bakeEnvironment, shadowCatcher, studioLights } from "./studio.ts";

/**
 * One WebGL renderer for every Pip on the page. Each Pip owns a plain 2D canvas; the stage
 * renders a Pip into the corner of its own (hidden) WebGL canvas and copies that region across.
 * The loop runs only while some Pip is on screen and the tab is visible: offscreen, hidden or
 * with no Pips there is no GPU work at all, and the renderer is released a little after the
 * last Pip leaves.
 */

export interface PipView {
  state: PipState;
  accessories: readonly PipAccessory[];
  lookAt: "cursor" | PipPoint | null;
}

export interface PipHandle {
  update(view: PipView): void;
  poke(): void;
  destroy(): void;
}

interface Entry {
  pip: PipInstance;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: PipSize;
  lookAt: PipView["lookAt"];
  visible: boolean;
  live: boolean;
  lastFrameMs: number;
  onLive(live: boolean): void;
}

/** Device pixels per CSS pixel, capped: Pip is soft clay, 2× is already crisp. */
const MAX_DPR = 2;
/** Calm states and compact Pips draw at 30 fps; anything that moves draws every frame. */
const CALM_FRAME_MS = 1000 / 30 - 1;
const CALM: ReadonlySet<PipState> = new Set(["idle", "dozing"]);
const RELEASE_AFTER_MS = 15_000;
const FOV = 22;
const TILT = (8 * Math.PI) / 180;

interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  environment: Texture;
  cameras: Record<PipSize, PerspectiveCamera>;
  entries: Set<Entry>;
  observer: IntersectionObserver;
  raf: number;
  pointer: PipPoint | null;
  pointerAt: number;
  release: ReturnType<typeof setTimeout> | undefined;
  lost: boolean;
  dispose(): void;
}

interface PipStats {
  frames: number;
  /** Script time per rendered Pip frame (ms): update + render + copy. Last 600. */
  tickMs: number[];
  /** The motion part of it (blend, blink, look, sprout, pose): Pip's own CPU work. Last 600. */
  updateMs: number[];
  /** Milliseconds between loop frames. Last 600. */
  frameGapMs: number[];
  live: number;
  triangles: number;
  meshes: number;
}

const debug = typeof window !== "undefined" && new URLSearchParams(location.search).has("debug");
const stats: PipStats | null = debug
  ? { frames: 0, tickMs: [], updateMs: [], frameGapMs: [], live: 0, triangles: 0, meshes: 0 }
  : null;
const push = (list: number[], value: number) => {
  list.push(value);
  if (list.length > 600) list.shift();
};

let stage: Stage | null = null;

function camera(size: PipSize): PerspectiveCamera {
  const f = FRAMING[size];
  const cam = new PerspectiveCamera(FOV, 1, 0.1, 30);
  const distance = f.half / Math.tan((FOV * Math.PI) / 360);
  cam.position.set(f.cx, f.cy + distance * Math.sin(TILT), distance * Math.cos(TILT));
  cam.lookAt(f.cx, f.cy, 0);
  return cam;
}

function isDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function createStage(): Stage {
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, ...PIP_CONTEXT });
  renderer.setPixelRatio(1);
  renderer.setSize(64, 64, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  // ACES keeps the clay's teal saturated (AgX greyed it, measured side by side).
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setScissorTest(true);

  const scene = new Scene();
  const environment = bakeEnvironment(renderer);
  scene.environment = environment;
  scene.environmentIntensity = 0.35;
  const lights = studioLights(isDark());
  scene.add(lights.key, lights.key.target, lights.fill, lights.rim, shadowCatcher());

  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const onTheme = () => {
    lights.rim.intensity = dark.matches ? 2.6 : 1.5;
  };
  dark.addEventListener("change", onTheme);

  const s: Stage = {
    renderer,
    scene,
    environment,
    cameras: { hero: camera("hero"), compact: camera("compact") },
    entries: new Set(),
    observer: new IntersectionObserver((records) => {
      for (const record of records) {
        for (const entry of s.entries) {
          if (entry.host !== record.target) continue;
          entry.visible = record.isIntersecting;
          if (!entry.visible) setLive(entry, false);
        }
      }
      wake();
    }),
    raf: 0,
    pointer: null,
    pointerAt: 0,
    release: undefined,
    lost: false,
    dispose() {
      cancelAnimationFrame(s.raf);
      s.observer.disconnect();
      dark.removeEventListener("change", onTheme);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", wake);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  canvas.addEventListener("webglcontextlost", () => {
    // Never fatal: every Pip falls back to its poster.
    s.lost = true;
    for (const entry of s.entries) setLive(entry, false);
  });
  const onPointer = (e: PointerEvent) => {
    s.pointer = { x: e.clientX, y: e.clientY };
    s.pointerAt = performance.now();
  };
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("visibilitychange", wake);
  if (stats) Object.assign(stats, measureRig());
  return s;
}

function setLive(entry: Entry, live: boolean): void {
  if (entry.live === live) return;
  entry.live = live;
  entry.onLive(live);
  if (stats && stage) stats.live = [...stage.entries].filter((e) => e.live).length;
}

function wake(): void {
  if (!stage || stage.raf || stage.lost || document.hidden) return;
  if (![...stage.entries].some((e) => e.visible)) return;
  stage.raf = requestAnimationFrame(frame);
}

function lookFor(entry: Entry, s: Stage): Look {
  const target = entry.lookAt === "cursor" ? s.pointer : entry.lookAt;
  if (!target) return { yaw: 0, pitch: 0 };
  return lookToward(target, entry.host.getBoundingClientRect());
}

function due(entry: Entry, nowMs: number, s: Stage): boolean {
  const calm =
    entry.size === "compact" ||
    (CALM.has(entry.pip.state) && !(entry.lookAt === "cursor" && nowMs - s.pointerAt < 1000));
  return !calm || nowMs - entry.lastFrameMs >= CALM_FRAME_MS;
}

let lastLoopMs = 0;

function frame(nowMs: number): void {
  const s = stage;
  if (!s) return;
  s.raf = 0;
  if (stats) {
    if (lastLoopMs) push(stats.frameGapMs, nowMs - lastLoopMs);
    lastLoopMs = nowMs;
  }
  let any = false;
  for (const entry of s.entries) {
    if (!entry.visible) continue;
    any = true;
    if (!due(entry, nowMs, s)) continue;
    const t0 = performance.now();
    const dt = entry.lastFrameMs ? Math.min((nowMs - entry.lastFrameMs) / 1000, 0.1) : 1 / 60;
    entry.lastFrameMs = nowMs;
    entry.pip.update(nowMs / 1000, dt, lookFor(entry, s));
    const t1 = performance.now();
    draw(s, entry);
    setLive(entry, true);
    if (stats) {
      stats.frames++;
      push(stats.updateMs, t1 - t0);
      push(stats.tickMs, performance.now() - t0);
    }
  }
  if (any && !document.hidden && !s.lost) s.raf = requestAnimationFrame(frame);
  else lastLoopMs = 0;
}

/** Renders one Pip into the shared canvas's bottom-left corner and copies it to its own canvas. */
function draw(s: Stage, entry: Entry): void {
  const rect = entry.host.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (entry.canvas.width !== w || entry.canvas.height !== h) {
    entry.canvas.width = w;
    entry.canvas.height = h;
  }
  renderInto(s, entry.pip, entry.size, w, h);
  const H = s.renderer.domElement.height;
  entry.ctx.clearRect(0, 0, w, h);
  entry.ctx.drawImage(s.renderer.domElement, 0, H - h, w, h, 0, 0, w, h);
}

function renderInto(s: Stage, pip: PipInstance, size: PipSize, w: number, h: number): void {
  const canvas = s.renderer.domElement;
  // Grow only: resizing the drawing buffer reallocates it.
  if (canvas.width < w || canvas.height < h)
    s.renderer.setSize(Math.max(canvas.width, w), Math.max(canvas.height, h), false);
  s.renderer.setViewport(0, 0, w, h);
  s.renderer.setScissor(0, 0, w, h);
  const cam = s.cameras[size];
  s.scene.add(pip.rig.group);
  s.renderer.render(s.scene, cam);
  s.scene.remove(pip.rig.group);
}

/** Mounts a live Pip on `host`, drawing into `canvas`. Returns null when WebGL is unavailable. */
export function mountPip(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  size: PipSize,
  view: PipView,
  onLive: (live: boolean) => void,
): PipHandle | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    stage ??= createStage();
  } catch {
    return null;
  }
  const s = stage;
  if (s.lost) return null;
  clearTimeout(s.release);
  const now = performance.now() / 1000;
  const pip = new PipInstance(view.state, now, size === "compact");
  pip.setAccessories(view.accessories);
  const entry: Entry = {
    pip,
    host,
    canvas,
    ctx,
    size,
    lookAt: view.lookAt,
    visible: false,
    live: false,
    lastFrameMs: 0,
    onLive,
  };
  s.entries.add(entry);
  s.observer.observe(host);
  return {
    update(next) {
      pip.setState(next.state, performance.now() / 1000);
      pip.setAccessories(next.accessories);
      entry.lookAt = next.lookAt;
      wake();
    },
    poke() {
      pip.poke(performance.now() / 1000);
      wake();
    },
    destroy() {
      s.entries.delete(entry);
      s.observer.unobserve(host);
      pip.dispose();
      if (s.entries.size === 0) {
        s.release = setTimeout(() => {
          if (stage !== s || s.entries.size > 0) return;
          s.dispose();
          stage = null;
        }, RELEASE_AFTER_MS);
      }
    },
  };
}

/** The moment in each state a poster freezes (seconds after entering it). */
const POSTER_MOMENT: Record<PipState, number> = {
  idle: 0.8,
  attentive: 1,
  thinking: 2,
  working: 1.05,
  waiting: 1.2,
  waving: 1.17,
  celebrating: 2.5,
  dozing: 2.4,
  oops: 1.6,
  reading: 1.1,
};

/** Renders one deterministic poster frame as a WebP data URL (the poster script uses this). */
function capturePoster(state: PipState, size: PipSize, px: number): string {
  stage ??= createStage();
  const s = stage;
  const pip = posterInstance(state, size === "compact", []);
  const step = 1 / 60;
  for (let t = step; t <= POSTER_MOMENT[state] + 1e-6; t += step) {
    pip.update(t, step, { yaw: 0, pitch: 0 });
  }
  renderInto(s, pip, size, px, px);
  const out = document.createElement("canvas");
  out.width = out.height = px;
  const H = s.renderer.domElement.height;
  out.getContext("2d")?.drawImage(s.renderer.domElement, 0, H - px, px, px, 0, 0, px, px);
  pip.dispose();
  return out.toDataURL("image/webp", 0.9);
}

if (stats) (window as unknown as { __pipStats: PipStats }).__pipStats = stats;
// The poster script (scripts/render-pip-posters.ts) renders through this hook on the gallery.
if (typeof window !== "undefined" && new URLSearchParams(location.search).has("capture")) {
  (window as unknown as { __pipCapture: typeof capturePoster }).__pipCapture = capturePoster;
}
