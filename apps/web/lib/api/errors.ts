const COPY: Record<string, string> = {
  BAD_REQUEST: "Check the highlighted fields and try again.",
  UNAUTHORIZED: "Your session ended. Sign in again.",
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "This item no longer exists.",
  CONFLICT: "That name is already taken.",
  TOO_MANY_REQUESTS: "Too many requests. Wait a moment and try again.",
  NOT_IMPLEMENTED: "This isn't available yet.",
};

/** The oRPC error code (for example "CONFLICT"), or null when the error carries none. */
export function errorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** User-facing copy for an API error. Server messages are never shown: they may echo input. */
export function errorCopy(error: unknown, fallback = "Something went wrong. Try again."): string {
  const code = errorCode(error);
  return (code ? COPY[code] : undefined) ?? fallback;
}
