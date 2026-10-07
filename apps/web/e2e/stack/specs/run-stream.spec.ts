import {
  RUN_EVENT_SSE_NAME,
  RunDetail,
  RunSummary,
  compareEventIds,
  runEventsPath,
} from "@mastertutor/contracts";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { frame } from "../../helpers/run.ts";
import { rpcOk } from "../support/rpc.ts";

async function finishedRun(request: APIRequestContext): Promise<RunSummary> {
  const goal = scenarioGoal("wire-shapes", `Look at ${SITE}/index.html`);
  const run = RunSummary.parse(
    await rpcOk(request, "runs/create", { goal, allowedOrigins: [SITE] }),
  );
  await expect
    .poll(async () => RunDetail.parse(await rpcOk(request, "runs/get", { runId: run.id })).status, {
      timeout: 90_000,
    })
    .toBe("completed");
  return run;
}

/**
 * A real EventSource in the page, listening the way the contract says (X13): by event name. It
 * collects ids until the server ends a finished run's stream and EventSource gives up (its
 * reconnect is answered 204), or 15 s. The agent's slot release follows the terminal status, so
 * the terminal status is not the last record. `onmessage` would never fire for `run_event`.
 */
async function streamIds(page: Page, path: string): Promise<{ ids: string[]; unnamed: number }> {
  return page.evaluate(
    ({ path, eventName }) =>
      new Promise<{ ids: string[]; unnamed: number }>((resolve) => {
        const ids: string[] = [];
        let unnamed = 0;
        const source = new EventSource(path);
        const finish = () => {
          clearTimeout(timer);
          source.close();
          resolve({ ids, unnamed });
        };
        const timer = setTimeout(finish, 15_000);
        source.onmessage = () => {
          unnamed += 1;
        };
        source.onerror = () => {
          if (source.readyState === EventSource.CLOSED) finish();
        };
        source.addEventListener(eventName, (event) => {
          ids.push((JSON.parse((event as MessageEvent<string>).data) as { id: string }).id);
        });
      }),
    { path, eventName: RUN_EVENT_SSE_NAME },
  );
}

test.describe("run events through Traefik (Review Focus 2, X13)", () => {
  test("replays a finished run in order and resumes after ?after= without loss or duplicates", async ({
    page,
    request,
  }) => {
    const run = await finishedRun(request);
    await page.goto("/library");
    const full = await streamIds(page, runEventsPath(run.id));
    expect(full.unnamed).toBe(0);
    expect(full.ids.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < full.ids.length; i++)
      expect(compareEventIds(full.ids[i - 1]!, full.ids[i]!)).toBeLessThan(0);
    const resumed = await streamIds(page, runEventsPath(run.id, full.ids[1]!));
    expect(resumed.ids).toEqual(full.ids.slice(2));
  });

  test("Last-Event-ID wins over ?after=, and every record is a named run_event", async ({
    page,
    request,
  }) => {
    const run = await finishedRun(request);
    await page.goto("/library");
    const { ids } = await streamIds(page, runEventsPath(run.id));
    const response = await request.get(runEventsPath(run.id, ids.at(-2)!), {
      headers: { "last-event-id": ids[0]! },
    });
    expect(response.headers()["content-type"]).toContain("text/event-stream");
    const body = await response.text();
    expect([...body.matchAll(/^id: (\d+)$/gm)].map((match) => match[1])).toEqual(ids.slice(1));
    const names = [...body.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
    expect(names).toHaveLength(ids.length - 1);
    expect(new Set(names)).toEqual(new Set([RUN_EVENT_SSE_NAME]));
  });

  test("the paused view of a finished run shows its last masked screenshot through the seq route (D6)", async ({
    page,
    request,
  }) => {
    const run = await finishedRun(request);
    await page.goto(`/runs/${run.id}`);
    await expect(frame(page)).toHaveAttribute("data-state", "paused");
    const shot = frame(page).locator("img[src*='/steps/']");
    await expect(shot).toBeVisible();
    await expect
      .poll(() => shot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await expect(page.getByRole("button", { name: /^Replay step:/ }).first()).toBeVisible();
  });

  test("a running run shows the live browser through the real openLive and /live route; cancel ends it", async ({
    page,
    request,
  }) => {
    const goal = scenarioGoal("long-wait", `Wait on ${SITE}/`);
    const run = RunSummary.parse(
      await rpcOk(request, "runs/create", { goal, allowedOrigins: [SITE] }),
    );
    try {
      await expect
        .poll(
          async () => RunDetail.parse(await rpcOk(request, "runs/get", { runId: run.id })).slotName,
          {
            timeout: 60_000,
          },
        )
        .not.toBeNull();
      await page.goto(`/runs/${run.id}`);
      await expect(page.locator("iframe[title^='Remote browser']")).toBeVisible();
      await expect(frame(page)).toHaveAttribute("data-state", /^(live|acting)$/);
    } finally {
      await rpcOk(request, "runs/cancel", { runId: run.id });
    }
    await expect(frame(page)).toHaveAttribute("data-state", "paused", { timeout: 30_000 });
    await expect(page.locator("iframe[title^='Remote browser']")).toHaveCount(0);
  });
});
