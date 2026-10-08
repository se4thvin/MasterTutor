import { isAssetMimeType, MAX_ASSET_BYTES } from "@mastertutor/contracts";
import { assets, type DbLike } from "@mastertutor/db";
import { objectKeys, type Storage } from "@mastertutor/storage";
import { and, eq } from "drizzle-orm";
import type { MaskSources } from "../browser/masking.ts";
import { sha256Hex } from "./hash.ts";
import { screenText } from "./note-writer.ts";

export interface AssetInput {
  bytes: Uint8Array;
  mime: string;
  width: number | null;
  height: number | null;
  sourceUrl: string | null;
}
export interface StoredAsset {
  assetId: string;
  sha256: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}
export interface AssetStore {
  /** `secrets` screens the source URL (spec §9); a rejected type or size throws AssetRejected. */
  put(workspaceId: string, input: AssetInput, secrets: MaskSources): Promise<StoredAsset>;
}

/** The input is not storable (type outside the allow-list, or over MAX_ASSET_BYTES). */
export class AssetRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetRejected";
  }
}

/** Content-addressed and written immediately (plan decision 6): orphans from aborted steps are harmless. */
export function createAssetStore(deps: { db: DbLike; storage: Storage }): AssetStore {
  return {
    async put(workspaceId, input, secrets) {
      // The single write boundary into object storage: every caller is checked here.
      if (!isAssetMimeType(input.mime)) throw new AssetRejected("unsupported asset type");
      if (input.bytes.byteLength > MAX_ASSET_BYTES) throw new AssetRejected("asset too large");
      if (input.sourceUrl) screenText(secrets, input.sourceUrl);
      const sha256 = sha256Hex(input.bytes);
      const key = objectKeys.asset(workspaceId, sha256);
      if ((await deps.storage.head(key)) === null) {
        await deps.storage.put(key, input.bytes, { contentType: input.mime, sha256 });
      }
      const sourceUrl =
        input.sourceUrl && /^https?:/i.test(input.sourceUrl)
          ? input.sourceUrl.slice(0, 2_048)
          : null;
      const inserted = await deps.db
        .insert(assets)
        .values({
          workspaceId,
          sha256,
          bucket: deps.storage.bucket,
          key,
          mime: input.mime,
          bytes: input.bytes.byteLength,
          width: input.width,
          height: input.height,
          sourceUrl,
        })
        .onConflictDoNothing({ target: [assets.workspaceId, assets.sha256] })
        .returning({ id: assets.id });
      const assetId =
        inserted[0]?.id ??
        (
          await deps.db
            .select({ id: assets.id })
            .from(assets)
            .where(and(eq(assets.workspaceId, workspaceId), eq(assets.sha256, sha256)))
        )[0]?.id;
      if (!assetId) throw new Error("asset row missing after upsert");
      return {
        assetId,
        sha256,
        mime: input.mime,
        bytes: input.bytes.byteLength,
        width: input.width,
        height: input.height,
      };
    },
  };
}
