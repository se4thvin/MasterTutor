// B2 Task 11 extends this file (ObjectDeps, assetResponse, snapshotResponse, assetUrl). Phase 7
// Task 0D created it early with only the header constant, so the screenshot routes share it.

/** Stored objects are never documents: no sniffing, no script, no embedding elsewhere. One constant for every object route. */
export const OBJECT_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};
