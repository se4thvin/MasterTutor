import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProductionEnv } from "../../scripts/deploy/check-env.ts";
import { generateSecrets } from "../../scripts/env-init.ts";

// Not secrets; AGENT_TEST_MODE's value "1" also occurs in names such as browser-1.
const PLAIN = new Set([
  "DOMAIN",
  "PUBLIC_URL",
  "PUBLIC_IP",
  "COMPOSE_PROFILES",
  "AUTH_SIGNUP_OPEN",
  "AGENT_TEST_MODE",
]);

/** P9-17: built from scratch (not .env.test); every secret is a unique random canary. */
function goodEnv(): Record<string, string> {
  return {
    ...generateSecrets(),
    OPENAI_API_KEY: `sk-canary-${randomUUID()}`,
    DOMAIN: "notes.example.org",
    PUBLIC_URL: "https://notes.example.org",
    PUBLIC_IP: "8.8.4.4",
    COMPOSE_PROFILES: "pdf",
    AUTH_SIGNUP_OPEN: "0",
  };
}

function envFile(values: Record<string, string>): string {
  const file = join(mkdtempSync(join(tmpdir(), "mt-env-")), "prod.env");
  writeFileSync(
    file,
    `${Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  return file;
}

function expectNoValues(problems: string[], values: Record<string, string>) {
  const text = problems.join("\n");
  for (const [key, value] of Object.entries(values)) {
    if (!PLAIN.has(key)) expect(text.includes(value), `${key} value leaked`).toBe(false);
  }
}

describe("checkProductionEnv", () => {
  it("accepts a complete production env", async () => {
    expect(await checkProductionEnv(envFile(goodEnv()))).toEqual([]);
  });

  it("names every production-rule violation by key, never by value (P9-15, P9-16)", async () => {
    const values = {
      ...goodEnv(),
      PUBLIC_URL: "http://notes.example.org",
      PUBLIC_IP: "100.100.1.1",
      AUTH_SIGNUP_OPEN: "1",
      AGENT_TEST_MODE: "1",
      SLOT_EGRESS_ALLOW_CIDRS: `10.${Math.floor(Math.random() * 200)}.0.0/16`,
      COMPOSE_PROFILES: "turn",
      TURN_SECRET: `turn-canary-${randomUUID()}`,
      OPENAI_EMBEDDINGS_KEY: `sk-canary-${randomUUID()}`,
      VAULT_NEXT_PRIVATE_KEY: generateSecrets().VAULT_PRIVATE_KEY!,
      CDP_SUBNET_PREFIX: "172.30.300",
    };
    const problems = await checkProductionEnv(envFile(values));
    const text = problems.join("\n");
    for (const key of [
      "PUBLIC_URL",
      "PUBLIC_IP",
      "AUTH_SIGNUP_OPEN",
      "AGENT_TEST_MODE",
      "SLOT_EGRESS_ALLOW_CIDRS",
      "COMPOSE_PROFILES: must include pdf",
      "COMPOSE_PROFILES: must not include turn",
      "TURN_SECRET",
      "OPENAI_EMBEDDINGS_KEY",
      "VAULT_NEXT_PRIVATE_KEY",
      "CDP_SUBNET_PREFIX",
    ]) {
      expect(text, key).toContain(key);
    }
    expectNoValues(problems, values);
  });

  it("rejects a private, loopback or CGNAT public IP", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.86.94", "100.64.0.1", "not-an-ip"]) {
      const problems = await checkProductionEnv(envFile({ ...goodEnv(), PUBLIC_IP: ip }));
      expect(
        problems.some((p) => p.startsWith("PUBLIC_IP:")),
        ip,
      ).toBe(true);
    }
  });

  it("detects a vault public key that does not match the private key", async () => {
    const values = { ...goodEnv(), VAULT_PUBLIC_KEY: generateSecrets().VAULT_PUBLIC_KEY! };
    const problems = await checkProductionEnv(envFile(values));
    expect(problems).toContain("VAULT_PUBLIC_KEY: does not match VAULT_PRIVATE_KEY");
    expectNoValues(problems, values);
  });

  it("reports a missing secret by key", async () => {
    const values = goodEnv();
    delete values.VAULT_PRIVATE_KEY;
    const problems = await checkProductionEnv(envFile(values));
    expect(problems.some((p) => p.includes("VAULT_PRIVATE_KEY"))).toBe(true);
    expectNoValues(problems, values);
  });

  it("refuses to be fooled by a shell variable that overrides the file", async () => {
    process.env.PUBLIC_IP = "8.8.8.8";
    try {
      const problems = await checkProductionEnv(envFile(goodEnv()));
      expect(problems).toContain(
        "PUBLIC_IP: also set in this shell, which overrides the file; unset it",
      );
    } finally {
      delete process.env.PUBLIC_IP;
    }
  });
});

describe("pnpm deploy:check-env (CLI)", () => {
  it("never prints a value, even when docker compose chokes on a malformed line (review I1)", () => {
    const canary = `sk-canary-${randomUUID()}`;
    const values = goodEnv();
    delete values.OPENAI_API_KEY;
    const file = envFile(values);
    // An unterminated quote: docker compose's own error message quotes the value.
    writeFileSync(file, `OPENAI_API_KEY="${canary}\n`, { flag: "a" });
    const result = spawnSync(process.execPath, ["scripts/deploy/check-env.ts", file], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(canary);
    for (const [key, value] of Object.entries(values)) {
      if (!PLAIN.has(key)) {
        expect(`${result.stdout}\n${result.stderr}`.includes(value), key).toBe(false);
      }
    }
  });
});
