import { readFileSync } from "node:fs";
import { liveEmbedPath, type RunDetail, type RunEventRecord } from "@mastertutor/contracts";
import { expect, type Locator, type Page } from "@playwright/test";
import { RECORDED_RUN_ID } from "../../lib/fixtures/run-recording.ts";

export interface RpcCall {
  path: string;
  input: unknown;
}
export type RpcHandler = (input: unknown) => unknown;

/** Thrown by a handler to answer with an oRPC error (status + code), as the server would. */
export class RpcFailure extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Intercepts /api/rpc/<router>/<proc> for the given procedures only; everything else falls through
 * to the fixture server. oRPC 1.15.4 wire: request {json: input}; response {json: output}.
 */
export async function mockRpc(
  page: Page,
  handlers: Record<string, RpcHandler>,
): Promise<RpcCall[]> {
  const calls: RpcCall[] = [];
  await page.route("**/api/rpc/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/rpc\//, "");
    const handler = handlers[path];
    if (!handler) return route.fallback();
    const input = (route.request().postDataJSON() as { json?: unknown } | null)?.json;
    calls.push({ path, input });
    try {
      const output: unknown = await handler(input);
      await route.fulfill({ json: { json: output } });
    } catch (error) {
      const failure =
        error instanceof RpcFailure ? error : new RpcFailure("INTERNAL_SERVER_ERROR", 500);
      await route.fulfill({
        status: failure.status,
        json: {
          json: {
            defined: false,
            code: failure.code,
            status: failure.status,
            message: failure.message,
          },
        },
      });
    }
  });
  return calls;
}

export const rpcCalls = (calls: readonly RpcCall[], path: string): unknown[] =>
  calls.filter((c) => c.path === path).map((c) => c.input);

const OK = { ok: true } as const;

/** The control RPCs a run test asserts; the fixture router does not implement them (Phase 7/B6 do). */
export function controlHandlers(): Record<string, RpcHandler> {
  return {
    "runs/openLive": (input) => ({
      sleeping: false,
      slotName: "browser-1",
      embedPath: liveEmbedPath((input as { runId: string }).runId),
      iceServers: [],
    }),
    "runs/takeControl": () => OK,
    "runs/handBack": () => OK,
    "runs/decideApproval": () => OK,
    "runs/submitOtp": () => OK,
    "runs/sendMessage": () => OK,
    "runs/setApprovalMode": () => OK,
    "runs/cancel": () => OK,
    "runs/resume": () => OK,
  };
}

interface FakeSource extends EventTarget {
  readyState: number;
  url: string;
  dispatch(event: Event): void;
}
interface SseControl {
  sources: FakeSource[];
  blockOpen: boolean;
  emit(records: { id: string }[]): void;
  fail(closed: boolean): void;
  openAll(): void;
}
declare global {
  interface Window {
    __sse: SseControl;
  }
}

/** Replaces window.EventSource with a test-controlled fake (open streams, scripted delivery). */
export async function installFakeEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const open = (source: FakeSource) => {
      source.readyState = 1;
      source.dispatch(new Event("open"));
    };
    const control: SseControl = {
      sources: [],
      blockOpen: false,
      emit(records) {
        for (const source of control.sources) {
          if (source.readyState !== 1) continue;
          for (const record of records) {
            source.dispatch(
              new MessageEvent("run_event", {
                data: JSON.stringify(record),
                lastEventId: record.id,
              }),
            );
          }
        }
      },
      fail(closed) {
        for (const source of control.sources) {
          if (source.readyState === 2) continue;
          source.readyState = closed ? 2 : 0;
          source.dispatch(new Event("error"));
        }
      },
      openAll() {
        control.blockOpen = false;
        for (const source of control.sources) if (source.readyState === 0) open(source);
      },
    };
    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly withCredentials = false;
      readonly url: string;
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: Event) => void) | null = null;
      constructor(url: string | URL) {
        super();
        this.url = String(url);
        control.sources.push(this);
        if (!control.blockOpen) setTimeout(() => open(this), 0);
      }
      dispatch(event: Event) {
        const handler =
          event.type === "open" ? this.onopen : event.type === "error" ? this.onerror : null;
        handler?.call(this, event);
        this.dispatchEvent(event);
      }
      close() {
        this.readyState = 2;
      }
    }
    window.__sse = control;
    window.EventSource = FakeEventSource as unknown as typeof EventSource;
  });
}

export async function emit(page: Page, records: RunEventRecord[]): Promise<void> {
  await page.waitForFunction(() => window.__sse.sources.some((s) => s.readyState === 1));
  await page.evaluate((rs) => window.__sse.emit(rs), records);
}

const FRAME_SVG = readFileSync(new URL("./frame.svg", import.meta.url), "utf8");

/**
 * A stand-in for n.eko's embed: the fixed frame and a `<video>` that decodes frames (as n.eko's
 * does once WebRTC connects): at once, after `LATE_VIDEO_MS` ("late"), or never ("blank").
 */
const liveEmbedPage = (video: "video" | "late" | "blank") =>
  `<!doctype html><html lang="en"><head><title>Remote page</title><style>html,body{margin:0;height:100%}svg{display:block;width:100%;height:100%}video{position:absolute;width:1px;height:1px;opacity:0}</style></head><body>${FRAME_SVG}<video autoplay muted playsinline></video>${
    video === "blank"
      ? ""
      : `<script>setTimeout(() => {const c=document.createElement("canvas");c.width=64;c.height=36;const x=c.getContext("2d");let i=0;setInterval(()=>{x.fillStyle=i++%2?"#345":"#543";x.fillRect(0,0,64,36)},100);document.querySelector("video").srcObject=c.captureStream(10);}, ${video === "late" ? LATE_VIDEO_MS : 0});</script>`
  }</body></html>`;

/** When a "late" embed decodes its first frame. */
export const LATE_VIDEO_MS = 9_000;

/** Whether the n-th load (1-based) of the live embed decodes video. */
export type LiveEmbed = (load: number) => "video" | "late" | "blank";

/** Stubs the n.eko embed and the masked step and approval screenshots with one fixed frame. */
export async function stubLiveFrame(
  page: Page,
  liveEmbed: LiveEmbed = () => "video",
): Promise<void> {
  let loads = 0;
  await page.route("**/live/**", (route) =>
    route.fulfill({ contentType: "text/html", body: liveEmbedPage(liveEmbed(++loads)) }),
  );
  for (const pattern of [
    "**/api/runs/*/steps/*/screenshot",
    "**/api/runs/*/approvals/*/screenshot",
  ]) {
    await page.route(pattern, (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: FRAME_SVG }),
    );
  }
}

export const frame = (page: Page): Locator => page.getByTestId("browser-frame");

export interface GotoRunOptions {
  /** A runs.get variant (sleeping, user-held, finished, …); default: the fixture's recorded run. */
  detail?: RunDetail;
  handlers?: Record<string, RpcHandler>;
  realEventSource?: boolean;
  /** Whether each load of the live embed decodes video (default: always). */
  liveEmbed?: LiveEmbed;
}

export async function gotoRun(page: Page, opts: GotoRunOptions = {}): Promise<RpcCall[]> {
  if (!opts.realEventSource) await installFakeEventSource(page);
  await stubLiveFrame(page, opts.liveEmbed);
  const detail = opts.detail;
  const calls = await mockRpc(page, {
    ...controlHandlers(),
    ...(detail ? { "runs/get": () => detail } : {}),
    ...opts.handlers,
  });
  await page.goto(`/runs/${detail?.id ?? RECORDED_RUN_ID}`);
  await expect(frame(page)).toBeVisible();
  // The thread's content is lazily loaded: a test starts once the pane holds it.
  await expect(page.locator(".thread-loading")).toHaveCount(0);
  return calls;
}
