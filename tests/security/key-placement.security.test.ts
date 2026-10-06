import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// §12 test 8 (code half). The env half (web lacks VAULT_PRIVATE_KEY, slots lack vault and OpenAI
// keys) is pinned by Phase 0 Task 15's compose-config test; together they are §12.8.
const root = path.resolve(import.meta.dirname, "../..");
const SKIP = new Set(["node_modules", ".next", ".dist", "dist"]);

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) yield full;
  }
}

describe("vault key placement", () => {
  it("web code never references the private key, the next key or the opener", async () => {
    // apps/web/scripts is build-time tooling that never ships; its bundle check names the key to
    // prove the client output does not contain it.
    const tooling = path.join("apps", "web", "scripts");
    for await (const file of sourceFiles(path.join(root, "apps/web"))) {
      if (path.relative(root, file).startsWith(tooling)) continue;
      const text = await readFile(file, "utf8");
      expect(text, path.relative(root, file)).not.toMatch(
        /VAULT_PRIVATE_KEY|VAULT_NEXT_PRIVATE_KEY|@mastertutor\/sealing\/open|crypto_box_seal_open/,
      );
    }
  });

  it("only the agent imports the opener", async () => {
    for (const dir of ["apps", "packages"]) {
      for await (const file of sourceFiles(path.join(root, dir))) {
        const rel = path.relative(root, file);
        if (
          rel.startsWith(path.join("apps", "agent")) ||
          rel === path.join("packages", "sealing", "src", "open.ts")
        )
          continue;
        expect(await readFile(file, "utf8"), rel).not.toMatch(
          /@mastertutor\/sealing\/open|from "\.\/open\.ts"/,
        );
      }
    }
  });

  it("the web-importable sealing entry exports no way to open a box", async () => {
    const entry = await import("../../packages/sealing/src/index.ts");
    expect(Object.keys(entry).filter((name) => /open|private/i.test(name))).toEqual([]);
  });

  it("web depends on neither the IMAP client nor the TOTP generator", async () => {
    const pkg = JSON.parse(await readFile(path.join(root, "apps/web/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toEqual(expect.arrayContaining(["imapflow"]));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("otplib");
  });
});
