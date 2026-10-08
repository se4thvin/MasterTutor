import { randomUUID } from "node:crypto";
import {
  Anchor,
  MAX_BLOCK_CHARS,
  toOrigin,
  unescapeMarkdown,
  type BlockOrigin,
  type BlockType,
  type SourceKind,
} from "@mastertutor/contracts";
import { type DbLike, noteBlocks, notes, refreshNoteQuality, runs, sources } from "@mastertutor/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { containsSecret, type MaskSources } from "../browser/masking.ts";
import type { StepWriter, ToolContext } from "../tools/types.ts";
import type { Embedder } from "./embedder.ts";
import { sha256Hex } from "./hash.ts";
import { keysBetween, positionOrder } from "./positions.ts";

export interface RunScope {
  runId: string;
  workspaceId: string;
}

/** What one write needs from its step: the run, the step writer, the vault screen and the signal. */
export interface WriteContext {
  scope: RunScope;
  step: StepWriter;
  /** B3 seam: the run's vault mask sources; `containsSecret(secrets, text)` screens what is stored (spec §9; D8). */
  secrets: MaskSources;
  signal?: AbortSignal;
}

export function writeContext(ctx: ToolContext): WriteContext {
  return {
    scope: { runId: ctx.runId, workspaceId: ctx.workspaceId },
    step: ctx.step,
    secrets: ctx.mask,
    signal: ctx.signal,
  };
}

export interface BlockDraft {
  type: BlockType;
  markdown: string;
  origin: BlockOrigin;
  assetId: string | null;
  anchor: Anchor | null;
  verified: boolean;
}
export interface NoteDraft {
  title: string;
  lede: string | null;
}
export interface SourceDraft {
  noteId: string;
  kind: SourceKind;
  url: string;
  canonicalUrl: string | null;
  title: string | null;
  faviconAssetId: string | null;
  mhtmlKey: string | null;
  screenshotKey: string | null;
  snapshotSha256: string | null;
  meta: Record<string, unknown>;
}
export interface ExistingSource {
  sourceId: string;
  meta: Record<string, unknown>;
  blockIds: string[];
}
export interface AppendOptions {
  noteId: string;
  sourceId: string | null;
  blocks: readonly BlockDraft[];
  /** null appends at the end; a block id inserts right after that block. */
  afterBlockId: string | null;
}

export type NoteWriteErrorCode =
  | "unknown_block"
  | "foreign_note"
  | "block_too_large"
  | "unsupported_url"
  | "run_missing"
  | "secret_on_page";
export class NoteWriteError extends Error {
  readonly code: NoteWriteErrorCode;
  constructor(code: NoteWriteErrorCode, message: string) {
    super(message);
    this.name = "NoteWriteError";
    this.code = code;
  }
}

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
const byteOrder = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/** Spec §9: no stored text may hold a registered secret, as shown or as the reader sees it. */
export function screenText(secrets: MaskSources, text: string): void {
  if (containsSecret(secrets, text) || containsSecret(secrets, unescapeMarkdown(text)))
    throw new NoteWriteError("secret_on_page", "The page shows a saved secret; nothing was stored");
}

/** screenText over every string of a JSON-like value, keys included. */
export function screenValue(secrets: MaskSources, value: unknown): void {
  if (typeof value === "string") screenText(secrets, value);
  else if (Array.isArray(value)) for (const item of value) screenValue(secrets, item);
  else if (value !== null && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      screenText(secrets, key);
      screenValue(secrets, item);
    }
}

/** A block's place in its note, committed or staged in this step. */
export interface PlacedBlock {
  id: string;
  position: string;
  sourceId: string | null;
  anchor: Anchor | null;
  type: BlockType;
}

/** spec §3.3 `notes`: the only module that writes notes, sources and blocks. */
export class NoteWriter {
  protected readonly db: DbLike;
  protected readonly embedder: Embedder;
  /** Blocks staged in a step but not committed yet, per note: later appends in that step see them (W10). */
  readonly #pending = new WeakMap<StepWriter, Map<string, PlacedBlock[]>>();

  constructor(deps: { db: DbLike; embedder: Embedder }) {
    this.db = deps.db;
    this.embedder = deps.embedder;
  }

  /** The note is this run's: committed in its workspace, or staged by this very step. */
  async #assertWritable(w: WriteContext, noteId: string): Promise<void> {
    if (this.#pending.get(w.step)?.has(noteId)) return;
    await this.assertRunNote(w.scope, noteId);
  }

  /** The run's note; stages a new one (and runs.note_id) when the run has none yet. */
  async ensureNote(w: WriteContext, draft: NoteDraft): Promise<string> {
    const title = clip(draft.title.trim(), 500) || "Untitled";
    const lede = draft.lede?.trim() ? clip(draft.lede.trim(), 1_000) : null;
    const [run] = await this.db
      .select({ noteId: runs.noteId, targetFolderId: runs.targetFolderId })
      .from(runs)
      .where(and(eq(runs.id, w.scope.runId), eq(runs.workspaceId, w.scope.workspaceId)));
    if (!run) throw new NoteWriteError("run_missing", "run not found");
    if (run.noteId) return run.noteId;
    const pending = this.#pending.get(w.step)?.keys().next().value;
    if (pending) return pending;
    // Screened only when it is going to be stored (an existing note keeps its own title).
    screenText(w.secrets, title);
    if (lede) screenText(w.secrets, lede);
    const noteId = randomUUID();
    w.step.defer(async (tx) => {
      await tx.insert(notes).values({
        id: noteId,
        workspaceId: w.scope.workspaceId,
        runId: w.scope.runId,
        title,
        lede,
        folderId: run.targetFolderId,
        filedBy: "agent",
      });
      await tx.update(runs).set({ noteId }).where(eq(runs.id, w.scope.runId));
    });
    this.#staged(w.step, noteId);
    return noteId;
  }

  /** Throws `foreign_note` unless the note belongs to this run and workspace. */
  async assertRunNote(scope: RunScope, noteId: string): Promise<void> {
    const rows = await this.db
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.id, noteId),
          eq(notes.runId, scope.runId),
          eq(notes.workspaceId, scope.workspaceId),
        ),
      );
    if (rows.length === 0)
      throw new NoteWriteError("foreign_note", "note does not belong to this run");
  }

  async findSource(
    scope: RunScope,
    noteId: string,
    kind: SourceKind,
    url: string,
  ): Promise<ExistingSource | null> {
    const [source] = await this.db
      .select({ id: sources.id, meta: sources.meta })
      .from(sources)
      .where(
        and(
          eq(sources.workspaceId, scope.workspaceId),
          eq(sources.kind, kind),
          eq(sources.url, url),
          sql`${sources.meta}->>'noteId' = ${noteId}`,
        ),
      )
      .orderBy(sql`${sources.createdAt} desc`)
      .limit(1);
    if (!source) return null;
    const blocks = await this.db
      .select({ id: noteBlocks.id })
      .from(noteBlocks)
      .where(and(eq(noteBlocks.noteId, noteId), eq(noteBlocks.sourceId, source.id)))
      .orderBy(positionOrder);
    return { sourceId: source.id, meta: source.meta, blockIds: blocks.map((b) => b.id) };
  }

  stageSource(w: WriteContext, draft: SourceDraft, id: string = randomUUID()): string {
    const origin = toOrigin(draft.url);
    if (!origin || !/^https?:/.test(draft.url))
      throw new NoteWriteError("unsupported_url", "only http(s) sources");
    // A URL can echo a secret (a GET login form); B3's redactor also reads percent-encoded tokens.
    screenValue(w.secrets, [draft.url, draft.canonicalUrl, draft.title, draft.meta]);
    w.step.defer(async (tx) => {
      await tx.insert(sources).values({
        id,
        workspaceId: w.scope.workspaceId,
        kind: draft.kind,
        url: clip(draft.url, 4_096),
        canonicalUrl: draft.canonicalUrl ? clip(draft.canonicalUrl, 4_096) : null,
        origin,
        title: draft.title ? clip(draft.title, 1_000) : null,
        faviconAssetId: draft.faviconAssetId,
        mhtmlKey: draft.mhtmlKey,
        screenshotKey: draft.screenshotKey,
        snapshotSha256: draft.snapshotSha256,
        meta: { ...draft.meta, noteId: draft.noteId },
      });
    });
    return id;
  }

  stageSourceMeta(w: WriteContext, sourceId: string, patch: Record<string, unknown>): void {
    screenValue(w.secrets, patch);
    w.step.defer(async (tx) => {
      await tx
        .update(sources)
        .set({ meta: sql`${sources.meta} || ${JSON.stringify(patch)}::jsonb` })
        .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, w.scope.workspaceId)));
    });
  }

  /**
   * Committed blocks plus the ones this step staged, in position (byte) order. Ids come from
   * model arguments, so the note must be this run's (`foreign_note` otherwise).
   */
  protected async placed(w: WriteContext, noteId: string): Promise<PlacedBlock[]> {
    await this.#assertWritable(w, noteId);
    const rows = await this.db
      .select({
        id: noteBlocks.id,
        position: noteBlocks.position,
        sourceId: noteBlocks.sourceId,
        anchor: noteBlocks.anchor,
        type: noteBlocks.type,
      })
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, noteId))
      .orderBy(positionOrder);
    return [...rows, ...(this.#pending.get(w.step)?.get(noteId) ?? [])].sort(byteOrder);
  }

  async appendBlocks(w: WriteContext, options: AppendOptions): Promise<string[]> {
    const ordered = await this.placed(w, options.noteId);
    let before: string | null = ordered.at(-1)?.position ?? null;
    let after: string | null = null;
    if (options.afterBlockId !== null) {
      const index = ordered.findIndex((row) => row.id === options.afterBlockId);
      if (index < 0) throw new NoteWriteError("unknown_block", "afterBlockId is not in this note");
      before = ordered[index]?.position ?? null;
      after = ordered[index + 1]?.position ?? null;
    }
    const keys = keysBetween(before, after, options.blocks.length);
    return this.stageBlockRows(
      w,
      options.noteId,
      options.sourceId,
      options.blocks.map((draft, i) => ({ draft, position: keys[i] ?? "" })),
    );
  }

  /** Screens, embeds, then stages the inserts and one block_added event per block. */
  protected async stageBlockRows(
    w: WriteContext,
    noteId: string,
    sourceId: string | null,
    items: readonly { draft: BlockDraft; position: string }[],
  ): Promise<string[]> {
    for (const { draft } of items) {
      if (draft.markdown.length > MAX_BLOCK_CHARS)
        throw new NoteWriteError("block_too_large", "block too large");
      screenText(w.secrets, draft.markdown);
      if (draft.anchor) screenValue(w.secrets, draft.anchor);
    }
    const vectors = await this.embedder.embed(
      items.map((item) => item.draft.markdown),
      { signal: w.signal, step: w.step },
    );
    const rows = items.map(({ draft, position }, k) => ({
      id: randomUUID(),
      noteId,
      position,
      type: draft.type,
      markdown: draft.markdown,
      assetId: draft.assetId,
      sourceId,
      origin: draft.origin,
      anchor: draft.anchor === null ? null : Anchor.parse(draft.anchor),
      contentSha256: sha256Hex(draft.markdown),
      verified: draft.verified,
      embedding: vectors[k] ?? null,
    }));
    if (rows.length > 0) {
      w.step.defer(async (tx) => {
        for (let i = 0; i < rows.length; i += 500)
          await tx.insert(noteBlocks).values(rows.slice(i, i + 500));
      });
    }
    for (const row of rows) {
      w.step.emit({
        type: "block_added",
        noteId,
        blockId: row.id,
        blockType: row.type,
        origin: row.origin,
      });
    }
    this.#staged(w.step, noteId).push(
      ...rows.map((row) => ({
        id: row.id,
        position: row.position,
        sourceId,
        anchor: row.anchor,
        type: row.type,
      })),
    );
    return rows.map((row) => row.id);
  }

  #staged(step: StepWriter, noteId: string): PlacedBlock[] {
    let notesOfStep = this.#pending.get(step);
    if (!notesOfStep) {
      notesOfStep = new Map();
      this.#pending.set(step, notesOfStep);
    }
    let list = notesOfStep.get(noteId);
    if (!list) {
      list = [];
      notesOfStep.set(noteId, list);
    }
    return list;
  }

  /**
   * Coverage = min over captures; fidelity from the shared rule (refreshNoteQuality). Runs after the
   * block inserts. The note row is locked first, as web's "Mark verified" does, so neither write
   * recomputes fidelity from the other's stale state.
   */
  stageQuality(w: WriteContext, noteId: string, coverage: number | null): void {
    w.step.defer(async (tx) => {
      const [note] = await tx
        .select({ coverage: notes.coverage })
        .from(notes)
        .where(and(eq(notes.id, noteId), eq(notes.workspaceId, w.scope.workspaceId)))
        .for("update");
      if (!note) return;
      const merged = coverage === null ? note.coverage : Math.min(note.coverage ?? 1, coverage);
      await refreshNoteQuality(tx, w.scope.workspaceId, noteId, merged);
    });
  }

  /** Embeds this workspace's blocks stored without vectors (API outage at capture time). Idempotent. */
  async backfillEmbeddings(
    scope: RunScope,
    noteId: string,
    options: { signal?: AbortSignal; step: StepWriter },
  ): Promise<number> {
    const rows = await this.db
      .select({ id: noteBlocks.id, markdown: noteBlocks.markdown })
      .from(noteBlocks)
      .innerJoin(notes, eq(notes.id, noteBlocks.noteId))
      .where(
        and(
          eq(noteBlocks.noteId, noteId),
          eq(notes.workspaceId, scope.workspaceId),
          isNull(noteBlocks.embedding),
        ),
      );
    if (rows.length === 0) return 0;
    const vectors = await this.embedder.embed(
      rows.map((row) => row.markdown),
      options,
    );
    const updates = rows.flatMap((row, i) => {
      const vector = vectors[i];
      return vector ? [sql`(${row.id}::uuid, ${JSON.stringify(vector)}::vector)`] : [];
    });
    if (updates.length === 0) return 0;
    // One statement for the whole note, not one UPDATE per block.
    await this.db.execute(sql`
      update ${noteBlocks} set embedding = v.embedding
      from (values ${sql.join(updates, sql`, `)}) as v(id, embedding)
      where ${noteBlocks.id} = v.id and ${noteBlocks.embedding} is null`);
    return updates.length;
  }
}
