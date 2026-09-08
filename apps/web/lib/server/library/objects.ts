import { isAssetMimeType, type SignedUrl, Uuid } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { assets, sources, workspaceMembers, type Database } from "@mastertutor/db";
import { ObjectNotFound, type Storage } from "@mastertutor/storage";
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

const log = createLogger({ service: "web" });

/** A bodyless answer that still carries the object headers. */
export const objectStatus = (code: number, cache: string) =>
  new Response(null, { status: code, headers: { ...OBJECT_HEADERS, "Cache-Control": cache } });

/**
 * If-None-Match against one strong ETag, by the weak comparison RFC 9110 §13.1.2 asks for: a list
 * of tags, `W/` forms and `*` all count (QA-087).
 */
export function matchesIfNoneMatch(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

/**
 * The object's bytes, or a hardened status: a key with no object is 404, a store that fails is
 * 502 (logged), never Next's bare 500 without OBJECT_HEADERS (QA-086).
 */
async function objectBody(
  deps: ObjectDeps,
  key: string,
  cache: string,
): Promise<ReadableStream<Uint8Array> | Response> {
  try {
    return await deps.storage.getStream(key);
  } catch (error) {
    if (error instanceof ObjectNotFound) return objectStatus(404, cache);
    log.error({ reason: (error as Error).name }, "object store read failed");
    return objectStatus(502, cache);
  }
}

/** GET /api/assets/:assetId: the asset of the viewer's workspace (membership in the same query). */
export async function assetResponse(
  deps: ObjectDeps,
  request: Request,
  assetId: string,
): Promise<Response> {
  if (!Uuid.safeParse(assetId).success) return objectStatus(404, ASSET_CACHE);
  const userId = await deps.viewerId();
  if (!userId) return objectStatus(401, ASSET_CACHE);
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
  if (!row) return objectStatus(404, ASSET_CACHE);
  const etag = `"${row.sha256}"`;
  const common = { ...OBJECT_HEADERS, ETag: etag, "Cache-Control": ASSET_CACHE };
  if (matchesIfNoneMatch(request, etag))
    return new Response(null, { status: 304, headers: common });
  const body = await objectBody(deps, row.key, ASSET_CACHE);
  if (body instanceof Response) return body;
  // Only the stored-asset allow-list is shown inline; anything else downloads as bytes.
  const inline = isAssetMimeType(row.mime);
  return new Response(body, {
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
    return objectStatus(404, OBJECT_CACHE);
  const userId = await deps.viewerId();
  if (!userId) return objectStatus(401, OBJECT_CACHE);
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
  if (!key) return objectStatus(404, OBJECT_CACHE);
  const body = await objectBody(deps, key, OBJECT_CACHE);
  if (body instanceof Response) return body;
  const png = name === "page.png";
  return new Response(body, {
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
