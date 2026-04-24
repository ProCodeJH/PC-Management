// JHS PC Manager — Service Worker
// Strategy:
//   - Static assets (HTML/CSS/JS/SVG): cache-first with background revalidation
//   - API requests: network-only (live data, no caching)
//   - Socket.IO: passthrough (WebSocket can't be cached)

const CACHE_VERSION = 'jhs-pc-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json',
    '/icon.svg',
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => {
            // Best-effort precache; ignore failures (offline first install)
            return cache.addAll(STATIC_ASSETS).catch(() => {});
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k.startsWith('jhs-pc-') && k !== STATIC_CACHE)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never cache: API, socket.io, screenshots, agent updates
    if (url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/socket.io/') ||
        url.pathname.startsWith('/screenshots/') ||
        url.pathname === '/agent-latest.js' ||
        url.pathname === '/wallpaper.png') {
        return; // pass through to network
    }

    // Only handle GET
    if (event.request.method !== 'GET') return;

    // Cache-first with background refresh for static assets
    event.respondWith(
        caches.match(event.request).then(cached => {
            const networkFetch = fetch(event.request).then(networkRes => {
                if (networkRes && networkRes.status === 200 && networkRes.type !== 'opaque') {
                    const clone = networkRes.clone();
                    caches.open(STATIC_CACHE).then(c => c.put(event.request, clone)).catch(() => {});
                }
                return networkRes;
            }).catch(() => cached);
            return cached || networkFetch;
        })
    );
});
