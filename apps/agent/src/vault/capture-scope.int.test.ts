import { afterAll, beforeAll, expect, it } from "vitest";
import { capturePreferences, runs, runEvents } from "@mastertutor/db";
import { eq } from "drizzle-orm";
import { startVaultTestEnv, type VaultTestEnv } from "./testing/env.ts";
import { startScopeScreenServer } from "./scope-screen.ts";
import { screenCaptureScope } from "../../../web/lib/server/vault/scope-screen.ts";

import {
  setCaptureBrief,
  setCapturePreference,
} from "../../../web/lib/server/runs/capture-intent.ts";

let env: VaultTestEnv;

let server: Awaited<ReturnType<typeof startScopeScreenServer>>;
const token = "test-internal-token-for-scope-screen";
const canary = "MARMOT4-CANARY8-VELVET";
const brief = { keep: ["reading_text"] as "reading_text"[], skip: [], scopeNote: "Reading only" };
beforeAll(async () => {
  env = await startVaultTestEnv();
  await env.seedItem({
    alias: "scope-test",
    origin: "https://example.com",
    secrets: { password: canary, pin: "12" },
  });

  server = await startScopeScreenServer({ ...env.deps(), token, port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await server?.close();
  await env?.stop();
});
const screen = (workspaceId: string, text: string) =>
  screenCaptureScope(workspaceId, text, {
    url: `http://127.0.0.1:${server.port}/scope-screen`,
    token,
  });

it("refuses a vault canary before scope answers, edits or preferences persist anything", async () => {
  const runId = await env.newRun();
  const scope = { workspaceId: env.workspaceId, actor: env.userId };
  await setCaptureBrief(env.web.db, scope, { runId, brief }, screen);
  const before = await env.owner.db.select().from(runEvents).where(eq(runEvents.runId, runId));
  for (const scopeNote of [`Keep ${canary}`, `Keep MARMOT4 CANARY8 VELVET`, "PIN 12"]) {
    const unsafe = { ...brief, scopeNote };
    await expect(
      setCaptureBrief(env.web.db, scope, { runId, brief: unsafe }, screen),
    ).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("secret") });
    await expect(
      setCapturePreference(
        env.web.db,
        scope,
        { url: "https://example.com", brief: unsafe },
        screen,
      ),
    ).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("secret") });
  }
  expect(
    (await env.owner.db.select().from(runs).where(eq(runs.id, runId)))[0]?.captureBrief,
  ).toEqual(brief);
  expect((await env.owner.db.select().from(capturePreferences))[0]?.brief).toEqual(brief);
  expect(await env.owner.db.select().from(runEvents).where(eq(runEvents.runId, runId))).toEqual(
    before,
  );
  expect(env.log.text()).not.toContain(canary);
});

it("fails closed for unauthorized screening", async () => {
  await expect(
    screenCaptureScope(env.workspaceId, "Reading only", {
      url: `http://127.0.0.1:${server.port}/scope-screen`,
      token: "wrong",
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  const reply = await fetch(`http://127.0.0.1:${server.port}/scope-screen`, { method: "POST" });
  expect(reply.status).toBe(401);
});
