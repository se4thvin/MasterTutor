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

describe("one-time codes in pixels (ruling)", () => {
  const codes = (code: string): MaskSources => ({
    nodeIds: () => [],
    hasSecrets: () => false,
    redact: (text) => text,
    hasOneTimeCodes: () => true,
    isOneTimeCode: (token) => token === code,
  });
  it("finds a filled code as a whole token, and nothing inside a longer number", async () => {
    const hit = await screenPixels(
      ocr,
      codes("482913"),
      await image("Your code is 482913."),
      signal,
    );
    expect(hit.kind).toBe("hit");
    expect(
      await screenPixels(ocr, codes("482913"), await image("Order 4829137 shipped"), signal),
    ).toEqual({
      kind: "clean",
    });
    expect(await pixelsAreClean(ocr, codes("482913"), await image("code 482913"), signal)).toBe(
      false,
    );
  }, 60_000);
});

describe("confusable OCR reads (QA-099)", () => {
  // The vault's matcher folds O/0, l/1, B/8…; the screens must ask it, not only the exact redactor.
  const folding: MaskSources = {
    nodeIds: () => [],
    hasSecrets: () => true,
    redact: (text) => text.replaceAll("hunter2Ol1", "[secret]"),
    // A stand-in for the vault's folded match: separators ignored, O/0 and l/1 alike.
    inOcrText: (text) =>
      /hunter2011/i.test(
        text
          .replace(/[^A-Za-z0-9]/g, "")
          .replace(/[Oo]/g, "0")
          .replace(/[lI]/g, "1"),
      ),
  };
  const box = (x: number) => ({ x, y: 0, width: 40, height: 12 });
  const read = (words: string[]) => ({
    text: async () => words.join(" "),
    words: async () => [{ words: words.map((text, i) => ({ text, box: box(i * 50) })) }],
  });
  it("withholds and masks a secret OCR misread as confusable characters", async () => {
    const misread = read(["Password", "hunter2011", "user", "alice"]);
    expect(await pixelsAreClean(misread, folding, new Uint8Array([1]), signal)).toBe(false);
    const hit = await screenPixels(misread, folding, new Uint8Array([1]), signal);
    expect(hit).toEqual({ kind: "hit", boxes: [box(50)] });
    const clean = read(["Password", "hidden", "user", "alice"]);
    expect(await screenPixels(clean, folding, new Uint8Array([1]), signal)).toEqual({
      kind: "clean",
    });
  });
});
