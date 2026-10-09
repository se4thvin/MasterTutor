"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { PipProps, PipState } from "./pip-types.ts";

/**
 * 2D stand-in for the 3D Pip (mascot-contract.md): the same props, the concept palette, a pose
 * and a visible state label per state. It is the test double and fixture behind PipLazy until
 * components/mascot/pip.tsx (branch mascot-3d) takes its place; it is not the shipped Pip.
 */
const LABEL: Record<PipState, string> = {
  idle: "Idle",
  attentive: "Listening",
  thinking: "Thinking",
  working: "Working",
  waiting: "Waiting for you",
  waving: "Hello",
  celebrating: "Done",
  dozing: "Dozing",
  oops: "Oops",
  reading: "Reading",
};

/** How far the pupils travel toward the look target, in viewBox units. */
const LOOK_REACH = 2.2;

function aim(el: HTMLElement, x: number, y: number) {
  const r = el.getBoundingClientRect();
  const dx = x - (r.left + r.width / 2);
  const dy = y - (r.top + r.height * 0.45);
  const len = Math.hypot(dx, dy) || 1;
  el.style.setProperty("--look-x", `${((dx / len) * LOOK_REACH).toFixed(2)}px`);
  el.style.setProperty("--look-y", `${((dy / len) * LOOK_REACH).toFixed(2)}px`);
}

function useLookAt(ref: RefObject<HTMLElement | null>, lookAt: PipProps["lookAt"]) {
  const x = typeof lookAt === "object" && lookAt ? lookAt.x : null;
  const y = typeof lookAt === "object" && lookAt ? lookAt.y : null;
  const cursor = lookAt === "cursor";
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (x !== null && y !== null) aim(el, x, y);
    else {
      el.style.removeProperty("--look-x");
      el.style.removeProperty("--look-y");
    }
    if (!cursor) return undefined;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => aim(el, e.clientX, e.clientY));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [ref, x, y, cursor]);
}

function Face({ state }: { state: PipState }) {
  if (state === "dozing")
    return (
      <g
        className="mascot-face"
        fill="none"
        stroke="var(--pip-ink)"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M40 55q3 2.4 6 0M54 55q3 2.4 6 0" />
        <circle cx="50" cy="61.5" r="1" fill="var(--pip-ink)" stroke="none" />
      </g>
    );
  if (state === "waving" || state === "celebrating")
    return (
      <g
        className="mascot-face"
        fill="none"
        stroke="var(--pip-ink)"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M40 56q3-3.4 6 0M54 56q3-3.4 6 0" />
        <ellipse cx="50" cy="61.5" rx="1.9" ry="1.5" fill="var(--pip-ink)" stroke="none" />
      </g>
    );
  return (
    <g className="mascot-face">
      <g className="mascot-eyes" fill="var(--pip-ink)">
        <ellipse cx="43" cy="55" rx="2.1" ry="2.7" />
        <ellipse cx="57" cy="55" rx="2.1" ry="2.7" />
      </g>
      {state === "thinking" ? (
        <path
          d="M54 49.5q3-1.6 6 0"
          fill="none"
          stroke="var(--pip-ink)"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      ) : null}
      <path
        d={
          state === "oops"
            ? "M45 62.5q1.7-1.6 3.4 0t3.4 0t3.4 0"
            : state === "thinking"
              ? "M47 62h6"
              : "M46 60.5q4 3.4 8 0"
        }
        fill="none"
        stroke="var(--pip-ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </g>
  );
}

function Prop({ state }: { state: PipState }) {
  switch (state) {
    case "working":
      return (
        <g className="mascot-prop">
          <rect
            x="37"
            y="72"
            width="26"
            height="15"
            rx="2"
            fill="var(--pip-paper)"
            stroke="var(--pip-shade)"
            strokeWidth="1"
          />
          <circle cx="50" cy="79.5" r="1.4" className="mascot-glow" fill="var(--pip-body)" />
        </g>
      );
    case "reading":
      return (
        <g className="mascot-prop">
          <path
            d="M36 74l14 3 14-3v13l-14 3-14-3z"
            fill="var(--pip-paper)"
            stroke="var(--pip-shade)"
            strokeWidth="1"
          />
          <path d="M50 77v13" stroke="var(--pip-shade)" strokeWidth="1" />
        </g>
      );
    case "dozing":
      return (
        <path
          className="mascot-zzz"
          d="M73 24h6l-6 6h6M82 15h4.5l-4.5 4.5h4.5M88 7h3l-3 3h3"
          fill="none"
          stroke="var(--pip-shade)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "thinking":
      return (
        <g
          className="mascot-bubbles"
          fill="var(--pip-paper)"
          stroke="var(--pip-shade)"
          strokeWidth="0.8"
        >
          <circle cx="76" cy="32" r="2" />
          <circle cx="82" cy="23" r="3" />
          <circle cx="89" cy="12" r="5" />
        </g>
      );
    case "celebrating":
      return (
        <g className="mascot-confetti">
          <path d="M44 14l6-12 6 12z" fill="var(--pip-cheek)" />
          <circle cx="50" cy="2.5" r="2" fill="var(--pip-leaf)" />
          <rect
            x="16"
            y="20"
            width="3"
            height="5"
            rx="1"
            fill="var(--pip-leaf)"
            transform="rotate(-20 17 22)"
          />
          <rect
            x="82"
            y="26"
            width="3"
            height="5"
            rx="1"
            fill="var(--pip-cheek)"
            transform="rotate(25 83 28)"
          />
          <circle cx="22" cy="40" r="1.6" fill="var(--pip-body)" />
          <circle cx="80" cy="44" r="1.6" fill="var(--pip-leaf)" />
        </g>
      );
    case "oops":
      return <path className="mascot-drop" d="M68 36q3 5 0 7q-3-2 0-7z" fill="var(--pip-body)" />;
    default:
      return null;
  }
}

/** Arms up for waving, waiting (hand raised) and celebrating; down otherwise. */
const RAISED: ReadonlySet<PipState> = new Set(["waving", "waiting", "celebrating"]);

export function Pip({
  state,
  size,
  lookAt = null,
  accessories = [],
  onPoke,
  label = "Pip",
}: PipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useLookAt(ref, lookAt);
  const raised = RAISED.has(state);
  return (
    <span
      ref={ref}
      className="mascot"
      data-size={size}
      data-state={state}
      data-accessories={accessories.join(" ") || undefined}
      role="img"
      aria-label={label}
      onClick={onPoke}
    >
      <svg className="mascot-art" viewBox="0 0 100 110" aria-hidden="true">
        <ellipse cx="50" cy="104" rx="24" ry="4" className="mascot-shadow" />
        <g className="mascot-body">
          <g className="mascot-sprout" fill="var(--pip-leaf)">
            <path d="M50 22v-9" stroke="var(--pip-leaf)" strokeWidth="2" strokeLinecap="round" />
            <ellipse cx="44" cy="13" rx="6" ry="2.6" transform="rotate(-18 44 13)" />
            <ellipse cx="56" cy="12" rx="6" ry="2.6" transform="rotate(18 56 12)" />
          </g>
          <ellipse cx="34" cy="100" rx="8" ry="4" fill="var(--pip-shade)" />
          <ellipse cx="66" cy="100" rx="8" ry="4" fill="var(--pip-shade)" />
          <path
            className={raised ? "mascot-arm mascot-arm-up" : "mascot-arm"}
            d={raised ? "M80 58q10-8 9-20" : "M80 58q8 6 7 16"}
            stroke="var(--pip-body)"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d={state === "celebrating" ? "M20 58q-10-8-9-20" : "M20 58q-8 6-7 16"}
            stroke="var(--pip-body)"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M50 21C29 21 17 50 17 70c0 18 14 29 33 29s33-11 33-29C83 50 71 21 50 21z"
            fill="var(--pip-body)"
          />
          <ellipse
            cx="50"
            cy="57"
            rx="20"
            ry="17"
            fill="var(--pip-face)"
            stroke="var(--pip-shade)"
            strokeWidth="3"
          />
          <g className="mascot-look">
            <Face state={state} />
          </g>
          <ellipse cx="37" cy="61" rx="3" ry="2" fill="var(--pip-cheek)" />
          <ellipse cx="63" cy="61" rx="3" ry="2" fill="var(--pip-cheek)" />
          <Prop state={state} />
        </g>
      </svg>
      {size === "hero" ? (
        <span className="mascot-label" aria-hidden="true">
          {LABEL[state]}
        </span>
      ) : null}
    </span>
  );
}
