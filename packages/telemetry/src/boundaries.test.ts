import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
/** Source files under a repo directory (a walk, not git: the remote test host has no .git). */
const files = (dir: string) =>
  existsSync(new URL(dir, root))
    ? readdirSync(new URL(dir, root), { recursive: true, encoding: "utf8" })
        .map((file) => `${dir}/${file}`)
        .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    : [];
const imports = (file: string) =>
  [...readFileSync(new URL(file, root), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);

describe("module dependency map (plan: no cycles, spec §4.3)", () => {
  it("telemetry imports only contracts and OTel", () => {
    for (const file of files("packages/telemetry/src"))
      for (const spec of imports(file))
        expect(spec, file).toMatch(/^(\.|node:|@opentelemetry\/|@mastertutor\/contracts)/);
  });

  it("observability imports only contracts and zod", () => {
    for (const file of files("packages/observability/src"))
      for (const spec of imports(file))
        expect(spec, file).toMatch(/^(\.|node:|zod$|@mastertutor\/contracts)/);
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
});
