// Maxwell DealFlow CRM — Core App
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentAgent = null;
let currentTab = 'overview';

const App = {

  async init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    // Check existing session
    const { data: { session } } = await db.auth.getSession();
    if (session) {
      await App.onSignedIn(session.user);
    }
    // Listen for auth changes
    db.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) await App.onSignedIn(session.user);
      if (event === 'SIGNED_OUT') App.showAuth();
    });
  },

  async signIn() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = 'Please enter email and password.'; return; }
    const btn = document.querySelector('.auth-btn');
    btn.textContent = 'Signing in...';
    btn.disabled = true;
    const { error } = await db.auth.signInWithPassword({ email, password });
    btn.textContent = 'Sign In'; btn.disabled = false;
    if (error) { errEl.textContent = error.message; return; }
  },

  showSignUp() {
    const errEl = document.getElementById('auth-error');
    errEl.textContent = 'Contact Maxwell to get your account created.';
    errEl.style.color = '#63b3ed';
  },

  async onSignedIn(user) {
    // Load agent profile
    const { data: agent } = await db.from('agents').select('*').eq('email', user.email).single();
    currentAgent = agent || { name: user.email, email: user.email, id: null };
    // Update UI
    const initials = (currentAgent.name || 'M').split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
    document.getElementById('topbar-avatar').textContent = initials;
    // Show app
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    // Load initial data
    await App.loadOverview();
    Clients.load();
    Viewings.load();
    Offers.load();
    Pipeline.load();
  },

  showAuth() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  },

  async signOut() {
    await db.auth.signOut();
    App.showAuth();
  },

  switchTab(tab) {
    currentTab = tab;
    // Update screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`screen-${tab}`);
    if (screen) screen.classList.add('active');
    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.tab === tab);
    });
    // Update topbar title
    const titles = { overview:'Overview', clients:'Clients', viewings:'Viewings', offers:'Offers & Pipeline', pipeline:'Pipeline', ai:'AI Assistant' };
    document.getElementById('topbar-title').textContent = titles[tab] || 'DealFlow';
    // Scroll to top
    document.getElementById('main-content').scrollTop = 0;
  },

  toggleAI() {
    App.switchTab('ai');
    // Update nav — AI isn't in nav so clear active
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  },

  async loadOverview() {
    if (!currentAgent?.id) return;
    // Stats
    const [{ count: cc }, { count: vc }, { count: pc }] = await Promise.all([
      db.from('clients').select('*', { count:'exact', head:true }).eq('agent_id', currentAgent.id).eq('status','Active'),
      db.from('viewings').select('*', { count:'exact', head:true }).eq('viewing_status','Scheduled'),
      db.from('pipeline').select('*', { count:'exact', head:true }).eq('agent_id', currentAgent.id).eq('status','Active'),
    ]);
    document.getElementById('stat-clients').textContent = cc || 0;
    document.getElementById('stat-viewings').textContent = vc || 0;
    document.getElementById('stat-pipeline').textContent = pc || 0;

    // Recent activity
    const { data: recent } = await db.from('activity_log')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false }).limit(5);

    const actEl = document.getElementById('recent-activity');
    if (!recent?.length) {
      actEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No activity yet</div><div class="empty-sub">Start by adding a client</div></div>';
      return;
    }
    actEl.innerHTML = recent.map(a => `
      <div class="activity-row">
        <div class="activity-icon" style="background:var(--bg2);">${App.activityIcon(a.activity_type)}</div>
        <div>
          <div class="activity-title">${a.description || a.activity_type}</div>
          <div class="activity-meta">${a.client_name || ''} · ${App.timeAgo(a.created_at)}</div>
        </div>
      </div>`).join('');

    // Pipeline snapshot
    const { data: deals } = await db.from('pipeline')
      .select('*').eq('agent_id', currentAgent.id).eq('status','Active').limit(3);
    const snapEl = document.getElementById('pipeline-snapshot');
    if (!deals?.length) { snapEl.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">No active deals in pipeline.</div>'; return; }
    snapEl.innerHTML = deals.map(d => `
      <div class="card" style="margin-bottom:10px;">
        <div class="fw-700">${d.client_name || 'Unknown'}</div>
        <div class="text-muted" style="font-size:12px;margin:3px 0 8px;">${d.property_address || '—'}</div>
        <div class="pipeline-bar">${['Accepted','Conditions','Closing','Closed'].map(s =>
          `<div class="pipeline-step ${d.stage===s?'active':(['Accepted','Conditions','Closing','Closed'].indexOf(d.stage)>['Accepted','Conditions','Closing','Closed'].indexOf(s)?'done':'')}">`
        ).join('')}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
          <span class="text-accent">${d.stage || 'Active'}</span>
          <span class="text-muted">${d.closing_date ? 'Closes ' + App.fmtDate(d.closing_date) : ''}</span>
        </div>
      </div>`).join('');
  },

  openModal(html) {
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('open');
  },

  closeModal(e) {
    if (!e || e.target === document.getElementById('modal-overlay')) {
      document.getElementById('modal-overlay').classList.remove('open');
    }
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

  fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-CA', { month:'short', day:'numeric' });
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

  async logActivity(type, clientName, clientEmail, desc, clientId = null) {
    if (!currentAgent?.id) return;
    await db.from('activity_log').insert({
      agent_id: currentAgent.id, client_id: clientId,
      activity_type: type, description: desc,
      client_name: clientName, client_email: clientEmail
    });
  }
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
