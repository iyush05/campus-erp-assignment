const VERSION = 'campus-shell-v4';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => { for (const key of await caches.keys()) if (key.startsWith('campus-shell-') && key !== VERSION) await caches.delete(key); await self.clients.claim(); })()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'PREPARE_OFFLINE' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const assets = event.data.urls.filter(value => { try { const u = new URL(value, self.location.origin); return u.origin === self.location.origin && /\.(js|css|svg)$/.test(u.pathname) && !u.pathname.startsWith('/api/'); } catch { return false; } });
    await Promise.allSettled(['/', ...assets].map(async url => { const response = await fetch(url); if (response.ok && !response.redirected) await cache.put(url, response); }));
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.includes('chatgpt') || url.pathname === '/callback') return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith((async () => { const cache = await caches.open(VERSION); try { const response = await fetch(request); if (response.ok && !response.redirected) await cache.put('/', response.clone()); return response; } catch { return (await cache.match('/')) || new Response('Open Campus online once to prepare offline attendance.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); } })());
  } else if (/\.(js|css|svg|woff2)$/.test(url.pathname) && !url.pathname.includes('node_modules')) {
    event.respondWith((async () => { const cache = await caches.open(VERSION), cached = await cache.match(request); if (cached) return cached; const response = await fetch(request); if (response.ok) await cache.put(request, response.clone()); return response; })());
  }
});
