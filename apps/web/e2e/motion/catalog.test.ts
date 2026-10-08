import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOTIONS, MOTION_INFRASTRUCTURE } from "./catalog.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("motion catalog (D28, P8-26, P8-29)", () => {
  it("covers every UI file that animates with motion, except the motion infrastructure", () => {
    const animated = ["apps/web/components", "apps/web/app", "apps/web/lib"]
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((file) => /from "motion\/react(?:-m)?"/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    const covered = new Set([...MOTIONS.flatMap((m) => m.files), ...MOTION_INFRASTRUCTURE]);
    expect(animated.filter((file) => !covered.has(file))).toEqual([]);
  });

  it("names only files that exist", () => {
    for (const file of [...MOTIONS.flatMap((m) => m.files), ...MOTION_INFRASTRUCTURE]) {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
  });

  it("has unique ids and single-selector scopes", () => {
    expect(new Set(MOTIONS.map((m) => m.id)).size).toBe(MOTIONS.length);
    for (const m of MOTIONS) expect(m.scope.includes(","), m.id).toBe(false);
  });
});
