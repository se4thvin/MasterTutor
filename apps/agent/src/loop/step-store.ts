import { randomUUID } from "node:crypto";
import {
  TERMINAL_RUN_STATUSES,
  type Budget,
  type GuardState,
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
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { emitRunEvents, runSteps, runTranscript, runs, type Database } from "@mastertutor/db";
import { objectKeys, type Storage } from "@mastertutor/storage";
import { instrument } from "@mastertutor/telemetry/instrument";
import {
  recordRunFailure,
  recordSpend,
  recordObserverFailure,
} from "@mastertutor/telemetry/record";
import { and, eq, gt, inArray, max, sql } from "drizzle-orm";
import type { BrowserStorageState, CollectedStorage } from "../browser/storage-state.ts";
import { LeaseLost, RunChanged } from "../runtime/errors.ts";
import type { Tx } from "../runtime/types.ts";
import { externalizeImages, inJsonbOrder, type TranscriptEntry } from "./transcript.ts";

export interface RunPatch {
  plan?: Plan | null;
  usage?: Usage;
  budget?: Budget;
  model?: string;
  currentUrl?: string | null;
  scroll?: ScrollPosition | null;
  videoTime?: number | null;
  allowedOrigins?: string[];
  wakeRequested?: boolean;
  /**
   * The wake request this step consumed (the `wake_requested_at` value read as text). It is cleared
   * only if no newer wake arrived meanwhile.
   */
  consumeWake?: string | null;
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
  /** A decide step's screened reasoning summary: streamed on its step event (also in `result`). */
  reasoning?: string | null;
  url?: string | null;
  screenshotKey?: string | null;
  /**
   * The screenshot bytes for `screenshotKey`, uploaded with this commit: a failed commit (lost lease)
   * deletes them again, and the nonce in the key means nothing live is ever overwritten.
   */
  screenshot?: Uint8Array;
  usage?: Usage | null;
}

export interface StepCommit {
  steps?: readonly StepRecord[];
  transcript?: readonly TranscriptEntry[];
  run?: RunPatch;
  transition?: Transition;
  events?: readonly RunEvent[];
  storage?: CollectedStorage | null;
  extra?: (tx: Tx) => Promise<void>;
  /** Objects a tool uploaded for this step: deleted when the commit fails (preflight F17). */
  ownedObjects?: readonly string[];
}

/** Sealed storageState per alias + origin (spec §5.6). B3 implements it; B1 only calls it. */
export interface SessionStore {
  load(run: {
    id: string;
    workspaceId: string;
    allowedOrigins: readonly string[];
  }): Promise<BrowserStorageState | null>;
  save(
    tx: Tx,
    run: { id: string; workspaceId: string },
    collected: CollectedStorage,
  ): Promise<void>;
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
  /** runs.usage.usd as last committed: committed spend is counted as its change (seam 5). */
  #usd: number;

  private constructor(options: StepStoreOptions, seq: number, transcriptSeq: number, usd: number) {
    this.#options = options;
    this.#seq = seq;
    this.#transcriptSeq = transcriptSeq;
    this.#usd = usd;
  }

  static async open(options: StepStoreOptions): Promise<StepStore> {
    const [[steps], [transcript], [current]] = await Promise.all([
      options.db
        .select({ value: max(runSteps.seq) })
        .from(runSteps)
        .where(eq(runSteps.runId, options.run.id)),
      options.db
        .select({ value: max(runTranscript.seq) })
        .from(runTranscript)
        .where(eq(runTranscript.runId, options.run.id)),
      options.db.select({ usage: runs.usage }).from(runs).where(eq(runs.id, options.run.id)),
    ]);
    return new StepStore(
      options,
      (steps?.value ?? -1) + 1,
      (transcript?.value ?? -1) + 1,
      current?.usage.usd ?? 0,
    );
  }

  /** The observer stages only metadata inside the transaction, then starts work after commit. */
  onCommitted(
    listener: (events: readonly RunEvent[]) => void,
    checkpoint?: (events: readonly RunEvent[]) => GuardState,
  ): void {
    this.#onCommitted = listener;
    this.#observerStage = checkpoint ?? null;
  }

  #observerStage: ((events: readonly RunEvent[]) => GuardState) | null = null;

  nextSeq(): number {
    return this.#seq++;
  }

  /** A fresh, unique key for a step screenshot (uploaded by the commit that carries the step). */
  screenshotKey(seq: number): string {
    return objectKeys.stepScreenshot(this.#options.run.id, seq, randomUUID().replaceAll("-", ""));
  }

  #onCommitted: ((events: readonly RunEvent[]) => void) | null = null;

  /** Seam 5 (spec §7.3): the step transaction's span; spend and failures counted only once committed. */
  commit(commit: StepCommit): Promise<TranscriptEntry[]> {
    return instrument(SPAN.stepCommit, { [ATTR.runId]: this.#options.run.id }, async () => {
      const { entries, events } = await this.#commitOnce(commit);
      if (events.length) {
        try {
          this.#onCommitted?.(events);
        } catch {
          recordObserverFailure("watcher", "error");
        }
      }
      const usd = commit.run?.usage?.usd;
      if (usd !== undefined) {
        recordSpend(usd - this.#usd, "run");
        this.#usd = usd;
      }
      if (commit.transition?.to === "failed")
        recordRunFailure(commit.transition.error?.code ?? "unknown_error");
      return entries;
    });
  }

  /** Commits in one transaction; returns the transcript entries as stored (images as refs). */
  async #commitOnce(
    commit: StepCommit,
  ): Promise<{ entries: TranscriptEntry[]; events: RunEvent[] }> {
    const { storage, run } = this.#options;
    const nonce = randomUUID().replaceAll("-", "");
    const uploaded: string[] = [];
    let entries: TranscriptEntry[];
    let events: RunEvent[];
    try {
      const shots = (commit.steps ?? []).flatMap((step) =>
        step.screenshot && step.screenshotKey
          ? [{ key: step.screenshotKey, body: step.screenshot }]
          : [],
      );
      uploaded.push(...shots.map((shot) => shot.key));
      const [stored] = await Promise.all([
        Promise.all(
          (commit.transcript ?? []).map((entry, index) =>
            externalizeImages(storage, run.id, this.#transcriptSeq + index, entry, nonce, uploaded),
          ),
        ),
        ...shots.map((shot) => storage.put(shot.key, shot.body, { contentType: "image/png" })),
      ]);
      entries = stored;
      events = await this.#write(commit, entries);
    } catch (error) {
      // Nothing was committed: do not leave this attempt's uploads behind (best effort).
      await Promise.allSettled(
        [...uploaded, ...(commit.ownedObjects ?? [])].map((key) => storage.delete(key)),
      );
      throw error;
    }
    this.#transcriptSeq += entries.length;
    return { entries: entries.map(inJsonbOrder), events };
  }

  async #write(commit: StepCommit, entries: readonly TranscriptEntry[]): Promise<RunEvent[]> {
    const { db, sessionStore, owner, run } = this.#options;
    return db.transaction(async (tx) => {
      const patch = commit.run ?? {};
      const transition = commit.transition;
      const terminal = transition
        ? (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(transition.to)
        : false;
      const updated = await tx
        .update(runs)
        .set({
          lastActivityAt: sql`now()`,
          ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
          ...(patch.usage ? { usage: patch.usage } : {}),
          ...(patch.budget ? { budget: patch.budget } : {}),
          ...(patch.model ? { model: patch.model } : {}),
          ...(patch.currentUrl !== undefined ? { currentUrl: patch.currentUrl } : {}),
          ...(patch.scroll !== undefined ? { scroll: patch.scroll } : {}),
          ...(patch.videoTime !== undefined ? { videoTime: patch.videoTime } : {}),
          ...(patch.allowedOrigins ? { allowedOrigins: patch.allowedOrigins } : {}),
          ...(patch.wakeRequested ? { wakeRequestedAt: sql`now()` } : {}),
          ...(patch.consumeWake
            ? {
                wakeRequestedAt: sql`case when ${runs.wakeRequestedAt} <= ${patch.consumeWake}::timestamptz then null else ${runs.wakeRequestedAt} end`,
              }
            : {}),
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
            set: {
              state: step.state,
              result: step.result ?? null,
              caption: sql`coalesce(excluded.caption, ${runSteps.caption})`,
              url: sql`coalesce(excluded.url, ${runSteps.url})`,
              screenshotKey: sql`coalesce(excluded.screenshot_key, ${runSteps.screenshotKey})`,
              usage: sql`coalesce(excluded.usage, ${runSteps.usage})`,
              updatedAt: sql`now()`,
            },
          });
        const action = step.action
          ? {
              tool: step.action.tool,
              summary: step.action.summary,
              point: step.action.point,
              ...(step.action.pointer ? { pointer: step.action.pointer } : {}),
            }
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
          ...(step.reasoning ? { reasoning: step.reasoning } : {}),
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
      // A failed run's error is also on its stream, where the run view reads why it failed (D35).
      // Other transitions (a kill-switch cancel) say why on their status (review M5).
      if (transition?.to === "failed" && transition.error)
        events.push({
          type: "error",
          code: transition.error.code,
          message: transition.error.message.slice(0, 500),
        });
      if (transition)
        events.push({
          type: "status",
          status: transition.to,
          waitReason: transition.waitReason,
          reason: transition.reason?.slice(0, 500) ?? null,
        });
      events.push(...(commit.events ?? []));
      await commit.extra?.(tx);
      if (this.#observerStage)
        await tx
          .update(runs)
          .set({ guardState: this.#observerStage(events) })
          .where(eq(runs.id, run.id));
      await emitRunEvents(tx, run.id, events);
      return events;
    });
  }
}
