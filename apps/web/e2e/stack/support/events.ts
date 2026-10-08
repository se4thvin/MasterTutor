import {
  LAST_EVENT_ID_HEADER,
  RUN_EVENT_SSE_NAME,
  decodeRunEventData,
  runEventsPath,
  type RunEvent,
  type RunEventRecord,
} from "@mastertutor/contracts";
import type { APIRequestContext, Page } from "@playwright/test";

export interface SseFrame {
  id: string | null;
  event: string | null;
  data: string;
  retry: number | null;
}

/** WHATWG event-stream parsing: a blank line ends a frame, ':' lines are comments. */
export function parseSse(body: string): SseFrame[] {
  const frames: SseFrame[] = [];
  let frame: SseFrame = { id: null, event: null, data: "", retry: null };
  let data: string[] = [];
  let open = false;
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line === "") {
      if (open) frames.push({ ...frame, data: data.join("\n") });
      frame = { id: null, event: null, data: "", retry: null };
      data = [];
      open = false;
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const raw = colon < 0 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    open = true;
    if (field === "id") frame.id = value;
    else if (field === "event") frame.event = value;
    else if (field === "data") data.push(value);
    else if (field === "retry") frame.retry = /^[0-9]+$/.test(value) ? Number(value) : null;
  }
  return frames;
}

/** Decodes every run_event frame through the contract; a bad or mismatched frame throws. */
export function recordsOf(frames: readonly SseFrame[]): RunEventRecord[] {
  return frames
    .filter((frame) => frame.event === RUN_EVENT_SSE_NAME)
    .map((frame) => {
      const record = decodeRunEventData(frame.data);
      if (!record) throw new Error(`undecodable run_event frame ${frame.id ?? "(no id)"}`);
      if (record.id !== frame.id) throw new Error(`frame id ${frame.id} != record id ${record.id}`);
      return record;
    });
}

export function eventsOf<T extends RunEvent["type"]>(
  records: readonly RunEventRecord[],
  type: T,
): Extract<RunEvent, { type: T }>[] {
  return records
    .map((record) => record.event)
    .filter((event): event is Extract<RunEvent, { type: T }> => event.type === type);
}

export interface Replay {
  status: number;
  contentType: string;
  frames: SseFrame[];
  records: RunEventRecord[];
}

/** The whole stream of a FINISHED run: the route closes after a terminal status (Task 0D). */
export async function replayEvents(
  request: APIRequestContext,
  runId: string,
  options: { after?: string; lastEventId?: string } = {},
): Promise<Replay> {
  const response = await request.get(runEventsPath(runId, options.after ?? null), {
    headers: options.lastEventId ? { [LAST_EVENT_ID_HEADER]: options.lastEventId } : {},
    failOnStatusCode: false,
    timeout: 30_000,
  });
  const frames = response.status() === 200 ? parseSse(await response.text()) : [];
  return {
    status: response.status(),
    contentType: response.headers()["content-type"] ?? "",
    frames,
    records: recordsOf(frames),
  };
}

/** Waits in the browser for the run's first event of `type` (replayed or live). */
export async function nextBrowserEvent(
  page: Page,
  runId: string,
  type: RunEvent["type"],
  timeoutMs = 60_000,
): Promise<RunEventRecord> {
  const text = await page.evaluate(
    ({ path, name, type, timeoutMs }) =>
      new Promise<string>((resolve, reject) => {
        const source = new EventSource(path);
        const timer = setTimeout(() => {
          source.close();
          reject(new Error(`no ${type} event within ${timeoutMs} ms`));
        }, timeoutMs);
        source.addEventListener(name, (message) => {
          const data = (message as MessageEvent<string>).data;
          if ((JSON.parse(data) as { event?: { type?: string } }).event?.type !== type) return;
          clearTimeout(timer);
          source.close();
          resolve(data);
        });
      }),
    { path: runEventsPath(runId), name: RUN_EVENT_SSE_NAME, type, timeoutMs },
  );
  const record = decodeRunEventData(text);
  if (!record) throw new Error(`undecodable ${type} event`);
  return record;
}
