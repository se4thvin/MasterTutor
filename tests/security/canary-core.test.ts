import { describe, expect, it } from "vitest";
import { expectAbsent, findCanaryHits, findOcrHits, ocrContains } from "./canary-core.ts";

const TEXT = { password: "OSPREY6CANARY2LANTERN" };
const PIN = { pin: "739146" };

describe("findCanaryHits and expectAbsent (moved from B3's testing/canary.ts)", () => {
  it("finds a canary as is, as hex and inside base64 at any byte alignment", () => {
    const hex = Buffer.from(TEXT.password).toString("hex");
    for (const leak of [TEXT.password, hex, hex.toUpperCase()])
      expect(() => expectAbsent(`x ${leak} y`, "t", TEXT)).toThrow();
    for (const prefix of ["", "a", "ab", "abc"]) {
      const blob = Buffer.from(`${prefix}${TEXT.password}!`);
      expect(() => expectAbsent(blob.toString("base64"), "t", TEXT), prefix).toThrow();
      expect(() => expectAbsent(blob.toString("base64url"), "t", TEXT), prefix).toThrow();
    }
  });

  it("passes text that holds no canary", () => {
    expect(() => expectAbsent("Signed in. Password: [secret]", "t", TEXT)).not.toThrow();
  });

  it("finds a canary stored as UTF-16LE bytes", () => {
    const bytes = Buffer.from(`x ${TEXT.password} y`, "utf16le").toString("latin1");
    expect(findCanaryHits(bytes, "t", TEXT).map((hit) => hit.form)).toEqual(["utf16"]);
  });

  it("names the canary, the form and the place, never the value", () => {
    expect(() => expectAbsent(`x ${TEXT.password}`, "logs", TEXT)).toThrow(
      "password (plain) in logs",
    );
    let message = "";
    try {
      expectAbsent(`x ${TEXT.password}`, "logs", TEXT);
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain(TEXT.password);
  });

  it("matches a digit canary only as a whole number, never as hex or base64 (P7-34)", () => {
    expect(findCanaryHits("code 739146.", "t", PIN)).toHaveLength(1);
    expect(findCanaryHits("id 17391460", "t", PIN)).toEqual([]);
    expect(findCanaryHits(Buffer.from("739146").toString("hex"), "t", PIN)).toEqual([]);
  });

  it("does not search base64 for values under 12 bytes", () => {
    const short = { s: "ab1cd2ef3" };
    expect(findCanaryHits(Buffer.from(`xx ${short.s} yy`).toString("base64"), "t", short)).toEqual(
      [],
    );
  });

  it("refuses an empty canary, which would match everything", () => {
    expect(() => findCanaryHits("x", "t", { empty: "" })).toThrow(TypeError);
  });
});

describe("OCR matching (moved from B3's testing/ocr.ts)", () => {
  it("finds a canary despite OCR confusions and spacing", () => {
    expect(ocrContains("Signed in as zq-canary-ZEBRATQUOKKA4", "ZEBRA7QUOKKA4")).toBe(true);
    expect(ocrContains("MARMOT 4CANARY 8VELVET", "MARMOT4CANARY8VELVET")).toBe(true);
    expect(ocrContains("kite7canary3@example.test", "KITE7CANARY3@example.test")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(ocrContains("Sign in Email Password Show", "MARMOT4CANARY8VELVET")).toBe(false);
  });

  it("findOcrHits: fuzzy for long text canaries, whole numbers for digits", () => {
    expect(
      findOcrHits("Signed in as MARMOT 4CANARY 8VELVET", "shot", {
        password: "MARMOT4CANARY8VELVET",
      }),
    ).toEqual([{ canary: "password", where: "shot", form: "ocr" }]);
    expect(findOcrHits("Order 7391460 shipped", "shot", PIN)).toEqual([]);
    expect(findOcrHits("PIN 739146", "shot", PIN)).toHaveLength(1);
  });
});
