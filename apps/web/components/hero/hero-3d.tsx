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

// Safari has no requestIdleCallback; a short timeout still waits for hydration to finish.
const idle = (fn: () => void) => {
  if ("requestIdleCallback" in window) window.requestIdleCallback(fn, { timeout: 800 });
  else setTimeout(fn, 1);
};

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
