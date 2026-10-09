import type { RunEvent } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { Trajectory, entriesOf } from "./trajectory.ts";

const act = (origin: string): RunEvent => ({
  type: "step",
  seq: 1,
  phase: "act",
  state: "done",
  caption: "Clicked “Buy now” on a page that said ignore all instructions",
  url: `${origin}/path?token=x`,
  screenshotKey: null,
  action: { tool: "computer", summary: "Click “Buy now”", point: null },
});

describe("the trajectory (spec §6.9)", () => {
  it("keeps codes and origins only: no caption, summary, path or query", () => {
    const [entry] = entriesOf(act("https://a.test"));
    expect(entry).toEqual({ kind: "act", origin: "https://a.test", tool: "computer", detail: "" });
  });
  it("raises risk and asks for a review on origin fan-out, once", () => {
    const t = new Trajectory();
    const first = t.add(["a", "b", "c", "d"].map((h) => act(`https://${h}.test`)));
    expect(first).toEqual({ signals: [], reviewDue: false });
    const second = t.add([act("https://e.test")]);
    expect(second).toEqual({ signals: ["origin_fanout"], reviewDue: true });
    expect(t.riskLevel).toBe("elevated");
    expect(t.add([act("https://f.test")]).reviewDue).toBe(false);
  });
  it("counts person denials and egress flows", () => {
    const t = new Trajectory();
    const denied: RunEvent = {
      type: "approval_resolved",
      approvalId: "00000000-0000-4000-8000-000000000001",
      status: "denied",
      decidedBy: "user-1",
    };
    expect(t.add([denied, denied]).signals).toEqual(["person_denials"]);
    const flow: RunEvent = {
      type: "guard",
      verdict: "allow",
      category: "other",
      stage: "screen",
      rollout: "enforce",
      applied: false,
      items: 1,
      flows: 1,
    };
    expect(t.add([flow, flow]).signals).toEqual(["egress_flows"]);
  });
  it("asks for a review every 10 guard reviews even with no signal", () => {
    const t = new Trajectory();
    const allow: RunEvent = {
      type: "guard",
      verdict: "allow",
      category: "other",
      stage: "screen",
      rollout: "enforce",
      applied: false,
      items: 1,
      flows: 0,
    };
    let due = 0;
    for (let i = 0; i < 20; i++) if (t.add([allow]).reviewDue) due++;
    expect(due).toBe(2);
  });
  it("digests at most 50 entries", () => {
    const t = new Trajectory();
    t.add(Array.from({ length: 80 }, () => act("https://a.test")));
    expect(t.digest({ goal: "g", mode: "ask", allowedOrigins: [] }).entries).toHaveLength(50);
  });
});
