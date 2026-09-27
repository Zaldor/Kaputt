/* KAPUTT service worker.
   Versioned precache of the static core; /api/* is network-first and NEVER cached
   (matches, rooms, leaderboard, badges and the LLM proxy stay live-only).
   Static assets are cache-first with a network fallback; navigations fall back to
   the cached index.html so the game opens offline. Bump CACHE on every deploy. */
const CACHE = 'kaputt-v1';

const PRECACHE = [
  'index.html',
  'game.css',
  'game.js',
  'engine.js',
  'bots.js',
  'bot-worker.js',
  'motion.js',
  'match-outbox.js',
  'llm.js',
  'remote-client.js',
  'dice-scene.js',
  'assets/fonts/barlow-500.ttf',
  'assets/fonts/barlow-600.ttf',
  'assets/fonts/barlow-700.ttf',
  'assets/fonts/barlow-800.ttf',
  'assets/fonts/barlow-900.ttf',
  'assets/arena.webp',
  'assets/court-smooth.webp',
  'assets/target-ring.webp',
  'assets/kaputt-logo.webp',
  'assets/icons/arrow-clockwise-bold.svg',
  'assets/icons/arrow-left-bold.svg',
  'assets/icons/arrow-right-bold.svg',
  'assets/icons/chart-bar-bold.svg',
  'assets/icons/copy-bold.svg',
  'assets/icons/dice-five-fill.svg',
  'assets/icons/download-simple-bold.svg',
  'assets/icons/flask-bold.svg',
  'assets/icons/list-bold.svg',
  'assets/icons/question-bold.svg',
  'assets/icons/sparkle-fill.svg',
  'assets/icons/speaker-high-bold.svg',
  'assets/icons/trophy-fill.svg',
  'assets/icons/users-bold.svg',
  'assets/icons/x-bold.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'manifest.webmanifest'
];

const isApi = (url) => url.pathname === '/api' || url.pathname.startsWith('/api/');
const sameOrigin = (url) => url.origin === self.location.origin;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/* Network-first for the API. Responses are never written to any cache, and a
   network failure answers with a server-shaped 503 so clients keep retrying. */
async function networkFirstApi(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: 'You are offline. This will retry when you reconnect.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}

/* Cache-first for static assets, network fills the cache when offline misses. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const url = new URL(request.url);
    const storable = response && response.ok && sameOrigin(url) && !isApi(url) && !request.headers.get('range');
    if (storable) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const late = await cache.match(request, { ignoreSearch: true });
    if (late) return late;
    throw error;
  }
}

/* Navigations: network first so deploys show up immediately, cached copy when the
   network is gone, and the precached index.html as the offline page. */
async function navigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) return response;
  } catch (error) { /* offline below */ }
  const cache = await caches.open(CACHE);
  const page = (await cache.match(request, { ignoreSearch: true })) || (await cache.match('index.html'));
  if (page) return page;
  return new Response('<!doctype html><meta charset="utf-8"><title>KAPUTT offline</title><p>KAPUTT needs a connection the first time it loads. Reconnect and try again.</p>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!sameOrigin(url)) return; // cross-origin (LLM providers) stays untouched
  if (isApi(url)) {
    event.respondWith(networkFirstApi(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
