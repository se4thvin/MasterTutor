import type { ApprovalRequest } from "@mastertutor/contracts";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import type { Log } from "../runtime/types.ts";
import type { RegisteredTool } from "../tools/types.ts";
import type { RunSnapshot } from "./run-state.ts";
import { NO_SESSION_STORE, type SessionStore } from "./step-store.ts";

export interface ControlTransitions {
  /** B6: n.eko host → the user's member session, clipboard on. */
  onUserControl(slotName: string, runId: string): Promise<void>;
  /** B6: n.eko host → agent admin session, clipboard off. */
  onAgentControl(slotName: string, runId: string): Promise<void>;
}

/** Extension points later phases implement; B1 ships safe defaults. */
export interface RunHooks {
  onComplete(context: {
    run: RunSnapshot;
    log: Log;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
  sessionStore: SessionStore;
  maskSources(runId: string): MaskSources;
  control: ControlTransitions;
  functionTools: readonly RegisteredTool[];
  functionApproval(
    call: { name: string; args: unknown },
    run: RunSnapshot,
    url: string,
  ): Promise<ApprovalRequest | null>;
  promptContext(run: RunSnapshot): Promise<string[]>;
}

export const DEFAULT_HOOKS: RunHooks = {
  onComplete: async () => ({ ok: true }),
  sessionStore: NO_SESSION_STORE,
  maskSources: () => NO_MASK_SOURCES,
  control: { onUserControl: async () => undefined, onAgentControl: async () => undefined },
  functionTools: [],
  functionApproval: async () => null,
  promptContext: async () => [],
};

export function withHooks(overrides: Partial<RunHooks> = {}): RunHooks {
  return { ...DEFAULT_HOOKS, ...overrides };
}
