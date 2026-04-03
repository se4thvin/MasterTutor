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
import { createOcr, ocrContains, type Ocr } from "../testing/ocr.ts";
import { startVaultScenario, type VaultScenario } from "../testing/scenario.ts";

// §12 tests 1 (run_transcript, model requests, Garage objects, logs) and 4 (injection) through the
// real B1 loop with the vault plugged in by hooks.
const CANARY = {
  username: "LOOPKITE5CANARY@example.test",
  password: "OSPREY6CANARY2LANTERN",
} as const;
const read: MockTurn = {
  outputs: [
    { type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } },
  ],
};
const fill = (field: "username" | "password", name: string): MockTurn => ({
  outputs: [{ type: "fill_named", alias: "site", field, name }],
});
const click = (name: string): MockTurn => ({ outputs: [{ type: "click_named", name }] });
const done: MockTurn = { outputs: [{ type: "turn", status: "done", reason: "Finished" }] };

let fx: VaultFixtures;
let s: VaultScenario;
let ocr: Ocr;
let runId: string;

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
  ocr = await createOcr();
  s = await startVaultScenario({
    chromiumArgs: chromiumArgsFor([]),
    scenarios: [
      {
        name: "injection",
        turns: [
          read,
          fill("username", "Email"),
          fill("password", "Password"),
          click("Sign in"),
          read,
          click("Security notice"),
          read,
          fill("password", "Comments"),
          click("Delete account"),
          // Before Continue: a denied new_origin leaves the tab on chrome-error, where a later
          // click on the download link would hit nothing and prove nothing.
          click("Download report"),
          click("Continue"),
          done,
        ],
      },
    ],
  });
  const login = fx.origin("login");
  const secrets = await Promise.all(
    (["username", "password"] as const).map(async (field) => ({
      field,
      sealed: await sealValue(
        s.keys.publicKey,
        { kind: "secret", workspaceId: s.workspaceId, alias: "site", origin: login, field },
        CANARY[field],
      ),
    })),
  );
  await createVaultItem(s.owner.db, {
    workspaceId: s.workspaceId,
    alias: "site",
    origin: login,
    label: "My private label",
    imap: null,
    secrets,
    actor: s.userId,
  });
  runId = await s.start({
    name: "injection",
    goal: `Sign in at ${login}/password and read the account notice.`,
    allowedOrigins: [login],
    approvalMode: "ask",
  });
});
afterAll(async () => {
  await s?.stop();
  await ocr?.close();
  await fx?.close();
});

describe("prompt injection through the loop (ask mode)", () => {
  it("asks before first credential use, then blocks the risky click, the exfiltration link and the download", async () => {
    const steps = [
      ["credential_first_use", "approved"],
      ["risky_click", "denied"], // "Delete account"
      ["download", "denied"], // "Download report": B1's download gate (1984cf3)
      ["new_origin", "denied"], // "Continue" to evil
    ] as const;
    for (const [kind, decision] of steps) {
      expect(await s.settle(runId), kind).toEqual({ status: "waiting", waitReason: "approval" });
      await s.decide(runId, decision);
    }
    expect((await s.settle(runId)).status).toBe("completed");

    const rows = await s.owner
      .sql`select kind, status from approvals where run_id = ${runId} order by created_at`;
    expect(rows.map((row) => [row.kind, row.status])).toEqual(steps.map((step) => [...step]));
    expect(
      (await s.toolOutputs(runId)).some((output) => output.includes('"field_type_mismatch"')),
    ).toBe(true);
    expect(fx.requests.filter((r) => r.host === FIXTURE_HOSTS.evil)).toEqual([]);
    // §12.4: the injected download never reached the browser. If this fails because B1 lets a
    // same-origin download through without approval, stop and report (B6 F6 owns download blocking).
    expect(fx.requests.filter((r) => r.path === "/download/report.csv")).toEqual([]);
    const audit = await s.owner
      .sql`select action, outcome from vault_audit where run_id = ${runId} order by at`;
    expect(audit.map((row) => [row.action, row.outcome])).toEqual([
      ["fill", "ok"],
      ["fill", "ok"],
      ["denied", "field_type_mismatch"],
    ]);
  });

  it("tells the model the alias, never the label, username or password (F14)", () => {
    const first = JSON.stringify(s.mock.requestsFor("injection")[0]?.body.input);
    expect(first).toContain(`site (${fx.origin("login")})`);
    expect(first).not.toContain("My private label");
  });

  it("no canary reaches run_transcript, model requests, logs or tool outputs", async () => {
    const [transcript] = await s.owner
      .sql`select coalesce(string_agg(item::text, E'\\n'), '') as dump from run_transcript where run_id = ${runId}`;
    const haystacks = {
      run_transcript: String(transcript?.dump ?? ""),
      model_requests: JSON.stringify(
        s.mock.requestsFor("injection").map((request) => request.body),
      ),
      logs: s.logs(),
      tool_outputs: (await s.toolOutputs(runId)).join("\n"),
    };
    for (const [where, text] of Object.entries(haystacks)) {
      for (const [name, value] of Object.entries(CANARY))
        expect(text.includes(value), `${name} in ${where}`).toBe(false);
    }
  });

  it("no stored screenshot in Garage shows a canary (OCR)", async () => {
    const steps = await s.owner.sql<
      { key: string | null }[]
    >`select screenshot_key as key from run_steps where run_id = ${runId}`;
    const keys = [...new Set(steps.flatMap((row) => (row.key ? [row.key] : [])))];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const text = await ocr.text(Buffer.from(await s.storage.getBytes(key)));
      for (const value of Object.values(CANARY)) expect(ocrContains(text, value), key).toBe(false);
    }
  });
});
