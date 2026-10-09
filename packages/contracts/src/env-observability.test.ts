import { describe, expect, it } from "vitest";
import { GarageInitEnv, ObservabilityInitEnv, TelemetryEnv, WebEnv, parseEnv } from "./env.ts";

const secret = "s".repeat(40);
/** OpenObserve's password policy: lower, upper, digit and special (Task B1). */
const o2Password = "Observe-password-0123456789abcdef";
const web = {
  DATABASE_URL: "postgres://web_role:pw@postgres:5432/mastertutor",
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: "https://mt.example.com",
  VAULT_PUBLIC_KEY: Buffer.alloc(32, 1).toString("base64"),
  NEKO_MEMBER_SECRET: secret,
  LIVE_COOKIE_SECRET: secret,
  OPENAI_API_KEY: "k",
  S3_ENDPOINT: "http://garage:3900",
  S3_ACCESS_KEY_ID: `GK${"a".repeat(24)}`,
  S3_SECRET_ACCESS_KEY: "b".repeat(64),
};

describe("observability env (D50)", () => {
  it("leaves telemetry off unless an endpoint is set", () => {
    expect(parseEnv(TelemetryEnv, {})).toEqual({ MT_DEPLOYMENT: "production" });
    expect(() => parseEnv(TelemetryEnv, { OTEL_EXPORTER_OTLP_ENDPOINT: "ftp://x" })).toThrow();
  });

  it("needs both VAPID keys or neither, and never names their values", () => {
    expect(parseEnv(WebEnv, web).VAPID_PUBLIC_KEY).toBeUndefined();
    const half = { ...web, VAPID_PUBLIC_KEY: `B${"x".repeat(86)}` };
    try {
      parseEnv(WebEnv, half);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("VAPID_PRIVATE_KEY");
      expect(String(error)).not.toContain("x".repeat(86));
    }
  });

  it("provisions the observe bucket only with both keys", () => {
    const base = {
      GARAGE_ADMIN_URL: "http://garage:3903",
      GARAGE_ADMIN_TOKEN: secret,
      S3_WEB_ACCESS_KEY_ID: `GK${"1".repeat(24)}`,
      S3_WEB_SECRET_ACCESS_KEY: "1".repeat(64),
      S3_AGENT_ACCESS_KEY_ID: `GK${"2".repeat(24)}`,
      S3_AGENT_SECRET_ACCESS_KEY: "2".repeat(64),
    };
    expect(parseEnv(GarageInitEnv, base).S3_OBSERVE_BUCKET).toBe("observability");
    expect(() =>
      parseEnv(GarageInitEnv, { ...base, S3_OBSERVE_ACCESS_KEY_ID: `GK${"3".repeat(24)}` }),
    ).toThrow(/S3_OBSERVE_SECRET_ACCESS_KEY/);
  });

  it("parses the provisioner env with safe defaults", () => {
    const env = parseEnv(ObservabilityInitEnv, {
      OBSERVE_ROOT_PASSWORD: o2Password,
      OBSERVE_INGEST_PASSWORD: o2Password,
      OBSERVE_VIEWER_PASSWORD: o2Password,
      ALERT_WEBHOOK_SECRET: secret,
    });
    expect(env.OBSERVE_URL).toBe("http://openobserve:5080/observability");
    expect(env.ALERT_WEBHOOK_URL).toBe("http://web:3000/api/alerts/webhook");
    expect(env.SPEND_ALERT_USD_PER_HOUR).toBe(25);
    expect(env.OBSERVE_ROOT_PASSWORD_PREVIOUS).toBeUndefined();
    expect(() =>
      parseEnv(ObservabilityInitEnv, {
        OBSERVE_ROOT_PASSWORD: o2Password,
        OBSERVE_ROOT_PASSWORD_PREVIOUS: secret,
        OBSERVE_INGEST_PASSWORD: o2Password,
        OBSERVE_VIEWER_PASSWORD: o2Password,
        ALERT_WEBHOOK_SECRET: secret,
      }),
    ).toThrow(/OBSERVE_ROOT_PASSWORD_PREVIOUS/);
  });
});

describe("OpenObserve passwords (Task B1: the image refuses weak ones, the root one at boot)", () => {
  it("needs a lowercase letter, an uppercase letter, a digit and a special character, and names no value", () => {
    const init = (password: string) => ({
      OBSERVE_ROOT_PASSWORD: password,
      OBSERVE_INGEST_PASSWORD: o2Password,
      OBSERVE_VIEWER_PASSWORD: o2Password,
      ALERT_WEBHOOK_SECRET: secret,
    });
    for (const weak of [
      secret,
      "A1-".repeat(12),
      "a1-".repeat(12),
      "Aa-".repeat(12),
      "Aa1".repeat(12),
    ]) {
      try {
        parseEnv(ObservabilityInitEnv, init(weak));
        expect.unreachable(weak);
      } catch (error) {
        expect(String(error)).toContain("OBSERVE_ROOT_PASSWORD");
        expect(String(error)).not.toContain(weak);
      }
    }
    expect(() => parseEnv(WebEnv, { ...web, OBSERVE_VIEWER_PASSWORD: secret })).toThrow(
      /OBSERVE_VIEWER_PASSWORD/,
    );
    expect(
      parseEnv(WebEnv, { ...web, OBSERVE_VIEWER_PASSWORD: o2Password }).OBSERVE_VIEWER_PASSWORD,
    ).toBe(o2Password);
  });
});

describe("VAPID keys in the format web-push takes (setVapidDetails)", () => {
  it("accepts a real P-256 pair: 65-byte public point and 32-byte private scalar, base64url", async () => {
    const { createECDH } = await import("node:crypto");
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const env = parseEnv(WebEnv, {
      ...web,
      VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString("base64url"),
      VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString("base64url").padStart(43, "A"),
    });
    expect(Buffer.from(env.VAPID_PUBLIC_KEY!, "base64url")).toHaveLength(65);
    expect(Buffer.from(env.VAPID_PRIVATE_KEY!, "base64url")).toHaveLength(32);
    expect(() =>
      parseEnv(WebEnv, {
        ...web,
        VAPID_PUBLIC_KEY: `B${"x".repeat(86)}=`,
        VAPID_PRIVATE_KEY: "y".repeat(43),
      }),
    ).toThrow(/VAPID_PUBLIC_KEY/);
  });
});
