import { describe, expect, it } from "vitest";
import { MODELS } from "@mastertutor/contracts";
import { startLlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { ModelCaller } from "./caller.ts";
import { createOpenAIModelClient, type ModelRequest } from "./client.ts";
import { instantClock } from "../runtime/clock.ts";
import { Interrupted, ModelUnavailable } from "../runtime/errors.ts";
import { installTestTelemetry } from "@mastertutor/telemetry/testing";

const request: ModelRequest = {
  model: MODELS.agentPrimary,
  instructions: "i",
  input: [{ role: "user", content: "[scenario:stall]" }],
  format: "agent_turn",
  toolProfile: "browser_use",
};

describe("decide deadline", () => {
  it.each([false, true])(
    "records timeout and retry counts when the retry also stalls: %s",
    async (twice) => {
      const telemetry = installTestTelemetry();
      let attempts = 0;
      const caller = new ModelCaller(
        {
          create: async (request, signal) => {
            if (++attempts === 1 || twice)
              return new Promise((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
              );
            return {
              id: "fresh",
              model: request.model,
              output: [],
              usage: { input: 17, cached: 0, cacheWrite: 0, output: 3 },
            };
          },
        },
        { clock: instantClock(), fallbackAfter5xx: 3, decideTimeoutMs: 20 },
      );
      try {
        const call = caller.call(request, new AbortController().signal);
        if (twice) await expect(call).rejects.toBeInstanceOf(ModelUnavailable);
        else await call;
        const span = telemetry.spans().find((span) => span.name === "mt.model.request")!;
        expect(span.attributes).toMatchObject({
          "mt.model.decide_timeouts": twice ? 2 : 1,
          "mt.model.decide_retries": 1,
          "mt.model.attempts": 2,
        });
        expect(await telemetry.metric("mt.model.tokens")).toHaveLength(twice ? 0 : 3);
      } finally {
        await telemetry.shutdown();
      }
    },
  );

  it("reports a slow request and retry, then clears notices when the call settles", async () => {
    const captions: string[] = [];
    let attempts = 0;
    const caller = new ModelCaller(
      {
        create: async (request, signal) => {
          if (++attempts === 1)
            return new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
            );
          return {
            id: "fresh",
            model: request.model,
            output: [],
            usage: { input: 0, cached: 0, cacheWrite: 0, output: 0 },
          };
        },
      },
      { clock: instantClock(), fallbackAfter5xx: 3, decideTimeoutMs: 60, decideSlowMs: 10 },
    );
    await caller.call(request, new AbortController().signal, async (caption) => {
      captions.push(caption);
    });
    expect(captions).toEqual(["Waiting on the model…", "Model slow, retrying…"]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(captions).toHaveLength(2);
  });

  it("aborts a stalled HTTP request and obtains a fresh reply once", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = await startLlmMock({
      scenarios: [
        {
          name: "stall",
          turns: [
            { hold: () => held, outputs: [{ type: "turn", status: "done", reason: "stale" }] },
            {
              outputs: [{ type: "turn", status: "done", reason: "fresh" }],
              usage: { input: 17, output: 3 },
            },
          ],
        },
      ],
    });
    const caller = new ModelCaller(
      createOpenAIModelClient({ apiKey: "k", baseURL: `${mock.url}/v1` }),
      {
        clock: instantClock(),
        fallbackAfter5xx: 3,
        decideTimeoutMs: 200,
      },
    );
    const controller = new AbortController();
    // Bounds the pre-fix reproduction without leaving an HTTP request behind.
    const watchdog = setTimeout(() => controller.abort(new Error("deadline missing")), 1500);
    try {
      const result = await caller.call(request, controller.signal);
      expect(JSON.stringify(result.reply.output)).toContain("fresh");
      expect(result.reply.usage).toMatchObject({ input: 17, output: 3 });
      expect(mock.requestsFor("stall")).toHaveLength(2);
      expect(controller.signal.aborted).toBe(false);
    } finally {
      clearTimeout(watchdog);
      release();
      await mock.close();
    }
  });

  it("fails through ModelUnavailable after two deadlines without fallback", async () => {
    const signals: AbortSignal[] = [];
    const caller = new ModelCaller(
      {
        create: async (_request, signal) => {
          signals.push(signal);
          return new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
        },
      },
      { clock: instantClock(), fallbackAfter5xx: 3, decideTimeoutMs: 20 },
    );
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(new Error("deadline missing")), 200);
    try {
      await expect(caller.call(request, controller.signal)).rejects.toBeInstanceOf(
        ModelUnavailable,
      );
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      clearTimeout(watchdog);
    }
  });

  it.each(["takeover", "message"] as const)(
    "preserves %s cancellation without retry",
    async (reason) => {
      const controller = new AbortController();
      const interruption = new Interrupted(reason);
      let calls = 0;
      const caller = new ModelCaller(
        {
          create: async (_request, signal) => {
            calls++;
            queueMicrotask(() => controller.abort(interruption));
            return new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
            );
          },
        },
        { clock: instantClock(), fallbackAfter5xx: 3, decideTimeoutMs: 20 },
      );
      await expect(caller.call(request, controller.signal)).rejects.toBe(interruption);
      expect(calls).toBe(1);
    },
  );
});
