import { getVaultGrantApprover } from "@mastertutor/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../tests/fixtures/vault-sites/server.ts";
import { fillApproval, fillCredential, forgetFillState } from "./fill.ts";
import { generateVaultKeyPair, vaultKeyPairFromPrivate } from "@mastertutor/sealing/open";
import { readPageTool } from "../tools/read-page.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { register } from "../tools/types.ts";
import { ControlHeld, captureModelScreenshot, resolveVaultTarget } from "./runtime.ts";
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
/** One approve-phase question, asked against the page as it is now. */
const ask = async (
  d: ReturnType<typeof deps>,
  alias: string,
  field: "username" | "password",
  selector: string,
) => fillApproval(d, ctx(), { alias, field, target: await refs.ref(selector) });
/** A person's approval of exactly the card they were shown. */
const approve = (card: Awaited<ReturnType<typeof fillApproval>>) =>
  humanApproval(env.userId, card?.kind === "credential_first_use" ? (card.postsTo ?? null) : null);
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
      await fillApproval(deps(), ctx(), {
        alias: "first",
        field: "username",
        target: await refs.ref("#email"),
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
    expect(mask.filledFrames?.()).toEqual([
      { frameId: frameTree.frame.id, loaderId: frameTree.frame.loaderId },
    ]);
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

  it("records a fill in a same-origin iframe under the child frame's id (I1)", async () => {
    await tb.page.goto(`${login}/iframe-same-origin`);
    const frame = tb.page.frames()[1]!;
    await frame.waitForSelector("#child-password");
    const d = deps();
    expect(
      await fillCredential(d, ctx(), {
        alias: "site",
        field: "password",
        target: await refs.ref("#child-password", frame),
      }),
    ).toEqual({ ok: true });
    const { frameTree } = await (await tb.session.cdp()).send("Page.getFrameTree");
    const child = frameTree.childFrames![0]!.frame;
    expect(d.fingerprints.forRun(runId).filledFrames?.()).toEqual([
      { frameId: child.id, loaderId: child.loaderId },
    ]);
  });

  it("a fill the page makes fail leaves nothing of the secret unmasked (I2)", async () => {
    await tb.page.goto(`${login}/rewrite`);
    const d = deps();
    const target = await refs.ref("#password");
    expect(await fillCredential(d, ctx(), { alias: "site", field: "password", target })).toEqual({
      error: "fill_failed",
    });
    // The box is cleared (the page's own handler may add to the empty value), and the page's
    // echo of the value is masked and redacted.
    expect(await tb.page.inputValue("#password")).not.toContain(account.password);
    const mask = d.fingerprints.forRun(runId);
    expect(mask.nodeIds(await tb.session.cdp())).toHaveLength(1);
    const text = await tb.page.evaluate(() => `${document.title}\n${document.body.innerText}`);
    expect(text).toContain(account.password);
    expect(mask.redact(text)).not.toContain(account.password);
    const registry = new ToolRegistry([register(readPageTool)], env.log.logger, mask);
    const { output } = await registry.run(
      "read_page",
      { mode: "text", sinceHash: null },
      {
        runId,
        workspaceId: env.workspaceId,
        session: tb.session,
        signal: new AbortController().signal,
        log: env.log.logger,
        approval: null,
      },
    );
    expect(output).not.toContain(account.password);
    const shot = await captureModelScreenshot(tb.session, mask, new AbortController().signal);
    expect(shot.dropped).toBe(true);
  });

  it("asks again when the form posts off the item's origin, by action or by submit button (M4)", async () => {
    // One vault for the whole run, as in production: it remembers the destination it asked about.
    const d = deps();
    for (const path of ["/offsite-form", "/offsite-button"]) {
      await tb.page.goto(`${login}${path}`);
      expect(
        await fillCredential(d, ctx(), {
          alias: "site",
          field: "password",
          target: await refs.ref("#password"),
        }),
        path,
      ).toEqual({ error: "approval_required" });
      expect(await tb.page.inputValue("#password")).toBe("");
      const [row] = await env.owner
        .sql`select action, outcome from vault_audit where run_id = ${runId} order by at desc limit 1`;
      expect(row).toMatchObject({ action: "denied", outcome: "form_action_offsite" });
      // The next approve phase shows where the form posts; a person approves that destination.
      const card = await ask(d, "site", "password", "#password");
      expect(card, path).toMatchObject({ postsTo: fx.origin("evil") });
      expect(
        await fillCredential(d, ctx(approve(card)), {
          alias: "site",
          field: "password",
          target: await refs.ref("#password"),
        }),
        path,
      ).toEqual({ ok: true });
    }
  });

  it("checks control and abort before it decrypts anything (M8)", async () => {
    await tb.page.goto(`${login}/password`);
    // With keys that cannot open the box, decrypting first would answer fill_failed instead.
    const stranger = await vaultKeyPairFromPrivate((await generateVaultKeyPair()).privateKeyBase64);
    tb.setController("user");
    await expect(
      fillCredential({ ...deps(), keys: stranger }, ctx(), {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).rejects.toBeInstanceOf(ControlHeld);
    tb.setController("agent");
    const [row] = await env.owner
      .sql`select count(*)::int as n from vault_audit where run_id = ${runId}`;
    expect(row?.n).toBe(0);
  });

  it("asks a person about an off-origin form, even for a granted alias (carry-over 1)", async () => {
    await tb.page.goto(`${login}/offsite-form`);
    const d = deps();
    const call = async (approval: ReturnType<typeof humanApproval> | null) =>
      fillCredential(d, ctx(approval), {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      });
    expect(await call(null)).toEqual({ error: "approval_required" });
    // The approve phase raises a real request naming where the form posts, even for a granted alias.
    expect(
      await fillApproval(d, ctx(), {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).toEqual({
      kind: "credential_first_use",
      alias: "site",
      origin: login,
      postsTo: fx.origin("evil"),
    });
    // A policy (auto-mode) approval never clears the pin: a person must look.
    expect(await call(policyApproval(fx.origin("evil")))).toEqual({ error: "needs_human" });
    expect(await tb.page.inputValue("#password")).toBe("");
    expect(await call(humanApproval(env.userId, fx.origin("evil")))).toEqual({ ok: true });
    // Once filled, the request is not raised again for a same-origin page.
    await tb.page.goto(`${login}/password`);
    expect(
      await fillApproval(d, ctx(), {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).toBeNull();
  });

  it("reads a form's real action even when a field named 'action' shadows it, and treats javascript: as off-origin (carry-over 2)", async () => {
    for (const path of ["/shadowed-action", "/javascript-action"]) {
      await tb.page.goto(`${login}${path}`);
      expect(
        await fillCredential(deps(), ctx(), {
          alias: "site",
          field: "password",
          target: await refs.ref("#password"),
        }),
        path,
      ).toEqual({ error: "approval_required" });
    }
  });

  it("registers no masks when the value does not fit the boxes (N2)", async () => {
    await env.seedItem({ alias: "shortpin", origin: login, secrets: { pin: "1234" } });
    await grant("shortpin");
    await tb.page.goto(`${login}/pin`);
    const d = deps();
    expect(
      await fillCredential(d, ctx(), {
        alias: "shortpin",
        field: "pin",
        target: await refs.ref("#pin0"),
      }),
    ).toEqual({ error: "fill_failed" });
    expect(d.fingerprints.forRun(runId).nodeIds(await tb.session.cdp())).toEqual([]);
    expect(d.fingerprints.forRun(runId).hasSecrets()).toBe(false);
  });

  it("fills nothing of a same-turn username and password pair without a card naming the destination (T10-12 I1)", async () => {
    await env.seedItem({
      alias: "pair",
      origin: login,
      secrets: { username: account.email, password: account.password },
    });
    await tb.page.goto(`${login}/offsite-form`);
    const d = deps();
    // One approve phase raises both cards before either call acts; each names where the form posts.
    const cards = [
      await ask(d, "pair", "username", "#username"),
      await ask(d, "pair", "password", "#password"),
    ];
    for (const card of cards)
      expect(card).toEqual({
        kind: "credential_first_use",
        alias: "pair",
        origin: login,
        postsTo: fx.origin("evil"),
      });
    // Approvals of cards that named no destination clear neither call, first or second.
    for (const [field, selector] of [
      ["username", "#username"],
      ["password", "#password"],
    ] as const)
      expect(
        await fillCredential(d, ctx(humanApproval(env.userId)), {
          alias: "pair",
          field,
          target: await refs.ref(selector),
        }),
        field,
      ).toEqual({ error: "approval_required" });
    expect([await tb.page.inputValue("#username"), await tb.page.inputValue("#password")]).toEqual([
      "",
      "",
    ]);
    // The cards that named it do.
    expect(
      await fillCredential(d, ctx(approve(cards[0]!)), {
        alias: "pair",
        field: "username",
        target: await refs.ref("#username"),
      }),
    ).toEqual({ ok: true });
    expect(
      await fillCredential(d, ctx(approve(cards[1]!)), {
        alias: "pair",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).toEqual({ ok: true });
  });

  it("refuses every call of a turn once the page swaps the destination its cards named (T10-12 I1)", async () => {
    await env.seedItem({
      alias: "swap",
      origin: login,
      secrets: { username: account.email, password: account.password },
    });
    await tb.page.goto(`${login}/offsite-form`);
    const d = deps();
    const other = fx.origin("other");
    const swap = () =>
      tb.page.evaluate(
        (to) => document.querySelector("form")!.setAttribute("action", `${to}/collect`),
        other,
      );
    const fill = async (card: Awaited<ReturnType<typeof ask>>, field: "username" | "password") =>
      fillCredential(d, ctx(approve(card)), {
        alias: "swap",
        field,
        target: await refs.ref(`#${field}`),
      });

    // Swapped after the approve phase, before any call acts: both refused.
    let cards = [
      await ask(d, "swap", "username", "#username"),
      await ask(d, "swap", "password", "#password"),
    ];
    await swap();
    expect(await fill(cards[0]!, "username")).toEqual({ error: "approval_required" });
    expect(await fill(cards[1]!, "password")).toEqual({ error: "approval_required" });
    expect([await tb.page.inputValue("#username"), await tb.page.inputValue("#password")]).toEqual([
      "",
      "",
    ]);

    // Swapped between the two calls: the first fills, the second is refused.
    await tb.page.goto(`${login}/offsite-form`);
    cards = [
      await ask(d, "swap", "username", "#username"),
      await ask(d, "swap", "password", "#password"),
    ];
    expect(await fill(cards[0]!, "username")).toEqual({ ok: true });
    await swap();
    expect(await fill(cards[1]!, "password")).toEqual({ error: "approval_required" });
    expect(await tb.page.inputValue("#password")).toBe("");
    // The next card names the new destination.
    expect(await ask(d, "swap", "password", "#password")).toMatchObject({ postsTo: other });
  });

  it("names every off-origin destination of the form, a submit button's formaction included (N7)", async () => {
    await tb.page.goto(`${login}/offsite-split`);
    const d = deps();
    const both = [fx.origin("evil"), fx.origin("other")].sort().join(", ");
    const card = await ask(d, "site", "password", "#password");
    expect(card).toMatchObject({ postsTo: both });
    const fill = async (postsTo: string) =>
      fillCredential(d, ctx(humanApproval(env.userId, postsTo)), {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      });
    // A card that named only the form's action never covers the button that posts elsewhere.
    expect(await fill(fx.origin("other"))).toEqual({ error: "approval_required" });
    expect(await tb.page.inputValue("#password")).toBe("");
    expect(await fill(both)).toEqual({ ok: true });

    // A submit button added after the approve phase, posting elsewhere, is refused too.
    await tb.page.goto(`${login}/offsite-form`);
    const shown = await ask(d, "site", "password", "#password");
    expect(shown).toMatchObject({ postsTo: fx.origin("evil") });
    await tb.page.evaluate((to) => {
      const button = document.createElement("button");
      button.type = "submit";
      button.setAttribute("formaction", `${to}/collect`);
      button.textContent = "Continue";
      document.querySelector("form")!.append(button);
    }, fx.origin("other"));
    expect(await fill(fx.origin("evil"))).toEqual({ error: "approval_required" });
    expect(await tb.page.inputValue("#password")).toBe("");
  });

  it("names the destination of a submit button outside the form, linked by form= (review I1)", async () => {
    await tb.page.goto(`${login}/offsite-outside-button`);
    const d = deps();
    const card = await ask(d, "site", "password", "#password");
    expect(card).toMatchObject({ postsTo: fx.origin("evil") });
    // A plain first-use card (or a grant alone) never clears it.
    expect(
      await fillCredential(d, ctx(humanApproval(env.userId)), {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).toEqual({ error: "approval_required" });
    expect(await tb.page.inputValue("#password")).toBe("");
  });

  it("names where an image submit button posts, inside the form or linked by form= (final review I1)", async () => {
    for (const path of ["/offsite-image-inside", "/offsite-image-outside"]) {
      await tb.page.goto(`${login}${path}`);
      const d = deps();
      expect(await ask(d, "site", "password", "#password"), path).toMatchObject({
        postsTo: fx.origin("evil"),
      });
      expect(
        await fillCredential(d, ctx(), {
          alias: "site",
          field: "password",
          target: await refs.ref("#password"),
        }),
        path,
      ).toEqual({ error: "approval_required" });
      expect(await tb.page.inputValue("#password"), path).toBe("");
    }
  });

  it("names where an image submit button posts when the form lives in a shadow root (final re-review I1)", async () => {
    for (const path of ["/offsite-image-shadow-inside", "/offsite-image-shadow-outside"]) {
      await tb.page.goto(`${login}${path}`);
      // Positive control: the browser itself would submit the form to evil through that button.
      expect(
        await tb.page.evaluate(() => {
          const root = document.getElementById("host")!.shadowRoot!;
          const image = root.getElementById("go") as HTMLInputElement;
          return image.form === root.getElementById("f") ? image.formAction : null;
        }),
        path,
      ).toBe(`${fx.origin("evil")}/collect`);
      const d = deps();
      expect(await ask(d, "site", "password", "#password"), path).toMatchObject({
        postsTo: fx.origin("evil"),
      });
      expect(
        await fillCredential(d, ctx(), {
          alias: "site",
          field: "password",
          target: await refs.ref("#password"),
        }),
        path,
      ).toEqual({ error: "approval_required" });
    }
  });

  it("hands a form with more destinations than a card can name to a person, never a cut list", async () => {
    await tb.page.goto(`${login}/offsite-many`);
    const d = deps();
    // No card can show every destination, so none is raised.
    expect(await ask(d, "site", "password", "#password")).toBeNull();
    const call = ctx(humanApproval(env.userId));
    expect(
      await fillCredential(d, call, {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).toEqual({ error: "needs_human" });
    expect(call.handOvers).toHaveLength(1);
    expect(call.handOvers[0]).toMatch(/too many places/);
    expect(await tb.page.inputValue("#password")).toBe("");
    const [row] = await env.owner
      .sql`select outcome from vault_audit where run_id = ${runId} order by at desc limit 1`;
    expect(row?.outcome).toBe("form_destinations_too_long");
  });

  it("in auto mode hands the page to a person, naming where the form posts (needs_human)", async () => {
    await tb.page.goto(`${login}/offsite-form`);
    const auto = ctx(policyApproval(fx.origin("evil")));
    expect(
      await fillCredential(deps(), auto, {
        alias: "site",
        field: "password",
        target: await refs.ref("#password"),
      }),
    ).toEqual({ error: "needs_human" });
    expect(auto.handOvers).toHaveLength(1);
    expect(auto.handOvers[0]).toContain(fx.origin("evil"));
  });

  it("forgets a finished run's fill state", async () => {
    await tb.page.goto(`${login}/offsite-form`);
    const d = deps();
    await fillCredential(d, ctx(), {
      alias: "site",
      field: "password",
      target: await refs.ref("#password"),
    });
    expect(d.signInStarted.size).toBe(1);
    forgetFillState(d, runId, Date.now());
    expect([d.signInStarted.size, d.totpSteps.size]).toEqual([0, 0]);
  });

  describe('target "focused" (Phase 10, P10a-9/10): the real resolver, main frame only', () => {
    const focusedDeps = () =>
      env.deps({ resolveRef: resolveVaultTarget, logins: { noteLogin: () => undefined } });
    const focused = (field: "username" | "password") => ({
      alias: "site",
      field,
      target: "focused" as const,
    });

    it("fills the focused password input after every §9 check", async () => {
      await tb.page.goto(`${login}/password`);
      await tb.page.focus("#password");
      expect(await fillCredential(focusedDeps(), ctx(), focused("password"))).toEqual({ ok: true });
      expect(await tb.page.inputValue("#password")).not.toBe("");
    });

    it("refuses a password into a focused text input (field_type_mismatch)", async () => {
      await tb.page.goto(`${login}/password`);
      await tb.page.focus("#email");
      expect(await fillCredential(focusedDeps(), ctx(), focused("password"))).toEqual({
        error: "field_type_mismatch",
      });
    });

    it("answers no_focused_field when nothing is focused", async () => {
      await tb.page.goto(`${login}/password`);
      await tb.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      expect(await fillCredential(focusedDeps(), ctx(), focused("password"))).toEqual({
        error: "no_focused_field",
      });
    });

    it("never reaches into a frame: focus inside an iframe is no_focused_field", async () => {
      await tb.page.goto(`${login}/iframe-same-origin`);
      const frame = tb.page.frames()[1]!;
      await frame.waitForSelector("#child-password");
      await frame.focus("#child-password");
      expect(await fillCredential(focusedDeps(), ctx(), focused("password"))).toEqual({
        error: "no_focused_field",
      });
      expect(await frame.inputValue("#child-password")).toBe("");
    });

    it("asks the approve-phase question about the focused field like any ref", async () => {
      // A fresh, never-granted alias, so the card does not depend on test order (W2).
      await env.seedItem({
        alias: "focus-first",
        origin: login,
        secrets: { username: account.email },
      });
      await tb.page.goto(`${login}/password`);
      await tb.page.focus("#email");
      expect(
        await fillApproval(focusedDeps(), ctx(), {
          alias: "focus-first",
          field: "username",
          target: "focused",
        }),
      ).toEqual({ kind: "credential_first_use", alias: "focus-first", origin: login });
    });
  });
});
