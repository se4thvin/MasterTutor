import { FillCredentialArgs, FillCredentialResult } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { SPAN } from "@mastertutor/contracts/telemetry";
import { instrument, recordRunEvent } from "@mastertutor/telemetry";
import { installTestTelemetry } from "@mastertutor/telemetry/testing";
import { EMPTY_USAGE } from "@mastertutor/contracts";
import type { Database } from "@mastertutor/db";
import { describe, expect, it } from "vitest";
import type { BrowserSession } from "./browser/session.ts";
import { NO_MASK_SOURCES } from "./browser/masking.ts";
import { APIError } from "./llm/openai.ts";
import { ModelCaller } from "./llm/caller.ts";
import { StepCollector } from "./loop/step-collector.ts";
import { NO_SESSION_STORE, StepStore } from "./loop/step-store.ts";
import { createMemoryStorage } from "./testing/memory-storage.ts";
import { instantClock } from "./runtime/clock.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { ToolError, register } from "./tools/types.ts";

const CANARY = "sk-CANARY0123456789abcdefghij";
const PAGE_TEXT = "Welcome back, CANARY-PAGE-TEXT";
const PNG = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");

describe("no secret, page text, prompt or screenshot leaves through telemetry (spec §14)", () => {
  it("canaries pass through seams 1-6 and appear nowhere in exported telemetry", async () => {
    const telemetry = installTestTelemetry();
    const log = createLogger({ service: "agent", destination: { write: () => undefined } });
    const tool = register({
      name: "fill_credential",
      args: FillCredentialArgs,
      result: FillCredentialResult,
      untrusted: false,
      run: async () => {
        throw new ToolError("needs_human", `${PAGE_TEXT} ${CANARY}`);
      },
    });
    const ctx = {
      runId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      session: {
        page: { url: () => `https://a.example/?token=${CANARY}` },
      } as unknown as BrowserSession,
      signal: new AbortController().signal,
      log,
      approval: null,
      step: new StepCollector(),
      mask: NO_MASK_SOURCES,
      slotName: "browser-1",
    };
    await instrument(SPAN.step, { "mt.run.id": ctx.runId, "mt.step.phase": "act" }, async () => {
      await new ToolRegistry([tool], log).run(
        "fill_credential",
        { alias: "zybooks", field: "password", target: "e1" },
        ctx,
      );
      await new ModelCaller(
        {
          create: async () => {
            const text = `${PAGE_TEXT} prompt: ${CANARY} data:image/png;base64,${PNG}`;
            throw APIError.generate(400, { error: { message: text } }, text, new Headers());
          },
        },
        { clock: instantClock(), fallbackAfter5xx: 3 },
      )
        .call(
          {
            model: "gpt-6-astra",
            instructions: CANARY,
            input: [],
            format: "agent_turn",
            toolProfile: "browser_use",
          },
          ctx.signal,
        )
        .catch(() => undefined);
      log.info({ password: CANARY, code: "123456" }, "fill attempted");
      log.error({ err: new Error(`${PAGE_TEXT} ${CANARY}`), userId: CANARY }, "boot check failed");
      // Seam 5: a commit whose database error quotes a value (Postgres does: "Key (x)=(…)").
      const failing = {
        select: (shape: Record<string, unknown>) => ({
          from: () => ({
            where: async () => ["usage" in shape ? { usage: EMPTY_USAGE } : { value: null }],
          }),
        }),
        transaction: async () => {
          throw new Error(`duplicate key value: Key (secret)=(${CANARY}) ${PAGE_TEXT}`);
        },
      } as unknown as Database;
      const store = await StepStore.open({
        db: failing,
        storage: createMemoryStorage(),
        sessionStore: NO_SESSION_STORE,
        owner: "canary",
        run: { id: ctx.runId, workspaceId: ctx.workspaceId },
      });
      await store.commit({ run: { usage: { ...EMPTY_USAGE, usd: 1 } } }).catch(() => undefined);
      recordRunEvent({ type: "user_message", text: CANARY });
      recordRunEvent({ type: "error", code: "needs_human", message: PAGE_TEXT });
      await instrument(
        SPAN.tool,
        { ["user.prompt" as never]: CANARY } as never,
        async () => undefined,
      );
    });
    const exported = await telemetry.exported();
    for (const canary of [CANARY, "CANARY-PAGE-TEXT", PNG, "123456", "token="])
      expect(exported, canary).not.toContain(canary);
    expect(exported).toContain("mt.step");
    expect(telemetry.spans().map((s) => s.name)).toContain("mt.step.commit");
    await telemetry.shutdown();
  });
});
