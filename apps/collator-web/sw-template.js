/* global self, caches, fetch, URL, __VERSION__, __SHELL__ */
// The judge page's service worker (#41 PR 3): it keeps the app itself on the phone, so a reload with no
// Wi-Fi still opens the page. vite.config.ts fills in SHELL (the built files) and VERSION at build time.
//
// It keeps the app only. The event, the roster and the outbox live in the page (localStorage, which a
// service worker can't read), and the page does all the sending: no Background Sync, which iOS Safari
// doesn't have anyway. If the worker ever has to send, the outbox moves to IndexedDB behind the same
// interface. Requests to /api/ are never touched here.

const VERSION = __VERSION__;
const SHELL = __SHELL__;
const PREFIX = "judge-app-";
const CACHE = `${PREFIX}${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

// A new version takes over at once and drops the old copy. The page already running keeps its loaded
// code; the next reload gets the new one.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(PREFIX) && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The copy on the phone first: a station's weak Wi-Fi can hang a request for a long time. Any page
// (the judge page, /official) is the one index.html, kept as "/".
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/"))
    return;
  const key = request.mode === "navigate" ? "/" : request;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(key))
      .then((kept) => kept ?? fetch(request)),
  );
});
