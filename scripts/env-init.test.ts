import { Base64Key32, DbPassword, GarageKeyId, GarageSecret } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { ENV_DEFAULTS, fillEnv, generateSecrets } from "./env-init.ts";

describe("generateSecrets", () => {
  it("produces values that satisfy the env contracts", () => {
    const s = generateSecrets();
    for (const key of ["POSTGRES_PASSWORD", "WEB_DB_PASSWORD", "AGENT_DB_PASSWORD"]) {
      expect(DbPassword.safeParse(s[key]).success, key).toBe(true);
    }
    for (const key of ["S3_WEB_ACCESS_KEY_ID", "S3_AGENT_ACCESS_KEY_ID"]) {
      expect(GarageKeyId.safeParse(s[key]).success, key).toBe(true);
    }
    for (const key of [
      "S3_WEB_SECRET_ACCESS_KEY",
      "S3_AGENT_SECRET_ACCESS_KEY",
      "GARAGE_RPC_SECRET",
    ]) {
      expect(GarageSecret.safeParse(s[key]).success, key).toBe(true);
    }
    expect(Base64Key32.safeParse(s.VAULT_PUBLIC_KEY).success).toBe(true);
    expect(Base64Key32.safeParse(s.VAULT_PRIVATE_KEY).success).toBe(true);
    for (const key of [
      "BETTER_AUTH_SECRET",
      "NEKO_ADMIN_SECRET",
      "NEKO_MEMBER_SECRET",
      "LIVE_COOKIE_SECRET",
      "TURN_SECRET",
      "GARAGE_ADMIN_TOKEN",
    ]) {
      expect(s[key]!.length, key).toBeGreaterThanOrEqual(32);
    }
  });
});

describe("fillEnv", () => {
  const generated = { ...generateSecrets() };

  it("never touches existing values, fills empty ones and appends missing ones", () => {
    const existing =
      "OPENAI_API_KEY=sk-real\nPOSTGRES_PASSWORD=\nNEKO_ADMIN_SECRET=keep-me-keep-me-keep-me-keep-me-1\n";
    const result = fillEnv(existing, generated);
    expect(result.text).toContain("OPENAI_API_KEY=sk-real\n");
    expect(result.text).toContain("NEKO_ADMIN_SECRET=keep-me-keep-me-keep-me-keep-me-1\n");
    expect(result.text).toContain(`POSTGRES_PASSWORD=${generated.POSTGRES_PASSWORD}\n`);
    expect(result.text).toContain(`BROWSER_SLOTS=${ENV_DEFAULTS.BROWSER_SLOTS}`);
    expect(result.filled).toContain("POSTGRES_PASSWORD");
    expect(result.filled).not.toContain("NEKO_ADMIN_SECRET");
    expect(result.missingManual).toEqual(["OPENAI_EMBEDDINGS_KEY"]);
  });

  it("is a no-op the second time", () => {
    const once = fillEnv("", generated).text;
    expect(fillEnv(once, generateSecrets()).text).toBe(once);
  });

  it("refuses a half-present vault key pair", () => {
    expect(() =>
      fillEnv("VAULT_PUBLIC_KEY=y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=\n", generated),
    ).toThrow(/VAULT_PUBLIC_KEY and VAULT_PRIVATE_KEY/);
  });
});
