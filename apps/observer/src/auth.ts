import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { OBSERVER_HEADERS, PersonDecider, Uuid } from "@mastertutor/contracts";

export interface Caller {
  userId: PersonDecider;
  workspaceId: string;
}

const header = (headers: IncomingHttpHeaders, name: string) => {
  const value = headers[name];
  return typeof value === "string" ? value : null;
};

/**
 * Only Traefik's ForwardAuth answer carries this bearer and these headers (authResponseHeaders
 * replace the browser's), so a request that did not pass the owner check is refused here, even from
 * inside the network (spec §7.1). Constant-time compare.
 */
export function authorize(headers: IncomingHttpHeaders, token: string): Caller | null {
  const given = header(headers, "authorization");
  if (!token || !given?.startsWith("Bearer ")) return null;
  const a = Buffer.from(given.slice("Bearer ".length));
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const userId = PersonDecider.safeParse(header(headers, OBSERVER_HEADERS.user));
  const workspaceId = Uuid.safeParse(header(headers, OBSERVER_HEADERS.workspace));
  return userId.success && workspaceId.success
    ? { userId: userId.data, workspaceId: workspaceId.data }
    : null;
}
