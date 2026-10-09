import { OBSERVE_ORG } from "@mastertutor/contracts";
import type { z } from "zod";

export interface O2ClientOptions {
  /** OpenObserve's base URL including ZO_BASE_URI, e.g. http://openobserve:5080/observability. */
  baseUrl: string;
  email: string;
  password: string;
  org?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type O2Method = "GET" | "POST" | "PUT" | "DELETE";

export interface O2Client {
  readonly org: string;
  call<T = unknown>(
    operation: string,
    method: O2Method,
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>,
  ): Promise<T>;
}

/** A failed OpenObserve call: the operation and status only, never a body (it can echo input). */
export class O2Error extends Error {
  readonly operation: string;
  readonly status: number;
  constructor(operation: string, status: number) {
    super(`OpenObserve ${operation} failed with HTTP ${status}`);
    this.name = "O2Error";
    this.operation = operation;
    this.status = status;
  }
}

export function createO2Client(options: O2ClientOptions): O2Client {
  const base = options.baseUrl.replace(/\/+$/, "");
  const authorization = `Basic ${Buffer.from(`${options.email}:${options.password}`).toString("base64")}`;
  const doFetch = options.fetchImpl ?? fetch;
  return {
    org: options.org ?? OBSERVE_ORG,
    async call(operation, method, path, body, schema) {
      const headers: Record<string, string> = { authorization };
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
      const text = await response.text();
      if (!response.ok) throw new O2Error(operation, response.status);
      const json: unknown = text.length > 0 ? JSON.parse(text) : null;
      return (schema ? schema.parse(json) : json) as never;
    },
  };
}

/** Polls /healthz until OpenObserve answers (one-shot startup only). */
export async function waitForO2(client: O2Client, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await client.call("health", "GET", "/healthz");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}
