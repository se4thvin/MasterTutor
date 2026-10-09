// Fills missing or empty keys in an env file (default: the root .env) with fresh secrets and safe local defaults.
// Never prints or overwrites an existing value. Usage: pnpm env:init [--out <git-ignored or out-of-repo file>]
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_BROWSER_SLOTS } from "@mastertutor/contracts";
import { vapidKeyPair } from "./lib/vapid.ts";

const b64url = (bytes: number) => randomBytes(bytes).toString("base64url");
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
/** ObservePassword: 256 random bits plus one character of each kind OpenObserve's policy demands. */
const observePassword = () => `${b64url(32)}-Aa0`;

export const ENV_DEFAULTS = {
  PUBLIC_IP: "127.0.0.1",
  PUBLIC_URL: "http://localhost:18080",
  BROWSER_SLOTS: DEFAULT_BROWSER_SLOTS.join(","),
  AUTH_SIGNUP_OPEN: "0",
} as const;
export const MANUAL_KEYS = ["OPENAI_API_KEY"] as const;

export function generateSecrets(): Record<string, string> {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pub = publicKey.export({ format: "jwk" }).x;
  const priv = privateKey.export({ format: "jwk" }).d;
  if (!pub || !priv) throw new Error("x25519 key export failed");
  const vapid = vapidKeyPair();
  return {
    POSTGRES_PASSWORD: b64url(24),
    WEB_DB_PASSWORD: b64url(24),
    AGENT_DB_PASSWORD: b64url(24),
    OBSERVER_DB_PASSWORD: b64url(24),
    OBSERVER_INTERNAL_TOKEN: b64url(32),
    OBSERVER_QUERY_TOKEN: b64url(32),
    OBSERVE_COPILOT_PASSWORD: observePassword(),
    BETTER_AUTH_SECRET: b64url(32),
    NEKO_ADMIN_SECRET: b64url(32),
    NEKO_MEMBER_SECRET: b64url(32),
    LIVE_COOKIE_SECRET: b64url(32),
    GARAGE_ADMIN_TOKEN: b64url(32),
    GARAGE_RPC_SECRET: hex(32),
    S3_WEB_ACCESS_KEY_ID: `GK${hex(12)}`,
    S3_WEB_SECRET_ACCESS_KEY: hex(32),
    S3_AGENT_ACCESS_KEY_ID: `GK${hex(12)}`,
    S3_AGENT_SECRET_ACCESS_KEY: hex(32),
    // libsodium crypto_box keys are raw X25519 keys; base64 (standard) for the env.
    VAULT_PUBLIC_KEY: Buffer.from(pub, "base64url").toString("base64"),
    VAULT_PRIVATE_KEY: Buffer.from(priv, "base64url").toString("base64"),
    S3_OBSERVE_ACCESS_KEY_ID: `GK${hex(12)}`,
    S3_OBSERVE_SECRET_ACCESS_KEY: hex(32),
    OBSERVE_ROOT_PASSWORD: observePassword(),
    OBSERVE_INGEST_PASSWORD: observePassword(),
    OBSERVE_VIEWER_PASSWORD: observePassword(),
    ALERT_WEBHOOK_SECRET: b64url(32),
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
  };
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export function fillEnv(
  existing: string,
  generated: Record<string, string>,
): { text: string; filled: string[]; missingManual: string[] } {
  const wanted: Record<string, string> = { ...ENV_DEFAULTS, ...generated };
  const values = new Map<string, string>();
  for (const line of existing.split("\n")) {
    const match = LINE.exec(line);
    if (match) values.set(match[1]!, match[2]!.trim());
  }
  for (const [a, b] of [
    ["VAULT_PUBLIC_KEY", "VAULT_PRIVATE_KEY"],
    ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    ["S3_OBSERVE_ACCESS_KEY_ID", "S3_OBSERVE_SECRET_ACCESS_KEY"],
  ] as const) {
    if (((values.get(a) ?? "") !== "") !== ((values.get(b) ?? "") !== ""))
      throw new Error(`${a} and ${b} must be set together; fix .env by hand`);
  }
  const filled: string[] = [];
  const lines = existing.split("\n").map((line) => {
    const match = LINE.exec(line);
    if (!match) return line;
    const [, key, value] = match;
    if (value!.trim() === "" && key! in wanted) {
      filled.push(key!);
      return `${key}=${wanted[key!]}`;
    }
    return line;
  });
  const appended = Object.keys(wanted).filter((key) => !values.has(key));
  let text = lines.join("\n");
  if (appended.length > 0) {
    if (text.length > 0 && !text.endsWith("\n")) text += "\n";
    text += `# Added by pnpm env:init\n${appended.map((key) => `${key}=${wanted[key]}`).join("\n")}\n`;
    filled.push(...appended);
  }
  const missingManual = MANUAL_KEYS.filter((key) => (values.get(key) ?? "") === "");
  return { text, filled, missingManual };
}

const tmpPathFor = (path: string) => `${path}.tmp`;

/** Where env:init writes. A path inside the repo must be git-ignored, so secrets are never committed. */
export function resolveOutPath(
  argv: readonly string[],
  repoRoot: string,
  isIgnored: (absPath: string) => boolean,
  cwd: string = process.cwd(),
): string {
  const { values } = parseArgs({
    args: [...argv],
    options: { out: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const path = values.out === undefined ? resolve(repoRoot, ".env") : resolve(cwd, values.out);
  // The atomic write goes through `<path>.tmp`, which a crash can leave behind: it must be ignored too.
  for (const candidate of [path, tmpPathFor(path)]) {
    const inside = relative(repoRoot, candidate);
    if (!inside.startsWith("..") && !isAbsolute(inside) && !isIgnored(candidate)) {
      throw new Error(
        `refusing to write secrets to ${inside}: git would track it (add it to .gitignore)`,
      );
    }
  }
  return path;
}

const gitIgnores = (repoRoot: string) => (absPath: string) =>
  spawnSync("git", ["check-ignore", "-q", absPath], { cwd: repoRoot }).status === 0;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const path = resolveOutPath(process.argv.slice(2), repoRoot, gitIgnores(repoRoot));
  const existing = await readFile(path, "utf8").catch(() => "");
  const result = fillEnv(existing, generateSecrets());
  // Atomic: a crash mid-write must not lose existing keys. A stale tmp file is removed first, so
  // the exclusive create always applies mode 600.
  const tmp = tmpPathFor(path);
  await rm(tmp, { force: true });
  await writeFile(tmp, result.text, { mode: 0o600, flag: "wx" });
  await rename(tmp, path);
  console.log(result.filled.length ? `filled: ${result.filled.join(", ")}` : "nothing to fill");
  if (result.missingManual.length) console.log(`set by hand: ${result.missingManual.join(", ")}`);
}
