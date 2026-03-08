import { ORPCError } from "@orpc/server";
import { getDb } from "../db.ts";
import { getSealer } from "../vault/sealer.ts";
import { liveOs as os } from "./live-os.ts";
import { createVaultProcedures } from "./vault.ts";

const vault = createVaultProcedures({ sealer: getSealer, db: getDb });

/** Phase 7 (with B2 and B6) replaces the remaining handlers, one namespace at a time. B3 wired vault.* and runs.submitOtp. */
const notWired = (): never => {
  throw new ORPCError("NOT_IMPLEMENTED", {
    message: "This endpoint is not wired to the backend yet.",
  });
};

export const liveRouter = os.router({
  runs: {
    create: os.runs.create.handler(notWired),
    list: os.runs.list.handler(notWired),
    get: os.runs.get.handler(notWired),
    steps: os.runs.steps.handler(notWired),
    cancel: os.runs.cancel.handler(notWired),
    resume: os.runs.resume.handler(notWired),
    sendMessage: os.runs.sendMessage.handler(notWired),
    decideApproval: os.runs.decideApproval.handler(notWired),
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
  settings: {
    get: os.settings.get.handler(notWired),
    update: os.settings.update.handler(notWired),
    setKillSwitch: os.settings.setKillSwitch.handler(notWired),
    usage: os.settings.usage.handler(notWired),
  },
  assets: { url: os.assets.url.handler(notWired) },
  benchmarks: {
    list: os.benchmarks.list.handler(notWired),
    create: os.benchmarks.create.handler(notWired),
    start: os.benchmarks.start.handler(notWired),
    runs: os.benchmarks.runs.handler(notWired),
    grade: os.benchmarks.grade.handler(notWired),
  },
});
