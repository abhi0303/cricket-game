// Service worker: makes the game installable and playable offline.
//
// The game is plain files, so on install it saves the page, the code, the styles and the core assets (the list comes
// from the precache manifest, written at publish time by the deploy workflow). Everything else it fetches (Three.js
// and the fonts from their CDNs, the 3D models, the textures) is saved the first time it loads. After that:
//   - the game's own files: from the network when online (so an update shows up straight away), from the cache
//     when offline;
//   - the CDN libraries, fonts, models and textures (they never change at the same address): from the cache first.
// A new version of this file (VERSION changes on every publish) clears the old caches.
const VERSION = 'dev';
const CACHE = `lpcricket-${VERSION}`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let files = ['./', './index.html', './manifest.webmanifest'];
    try {
      const r = await fetch('./precache.json', { cache: 'no-store' });
      if (r.ok) files = [...new Set([...files, ...(await r.json())])];
    } catch { /* no list (running locally): the rest is saved as it loads */ }
    // one at a time so one missing file doesn't stop the rest
    await Promise.all(files.map(f => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lpcricket-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const LONG_LIVED = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const isAsset = url => /\/assets\/(models|textures|icons)\//.test(url) || /\.(glb|jpe?g|png|webp)$/.test(url);

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  const sameOrigin = url.startsWith(self.location.origin);
  if (!sameOrigin && !LONG_LIVED.test(url)) return;
  if (LONG_LIVED.test(url) || (sameOrigin && isAsset(url))) {
    // cache first, saving what comes from the network
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: sameOrigin });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  // the game's code and pages: network first (fresh when online), the saved copy when offline
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
      if (hit) return hit;
      throw new Error('offline and not saved: ' + url);
    }
  })());
});
