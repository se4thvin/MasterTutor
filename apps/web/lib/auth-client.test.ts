import { describe, expect, it } from "vitest";
import { authErrorCopy } from "./auth-client.ts";

const NEUTRAL =
  "Couldn't create the account. Sign-up may be closed, or this email may already be registered.";

describe("authErrorCopy", () => {
  it("explains wrong credentials without blame", () => {
    expect(authErrorCopy({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, "sign-in")).toBe(
      "That email and password don't match.",
    );
  });
  it("gives one answer for closed sign-up and an existing account", () => {
    expect(authErrorCopy({ status: 403 }, "sign-up")).toBe(NEUTRAL);
    expect(authErrorCopy({ status: 422, code: "USER_ALREADY_EXISTS" }, "sign-up")).toBe(NEUTRAL);
    expect(NEUTRAL).not.toMatch(/already exists/i);
  });
  it("does not talk about sign-up when sign-in is refused", () => {
    expect(authErrorCopy({ status: 403 }, "sign-in")).toBe("Couldn't sign in. Try again.");
  });
  it("asks for a longer password", () => {
    expect(authErrorCopy({ code: "PASSWORD_TOO_SHORT" }, "sign-up")).toBe(
      "Use at least 12 characters.",
    );
  });
  it("names the real failure: unexpected answers are not called a network problem (M14)", () => {
    for (const status of [400, 500]) {
      expect(authErrorCopy({ status }, "sign-up")).toBe("Couldn't create the account. Try again.");
    }
    expect(authErrorCopy({ status: 400, code: "INVALID_EMAIL" }, "sign-up")).toBe(
      "Enter a valid email address.",
    );
    for (const mode of ["sign-up", "sign-in"] as const) {
      expect(authErrorCopy({ status: 429 }, mode)).toBe(
        "Too many attempts. Wait a moment and try again.",
      );
      expect(authErrorCopy({ network: true }, mode)).toBe("Couldn't reach the server. Try again.");
    }
  });
});
