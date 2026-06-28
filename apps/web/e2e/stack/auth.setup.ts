import { expect, test as setup } from "@playwright/test";
import { AUTH_STATE, BASE_URL, OWNER } from "./support/env.ts";

setup("owner session", async ({ request }) => {
  const headers = { origin: BASE_URL };
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers,
    data: OWNER,
    failOnStatusCode: false,
  });
  if (signUp.status() !== 200) {
    // A kept stack (KEEP_STACK=1) already has the owner: Better Auth answers 422 for the existing
    // email, and 403 once sign-up has closed after the first user (Phase 0). Sign in instead.
    expect([403, 422]).toContain(signUp.status());
    const signIn = await request.post("/api/auth/sign-in/email", {
      headers,
      data: { email: OWNER.email, password: OWNER.password },
    });
    expect(signIn.ok()).toBe(true);
  }
  await request.storageState({ path: AUTH_STATE });
});
