import {
  createDb,
  createFolder,
  deleteFolder,
  type DbHandle,
  folders,
  notes,
  runEvents,
} from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StepCollector } from "../loop/step-collector.ts";
import { fakeLibraryServices } from "../testing/library.ts";
import { commitStep, seedRun, testWrite } from "../testing/notes.ts";
import { fileRunNote, type FilingModel } from "./filing.ts";

let tdb: TestDatabase;
let h: DbHandle;
beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1"] });
  h = createDb(tdb.agentUrl);
});
afterAll(async () => {
  await h?.close();
  await tdb?.stop();
});

const services = (filing: FilingModel) => fakeLibraryServices(h.db, { filing });

async function runNote(options: { targetFolderId?: string; workspaceId?: string } = {}) {
  const scope = await seedRun(h.db, options);
  const w = testWrite(scope);
  const noteId = await services({
    decide: async () => ({ path: ["x"], createLeaf: false }),
  }).writer.ensureNote(w, { title: "Leaves", lede: "Light reactions" });
  await commitStep(h.db, scope.runId, w.step);
  return { scope, noteId };
}
const filed = (runId: string) =>
  h.db
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "filed")));

describe("fileRunNote", () => {
  it("creates one leaf in the completion transaction, files the note, emits `filed` and books the spend", async () => {
    const { scope, noteId } = await runNote();
    const bio = await createFolder(h.db, scope.workspaceId, { name: "Biology", parentId: null });
    const step = new StepCollector();
    const plan = await fileRunNote(
      services({
        decide: async (_input, { step: s }) => {
          s.addUsage({
            steps: 0,
            inputTokens: 5,
            cachedInputTokens: 0,
            outputTokens: 1,
            usd: 0.001,
            activeMs: 0,
          });
          return { path: ["Biology", "Plants"], createLeaf: true };
        },
      }),
      scope,
      step,
    );
    expect(await h.db.select().from(folders).where(eq(folders.name, "Plants"))).toHaveLength(0);
    await commitStep(h.db, scope.runId, step);
    expect(plan?.kind).toBe("create");
    const [note] = await h.db.select().from(notes).where(eq(notes.id, noteId));
    const [leaf] = await h.db.select().from(folders).where(eq(folders.id, note!.folderId!));
    expect(leaf).toMatchObject({ name: "Plants", parentId: bio.id });
    expect(note?.filedBy).toBe("agent");
    expect((await filed(scope.runId)).map((e) => e.payload)).toEqual([
      expect.objectContaining({
        type: "filed",
        noteId,
        path: ["Biology", "Plants"],
        filedBy: "agent",
      }),
    ]);
    expect(step.usage.usd).toBeGreaterThan(0);
  });

  it("reuses a case-variant sibling created meanwhile instead of adding a near-duplicate (QA-083)", async () => {
    const { scope, noteId } = await runNote();
    const bio = await createFolder(h.db, scope.workspaceId, { name: "Biology", parentId: null });
    const step = new StepCollector();
    const plan = await fileRunNote(
      services({ decide: async () => ({ path: ["Biology", "plants"], createLeaf: true }) }),
      scope,
      step,
    );
    expect(plan?.kind).toBe("create");
    const plants = await createFolder(h.db, scope.workspaceId, {
      name: "Plants",
      parentId: bio.id,
    });
    await commitStep(h.db, scope.runId, step);
    const [note] = await h.db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(note?.folderId).toBe(plants.id);
    const children = await h.db
      .select({ name: folders.name })
      .from(folders)
      .where(eq(folders.parentId, bio.id));
    expect(children.map((c) => c.name)).toEqual(["Plants"]);
  });

  it("uses the task's target folder without asking the model", async () => {
    const seedScope = await seedRun(h.db);
    const target = await createFolder(h.db, seedScope.workspaceId, {
      name: "Target",
      parentId: null,
    });
    const { scope, noteId } = await runNote({
      targetFolderId: target.id,
      workspaceId: seedScope.workspaceId,
    });
    let asked = false;
    const step = new StepCollector();
    await fileRunNote(
      services({ decide: async () => ((asked = true), { path: ["x"], createLeaf: true }) }),
      scope,
      step,
    );
    await commitStep(h.db, scope.runId, step);
    expect(asked).toBe(false);
    const [note] = await h.db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(note?.folderId).toBe(target.id);
  });

  it("never blocks completion: a failing leaf write leaves the note unfiled and the rest commits", async () => {
    const { scope, noteId } = await runNote();
    const parent = await createFolder(h.db, scope.workspaceId, {
      name: "Gone soon",
      parentId: null,
    });
    const step = new StepCollector();
    await fileRunNote(
      services({ decide: async () => ({ path: ["Gone soon", "Child"], createLeaf: true }) }),
      scope,
      step,
    );
    await deleteFolder(h.db, scope.workspaceId, parent.id);
    await expect(commitStep(h.db, scope.runId, step)).resolves.toBeUndefined();
    const [note] = await h.db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(note?.folderId).toBeNull();
    expect(await filed(scope.runId)).toEqual([]);
  });

  it("leaves the note unfiled when the model fails, and respects user moves", async () => {
    const { scope, noteId } = await runNote();
    expect(
      await fileRunNote(
        services({
          decide: async () => {
            throw new Error("down");
          },
        }),
        scope,
        new StepCollector(),
      ),
    ).toEqual({ kind: "unfiled" });
    await h.db.update(notes).set({ filedBy: "user" }).where(eq(notes.id, noteId));
    expect(
      await fileRunNote(
        services({ decide: async () => ({ path: ["A"], createLeaf: true }) }),
        scope,
        new StepCollector(),
      ),
    ).toBeNull();
  });
});
