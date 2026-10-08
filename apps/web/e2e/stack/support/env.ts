import { fileURLToPath } from "node:url";

/** The app's origin as the e2e container sees it (Traefik's namespace); BETTER_AUTH_URL's origin. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:18080";
/** The llm-mock, over the edge network (compose.test.yml). */
export const LLM_MOCK_URL = process.env.E2E_LLM_MOCK_URL ?? "http://llm-mock:8090";
export const AUTH_STATE = fileURLToPath(
  new URL("../../.out/stack/auth/owner.json", import.meta.url),
);
/** The throwaway stack's owner. Not a secret: the stack and its database are destroyed after each run. */
export const OWNER = {
  email: "owner@e2e.test",
  password: "e2e-owner-password-0123",
  name: "E2E Owner",
} as const;
/**
 * Options for a request context with no session. The runner applies the project's storageState to
 * every new request context, so a context is anonymous only when it says so.
 */
export const SIGNED_OUT: { storageState: { cookies: []; origins: [] } } = {
  storageState: { cookies: [], origins: [] },
};
