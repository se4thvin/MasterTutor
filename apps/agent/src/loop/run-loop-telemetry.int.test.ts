import { createLogger } from "@mastertutor/contracts/server";
import { METRIC } from "@mastertutor/contracts/telemetry";
import { createDb, runs, type DbHandle } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLlmMock, type LlmMock } from "../../../../tests/llm-mock/src/server.ts";
import { ModelCaller } from "../llm/caller.ts";
import { createOpenAIModelClient } from "../llm/client.ts";
import { instantClock } from "../runtime/clock.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { insertRun, seedWorkspace } from "../testing/db.ts";
import { FakeLoopBrowser } from "../testing/fake-loop-browser.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { withHooks } from "./hooks.ts";
import { RunLoop } from "./run-loop.ts";
import { snapshotOf } from "./run-state.ts";
import { NO_SESSION_STORE, StepStore } from "./step-store.ts";

const OWNER = "loop-telemetry";
let database: TestDatabase;
let owner: DbHandle;
let agent: DbHandle;
let mock: LlmMock;
let telemetry: TestTelemetry;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl);
  agent = createDb(database.agentUrl);
  mock = await startLlmMock();
  telemetry = installTestTelemetry();
});
afterAll(async () => {
  await telemetry?.shutdown();
  await mock?.close();
  await agent?.close();
  await owner?.close();
  await database?.stop();
});

describe("a real loop emits the product telemetry (spec §7.3, §15)", () => {
  it("records every phase, the model request, the computer call, commits and spend", async () => {
    mock.setScenarios([
      {
        name: "t1",
        turns: [
          {
            outputs: [
              { type: "computer", actions: [{ type: "click", x: 10, y: 20, button: "left" }] },
            ],
          },
          { outputs: [{ type: "turn", status: "done", reason: "ok" }] },
        ],
      },
    ]);
    const workspaceId = await seedWorkspace(owner.db);
    const row = await insertRun(owner.db, {
      workspaceId,
      goal: "[scenario:t1] Do the task",
      status: "running",
      leaseOwner: OWNER,
    });
    const storage = createMemoryStorage();
    const [fresh] = await owner.db.select().from(runs).where(eq(runs.id, row.id));
    const loop = await RunLoop.restore(
      {
        db: agent.db,
        storage,
        caller: new ModelCaller(
          createOpenAIModelClient({ apiKey: "k", baseURL: `${mock.url}/v1` }),
          { clock: instantClock(), fallbackAfter5xx: 3 },
        ),
        browser: new FakeLoopBrowser(),
        hooks: withHooks(),
        clock: instantClock(),
        config: runtimeConfig(),
        log: createLogger({ service: "test", level: "silent" }),
        store: await StepStore.open({
          db: agent.db,
          storage,
          sessionStore: NO_SESSION_STORE,
          owner: OWNER,
          run: row,
        }),
      },
      snapshotOf(fresh!),
    );
    for (let i = 0; i < 20; i++) {
      const outcome = await loop.step(new AbortController().signal);
      if (outcome.kind !== "continue") break;
    }
    const spans = telemetry.spans();
    const phases = new Set(
      spans.filter((s) => s.name === "mt.step").map((s) => s.attributes["mt.step.phase"]),
    );
    expect([...phases].sort()).toEqual(["act", "approve", "decide", "observe"]);
    expect(
      spans.some(
        (s) => s.name === "mt.model.request" && Number(s.attributes["mt.model.tokens.input"]) > 0,
      ),
    ).toBe(true);
    expect(
      spans.some((s) => s.name === "mt.tool" && s.attributes["mt.tool.name"] === "computer"),
    ).toBe(true);
    expect(spans.some((s) => s.name === "mt.step.commit")).toBe(true);
    for (const s of spans.filter((s) => s.name === "mt.step"))
      expect(s.attributes["mt.run.id"]).toBe(row.id);
    expect((await telemetry.metric(METRIC.spendUsd.name))[0]?.value ?? 0).toBeGreaterThan(0);
    expect(await telemetry.metric(METRIC.runsEnded.name)).toEqual([
      { value: 1, attributes: { "mt.run.status": "completed" } },
    ]);
  });
});
