import { assets, createDb, sources, type DbHandle } from "@mastertutor/db";
import { seedMember, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectNotFound } from "@mastertutor/storage";
import { assetResponse, assetUrl, snapshotResponse, type ObjectDeps } from "./objects.ts";

let tdb: TestDatabase;
let web: DbHandle;
let mine: { userId: string; workspaceId: string };
let theirs: { userId: string; workspaceId: string };
let svgId: string;
let htmlId: string;
let sourceId: string;
const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const sha = "a".repeat(64);

beforeAll(async () => {
  tdb = await startTestDatabase();
  web = createDb(tdb.webUrl, { max: 2 });
  const owner = createDb(tdb.ownerUrl, { max: 2 });
  mine = await seedMember(owner.db);
  theirs = await seedMember(owner.db);
  const rows = await owner.db
    .insert(assets)
    .values([
      {
        workspaceId: mine.workspaceId,
        sha256: sha,
        bucket: "b",
        key: `assets/${mine.workspaceId}/${sha}`,
        mime: "image/svg+xml",
        bytes: bytes.length,
      },
      {
        workspaceId: mine.workspaceId,
        sha256: "b".repeat(64),
        bucket: "b",
        key: `assets/${mine.workspaceId}/${"b".repeat(64)}`,
        mime: "text/html",
        bytes: 1,
      },
    ])
    .returning({ id: assets.id });
  [svgId, htmlId] = rows.map((row) => row.id) as [string, string];
  [{ id: sourceId }] = (await owner.db
    .insert(sources)
    .values({
      workspaceId: mine.workspaceId,
      kind: "web",
      url: "https://x.test/",
      origin: "https://x.test",
      mhtmlKey: "snapshots/s/page.mhtml",
      screenshotKey: "snapshots/s/page.png",
    })
    .returning({ id: sources.id })) as [{ id: string }];
  await owner.close();
});
afterAll(async () => {
  await web?.close();
  await tdb?.stop();
});

const deps = (viewer: string | null): ObjectDeps => ({
  db: web.db,
  storage: { getStream: async () => new Blob([bytes]).stream() },
  viewerId: async () => viewer,
});
const get = (headers: HeadersInit = {}) => new Request("http://web.test/x", { headers });

describe("object proxy", () => {
  it("streams workspace assets with hardened, revalidating headers (assets: private, no-cache + ETag)", async () => {
    const res = await assetResponse(deps(mine.userId), get(), svgId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'.*sandbox/);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("content-length")).toBe(String(bytes.length));
    expect(res.headers.get("etag")).toBe(`"${sha}"`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    const revalidated = await assetResponse(
      deps(mine.userId),
      get({ "if-none-match": `"${sha}"` }),
      svgId,
    );
    expect(revalidated.status).toBe(304);
  });
  it("revalidates If-None-Match lists, weak tags and * (QA-087)", async () => {
    for (const header of [`"x", "${sha}"`, `W/"${sha}"`, "*"])
      expect(
        (await assetResponse(deps(mine.userId), get({ "if-none-match": header }), svgId)).status,
        header,
      ).toBe(304);
    expect(
      (await assetResponse(deps(mine.userId), get({ "if-none-match": `"other"` }), svgId)).status,
    ).toBe(200);
  });
  it("answers a missing object 404 and a failing store 502, both with the object headers (QA-086)", async () => {
    const failing = (error: Error): ObjectDeps => ({
      ...deps(mine.userId),
      storage: { getStream: async () => Promise.reject(error) },
    });
    const cases = [
      [new ObjectNotFound(), 404],
      [new Error("connect ECONNREFUSED"), 502],
    ] as const;
    for (const [error, code] of cases) {
      const responses = [
        await assetResponse(failing(error), get(), svgId),
        await snapshotResponse(failing(error), get(), sourceId, "page.png"),
      ];
      for (const res of responses) {
        expect(res.status, error.name).toBe(code);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("content-security-policy")).toMatch(/sandbox/);
      }
    }
  });
  it("never serves a stored type outside the allow-list inline", async () => {
    const res = await assetResponse(deps(mine.userId), get(), htmlId);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
  });
  it("hides other workspaces' assets and requires a session", async () => {
    expect((await assetResponse(deps(theirs.userId), get(), svgId)).status).toBe(404);
    expect((await assetResponse(deps(null), get(), svgId)).status).toBe(401);
    expect((await assetResponse(deps(mine.userId), get(), "../etc")).status).toBe(404);
  });
  it("serves snapshots never cached (screenshots: private, no-store), MHTML as an attachment only", async () => {
    const mhtml = await snapshotResponse(deps(mine.userId), get(), sourceId, "page.mhtml");
    expect(mhtml.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(mhtml.headers.get("cache-control")).toBe("private, no-store");
    const png = await snapshotResponse(deps(mine.userId), get(), sourceId, "page.png");
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("cache-control")).toBe("private, no-store");
    expect((await snapshotResponse(deps(mine.userId), get(), sourceId, "x.html")).status).toBe(404);
    expect((await snapshotResponse(deps(theirs.userId), get(), sourceId, "page.png")).status).toBe(
      404,
    );
    expect((await snapshotResponse(deps(null), get(), sourceId, "page.png")).status).toBe(401);
  });
  it("returns a same-origin URL for assets.url, in the viewer's workspace only", async () => {
    const url = await assetUrl(web.db, mine.workspaceId, { assetId: svgId });
    expect(url.url).toBe(`/api/assets/${svgId}`);
    await expect(assetUrl(web.db, theirs.workspaceId, { assetId: svgId })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
