const CACHE = 'ofg-v46';
const SHELL = ['/', '/style.css', '/uicons.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/favicon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/ws')) return;
  if (u.pathname.startsWith('/api/event')) {
    // agenda disponível offline: rede primeiro, cache como reserva
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/media/')) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});

self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : { title: 'OFG Recife', body: '' };
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    if (cs.some((c) => c.visibilityState === 'visible')) return; // app aberta: já mostra toast
    return self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-48.png', data: d });
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.length ? cs[0].focus() : self.clients.openWindow('/')));
});
