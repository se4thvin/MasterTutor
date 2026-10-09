import { describe, expect, it } from "vitest";
import { authorize } from "./auth.ts";

const TOKEN = "t".repeat(48);
const WS = "6f2c8a3e-0000-4000-8000-00000000000a";
describe("observer request auth (spec §7.1)", () => {
  it("fails closed without a configured token or with duplicate identity headers", () => {
    expect(
      authorize({ authorization: "Bearer ", "x-mt-user": "user_abc", "x-mt-workspace": WS }, ""),
    ).toBeNull();
    expect(
      authorize(
        {
          authorization: `Bearer ${TOKEN}`,
          "x-mt-user": ["user_abc", "user_other"],
          "x-mt-workspace": WS,
        },
        TOKEN,
      ),
    ).toBeNull();
  });
  it("accepts only ForwardAuth's bearer with a user and workspace", () => {
    expect(
      authorize(
        { authorization: `Bearer ${TOKEN}`, "x-mt-user": "user_abc", "x-mt-workspace": WS },
        TOKEN,
      ),
    ).toEqual({ userId: "user_abc", workspaceId: WS });
    expect(
      authorize(
        {
          authorization: `Bearer ${"x".repeat(48)}`,
          "x-mt-user": "user_abc",
          "x-mt-workspace": WS,
        },
        TOKEN,
      ),
    ).toBeNull();
    expect(authorize({ "x-mt-user": "user_abc", "x-mt-workspace": WS }, TOKEN)).toBeNull();
    expect(
      authorize(
        { authorization: `Bearer ${TOKEN}`, "x-mt-user": "observer", "x-mt-workspace": WS },
        TOKEN,
      ),
    ).toBeNull();
    expect(
      authorize(
        { authorization: `Bearer ${TOKEN}`, "x-mt-user": "user_abc", "x-mt-workspace": "nope" },
        TOKEN,
      ),
    ).toBeNull();
  });
});
