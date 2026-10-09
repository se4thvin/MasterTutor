import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import type { BrowserSession } from "../browser/session.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import { createSecretFingerprints } from "../vault/fingerprints.ts";
import { MHTML_SKIP, mhtmlTexts } from "./mhtml-mask.ts";
import { takeSnapshot } from "./snapshot.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
beforeAll(async () => {
  session = await openTestSession();
});
afterAll(async () => {
  await session?.close();
});

describe("takeSnapshot", () => {
  it("captures MHTML and a full-page PNG with hashes", async () => {
    await session.goto(`${FIXTURES}/capture/article/index.html`, signal);
    const snapshot = await takeSnapshot(session, NO_MASK_SOURCES, signal);
    expect(new TextDecoder().decode(snapshot.mhtml!.slice(0, 200))).toMatch(
      /MIME-Version|Content-Type: multipart\/related/i,
    );
    expect(snapshot.png!.slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
    expect(snapshot.mhtmlSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.skipped).toEqual([]);
  });
  const SECRET = "MARMOT4CANARY8VELVET";
  /** The vault's real mask source, with SECRET filled into `#user` (a plain text input) on this page. */
  async function vaultFilled(selector: string | null): Promise<MaskSources> {
    const prints = createSecretFingerprints();
    const cdp = await session.cdp();
    const { frameTree } = await cdp.send("Page.getFrameTree");
    let backendNodeIds: number[] = [];
    if (selector) {
      const objectId = await (
        await session.worlds()
      ).evaluateHandle(`document.querySelector(${JSON.stringify(selector)})`);
      backendNodeIds = [
        (await cdp.send("DOM.describeNode", { objectId: objectId! })).node.backendNodeId,
      ];
    }
    prints.remember("run", {
      filled: {
        cdp,
        frameId: frameTree.frame.id,
        loaderId: (frameTree.frame as { loaderId: string }).loaderId,
        backendNodeIds,
      },
      secret: SECRET,
    });
    return prints.forRun("run");
  }
  const allText = (snapshot: { mhtml: Uint8Array | null }) =>
    mhtmlTexts(new TextDecoder().decode(snapshot.mhtml!)).join("\n");

  it("stores a masked MHTML for a secret run: no secret bytes, raw or decoded (snapshot ruling)", async () => {
    await session.page.setContent(`<!doctype html><html><body>
      <h1>Sign-in done</h1><p>${"A paragraph of ordinary page text. ".repeat(6)}</p>
      <form><input id="user" name="user" value="${SECRET}"><input type="password" id="pw" value="hunter-pass-77">
      <input id="pin" name="pin" inputmode="numeric" value="4821"></form>
      <img alt="logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-note="${SECRET}"></body></html>`);
    await session.page.fill("#user", SECRET); // the live value, as a vault fill leaves it
    const snapshot = await takeSnapshot(session, await vaultFilled("#user"), signal);
    expect(snapshot.skipped.filter((reason) => reason.startsWith("mhtml"))).toEqual([]);
    expect(snapshot.mhtmlSha256).toMatch(/^[0-9a-f]{64}$/);
    const raw = new TextDecoder().decode(snapshot.mhtml!);
    expect(raw).not.toContain(SECRET);
    const text = allText(snapshot);
    for (const value of [SECRET, "hunter-pass-77", 'value="4821"'])
      expect(text).not.toContain(value);
    expect(text).toContain("A paragraph of ordinary page text.");
    expect(text).toContain("Sign-in done");
  });

  it("masks a page's own password field on a run without secrets", async () => {
    await session.page.setContent(
      '<form><input type="password" value="typed-by-hand-9"></form><p>Body</p>',
    );
    const snapshot = await takeSnapshot(session, NO_MASK_SOURCES, signal);
    expect(snapshot.mhtml).not.toBeNull();
    expect(allText(snapshot)).not.toContain("typed-by-hand-9");
  });

  it("skips the MHTML, with the reason recorded, when the page renders a secret in text", async () => {
    await session.page.setContent(
      `<p>Your recovery key is MARMOT4<b>CANARY8</b>VELVET, keep it safe.</p>`,
    );
    const snapshot = await takeSnapshot(session, await vaultFilled(null), signal);
    expect(snapshot.mhtml).toBeNull();
    expect(snapshot.mhtmlSha256).toBeNull();
    expect(snapshot.skipped).toContain(MHTML_SKIP.secretRemains);
  });
});
