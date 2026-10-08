import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { AllowlistSpanExporter } from "./allowlist.ts";

describe("AllowlistSpanExporter (spec §5.2, §14)", () => {
  it("exports only allowlisted attributes, filters events, and counts what it dropped", async () => {
    const memory = new InMemorySpanExporter();
    let dropped = 0;
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(new AllowlistSpanExporter(memory, (n) => (dropped += n))),
      ],
    });
    const span = provider.getTracer("t").startSpan("mt.tool", {
      attributes: {
        "mt.tool.name": "capture",
        "server.address": "garage",
        "url.full": "http://garage:3900/mastertutor/downloads/r/private.pdf",
        "user.goal": "page text canary",
      },
    });
    span.addEvent("exception", {
      "exception.type": "ToolError",
      "exception.message": "the page said hunter2",
    });
    span.end();
    await provider.forceFlush();
    const [exported] = memory.getFinishedSpans();
    expect(exported!.attributes).toEqual({ "mt.tool.name": "capture", "server.address": "garage" });
    expect(exported!.events[0]!.attributes).toEqual({ "exception.type": "ToolError" });
    expect(exported!.spanContext().spanId).toBe(span.spanContext().spanId);
    expect(exported!.name).toBe("mt.tool");
    expect(dropped).toBe(3);
  });
});
