import {
  account,
  ensureWorkspaceMember,
  hasAnyUser,
  session,
  user,
  verification,
  WorkspaceClosedError,
  type Database,
} from "@mastertutor/db";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { getDb } from "./db.ts";
import { getWebEnv } from "./env.ts";

export interface AuthDeps {
  db: Database;
  secret: string;
  baseURL: string;
  signupOpen: boolean;
}

/** v1 is one trusted workspace (D4): the first sign-up owns it; later sign-ups need AUTH_SIGNUP_OPEN. */
export function createAuth({ db, secret, baseURL, signupOpen }: AuthDeps) {
  return betterAuth({
    secret,
    baseURL,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!signupOpen && (await hasAnyUser(db))) {
              throw new APIError("FORBIDDEN", { message: "Sign-up is closed" });
            }
          },
          // The check in `before` is only a fast path: two first sign-ups can both pass it.
          // The authoritative gate is ensureWorkspaceMember's advisory lock, which lets exactly
          // one user create the workspace; a loser is removed and refused.
          after: async (created) => {
            try {
              await ensureWorkspaceMember(db, created.id, { joinExisting: signupOpen });
            } catch (error) {
              if (!(error instanceof WorkspaceClosedError)) throw error;
              await db.delete(user).where(eq(user.id, created.id));
              throw new APIError("FORBIDDEN", { message: "Sign-up is closed" });
            }
          },
        },
      },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | undefined;

export function getAuth(): Auth {
  if (!cached) {
    const env = getWebEnv();
    cached = createAuth({
      db: getDb().db,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      signupOpen: env.AUTH_SIGNUP_OPEN,
    });
  }
  return cached;
}
