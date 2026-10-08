import {
  EventId,
  LAST_EVENT_ID_HEADER,
  TERMINAL_RUN_STATUSES,
  Uuid,
  compareEventIds,
  decodeNotify,
  encodeRunEventSse,
  resumeAfter,
  type RunStatus,
} from "@mastertutor/contracts";
import { getRunForMember, runEvents, type DbHandle } from "@mastertutor/db";
import { recordSseConnection } from "@mastertutor/telemetry/record";
import { and, asc, eq, sql } from "drizzle-orm";

/** bigserial's maximum. EventId admits 19-digit values above it; resuming after one is a bad request. */
const MAX_EVENT_ID = "9223372036854775807";
const SSE_RETRY_MS = 2_000;
/** Comment lines keep proxies from closing an idle stream. */
const SSE_HEARTBEAT_MS = 15_000;
const BATCH = 500;
const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);
const encoder = new TextEncoder();

interface EventStreamDeps {
  db: DbHandle;
  viewerId(): Promise<string | null>;
  heartbeatMs?: number;
}

const empty = (status: number) =>
  new Response(null, { status, headers: { "cache-control": "no-store" } });

/**
 * Last-Event-ID wins over ?after (run-stream.ts); neither means a full replay (P10a-16). A cursor
 * that is present but not an id we could have sent is refused, never silently replaced.
 */
function cursorOf(request: Request): string | null | "invalid" {
  const header = request.headers.get(LAST_EVENT_ID_HEADER);
  const query = new URL(request.url).searchParams.get("after");
  for (const given of [header, query])
    if (given !== null && !EventId.safeParse(given).success) return "invalid";
  const after = resumeAfter(header, query);
  return after !== null && compareEventIds(after, MAX_EVENT_ID) > 0 ? "invalid" : after;
}

/** Ids travel as text: bigserial exceeds JS's safe integers long before it runs out. */
function eventsAfter(db: DbHandle, runId: string, after: string | null) {
  return db.db
    .select({
      id: sql<string>`${runEvents.id}::text`,
      payload: runEvents.payload,
      at: runEvents.createdAt,
    })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        after === null ? undefined : sql`${runEvents.id} > ${after}::bigint`,
      ),
    )
    .orderBy(asc(runEvents.id))
    .limit(BATCH);
}

/**
 * GET /api/runs/:id/events (spec §6, S4). Membership first; then LISTEN run_event before the
 * replay, so nothing committed in between is missed; then every event after the cursor, in id
 * order. Writers lock the run row before inserting events (runs/service.ts lockRun, the agent's
 * step commit), so ids commit in order and `id > cursor` never skips one. The stream ends after a
 * terminal status; a finished run with nothing new answers 204, which EventSource does not retry.
 */
export async function runEventStream(
  deps: EventStreamDeps,
  request: Request,
  runIdParam: string,
): Promise<Response> {
  const parsed = Uuid.safeParse(runIdParam);
  if (!parsed.success) return empty(404);
  const runId = parsed.data;
  const userId = await deps.viewerId();
  if (!userId) return empty(401);
  const cursor = cursorOf(request);
  if (cursor === "invalid") return empty(400);
  const run = await getRunForMember(deps.db.db, runId, userId);
  if (!run) return empty(404);
  const finished = TERMINAL.has(run.status);
  if (finished && (await eventsAfter(deps.db, runId, cursor)).length === 0) return empty(204);

  let last = cursor;
  let closed = false;
  let queued = false;
  let chain: Promise<void> = Promise.resolve();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unlisten: (() => Promise<void>) | null = null;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  /** Resolved by pull(): the reader wants more. A stalled reader holds one record, not the log. */
  let demand: (() => void) | null = null;
  const wanted = () => (controller.desiredSize ?? 0) > 0;
  const ready = () =>
    closed || wanted() ? Promise.resolve() : new Promise<void>((resolve) => (demand = resolve));

  const send = (text: string) => {
    if (!closed) controller.enqueue(encoder.encode(text));
  };
  const stop = () => {
    if (closed) return;
    closed = true;
    recordSseConnection(-1);
    clearInterval(heartbeat);
    demand?.();
    demand = null;
    request.signal.removeEventListener("abort", stop);
    void unlisten?.().catch(() => undefined);
    try {
      controller.close();
    } catch {
      // The consumer already cancelled the stream.
    }
  };
  const flush = async () => {
    for (;;) {
      const rows = await eventsAfter(deps.db, runId, last);
      let ended = false;
      for (const row of rows) {
        last = row.id;
        // encodeRunEventSse is the one validation. A row this version cannot read is skipped,
        // never sent half-formed or allowed to stall the stream.
        let text: string;
        try {
          text = encodeRunEventSse({
            id: row.id,
            runId,
            at: row.at.toISOString(),
            event: row.payload,
          });
        } catch {
          continue;
        }
        await ready();
        if (closed) return;
        send(text);
        // Valid, since it just encoded.
        const event = row.payload;
        if (event.type === "status" && TERMINAL.has(event.status)) ended = true;
      }
      if (ended) return stop();
      if (rows.length < BATCH) return;
    }
  };
  /** One flush at a time; a notification during a flush queues exactly one more. */
  const schedule = () => {
    if (queued || closed) return;
    queued = true;
    chain = chain
      .then(async () => {
        queued = false;
        if (!closed) await flush();
      })
      // A failed read ends the stream; the browser reconnects with Last-Event-ID.
      .catch(stop);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      controller = streamController;
      recordSseConnection(1);
      request.signal.addEventListener("abort", stop);
      send(`retry: ${SSE_RETRY_MS}\n\n`);
      try {
        const subscription = await deps.db.sql.listen("run_event", (text) => {
          try {
            if (decodeNotify("run_event", text).runId === runId) schedule();
          } catch {
            // A malformed notification carries nothing to deliver.
          }
        });
        unlisten = subscription.unlisten;
        if (closed) await subscription.unlisten();
      } catch {
        stop();
        return;
      }
      // A reader that is behind already has bytes queued; a ping would only add to them. Each
      // beat also re-checks membership, so a removed member stops receiving within one beat.
      let checking = false;
      heartbeat = setInterval(() => {
        if (wanted()) send(": ping\n\n");
        if (checking) return;
        checking = true;
        getRunForMember(deps.db.db, runId, userId)
          .then((still) => {
            if (!still) stop();
          })
          // A failed check ends the stream; the browser reconnects and is checked again.
          .catch(stop)
          .finally(() => (checking = false));
      }, deps.heartbeatMs ?? SSE_HEARTBEAT_MS);
      schedule();
      // An already finished run closes once its tail is sent, even without a status event in it.
      if (finished) chain = chain.then(stop);
    },
    pull() {
      demand?.();
      demand = null;
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
