import { describe, expect, it } from "vitest";
import { authorizeLive, type AuthorizeDeps } from "./authorize.ts";
import { signLiveSlot } from "./cookie.ts";

const secret = "live-cookie-secret-for-tests-0123456789";
const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const userId = "user_a";
const now = 1_700_000_000;
const SESSION = "better-auth.session_token=s3cr3t";
const NEKO = "NEKO_SESSION=tok123";
const slotCookie = (slotName: string, forRun = runId, forUser = userId) =>
  `live_slot=${signLiveSlot(secret, { slotName, runId: forRun, userId: forUser, expiresAt: now + 600 })}`;

function deps(leased: Record<string, string>): AuthorizeDeps & { queries: unknown[] } {
  const queries: unknown[] = [];
  return {
    queries,
    liveCookieSecret: secret,
    nowSeconds: () => now,
    canAccess: async (q) => {
      queries.push(q);
      return leased[q.slotName] === q.runId && q.userId === userId;
    },
  };
}

const input = (cookies: string[], uri = `/live/${runId}/api/ws`, user: string | null = userId) => ({
  forwardedUri: uri,
  cookieHeader: cookies.join("; ") || null,
  userId: user,
});

describe("authorizeLive (spec §10.2.2, §12 live-view auth)", () => {
  it("allows a signed cookie for the leased slot and forwards only NEKO_SESSION upstream", async () => {
    const d = deps({ "browser-1": runId });
    const decision = await authorizeLive(d, input([SESSION, slotCookie("browser-1"), NEKO]));
    expect(decision).toEqual({ allow: true, upstreamCookie: NEKO });
    expect(JSON.stringify(decision)).not.toContain("better-auth");
    expect(JSON.stringify(decision)).not.toContain("live_slot");
    expect(d.queries).toEqual([{ runId, slotName: "browser-1", userId }]);
  });

  it("refuses a request without an n.eko session, so the Better Auth cookie never reaches n.eko (S3)", async () => {
    const d = deps({ "browser-1": runId });
    expect(await authorizeLive(d, input([SESSION, slotCookie("browser-1")]))).toEqual({
      allow: false,
      status: 401,
    });
    expect(d.queries).toEqual([]);
  });

  it("refuses duplicate or malformed n.eko sessions", async () => {
    const d = deps({ "browser-1": runId });
    for (const neko of [
      [NEKO, "NEKO_SESSION=other"],
      ["NEKO_SESSION=a\r\nX: y"],
      ["NEKO_SESSION="],
      [`NEKO_SESSION=${"a".repeat(257)}`],
    ]) {
      expect(
        await authorizeLive(d, input([SESSION, slotCookie("browser-1"), ...neko])),
        neko.join("; "),
      ).toEqual({ allow: false, status: 401 });
    }
    expect(d.queries).toEqual([]);
  });

  it("rejects no session, bad paths, missing or forged slot cookies", async () => {
    const d = deps({ "browser-1": runId });
    const valid = slotCookie("browser-1");
    expect(await authorizeLive(d, input([valid, NEKO], undefined, null))).toEqual({
      allow: false,
      status: 401,
    });
    expect(await authorizeLive(d, input([valid, NEKO], "/api/auth/session"))).toEqual({
      allow: false,
      status: 403,
    });
    expect(await authorizeLive(d, input([NEKO]))).toEqual({ allow: false, status: 401 });
    const forged = valid.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(await authorizeLive(d, input([forged, NEKO]))).toEqual({ allow: false, status: 401 });
    expect(await authorizeLive(d, input([slotCookie("browser-1", runId, "user_b"), NEKO]))).toEqual(
      {
        allow: false,
        status: 401,
      },
    );
    expect(d.queries).toEqual([]);
  });

  it("rejects duplicate live_slot cookies so Traefik and auth can never disagree", async () => {
    const d = deps({ "browser-1": runId });
    expect(
      await authorizeLive(
        d,
        input([slotCookie("browser-1"), "live_slot=browser-2.1700000600.x", NEKO]),
      ),
    ).toEqual({ allow: false, status: 401 });
    expect(d.queries).toEqual([]);
  });

  it("rejects a slot leased to another run, an idle slot or a stale cookie", async () => {
    expect(
      await authorizeLive(
        deps({ "browser-1": "other-run" }),
        input([slotCookie("browser-1"), NEKO]),
      ),
    ).toEqual({ allow: false, status: 403 });
    expect(await authorizeLive(deps({}), input([slotCookie("browser-2"), NEKO]))).toEqual({
      allow: false,
      status: 403,
    });
  });
});
