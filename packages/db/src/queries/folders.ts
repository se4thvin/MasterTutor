import { FolderName, MAX_FOLDER_DEPTH, type FiledBy } from "@mastertutor/contracts";
import { and, asc, eq } from "drizzle-orm";
import type { DbLike } from "../client.ts";
import { folders, notes } from "../schema/index.ts";

/** One folder as the tree queries return it (the full table row is zod.ts's FolderRow). */
export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
  sort: number;
}

export type FolderErrorCode = "not_found" | "conflict" | "invalid";

export class FolderError extends Error {
  readonly code: FolderErrorCode;
  constructor(code: FolderErrorCode, message: string) {
    super(message);
    this.name = "FolderError";
    this.code = code;
  }
}

const columns = {
  id: folders.id,
  parentId: folders.parentId,
  name: folders.name,
  sort: folders.sort,
};

function pgCode(error: unknown): string | undefined {
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof cause === "string" ? cause : undefined;
}

function toFolderError(error: unknown): unknown {
  switch (pgCode(error)) {
    case "23505":
      return new FolderError("conflict", "A folder with that name already exists here");
    case "23503":
    case "23514":
      return new FolderError("invalid", "That folder change breaks the tree rules");
    default:
      return error;
  }
}

function parseName(name: string): string {
  const parsed = FolderName.safeParse(name);
  if (!parsed.success) throw new FolderError("invalid", "Folder names are 1-120 chars without '/'");
  return parsed.data;
}

export async function listFolders(db: DbLike, workspaceId: string): Promise<FolderNode[]> {
  return db
    .select(columns)
    .from(folders)
    .where(eq(folders.workspaceId, workspaceId))
    .orderBy(asc(folders.sort), asc(folders.name));
}

/** Folder id → names from the root. */
export function folderPaths(rows: readonly FolderNode[]): Map<string, string[]> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const memo = new Map<string, string[]>();
  const pathOf = (id: string, guard: number): string[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    const row = byId.get(id);
    if (!row || guard > MAX_FOLDER_DEPTH) return [];
    const path = row.parentId ? [...pathOf(row.parentId, guard + 1), row.name] : [row.name];
    memo.set(id, path);
    return path;
  };
  for (const row of rows) pathOf(row.id, 0);
  return memo;
}

const fold = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en");

/** Walks `path` from the root; returns the deepest existing folder (exact name first, then case-insensitive). */
export function resolveFolderPath(
  rows: readonly FolderNode[],
  path: readonly string[],
): { folderId: string | null; matched: number } {
  let parentId: string | null = null;
  let matched = 0;
  for (const name of path) {
    const siblings = rows.filter((row) => row.parentId === parentId);
    const hit =
      siblings.find((row) => row.name === name) ??
      siblings.find((row) => fold(row.name) === fold(name));
    if (!hit) break;
    parentId = hit.id;
    matched++;
  }
  return { folderId: parentId, matched };
}

export async function createFolder(
  db: DbLike,
  workspaceId: string,
  input: { name: string; parentId: string | null; id?: string },
): Promise<FolderNode> {
  const name = parseName(input.name);
  try {
    const [row] = await db
      .insert(folders)
      .values({
        ...(input.id ? { id: input.id } : {}),
        workspaceId,
        name,
        parentId: input.parentId,
      })
      .returning(columns);
    return row!;
  } catch (error) {
    throw toFolderError(error);
  }
}

async function updateFolder(
  db: DbLike,
  workspaceId: string,
  folderId: string,
  set: Partial<{ name: string; parentId: string | null }>,
): Promise<FolderNode> {
  try {
    const [row] = await db
      .update(folders)
      .set(set)
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
      .returning(columns);
    if (!row) throw new FolderError("not_found", "Folder not found");
    return row;
  } catch (error) {
    throw toFolderError(error);
  }
}

export function renameFolder(
  db: DbLike,
  workspaceId: string,
  folderId: string,
  name: string,
): Promise<FolderNode> {
  return updateFolder(db, workspaceId, folderId, { name: parseName(name) });
}

export function moveFolder(
  db: DbLike,
  workspaceId: string,
  folderId: string,
  parentId: string | null,
): Promise<FolderNode> {
  if (parentId === folderId) throw new FolderError("invalid", "A folder cannot contain itself");
  return updateFolder(db, workspaceId, folderId, { parentId });
}

/** Deletes the folder and its subtree (FK cascade); notes inside become unfiled (FK set null). */
export async function deleteFolder(
  db: DbLike,
  workspaceId: string,
  folderId: string,
): Promise<void> {
  const deleted = await db
    .delete(folders)
    .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
    .returning({ id: folders.id });
  if (deleted.length === 0) throw new FolderError("not_found", "Folder not found");
}

export async function moveNote(
  db: DbLike,
  workspaceId: string,
  noteId: string,
  folderId: string | null,
  filedBy: FiledBy,
): Promise<void> {
  if (folderId !== null) {
    const owned = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
    if (owned.length === 0) throw new FolderError("not_found", "Folder not found");
  }
  const moved = await db
    .update(notes)
    .set({ folderId, filedBy, updatedAt: new Date() })
    .where(and(eq(notes.id, noteId), eq(notes.workspaceId, workspaceId)))
    .returning({ id: notes.id });
  if (moved.length === 0) throw new FolderError("not_found", "Note not found");
}
