/**
 * Session cookies are ambient, so a state-changing RPC must come from our own pages (E2): a
 * non-GET request whose Origin is not exactly the app's origin is refused, and so is one with no
 * Origin (browsers always send it on POST).
 */
export function isCrossSiteWrite(request: Request, appOrigin: string): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  return request.headers.get("origin") !== appOrigin;
}
