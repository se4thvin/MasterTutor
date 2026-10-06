import { describe, expect, it } from "vitest";
import { deriveNekoPassword } from "./neko.ts";

describe("deriveNekoPassword", () => {
  it("matches the slot entrypoint (openssl dgst -sha256 -hmac)", () => {
    // printf '%s' browser-1 | openssl dgst -sha256 -hmac 'neko-admin-secret-for-tests-0123456789' -r
    expect(deriveNekoPassword("neko-admin-secret-for-tests-0123456789", "browser-1")).toBe(
      "a35f74afd3da16d9602bfa17a0637d2a482e320a6d90af6600987626cd6c9ef6",
    );
  });
  it("rejects bad slot names and short secrets", () => {
    expect(() => deriveNekoPassword("neko-admin-secret-for-tests-0123456789", "web")).toThrow();
    expect(() => deriveNekoPassword("short", "browser-1")).toThrow();
  });
});
