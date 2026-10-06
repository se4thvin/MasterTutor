import { upsertBrowserSession } from "@mastertutor/db";
import { sealValue } from "@mastertutor/sealing";
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

// The first tests build on each other (sign in, then restore, then log out), as the plan wrote
// them; the review tests after them set up their own state.
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

  it("leaves a sealed session alone on a click that is not a logout (I3)", async () => {
    const b = await browser();
    const own = await newRun();
    const store = await signIn(b, "site", own.id);
    await b.page.click("#submit");
    await b.page.waitForURL(`${login}/account`);
    await saveState(store, own, await collectStorageState(b.session));
    expect((await sessionRows()).map((row) => row.alias)).toEqual(["site"]);
    await store.onClick(own, { label: "Log in", url: `${login}/password` });
    expect((await sessionRows()).map((row) => row.alias)).toEqual(["site"]);
    const logouts = await env.owner.sql`
      select 1 from vault_audit where run_id = ${own.id} and outcome = 'logout'`;
    expect(logouts).toHaveLength(0);
  });

  it("stops sealing once the grant is revoked mid-run (review)", async () => {
    const b = await browser();
    const own = await newRun();
    const store = await signIn(b, "site", own.id);
    await b.page.click("#submit");
    await b.page.waitForURL(`${login}/account`);
    await saveState(store, own, await collectStorageState(b.session));
    const before = String((await sessionRows())[0]!.updated_at);
    await env.owner
      .sql`delete from vault_grants where item_id = (select id from vault_items where alias = 'site')`;
    await b.page.evaluate(() => localStorage.setItem("fx_changed", "1"));
    await saveState(store, own, await collectStorageState(b.session));
    expect(String((await sessionRows())[0]!.updated_at)).toBe(before);
  });

  it("saves again when the act that saved was rolled back (review)", async () => {
    await env.owner.sql`delete from browser_sessions`;
    const b = await browser();
    const own = await newRun();
    const store = await signIn(b, "site", own.id);
    await b.page.click("#submit");
    await b.page.waitForURL(`${login}/account`);
    const state = await collectStorageState(b.session);
    await env.agent.db
      .transaction(async (tx) => {
        await store.save(tx, own, state);
        throw new Error("the act's commit failed");
      })
      .catch(() => undefined);
    expect(await sessionRows()).toEqual([]);
    await saveState(store, own, state);
    expect((await sessionRows()).map((row) => row.alias)).toEqual(["site"]);
  });

  it("restores one identity per origin, the most recently saved (review)", async () => {
    await env.owner.sql`delete from browser_sessions`;
    for (const alias of ["older", "newer"]) {
      await env.seedItem({ alias, origin: login, secrets: {} });
      await env.owner.sql`insert into vault_grants (item_id, origin, approved_by)
        select id, ${login}, ${env.userId} from vault_items where alias = ${alias}`;
      const state = {
        cookies: [],
        origins: [{ origin: login, localStorage: [{ name: "who", value: alias }] }],
      };
      await upsertBrowserSession(env.agent.db, {
        workspaceId: env.workspaceId,
        alias,
        origin: login,
        sealed: await sealValue(
          env.keys.publicKey,
          { kind: "session", workspaceId: env.workspaceId, alias, origin: login },
          JSON.stringify(state),
        ),
      });
    }
    await env.owner
      .sql`update browser_sessions set updated_at = now() - interval '1 hour' where alias = 'older'`;
    const restored = await createVaultSessionStore(env.deps()).load(await newRun());
    expect(restored?.origins).toEqual([
      { origin: login, localStorage: [{ name: "who", value: "newer" }] },
    ]);
  });

  it("a logout click deletes a session this run only restored (review)", async () => {
    const restoring = await newRun();
    const store = createVaultSessionStore(env.deps());
    expect(await store.load(restoring)).not.toBeNull();
    await store.onClick(restoring, { label: "Sign out", url: `${login}/account` });
    // The identity it restored ("newer") is signed out; another alias's session is not touched.
    expect((await sessionRows()).map((row) => row.alias)).toEqual(["older"]);
  });
});
