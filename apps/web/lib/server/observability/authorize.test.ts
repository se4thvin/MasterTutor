import { describe, expect, it } from "vitest";
import { decideObservability } from "./authorize.ts";

const PASSWORD = "v".repeat(40);

describe("/observability ForwardAuth decision (spec §12, Review Focus 4)", () => {
  it("sends a signed-out visitor to sign in, then to the entry route", () => {
    expect(decideObservability({ signedIn: false, role: null, viewerPassword: PASSWORD })).toEqual({
      kind: "sign_in",
      location: "/sign-in?next=%2Fapi%2Fobservability%2Fenter",
    });
  });

  it("refuses a member who is not the owner", () => {
    expect(
      decideObservability({ signedIn: true, role: "member", viewerPassword: PASSWORD }),
    ).toEqual({ kind: "forbidden" });
    expect(decideObservability({ signedIn: true, role: null, viewerPassword: PASSWORD })).toEqual({
      kind: "forbidden",
    });
  });

  it("is unavailable without a viewer password, and otherwise injects the viewer's credentials", () => {
    expect(
      decideObservability({ signedIn: true, role: "owner", viewerPassword: undefined }),
    ).toEqual({ kind: "unavailable" });
    expect(
      decideObservability({ signedIn: true, role: "owner", viewerPassword: PASSWORD }),
    ).toEqual({
      kind: "allow",
      authorization: `Basic ${Buffer.from(`viewer@mastertutor.internal:${PASSWORD}`).toString("base64")}`,
    });
  });
});
