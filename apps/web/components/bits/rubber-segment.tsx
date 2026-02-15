"use client";
/*
 * Adapted from React Bits "RubberSegment" (TS-TW).
 * Source:  https://reactbits.dev/r/RubberSegment-TS-TW.json
 * sha256:  6312529f077aafa59d52ebaabb17d8f27fb12e166e2c7245963dab3fb3d26336 (fetched 2026-10-05)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: tokens and <Icon>; shared springs and durations from motion-tokens; m.* under
 * LazyMotion; the thumb moves with x + scaleX (transform-only) instead of an animated clip-path,
 * so there is no second, clipped copy of the labels; slots are measured from the items, which
 * gives both equal slots (default) and content-sized slots (`fit="content"`, for labels of
 * different lengths such as Source | Note); the colour, speed, glide, stretch and radius props
 * are removed; items are real radios with a keyboard path and an assistive-technology click path.
 */
import {
  animate,
  m,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
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
  /** "equal" gives every item the same width; "content" sizes each item to its label. */
  fit?: "equal" | "content";
  className?: string;
}

type Slot = { l: number; r: number };
type Drag = {
  id: number;
  x0: number;
  slot: number;
  onThumb: boolean;
  live: boolean;
  offset: number;
  width: number;
  hist: Array<[number, number]>;
};

const FLICK = 110;
const MAX_VELOCITY = 2000;
const DEADZONE = 4;
const SLOP = 10;
const RUBBER = 0.55;
const SQUASH = 3;
const GLIDE = 75;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rubber = (over: number, dim: number) =>
  (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over));
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
function nearestSlot(slots: readonly Slot[], x: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  slots.forEach((s, i) => {
    const distance = Math.abs((s.l + s.r) / 2 - x);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

export function RubberSegment<V extends string>({
  items,
  value,
  onChange,
  "aria-label": ariaLabel,
  size = "md",
  fit = "equal",
  className,
}: RubberSegmentProps<V>) {
  const reduce = useReducedMotion();
  const count = items.length;
  const index = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const slots = useRef<Slot[]>([]);
  const box = useRef<DOMRect | null>(null);
  const committed = useRef(index);
  const gen = useRef(0);
  const handoff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const inset = useRef(0);
  const edgeL = useMotionValue(0);
  const edgeR = useMotionValue(0);
  /** The thumb's laid-out width; scaleX stretches it to [edgeL, edgeR]. */
  const baseW = useMotionValue(0);
  const scaleX = useTransform(() => {
    const w = baseW.get();
    return w > 0 ? (edgeR.get() - edgeL.get()) / w : 1;
  });

  const slot = (i: number): Slot => slots.current[i] ?? { l: 0, r: 0 };
  const jumpTo = (i: number) => {
    clearTimeout(handoff.current);
    gen.current += 1;
    const s = slot(i);
    edgeL.jump(s.l);
    edgeR.jump(s.r);
  };

  const signature = items.map((item) => `${item.value}:${item.label}`).join("|");
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    let alive = true;
    const measure = () => {
      inset.current = Number.parseFloat(getComputedStyle(track).paddingLeft) || 0;
      box.current = track.getBoundingClientRect();
      // offsetLeft/offsetWidth ignore the press-scale transform that getBoundingClientRect sees.
      slots.current = Array.from({ length: count }, (_, i) => {
        const el = itemRefs.current[i];
        return el
          ? { l: el.offsetLeft - inset.current, r: el.offsetLeft + el.offsetWidth - inset.current }
          : { l: 0, r: 0 };
      });
      const first = slot(0);
      baseW.set(first.r - first.l);
      jumpTo(committed.current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    // Web fonts change label widths after the first paint.
    void document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpTo/measure only touch refs and motion values
  }, [count, signature, fit, size]);

  useEffect(() => {
    if (!drag.current && committed.current !== index) {
      committed.current = index;
      jumpTo(index);
    }
  });

  useEffect(
    () => () => {
      clearTimeout(handoff.current);
      edgeL.stop();
      edgeR.stop();
    },
    [edgeL, edgeR],
  );

  const commit = (i: number) => {
    committed.current = i;
    const item = items[i];
    if (item && i !== index) onChange(item.value);
  };

  const land = (to: number, v: number | null, flick: boolean, withSquash: boolean) => {
    const b = slot(to);
    const g = ++gen.current;
    const dir = Math.sign((b.l + b.r) / 2 - (edgeL.get() + edgeR.get()) / 2) || 1;
    const [lead, leadTo, trail, trailTo]: [
      MotionValue<number>,
      number,
      MotionValue<number>,
      number,
    ] = dir > 0 ? [edgeR, b.r, edgeL, b.l] : [edgeL, b.l, edgeR, b.r];
    const velocity = (mv: MotionValue<number>) =>
      clamp(v ?? mv.getVelocity(), -MAX_VELOCITY, MAX_VELOCITY);
    void animate(lead, leadTo, {
      ...(flick ? transitions.springSoft : transitions.spring),
      velocity: velocity(lead),
    });
    const trailVelocity = velocity(trail);
    if (!withSquash) {
      void animate(trail, trailTo, { ...transitions.spring, velocity: trailVelocity });
      return;
    }
    void animate(trail, trailTo + dir * SQUASH, {
      ...transitions.spring,
      velocity: trailVelocity,
    }).then(() => {
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
    drag.current = {
      id: e.pointerId,
      x0: x,
      slot: i,
      onThumb,
      live: false,
      offset: 0,
      width: 0,
      hist: [[e.timeStamp, x]],
    };
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
    const total = slot(count - 1).r;
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
    let to = nearestSlot(slots.current, (edgeL.get() + edgeR.get()) / 2 + project(v));
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
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? Math.min(last, index + 1)
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? Math.max(0, index - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
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
      className={cx("rseg", `rseg-${size}`, `rseg-${fit}`, className)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      <m.span
        className="rseg-thumb"
        aria-hidden="true"
        style={{ x: edgeL, scaleX, width: baseW }}
      />
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
          onClick={(e) => {
            // detail 0: keyboard or assistive-technology activation, which onPointerUp never sees.
            if (e.detail === 0 && i !== index) {
              commit(i);
              travel(index, i);
            }
          }}
        >
          {item.icon ? <Icon name={item.icon} size="sm" /> : null}
          {item.hideLabel ? null : <span>{item.label}</span>}
        </button>
      ))}
    </div>
  );
}
