import { describe, expect, it } from "vitest";
import { apiContract } from "./contract.ts";

describe("apiContract", () => {
  it("exposes the agreed routers and procedures", () => {
    const shape = Object.fromEntries(
      Object.entries(apiContract).map(([router, procedures]) => [
        router,
        Object.keys(procedures).sort(),
      ]),
    );
    expect(shape).toEqual({
      runs: [
        "cancel",
        "create",
        "decideApproval",
        "get",
        "handBack",
        "list",
        "openLive",
        "resume",
        "sendMessage",
        "setApprovalMode",
        "setCaptureBrief",
        "steps",
        "submitOtp",
        "takeControl",
      ],
      notes: ["delete", "export", "get", "list", "markVerified", "move", "search", "updateBlock"],
      folders: ["create", "delete", "move", "rename", "tree"],
      vault: ["audit", "create", "delete", "forgetSession", "list", "removeSecret", "setSecret"],
      settings: [
        "capturePreferences",
        "get",
        "setCapturePreference",
        "setKillSwitch",
        "update",
        "usage",
      ],
      assets: ["url"],
      benchmarks: ["create", "grade", "list", "runs", "start"],
      alerts: [
        "acknowledge",
        "active",
        "list",
        "pushConfig",
        "pushStatus",
        "subscribe",
        "unsubscribe",
      ],
    });
  });
});
