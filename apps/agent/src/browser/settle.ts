import { abortable, pause } from "../runtime/abortable.ts";
import type { BrowserSession } from "./session.ts";

/** Runs in the isolated world: resolves after quietMs without DOM mutations (cap maxMs). Observes only. */
export function domQuietScript(arg: { quietMs: number; maxMs: number }): Promise<boolean> {
  return new Promise((resolve) => {
    let timer = setTimeout(done, arg.quietMs);
    const cap = setTimeout(done, arg.maxMs);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, arg.quietMs);
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    function done() {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(cap);
      const fallback = setTimeout(() => resolve(true), 100);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          clearTimeout(fallback);
          resolve(true);
        }),
      );
    }
  });
}

/**
 * Waits after an action until the page is usable: a started navigation finishes, the document is
 * parsed, and the DOM stops changing. Checks the abort signal between every wait (spec §5.3).
 */
export async function settle(
  session: BrowserSession,
  signal: AbortSignal,
  options: { navigationTimeoutMs?: number; quietMs?: number; maxQuietMs?: number } = {},
): Promise<void> {
  await pause(60, signal);
  await abortable(session.pendingAdoption(), signal);
  const page = session.page;
  const deadline = Date.now() + (options.navigationTimeoutMs ?? 15_000);
  while (session.navigations.pending(page) > 0 && Date.now() < deadline) await pause(50, signal);
  await abortable(
    page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined),
    signal,
  );
  const worlds = await session.worlds();
  await abortable(
    worlds
      .evaluate(domQuietScript, {
        quietMs: options.quietMs ?? 200,
        maxMs: options.maxQuietMs ?? 1_500,
      })
      .catch(() => false),
    signal,
  );
}
