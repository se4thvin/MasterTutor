import { describe, expect, it } from "vitest";
import { AgentEnv, EnvError, GarageInitEnv, MigrateEnv, WebEnv, parseEnv } from "./env.ts";

const agentSource = {
  DATABASE_URL: "postgres://agent_role:pw@postgres:5432/mastertutor",
  OPENAI_API_KEY: "sk-test-not-a-real-key",
  OPENAI_BASE_URL: "",
  VAULT_PRIVATE_KEY: "kCNZsvnP2oSO4FaU/yZoEi4TCPUK/EKw1zn4wI/5s1c=",
  NEKO_ADMIN_SECRET: "neko-admin-secret-for-tests-0123456789",
  S3_ENDPOINT: "http://garage:3900",
  S3_ACCESS_KEY_ID: "GK5aa6eb9e4f040236e79864f3",
  S3_SECRET_ACCESS_KEY: "0974bfbf76eb6fb9faf77bf05f5b21d703c85dbd797421167285185ae7ff3568",
  BROWSER_SLOTS: "browser-1, browser-2",
};

describe("parseEnv", () => {
  it("parses the agent env with defaults", () => {
    const env = parseEnv(AgentEnv, agentSource);
    expect(env.BROWSER_SLOTS).toEqual(["browser-1", "browser-2"]);
    expect(env.S3_REGION).toBe("garage");
    expect(env.S3_BUCKET).toBe("mastertutor");
    expect(env.AGENT_HEALTH_PORT).toBe(8787);
    expect(env.AGENT_TEST_MODE).toBe(false);
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("parses boolean flags", () => {
    expect(parseEnv(AgentEnv, { ...agentSource, AGENT_TEST_MODE: "1" }).AGENT_TEST_MODE).toBe(true);
    expect(() => parseEnv(AgentEnv, { ...agentSource, AGENT_TEST_MODE: "yes" })).toThrow(EnvError);
  });

  it("rejects duplicate or malformed slot lists", () => {
    expect(() =>
      parseEnv(AgentEnv, { ...agentSource, BROWSER_SLOTS: "browser-1,browser-1" }),
    ).toThrow(EnvError);
    expect(() => parseEnv(AgentEnv, { ...agentSource, BROWSER_SLOTS: "slot-a" })).toThrow(EnvError);
    expect(() => parseEnv(AgentEnv, { ...agentSource, BROWSER_SLOTS: " , " })).toThrow(EnvError);
  });

  it("names the bad keys but never echoes their values", () => {
    const secretValue = "super-secret-value-123";
    try {
      parseEnv(AgentEnv, {
        ...agentSource,
        NEKO_ADMIN_SECRET: secretValue,
        OPENAI_API_KEY: undefined,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      expect(message).toContain("NEKO_ADMIN_SECRET");
      expect(message).toContain("OPENAI_API_KEY");
      expect(message).not.toContain(secretValue);
    }
  });
});

describe("least privilege per service (spec §13)", () => {
  const keys = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape);
  it("web never gets the vault private key, the n.eko admin secret or the agent's OpenAI key", () => {
    expect(keys(WebEnv)).not.toContain("VAULT_PRIVATE_KEY");
    expect(keys(WebEnv)).not.toContain("NEKO_ADMIN_SECRET");
    expect(keys(WebEnv)).not.toContain("OPENAI_API_KEY");
  });
  it("agent never gets web-only secrets", () => {
    for (const key of [
      "NEKO_MEMBER_SECRET",
      "BETTER_AUTH_SECRET",
      "LIVE_COOKIE_SECRET",
      "TURN_SECRET",
      "VAULT_PUBLIC_KEY",
    ]) {
      expect(keys(AgentEnv)).not.toContain(key);
    }
  });
  it("one-shots get only what they need", () => {
    expect(keys(MigrateEnv).sort()).toEqual(
      [
        "AGENT_DB_PASSWORD",
        "BROWSER_SLOTS",
        "DATABASE_URL",
        "LOG_LEVEL",
        "NODE_ENV",
        "WEB_DB_PASSWORD",
      ].sort(),
    );
    expect(keys(GarageInitEnv)).not.toContain("DATABASE_URL");
  });
});
