/**
 * Screenshot shooter for the D22 swarm. For one screen group it writes, per screen, QA width and
 * theme: a full-page PNG and a JSON holding fe's layout issues (44px targets on) and the serious or
 * critical axe violations (fe's seriousA11yViolations, P8-23). Runs in T1's e2e runner container
 * (Traefik's namespace) via scripts/qa-stack.sh shoot; remotely pnpm qa:shoot →
 * scripts/remote-test.sh qa shoot. Output: apps/web/e2e/.out/qa/<run>/ (fetched back by T1's runner).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { seriousA11yViolations } from "../../helpers/a11y.ts";
import { QA_VIEWPORTS } from "../../helpers/breakpoints.ts";
import { settle } from "../../helpers/clean-screen.ts";
import { findLayoutIssues } from "../../helpers/layout-qa.ts";
import { chromium } from "@playwright/test";
import { AUTH_STATE, BASE_URL } from "../support/env.ts";
import { QA_RUN_ID } from "./findings.ts";
import { openScreen } from "./qa-page.ts";
import { SCREEN_GROUPS, SCREENS } from "./screens.ts";

const { values } = parseArgs({
  strict: true,
  options: { group: { type: "string" }, run: { type: "string" } },
});
const group = SCREEN_GROUPS.find((g) => g === values.group);
if (!group || !values.run || !QA_RUN_ID.test(values.run)) {
  throw new Error(
    `usage: qa:shoot --group <${SCREEN_GROUPS.join("|")}> --run <YYYY-MM-DD-NN-test-qa-…>`,
  );
}
const root = join(fileURLToPath(new URL("../../.out/qa/", import.meta.url)), values.run);
const summary: { screen: string; width: number; theme: string; layout: number; axe: number }[] = [];
const browser = await chromium.launch();
try {
  for (const screen of SCREENS.filter((s) => s.group === group)) {
    for (const vp of QA_VIEWPORTS) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          baseURL: BASE_URL,
          ...(screen.signedOut ? {} : { storageState: AUTH_STATE }),
          viewport: { width: vp.width, height: vp.height },
          hasTouch: vp.width <= 820,
          colorScheme: theme,
          reducedMotion: "reduce",
          locale: "en-US",
          timezoneId: "UTC",
        });
        try {
          const page = await context.newPage();
          await openScreen(page, screen);
          await settle(page);
          const dir = join(root, screen.id);
          mkdirSync(dir, { recursive: true });
          const base = join(dir, `${vp.name}-${theme}`);
          await page.screenshot({
            path: `${base}.png`,
            fullPage: true,
            animations: "disabled",
            caret: "hide",
          });
          const layout = await findLayoutIssues(page, { minTargetPx: 44 });
          const axe = await seriousA11yViolations(page);
          writeFileSync(
            `${base}.json`,
            `${JSON.stringify({ screen: screen.id, width: vp.width, theme, layout, axe }, null, 2)}\n`,
          );
          summary.push({
            screen: screen.id,
            width: vp.width,
            theme,
            layout: layout.length,
            axe: axe.length,
          });
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(root, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`qa:shoot: ${summary.length} shots for ${group} in apps/web/e2e/.out/qa/${values.run}`);
