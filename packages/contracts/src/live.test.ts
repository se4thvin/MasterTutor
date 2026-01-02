import { describe, expect, it } from "vitest";
import { OpenLiveResult, liveEmbedPath, livePath } from "./live.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("live view contracts", () => {
  it("builds per-run paths", () => {
    expect(livePath(runId)).toBe(`/live/${runId}/`);
    expect(liveEmbedPath(runId)).toBe(`/live/${runId}/?embed=1`);
    expect(() => livePath("../etc")).toThrow();
    expect(livePath(runId.toUpperCase())).toBe(`/live/${runId}/`);
  });
  it("parses both openLive shapes", () => {
    expect(OpenLiveResult.parse({ sleeping: true })).toEqual({ sleeping: true });
    const awake = OpenLiveResult.parse({
      sleeping: false,
      slotName: "browser-3",
      embedPath: liveEmbedPath(runId),
      iceServers: [
        { urls: ["turn:turn.example.com:3478"], username: "1700000000:run", credential: "x" },
      ],
    });
    expect(awake.sleeping).toBe(false);
  });
  it("rejects embed paths that are not per-run live paths", () => {
    expect(
      OpenLiveResult.safeParse({
        sleeping: false,
        slotName: "browser-1",
        embedPath: "/admin",
        iceServers: [],
      }).success,
    ).toBe(false);
  });
});
