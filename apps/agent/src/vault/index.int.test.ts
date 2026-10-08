import { createLogger } from "@mastertutor/contracts/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../tests/fixtures/vault-sites/server.ts";
import { ControlGuard } from "../browser/guard.ts";
import { withHooks } from "../loop/hooks.ts";
import type { LoopBrowser } from "../loop/loop-browser.ts";
import type { RunSnapshot } from "../loop/run-state.ts";
import { slotBrowserConnector } from "../loop/session-browser.ts";
import { instantClock } from "../runtime/clock.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { SlotPool } from "../slots/pool.ts";
import { createVault, vaultHooks, type Vault } from "./index.ts";
import { chromiumArgsFor } from "./testing/browser.ts";
import { startChromium, type LocalChromium } from "./testing/chromium.ts";
import { startVaultTestEnv, type VaultTestEnv } from "./testing/env.ts";

const zybooks = "https://learn.zybooks.com";
const silent = createLogger({ service: "vault-test", level: "silent" });
const signal = new AbortController().signal;
let env: VaultTestEnv;
let vault: Vault;
let fx: VaultFixtures;
let chromium: LocalChromium;
let login: string;
const run = () => ({ workspaceId: env.workspaceId, allowedOrigins: [zybooks] });

beforeAll(async () => {
  env = await startVaultTestEnv();
  fx = await startVaultFixtures({
    account: { email: "me@example.test", password: "pw", totpSeed: "JBSWY3DPEHPK3PXP", pin: "1" },
    mail: null,
  });
  login = fx.origin("login");
  chromium = await startChromium(chromiumArgsFor([]));
  vault = createVault({ db: env.agent.db, keys: env.keys, log: env.log.logger, testMode: true });
  await env.seedItem({
    alias: "zybooks",
    origin: zybooks,
    secrets: { username: "KITE7CANARY3@example.test", password: "MARMOT4CANARY8VELVET" },
  });
  await env.seedItem({
    alias: "elsewhere",
    origin: "https://other.example",
    secrets: { password: "x-y-z-1" },
  });
  await env.seedItem({ alias: "site", origin: login, secrets: { password: "pw" } });
  await env.owner
    .sql`update vault_items set label = 'My private zyBooks account' where alias = 'zybooks'`;
});
afterAll(async () => {
  await chromium?.stop();
  await fx?.close();
  await env?.stop();
});

/** B1's real slot connector, with the vault plugged in only through its hooks (F3). */
async function connect(runId: string): Promise<{ browser: LoopBrowser; close(): Promise<void> }> {
  const pool = new SlotPool({
    store: {
      markIdle: async () => true,
      reclaimExpired: async () => [],
      listRestarting: async () => [],
    },
    slots: ["browser-1"],
    cdpBaseUrl: async () => chromium.cdpBaseUrl,
    config: runtimeConfig(),
    log: silent,
  });
  const connector = slotBrowserConnector({
    cdpBaseUrl: async () => chromium.cdpBaseUrl,
    pool,
    hooks: withHooks(vaultHooks(vault)),
    clock: instantClock(),
    config: runtimeConfig(),
    testMode: true,
    log: silent,
  });
  const snapshot = {
    id: runId,
    workspaceId: env.workspaceId,
    allowedOrigins: fx.origins,
    toolProfile: "browser_use",
  } as RunSnapshot;
  return connector({ slotName: "browser-1", run: () => snapshot, guard: new ControlGuard() });
}

/** The read_page ref of the first element whose accessible name starts with `name`. */
async function refNamed(browser: LoopBrowser, name: string): Promise<string> {
  const { output } = await browser.runFunction(
    "read_page",
    { mode: "interactive", sinceHash: null },
    signal,
    null,
  );
  const match = new RegExp(`"ref":"(e\\d+)","tag":"[a-z]+","role":"[^"]*","name":"${name}`).exec(
    output,
  );
  if (!match?.[1]) throw new Error(`no element named ${name}`);
  return match[1];
}

describe("createVault / vaultHooks", () => {
  it("plugs into B1 through hooks only: tools, masks, sessions, prompt, click, release", () => {
    const hooks = vaultHooks(vault);
    expect(Object.keys(hooks).sort()).toEqual(
      [
        "functionTools",
        "maskSources",
        "onClick",
        "onReleased",
        "promptContext",
        "sessionStore",
      ].sort(),
    );
    expect(hooks.functionTools?.map((tool) => tool.name)).toEqual([
      "fill_credential",
      "use_passkey",
    ]);
  });

  it("lists aliases, origins and fields of this run's sites only: no labels, usernames or values (F14, R-E18)", async () => {
    const [text, ...rest] = await vault.promptContext(run());
    expect(rest).toEqual([]);
    expect(text).toContain(`zybooks (${zybooks}): username, password, otp`);
    for (const absent of ["elsewhere", "My private", "KITE7CANARY3", "MARMOT4CANARY8VELVET"])
      expect(text).not.toContain(absent);
    expect(
      await vault.promptContext({ ...run(), allowedOrigins: ["https://none.example"] }),
    ).toEqual([]);
  });

  it("raises each credential tool's card through B1's real loop browser, from the live page (N9)", async () => {
    const runId = await env.newRun([login]);
    const attached = await connect(runId);
    const { browser } = attached;
    try {
      await browser.navigate(`${login}/offsite-form`, signal);
      const fill = (field: string, target: string) =>
        browser.functionApproval("fill_credential", { alias: "site", field, target }, signal);
      expect(await fill("password", await refNamed(browser, "Password"))).toEqual({
        kind: "credential_first_use",
        alias: "site",
        origin: login,
        postsTo: fx.origin("evil"),
      });
      await browser.navigate(`${login}/password`, signal);
      expect(await fill("password", await refNamed(browser, "Password"))).toEqual({
        kind: "credential_first_use",
        alias: "site",
        origin: login,
      });
      expect(
        await browser.functionApproval("use_passkey", { alias: "site" }, signal),
      ).toMatchObject({ kind: "credential_first_use", alias: "site" });
      // Invalid arguments, other tools and other origins raise nothing (the call is refused anyway).
      expect(await browser.functionApproval("fill_credential", { alias: 3 }, signal)).toBeNull();
      expect(
        await browser.functionApproval("read_page", { mode: "text", sinceHash: null }, signal),
      ).toBeNull();
      await browser.navigate(`${fx.origin("lookalike")}/password`, signal);
      expect(await fill("password", await refNamed(browser, "Password"))).toBeNull();
    } finally {
      await attached.close();
    }
  });

  it("forgets a run's masks and fill state when B1 releases it", async () => {
    expect(vault.maskSources("r1").hasSecrets()).toBe(false);
    await vaultHooks(vault).onReleased?.("r1");
    expect(vault.maskSources("r1").redact("x")).toBe("x");
  });
});
