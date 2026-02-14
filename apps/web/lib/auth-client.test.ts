import { describe, expect, it } from "vitest";
import { authErrorCopy } from "./auth-client.ts";

describe("authErrorCopy", () => {
  it("explains wrong credentials without blame", () => {
    expect(authErrorCopy({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      "That email and password don't match.",
    );
  });
  it("explains closed sign-up", () => {
    expect(authErrorCopy({ status: 403 })).toBe(
      "Sign-up is closed. Ask the workspace owner to invite you.",
    );
  });
  it("explains an existing account", () => {
    expect(authErrorCopy({ status: 422, code: "USER_ALREADY_EXISTS" })).toBe(
      "An account with this email already exists. Sign in instead.",
    );
  });
  it("falls back politely", () => {
    expect(authErrorCopy({ status: 500 })).toBe("Couldn't reach the server. Try again.");
  });
});
