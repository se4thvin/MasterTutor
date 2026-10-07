// Validates a production env file (what goes into Dokploy's env) against the service env
// contracts and the production rules, naming keys only, never values.
// Usage: pnpm deploy:check-env <file>   (create it with pnpm env:init --out <file outside the repo>)
import { readFileSync } from "node:fs";
import { BlockList, isIPv4 } from "node:net";
import { fileURLToPath } from "node:url";
import { parseEnv as parseDotenv } from "node:util";
import {
  AgentEnv,
  DEFAULT_CDP_SUBNET_PREFIX,
  EnvError,
  GarageInitEnv,
  MigrateEnv,
  WebEnv,
  liveForwardAuthAddress,
  liveRouterRule,
  parseEnv,
} from "@mastertutor/contracts";
import { vaultKeyPairFromPrivate } from "@mastertutor/sealing/open";
import { composeConfig, type ComposeConfig } from "../../tests/compose/compose-json.ts";
import { prodModeProblems } from "../../tests/compose/prod-mode.ts";

export const PRODUCTION_FILES = ["compose.yml", "compose.prod.yml"] as const;
const SERVICE_SCHEMAS = {
  web: WebEnv,
  agent: AgentEnv,
  migrate: MigrateEnv,
  "garage-init": GarageInitEnv,
};
const REMOVED_KEYS: Record<string, string> = {
  TURN_SECRET: "v1 has no TURN relay, D42",
  OPENAI_EMBEDDINGS_KEY: "one OPENAI_API_KEY, D36",
  VAULT_NEXT_PRIVATE_KEY: "key rotation only; never set on a running deploy",
  AGENT_TEST_MODE: "test mode never runs in production",
  WEB_FIXTURE_API: "fixture API never runs in production",
};

/** NAT1TO1 must be the public address browsers reach: not private, loopback, CGNAT/tailnet or reserved. */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}

export async function checkProductionEnv(envFile: string): Promise<string[]> {
  const root = parseDotenv(readFileSync(envFile, "utf8"));
  const problems: string[] = [];
  const has = (key: string) => (root[key] ?? "") !== "";

  for (const key of Object.keys(root)) {
    if (process.env[key] !== undefined) {
      problems.push(`${key}: also set in this shell, which overrides the file; unset it`);
    }
  }
  for (const [key, why] of Object.entries(REMOVED_KEYS)) {
    if (has(key)) problems.push(`${key}: remove it (${why})`);
  }

  const profiles = (root.COMPOSE_PROFILES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!profiles.includes("pdf")) problems.push("COMPOSE_PROFILES: must include pdf (docling, D42)");
  if (profiles.includes("turn")) problems.push("COMPOSE_PROFILES: must not include turn (D42)");

  if (!has("DOMAIN")) {
    problems.push("DOMAIN: required");
  } else {
    try {
      liveRouterRule("browser-1", root.DOMAIN!);
    } catch {
      problems.push("DOMAIN: must be a bare host name");
    }
    if (root.PUBLIC_URL !== `https://${root.DOMAIN}`) {
      problems.push("PUBLIC_URL: must be https://${DOMAIN}");
    }
  }
  const ip = root.PUBLIC_IP ?? "";
  if (!isIPv4(ip) || NOT_PUBLIC.check(ip, "ipv4")) {
    problems.push(
      "PUBLIC_IP: must be the server's public IPv4 (not private, loopback, CGNAT/tailnet or reserved)",
    );
  }
  try {
    liveForwardAuthAddress(root.CDP_SUBNET_PREFIX || DEFAULT_CDP_SUBNET_PREFIX);
  } catch {
    problems.push("CDP_SUBNET_PREFIX: must be three octets such as 172.30.231");
  }
  if (["1", "true"].includes(root.AUTH_SIGNUP_OPEN ?? "")) {
    problems.push("AUTH_SIGNUP_OPEN: must be 0 (open it only while the owner signs up)");
  }
  if (has("SLOT_EGRESS_ALLOW_CIDRS")) {
    problems.push("SLOT_EGRESS_ALLOW_CIDRS: must be empty in production");
  }

  if (has("VAULT_PRIVATE_KEY") && has("VAULT_PUBLIC_KEY")) {
    try {
      const pair = await vaultKeyPairFromPrivate(root.VAULT_PRIVATE_KEY!);
      const matches = Buffer.from(pair.publicKey).toString("base64") === root.VAULT_PUBLIC_KEY;
      pair.privateKey.fill(0);
      if (!matches) problems.push("VAULT_PUBLIC_KEY: does not match VAULT_PRIVATE_KEY");
    } catch {
      problems.push("VAULT_PRIVATE_KEY: not a valid vault key");
    }
  }

  let config: ComposeConfig;
  try {
    config = composeConfig(envFile, PRODUCTION_FILES, { profiles });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const missing = [
      ...new Set([...stderr.matchAll(/\bset ([A-Z][A-Z0-9_]*)\b/g)].map((m) => m[1]!)),
    ];
    problems.push(
      ...(missing.length > 0
        ? missing.map((key) => `${key}: required`)
        : [
            "compose config failed: run `docker compose --env-file <file> -f compose.yml -f compose.prod.yml config --quiet`",
          ]),
    );
    return problems;
  }
  for (const [service, schema] of Object.entries(SERVICE_SCHEMAS)) {
    const env = Object.fromEntries(
      Object.entries(config.services[service]?.environment ?? {}).map(([k, v]) => [
        k,
        v ?? undefined,
      ]),
    );
    try {
      parseEnv(schema, env);
    } catch (error) {
      if (!(error instanceof EnvError)) throw error;
      problems.push(...error.problems.map((problem) => `${service}.${problem}`));
    }
  }
  problems.push(...prodModeProblems(config));
  // B5's docling (profile pdf) is not merged yet: once compose.prod.yml pins DOCLING_URL, add
  // `agent.DOCLING_URL: must be set` here (Task 14 Step 11, deferred with Task 12's docling pin).
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || process.argv.length > 3) {
    console.error("usage: pnpm deploy:check-env <env file>");
    process.exit(2);
  }
  const problems = await checkProductionEnv(file);
  for (const problem of problems) console.error(`- ${problem}`);
  console.log(problems.length === 0 ? "production env OK" : `${problems.length} problem(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}
