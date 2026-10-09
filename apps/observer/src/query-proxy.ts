import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import {
  COPILOT_LIMITS,
  ObserverInstant,
  ObserverRange,
  ObserverSearch,
} from "@mastertutor/contracts";
import { checkSql } from "./queries/sql.ts";
import { checkPromql } from "./queries/promql.ts";
import type { O2Query } from "./o2.ts";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

/** Exact read routes only: no forwarded URLs, methods, headers or credentials. */
export function createQueryProxyServer(o2: O2Query, token: string): Server {
  if (!token) throw new Error("missing_query_proxy_token");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const expected = digest(`Bearer ${token}`);
  const server = createServer(async (req, res) => {
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const signal = AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(COPILOT_LIMITS.queryTimeoutMs),
    ]);
    try {
      if (req.method === "GET" && req.url === "/healthz") return json(res, 200, { ok: true });
      if (req.method !== "POST" || !["/search", "/query", "/query_range"].includes(req.url ?? ""))
        return json(res, 404, { error: "not_found" });
      if (!timingSafeEqual(digest(req.headers.authorization ?? ""), expected))
        return json(res, 401, { error: "unauthorized" });
      const chunks: Buffer[] = [];
      let size = 0;
      // Pause instead of destroying the socket on overflow, so the bounded error can be sent.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 16 * 1024) return json(res, 413, { error: "too_large" });
        chunks.push(chunk);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return json(res, 400, { error: "invalid_query" });
      }
      if (req.url === "/search") {
        const parsed = ObserverSearch.safeParse(body);
        if (!parsed.success || !checkSql(parsed.data.sql, parsed.data.stream).ok)
          return json(res, 400, { error: "invalid_query" });
        const { stream, sql, range, size } = parsed.data;
        return json(res, 200, await o2.search(stream, sql, range, size, signal));
      }
      // A one-point range evaluates PromQL at exactly `time`, sharing the bounded matrix adapter.
      const instant = req.url === "/query" ? ObserverInstant.safeParse(body) : null;
      const parsed = ObserverRange.safeParse(
        instant?.success
          ? {
              query: instant.data.query,
              range: { start: instant.data.time, end: instant.data.time, step: 1 },
            }
          : req.url === "/query"
            ? null
            : body,
      );
      if (!parsed.success || !checkPromql(parsed.data.query).ok)
        return json(res, 400, { error: "invalid_query" });
      return json(res, 200, await o2.range(parsed.data.query, parsed.data.range, signal));
    } catch {
      // Upstream errors may contain SQL, rows or secrets; none are logged or reflected.
      if (!res.headersSent) json(res, 502, { error: "query_failed" });
      else res.end();
    }
  });
  server.requestTimeout = COPILOT_LIMITS.queryTimeoutMs;
  server.headersTimeout = COPILOT_LIMITS.queryTimeoutMs;
  return server;
}
