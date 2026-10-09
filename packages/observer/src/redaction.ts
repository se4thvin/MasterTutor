/** The serialized payload would have changed under the exact-match redactor: nothing is sent. */
export class RedactionTripped extends Error {
  constructor() {
    super("A secret was found in an Observer payload; nothing was sent");
    this.name = "RedactionTripped";
  }
}

/**
 * The last check before any Observer request leaves the process (spec §6.4, GD §3.3). `redact`
 * is MaskSources.redact: exact match, local, no model. The payload is never echoed.
 */
export function assertRedacted(serialized: string, redact: (text: string) => string): void {
  if (redact(serialized) !== serialized) throw new RedactionTripped();
}
