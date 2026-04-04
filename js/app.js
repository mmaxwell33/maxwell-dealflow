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
    // Update topbar with full agent info
    const initials = (currentAgent.name || 'M').split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
    document.getElementById('topbar-avatar').textContent = initials;
    document.getElementById('topbar-name').textContent = currentAgent.name || 'Maxwell';
    document.getElementById('topbar-brokerage').textContent = currentAgent.brokerage || 'eXp Realty';
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
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`screen-${tab}`);
    if (screen) screen.classList.add('active');
    document.querySelectorAll('.nav-item, .tab-item').forEach(n => {
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
    if (tab === 'tracker') Tracker.load();
    if (tab === 'checklist') Checklist.load();
    if (tab === 'inbox') { /* Inbox loads on button click — instant tab open */ }
    if (tab === 'formresponses') FormResponses.load();
    if (tab === 'agentportal') AgentPortal.load();
    if (tab === 'cleanup') Cleanup.init();
    if (tab === 'system') SystemTools.load();
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
      { data: deals }
    ] = await Promise.all([
      db.from('clients').select('*',{count:'exact',head:true}).eq('agent_id',agentId).eq('status','Active'),
      db.from('clients').select('*',{count:'exact',head:true}).eq('agent_id',agentId),
      db.from('viewings').select('*',{count:'exact',head:true}).eq('agent_id',agentId).eq('viewing_status','Scheduled'),
      db.from('pipeline').select('*',{count:'exact',head:true}).eq('agent_id',agentId).eq('status','Active'),
      db.from('pipeline').select('*',{count:'exact',head:true}).eq('agent_id',agentId).eq('stage','Closed'),
      db.from('clients').select('*',{count:'exact',head:true}).eq('agent_id',agentId).gte('created_at',weekAgo),
      db.from('clients').select('id,name,stage,updated_at').eq('agent_id',agentId).eq('status','Active'),
      db.from('activity_log').select('*').eq('agent_id',agentId).order('created_at',{ascending:false}).limit(6),
      db.from('pipeline').select('*').eq('agent_id',agentId).eq('status','Active').limit(3)
    ]);

    // Update stats
    document.getElementById('stat-active').textContent = activeCount || 0;
    document.getElementById('stat-total').textContent = totalCount || 0;
    document.getElementById('stat-viewings').textContent = viewingsCount || 0;
    document.getElementById('stat-pipeline').textContent = pipelineCount || 0;
    document.getElementById('stat-closed').textContent = closedCount || 0;

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
          <div class="client-avatar" style="width:32px;height:32px;font-size:12px;background:${App.avatarColor(c.name)};">${App.initials(c.name)}</div>
          <div>
            <div style="font-size:13px;font-weight:700;">${c.name}</div>
            <div style="font-size:11px;color:var(--text2);">${c.stage || 'No stage'} · Last update ${App.timeAgo(c.updated_at)}</div>
          </div>
        </div>`).join('');
    } else {
      alertEl.style.display = 'none';
    }

    // Recent activity
    const actEl = document.getElementById('recent-activity');
    if (!recent?.length) {
      actEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No activity yet</div><div class="empty-sub">Start by adding a client</div></div>';
    } else {
      actEl.innerHTML = recent.map(a => `
        <div class="activity-row">
          <div class="activity-icon" style="background:var(--bg2);">${App.activityIcon(a.activity_type)}</div>
          <div>
            <div class="activity-title">${a.description || a.activity_type}</div>
            <div class="activity-meta">${a.client_name || ''} · ${App.timeAgo(a.created_at)}</div>
          </div>
        </div>`).join('');
    }

    // Pipeline snapshot
    const snapEl = document.getElementById('pipeline-snapshot');
    if (!deals?.length) {
      snapEl.innerHTML = '<div class="card text-muted" style="font-size:13px;text-align:center;padding:20px;">No active deals in pipeline.</div>';
    } else {
      const stages = ['Accepted','Conditions','Closing','Closed'];
      snapEl.innerHTML = deals.map(d => {
        const si = stages.indexOf(d.stage);
        return `<div class="card" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div class="fw-700">${d.client_name || 'Unknown'}</div>
            <span class="stage-badge badge-accepted">${d.stage || 'Active'}</span>
          </div>
          <div class="text-muted" style="font-size:12px;margin-bottom:10px;">📍 ${d.property_address || '—'} · ${App.fmtMoney(d.offer_amount)}</div>
          <div class="pipeline-bar">${stages.map((s,i)=>`<div class="pipeline-step ${i===si?'active':i<si?'done':''}"></div>`).join('')}</div>
          <div style="font-size:11px;color:var(--text2);text-align:right;">${d.closing_date ? '🗓 Closes '+App.fmtDate(d.closing_date) : ''}</div>
        </div>`;
      }).join('');
    }
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

  esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.startLockScreen();
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
