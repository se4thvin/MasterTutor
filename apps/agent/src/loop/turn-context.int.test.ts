import { beforeAll, describe, expect, it } from "vitest";
import { PersonDecider } from "@mastertutor/contracts";
import { createVaultItem } from "@mastertutor/db";
import { sealValue } from "@mastertutor/sealing";
import { generateVaultKeyPair, vaultKeyPairFromPrivate } from "@mastertutor/sealing/open";
import { createVault, vaultHooks, type Vault } from "../vault/index.ts";
import {
  click,
  done,
  drive,
  setup,
  mock,
  owner,
  agent,
  workspaceId,
  log,
  decideApproval,
} from "./testing/loop-harness.ts";

const origin = "https://learn.zybooks.com";
const canary = "MARMOT4CANARY8VELVET";
let vault: Vault;
beforeAll(async () => {
  const keys = await vaultKeyPairFromPrivate((await generateVaultKeyPair()).privateKeyBase64);
  await createVaultItem(owner.db, {
    workspaceId,
    alias: "zybooks",
    origin,
    label: "KITE7CANARY3",
    imap: null,
    actor: PersonDecider.parse("user-1"),
    secrets: [
      {
        field: "password",
        sealed: await sealValue(
          keys.publicKey,
          { kind: "secret", workspaceId, alias: "zybooks", origin, field: "password" },
          canary,
        ),
      },
    ],
  });
  vault = createVault({ db: agent.db, keys, log, testMode: true });
});

const aliasLine = `- zybooks (${origin}): password, otp`;
const occurrences = (input: unknown) => JSON.stringify(input).split(aliasLine).length - 1;

describe("turn context (D56)", () => {
  it.each(["ask", "bypass"] as const)(
    "announces a newly approved origin's sign-in once (%s), including after restart",
    async (approvalMode) => {
      const h = await setup([click(), click(30, 40), done()], {
        approvalMode,
        hooks: vaultHooks(vault),
      });
      h.browser.computerHook = async () => {
        if (h.browser.computerRuns.length === 1)
          h.browser.blocked.push({ origin, url: `${origin}/signin` });
      };
      // The first act reaches the new-origin approval; ask waits, bypass keeps running.
      for (let i = 0; i < 4; i++) await h.loop.step(new AbortController().signal);
      if (approvalMode === "ask") {
        await decideApproval(h.run.id, "approved");
        await h.loop.resume(new AbortController().signal);
      }
      // Run through the second decide, then restore before the third.
      while (mock.requestsFor(h.name).length < 2) await h.loop.step(new AbortController().signal);
      expect(occurrences(mock.requestsFor(h.name)[1]?.body.input)).toBe(1);
      expect(await drive(await h.reload())).toEqual({ kind: "completed" });
      expect(occurrences(mock.requestsFor(h.name).at(-1)?.body.input)).toBe(1);
      const input = JSON.stringify(mock.requestsFor(h.name));
      expect(input).not.toContain(canary);
      expect(input).not.toContain("KITE7CANARY3");
    },
  );

  it.each(["ask", "auto_within_allowlist", "bypass"] as const)(
    "keeps a D51 sign-in origin before checking its saved login (%s)",
    async (approvalMode) => {
      const h = await setup([done()], {
        approvalMode,
        allowedOrigins: ["https://www.zybooks.com"],
        hooks: vaultHooks(vault),
      });
      h.browser.url = `${origin}/signin`;
      h.browser.signIn = true;
      expect(await drive(h.loop)).toEqual({ kind: "completed" });
      expect(occurrences(mock.requestsFor(h.name)[0]?.body.input)).toBe(1);
    },
  );

  it("restates policy, budget, plan and saved sign-ins after compaction", async () => {
    const h = await setup([{ ...click(), usage: { input: 210_000 } }, done()], {
      approvalMode: "bypass",
      allowedOrigins: [origin],
      hooks: vaultHooks(vault),
    });
    h.browser.url = `${origin}/`;
    expect(await drive(h.loop)).toEqual({ kind: "completed" });
    const last = JSON.stringify(mock.requestsFor(h.name).at(-1)?.body.input);
    for (const fact of ["Allowed origins:", "Approval mode:", "Budget:", "Plan:", aliasLine])
      expect(last).toContain(fact);
    expect(last).not.toContain(canary);
  });
});

describe("goal source initialization", () => {
  it("a goal URL allows its origin and announces its vault alias on the first model turn", async () => {
    const { CreateRunInput } = await import("@mastertutor/contracts");
    const { startUrl } = await import("./start-url.ts");
    const input = CreateRunInput.parse({
      goal: `${origin}/zybook/course/chapter/4/section/4\n\nTake notes on this page`,
    });
    expect(input.allowedOrigins).toEqual([origin]);
    const h = await setup([done()], {
      allowedOrigins: input.allowedOrigins,
      hooks: vaultHooks(vault),
    });
    h.browser.url = startUrl(input.goal, input.allowedOrigins);
    h.browser.signIn = true;
    expect(await drive(h.loop)).toEqual({ kind: "completed" });
    expect(occurrences(mock.requestsFor(h.name)[0]?.body.input)).toBe(1);
    expect(JSON.stringify(mock.requestsFor(h.name))).not.toContain(canary);
  });
});

const takeover = {
  outputs: [
    {
      type: "turn" as const,
      status: "need_human" as const,
      needHuman: "takeover" as const,
      reason: "Please sign in",
    },
  ],
};

describe("saved sign-in takeover guardrail", () => {
  it.each(["ask", "auto_within_allowlist", "bypass"] as const)(
    "redirects once to fill_credential and honors the second ask after restart (%s)",
    async (approvalMode) => {
      const h = await setup([takeover, takeover], {
        approvalMode,
        allowedOrigins: [origin],
        hooks: vaultHooks(vault),
      });
      h.browser.url = `${origin}/signin`;
      h.browser.signIn = true;
      expect(await h.loop.step(new AbortController().signal)).toEqual({ kind: "continue" });
      expect(await h.loop.step(new AbortController().signal)).toEqual({ kind: "continue" });
      expect(await drive(await h.reload())).toEqual({ kind: "waiting", reason: "takeover" });
      expect(mock.requestsFor(h.name)).toHaveLength(2);
      const input = JSON.stringify(mock.requestsFor(h.name)[1]?.body.input);
      expect(input).toContain("Use fill_credential with alias zybooks");
      expect(input.split("Executor: a saved sign-in is available").length - 1).toBe(1);
      expect(input).not.toContain(canary);
    },
  );
  it("can proceed with a credential tool after the guardrail", async () => {
    const h = await setup(
      [
        takeover,
        {
          outputs: [
            {
              type: "function",
              name: "fill_credential",
              args: { alias: "zybooks", field: "password", target: "e1" },
            },
          ],
        },
        done(),
      ],
      { approvalMode: "bypass", allowedOrigins: [origin], hooks: vaultHooks(vault) },
    );
    h.browser.url = `${origin}/signin`;
    expect(await drive(h.loop)).toEqual({ kind: "completed" });
    expect(h.browser.functionRuns).toEqual([
      { name: "fill_credential", args: { alias: "zybooks", field: "password", target: "e1" } },
    ]);
  });
  it("keeps the once-per-origin limit after compaction", async () => {
    const h = await setup([{ ...takeover, usage: { input: 210_000 } }, takeover], {
      allowedOrigins: [origin],
      hooks: vaultHooks(vault),
    });
    h.browser.url = `${origin}/signin`;
    expect(await drive(h.loop)).toEqual({ kind: "waiting", reason: "takeover" });
    expect(mock.requestsFor(h.name)).toHaveLength(3); // two turns and compaction
    const last = JSON.stringify(mock.requestsFor(h.name).at(-1)?.body.input);
    expect(last).toContain(aliasLine);
    expect(last).toContain("fill_credential");
    expect(last).not.toContain(canary);
  });
  it("does not redirect a vault item outside the run's allowed origins", async () => {
    const h = await setup([takeover], { hooks: vaultHooks(vault) });
    h.browser.url = `${origin}/signin`;
    expect(await drive(h.loop)).toEqual({ kind: "waiting", reason: "takeover" });
    expect(mock.requestsFor(h.name)).toHaveLength(1);
  });
  it("honors captcha requests even on an origin with a saved sign-in", async () => {
    const h = await setup(
      [
        {
          outputs: [
            {
              type: "turn",
              status: "need_human",
              needHuman: "captcha",
              reason: "Solve the captcha",
            },
          ],
        },
      ],
      { allowedOrigins: [origin], hooks: vaultHooks(vault) },
    );
    h.browser.url = `${origin}/signin`;
    expect(await drive(h.loop)).toEqual({ kind: "waiting", reason: "captcha" });
    expect(mock.requestsFor(h.name)).toHaveLength(1);
  });
});
