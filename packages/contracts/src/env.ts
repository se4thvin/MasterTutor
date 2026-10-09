import { z } from "zod";
import {
  Base64Key32,
  BucketName,
  DbPassword,
  GarageKeyId,
  GarageSecret,
  ObservePassword,
  PostgresUrl,
} from "./primitives.ts";
import { SlotList } from "./constants.ts";
import { DEFAULT_CDP_SUBNET_PREFIX } from "./live.ts";
import { ALERT_WEBHOOK_INTERNAL_URL, OBSERVE_INTERNAL_URL } from "./observability.ts";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export const LogLevel = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevel>;

const Secret = z.string().min(32, "Must be at least 32 characters");
const Flag = z
  .enum(["0", "1", "true", "false"])
  .default("0")
  .transform((value) => value === "1" || value === "true");

const Common = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: LogLevel.default("info"),
};
const S3Access = {
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("garage"),
  S3_BUCKET: BucketName.default("mastertutor"),
  S3_ACCESS_KEY_ID: GarageKeyId,
  S3_SECRET_ACCESS_KEY: GarageSecret,
};

export const DEPLOYMENTS = ["production", "bench", "test", "development"] as const;
/** Telemetry is off unless an endpoint is set (spec §6.3); test stacks never set it. */
const Telemetry = {
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  MT_DEPLOYMENT: z.enum(DEPLOYMENTS).default("production"),
};
export const TelemetryEnv = z.object(Telemetry);
export type TelemetryEnv = z.infer<typeof TelemetryEnv>;

/**
 * VAPID keys as `pnpm env:init` writes them and web-push's setVapidDetails takes them: unpadded
 * base64url of the 65-byte uncompressed P-256 point (0x04 prefix, so it starts with "B") and of the
 * 32-byte private scalar.
 */
const VapidPublicKey = z
  .string()
  .regex(/^B[A-Za-z0-9_-]{86}$/, "Expected a base64url uncompressed P-256 public key");
const VapidPrivateKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Expected a base64url 32-byte P-256 private key");

/** Both members of a key pair, or neither (names the missing key, never a value). */
const paired = (a: string, b: string) => (env: Record<string, unknown>, ctx: z.RefinementCtx) => {
  if ((env[a] === undefined) !== (env[b] === undefined))
    ctx.addIssue({
      code: "custom",
      path: [env[a] === undefined ? a : b],
      message: `set together with ${env[a] === undefined ? b : a}`,
    });
};

/** web: encryption-only vault key, member-only n.eko secret, read-only S3 key (spec §13). */
export const WebEnv = z
  .object({
    ...Common,
    ...Telemetry,
    DATABASE_URL: PostgresUrl,
    BETTER_AUTH_SECRET: Secret,
    BETTER_AUTH_URL: z.url(),
    AUTH_SIGNUP_OPEN: Flag,
    VAULT_PUBLIC_KEY: Base64Key32,
    NEKO_MEMBER_SECRET: Secret,
    LIVE_COOKIE_SECRET: Secret,
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_BASE_URL: z.url().optional(),
    ...S3Access,
    /** Web Push (spec §13.4): unset means in-app alerts only. */
    VAPID_PUBLIC_KEY: VapidPublicKey.optional(),
    VAPID_PRIVATE_KEY: VapidPrivateKey.optional(),
    /** OpenObserve's alert webhook bearer (spec §13.2): unset means the webhook does not exist. */
    ALERT_WEBHOOK_SECRET: Secret.optional(),
    /** The viewer user ForwardAuth injects for /observability (spec §12): unset means unavailable. */
    OBSERVE_VIEWER_PASSWORD: ObservePassword.optional(),
    /** web's cdp address is <prefix>.11: the Host Traefik's ForwardAuth calls carry (D50 I-1). */
    CDP_SUBNET_PREFIX: z
      .string()
      .regex(/^(?:[0-9]{1,3}\.){2}[0-9]{1,3}$/)
      .default(DEFAULT_CDP_SUBNET_PREFIX),
    /** Test-only: serve the in-memory fixture API (apps/web/lib/fixtures). Never set in compose files. */
    WEB_FIXTURE_API: Flag,
  })
  .superRefine(paired("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"));
export type WebEnv = z.infer<typeof WebEnv>;

/** agent: decryption key, n.eko admin secret, read/write S3 key. */
export const AgentEnv = z.object({
  ...Common,
  ...Telemetry,
  DATABASE_URL: PostgresUrl,
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.url().optional(),
  /** docling-serve base URL; set only with COMPOSE_PROFILES containing `pdf` (spec §7.6). */
  DOCLING_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** The pdf-worker service on the internal `pdf` network: the only place PDFs are parsed (B5 I-1). */
  PDF_WORKER_URL: z.url({ protocol: /^https?$/ }),
  /** The audio-capture service on `cdp`: the only place a slot's audio is recorded (B4 review I7). */
  AUDIO_CAPTURE_URL: z.url({ protocol: /^https?$/ }),
  VAULT_PRIVATE_KEY: Base64Key32,
  NEKO_ADMIN_SECRET: Secret,
  ...S3Access,
  BROWSER_SLOTS: SlotList,
  AGENT_TEST_MODE: Flag,
  AGENT_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  /** How long a graceful stop waits for slot restarts; keep it below compose stop_grace_period. */
  AGENT_SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(60_000).default(5_000),
});
export type AgentEnv = z.infer<typeof AgentEnv>;

/** migrate one-shot: owner connection plus the service-role passwords it sets. */
export const MigrateEnv = z.object({
  ...Common,
  DATABASE_URL: PostgresUrl,
  WEB_DB_PASSWORD: DbPassword,
  AGENT_DB_PASSWORD: DbPassword,
  BROWSER_SLOTS: SlotList,
});
export type MigrateEnv = z.infer<typeof MigrateEnv>;

/** garage-init one-shot: admin API token, the two service keys, and OpenObserve's own bucket and key. */
export const GarageInitEnv = z
  .object({
    ...Common,
    GARAGE_ADMIN_URL: z.url(),
    GARAGE_ADMIN_TOKEN: Secret,
    S3_BUCKET: BucketName.default("mastertutor"),
    S3_WEB_ACCESS_KEY_ID: GarageKeyId,
    S3_WEB_SECRET_ACCESS_KEY: GarageSecret,
    S3_AGENT_ACCESS_KEY_ID: GarageKeyId,
    S3_AGENT_SECRET_ACCESS_KEY: GarageSecret,
    S3_OBSERVE_BUCKET: BucketName.default("observability"),
    S3_OBSERVE_ACCESS_KEY_ID: GarageKeyId.optional(),
    S3_OBSERVE_SECRET_ACCESS_KEY: GarageSecret.optional(),
    GARAGE_CAPACITY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 ** 3),
  })
  .superRefine(paired("S3_OBSERVE_ACCESS_KEY_ID", "S3_OBSERVE_SECRET_ACCESS_KEY"));
export type GarageInitEnv = z.infer<typeof GarageInitEnv>;

/** observability-init one-shot (spec §11): provisions OpenObserve's users, streams, dashboards, alerts. */
export const ObservabilityInitEnv = z.object({
  ...Common,
  OBSERVE_URL: z.url().default(OBSERVE_INTERNAL_URL),
  OBSERVE_ROOT_PASSWORD: ObservePassword,
  /** Set for one deploy to rotate root: the password OpenObserve still has (review I4). */
  OBSERVE_ROOT_PASSWORD_PREVIOUS: ObservePassword.optional(),
  OBSERVE_INGEST_PASSWORD: ObservePassword,
  OBSERVE_VIEWER_PASSWORD: ObservePassword,
  ALERT_WEBHOOK_SECRET: Secret,
  ALERT_WEBHOOK_URL: z.url().default(ALERT_WEBHOOK_INTERNAL_URL),
  SPEND_ALERT_USD_PER_HOUR: z.coerce.number().positive().max(1_000).default(25),
});
export type ObservabilityInitEnv = z.infer<typeof ObservabilityInitEnv>;

export class EnvError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid environment:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "EnvError";
    this.problems = problems;
  }
}

/** Parses env at boot. Empty strings count as unset. Errors name keys, never values. */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Readonly<Record<string, string | undefined>>,
): z.output<S> {
  const present: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") present[key] = value;
  }
  const result = schema.safeParse(present);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map(
        (issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}

/**
 * vault:rotate CLI (agent image only; never set on a running service). Re-seals every vault row
 * from VAULT_PRIVATE_KEY's pair to VAULT_NEXT_PRIVATE_KEY's pair (spec §9 key rotation).
 */
export const VaultRotateEnv = z
  .object({
    ...Common,
    DATABASE_URL: PostgresUrl,
    VAULT_PRIVATE_KEY: Base64Key32,
    VAULT_NEXT_PRIVATE_KEY: Base64Key32,
  })
  .refine((env) => env.VAULT_PRIVATE_KEY !== env.VAULT_NEXT_PRIVATE_KEY, {
    path: ["VAULT_NEXT_PRIVATE_KEY"],
    message: "must differ from VAULT_PRIVATE_KEY",
  });
export type VaultRotateEnv = z.infer<typeof VaultRotateEnv>;
