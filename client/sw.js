// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The service worker (docs/features/CHAT.md §8): it only shows notifications pushed while the page isn't open — an
// agent asking for its owner's OK, a note, an answer that came — and opens (or brings forward) the page where it
// belongs when one is tapped. It caches nothing and handles no requests: the page always comes from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  const title = typeof m.title === 'string' && m.title ? m.title.slice(0, 120) : 'My Virtual World';
  const url = typeof m.url === 'string' && m.url.startsWith('/') ? m.url : '/';
  e.waitUntil(self.registration.showNotification(title, {
    body: typeof m.body === 'string' ? m.body.slice(0, 400) : '', tag: typeof m.tag === 'string' ? m.tag.slice(0, 64) : undefined, renotify: !!m.tag,
    icon: '/img/brand/app-192.png', badge: '/img/brand/favicon-64.png', data: { url },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = all.find(c => new URL(c.url).origin === self.location.origin);
    if (page) { await page.focus(); page.postMessage({ t: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});
