import { afterAll, describe, expect, it } from "vitest";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import type { BrowserSession } from "./session.ts";

const signal = new AbortController().signal;
const isData = (url: URL) => url.pathname.endsWith("/capture/data.json");
let session: BrowserSession | undefined;
afterAll(async () => {
  await session?.close();
});

describe("the main-frame response log (Task 0 review I3, M12)", () => {
  it("keeps only the current tab's responses after a popup is adopted, with URLs redacted", async () => {
    session = await openTestSession({
      responseLog: isData,
      redactUrl: (url) => url.replaceAll("secret-token-123", "[secret]"),
    });
    await session.goto(`${FIXTURES}/capture/log-a.html`, signal);
    const first = await session.nextResponse((entry) => entry.url.includes("tab=a"), 5_000, signal);
    expect(first).not.toBeNull();
    const opener = session.page;
    await opener.evaluate(() => void window.open("/capture/log-b.html"));
    await expect.poll(() => session!.page !== opener, { timeout: 10_000 }).toBe(true);
    const b = await session.nextResponse((entry) => entry.url.includes("tab=b"), 5_000, signal);
    expect(b).not.toBeNull();
    expect(b!.url).toContain("token=[secret]");
    expect(b!.url).not.toContain("secret-token-123");
    // Tab A keeps fetching every 100 ms; none of it may reach the adopted tab's log.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(session.recentResponses().filter((entry) => entry.url.includes("tab=a"))).toEqual([]);
    await opener.close();
  });
});
