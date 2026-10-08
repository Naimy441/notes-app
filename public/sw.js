// Offline-first shell for the home-screen app. Notes themselves live in
// Firestore's IndexedDB cache; this only makes the app code load without network.
const SHELL = "shell-v1";
const STATIC = "static-v1";

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

  // The app is a single page: serve the cached shell instantly, refresh it in the background.
  const key = req.mode === "navigate" ? "/" : req;
  e.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(key);
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") c.put(key, res.clone());
          return res;
        })
        .catch(() => hit || Response.error());
      if (hit) {
        e.waitUntil(network);
        return hit;
      }
      return network;
    }),
  );
});
