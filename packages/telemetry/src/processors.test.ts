import { ExportResultCode } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { BoundedSpanProcessor, exportOnce } from "./processors.ts";

const failing: SpanExporter = {
  export: (_spans, done) => done({ code: ExportResultCode.FAILED, error: new Error("down") }),
  shutdown: async () => undefined,
};

describe("bounded processors", () => {
  it("exportOnce resolves on success and rejects on failure", async () => {
    await expect(exportOnce(failing, [])).rejects.toThrow("down");
  });

  it("counts spans an unreachable collector could not take, and onEnd never throws", async () => {
    const drops: number[] = [];
    const processor = new BoundedSpanProcessor(
      failing,
      { maxQueue: 10, maxBatch: 5, intervalMs: 60_000 },
      (count) => drops.push(count),
    );
    const provider = new BasicTracerProvider({ spanProcessors: [processor] });
    for (let i = 0; i < 3; i++) provider.getTracer("t").startSpan("s").end();
    await processor.forceFlush();
    expect(drops.reduce((a, b) => a + b, 0)).toBe(3);
    await processor.shutdown();
  });

  it("skips unsampled spans", async () => {
    const seen: ReadableSpan[] = [];
    const processor = new BoundedSpanProcessor(
      {
        export: (spans, done) => (seen.push(...spans), done({ code: ExportResultCode.SUCCESS })),
        shutdown: async () => undefined,
      },
      { maxQueue: 10, maxBatch: 5, intervalMs: 60_000 },
      () => undefined,
    );
    processor.onEnd({
      spanContext: () => ({ traceId: "a", spanId: "b", traceFlags: 0 }),
    } as ReadableSpan);
    await processor.forceFlush();
    expect(seen).toEqual([]);
  });
});
