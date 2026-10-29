// Offline support. The page is fetched from the network first (so updates show up at once) and
// falls back to the cached copy offline; the hashed files under assets/ never change, so they come
// from the cache. Every time a fresh page arrives, the files it uses are cached and old ones dropped.
const CACHE = 'grid-icon-v1';
const SHELL = ['./', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

async function cachePage(html) {
  const cache = await caches.open(CACHE);
  const used = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href);
  await Promise.all(used.map(async (u) => (await cache.match(u)) || cache.add(u).catch(() => {})));
  // drop assets of older builds
  for (const req of await cache.keys())
    if (req.url.includes('/assets/') && !used.includes(req.url)) await cache.delete(req);
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const page = await cache.match('./');
    if (page) await cachePage(await page.text());
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put('./', res.clone());
          e.waitUntil(res.clone().text().then(cachePage));
        }
        return res;
      } catch {
        return (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    // examples and other static files: keep a copy for offline use
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(req, res.clone());
    }
    return res;
  })());
});
