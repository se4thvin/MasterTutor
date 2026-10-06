import { z } from "zod";
import { RunEventRecord } from "./events.ts";
import { Uuid } from "./primitives.ts";

/**
 * SSE wire format for GET /api/runs/:id/events (spec §6). The server (Phase 7) writes
 * `encodeRunEventSse` per record and resumes from `resumeAfter(header, ?after)`.
 */
export const RUN_EVENT_SSE_NAME = "run_event";
/** Browsers send this on automatic reconnect; it wins over the `after` query. */
export const LAST_EVENT_ID_HEADER = "last-event-id";
export const EventId = z.string().regex(/^[0-9]{1,19}$/);

export function runEventsPath(runId: string, after: string | null = null): string {
  const base = `/api/runs/${Uuid.parse(runId)}/events`;
  return after === null ? base : `${base}?after=${EventId.parse(after)}`;
}

/** Masked step screenshot; the route resolves the object key by seq (keys carry a nonce). */
export function stepScreenshotPath(runId: string, seq: number): string {
  const n = z.number().int().nonnegative().parse(seq);
  return `/api/runs/${Uuid.parse(runId)}/steps/${n}/screenshot`;
}

/** The screenshot an approval was requested on; the route reads approvals.request.screenshotKey. */
export function approvalScreenshotPath(runId: string, approvalId: string): string {
  return `/api/runs/${Uuid.parse(runId)}/approvals/${Uuid.parse(approvalId)}/screenshot`;
}

export function resumeAfter(header: string | null, query: string | null): string | null {
  for (const candidate of [header, query]) {
    const parsed = EventId.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** JSON.stringify never emits raw newlines, so each record is exactly one `data:` line. */
export function encodeRunEventSse(record: RunEventRecord): string {
  const valid = RunEventRecord.parse(record);
  return `id: ${valid.id}\nevent: ${RUN_EVENT_SSE_NAME}\ndata: ${JSON.stringify(valid)}\n\n`;
}

export function decodeRunEventData(data: string): RunEventRecord | null {
  try {
    const parsed = RunEventRecord.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** bigserial ids as digit strings: longer is larger; equal length compares lexically. */
export function compareEventIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
