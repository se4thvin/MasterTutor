import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Benchmark site names, and the consent vendor its pages use. Benchmarks must measure generic ability (D32). */
const SITE = /zybook|osano/i;
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".dist",
  "coverage",
  "test-results",
  "playwright-report",
  "e2e",
  "testing",
]);
const TEXT = /\.(?:[cm]?[jt]sx?|json|css|sql|ya?ml|html|sh|conf|toml)$/;
const isTest = (name: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return TEXT.test(name) && !isTest(name) ? [path] : [];
  });
}

/** Product source: apps, packages, infra and scripts (tests/ is the harness), plus the compose files. */
function offenders(root: string): string[] {
  const files = [
    ...["apps", "packages", "infra", "scripts"].flatMap((dir) => {
      try {
        return walk(join(root, dir));
      } catch {
        return [];
      }
    }),
    ...readdirSync(root)
      .filter((name) => /^compose.*\.ya?ml$/.test(name))
      .map((name) => join(root, name)),
  ];
  return files
    .filter((file) => SITE.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));
}

describe("no site-specific logic in product code (P10b-1)", () => {
  it("finds no benchmark site name in product source", () => {
    expect(offenders(ROOT)).toEqual([]);
  });
  it("catches a planted offender and ignores tests (the rule is not vacuous)", () => {
    const root = mkdtempSync(join(tmpdir(), "nsh-"));
    mkdirSync(join(root, "apps", "x"), { recursive: true });
    writeFileSync(
      join(root, "apps", "x", "hack.ts"),
      'if (url.includes("learn.zybooks.com")) dismissOsano();',
    );
    writeFileSync(join(root, "apps", "x", "hack.test.ts"), '"learn.zybooks.com"');
    writeFileSync(join(root, "compose.extra.yml"), "# zybooks");
    expect(offenders(root).sort()).toEqual(["apps/x/hack.ts", "compose.extra.yml"]);
  });
});
