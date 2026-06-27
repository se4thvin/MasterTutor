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

/**
 * The one Cache-Control for stored objects: a browser never keeps a masked screenshot (or any
 * object) after sign-out (coordinator ruling, Phase 7 group 0 review). B2's object routes use it.
 */
export const OBJECT_CACHE = "private, no-store";
