// The home-screen app. Notes live in Firestore's IndexedDB cache.
// Navigations are network-first: a cache-first shell kept serving the
// pre-deploy HTML (and its old hashed bundles) after the app had moved on.
const SHELL = "shell-v2";
const STATIC = "static-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.add("/")));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (![SHELL, STATIC].includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/__/") || url.searchParams.has("_rsc")) return;

  // Content-hashed build output never changes: cache forever.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Documents: network first, fall back to the last good shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        try {
          const res = await fetch(req);
          if (res.ok && res.type === "basic") cache.put("/", res.clone());
          return res;
        } catch {
          return (await cache.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || Response.error();
      }
    })(),
  );
});
