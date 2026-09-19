import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_MASK_SOURCES, type MaskSources } from "../browser/masking.ts";
import type { BrowserSession } from "../browser/session.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
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
  it("skips MHTML when the page holds secret fields or the run has registered secrets", async () => {
    await session.page.setContent('<form><input type="password" value="x"></form>');
    expect(await takeSnapshot(session, NO_MASK_SOURCES, signal)).toMatchObject({
      mhtml: null,
      skipped: expect.arrayContaining(["mhtml:secret_fields"]),
    });
    await session.goto(`${FIXTURES}/capture/article/index.html`, signal);
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text) => text,
    }; // B3 seam
    expect(await takeSnapshot(session, vault, signal)).toMatchObject({
      mhtml: null,
      skipped: expect.arrayContaining(["mhtml:secrets_registered"]),
    });
  });
});
