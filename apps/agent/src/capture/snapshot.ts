import { objectKeys, type Storage } from "@mastertutor/storage";
import type { MaskSources } from "../browser/masking.ts";
import {
  MAX_REGION_PIXELS,
  MAX_REGION_WIDTH,
  captureMaskedRegion,
  hasMaskTargets,
} from "../browser/region-capture.ts";
import type { BrowserSession } from "../browser/session.ts";
import { sha256Hex } from "../notes/hash.ts";
import type { StepWriter } from "../tools/types.ts";

export const MAX_FULLPAGE_HEIGHT = 16_384;

export interface Snapshot {
  mhtml: Uint8Array | null;
  png: Uint8Array | null;
  mhtmlSha256: string | null;
  pngSha256: string | null;
  skipped: string[];
}

/**
 * Spec §7.1 provenance: MHTML plus a masked full-page screenshot, each hashed. MHTML serializes form
 * state, so it is skipped when the page has secret fields or the run has vault material (decisions 5, 15).
 */
export async function takeSnapshot(
  session: BrowserSession,
  mask: MaskSources,
  signal: AbortSignal,
): Promise<Snapshot> {
  const cdp = await session.cdp();
  const skipped: string[] = [];
  let mhtml: Uint8Array | null = null;
  if (mask.hasSecrets())
    skipped.push("mhtml:secrets_registered"); // B3 seam
  else if (await hasMaskTargets(session, mask)) skipped.push("mhtml:secret_fields");
  else
    mhtml = new TextEncoder().encode(
      (await cdp.send("Page.captureSnapshot", { format: "mhtml" })).data,
    );
  const metrics = await cdp.send("Page.getLayoutMetrics");
  const fullWidth = Math.ceil(metrics.cssContentSize.width);
  const fullHeight = Math.ceil(metrics.cssContentSize.height);
  const width = Math.min(fullWidth, MAX_REGION_WIDTH);
  const height = Math.min(
    fullHeight,
    MAX_FULLPAGE_HEIGHT,
    Math.floor(MAX_REGION_PIXELS / Math.max(1, width)),
  );
  if (width < fullWidth) skipped.push("png:narrowed");
  if (height < fullHeight) skipped.push("png:truncated");
  const png = await captureMaskedRegion(
    session,
    mask,
    { clip: { x: 0, y: 0, width, height }, scale: 1 },
    signal,
  );
  if (!png) skipped.push("png:withheld");
  return {
    mhtml,
    png,
    mhtmlSha256: mhtml ? sha256Hex(mhtml) : null,
    pngSha256: png ? sha256Hex(png) : null,
    skipped,
  };
}

export interface SnapshotKeys {
  mhtmlKey: string | null;
  screenshotKey: string | null;
}

/** Keys are known before upload, so the source row can be staged first and the upload done last. */
export function snapshotKeys(sourceId: string, snapshot: Snapshot): SnapshotKeys {
  return {
    mhtmlKey: snapshot.mhtml ? objectKeys.snapshot(sourceId, "page.mhtml") : null,
    screenshotKey: snapshot.png ? objectKeys.snapshot(sourceId, "page.png") : null,
  };
}

/** Uploads under the not-yet-committed source; the step owns the keys, so a failed commit deletes them (F17). */
export async function uploadSnapshot(
  storage: Storage,
  step: StepWriter,
  keys: SnapshotKeys,
  snapshot: Snapshot,
): Promise<void> {
  if (keys.mhtmlKey) step.ownObject(keys.mhtmlKey);
  if (keys.screenshotKey) step.ownObject(keys.screenshotKey);
  await Promise.all([
    keys.mhtmlKey &&
      snapshot.mhtml &&
      storage.put(keys.mhtmlKey, snapshot.mhtml, {
        contentType: "multipart/related",
        sha256: snapshot.mhtmlSha256 ?? undefined,
      }),
    keys.screenshotKey &&
      snapshot.png &&
      storage.put(keys.screenshotKey, snapshot.png, {
        contentType: "image/png",
        sha256: snapshot.pngSha256 ?? undefined,
      }),
  ]);
}
