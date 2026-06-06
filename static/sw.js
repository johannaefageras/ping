const CACHE = "ping-shell-v7";

const SHELL = [
  "/",
  "/app",
  "/style.css",
  "/app.js",
  "/assets/scripts/invite-url.js",
  "/assets/scripts/qrcode.js",
  "/assets/audio/ping.wav",
  "/assets/manifest/manifest.webmanifest",
  "/assets/favicons/icon-192.png",
  "/assets/favicons/icon-512.png",
  "/assets/favicons/apple-touch-icon.png",
  "/assets/favicons/favicon-32.png",
  "/fonts/MonaspaceRadon.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => null),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/config") return;
  // Link previews are dynamic and per-URL. Never SW-cache them: caching the
  // /preview JSON would defeat the server's 10-minute TTL and pin transient
  // "no preview" (204) results forever; the image proxy sets its own
  // Cache-Control for normal browser caching.
  if (url.pathname === "/preview" || url.pathname === "/preview/image") return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/app").then((r) => r || caches.match("/")),
      ),
    );
    return;
  }

  // Network-first for code/styles so edits show on reload (cache-first would
  // serve a stale style.css/app.js until the CACHE version is bumped). Falls
  // back to cache when offline, and refreshes the cache on every hit.
  if (url.pathname === "/style.css" || url.pathname === "/app.js") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => cached),
    ),
  );
});
