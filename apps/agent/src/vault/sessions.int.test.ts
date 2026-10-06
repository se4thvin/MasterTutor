import { withOpenedText } from "@mastertutor/sealing/open";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../tests/fixtures/vault-sites/server.ts";
import { fillCredential } from "./fill.ts";
import { applyStorageState, collectStorageState } from "./runtime.ts";
import { createVaultSessionStore } from "./sessions.ts";
import {
  humanApproval,
  launchTestBrowser,
  policyApproval,
  refMap,
  toolContext,
  type TestBrowser,
} from "./testing/browser.ts";
import { startVaultTestEnv, type VaultTestEnv } from "./testing/env.ts";

const account = {
  email: "me@example.test",
  password: "fixture-password-1",
  totpSeed: "JBSWY3DPEHPK3PXP",
  pin: "739146",
};
let env: VaultTestEnv;
let fx: VaultFixtures;
let login: string;
let tb: TestBrowser | undefined;
const sessionRows = () =>
  env.owner
    .sql`select alias, origin, sealed_state, updated_at from browser_sessions order by alias`;
/** B1 saves inside the act step's transaction; so do the tests. */
const saveState = (
  store: ReturnType<typeof createVaultSessionStore>,
  run: { id: string; workspaceId: string },
  collected: Awaited<ReturnType<typeof collectStorageState>>,
) => env.agent.db.transaction((tx) => store.save(tx, run, collected));
const status = (b: TestBrowser) => b.page.textContent("#status").catch(() => null);

async function browser(): Promise<TestBrowser> {
  tb = await launchTestBrowser({ allowedOrigins: fx.origins });
  return tb;
}
async function newRun() {
  return { id: await env.newRun([login]), workspaceId: env.workspaceId, allowedOrigins: [login] };
}
async function signIn(
  b: TestBrowser,
  alias: string,
  runId: string,
  approval = humanApproval(env.userId),
) {
  const refs = refMap(b);
  const store = createVaultSessionStore(env.deps());
  const deps = env.deps({ resolveRef: refs.resolve, logins: store });
  await b.page.goto(`${login}/password`);
  const ctx = toolContext({ runId, workspaceId: env.workspaceId, session: b.session, approval });
  expect(
    await fillCredential(deps, ctx, { alias, field: "username", target: await refs.ref("#email") }),
  ).toEqual({ ok: true });
  expect(
    await fillCredential(deps, ctx, {
      alias,
      field: "password",
      target: await refs.ref("#password"),
    }),
  ).toEqual({ ok: true });
  return store;
}

beforeAll(async () => {
  env = await startVaultTestEnv();
  fx = await startVaultFixtures({ account, mail: null });
  login = fx.origin("login");
  const secrets = { username: account.email, password: account.password };
  await env.seedItem({ alias: "site", origin: login, secrets });
  await env.seedItem({ alias: "bench", origin: login, secrets });
});
afterEach(async () => {
  await tb?.close();
  tb = undefined;
});
afterAll(async () => {
  await fx?.close();
  await env?.stop();
});

describe("sealed per-alias sessions (spec §5.6)", () => {
  let run: Awaited<ReturnType<typeof newRun>>;
  let token: string | null;

  it("does not save while the login form shows, then seals once signed in with a human grant", async () => {
    const b = await browser();
    run = await newRun();
    const store = await signIn(b, "site", run.id);
    await saveState(store, run, await collectStorageState(b.session));
    expect(await sessionRows()).toEqual([]);
    await b.page.click("#submit");
    await b.page.waitForURL(`${login}/account`);
    token = await b.page.evaluate(() => localStorage.getItem("fx_token"));
    await saveState(store, run, await collectStorageState(b.session));
    const [row] = await sessionRows();
    expect(row).toMatchObject({ alias: "site", origin: login });
    const state = await withOpenedText(
      env.keys,
      row!.sealed_state,
      { kind: "session", workspaceId: env.workspaceId, alias: "site", origin: login },
      async (text) =>
        JSON.parse(text) as {
          cookies: Array<{ name: string }>;
          origins: Array<{ origin: string }>;
        },
    );
    expect(state.cookies.map((cookie) => cookie.name)).toContain("sid");
    expect(state.origins.map((entry) => entry.origin)).toEqual([login]);

    // W8: an unchanged state is not sealed again (save runs after every act).
    const before = String(row!.updated_at);
    await saveState(store, run, await collectStorageState(b.session));
    expect(String((await sessionRows())[0]!.updated_at)).toBe(before);
  });

  it("restores the sealed session into a fresh browser: cookies and localStorage", async () => {
    const b = await browser();
    const state = await createVaultSessionStore(env.deps()).load(run);
    expect(state).not.toBeNull();
    const remove = await applyStorageState(b.session, state!);
    await b.page.goto(`${login}/account`);
    await remove();
    await expect.poll(() => status(b)).toBe("Signed in");
    expect(await b.page.evaluate(() => localStorage.getItem("fx_token"))).toBe(token);
  });

  it("restores nothing for origins outside the run's allowlist", async () => {
    const store = createVaultSessionStore(env.deps());
    expect(await store.load({ ...run, allowedOrigins: ["https://elsewhere.example"] })).toBeNull();
  });

  it("recovers the run's aliases after an agent restart and keeps saving", async () => {
    const b = await browser();
    const fresh = createVaultSessionStore(env.deps());
    await applyStorageState(b.session, (await fresh.load(run))!);
    await b.page.goto(`${login}/account`);
    await b.page.evaluate(() => localStorage.setItem("fx_extra", "1"));
    const before = String((await sessionRows())[0]!.updated_at);
    await saveState(fresh, run, await collectStorageState(b.session));
    expect(String((await sessionRows())[0]!.updated_at)).not.toBe(before);
  });

  it("never seals a session from a policy (auto-mode) login (S11, Review Focus 8)", async () => {
    const b = await browser();
    const auto = await newRun();
    const store = await signIn(b, "bench", auto.id, policyApproval());
    await b.page.click("#submit");
    await b.page.waitForURL(`${login}/account`);
    await saveState(store, auto, await collectStorageState(b.session));
    expect((await sessionRows()).map((row) => row.alias)).not.toContain("bench");
  });

  it("deletes the sealed session when the agent clicks Log out, and stops re-saving it", async () => {
    const b = await browser();
    const store = createVaultSessionStore(env.deps());
    await applyStorageState(b.session, (await store.load(run))!);
    await b.page.goto(`${login}/account`);
    await store.onClick(run, { label: "Log out", url: `${login}/account` });
    expect(await sessionRows()).toEqual([]);
    await saveState(store, run, await collectStorageState(b.session));
    expect(await sessionRows()).toEqual([]);
    const [audit] = await env.owner.sql`
      select action, field, outcome from vault_audit where run_id = ${run.id} and field = 'session'`;
    expect(audit).toMatchObject({ action: "delete", outcome: "logout" });
  });

  it("ignores clicks that are not a logout", async () => {
    const store = createVaultSessionStore(env.deps());
    await expect(
      store.onClick(run, { label: "Log in", url: `${login}/password` }),
    ).resolves.toBeUndefined();
  });
});
