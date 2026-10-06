import { setVaultSecret, submitOtpCode } from "@mastertutor/db";
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
import { fillCredential, forgetFillState } from "./fill.ts";
import { CODE_FIRST_LOOKBACK_MS, codeFirstSignInStart } from "./otp.ts";
import { totpCode } from "./totp.ts";
import {
  humanApproval,
  launchTestBrowser,
  refMap,
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
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
    secrets: { username: account.email, imap_password: GREENMAIL_USER.password },
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

describe("TOTP step reuse", () => {
  it("waits for a fresh step without the seed open, then types the code of the seed stored now (N5)", async () => {
    const id = await env.seedItem({
      alias: "rotating",
      origin: login,
      secrets: { totp: account.totpSeed },
    });
    await grant("rotating");
    const rotated = "GEZDGNBVGY3TQOJQGEZDGNBV";
    let skew = 0;
    const deps = env.deps({
      resolveRef: refs.resolve,
      now: () => Date.now() + skew,
      // The wait for the next step: the seed is replaced meanwhile, as a person rotating it would.
      sleep: async (ms: number) => {
        skew += ms;
        await setVaultSecret(env.web.db, {
          workspaceId: env.workspaceId,
          itemId: id,
          actor: env.userId,
          secret: {
            field: "totp",
            sealed: await sealValue(
              env.keys.publicKey,
              {
                kind: "secret",
                workspaceId: env.workspaceId,
                alias: "rotating",
                origin: login,
                field: "totp",
              },
              rotated,
            ),
          },
        });
      },
    });
    const fill = async () => {
      await tb.page.goto(`${login}/totp`);
      return fillCredential(deps, ctx(), {
        alias: "rotating",
        field: "totp",
        target: await refs.ref("#totp"),
      });
    };
    expect(await fill()).toEqual({ ok: true });
    expect(await fill()).toEqual({ ok: true });
    expect(skew).toBeGreaterThan(0);
    expect(await tb.page.inputValue("#totp")).toBe(totpCode(rotated, Date.now() + skew));
  });
});

describe("TOTP across a sleep and wake", () => {
  it("still never retypes the step typed before the run was released (review minor)", async () => {
    let skew = 0;
    const waits: number[] = [];
    const deps = env.deps({
      resolveRef: refs.resolve,
      now: () => Date.now() + skew,
      sleep: async (ms: number) => {
        waits.push(ms);
        skew += ms;
      },
    });
    const fill = async () => {
      await tb.page.goto(`${login}/totp`);
      return fillCredential(deps, ctx(), {
        alias: "site",
        field: "totp",
        target: await refs.ref("#totp"),
      });
    };
    expect(await fill()).toEqual({ ok: true });
    const typed = await tb.page.inputValue("#totp");
    waits.length = 0;
    // The run sleeps (its worker releases it) and wakes within the same 30 s window.
    forgetFillState(deps, runId, deps.now());
    expect(await fill()).toEqual({ ok: true });
    expect(waits).toHaveLength(1);
    expect(await tb.page.inputValue("#totp")).not.toBe(typed);
  });

  it("never lets two runs of one alias type the same step (final review minor 3)", async () => {
    let skew = 0;
    const waits: number[] = [];
    const deps = env.deps({
      resolveRef: refs.resolve,
      now: () => Date.now() + skew,
      sleep: async (ms: number) => {
        waits.push(ms);
        skew += ms;
      },
    });
    const fillIn = async (run: string) => {
      await tb.page.goto(`${login}/totp`);
      return fillCredential(
        deps,
        toolContext({ runId: run, workspaceId: env.workspaceId, session: tb.session }),
        { alias: "site", field: "totp", target: await refs.ref("#totp") },
      );
    };
    expect(await fillIn(runId)).toEqual({ ok: true });
    const typed = await tb.page.inputValue("#totp");
    waits.length = 0;
    expect(await fillIn(await env.newRun([login]))).toEqual({ ok: true });
    expect(waits).toHaveLength(1);
    expect(await tb.page.inputValue("#totp")).not.toBe(typed);
  });

  it("drops a step once its window has passed", () => {
    const deps = env.deps();
    deps.totpSteps.set(`${env.workspaceId}\u0000site\u0000${login}`, { step: 1, until: 1_000 });
    forgetFillState(deps, runId, 2_000);
    expect(deps.totpSteps.size).toBe(0);
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
    await pause(1_500);
    const deps = env.deps({ resolveRef: refs.resolve, otpImapWaitMs: 1_500 });
    // The sign-in starts with its first fill; the code mailed before it belongs to another attempt.
    expect(
      await fillCredential(deps, ctx(), {
        alias: "mailbox",
        field: "username",
        target: await refs.ref("#email"),
      }),
    ).toEqual({ ok: true });
    expect(
      await fillCredential(deps, ctx(), {
        alias: "mailbox",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ error: "otp_unavailable" });
  });

  it("finds the code of an email-code-only sign-in, mailed before its first fill (N2)", async () => {
    await tb.page.goto(`${login}/email-otp`);
    await sendCode();
    // Observing the page and the model's turn take seconds before the code fill starts.
    await pause(2_500);
    const deps = env.deps({ resolveRef: refs.resolve, otpImapWaitMs: 3_000 });
    expect(
      await fillCredential(deps, ctx(), {
        alias: "mailbox",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ ok: true });
    await tb.page.click("#submit");
    await expect.poll(status).toBe("Code accepted");
  });

  it("finds the code when the agent typed the email itself before asking for it (N2)", async () => {
    await tb.page.goto(`${login}/email-otp`);
    await tb.page.fill("#email", account.email); // the agent's own typing, not fill_credential
    await sendCode();
    await pause(2_500);
    const deps = env.deps({ resolveRef: refs.resolve, otpImapWaitMs: 3_000 });
    expect(
      await fillCredential(deps, ctx(), {
        alias: "mailbox",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    ).toEqual({ ok: true });
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

describe("codeFirstSignInStart (N2)", () => {
  it("starts a code-first sign-in at its approval or a little before the call, whichever is earlier, never before the run", async () => {
    const now = Date.now();
    await env.owner
      .sql`update runs set created_at = ${new Date(now - 60 * 60_000).toISOString()} where id = ${runId}`;
    const deps = env.deps({ now: () => now });
    const decided = (at: number) => ({
      runId,
      approval: { ...humanApproval(env.userId), decidedAt: at },
    });
    expect(await codeFirstSignInStart(deps, { runId, approval: null })).toBe(
      now - CODE_FIRST_LOOKBACK_MS,
    );
    expect(await codeFirstSignInStart(deps, decided(now - 3 * 60_000))).toBe(now - 3 * 60_000);
    expect(await codeFirstSignInStart(deps, decided(now - 2 * 60 * 60_000))).toBe(
      now - 60 * 60_000,
    );
  });
});
