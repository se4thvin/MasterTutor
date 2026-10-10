import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { noteBlocks, notes } from "@mastertutor/db";
import type { CaptureBrief } from "@mastertutor/contracts";
import type { RecordedRequest } from "../../../../tests/llm-mock/src/scenario.ts";
import { SITE } from "../../../../tests/behaviour/constants.ts";
import {
  createRun,
  startBehaviourAgent,
  waitForRun,
  type BehaviourAgent,
} from "../../../../tests/behaviour/harness.ts";
import { createLibraryServices, libraryHooks } from "../library.ts";
import { positionOrder } from "../notes/positions.ts";

const brief: CaptureBrief = {
  keep: ["reading_text", "definitions", "figures"],
  skip: ["activities", "platform_chrome", "navigation", "due_dates", "scores"],
  scopeNote: "Reading notes only; skip activities and platform chrome",
};
const passages = [
  "A bit has two possible values: 0 and 1.",
  "Two bits represent four values, in order: 00, 01, 10, 11.",
  "Each additional bit doubles the number of possible values.",
];
let agent: BehaviourAgent;
beforeAll(async () => {
  agent = await startBehaviourAgent({
    hooks: (deps) =>
      libraryHooks(
        createLibraryServices({
          ...deps,
          pdfWorkerUrl: "http://pdf-worker:8000",
          audioCaptureUrl: "http://audio-capture:8000",
        }),
      ),
  });
  agent.mock.setStructured("capture_intent", () => ({ brief, ambiguous: false }));
  agent.mock.setStructured("capture_selection", (body) => {
    const input = body.input as Array<{ content: string }>;
    const text = input[0]!.content;
    const data = JSON.parse(text.slice(text.indexOf("\n") + 1, text.lastIndexOf("\n"))) as {
      brief: CaptureBrief;
      blocks: Array<{ id: string; preview: string }>;
    };
    expect(data.brief).toEqual(brief);
    return {
      ids: data.blocks
        .filter((block) => passages.some((p) => block.preview.includes(p)))
        .map((block) => block.id),
    };
  });
}, 300_000);
afterAll(async () => {
  await agent?.stop();
});

it("a skip-activities brief captures pages without DevTools and stores only verbatim reading blocks", async () => {
  const check = (request: RecordedRequest) => {
    expect(request.body.instructions).toContain("The system applies the capture brief");
    expect(request.body.instructions).not.toContain("or the default");
    expect(request.body.instructions).toContain("Do not filter with selectors");
    expect(request.body.instructions).toContain("Do not open DevTools or view-source");
    expect(JSON.stringify(request.body.input)).toContain(
      "Capture brief (what the system will keep)",
    );
    expect(JSON.stringify(request.body.input)).toContain("activities");
  };
  const capture = {
    check,
    outputs: [
      {
        type: "function" as const,
        name: "capture",
        args: { scope: "page", selector: null, kind: null },
      },
    ],
  };
  const name = "reading-skip-activities";
  agent.mock.setScenarios([
    {
      name,
      turns: [
        {
          check,
          outputs: [
            {
              type: "computer",
              actions: [
                { type: "keypress", keys: ["CTRL", "L"] },
                { type: "type", text: `${SITE}/capture/intent-capture.html` },
                { type: "keypress", keys: ["ENTER"] },
              ],
            },
          ],
        },
        capture,
        capture,
        { check, outputs: [{ type: "turn", status: "done", reason: "Reading captured" }] },
      ],
    },
  ]);
  const runId = await createRun(
    agent,
    `[scenario:${name}] Take reading notes; skip activities and platform chrome`,
    { approvalMode: "bypass" },
  );
  const run = await waitForRun(
    agent,
    runId,
    (row) => row.status === "completed" || row.status === "waiting" || row.status === "failed",
    "reading capture complete",
  );
  expect(run.status).toBe("completed");
  expect(run.captureBrief).toEqual(brief);
  expect(agent.mock.failures).toEqual([]);
  const requests = agent.mock.requestsFor(name);
  expect(requests).toHaveLength(4);
  const replay = requests.at(-1)!.body.input as Array<{
    type?: string;
    name?: string;
    arguments?: string;
    actions?: Array<{ type: string; keys?: string[] }>;
  }>;
  const captures = replay.filter(
    (item) => item.type === "function_call" && item.name === "capture",
  );
  expect(captures).toHaveLength(2);
  for (const call of captures)
    expect(JSON.parse(call.arguments!)).toEqual({ scope: "page", selector: null, kind: null });
  expect(replay.some((item) => item.type === "function_call" && item.name === "read_page")).toBe(
    false,
  );
  const keys = replay
    .flatMap((item) => (item.type === "computer_call" ? (item.actions ?? []) : []))
    .filter((action) => action.type === "keypress")
    .map((action) => action.keys);
  expect(keys).toEqual([["CTRL", "L"], ["ENTER"]]);
  const storedNotes = await agent.owner.db.select().from(notes).where(eq(notes.runId, runId));
  expect(storedNotes).toHaveLength(1);
  const blocks = await agent.owner.db
    .select()
    .from(noteBlocks)
    .where(eq(noteBlocks.noteId, storedNotes[0]!.id))
    .orderBy(positionOrder);
  expect(blocks.map((block) => block.markdown)).toEqual(passages);
  expect(blocks.every((block) => block.origin === "dom")).toBe(true);
  expect(
    agent.mock.requests.filter((r) => r.body.text?.format?.name === "capture_selection"),
  ).toHaveLength(2);
});
