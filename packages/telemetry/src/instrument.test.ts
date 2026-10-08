import { SpanStatusCode } from "@opentelemetry/api";
import { createLogger } from "@mastertutor/contracts/server";
import { SPAN } from "@mastertutor/contracts/telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorCodeOf, instrument } from "./instrument.ts";
import { installTestTelemetry, type TestTelemetry } from "./testing.ts";

class ModelUnavailable extends Error {
  readonly code = "model_request_rejected";
  constructor() {
    super("The model rejected: the page said hunter2-canary");
    this.name = "ModelUnavailable";
  }
}
class Interrupted extends Error {
  readonly why: string;
  constructor(why: string) {
    super(`Run interrupted: ${why}`);
    this.why = why;
    this.name = "Interrupted";
  }
}
const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";

let telemetry: TestTelemetry;
beforeEach(() => {
  telemetry = installTestTelemetry();
});
afterEach(async () => {
  await telemetry.shutdown();
});

describe("instrument (spec §7)", () => {
  it("records the span with its product attributes", async () => {
    const result = await instrument(SPAN.tool, { "mt.tool.name": "capture" }, async (span) => {
      span.set({ "mt.tool.outcome": "ok", "mt.capture.fidelity": "verified" });
      return 42;
    });
    expect(result).toBe(42);
    const [span] = telemetry.spans();
    expect(span!.name).toBe("mt.tool");
    expect(span!.attributes).toEqual({
      "mt.tool.name": "capture",
      "mt.tool.outcome": "ok",
      "mt.capture.fidelity": "verified",
    });
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("records an error by its product code only: never its message or stack", async () => {
    await expect(
      instrument(SPAN.modelRequest, {}, async () => {
        throw new ModelUnavailable();
      }),
    ).rejects.toThrow(ModelUnavailable);
    const [span] = telemetry.spans();
    expect(span!.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "model_request_rejected",
    });
    expect(span!.attributes["mt.error.code"]).toBe("model_request_rejected");
    expect(span!.events.map((e) => [e.name, e.attributes])).toEqual([
      ["exception", { "exception.type": "ModelUnavailable" }],
    ]);
    expect(await telemetry.exported()).not.toContain("hunter2-canary");
  });

  it("marks an interruption as such, not as an error", async () => {
    await expect(
      instrument(
        SPAN.step,
        { "mt.step.phase": "act" },
        async () => {
          throw new Interrupted("takeover");
        },
        { expected: (e) => (e instanceof Interrupted ? e.why : null) },
      ),
    ).rejects.toThrow(Interrupted);
    const [span] = telemetry.spans();
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);
    expect(span!.attributes["mt.interruption"]).toBe("takeover");
    expect(span!.attributes).not.toHaveProperty("mt.error.code");
  });

  it("fail() records a normalised code without throwing", async () => {
    await instrument(SPAN.slotReset, {}, async (span) => span.fail("Not A Code!"));
    expect(telemetry.spans()[0]!.attributes["mt.error.code"]).toBe("unknown_error");
  });

  it("concurrent runs keep their own run_id on log lines (Review Focus 5)", async () => {
    const lines: string[] = [];
    const log = createLogger({
      service: "t",
      destination: { write: (line: string) => void lines.push(line) },
    });
    await Promise.all(
      [RUN_A, RUN_B].map((runId) =>
        instrument(SPAN.step, { "mt.run.id": runId }, async () => {
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setImmediate(resolve));
            log.info({ expected: runId }, "tick");
          }
        }),
      ),
    );
    expect(lines).toHaveLength(40);
    for (const line of lines.map((l) => JSON.parse(l) as { run_id: string; expected: string }))
      expect(line.run_id).toBe(line.expected);
  });

  it("truncates long strings and caps arrays", async () => {
    await instrument(
      SPAN.tool,
      { "mt.vault.alias": "a".repeat(500), "mt.action.types": Array(40).fill("click") },
      async () => undefined,
    );
    const [span] = telemetry.spans();
    expect((span!.attributes["mt.vault.alias"] as string).length).toBe(256);
    expect((span!.attributes["mt.action.types"] as string[]).length).toBe(16);
  });
});

describe("errorCodeOf", () => {
  it("prefers a valid code, then a snake-cased name, never a message", () => {
    expect(errorCodeOf(new ModelUnavailable())).toBe("model_request_rejected");
    expect(errorCodeOf(Object.assign(new Error("x"), { name: "ContextOverflow" }))).toBe(
      "context_overflow",
    );
    expect(errorCodeOf(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("error");
    expect(errorCodeOf("a string")).toBe("unknown_error");
    expect(errorCodeOf(null)).toBe("unknown_error");
  });
});

describe("without an SDK", () => {
  it("still runs the work", async () => {
    await telemetry.shutdown();
    expect(await instrument(SPAN.tool, {}, async () => "ran")).toBe("ran");
    telemetry = installTestTelemetry();
  });
});
