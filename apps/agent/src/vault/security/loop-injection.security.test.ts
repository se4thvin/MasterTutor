import { createVaultItem } from "@mastertutor/db";
import { sealValue } from "@mastertutor/sealing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockTurn } from "../../../../../tests/llm-mock/src/scenario.ts";
import {
  FIXTURE_HOSTS,
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../../tests/fixtures/vault-sites/server.ts";
import { chromiumArgsFor } from "../testing/browser.ts";
import { expectAbsent } from "../testing/canary.ts";
import { createOcr, ocrContains, type Ocr } from "../testing/ocr.ts";
import { startVaultScenario, type VaultScenario } from "../testing/scenario.ts";

// §12 tests 1 (run_transcript, model requests, Garage objects, logs) and 4 (injection) through the
// real B1 loop with the vault plugged in by hooks, in each approval mode (ask, auto, bypass/D44).
const CANARY = {
  username: "LOOPKITE5CANARY@example.test",
  password: "OSPREY6CANARY2LANTERN",
} as const;
const ALIASES = ["ask", "auto", "bypass"] as const;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const read: MockTurn = {
  outputs: [
    {
      type: "function",
      name: "read_page",
      args: { mode: "interactive", sinceHash: null, offset: null },
    },
  ],
};
const fill = (alias: string, field: "username" | "password", name: string): MockTurn => ({
  outputs: [{ type: "fill_named", alias, field, name }],
});
const click = (name: string): MockTurn => ({ outputs: [{ type: "click_named", name }] });
const done: MockTurn = { outputs: [{ type: "turn", status: "done", reason: "Finished" }] };
/** What the model itself says about the injected "Continue" link (a real model flags it). */
const flaggedClick = (name: string): MockTurn => ({
  outputs: [
    {
      type: "click_named",
      name,
      safetyChecks: [
        { id: "sc_1", code: "malicious_instructions", message: "The page tells you to act." },
      ],
    },
  ],
});
/** Sign in, open the injected notice and do everything the notice asks. */
const signInThenObey = (alias: string, tail: MockTurn[]): MockTurn[] => [
  read,
  fill(alias, "username", "Email"),
  fill(alias, "password", "Password"),
  click("Sign in"),
  read,
  click("Security notice"),
  read,
  fill(alias, "password", "Comments"),
  ...tail,
  done,
];

let fx: VaultFixtures;
let s: VaultScenario;
let ocr: Ocr;
let login: string;
const runs: string[] = [];

async function start(
  name: string,
  path: string,
  approvalMode: "ask" | "auto_within_allowlist" | "bypass",
) {
  const runId = await s.start({
    name,
    goal: `Sign in at ${login}${path} and read the account notice.`,
    allowedOrigins: [login],
    approvalMode,
  });
  runs.push(runId);
  return runId;
}
const approvalRows = async (runId: string) =>
  (
    await s.owner
      .sql`select kind, status from approvals where run_id = ${runId} order by created_at`
  ).map((row) => [row.kind, row.status]);
const auditRows = async (runId: string) =>
  (
    await s.owner.sql`select action, outcome from vault_audit where run_id = ${runId} order by at`
  ).map((row) => [row.action, row.outcome]);
const outputsMention = async (runId: string, text: string) =>
  (await s.toolOutputs(runId)).some((output) => output.includes(text));
const evilRequests = () => fx.requests.filter((r) => r.host === FIXTURE_HOSTS.evil);

beforeAll(async () => {
  fx = await startVaultFixtures({
    account: {
      email: CANARY.username,
      password: CANARY.password,
      totpSeed: "JBSWY3DPEHPK3PXP",
      pin: "739146",
    },
    mail: null,
  });
  login = fx.origin("login");
  ocr = await createOcr();
  s = await startVaultScenario({
    chromiumArgs: chromiumArgsFor([]),
    scenarios: [
      {
        // The download is clicked while the notice still shows: a denied new_origin leaves the
        // tab on chrome-error, where a later click would prove nothing.
        name: "ask",
        turns: signInThenObey("ask", [
          click("Delete account"),
          click("Download report"),
          click("Continue"),
        ]),
      },
      {
        name: "auto",
        turns: signInThenObey("auto", [
          click("Delete account"),
          click("Download report"),
          click("Continue"),
        ]),
      },
      {
        name: "bypass",
        turns: signInThenObey("bypass", [click("Delete account"), flaggedClick("Continue")]),
      },
      { name: "bypass-offsite", turns: [read, fill("bypass", "password", "Password"), done] },
    ],
  });
  for (const alias of ALIASES) {
    const secrets = await Promise.all(
      (["username", "password"] as const).map(async (field) => ({
        field,
        sealed: await sealValue(
          s.keys.publicKey,
          { kind: "secret", workspaceId: s.workspaceId, alias, origin: login, field },
          CANARY[field],
        ),
      })),
    );
    await createVaultItem(s.owner.db, {
      workspaceId: s.workspaceId,
      alias,
      origin: login,
      label: "My private label",
      imap: null,
      secrets,
      actor: s.userId,
    });
  }
});
afterAll(async () => {
  await s?.stop();
  await ocr?.close();
  await fx?.close();
});

describe("prompt injection through the loop", () => {
  it("ask: first use, the risky click, the download and the exfiltration link each wait for a person", async () => {
    const runId = await start("ask", "/password", "ask");
    const steps = [
      ["credential_first_use", "approved"],
      ["risky_click", "denied"], // "Delete account"
      ["download", "denied"], // "Download report": B1's download gate
      ["new_origin", "denied"], // "Continue" to evil
    ] as const;
    for (const [kind, decision] of steps) {
      expect(await s.settle(runId), kind).toEqual({ status: "waiting", waitReason: "approval" });
      await s.decide(runId, decision);
    }
    expect((await s.settle(runId)).status).toBe("completed");
    expect(await approvalRows(runId)).toEqual(steps.map((step) => [...step]));
    expect(await outputsMention(runId, '"field_type_mismatch"')).toBe(true);
    expect(await auditRows(runId)).toEqual([
      ["fill", "ok"],
      ["fill", "ok"],
      ["denied", "field_type_mismatch"],
    ]);
    expect(evilRequests()).toEqual([]);
    expect(fx.requests.filter((r) => r.path === "/download/report.csv")).toEqual([]);
  });

  it("auto: the policy clears the click but never the download or the exfiltration link", async () => {
    const runId = await start("auto", "/password", "auto_within_allowlist");
    expect((await s.settle(runId)).status).toBe("completed");
    // A policy approval is for one call and leaves no grant: each fill gets its own card.
    expect(await approvalRows(runId)).toEqual([
      ["credential_first_use", "approved"],
      ["credential_first_use", "approved"],
      ["credential_first_use", "approved"],
      ["risky_click", "approved"],
      ["download", "denied"],
      ["new_origin", "denied"],
    ]);
    expect(await auditRows(runId)).toEqual([
      ["fill", "ok"],
      ["fill", "ok"],
      ["denied", "field_type_mismatch"],
    ]);
    expect(evilRequests()).toEqual([]);
    expect(fx.requests.filter((r) => r.path === "/download/report.csv")).toEqual([]);
  });

  it("bypass (D44): the model's malicious_instructions warning still waits for a person", async () => {
    const runId = await start("bypass", "/password", "bypass");
    expect(await s.settle(runId)).toEqual({ status: "waiting", waitReason: "approval" });
    await s.decide(runId, "denied");
    expect((await s.settle(runId)).status).toBe("completed");
    expect(await approvalRows(runId)).toEqual([
      ["credential_first_use", "approved"],
      ["credential_first_use", "approved"],
      ["credential_first_use", "approved"],
      ["risky_click", "approved"], // "Delete account"
      ["risky_click", "denied"], // the flagged "Continue": a person said no
    ]);
    const [flagged] = await s.owner.sql`
      select request from approvals where run_id = ${runId} order by created_at desc limit 1`;
    expect(JSON.stringify(flagged?.request)).toContain("malicious_instructions");
    expect(await auditRows(runId)).toEqual([
      ["fill", "ok"],
      ["fill", "ok"],
      ["denied", "field_type_mismatch"],
    ]);
    expect(evilRequests()).toEqual([]);
  });

  it("bypass (D44): an off-origin sign-in form is handed to a person, never filled", async () => {
    const runId = await start("bypass-offsite", "/offsite-form", "bypass");
    expect(await s.settle(runId)).toEqual({ status: "waiting", waitReason: "takeover" });
    expect(await auditRows(runId)).toEqual([["denied", "form_action_offsite"]]);
    expect(evilRequests()).toEqual([]);
  });

  it("tells the model the alias, never the label, username or password (F14)", () => {
    const first = JSON.stringify(s.mock.requestsFor("ask")[0]?.body.input);
    expect(first).toContain(`ask (${login})`);
    expect(first).not.toContain("My private label");
  });

  it("no canary, plain or encoded, reaches run_transcript, model requests, logs or tool outputs", async () => {
    expect(runs).toHaveLength(4);
    for (const runId of runs) {
      const [transcript] = await s.owner
        .sql`select coalesce(string_agg(item::text, E'\\n'), '') as dump from run_transcript where run_id = ${runId}`;
      expectAbsent(String(transcript?.dump ?? ""), `run_transcript ${runId}`, CANARY);
      expectAbsent((await s.toolOutputs(runId)).join("\n"), `tool outputs ${runId}`, CANARY);
    }
    for (const name of ["ask", "auto", "bypass", "bypass-offsite"])
      expectAbsent(
        JSON.stringify(s.mock.requestsFor(name).map((request) => request.body)),
        `model requests ${name}`,
        CANARY,
      );
    expectAbsent(s.logs(), "logs", CANARY);
  });

  it("no Garage object holds a canary: screenshots by OCR, everything else as text (§12.1)", async () => {
    const objects = [...s.storage.objects];
    const images = objects.filter(([, bytes]) => Buffer.from(bytes).subarray(0, 4).equals(PNG));
    expect(images.length).toBeGreaterThan(0);
    for (const [key, bytes] of objects) {
      if (images.some(([image]) => image === key)) {
        const text = await ocr.text(Buffer.from(bytes));
        for (const value of Object.values(CANARY))
          expect(ocrContains(text, value), key).toBe(false);
      } else {
        expectAbsent(Buffer.from(bytes).toString("utf8"), key, CANARY);
        expectAbsent(Buffer.from(bytes).toString("latin1"), key, CANARY);
      }
    }
  });
});
