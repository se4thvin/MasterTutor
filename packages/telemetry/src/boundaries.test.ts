import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
/** Source files under a repo directory (a walk, not git: the remote test host has no .git). */
const files = (dir: string): string[] => {
  if (!existsSync(new URL(dir, root))) return [];
  return readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) => {
    // Prune before walking: generated trees are outside the source dependency map.
    if (["node_modules", ".next", "dist", "coverage"].includes(entry.name)) return [];
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return files(path);
    return entry.isFile() && /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
};
const imports = (file: string) =>
  [...readFileSync(new URL(file, root), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);

describe("module dependency map (plan: no cycles, spec §4.3)", () => {
  it("telemetry imports only contracts and OTel", () => {
    for (const file of files("packages/telemetry/src"))
      for (const spec of imports(file))
        expect(spec, file).toMatch(/^(\.|node:|@opentelemetry\/|@mastertutor\/contracts)/);
  });

  it("observability imports only contracts and zod (its test-only testing.ts adds testcontainers)", () => {
    for (const file of files("packages/observability/src"))
      for (const spec of imports(file))
        expect(spec, file).toMatch(
          file.endsWith("/testing.ts")
            ? /^(\.|node:|zod$|@mastertutor\/contracts|testcontainers$)/
            : /^(\.|node:|zod$|@mastertutor\/contracts)/,
        );
  });

  it("contracts imports no workspace package, and OTel only in the log bridge", () => {
    for (const file of files("packages/contracts/src"))
      for (const spec of imports(file)) {
        expect(spec, file).not.toMatch(/^@mastertutor\//);
        if (spec.startsWith("@opentelemetry/"))
          expect(file).toBe("packages/contracts/src/server/log-bridge.ts");
      }
  });

  it("db reaches telemetry through ./record only", () => {
    for (const file of files("packages/db/src"))
      for (const spec of imports(file).filter((s) => s.startsWith("@mastertutor/telemetry")))
        expect(spec, file).toBe("@mastertutor/telemetry/record");
  });

  it("observer imports only contracts, zod and node", () => {
    for (const file of files("packages/observer/src"))
      for (const spec of imports(file))
        expect(spec, file).toMatch(/^(\.|node:|zod$|@mastertutor\/contracts)/);
  });

  it("the agent reaches the observer core through ./guard only", () => {
    for (const file of files("apps/agent/src"))
      for (const spec of imports(file).filter((s) => s.startsWith("@mastertutor/observer")))
        expect(spec, file).toMatch(/^@mastertutor\/observer(\/guard)?$/);
  });

  it("the observer service uses ./copilot and observability/query only, and nothing imports it", () => {
    for (const file of files("apps/observer/src"))
      for (const spec of imports(file)) {
        if (spec.startsWith("@mastertutor/observer"))
          expect(spec, file).toMatch(/^@mastertutor\/observer(\/copilot)?$/);
        if (spec.startsWith("@mastertutor/observability"))
          expect(spec, file).toBe("@mastertutor/observability/query");
      }
    for (const dir of ["apps/agent/src", "apps/web", "packages"])
      for (const file of files(dir).filter((f) => !f.includes("node_modules")))
        for (const spec of imports(file)) expect(spec, file).not.toMatch(/apps\/observer/);
  });

  it("web imports neither the observer core nor observability", () => {
    for (const dir of ["apps/web/app", "apps/web/components", "apps/web/lib"])
      for (const file of files(dir))
        for (const spec of imports(file))
          expect(spec, file).not.toMatch(/^@mastertutor\/(observer|observability)/);
  });

  it("no running service but the observer imports observability, and only ./query", () => {
    for (const dir of [
      "apps/agent/src",
      "packages/db/src",
      "packages/telemetry/src",
      "packages/storage/src",
    ])
      for (const file of files(dir))
        for (const spec of imports(file))
          expect(spec, file).not.toMatch(/^@mastertutor\/observability/);
  });
});
