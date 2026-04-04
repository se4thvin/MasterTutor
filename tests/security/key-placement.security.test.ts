import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// §12 test 8 (code half). The env half (web lacks VAULT_PRIVATE_KEY, slots lack vault and OpenAI
// keys) is pinned by Phase 0 Task 15's compose-config test; together they are §12.8.
const root = path.resolve(import.meta.dirname, "../..");
const SKIP = new Set(["node_modules", ".next", ".dist", "dist"]);
/** Every way to reach the opening entry: the package export, a deep path, a relative path. */
const OPENER =
  /@mastertutor\/sealing\/open|@mastertutor\/sealing\/src\/open|sealing\/src\/open(\.ts)?["']|from "\.\/open(\.ts)?"/;
const KEY = /VAULT_PRIVATE_KEY|VAULT_NEXT_PRIVATE_KEY|crypto_box_seal_open/;
const SOURCE = /\.(c|m)?(j|t)sx?$/;
const TEST = /\.test\.(c|m)?(j|t)sx?$/;
/** Inside `dir` (a path relative to the repo root), not merely sharing its name as a prefix. */
const within = (rel: string, dir: string) => rel === dir || rel.startsWith(`${dir}${path.sep}`);

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) yield full;
  }
}

describe("vault key placement", () => {
  it("the scan itself sees every import form and source extension (review)", () => {
    for (const line of [
      'import { open } from "@mastertutor/sealing/open";',
      'import { open } from "@mastertutor/sealing/src/open.ts";',
      'import { open } from "../../../packages/sealing/src/open.ts";',
      "const open = require('../sealing/src/open');",
      'export * from "./open.ts";',
    ])
      expect(line).toMatch(OPENER);
    for (const name of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.mts", "a.cts"])
      expect(name).toMatch(SOURCE);
    expect(
      within(
        path.join("apps", "web", "scripts-extra", "x.ts"),
        path.join("apps", "web", "scripts"),
      ),
    ).toBe(false);
    expect(within(path.join("apps", "agent-tools", "x.ts"), path.join("apps", "agent"))).toBe(
      false,
    );
  });

  it("web code never references the private key, the next key or the opener", async () => {
    // apps/web/scripts is build-time tooling that never ships; its bundle check names the key to
    // prove the client output does not contain it.
    const tooling = path.join("apps", "web", "scripts");
    for await (const file of sourceFiles(path.join(root, "apps/web"))) {
      const rel = path.relative(root, file);
      if (within(rel, tooling)) continue;
      const text = await readFile(file, "utf8");
      expect(text, rel).not.toMatch(KEY);
      expect(text, rel).not.toMatch(OPENER);
    }
  });

  it("only the agent imports the opener", async () => {
    for (const dir of ["apps", "packages"]) {
      for await (const file of sourceFiles(path.join(root, dir))) {
        const rel = path.relative(root, file);
        if (
          within(rel, path.join("apps", "agent")) ||
          rel === path.join("packages", "sealing", "src", "open.ts")
        )
          continue;
        expect(await readFile(file, "utf8"), rel).not.toMatch(OPENER);
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
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("imapflow");
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("otplib");
  });
});
