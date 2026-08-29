import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const seen: Array<Record<string, unknown>> = [];
vi.mock("tesseract.js", () => ({
  PSM: { SPARSE_TEXT: "11" },
  createWorker: vi.fn(async (_lang: string, _oem: number, options: Record<string, unknown>) => {
    seen.push(options);
    return {
      setParameters: async () => undefined,
      recognize: async () => ({ data: { text: "" } }),
      terminate: async () => undefined,
    };
  }),
}));

const { createLocalOcr } = await import("../browser/local-ocr.ts");

describe("local OCR loads only bundled files (never a CDN, never a shared cache)", () => {
  it("reads the English model from the bundled package and caches nothing", async () => {
    const ocr = createLocalOcr();
    await ocr.text(new Uint8Array([1]));
    await ocr.close();
    const options = seen[0]!;
    const langPath = String(options.langPath);
    expect(path.isAbsolute(langPath)).toBe(true);
    expect(langPath).not.toMatch(/^[a-z]+:/i);
    expect(existsSync(path.join(langPath, "eng.traineddata.gz"))).toBe(true);
    // The worker and core come from the installed package (tesseract.js's Node defaults).
    expect(options).not.toHaveProperty("workerPath");
    expect(options).not.toHaveProperty("corePath");
    // A model file planted in a shared temp directory must never be loaded instead.
    expect(options.cacheMethod).toBe("none");
  });
});
