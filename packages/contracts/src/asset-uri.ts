const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID_SOURCE}$`);

/** Notes reference stored assets as `asset:<assetId>` inside Markdown link/image targets. */
export const ASSET_URI_PREFIX = "asset:";

export function assetUri(assetId: string): string {
  if (!UUID_RE.test(assetId)) throw new TypeError("assetId must be a lowercase UUID");
  return `${ASSET_URI_PREFIX}${assetId}`;
}

/** Rewrites `](asset:<uuid>)` targets only; the word "asset:" in prose is left alone. */
export function replaceAssetUris(markdown: string, replace: (assetId: string) => string): string {
  const pattern = new RegExp(`\\]\\(${ASSET_URI_PREFIX}(${UUID_SOURCE})\\)`, "g");
  return markdown.replace(pattern, (_match, assetId: string) => `](${replace(assetId)})`);
}

export function assetIdsIn(markdown: string): string[] {
  const ids = new Set<string>();
  replaceAssetUris(markdown, (assetId) => {
    ids.add(assetId);
    return assetId;
  });
  return [...ids];
}
