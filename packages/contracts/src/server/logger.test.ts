import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { logs, type LogRecord } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CREDENTIAL_FIELDS, VAULT_SECRET_FIELDS } from "../enums.ts";
import { disableLogBridge, enableLogBridge, withRunId } from "./log-bridge.ts";
import { createLogger } from "./logger.ts";

function capture() {
  const lines: string[] = [];
  return { lines, destination: { write: (line: string) => void lines.push(line) } };
}

describe("createLogger", () => {
  it("redacts secret-bearing fields at the top level and one level deep", () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: "test", destination });
    log.info(
      {
        password: "p1",
        code: "123456",
        authorization: "Bearer x",
        fill: { password: "p2", sealed: "s", secret: "t", code: "654321" },
        alias: "zybooks",
      },
      "fill",
    );
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry.password).toBe("[redacted]");
    expect(entry.code).toBe("[redacted]");
    expect(entry.authorization).toBe("[redacted]");
    expect(entry.fill).toEqual({
      password: "[redacted]",
      sealed: "[redacted]",
      secret: "[redacted]",
      code: "[redacted]",
    });
    expect(entry.alias).toBe("zybooks");
    expect(entry.service).toBe("test");
    for (const secret of ["p1", "p2", "123456", "654321", "Bearer x"]) {
      expect(lines.join("\n")).not.toContain(secret);
    }
  });

  it("redacts every credential and vault secret field plus token, cookie headers", () => {
    const keys = [
      ...new Set([
        ...CREDENTIAL_FIELDS,
        ...VAULT_SECRET_FIELDS,
        "token",
        "cookie",
        "set-cookie",
        "authorization",
      ]),
    ];
    for (const key of keys) {
      const { lines, destination } = capture();
      const log = createLogger({ service: "test", destination });
      log.info({ [key]: "top-secret-value", nested: { [key]: "top-secret-value" } }, "x");
      const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(entry[key], key).toBe("[redacted]");
      expect((entry.nested as Record<string, unknown>)[key], key).toBe("[redacted]");
      expect(lines.join("\n")).not.toContain("top-secret-value");
    }
  });
});

const RUN = "11111111-1111-4111-8111-111111111111";
const SPAN_CONTEXT = {
  traceId: "0af7651916cd43dd8448eb211c80319c",
  spanId: "b7ad6b7169203331",
  traceFlags: 1,
};

function captureOtel(): LogRecord[] {
  const records: LogRecord[] = [];
  logs.setGlobalLoggerProvider({
    getLogger: () => ({ emit: (r) => void records.push(r), enabled: () => true }),
  });
  return records;
}

describe("createLogger and the OTel bridge (spec §9)", () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });
  afterEach(() => {
    disableLogBridge();
    logs.disable();
  });

  it("adds trace_id, span_id and run_id from the active context, only when present", () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: "test", destination });
    const active = withRunId(trace.setSpanContext(ROOT_CONTEXT, SPAN_CONTEXT), RUN);
    context.with(active, () => log.info({ step: "observe" }, "step"));
    log.info("outside");
    const [inside, outside] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(inside).toMatchObject({
      trace_id: SPAN_CONTEXT.traceId,
      span_id: SPAN_CONTEXT.spanId,
      run_id: RUN,
      step: "observe",
    });
    expect(outside).not.toHaveProperty("trace_id");
    expect(outside).not.toHaveProperty("run_id");
  });

  it("bridges nothing until enabled, then only redacted lines, never the telemetry module", () => {
    const records = captureOtel();
    const { lines, destination } = capture();
    const log = createLogger({ service: "agent", destination });
    log.info({ password: "hunter2-canary" }, "before");
    expect(records).toEqual([]);
    enableLogBridge();
    context.with(trace.setSpanContext(ROOT_CONTEXT, SPAN_CONTEXT), () =>
      log.warn({ password: "hunter2-canary", alias: "zybooks", errorCode: "x_y" }, "fill"),
    );
    log.warn({ module: "telemetry", errorCode: "telemetry_dropped" }, "dropped");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      severityText: "WARN",
      body: "fill",
      attributes: { password: "[redacted]", alias: "zybooks", errorCode: "x_y", service: "agent" },
    });
    expect(JSON.stringify(records)).not.toContain("hunter2-canary");
    expect(lines).toHaveLength(3);
  });
});
