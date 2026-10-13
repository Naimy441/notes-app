// The home-screen app's offline shell. Notes themselves live in Firestore's
// IndexedDB cache; this only makes the app code load without (or with bad) network.
const SHELL = "shell-v3";
const STATIC = "static-v3";
const NAV_TIMEOUT_MS = 3000; // after this, open the cached app instead of waiting
const STATIC_LIMIT = 300; // old hashed bundles from past deploys are pruned past this

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

async function prune(cache) {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT))) await cache.delete(req);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/__/") || url.pathname.startsWith("/api/") || url.searchParams.has("_rsc")) return;

  // Content-hashed build output never changes: cache forever (bounded).
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          c.put(req, res.clone());
          e.waitUntil(prune(c));
        }
        return res;
      }),
    );
    return;
  }

  // Documents: network first so a deploy shows up right away, but don't make the
  // app wait on a weak connection — after a few seconds open the cached shell and
  // let the network response refresh the cache for next time.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        const network = fetch(req).then((res) => {
          if (res.ok && res.type === "basic") cache.put("/", res.clone());
          return res;
        });
        e.waitUntil(network.catch(() => {}));
        const cached = await cache.match("/");
        if (!cached) return network.catch(() => Response.error());
        const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS));
        return Promise.race([network.catch(() => cached), timeout]);
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
