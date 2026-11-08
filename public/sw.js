/* The build step replaces these values with a content-hashed offline snapshot. */
const VERSION = '__CACHE_VERSION__';
const FILES = /* __PRECACHE_ASSETS__ */ [];
const SCOPE = self.registration.scope;
const PREFIX = `isai-${new URL(SCOPE).pathname}-`;
const CACHE = `${PREFIX}${VERSION}`;
const INDEX = new URL('index.html', SCOPE).href;
const PRECACHE = new Set(FILES.map(path => new URL(path, SCOPE).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...PRECACHE]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== new URL(SCOPE).origin || !url.href.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      // Online navigation gets fresh HTML. Offline always uses a coherent,
      // build-time snapshot, never an HTML error page or a partial update.
      try {
        const response = await fetch(request);
        if (response.ok) return response;
      } catch { /* Fall back to the installed app shell. */ }
      const cache = await caches.open(CACHE);
      return await cache.match(INDEX) || new Response('Isai is not available offline yet. Open it once while online.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })());
    return;
  }

  // Cache only build-listed files. Missing files keep their real status and
  // arbitrary URLs are never answered with the app's HTML.
  url.search = '';
  if (!PRECACHE.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(url.href) || fetch(request);
  })());
});
