/**
 * Build-output check for a production build (`next build` without WEB_FIXTURE_API):
 * - no fixture API code (router, seed) anywhere in the output, server or client;
 * - no server-only env names in client chunks (they would reveal what the server holds).
 * Run after `pnpm --filter @mastertutor/web build`. Exits 1 with each finding.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../.next/", import.meta.url).pathname;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // The build cache and a dev server's output are intermediate artefacts, not what ships.
      if (entry.name !== "cache" && entry.name !== "dev") yield* files(path);
    } else if (/\.(js|mjs|cjs|json|html|rsc|body)$/.test(entry.name)) yield path;
  }
}

/** Strings that exist only in the fixture API (router copy and seed data). */
const FIXTURE_MARKERS = ["Not available in fixture mode yet.", "Learning-rate warmup, explained"];
/**
 * Server-only env names from our WebEnv / AgentEnv schemas that must never reach the browser.
 * (BETTER_AUTH_SECRET is left out: better-auth's own client code names it in its env helper.)
 */
const SERVER_ENV_NAMES = [
  "DATABASE_URL",
  "VAULT_PUBLIC_KEY",
  "VAULT_PRIVATE_KEY",
  "NEKO_MEMBER_SECRET",
  "OPENAI_EMBEDDINGS_KEY",
  "S3_SECRET_ACCESS_KEY",
];

const findings: string[] = [];
for (const path of files(root)) {
  const text = readFileSync(path, "utf8");
  const rel = path.slice(root.length);
  for (const marker of FIXTURE_MARKERS) {
    if (text.includes(marker)) findings.push(`fixture code in ${rel}: "${marker}"`);
  }
  if (rel.startsWith("static/")) {
    for (const name of SERVER_ENV_NAMES) {
      if (text.includes(name)) findings.push(`server env name in client chunk ${rel}: ${name}`);
    }
  }
}

if (findings.length) {
  console.error(`Production bundle check failed (${findings.length}):\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("Production bundle check passed: no fixture code, no server env names in the client.");
