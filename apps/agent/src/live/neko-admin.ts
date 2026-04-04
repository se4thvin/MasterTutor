import { NEKO_MEMBERS, NEKO_PORT } from "@mastertutor/contracts";
import { deriveNekoPassword, loginNeko } from "@mastertutor/contracts/server";

export class NekoApiError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string) {
    super(`n.eko ${path} answered HTTP ${status}`);
    this.name = "NekoApiError";
    this.status = status;
    this.path = path;
  }
}

export interface NekoAdminOptions {
  /** NEKO_ADMIN_SECRET (agent only). */
  adminSecret: string;
  baseUrl?: (slotName: string) => string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface NekoAdmin {
  request(
    slotName: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown>;
  /** Drops the cached token (e.g. when the slot is released and restarts). */
  forget(slotName: string): void;
}

/** n.eko REST as the per-slot "agent" admin member, with a cached bearer token. */
export function createNekoAdmin(options: NekoAdminOptions): NekoAdmin {
  const baseUrl = options.baseUrl ?? ((slot: string) => `http://${slot}:${NEKO_PORT}`);
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const tokens = new Map<string, Promise<string>>();

  function token(slotName: string): Promise<string> {
    let pending = tokens.get(slotName);
    if (!pending) {
      pending = loginNeko({
        baseUrl: baseUrl(slotName),
        username: NEKO_MEMBERS.agent,
        password: deriveNekoPassword(options.adminSecret, slotName),
        fetch: doFetch,
        timeoutMs,
      });
      tokens.set(slotName, pending);
      pending.catch(() => tokens.delete(slotName));
    }
    return pending;
  }

  async function send(
    slotName: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: unknown,
    retry: boolean,
  ): Promise<unknown> {
    const response = await doFetch(`${baseUrl(slotName)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await token(slotName)}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // The bearer token never follows a redirect.
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (response.status === 401 && retry) {
      tokens.delete(slotName);
      return send(slotName, method, path, body, false);
    }
    if (!response.ok) throw new NekoApiError(response.status, path);
    if (text === "") return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  return {
    request: (slotName, method, path, body) => send(slotName, method, path, body, true),
    forget: (slotName) => void tokens.delete(slotName),
  };
}
