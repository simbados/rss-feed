// Service worker, served as /sw.js (classic script). Push notifications only for now (offline cache
// comes later).
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch {}
  const text = (v, fallback) => (typeof v === 'string' && v ? v : fallback);
  e.waitUntil(self.registration.showNotification(text(msg.title, 'RSS'), {
    body: text(msg.body, ''),
    tag: text(msg.tag, 'rss'),
    icon: '/icon-192.png',
    data: { url: text(msg.url, '/') },
  }));
});

// Only paths on this site are opened, whatever the message says.
function sitePath(url) {
  if (typeof url !== 'string') return '/';
  try {
    const u = new URL(url, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = sitePath(e.notification.data && e.notification.data.url);
  e.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      try {
        await client.focus();
        await client.navigate(target);
        return;
      } catch {}
    }
    await self.clients.openWindow(target);
  })());
});
