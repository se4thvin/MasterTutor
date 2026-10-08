import { describe, expect, it } from "vitest";
import { pushConfigOf, vapidKeysOf } from "./config.ts";

const keys = { VAPID_PUBLIC_KEY: `B${"x".repeat(86)}`, VAPID_PRIVATE_KEY: "y".repeat(43) };

describe("push availability (spec §13.4 degradation)", () => {
  it("needs both keys and an https origin", () => {
    expect(pushConfigOf({ BETTER_AUTH_URL: "http://localhost:18080", ...keys })).toEqual({
      available: false,
      publicKey: null,
    });
    expect(pushConfigOf({ BETTER_AUTH_URL: "https://notes.example.org" })).toEqual({
      available: false,
      publicKey: null,
    });
    expect(pushConfigOf({ BETTER_AUTH_URL: "https://notes.example.org", ...keys })).toEqual({
      available: true,
      publicKey: keys.VAPID_PUBLIC_KEY,
    });
  });

  it("uses the https origin as the VAPID subject", () => {
    expect(
      vapidKeysOf({ BETTER_AUTH_URL: "https://notes.example.org/some/path", ...keys }),
    ).toEqual({
      publicKey: keys.VAPID_PUBLIC_KEY,
      privateKey: keys.VAPID_PRIVATE_KEY,
      subject: "https://notes.example.org",
    });
  });
});
