/** The ~2.4s Start sequence (run 16): choreography offsets in seconds. */
export const CAPTURE_END_S = 2.4;
export const LINE_STAGGER_S = 0.035;
export const PAGE_FLOW = { start: 0.14, length: 0.64 } as const;
export const RIPPLE_S = 0.75;

export type CueKey = "inhale" | "shower" | "gulp" | "note" | "page" | `line${number}`;
interface Cue {
  key: CueKey;
  at: number;
}

export function captureCues(lineCount: number): Cue[] {
  return [
    { key: "inhale", at: 0 },
    { key: "shower", at: 0.12 },
    { key: "gulp", at: 0.78 },
    { key: "note", at: 0.86 },
    ...Array.from({ length: lineCount }, (_, i) => ({
      key: `line${i}` as CueKey,
      at: 0.98 + i * LINE_STAGGER_S,
    })),
    { key: "page", at: 1.55 },
  ];
}

export function dueCues(cues: readonly Cue[], t: number, fired: Set<string>): CueKey[] {
  const due: CueKey[] = [];
  for (const cue of cues) {
    if (t >= cue.at && !fired.has(cue.key)) {
      fired.add(cue.key);
      due.push(cue.key);
    }
  }
  return due;
}
