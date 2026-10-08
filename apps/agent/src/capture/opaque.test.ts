import { EMPTY_USAGE } from "@mastertutor/contracts";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { StepCollector } from "../loop/step-collector.ts";
import { createOcrModel, OcrBudgetExhausted, ocrTiles } from "./opaque.ts";

const png = async (width: number, height: number) =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#fff" } })
      .png()
      .toBuffer(),
  );

describe("OCR input stays within 1280×800 (data policy rule 4, D5)", () => {
  it("scales wide images down and tiles tall ones", async () => {
    const tiles = await ocrTiles(await png(2448, 3168));
    expect(tiles.length).toBe(3);
    for (const tile of tiles) {
      const meta = await sharp(tile).metadata();
      expect(meta.width).toBeLessThanOrEqual(1280);
      expect(meta.height).toBeLessThanOrEqual(800);
    }
    expect(await ocrTiles(await png(100, 50))).toHaveLength(1);
  });
  it("sends each tile through the stateless parse with instructions and books the spend", async () => {
    const requests: Array<{ instructions: string; input: unknown; name: string }> = [];
    const model = createOcrModel({
      responses: {
        create: async () => {
          throw new Error("unused");
        },
        parse: async (request) => {
          requests.push(request as never);
          return {
            parsed: { markdown: `tile ${requests.length}` } as never,
            model: "gpt-6-astra",
            tokens: { input: 10, cached: 0, output: 5 },
          };
        },
      },
    });
    const step = new StepCollector();
    expect(
      await model.transcribe(await png(1224, 1584), { signal: new AbortController().signal, step }),
    ).toBe("tile 1\n\ntile 2");
    expect(requests.map((r) => r.name)).toEqual(["ocr_text", "ocr_text"]);
    expect(requests[0]!.instructions).toMatch(/Transcribe/);
    expect(JSON.stringify(requests[0]!.input)).not.toContain('"system"');
    expect(step.usage.inputTokens).toBe(20);
    expect(step.usage.usd).toBeGreaterThan(EMPTY_USAGE.usd);
  });
  it("checks the run's budget before every OCR call (final review I6)", async () => {
    let calls = 0;
    const model = createOcrModel({
      responses: {
        create: async () => {
          throw new Error("unused");
        },
        parse: async () => {
          calls++;
          return {
            parsed: { markdown: "tile" } as never,
            model: "gpt-6-astra",
            tokens: { input: 10, cached: 0, output: 5 },
          };
        },
      },
    });
    const broke = new StepCollector({ usdLeft: 0 });
    await expect(
      model.transcribe(await png(100, 50), { signal: new AbortController().signal, step: broke }),
    ).rejects.toBeInstanceOf(OcrBudgetExhausted);
    expect(calls).toBe(0);
  });
});
