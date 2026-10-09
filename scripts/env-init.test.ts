import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import {
  Base64Key32,
  DbPassword,
  GarageKeyId,
  GarageSecret,
  ObservabilityInitEnv,
} from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { ENV_DEFAULTS, fillEnv, generateSecrets, resolveOutPath } from "./env-init.ts";
import { vapidPairMatches } from "./lib/vapid.ts";

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
      "GARAGE_ADMIN_TOKEN",
    ]) {
      expect(s[key]!.length, key).toBeGreaterThanOrEqual(32);
    }
  });
  it("generates no TURN secret (D42)", () => {
    expect(generateSecrets()).not.toHaveProperty("TURN_SECRET");
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
    expect(result.missingManual).toEqual([]);
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

describe("resolveOutPath (P9-18)", () => {
  const root = "/repo";
  const ignored = new Set([
    "/repo/.env",
    "/repo/.env.tmp",
    "/repo/.env.bench",
    "/repo/.env.bench.tmp",
  ]);
  const isIgnored = (path: string) => ignored.has(path);

  it("defaults to the root .env", () => {
    expect(resolveOutPath([], root, isIgnored, "/repo")).toBe("/repo/.env");
  });
  it("writes a git-ignored file inside the repo", () => {
    expect(resolveOutPath(["--out", ".env.bench"], root, isIgnored, "/repo")).toBe(
      "/repo/.env.bench",
    );
  });
  it("writes a file outside the repo", () => {
    expect(resolveOutPath(["--out", "/secure/prod.env"], root, isIgnored, "/repo")).toBe(
      "/secure/prod.env",
    );
  });
  it("refuses a path git would track", () => {
    expect(() => resolveOutPath(["--out", ".env.example"], root, isIgnored, "/repo")).toThrow(
      /git would track/,
    );
    expect(() => resolveOutPath(["--out", "apps/x.env"], root, isIgnored, "/repo/apps/..")).toThrow(
      /git would track/,
    );
  });
  it("refuses a target whose temporary file git would track (review minor)", () => {
    const onlyTarget = (path: string) => path === "/repo/.env.bench";
    expect(() => resolveOutPath(["--out", ".env.bench"], root, onlyTarget, "/repo")).toThrow(
      /git would track/,
    );
  });
  it("refuses unknown arguments and positionals", () => {
    expect(() => resolveOutPath(["--force"], root, isIgnored, "/repo")).toThrow();
    expect(() => resolveOutPath([".env.bench"], root, isIgnored, "/repo")).toThrow();
  });
});

describe(".gitignore (re-review N3)", () => {
  // Read the file, not `git check-ignore`: the remote runner syncs the tree without .git.
  const patterns = readFileSync(new URL("../.gitignore", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));
  it("ignores env:init's temporary file for every env file, .env.bench included", () => {
    for (const file of [".env.tmp", ".env.bench.tmp", ".env.local.tmp"]) {
      expect(
        patterns.some((pattern) => matchesGlob(file, pattern)),
        file,
      ).toBe(true);
    }
  });
});

describe("observability secrets (D50)", () => {
  it("generates every observability secret in its contract shape", () => {
    const s = generateSecrets();
    expect(GarageKeyId.safeParse(s.S3_OBSERVE_ACCESS_KEY_ID).success).toBe(true);
    expect(GarageSecret.safeParse(s.S3_OBSERVE_SECRET_ACCESS_KEY).success).toBe(true);
    expect(vapidPairMatches(s.VAPID_PUBLIC_KEY!, s.VAPID_PRIVATE_KEY!)).toBe(true);
    // ObservePassword: OpenObserve refuses weak passwords, and panics at boot on a weak root one.
    expect(
      ObservabilityInitEnv.safeParse({
        OBSERVE_ROOT_PASSWORD: s.OBSERVE_ROOT_PASSWORD,
        OBSERVE_INGEST_PASSWORD: s.OBSERVE_INGEST_PASSWORD,
        OBSERVE_VIEWER_PASSWORD: s.OBSERVE_VIEWER_PASSWORD,
        ALERT_WEBHOOK_SECRET: s.ALERT_WEBHOOK_SECRET,
      }).success,
    ).toBe(true);
    expect(
      new Set([s.OBSERVE_ROOT_PASSWORD, s.OBSERVE_INGEST_PASSWORD, s.OBSERVE_VIEWER_PASSWORD]).size,
    ).toBe(3);
  });

  it("refuses a half-present VAPID pair", () => {
    expect(() => fillEnv("VAPID_PUBLIC_KEY=Bx\n", generateSecrets())).toThrow(
      "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together",
    );
  });
});

it("generates independent Copilot credentials that satisfy the policies", () => {
  const s = generateSecrets();
  const keys = [
    "OBSERVER_DB_PASSWORD",
    "OBSERVER_INTERNAL_TOKEN",
    "OBSERVER_QUERY_TOKEN",
    "OBSERVE_COPILOT_PASSWORD",
  ];
  expect(keys.every((key) => (s[key]?.length ?? 0) >= 32)).toBe(true);
  expect(new Set(keys.map((key) => s[key])).size).toBe(4);
  expect(DbPassword.safeParse(s.OBSERVER_DB_PASSWORD).success).toBe(true);
  expect(
    ObservabilityInitEnv.shape.OBSERVE_COPILOT_PASSWORD.safeParse(s.OBSERVE_COPILOT_PASSWORD)
      .success,
  ).toBe(true);
});
