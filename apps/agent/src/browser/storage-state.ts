import { toOrigin } from "@mastertutor/contracts";
import { z } from "zod";
import type { BrowserSession } from "./session.ts";

export const BrowserStorageState = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(["Strict", "Lax", "None"]),
    }),
  ),
  origins: z.array(
    z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});
export type BrowserStorageState = z.infer<typeof BrowserStorageState>;

function localStorageScript(): Array<[string, string]> {
  try {
    return Object.entries(localStorage);
  } catch {
    return [];
  }
}

/**
 * Our own collection (spec §5.6). Playwright's context.storageState() may open hidden pages to
 * read other origins, which would flash tabs in the user's live view.
 */
export async function collectStorageState(session: BrowserSession): Promise<BrowserStorageState> {
  const cookies = await session.context.cookies();
  const origins: BrowserStorageState["origins"] = [];
  const origin = toOrigin(session.page.url());
  if (origin !== null) {
    const entries = await (
      await session.worlds()
    )
      .evaluate(localStorageScript, null)
      .catch(() => []);
    if (entries.length > 0) {
      origins.push({ origin, localStorage: entries.map(([name, value]) => ({ name, value })) });
    }
  }
  return BrowserStorageState.parse({ cookies, origins });
}

/** Applies sealed state on lease (spec §5.2 rule 6). Returns a remover for the localStorage script. */
export async function applyStorageState(
  session: BrowserSession,
  state: BrowserStorageState,
): Promise<() => Promise<void>> {
  if (state.cookies.length > 0) await session.context.addCookies(state.cookies);
  if (state.origins.length === 0) return async () => undefined;
  const byOrigin = Object.fromEntries(
    state.origins.map((entry) => [
      entry.origin,
      entry.localStorage.map((item) => [item.name, item.value]),
    ]),
  );
  const source = `(() => { const items = (${JSON.stringify(byOrigin)})[location.origin]; if (!items) return; for (const [k, v] of items) { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } })();`;
  const cdp = await session.cdp();
  // The Page domain must be enabled on this session, or the script never runs on new documents.
  await cdp.send("Page.enable");
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source,
    worldName: "mastertutor-restore",
  });
  return async () => {
    await cdp
      .send("Page.removeScriptToEvaluateOnNewDocument", { identifier })
      .catch(() => undefined);
  };
}
