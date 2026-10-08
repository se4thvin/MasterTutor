import { describe, expect, it } from "vitest";
import { SERVICE_WORKER_SOURCE } from "./service-worker.ts";

type Handler = (event: Record<string, unknown>) => void;

/** Runs the worker source against a fake ServiceWorkerGlobalScope and returns its handlers. */
function boot(windows: Array<{ navigate(url: string): Promise<unknown> }> = []) {
  const handlers: Record<string, Handler> = {};
  const shown: unknown[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://notes.example.org" },
    addEventListener: (type: string, handler: Handler) => (handlers[type] = handler),
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title: string, options: unknown) =>
        void shown.push({ title, options }),
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => windows,
      openWindow: async (url: string) => void opened.push(url),
    },
  };
  new Function("self", SERVICE_WORKER_SOURCE)(self);
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    handlers[type]!({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  return { dispatch, shown, opened };
}

const click = (url: unknown) => ({
  notification: { close: () => undefined, data: { url } },
});

describe("service worker (spec §13.4)", () => {
  it("caches nothing and fetches nothing", () => {
    expect(SERVICE_WORKER_SOURCE).not.toMatch(/fetch|importScripts|caches/);
  });

  it("shows the payload's title, body and link", async () => {
    const sw = boot();
    const payload = { title: "MasterTutor", body: "A run failed", url: "/settings/alerts#alert-1" };
    await sw.dispatch("push", { data: { json: () => payload } });
    expect(sw.shown).toEqual([
      {
        title: "MasterTutor",
        options: {
          body: "A run failed",
          tag: "mt-alert",
          data: { url: "/settings/alerts#alert-1" },
        },
      },
    ]);
  });

  it("shows a generic alert for a payload it cannot read", async () => {
    const sw = boot();
    await sw.dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("bad");
        },
      },
    });
    expect(sw.shown).toEqual([
      {
        title: "MasterTutor",
        options: { body: "", tag: "mt-alert", data: { url: "/settings/alerts" } },
      },
    ]);
  });

  it("opens same-origin links only", async () => {
    const sw = boot();
    await sw.dispatch("notificationclick", click("/settings/alerts#alert-1"));
    await sw.dispatch("notificationclick", click("https://evil.example/phish"));
    await sw.dispatch("notificationclick", click("javascript:alert(1)"));
    expect(sw.opened).toEqual(["/settings/alerts#alert-1", "/settings/alerts", "/settings/alerts"]);
  });

  it("reuses an open window, and opens one when it cannot navigate", async () => {
    const visited: string[] = [];
    const focused: string[] = [];
    const window = {
      navigate: async (url: string) => {
        visited.push(url);
        return { focus: async () => void focused.push(url) };
      },
    };
    const reused = boot([window]);
    await reused.dispatch("notificationclick", click("/settings/alerts#alert-1"));
    expect([visited, focused, reused.opened]).toEqual([
      ["/settings/alerts#alert-1"],
      ["/settings/alerts#alert-1"],
      [],
    ]);
    const stuck = boot([{ navigate: async () => Promise.reject(new TypeError("uncontrolled")) }]);
    await stuck.dispatch("notificationclick", click("/settings/alerts#alert-1"));
    expect(stuck.opened).toEqual(["/settings/alerts#alert-1"]);
  });
});
