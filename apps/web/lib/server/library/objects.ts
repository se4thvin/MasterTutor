import { isAssetMimeType, type SignedUrl, Uuid } from "@mastertutor/contracts";
import { assets, sources, workspaceMembers, type Database } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { and, eq } from "drizzle-orm";
import { ServiceError } from "../service-error.ts";

/** Stored objects are never documents: no sniffing, no script, no embedding elsewhere. One constant for every object route. */
export const OBJECT_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

/**
 * Screenshots (step, approval and snapshot images) and MHTML: a browser never keeps them after
 * sign-out (coordinator ruling, Phase 7 group 0 review).
 */
export const OBJECT_CACHE = "private, no-store";
/** Content-addressed assets: revalidated every time with their ETag, a cheap 304 (B2 ruling). */
export const ASSET_CACHE = "private, no-cache";
const ASSET_URL_TTL_SECONDS = 3_600;

export interface ObjectDeps {
  db: Database;
  storage: Pick<Storage, "getStream">;
  viewerId(): Promise<string | null>;
}

const status = (code: number, cache: string) =>
  new Response(null, { status: code, headers: { ...OBJECT_HEADERS, "Cache-Control": cache } });

/** GET /api/assets/:assetId: the asset of the viewer's workspace (membership in the same query). */
export async function assetResponse(
  deps: ObjectDeps,
  request: Request,
  assetId: string,
): Promise<Response> {
  if (!Uuid.safeParse(assetId).success) return status(404, ASSET_CACHE);
  const userId = await deps.viewerId();
  if (!userId) return status(401, ASSET_CACHE);
  const [row] = await deps.db
    .select({ key: assets.key, mime: assets.mime, sha256: assets.sha256, bytes: assets.bytes })
    .from(assets)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, assets.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(assets.id, assetId));
  if (!row) return status(404, ASSET_CACHE);
  const etag = `"${row.sha256}"`;
  const common = { ...OBJECT_HEADERS, ETag: etag, "Cache-Control": ASSET_CACHE };
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: common });
  // Only the stored-asset allow-list is shown inline; anything else downloads as bytes.
  const inline = isAssetMimeType(row.mime);
  return new Response(await deps.storage.getStream(row.key), {
    headers: {
      ...common,
      "Content-Type": inline ? row.mime : "application/octet-stream",
      "Content-Disposition": inline ? "inline" : "attachment",
      "Content-Length": String(row.bytes),
    },
  });
}

/** GET /api/sources/:sourceId/snapshot/:name: the page's MHTML (attachment) or screenshot. */
export async function snapshotResponse(
  deps: ObjectDeps,
  _request: Request,
  sourceId: string,
  name: string,
): Promise<Response> {
  if (!Uuid.safeParse(sourceId).success || (name !== "page.mhtml" && name !== "page.png"))
    return status(404, OBJECT_CACHE);
  const userId = await deps.viewerId();
  if (!userId) return status(401, OBJECT_CACHE);
  const [row] = await deps.db
    .select({ mhtmlKey: sources.mhtmlKey, screenshotKey: sources.screenshotKey })
    .from(sources)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, sources.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(sources.id, sourceId));
  const key = name === "page.mhtml" ? row?.mhtmlKey : row?.screenshotKey;
  if (!key) return status(404, OBJECT_CACHE);
  const png = name === "page.png";
  return new Response(await deps.storage.getStream(key), {
    headers: {
      ...OBJECT_HEADERS,
      "Content-Type": png ? "image/png" : "multipart/related",
      "Content-Disposition": png ? "inline" : 'attachment; filename="page.mhtml"',
      "Cache-Control": OBJECT_CACHE,
    },
  });
}

/** `assets.url`: a same-origin path that needs the session cookie (not a bearer capability). */
export async function assetUrl(
  db: Database,
  workspaceId: string,
  input: { assetId: string },
): Promise<SignedUrl> {
  const [row] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, input.assetId), eq(assets.workspaceId, workspaceId)));
  if (!row) throw new ServiceError("not_found", "Asset not found");
  return {
    url: `/api/assets/${row.id}`,
    expiresAt: new Date(Date.now() + ASSET_URL_TTL_SECONDS * 1_000).toISOString(),
  };
}
