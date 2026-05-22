import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { BEHAVIOUR_NEKO_ADMIN_SECRET, nekoBaseUrlForTests } from "./constants.ts";

const SLOT = "browser-1";
const base = nekoBaseUrlForTests(SLOT);

describe("n.eko chat is off (S4: the same-origin client renders no attacker-controlled text)", () => {
  it("announces chat as disabled and never broadcasts a chat message", async () => {
    const token = await loginNeko({
      baseUrl: base,
      username: "agent",
      password: deriveNekoPassword(BEHAVIOUR_NEKO_ADMIN_SECRET, SLOT),
    });
    const socket = new WebSocket(`${base.replace("http", "ws")}/api/ws?token=${token}`);
    const events: Array<{ event: string; payload?: unknown }> = [];
    socket.addEventListener("message", (message) => events.push(JSON.parse(String(message.data))));
    try {
      await waitFor(() => events.some((e) => e.event === "chat/init"), {
        label: "chat/init",
        timeoutMs: 10_000,
      });
      expect(events.find((e) => e.event === "chat/init")?.payload).toEqual({ enabled: false });
      // With chat on, n.eko echoes this to every member, the sender included.
      socket.send(JSON.stringify({ event: "chat/message", payload: { text: "<b>hi</b>" } }));
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(events.map((e) => e.event)).not.toContain("chat/message");
    } finally {
      socket.close();
    }
  });
});
