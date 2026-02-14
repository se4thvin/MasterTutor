const COPY: Record<string, string> = {
  BAD_REQUEST: "Check the highlighted fields and try again.",
  UNAUTHORIZED: "Your session ended. Sign in again.",
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "This item no longer exists.",
  CONFLICT: "That name is already taken.",
  TOO_MANY_REQUESTS: "Too many requests. Wait a moment and try again.",
  NOT_IMPLEMENTED: "This isn't available yet.",
};

/** User-facing copy for an API error. Server messages are never shown: they may echo input. */
export function errorCopy(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return COPY[error.code] ?? fallback;
  }
  return fallback;
}
