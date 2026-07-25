import { describe, expect, it } from "vitest";
import { compactNumber, formatBytes, formatCount, formatElapsed, spokenElapsed } from "./format.ts";

describe("format", () => {
  it("formats elapsed thinking time to a tenth of a second", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(3_240)).toBe("3.2s");
    expect(formatElapsed(65_500)).toBe("1m 5.5s");
    expect(spokenElapsed(3_240)).toBe("3.2 seconds");
  });

  it("formats counts with fixed decimals and affixes", () => {
    expect(formatCount(0.4, 2, "$")).toBe("$0.40");
    expect(formatCount(1500, 0)).toBe("1,500");
    expect(formatCount(6.4, 0, "", " min")).toBe("6 min");
  });

  it("compacts token counts", () => {
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(188_400)).toBe("188k");
    expect(compactNumber(2_400_000)).toBe("2.4M");
  });
});

describe("formatBytes (A11 held downloads)", () => {
  it("spells sizes in binary units, whole below a megabyte", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(900)).toBe("900 bytes");
    expect(formatBytes(2_048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
  });
});
