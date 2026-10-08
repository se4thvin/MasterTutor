import type { CDPSession } from "playwright-core";
import { describe, expect, it } from "vitest";
import { opaqueFrameBoxes } from "./region-capture.ts";

/** A page target whose one cross-origin frame owner cannot be measured (stale node, CDP error). */
function fakeCdp(): CDPSession {
  return {
    send: async (method: string) => {
      if (method === "DOM.getDocument")
        return {
          root: {
            backendNodeId: 1,
            nodeName: "#document",
            documentURL: "https://a.example/",
            children: [{ backendNodeId: 7, nodeName: "IFRAME", attributes: [] }],
          },
        };
      throw new Error(`${method} failed`);
    },
  } as unknown as CDPSession;
}

describe("opaqueFrameBoxes (Task 0 re-review N3)", () => {
  it("counts an owner it cannot measure as unverifiable, never as absent", async () => {
    expect(await opaqueFrameBoxes(fakeCdp(), { x: 0, y: 0 })).toEqual({
      boxes: [],
      unverifiable: 1,
    });
  });
});
