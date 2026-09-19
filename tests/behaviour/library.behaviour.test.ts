import { noteBlocks, notes } from "@mastertutor/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createLibraryServices, libraryHooks } from "../../apps/agent/src/library.ts";
import { policyProblems } from "../llm-mock/src/policy.ts";
import type { MockTurn } from "../llm-mock/src/scenario.ts";
import { SITE } from "./constants.ts";
import { createRun, startBehaviourAgent, waitForRun, type BehaviourAgent } from "./harness.ts";

let agent: BehaviourAgent;
beforeAll(async () => {
  agent = await startBehaviourAgent({ hooks: (deps) => libraryHooks(createLibraryServices(deps)) });
});
afterAll(async () => {
  await agent?.stop();
});
// openai-data-policy.md rule 6 over every request on every path, after every test (D7, W7).
afterEach(() => {
  expect(agent.mock.failures.splice(0)).toEqual([]);
  expect(policyProblems(agent.mock.requests)).toEqual([]);
});

const capture: MockTurn = {
  outputs: [
    { type: "function", name: "capture", args: { scope: "page", selector: null, kind: null } },
  ],
};
const done: MockTurn = { outputs: [{ type: "turn", status: "done", reason: "Captured" }] };

describe("the library on a live run", () => {
  it("captures, embeds and files a note with stateless, anonymous requests only", async () => {
    agent.mock.setScenarios([{ name: "lib-docs", turns: [capture, done] }]);
    const runId = await createRun(
      agent,
      `[scenario:lib-docs] Capture ${SITE}/capture/docs/index.html`,
    );
    const run = await waitForRun(
      agent,
      runId,
      (r) => r.status === "completed",
      "run completed",
      180_000,
    );
    const [note] = await agent.owner.db.select().from(notes).where(eq(notes.id, run.noteId!));
    expect(note).toMatchObject({ fidelity: "verified", filedBy: "agent" });
    expect(note!.folderId).not.toBeNull();
    expect(new Set(agent.mock.requests.map((r) => r.path))).toEqual(
      new Set(["/v1/responses", "/v1/embeddings"]),
    );
    expect(agent.mock.requests.some((r) => r.body.text?.format?.name === "filing_decision")).toBe(
      true,
    );
  }, 240_000);

  it("sends opaque pages to OCR through the same factory", async () => {
    agent.mock.setStructured("ocr_text", () => ({ markdown: "Quarterly results" }));
    agent.mock.setScenarios([{ name: "lib-opaque", turns: [capture, done] }]);
    const runId = await createRun(
      agent,
      `[scenario:lib-opaque] Capture ${SITE}/capture/opaque/index.html`,
    );
    const run = await waitForRun(
      agent,
      runId,
      (r) => r.status === "completed",
      "run completed",
      180_000,
    );
    const blocks = await agent.owner.db
      .select()
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, run.noteId!));
    expect(blocks.some((b) => b.origin === "ocr_model")).toBe(true);
    expect(agent.mock.requests.some((r) => r.body.text?.format?.name === "ocr_text")).toBe(true);
  }, 240_000);
});
