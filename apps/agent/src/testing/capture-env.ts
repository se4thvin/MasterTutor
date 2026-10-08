import { createDb, type DbHandle } from "@mastertutor/db";
import { behaviourEnv } from "../../../../tests/behaviour/env.ts";
import type { MaskSources } from "../browser/masking.ts";
import type { BrowserSession } from "../browser/session.ts";
import type { LibraryServices } from "../library.ts";
import type { RunScope } from "../notes/note-writer.ts";
import type { ToolContext } from "../tools/types.ts";
import type { StepCollector } from "../loop/step-collector.ts";
import { openTestSession } from "./browser-harness.ts";
import { fakeLibraryServices, type MemoryStorage } from "./library.ts";
import { commitStep } from "./notes.ts";
import { testToolContext } from "./tool-context.ts";

export interface CaptureEnv {
  db: DbHandle;
  session: BrowserSession;
  services: LibraryServices;
  storage: MemoryStorage;
  ocrCalls: number[];
  context(scope: RunScope, mask?: MaskSources): ToolContext & { step: StepCollector };
  /** Commits the context's step as the loop does after a successful tool call. */
  commit(ctx: ToolContext & { step: StepCollector }): Promise<void>;
  /** Discards the context's step as the loop does after a failed tool call. */
  discard(ctx: ToolContext & { step: StepCollector }): Promise<void>;
  stop(): Promise<void>;
}

/** Behaviour DB + slot browser-1 + memory storage + fake models, shared by capture, video and PDF tests. */
export async function startCaptureEnv(
  options: { responseLog?: (url: URL) => boolean } = {},
): Promise<CaptureEnv> {
  const db = createDb(behaviourEnv().agentUrl);
  const session = await openTestSession(options);
  const services = fakeLibraryServices(db.db);
  return {
    db,
    session,
    services,
    storage: services.storage,
    ocrCalls: services.ocrCalls,
    context: (scope, mask) => testToolContext({ ...scope, session, ...(mask ? { mask } : {}) }),
    commit: (ctx) => commitStep(db.db, ctx.runId, ctx.step),
    discard: async (ctx) => {
      await Promise.allSettled(ctx.step.reset().map((key) => services.storage.delete(key)));
    },
    async stop() {
      await session.close();
      await db.close();
    },
  };
}
