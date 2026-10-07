import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createOcr, ocrContains } from "./ocr.ts";

describe("ocrContains", () => {
  it("finds a canary despite OCR confusions and spacing (planning verification 9)", () => {
    expect(ocrContains("Signed in as zq-canary-ZEBRATQUOKKA4", "ZEBRA7QUOKKA4")).toBe(true);
    expect(ocrContains("MARMOT 4CANARY 8VELVET", "MARMOT4CANARY8VELVET")).toBe(true);
    expect(ocrContains("kite7canary3@example.test", "KITE7CANARY3@example.test")).toBe(true);
  });
  it("does not match unrelated text", () => {
    expect(ocrContains("Sign in Email Password Show", "MARMOT4CANARY8VELVET")).toBe(false);
  });
});

describe("createOcr", () => {
  it("reads a filled field in a Linux headless Chromium frame (the canary's positive control)", async () => {
    // Captured on the CI runner (node:24-bookworm, DejaVu Sans): the login page with the email filled.
    const png = readFileSync(new URL("./linux-filled-email.png", import.meta.url));
    const ocr = await createOcr();
    try {
      expect(ocrContains(await ocr.text(png), "KITE7CANARY3@example.test")).toBe(true);
    } finally {
      await ocr.close();
    }
  }, 60_000);
});
