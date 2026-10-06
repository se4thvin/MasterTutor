import { generateKeyPairSync, randomBytes } from "node:crypto";
import { findVaultItemByAlias, putVaultSecret, vaultAudit } from "@mastertutor/db";
import { sealValue } from "@mastertutor/sealing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../tests/fixtures/vault-sites/server.ts";
import { StoredPasskey, createPasskeys } from "./passkeys.ts";
import { withItemSecret } from "./secrets.ts";
import {
  humanApproval,
  launchTestBrowser,
  toolContext,
  type TestBrowser,
} from "./testing/browser.ts";
import { startVaultTestEnv, type VaultTestEnv } from "./testing/env.ts";

const account = {
  email: "me@example.test",
  password: "pw",
  totpSeed: "JBSWY3DPEHPK3PXP",
  pin: "739146",
};
let env: VaultTestEnv;
let fx: VaultFixtures;
let login: string;
let tb: TestBrowser | undefined;

async function browser(): Promise<TestBrowser> {
  tb = await launchTestBrowser({
    allowedOrigins: fx.origins,
    secureOrigins: [fx.origin("login"), fx.origin("lookalike")],
  });
  return tb;
}
/** Records the CDP calls the vault makes on this browser, and the authenticator it creates. */
async function watchCdp(b: TestBrowser) {
  const cdp = await b.session.cdp();
  const sent: string[] = [];
  const created: string[] = [];
  const send = cdp.send.bind(cdp);
  cdp.send = (async (method: string, params?: object) => {
    sent.push(method);
    const result = await send(method as never, params as never);
    if (method === "WebAuthn.addVirtualAuthenticator")
      created.push((result as { authenticatorId: string }).authenticatorId);
    return result;
  }) as typeof cdp.send;
  const gone = async () =>
    send("WebAuthn.getCredentials", { authenticatorId: created.at(-1)! }).then(
      () => false,
      () => true,
    );
  return { cdp, sent, created, send, gone };
}
const status = (b: TestBrowser) => b.page.textContent("#status").catch(() => null);

beforeAll(async () => {
  env = await startVaultTestEnv();
  fx = await startVaultFixtures({ account, mail: null });
  login = fx.origin("login");
  await env.seedItem({ alias: "site", origin: login, secrets: {} });
  await env.seedItem({ alias: "empty", origin: fx.origin("lookalike"), secrets: {} });
});
afterEach(async () => {
  await tb?.close(); // W1
  tb = undefined;
});
afterAll(async () => {
  await fx?.close();
  await env?.stop();
});

describe("passkeys", () => {
  it("enrols a passkey the user registers during takeover and seals it to the matching item", async () => {
    const passkeys = createPasskeys(env.deps());
    const b = await browser();
    await b.page.goto(`${login}/webauthn/register`);
    const handle = await passkeys.enrolment.begin(b.session);
    b.setController("user");
    await b.page.click("#register");
    await expect.poll(() => status(b)).toBe("Passkey registered");
    const runId = await env.newRun([login]);
    expect(await passkeys.enrolment.finish(handle, { workspaceId: env.workspaceId, runId })).toBe(
      1,
    );
    expect((await findVaultItemByAlias(env.agent.db, env.workspaceId, "site"))?.fields).toContain(
      "passkey",
    );
    const [audit] = await env.owner
      .sql`select action, field, outcome from vault_audit where run_id = ${runId}`;
    expect(audit).toMatchObject({ action: "update", field: "passkey", outcome: "enrolled" });
    await expect(
      handle.cdp.send("WebAuthn.getCredentials", { authenticatorId: handle.authenticatorId }),
    ).rejects.toThrow();
  });

  it("signs in with the sealed passkey in a fresh browser, then removes the authenticator", async () => {
    const passkeys = createPasskeys(env.deps());
    const b = await browser();
    await b.page.goto(`${login}/webauthn/login`);
    const runId = await env.newRun([login]);
    const ctx = toolContext({
      runId,
      workspaceId: env.workspaceId,
      session: b.session,
      approval: humanApproval(env.userId),
    });
    expect(await passkeys.use(ctx, { alias: "site" })).toEqual({ ok: true });
    await b.page.click("#passkey-login");
    await expect.poll(() => status(b)).toBe("Signed in with passkey");
    await expect
      .poll(async () =>
        (
          await env.owner.sql`select outcome from vault_audit where run_id = ${runId} order by at`
        ).map((row) => row.outcome),
      )
      .toEqual(["armed", "asserted"]);
  });

  it("removes the authenticator once the site has asserted (review)", async () => {
    const passkeys = createPasskeys(env.deps());
    const b = await browser();
    await b.page.goto(`${login}/webauthn/login`);
    const watch = await watchCdp(b);
    const runId = await env.newRun([login]);
    const ctx = toolContext({
      runId,
      workspaceId: env.workspaceId,
      session: b.session,
      approval: humanApproval(env.userId),
    });
    expect(await passkeys.use(ctx, { alias: "site" })).toEqual({ ok: true });
    expect(await watch.gone()).toBe(false);
    await b.page.click("#passkey-login");
    await expect.poll(() => status(b)).toBe("Signed in with passkey");
    await expect.poll(watch.gone).toBe(true);
  });

  it("disarms an unused authenticator when the arm window ends (review)", async () => {
    const passkeys = createPasskeys(env.deps(), { armMs: 300 });
    const b = await browser();
    await b.page.goto(`${login}/webauthn/login`);
    const watch = await watchCdp(b);
    const runId = await env.newRun([login]);
    const ctx = toolContext({
      runId,
      workspaceId: env.workspaceId,
      session: b.session,
      approval: humanApproval(env.userId),
    });
    expect(await passkeys.use(ctx, { alias: "site" })).toEqual({ ok: true });
    await expect.poll(watch.gone, { timeout: 3_000 }).toBe(true);
  });

  it("seals only credentials for the item's own RP after an assertion (review)", async () => {
    const passkeys = createPasskeys(env.deps());
    const b = await browser();
    await b.page.goto(`${login}/webauthn/login`);
    const watch = await watchCdp(b);
    const runId = await env.newRun([login]);
    const ctx = toolContext({
      runId,
      workspaceId: env.workspaceId,
      session: b.session,
      approval: humanApproval(env.userId),
    });
    expect(await passkeys.use(ctx, { alias: "site" })).toEqual({ ok: true });
    // A credential for another RP lands in the armed authenticator before the ceremony.
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    await watch.send("WebAuthn.addCredential", {
      authenticatorId: watch.created.at(-1)!,
      credential: {
        credentialId: randomBytes(16).toString("base64"),
        isResidentCredential: true,
        rpId: "evil.fixtures-isolated.test",
        userHandle: Buffer.from("intruder").toString("base64"),
        privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
        signCount: 0,
      },
    });
    await b.page.click("#passkey-login");
    await expect.poll(() => status(b)).toBe("Signed in with passkey");
    await expect.poll(watch.gone).toBe(true);
    const item = (await findVaultItemByAlias(env.agent.db, env.workspaceId, "site"))!;
    const stored = await withItemSecret(
      env.deps(),
      env.workspaceId,
      item,
      "passkey",
      async (text) => StoredPasskey.array().parse(JSON.parse(text)),
    );
    expect(Array.isArray(stored) && stored.map((passkey) => passkey.rpId)).toEqual([
      "login.fixtures.test",
    ]);
  });

  it("disarms when the arm cannot be audited (review)", async () => {
    const db = env.agent.db;
    // Every audit insert works except the "armed" row.
    const failing = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "insert") return Reflect.get(target, property, receiver);
        return (table: unknown) => {
          const builder = target.insert(table as never);
          if (table !== vaultAudit) return builder;
          return {
            values: (row: { outcome?: string }) =>
              row.outcome === "armed"
                ? Promise.reject(new Error("audit down"))
                : builder.values(row as never),
          };
        };
      },
    });
    const passkeys = createPasskeys(env.deps({ db: failing }));
    const b = await browser();
    await b.page.goto(`${login}/webauthn/login`);
    const watch = await watchCdp(b);
    const runId = await env.newRun([login]);
    const ctx = toolContext({
      runId,
      workspaceId: env.workspaceId,
      session: b.session,
      approval: humanApproval(env.userId),
    });
    await expect(passkeys.use(ctx, { alias: "site" })).rejects.toThrow("audit down");
    expect(await watch.gone()).toBe(true);
  });

  it("refuses on a lookalike origin and reports a missing passkey", async () => {
    const passkeys = createPasskeys(env.deps());
    const b = await browser();
    await b.page.goto(`${fx.origin("lookalike")}/webauthn/login`);
    const runId = await env.newRun([login]);
    const ctx = toolContext({
      runId,
      workspaceId: env.workspaceId,
      session: b.session,
      approval: humanApproval(env.userId),
    });
    expect(await passkeys.use(ctx, { alias: "site" })).toEqual({ error: "origin_mismatch" });
    expect(await passkeys.use(ctx, { alias: "empty" })).toEqual({ error: "no_passkey" });
    expect(await passkeys.use(ctx, { alias: "nope" })).toEqual({ error: "unknown_alias" });
  });

  it("needs first-use approval like any credential", async () => {
    const passkeys = createPasskeys(env.deps());
    const b = await browser();
    await env.owner.sql`delete from vault_grants`;
    await b.page.goto(`${login}/webauthn/login`);
    const runId = await env.newRun([login]);
    expect(
      await passkeys.approval({ workspaceId: env.workspaceId }, b.page.url(), { alias: "site" }),
    ).toEqual({
      kind: "credential_first_use",
      alias: "site",
      origin: login,
    });
    const ctx = toolContext({ runId, workspaceId: env.workspaceId, session: b.session });
    expect(await passkeys.use(ctx, { alias: "site" })).toEqual({ error: "approval_required" });
  });

  it("removes the authenticator when a stored passkey cannot be added (S8)", async () => {
    const id = await env.seedItem({ alias: "broken", origin: login, secrets: {} });
    const bad = [
      {
        credentialId: "AAAA",
        isResidentCredential: true,
        rpId: "login.fixtures.test",
        privateKey: "AAAA",
        signCount: 0,
      },
    ];
    await putVaultSecret(
      env.agent.db,
      { workspaceId: env.workspaceId, itemId: id },
      {
        field: "passkey",
        sealed: await sealValue(
          env.keys.publicKey,
          {
            kind: "secret",
            workspaceId: env.workspaceId,
            alias: "broken",
            origin: login,
            field: "passkey",
          },
          JSON.stringify(bad),
        ),
      },
    );
    const passkeys = createPasskeys(env.deps());
    const b = await browser();
    await b.page.goto(`${login}/webauthn/login`);
    const cdp = await b.session.cdp();
    const sent: string[] = [];
    const send = cdp.send.bind(cdp);
    cdp.send = ((method: string, params?: object) => {
      sent.push(method);
      return send(method as never, params as never);
    }) as typeof cdp.send;
    const runId = await env.newRun([login]);
    const ctx = toolContext({
      runId,
      workspaceId: env.workspaceId,
      session: b.session,
      approval: humanApproval(env.userId),
    });
    expect(await passkeys.use(ctx, { alias: "broken" })).toEqual({ error: "ceremony_failed" });
    expect(sent).toContain("WebAuthn.addVirtualAuthenticator");
    expect(sent.at(-1)).toBe("WebAuthn.removeVirtualAuthenticator");
  });
});
