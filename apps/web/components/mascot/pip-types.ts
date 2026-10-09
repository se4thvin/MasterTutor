/** Pip's public contract (mascot-contract.md). The app codes against these names only. */

export const PIP_STATES = [
  "idle",
  "attentive",
  "thinking",
  "working",
  "waiting",
  "waving",
  "celebrating",
  "dozing",
  "oops",
  "reading",
] as const;
export type PipState = (typeof PIP_STATES)[number];

/** hero: 240–360 px wide; compact: 40–64 px. */
export type PipSize = "hero" | "compact";

export const PIP_ACCESSORIES = [
  "glasses",
  "beret",
  "headphones",
  "bowtie",
  "book",
  "laptop",
  "party-hat",
] as const;
export type PipAccessory = (typeof PIP_ACCESSORIES)[number];

/** Viewport pixels. */
export interface PipPoint {
  x: number;
  y: number;
}

export interface PipProps {
  state: PipState;
  size: PipSize;
  /** Eyes and head follow the cursor or a viewport point; null or absent looks ahead. */
  lookAt?: "cursor" | PipPoint | null;
  /** Sockets for later personalisation. */
  accessories?: readonly PipAccessory[];
  /** Click or tap reaction hook (pointer only: Pip never becomes a tab stop). */
  onPoke?: () => void;
  /** Accessible name; default "Pip". */
  label?: string;
}
