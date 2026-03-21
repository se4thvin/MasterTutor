import { getVaultGrantApprover } from "@mastertutor/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../tests/fixtures/vault-sites/server.ts";
import { fillApproval, fillCredential } from "./fill.ts";
import { ControlHeld } from "./runtime.ts";
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
let tb: TestBrowser;
let refs: ReturnType<typeof refMap>;
let runId: string;
let login: string;

const deps = (logins: string[] = []) =>
  env.deps({
    resolveRef: refs.resolve,
    logins: { noteLogin: (_run, alias) => logins.push(alias) },
  });
const ctx = (approval = null as ReturnType<typeof humanApproval> | null, signal?: AbortSignal) =>
  toolContext({ runId, workspaceId: env.workspaceId, session: tb.session, approval, signal });
async function grant(alias: string) {
  await env.owner.sql`insert into vault_grants (item_id, origin, approved_by)
                      select id, ${login}, ${env.userId} from vault_items where alias = ${alias}`;
}

beforeAll(async () => {
  env = await startVaultTestEnv();
  fx = await startVaultFixtures({ account, mail: null });
  login = fx.origin("login");
  const secrets = { username: account.email, password: account.password, pin: account.pin };
  await env.seedItem({ alias: "site", origin: login, secrets });
  await env.seedItem({ alias: "first", origin: login, secrets });
  await env.seedItem({ alias: "nopin", origin: login, secrets: { username: account.email } });
  // W2: every test but the first-use one starts from a granted alias, independent of order.
  await Promise.all([grant("site"), grant("nopin")]);
});
beforeEach(async () => {
  tb = await launchTestBrowser({ allowedOrigins: fx.origins });
  refs = refMap(tb);
  runId = await env.newRun([login]);
});
afterEach(async () => {
  await tb?.close(); // W1: one browser per test, always closed.
});
afterAll(async () => {
  await fx?.close();
  await env?.stop();
});

describe("fill_credential", () => {
  it("asks before the first use, signs in after a human approval, then needs no approval", async () => {
    await tb.page.goto(`${login}/password`);
    const logins: string[] = [];
    expect(
      await fillApproval(deps(), { workspaceId: env.workspaceId }, tb.page.url(), {
        alias: "first",
        field: "username",
        target: "e1",
      }),
    ).toEqual({ kind: "credential_first_use", alias: "first", origin: login });
    expect(
      await fillCredential(deps(logins), ctx(humanApproval(env.userId)), {
        alias: "first",
        field: "username",
        target: await refs.ref("#email"),
      }),
    ).toEqual({ ok: true });
    expect(
      await fillCredential(deps(logins), ctx(), {
        alias: "first",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).toEqual({ ok: true });
    const [first] = await env.owner.sql`select id from vault_items where alias = 'first'`;
    expect(await getVaultGrantApprover(env.agent.db, first!.id, login)).toBe(env.userId);
    expect(await tb.page.getAttribute("#password", "type")).toBe("password");
    expect(await tb.page.isDisabled("#reveal")).toBe(true);
    await tb.page.click("#submit");
    await expect.poll(() => tb.page.textContent("#status").catch(() => null)).toBe("Signed in");
    expect(logins).toEqual(["first", "first"]);
    const audit = await env.owner
      .sql`select action, outcome, approved_by from vault_audit where run_id = ${runId} order by at`;
    expect(audit.map((row) => [row.action, row.outcome, row.approved_by])).toEqual([
      ["fill", "ok", env.userId],
      ["fill", "ok", env.userId],
    ]);
  });

  it("fills a React-controlled form so its own submit sends the values (Review Focus 1)", async () => {
    await tb.page.goto(`${login}/react`);
    await tb.page.waitForSelector("#r-email");
    expect(
      await fillCredential(deps(), ctx(), {
        alias: "site",
        field: "username",
        target: await refs.ref("#r-email"),
      }),
    ).toEqual({ ok: true });
    expect(
      await fillCredential(deps(), ctx(), {
        alias: "site",
        field: "password",
        target: await refs.ref("#r-password"),
      }),
    ).toEqual({ ok: true });
    expect(await tb.page.isEnabled("#r-submit")).toBe(true);
    await tb.page.click("#r-submit");
    await expect.poll(() => tb.page.textContent("#status").catch(() => null)).toBe("Signed in");
  });

  it("fills a split PIN across its boxes in DOM order", async () => {
    await tb.page.goto(`${login}/pin`);
    expect(
      await fillCredential(deps(), ctx(), {
        alias: "site",
        field: "pin",
        target: await refs.ref("#pin0"),
      }),
    ).toEqual({ ok: true });
    await tb.page.click("#submit");
    await expect.poll(() => tb.page.textContent("#status").catch(() => null)).toBe("PIN accepted");
  });

  it("treats an auto-submitting PIN as success (Review Focus 3)", async () => {
    await tb.page.goto(`${login}/pin-autosubmit`);
    expect(
      await fillCredential(deps(), ctx(), {
        alias: "site",
        field: "pin",
        target: await refs.ref("#pin0"),
      }),
    ).toEqual({ ok: true });
    await expect.poll(() => tb.page.textContent("#status").catch(() => null)).toBe("PIN accepted");
  });

  it("a policy approval fills once but leaves no grant (Review Focus 4)", async () => {
    const bench = await env.seedItem({
      alias: "bench",
      origin: login,
      secrets: { username: account.email },
    });
    await tb.page.goto(`${login}/password`);
    expect(
      await fillCredential(deps(), ctx(policyApproval()), {
        alias: "bench",
        field: "username",
        target: await refs.ref("#email"),
      }),
    ).toEqual({ ok: true });
    expect(await getVaultGrantApprover(env.agent.db, bench, login)).toBeNull();
    expect(
      await fillCredential(deps(), ctx(), {
        alias: "bench",
        field: "username",
        target: await refs.ref("#email"),
      }),
    ).toEqual({ error: "approval_required" });
  });

  it("reports a field the alias does not store", async () => {
    await tb.page.goto(`${login}/pin`);
    expect(
      await fillCredential(deps(), ctx(), {
        alias: "nopin",
        field: "pin",
        target: await refs.ref("#pin0"),
      }),
    ).toEqual({ error: "field_not_stored" });
  });

  it("registers masks: filled nodes on the page session, and secret values but never the username", async () => {
    await tb.page.goto(`${login}/password`);
    const d = deps();
    await fillCredential(d, ctx(), {
      alias: "site",
      field: "username",
      target: await refs.ref("#email"),
    });
    await fillCredential(d, ctx(), {
      alias: "site",
      field: "password",
      target: await refs.ref("#password"),
    });
    const mask = d.fingerprints.forRun(runId);
    expect(mask.nodeIds(await tb.session.cdp())).toHaveLength(2);
    // N2 producer: each fill is recorded with the frame it landed in, by CDP frame id.
    const { frameTree } = await (await tb.session.cdp()).send("Page.getFrameTree");
    expect(mask.filledFrames?.()).toEqual([frameTree.frame.id]);
    expect(mask.redact(`pw ${account.password}`)).not.toContain(account.password);
    expect(mask.redact(`hi ${account.email}`)).toContain(account.email);
  });

  it("audits a tampered ciphertext and answers fill_failed (F16)", async () => {
    await env.seedItem({
      alias: "tampered",
      origin: login,
      secrets: { password: "OTHER-VALUE-123" },
    });
    await grant("tampered");
    await env.owner.sql`
      update vault_secrets set sealed = (select s.sealed from vault_secrets s join vault_items i on i.id = s.item_id
                                         where i.alias = 'site' and s.field = 'password')
      where item_id = (select id from vault_items where alias = 'tampered') and field = 'password'`;
    await tb.page.goto(`${login}/password`);
    expect(
      await fillCredential(deps(), ctx(), {
        alias: "tampered",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).toEqual({ error: "fill_failed" });
    const [row] = await env.owner
      .sql`select action, outcome from vault_audit where run_id = ${runId} order by at desc limit 1`;
    expect(row).toMatchObject({ action: "fill", outcome: "binding_mismatch" });
    expect(await tb.page.inputValue("#password")).toBe("");
  });

  it("never fills after an abort, and never while the user holds control", async () => {
    await tb.page.goto(`${login}/password`);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      fillCredential(deps(), ctx(null, aborted.signal), {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).rejects.toThrow(/abort/i);
    tb.setController("user");
    await expect(
      fillCredential(deps(), ctx(), {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).rejects.toBeInstanceOf(ControlHeld);
    tb.setController("agent");
    expect(await tb.page.inputValue("#password")).toBe("");
  });
});
