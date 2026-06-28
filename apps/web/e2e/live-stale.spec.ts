import { liveEmbedPath, type OpenLiveResult } from "@mastertutor/contracts";
import { rec } from "../lib/fixtures/run-recording.ts";
import { emit, frame, gotoRun, rpcCalls } from "./helpers/run.ts";
import { expect, test } from "./helpers/test.ts";

test.skip(({ viewport }) => viewport?.width !== 1440, "behaviour check runs once");

test("a stale openLive answer that lands after a newer slot change never wins (Review Focus 2)", async ({
  page,
}) => {
  let releaseStale!: () => void;
  const staleHeld = new Promise<void>((resolve) => (releaseStale = resolve));
  let answered = 0;
  const calls = await gotoRun(page, {
    handlers: {
      "runs/openLive": async (input) => {
        answered += 1;
        if (answered === 1) {
          // The first answer (for browser-1) is held, then arrives last and says "sleeping".
          await staleHeld;
          return { sleeping: true } satisfies OpenLiveResult;
        }
        return {
          sleeping: false,
          slotName: "browser-2",
          embedPath: liveEmbedPath((input as { runId: string }).runId),
          iceServers: [],
        } satisfies OpenLiveResult;
      },
    },
  });
  await expect.poll(() => rpcCalls(calls, "runs/openLive").length).toBe(1);
  await emit(page, [rec({ type: "slot", slotName: "browser-2" })]);
  await expect(page.locator("iframe[title^='Remote browser']")).toBeVisible();

  const late = page.waitForResponse((response) =>
    response.url().endsWith("/api/rpc/runs/openLive"),
  );
  releaseStale();
  await late;
  // Two frames: the stale answer has been delivered and React has rendered whatever it caused.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(page.locator("iframe[title^='Remote browser']")).toBeVisible();
  await expect(frame(page)).toHaveAttribute("data-state", "live");
  expect(rpcCalls(calls, "runs/openLive")).toHaveLength(2);
});
