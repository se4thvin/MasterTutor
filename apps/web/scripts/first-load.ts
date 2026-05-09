/**
 * First-load JS per App Router route, from a `next build` (Turbopack) output directory.
 * First load = the root main files + every JS file the route's client-reference manifest lists in
 * entryJSFiles (its layouts and page). Chunks reached only through import() are never listed there,
 * so lazy-loaded code (KaTeX, domMax, three) does not count. Sizes are gzip (Node default level).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
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

/** Every route's first-load JS files (root main files + entryJSFiles), relative to nextDir. */
function routeFiles(nextDir: string): Record<string, string[]> {
  const build = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8")) as {
    rootMainFiles: string[];
  };
  const result: Record<string, string[]> = {};
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
      result[route] = [...files];
    }
  }
  return result;
}

export function measureFirstLoad(nextDir: string): Record<string, number> {
  const gzCache = new Map<string, number>();
  const gz = (file: string) => {
    let size = gzCache.get(file);
    if (size === undefined) {
      size = gzipSync(readFileSync(join(nextDir, file))).length;
      gzCache.set(file, size);
    }
    return size;
  };
  return Object.fromEntries(
    Object.entries(routeFiles(nextDir)).map(([route, files]) => [
      route,
      toKb(files.reduce((sum, file) => sum + gz(file), 0)),
    ]),
  );
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

/** Spec §11.2: raw three, tree-shaken, at most 150 kB gz, and only ever loaded lazily. */
export const HERO_BUDGET_KB = 150;

interface HeroBundle {
  /** Static chunks that contain three (relative to nextDir), sorted. */
  files: string[];
  kb: number;
  /** Hero chunks that some route loads on first load: three leaked out of the lazy import. */
  leaked: string[];
}

function* staticJs(dir: string, base: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* staticJs(path, base);
    else if (entry.name.endsWith(".js")) yield relative(base, path);
  }
}

/** Turbopack's async loader lists a lazy import's whole chunk group: Promise.all(["static/…js", …]). */
const CHUNK_GROUP = /Promise\.all\(\[((?:"static\/[^"]+\.js",?)+)\]/g;

export function measureHeroBundle(nextDir: string, marker = "isWebGLRenderer"): HeroBundle {
  const firstLoad = new Set(Object.values(routeFiles(nextDir)).flat());
  const sources = new Map(
    [...staticJs(join(nextDir, "static"), nextDir)].map((file) => [
      file,
      readFileSync(join(nextDir, file), "utf8"),
    ]),
  );
  const three = new Set([...sources].filter(([, body]) => body.includes(marker)).map(([f]) => f));
  // Every chunk loaded together with three counts: the scene modules may be split from it (M4).
  const hero = new Set(three);
  for (const body of sources.values()) {
    for (const match of body.matchAll(CHUNK_GROUP)) {
      const group = (JSON.parse(`[${match[1]}]`) as string[]).filter((f) => sources.has(f));
      if (group.some((file) => three.has(file))) for (const file of group) hero.add(file);
    }
  }
  const files = [...hero].sort();
  const bytes = files.reduce(
    (sum, file) => sum + gzipSync(readFileSync(join(nextDir, file))).length,
    0,
  );
  return { files, kb: toKb(bytes), leaked: files.filter((file) => firstLoad.has(file)) };
}

export function compareHeroBundle(hero: HeroBundle, budgetKb: number): string[] {
  if (hero.files.length === 0)
    return ["hero: no chunk contains three (is the lazy hero import wired?)"];
  const findings = hero.leaked.map((file) => `hero: three is in first-load JS (${file})`);
  if (hero.kb > budgetKb) findings.push(`hero: ${hero.kb} kB gz exceeds the ${budgetKb} kB budget`);
  return findings;
}
