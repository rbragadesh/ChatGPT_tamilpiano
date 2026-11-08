/* The build step replaces these values with a content-hashed offline snapshot. */
const VERSION = '6e26ba6f4cb267f8';
const FILES = ["apple-touch-icon.png","assets/index-DYyd23c9.css","assets/index-Di28Ziqa.js","assets/transcription.worker-CnLk6HNr.js","credits.html","icon-192.png","icon-512.png","icon-maskable.png","icon.svg","index.html","licenses/index.json","licenses/lucide-react@0.468.0/LICENSE","licenses/onnxruntime-common@1.31.1/LICENSE","licenses/onnxruntime-common@1.31.1/ThirdPartyNotices.txt","licenses/onnxruntime-web@1.31.1/LICENSE","licenses/onnxruntime-web@1.31.1/ThirdPartyNotices.txt","licenses/react-dom@19.3.1/LICENSE","licenses/react@19.3.1/LICENSE","licenses/scheduler@0.28.0/LICENSE","manifest.webmanifest","metadata/LICENSE-CC0.txt","models/LICENSE","models/NOTICE","models/ONNXRUNTIME-LICENSE","models/ONNXRUNTIME-THIRD-PARTY-NOTICES.txt","models/basic-pitch-0.4.0.onnx","onnx/assets.json","onnx/ort-wasm-simd-threaded.mjs","onnx/ort-wasm-simd-threaded.wasm","onnx/ort.wasm.bundle.min.mjs"];
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
