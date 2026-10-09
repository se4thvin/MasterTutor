import type { Ref } from "react";
import { PIP_POSTERS } from "./posters.ts";
import type { PipSize, PipState } from "./pip-types.ts";

/**
 * Pip's markup: the state's poster, and the canvas the live scene draws into, crossfaded by
 * `data-live`. A poke target is a button; otherwise it is an image with an accessible name.
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
  const common = {
    className: "pip",
    "data-size": size,
    "data-state": state,
    "data-live": live ? "" : undefined,
  };
  return onPoke ? (
    <button
      {...common}
      ref={hostRef as Ref<HTMLButtonElement>}
      type="button"
      aria-label={label}
      onClick={onPoke}
    >
      {inner}
    </button>
  ) : (
    <div {...common} ref={hostRef as Ref<HTMLDivElement>} role="img" aria-label={label}>
      {inner}
    </div>
  );
}
