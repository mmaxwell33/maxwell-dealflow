const CACHE = 'dealflow-v8';
const ASSETS = [
  '/',
  '/index.html',
  '/intake.html',
  '/manifest.json',
  '/config.js',
  '/css/app.css',
  '/js/app.js',
  '/js/clients.js',
  '/js/viewings.js',
  '/js/offers.js',
  '/js/notifications.js',
  '/js/tracker.js',
  '/js/analytics.js',
  '/js/extras.js',
  '/js/ai.js',
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

// ── INSTALL: cache all shell assets ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first for Supabase; cache-first for shell assets ───────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never intercept Supabase, auth, or POST requests
  if (url.includes('supabase.co') || e.request.method !== 'GET') return;

  // For navigation (HTML pages) — network first, fallback to cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For everything else — cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        // Cache successful same-origin responses
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
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
