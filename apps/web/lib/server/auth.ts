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
import { createLogger } from "@mastertutor/contracts/server";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { getDb } from "./db.ts";
import { getWebEnv } from "./env.ts";

interface AuthDeps {
  db: Database;
  secret: string;
  baseURL: string;
  signupOpen: boolean;
  /** Test seam; defaults to the real bootstrap. */
  ensureMember?: typeof ensureWorkspaceMember;
}

const log = createLogger({ service: "web" });

/** v1 is one trusted workspace (D4): the first sign-up owns it; later sign-ups need AUTH_SIGNUP_OPEN. */
export function createAuth({
  db,
  secret,
  baseURL,
  signupOpen,
  ensureMember = ensureWorkspaceMember,
}: AuthDeps) {
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
              await ensureMember(db, created.id, { joinExisting: signupOpen });
            } catch (error) {
              // Never leave a user with no membership: it would make hasAnyUser lock sign-up for all.
              try {
                await db.delete(user).where(eq(user.id, created.id));
              } catch {
                log.error(
                  { userId: created.id },
                  "could not remove user after sign-up hook failure",
                );
              }
              if (error instanceof WorkspaceClosedError) {
                throw new APIError("FORBIDDEN", { message: "Sign-up is closed" });
              }
              throw error;
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
