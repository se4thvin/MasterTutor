import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeNotify } from "@mastertutor/contracts";
import { createDb, type DbHandle } from "@mastertutor/db";
import {
  leaseSlotForTest,
  nextNotification,
  releaseSlotForTest,
  seedMember,
  seedRun,
  startTestDatabase,
  type TestDatabase,
} from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveDeps } from "./open-live.ts";
import { createLiveHandlers } from "./procedures.ts";

let testDb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let fakeNeko: Server;
let nekoStatus = 200;
let member: { userId: string; workspaceId: string };
let handlers: ReturnType<typeof createLiveHandlers>;

beforeAll(async () => {
  testDb = await startTestDatabase({ slots: ["browser-1"] });
  owner = createDb(testDb.ownerUrl, { max: 2 });
  web = createDb(testDb.webUrl, { max: 2 });
  member = await seedMember(owner.db);
  fakeNeko = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (nekoStatus === 307) return void res.writeHead(307, { location: "/elsewhere" }).end();
      if (nekoStatus !== 200) return void res.writeHead(nekoStatus).end();
      res.writeHead(200, { "set-cookie": "NEKO_SESSION=faketoken; Path=/" }).end('{"id":"user"}');
    });
  });
  await new Promise<void>((resolve) => fakeNeko.listen(0, "127.0.0.1", resolve));
  const port = (fakeNeko.address() as AddressInfo).port;
  const deps: LiveDeps = {
    db: web.db,
    nekoMemberSecret: "neko-member-secret-for-tests-0123456789",
    liveCookieSecret: "live-cookie-secret-for-tests-0123456789",
    nekoBaseUrl: () => `http://127.0.0.1:${port}`,
  };
  handlers = createLiveHandlers(() => deps);
});
afterAll(async () => {
  fakeNeko?.close();
  await Promise.all([owner?.close(), web?.close()]);
  await testDb?.stop();
});

const as = (userId: string) => ({ viewer: { id: userId }, resHeaders: new Headers() });

describe("live handlers on liveRouter", () => {
  it("openLive sets both cookies through resHeaders", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await leaseSlotForTest(owner.db, "browser-1", runId);
    const context = as(member.userId);
    expect(await handlers.openLive({ runId }, context)).toMatchObject({
      sleeping: false,
      slotName: "browser-1",
      iceServers: [],
    });
    expect(context.resHeaders.getSetCookie()).toHaveLength(2);
  });

  it("openLive refuses to run without ResponseHeadersPlugin", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await expect(
      handlers.openLive({ runId }, { viewer: { id: member.userId } }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("maps n.eko conflicts and outages to CONFLICT and SERVICE_UNAVAILABLE", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await releaseSlotForTest(owner.db, "browser-1");
    await leaseSlotForTest(owner.db, "browser-1", runId);
    nekoStatus = 422;
    await expect(handlers.openLive({ runId }, as(member.userId))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    nekoStatus = 500;
    await expect(handlers.openLive({ runId }, as(member.userId))).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    // A redirect is a failed n.eko login (NekoLoginError), never a raw fetch TypeError.
    nekoStatus = 307;
    await expect(handlers.openLive({ runId }, as(member.userId))).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    nekoStatus = 200;
  });

  it("takeControl and handBack drive the DB and NOTIFY, with NOT_FOUND and CONFLICT errors", async () => {
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    const takeover = await nextNotification(owner.sql, "run_control", () =>
      handlers.takeControl({ runId }, as(member.userId)),
    );
    expect(decodeNotify("run_control", takeover)).toEqual({ runId });
    const back = await nextNotification(owner.sql, "run_control", () =>
      handlers.handBack({ runId, note: "All yours" }, as(member.userId)),
    );
    expect(decodeNotify("run_control", back)).toEqual({ runId });
    const outsider = await seedMember(owner.db);
    await expect(handlers.takeControl({ runId }, as(outsider.userId))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const done = await seedRun(owner.db, { workspaceId: member.workspaceId, status: "cancelled" });
    await expect(
      handlers.handBack({ runId: done, note: null }, as(member.userId)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps another member's takeover or hand-back of a held run to FORBIDDEN", async () => {
    const holder = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const other = await seedMember(owner.db, { workspaceId: member.workspaceId, role: "member" });
    const runId = await seedRun(owner.db, { workspaceId: member.workspaceId });
    await handlers.takeControl({ runId }, as(holder.userId));
    await expect(handlers.takeControl({ runId }, as(holder.userId))).resolves.toEqual({ ok: true });
    await expect(handlers.takeControl({ runId }, as(other.userId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(handlers.handBack({ runId, note: null }, as(other.userId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
