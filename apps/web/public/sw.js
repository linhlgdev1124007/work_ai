self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  event.waitUntil(self.registration.showNotification(payload.title || 'WorkAI', {
    body: payload.body || 'Bạn có thông báo mới.',
    tag: payload.id || 'workai',
    icon: '/icon-192.png',
    data: { href: payload.href || '/today' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = new URL('/today', self.location.origin);
  try {
    const requested = new URL(event.notification.data?.href || '/today', self.location.origin);
    if (requested.origin === self.location.origin && ['/tasks', '/chat', '/today'].includes(requested.pathname)) target = requested;
  } catch {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      try { const navigated = await existing.navigate(target.href); if (navigated) { await navigated.focus(); return; } } catch {}
    }
    await self.clients.openWindow(target.href);
  })());
});
