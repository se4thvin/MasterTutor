import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../vitest.config.ts";

const root = path.resolve(import.meta.dirname, "../..");

/** Spec §12 security tests: where each lives (paths from the repo root). The runner comes from the name. */
const INVENTORY: Record<string, readonly string[]> = {
  "1 secret canary": [
    "apps/agent/src/vault/security/canary.security.test.ts",
    "apps/agent/src/vault/security/url-secret.security.test.ts",
    "apps/web/components/bits/code-slots.security.test.ts",
    "tests/security/canary-core.test.ts",
    "tests/security/stack-canary.test.ts",
    "tests/security/stack-canary.ts",
  ],
  "2 origin pinning": ["apps/agent/src/vault/security/fill-pinning.security.test.ts"],
  "3 field type": ["apps/agent/src/vault/security/fill-pinning.security.test.ts"],
  "4 injection": [
    "apps/agent/src/vault/security/loop-injection.security.test.ts",
    "apps/agent/src/vault/security/fill-pinning.security.test.ts",
    "apps/web/e2e/stack/specs/bypass.spec.ts",
  ],
  "5 SSRF": [
    "apps/agent/src/browser/network-policy.test.ts",
    "apps/agent/src/browser/session.behaviour.test.ts",
    "tests/live/live-stack.int.test.ts",
  ],
  "6 slot reset": ["tests/behaviour/runs.behaviour.test.ts"],
  "7 downloads": [
    "apps/agent/src/browser/download-gate.behaviour.test.ts",
    "apps/web/e2e/stack/specs/downloads.spec.ts",
    "apps/web/e2e/stack/specs/takeover.spec.ts",
  ],
  "8 key placement": [
    "tests/security/key-placement.security.test.ts",
    "tests/compose/compose-config.int.test.ts",
  ],
  "9 tool list": ["apps/agent/src/llm/llm.test.ts"],
  "10 dependencies": [".github/workflows/ci.yml"],
  "live-view auth": ["tests/live/live-stack.int.test.ts"],
  "takeover lock": [
    "apps/agent/src/live/takeover.behaviour.test.ts",
    "tests/behaviour/runs.behaviour.test.ts",
    "apps/web/e2e/stack/specs/takeover.spec.ts",
  ],
  masking: ["tests/behaviour/runs.behaviour.test.ts"],
};

type Runner = "unit" | "integration" | "security" | "behaviour" | "e2e" | "e2e-scan" | "ci";
function runnerOf(file: string): Runner {
  if (file === ".github/workflows/ci.yml") return "ci";
  if (file === "tests/security/stack-canary.ts") return "e2e-scan";
  if (file.endsWith(".security.test.ts")) return "security";
  if (file.endsWith(".behaviour.test.ts")) return "behaviour";
  if (file.endsWith(".int.test.ts")) return "integration";
  if (file.endsWith(".spec.ts")) return "e2e";
  if (file.endsWith(".test.ts")) return "unit";
  throw new Error(`no runner collects ${file}`);
}

const SKIP = new Set([
  "node_modules",
  ".next",
  ".dist",
  "dist",
  ".worktrees",
  ".superpowers",
  ".out",
]);
function securityFiles(dir = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...securityFiles(rel));
    else if (rel.endsWith(".security.test.ts")) out.push(rel);
  }
  return out;
}
const allSecurityFiles = () => ["apps", "packages", "tests"].flatMap((dir) => securityFiles(dir));

// Matches the `<dir>/**/*<suffix>` include shape; any other shape fails loudly.
function matches(pattern: string, file: string): boolean {
  const shape = /^([^*]+)\/\*\*\/\*([^*/]+)$/.exec(pattern);
  if (!shape) throw new Error(`unsupported include pattern ${pattern}`);
  return file.startsWith(`${shape[1]}/`) && file.endsWith(shape[2]!);
}

interface ProjectShape {
  extends?: unknown;
  test?: { name?: string; include?: string[] };
}
const projects = (config.test?.projects ?? []) as unknown as ProjectShape[];

describe("§12 security inventory", () => {
  it("names a real file and a runner for every item", () => {
    for (const [item, files] of Object.entries(INVENTORY)) {
      expect(files.length, item).toBeGreaterThan(0);
      for (const file of files) {
        expect(existsSync(path.join(root, file)), `${item}: ${file}`).toBe(true);
        expect(() => runnerOf(file), file).not.toThrow();
      }
    }
  });

  it("lists every *.security.test.ts, so none runs unaccounted for", () => {
    const listed = new Set(Object.values(INVENTORY).flat());
    for (const file of allSecurityFiles()) expect(listed.has(file), file).toBe(true);
  });

  it("selects security tests by file name, in a project that shares the root config (P7-1, P7-31)", () => {
    const security = projects.find((project) => project.test?.name === "security");
    expect(security?.extends).toBe(true);
    const include = security?.test?.include ?? [];
    for (const dir of ["apps", "packages", "tests"])
      expect(include).toContain(`${dir}/**/*.security.test.ts`);
    for (const file of allSecurityFiles())
      expect(
        include.some((pattern) => matches(pattern, file)),
        file,
      ).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:security"]).toBe("vitest run --project security");
  });
});
