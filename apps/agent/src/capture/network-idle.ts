import type { CDPSession } from "playwright-core";
import { RESPONSE_LOG_BUFFERS } from "../browser/session.ts";

/** Resolves true after `quietMs` with no in-flight requests, or false at `timeoutMs` (never throws for time). */
export async function waitForNetworkIdle(
  cdp: CDPSession,
  options: { quietMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const quietMs = options.quietMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 10_000;
  options.signal?.throwIfAborted();
  // Same bounds as the session's response log: a second enable must not lift them.
  await cdp.send("Network.enable", RESPONSE_LOG_BUFFERS);
  const inflight = new Set<string>();
  return new Promise<boolean>((resolve, reject) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const onStart = (event: { requestId: string; type?: string }) => {
      if (event.type === "WebSocket" || event.type === "EventSource") return;
      inflight.add(event.requestId);
      clearTimeout(quiet);
    };
    const onEnd = (event: { requestId: string }) => {
      if (inflight.delete(event.requestId)) arm();
    };
    const cleanup = () => {
      clearTimeout(quiet);
      clearTimeout(deadline);
      cdp.off("Network.requestWillBeSent", onStart);
      cdp.off("Network.loadingFinished", onEnd);
      cdp.off("Network.loadingFailed", onEnd);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (idle: boolean) => {
      cleanup();
      resolve(idle);
    };
    const onAbort = () => {
      cleanup();
      reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const arm = () => {
      clearTimeout(quiet);
      if (inflight.size === 0) quiet = setTimeout(() => finish(true), quietMs);
    };
    cdp.on("Network.requestWillBeSent", onStart);
    cdp.on("Network.loadingFinished", onEnd);
    cdp.on("Network.loadingFailed", onEnd);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const deadline = setTimeout(() => finish(false), timeoutMs);
    arm();
  });
}
