import { submitOtpCode } from "@mastertutor/db";
import { sealValue } from "@mastertutor/sealing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  GREENMAIL_USER,
  startGreenmail,
  type Greenmail,
} from "../../../../tests/fixtures/vault-sites/greenmail.ts";
import {
  FIXTURE_MAIL_FROM,
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../tests/fixtures/vault-sites/server.ts";
import { fillCredential } from "./fill.ts";
import { launchTestBrowser, refMap, toolContext, type TestBrowser } from "./testing/browser.ts";
import { startVaultTestEnv, type VaultTestEnv } from "./testing/env.ts";

const account = {
  email: "me@example.test",
  password: "pw",
  totpSeed: "JBSWY3DPEHPK3PXP",
  pin: "739146",
};
let env: VaultTestEnv;
let mail: Greenmail;
let fx: VaultFixtures;
let tb: TestBrowser;
let refs: ReturnType<typeof refMap>;
let runId: string;
let login: string;

async function grant(alias: string) {
  await env.owner.sql`insert into vault_grants (item_id, origin, approved_by)
                      select id, ${login}, ${env.userId} from vault_items where alias = ${alias}`;
}
const ctx = () => toolContext({ runId, workspaceId: env.workspaceId, session: tb.session });
const status = () => tb.page.textContent("#status").catch(() => null);
const sealCode = (code: string) =>
  sealValue(env.keys.publicKey, { kind: "otp", workspaceId: env.workspaceId, runId }, code);
async function sendCode() {
  await tb.page.click("#send");
  await expect.poll(() => tb.page.textContent("#sent").catch(() => null)).toBe("Code sent");
}

beforeAll(async () => {
  env = await startVaultTestEnv();
  mail = await startGreenmail();
  fx = await startVaultFixtures({
    account,
    mail: { smtpHost: mail.host, smtpPort: mail.smtpPort, to: GREENMAIL_USER.address },
  });
  login = fx.origin("login");
  const imap = { host: mail.host, port: mail.imapPort, user: GREENMAIL_USER.login };
  await env.seedItem({ alias: "site", origin: login, secrets: { totp: account.totpSeed } });
  await env.seedItem({
    alias: "mailbox",
    origin: login,
    secrets: { imap_password: GREENMAIL_USER.password },
    imap: { ...imap, senderFilter: FIXTURE_MAIL_FROM },
  });
  // Watches the same inbox for a sender that never writes, so only the code box can answer.
  await env.seedItem({
    alias: "watched",
    origin: login,
    secrets: { imap_password: GREENMAIL_USER.password },
    imap: { ...imap, senderFilter: "nobody@fixtures.test" },
  });
  await env.seedItem({ alias: "boxonly", origin: login, secrets: { username: "x@example.test" } });
  await Promise.all(["site", "mailbox", "watched", "boxonly"].map(grant));
});
beforeEach(async () => {
  tb = await launchTestBrowser({ allowedOrigins: fx.origins });
  refs = refMap(tb);
  runId = await env.newRun([login]);
});
afterEach(async () => {
  await tb?.close(); // W1
});
afterAll(async () => {
  await fx?.close();
  await mail?.stop();
  await env?.stop();
});

describe("TOTP", () => {
  it("generates the current code server-side and the site accepts it", async () => {
    await tb.page.goto(`${login}/totp`);
    expect(
      await fillCredential(env.deps({ resolveRef: refs.resolve }), ctx(), {
        alias: "site",
        field: "totp",
        target: await refs.ref("#totp"),
      }),
    ).toEqual({ ok: true });
    await tb.page.click("#submit");
    await expect.poll(status).toBe("TOTP accepted");
  });
});

describe("OTP from IMAP", () => {
  it("reads the newest emailed code, fills the split boxes and the site accepts it", async () => {
    await tb.page.goto(`${login}/email-otp`);
    const deps = env.deps({ resolveRef: refs.resolve, otpImapWaitMs: 10_000 });
    // The code is sent once this sign-in is under way, as on a real site.
    const filling = fillCredential(deps, ctx(), {
      alias: "mailbox",
      field: "otp",
      target: await refs.ref("#otp0"),
    });
    await sendCode();
    expect(await filling).toEqual({ ok: true });
    await tb.page.click("#submit");
    await expect.poll(status).toBe("Code accepted");
    const audit = await env.owner
      .sql`select action, outcome from vault_audit where run_id = ${runId} order by at`;
    expect(audit.map((row) => [row.action, row.outcome])).toEqual([
      ["otp_received", "imap"],
      ["fill", "ok"],
    ]);

    // Review Focus 5: the same message is never used twice.
    await tb.page.goto(`${login}/email-otp`);
    const again = ctx();
    expect(
      await fillCredential(deps, again, {
        alias: "mailbox",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ error: "otp_unavailable" });
    expect(again.waits).toEqual(["otp"]);
  });

  it("ignores mail older than the 5-minute window (Review Focus 5)", async () => {
    await tb.page.goto(`${login}/email-otp`);
    await sendCode();
    const later = env.deps({ resolveRef: refs.resolve, now: () => Date.now() + 10 * 60_000 });
    expect(
      await fillCredential(later, ctx(), {
        alias: "mailbox",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ error: "otp_unavailable" });
  });

  it("refuses an IMAP host on a private network outside test mode", async () => {
    await tb.page.goto(`${login}/email-otp`);
    const prod = env.deps({ resolveRef: refs.resolve, testMode: false });
    expect(
      await fillCredential(prod, ctx(), {
        alias: "mailbox",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ error: "otp_unavailable" });
    expect(env.log.text()).toContain("imap_blocked");
  });

  it("uses a code typed into the box while the inbox is being watched (S7)", async () => {
    await tb.page.goto(`${login}/email-otp`);
    const deps = env.deps({ resolveRef: refs.resolve, otpImapWaitMs: 20_000 });
    const started = Date.now();
    const filling = fillCredential(deps, ctx(), {
      alias: "watched",
      field: "otp",
      target: await refs.ref("#otp0"),
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await submitOtpCode(env.web.db, {
      workspaceId: env.workspaceId,
      runId,
      sealed: await sealCode("135790"),
    });
    expect(await filling).toEqual({ ok: true });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await tb.page.inputValue("#otp5")).toBe("0");
    const [received] = await env.owner.sql`
      select outcome from vault_audit where run_id = ${runId} and action = 'otp_received'`;
    expect(received?.outcome).toBe("code_box");
  });
});

describe("OTP sources are trusted only for this sign-in (review)", () => {
  it("never uses a code emailed before this sign-in started", async () => {
    await tb.page.goto(`${login}/email-otp`);
    await sendCode();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const deps = env.deps({ resolveRef: refs.resolve, otpImapWaitMs: 1_500 });
    expect(
      await fillCredential(deps, ctx(), {
        alias: "mailbox",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ error: "otp_unavailable" });
  });

  it("answers fill_failed, audited, when a typed code cannot be opened during the inbox wait", async () => {
    await tb.page.goto(`${login}/email-otp`);
    const deps = env.deps({ resolveRef: refs.resolve, otpImapWaitMs: 20_000 });
    const filling = fillCredential(deps, ctx(), {
      alias: "watched",
      field: "otp",
      target: await refs.ref("#otp0"),
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    // Sealed for another run: it can never open under this run's binding.
    const foreign = await sealValue(
      env.keys.publicKey,
      { kind: "otp", workspaceId: env.workspaceId, runId: "00000000-0000-4000-8000-00000000abcd" },
      "135790",
    );
    await submitOtpCode(env.web.db, { workspaceId: env.workspaceId, runId, sealed: foreign });
    expect(await filling).toEqual({ error: "fill_failed" });
    const [row] = await env.owner.sql`
      select action, outcome from vault_audit where run_id = ${runId} order by at desc limit 1`;
    expect(row).toMatchObject({ action: "fill", outcome: "binding_mismatch" });
  });
});

describe("OTP from the UI code box", () => {
  it("asks for a code, then fills the one the user submitted", async () => {
    await tb.page.goto(`${login}/email-otp`);
    await sendCode();
    const deps = env.deps({ resolveRef: refs.resolve });
    const first = ctx();
    expect(
      await fillCredential(deps, first, {
        alias: "boxonly",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ error: "otp_unavailable" });
    expect(first.waits).toEqual(["otp"]);
    expect(
      await submitOtpCode(env.web.db, {
        workspaceId: env.workspaceId,
        runId,
        sealed: await sealCode(fx.lastEmailCode()!),
      }),
    ).toBe("ok");
    expect(
      await fillCredential(deps, ctx(), {
        alias: "boxonly",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ ok: true });
    await tb.page.click("#submit");
    await expect.poll(status).toBe("Code accepted");
  });

  it("never fills an expired code", async () => {
    await tb.page.goto(`${login}/email-otp`);
    await submitOtpCode(env.web.db, {
      workspaceId: env.workspaceId,
      runId,
      sealed: await sealCode("123456"),
    });
    await env.owner
      .sql`update otp_codes set expires_at = now() - interval '1 second' where run_id = ${runId}`;
    expect(
      await fillCredential(env.deps({ resolveRef: refs.resolve }), ctx(), {
        alias: "boxonly",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ error: "otp_unavailable" });
  });

  it("registers one-time codes as filled nodes only, never as secret values (S5)", async () => {
    await tb.page.goto(`${login}/totp`);
    const deps = env.deps({ resolveRef: refs.resolve });
    await fillCredential(deps, ctx(), {
      alias: "site",
      field: "totp",
      target: await refs.ref("#totp"),
    });
    const mask = deps.fingerprints.forRun(runId);
    expect(mask.nodeIds(await tb.session.cdp())).toHaveLength(1);
    expect(mask.hasSecrets()).toBe(false);
  });
});
