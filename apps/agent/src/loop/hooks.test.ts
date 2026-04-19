import { describe, expect, it } from "vitest";
import type { RegisteredTool } from "../tools/types.ts";
import { composeRunHooks, withHooks, type LeasedSlot } from "./hooks.ts";

const slot: LeasedSlot = {
  runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  slotName: "browser-1",
  session: null,
  browserCdp: () => Promise.reject(new Error("unused")),
};

describe("composeRunHooks", () => {
  it("runs every onLeased and onLeaseEnding in order, and merges tools and prompt context", async () => {
    const calls: string[] = [];
    const hooks = withHooks(
      composeRunHooks(
        {
          onLeased: async () => void calls.push("a leased"),
          onLeaseEnding: async () => void calls.push("a ending"),
          promptContext: async () => ["Saved sign-ins: zybooks"],
        },
        {
          onLeased: async () => void calls.push("b leased"),
          onLeaseEnding: async () => void calls.push("b ending"),
          promptContext: async () => ["Live view: open"],
        },
      ),
    );
    await hooks.onLeased(slot);
    await hooks.onLeaseEnding({ runId: slot.runId, slotName: "browser-1", slotReleased: true });
    expect(calls).toEqual(["a leased", "b leased", "a ending", "b ending"]);
    expect(await hooks.promptContext({} as never)).toEqual([
      "Saved sign-ins: zybooks",
      "Live view: open",
    ]);
  });

  it("still runs later onLeaseEnding hooks when an earlier one throws", async () => {
    const calls: string[] = [];
    const hooks = composeRunHooks(
      { onLeaseEnding: async () => Promise.reject(new Error("boom")) },
      { onLeaseEnding: async () => void calls.push("b ending") },
    );
    await expect(
      hooks.onLeaseEnding!({ runId: slot.runId, slotName: "browser-1", slotReleased: true }),
    ).rejects.toThrow("boom");
    expect(calls).toEqual(["b ending"]);
  });

  it("keeps B3's onReleased(runId) single-owner and passes it through unchanged", async () => {
    const released: string[] = [];
    const onReleased = async (runId: string) => void released.push(runId);
    await composeRunHooks({ onReleased }, { onLeaseEnding: async () => undefined }).onReleased!(
      slot.runId,
    );
    expect(released).toEqual([slot.runId]);
    expect(() => composeRunHooks({ onReleased }, { onReleased })).toThrow(/onReleased/);
  });

  it("refuses two owners of a single-owner hook, and two owners of one tool name", () => {
    const control = {
      onUserControl: async () => ({ ok: true }) as const,
      onAgentControl: async () => undefined,
    };
    expect(() => composeRunHooks({ control }, { control })).toThrow(/control/);
    // B3: tools register their own approval (RunHooks.functionApproval is gone).
    const t: RegisteredTool = {
      name: "read_page",
      untrusted: true,
      invoke: async () => ({}),
      approval: async () => null,
    };
    expect(() => composeRunHooks({ functionTools: [t] }, { functionTools: [t] })).toThrow(
      /more than one owner/,
    );
  });
});
