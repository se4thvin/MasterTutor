import { describe, expect, it } from "vitest";
import { StepCollector } from "../loop/step-collector.ts";
import { createTranscriber } from "./transcriber.ts";

describe("createTranscriber", () => {
  it("sends the chunk through the factory, keeps non-empty segments and books the seconds", async () => {
    const sent: Array<{ filename: string; bytes: number }> = [];
    const step = new StepCollector();
    const transcriber = createTranscriber({
      audio: {
        transcriptions: {
          create: async (input) => {
            sent.push({ filename: input.filename, bytes: input.bytes.byteLength });
            return {
              seconds: 60,
              segments: [
                { start: 1, end: 2, text: " Hi ", speaker: "A" },
                { start: 2, end: 3, text: "", speaker: null },
              ],
            };
          },
        },
      },
    });
    expect(
      await transcriber.transcribe(
        { bytes: new TextEncoder().encode("RIFF"), filename: "chunk-000.wav" },
        { signal: new AbortController().signal, step },
      ),
    ).toEqual([{ start: 1, end: 2, text: "Hi", speaker: "A" }]);
    expect(sent).toEqual([{ filename: "chunk-000.wav", bytes: 4 }]);
    expect(step.usage.usd).toBeCloseTo(0.006, 6);
  });
});
