/**
 * Screenshot shooter for the D22 swarm. For one screen group it writes, per screen, QA width and
 * theme: a full-page PNG and a JSON holding fe's layout issues (44px targets on), the serious or
 * critical axe violations (fe's seriousA11yViolations, P8-23) and the shot's errors: a screen that
 * did not open, 5xx responses and page errors. A screen that fails is recorded and the group goes
 * on (QA-041); the exit code is 1 when any screen did not open. Runs in T1's e2e runner container
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
import { QA_RUN_ID, autoFindings, type Shot } from "./findings.ts";
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
const summary: {
  screen: string;
  width: number;
  theme: string;
  layout: number;
  axe: number;
  errors: number;
}[] = [];
const shots: Shot[] = [];
const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0]!.trim();
let unopened = 0;
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
          const errors = new Set<string>();
          page.on("pageerror", (error) => errors.add(`page error: ${firstLine(error)}`));
          page.on("response", (response) => {
            if (response.status() < 500) return;
            const { pathname } = new URL(response.url());
            errors.add(
              `server error: HTTP ${response.status()} ${response.request().method()} ${pathname}`,
            );
          });
          let opened = true;
          try {
            await openScreen(page, screen);
            await settle(page);
          } catch (error) {
            opened = false;
            unopened++;
            errors.add(`did not open: ${firstLine(error)}`);
          }
          const dir = join(root, screen.id);
          mkdirSync(dir, { recursive: true });
          const base = join(dir, `${vp.name}-${theme}`);
          // A screen that did not open is still shot when it can be: the swarm sees what was there.
          await page
            .screenshot({
              path: `${base}.png`,
              fullPage: true,
              animations: "disabled",
              caret: "hide",
            })
            .catch((error: unknown) => {
              if (opened) throw error;
            });
          const layout = opened ? await findLayoutIssues(page, { minTargetPx: 44 }) : [];
          const axe = opened ? await seriousA11yViolations(page) : [];
          const shot: Shot = {
            screen: screen.id,
            width: vp.width,
            theme,
            layout,
            axe,
            errors: [...errors],
          };
          writeFileSync(`${base}.json`, `${JSON.stringify(shot, null, 2)}\n`);
          shots.push(shot);
          summary.push({
            screen: screen.id,
            width: vp.width,
            theme,
            layout: layout.length,
            axe: axe.length,
            errors: shot.errors.length,
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
// The detector, axe and error findings with stable keys: the swarm copies them verbatim (I5).
writeFileSync(
  join(root, "auto-findings.json"),
  `${JSON.stringify(autoFindings(group, values.run, shots), null, 2)}\n`,
);
writeFileSync(join(root, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`qa:shoot: ${summary.length} shots for ${group} in apps/web/e2e/.out/qa/${values.run}`);
if (unopened > 0) {
  console.error(`qa:shoot: ${unopened} shots did not open; see auto-findings.json`);
  process.exitCode = 1;
}
