/**
 * First-load JS per App Router route, from a `next build` (Turbopack) output directory.
 * First load = the root main files + every JS file the route's client-reference manifest lists in
 * entryJSFiles (its layouts and page). Chunks reached only through import() are never listed there,
 * so lazy-loaded code (KaTeX, domMax, three) does not count. Sizes are gzip (Node default level).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

export interface FirstLoadBaseline {
  budgetKb: number;
  routes: Record<string, number>;
}

type RscManifest = Record<string, { entryJSFiles?: Record<string, string[]> }>;

function* manifestFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* manifestFiles(path);
    else if (entry.name === "page_client-reference-manifest.js") yield path;
  }
}

/** "/(app)/library/page" → "/library": route groups and the trailing /page are not in the URL. */
export function routeOf(manifestKey: string): string {
  const path = manifestKey.replace(/\/page$/, "").replace(/\/\([^)]+\)/g, "");
  return path === "" ? "/" : path;
}

const toKb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;

export function measureFirstLoad(nextDir: string): Record<string, number> {
  const build = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8")) as {
    rootMainFiles: string[];
  };
  const gzCache = new Map<string, number>();
  const gz = (file: string) => {
    let size = gzCache.get(file);
    if (size === undefined) {
      size = gzipSync(readFileSync(join(nextDir, file))).length;
      gzCache.set(file, size);
    }
    return size;
  };
  const result: Record<string, number> = {};
  for (const path of manifestFiles(join(nextDir, "server", "app"))) {
    // The manifest is a script that assigns globalThis.__RSC_MANIFEST; run it in an empty context.
    const context: { __RSC_MANIFEST?: RscManifest } = {};
    runInNewContext(readFileSync(path, "utf8"), context);
    for (const [key, manifest] of Object.entries(context.__RSC_MANIFEST ?? {})) {
      const route = routeOf(key);
      if (route.startsWith("/_")) continue;
      const files = new Set(build.rootMainFiles);
      for (const list of Object.values(manifest.entryJSFiles ?? {})) {
        for (const file of list) if (file.endsWith(".js")) files.add(file.replace(/^\//, ""));
      }
      result[route] = toKb([...files].reduce((sum, file) => sum + gz(file), 0));
    }
  }
  return result;
}

export function compareFirstLoad(
  current: Record<string, number>,
  baseline: FirstLoadBaseline,
): string[] {
  const findings: string[] = [];
  for (const [route, size] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
    const base = baseline.routes[route];
    if (base === undefined) {
      findings.push(
        `${route}: no baseline (run check:first-load -- --write-baseline and commit it)`,
      );
    } else if (size > base + baseline.budgetKb) {
      const growth = Math.round((size - base) * 10) / 10;
      findings.push(
        `${route}: ${size} kB gz exceeds baseline ${base} kB + ${baseline.budgetKb} kB budget (+${growth} kB)`,
      );
    }
  }
  return findings;
}
