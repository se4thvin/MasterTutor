import { OBSERVABILITY_ENTER_PATH, OBSERVE_USERS, type MemberRole } from "@mastertutor/contracts";
import { signInPathFor } from "../../auth/next-path.ts";

export type ObservabilityDecision =
  | { kind: "allow"; authorization: string }
  | { kind: "sign_in"; location: string }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

/**
 * Spec §12: only the workspace owner reaches OpenObserve. The viewer's credentials are added to the
 * upstream request by Traefik (authResponseHeaders) and never reach the browser.
 */
export function decideObservability(input: {
  signedIn: boolean;
  role: MemberRole | null;
  viewerPassword: string | undefined;
}): ObservabilityDecision {
  if (!input.signedIn)
    return { kind: "sign_in", location: signInPathFor(OBSERVABILITY_ENTER_PATH, "") };
  if (input.role !== "owner") return { kind: "forbidden" };
  if (!input.viewerPassword) return { kind: "unavailable" };
  const credentials = `${OBSERVE_USERS.viewer}:${input.viewerPassword}`;
  return { kind: "allow", authorization: `Basic ${Buffer.from(credentials).toString("base64")}` };
}
