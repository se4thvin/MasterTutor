import { describe, expect, it } from "vitest";
import { resolveVaultTarget, type BrowserSession } from "./runtime.ts";

function session(objectId: string | null) {
  const cdp = {
    send: async (method: string) => {
      if (method !== "DOM.describeNode") throw new Error(`unexpected ${method}`);
      return { node: { backendNodeId: 42 } };
    },
  };
  return {
    cdp,
    session: {
      worlds: async () => ({ evaluateHandle: async () => objectId }),
      cdp: async () => cdp,
    } as unknown as BrowserSession,
  };
}

describe("resolveVaultTarget (F13)", () => {
  it("maps a live read_page ref to the page session's node", async () => {
    const fake = session("obj-1");
    expect(await resolveVaultTarget(fake.session, "e3")).toEqual({
      cdp: fake.cdp,
      backendNodeId: 42,
    });
  });
  it("maps a stale ref to null", async () => {
    expect(await resolveVaultTarget(session(null).session, "e3")).toBeNull();
  });
});
