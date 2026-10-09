/**
 * The service worker (spec §13.4): shows a push and opens its same-origin deep link. It never
 * intercepts requests or stores anything, so it never changes how the app loads. It takes over at
 * once, so the page that turned phone alerts on is the one a tap can navigate. When the browser
 * rotates the subscription it re-sends the new one itself (the app may not be open) and tells
 * open pages, so Settings never shows phone alerts on while the server holds a dead endpoint.
 */
export const SERVICE_WORKER_SOURCE = `
const FALLBACK = "/settings/alerts";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try { data = (event.data && event.data.json()) || {}; } catch (e) { data = {}; }
  const title = typeof data.title === "string" ? data.title : "MasterTutor";
  const body = typeof data.body === "string" ? data.body : "";
  const url = typeof data.url === "string" ? data.url : FALLBACK;
  event.waitUntil(self.registration.showNotification(title, { body, tag: "mt-alert", data: { url } }));
});
function sameOrigin(url) {
  try { return typeof url === "string" && new URL(url, self.location.origin).origin === self.location.origin; }
  catch (e) { return false; }
}
function rpc(path, input) {
  return fetch("/api/rpc/alerts/" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
}
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const fresh = event.newSubscription || (old ? await self.registration.pushManager.subscribe(old.options) : null);
    if (fresh) {
      const json = fresh.toJSON();
      await rpc("subscribe", { endpoint: json.endpoint, keys: json.keys });
    }
    if (old && (!fresh || fresh.endpoint !== old.endpoint)) await rpc("unsubscribe", { endpoint: old.endpoint });
    const windows = await self.clients.matchAll({ type: "window" });
    for (const client of windows) client.postMessage({ type: "mt-push-changed" });
  })().catch(() => undefined));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  const target = sameOrigin(url) ? url : FALLBACK;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try {
        const opened = await client.navigate(target);
        if (opened) return opened.focus();
      } catch (e) {}
    }
    return self.clients.openWindow(target);
  })());
});
`;
