import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = new URL("./", import.meta.url);
const sheets = readdirSync(styles)
  .filter((f) => f.endsWith(".css") && f !== "tokens.css" && f !== "motion.css")
  .map((f) => [f, readFileSync(new URL(f, styles), "utf8")] as const);

function filesUnder(dir: URL): Array<readonly [string, string]> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) return filesUnder(url);
    return entry.name.endsWith(".tsx") ? [[url.pathname, readFileSync(url, "utf8")] as const] : [];
  });
}
const components = filesUnder(new URL("../components/", import.meta.url));

/** Raw colour literals: hex in CSS, and rgb()/hsl() anywhere. tokens.css is the only home for them. */
const RAW_CSS = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i;
const RAW_TSX = /\b(rgba?|hsla?)\(|["'`]#[0-9a-f]{3,8}["'`]/i;

describe("one source for colours, shadows and glass", () => {
  it.each(sheets)("%s has no raw colour values", (_name, css) => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(RAW_CSS);
  });

  it("component code has no raw colour values", () => {
    for (const [path, tsx] of components) expect(tsx, path).not.toMatch(RAW_TSX);
  });

  it("writes the glass blur recipe exactly once, in .glass", () => {
    // Declarations only: an @supports (backdrop-filter: …) condition is not a second recipe.
    const uses = sheets.flatMap(([name, css]) =>
      [...css.matchAll(/(?<!-webkit-|\()backdrop-filter:/g)].map(() => name),
    );
    expect(uses).toEqual(["components.css"]);
  });

  it("never writes -webkit-backdrop-filter by hand: the minifier kept only it, and Chromium lost the blur", () => {
    for (const [name, css] of sheets) {
      expect(css.replace(/\/\*[\s\S]*?\*\//g, ""), name).not.toMatch(/-webkit-backdrop-filter/);
    }
  });
});
