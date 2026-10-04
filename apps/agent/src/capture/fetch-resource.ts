import { MAX_ASSET_BYTES } from "@mastertutor/contracts";
import type { BrowserSession } from "../browser/session.ts";
import { abortable } from "../runtime/abortable.ts";

export const FETCH_TIMEOUT_MS = 30_000;
/** A large download gets more time, at an assumed floor of 1 MiB/s, never more than 5 minutes. */
const MIN_BYTES_PER_MS = (1024 * 1024) / 1000;
export const MAX_FETCH_TIMEOUT_MS = 300_000;

/** The time a download of `bytes` may take (B5 review: 25–100 MiB PDFs must not time out at 30 s). */
export function fetchTimeoutMs(bytes: number): number {
  return Math.min(MAX_FETCH_TIMEOUT_MS, FETCH_TIMEOUT_MS + bytes / MIN_BYTES_PER_MS);
}
const READ_CHUNK = 1 << 20;

export interface FetchedResource {
  bytes: Uint8Array;
  contentType: string | null;
}

export interface FetchContext {
  session: Pick<BrowserSession, "cdp" | "allowsFetch" | "page">;
  /** The frame whose network context (cookies, egress) the request uses. */
  frameId: string;
  /** The run's signal: an interruption rethrows; the per-fetch timeout only gives up. */
  signal: AbortSignal;
}

function header(headers: Record<string, string> | undefined, name: string): string | null {
  for (const [key, value] of Object.entries(headers ?? {}))
    if (key.toLowerCase() === name) return value;
  return null;
}

/** Cookies go only to the page's own site (its host or subdomains); everything else loads anonymously. */
export function sameSite(target: URL, pageUrl: string): boolean {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return false;
  }
  const base = page.hostname.replace(/^www\./, "");
  return (
    target.hostname === page.hostname ||
    target.hostname === base ||
    target.hostname.endsWith(`.${base}`)
  );
}

/**
 * Fetches through the slot's own network stack (decision 3). `Network.loadNetworkResource` skips
 * Playwright's context.route, so B1's network policy is asked first (preflight S1); the slot's
 * iptables rules stay the boundary for redirects (CDP gives no redirect hook here). The agent
 * never fetches page URLs itself.
 *
 * Residual (5-8 review M2): the slot accepts loopback egress, so a redirect can reach the slot's
 * own 127.0.0.1 services (CDP, n.eko, Pulse). Nothing from such a hop reaches the model, and only
 * bytes that sniff as an allowed image are stored, so a JSON or HTML answer is dropped.
 */
export async function fetchInBrowser(
  ctx: FetchContext,
  url: string,
  maxBytes: number = MAX_ASSET_BYTES,
): Promise<FetchedResource | null> {
  ctx.signal.throwIfAborted();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!(await ctx.session.allowsFetch(parsed.href))) return null;
  const cdp = await ctx.session.cdp();
  // The deadline starts at FETCH_TIMEOUT_MS and only grows with the declared or received size.
  const timeout = new AbortController();
  const started = Date.now();
  let allowed = FETCH_TIMEOUT_MS;
  let timer = setTimeout(() => timeout.abort(), allowed);
  const extendFor = (bytes: number) => {
    const next = fetchTimeoutMs(bytes);
    if (next <= allowed) return;
    allowed = next;
    clearTimeout(timer);
    timer = setTimeout(() => timeout.abort(), Math.max(0, started + allowed - Date.now()));
  };
  const signal = AbortSignal.any([ctx.signal, timeout.signal]);
  let handle: string | undefined;
  try {
    const { resource } = await abortable(
      cdp.send("Network.loadNetworkResource", {
        frameId: ctx.frameId,
        url: parsed.href,
        options: {
          disableCache: false,
          includeCredentials: sameSite(parsed, ctx.session.page.url()),
        },
      }),
      signal,
    );
    handle = resource.stream;
    if (!resource.success || !handle || (resource.httpStatusCode ?? 0) >= 400) return null;
    const declared = Number(header(resource.headers, "content-length"));
    if (declared > maxBytes) return null;
    if (declared > 0) extendFor(declared);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const read = await abortable(cdp.send("IO.read", { handle, size: READ_CHUNK }), signal);
      const chunk = read.base64Encoded
        ? Buffer.from(read.data, "base64")
        : Buffer.from(read.data, "utf8");
      total += chunk.length;
      if (total > maxBytes) return null;
      extendFor(total + READ_CHUNK);
      chunks.push(chunk);
      if (read.eof) break;
    }
    return {
      bytes: new Uint8Array(Buffer.concat(chunks)),
      contentType: header(resource.headers, "content-type"),
    };
  } catch (error) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    if (timeout.signal.aborted) return null;
    throw error;
  } finally {
    clearTimeout(timer);
    if (handle) await cdp.send("IO.close", { handle }).catch(() => undefined);
  }
}

export function decodeDataUrl(
  url: string,
  maxBytes: number = MAX_ASSET_BYTES,
): FetchedResource | null {
  const match = /^data:([^,;]*)((?:;[^,;]*)*?)(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const payload = match[4] ?? "";
  if (payload.length > maxBytes * 1.4) return null;
  let bytes: Buffer;
  try {
    bytes = match[3]
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
  } catch {
    return null;
  }
  if (bytes.length > maxBytes) return null;
  return { bytes: new Uint8Array(bytes), contentType: match[1] || null };
}
