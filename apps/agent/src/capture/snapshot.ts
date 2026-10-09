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
import { maskMhtml } from "./mhtml-mask.ts";
import { pageStripSecretFields, type FilledFieldIds } from "./page/strip-fields.ts";
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
 * state: on a run with vault material or a page with secret fields it is masked (snapshot ruling,
 * superseding decisions 5 and 15: field values removed, secrets redacted), and skipped with the
 * reason in `skipped` only when a secret would still remain.
 */
export async function takeSnapshot(
  session: BrowserSession,
  mask: MaskSources,
  signal: AbortSignal,
): Promise<Snapshot> {
  const cdp = await session.cdp();
  const skipped: string[] = [];
  let mhtml: Uint8Array | null = null;
  const raw = (await cdp.send("Page.captureSnapshot", { format: "mhtml" })).data;
  if (mask.hasSecrets() || (await hasMaskTargets(session, mask))) {
    const masked = await maskMhtml(raw, mask, async (html) =>
      (await session.worlds()).evaluate(pageStripSecretFields, {
        html: [...html],
        filled: await filledFieldIds(session, mask),
      }),
    );
    if (masked.kind === "masked") mhtml = new TextEncoder().encode(masked.mhtml);
    else skipped.push(masked.reason);
  } else {
    mhtml = new TextEncoder().encode(raw);
  }
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

/** The id and name of each field the vault filled on this page, to find it in the serialized copy. */
async function filledFieldIds(
  session: BrowserSession,
  mask: MaskSources,
): Promise<FilledFieldIds[]> {
  const cdp = await session.cdp();
  const out: FilledFieldIds[] = [];
  for (const backendNodeId of mask.nodeIds(cdp)) {
    const node = await cdp
      .send("DOM.describeNode", { backendNodeId })
      .then((result) => result.node)
      .catch(() => null);
    const attributes = node?.attributes ?? [];
    const value = (name: string) => {
      const index = attributes.findIndex((attr, i) => i % 2 === 0 && attr === name);
      return index >= 0 ? (attributes[index + 1] ?? null) : null;
    };
    out.push({ id: value("id"), name: value("name") });
  }
  return out;
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
