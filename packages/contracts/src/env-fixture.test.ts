import { describe, expect, it } from "vitest";
import { WebEnv, parseEnv } from "./env.ts";

const web = {
  DATABASE_URL: "postgres://web:pw@postgres:5432/mastertutor",
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  VAULT_PUBLIC_KEY: "y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=",
  NEKO_MEMBER_SECRET: "neko-member-secret-for-tests-0123456789",
  LIVE_COOKIE_SECRET: "live-cookie-secret-for-tests-0123456789",
  TURN_SECRET: "turn-secret-for-tests-0123456789abcdef",
  OPENAI_EMBEDDINGS_KEY: "sk-test",
  S3_ENDPOINT: "http://garage:3900",
  S3_ACCESS_KEY_ID: "GK66316f1f1bd64a571eb1b439",
  S3_SECRET_ACCESS_KEY: "16b2df8b12b3996e4916bd7de64631b3aa2704355137354988fcc6ac4cb1ab82",
};

describe("WEB_FIXTURE_API", () => {
  it("is off unless explicitly enabled", () => {
    expect(parseEnv(WebEnv, web).WEB_FIXTURE_API).toBe(false);
    expect(parseEnv(WebEnv, { ...web, WEB_FIXTURE_API: "1" }).WEB_FIXTURE_API).toBe(true);
  });
});
