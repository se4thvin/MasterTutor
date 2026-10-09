import { describe, expect, it } from "vitest";
import { PUSH_HINTS, base64UrlToBytes, phoneAlertState, pushSupport } from "./push-support.ts";

const ready = {
  secureContext: true,
  standalone: true,
  iOS: true,
  hasPush: true,
  config: { available: true, publicKey: "B" },
};

describe("pushSupport (spec §13.4)", () => {
  it("explains each state in order", () => {
    expect(pushSupport({ ...ready, secureContext: false })).toBe("insecure");
    expect(pushSupport({ ...ready, standalone: false })).toBe("ios_install");
    expect(pushSupport({ ...ready, iOS: false, standalone: false, hasPush: false })).toBe(
      "unsupported",
    );
    expect(pushSupport({ ...ready, config: { available: false, publicKey: null } })).toBe(
      "unavailable",
    );
    expect(pushSupport(ready)).toBe("ready");
    expect(pushSupport({ ...ready, iOS: false, standalone: false })).toBe("ready");
  });

  it("says what to do, in plain words", () => {
    expect(PUSH_HINTS.insecure).toBe(
      "Phone alerts need the deployed HTTPS site. Alerts still appear here in the app.",
    );
    expect(PUSH_HINTS.ios_install).toBe(
      "On iPhone, add MasterTutor to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on phone alerts.",
    );
    expect(PUSH_HINTS.unavailable).toBe("Phone alerts aren't set up on this server.");
  });
});

describe("base64UrlToBytes", () => {
  it("decodes an unpadded base64url VAPID key to its 65 bytes", () => {
    const raw = Buffer.alloc(65, 0xfb);
    raw[0] = 4;
    expect(Buffer.from(base64UrlToBytes(raw.toString("base64url")))).toEqual(raw);
  });
});

describe("phoneAlertState (review I-3)", () => {
  const sub = () => {
    const calls: string[] = [];
    return {
      calls,
      value: {
        endpoint: "https://web.push.apple.com/a",
        unsubscribe: async () => (calls.push("unsubscribe"), true),
      },
    };
  };

  it("is off without a browser subscription, and on while the server holds it", async () => {
    expect(await phoneAlertState({ subscription: null, registered: async () => true })).toBe("off");
    const held = sub();
    expect(await phoneAlertState({ subscription: held.value, registered: async () => true })).toBe(
      "on",
    );
    expect(held.calls).toEqual([]);
  });

  it("says stopped and drops the dead subscription once a push service removed it (404/410)", async () => {
    const dropped = sub();
    expect(
      await phoneAlertState({ subscription: dropped.value, registered: async () => false }),
    ).toBe("stopped");
    expect(dropped.calls).toEqual(["unsubscribe"]);
    expect(PUSH_HINTS.stopped).toBe(
      "Phone alerts stopped on this device. Turn them on again to keep getting them.",
    );
  });

  it("does nothing destructive when the server can't be asked", async () => {
    const unknown = sub();
    expect(
      await phoneAlertState({
        subscription: unknown.value,
        registered: async () => {
          throw new TypeError("offline");
        },
      }),
    ).toBe("on");
    expect(unknown.calls).toEqual([]);
  });
});
