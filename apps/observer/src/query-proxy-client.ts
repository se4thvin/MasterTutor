import { COPILOT_LIMITS, ObserverSearchResult, ObserverTable } from "@mastertutor/contracts";
import type { O2Query } from "./o2.ts";

/** Observer transport: its only query destination is the authenticated internal proxy. */
export function createQueryProxyClient(baseUrl: string, token: string): O2Query {
  const base = baseUrl.replace(/\/+$/, "");
  const call = async (path: string, body: unknown, signal: AbortSignal): Promise<unknown> => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(COPILOT_LIMITS.queryTimeoutMs)]),
      redirect: "error",
    });
    if (!response.ok) throw new Error("observer_query_failed");
    return response.json();
  };
  return {
    async search(stream, sql, range, size, signal) {
      return ObserverSearchResult.parse(
        await call("/search", { stream, sql, range, size }, signal),
      );
    },
    async range(query, range, signal) {
      return ObserverTable.parse(await call("/query_range", { query, range }, signal));
    },
  };
}
