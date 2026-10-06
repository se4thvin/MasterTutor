import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Spec §3.1: web seals with the public key and can never open a box. Two guards keep it so:
// lint refuses the agent-only entry in web code, and this scan refuses the private key's name.
const WEB = fileURLToPath(new URL("../../../", import.meta.url));
const ROOT = join(WEB, "../..");
const SKIP = new Set(["node_modules", ".next", "test-results", "playwright-report"]);
// The bundle check names the private key on purpose, to hunt for it in the build output.
const SKIP_FILES = new Set([join(WEB, "scripts/check-prod-bundle.ts")]);
const isTest = (file: string) => /\.(test|spec)\.tsx?$/.test(file);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !isTest(entry.name) && !SKIP_FILES.has(path)
      ? [path]
      : [];
  });
}

describe("vault key placement (W9)", () => {
  it("no production web file names the opening entry or the private key", () => {
    const offenders = sources(WEB).filter((file) =>
      /@mastertutor\/sealing\/open|VAULT_PRIVATE_KEY/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => relative(WEB, file))).toEqual([]);
  });

  it("lint refuses importing @mastertutor/sealing/open from web code, statically or dynamically", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const lint = async (code: string, file: string) =>
      (await eslint.lintText(code, { filePath: join(WEB, file) }))[0]!.messages.map(
        (message) => message.ruleId,
      );
    const statics = 'import { openSealed } from "@mastertutor/sealing/open";\nvoid openSealed;\n';
    const dynamic = 'void import("@mastertutor/sealing/open");\n';
    expect(await lint(statics, "lib/server/vault/x.ts")).toContain("no-restricted-imports");
    expect(await lint(dynamic, "lib/server/vault/x.ts")).toContain("no-restricted-syntax");
    // The one sanctioned exception: the integration test that plays the agent (W9), by name.
    expect(await lint(statics, "lib/server/rpc/vault.int.test.ts")).not.toContain(
      "no-restricted-imports",
    );
    expect(await lint(statics, "lib/server/rpc/x.int.test.ts")).toContain("no-restricted-imports");
  });

  it("scans build scripts too, skipping only the bundle check that names the key on purpose", () => {
    const scanned = sources(WEB).map((file) => relative(WEB, file));
    expect(scanned).toContain("scripts/generate-motion-css.ts");
    expect(scanned).not.toContain("scripts/check-prod-bundle.ts");
  });
});
