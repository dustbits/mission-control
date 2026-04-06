const CACHE = 'mc-v4';
const PRECACHE = ['/', '/index.html', '/config.js', '/game.js', '/scripts/cost-dashboard.js', '/assets/bebop-sprites.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Network-first for live data and JSON
  if (url.pathname.includes('shared-log') || url.pathname.includes('mission-control-live') || url.pathname.includes('gateway') || url.pathname.endsWith('.json')) {
    return;
  }
  // Network-first for HTML and JS (so deploys take effect immediately)
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Cache-first for static assets (images, css)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    }))
  );
});
