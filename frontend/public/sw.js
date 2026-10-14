/* CADE service worker: push notifications and an installable shell.
 *
 * No asset caching: a stale script would be worse than a reload on a slow
 * link, and the backend serves the built app directly. The one cached item
 * is the shell page, so navigation still renders something when offline.
 */

const SHELL_CACHE = "cade-shell-v1";
const BASE = new URL(self.registration.scope).pathname; // e.g. "/" or "/cade/"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(BASE).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(BASE).then((hit) => hit || Response.error()))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CADE", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "CADE";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "cade",
      renotify: true,
      icon: BASE + "icons/icon-192.png",
      badge: BASE + "icons/icon-192.png",
      data: { url: data.url || BASE, sessionId: data.sessionId || null },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || BASE;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin + BASE) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
