import {
  RUN_EVENT_SSE_NAME,
  decodeRunEventData,
  runEventsPath,
  type RunEventRecord,
} from "@mastertutor/contracts";
import type { Connection } from "../model/browser-state.ts";

/** A blip shorter than this never flashes "Reconnecting". */
export const LOST_GRACE_MS = 1_500;

/** After this many refused reopens in a row, ask the RPC link whether the run is still there. */
const PROBE_AFTER_CLOSED = 3;

export function reconnectDelayMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt);
}

interface RunEventsOptions {
  runId: string;
  /** RunDetail.lastEventId: resume right after the snapshot. */
  after: string | null;
  onRecord(record: RunEventRecord): void;
  onConnection(state: Connection): void;
  /**
   * runs.get through the RPC link. A refused stream (401, 403, 404) closes without a reason, so
   * after PROBE_AFTER_CLOSED attempts this tells us why: the link's UNAUTHORIZED interceptor
   * ends the session, and any other rejection ends the stream (onFailure).
   */
  probe(): Promise<unknown>;
  onFailure(error: unknown): void;
  /** Tests inject a fake; production uses the browser's EventSource. */
  EventSourceImpl?: typeof EventSource;
}

/**
 * Streams RunEvents over SSE (spec §6). While the browser retries on its own (CONNECTING) it sends
 * Last-Event-ID; if the stream is CLOSED (HTTP error), we reopen with ?after=<last id> on backoff.
 * Every PROBE_AFTER_CLOSED refusals in a row, runs.get decides: a rejection stops for good.
 */
export function connectRunEvents(options: RunEventsOptions): { close(): void } {
  const Impl = options.EventSourceImpl ?? EventSource;
  let lastId = options.after;
  let attempt = 0;
  let refused = 0;
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
      refused = 0;
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
        const delay = reconnectDelayMs(attempt++);
        refused += 1;
        if (refused < PROBE_AFTER_CLOSED) {
          retryTimer = setTimeout(open, delay);
          return;
        }
        refused = 0;
        options.probe().then(
          () => {
            if (!closed) retryTimer = setTimeout(open, delay);
          },
          (error: unknown) => {
            if (!closed) options.onFailure(error);
          },
        );
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
