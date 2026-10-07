import { describe, expect, it } from "vitest";
import { NekoApiError, type NekoAdmin } from "./neko-admin.ts";
import { LiveViewError, createNekoLiveView } from "./neko-live-view.ts";

function fakeAdmin(script: { connectedAfterPolls: number; giveFails404?: boolean }) {
  const calls: string[] = [];
  let polls = 0;
  const admin: NekoAdmin = {
    async request(_slot, method, path, body) {
      calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
      if (path === "/api/sessions") {
        polls += 1;
        const connected = polls > script.connectedAfterPolls;
        return [
          { id: "agent", state: { is_connected: false } },
          { id: "user", state: { is_connected: connected } },
        ];
      }
      if (path === "/api/room/control/give/user" && script.giveFails404)
        throw new NekoApiError(404, path);
      return null;
    },
  };
  return { admin, calls };
}

const slot = { name: "browser-2" };

describe("NekoLiveView", () => {
  it("waits for the user's live view to connect, then grants hosting and gives control", async () => {
    const { admin, calls } = fakeAdmin({ connectedAfterPolls: 2 });
    await createNekoLiveView({ admin, retryDelayMs: 1 }).giveControl(slot, "user_1");
    expect(calls).toEqual([
      "GET /api/sessions",
      "GET /api/sessions",
      "GET /api/sessions",
      'POST /api/members/user {"can_host":true}',
      "POST /api/room/control/give/user",
    ]);
  });

  it("never grants hosting when the live view does not connect in time", async () => {
    const { admin, calls } = fakeAdmin({ connectedAfterPolls: 1_000 });
    const view = createNekoLiveView({ admin, giveTimeoutMs: 30, retryDelayMs: 5 });
    const error = await view.giveControl(slot, "user_1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveViewError);
    expect((error as LiveViewError).code).toBe("user_not_connected");
    expect(calls.some((c) => c.startsWith("POST /api/members/user"))).toBe(false);
  });

  it("revokes hosting again if the session vanished between the check and the give", async () => {
    const { admin, calls } = fakeAdmin({ connectedAfterPolls: 0, giveFails404: true });
    await expect(createNekoLiveView({ admin }).giveControl(slot, "user_1")).rejects.toBeInstanceOf(
      LiveViewError,
    );
    expect(calls.at(-1)).toBe('POST /api/members/user {"can_host":false}');
  });

  it("takes control as the agent before revoking the user's hosting right", async () => {
    const { admin, calls } = fakeAdmin({ connectedAfterPolls: 0 });
    const view = createNekoLiveView({ admin });
    await view.takeControl(slot);
    await view.setClipboardAccess(slot, true);
    expect(calls).toEqual([
      "POST /api/room/control/take",
      'POST /api/members/user {"can_host":false}',
      'POST /api/members/user {"can_access_clipboard":true}',
    ]);
  });
});
