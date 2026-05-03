import {
  RUN_EVENT_SSE_NAME,
  decodeRunEventData,
  runEventsPath,
  type RunEventRecord,
} from "@mastertutor/contracts";
import type { Connection } from "../model/browser-state.ts";

/** A blip shorter than this never flashes "Reconnecting". */
export const LOST_GRACE_MS = 1_500;

export function reconnectDelayMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt);
}

interface RunEventsOptions {
  runId: string;
  /** RunDetail.lastEventId: resume right after the snapshot. */
  after: string | null;
  onRecord(record: RunEventRecord): void;
  onConnection(state: Connection): void;
  /** Tests inject a fake; production uses the browser's EventSource. */
  EventSourceImpl?: typeof EventSource;
}

/**
 * Streams RunEvents over SSE (spec §6). While the browser retries on its own (CONNECTING) it sends
 * Last-Event-ID; if the stream is CLOSED (HTTP error), we reopen with ?after=<last id> on backoff.
 */
export function connectRunEvents(options: RunEventsOptions): { close(): void } {
  const Impl = options.EventSourceImpl ?? EventSource;
  let lastId = options.after;
  let attempt = 0;
  let closed = false;
  let source: EventSource | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let state: Connection = "connecting";

  const report = (next: Connection) => {
    if (closed || next === state) return;
    state = next;
    options.onConnection(next);
  };

  const onMessage = (event: Event) => {
    const record = decodeRunEventData(String((event as MessageEvent).data));
    if (!record || record.runId !== options.runId) return;
    lastId = record.id;
    options.onRecord(record);
  };

  const open = () => {
    const current = new Impl(runEventsPath(options.runId, lastId));
    source = current;
    current.addEventListener(RUN_EVENT_SSE_NAME, onMessage);
    current.onopen = () => {
      attempt = 0;
      clearTimeout(graceTimer);
      graceTimer = undefined;
      report("open");
    };
    current.onerror = () => {
      if (closed) return;
      graceTimer ??= setTimeout(() => report("lost"), LOST_GRACE_MS);
      if (current.readyState === Impl.CLOSED) {
        current.close();
        source = null;
        retryTimer = setTimeout(open, reconnectDelayMs(attempt++));
      }
    };
  };

  open();
  return {
    close() {
      closed = true;
      clearTimeout(graceTimer);
      clearTimeout(retryTimer);
      source?.close();
    },
  };
}
