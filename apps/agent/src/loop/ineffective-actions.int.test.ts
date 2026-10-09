import { describe, expect, it } from "vitest";
import { click, done, drive, mock, setup } from "./testing/loop-harness.ts";

const NOTE =
  "Executor: the same action with the same arguments had no effect three times in a row. The page hash is unchanged; try something else.";
const notes = (input: unknown) => JSON.stringify(input).split(NOTE).length - 1;

describe("ineffective repetition (F3, D56)", () => {
  it("gives one correction after three ineffective clicks, lets the agent recover, and survives restore", async () => {
    const s = await setup([click(), click(), click(), click(30, 40), done()]);
    while (mock.requestsFor(s.name).length < 3) await s.loop.step(new AbortController().signal);
    await s.loop.step(new AbortController().signal); // approve
    expect(await s.loop.step(new AbortController().signal)).toEqual({ kind: "continue" }); // act
    const restored = await s.reload();
    expect(await drive(restored)).toEqual({ kind: "completed" });
    const requests = mock.requestsFor(s.name);
    expect(requests.slice(0, 3).map((r) => notes(r.body.input))).toEqual([0, 0, 0]);
    expect(notes(requests[3]!.body.input)).toBe(1);
    expect(notes(requests[4]!.body.input)).toBe(1);
  });

  it("still hands over if the agent ignores the correction", async () => {
    const s = await setup([click(), click(), click(), click(), done()]);
    expect(await drive(s.loop)).toEqual({ kind: "waiting", reason: "takeover" });
    expect(mock.requestsFor(s.name)).toHaveLength(4);
    expect(notes(mock.requestsFor(s.name)[3]!.body.input)).toBe(1);
  });

  it("carries the correction verbatim through compaction", async () => {
    const s = await setup([click(), click(), { ...click(), usage: { input: 64_001 } }, done()]);
    expect(await drive(s.loop)).toEqual({ kind: "completed" });
    const requests = mock.requestsFor(s.name);
    expect(requests.some((r) => r.body.text?.format?.name === "compaction_summary")).toBe(true);
    expect(notes(requests.at(-1)!.body.input)).toBe(1);
  });

  it("also detects identical function arguments on an unchanged page", async () => {
    const read = {
      outputs: [
        {
          type: "function" as const,
          name: "read_page",
          args: { mode: "text", sinceHash: null, offset: null },
        },
      ],
    };
    const s = await setup([read, read, read, done()]);
    expect(await drive(s.loop)).toEqual({ kind: "completed" });
    expect(notes(mock.requestsFor(s.name).at(-1)!.body.input)).toBe(1);
  });

  it.each(["hash", "scroll", "arguments"])("does not nudge when %s changes", async (change) => {
    const s = await setup([click(), click(change === "arguments" ? 30 : 10), click(), done()]);
    let n = 0;
    s.browser.computerHook = async () => {
      if (change === "hash") s.browser.domHash = String(++n).padStart(64, "0");
      if (change === "scroll") s.browser.scroll.y += 100;
    };
    expect(await drive(s.loop)).toEqual({ kind: "completed" });
    expect(notes(mock.requestsFor(s.name).at(-1)!.body.input)).toBe(0);
  });
});
