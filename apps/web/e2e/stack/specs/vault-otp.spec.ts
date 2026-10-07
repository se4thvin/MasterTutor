import { BYPASS_DECIDER, isPersonDecider } from "@mastertutor/contracts";
import { expect, test } from "@playwright/test";
import { LOGIN } from "../../../../../tests/behaviour/constants.ts";
import { GREENMAIL_USER } from "../../../../../tests/fixtures/vault-sites/greenmail.ts";
import { FIXTURE_MAIL_FROM } from "../../../../../tests/fixtures/vault-sites/server.ts";
import { E2E_ALIAS, E2E_SCENARIO } from "../../../../../tests/llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { STACK_CANARIES } from "../../../../../tests/security/canaries.ts";
import { eventsOf, replayEvents } from "../support/events.ts";
import { createRun, hasStatus, waitForRun } from "../support/runs.ts";
import { addSignIn, auditFor, listSignIns, removeSignIn } from "../support/vault.ts";

const auto = { allowedOrigins: [LOGIN], approvalMode: "auto_within_allowlist" as const };

test.describe
  .serial("vault and one-time codes (credentials only through the Vault UI, D34)", () => {
  test("sign-ins typed into the Vault UI are sealed and never rendered back", async ({
    page,
    request,
  }) => {
    await removeSignIn(request, E2E_ALIAS.login);
    await removeSignIn(request, E2E_ALIAS.imap);
    await addSignIn(page, {
      alias: E2E_ALIAS.login,
      website: LOGIN,
      name: "Fixture login",
      username: STACK_CANARIES.username,
      password: STACK_CANARIES.password,
      totpSeed: STACK_CANARIES.totpSeed,
      pin: STACK_CANARIES.pin,
    });
    await addSignIn(page, {
      alias: E2E_ALIAS.imap,
      website: LOGIN,
      name: "Fixture email codes",
      username: STACK_CANARIES.username,
      password: STACK_CANARIES.password,
      imap: {
        server: "greenmail",
        port: 3143,
        user: GREENMAIL_USER.login,
        from: FIXTURE_MAIL_FROM,
        password: STACK_CANARIES.imapPassword,
      },
    });
    await page.reload();
    const html = await page.content();
    const items = await listSignIns(request);
    const listed = JSON.stringify(items);
    for (const [name, value] of Object.entries(STACK_CANARIES)) {
      expect(html, name).not.toContain(value);
      expect(listed, name).not.toContain(value);
    }
    expect(
      items
        .filter((item) => item.origin === LOGIN)
        .map((item) => item.alias)
        .sort(),
    ).toEqual([E2E_ALIAS.imap, E2E_ALIAS.login]);
  });

  test("the agent signs in with that item, filling from the vault", async ({ request }) => {
    const runId = await createRun(request, {
      goal: scenarioGoal(E2E_SCENARIO.loginPassword, `Sign in at ${LOGIN}/password`),
      ...auto,
    });
    await waitForRun(request, runId, hasStatus("completed"), "signed in"); // doneSeeing("Signed in")
  });

  test("an OTP the person types into CodeSlots unblocks the sign-in", async ({ page, request }) => {
    const runId = await createRun(request, {
      goal: scenarioGoal(E2E_SCENARIO.loginOtpUi, `Verify at ${LOGIN}/otp-fixed`),
      ...auto,
    });
    await waitForRun(request, runId, (r) => r.waitReason === "otp", "waiting for a code");
    await page.goto(`/runs/${runId}`);
    // The card leaves as soon as the run resumes, so the code's delivery is checked on the wire.
    const submitted = page.waitForResponse((r) => r.url().endsWith("/api/rpc/runs/submitOtp"));
    await page.getByLabel("One-time code").pressSequentially(STACK_CANARIES.otp);
    expect((await submitted).status()).toBe(200);
    await waitForRun(request, runId, hasStatus("completed"), "code accepted"); // doneSeeing("Code accepted")
  });

  test("an emailed code is read over IMAP without the person", async ({ request }) => {
    const runId = await createRun(request, {
      goal: scenarioGoal(E2E_SCENARIO.loginOtpImap, `Verify at ${LOGIN}/email-otp`),
      ...auto,
    });
    await waitForRun(request, runId, hasStatus("completed"), "code accepted");
    expect((await auditFor(request, runId)).map((row) => row.action)).toContain("otp_received");
  });

  test("bypass fills without asking and never records a person's decision (D44)", async ({
    request,
  }) => {
    const runId = await createRun(request, {
      goal: scenarioGoal(E2E_SCENARIO.loginPassword, `Sign in at ${LOGIN}/password`),
      allowedOrigins: [LOGIN],
      approvalMode: "bypass",
      bypassAcknowledged: true,
    });
    await waitForRun(request, runId, hasStatus("completed"), "signed in");
    for (const event of eventsOf(
      (await replayEvents(request, runId)).records,
      "approval_resolved",
    )) {
      expect(event.decidedBy).toBe(BYPASS_DECIDER);
    }
    const audit = await auditFor(request, runId);
    expect(audit.length).toBeGreaterThan(0);
    for (const row of audit) expect(isPersonDecider(row.approvedBy), row.action).toBe(false);
  });
});
