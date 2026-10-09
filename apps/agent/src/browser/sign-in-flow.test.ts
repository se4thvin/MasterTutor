import { describe, expect, it } from "vitest";
import { SIGN_IN_FLOW_ACTS, SIGN_IN_FLOW_MS, SignInFlow } from "./sign-in-flow.ts";

describe("SignInFlow (D51)", () => {
  it("is closed until a fill opens it, then closes after a few actions", () => {
    const flow = new SignInFlow(() => 0);
    expect(flow.isOpen).toBe(false);
    flow.acted();
    flow.open();
    for (let act = 0; act < SIGN_IN_FLOW_ACTS; act++) {
      expect(flow.isOpen).toBe(true);
      flow.acted();
    }
    expect(flow.isOpen).toBe(false);
  });

  it("each fill renews it; it never outlives its time bound", () => {
    let now = 0;
    const flow = new SignInFlow(() => now);
    flow.open();
    flow.acted();
    flow.open();
    flow.acted();
    flow.acted();
    expect(flow.isOpen).toBe(true);
    now = SIGN_IN_FLOW_MS;
    expect(flow.isOpen).toBe(false);
  });
});
