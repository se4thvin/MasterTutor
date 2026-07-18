import { createLogger } from "@mastertutor/contracts/server";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import type { BrowserSession } from "../browser/session.ts";
import { StepCollector } from "../loop/step-collector.ts";
import type { CallApproval, ToolContext } from "../tools/types.ts";

export const testLog = createLogger({ service: "test", level: "silent" });

/** A full ToolContext for tool tests; `step` is a real StepCollector so tests commit like the loop. */
export function testToolContext(base: {
  runId: string;
  workspaceId: string;
  session: BrowserSession;
  mask?: MaskSources;
  signal?: AbortSignal;
  approval?: CallApproval | null;
}): ToolContext & { step: StepCollector } {
  return {
    runId: base.runId,
    workspaceId: base.workspaceId,
    session: base.session,
    signal: base.signal ?? new AbortController().signal,
    log: testLog,
    step: new StepCollector(),
    mask: base.mask ?? NO_MASK_SOURCES,
    slotName: "browser-1",
    // B3: the call's own approval and its wait / hand-over requests (no-ops for capture tools).
    approval: base.approval ?? null,
    requestWait: () => undefined,
    requestHandOver: () => undefined,
  };
}
