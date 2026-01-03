import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  db = await startTestDatabase({ slots: ["browser-1"] });
  owner = postgres(db.ownerUrl, { max: 2, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await db?.stop();
});

async function workspace(): Promise<string> {
  const [row] = await owner`insert into workspaces (name) values ('W') returning id`;
  return row!.id as string;
}
async function folder(ws: string, name: string, parentId: string | null): Promise<string> {
  const [row] = await owner`insert into folders (workspace_id, name, parent_id)
                            values (${ws}, ${name}, ${parentId}) returning id`;
  return row!.id as string;
}
async function chain(ws: string, depth: number): Promise<string[]> {
  const ids: string[] = [];
  for (let level = 0; level < depth; level++) {
    ids.push(await folder(ws, `level-${level}`, ids.at(-1) ?? null));
  }
  return ids;
}

describe("folders", () => {
  it("rejects duplicate names at the root", async () => {
    const ws = await workspace();
    await folder(ws, "Biology", null);
    await expect(folder(ws, "Biology", null)).rejects.toThrow(/folders_workspace_parent_name_uq/);
  });
  it("allows 8 levels and rejects a 9th", async () => {
    const ws = await workspace();
    const ids = await chain(ws, 8);
    await expect(folder(ws, "too-deep", ids[7]!)).rejects.toThrow(/depth exceeds 8/);
  });
  it("rejects moving a folder into its own descendant", async () => {
    const ws = await workspace();
    const [a, b] = await chain(ws, 2);
    await expect(owner`update folders set parent_id = ${b!} where id = ${a!}`).rejects.toThrow(
      /cycle/,
    );
  });
  it("rejects a move that would push a subtree past depth 8", async () => {
    const ws = await workspace();
    const deep = await chain(ws, 6);
    const x = await folder(ws, "x", null);
    const y = await folder(ws, "y", x);
    await folder(ws, "z", y);
    await expect(owner`update folders set parent_id = ${deep[5]!} where id = ${x}`).rejects.toThrow(
      /depth exceeds 8/,
    );
  });
  it("rejects a parent from another workspace", async () => {
    const parent = await folder(await workspace(), "p", null);
    await expect(folder(await workspace(), "child", parent)).rejects.toThrow(/another workspace/);
  });
  it("rejects '/' in names", async () => {
    await expect(folder(await workspace(), "a/b", null)).rejects.toThrow(/folders_name_valid/);
  });
});

describe("notes and blocks", () => {
  it("indexes title and lede for full-text search", async () => {
    const ws = await workspace();
    await owner`insert into notes (workspace_id, title, lede)
                values (${ws}, 'Photosynthesis in plants', 'Light reactions')`;
    const hits = await owner`select title from notes
                             where search @@ plainto_tsquery('english', 'photosynthesis')`;
    expect(hits.map((h) => h.title)).toContain("Photosynthesis in plants");
  });
  it("stores 1536-dim embeddings and answers cosine queries", async () => {
    const ws = await workspace();
    const [note] =
      await owner`insert into notes (workspace_id, title) values (${ws}, 'v') returning id`;
    const embedding = JSON.stringify(Array.from({ length: 1536 }, (_, i) => (i % 7) / 7));
    await owner`insert into note_blocks (note_id, position, type, markdown, origin, embedding)
                values (${note!.id}, 'a0', 'paragraph', 'text', 'dom', ${embedding}::vector)`;
    const [nearest] = await owner`select markdown from note_blocks
                                  order by embedding <=> ${embedding}::vector limit 1`;
    expect(nearest?.markdown).toBe("text");
  });
});

describe("runs constraints", () => {
  it("requires a wait reason exactly when waiting", async () => {
    const ws = await workspace();
    await expect(owner`insert into runs (workspace_id, goal, allowed_origins, status)
                       values (${ws}, 'g', ${["https://a.com"]}, 'waiting')`).rejects.toThrow(
      /runs_wait_reason_matches_status/,
    );
  });
  it("allows at most one run per slot", async () => {
    const ws = await workspace();
    await owner`insert into runs (workspace_id, goal, allowed_origins, slot_name)
                values (${ws}, 'g', ${["https://a.com"]}, 'browser-1')`;
    await expect(owner`insert into runs (workspace_id, goal, allowed_origins, slot_name)
                       values (${ws}, 'g2', ${["https://a.com"]}, 'browser-1')`).rejects.toThrow(
      /runs_slot_name_uq/,
    );
  });
});
