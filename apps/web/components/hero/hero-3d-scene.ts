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
import { clamp01, cubicBezier } from "@/lib/easing.ts";
import { easings, springs } from "@/lib/motion-tokens.ts";
import { HERO_EVENTS } from "./hero-events.ts";
import { CONTEXT_ATTRIBUTES } from "./hero-gate.ts";
import {
  CAPTURE_END_S,
  PAGE_FLOW,
  RIPPLE_S,
  captureCues,
  dueCues,
  type CueKey,
} from "./scene/capture-timeline.ts";
import { bar, lathe, slab } from "./scene/geometry.ts";
import { LENS, lensProfile } from "./scene/lens-profile.ts";
import { createSpring, smoothstep, stepSprings } from "@/lib/spring.ts";
import { IDLE_AFTER_MS, shouldRender } from "./scene/pacing.ts";
import { pageTexture } from "./scene/page-texture.ts";
import { buildStudio, readSceneTokens } from "./scene/studio.ts";

interface HeroOptions {
  debug?: boolean;
}
export interface HeroInstance {
  destroy(): void;
}
interface HeroStats {
  frames: number;
  fps: number;
  dpr: number;
  captures: number;
  /** Drawing at the idle rate (final I3). */
  idle: boolean;
  /** Studio (PMREM) builds: only a theme change makes another (final M7). */
  studios: number;
}
declare global {
  interface Window {
    __heroStats?: HeroStats;
  }
}

const MAX_DPR = 2;
const SLOW_FRAME_MS = 24;
/** A long gap (a tab coming back) never jumps the capture more than this. */
const MAX_CAPTURE_STEP_S = 0.25;
const FRAGMENTS = 14;
const ease = { flow: cubicBezier(easings.standard), arc: cubicBezier(easings.cursor) };

export async function createHero(
  el: HTMLElement,
  options: HeroOptions = {},
): Promise<HeroInstance | null> {
  const canvas = el.querySelector("canvas");
  if (!canvas) return null;
  // A WebGL2 constructor does not prove a context can be created (P2): ask, and keep the poster if not.
  const context = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (!context) return null;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context, ...CONTEXT_ATTRIBUTES });
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
  const std = (p: ConstructorParameters<typeof MeshStandardMaterial>[0]) =>
    keep(new MeshStandardMaterial(p));
  const tokens = readSceneTokens();

  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 1, 0.1, 60);
  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(-3, 5, 6);
  scene.add(key);

  // Page (the web source)
  const paper = std({ color: 0xffffff, roughness: 0.62 });
  const pageMap = keep(pageTexture(renderer.capabilities.getMaxAnisotropy(), tokens));
  const page = new Mesh(keep(slab(2.0, 2.5, 0.09, 0.03, 0.012)), [
    std({ map: pageMap, roughness: 0.6 }),
    paper,
  ]);

  // Capture Lens: frosted aqua puck with a Bondi band and signal dot inside
  const glass = keep(
    new MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.17,
      transmission: 1,
      thickness: 1.1,
      ior: 1.46,
      dispersion: 0.25,
      attenuationColor: new Color(tokens.aqua),
      attenuationDistance: 1.15,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      specularIntensity: 1,
      envMapIntensity: 1.25,
    }),
  );
  const shell = new Mesh(keep(lathe(lensProfile())), glass);
  const band = new Mesh(
    keep(new TorusGeometry(0.73, 0.1, 24, 96)),
    keep(new MeshPhysicalMaterial({ color: tokens.bondi, roughness: 0.28, clearcoat: 0.8 })),
  );
  band.rotation.x = Math.PI / 2;
  band.scale.z = 1.25;
  const dotMat = std({
    color: tokens.signal,
    emissive: tokens.signal,
    emissiveIntensity: 0.3,
    roughness: 0.35,
  });
  const dot = new Mesh(keep(new CylinderGeometry(0.13, 0.13, 0.05, 48)), dotMat);
  dot.position.y = LENS.halfHeight - 0.06;
  const ringMat = keep(
    new MeshBasicMaterial({
      color: tokens.bondi,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const ring = new Mesh(keep(new RingGeometry(0.93, 1.0, 96)), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = LENS.halfHeight + LENS.dome + 0.01;
  const body = new Group();
  body.add(shell, band, dot, ring);
  const puck = new Group();
  puck.add(body);

  // Note card with lines that spring in one by one
  const note = new Group();
  note.add(
    new Mesh(
      keep(slab(1.35, 1.7, 0.08, 0.03, 0.012)),
      keep(new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, clearcoat: 0.4 })),
    ),
  );
  const ink = std({ color: 0x1d1d1f, roughness: 0.5 });
  const grey = std({ color: 0xd2d2d7, roughness: 0.6 });
  const blue = std({ color: tokens.tint, roughness: 0.5 });
  const aqua = std({ color: tokens.aqua, roughness: 0.45 });
  const lineSpec: [number, number, number, number, MeshStandardMaterial][] = [
    [0.28, 0.05, -0.55, 0.68, blue],
    [0.95, 0.09, -0.55, 0.53, ink],
    [0.6, 0.09, -0.55, 0.39, ink],
    [1.1, 0.42, -0.55, 0.05, aqua],
    [1.1, 0.045, -0.55, -0.34, grey],
    [1.04, 0.045, -0.55, -0.44, grey],
    [1.1, 0.045, -0.55, -0.54, grey],
    [0.68, 0.045, -0.55, -0.64, grey],
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
    active: false,
    t: 0,
    dur: 0.6,
    p0: new Vector3(),
    p1: new Vector3(),
    r0: new Vector3(),
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
  const shadowMat = keep(
    new MeshBasicMaterial({
      map: keep(new CanvasTexture(sc)),
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    }),
  );
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

  const stats: HeroStats = { frames: 0, fps: 0, dpr, captures: 0, idle: false, studios: 0 };
  if (options.debug) window.__heroStats = stats;

  // Theme (light/dark): background and studio follow --bg. Any class change on <html> is
  // observed; the studio is rebuilt only when the colours it mirrors changed (final M7).
  let themeKey = "";
  const applyTheme = () => {
    const t = readSceneTokens();
    const key = `${t.bg}|${t.signal}|${t.tint}`;
    if (key === themeKey) return;
    themeKey = key;
    stats.studios++;
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
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });

  // Motion state
  const S = {
    px: createSpring(0, springs.heroParallax),
    py: createSpring(0, springs.heroParallax),
    breath: createSpring(0, springs.spring),
    attn: createSpring(0, springs.heroAttention),
    note: createSpring(1, springs.spring),
    page: createSpring(1, springs.spring),
  };
  const lineS = lines.map(() => createSpring(1, springs.spring));
  const moving = [...Object.values(S), ...lineS];
  const cues = captureCues(lines.length);
  let flash = 0;
  let ringT = 1;
  let noteFromLens = false;
  let cap: { t: number; fired: Set<string> } | null = null;
  const tmp = new Vector3();

  const spawnFragment = (delay = 0) => {
    const f = frags.find((x) => !x.active);
    if (!f) return;
    page.updateMatrix();
    f.active = true;
    f.t = -delay;
    f.dur = 0.55 + Math.random() * 0.15;
    f.p0
      .set((Math.random() - 0.5) * 1.5, (Math.random() - 0.35) * 1.8, 0.06)
      .applyMatrix4(page.matrix);
    f.p1
      .copy(f.p0)
      .lerp(SLOT.puck.p, 0.5)
      .add(new Vector3(0.25 + Math.random() * 0.3, 0.8 + Math.random() * 0.4, 0.9));
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

  // Events from the composer (window, decoupled). Each one wakes the loop to full rate.
  let lastActive = performance.now();
  const touch = () => {
    lastActive = performance.now();
    stats.idle = false;
  };
  let lastType = 0;
  const onType = () => {
    touch();
    const now = performance.now();
    S.breath.v += 0.7;
    if (now - lastType > 80) {
      lastType = now;
      spawnFragment();
    }
    sync();
  };
  const onFocus = (e: Event) => {
    touch();
    S.attn.target = (e as CustomEvent<boolean>).detail ? 1 : 0;
    sync();
  };
  const onStart = () => {
    touch();
    cap ??= { t: 0, fired: new Set() };
    sync();
  };
  const onPointer = (e: PointerEvent) => {
    touch();
    const r = el.getBoundingClientRect();
    S.px.target = Math.max(
      -1,
      Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)),
    );
    S.py.target = Math.max(
      -1,
      Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)),
    );
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
  /** `dt` steps the springs (capped for stability); `wall` keeps the capture on the clock. */
  const update = (dt: number, wall = dt) => {
    clock += dt;
    if (cap) {
      // The capture keeps real time on a slow device, so it ends with the Start floor (P3).
      cap.t += wall;
      for (const cue of dueCues(cues, cap.t, cap.fired)) fire(cue);
      if (cap.t > CAPTURE_END_S) {
        cap = null;
        stats.captures++;
        window.dispatchEvent(new CustomEvent(HERO_EVENTS.captured));
      }
    }
    stepSprings(moving, dt);
    const t = clock;
    camera.position.set(fit.cx + S.px.x * 0.75, fit.cy + 0.35 - S.py.x * 0.45, fit.dist);
    camera.lookAt(fit.cx, fit.cy - 0.05, 0);
    rig.rotation.y = S.px.x * 0.1 + Math.sin(t * 0.21) * 0.035;
    rig.rotation.x = S.py.x * 0.05;

    puck.position.set(SLOT.puck.p.x, SLOT.puck.p.y + Math.sin(t * 0.8) * 0.07, SLOT.puck.p.z);
    puck.rotation.set(
      SLOT.puck.rx + Math.sin(t * 0.55) * 0.035 + S.attn.x * 0.1,
      0,
      Math.sin(t * 0.4) * 0.04 + S.attn.x * 0.08,
    );
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
      page.rotation.set(
        SLOT.page.r.x * (1 - f) + 0.6 * f,
        SLOT.page.r.y * (1 - f),
        SLOT.page.r.z + f * 0.5,
      );
      page.scale.setScalar(Math.max(0.001, 1 - 0.97 * f));
    } else {
      page.position.set(
        SLOT.page.p.x,
        SLOT.page.p.y + Math.sin(t * 0.7 + 1.3) * 0.05,
        SLOT.page.p.z,
      );
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
      f.mesh.position
        .copy(f.p0)
        .multiplyScalar(o * o)
        .addScaledVector(f.p1, 2 * o * e)
        .addScaledVector(puck.position, e * e);
      f.mesh.rotation.set(f.r0.x * o + 0.86 * e, f.r0.y * o, f.r0.z * o);
      f.mesh.scale.setScalar(
        Math.max(0.001, smoothstep(0, 0.18, u) * (1 - smoothstep(0.62, 1, u))),
      );
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
  let samples = 0;
  let downgrades = 0;
  const settled = () =>
    cap === null &&
    !frags.some((f) => f.active) &&
    moving.every((m) => Math.abs(m.v) < 1e-3 && Math.abs(m.x - m.target) < 1e-3);
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // Idle: nothing but the slow bob, so draw at about 30 fps (final I3).
    if (!settled()) lastActive = now;
    if (!shouldRender(now, lastActive, last)) return;
    stats.idle = now - lastActive >= IDLE_AFTER_MS;
    const interval = now - last;
    last = now;
    update(Math.min(interval / 1000, 1 / 20), Math.min(interval / 1000, MAX_CAPTURE_STEP_S));
    renderer.render(scene, camera);
    stats.frames++;
    // DPR adapts to full-rate frames only: idle frames are slow on purpose.
    if (stats.idle) {
      acc = 0;
      samples = 0;
      return;
    }
    acc += interval;
    samples++;
    if (samples === 60) {
      samples = 0;
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
