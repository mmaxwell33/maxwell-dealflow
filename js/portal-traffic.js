// js/portal-traffic.js — Portal Traffic dashboard
// Reads from public.portal_views (RLS scopes to current agent's deals/clients).
// Renders: stat cards, 30-day line chart (Chart.js), per-client table.

const PortalTraffic = {
  rows: [],
  range: 30,           // days: 7 | 30 | 90
  chart: null,

  async load() {
    const root = document.getElementById('screen-portaltraffic');
    if (!root) return;
    root.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:18px;">
        <div>
          <h2 style="margin:0;font-size:22px;font-weight:800;">📡 Portal Traffic</h2>
          <div style="font-size:13px;color:var(--text2);margin-top:4px;">Who's viewing the links you've sent — client, builder, and stakeholder portals.</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="pt-range" data-r="7"  onclick="PortalTraffic.setRange(7)">7d</button>
          <button class="pt-range" data-r="30" onclick="PortalTraffic.setRange(30)">30d</button>
          <button class="pt-range" data-r="90" onclick="PortalTraffic.setRange(90)">90d</button>
        </div>
      </div>
      <div id="pt-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px;"></div>
      <div style="background:var(--card);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:14px;padding:18px;margin-bottom:18px;">
        <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Views over time</div>
        <div style="position:relative;height:240px;"><canvas id="pt-chart"></canvas></div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:14px;padding:18px;">
        <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">By client</div>
        <div id="pt-clients"></div>
      </div>
      <style>
        .pt-range{background:var(--card2,#1E2636);color:var(--text2);border:1px solid var(--border,rgba(255,255,255,.08));padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;}
        .pt-range.on{background:var(--accent);color:#fff;border-color:var(--accent);}
        .pt-stat{background:var(--card);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:12px;padding:14px;}
        .pt-stat-label{font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;}
        .pt-stat-num{font-size:24px;font-weight:800;color:var(--text1,#F8FAFC);}
        .pt-row{display:grid;grid-template-columns:1.4fr 0.7fr 0.7fr 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--border,rgba(255,255,255,.06));align-items:center;font-size:13px;}
        .pt-row:last-child{border-bottom:none;}
        .pt-row.head{font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border,rgba(255,255,255,.08));}
        .pt-pill{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;background:rgba(204,120,92,.16);color:var(--accent);margin-right:4px;}
      </style>
    `;
    await this.fetch();
    this.render();
  },

  setRange(r) {
    this.range = r;
    document.querySelectorAll('.pt-range').forEach(b => b.classList.toggle('on', String(b.dataset.r) === String(r)));
    this.fetch().then(() => this.render());
  },

  async fetch() {
    try {
      const since = new Date(Date.now() - this.range * 86400000).toISOString();
      const { data, error } = await db.from('portal_views')
        .select('id, page_type, token, client_id, client_name, deal_id, viewed_at, is_self')
        .gte('viewed_at', since)
        .order('viewed_at', { ascending: false });
      if (error) { console.error('PortalTraffic fetch:', error); this.rows = []; return; }
      const rows = data || [];

      // Tokens in deal_stakeholders with role='client' = real clients (not lawyer/lender).
      // For these, treat their stakeholder views as Client views in the dashboard.
      const stakeTokens = rows.filter(r => r.page_type === 'stakeholder' && r.token).map(r => r.token);
      let clientRoleTokens = new Set();
      if (stakeTokens.length) {
        try {
          const { data: ds } = await db.from('deal_stakeholders')
            .select('token, role').in('token', stakeTokens).eq('role', 'client');
          (ds || []).forEach(x => clientRoleTokens.add(x.token));
        } catch(_) { /* ignore — fall back to raw page_type */ }
      }
      // Tag every row with the label-effective type
      rows.forEach(r => {
        r.effective_type = (r.page_type === 'stakeholder' && clientRoleTokens.has(r.token))
          ? 'build' : r.page_type;
      });
      // SELF_FILTER_INSTALLED
      this.allRows = rows;
      this.rows = rows.filter(r => !r.is_self);
    } catch(e) { console.error(e); this.rows = []; }
  },

  render() {
    document.querySelectorAll('.pt-range').forEach(b => b.classList.toggle('on', String(b.dataset.r) === String(this.range)));
    this.renderStats();
    this.renderChart();
    this.renderClients();
    this.renderRecent();
  },

  renderStats() {
    const total = this.rows.length;
    const today = new Date().toISOString().slice(0,10);
    const todayCount = this.rows.filter(r => r.viewed_at.slice(0,10) === today).length;
    const uniqueClients = new Set(this.rows.filter(r => r.client_id).map(r => r.client_id)).size;
    const byType = this.rows.reduce((a,r) => { const k = r.effective_type || r.page_type; a[k]=(a[k]||0)+1; return a; }, {});
    const top = Object.entries(byType).sort((a,b)=>b[1]-a[1])[0];

    document.getElementById('pt-stats').innerHTML = `
      <div class="pt-stat"><div class="pt-stat-label">Total Views</div><div class="pt-stat-num">${total}</div></div>
      <div class="pt-stat"><div class="pt-stat-label">Today</div><div class="pt-stat-num">${todayCount}</div></div>
      <div class="pt-stat"><div class="pt-stat-label">Unique Clients</div><div class="pt-stat-num">${uniqueClients}</div></div>
      <div class="pt-stat"><div class="pt-stat-label">Top Portal</div><div class="pt-stat-num" style="font-size:18px;">${top ? ({build:'Client',builder:'Builder',stakeholder:'Stakeholder'}[top[0]]||top[0])+' ('+top[1]+')' : '—'}</div></div>
    `;
  },

  renderChart() {
    const canvas = document.getElementById('pt-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (this.chart) { this.chart.destroy(); this.chart = null; }

    // Build day buckets
    const days = [];
    for (let i = this.range - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0,10));
    }
    const types = ['build','builder','stakeholder'];
    const colors = { build:'#CC785C', builder:'#7c7cff', stakeholder:'#10B981' };
    const LABELS = { build:'Client', builder:'Builder', stakeholder:'Stakeholder' };
    const datasets = types.map(t => ({
      label: LABELS[t],
      data: days.map(day => this.rows.filter(r => (r.effective_type||r.page_type)===t && r.viewed_at.slice(0,10)===day).length),
      borderColor: colors[t], backgroundColor: colors[t]+'33',
      borderWidth: 2, tension: .35, fill: true, pointRadius: 2,
    }));

    this.chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: days.map(d => d.slice(5)), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: getComputedStyle(document.body).getPropertyValue('--text2') || '#9CA3AF', font:{size:11} } } },
        scales: {
          x: { ticks: { color: '#94A3B8', font:{size:10} }, grid: { color:'rgba(255,255,255,.04)' } },
          y: { beginAtZero: true, ticks: { color: '#94A3B8', font:{size:10}, precision:0 }, grid: { color:'rgba(255,255,255,.04)' } }
        }
      }
    });
  },

  renderClients() {
    const byClient = {};
    for (const r of this.rows) {
      const key = r.client_id || ('anon::' + (r.client_name || 'Unknown'));
      if (!byClient[key]) byClient[key] = { name: r.client_name || 'Unknown', types: {}, total: 0, last: r.viewed_at };
      byClient[key].total++;
      const _et = r.effective_type || r.page_type;
      byClient[key].types[_et] = (byClient[key].types[_et]||0) + 1;
      if (r.viewed_at > byClient[key].last) byClient[key].last = r.viewed_at;
    }
    const list = Object.values(byClient).sort((a,b)=>b.total-a.total);
    const root = document.getElementById('pt-clients');
    if (!list.length) { root.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text2);font-size:13px;">No portal views in this range yet.</div>'; return; }

    let html = '<div class="pt-row head"><div>Client</div><div>Portals</div><div>Views</div><div>Last viewed</div></div>';
    for (const c of list) {
      const _LBL = { build:'Client', builder:'Builder', stakeholder:'Stakeholder' };
      const pills = Object.entries(c.types).map(([t,n]) => `<span class="pt-pill">${_LBL[t]||t} ${n}</span>`).join('');
      const ago = App.timeAgo ? App.timeAgo(c.last) : new Date(c.last).toLocaleString();
      html += `<div class="pt-row"><div style="font-weight:700;">${c.name}</div><div>${pills}</div><div style="font-weight:700;">${c.total}</div><div style="color:var(--text2);">${ago}</div></div>`;
    }
    root.innerHTML = html;
  }
,

  renderRecent() {
    const root = document.getElementById('pt-recent');
    if (!root) return;
    const all = (this.allRows || this.rows || []).slice(0, 25);
    if (!all.length) { root.innerHTML = ''; return; }
    const _LBL = { build:'Client', builder:'Builder', stakeholder:'Stakeholder' };
    let html = '<div class="pt-section-title" style="margin-top:24px;font-weight:700;font-size:13px;color:var(--text2);text-transform:uppercase;letter-spacing:.6px;">Recent Views (last 25)</div>';
    html += '<div class="pt-row head"><div>Who</div><div>Portal</div><div>When</div><div>Action</div></div>';
    for (const r of all) {
      const ago = App.timeAgo ? App.timeAgo(r.viewed_at) : new Date(r.viewed_at).toLocaleString();
      const pillType = r.effective_type || r.page_type;
      const tag = r.is_self
        ? '<span class="pt-pill" style="background:#f59e0b22;color:#f59e0b;">self-test</span>'
        : '<span class="pt-pill">'+(_LBL[pillType]||pillType)+'</span>';
      const btnLabel = r.is_self ? 'Restore' : 'Mark as self';
      const btnTitle = r.is_self ? 'Include this view in totals again' : 'Exclude this view from chart and totals';
      html += '<div class="pt-row"><div>'+(r.client_name||'Unknown')+'</div><div>'+tag+'</div><div style="color:var(--text2);">'+ago+'</div><div><button class="btn btn-outline btn-xs" title="'+btnTitle+'" onclick="PortalTraffic.markSelf(\''+r.id+'\', '+(!r.is_self)+')">'+btnLabel+'</button></div></div>';
    }
    root.innerHTML = html;
  },

  async markSelf(viewId, makeSelf) {
    try {
      const { error } = await db.rpc('mark_portal_view_self', { p_view_id: viewId, p_is_self: !!makeSelf });
      if (error) { App.toast('Could not update: ' + error.message, 'var(--red)'); return; }
      App.toast(makeSelf ? '✅ Marked as self-test (excluded from totals)' : '↩️ Restored to totals', 'var(--green)');
      await this.fetch();
      this.render();
    } catch (e) {
      App.toast('Error: ' + e.message, 'var(--red)');
    }
  }
};
