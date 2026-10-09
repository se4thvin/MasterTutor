import {
  OBSERVER_HEADERS,
  OBSERVER_UPSTREAM_COOKIE,
  PersonDecider,
  Uuid,
} from "@mastertutor/contracts";

type ObserverAccess =
  { kind: "allow"; headers: Record<string, string> } | { kind: "refuse"; status: 401 | 403 | 503 };

/**
 * Spec §7.2: only the signed-in workspace owner reaches the observer service. Traefik copies these
 * headers onto the upstream request (authResponseHeaders), replacing the browser's: the bearer
 * proves the request passed here, and no MasterTutor cookie reaches the service.
 */
export function decideObserverAccess(input: {
  userId: string | null;
  workspaceId: string | null;
  owner: boolean;
  token: string | undefined;
}): ObserverAccess {
  if (input.userId === null) return { kind: "refuse", status: 401 };
  if (
    !input.owner ||
    !Uuid.safeParse(input.workspaceId).success ||
    !PersonDecider.safeParse(input.userId).success
  )
    return { kind: "refuse", status: 403 };
  if (!input.token) return { kind: "refuse", status: 503 };
  return {
    kind: "allow",
    headers: {
      authorization: `Bearer ${input.token}`,
      cookie: OBSERVER_UPSTREAM_COOKIE,
      [OBSERVER_HEADERS.user]: input.userId,
      [OBSERVER_HEADERS.workspace]: input.workspaceId!,
      "cache-control": "no-store",
    },
  };
}
