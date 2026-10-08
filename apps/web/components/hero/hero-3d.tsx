"use client";

import { useEffect, useRef } from "react";
import { durations } from "@/lib/motion-tokens.ts";
import { whenIdle } from "@/lib/when-idle.ts";
import { HERO_EVENTS } from "./hero-events.ts";
import {
  CONTEXT_ATTRIBUTES,
  isSoftwareGL,
  shouldLoad3D,
  type HeroEnvironment,
} from "./hero-gate.ts";
import { PosterArt } from "./hero-poster.tsx";

interface HeroInstance {
  destroy(): void;
}

type HintedNavigator = Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };

/**
 * A WebGL2 constructor does not prove a context can be made (a blocklisted GPU): ask the hero's
 * own canvas before downloading three (final M2), and whether it draws on the CPU (D49). The scene
 * later gets this same context.
 */
function probeContext(el: HTMLElement): Pick<HeroEnvironment, "hasWebGL2" | "softwareGL"> {
  const gl = el.querySelector("canvas")?.getContext("webgl2", CONTEXT_ATTRIBUTES);
  return gl
    ? { hasWebGL2: true, softwareGL: isSoftwareGL(gl) }
    : { hasWebGL2: false, softwareGL: false };
}

function environment(
  el: HTMLElement,
  params: URLSearchParams,
  reduce: MediaQueryList,
): HeroEnvironment {
  const nav = navigator as HintedNavigator;
  const cheap: HeroEnvironment = {
    reducedMotion: reduce.matches,
    hasWebGL2: true,
    softwareGL: false,
    forcePoster: params.get("hero") === "poster",
    forceLive: params.get("hero") === "live",
    saveData: nav.connection?.saveData === true,
    lowMemory: nav.deviceMemory !== undefined && nav.deviceMemory < 4,
  };
  // The context is the costly check: only made when nothing else already keeps the poster.
  return shouldLoad3D(cheap) ? { ...cheap, ...probeContext(el) } : cheap;
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
    // Near the viewport (IntersectionObserver, 200px margin): the only place a scene loads (M6).
    let near = false;
    let cancelIdle = () => undefined as void;

    const load = () => {
      if (!near || loading || instance || !shouldLoad3D(environment(el, params, reduce))) return;
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
        near = entries.some((e) => e.isIntersecting);
        cancelIdle();
        if (near) cancelIdle = whenIdle(load, 800);
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
      cancelIdle();
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
