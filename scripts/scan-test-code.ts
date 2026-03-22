/**
 * Lists test code under a directory: *.test.ts files, testing/ directories, and any source file
 * that imports a test framework (vitest, testcontainers, @playwright/test). These rules are the
 * agent image check's own, independent of how the Dockerfile prunes (carry-over 5).
 * Usage: node scripts/scan-test-code.ts <dir>   (prints offenders, exits 1 when there are any)
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const TEST_IMPORT =
  /\bfrom\s+["'](vitest|testcontainers|@playwright\/test)["']|\bimport\s*\(?\s*["'](vitest|testcontainers|@playwright\/test)["']/;

export async function scanTestCode(root: string): Promise<string[]> {
  const offenders: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "testing") offenders.push(relative(root, path));
        else await visit(path);
      } else if (/\.test\.[cm]?[tj]sx?$/.test(entry.name)) {
        offenders.push(relative(root, path));
      } else if (
        /\.[cm]?[tj]sx?$/.test(entry.name) &&
        TEST_IMPORT.test(await readFile(path, "utf8"))
      ) {
        offenders.push(relative(root, path));
      }
    }
  }
  await visit(root);
  return offenders.sort();
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) {
    process.stderr.write("usage: node scan-test-code.ts <dir>\n");
    process.exit(2);
  }
  const offenders = await scanTestCode(root);
  for (const path of offenders) process.stdout.write(`${path}\n`);
  process.exit(offenders.length > 0 ? 1 : 0);
}
