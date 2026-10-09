import { createHmac, randomBytes } from "node:crypto";
import { unwrapUntrusted, type Provenance } from "@mastertutor/contracts";

/** Spec §6.3: 8-character shingles; text under 16 characters is never labelled; 50% overlap matches. */
export const PROVENANCE = { shingle: 8, minChars: 16, match: 0.5 } as const;
/** Fingerprints kept per origin, so a huge page cannot grow memory without bound. */
const MAX_PER_ORIGIN = 200_000;

export interface ProvenanceLabel {
  provenance: Provenance;
  sourceOrigin: string | null;
  chars: number;
}

const normalize = (text: string) =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Where typed text came from (CaMeL-lite, GD §4.3): keyed fingerprints of the text the model read,
 * per origin. In memory only, per run (a random HMAC key); rebuilt from the transcript on restore.
 * Nothing here ever leaves the process.
 */
export class ProvenanceStore {
  readonly #key = randomBytes(32);
  readonly #byOrigin = new Map<string, Set<string>>();
  readonly #goal: Set<string>;

  constructor(goal: string) {
    this.#goal = this.#shingles(goal);
  }

  #shingles(text: string): Set<string> {
    const clean = normalize(text);
    const out = new Set<string>();
    for (let i = 0; i + PROVENANCE.shingle <= clean.length; i++)
      out.add(
        createHmac("sha256", this.#key)
          .update(clean.slice(i, i + PROVENANCE.shingle))
          .digest("base64url")
          .slice(0, 16),
      );
    return out;
  }

  ingest(origin: string | null, text: string): void {
    if (origin === null) return;
    const set = this.#byOrigin.get(origin) ?? new Set<string>();
    for (const shingle of this.#shingles(text)) {
      if (set.size >= MAX_PER_ORIGIN) break;
      set.add(shingle);
    }
    this.#byOrigin.set(origin, set);
  }

  /** A function tool's output as the model received it: only page envelopes count (registry.ts). */
  ingestToolOutput(output: string): void {
    const page = unwrapUntrusted(output);
    if (page) this.ingest(page.origin, page.content);
  }

  label(text: string, pageOrigin: string | null): ProvenanceLabel {
    const chars = text.length;
    if (normalize(text).length < PROVENANCE.minChars)
      return { provenance: "none", sourceOrigin: null, chars };
    const typed = this.#shingles(text);
    const overlap = (set: Set<string>) => {
      let hits = 0;
      for (const shingle of typed) if (set.has(shingle)) hits++;
      return hits / typed.size;
    };
    if (overlap(this.#goal) >= PROVENANCE.match)
      return { provenance: "goal", sourceOrigin: null, chars };
    const here = pageOrigin === null ? undefined : this.#byOrigin.get(pageOrigin);
    if (here && overlap(here) >= PROVENANCE.match)
      return { provenance: "same_origin", sourceOrigin: pageOrigin, chars };
    let best: { origin: string; score: number } | null = null;
    for (const [origin, set] of this.#byOrigin) {
      if (origin === pageOrigin) continue;
      const score = overlap(set);
      if (score >= PROVENANCE.match && (!best || score > best.score)) best = { origin, score };
    }
    return best
      ? { provenance: "other_origin", sourceOrigin: best.origin, chars }
      : { provenance: "novel", sourceOrigin: null, chars };
  }
}
