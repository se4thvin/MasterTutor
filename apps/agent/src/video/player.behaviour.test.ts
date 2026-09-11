import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { FIXTURES, openTestSession } from "../testing/browser-harness.ts";
import {
  pageCaptionsState,
  pageVideoPause,
  pageVideoReveal,
  pageVideoSeek,
  pageVideoState,
  pageYoutubeData,
} from "./page/player.ts";

let session: BrowserSession;
const signal = new AbortController().signal;
beforeAll(async () => {
  session = await openTestSession();
});
afterAll(async () => {
  await session?.close();
});

describe("player page functions", () => {
  it("finds, seeks and reads the fake player", async () => {
    await session.goto(`${FIXTURES}/youtube/watch.html`, signal);
    const worlds = await session.worlds();
    expect(await worlds.call(pageVideoReveal, [])).toMatchObject({
      found: true,
      duration: expect.closeTo(20, 0),
    });
    expect(await worlds.call(pageVideoSeek, [7])).toBe(true);
    await worlds.call(pageVideoPause, []);
    const state = await worlds.call(pageVideoState, []);
    expect(state.currentTime).toBeCloseTo(7, 0);
    expect(state.rect).toMatchObject({ width: 640, height: 360 });
    expect(await worlds.call(pageCaptionsState, [])).toEqual({
      present: true,
      pressed: false,
      disabled: false,
    });
    const data = await worlds.call(pageYoutubeData, []);
    expect(data.initialDataScript).toContain("chapterRenderer");
    expect(data.description).toContain("0:10 Calvin cycle");
  });
});
