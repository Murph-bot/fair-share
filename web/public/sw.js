const CACHE = "fairshare-shell-v2";
const TRIP_CACHE_PREFIX = "fairshare-trip-";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-180.png", "/icon-192.png"]),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE && !key.startsWith(TRIP_CACHE_PREFIX))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function cacheKeyForTrip(id) {
  return `${TRIP_CACHE_PREFIX}${id}`;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Trip data: network-first so fresh data wins, cached copy as offline fallback.
  const tripMatch = /^\/api\/trips\/([a-f0-9]{32})$/.exec(url.pathname);
  if (tripMatch) {
    const id = tripMatch[1];
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(cacheKeyForTrip(id)).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.open(cacheKeyForTrip(id)).then((cache) => cache.match(event.request)),
        ),
    );
    return;
  }

  // Photos: cache-first, but only when the response is publicly cacheable
  // (unlocked trips). PIN-locked photos are private and never persisted.
  if (url.pathname.startsWith("/uploads/photos/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          return cached;
        }
        const response = await fetch(event.request);
        const cacheControl = response.headers.get("Cache-Control") ?? "";
        if (response.ok && cacheControl.includes("public")) {
          cache.put(event.request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  // App shell + assets: network-first with offline fallback.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", clone));
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) {
          cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await cache.match(event.request);
        if (cached) {
          return cached;
        }
        throw new Error("offline");
      }
    }),
  );
});
