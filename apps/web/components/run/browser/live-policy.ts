/** How the live frame treats a failed runs.openLive (L1; B6 A9 error mapping). */
type LiveFailure = "retry" | "in_use" | "unavailable" | "off";

const RETRY: ReadonlySet<string> = new Set([
  "SERVICE_UNAVAILABLE",
  "INTERNAL_SERVER_ERROR",
  "BAD_GATEWAY",
  "GATEWAY_TIMEOUT",
  "TIMEOUT",
]);

export function liveFailure(code: string | null): LiveFailure {
  if (code === null || RETRY.has(code)) return "retry";
  if (code === "CONFLICT") return "in_use";
  if (code === "UNAUTHORIZED") return "off";
  return "unavailable";
}
