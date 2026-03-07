import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function sources(dir: URL): Array<[string, string]> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) return sources(url);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [
          [url.pathname.split("/apps/web/")[1] ?? entry.name, readFileSync(url, "utf8")] as [
            string,
            string,
          ],
        ]
      : [];
  });
}

describe("module layering (principle 5, M8)", () => {
  it("lib/ never imports from components/, not even types", () => {
    const offenders = sources(new URL("./", import.meta.url)).flatMap(([path, code]) =>
      [...code.matchAll(/from\s+["']((?:@\/|(?:\.\.\/)+)components\/[^"']+)["']/g)].map(
        (m) => `${path} -> ${m[1]}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
