import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "@mastertutor/contracts";
import { z } from "zod";
import { STACKS, type StackName } from "./types.ts";

/** One project name for the bench stack, so it never shares volumes with mastertutor or the tests (X9). */
export const BENCH_PROJECT = "mastertutor-bench";
/** The harness's app account. `.env.bench` belongs to env:init (D47) and is never read by the harness. */
export const BENCH_ACCOUNT_FILE = ".env.bench-account";

export const STACK_COMPOSE: Record<StackName, readonly string[]> = {
  test: [
    "docker",
    "compose",
    "--env-file",
    ".env.test",
    "-f",
    "compose.yml",
    "-f",
    "compose.test.yml",
  ],
  // D47: production compose and images (docling pdf profile, D42; observability, D50); the local
  // override covers only domain and TLS, and keeps the workers' logs local.
  local: [
    "docker",
    "compose",
    "-p",
    BENCH_PROJECT,
    "--env-file",
    ".env",
    "--env-file",
    ".env.bench",
    "--profile",
    "pdf",
    "--profile",
    "observability",
    "-f",
    "compose.yml",
    "-f",
    "compose.prod.yml",
    "-f",
    "tests/bench/compose.local.yml",
  ],
};

export const BenchEnv = z.object({
  BENCH_STACK: z.enum(STACKS),
  BENCH_BASE_URL: z.url(),
  BENCH_EMAIL: z.email(),
  BENCH_PASSWORD: z.string().min(16),
  /** The app's origin (PUBLIC_URL) when BENCH_BASE_URL is another port, as on a CI slot (D48). */
  BENCH_APP_ORIGIN: z.url().optional(),
});
export type BenchEnv = z.infer<typeof BenchEnv>;

export function readBenchEnv(path = BENCH_ACCOUNT_FILE): BenchEnv {
  const map: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^(BENCH_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) map[match[1]!] = match[2]!;
  }
  return parseEnv(BenchEnv, map);
}

/** Mode 0600; never prints values. */
export function writeBenchEnv(path: string, env: BenchEnv): void {
  const lines = Object.entries(BenchEnv.parse(env)).map(([key, value]) => `${key}=${value}`);
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** D34: site credentials live only in the vault. The harness refuses to run if any are in its env. */
export function assertNoSiteCredentialsInEnv(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const offending = Object.keys(env).filter((key) => /zybook/i.test(key));
  if (offending.length > 0)
    throw new Error(
      `Refusing to run: ${offending.join(", ")} looks like a site credential. Enter credentials only in the Vault UI.`,
    );
}
