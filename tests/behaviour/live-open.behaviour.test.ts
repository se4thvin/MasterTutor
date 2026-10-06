import { LIVE_SLOT_COOKIE, NEKO_SESSION_COOKIE, liveEmbedPath } from "@mastertutor/contracts";
import { createDb, type DbHandle } from "@mastertutor/db";
import { leaseSlotForTest, releaseSlotForTest, seedMember, seedRun } from "@mastertutor/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { parseCookies, verifyLiveSlot } from "../../apps/web/lib/server/live/cookie.ts";
import {
  LiveAccessError,
  openLive,
  type LiveDeps,
} from "../../apps/web/lib/server/live/open-live.ts";
import { BEHAVIOUR_NEKO_MEMBER_SECRET, nekoBaseUrlForTests } from "./constants.ts";
import { behaviourEnv } from "./env.ts";

const SLOT = "browser-2";
const now = 1_700_000_000;
let owner: DbHandle;
let web: DbHandle;
let deps: LiveDeps;
let member: { userId: string; workspaceId: string };
let outsider: { userId: string; workspaceId: string };
const sockets: WebSocket[] = [];

beforeAll(async () => {
  const env = behaviourEnv();
  owner = createDb(env.ownerUrl, { max: 2 });
  web = createDb(env.webUrl, { max: 2 });
  member = await seedMember(owner.db);
  outsider = await seedMember(owner.db);
  deps = {
    db: web.db,
    nekoMemberSecret: BEHAVIOUR_NEKO_MEMBER_SECRET,
    liveCookieSecret: "live-cookie-secret-for-tests-0123456789",
    nekoBaseUrl: () => nekoBaseUrlForTests(SLOT),
    nowSeconds: () => now,
  };
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await releaseSlotForTest(owner.db, SLOT);
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close()]);
});

const cookieValue = (setCookies: string[], name: string) =>
  parseCookies(setCookies.map((c) => c.split(";")[0]!).join("; ")).get(name)![0]!;

describe("openLive against a real slot (spec §10.2.1)", () => {
  it("says sleeping when the run holds no slot", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId, status: "sleeping" });
    expect(await openLive(deps, { runId, userId: member.userId })).toEqual({
      result: { sleeping: true },
      setCookies: [],
    });
  });

  it("logs into n.eko server-side and returns run-scoped cookies, no ICE servers in v1", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, SLOT, runId);
    const { result, setCookies } = await openLive(deps, { runId, userId: member.userId });
    expect(result).toEqual({
      sleeping: false,
      slotName: SLOT,
      embedPath: liveEmbedPath(runId),
      iceServers: [],
    });
    expect(setCookies).toHaveLength(2);
    for (const cookie of setCookies) {
      expect(cookie).toContain(
        `; Path=/live/${runId}/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`,
      );
    }
    const slotValue = cookieValue(setCookies, LIVE_SLOT_COOKIE);
    expect(
      verifyLiveSlot(deps.liveCookieSecret, slotValue, {
        runId,
        userId: member.userId,
        nowSeconds: now,
      }),
    ).toBe(SLOT);
    const whoami = await fetch(`${nekoBaseUrlForTests(SLOT)}/api/whoami`, {
      headers: { cookie: `${NEKO_SESSION_COOKIE}=${cookieValue(setCookies, NEKO_SESSION_COOKIE)}` },
    });
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({ id: "user" });
    expect(JSON.stringify(setCookies)).not.toContain(BEHAVIOUR_NEKO_MEMBER_SECRET);
  });

  it("hides other workspaces' runs", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await expect(openLive(deps, { runId, userId: outsider.userId })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("reports in_use while another tab is connected, then recovers when it closes (base Review Focus 2)", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, SLOT, runId);
    const first = await openLive(deps, { runId, userId: member.userId });
    const token = cookieValue(first.setCookies, NEKO_SESSION_COOKIE);
    const socket = new WebSocket(
      `${nekoBaseUrlForTests(SLOT).replace("http", "ws")}/api/ws?token=${token}`,
    );
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("ws failed")));
    });
    const error = await openLive(deps, { runId, userId: member.userId }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveAccessError);
    expect((error as LiveAccessError).code).toBe("in_use");
    socket.close();
    await waitFor(
      () =>
        openLive(deps, { runId, userId: member.userId }).then(
          (r) => !r.result.sleeping,
          () => false,
        ),
      { label: "openLive after the other tab closed", timeoutMs: 15_000, intervalMs: 500 },
    );
  });

  it("reports unavailable when the slot does not answer", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, SLOT, runId);
    await expect(
      openLive(
        { ...deps, nekoBaseUrl: () => "http://127.0.0.1:9" },
        { runId, userId: member.userId },
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
