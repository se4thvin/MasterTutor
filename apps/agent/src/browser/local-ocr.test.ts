import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import type { MaskSources } from "../browser/masking.ts";
import { createLocalOcr, pixelsAreClean, screenPixels } from "./local-ocr.ts";

const ocr = createLocalOcr();
afterAll(() => ocr.close());

const image = async (text: string) =>
  new Uint8Array(
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="120"><rect width="900" height="120" fill="#fff"/><text x="20" y="80" font-family="sans-serif" font-size="48" fill="#000">${text}</text></svg>`,
      ),
    )
      .png()
      .toBuffer(),
  );
const secrets = (secret: string): MaskSources => ({
  nodeIds: () => [],
  hasSecrets: () => true,
  redact: (text) => text.replaceAll(secret, "[secret]"),
});
const signal = new AbortController().signal;

describe("pixelsAreClean (self-hosted tesseract, A-M1)", () => {
  it("reads a secret out of pixels and withholds them", async () => {
    expect(
      await pixelsAreClean(ocr, secrets("MARMOT4CANARY"), await image("pw MARMOT4CANARY"), signal),
    ).toBe(false);
    expect(
      await pixelsAreClean(ocr, secrets("MARMOT4CANARY"), await image("Quarterly results"), signal),
    ).toBe(true);
  }, 60_000);
  it("withholds pixels it cannot read, and reads nothing without registered secrets", async () => {
    const broken = {
      text: async (): Promise<string> => Promise.reject(new Error("crash")),
      words: async (): Promise<never> => Promise.reject(new Error("crash")),
    };
    expect(await pixelsAreClean(broken, secrets("x"), new Uint8Array([1]), signal)).toBe(false);
    expect(
      await pixelsAreClean(
        broken,
        { ...secrets("x"), hasSecrets: () => false },
        new Uint8Array([1]),
        signal,
      ),
    ).toBe(true);
  });
});

describe("screenPixels (agent-loop screenshots, I-1)", () => {
  it("returns the word boxes of a registered secret, never of a username", async () => {
    const png = await image("pw MARMOT4CANARY user alice");
    const hit = await screenPixels(ocr, secrets("MARMOT4CANARY"), png, signal);
    expect(hit.kind).toBe("hit");
    if (hit.kind !== "hit") return;
    expect(hit.boxes).toHaveLength(1);
    const [box] = hit.boxes;
    // The secret is the middle word: its box starts right of "pw" and ends before "user".
    expect(box!.x).toBeGreaterThan(60);
    expect(box!.x + box!.width).toBeLessThan(700);
    expect(await screenPixels(ocr, secrets("alice-unregistered"), png, signal)).toEqual({
      kind: "clean",
    });
  }, 60_000);
  it("reports a failed read, and gives up at once when the run is cancelled", async () => {
    const broken = {
      text: async () => "",
      words: async (): Promise<never> => Promise.reject(new Error("crash")),
    };
    expect(await screenPixels(broken, secrets("x"), new Uint8Array([1]), signal)).toEqual({
      kind: "failed",
    });
    const hung = {
      text: () => new Promise<string>(() => undefined),
      words: () => new Promise<never>(() => undefined),
    };
    const controller = new AbortController();
    const pending = pixelsAreClean(hung, secrets("x"), new Uint8Array([1]), controller.signal);
    controller.abort(new Error("killed"));
    await expect(pending).rejects.toThrow("killed");
  });
});
