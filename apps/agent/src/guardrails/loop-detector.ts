import { PERCEPTUAL_SAME, perceptualDistance, type PerceptualHash } from "../browser/phash.ts";

export const SAME_ACTION_LIMIT = 3;
export const NO_PROGRESS_LIMIT = 8;

/** Spec §5.5 loop detection. In memory per run; a restore or a human wait starts it afresh. */
export class LoopDetector {
  #repeat: { signature: string; phash: PerceptualHash; count: number } | null = null;
  #last: { url: string; domHash: string } | null = null;
  #stale = 0;

  recordAction(signature: string, phash: PerceptualHash): boolean {
    const previous = this.#repeat;
    if (
      previous &&
      previous.signature === signature &&
      perceptualDistance(previous.phash, phash) <= PERCEPTUAL_SAME
    ) {
      previous.count += 1;
    } else {
      this.#repeat = { signature, phash, count: 1 };
    }
    return (this.#repeat?.count ?? 0) >= SAME_ACTION_LIMIT;
  }

  recordObservation(observation: { url: string; domHash: string; notesChanged: boolean }): boolean {
    const unchanged =
      this.#last !== null &&
      this.#last.url === observation.url &&
      this.#last.domHash === observation.domHash &&
      !observation.notesChanged;
    this.#stale = unchanged ? this.#stale + 1 : 0;
    this.#last = { url: observation.url, domHash: observation.domHash };
    return this.#stale >= NO_PROGRESS_LIMIT;
  }

  reset(): void {
    this.#repeat = null;
    this.#last = null;
    this.#stale = 0;
  }
}
