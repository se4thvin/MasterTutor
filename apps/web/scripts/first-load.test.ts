import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  HERO_BUDGET_KB,
  compareFirstLoad,
  compareHeroBundle,
  measureFirstLoad,
  measureHeroBundle,
  routeOf,
} from "./first-load.ts";

const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;

function fakeBuild() {
  const dir = mkdtempSync(join(tmpdir(), "first-load-"));
  mkdirSync(join(dir, "static/chunks"), { recursive: true });
  const files = {
    "static/chunks/root.js": randomBytes(6000).toString("hex"),
    "static/chunks/layout.js": randomBytes(3000).toString("hex"),
    "static/chunks/page.js": randomBytes(2000).toString("hex"),
    "static/chunks/lazy.js": randomBytes(9000).toString("hex"),
  };
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body);
  writeFileSync(
    join(dir, "build-manifest.json"),
    JSON.stringify({ rootMainFiles: ["static/chunks/root.js"] }),
  );
  const manifest = (key: string, entries: Record<string, string[]>) =>
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n` +
    `globalThis.__RSC_MANIFEST[${JSON.stringify(key)}] = ${JSON.stringify({ entryJSFiles: entries, entryCSSFiles: {} })};`;
  mkdirSync(join(dir, "server/app/(app)/library"), { recursive: true });
  writeFileSync(
    join(dir, "server/app/(app)/library/page_client-reference-manifest.js"),
    manifest("/(app)/library/page", {
      "[project]/apps/web/app/layout": ["static/chunks/layout.js"],
      "[project]/apps/web/app/(app)/library/page": [
        "static/chunks/layout.js",
        "static/chunks/page.js",
        "static/chunks/page.css",
      ],
    }),
  );
  mkdirSync(join(dir, "server/app/_not-found"), { recursive: true });
  writeFileSync(
    join(dir, "server/app/_not-found/page_client-reference-manifest.js"),
    manifest("/_not-found/page", { "[project]/x": ["static/chunks/page.js"] }),
  );
  const gz = (path: keyof typeof files) => gzipSync(files[path]).length;
  return { dir, gz };
}

describe("routeOf", () => {
  it.each([
    ["/(app)/library/page", "/library"],
    ["/(app)/notes/[noteId]/page", "/notes/[noteId]"],
    ["/(auth)/sign-in/page", "/sign-in"],
    ["/page", "/"],
  ])("%s → %s", (key, route) => expect(routeOf(key)).toBe(route));
});

describe("measureFirstLoad", () => {
  it("sums root and entry JS once each, skipping CSS, lazy chunks and /_ routes", () => {
    const { dir, gz } = fakeBuild();
    expect(measureFirstLoad(dir)).toEqual({
      "/library": kb(
        gz("static/chunks/root.js") + gz("static/chunks/layout.js") + gz("static/chunks/page.js"),
      ),
    });
  });
});

describe("compareFirstLoad", () => {
  const baseline = { budgetKb: 6, routes: { "/library": 384.6, "/vault": 385.2 } };
  it("passes growth within the budget", () => {
    expect(compareFirstLoad({ "/library": 390.5, "/vault": 385.2 }, baseline)).toEqual([]);
  });
  it("names a route that grew past the budget", () => {
    expect(compareFirstLoad({ "/library": 390.7, "/vault": 385.2 }, baseline)).toEqual([
      "/library: 390.7 kB gz exceeds baseline 384.6 kB + 6 kB budget (+6.1 kB)",
    ]);
  });
  it("asks for a baseline for a new route", () => {
    expect(compareFirstLoad({ "/library": 384.6, "/runs/[runId]": 400 }, baseline)).toEqual([
      "/runs/[runId]: no baseline (run check:first-load -- --write-baseline and commit it)",
    ]);
  });
});

describe("measureHeroBundle (F5 P4)", () => {
  it("finds the lazy three chunk and reports one that leaked into first load", () => {
    const { dir } = fakeBuild();
    writeFileSync(
      join(dir, "static/chunks/hero.js"),
      `isWebGLRenderer ${randomBytes(4000).toString("hex")}`,
    );
    const lazy = measureHeroBundle(dir);
    expect(lazy.files).toEqual(["static/chunks/hero.js"]);
    expect(lazy.leaked).toEqual([]);
    expect(lazy.kb).toBeGreaterThan(0);
    writeFileSync(join(dir, "static/chunks/page.js"), "isWebGLRenderer");
    expect(measureHeroBundle(dir).leaked).toEqual(["static/chunks/page.js"]);
  });
});

describe("compareHeroBundle", () => {
  it("passes a lazy chunk within the budget", () => {
    expect(compareHeroBundle({ files: ["a.js"], kb: 139.2, leaked: [] }, HERO_BUDGET_KB)).toEqual(
      [],
    );
  });
  it("names a missing, oversized or leaked hero", () => {
    expect(compareHeroBundle({ files: [], kb: 0, leaked: [] }, 150)).toEqual([
      "hero: no chunk contains three (is the lazy hero import wired?)",
    ]);
    expect(compareHeroBundle({ files: ["a.js"], kb: 151.3, leaked: [] }, 150)).toEqual([
      "hero: 151.3 kB gz exceeds the 150 kB budget",
    ]);
    expect(compareHeroBundle({ files: ["a.js"], kb: 10, leaked: ["a.js"] }, 150)).toEqual([
      "hero: three is in first-load JS (a.js)",
    ]);
  });
});
