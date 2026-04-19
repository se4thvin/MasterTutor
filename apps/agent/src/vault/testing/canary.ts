import { expect } from "vitest";

/**
 * What a leaked secret looks like inside base64 text, at each of the three byte alignments it can
 * land on: the characters no neighbouring byte can change. Too short a secret has no core long
 * enough to search without false hits, so it is checked as plain and hex only.
 */
function base64Cores(bytes: Buffer): string[] {
  if (bytes.length < 12) return [];
  const cores: string[] = [];
  for (let shift = 0; shift < 3; shift++) {
    const text = Buffer.concat([Buffer.alloc(shift), bytes]).toString("base64");
    const core = text.slice(Math.ceil((shift * 4) / 3), text.length - 4);
    cores.push(core, core.replaceAll("+", "-").replaceAll("/", "_"));
  }
  return cores;
}

/** Fails naming the canary and the encoding if any form of any canary is in `haystack` (§12.1). */
export function expectAbsent(
  haystack: string,
  where: string,
  canaries: Readonly<Record<string, string>>,
): void {
  const lower = haystack.toLowerCase();
  for (const [name, value] of Object.entries(canaries)) {
    const bytes = Buffer.from(value);
    expect(haystack.includes(value), `${name} in ${where}`).toBe(false);
    expect(lower.includes(bytes.toString("hex")), `${name} (hex) in ${where}`).toBe(false);
    for (const core of base64Cores(bytes))
      expect(haystack.includes(core), `${name} (base64) in ${where}`).toBe(false);
  }
}
