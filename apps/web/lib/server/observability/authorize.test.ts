import { describe, expect, it } from "vitest";
import { decideObservability, obsSessionCookie, readObsSession } from "./authorize.ts";

const PASSWORD = "v".repeat(40);
const SIGN_IN = "/sign-in?next=%2Fobservability";

describe("/observability decision (spec §12, Review Focus 4)", () => {
  it("sends someone without a session to sign in", () => {
    expect(
      decideObservability({ userId: null, owner: false, viewerPassword: PASSWORD }, SIGN_IN),
    ).toEqual({ kind: "sign_in", location: SIGN_IN });
  });

  it("refuses anyone who is not the signed-in owner", () => {
    expect(
      decideObservability({ userId: "u", owner: false, viewerPassword: PASSWORD }, SIGN_IN),
    ).toEqual({ kind: "forbidden" });
  });

  it("is unavailable without a viewer password, and otherwise carries the viewer's credentials", () => {
    expect(
      decideObservability({ userId: "u", owner: true, viewerPassword: undefined }, SIGN_IN),
    ).toEqual({ kind: "unavailable" });
    expect(
      decideObservability({ userId: "u", owner: true, viewerPassword: PASSWORD }, SIGN_IN),
    ).toEqual({
      kind: "allow",
      userId: "u",
      authorization: `Basic ${Buffer.from(`viewer@mastertutor.internal:${PASSWORD}`).toString("base64")}`,
    });
  });
});

describe("the obs-host session cookie", () => {
  it("is host-only (no Domain), HttpOnly, SameSite=Strict, and Secure on https", () => {
    const cookie = obsSessionCookie("tok.en", { secure: true });
    expect(cookie).toBe(
      "mt_obs_session=tok.en; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict; Secure",
    );
    expect(cookie).not.toMatch(/domain=/i);
    expect(obsSessionCookie("tok.en", { secure: false })).not.toMatch(/Secure/);
  });

  it("is read only when it appears exactly once", () => {
    expect(readObsSession("a=1; mt_obs_session=tok.en")).toBe("tok.en");
    expect(readObsSession("mt_obs_session=a; mt_obs_session=b")).toBeNull();
    expect(readObsSession(null)).toBeNull();
  });
});
