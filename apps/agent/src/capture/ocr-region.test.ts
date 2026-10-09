import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import { StepCollector } from "../loop/step-collector.ts";
import type { AssetInput, AssetStore } from "../notes/assets.ts";
import { testLog } from "../testing/tool-context.ts";
import { readRegion, type RegionReader } from "./ocr-region.ts";
import { createOcrModel } from "./opaque.ts";

const png = async () =>
  new Uint8Array(
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "#fff" } })
      .png()
      .toBuffer(),
  );
const stored: AssetInput[] = [];
const assets: AssetStore = {
  put: async (_ws, input) => (
    stored.push(input),
    {
      assetId: crypto.randomUUID(),
      sha256: "x",
      mime: input.mime,
      bytes: 1,
      width: null,
      height: null,
    }
  ),
};
const deps = (over: Partial<RegionReader> = {}): RegionReader => ({
  assets,
  ocr: { transcribe: async () => "## Title\n\nBody text." },
  localOcr: { text: async () => "" },
  log: testLog,
  ...over,
});
const ctx = (mask: MaskSources = NO_MASK_SOURCES, usdLeft?: number) => ({
  workspaceId: "w",
  signal: new AbortController().signal,
  step: new StepCollector(usdLeft === undefined ? {} : { usdLeft }),
  mask,
});
const region = async () => ({
  png: await png(),
  width: 40,
  height: 20,
  label: "Page region 1",
  imageOrigin: "dom" as const,
  anchor: null,
});
const vault: MaskSources = {
  nodeIds: () => [],
  hasSecrets: () => true,
  redact: (t) => t.replaceAll("hunter2", "[secret]"),
};

describe("readRegion (one OCR pipeline for web canvas tiles and textless PDF pages, final I2)", () => {
  it("stores the image and keeps the text as unverified ocr_model blocks", async () => {
    const out = await readRegion(deps(), ctx(), await region());
    expect(out.lost).toBe(false);
    expect(out.blocks.map((b) => [b.type, b.origin, b.verified])).toEqual([
      ["image", "dom", true],
      ["heading", "ocr_model", false],
      ["paragraph", "ocr_model", false],
    ]);
  });
  it("counts an empty read as lost", async () => {
    const out = await readRegion(
      deps({ ocr: { transcribe: async () => "  " } }),
      ctx(),
      await region(),
    );
    expect(out).toMatchObject({ lost: true, blocks: [{ type: "image" }] });
  });
  it("counts withheld pixels as lost and stores nothing", async () => {
    const before = stored.length;
    const out = await readRegion(
      deps({ localOcr: { text: async () => "pw hunter2" } }),
      ctx(vault),
      await region(),
    );
    expect(out).toEqual({ blocks: [], lost: true });
    expect(stored.length).toBe(before);
  });
  it("stops at a spent budget before calling OpenAI, and counts the region lost (final I6)", async () => {
    let calls = 0;
    const ocr = createOcrModel({
      responses: {
        stream: () => {
          throw new Error("unused");
        },
        create: async () => {
          throw new Error("unused");
        },
        parse: async () => {
          calls++;
          return {
            parsed: { markdown: "x" } as never,
            model: "gpt-6-astra",
            tokens: { input: 1, cached: 0, output: 1 },
          };
        },
      },
    });
    const out = await readRegion(deps({ ocr }), ctx(NO_MASK_SOURCES, 0), await region());
    expect(calls).toBe(0);
    expect(out.lost).toBe(true);
  });
});
