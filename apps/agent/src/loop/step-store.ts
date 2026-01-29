import {
  TERMINAL_RUN_STATUSES,
  type Budget,
  type Plan,
  type RunError,
  type RunEvent,
  type RunStatus,
  type ScrollPosition,
  type StepAction,
  type StepPhase,
  type StepState,
  type Usage,
  type WaitReason,
} from "@mastertutor/contracts";
import { runSteps, runTranscript, runs, type Database } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { and, eq, gt, inArray, max, sql } from "drizzle-orm";
import type { BrowserStorageState } from "../browser/storage-state.ts";
import { emitRunEvents } from "../events/emit.ts";
import { LeaseLost, RunChanged } from "../runtime/errors.ts";
import type { Tx } from "../runtime/types.ts";
import { externalizeImages, type TranscriptEntry } from "./transcript.ts";

export interface RunPatch {
  previousResponseId?: string | null;
  plan?: Plan | null;
  usage?: Usage;
  budget?: Budget;
  model?: string;
  currentUrl?: string | null;
  scroll?: ScrollPosition | null;
  videoTime?: number | null;
  allowedOrigins?: string[];
  wakeRequested?: boolean;
  releaseLease?: boolean;
}

export interface Transition {
  from: readonly RunStatus[];
  to: RunStatus;
  waitReason: WaitReason | null;
  reason: string | null;
  error?: RunError | null;
}

export interface StepRecord {
  seq: number;
  phase: StepPhase;
  state: StepState;
  /** A StepAction (what the UI shows) plus `callId` for act rows. */
  action?: (StepAction & { callId?: string }) | null;
  result?: unknown;
  caption?: string | null;
  url?: string | null;
  screenshotKey?: string | null;
  usage?: Usage | null;
}

export interface StepCommit {
  steps?: readonly StepRecord[];
  transcript?: readonly TranscriptEntry[];
  run?: RunPatch;
  transition?: Transition;
  events?: readonly RunEvent[];
  storage?: BrowserStorageState | null;
  extra?: (tx: Tx) => Promise<void>;
}

/** Sealed storageState per alias + origin (spec §5.6). B3 implements it; B1 only calls it. */
export interface SessionStore {
  load(run: { id: string; workspaceId: string }): Promise<BrowserStorageState | null>;
  save(tx: Tx, run: { id: string; workspaceId: string }, state: BrowserStorageState): Promise<void>;
}

export const NO_SESSION_STORE: SessionStore = {
  load: async () => null,
  save: async () => undefined,
};

interface StepStoreOptions {
  db: Database;
  storage: Storage;
  sessionStore: SessionStore;
  owner: string;
  run: { id: string; workspaceId: string };
}

/** Spec §5.3: every step commits in one transaction, guarded by the run lease. */
export class StepStore {
  readonly #options: StepStoreOptions;
  #seq: number;
  #transcriptSeq: number;

  private constructor(options: StepStoreOptions, seq: number, transcriptSeq: number) {
    this.#options = options;
    this.#seq = seq;
    this.#transcriptSeq = transcriptSeq;
  }

  static async open(options: StepStoreOptions): Promise<StepStore> {
    const [steps] = await options.db
      .select({ value: max(runSteps.seq) })
      .from(runSteps)
      .where(eq(runSteps.runId, options.run.id));
    const [transcript] = await options.db
      .select({ value: max(runTranscript.seq) })
      .from(runTranscript)
      .where(eq(runTranscript.runId, options.run.id));
    return new StepStore(options, (steps?.value ?? -1) + 1, (transcript?.value ?? -1) + 1);
  }

  nextSeq(): number {
    return this.#seq++;
  }

  async commit(commit: StepCommit): Promise<void> {
    const { db, storage, sessionStore, owner, run } = this.#options;
    const entries = await Promise.all(
      (commit.transcript ?? []).map((entry, index) =>
        externalizeImages(storage, run.id, this.#transcriptSeq + index, entry),
      ),
    );
    await db.transaction(async (tx) => {
      const patch = commit.run ?? {};
      const transition = commit.transition;
      const terminal = transition
        ? (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(transition.to)
        : false;
      const updated = await tx
        .update(runs)
        .set({
          lastActivityAt: sql`now()`,
          ...(patch.previousResponseId !== undefined
            ? { previousResponseId: patch.previousResponseId }
            : {}),
          ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
          ...(patch.usage ? { usage: patch.usage } : {}),
          ...(patch.budget ? { budget: patch.budget } : {}),
          ...(patch.model ? { model: patch.model } : {}),
          ...(patch.currentUrl !== undefined ? { currentUrl: patch.currentUrl } : {}),
          ...(patch.scroll !== undefined ? { scroll: patch.scroll } : {}),
          ...(patch.videoTime !== undefined ? { videoTime: patch.videoTime } : {}),
          ...(patch.allowedOrigins ? { allowedOrigins: patch.allowedOrigins } : {}),
          ...(patch.wakeRequested ? { wakeRequestedAt: sql`now()` } : {}),
          ...(patch.releaseLease ? { leaseOwner: null, leaseExpiresAt: null } : {}),
          ...(transition
            ? {
                status: transition.to,
                waitReason: transition.waitReason,
                ...(transition.error !== undefined ? { error: transition.error } : {}),
                ...(terminal ? { finishedAt: sql`now()` } : {}),
              }
            : {}),
        })
        .where(
          and(
            eq(runs.id, run.id),
            eq(runs.leaseOwner, owner),
            gt(runs.leaseExpiresAt, sql`now()`),
            transition ? inArray(runs.status, [...transition.from]) : undefined,
          ),
        )
        .returning({ id: runs.id });
      if (updated.length === 0) {
        const [current] = await tx
          .select({ owner: runs.leaseOwner, live: sql<boolean>`${runs.leaseExpiresAt} > now()` })
          .from(runs)
          .where(eq(runs.id, run.id));
        throw current?.owner === owner && current.live
          ? new RunChanged(run.id)
          : new LeaseLost(run.id);
      }
      const events: RunEvent[] = [];
      for (const step of commit.steps ?? []) {
        await tx
          .insert(runSteps)
          .values({
            runId: run.id,
            seq: step.seq,
            phase: step.phase,
            state: step.state,
            action: step.action ?? null,
            result: step.result ?? null,
            caption: step.caption ?? null,
            url: step.url ?? null,
            screenshotKey: step.screenshotKey ?? null,
            usage: step.usage ?? null,
          })
          .onConflictDoUpdate({
            target: [runSteps.runId, runSteps.seq],
            set: { state: step.state, result: step.result ?? null, updatedAt: sql`now()` },
          });
        const action = step.action
          ? { tool: step.action.tool, summary: step.action.summary, point: step.action.point }
          : null;
        events.push({
          type: "step",
          seq: step.seq,
          phase: step.phase,
          state: step.state,
          caption: step.caption ?? null,
          url: step.url?.slice(0, 4_096) ?? null,
          screenshotKey: step.screenshotKey ?? null,
          action,
        });
      }
      if (entries.length > 0) {
        await tx.insert(runTranscript).values(
          entries.map((item, index) => ({
            runId: run.id,
            seq: this.#transcriptSeq + index,
            item,
          })),
        );
      }
      if (commit.storage) await sessionStore.save(tx, run, commit.storage);
      if (transition)
        events.push({
          type: "status",
          status: transition.to,
          waitReason: transition.waitReason,
          reason: transition.reason?.slice(0, 500) ?? null,
        });
      events.push(...(commit.events ?? []));
      await commit.extra?.(tx);
      await emitRunEvents(tx, run.id, events);
    });
    this.#transcriptSeq += entries.length;
  }
}
