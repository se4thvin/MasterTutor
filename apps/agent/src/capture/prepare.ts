import type { BrowserSession } from "../browser/session.ts";
import { waitForNetworkIdle } from "./network-idle.ts";
import { pageForceEager, pageScrollMetrics, pageScrollTo } from "./page/prepare.ts";
import { captureWorlds } from "./worlds.ts";

export const MAX_SCROLL_VIEWPORTS = 50;

/**
 * Spec §7.2: eager loading, stepwise scroll until the height is stable (cap 50 viewports), network
 * idle. Each live mutation first checks that the agent still holds control (preflight F13).
 */
export async function preparePage(
  session: BrowserSession,
  signal: AbortSignal,
): Promise<{ viewports: number; idle: boolean; heightStable: boolean }> {
  const mutate = () => session.guard.assertAgent(signal);
  mutate();
  const worlds = await captureWorlds(session);
  const cdp = await session.cdp();
  // Checked again right before the first change to the page: control may have moved meanwhile.
  mutate();
  await worlds.call(pageForceEager, []);
  const start = await worlds.call(pageScrollMetrics, []);
  let viewports = 0;
  let lastHeight = start.height;
  let heightStable = false;
  try {
    let y = 0;
    mutate();
    await worlds.call(pageScrollTo, [start.x, 0]);
    while (viewports < MAX_SCROLL_VIEWPORTS) {
      mutate();
      y += start.viewport;
      viewports++;
      await worlds.call(pageScrollTo, [start.x, y]);
      await waitForNetworkIdle(cdp, { quietMs: 300, timeoutMs: 3_000, signal });
      mutate();
      await worlds.call(pageForceEager, []);
      const now = await worlds.call(pageScrollMetrics, []);
      if (now.y + now.viewport >= now.height - 2 && now.height === lastHeight) {
        heightStable = true;
        break;
      }
      lastHeight = now.height;
    }
    const idle = await waitForNetworkIdle(cdp, { signal });
    return { viewports, idle, heightStable };
  } finally {
    // Put the reader back only while the agent still has the page.
    if (!session.guard.held && !signal.aborted)
      await worlds.call(pageScrollTo, [start.x, start.y]).catch(() => undefined);
  }
}
