import { Uuid } from "@mastertutor/contracts";
import { createDb, type DbHandle, noteBlocks, objectDeletions, sources } from "@mastertutor/db";
import { startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { sha256Hex } from "../notes/hash.ts";
import type { BlockDraft } from "../notes/note-writer.ts";
import { fakeLibraryServices } from "../testing/library.ts";
import { commitStep, seedRun } from "../testing/notes.ts";
import { testToolContext } from "../testing/tool-context.ts";
import { persistCapture, type PersistDraft } from "./capture-tool.ts";

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

const block = (markdown: string, n: number): BlockDraft => ({
  type: "paragraph",
  markdown,
  origin: "dom",
  assetId: null,
  verified: true,
  anchor: {
    selector: `#p${n}`,
    xpath: `/html[1]/body[1]/p[${n}]`,
    start: 0,
    end: markdown.length,
    textFragment: null,
    domOrder: [0, 1, n],
  },
});
const draft = (blocks: BlockDraft[], scope = "page"): PersistDraft => ({
  kind: "web",
  url: "https://example.com/section/1",
  canonicalUrl: "https://example.com/book",
  title: "Section 1.1",
  lede: null,
  faviconUrl: null,
  blocks,
  coverage: 1,
  contentSha256: sha256Hex(blocks.map((b) => b.markdown).join("\n\n")),
  snapshot: null,
  meta: { scope },
  dedupe: scope === "page",
});
const ordered = (noteId: string) =>
  h.db
    .select()
    .from(noteBlocks)
    .where(eq(noteBlocks.noteId, noteId))
    .orderBy(sql`${noteBlocks.position} collate "C"`);

async function setup() {
  const scope = await seedRun(h.db);
  const services = fakeLibraryServices(h.db);
  const context = () => testToolContext({ ...scope, session: {} as BrowserSession });
  const capture = async (input: PersistDraft) => {
    const ctx = context();
    const result = await persistCapture(services, ctx, input);
    await commitStep(h.db, scope.runId, ctx.step);
    return { ...result, noteId: Uuid.parse(result.noteId) };
  };
  return { scope, services, context, capture };
}

describe("capture reconciliation", () => {
  it("updates changed pages in source order while keeping unchanged block IDs and distinct anchors", async () => {
    const { capture } = await setup();
    const a = block("First verbatim sentence.", 1);
    const b = block("Repeated verbatim sentence.", 2);
    const c = block("Repeated verbatim sentence.", 3);
    const first = await capture(draft([a, b]));
    const second = await capture(draft([c, a, b, b]));
    expect(second.blockIds.slice(1)).toEqual(first.blockIds);
    expect((await ordered(first.noteId)).map((b) => b.markdown)).toEqual([
      c.markdown,
      a.markdown,
      b.markdown,
    ]);
    expect(
      await h.db
        .select()
        .from(sources)
        .where(sql`${sources.meta}->>'noteId' = ${first.noteId}`),
    ).toHaveLength(1);
    // Same text fingerprint, different order/anchors/verification: still update.
    const third = await capture(draft([a, c, { ...b, verified: false }]));
    expect((await ordered(first.noteId)).map((b) => b.id)).toEqual(third.blockIds);
    expect((await ordered(first.noteId)).at(-1)?.verified).toBe(false);
    expect(third.blockIds).toEqual([first.blockIds[0], second.blockIds[0], first.blockIds[1]]);
  });

  it("merges overlapping element captures in DOM order, including repeats within a step", async () => {
    const { capture, services, context, scope } = await setup();
    const a = block("First", 1),
      b = block("Second", 2),
      c = block("Third", 3);
    const first = await capture(draft([c], "element"));
    const ctx = context();
    await persistCapture(services, ctx, draft([a, b], "element"));
    const again = await persistCapture(services, ctx, draft([b, c], "element"));
    await commitStep(h.db, scope.runId, ctx.step);
    const stored = await ordered(first.noteId);
    expect(stored.map((b) => b.markdown)).toEqual(["First", "Second", "Third"]);
    expect(again.blockIds).toEqual([stored[1]!.id, first.blockIds[0]]);
  });

  it("updates an element whose text length changes without keeping its stale version", async () => {
    const { capture } = await setup();
    const first = await capture(
      draft([block("Unchanged", 1), block("Earlier long sentence", 2)], "element"),
    );
    await capture(draft([block("New", 2)], "element"));
    expect((await ordered(first.noteId)).map((b) => b.markdown)).toEqual(["Unchanged", "New"]);
  });

  it("queues superseded snapshots for deletion without overwriting the earlier capture before commit", async () => {
    const { capture } = await setup();
    const input = draft([block("First", 1)]);
    input.snapshot = {
      mhtml: null,
      png: new Uint8Array([1, 2, 3]),
      mhtmlSha256: null,
      pngSha256: sha256Hex(new Uint8Array([1, 2, 3])),
      skipped: [],
    };
    const result = await capture(input);
    const [before] = await h.db
      .select()
      .from(sources)
      .where(sql`${sources.meta}->>'noteId' = ${result.noteId}`);
    await capture(input);
    const [after] = await h.db.select().from(sources).where(eq(sources.id, before!.id));
    expect(after?.screenshotKey).not.toBe(before!.screenshotKey);
    expect(
      await h.db
        .select()
        .from(objectDeletions)
        .where(eq(objectDeletions.key, before!.screenshotKey!)),
    ).toHaveLength(1);
  });

  it("replaces stale captured content while preserving the user's edited block", async () => {
    const { capture } = await setup();
    const first = await capture(draft([block("First", 1), block("Second", 2)]));
    await h.db
      .update(noteBlocks)
      .set({ edited: true, originalMarkdown: "First", markdown: "My writing" })
      .where(eq(noteBlocks.id, first.blockIds[0]!));
    await capture(draft([block("First", 1), block("Replacement", 2)]));
    const rows = await ordered(first.noteId);
    expect(rows.map((b) => b.markdown)).toEqual(["My writing", "Replacement"]);
    expect(rows[0]?.id).toBe(first.blockIds[0]);
  });
});

it("D57 empty selection writes only counts, no note, source or snapshot", async () => {
  const { runs, notes } = await import("@mastertutor/db");
  const { scope, services, context } = await setup();
  await h.db
    .update(runs)
    .set({ captureBrief: { keep: ["reading_text"], skip: ["due_dates"], scopeNote: "" } })
    .where(eq(runs.id, scope.runId));
  services.selection = { select: async () => [] };
  const ctx = context();
  const result = await persistCapture(services, ctx, {
    ...draft([block("Due: tomorrow", 1)]),
    lede: "Due: tomorrow",
  });
  expect(result).toMatchObject({ noteId: null, blockIds: [], kept: 0, skipped: 1 });
  await commitStep(h.db, scope.runId, ctx.step);
  expect(await h.db.select().from(notes).where(eq(notes.workspaceId, scope.workspaceId))).toEqual(
    [],
  );
  expect(
    await h.db.select().from(sources).where(eq(sources.workspaceId, scope.workspaceId)),
  ).toEqual([]);
});
