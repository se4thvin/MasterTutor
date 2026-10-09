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
    // A kept stack (KEEP_STACK=1) already has the owner, so sign-up is closed (Phase 0). Closed
    // sign-up answers 403 for every email, registered or not (no enumeration). Sign in instead.
    expect(signUp.status()).toBe(403);
    const signIn = await request.post("/api/auth/sign-in/email", {
      headers,
      data: { email: OWNER.email, password: OWNER.password },
    });
    expect(signIn.ok()).toBe(true);
  }
  await request.storageState({ path: AUTH_STATE });
});
