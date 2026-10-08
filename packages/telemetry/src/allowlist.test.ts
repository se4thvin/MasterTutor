import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
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

  it("never exports a status message: third-party spans put raw error text there (review C1)", async () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new AllowlistSpanExporter(memory, () => undefined))],
    });
    const span = provider.getTracer("undici").startSpan("POST");
    span.setStatus({ code: SpanStatusCode.ERROR, message: "Key (email)=(canary@example.test)" });
    span.end();
    await provider.forceFlush();
    const [exported] = memory.getFinishedSpans();
    expect(exported!.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(JSON.stringify(exported!.status)).not.toContain("canary");
  });

  it("no span name, event name or allowlisted value carries a full URL (review I2)", async () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new AllowlistSpanExporter(memory, () => undefined))],
    });
    const endpoint = "https://push.example/wpush/v2/canary-device-token?x=1";
    const span = provider.getTracer("next.js").startSpan(`fetch POST ${endpoint}`, {
      attributes: { "next.span_name": `fetch POST ${endpoint}`, "http.route": "/api/runs/[id]" },
    });
    span.addEvent(`retry ${endpoint}`);
    span.end();
    await provider.forceFlush();
    const [exported] = memory.getFinishedSpans();
    expect(JSON.stringify([exported!.name, exported!.attributes, exported!.events])).not.toMatch(
      /:\/\/|canary-device-token/,
    );
    expect(exported!.name).toBe("fetch POST [url]");
    expect(exported!.attributes["http.route"]).toBe("/api/runs/[id]");
  });
});
