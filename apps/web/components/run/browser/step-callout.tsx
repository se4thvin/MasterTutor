"use client";

import { useRef } from "react";
import type { Point } from "../cursor/cursor-path.ts";
import { calloutPlacement, type Box } from "../model/callout.ts";
import { useElementSize } from "../use-element-size.ts";

const FALLBACK_LABEL = { width: 240, height: 48 };

/**
 * Cutaway callout with a dotted leader to the step's element (wide), or a gutter badge (≤1180px).
 * Placement keeps label and leader inside the frame, so the leader never crosses the timeline (D22).
 */
export function StepCallout({
  text,
  number,
  target,
  box,
}: {
  text: string;
  number: number;
  target: Point;
  box: Box;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const label = useElementSize(ref);
  const placed = calloutPlacement(target, box, label ?? FALLBACK_LABEL);
  return (
    <div className="run-callouts" aria-hidden="true" data-testid="step-callout">
      <svg className="run-leader" data-qa-avoid width={box.width} height={box.height}>
        <line x1={placed.line.x1} y1={placed.line.y1} x2={placed.line.x2} y2={placed.line.y2} />
        <circle cx={target.x} cy={target.y} r={3} />
      </svg>
      <div
        ref={ref}
        className="run-callout glass"
        data-qa-avoid
        style={{ transform: `translate(${placed.left}px, ${placed.top}px)` }}
      >
        <b>Step {number}.</b> <bdi>{text}</bdi>
      </div>
      <span
        className="run-gutter-badge"
        data-testid="gutter-badge"
        style={{ transform: `translateY(${target.y}px)` }}
      >
        {number}
      </span>
    </div>
  );
}
