import type { Ref } from "react";
import { PIP_POSTERS } from "./posters.ts";
import type { PipSize, PipState } from "./pip-types.ts";

/**
 * Pip's markup: the state's poster, and the canvas the live scene draws into, crossfaded by
 * `data-live`. Always an image with an accessible name; `onPoke` is a pointer-only reaction.
 */
export function PipFrame({
  state,
  size,
  label,
  live = false,
  onPoke,
  hostRef,
  canvasRef,
}: {
  state: PipState;
  size: PipSize;
  label: string;
  live?: boolean;
  onPoke?: (() => void) | undefined;
  hostRef?: Ref<HTMLElement>;
  canvasRef?: Ref<HTMLCanvasElement>;
}) {
  const inner = (
    <>
      {/* Decorative: the host carries the name. */}
      <img
        className="pip-poster"
        src={PIP_POSTERS[state][size]}
        alt=""
        decoding="async"
        draggable={false}
      />
      <canvas className="pip-canvas" ref={canvasRef} aria-hidden="true" />
    </>
  );
  // Pip stays a labelled image even when it can be poked: a poke is a pointer-only delight, so Pip
  // never adds a tab stop, never takes focus and never announces itself as a control.
  return (
    <div
      className="pip"
      data-size={size}
      data-state={state}
      data-live={live ? "" : undefined}
      ref={hostRef as Ref<HTMLDivElement>}
      role="img"
      aria-label={label}
      onClick={onPoke}
      // A poke leaves focus where it was (the goal field keeps its caret).
      onMouseDown={onPoke ? (event) => event.preventDefault() : undefined}
    >
      {inner}
    </div>
  );
}
