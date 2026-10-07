import { cookies, headers } from "next/headers";
import { FIXTURE_AUTH_COOKIE } from "../fixtures/cookies.ts";
import { getAuth } from "./auth.ts";
import { getWebEnv } from "./env.ts";

export interface Viewer {
  id: string;
  name: string;
  email: string;
}

export const FIXTURE_VIEWER: Viewer = {
  id: "fixture-user",
  name: "Sam Lee",
  email: "sam@example.test",
};

/** The signed-in user, or null. Fixture mode signs in a fixed user unless the test sets "signed-out". */
export async function getViewer(): Promise<Viewer | null> {
  // Only a fixture build can sign anyone in by cookie; a production build folds this away.
  if (__FIXTURE_BUILD__ && getWebEnv().WEB_FIXTURE_API) {
    const jar = await cookies();
    return jar.get(FIXTURE_AUTH_COOKIE)?.value === "signed-out" ? null : FIXTURE_VIEWER;
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session
    ? { id: session.user.id, name: session.user.name, email: session.user.email }
    : null;
}

/** The signed-in user's id, or null: what non-RPC routes pass to their services. */
export async function getViewerId(): Promise<string | null> {
  return (await getViewer())?.id ?? null;
}
