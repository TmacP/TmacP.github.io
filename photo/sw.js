// ============================================================================
// PWA SERVICE WORKER — photo_poki
// ============================================================================
// Caches the game shell so it loads instantly and runs offline after first
// visit. Binary game assets are embedded inside photo_poki.wasm, and shaders
// are inlined into main.js by the build — so only the shell files need caching.

// NOTE: the `-v2` suffix is a placeholder — the `photo_poki_web` make recipe
// rewrites it to a hash of the built bundle at deploy time, so installed PWAs
// reliably pick up new deploys. Don't rely on this literal value at runtime.
const CACHE_NAME = 'photo-poki-pwa-a1c1ba6385';

const CORE_ASSETS = [
  './',
  './index.html',
  './main.js',
  './generated_constants.js',
  './photo_poki.wasm',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

// Always fetch from network (never cache) — these files are tiny and may change
// between deploys without the SW noticing, causing stale manifest/icon issues.
// Suffix-matched (not absolute) so this works when the app is served from a
// sub-path like educedmoment.ca/photo/ as well as from a domain root.
const NETWORK_ONLY = ['manifest.json', 'sw.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) =>
            console.warn(`[PWA] Could not cache ${url}:`, err.message)
          )
        )
      );
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[PWA] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Manifest + sw.js: always network (avoid stale manifest issues)
  if (NETWORK_ONLY.some((name) => url.pathname.endsWith(name))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Everything else: cache-first, fall back to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});