/**
 * Fails when any route's first-load JS grew past its committed baseline + budget (D43 delight pass:
 * delight is welcome, unbounded weight is not). Run after a production `next build`.
 *   pnpm --filter @mastertutor/web check:first-load                     check
 *   pnpm --filter @mastertutor/web check:first-load -- --write-baseline  rewrite routes, keep budget
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HERO_BUDGET_KB,
  compareFirstLoad,
  compareHeroBundle,
  measureFirstLoad,
  measureHeroBundle,
  type FirstLoadBaseline,
} from "./first-load.ts";

const nextDir = fileURLToPath(new URL("../.next/", import.meta.url));
const baselineUrl = new URL("./first-load-baseline.json", import.meta.url);
const DEFAULT_BUDGET_KB = 6;

const current = measureFirstLoad(nextDir);
const previous: FirstLoadBaseline = existsSync(baselineUrl)
  ? (JSON.parse(readFileSync(baselineUrl, "utf8")) as FirstLoadBaseline)
  : { budgetKb: DEFAULT_BUDGET_KB, routes: {} };

for (const [route, size] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
  const base = previous.routes[route];
  const delta =
    base === undefined ? "new" : `${size - base >= 0 ? "+" : ""}${(size - base).toFixed(1)}`;
  console.log(`${route.padEnd(24)} ${size.toFixed(1).padStart(7)} kB gz  (${delta})`);
}

if (process.argv.includes("--write-baseline")) {
  // Sorted, so the committed file does not churn with the filesystem's directory order.
  const routes = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  const next: FirstLoadBaseline = { budgetKb: previous.budgetKb, routes };
  writeFileSync(baselineUrl, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Baseline written (${Object.keys(current).length} routes).`);
} else {
  const hero = measureHeroBundle(nextDir);
  console.log(
    `hero (lazy three)        ${hero.kb.toFixed(1).padStart(7)} kB gz  (${hero.files.length} chunk(s), budget ${HERO_BUDGET_KB} kB)`,
  );
  const findings = [
    ...compareFirstLoad(current, previous),
    ...compareHeroBundle(hero, HERO_BUDGET_KB),
  ];
  if (findings.length) {
    console.error(`First-load JS budget exceeded (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(
    `First-load JS within budget (+${previous.budgetKb} kB gz per route); hero within ${HERO_BUDGET_KB} kB.`,
  );
}
