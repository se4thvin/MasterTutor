import type { ServerResponse } from "node:http";
import { CopilotEvent } from "@mastertutor/contracts";

/** One SSE stream per answer (spec §7.6): only CopilotEvent shapes, validated as they leave. */
export function openSse(res: ServerResponse): (event: CopilotEvent) => void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-accel-buffering": "no",
  });
  return (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(CopilotEvent.parse(event))}\n\n`);
  };
}
