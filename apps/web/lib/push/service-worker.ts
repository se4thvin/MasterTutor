/**
 * The service worker (spec §13.4): shows a push and opens its same-origin deep link. It never
 * intercepts requests or stores anything, so it never changes how the app loads. It takes over at
 * once, so the page that turned phone alerts on is the one a tap can navigate.
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
