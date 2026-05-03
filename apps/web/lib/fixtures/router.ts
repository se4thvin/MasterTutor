import {
  EMPTY_USAGE,
  MODELS,
  TYPED_SECRET_FIELDS,
  apiContract,
  type NoteBlock,
  type RunDetail,
  type RunSummary,
  type VaultAuditView,
} from "@mastertutor/contracts";
import { ORPCError, implement } from "@orpc/server";
import { buildNoteMarkdown } from "../export/note-markdown.ts";
import { canCreateFolder, canMoveFolder, descendantIds, folderPath } from "../folders/tree.ts";
import { requireViewer } from "../server/rpc/require-viewer.ts";
import { FIXTURE_ASSETS } from "./assets.ts";
import { ids } from "./ids.ts";
import { RECORDED_RUN_ID, recordedDetail, recordedSteps } from "./run-recording.ts";
import { stateFor, usageReport } from "./store.ts";
import type { FixtureContext, FixtureState, NoteRecord } from "./types.ts";

// Fixture mode enforces the session like live mode, so UI tests can expire it mid-session.
const os = implement(apiContract).$context<FixtureContext>().use(requireViewer);

const now = () => new Date().toISOString();
const notFound = (what: string) => new ORPCError("NOT_FOUND", { message: `${what} not found` });
const notImplemented = (): never => {
  throw new ORPCError("NOT_IMPLEMENTED", { message: "Not available in fixture mode yet." });
};

function paginate<T>(items: readonly T[], input: { limit: number; cursor: string | null }) {
  const start = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
  const end = start + input.limit;
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
}

function findBlock(state: FixtureState, blockId: string): { record: NoteRecord; block: NoteBlock } {
  for (const record of state.notes) {
    const block = record.blocks.find((b) => b.id === blockId);
    if (block) return { record, block };
  }
  throw notFound("Block");
}

function findNote(state: FixtureState, noteId: string): NoteRecord {
  const record = state.notes.find((r) => r.note.id === noteId);
  if (!record) throw notFound("Note");
  return record;
}

function assertFolder(state: FixtureState, folderId: string | null): void {
  if (folderId !== null && !state.folders.some((f) => f.id === folderId)) throw notFound("Folder");
}

function assertUniqueName(
  state: FixtureState,
  parentId: string | null,
  name: string,
  exceptId?: string,
): void {
  const clash = state.folders.some(
    (f) =>
      f.parentId === parentId && f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash)
    throw new ORPCError("CONFLICT", { message: "A folder with that name already exists here." });
}

function snippetAround(markdown: string, q: string): string {
  const plain = markdown
    .replace(/[#*`>|$\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const index = plain.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return plain.slice(0, 140);
  const start = Math.max(0, index - 60);
  const end = Math.min(plain.length, index + q.length + 80);
  return `${start > 0 ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}

function appendAudit(
  state: FixtureState,
  entry: Omit<VaultAuditView, "id" | "at" | "runId" | "approvedBy">,
): void {
  state.audit.unshift({
    ...entry,
    id: crypto.randomUUID(),
    at: now(),
    runId: null,
    approvedBy: null,
  });
}

export const fixtureRouter = os.router({
  runs: {
    create: os.runs.create.handler(({ input, context }): RunSummary => {
      const state = stateFor(context.ns);
      const run: RunSummary = {
        id: ids.run(100 + state.runs.length),
        goal: input.goal,
        status: "queued",
        waitReason: null,
        controller: "agent",
        approvalMode: input.approvalMode,
        model: MODELS.agentPrimary,
        noteId: null,
        usage: EMPTY_USAGE,
        budget: input.budget ?? state.settings.defaultBudget,
        createdAt: now(),
        finishedAt: null,
      };
      state.runs.unshift(run);
      state.runScope[run.id] = {
        allowedOrigins: input.allowedOrigins,
        targetFolderId: input.targetFolderId,
      };
      return run;
    }),
    list: os.runs.list.handler(({ input, context }) => {
      const runs = stateFor(context.ns).runs.filter(
        (r) => input.status === null || r.status === input.status,
      );
      return paginate(runs, input);
    }),
    get: os.runs.get.handler(({ input, context }): RunDetail => {
      if (input.runId === RECORDED_RUN_ID) return recordedDetail();
      const state = stateFor(context.ns);
      const run = state.runs.find((r) => r.id === input.runId);
      if (!run) throw notFound("Run");
      const scope = state.runScope[run.id];
      return {
        ...run,
        plan: null,
        allowedOrigins: scope?.allowedOrigins ?? [],
        currentUrl: null,
        slotName: null,
        targetFolderId: scope?.targetFolderId ?? null,
        pendingApprovals: [],
        lastEventId: null,
      };
    }),
    steps: os.runs.steps.handler(({ input }) => ({
      items: input.runId === RECORDED_RUN_ID && input.afterSeq === null ? recordedSteps() : [],
    })),
    cancel: os.runs.cancel.handler(notImplemented),
    resume: os.runs.resume.handler(notImplemented),
    sendMessage: os.runs.sendMessage.handler(notImplemented),
    decideApproval: os.runs.decideApproval.handler(notImplemented),
    submitOtp: os.runs.submitOtp.handler(notImplemented),
    takeControl: os.runs.takeControl.handler(notImplemented),
    handBack: os.runs.handBack.handler(notImplemented),
    openLive: os.runs.openLive.handler(notImplemented),
  },
  notes: {
    list: os.notes.list.handler(({ input, context }) => {
      const notes = stateFor(context.ns)
        .notes.map((r) => r.note)
        .filter((n) =>
          input.folder === "all"
            ? true
            : input.folder === "unfiled"
              ? n.folderId === null
              : n.folderId === input.folder,
        )
        .filter((n) => input.kind === null || n.sourceKinds.includes(input.kind))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title));
      return paginate(notes, input);
    }),
    get: os.notes.get.handler(({ input, context }) => {
      const record = findNote(stateFor(context.ns), input.noteId);
      return {
        note: record.note,
        // Byte order, as Postgres "C" collation orders fractional-index keys.
        blocks: [...record.blocks].sort((a, b) =>
          a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
        ),
        sources: record.sources,
      };
    }),
    updateBlock: os.notes.updateBlock.handler(({ input, context }) => {
      const { record, block } = findBlock(stateFor(context.ns), input.blockId);
      if (!block.edited) block.originalMarkdown = block.markdown;
      block.markdown = input.markdown;
      block.edited = true;
      record.note.updatedAt = now();
      return { ...block };
    }),
    markVerified: os.notes.markVerified.handler(({ input, context }) => {
      const { record, block } = findBlock(stateFor(context.ns), input.blockId);
      block.verified = true;
      if (record.note.fidelity === "needs_review" && record.blocks.every((b) => b.verified)) {
        record.note.fidelity = (record.note.coverage ?? 1) >= 0.98 ? "verified" : "partial";
      }
      record.note.updatedAt = now();
      return { ...block };
    }),
    move: os.notes.move.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      assertFolder(state, input.folderId);
      const record = findNote(state, input.noteId);
      record.note.folderId = input.folderId;
      record.note.filedBy = "user";
      record.note.updatedAt = now();
      return { ok: true as const };
    }),
    delete: os.notes.delete.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      findNote(state, input.noteId);
      state.notes = state.notes.filter((r) => r.note.id !== input.noteId);
      return { ok: true as const };
    }),
    export: os.notes.export.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const record = findNote(state, input.noteId);
      const path = record.note.folderId ? folderPath(state.folders, record.note.folderId) : [];
      const markdown = buildNoteMarkdown(
        { note: record.note, blocks: record.blocks, sources: record.sources },
        path.map((f) => f.name),
      );
      return {
        downloadUrl: `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    }),
    search: os.notes.search.handler(({ input, context }) => {
      const q = input.q.toLowerCase();
      const hits: Array<{
        noteId: string;
        blockId: string | null;
        title: string;
        snippet: string;
        score: number;
      }> = [];
      for (const record of stateFor(context.ns).notes) {
        if (input.kind !== null && !record.note.sourceKinds.includes(input.kind)) continue;
        const titleMatch = record.note.title.toLowerCase().includes(q);
        const blockHits = record.blocks.filter((b) => b.markdown.toLowerCase().includes(q));
        for (const block of blockHits) {
          hits.push({
            noteId: record.note.id,
            blockId: block.id,
            title: record.note.title,
            snippet: snippetAround(block.markdown, input.q),
            score: titleMatch ? 2 : 1,
          });
        }
        if (titleMatch && blockHits.length === 0) {
          hits.push({
            noteId: record.note.id,
            blockId: null,
            title: record.note.title,
            snippet: record.note.lede ?? "",
            score: 2,
          });
        }
      }
      return { items: hits.sort((a, b) => b.score - a.score).slice(0, input.limit) };
    }),
  },
  folders: {
    tree: os.folders.tree.handler(({ context }) => ({
      folders: [...stateFor(context.ns).folders],
    })),
    create: os.folders.create.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      assertFolder(state, input.parentId);
      if (!canCreateFolder(state.folders, input.parentId)) {
        throw new ORPCError("BAD_REQUEST", { message: "Folders can nest at most 8 levels." });
      }
      assertUniqueName(state, input.parentId, input.name);
      const siblings = state.folders.filter((f) => f.parentId === input.parentId);
      const folder = {
        id: crypto.randomUUID(),
        parentId: input.parentId,
        name: input.name,
        sort: siblings.length,
      };
      state.folders.push(folder);
      return folder;
    }),
    rename: os.folders.rename.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const folder = state.folders.find((f) => f.id === input.folderId);
      if (!folder) throw notFound("Folder");
      assertUniqueName(state, folder.parentId, input.name, folder.id);
      folder.name = input.name;
      return { ...folder };
    }),
    move: os.folders.move.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const folder = state.folders.find((f) => f.id === input.folderId);
      if (!folder) throw notFound("Folder");
      assertFolder(state, input.parentId);
      if (!canMoveFolder(state.folders, input.folderId, input.parentId)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "A folder can't move into itself or deeper than 8 levels.",
        });
      }
      assertUniqueName(state, input.parentId, folder.name, folder.id);
      folder.parentId = input.parentId;
      return { ...folder };
    }),
    delete: os.folders.delete.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      if (!state.folders.some((f) => f.id === input.folderId)) throw notFound("Folder");
      const removed = descendantIds(state.folders, input.folderId);
      state.folders = state.folders.filter((f) => !removed.has(f.id));
      for (const record of state.notes) {
        if (record.note.folderId !== null && removed.has(record.note.folderId))
          record.note.folderId = null;
      }
      return { ok: true as const };
    }),
  },
  vault: {
    list: os.vault.list.handler(({ context }) => ({ items: [...stateFor(context.ns).vault] })),
    create: os.vault.create.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      if (state.vault.some((i) => i.alias === input.alias)) {
        throw new ORPCError("CONFLICT", { message: "That alias is already used." });
      }
      // Values are discarded here; the fixture stores which fields exist, never what they are.
      const fields = TYPED_SECRET_FIELDS.filter((field) => input.secrets[field] !== undefined);
      const item = {
        id: crypto.randomUUID(),
        alias: input.alias,
        origin: input.origin,
        label: input.label,
        fields,
        hasImap: input.imap !== null,
        sessionSaved: false,
        createdAt: now(),
      };
      state.vault.push(item);
      appendAudit(state, {
        alias: item.alias,
        origin: item.origin,
        field: null,
        action: "create",
        outcome: "ok",
      });
      return item;
    }),
    setSecret: os.vault.setSecret.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const item = state.vault.find((i) => i.id === input.itemId);
      if (!item) throw notFound("Sign-in");
      if (!item.fields.includes(input.field)) item.fields = [...item.fields, input.field];
      appendAudit(state, {
        alias: item.alias,
        origin: item.origin,
        field: input.field,
        action: "update",
        outcome: "ok",
      });
      return { ok: true as const };
    }),
    removeSecret: os.vault.removeSecret.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const item = state.vault.find((i) => i.id === input.itemId);
      if (!item) throw notFound("Sign-in");
      item.fields = item.fields.filter((f) => f !== input.field);
      appendAudit(state, {
        alias: item.alias,
        origin: item.origin,
        field: input.field,
        action: "update",
        outcome: "removed",
      });
      return { ok: true as const };
    }),
    delete: os.vault.delete.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const item = state.vault.find((i) => i.id === input.itemId);
      if (!item) throw notFound("Sign-in");
      state.vault = state.vault.filter((i) => i.id !== input.itemId);
      appendAudit(state, {
        alias: item.alias,
        origin: item.origin,
        field: null,
        action: "delete",
        outcome: "ok",
      });
      return { ok: true as const };
    }),
    forgetSession: os.vault.forgetSession.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      const item = state.vault.find((i) => i.alias === input.alias && i.origin === input.origin);
      // Idempotent like the live endpoint (E6): forgetting nothing is ok.
      appendAudit(state, {
        alias: input.alias,
        origin: input.origin,
        field: "session",
        action: "delete",
        outcome: item?.sessionSaved ? "forgotten" : "none",
      });
      if (item) item.sessionSaved = false;
      return { ok: true as const };
    }),
    audit: os.vault.audit.handler(({ input, context }) =>
      paginate(
        [...stateFor(context.ns).audit].sort((a, b) => b.at.localeCompare(a.at)),
        input,
      ),
    ),
  },
  settings: {
    get: os.settings.get.handler(({ context }) => ({ ...stateFor(context.ns).settings })),
    update: os.settings.update.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      if (input.concurrency !== undefined && input.concurrency > 6) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Concurrency can't exceed the browser slots.",
        });
      }
      state.settings = {
        ...state.settings,
        ...(input.defaultBudget ? { defaultBudget: input.defaultBudget } : {}),
        ...(input.defaultAllowedOrigins
          ? { defaultAllowedOrigins: input.defaultAllowedOrigins }
          : {}),
        ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
      };
      return { ...state.settings };
    }),
    setKillSwitch: os.settings.setKillSwitch.handler(({ input, context }) => {
      const state = stateFor(context.ns);
      state.settings = { ...state.settings, killSwitch: input.on };
      return { ...state.settings };
    }),
    usage: os.settings.usage.handler(({ input, context }) =>
      usageReport(stateFor(context.ns).runs, input.from, input.to),
    ),
  },
  assets: {
    url: os.assets.url.handler(({ input }) => {
      const url = FIXTURE_ASSETS.get(input.assetId);
      if (!url) throw notFound("Asset");
      return { url, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
    }),
  },
  benchmarks: {
    list: os.benchmarks.list.handler(() => ({ items: [] })),
    create: os.benchmarks.create.handler(notImplemented),
    start: os.benchmarks.start.handler(notImplemented),
    runs: os.benchmarks.runs.handler(() => ({ items: [] })),
    grade: os.benchmarks.grade.handler(notImplemented),
  },
});
