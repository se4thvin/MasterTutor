import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

/** Fixed copy for auth failures; never echoes server messages. */
export function authErrorCopy(error: { status?: number; code?: string }): string {
  if (error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD")
    return "That email and password don't match.";
  if (error.status === 403) return "Sign-up is closed. Ask the workspace owner to invite you.";
  if (error.code === "USER_ALREADY_EXISTS" || error.status === 422)
    return "An account with this email already exists. Sign in instead.";
  if (error.code === "PASSWORD_TOO_SHORT") return "Use at least 12 characters.";
  return "Couldn't reach the server. Try again.";
}
