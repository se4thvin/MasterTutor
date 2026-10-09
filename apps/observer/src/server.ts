import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  OBSERVER_API_PREFIX,
  ResultId,
  Uuid,
  type CopilotEvent,
  type CopilotResultView,
  type CopilotThreadSummary,
  type CopilotThreadView,
} from "@mastertutor/contracts";
import { isCrossSiteWrite, type Logger } from "@mastertutor/contracts/server";
import { authorize, type Caller } from "./auth.ts";
import { openSse } from "./sse.ts";

export interface ObserverRoutes {
  ask(
    caller: Caller,
    body: unknown,
    emit: (event: CopilotEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  threads(caller: Caller): Promise<CopilotThreadSummary[]>;
  thread(caller: Caller, id: string): Promise<CopilotThreadView | null>;
  deleteThread(caller: Caller, id: string): Promise<void>;
  result(caller: Caller, threadId: string, resultId: string): Promise<CopilotResultView | null>;
}

const MAX_BODY = 16 * 1024;
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" } as const;
const json = (res: ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, {
    ...HEADERS,
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<unknown | "too_large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return "too_large";
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/** node:http, no framework (bloat-free): six routes under /api/observer (spec §7.1). */
export function createObserverServer(deps: {
  token: string;
  appOrigin: string;
  routes: ObserverRoutes;
  log: Logger;
}): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://observer");
    const path = url.pathname;
    try {
      if (path === "/healthz") return json(res, 200, { ok: true });
      if (!path.startsWith(`${OBSERVER_API_PREFIX}/`)) return json(res, 404);
      const caller = authorize(req.headers, deps.token);
      if (!caller) return json(res, 401);
      const method = req.method ?? "GET";
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : null;
      if (isCrossSiteWrite(method, origin, deps.appOrigin)) return json(res, 403);
      const route = path.slice(OBSERVER_API_PREFIX.length);
      if (method === "POST" && route === "/threads/ask") {
        const body = await readBody(req);
        if (body === "too_large") return json(res, 413);
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const emit = openSse(res);
        await deps.routes.ask(caller, body, emit, abort.signal);
        return res.end();
      }
      if (method === "GET" && route === "/threads")
        return json(res, 200, await deps.routes.threads(caller));
      const thread = /^\/threads\/([^/]+)$/.exec(route);
      if (thread && Uuid.safeParse(thread[1]).success) {
        if (method === "GET") {
          const view = await deps.routes.thread(caller, thread[1]!);
          return view ? json(res, 200, view) : json(res, 404);
        }
        if (method === "DELETE") {
          await deps.routes.deleteThread(caller, thread[1]!);
          return json(res, 204);
        }
      }
      const result = /^\/results\/([^/]+)\/([^/]+)$/.exec(route);
      if (
        method === "GET" &&
        result &&
        Uuid.safeParse(result[1]).success &&
        ResultId.safeParse(result[2]).success
      ) {
        const view = await deps.routes.result(caller, result[1]!, result[2]!);
        return view ? json(res, 200, view) : json(res, 404);
      }
      return json(res, 404);
    } catch (error) {
      deps.log.error(
        {
          errorCode: "observer_request_failed",
          errName: error instanceof Error ? error.name : "unknown",
        },
        "request failed",
      );
      if (!res.headersSent) json(res, 500);
      else res.end();
    }
  });
}
