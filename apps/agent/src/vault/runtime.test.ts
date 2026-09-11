import { FOCUSED_TARGET } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { resolveVaultTarget, type BrowserSession } from "./runtime.ts";

function session(objectId: string | null, options: { describeFails?: boolean } = {}) {
  const sent: string[] = [];
  const expressions: string[] = [];
  const cdp = {
    send: async (method: string, params: { objectId?: string }) => {
      sent.push(`${method} ${params.objectId ?? ""}`.trim());
      if (method === "Runtime.releaseObject") return {};
      if (method !== "DOM.describeNode") throw new Error(`unexpected ${method}`);
      if (options.describeFails) throw new Error("No node with given id found");
      return { node: { backendNodeId: 42 } };
    },
  };
  return {
    cdp,
    sent,
    expressions,
    session: {
      worlds: async () => ({
        evaluateHandle: async (expression: string) => {
          expressions.push(expression);
          return objectId;
        },
      }),
      cdp: async () => cdp,
    } as unknown as BrowserSession,
  };
}

/** Runs the focused-element page script against a stand-in document. */
function focusedIn(document: object, expression: string): unknown {
  return new Function("document", `return ${expression};`)(document);
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

describe('resolveVaultTarget("focused") (Phase 10)', () => {
  it("releases the focused element's remote handle once the node id is read (QA-065)", async () => {
    const fake = session("focus-1");
    expect(await resolveVaultTarget(fake.session, FOCUSED_TARGET)).toEqual({
      cdp: fake.cdp,
      backendNodeId: 42,
    });
    expect(fake.sent).toEqual(["DOM.describeNode focus-1", "Runtime.releaseObject focus-1"]);
  });
  it("releases the handle even when the node cannot be described (QA-065)", async () => {
    const fake = session("focus-2", { describeFails: true });
    await expect(resolveVaultTarget(fake.session, FOCUSED_TARGET)).rejects.toThrow();
    expect(fake.sent).toContain("Runtime.releaseObject focus-2");
  });
  it("never enters a focused frame, in HTML or XHTML documents (QA-066)", async () => {
    const fake = session(null);
    await resolveVaultTarget(fake.session, FOCUSED_TARGET);
    const [expression] = fake.expressions;
    const body = { localName: "body", tagName: "BODY" };
    const documentWith = (el: object) => ({ activeElement: el, body, documentElement: {} });
    // XHTML keeps tagName lowercase; localName is lowercase in both.
    for (const frame of [
      { localName: "iframe", tagName: "IFRAME" },
      { localName: "iframe", tagName: "iframe" },
      { localName: "frame", tagName: "frame" },
    ])
      expect(focusedIn(documentWith(frame), expression!), frame.tagName).toBeNull();
    const input = { localName: "input", tagName: "input" };
    expect(focusedIn(documentWith(input), expression!)).toBe(input);
  });
});
