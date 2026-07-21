// Maxwell DealFlow CRM — Core App
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentAgent = null;
let currentTab = 'overview';

// ── PWA Install Prompt ────────────────────────────────────────────────────────
let _pwaInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaInstallPrompt = e;
  // Show install banner after a short delay (only if not already installed)
  if (!window.matchMedia('(display-mode: standalone)').matches) {
    setTimeout(() => _showPWABanner(), 3000);
  }
});

window.addEventListener('appinstalled', () => {
  _pwaInstallPrompt = null;
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.remove();
  console.log('DealFlow PWA installed ✅');
});

function _showPWABanner() {
  if (document.getElementById('pwa-install-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = [
    'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
    'background:#1a56db', 'color:#fff', 'padding:12px 20px', 'border-radius:12px',
    'display:flex', 'align-items:center', 'gap:12px', 'box-shadow:0 4px 24px rgba(0,0,0,0.4)',
    'z-index:99999', 'font-family:inherit', 'font-size:14px', 'font-weight:600',
    'white-space:nowrap', 'cursor:pointer', 'transition:opacity .3s'
  ].join(';');
  banner.innerHTML = `
    <span style="font-size:20px">📲</span>
    <span>Install DealFlow on your device</span>
    <button onclick="App.installPWA()" style="background:#fff;color:#1a56db;border:none;padding:6px 14px;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">Install</button>
    <button onclick="document.getElementById('pwa-install-banner').remove()" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:13px;">✕</button>
  `;
  document.body.appendChild(banner);
}

const App = {

  async installPWA() {
    if (!_pwaInstallPrompt) return;
    _pwaInstallPrompt.prompt();
    const { outcome } = await _pwaInstallPrompt.userChoice;
    if (outcome === 'accepted') _pwaInstallPrompt = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.remove();
  },

  async init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      // When a new SW takes control (after a deploy), reload ONCE so the page
      // runs the fresh JS instead of the old cached copy. Guarded against loops.
      // This ends the "hard-refresh twice after every update" problem.
      let _swReloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_swReloaded) return;
        _swReloaded = true;
        location.reload();
      });
      navigator.serviceWorker.register('sw.js').catch(() => {});
      // Listen for SW messages (e.g. notification tap → switch tab)
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'SWITCH_TAB') App.switchTab(e.data.tab);
      });
    }
    // Apply saved theme or auto day/night
    App.applyAutoTheme();
    // Check existing session
    const { data: { session } } = await db.auth.getSession();
    if (session) {
      await App.onSignedIn(session.user);
    }
    // Listen for auth changes
    db.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) await App.onSignedIn(session.user);
      if (event === 'SIGNED_OUT') { App._authUser = null; App.showAuth(); }
    });
  },

  // ── Day / Night Theme ────────────────────────────────────────────────────
  applyAutoTheme() {
    const saved = localStorage.getItem('df-theme');
    if (saved === 'light') {
      document.body.classList.add('theme-light');
      App._updateThemeBtn(true);
    } else if (saved === 'dark') {
      document.body.classList.remove('theme-light');
      App._updateThemeBtn(false);
    } else {
      // Auto: light 7am–7pm, dark otherwise
      const h = new Date().getHours();
      const isDay = h >= 7 && h < 19;
      document.body.classList.toggle('theme-light', isDay);
      App._updateThemeBtn(isDay);
    }
  },

  cycleTheme() {
    const saved = localStorage.getItem('df-theme');
    const isLight = document.body.classList.contains('theme-light');
    if (!saved) {
      // Auto → force to opposite of current
      const newTheme = isLight ? 'dark' : 'light';
      localStorage.setItem('df-theme', newTheme);
      document.body.classList.toggle('theme-light', newTheme === 'light');
      App._updateThemeBtn(newTheme === 'light');
    } else if (saved === 'light') {
      localStorage.setItem('df-theme', 'dark');
      document.body.classList.remove('theme-light');
      App._updateThemeBtn(false);
    } else if (saved === 'dark') {
      // Back to auto
      localStorage.removeItem('df-theme');
      App.applyAutoTheme();
    }
  },

  _updateThemeBtn(isLight) {
    const btn = document.getElementById('tb-theme-btn');
    if (!btn) return;
    const saved = localStorage.getItem('df-theme');
    if (!saved) {
      btn.textContent = '🌗';
      btn.title = 'Theme: Auto (click to toggle)';
    } else if (isLight) {
      btn.textContent = '☀️';
      btn.title = 'Theme: Light (click for Dark)';
    } else {
      btn.textContent = '🌙';
      btn.title = 'Theme: Dark (click for Auto)';
    }
  },

  async signIn() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = 'Please enter email and password.'; return; }

    // Brute-force protection is enforced server-side by Supabase Auth's
    // built-in rate limiter (30 sign-in attempts / hour / IP). A previous
    // client-side localStorage counter was removed in PR #15 — it locked
    // Maxwell out on his own typos and offered no real protection to an
    // attacker, who would just clear localStorage or open a fresh tab.

    // Clear any leftover lockout keys from older app versions
    try {
      localStorage.removeItem('mdf-login-lock');
      localStorage.removeItem('mdf-login-attempts');
    } catch (_) {}

    const btn = document.querySelector('.lock-btn') || document.querySelector('.auth-btn');
    if (btn) { btn.textContent = 'Unlocking...'; btn.disabled = true; }
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (btn) { btn.textContent = 'Unlock'; btn.disabled = false; }

    if (error) {
      errEl.textContent = error.message;
      return;
    }
  },

  showSignUp() {
    const errEl = document.getElementById('auth-error');
    errEl.textContent = 'Contact Maxwell to get your account created.';
    errEl.style.color = '#63b3ed';
  },

  // Cached auth user. db.auth.getUser() hits the Supabase Auth server on EVERY
  // call (a full network round-trip); getSession() reads the locally-stored
  // session with no network. We cache the resolved user at sign-in so the many
  // per-action callers (Notify.queue, badge updates, pipeline/build confirms)
  // don't each pay a round trip — the #1 reason "everything felt slow".
  _authUser: null,
  async getAuthUser() {
    if (App._authUser) return App._authUser;
    const { data: { session } } = await db.auth.getSession();
    App._authUser = session?.user || null;
    return App._authUser;
  },

  async onSignedIn(user) {
    App._authUser = user;   // prime the cache — same auth uid every getAuthUser() returns
    // Load agent profile
    // Try by auth user ID first, then fall back to email match
    let { data: agent } = await db.from('agents').select('*').eq('id', user.id).single();
    if (!agent) {
      const { data: agentByEmail } = await db.from('agents').select('*').eq('email', user.email).single();
      agent = agentByEmail;
    }
    currentAgent = agent || { name: user.email, email: user.email, id: user.id };
    // Merge any locally-cached profile edits (in case Supabase write was blocked)
    try {
      const cached = JSON.parse(localStorage.getItem('mdf-profile-cache') || 'null');
      if (cached) Object.assign(currentAgent, cached);
    } catch(e) {}
    // Only the FOUNDER (agents row with created_by IS NULL) may manage agents.
    // Hide the Agent Portal from invited agents (the invite-agent edge function
    // also rejects non-founders server-side).
    try {
      currentAgent.isFounder = (agent && (agent.created_by === null || agent.created_by === undefined));
      const apNav = document.querySelector('.nav-item[data-tab="agentportal"]');
      if (apNav) apNav.style.display = currentAgent.isFounder ? '' : 'none';
    } catch (_) {}
    // Update topbar with full agent info
    const _nmParts = (currentAgent.full_name || currentAgent.name || 'M').trim().split(/\s+/).filter(Boolean);
    const initials = (_nmParts[0][0] + (_nmParts.length > 1 ? _nmParts[_nmParts.length - 1][0] : '')).toUpperCase();
    const initialsEl = document.getElementById('topbar-initials');
    if (initialsEl) initialsEl.textContent = initials;
    // Sidebar profile card sync
    const sbInitials = document.getElementById('sb-profile-initials');
    if (sbInitials) sbInitials.textContent = initials;
    const sbName = document.getElementById('sb-profile-name');
    if (sbName) sbName.textContent = (currentAgent.full_name || currentAgent.name || 'Maxwell').split(' ').slice(0,2).join(' ');
    const sbRole = document.getElementById('sb-profile-role');
    if (sbRole) sbRole.textContent = currentAgent.brokerage || 'eXp Realty';
    // Null-safe for removed topbar text elements
    const tnEl = document.getElementById('topbar-name');
    if (tnEl) tnEl.textContent = currentAgent.full_name || currentAgent.name || 'Maxwell';
    const tbEl = document.getElementById('topbar-brokerage');
    if (tbEl) tbEl.textContent = currentAgent.brokerage || 'eXp Realty';
    // Show app
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    // Apply saved photo IMMEDIATELY after app becomes visible (no delay)
    if (window.Settings) Settings.loadSavedPhoto();
    // Load critical first-paint data in parallel.
    // loadOverview is awaited so the dashboard tiles render before we hand off.
    await App.loadOverview();
    Clients.load();
    Viewings.load();
    Offers.load();
    Pipeline.load();
    App.restoreGroupStates();

    // ── Background startup jobs (PR #17) ─────────────────────────────────
    // Previously a cascade of setTimeout calls with magic delays (400 ms,
    // 1500, 2000, 2500, 3000, 4000, 4500, 5000, 6000, 7000). They raced
    // the network and the agent saw an empty UI for up to 7 s while jobs
    // trickled in. Now we drain a single queue via requestIdleCallback,
    // so jobs start ~tens of ms after first paint, in declared order,
    // without blocking the main thread.
    App._scheduleStartupJobs([
      () => window.SystemTools && SystemTools.loadSavedTheme(),
      () => typeof Notify !== 'undefined' && Notify.updateBadge(),
      () => typeof Responses !== 'undefined' && Responses.updateBadge(),
      () => typeof Inbox !== 'undefined' && Inbox.updateBadge(),
      () => App.loadNotifications(),
      () => typeof Notify !== 'undefined' && Notify.checkConditionDeadlines(),
      () => typeof Notify !== 'undefined' && Notify.checkCompletedViewings(),
      () => typeof PendingOffers !== 'undefined' && PendingOffers.load(),
      () => App.requestNotifyPermission(),
      () => App.checkNewIntakes(),
      () => App.checkNewRequests(),
      () => App.subscribeToRequests(),
      () => typeof Offers !== 'undefined' && Offers.checkFollowUps(),
      () => typeof Notify !== 'undefined' && Notify.checkInactiveClients(7),
    ]);

    // ── Periodic background polls ────────────────────────────────────────
    // Intervals are kept separate from one-shot startup jobs above; they
    // run forever once started. Page reloads reset them naturally.
    setInterval(() => { if (typeof Notify !== 'undefined') Notify.checkCompletedViewings(); }, 5 * 60 * 1000);
    setInterval(() => { if (typeof PendingOffers !== 'undefined') PendingOffers.load(); }, 5 * 60 * 1000);
    setInterval(() => { if (typeof Inbox !== 'undefined') Inbox.syncGmail(true); }, 5 * 60 * 1000);
    setInterval(() => { if (typeof Offers !== 'undefined') Offers.checkFollowUps(); }, 5 * 60 * 1000);
    setInterval(() => { if (typeof Notify !== 'undefined') Notify.checkInactiveClients(7); }, 6 * 60 * 60 * 1000);
  },

  // Drain a queue of zero-arg job functions one at a time, yielding to the
  // main thread between each so first paint and user input stay smooth.
  // Uses requestIdleCallback where available (Chrome, Edge, Firefox) and
  // a setTimeout(0) fallback on Safari. Each job is wrapped in try/catch
  // so a thrown error doesn't stop subsequent jobs.
  _scheduleStartupJobs(jobs) {
    const ric = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
    let i = 0;
    const next = () => {
      if (i >= jobs.length) return;
      const job = jobs[i++];
      ric(() => {
        try { job(); } catch (err) { App.logError && App.logError(err, '_scheduleStartupJobs'); }
        next();
      }, { timeout: 2000 });
    };
    next();
  },

  // ── BROWSER PUSH NOTIFICATIONS ────────────────────────────────────────────
  async requestNotifyPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        App.pushNotify('Notifications On', 'You will be alerted when approvals need your attention.', 'approvals');
      }
    }
    // Always try to subscribe for Web Push (works even if permission was already granted)
    if (Notification.permission === 'granted') {
      await App.subscribePush();
    }
  },

  // Subscribe this device to Web Push and save the subscription to Supabase
  async subscribePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      const reg = await navigator.serviceWorker.ready;
      // Check if already subscribed
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        // Convert VAPID public key from base64url to Uint8Array
        const keyStr = (typeof VAPID_PUBLIC_KEY !== 'undefined') ? VAPID_PUBLIC_KEY : '';
        if (!keyStr) return;
        const pad = keyStr.length % 4 === 0 ? '' : '='.repeat(4 - keyStr.length % 4);
        const raw = atob((keyStr + pad).replace(/-/g, '+').replace(/_/g, '/'));
        const keyBytes = Uint8Array.from(raw, c => c.charCodeAt(0));
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes
        });
      }
      // Save subscription to Supabase so the edge function can reach this device
      const user = await App.getAuthUser();
      if (!user) return;
      const subJson = sub.toJSON();
      await db.from('push_subscriptions').upsert({
        agent_id: user.id,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys?.p256dh,
        auth: subJson.keys?.auth,
        updated_at: new Date().toISOString()
      }, { onConflict: 'endpoint' });
      console.log('[Push] Subscription saved for this device');
    } catch (err) {
      console.warn('[Push] Subscribe failed:', err.message);
    }
  },

  // Send a real Web Push to all of Maxwell's subscribed devices via edge function
  async sendWebPush(title, body, tab = 'approvals') {
    try {
      const user = await App.getAuthUser();
      if (!user) return;
      const { data: subs } = await db.from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('agent_id', user.id);
      if (!subs?.length) return;
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch(typeof PUSH_FUNCTION_URL !== 'undefined' ? PUSH_FUNCTION_URL : '', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : ''
        },
        body: JSON.stringify({
          title, body, tab,
          subscriptions: subs.map(s => ({
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth }
          }))
        })
      });
      const json = await res.json().catch(() => ({}));
      console.log('[Push] Edge fn →', res.status, JSON.stringify(json));

      // Auto-prune expired subscriptions (status 410 = "subscription has unsubscribed or expired")
      // This keeps the push_subscriptions table clean so future sends only target live devices.
      if (Array.isArray(json.detail)) {
        const expiredEndpoints = json.detail
          .map((d, i) => (d?.status === 410 || d?.status === 404) ? subs[i]?.endpoint : null)
          .filter(Boolean);
        if (expiredEndpoints.length) {
          console.log(`[Push] Pruning ${expiredEndpoints.length} expired subscription(s)`);
          await db.from('push_subscriptions')
            .delete()
            .in('endpoint', expiredEndpoints);
        }
      }
    } catch (err) {
      console.warn('[Push] sendWebPush failed:', err.message);
    }
  },

  async checkNewIntakes() {
    // Silently check Supabase for unreviewed intake submissions on every login
    try {
      const { data, error } = await db.from('client_intake')
        .select('id, full_name, submitted_at')
        .eq('status', 'New')
        .order('submitted_at', { ascending: false });
      if (error || !data?.length) return;
      const count = data.length;
      const latest = data[0];
      // Push notify agent immediately
      App.pushNotify(
        `📋 ${count} New Client Intake${count > 1 ? 's' : ''}`,
        `${latest.full_name || 'A client'} submitted the form — tap to review`,
        'formresponses'
      );
      // Also show a toast in the app
      App.toast(`📋 ${count} new intake form${count > 1 ? 's' : ''} waiting — check Form Responses`, 'var(--accent2)');
      // Update the Form Responses tab badge if it exists
      const badge = document.getElementById('formresponses-badge');
      if (badge) { badge.textContent = count; badge.style.display = 'inline'; }
    } catch(e) {}
  },

  async checkNewRequests() {
    try {
      if (!currentAgent?.id) return;
      const { data, error } = await db.from('pending_offers')
        .select('id, client_name, property_address, created_at')
        .eq('agent_id', currentAgent.id)
        .eq('status', 'Pending')
        .order('created_at', { ascending: false });
      if (error || !data?.length) return;
      const count = data.length;
      const latest = data[0];
      App.pushNotify(
        `📬 ${count} New Offer Request${count > 1 ? 's' : ''}`,
        `${latest.client_name || 'A client'} is interested in ${latest.property_address || 'a property'} — tap to review`,
        'offers'
      );
      App.toast(`📬 ${count} new offer request${count > 1 ? 's' : ''} waiting — check Requests tab`, 'var(--accent2)');
      if (typeof PendingRequests !== 'undefined') PendingRequests._updateBadge(count);
    } catch(e) {}
  },

  subscribeToRequests() {
    try {
      if (!currentAgent?.id) return;
      db.channel('pending-offers-' + currentAgent.id)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'pending_offers',
          filter: `agent_id=eq.${currentAgent.id}`
        }, (payload) => {
          const r = payload.new;
          App.pushNotify(
            'New Offer Request!',
            `${r.client_name || 'A client'} wants to make an offer on ${r.property_address || 'a property'}`,
            'offers'
          );
          App.toast('New offer request just came in — check Requests tab', 'var(--accent2)');
          if (typeof PendingRequests !== 'undefined') PendingRequests.loadBadge();
        })
        .subscribe();
    } catch(e) {}
  },

  pushNotify(title, body, tab = 'approvals') {
    // 1. In-app browser notification (works when app is open)
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: tab,
        renotify: true,
        data: { tab }
      });
      n.onclick = () => {
        window.focus();
        App.switchTab(tab);
        n.close();
      };
    }
    // 2. Real Web Push to ALL devices — fires even when app is closed / phone is locked
    App.sendWebPush(title, body, tab);
  },

  showAuth() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  },

  async signOut() {
    await db.auth.signOut();
    App.showAuth();
  },

  confirmSignOut() {
    if (confirm('Log out of Maxwell DealFlow?')) App.signOut();
  },

  toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (!sb) return;
    const open = sb.classList.toggle('open');
    if (ov) ov.style.display = open ? 'block' : 'none';
  },

  closeSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.style.display = 'none';
  },

  // ── Profile Dropdown (sidebar footer) ──
  toggleProfileMenu() {
    const menu = document.getElementById('sb-profile-menu');
    const card = document.getElementById('sb-profile-card');
    if (!menu) return;
    const isOpen = menu.style.display === 'block';
    menu.style.display = isOpen ? 'none' : 'block';
    if (card) card.classList.toggle('open', !isOpen);
    // Close when clicking outside
    if (!isOpen) {
      setTimeout(() => {
        document.addEventListener('click', App._closeProfileOnOutside, { once: true });
      }, 10);
    }
  },

  _closeProfileOnOutside(e) {
    const menu = document.getElementById('sb-profile-menu');
    const card = document.getElementById('sb-profile-card');
    if (menu && !menu.contains(e.target) && card && !card.contains(e.target)) {
      App.closeProfileMenu();
    }
  },

  closeProfileMenu() {
    const menu = document.getElementById('sb-profile-menu');
    const card = document.getElementById('sb-profile-card');
    if (menu) menu.style.display = 'none';
    if (card) card.classList.remove('open');
  },

  // ── Notification Panel ──
  toggleNotifPanel(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const isOpen = panel.style.display === 'flex';
    panel.style.display = isOpen ? 'none' : 'flex';
    panel.style.flexDirection = 'column';
    if (!isOpen) {
      App.loadNotifications();
      setTimeout(() => {
        document.addEventListener('click', App._closeNotifOnOutside, { once: true });
      }, 50);
    }
  },

  async loadNotifications() {
    const el = document.getElementById('notif-list');
    if (!el || !currentAgent?.id) return;
    el.innerHTML = '<div class="notif-loading">Loading…</div>';
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
    const weekAgo = new Date(now - 7 * 86400000).toISOString();
    const [
      { data: todayV },
      { data: tomorrowV },
      { data: pending },
      { data: recentClients },
      { data: needFeedback },
      referralRes
    ] = await Promise.all([
      db.from('viewings').select('*, clients(full_name)').eq('viewing_date', today).neq('viewing_status', 'Completed'),
      db.from('viewings').select('*, clients(full_name)').eq('viewing_date', tomorrow).neq('viewing_status', 'Completed'),
      db.from('approval_queue').select('*').eq('agent_id', currentAgent.id).eq('status', 'Pending'),
      db.from('clients').select('id,full_name,stage,updated_at').eq('agent_id', currentAgent.id)
        .gte('created_at', weekAgo).order('created_at', { ascending: false }).limit(3),
      // Completed viewings still waiting on Maxwell's "how did it go?" feedback.
      // These are the "missed" prompts — they persist in the bell until acted on.
      db.from('viewings').select('*, clients(full_name)').eq('viewing_status', 'Completed')
        .is('client_feedback', null).order('viewing_date', { ascending: false }).limit(10),
      // Clients who tapped "Yes, introduce me" on the welcome email's soft broker
      // offer. Best-effort (table may not be migrated yet).
      db.from('broker_referral_requests').select('id,client_id,client_name,client_email,client_phone,status,source')
        .eq('agent_id', currentAgent.id).in('status', ['requested', 'pending'])
        .order('created_at', { ascending: false }).limit(10)
        .then(r => r, () => ({ data: [] }))
    ]);
    const referrals = referralRes?.data || [];
    const items = [];
    // Broker-intro requests sit at the very top — the client raised their hand,
    // so this is hot. Clicking sends the intro (through Approvals) and clears it.
    (referrals || []).forEach(r => {
      const fromWeb = r.source === 'website' || r.status === 'pending';
      items.push({ icon: '🤝', bg: 'rgba(204,120,92,0.18)', color: '#CC785C',
        title: fromWeb ? 'Client wants a mortgage broker' : 'Broker intro requested',
        text: fromWeb ? `${r.client_name || 'A client'} asked to speak to a mortgage broker` : `${r.client_name || 'A client'} wants an introduction to your broker`,
        tag: 'Action', action: `App.closeNotifPanel();App.sendBrokerReferral('${r.id}')` });
    });
    // Missed "how did the viewing go?" prompts come first — they're the most
    // actionable and the ones Maxwell asked to never lose. Clicking opens the
    // feedback modal right from the bell.
    (needFeedback || []).forEach(v => {
      const name = (v.clients && v.clients.full_name) || v.client_name || 'Client';
      const addr = v.property_address || v.address || 'Property';
      items.push({ icon: '📝', bg: 'rgba(245,158,11,0.18)', color: '#f59e0b', title: 'Viewing — needs your feedback', text: `${name} — ${addr}`, tag: 'Action', action: `App.closeNotifPanel();Viewings.agentFeedbackModal('${v.id}')` });
    });
    (todayV || []).forEach(v => {
      const name = (v.clients && v.clients.full_name) || 'Client';
      const addr = v.property_address || v.address || 'Property';
      const time = v.viewing_time ? v.viewing_time.slice(0, 5) : '';
      items.push({ icon: '🏠', bg: 'rgba(91,91,214,0.15)', color: '#7c7cff', title: `Viewing Today${time ? ' at ' + time : ''}`, text: `${name} — ${addr}`, tag: 'Today', action: `App.closeNotifPanel();App.switchTab('viewings')` });
    });
    (tomorrowV || []).forEach(v => {
      const name = (v.clients && v.clients.full_name) || 'Client';
      const addr = v.property_address || v.address || 'Property';
      items.push({ icon: '📅', bg: 'rgba(6,182,212,0.15)', color: '#06b6d4', title: 'Viewing Tomorrow', text: `${name} — ${addr}`, tag: 'Tomorrow', action: `App.closeNotifPanel();App.switchTab('viewings')` });
    });
    (pending || []).forEach(a => {
      items.push({ icon: '✅', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', title: 'Pending Approval', text: a.subject || a.type || 'Needs your review', tag: 'Pending', action: `App.closeNotifPanel();App.switchTab('approvals')` });
    });
    (recentClients || []).forEach(c => {
      items.push({ icon: '👤', bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6', title: 'New Client Added', text: c.full_name + (c.stage ? ' — ' + c.stage : ''), tag: 'New', action: `App.closeNotifPanel();App.switchTab('clients')` });
    });
    // Update bell badge
    const badge = document.getElementById('tb-bell-count');
    if (badge) {
      if (items.length > 0) {
        badge.style.display = 'flex';
        badge.textContent = items.length > 9 ? '9+' : String(items.length);
      } else {
        badge.style.display = 'none';
      }
    }
    if (!items.length) {
      el.innerHTML = '<div class="notif-empty">🎉 All caught up!<br><span style="font-size:11px;color:var(--text3);">No pending notifications</span></div>';
      return;
    }
    el.innerHTML = items.map(item => `
      <div class="notif-item"${item.action ? ` onclick="${item.action}" style="cursor:pointer;"` : ''}>
        <div class="notif-icon" style="background:${item.bg};color:${item.color};">${item.icon}</div>
        <div class="notif-body">
          <div class="notif-item-title">${item.title}</div>
          <div class="notif-item-text">${App.esc(item.text)}</div>
        </div>
        <div class="notif-time">${item.tag}</div>
      </div>`).join('');
  },

  _closeNotifOnOutside(e) {
    const panel = document.getElementById('notif-panel');
    const bell = document.getElementById('tb-bell-btn');
    if (panel && !panel.contains(e.target) && bell && !bell.contains(e.target)) {
      panel.style.display = 'none';
    }
  },

  closeNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (panel) panel.style.display = 'none';
  },

  // A client tapped "Yes, introduce me" in their welcome email. Fire the warm
  // broker intro (queued to Approvals for review) and mark the request sent.
  async sendBrokerReferral(id) {
    if (!id) return;
    const { data: req } = await db.from('broker_referral_requests').select('*').eq('id', id).single();
    if (!req) { App.toast('Referral request not found', 'var(--red)'); return; }
    // Already actioned (by Maxwell earlier, or by the broker on his lane)? Don't re-send.
    if (req.status === 'approved' || req.status === 'sent') {
      App.toast(req.approved_by === 'broker' ? '✅ Already handled by the broker' : '✅ Already sent', 'var(--yellow)');
      App.loadNotifications(); return;
    }
    // Broker must be configured before we claim the row (avoid stranding it 'sent').
    if (!(currentAgent && currentAgent.broker_email)) {
      App.toast('⚠️ Set your broker in Settings → Mortgage Broker Referral first', 'var(--yellow)'); return;
    }
    const name = req.client_name || 'this client';
    if (!confirm(`Send your mortgage-broker intro for ${name}?\n\nIt'll be queued in Approvals for you to review and send.`)) return;
    // CLAIM the referral first — compare-and-swap on the pre-approval statuses so a
    // simultaneous broker approval on the lane can't produce a second intro email.
    const { data: won } = await db.from('broker_referral_requests')
      .update({ status: 'sent', approved_by: 'maxwell', approved_at: new Date().toISOString() })
      .eq('id', id).in('status', ['pending', 'requested', 'offered']).select('id');
    if (!won || !won.length) { App.toast('✅ Already handled', 'var(--yellow)'); App.loadNotifications(); return; }
    // Won the claim — now queue the intro (broker primary, client + Maxwell CC).
    if (typeof Notify === 'undefined' || !Notify.onBrokerReferral) { App.toast('Notify unavailable', 'var(--red)'); return; }
    const client = { id: req.client_id, full_name: req.client_name, email: req.client_email };
    await Notify.onBrokerReferral(client, {});
    App.toast('🤝 Broker intro queued in Approvals', 'var(--green)');
    App.loadNotifications();
    if (App.switchTab) App.switchTab('approvals');
  },

  // ── DELETE PASSWORD GATE ────────────────────────────────────────────────
  // SHA-256 a string to a hex digest (used for the delete PIN — we never store
  // the raw PIN, only its hash).
  async _sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // Gate a destructive action. Returns a Promise<boolean>. If a delete PIN is
  // set on the agent, prompts for it and only resolves true on a correct match.
  // If no PIN is set, falls back to a plain confirm (with a hint to set one).
  // Honest scope: this is a UI deterrent against casual deletion by someone on
  // the logged-in session — not server-enforced security.
  requireDeletePin(opts = {}) {
    const title   = opts.title   || 'Confirm Delete';
    const message = opts.message || 'This cannot be undone.';
    const hash = currentAgent?.delete_pin_hash || null;
    return new Promise((resolve) => {
      App._pinResolve = resolve;
      if (!hash) {
        App.openModal(`
          <div class="modal-title" style="color:var(--red);">🗑 ${App.esc(title)}</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">${App.esc(message)}</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:14px;background:var(--bg);padding:8px 10px;border-radius:6px;">🔒 Tip: set a <strong>Delete Password</strong> in Settings to require a PIN before anyone can delete.</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button class="btn btn-red" onclick="App._resolveDeletePin(true)">🗑 Delete</button>
            <button class="btn btn-outline" onclick="App._resolveDeletePin(false)">Cancel</button>
          </div>`);
        return;
      }
      App.openModal(`
        <div class="modal-title" style="color:var(--red);">🔒 ${App.esc(title)}</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">${App.esc(message)}</div>
        <div class="form-group">
          <label class="form-label">Enter your delete password</label>
          <input class="form-input" id="del-pin-input" type="password" autocomplete="off"
                 onkeydown="if(event.key==='Enter'){event.preventDefault();App._checkDeletePin();}">
        </div>
        <div id="del-pin-msg" style="font-size:12px;color:var(--red);min-height:16px;margin-bottom:8px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button class="btn btn-red" onclick="App._checkDeletePin()">🗑 Confirm Delete</button>
          <button class="btn btn-outline" onclick="App._resolveDeletePin(false)">Cancel</button>
        </div>`);
      setTimeout(() => document.getElementById('del-pin-input')?.focus(), 50);
    });
  },

  async _checkDeletePin() {
    const val = document.getElementById('del-pin-input')?.value || '';
    const msg = document.getElementById('del-pin-msg');
    if (!val) { if (msg) msg.textContent = 'Enter your password.'; return; }
    const h = await App._sha256(val);
    if (h === (currentAgent?.delete_pin_hash || '')) {
      App._resolveDeletePin(true);
    } else if (msg) {
      msg.textContent = '❌ Incorrect password — not deleted.';
      const inp = document.getElementById('del-pin-input'); if (inp) { inp.value = ''; inp.focus(); }
    }
  },

  _resolveDeletePin(ok) {
    const r = App._pinResolve; App._pinResolve = null;
    App.closeModal();
    if (typeof r === 'function') r(!!ok);
  },

  // ── Mobile FAB (Floating Action Button) ──
  toggleFab() {
    const fab = document.getElementById('mobile-fab');
    const menu = document.getElementById('mobile-fab-menu');
    const overlay = document.getElementById('mobile-fab-overlay');
    if (!fab) return;
    const isOpen = fab.classList.toggle('open');
    if (menu) menu.classList.toggle('open', isOpen);
    if (overlay) overlay.classList.toggle('open', isOpen);
  },
  closeFab() {
    const fab = document.getElementById('mobile-fab');
    const menu = document.getElementById('mobile-fab-menu');
    const overlay = document.getElementById('mobile-fab-overlay');
    if (fab) fab.classList.remove('open');
    if (menu) menu.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  },

  toggleGroup(name) {
    const grp = document.getElementById(`grp-${name}`);
    if (!grp) return;
    const lbl = grp.querySelector('.sb-collapsible');
    const items = grp.querySelector('.sb-group-items');
    const isOpen = lbl.classList.contains('open');
    if (isOpen) {
      lbl.classList.remove('open');
      items.style.display = 'none';
    } else {
      lbl.classList.add('open');
      items.style.display = 'block';
    }
    try {
      const s = JSON.parse(localStorage.getItem('mdf-sb-groups') || '{}');
      s[name] = !isOpen;
      localStorage.setItem('mdf-sb-groups', JSON.stringify(s));
    } catch(e) {}
  },

  restoreGroupStates() {
    try {
      const s = JSON.parse(localStorage.getItem('mdf-sb-groups') || '{}');
      ['clients','deals','finance','comms','admin'].forEach(name => {
        const grp = document.getElementById(`grp-${name}`);
        if (!grp) return;
        const lbl = grp.querySelector('.sb-collapsible');
        const items = grp.querySelector('.sb-group-items');
        const defaultOpen = (name !== 'admin');
        const open = s[name] !== undefined ? s[name] : defaultOpen;
        if (open) { lbl.classList.add('open'); items.style.display = 'block'; }
        else { lbl.classList.remove('open'); items.style.display = 'none'; }
      });
    } catch(e) {}
  },

  switchTab(tab) {
    currentTab = tab;
    App.closeSidebar(); // close on mobile when tab selected
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`screen-${tab}`);
    if (screen) screen.classList.add('active');
    document.querySelectorAll('.nav-item, .tab-item').forEach(n => {
      n.classList.toggle('active', n.dataset.tab === tab);
    });
    // Sync mobile bottom nav active state
    document.querySelectorAll('.mob-nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.tab === tab);
    });
    document.getElementById('main-content').scrollTop = 0;
    // Lazy load modules
    if (tab === 'approvals') Approvals.load();
    if (tab === 'activity') ActivityLog.load();
    if (tab === 'commissions') Commission.load();
    if (tab === 'reports') Reports.load();
    if (tab === 'newbuilds') NewBuilds.load();
    if (tab === 'email') EmailSend.init();
    if (tab === 'analytics') Analytics.load();
    if (tab === 'portaltraffic') PortalTraffic.load();
    if (tab === 'tracker') Tracker.load();
    if (tab === 'checklist') Checklist.load();
    if (tab === 'inbox') { /* Inbox loads on button click — instant tab open */ }
    if (tab === 'responses') Responses.load();
    if (tab === 'formresponses') FormResponses.load();
    if (tab === 'agentportal') AgentPortal.load();
    if (tab === 'cleanup') Cleanup.init();
    if (tab === 'system') SystemTools.load();
    if (tab === 'settings') Settings.load();
    if (tab === 'calendar') Calendar.load();
    if (tab === 'mileage') Mileage.load();
    if (tab === 'broadcast') Broadcast.load();
    if (tab === 'reviews') Reviews.load();
    if (tab === 'marketing') Marketing.loadFolder();
    if (tab === 'briefing') Briefing.load();
    if (tab === 'pipeline') Pipeline.load();  // reload on visit — actions elsewhere no longer eagerly reload it
    if (tab === 'listings') Listings.load();
    if (tab === 'pipeline-archive') Pipeline.loadArchive();
  },

  toggleAI() {
    App.switchTab('ai');
  },

  async loadOverview() {
    if (!currentAgent?.id) return;
    const agentId = currentAgent.id;
    const now = new Date();
    const weekAgo = new Date(now - 7*24*60*60*1000).toISOString();

    // Load all stats in parallel
    const [
      { count: activeCount },
      { count: totalCount },
      { count: viewingsCount },
      { count: pipelineCount },
      { count: closedCount },
      { count: newCount },
      { data: allClients },
      { data: recent },
      { data: deals },
      { data: pendingOffers }
    ] = await Promise.all([
      db.from('clients').select('*',{count:'exact',head:true}).eq('agent_id',agentId).neq('status','Archived'),
      db.from('clients').select('*',{count:'exact',head:true}).eq('agent_id',agentId),
      db.from('viewings').select('*',{count:'exact',head:true}).eq('viewing_status','Scheduled'),
      db.from('pipeline').select('*',{count:'exact',head:true}).eq('agent_id',agentId).eq('status','Active'),
      db.from('pipeline').select('*',{count:'exact',head:true}).eq('agent_id',agentId).eq('stage','Closed'),
      db.from('clients').select('*',{count:'exact',head:true}).eq('agent_id',agentId).gte('created_at',weekAgo),
      db.from('clients').select('id,full_name,stage,updated_at').eq('agent_id',agentId).neq('status','Archived'),
      db.from('activity_log').select('*').eq('agent_id',agentId).order('created_at',{ascending:false}).limit(6),
      db.from('pipeline').select('*').eq('agent_id',agentId).not('stage','in','("Closed","Fell Through")').limit(3),
      db.from('pending_offers').select('id, client_name, property_address, offer_amount, created_at').eq('agent_id',agentId).eq('status','Pending').order('created_at',{ascending:false})
    ]);

    // Hero greeting (Phase 2.B.2)
    try {
      const heroDateEl = document.getElementById('hero-date');
      const heroGreetingEl = document.getElementById('hero-greeting');
      const heroSubEl = document.getElementById('hero-sub');
      if (heroDateEl) {
        heroDateEl.textContent = now.toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});
      }
      if (heroGreetingEl) {
        const h = now.getHours();
        const part = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
        const firstName = ((typeof currentAgent !== 'undefined' && currentAgent && (currentAgent.name || currentAgent.full_name)) || window.App?.currentUser?.user_metadata?.full_name || 'there').split(' ')[0];
        heroGreetingEl.textContent = `${part}, ${firstName}`;
      }
      if (heroSubEl) {
        const active = activeCount || 0;
        const v = viewingsCount || 0;
        heroSubEl.textContent = active === 0 && v === 0
          ? "Here's your day at a glance."
          : `${active} active client${active===1?'':'s'} · ${v} viewing${v===1?'':'s'} booked`;
      }
    } catch(e) { /* hero is cosmetic — never block stats */ }

    // Update stats
    document.getElementById('stat-active').textContent = activeCount || 0;
    document.getElementById('stat-total').textContent = totalCount || 0;
    document.getElementById('stat-viewings').textContent = viewingsCount || 0;
    document.getElementById('stat-pipeline').textContent = pipelineCount || 0;
    document.getElementById('stat-closed').textContent = closedCount || 0;

    // ── New Offer Requests banner — surfaces pending_offers on Overview ──
    // Highest urgency (clients waiting for you to formalize their offer).
    try {
      const newOfferAlert = document.getElementById('newoffer-alert');
      const newOfferBadge = document.getElementById('newoffer-count-badge');
      const newOfferSummary = document.getElementById('newoffer-summary');
      const offers = pendingOffers || [];
      if (newOfferAlert) {
        if (offers.length > 0) {
          newOfferAlert.style.display = 'block';
          if (newOfferBadge) newOfferBadge.textContent = offers.length;
          if (newOfferSummary) {
            const first = offers[0];
            newOfferSummary.textContent = offers.length === 1
              ? `${first.client_name || 'A client'} submitted an offer on ${first.property_address || 'a property'} — needs your review`
              : `${offers.length} clients have submitted offers — newest from ${offers[0].client_name || 'a client'}`;
          }
        } else {
          newOfferAlert.style.display = 'none';
        }
      }
    } catch(e) { /* banner is non-critical */ }

    // Needs follow-up: clients not updated in 7+ days
    const followups = (allClients || []).filter(c => {
      if (!c.updated_at) return true;
      return (now - new Date(c.updated_at)) > 7*24*60*60*1000;
    });
    document.getElementById('stat-followup').textContent = followups.length;

    // Show follow-up alert if any
    const alertEl = document.getElementById('followup-alert');
    if (followups.length > 0) {
      alertEl.style.display = 'block';
      document.getElementById('followup-count-badge').textContent = followups.length;
      document.getElementById('followup-list').innerHTML = followups.slice(0,3).map(c => `
        <div class="followup-item">
          <div class="client-avatar" style="width:32px;height:32px;font-size:12px;background:${App.avatarColor(c.full_name)};">${App.initials(c.full_name)}</div>
          <div>
            <div style="font-size:13px;font-weight:700;">${App.esc(c.full_name)}</div>
            <div style="font-size:11px;color:var(--text2);">${App.esc(c.stage || 'No stage')} · Last update ${App.timeAgo(c.updated_at)}</div>
          </div>
        </div>`).join('');
    } else {
      alertEl.style.display = 'none';
    }

    // 🔔 Pending notifications surface on Overview — same items as the bell.
    // Injected above "Recent activity" so Maxwell sees what needs his attention
    // without having to open the bell panel.
    try {
      await App.loadNotifications();   // refresh bell badge + items
      const actEl0 = document.getElementById('recent-activity');
      if (actEl0) {
        // Build a compact summary card from the same data sources as the bell
        const todayDate    = now.toISOString().slice(0, 10);
        const tomorrowDate = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
        const [
          { count: todayVCount    = 0 } = {},
          { count: tomorrowVCount = 0 } = {},
          { count: pendingApprovals = 0 } = {},
          { count: newIntakeCount = 0 } = {}
        ] = await Promise.all([
          db.from('viewings').select('*', { count: 'exact', head: true })
            .eq('agent_id', agentId).eq('viewing_date', todayDate).neq('viewing_status', 'Completed'),
          db.from('viewings').select('*', { count: 'exact', head: true })
            .eq('agent_id', agentId).eq('viewing_date', tomorrowDate).neq('viewing_status', 'Completed'),
          db.from('approval_queue').select('*', { count: 'exact', head: true })
            .eq('agent_id', agentId).eq('status', 'Pending'),
          db.from('client_intake').select('*', { count: 'exact', head: true })
            .eq('status', 'New')
        ]);

        const tiles = [];
        if (pendingApprovals > 0) tiles.push({ icon: '✅', label: `${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} pending`, color: '#f59e0b', tab: 'approvals' });
        if (todayVCount    > 0) tiles.push({ icon: '🏠', label: `${todayVCount} viewing${todayVCount === 1 ? '' : 's'} today`,           color: '#7c7cff', tab: 'viewings'  });
        if (tomorrowVCount > 0) tiles.push({ icon: '📅', label: `${tomorrowVCount} viewing${tomorrowVCount === 1 ? '' : 's'} tomorrow`,   color: '#06b6d4', tab: 'viewings'  });
        if (newIntakeCount > 0) tiles.push({ icon: '📋', label: `${newIntakeCount} new intake${newIntakeCount === 1 ? '' : 's'}`,         color: '#8b5cf6', tab: 'formresponses' });

        // Find or create the notifications card
        let notifCard = document.getElementById('overview-notifications-card');
        if (tiles.length > 0) {
          if (!notifCard) {
            notifCard = document.createElement('div');
            notifCard.id = 'overview-notifications-card';
            notifCard.className = 'card';
            notifCard.style.cssText = 'margin-bottom:14px;padding:14px;background:linear-gradient(135deg,rgba(91,91,214,0.08),rgba(124,124,255,0.05));border:1px solid var(--accent2);';
            // Insert before recent-activity's parent block
            actEl0.parentElement.insertBefore(notifCard, actEl0.parentElement.firstChild);
          }
          notifCard.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:11px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:0.06em;">🔔 Pending Now</div>
              <button class="btn btn-sm" style="padding:3px 10px;font-size:10px;" onclick="App.toggleNotifPanel()">View all →</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
              ${tiles.map(t => `
                <div onclick="App.switchTab('${t.tab}')" style="cursor:pointer;padding:10px;background:var(--card);border-radius:8px;border-left:3px solid ${t.color};display:flex;align-items:center;gap:8px;">
                  <div style="font-size:18px;">${t.icon}</div>
                  <div style="font-size:12px;color:var(--text1);font-weight:600;">${t.label}</div>
                </div>
              `).join('')}
            </div>`;
        } else if (notifCard) {
          // Nothing pending — remove the card so the Overview doesn't carry a stale empty box
          notifCard.remove();
        }
      }
    } catch (e) { /* notifications widget is non-critical */ }

    // Recent activity
    const actEl = document.getElementById('recent-activity');
    if (!recent?.length) {
      actEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No activity yet</div><div class="empty-sub">Start by adding a client</div></div>';
    } else {
      actEl.innerHTML = recent.map(a => `
        <div class="activity-row">
          <div class="activity-icon" style="background:var(--bg2);">${App.activityIcon(a.activity_type)}</div>
          <div>
            <div class="activity-title">${App.esc(a.description || a.activity_type)}</div>
            <div class="activity-meta">${App.esc(a.client_name || '')} · ${App.timeAgo(a.created_at)}</div>
          </div>
        </div>`).join('');
    }

    // Pipeline snapshot — uses the SAME milestone calculation as the Pipeline
    // tab (Pipeline.milestonesDone) so the percentage matches everywhere.
    const snapEl = document.getElementById('pipeline-snapshot');
    if (!deals?.length) {
      snapEl.innerHTML = '<div class="card text-muted" style="font-size:13px;text-align:center;padding:20px;">No active deals in pipeline.</div>';
    } else {
      snapEl.innerHTML = deals.map(d => {
        // Use the canonical Pipeline milestone calculation if it's available,
        // so Overview's progress bar can never disagree with the Pipeline tab.
        let pct = 0, doneInt = 0, total = 5;
        if (typeof Pipeline !== 'undefined' && Pipeline.milestonesDone) {
          const m = Pipeline.milestonesDone(d);
          pct = Math.round((m.done / m.total) * 100);
          doneInt = m.doneInt;
          total = m.total;
        }
        const isClosed = d.stage === 'Closed';
        const isFell   = d.stage === 'Fell Through';
        const finPast  = d.financing_date && new Date(d.financing_date+'T00:00:00') <= new Date(new Date().toDateString());
        const badgeLabel = isClosed ? 'CLOSED' : isFell ? 'FELL THROUGH' : finPast ? 'UNDER CONTRACT' : 'IN PROGRESS';
        const barColor = isClosed ? 'var(--green)' : isFell ? 'var(--red)' : 'linear-gradient(90deg,var(--accent),var(--accent2))';
        const fillPct  = isClosed ? 100 : isFell ? 0 : pct;
        return `<div class="card" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div class="fw-700">${App.esc(d.client_name || 'Unknown')}</div>
            <span class="stage-badge ${isClosed ? 'badge-default' : isFell ? 'badge-default' : 'badge-accepted'}">${badgeLabel}</span>
          </div>
          <div class="text-muted" style="font-size:12px;margin-bottom:8px;">📍 ${App.esc(d.property_address || '—')} · ${App.fmtMoney(d.offer_amount)}</div>
          <div style="height:6px;background:var(--border);border-radius:3px;margin-bottom:4px;">
            <div style="height:100%;width:${fillPct}%;background:${barColor};border-radius:3px;transition:width 0.4s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--text3);">
            <span>${doneInt} of ${total} milestones passed</span>
            <span>${fillPct}%</span>
          </div>
          ${d.closing_date ? `<div style="font-size:11px;color:var(--text2);text-align:right;margin-top:4px;">🗓 Closes ${App.fmtDate(d.closing_date)}</div>` : ''}
        </div>`;
      }).join('');
    }
  },

  // a11y: focusable selector + state for modal focus trap (PR #13)
  _focusableSel: 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  _savedFocus: null,
  _modalKeydownHandler: null,

  openModal(html) {
    // Remember what was focused so we can restore on close
    App._savedFocus = document.activeElement;

    const body = document.getElementById('modal-body');
    const overlay = document.getElementById('modal-overlay');
    body.innerHTML = html;
    overlay.classList.add('open');

    // Move focus into the modal (first focusable, else the body itself)
    const focusables = body.querySelectorAll(App._focusableSel);
    if (focusables.length) {
      focusables[0].focus();
    } else {
      body.setAttribute('tabindex', '-1');
      body.focus();
    }

    // Trap Tab inside the modal + close on Escape
    App._modalKeydownHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        App.closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = body.querySelectorAll(App._focusableSel);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', App._modalKeydownHandler);
  },

  closeModal(e) {
    if (!e || e.target === document.getElementById('modal-overlay')) {
      document.getElementById('modal-overlay').classList.remove('open');

      // Detach Tab/Escape handler
      if (App._modalKeydownHandler) {
        document.removeEventListener('keydown', App._modalKeydownHandler);
        App._modalKeydownHandler = null;
      }

      // Restore focus to the element that opened the modal
      if (App._savedFocus && typeof App._savedFocus.focus === 'function') {
        try { App._savedFocus.focus(); } catch (_) {}
        App._savedFocus = null;
      }
    }
  },

  // ── Command palette (Cmd+K / Ctrl+K) — PR #18 + PR #19 ──────────────────
  // Quick navigation: open with Cmd+K (Ctrl+K on Windows/Linux), type to
  // filter visible nav items AND search clients live. Reads tab items from
  // the sidebar .nav-item[data-tab] elements (single source of truth for
  // the navigation graph). Client search hits Supabase with a 200 ms
  // debounce and is race-guarded by a monotonic token.
  Palette: {
    _items: [],         // tab items collected from sidebar at open()
    _clients: [],       // live Supabase client results for the current query
    _filtered: [],      // merged + scored list rendered to the DOM
    _activeIdx: 0,
    _prevFocus: null,
    _queryToken: 0,     // bump every keystroke; stale responses discarded
    _debounceTimer: null,

    // Score a tab item against the query. Higher = better match.
    //  - exact substring of label   → strong score, weighted by earliness
    //  - subsequence match (chars in order, not contiguous) → weak score
    //  - no match → -Infinity (filtered out)
    _score(label, q) {
      if (!q) return 0;
      const l = label.toLowerCase();
      const qq = q.toLowerCase();   // case-insensitive on both sides
      const i = l.indexOf(qq);
      if (i !== -1) return 1000 - i;
      // subsequence fallback: "cmm" matches "Commissions"
      let li = 0, qi = 0;
      while (li < l.length && qi < qq.length) {
        if (l[li] === qq[qi]) qi++;
        li++;
      }
      return qi === qq.length ? 100 : -Infinity;
    },

    // Build the searchable list from the live DOM (one source of truth).
    _collectItems() {
      const out = [];
      document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
        const tab = btn.dataset.tab;
        const icon = btn.querySelector('.nav-icon')?.textContent?.trim() || '•';
        const label = btn.querySelector('.nav-label')?.textContent?.trim() || tab;
        const group = btn.closest('.sb-group')?.querySelector('.sb-section-label')
                        ?.firstChild?.textContent?.trim() || '';
        out.push({ type: 'tab', tab, icon, label, group });
      });
      return out;
    },

    open() {
      App.Palette._items = App.Palette._collectItems();
      App.Palette._clients = [];
      App.Palette._prevFocus = document.activeElement;
      const overlay = document.getElementById('cmdk-overlay');
      const input = document.getElementById('cmdk-input');
      overlay.hidden = false;
      input.value = '';
      App.Palette._render('');
      // focus input on next frame so the slide-in animation has started
      requestAnimationFrame(() => input.focus());
    },

    close() {
      const overlay = document.getElementById('cmdk-overlay');
      overlay.hidden = true;
      if (App.Palette._debounceTimer) {
        clearTimeout(App.Palette._debounceTimer);
        App.Palette._debounceTimer = null;
      }
      App.Palette._clients = [];
      if (App.Palette._prevFocus && typeof App.Palette._prevFocus.focus === 'function') {
        try { App.Palette._prevFocus.focus(); } catch (_) {}
      }
      App.Palette._prevFocus = null;
    },

    isOpen() {
      const overlay = document.getElementById('cmdk-overlay');
      return overlay && !overlay.hidden;
    },

    // PR #19: debounced live client search via Supabase.
    // Only fires for queries ≥ 2 chars. Each call bumps _queryToken; the
    // response only applies if its token still matches the latest one,
    // so a slow earlier query can't overwrite a fast later one.
    _scheduleClientSearch(query) {
      if (App.Palette._debounceTimer) clearTimeout(App.Palette._debounceTimer);
      const q = (query || '').trim();
      if (q.length < 2) {
        App.Palette._clients = [];
        return;
      }
      const myToken = ++App.Palette._queryToken;
      App.Palette._debounceTimer = setTimeout(async () => {
        try {
          // ilike with escaped wildcards in the pattern; Supabase encodes
          // the value, so `%` / `_` from the user are treated literally
          // only if escaped — here they'd just broaden the match, no XSS.
          const safeQ = q.replace(/[%_]/g, '');
          const { data, error } = await db.from('clients')
            .select('id, full_name, stage')
            .ilike('full_name', `%${safeQ}%`)
            .order('full_name', { ascending: true })
            .limit(5);
          if (myToken !== App.Palette._queryToken) return; // stale
          if (error) { App.logError && App.logError(error, 'Palette._scheduleClientSearch'); return; }
          App.Palette._clients = (data || []).map(c => ({
            type: 'client',
            id: c.id,
            icon: '👤',
            label: c.full_name || '(no name)',
            group: c.stage ? `CLIENT · ${c.stage}` : 'CLIENT',
          }));
          App.Palette._render(q, /*skipScheduling*/ true);
        } catch (err) {
          if (myToken !== App.Palette._queryToken) return;
          App.logError && App.logError(err, 'Palette._scheduleClientSearch');
        }
      }, 200);
    },

    _render(query, skipScheduling) {
      const q = (query || '').toLowerCase().trim();
      // Tabs (synchronous, scored).
      const tabs = App.Palette._items
        .map(it => ({ ...it, score: App.Palette._score(it.label, q) }))
        .filter(it => it.score !== -Infinity)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      // Clients (already filtered server-side, just preserve DB order).
      const clients = App.Palette._clients.slice(0, 5);
      // Merge: tabs first, clients below (matches Linear/Notion convention).
      const merged = tabs.concat(clients);
      App.Palette._filtered = merged;
      App.Palette._activeIdx = 0;
      const list = document.getElementById('cmdk-list');
      if (!merged.length) {
        list.innerHTML = `<li class="cmdk-empty" role="option" aria-selected="false">No matches for "${App.esc(query)}"</li>`;
      } else {
        list.innerHTML = merged.map((it, i) => `
          <li role="option" aria-selected="${i === 0}" data-idx="${i}" onclick="App.Palette._activate(${i})">
            <span class="cmdk-icon">${App.esc(it.icon)}</span>
            <span class="cmdk-text">${App.esc(it.label)}</span>
            <span class="cmdk-group">${App.esc(it.group)}</span>
          </li>
        `).join('');
      }
      // Kick off client search unless we're called from inside the search callback
      if (!skipScheduling) App.Palette._scheduleClientSearch(query);
    },

    _move(delta) {
      const n = App.Palette._filtered.length;
      if (!n) return;
      App.Palette._activeIdx = (App.Palette._activeIdx + delta + n) % n;
      const items = document.querySelectorAll('#cmdk-list li');
      items.forEach((li, i) => {
        const sel = i === App.Palette._activeIdx;
        li.setAttribute('aria-selected', sel ? 'true' : 'false');
        if (sel) li.scrollIntoView({ block: 'nearest' });
      });
    },

    _activate(idx) {
      const item = App.Palette._filtered[idx ?? App.Palette._activeIdx];
      if (!item) return;
      App.Palette.close();
      if (item.type === 'client') {
        // Land on the clients tab first so Clients.openDetail can find the
        // record in its in-memory cache. Poll briefly in case the tab is
        // freshly loaded and Clients.all is still arriving.
        App.switchTab('clients');
        let tries = 20;
        const tryOpen = () => {
          if (typeof Clients === 'undefined' || !Clients.all) {
            if (tries-- > 0) setTimeout(tryOpen, 100);
            return;
          }
          if (Clients.all.find(c => c.id === item.id)) {
            Clients.openDetail(item.id);
          } else if (tries-- > 0) {
            setTimeout(tryOpen, 100);
          }
          // If we run out of retries, the user is at least on the clients
          // tab and can find the client manually — no error toast needed.
        };
        tryOpen();
      } else {
        App.switchTab(item.tab);
      }
    },

    _onKey(e) {
      // Global trigger: Cmd+K on Mac, Ctrl+K elsewhere
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        // Don't open if a modal is already open
        const modal = document.getElementById('modal-overlay');
        if (modal && modal.classList.contains('open')) return;
        e.preventDefault();
        if (App.Palette.isOpen()) App.Palette.close();
        else App.Palette.open();
        return;
      }
      if (!App.Palette.isOpen()) return;
      if (e.key === 'Escape')      { e.preventDefault(); App.Palette.close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); App.Palette._move(1); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); App.Palette._move(-1); }
      else if (e.key === 'Enter')     { e.preventDefault(); App.Palette._activate(); }
    },

    init() {
      document.addEventListener('keydown', App.Palette._onKey);
      const input = document.getElementById('cmdk-input');
      if (input) input.addEventListener('input', (e) => App.Palette._render(e.target.value));
    },
  },

  toast(msg, color = 'var(--green)') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.borderColor = color;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  },

  activityIcon(type = '') {
    const t = type.toLowerCase();
    if (t.includes('viewing')) return '🏠';
    if (t.includes('offer')) return '📄';
    if (t.includes('client')) return '👤';
    if (t.includes('pipeline') || t.includes('deal')) return '🚀';
    if (t.includes('email')) return '📧';
    return '📋';
  },

  stageBadge(stage = '') {
    const map = {
      'Searching': 'badge-searching', 'Viewings': 'badge-viewings',
      'Offers': 'badge-offers', 'Accepted': 'badge-accepted',
      'Conditions': 'badge-conditions', 'Closing': 'badge-closing'
    };
    return `<span class="stage-badge ${map[stage]||'badge-default'}">${stage||'—'}</span>`;
  },

  avatarColor(name = '') {
    const colors = ['#1a56db','#8b5cf6','#22c55e','#f59e0b','#ef4444','#06b6d4','#ec4899'];
    let h = 0; for (let c of name) h = (h * 31 + c.charCodeAt(0)) % colors.length;
    return colors[h];
  },

  initials(name = '') {
    return name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() || '?';
  },

  // ── Privacy: mask client names, click to reveal ──
  // SECURITY (PR #14): every visible-text fragment goes through App.esc.
  // data-full attributes are escaped on write, but getAttribute() un-escapes
  // entities on read — so revealName/hideName must re-escape before innerHTML.
  privateName(fullName) {
    if (!fullName) return '<span style="color:var(--text3);">—</span>';
    const parts = fullName.trim().split(/\s+/);
    const first = parts[0];
    const safe = App.esc(fullName);
    return `<span class="pname" data-full="${safe}" onclick="App.revealName(this)" title="Click to expand">${App.esc(first)}<span class="pname-eye">›</span></span>`;
  },

  revealName(el) {
    const full = el.getAttribute('data-full');
    if (!full) return;
    el.classList.add('pname-open');
    // getAttribute returns the entity-decoded string — re-escape before innerHTML
    el.innerHTML = `${App.esc(full)}<span class="pname-eye pname-lock" onclick="event.stopPropagation();App.hideName(this.parentElement)">🔒</span>`;
  },

  hideName(el) {
    if (!el) return;
    const full = el.getAttribute('data-full');
    const parts = (full || '').trim().split(/\s+/);
    const first = parts[0] || '';
    const lastInit = parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() + '.' : '';
    const masked = lastInit ? `${first} ${lastInit}` : first;
    el.classList.remove('pname-open');
    el.innerHTML = `${App.esc(masked)}<span class="pname-eye">👁</span>`;
  },

  // ── Privacy: mask email + phone, click to reveal ──
  privateContact(email, phone) {
    const maskEmail = (e) => {
      if (!e) return '';
      const at = e.indexOf('@');
      if (at < 1) return `<span class="pname" data-full="${App.esc(e)}" onclick="App.revealName(this)" title="Click to reveal">${App.esc(e[0])}•••<span class="pname-eye">👁</span></span>`;
      const user = e.slice(0, at);
      const domain = e.slice(at + 1);
      const masked = user.length > 2 ? `${user[0]}${'•'.repeat(Math.min(user.length - 1, 4))}@${domain}` : `${user[0]}•@${domain}`;
      return `<span class="pname" data-full="${App.esc(e)}" onclick="App.revealName(this)" title="Click to reveal email">${App.esc(masked)}<span class="pname-eye">👁</span></span>`;
    };
    const maskPhone = (p) => {
      if (!p) return '';
      const digits = p.replace(/\D/g, '');
      const masked = digits.length >= 7 ? `${p.slice(0,3)} •••-${digits.slice(-4)}` : `${p.slice(0,3)}•••`;
      return `<span class="pname" data-full="${App.esc(p)}" onclick="App.revealName(this)" title="Click to reveal phone">${App.esc(masked)}<span class="pname-eye">👁</span></span>`;
    };
    const parts = [maskEmail(email), maskPhone(phone)].filter(Boolean);
    return parts.join(' · ');
  },

  fmtDate(d) {
    if (!d) return '—';
    const s = String(d).slice(0, 10); // always YYYY-MM-DD even if DB returns full timestamp
    const dt = new Date(s + 'T12:00:00'); // noon = immune to any ± UTC offset
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-CA', { month:'short', day:'numeric' });
  },

  fmtMoney(n) {
    if (!n) return '—';
    return '$' + Number(n).toLocaleString('en-CA');
  },

  timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff/60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h/24)}d ago`;
  },

  // Safe for HTML text content: `<div>${App.esc(name)}</div>`.
  // NOT safe inside an inline JS string like `onclick="fn('${...}')"` —
  // the browser decodes &#39; back to ' before the JS parser sees it.
  // For that case use App.escAttr() below.
  esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');
  },

  // Safe inside a single-quoted JS string literal that sits inside an HTML
  // attribute: `onclick="X.fn('${App.escAttr(name)}')"`. Two-pass —
  // (1) JS-escape so the inner string can't be broken out of, then
  // (2) HTML-escape `&` and `"` so the attribute container parses cleanly.
  escAttr(str) {
    if (!str) return '';
    const js = String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g,  "\\'")
      .replace(/"/g,  '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/</g,  '\\x3c');
    return js.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  },

  async logActivity(type, clientName, clientEmail, desc, clientId = null) {
    if (!currentAgent?.id) return;
    await db.from('activity_log').insert({
      agent_id: currentAgent.id, client_id: clientId,
      activity_type: type, description: desc,
      client_name: clientName, client_email: clientEmail
    });
  },

  // ── Error reporting (PR #7) ─────────────────────────────────────────────
  // Fire-and-forget log to public.client_errors. NEVER throws — that would
  // create an infinite loop with the window.error / unhandledrejection
  // listeners below. Reads happen via the Supabase Dashboard table editor.
  logError(err, context = {}) {
    try {
      const message = (err && err.message) ? String(err.message) : String(err);
      const stack   = (err && err.stack)   ? String(err.stack)   : null;
      const payload = {
        agent_id:   currentAgent && currentAgent.id ? currentAgent.id : null,
        url:        (typeof location !== 'undefined') ? String(location.href || '').slice(0, 2000) : null,
        user_agent: (typeof navigator !== 'undefined') ? String(navigator.userAgent || '').slice(0, 500) : null,
        message:    message.slice(0, 4000),
        stack:      stack ? stack.slice(0, 8000) : null,
        context:    context && typeof context === 'object' ? context : null,
        session_id: App._errorSessionId,
      };
      // Swallow both sync throw and async rejection — logError must never
      // surface failures back to the caller.
      const p = db.from('client_errors').insert(payload);
      if (p && typeof p.then === 'function') p.then(() => {}, () => {});
    } catch (_) { /* swallow */ }
  },

  // Per-page-load id so we can group errors that fired in the same session.
  _errorSessionId: (function () {
    try {
      const a = new Uint8Array(8);
      (typeof crypto !== 'undefined' ? crypto : { getRandomValues: () => a }).getRandomValues(a);
      return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return String(Date.now()) + Math.random().toString(16).slice(2, 8); }
  })()
};

// ── Global error capture (PR #7) ──────────────────────────────────────────
// Every uncaught JS error and unhandled promise rejection in the agent app
// gets logged to public.client_errors. Read via Supabase Dashboard.
if (typeof window !== 'undefined') {
  window.addEventListener('error', function (e) {
    App.logError(e && e.error ? e.error : new Error(e && e.message ? String(e.message) : 'window.error'), {
      type:     'window.error',
      filename: e && e.filename ? String(e.filename).slice(0, 500) : null,
      line:     e && typeof e.lineno === 'number' ? e.lineno : null,
      column:   e && typeof e.colno  === 'number' ? e.colno  : null,
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    App.logError(
      e && e.reason ? e.reason : new Error('unhandledrejection'),
      { type: 'unhandledrejection' }
    );
  });
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  // Apply saved photo IMMEDIATELY — before anything else loads
  try {
    const savedPhoto = localStorage.getItem('mdf-agent-photo');
    if (savedPhoto) {
      const tp = document.getElementById('topbar-photo');
      const ti = document.getElementById('topbar-initials');
      const lp = document.getElementById('lock-photo');
      const li = document.getElementById('lock-initials');
      if (tp) { tp.src = savedPhoto; tp.style.display = 'block'; }
      if (ti) ti.style.display = 'none';
      if (lp) { lp.src = savedPhoto; lp.style.display = 'block'; }
      if (li) li.style.display = 'none';
    }
  } catch(e) {}
  App.init();
  App.Palette.init();
  App.startLockScreen();
  // Restore saved theme immediately on load
  setTimeout(() => { if (window.SystemTools) SystemTools.loadSavedTheme(); }, 800);
});

// Lock screen clock + slideshow
App.startLockScreen = function() {
  // Clock
  function updateClock() {
    const now = new Date();
    const t = now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const d = now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    const cl = document.getElementById('lock-clock');
    const dl = document.getElementById('lock-date');
    if(cl) cl.textContent = t;
    if(dl) dl.textContent = d;
  }
  updateClock();
  setInterval(updateClock, 10000);

  // Slideshow
  let si = 0;
  const slides = document.querySelectorAll('.lock-slide');
  const dots = document.querySelectorAll('.lock-dot');
  if(slides.length > 1) {
    setInterval(() => {
      slides[si].classList.remove('active');
      dots[si].classList.remove('active');
      si = (si + 1) % slides.length;
      slides[si].classList.add('active');
      dots[si].classList.add('active');
    }, 5000);
  }
};
