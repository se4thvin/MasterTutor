import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// ocrContains moved to tests/security/canary-core.test.ts (P7-33); createOcr stays with the agent.
import { createOcr, ocrContains } from "./ocr.ts";

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
