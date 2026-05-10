import type { DbHandle } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { getDb } from "../db.ts";
import { getSealer, type Sealer } from "../vault/sealer.ts";
import { liveOs as os } from "./live-os.ts";
import { createRunProcedures } from "./runs.ts";
import { createSettingsProcedures } from "./settings.ts";
import { createVaultProcedures } from "./vault.ts";

/** What the live router reads, each on first use (importing it never reads env or opens the DB). */
interface LiveRouterDeps {
  db(): DbHandle;
  sealer(): Sealer;
  // P2 adds live(): LiveDeps (B6's createLiveHandlers wires takeControl, handBack and openLive).
}

/**
 * Procedures whose backend is not on this branch yet: runs.takeControl/handBack/openLive (P2, B6),
 * notes.*, folders.* and assets.url (P3, B2), benchmarks.* (T18). Nothing else may use this;
 * router-parity.int.test.ts lists each exclusion by the branch that removes it.
 */
const notWired = (): never => {
  throw new ORPCError("NOT_IMPLEMENTED", {
    message: "This endpoint is not wired to the backend yet.",
  });
};

/** The one RPC router of a production build (fixture builds use lib/fixtures/router.ts). */
function createLiveRouter(deps: LiveRouterDeps) {
  const vault = createVaultProcedures({ sealer: deps.sealer, db: deps.db });
  const runs = createRunProcedures({ db: deps.db });
  const settings = createSettingsProcedures({ db: deps.db });
  return os.router({
    runs: {
      ...runs,
      submitOtp: vault.submitOtp,
      takeControl: os.runs.takeControl.handler(notWired),
      handBack: os.runs.handBack.handler(notWired),
      openLive: os.runs.openLive.handler(notWired),
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
    benchmarks: {
      list: os.benchmarks.list.handler(notWired),
      create: os.benchmarks.create.handler(notWired),
      start: os.benchmarks.start.handler(notWired),
      runs: os.benchmarks.runs.handler(notWired),
      grade: os.benchmarks.grade.handler(notWired),
    },
  });
}

export const liveRouter = createLiveRouter({ db: getDb, sealer: getSealer });
