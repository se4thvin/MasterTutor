import { createHash } from "node:crypto";
import { ApprovalRequest, Uuid } from "@mastertutor/contracts";
import {
  approvals,
  memberOfRunWorkspace,
  runSteps,
  runs,
  workspaceMembers,
  type Database,
} from "@mastertutor/db";
import { objectKeys, type Storage } from "@mastertutor/storage";
import { and, eq } from "drizzle-orm";
import { OBJECT_CACHE, OBJECT_HEADERS, matchesIfNoneMatch } from "../library/objects.ts";

export interface ScreenshotDeps {
  db: Database;
  storage: Pick<Storage, "getStream">;
  viewerId(): Promise<string | null>;
}

/** run_steps.seq is an int4: at most 9 digits, canonical (no sign, no leading zero). */
const SEQ = /^(0|[1-9][0-9]{0,8})$/;
const status = (code: number) =>
  new Response(null, {
    status: code,
    headers: { ...OBJECT_HEADERS, "Cache-Control": OBJECT_CACHE },
  });

/**
 * Streams one masked step screenshot. The key comes from a row, never from the request, and must
 * be this run's step screenshot (objectKeys.stepScreenshotPrefix). The ETag hides the key.
 */
async function serve(
  deps: ScreenshotDeps,
  request: Request,
  runId: string,
  key: string | null | undefined,
): Promise<Response> {
  if (!key || !key.startsWith(objectKeys.stepScreenshotPrefix(runId))) return status(404);
  const etag = `"${createHash("sha256").update(key).digest("hex").slice(0, 32)}"`;
  const common = { ...OBJECT_HEADERS, ETag: etag, "Cache-Control": OBJECT_CACHE };
  if (matchesIfNoneMatch(request, etag))
    return new Response(null, { status: 304, headers: common });
  let body: ReadableStream<Uint8Array>;
  try {
    body = await deps.storage.getStream(key);
  } catch {
    return status(404);
  }
  return new Response(body, {
    headers: { ...common, "Content-Type": "image/png", "Content-Disposition": "inline" },
  });
}

/** GET /api/runs/:id/steps/:seq/screenshot (D6): the key is looked up by seq, membership in the same query. */
export async function stepScreenshotResponse(
  deps: ScreenshotDeps,
  request: Request,
  runIdParam: string,
  seq: string,
): Promise<Response> {
  const run = Uuid.safeParse(runIdParam);
  if (!run.success || !SEQ.test(seq)) return status(404);
  const userId = await deps.viewerId();
  if (!userId) return status(401);
  const [row] = await deps.db
    .select({ key: runSteps.screenshotKey })
    .from(runSteps)
    .innerJoin(runs, eq(runs.id, runSteps.runId))
    .innerJoin(workspaceMembers, memberOfRunWorkspace(userId))
    .where(and(eq(runSteps.runId, run.data), eq(runSteps.seq, Number(seq))));
  return serve(deps, request, run.data, row?.key);
}

/** GET /api/runs/:id/approvals/:approvalId/screenshot (D7): the server reads request.screenshotKey. */
export async function approvalScreenshotResponse(
  deps: ScreenshotDeps,
  request: Request,
  runIdParam: string,
  approvalIdParam: string,
): Promise<Response> {
  const run = Uuid.safeParse(runIdParam);
  const approval = Uuid.safeParse(approvalIdParam);
  if (!run.success || !approval.success) return status(404);
  const userId = await deps.viewerId();
  if (!userId) return status(401);
  const [row] = await deps.db
    .select({ request: approvals.request })
    .from(approvals)
    .innerJoin(runs, eq(runs.id, approvals.runId))
    .innerJoin(workspaceMembers, memberOfRunWorkspace(userId))
    .where(and(eq(approvals.id, approval.data), eq(approvals.runId, run.data)));
  const parsed = ApprovalRequest.safeParse(row?.request);
  const key =
    parsed.success && (parsed.data.kind === "risky_click" || parsed.data.kind === "form_submit")
      ? parsed.data.screenshotKey
      : null;
  return serve(deps, request, run.data, key);
}
