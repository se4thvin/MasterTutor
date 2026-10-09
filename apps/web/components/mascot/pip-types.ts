/**
 * The Pip interface (mascot-contract.md). Both the 3D Pip and its 2D stand-in implement it; every
 * caller renders Pip through `PipLazy`, never a concrete implementation. PipSize and PipAccessory
 * are exported once a module imports them (M7).
 */
export type PipState =
  | "idle"
  | "attentive"
  | "thinking"
  | "working"
  | "waiting"
  | "waving"
  | "celebrating"
  | "dozing"
  | "oops"
  | "reading";

/** hero ~240–360 px, compact ~40–64 px. */
type PipSize = "hero" | "compact";

/** Sockets for later personalization. */
type PipAccessory = "glasses" | "beret" | "headphones" | "bowtie" | "book" | "laptop" | "party-hat";

export interface PipProps {
  state: PipState;
  size: PipSize;
  /** Eyes and head follow the cursor or a viewport point (px). */
  lookAt?: "cursor" | { x: number; y: number } | null;
  accessories?: readonly PipAccessory[];
  /** Click or tap reaction hook. */
  onPoke?: () => void;
  /** Accessible name; default "Pip". */
  label?: string;
}
