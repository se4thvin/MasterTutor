import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import type { MaskSources } from "../browser/masking.ts";
import { createLocalOcr, pixelsAreClean, tallPixelsAreClean } from "./local-ocr.ts";
import { closerLookBands, screenPixels } from "./pixel-screen.ts";

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
    const blank = new Uint8Array(
      await sharp({ create: { width: 400, height: 40, channels: 3, background: "#fff" } })
        .png()
        .toBuffer(),
    );
    const hit = await screenPixels(misread, folding, blank, signal);
    expect(hit.kind).toBe("hit");
    expect(hit.kind === "hit" && hit.boxes).toContainEqual(box(50));
    const clean = read(["Password", "hidden", "user", "alice"]);
    expect(await screenPixels(clean, folding, blank, signal)).toEqual({ kind: "clean" });
  });
});

describe("a long page.png read never holds up a loop screen (QA-092)", () => {
  it("takes an urgent loop read before every capture read already queued (review M1)", async () => {
    const png = await image("Quarterly results");
    const done: string[] = [];
    const track = (name: string, read: Promise<unknown>) => read.then(() => done.push(name));
    // Three capture reads queued at once: the first starts, two wait; then the loop asks.
    const reads = [
      track("capture-1", ocr.text(png)),
      track("capture-2", ocr.text(png)),
      track("capture-3", ocr.text(png)),
      track("loop", ocr.words(png, { urgent: true })),
    ];
    await Promise.all(reads);
    expect(done).toEqual(["capture-1", "loop", "capture-2", "capture-3"]);
  }, 60_000);
  it("runs the loop's screen between page.png tiles, not after the whole page", async () => {
    const lines = Array.from(
      { length: 240 },
      (_, i) =>
        `<text x="20" y="${40 + i * 40}" font-family="sans-serif" font-size="22" fill="#000">Line ${i} of a long article about the citric acid cycle and its carriers</text>`,
    ).join("");
    const tall = new Uint8Array(
      await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="9640"><rect width="1280" height="9640" fill="#fff"/>${lines}</svg>`,
        ),
      )
        .png()
        .toBuffer(),
    );
    const small = await image("pw MARMOT4CANARY");
    const started = performance.now();
    let pageDone = 0;
    const page = tallPixelsAreClean(ocr, secrets("NOT-ON-THE-PAGE"), tall, signal).then(
      (clean) => ((pageDone = performance.now()), clean),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const asked = performance.now();
    const hit = await screenPixels(ocr, secrets("MARMOT4CANARY"), small, signal);
    const screened = performance.now();
    expect(await page).toBe(true);
    expect(hit.kind).toBe("hit");
    expect(screened).toBeLessThan(pageDone);
    // At most one tile ahead of it: far less than the whole page's read.
    expect(screened - asked).toBeLessThan((pageDone - started) / 2);
  }, 180_000);
});

describe("closerLookBands (QA-098: 2x only where the 1x read was small or unsure)", () => {
  const word = (y: number, height: number, confidence: number) => ({
    text: "w",
    confidence,
    box: { x: 10, y, width: 30, height },
  });
  const size = { width: 800, height: 600 };
  it("asks nothing more of large, confidently read text", () => {
    expect(closerLookBands([{ words: [word(100, 20, 95), word(100, 9, 96)] }], size)).toEqual([]);
  });
  it("judges size by the line's full height: 11 and 14 px text is re-read, 16 px body is not", () => {
    // Word boxes as tesseract gives them: a line spans about its text size, words less.
    const eleven = { words: [word(50, 11, 95), word(50, 8, 95)] };
    const fourteen = { words: [word(200, 13, 95), word(201, 10, 95), word(200, 13, 95)] };
    const body = { words: [word(400, 16, 95), word(403, 12, 95), word(403, 9, 95)] };
    expect(closerLookBands([eleven], size)).toEqual([{ x: 0, y: 44, width: 800, height: 23 }]);
    expect(closerLookBands([fourteen], size)).toEqual([{ x: 0, y: 194, width: 800, height: 25 }]);
    expect(closerLookBands([body], size)).toEqual([]);
  });
  it("re-reads ink the 1x read found no word in (review I1)", () => {
    const ink = Array.from(
      { length: 600 },
      (_, y) => (y >= 300 && y < 311) || (y >= 100 && y < 120),
    );
    // Rows 100–119 are a read line (large, sure); rows 300–310 hold ink and no word.
    expect(closerLookBands([{ words: [word(100, 20, 95)] }], size, ink)).toEqual([
      { x: 0, y: 294, width: 800, height: 23 },
    ]);
  });
  it("bands small or unsure lines across the width, merging close ones", () => {
    expect(
      closerLookBands(
        [
          { words: [word(100, 9, 95)] },
          { words: [word(120, 20, 40)] },
          { words: [word(400, 20, 95)] },
          { words: [word(500, 10, 90)] },
        ],
        size,
      ),
    ).toEqual([
      { x: 0, y: 94, width: 800, height: 52 },
      { x: 0, y: 494, width: 800, height: 22 },
    ]);
  });
});
