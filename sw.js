const CACHE = 'dealflow-v15';
const ICON_CACHE = 'dealflow-icons-v1';

const ICONS = [
  '/icons/icon-48.png',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-144.png',
  '/icons/icon-152.png',
  '/icons/icon-167.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// ── INSTALL: pre-cache only icons (they never change) ────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(ICON_CACHE).then(c => c.addAll(ICONS)).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== ICON_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never intercept Supabase, external APIs, or non-GET requests
  if (url.includes('supabase.co') || url.includes('googleapis') || e.request.method !== 'GET') return;

  // Icons — cache-first (they never change)
  if (url.includes('/icons/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          const toCache = resp.clone();
          caches.open(ICON_CACHE).then(c => c.put(e.request, toCache));
        }
        return resp;
      }))
    );
    return;
  }

  // Everything else (JS, CSS, HTML, manifest) — NETWORK FIRST, fallback to cache
  // This ensures updated code always loads immediately
  e.respondWith(
    fetch(e.request).then(resp => {
      // Cache the fresh response for offline fallback
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const toCache = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, toCache));
      }
      return resp;
    }).catch(() => {
      // Offline fallback — serve from cache
      return caches.match(e.request).then(cached => cached || caches.match('/index.html'));
    })
  );
});

// ── NOTIFICATION CLICK — open app and navigate to correct tab ────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = e.notification.data?.tab || 'approvals';
  const urlToOpen = self.registration.scope + '?tab=' + tab;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.registration.scope)) {
          client.focus();
          client.postMessage({ type: 'SWITCH_TAB', tab });
          return;
        }
      }
      return clients.openWindow(urlToOpen);
    })
  );
});

// ── PUSH: handle push notifications ──────────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json?.() || {};
  const title = data.title || 'Maxwell DealFlow';
  const options = {
    body: data.body || 'You have a new notification.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    data: { tab: data.tab || 'approvals' },
    vibrate: [200, 100, 200]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
