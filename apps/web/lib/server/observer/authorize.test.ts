import { describe, expect, it } from "vitest";
import { decideObserverAccess } from "./authorize.ts";

const TOKEN = "t".repeat(48);
const WS = "6f2c8a3e-0000-4000-8000-00000000000a";
describe("ForwardAuth for /api/observer/* (spec §7.2)", () => {
  it("refuses the signed-out, a non-owner member, and a server without a token", () => {
    expect(
      decideObserverAccess({ userId: null, workspaceId: null, owner: false, token: TOKEN }),
    ).toEqual({ kind: "refuse", status: 401 });
    expect(
      decideObserverAccess({ userId: "u1", workspaceId: WS, owner: false, token: TOKEN }),
    ).toEqual({ kind: "refuse", status: 403 });
    expect(
      decideObserverAccess({ userId: "u1", workspaceId: WS, owner: true, token: undefined }),
    ).toEqual({ kind: "refuse", status: 503 });
  });
  it("gives the owner the bearer, identity headers and a cookie that replaces the session", () => {
    expect(
      decideObserverAccess({ userId: "u1", workspaceId: WS, owner: true, token: TOKEN }),
    ).toEqual({
      kind: "allow",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        cookie: "mt_observer=1",
        "x-mt-user": "u1",
        "x-mt-workspace": WS,
        "cache-control": "no-store",
      },
    });
  });
});
