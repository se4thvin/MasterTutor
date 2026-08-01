import type { DbHandle } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { getDb } from "../db.ts";
import { getLiveDeps } from "../live/deps.ts";
import type { LiveDeps } from "../live/open-live.ts";
import { createLiveHandlers } from "../live/procedures.ts";
import { getSealer, type Sealer } from "../vault/sealer.ts";
import { createBenchmarkProcedures } from "./benchmarks.ts";
import { liveOs as os } from "./live-os.ts";
import { createRunProcedures } from "./runs.ts";
import { createSettingsProcedures } from "./settings.ts";
import { createVaultProcedures } from "./vault.ts";

/** What the live router reads, each on first use (importing it never reads env or opens the DB). */
interface LiveRouterDeps {
  db(): DbHandle;
  sealer(): Sealer;
  live(): LiveDeps;
}

/**
 * Procedures whose backend is not on this branch yet: notes.*, folders.* and assets.url (P3, B2).
 * Nothing else may use this; router-parity.int.test.ts lists each exclusion by the branch that
 * removes it.
 */
const notWired = (): never => {
  throw new ORPCError("NOT_IMPLEMENTED", {
    message: "This endpoint is not wired to the backend yet.",
  });
};

/** The one RPC router of a production build (fixture builds use lib/fixtures/router.ts). */
export function createLiveRouter(deps: LiveRouterDeps) {
  const vault = createVaultProcedures({ sealer: deps.sealer, db: deps.db });
  const runs = createRunProcedures({ db: deps.db });
  const settings = createSettingsProcedures({ db: deps.db });
  const benchmarks = createBenchmarkProcedures({ db: deps.db });
  /** B6: the live view and the control lock (spec §10.2, §10.3). */
  const live = createLiveHandlers(deps.live);
  return os.router({
    runs: {
      ...runs,
      submitOtp: vault.submitOtp,
      takeControl: os.runs.takeControl.handler(({ input, context }) =>
        live.takeControl(input, context),
      ),
      handBack: os.runs.handBack.handler(({ input, context }) => live.handBack(input, context)),
      openLive: os.runs.openLive.handler(({ input, context }) => live.openLive(input, context)),
    },
    notes: {
      list: os.notes.list.handler(notWired),
      get: os.notes.get.handler(notWired),
      updateBlock: os.notes.updateBlock.handler(notWired),
      markVerified: os.notes.markVerified.handler(notWired),
      move: os.notes.move.handler(notWired),
      delete: os.notes.delete.handler(notWired),
      export: os.notes.export.handler(notWired),
      search: os.notes.search.handler(notWired),
    },
    folders: {
      tree: os.folders.tree.handler(notWired),
      create: os.folders.create.handler(notWired),
      rename: os.folders.rename.handler(notWired),
      move: os.folders.move.handler(notWired),
      delete: os.folders.delete.handler(notWired),
    },
    vault: vault.vault,
    settings,
    assets: { url: os.assets.url.handler(notWired) },
    benchmarks,
  });
}

export const liveRouter = createLiveRouter({ db: getDb, sealer: getSealer, live: getLiveDeps });
