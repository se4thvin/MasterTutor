import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export type AuthMode = "sign-in" | "sign-up";

/**
 * Fixed copy for auth failures; never echoes server messages. Sign-up deliberately gives one
 * answer for "workspace closed" and "email already registered" so it cannot be used to probe
 * which accounts exist. `network` means the request never got an answer.
 */
export function authErrorCopy(
  error: { status?: number; code?: string; network?: boolean },
  mode: AuthMode,
): string {
  if (error.network) return "Couldn't reach the server. Try again.";
  if (error.status === 429) return "Too many attempts. Wait a moment and try again.";
  if (mode === "sign-up") {
    if (error.status === 403 || error.status === 422 || error.code === "USER_ALREADY_EXISTS") {
      return "Couldn't create the account. Sign-up may be closed, or this email may already be registered.";
    }
    if (error.code === "PASSWORD_TOO_SHORT") return "Use at least 12 characters.";
    if (error.code === "INVALID_EMAIL") return "Enter a valid email address.";
    return "Couldn't create the account. Try again.";
  }
  if (error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD") {
    return "That email and password don't match.";
  }
  return "Couldn't sign in. Try again.";
}
