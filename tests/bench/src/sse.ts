import {
  LAST_EVENT_ID_HEADER,
  RUN_EVENT_SSE_NAME,
  decodeRunEventData,
  runEventsPath,
  type RunEventRecord,
} from "@mastertutor/contracts";

export interface SseMessage {
  id: string | null;
  event: string | null;
  data: string;
}

export function createSseParser(onMessage: (message: SseMessage) => void): (chunk: string) => void {
  let buffer = "";
  let id: string | null = null;
  let event: string | null = null;
  let data: string[] = [];
  return (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + (buffer[newline] === "\r" ? 2 : 1));
      if (line === "") {
        if (data.length > 0) onMessage({ id, event, data: data.join("\n") });
        id = null;
        event = null;
        data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "id") id = value;
      else if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
  };
}

/**
 * A run's events over Task 0's SSE route (fe's run-stream contract). The first connect sends no id,
 * which is a full replay (P10a-16); reconnects resume after the last id seen. A 4xx is final.
 */
export async function* streamRunEvents(options: {
  baseUrl: string;
  cookie: string;
  runId: string;
  signal: AbortSignal;
}): AsyncGenerator<RunEventRecord> {
  let lastEventId: string | null = null;
  while (!options.signal.aborted) {
    const queue: RunEventRecord[] = [];
    const feed = createSseParser((message) => {
      if (message.event !== RUN_EVENT_SSE_NAME) return;
      const record = decodeRunEventData(message.data);
      if (record) queue.push(record);
    });
    try {
      const response = await fetch(`${options.baseUrl}${runEventsPath(options.runId)}`, {
        headers: {
          cookie: options.cookie,
          accept: "text/event-stream",
          ...(lastEventId === null ? {} : { [LAST_EVENT_ID_HEADER]: lastEventId }),
        },
        signal: options.signal,
      });
      if (response.status >= 400 && response.status < 500)
        throw new Error(`event stream HTTP ${response.status}`);
      if (!response.ok || !response.body)
        throw new RangeError(`event stream HTTP ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(value);
        for (let record = queue.shift(); record; record = queue.shift()) {
          lastEventId = record.id;
          yield record;
        }
      }
    } catch (error) {
      if (options.signal.aborted) return;
      if (
        error instanceof Error &&
        !(error instanceof RangeError) &&
        /HTTP 4\d\d/.test(error.message)
      )
        throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
