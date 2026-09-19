import type { DbHandle } from "@mastertutor/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GREENMAIL_USER,
  startGreenmail,
  type Greenmail,
} from "../../../../../tests/fixtures/vault-sites/greenmail.ts";
import {
  FIXTURE_MAIL_FROM,
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../../tests/fixtures/vault-sites/server.ts";
import { ToolRegistry } from "../../tools/registry.ts";
import { readPageTool } from "../../tools/read-page.ts";
import { fillCredential } from "../fill.ts";
import {
  SECRET_REDACTION,
  captureModelScreenshot,
  collectStorageState,
  register,
} from "../runtime.ts";
import { createVaultSessionStore } from "../sessions.ts";
import {
  humanApproval,
  launchTestBrowser,
  refMap,
  toolContext,
  type TestBrowser,
} from "../testing/browser.ts";
import { startVaultTestEnv, type VaultTestEnv } from "../testing/env.ts";
import { expectAbsent as expectCanariesAbsent } from "../testing/canary.ts";
import { createOcr, ocrContains, type Ocr } from "../testing/ocr.ts";

// §12 test 1: seeded canaries never reach non-sealed DB columns, logs, tool results or (by OCR)
// any model screenshot, and the agent stays sighted on pages that do not show one (W3).
const CANARY = {
  username: "KITE7CANARY3@example.test",
  password: "MARMOT4CANARY8VELVET",
  totpSeed: "KRUGS4ZANFZSAYJAONSWG4TFOQQGC3TEEB2GK43U",
  pin: "739146",
  imapPassword: GREENMAIL_USER.password,
} as const;
/** Long enough that a fuzzy OCR match cannot be a coincidence. */
const OCR_CANARIES = [CANARY.username, CANARY.password, CANARY.totpSeed, CANARY.imapPassword];
const signal = new AbortController().signal;

let env: VaultTestEnv;
let mail: Greenmail;
let fx: VaultFixtures;
let tb: TestBrowser;
let ocr: Ocr;
let login: string;
const shots: Array<{ where: string; png: Buffer; dropped: boolean }> = [];
const results: unknown[] = [];
const outputs: string[] = [];

async function dumpDatabase(owner: DbHandle): Promise<string> {
  const tables = await owner.sql<
    { tablename: string }[]
  >`select tablename from pg_tables where schemaname = 'public'`;
  const parts: string[] = [];
  for (const { tablename } of tables) {
    const [row] = await owner.sql.unsafe(
      `select coalesce(string_agg(t::text, E'\\n'), '') as dump from public."${tablename}" t`,
    );
    parts.push(String(row?.dump ?? ""));
  }
  return parts.join("\n");
}

const expectAbsent = (haystack: string, where: string) =>
  expectCanariesAbsent(haystack, where, CANARY);

beforeAll(async () => {
  env = await startVaultTestEnv();
  mail = await startGreenmail();
  fx = await startVaultFixtures({
    account: {
      email: CANARY.username,
      password: CANARY.password,
      totpSeed: CANARY.totpSeed,
      pin: CANARY.pin,
    },
    mail: { smtpHost: mail.host, smtpPort: mail.smtpPort, to: GREENMAIL_USER.address },
  });
  login = fx.origin("login");
  ocr = await createOcr();
  tb = await launchTestBrowser({ allowedOrigins: fx.origins });
  await env.seedItem({
    alias: "site",
    origin: login,
    secrets: {
      username: CANARY.username,
      password: CANARY.password,
      totp: CANARY.totpSeed,
      pin: CANARY.pin,
      imap_password: CANARY.imapPassword,
    },
    imap: {
      host: mail.host,
      port: mail.imapPort,
      user: GREENMAIL_USER.login,
      senderFilter: FIXTURE_MAIL_FROM,
    },
  });
});
afterAll(async () => {
  await tb?.close();
  await ocr?.close();
  await fx?.close();
  await mail?.stop();
  await env?.stop();
});

describe("secret canary", () => {
  it("OCR can see a canary when it is on screen (positive control)", async () => {
    await tb.page.goto(`${login}/visible?t=${CANARY.password}`);
    const { data } = await (
      await tb.session.cdp()
    ).send("Page.captureScreenshot", {
      format: "png",
    });
    expect(ocrContains(await ocr.text(Buffer.from(data, "base64")), CANARY.password)).toBe(true);
  });

  it("fills every field kind while masked model screenshots never show a secret", async () => {
    const refs = refMap(tb);
    const runId = await env.newRun([login]);
    const store = createVaultSessionStore(env.deps());
    const deps = env.deps({ resolveRef: refs.resolve, logins: store });
    const mask = deps.fingerprints.forRun(runId);
    const ctx = toolContext({
      runId,
      workspaceId: env.workspaceId,
      session: tb.session,
      approval: humanApproval(env.userId),
    });
    const shoot = async (where: string) => {
      const shot = await captureModelScreenshot(tb.session, mask, signal);
      shots.push({ where, png: shot.png, dropped: shot.dropped });
    };

    await tb.page.goto(`${login}/password`);
    results.push(
      await fillCredential(deps, ctx, {
        alias: "site",
        field: "username",
        target: await refs.ref("#email"),
      }),
    );
    // Positive control for masking: the raw frame shows the username; the model frame must not.
    const raw = Buffer.from(
      (await (await tb.session.cdp()).send("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    );
    expect(ocrContains(await ocr.text(raw), CANARY.username)).toBe(true);
    await shoot("username filled");
    results.push(
      await fillCredential(deps, ctx, {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    );
    await shoot("password filled");
    await tb.page.click("#submit");
    await tb.page.waitForURL(`${login}/account`);
    const collected = await collectStorageState(tb.session);
    await env.agent.db.transaction((tx) =>
      store.save(tx, { id: runId, workspaceId: env.workspaceId }, collected),
    );
    await shoot("signed in"); // F8: sighted after the login navigation

    await tb.page.goto(`${login}/totp`);
    results.push(
      await fillCredential(deps, ctx, {
        alias: "site",
        field: "totp",
        target: await refs.ref("#totp"),
      }),
    );
    await shoot("totp filled");
    await tb.page.goto(`${login}/pin`);
    results.push(
      await fillCredential(deps, ctx, {
        alias: "site",
        field: "pin",
        target: await refs.ref("#pin0"),
      }),
    );
    await shoot("pin filled");
    await tb.page.goto(`${login}/email-otp`);
    await tb.page.click("#send");
    await expect.poll(() => tb.page.textContent("#sent").catch(() => null)).toBe("Code sent");
    results.push(
      await fillCredential(deps, ctx, {
        alias: "site",
        field: "otp",
        target: await refs.ref("#otp0"),
      }),
    );
    await shoot("otp filled");

    // W7: a page that reflects the password into its text and title.
    await tb.page.goto(`${login}/echo`);
    results.push(
      await fillCredential(deps, ctx, {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    );
    await expect.poll(() => tb.page.textContent("#echo").catch(() => null)).toContain("You typed");
    await shoot("echo");
    const registry = new ToolRegistry([register(readPageTool)], env.log.logger, mask);
    for (const mode of ["text", "interactive"] as const)
      outputs.push(
        (await registry.run("read_page", { mode, sinceHash: null, offset: null }, ctx)).output,
      );

    expect(results).toEqual(Array(6).fill({ ok: true })); // G5: six fills, six results
    expect(shots.map((shot) => shot.where)).toEqual([
      "username filled",
      "password filled",
      "signed in",
      "totp filled",
      "pin filled",
      "otp filled",
      "echo",
    ]);
    // W3: every frame of a page that does not show a secret is delivered, not blacked out.
    expect(shots.filter((shot) => shot.where !== "echo").every((shot) => !shot.dropped)).toBe(true);
    // The echo page shows the secret in its text and title: that frame is withheld.
    expect(shots.find((shot) => shot.where === "echo")?.dropped).toBe(true);
    expect(outputs.every((output) => output.includes(SECRET_REDACTION))).toBe(true);
  });

  it("no masked model screenshot contains a canary (OCR)", async () => {
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      const text = await ocr.text(shot.png);
      for (const canary of OCR_CANARIES) expect(ocrContains(text, canary), shot.where).toBe(false);
    }
  });

  it("no canary appears in any non-sealed database column", async () => {
    expectAbsent(await dumpDatabase(env.owner), "database");
  });

  it("no canary appears in logs, tool results or read_page output (M13)", () => {
    expectAbsent(env.log.text(), "logs");
    expectAbsent(JSON.stringify(results), "tool results");
    expectAbsent(outputs.join("\n"), "read_page output");
  });
});
