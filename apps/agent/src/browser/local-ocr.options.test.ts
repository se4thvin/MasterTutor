import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const seen: Array<Record<string, unknown>> = [];
/** Starts that fail before the next one succeeds (a worker that cannot load, then can). */
let failingStarts = 0;
vi.mock("tesseract.js", () => ({
  PSM: { SPARSE_TEXT: "11" },
  createWorker: vi.fn(async (_lang: string, _oem: number, options: Record<string, unknown>) => {
    seen.push(options);
    if (failingStarts > 0) {
      failingStarts--;
      throw new Error("worker failed to start");
    }
    return {
      setParameters: async () => undefined,
      recognize: async () => ({ data: { text: "" } }),
      terminate: async () => undefined,
    };
  }),
}));

const { createLocalOcr, sharedLocalOcr } = await import("./local-ocr.ts");
const { createLibraryServices } = await import("../library.ts");

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

describe("one worker per process, and a failed start is retried (13-14 review)", () => {
  it("the library uses the shared worker, not a second one", () => {
    const services = createLibraryServices({
      db: {} as never,
      storage: {} as never,
      openai: {} as never,
      log: { child: () => ({}) } as never,
      pdfWorkerUrl: "http://pdf-worker:5002",
    });
    expect(services.localOcr).toBe(sharedLocalOcr());
  });

  it("fails closed while the worker cannot start, then recovers after a bounded backoff", async () => {
    vi.useFakeTimers();
    try {
      failingStarts = 1;
      const ocr = createLocalOcr();
      await expect(ocr.text(new Uint8Array([1]))).rejects.toThrow(/start/);
      // Within the backoff no new start is attempted: still failing closed.
      const starts = seen.length;
      await expect(ocr.text(new Uint8Array([1]))).rejects.toThrow(/start/);
      expect(seen.length).toBe(starts);
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(ocr.text(new Uint8Array([1]))).resolves.toBe("");
      await ocr.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
