/**
 * Session cookies are ambient, so a state-changing request must come from our own pages (E2): a
 * non-GET request whose Origin is not exactly the app's origin is refused, and so is one with no
 * Origin (browsers always send it on POST). Shared by web's RPC route and the observer service.
 */
export function isCrossSiteWrite(
  method: string,
  origin: string | null,
  appOrigin: string,
): boolean {
  if (method === "GET" || method === "HEAD") return false;
  return origin !== appOrigin;
}
