import { createDb } from "@mastertutor/db";
import { appendItems, createThread, saveHandles, saveResult } from "@mastertutor/db";
import { seedMember, startTestDatabase } from "@mastertutor/db/testing";
import { expect, it } from "vitest";
import { threadView } from "./store.ts";

it("replays a thread as messages and results with server-built links (spec §7.3)", async () => {
  const database = await startTestDatabase();
  const owner = createDb(database.ownerUrl, { max: 1 });
  const observer = createDb(database.observerUrl, { max: 1 });
  try {
    const { workspaceId, userId } = await seedMember(owner.db);
    const runId = "6f2c8a3e-0000-4000-8000-00000000000a";
    const id = await createThread(observer.db, { workspaceId, createdBy: userId, title: "Why?" });
    await saveHandles(observer.db, id, { R1: runId });
    await appendItems(observer.db, id, [
      { role: "user", item: { role: "user", content: "Why did it fail?" } },
      {
        role: "assistant",
        item: {
          role: "assistant",
          content: [{ type: "output_text", text: "It ran out of budget [Q1]. [Q99]" }],
        },
      },
    ]);
    await saveResult(observer.db, id, {
      resultId: "Q1",
      tool: "runs_find",
      summary: "failed runs",
      query: {},
      columns: ["run", "status"],
      rows: [["R1", "failed"]],
      rowCount: 1,
      truncated: false,
      tookMs: 2,
      tainted: false,
    });
    const view = await threadView(observer.db, workspaceId, id, "https://mt.example.com");
    expect(view?.messages).toEqual([
      { role: "user", text: "Why did it fail?", citations: [] },
      { role: "assistant", text: "It ran out of budget [Q1].", citations: ["Q1"] },
    ]);
    expect(view?.results[0]?.links.app).toBe(`/runs/${runId}`);
    expect(JSON.stringify(view?.results[0]?.rows)).not.toContain(runId);
    expect(
      await threadView(
        observer.db,
        "6f2c8a3e-0000-4000-8000-00000000000b",
        id,
        "https://mt.example.com",
      ),
    ).toBeNull();
  } finally {
    await observer.close();
    await owner.close();
    await database.stop();
  }
}, 300_000);
