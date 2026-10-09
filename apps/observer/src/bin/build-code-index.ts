// Image build step (spec §7.5): node build-code-index.ts <context> <out.json>.
import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SECRET_SCRUB_PATTERNS } from "@mastertutor/contracts/telemetry";

const ROOTS = ["apps", "packages", "infra"];
const TEXT = /\.(ts|tsx|js|mjs|json|ya?ml|sql|css|sh|conf|toml)$/;
const DENY = [
  /(^|\/)\.env/,
  /\.(pem|key|p12|crt|der)$/,
  /(^|\/)(fixtures|testing|tests|__tests__|e2e|node_modules|\.next|dist|coverage)\//,
  /\.(test|spec)\.tsx?$/,
  /(^|\/)testing\.ts$/,
];
const MAX_FILE = 512 * 1024;
const scrub = (line: string) =>
  SECRET_SCRUB_PATTERNS.reduce((text, pattern) => text.replace(pattern, "****"), line);

/** Prune excluded directories before reading; never follow a symlink out of the snapshot. */
export async function buildIndex(
  context: string,
): Promise<Array<{ path: string; lines: string[] }>> {
  const files: Array<{ path: string; lines: string[] }> = [];
  const walk = async (path: string): Promise<void> => {
    if (DENY.some((rule) => rule.test(`${path}/`))) return;
    const stat = await lstat(join(context, path)).catch(() => null);
    if (!stat || stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      const entries = await readdir(join(context, path));
      for (const entry of entries.sort()) await walk(`${path}/${entry}`);
      return;
    }
    if (
      !stat.isFile() ||
      !TEXT.test(path) ||
      DENY.some((rule) => rule.test(path)) ||
      stat.size > MAX_FILE
    )
      return;
    const text = await readFile(join(context, path), "utf8");
    if (text.includes("\0") || text.includes("\uFFFD")) return;
    files.push({ path, lines: text.split("\n").map(scrub) });
  };
  for (const root of ROOTS) await walk(root);
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [context, out] = process.argv.slice(2);
  if (!context || !out) throw new Error("usage: build-code-index.ts <context> <out.json>");
  await writeFile(out, JSON.stringify(await buildIndex(context)));
}
