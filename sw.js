const CACHE = 'dealflow-v7';
const ASSETS = ['/', '/index.html', '/css/app.css', '/js/app.js', '/config.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── NOTIFICATION CLICK — open app and navigate to Approvals ──────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = e.notification.data?.tab || 'approvals';
  const urlToOpen = self.registration.scope + '#' + tab;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If app is already open, focus it and switch tab
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope)) {
          client.focus();
          client.postMessage({ type: 'SWITCH_TAB', tab });
          return;
        }
      }
      // Otherwise open the app
      return clients.openWindow(self.registration.scope + '?tab=' + tab);
    })
  );
});
