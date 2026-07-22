// ── Financing Lane (broker portal) service worker ───────────────────────────
// Deliberately SEPARATE from the main app's sw.js and scoped to /broker.html
// (registered with {scope:'/broker.html'}) so it never controls Maxwell's CRM
// pages or collides with sw.js if both are open in the same browser profile.
const CACHE = 'financing-lane-v1';

// ── INSTALL / ACTIVATE ───────────────────────────────────────────────────────
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first so new code always loads; cache is offline fallback ──
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (url.includes('supabase.co') || url.includes('googleapis') || e.request.method !== 'GET') return;
  if (url.includes('/icons/')) return;  // let the browser handle icons normally
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/broker.html')))
  );
});

// ── PUSH: show the notification ──────────────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json?.() || {};
  const title = data.title || 'Financing Lane';
  const options = {
    body: data.body || 'You have an update.',
    icon: '/icons/icon-192-v3.png',
    badge: '/icons/icon-96-v3.png',
    data: { tab: data.tab || 'b' },   // default deep-link: All clients
    vibrate: [200, 100, 200]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ── NOTIFICATION CLICK: focus the portal and switch to the right tab ─────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = e.notification.data?.tab || 'b';
  const urlToOpen = self.registration.scope + '?tab=' + tab;   // scope is /broker.html
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const c of wins) {
        if (c.url.includes('/broker.html')) { c.focus(); c.postMessage({ type: 'SWITCH_TAB', tab }); return; }
      }
      return clients.openWindow(urlToOpen);
    })
  );
});
