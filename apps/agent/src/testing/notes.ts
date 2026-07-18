import { randomBytes } from "node:crypto";
import { type Database, emitRunEvents, runs, workspaces } from "@mastertutor/db";
import { bootstrapGarage, createStorage, type Storage } from "@mastertutor/storage";
import { startTestGarage } from "@mastertutor/storage/testing";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import { StepCollector } from "../loop/step-collector.ts";
import type { RunScope, WriteContext } from "../notes/note-writer.ts";
import { testLog } from "./tool-context.ts";

export const testLogger = testLog;

/** Commits a collector the way RunLoop does: writes, then events (with NOTIFY), then after-commit tasks. */
export async function commitStep(db: Database, runId: string, step: StepCollector): Promise<void> {
  const parts = step.commitParts();
  await db.transaction(async (tx) => {
    await parts.extra?.(tx);
    await emitRunEvents(tx, runId, parts.events);
  });
  await step.afterCommitted(testLog);
  step.reset();
}

export function testWrite(
  scope: RunScope,
  secrets: MaskSources = NO_MASK_SOURCES,
): WriteContext & { step: StepCollector } {
  return { scope, step: new StepCollector(), secrets };
}

export async function seedRun(
  db: Database,
  options: { targetFolderId?: string; workspaceId?: string } = {},
): Promise<RunScope> {
  const workspaceId =
    options.workspaceId ??
    (await db.insert(workspaces).values({ name: "Test" }).returning({ id: workspaces.id }))[0]!.id;
  const [run] = await db
    .insert(runs)
    .values({
      workspaceId,
      goal: "test",
      allowedOrigins: ["https://example.com"],
      targetFolderId: options.targetFolderId ?? null,
    })
    .returning({ id: runs.id });
  return { runId: run!.id, workspaceId };
}

export async function startTestStorage(): Promise<{ storage: Storage; stop: () => Promise<void> }> {
  const garage = await startTestGarage();
  const accessKeyId = `GK${randomBytes(12).toString("hex")}`;
  const secretAccessKey = randomBytes(32).toString("hex");
  const bucket = "mastertutor-test";
  await bootstrapGarage({
    adminUrl: garage.adminUrl,
    adminToken: garage.adminToken,
    bucket,
    keys: [{ name: "agent-test", accessKeyId, secretAccessKey, read: true, write: true }],
  });
  const storage = createStorage({
    endpoint: garage.s3Endpoint,
    region: "garage",
    bucket,
    accessKeyId,
    secretAccessKey,
  });
  return { storage, stop: () => garage.stop() };
}
