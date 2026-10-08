import { afterEach, describe, expect, it, vi } from "vitest";
import { authCookie } from "./app-client.ts";

afterEach(() => vi.unstubAllGlobals());

describe("authCookie on a CI slot (D48)", () => {
  it("posts to the slot's port but sends the app's own origin", async () => {
    const fetch = vi.fn(
      async () => new Response("{}", { status: 200, headers: { "set-cookie": "s=1; Path=/" } }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await authCookie(
        "http://localhost:20080",
        "a@b.test",
        "p",
        "sign-in",
        "http://localhost:18080",
      ),
    ).toBe("s=1");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:20080/api/auth/sign-in/email",
      expect.objectContaining({
        headers: expect.objectContaining({ origin: "http://localhost:18080" }),
      }),
    );
  });
});
