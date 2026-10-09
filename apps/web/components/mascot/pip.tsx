"use client";

import { useEffect, useRef, useState } from "react";
import { whenIdle } from "@/lib/when-idle.ts";
import { PipFrame } from "./pip-frame.tsx";
import { pipMode, readEnvironment } from "./pip-gate.ts";
import type { PipAccessory, PipProps } from "./pip-types.ts";
import type { PipHandle, PipView } from "./scene/stage.ts";

const NONE: readonly PipAccessory[] = [];

/**
 * Pip, the mascot. The poster shows first; the 3D scene (three) is imported only near the
 * viewport, when the browser is idle, and only when the gate allows it (D43, D49). State,
 * accessories and look target flow into the live scene without remounting it.
 */
export function Pip({
  state,
  size,
  lookAt = null,
  accessories = NONE,
  onPoke,
  label = "Pip",
}: PipProps) {
  const hostRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<PipHandle | null>(null);
  const viewRef = useRef<PipView>({ state, accessories, lookAt });
  viewRef.current = { state, accessories, lookAt };
  const [live, setLive] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let loading = false;
    let near = false;
    let cancelIdle = () => undefined as void;

    const load = () => {
      if (disposed || !near || loading || handleRef.current) return;
      if (pipMode(readEnvironment(window.location.search, reduce.matches)) !== "live") return;
      loading = true;
      import("./scene/stage.ts")
        .then((stage) => {
          loading = false;
          if (disposed) return;
          handleRef.current = stage.mountPip(host, canvas, size, viewRef.current, setLive);
        })
        .catch(() => {
          loading = false; // The poster stays; a failed scene is never fatal.
        });
    };
    const unload = () => {
      handleRef.current?.destroy();
      handleRef.current = null;
      setLive(false);
    };

    const io = new IntersectionObserver(
      (entries) => {
        near = entries.some((e) => e.isIntersecting);
        cancelIdle();
        if (near) cancelIdle = whenIdle(load, 800);
      },
      { rootMargin: "200px" },
    );
    io.observe(host);
    const onReduce = () => (reduce.matches ? unload() : load());
    reduce.addEventListener("change", onReduce);
    return () => {
      disposed = true;
      io.disconnect();
      cancelIdle();
      reduce.removeEventListener("change", onReduce);
      unload();
    };
  }, [size]);

  useEffect(() => {
    handleRef.current?.update({ state, accessories, lookAt });
  }, [state, accessories, lookAt]);

  const poke = onPoke
    ? () => {
        handleRef.current?.poke();
        onPoke();
      }
    : undefined;

  return (
    <PipFrame
      state={state}
      size={size}
      label={label}
      live={live}
      onPoke={poke}
      hostRef={hostRef}
      canvasRef={canvasRef}
    />
  );
}

export default Pip;
