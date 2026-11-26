// BRIGHTEM service worker — lets the app open with no internet.
//   page (navigation)        network first, falls back to the cached index.html
//   /assets/* (hashed files) cache first
//   other same-origin files  stale-while-revalidate
//   Supabase public photos   cache first (so photos seen once show offline)
// Data (Supabase REST) is NOT handled here — see src/offline.ts.
const VERSION = 'brightem-v1';
const SHELL = `${VERSION}-shell`;
const PHOTOS = `${VERSION}-photos`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const res = await fetch('/index.html', { cache: 'no-store' });
      await cache.put('/index.html', res.clone());
      // Precache the JS/CSS the page references.
      const html = await res.text();
      const urls = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
        .map((m) => m[1])
        .filter((u) => u.startsWith('/assets/') || u.endsWith('.webmanifest') || u.endsWith('.svg'));
      await Promise.all(urls.map((u) => cache.add(u).catch(() => undefined)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put('/index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('/index.html', { ignoreVary: true })) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true, ignoreSearch: false });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') await cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, { ignoreVary: true, ignoreSearch: false });
  const net = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || net;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') return event.respondWith(networkFirstPage(request));
    if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(request, SHELL));
    if (url.pathname === '/sw.js') return;
    return event.respondWith(staleWhileRevalidate(request));
  }
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/')) {
    return event.respondWith(cacheFirst(request, PHOTOS));
  }
});
