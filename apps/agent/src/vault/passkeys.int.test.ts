import { findVaultItemByAlias, putVaultSecret } from "@mastertutor/db";
import { sealValue } from "@mastertutor/sealing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../tests/fixtures/vault-sites/server.ts";
import { createPasskeys } from "./passkeys.ts";
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
