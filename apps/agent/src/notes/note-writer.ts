import { randomUUID } from "node:crypto";
import {
  Anchor,
  CAPTURED_ORIGINS,
  NoteBlock,
  noteFidelity,
  toOrigin,
  type BlockOrigin,
  type BlockType,
  type SourceKind,
} from "@mastertutor/contracts";
import { type DbLike, noteBlocks, notes, runs, sources } from "@mastertutor/db";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
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

/** One source of truth for the size limit: the NoteBlock contract (notes never imports capture). */
const MAX_BLOCK_CHARS = NoteBlock.shape.markdown.maxLength ?? 200_000;
const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
const unescaped = (markdown: string) => markdown.replace(/\\([\\`*_{}[\]()#+\-.!|$<>])/g, "$1");
const byteOrder = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

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

  #screen(w: WriteContext, text: string): void {
    if (containsSecret(w.secrets, text) || containsSecret(w.secrets, unescaped(text)))
      throw new NoteWriteError(
        "secret_on_page",
        "The page shows a saved secret; nothing was stored",
      );
  }

  /** The run's note; stages a new one (and runs.note_id) when the run has none yet. */
  async ensureNote(w: WriteContext, draft: NoteDraft): Promise<string> {
    const title = clip(draft.title.trim(), 500) || "Untitled";
    const lede = draft.lede?.trim() ? clip(draft.lede.trim(), 1_000) : null;
    this.#screen(w, title);
    if (lede) this.#screen(w, lede);
    const [run] = await this.db
      .select({ noteId: runs.noteId, targetFolderId: runs.targetFolderId })
      .from(runs)
      .where(and(eq(runs.id, w.scope.runId), eq(runs.workspaceId, w.scope.workspaceId)));
    if (!run) throw new NoteWriteError("run_missing", "run not found");
    if (run.noteId) return run.noteId;
    const pending = this.#pending.get(w.step)?.keys().next().value;
    if (pending) return pending;
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
    if (draft.title) this.#screen(w, draft.title);
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
    w.step.defer(async (tx) => {
      await tx
        .update(sources)
        .set({ meta: sql`${sources.meta} || ${JSON.stringify(patch)}::jsonb` })
        .where(eq(sources.id, sourceId));
    });
  }

  /** Committed blocks plus the ones this step staged, in position (byte) order. */
  protected async placed(w: WriteContext, noteId: string): Promise<PlacedBlock[]> {
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
      this.#screen(w, draft.markdown);
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

  /** Coverage = min over captures; fidelity from the shared rule. Runs after the block inserts. */
  stageQuality(w: WriteContext, noteId: string, coverage: number | null): void {
    w.step.defer(async (tx) => {
      const [note] = await tx
        .select({ coverage: notes.coverage })
        .from(notes)
        .where(eq(notes.id, noteId));
      const merged =
        coverage === null ? (note?.coverage ?? null) : Math.min(note?.coverage ?? 1, coverage);
      const [unverified] = await tx
        .select({ n: count() })
        .from(noteBlocks)
        .where(
          and(
            eq(noteBlocks.noteId, noteId),
            inArray(noteBlocks.origin, [...CAPTURED_ORIGINS]),
            eq(noteBlocks.verified, false),
          ),
        );
      const [lost] = await tx
        .select({ n: sql<number>`coalesce(sum((${sources.meta}->>'mediaLost')::int), 0)::int` })
        .from(sources)
        .where(sql`${sources.meta}->>'noteId' = ${noteId}`);
      await tx
        .update(notes)
        .set({
          coverage: merged,
          fidelity: noteFidelity({
            coverage: merged,
            unverifiedCaptured: unverified?.n ?? 0,
            missingMedia: lost?.n ?? 0,
          }),
          updatedAt: new Date(),
        })
        .where(eq(notes.id, noteId));
    });
  }

  /** Embeds blocks stored without vectors (API outage at capture time). Idempotent. */
  async backfillEmbeddings(
    noteId: string,
    options: { signal?: AbortSignal; step?: StepWriter } = {},
  ): Promise<number> {
    const rows = await this.db
      .select({ id: noteBlocks.id, markdown: noteBlocks.markdown })
      .from(noteBlocks)
      .where(and(eq(noteBlocks.noteId, noteId), isNull(noteBlocks.embedding)));
    if (rows.length === 0) return 0;
    const vectors = await this.embedder.embed(
      rows.map((row) => row.markdown),
      options,
    );
    let updated = 0;
    for (const [i, row] of rows.entries()) {
      const vector = vectors[i];
      if (!vector) continue;
      await this.db.update(noteBlocks).set({ embedding: vector }).where(eq(noteBlocks.id, row.id));
      updated++;
    }
    return updated;
  }
}
