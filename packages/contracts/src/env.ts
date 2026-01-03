import { z } from "zod";
import {
  Base64Key32,
  BucketName,
  DbPassword,
  GarageKeyId,
  GarageSecret,
  PostgresUrl,
} from "./primitives.ts";
import { SlotList } from "./constants.ts";

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

/** web: encryption-only vault key, member-only n.eko secret, read-only S3 key (spec §13). */
export const WebEnv = z.object({
  ...Common,
  DATABASE_URL: PostgresUrl,
  BETTER_AUTH_SECRET: Secret,
  BETTER_AUTH_URL: z.url(),
  AUTH_SIGNUP_OPEN: Flag,
  VAULT_PUBLIC_KEY: Base64Key32,
  NEKO_MEMBER_SECRET: Secret,
  LIVE_COOKIE_SECRET: Secret,
  TURN_SECRET: Secret,
  OPENAI_EMBEDDINGS_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.url().optional(),
  ...S3Access,
});
export type WebEnv = z.infer<typeof WebEnv>;

/** agent: decryption key, n.eko admin secret, read/write S3 key. */
export const AgentEnv = z.object({
  ...Common,
  DATABASE_URL: PostgresUrl,
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.url().optional(),
  VAULT_PRIVATE_KEY: Base64Key32,
  NEKO_ADMIN_SECRET: Secret,
  ...S3Access,
  BROWSER_SLOTS: SlotList,
  AGENT_TEST_MODE: Flag,
  AGENT_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
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

/** garage-init one-shot: admin API token plus the two service keys it imports. */
export const GarageInitEnv = z.object({
  ...Common,
  GARAGE_ADMIN_URL: z.url(),
  GARAGE_ADMIN_TOKEN: Secret,
  S3_BUCKET: BucketName.default("mastertutor"),
  S3_WEB_ACCESS_KEY_ID: GarageKeyId,
  S3_WEB_SECRET_ACCESS_KEY: GarageSecret,
  S3_AGENT_ACCESS_KEY_ID: GarageKeyId,
  S3_AGENT_SECRET_ACCESS_KEY: GarageSecret,
  GARAGE_CAPACITY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 ** 3),
});
export type GarageInitEnv = z.infer<typeof GarageInitEnv>;

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
