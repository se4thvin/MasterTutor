import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encodeRunEventSse } from "@mastertutor/contracts";
import { recordedEvents } from "../lib/fixtures/run-recording.ts";
import { frame, gotoRun } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

test.skip(({ viewport }) => viewport?.width !== 1440, "stream check runs once");

test("streams from the snapshot id, then resumes with Last-Event-ID (Review Focus 1)", async ({
  page,
}) => {
  const events = recordedEvents();
  const first = events.slice(0, 3);
  const second = events.slice(3);
  // A real SSE endpoint: the browser adds Last-Event-ID in its network layer, after Playwright's
  // route handler, so only a server that receives the request can see it.
  const seen: { url: string; lastEventId: string | undefined }[] = [];
  const server: Server = createServer((req, res) => {
    const header = req.headers["last-event-id"];
    seen.push({ url: req.url ?? "", lastEventId: Array.isArray(header) ? header[0] : header });
    const batch = seen.length === 1 ? first : seen.length === 2 ? second : [];
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(`retry: 100\n\n${batch.map(encodeRunEventSse).join("")}`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await page.route("**/api/runs/*/events*", (route) => {
      const url = new URL(route.request().url());
      return route.continue({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
    });
    await gotoRun(page, { realEventSource: true });
    await expect(frame(page)).toHaveAttribute("data-state", "approval");
    expect(new URL(seen[0]!.url, "http://x").searchParams.get("after")).toBe("12");
    expect(seen[1]!.lastEventId).toBe(first.at(-1)!.id);
  } finally {
    server.close();
  }
});
