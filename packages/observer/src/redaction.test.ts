import { describe, expect, it } from "vitest";
import { RedactionTripped, assertRedacted } from "./redaction.ts";

const redact = (text: string) => text.replaceAll("hunter2-canary", "[secret]");

describe("assertRedacted (spec §6.4)", () => {
  it("passes text the redactor leaves untouched", () => {
    expect(() => assertRedacted('{"goal":"notes"}', redact)).not.toThrow();
  });
  it("refuses to send anything the redactor would change, and never echoes it", () => {
    let error: unknown;
    try {
      assertRedacted('{"alias":"hunter2-canary"}', redact);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RedactionTripped);
    expect(String((error as Error).message)).not.toContain("hunter2");
  });
});
