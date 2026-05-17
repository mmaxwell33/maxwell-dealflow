const CACHE = 'dealflow-v72';
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

// ── FETCH STRATEGY (PR #16) ───────────────────────────────────────────────────
// Three lanes:
//   1. Icons              → cache-first (they never change, see ICON_CACHE)
//   2. HTML navigations   → network-first with 3 s timeout, fall back to cache
//   3. Everything else    → stale-while-revalidate (CSS/JS/manifest)
//
// To force a hard refresh of all clients after a deploy, bump CACHE (line 1).
// The activate handler will purge the old cache; SWR pulls the new file on
// the next request and serves it on the load after that.

// Helper: network-first with a hard timeout. Resolves to whatever wins.
function networkFirstWithTimeout(request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      const cached = await caches.match(request);
      resolve(cached || fetch(request).catch(() => caches.match('/index.html')));
    }, timeoutMs);

    fetch(request).then(resp => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const toCache = resp.clone();
        caches.open(CACHE).then(c => c.put(request, toCache));
      }
      resolve(resp);
    }).catch(async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const cached = await caches.match(request);
      resolve(cached || caches.match('/index.html'));
    });
  });
}

// Helper: serve cache immediately if present, refresh cache in background.
function staleWhileRevalidate(request) {
  return caches.match(request).then(cached => {
    const networkFetch = fetch(request).then(resp => {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const toCache = resp.clone();
        caches.open(CACHE).then(c => c.put(request, toCache));
      }
      return resp;
    }).catch(() => null);
    // Return cached immediately if we have it; otherwise wait for network.
    return cached || networkFetch;
  });
}

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never intercept Supabase, external APIs, or non-GET requests
  if (url.includes('supabase.co') || url.includes('googleapis') || e.request.method !== 'GET') return;

  // 1. Icons — cache-first (they never change)
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

  // 2. HTML page loads — network-first with 3s timeout, fall back to cache
  const isNavigation = e.request.mode === 'navigate'
    || (e.request.destination === 'document')
    || (e.request.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    e.respondWith(networkFirstWithTimeout(e.request, 3000));
    return;
  }

  // 3. Everything else (CSS, JS, manifest, fonts) — stale-while-revalidate
  e.respondWith(staleWhileRevalidate(e.request));
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
