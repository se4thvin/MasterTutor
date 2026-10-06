import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const web = new URL("../", import.meta.url);

function sources(dir: URL): Array<[string, string]> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".next", "test-results", "playwright-report"].includes(entry.name)) {
      return [];
    }
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) return sources(url);
    return /\.(tsx?|mts)$/.test(entry.name)
      ? [
          [url.pathname.split("/apps/web/")[1] ?? entry.name, readFileSync(url, "utf8")] as [
            string,
            string,
          ],
        ]
      : [];
  });
}

const all = sources(web);
const DECLARED =
  /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

describe("small public interfaces (principle 4, M7)", () => {
  it("every export in components/ and lib/ is used by another module (tests count)", () => {
    const unused: string[] = [];
    for (const [path, code] of all) {
      if (
        !/^(components|lib)\//.test(path) ||
        /\.test\.tsx?$/.test(path) ||
        path.endsWith(".d.ts")
      ) {
        continue;
      }
      for (const [, name] of code.matchAll(DECLARED)) {
        const word = new RegExp(`\\b${name?.replace(/\$/g, "\\$")}\\b`);
        const usedElsewhere = all.some(([other, text]) => other !== path && word.test(text));
        if (!usedElsewhere) unused.push(`${path}: ${name}`);
      }
    }
    expect(unused).toEqual([]);
  });
});
