import { createVaultItem } from "@mastertutor/db";
import { sealValue } from "@mastertutor/sealing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockTurn } from "../../../../../tests/llm-mock/src/scenario.ts";
import {
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../../tests/fixtures/vault-sites/server.ts";
import { SECRET_REDACTION } from "../runtime.ts";
import { chromiumArgsFor } from "../testing/browser.ts";
import { expectAbsent } from "../testing/canary.ts";
import { startVaultScenario, type VaultScenario } from "../testing/scenario.ts";

// Final review I2: a GET sign-in form puts the password, percent- and form-encoded, in the next
// page's URL. Neither the page header the model reads nor anything the run records may carry it.
const PASSWORD = "Kestrel#9!pass word";
const ENCODED = {
  raw: PASSWORD,
  uri: encodeURIComponent(PASSWORD),
  form: new URLSearchParams({ v: PASSWORD }).toString().slice(2),
};
const read: MockTurn = {
  outputs: [
    { type: "function", name: "read_page", args: { mode: "interactive", sinceHash: null } },
  ],
};

let fx: VaultFixtures;
let s: VaultScenario;
let runId: string;

beforeAll(async () => {
  fx = await startVaultFixtures({
    account: {
      email: "me@example.test",
      password: PASSWORD,
      totpSeed: "JBSWY3DPEHPK3PXP",
      pin: "1",
    },
    mail: null,
  });
  const login = fx.origin("login");
  s = await startVaultScenario({
    chromiumArgs: chromiumArgsFor([]),
    scenarios: [
      {
        name: "get-form",
        turns: [
          read,
          { outputs: [{ type: "fill_named", alias: "site", field: "password", name: "Password" }] },
          { outputs: [{ type: "click_named", name: "Sign in" }] },
          read,
          { outputs: [{ type: "turn", status: "done", reason: "Finished" }] },
        ],
      },
    ],
  });
  await createVaultItem(s.owner.db, {
    workspaceId: s.workspaceId,
    alias: "site",
    origin: login,
    label: "Site",
    imap: null,
    secrets: [
      {
        field: "password",
        sealed: await sealValue(
          s.keys.publicKey,
          {
            kind: "secret",
            workspaceId: s.workspaceId,
            alias: "site",
            origin: login,
            field: "password",
          },
          PASSWORD,
        ),
      },
    ],
    actor: s.userId,
  });
  runId = await s.start({
    name: "get-form",
    goal: `Sign in at ${login}/get-form.`,
    allowedOrigins: [login],
    approvalMode: "auto_within_allowlist",
  });
});
afterAll(async () => {
  await s?.stop();
  await fx?.close();
});

describe("a password carried in a URL (final review I2)", () => {
  it("never reaches the model's page header, run_transcript or the step records", async () => {
    expect((await s.settle(runId)).status).toBe("completed");
    // Positive control: the browser really sent the form-encoded password in the URL.
    expect(fx.requests.some((r) => r.path === "/welcome")).toBe(true);
    const requests = JSON.stringify(s.mock.requestsFor("get-form").map((r) => r.body));
    // The welcome page's URL reached the model's page header, and only redacted.
    expect(requests).toContain("Welcome");
    expect(requests).toContain(SECRET_REDACTION);
    const [transcript] = await s.owner
      .sql`select coalesce(string_agg(item::text, E'\\n'), '') as dump from run_transcript where run_id = ${runId}`;
    const [steps] = await s.owner
      .sql`select coalesce(string_agg(s::text, E'\\n'), '') as dump from run_steps s where run_id = ${runId}`;
    for (const [where, text] of [
      ["model requests", requests],
      ["run_transcript", String(transcript?.dump ?? "")],
      ["run_steps", String(steps?.dump ?? "")],
    ] as const)
      expectAbsent(text, where, ENCODED);
  });
});
