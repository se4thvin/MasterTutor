"use client";
/*
 * Adapted from React Bits "SwipeToast" (TS-TW).
 * Source:  https://reactbits.dev/r/SwipeToast-TS-TW.json
 * sha256:  675536a1a3a22ecd54d27c280e6662e4f17b6697782da29b6f1685c7343fef38 (fetched 2026-10-05)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: only transform and opacity animate; colours, radii and shadows come from our
 * tokens (styles/overlays.css) and the glyph from <Icon>; springs come from motion-tokens;
 * m.* under LazyMotion; useReducedMotion drops movement (fade only); the countdown pauses on
 * hover, focus, drag, a hidden tab and while the stack is held; inline mode (grid-template-rows animation), the
 * Tailwind arbitrary-value styling and unused props are removed.
 */
import { animate, m, useMotionValue, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon.tsx";
import { cx } from "@/lib/cx.ts";
import { durations, fuse, transitions } from "@/lib/motion-tokens.ts";

type SwipeToastCloseReason = "timeout" | "swipe" | "action" | "close" | "escape";

interface SwipeToastProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "danger";
  /** True while the pointer or focus is anywhere in the stack: every countdown waits. */
  held?: boolean;
  onClose: (reason: SwipeToastCloseReason) => void;
}

type Sample = [time: number, y: number];
const FLICK = 0.11;
const DEAD_ZONE = 3;
const RESIST_PX = 24;
const SWIPE_DISTANCE = 40;
const rubberband = (over: number, dim: number, c = 0.55) =>
  (over * dim * c) / (dim + c * Math.abs(over));
function velocityOf(hist: readonly Sample[]): number {
  const first = hist[0];
  const last = hist[hist.length - 1];
  if (!first || !last || hist.length < 2) return 0;
  return performance.now() - last[0] > 100
    ? 0
    : (last[1] - first[1]) / Math.max(1, last[0] - first[0]);
}

export function SwipeToast({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  tone = "neutral",
  held = false,
  onClose,
}: SwipeToastProps) {
  const reduce = useReducedMotion();
  const y = useMotionValue(0);
  const fade = useMotionValue(1);
  const cardRef = useRef<HTMLDivElement>(null);
  const fuseRef = useRef<HTMLElement>(null);
  const burn = useRef<Animation | null>(null);
  const drag = useRef<{ id: number; startY: number; grab: number | null; hist: Sample[] } | null>(
    null,
  );
  const flags = useRef({ hover: false, focus: false, drag: false, hidden: false, held: false });
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
    if (f.hover || f.focus || f.drag || f.hidden || f.held) a.pause();
    else if (a.playState === "paused") a.play();
  }, []);

  useEffect(() => {
    flags.current.held = held;
    syncFuse();
  }, [held, syncFuse]);

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
    flags.current.hidden = document.hidden;
    syncFuse();
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
      void animate(y, dy + cardRef.current.offsetHeight, {
        ...transitions.spring,
        velocity: v * 1000,
      });
    }
    void animate(fade, 0, transitions.exit).then(() => close("swipe"));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current || (e.target as HTMLElement).closest("button")) return;
    cardRef.current?.setPointerCapture(e.pointerId);
    y.stop();
    drag.current = {
      id: e.pointerId,
      startY: e.clientY,
      grab: null,
      hist: [[performance.now(), y.get()]],
    };
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
      className={cx("toast glass", tone === "danger" && "toast-danger")}
      role="group"
      aria-label="Notification"
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
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => close("close")}
      >
        <Icon name="close" size="sm" />
      </button>
      <i ref={fuseRef} className="toast-fuse" aria-hidden="true" />
    </m.div>
  );
}
