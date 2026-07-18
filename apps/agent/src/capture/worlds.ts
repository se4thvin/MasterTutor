import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { CDPSession } from "playwright-core";
import type { IsolatedWorlds } from "../browser/isolated-world.ts";
import type { BrowserSession } from "../browser/session.ts";
import { pageInstallLib } from "./page/lib.ts";

const require = createRequire(import.meta.url);

/** Capture's own world: Defuddle, Readability and __mtLib never enter read_page's world (preflight F9). */
export const CAPTURE_WORLD = "mastertutor-capture";

let source: Promise<string> | undefined;

/** Defuddle's full UMD bundle (defines `Defuddle`), Readability (defines `Readability`), then our lib. */
export function captureLibrarySource(): Promise<string> {
  source ??= Promise.all([
    readFile(require.resolve("defuddle/full"), "utf8"),
    readFile(require.resolve("@mozilla/readability/Readability.js"), "utf8"),
  ]).then(
    ([defuddle, readability]) =>
      `${defuddle}\n;\n${readability}\n;\n(${pageInstallLib.toString()})();\ntrue;`,
  );
  return source;
}

/** The capture world of the foreground tab; every new context (navigation, frame) re-runs the prelude. */
export function captureWorlds(session: BrowserSession): Promise<IsolatedWorlds> {
  return session.namedWorlds({ name: CAPTURE_WORLD, prelude: captureLibrarySource });
}

export async function childFrames(
  cdp: CDPSession,
): Promise<{ frameId: string; url: string; name: string | null }[]> {
  const { frameTree } = await cdp.send("Page.getFrameTree");
  return (frameTree.childFrames ?? []).map((child) => ({
    frameId: child.frame.id,
    url: child.frame.url,
    name: child.frame.name ?? null,
  }));
}
