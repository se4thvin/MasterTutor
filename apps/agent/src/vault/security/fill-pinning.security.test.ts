import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FIXTURE_HOSTS,
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../../tests/fixtures/vault-sites/server.ts";
import { fillCredential } from "../fill.ts";
import {
  humanApproval,
  launchTestBrowser,
  refMap,
  toolContext,
  type TestBrowser,
} from "../testing/browser.ts";
import { startVaultTestEnv, type VaultTestEnv } from "../testing/env.ts";

// §12 security tests 2 (origin pinning), 3 (field type) and the credential half of 4 (injection).
const account = {
  email: "me@example.test",
  password: "OTTER5PIN9CANARY",
  totpSeed: "JBSWY3DPEHPK3PXP",
  pin: "739146",
};
let env: VaultTestEnv;
let fx: VaultFixtures;
let tb: TestBrowser;
let refs: ReturnType<typeof refMap>;
let runId: string;

async function attempt(field: "password" | "pin", selector: string, frameIndex?: number) {
  const frame = frameIndex === undefined ? undefined : tb.page.frames()[frameIndex];
  const approval = humanApproval(env.userId);
  const ctx = toolContext({ runId, workspaceId: env.workspaceId, session: tb.session, approval });
  return fillCredential(env.deps({ resolveRef: refs.resolve }), ctx, {
    alias: "site",
    field,
    target: await refs.ref(selector, frame),
  });
}

/** Any exfiltration POST that is not to the login site itself (the evil and the same-site host). */
const leaked = () =>
  fx.requests.filter(
    (r) => r.host !== FIXTURE_HOSTS.login && r.path === "/collect" && r.body !== "",
  );
const lastAudit = async () =>
  (
    await env.owner
      .sql`select action, outcome from vault_audit where run_id = ${runId} order by at desc limit 1`
  )[0];

beforeAll(async () => {
  env = await startVaultTestEnv();
  fx = await startVaultFixtures({ account, mail: null });
  await env.seedItem({
    alias: "site",
    origin: fx.origin("login"),
    secrets: { password: account.password, pin: account.pin },
  });
});
beforeEach(async () => {
  tb = await launchTestBrowser({ allowedOrigins: fx.origins });
  refs = refMap(tb);
  runId = await env.newRun([fx.origin("login")]);
});
afterEach(async () => {
  await tb?.close();
});
afterAll(async () => {
  await fx?.close();
  await env?.stop();
});

describe("origin pinning", () => {
  it("counts a post to any host but the login site as a leak (M5)", () => {
    const before = fx.requests.length;
    fx.requests.push({ host: FIXTURE_HOSTS.other, method: "POST", path: "/collect", body: "x" });
    expect(leaked()).toHaveLength(1);
    fx.requests.splice(before);
  });

  it("refuses a field in another origin's frame even when document.domain lets the page script it (I1)", async () => {
    await tb.page.goto(`${fx.origin("login")}/iframe-domain`);
    await tb.page.frames()[1]!.waitForSelector("#domain-password");
    expect(await attempt("password", "#domain-password", 1)).toEqual({ error: "frame_mismatch" });
    expect(await tb.page.frames()[1]!.inputValue("#domain-password")).toBe("");
    expect(leaked()).toEqual([]);
  });

  it("refuses a lookalike domain serving the same login page", async () => {
    await tb.page.goto(`${fx.origin("lookalike")}/password`);
    expect(await attempt("password", "#password")).toEqual({ error: "origin_mismatch" });
    expect(await tb.page.inputValue("#password")).toBe("");
    expect(await lastAudit()).toMatchObject({ action: "denied", outcome: "origin_mismatch" });
  });

  it("refuses a password field in a same-site iframe from another origin", async () => {
    await tb.page.goto(`${fx.origin("login")}/iframe-same-site`);
    await tb.page.frames()[1]!.waitForSelector("#frame-password");
    expect(await attempt("password", "#frame-password", 1)).toEqual({ error: "frame_mismatch" });
    expect(leaked()).toEqual([]);
  });

  it("refuses a password field in a cross-site (out-of-process) iframe", async () => {
    await tb.page.goto(`${fx.origin("login")}/iframe-cross-site`);
    await tb.page.frames()[1]!.waitForSelector("#frame-password");
    expect(await attempt("password", "#frame-password", 1)).toEqual({ error: "frame_mismatch" });
    expect(leaked()).toEqual([]);
  });

  it("stops a fill when the page redirects mid-fill and leaks nothing to the new page", async () => {
    await tb.page.goto(`${fx.origin("login")}/redirect`);
    expect(await attempt("pin", "#rpin0")).toEqual({ error: "origin_mismatch" });
    expect(await lastAudit()).toMatchObject({ action: "denied", outcome: "navigated_mid_fill" });
    await tb.page.waitForURL(`${fx.origin("evil")}/landing`);
    expect(leaked()).toEqual([]);
  });
});

describe("field type", () => {
  it("refuses a password into a text field labelled 'Password'", async () => {
    await tb.page.goto(`${fx.origin("login")}/text-trap`);
    expect(await attempt("password", "#comment")).toEqual({ error: "field_type_mismatch" });
    expect(await tb.page.inputValue("#comment")).toBe("");
  });

  it("refuses even when page scripts make the field claim to be a password", async () => {
    await tb.page.goto(`${fx.origin("login")}/tampered`);
    expect(await attempt("password", "#note")).toEqual({ error: "field_type_mismatch" });
  });
});

describe("prompt injection (credential path)", () => {
  it("cannot steer a password into the injection page's exfiltrating comments box", async () => {
    await tb.page.goto(`${fx.origin("login")}/injection`);
    expect(await attempt("password", "#comments")).toEqual({ error: "field_type_mismatch" });
    expect(await tb.page.inputValue("#comments")).toBe("");
    expect(leaked()).toEqual([]);
  });
});
