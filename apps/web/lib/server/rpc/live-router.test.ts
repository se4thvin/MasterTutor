import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { liveRouter } from "./live-router.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("liveRouter live-view procedures", () => {
  it("require a signed-in viewer (typed UNAUTHORIZED, never a bare 401)", async () => {
    const client = createRouterClient(liveRouter, { context: { viewer: null } });
    await expect(client.runs.openLive({ runId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(client.runs.takeControl({ runId })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(client.runs.handBack({ runId, note: null })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("caps the hand-back note at 4,000 characters before it reaches the database", async () => {
    const viewer = { id: "user_a", name: "A", email: "a@example.test" };
    const client = createRouterClient(liveRouter, { context: { viewer } });
    await expect(client.runs.handBack({ runId, note: "x".repeat(4_001) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
