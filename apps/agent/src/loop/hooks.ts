import type { CDPSession } from "playwright-core";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import type { BrowserSession } from "../browser/session.ts";
import type { Log } from "../runtime/types.ts";
import type { RegisteredTool, StepWriter } from "../tools/types.ts";
import type { RunSnapshot } from "./run-state.ts";
import { NO_SESSION_STORE, type SessionStore } from "./step-store.ts";

/** B6 reports whether the user's live view could take the browser (F3). */
export type UserControlResult = { ok: true } | { ok: false; code: "takeover_failed" };

export interface ControlTransitions {
  /**
   * B6: n.eko host → the user's member session, clipboard on. `afterRestore` is true when the
   * takeover arrives with a fresh lease (a sleeping run woken into takeover), so the live view may
   * still be connecting. Never throws on purpose; a throw is treated as `takeover_failed`.
   */
  onUserControl(
    slotName: string,
    runId: string,
    context: { afterRestore: boolean },
  ): Promise<UserControlResult>;
  /** B6: n.eko host → agent admin session, clipboard off. */
  onAgentControl(slotName: string, runId: string): Promise<void>;
}

/** A slot just leased to a run (after connect, before restore). */
export interface LeasedSlot {
  runId: string;
  workspaceId: string;
  slotName: string;
  /** The page session (null for fakes); B3's passkey enrolment needs it. */
  session: BrowserSession | null;
  /** Browser-level CDP session (Browser.* domain), opened on first use and cached per lease. */
  browserCdp(): Promise<CDPSession>;
}

/** A lease ending. slotReleased=false: the worker stopped without releasing (lease lost, crash). */
export interface ReleasedSlot {
  runId: string;
  slotName: string;
  slotReleased: boolean;
}

/** Extension points later phases implement; B1 ships safe defaults. */
export interface RunHooks {
  /**
   * Runs before `completed` commits; its step writes join that commit. `{ok:false}` keeps running.
   * `signal` is the step's: a kill interrupts the hook's model and embedding calls.
   */
  onComplete(context: {
    run: RunSnapshot;
    log: Log;
    step: StepWriter;
    signal: AbortSignal;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Main-frame responses the browser session keeps for a later body read (B4 caption tracks). */
  responseLog: ((url: URL) => boolean) | null;
  sessionStore: SessionStore;
  maskSources(runId: string): MaskSources;
  control: ControlTransitions;
  functionTools: readonly RegisteredTool[];
  promptContext(run: RunSnapshot): Promise<string[]>;
  /** After an executed computer click (B3 logout detection): the target's accessible name and the page URL. */
  onClick(run: RunSnapshot, click: { label: string; url: string }): Promise<void>;
  /** This run's worker has ended (released, slept, lost its lease or failed): drop per-run state. */
  onReleased(runId: string): Promise<void>;
  /** After the browser connects, before restore. B6 attaches downloads and seats n.eko's host. */
  onLeased(slot: LeasedSlot): Promise<void>;
  /**
   * The lease is ending: from #release before Browser.close (slotReleased: true), or once from the
   * worker's finally before close() when #release never ran. Distinct from B3's onReleased(runId),
   * which runs after close() for per-run cleanup.
   */
  onLeaseEnding(slot: ReleasedSlot): Promise<void>;
}

export const DEFAULT_HOOKS: RunHooks = {
  onComplete: async () => ({ ok: true }),
  responseLog: null,
  sessionStore: NO_SESSION_STORE,
  maskSources: () => NO_MASK_SOURCES,
  control: {
    onUserControl: async () => ({ ok: true }),
    onAgentControl: async () => undefined,
  },
  functionTools: [],
  promptContext: async () => [],
  onClick: async () => undefined,
  onReleased: async () => undefined,
  onLeased: async () => undefined,
  onLeaseEnding: async () => undefined,
};

export function withHooks(overrides: Partial<RunHooks> = {}): RunHooks {
  return { ...DEFAULT_HOOKS, ...overrides };
}

/** Hooks several phases provide together; the rest of RunHooks has exactly one owner. */
const MERGED_HOOKS: ReadonlySet<keyof RunHooks> = new Set<keyof RunHooks>([
  "functionTools",
  "promptContext",
  "onLeased",
  "onLeaseEnding",
]);

/**
 * Combines phase hook sets (B3 vault, B6 live view, B5, …) for one Supervisor (principle 5:
 * explicit injection, no global registry). onLeased runs in argument order; every onLeaseEnding
 * runs even if an earlier one throws (the first error is rethrown afterwards). B3's
 * onReleased(runId), onClick, sessionStore, maskSources and control are single-owner.
 * A function tool name may have one owner only.
 */
export function composeRunHooks(...parts: Partial<RunHooks>[]): Partial<RunHooks> {
  const single: Record<string, unknown> = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (value === undefined || MERGED_HOOKS.has(key as keyof RunHooks)) continue;
      if (key in single) throw new Error(`RunHooks.${key} has more than one owner`);
      single[key] = value;
    }
  }
  const tools = parts.flatMap((part) => part.functionTools ?? []);
  const contexts = parts.flatMap((part) => (part.promptContext ? [part.promptContext] : []));
  const leased = parts.flatMap((part) => (part.onLeased ? [part.onLeased] : []));
  const ending = parts.flatMap((part) => (part.onLeaseEnding ? [part.onLeaseEnding] : []));
  const names = tools.map((tool) => tool.name);
  const duplicate = names.find((name, i) => names.indexOf(name) !== i);
  if (duplicate) throw new Error(`function tool ${duplicate} has more than one owner`);
  return {
    ...(single as Partial<RunHooks>),
    ...(tools.length > 0 ? { functionTools: tools } : {}),
    ...(contexts.length > 0
      ? {
          promptContext: async (run: RunSnapshot) =>
            (await Promise.all(contexts.map((context) => context(run)))).flat(),
        }
      : {}),
    ...(leased.length > 0
      ? {
          onLeased: async (slot: LeasedSlot) => {
            for (const hook of leased) await hook(slot);
          },
        }
      : {}),
    ...(ending.length > 0
      ? {
          onLeaseEnding: async (slot: ReleasedSlot) => {
            const results = await Promise.allSettled(ending.map((hook) => hook(slot)));
            const failed = results.find((result) => result.status === "rejected");
            if (failed) throw failed.reason;
          },
        }
      : {}),
  };
}
