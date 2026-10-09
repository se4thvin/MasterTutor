import { describe, expect, it } from "vitest";
import {
  AgentEnv,
  EnvError,
  GarageInitEnv,
  MigrateEnv,
  ObserverEnv,
  VaultRotateEnv,
  WebEnv,
  parseEnv,
} from "./env.ts";

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
  PDF_WORKER_URL: "http://pdf-worker:5002",
  AUDIO_CAPTURE_URL: "http://audio-capture:5003",
};

describe("parseEnv", () => {
  it("parses the agent env with defaults", () => {
    const env = parseEnv(AgentEnv, agentSource);
    expect(env.BROWSER_SLOTS).toEqual(["browser-1", "browser-2"]);
    expect(env.S3_REGION).toBe("garage");
    expect(env.S3_BUCKET).toBe("mastertutor");
    expect(env.AGENT_HEALTH_PORT).toBe(8787);
    expect(env.AGENT_SHUTDOWN_DRAIN_MS).toBe(5_000);
    expect(
      parseEnv(AgentEnv, { ...agentSource, AGENT_SHUTDOWN_DRAIN_MS: "12000" })
        .AGENT_SHUTDOWN_DRAIN_MS,
    ).toBe(12_000);
    expect(() => parseEnv(AgentEnv, { ...agentSource, AGENT_SHUTDOWN_DRAIN_MS: "-1" })).toThrow(
      EnvError,
    );
    expect(env.AGENT_TEST_MODE).toBe(false);
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("accepts an optional DOCLING_URL for the agent", () => {
    expect(
      parseEnv(AgentEnv, { ...agentSource, DOCLING_URL: "http://docling:5001" }).DOCLING_URL,
    ).toBe("http://docling:5001");
    expect(parseEnv(AgentEnv, { ...agentSource, DOCLING_URL: "" }).DOCLING_URL).toBeUndefined();
  });

  it("accepts only http(s) service URLs for the PDF services (B5 re-review N-7)", () => {
    for (const bad of [
      "file:///etc/passwd",
      "ftp://pdf-worker/",
      "javascript:alert(1)",
      "pdf-worker:5002",
    ]) {
      expect(() => parseEnv(AgentEnv, { ...agentSource, PDF_WORKER_URL: bad }), bad).toThrow(
        EnvError,
      );
      expect(() => parseEnv(AgentEnv, { ...agentSource, DOCLING_URL: bad }), bad).toThrow(EnvError);
    }
    expect(() => parseEnv(AgentEnv, { ...agentSource, PDF_WORKER_URL: undefined })).toThrow(
      EnvError,
    );
    expect(() => parseEnv(AgentEnv, { ...agentSource, AUDIO_CAPTURE_URL: undefined })).toThrow(
      EnvError,
    );
    expect(() =>
      parseEnv(AgentEnv, { ...agentSource, AUDIO_CAPTURE_URL: "file:///tmp/x" }),
    ).toThrow(EnvError);
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
  it("web never gets the vault private key or the n.eko admin secret, and shares the single OpenAI key (D36)", () => {
    expect(keys(WebEnv)).not.toContain("VAULT_PRIVATE_KEY");
    expect(keys(WebEnv)).not.toContain("NEKO_ADMIN_SECRET");
    expect(keys(WebEnv)).toContain("OPENAI_API_KEY");
    expect(keys(WebEnv)).not.toContain("OPENAI_EMBEDDINGS_KEY");
  });
  it("agent never gets web-only secrets", () => {
    for (const key of [
      "NEKO_MEMBER_SECRET",
      "BETTER_AUTH_SECRET",
      "LIVE_COOKIE_SECRET",
      "VAULT_PUBLIC_KEY",
    ]) {
      expect(keys(AgentEnv)).not.toContain(key);
    }
  });
  it("has no TURN secret anywhere: v1 has no TURN relay (D42)", () => {
    for (const schema of [WebEnv, AgentEnv, MigrateEnv, GarageInitEnv]) {
      expect(keys(schema)).not.toContain("TURN_SECRET");
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
        "OBSERVER_DB_PASSWORD",
        "WEB_DB_PASSWORD",
      ].sort(),
    );
    expect(keys(GarageInitEnv)).not.toContain("DATABASE_URL");
  });
});

describe("VaultRotateEnv", () => {
  const source = {
    DATABASE_URL: "postgres://agent:x@postgres:5432/mastertutor",
    VAULT_PRIVATE_KEY: "kCNZsvnP2oSO4FaU/yZoEi4TCPUK/EKw1zn4wI/5s1c=",
    VAULT_NEXT_PRIVATE_KEY: "y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=",
  };
  it("parses the current and next private keys", () => {
    expect(parseEnv(VaultRotateEnv, source).VAULT_NEXT_PRIVATE_KEY).toBe(
      source.VAULT_NEXT_PRIVATE_KEY,
    );
  });
  it("refuses a no-op rotation without echoing the key", () => {
    try {
      parseEnv(VaultRotateEnv, { ...source, VAULT_NEXT_PRIVATE_KEY: source.VAULT_PRIVATE_KEY });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect(String((error as EnvError).problems)).not.toContain(source.VAULT_PRIVATE_KEY);
      expect((error as EnvError).problems.join(" ")).toContain("VAULT_NEXT_PRIVATE_KEY");
    }
  });
});

describe("ObserverEnv (spec §5.1)", () => {
  const base = {
    DATABASE_URL: "postgres://observer_role:p@postgres:5432/mastertutor",
    OPENAI_API_KEY: "k",
    PUBLIC_URL: "https://mt.example.com",
    OBSERVER_INTERNAL_TOKEN: "t".repeat(32),
    OBSERVER_QUERY_TOKEN: "q".repeat(32),
    OBSERVER_QUERY_URL: "http://observer-query:4001",
  };
  it("defaults the daily cap to $3 and holds no S3, vault or auth secret", () => {
    const env = parseEnv(ObserverEnv, base);
    expect(env.OBSERVER_DAILY_USD).toBe(3);
    for (const key of Object.keys(ObserverEnv.shape))
      expect(key).not.toMatch(/^(S3_|VAULT_|BETTER_AUTH|NEKO_|LIVE_COOKIE|SEALING|OBSERVE_)/);
  });
});
