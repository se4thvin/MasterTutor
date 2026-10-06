import { describe, expect, it } from "vitest";
import { isLogoutLabel } from "./logout.ts";

describe("isLogoutLabel", () => {
  it("matches common sign-out controls", () => {
    for (const label of [
      "Log out",
      "Logout",
      "Sign out",
      "sign-off? no: Sign off",
      "ＬＯＧ ＯＵＴ",
      "Log\u200bout",
    ]) {
      expect(isLogoutLabel(label), label).toBe(true);
    }
  });
  it("does not match ordinary controls", () => {
    for (const label of ["Log in", "Sign in", "Logo", "Outbox", "Blog outline"])
      expect(isLogoutLabel(label), label).toBe(false);
  });
});
