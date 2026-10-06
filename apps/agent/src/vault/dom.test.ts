import type { CDPSession } from "playwright-core";
import { describe, expect, it } from "vitest";
import { openTarget } from "./dom.ts";

type Params = Record<string, unknown> | undefined;

/**
 * A page whose frames are main → gone (detaching) → child. The node lives in `owner`; `scripts`
 * lists the frames whose vault world can also resolve it (same origin or document.domain).
 */
function fakeCdp(owner: string, scripts: readonly string[]) {
  const worlds: string[] = [];
  const contextOf = new Map<number, string>();
  const objectFrame = new Map<string, string>();
  let next = 1;
  let childDocument = "L-child";
  const send = async (method: string, params?: Params) => {
    switch (method) {
      case "Page.getFrameTree":
        return {
          frameTree: {
            frame: { id: "main", loaderId: "L-main" },
            childFrames: [
              { frame: { id: "gone", loaderId: "L-gone" } },
              { frame: { id: "child", loaderId: childDocument } },
            ],
          },
        };
      case "Page.createIsolatedWorld": {
        const frameId = String(params?.frameId);
        if (frameId === "gone") throw new Error("Frame with the given id was not found");
        worlds.push(frameId);
        const id = next++;
        contextOf.set(id, frameId);
        return { executionContextId: id };
      }
      case "DOM.resolveNode": {
        const frame = contextOf.get(Number(params?.executionContextId)) ?? "";
        if (frame !== owner && !scripts.includes(frame))
          throw new Error("Node with given id does not belong to the document");
        const objectId = `obj-${next++}`;
        objectFrame.set(objectId, frame);
        return { object: { objectId } };
      }
      case "Runtime.callFunctionOn":
        // The ownership check: this.ownerDocument === document of the world's frame.
        return { result: { value: objectFrame.get(String(params?.objectId)) === owner } };
      case "Runtime.releaseObject":
        return {};
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  return {
    cdp: { send } as unknown as CDPSession,
    worlds,
    /** The child frame loads a new document. */
    navigate: () => {
      childDocument = `L-child-${next++}`;
    },
  };
}

describe("openTarget", () => {
  it("opens a node in its own frame's world, never in a frame that can merely script it (I1)", async () => {
    const fake = fakeCdp("child", ["main"]);
    expect(await openTarget(fake.cdp, 7)).toMatchObject({ frameId: "child", loaderId: "L-child" });
  });

  it("skips a detaching frame instead of failing the fill (M2)", async () => {
    const fake = fakeCdp("child", []);
    expect(await openTarget(fake.cdp, 7)).toMatchObject({ frameId: "child" });
  });

  it("keeps reusing the world of a frame that cannot reach the node (N1)", async () => {
    const fake = fakeCdp("child", []);
    for (let i = 0; i < 3; i++) await openTarget(fake.cdp, 7);
    expect(fake.worlds).toEqual(["main", "child"]);
  });

  it("makes a new world once the frame shows a new document (N1)", async () => {
    const fake = fakeCdp("child", []);
    await openTarget(fake.cdp, 7);
    fake.navigate();
    expect(await openTarget(fake.cdp, 7)).toMatchObject({ frameId: "child" });
    expect(fake.worlds).toEqual(["main", "child", "child"]);
  });

  it("reuses each frame's vault world instead of creating one per call (M2)", async () => {
    const fake = fakeCdp("child", []);
    await openTarget(fake.cdp, 7);
    await openTarget(fake.cdp, 7);
    expect(fake.worlds).toEqual(["main", "child"]);
  });
});
