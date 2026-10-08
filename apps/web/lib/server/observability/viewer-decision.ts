import { createLogger } from "@mastertutor/contracts/server";
import { memberRoleOf } from "@mastertutor/db";
import { getDb } from "../db.ts";
import { getWebEnv } from "../env.ts";
import { getViewer } from "../viewer.ts";
import { decideObservability, type ObservabilityDecision } from "./authorize.ts";

const log = createLogger({ service: "web" });

/** The type of a failure, never its message (it can carry secrets, M6). */
const failed = (errorCode: string) => (error: unknown) => {
  log.error({ errorCode, err: error instanceof Error ? error.name : "unknown" }, errorCode);
  return null;
};

/** This request's viewer, checked against the owner rule (spec §12). Fails closed. */
export async function viewerObservabilityDecision(): Promise<ObservabilityDecision> {
  const viewer = await getViewer().catch(failed("observability_session_failed"));
  const membership = viewer
    ? await memberRoleOf(getDb().db, viewer.id).catch(failed("observability_role_failed"))
    : null;
  return decideObservability({
    signedIn: viewer !== null,
    role: membership?.role ?? null,
    viewerPassword: getWebEnv().OBSERVE_VIEWER_PASSWORD,
  });
}
