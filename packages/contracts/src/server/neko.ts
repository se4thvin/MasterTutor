import { createHmac } from "node:crypto";
import { NEKO_SESSION_COOKIE } from "../live.ts";
import { SlotName } from "../primitives.ts";

/** Same derivation as apps/browser-slot/bin/slot-entrypoint (openssl dgst -sha256 -hmac). */
export function deriveNekoPassword(secret: string, slotName: string): string {
  const slot = SlotName.parse(slotName);
  if (secret.length < 32) throw new RangeError("n.eko secrets must be at least 32 characters");
  return createHmac("sha256", secret).update(slot).digest("hex");
}

const TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

export class NekoLoginError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`n.eko login failed (HTTP ${status})`);
    this.name = "NekoLoginError";
    this.status = status;
  }
}

export interface NekoLoginOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The NEKO_SESSION token from Set-Cookie headers, or null. */
export function nekoTokenFromSetCookie(headers: readonly string[]): string | null {
  for (const header of headers) {
    const pair = header.split(";")[0] ?? "";
    const index = pair.indexOf("=");
    if (index < 0 || pair.slice(0, index).trim() !== NEKO_SESSION_COOKIE) continue;
    const value = pair.slice(index + 1).trim();
    if (TOKEN.test(value)) return value;
  }
  return null;
}

/**
 * POST /api/login. With cookie auth on (the slot image's setting) the token arrives only in
 * Set-Cookie; otherwise in the body. Throws NekoLoginError; 422 means the session is connected.
 */
export async function loginNeko(options: NekoLoginOptions): Promise<string> {
  const response = await (options.fetch ?? fetch)(`${options.baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: options.username, password: options.password }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
  });
  const text = await response.text();
  if (!response.ok) throw new NekoLoginError(response.status);
  const fromCookie = nekoTokenFromSetCookie(response.headers.getSetCookie());
  if (fromCookie) return fromCookie;
  try {
    const body = JSON.parse(text) as { token?: unknown };
    if (typeof body.token === "string" && TOKEN.test(body.token)) return body.token;
  } catch {
    // fall through
  }
  throw new NekoLoginError(502);
}
