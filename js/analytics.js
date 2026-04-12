// ── ANALYTICS ───────────────────────────────────────────────────────────────
const Analytics = {
  charts: {},

  async load() {
    if (!currentAgent?.id) return;
    const agentId = currentAgent.id;
    const now = new Date();
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [
      { data: clients },
      { data: viewings },
      { data: pipeline },
      { data: commissions },
      { data: approvals }
    ] = await Promise.all([
      db.from('clients').select('*').eq('agent_id', agentId),
      db.from('viewings').select('*, clients(full_name, email)').order('viewing_date', { ascending: false }).limit(500),
      db.from('pipeline').select('*').eq('agent_id', agentId),
      db.from('commissions').select('*').eq('agent_id', agentId),
      db.from('approval_queue').select('*').eq('agent_id', agentId).eq('status', 'Pending')
    ]);

    const cl = clients || [];
    const vi = viewings || [];
    const pi = pipeline || [];
    const ap = approvals || [];

    // Stat cards
    const totalClients = cl.length;
    // Active = not Closed or Lost
    const activeClients = cl.filter(c => {
      const s = (c.stage || c.status || '').toLowerCase();
      return !s.includes('closed') && !s.includes('lost');
    }).length;
    const activeDeals = pi.filter(p => {
      const s = (p.stage || p.status || '').toLowerCase();
      return !s.includes('closed') && !s.includes('fell');
    }).length;
    const pipelineValue = pi.reduce((s, p) => s + (p.offer_amount || 0), 0);
    const closedDeals = cl.filter(c => (c.stage||'').toLowerCase().includes('closed')).length;
    const convRate = totalClients > 0 ? Math.round((closedDeals / totalClients) * 100) : 0;
    // Support both viewing_date and date field names
    const viewingsThisMonth = vi.filter(v => {
      const d = v.viewing_date || v.date || v.created_at;
      return d && new Date(d) >= monthAgo;
    }).length;
    const pendingApprovals = ap.length;
    const newClients30d = cl.filter(c => new Date(c.created_at) >= monthAgo).length;
    const followUp = cl.filter(c => {
      const s = (c.stage || '').toLowerCase();
      if (s.includes('closed') || s.includes('lost')) return false;
      return !c.updated_at || (now - new Date(c.updated_at)) > 7 * 24 * 60 * 60 * 1000;
    }).length;

    document.getElementById('analytics-stats').innerHTML = `
      <div class="stat-card stat-blue"><div class="stat-num">${activeClients} / ${totalClients}</div><div class="stat-label">Active / Total Clients</div></div>
      <div class="stat-card stat-purple"><div class="stat-num">${activeDeals}</div><div class="stat-label">Active Deals</div></div>
      <div class="stat-card stat-green"><div class="stat-num">${App.fmtMoney(pipelineValue)}</div><div class="stat-label">Pipeline Value</div></div>
      <div class="stat-card stat-gold"><div class="stat-num">${convRate}%</div><div class="stat-label">Conversion Rate</div></div>
      <div class="stat-card stat-cyan"><div class="stat-num">${viewingsThisMonth}</div><div class="stat-label">Viewings This Month</div></div>
      <div class="stat-card stat-red"><div class="stat-num">${pendingApprovals}</div><div class="stat-label">Pending Approvals</div></div>
      <div class="stat-card stat-blue"><div class="stat-num">${newClients30d}</div><div class="stat-label">New Clients (30D)</div></div>
      <div class="stat-card stat-yellow"><div class="stat-num">${followUp}</div><div class="stat-label">Needs Follow-Up</div></div>
    `;

    Analytics.renderPipelineBreakdown(cl);
    Analytics.renderClientsByCity(cl);
    Analytics.renderViewingsOverTime(vi, cl);
    Analytics.renderViewingsPerClient(vi, cl);
    Analytics.renderStageDistribution(cl);
    Analytics.renderBudgetDistribution(cl);
    Analytics.renderViewingStatus(vi);
    Analytics.renderTopLeads(cl);
    Analytics.renderNeedsFollowUp(cl);
    Analytics.renderViewingsData(cl, vi);
  },

  destroy(id) {
    if (Analytics.charts[id]) {
      Analytics.charts[id].destroy();
      delete Analytics.charts[id];
    }
  },

  darkScales() {
    return {
      x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1e293b' }, beginAtZero: true }
    };
  },

  renderPipelineBreakdown(clients) {
    // Dynamically bucket all actual stages found in the data
    const stageMap = {};
    clients.forEach(c => {
      const s = c.stage || 'Unknown';
      stageMap[s] = (stageMap[s] || 0) + 1;
    });
    const palette = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#f97316','#ec4899','#475569','#84cc16'];
    const entries = Object.entries(stageMap).sort((a,b) => b[1]-a[1]);
    const stages = entries.map(([s]) => s);
    const counts = entries.map(([,n]) => n);
    const colors = stages.map((_,i) => palette[i % palette.length]);
    Analytics.destroy('pipeline-breakdown');
    const ctx = document.getElementById('chart-pipeline-breakdown');
    if (!ctx) return;
    Analytics.charts['pipeline-breakdown'] = new Chart(ctx.getContext('2d'), {
      type: 'doughnut',
      data: { labels: stages, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } } }
      }
    });
  },

  renderClientsByCity(clients) {
    const cityMap = {};
    clients.forEach(c => {
      const city = c.city || c.preferred_areas || 'Unknown';
      cityMap[city] = (cityMap[city] || 0) + 1;
    });
    const sorted = Object.entries(cityMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];
    Analytics.destroy('clients-city');
    const ctx = document.getElementById('chart-clients-city');
    if (!ctx) return;
    Analytics.charts['clients-city'] = new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: sorted.map(([city]) => city),
        datasets: [{ data: sorted.map(([, n]) => n), backgroundColor: sorted.map((_, i) => colors[i % colors.length]), borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: Analytics.darkScales()
      }
    });
  },

  renderViewingsOverTime(viewings, clients) {
    const dateMap = {};
    viewings.forEach(v => {
      // Try every possible date field name
      const raw = v.viewing_date || v.date || v.scheduled_date || v.appointment_date || v.visit_date || v.created_at;
      if (!raw) return;
      const d = String(raw).substring(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return; // skip malformed dates
      dateMap[d] = (dateMap[d] || 0) + 1;
    });
    const dates = Object.keys(dateMap).sort().slice(-30);
    Analytics.destroy('viewings-time');
    const ctx = document.getElementById('chart-viewings-time');
    if (!ctx) return;
    // Clean up any old empty-state message
    const old = ctx.parentElement.querySelector('.chart-empty-msg');
    if (old) old.remove();
    ctx.style.display = '';
    // Show empty state if no date data
    if (!dates.length) {
      ctx.style.display = 'none';
      ctx.parentElement.insertAdjacentHTML('beforeend',
        '<div class="chart-empty-msg" style="text-align:center;color:var(--text2);padding:40px 20px;font-size:13px;">📅 No viewings recorded yet — add viewings to see this chart.</div>');
      return;
    }
    Analytics.charts['viewings-time'] = new Chart(ctx.getContext('2d'), {
      type: 'line',
      data: {
        labels: dates.map(d => d.substring(5)),
        datasets: [{
          data: dates.map(d => dateMap[d] || 0),
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)',
          borderWidth: 2, pointBackgroundColor: '#3b82f6', pointRadius: 4, fill: true, tension: 0.4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 45 }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: '#1e293b' }, beginAtZero: true }
        }
      }
    });
  },

  renderViewingsPerClient(viewings, clients) {
    clients = clients || [];
    // Build client id → full_name lookup so we can resolve client_id foreign keys
    const idToName = {};
    clients.forEach(c => {
      if (c.id) idToName[String(c.id)] = c.full_name || c.name || '';
    });
    const clientMap = {};
    viewings.forEach(v => {
      // Primary: joined clients relation (matches how Viewings tab works)
      let n = (v.clients && v.clients.full_name) || '';
      // Fallback: direct name fields
      if (!n) n = v.client_name || v.name || v.client || v.contact_name || '';
      // Fallback: resolve via client_id foreign key lookup
      if (!n && (v.client_id || v.clientId)) {
        n = idToName[String(v.client_id || v.clientId)] || '';
      }
      // Skip blank, timestamp-like, or non-name entries
      if (!n || n.length > 60 || /^\d|GMT|UTC|Standard Time/i.test(n)) return;
      clientMap[n] = (clientMap[n] || 0) + 1;
    });
    const sorted = Object.entries(clientMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    Analytics.destroy('viewings-client');
    const ctx = document.getElementById('chart-viewings-client');
    if (!ctx) return;
    // Clean up any old empty-state message
    const old = ctx.parentElement.querySelector('.chart-empty-msg');
    if (old) old.remove();
    ctx.style.display = '';
    // Show empty state if no client data
    if (!sorted.length) {
      ctx.style.display = 'none';
      ctx.parentElement.insertAdjacentHTML('beforeend',
        '<div class="chart-empty-msg" style="text-align:center;color:var(--text2);padding:40px 20px;font-size:13px;">👤 No viewings per client yet — add viewings with client names to see this chart.</div>');
      return;
    }
    Analytics.charts['viewings-client'] = new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: sorted.map(([n]) => n),
        datasets: [{ data: sorted.map(([, c]) => c), backgroundColor: '#8b5cf6', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: Analytics.darkScales()
      }
    });
  },

  renderStageDistribution(clients) {
    // Dynamically use all stages actually present in data
    const stageMap = {};
    clients.forEach(c => { const s = c.stage || 'Unknown'; stageMap[s] = (stageMap[s] || 0) + 1; });
    const palette = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#f97316','#ec4899','#475569','#84cc16'];
    const entries = Object.entries(stageMap).sort((a,b) => b[1]-a[1]);
    const stages = entries.map(([s]) => s);
    const counts = entries.map(([,n]) => n);
    const colors = stages.map((_,i) => palette[i % palette.length]);
    Analytics.destroy('stage-dist');
    const ctx = document.getElementById('chart-stage-dist');
    if (!ctx) return;
    Analytics.charts['stage-dist'] = new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: { labels: stages, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: '#1e293b' }, beginAtZero: true }
        }
      }
    });
  },

  renderBudgetDistribution(clients) {
    const ranges = ['< $200K', '$200K–$400K', '$400K–$600K', '$600K–$800K', '> $800K'];
    const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
    const counts = [0, 0, 0, 0, 0];
    clients.forEach(c => {
      // Parse price_range text like "$400K-$600K", "$750,000", "800000" etc.
      const raw = c.price_range || '';
      if (!raw) return;
      // Extract largest number from the string
      const nums = raw.replace(/,/g,'').match(/\d+(?:\.\d+)?/g);
      if (!nums) return;
      let b = parseFloat(nums[nums.length - 1]); // take upper bound
      if (b < 10000) b *= 1000; // handle shorthand like "400" meaning 400000
      if (isNaN(b) || b <= 0) return;
      if (b < 200000) counts[0]++;
      else if (b < 400000) counts[1]++;
      else if (b < 600000) counts[2]++;
      else if (b < 800000) counts[3]++;
      else counts[4]++;
    });
    // Only show ranges that have at least 1 client
    const filtered = ranges.map((r, i) => ({ r, c: counts[i], col: colors[i] })).filter(x => x.c > 0);
    Analytics.destroy('budget-dist');
    const ctx = document.getElementById('chart-budget-dist');
    if (!ctx) return;
    if (!filtered.length) {
      // No valid budgets — show placeholder message
      ctx.parentElement.innerHTML = '<div style="text-align:center;color:var(--text2);padding:30px;font-size:13px;">No budget data yet</div>';
      return;
    }
    Analytics.charts['budget-dist'] = new Chart(ctx.getContext('2d'), {
      type: 'pie',
      data: {
        labels: filtered.map(x => x.r),
        datasets: [{ data: filtered.map(x => x.c), backgroundColor: filtered.map(x => x.col), borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } } }
      }
    });
  },

  renderViewingStatus(viewings) {
    // Dynamically collect all statuses actually in the data
    const statusMap = {};
    viewings.forEach(v => {
      const s = v.viewing_status || v.status || '';
      if (!s) return; // skip records with no status field
      statusMap[s] = (statusMap[s] || 0) + 1;
    });
    // Filter out generic 'Unknown' entries — only show real status values
    const palette = ['#10b981', '#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4'];
    const entries = Object.entries(statusMap).sort((a,b) => b[1]-a[1]);
    const statuses = entries.map(([s]) => s);
    const counts = entries.map(([,n]) => n);
    const colors = statuses.map((_,i) => palette[i % palette.length]);
    Analytics.destroy('viewing-status');
    const ctx = document.getElementById('chart-viewing-status');
    if (!ctx) return;
    // Clean up any old empty-state message
    const old = ctx.parentElement.querySelector('.chart-empty-msg-status');
    if (old) old.remove();
    ctx.style.display = '';
    if (!statuses.length) {
      ctx.style.display = 'none';
      ctx.parentElement.insertAdjacentHTML('beforeend',
        '<div class="chart-empty-msg-status" style="text-align:center;color:var(--text2);padding:40px 20px;font-size:13px;">🔍 No viewing status data yet — update viewing statuses to see this chart.</div>');
      return;
    }
    Analytics.charts['viewing-status'] = new Chart(ctx.getContext('2d'), {
      type: 'pie',
      data: { labels: statuses, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } } }
      }
    });
  },

  renderTopLeads(clients) {
    // Flexible scoring — matches partial stage names case-insensitively
    const getScore = stage => {
      if (!stage) return 5;
      const s = stage.toLowerCase();
      if (s.includes('closed')) return 100;
      if (s.includes('offer') || s.includes('in offer')) return 60;
      if (s.includes('contract') || s.includes('under contract')) return 50;
      if (s.includes('search') || s.includes('searching') || s.includes('active')) return 35;
      if (s.includes('view') || s.includes('new')) return 15;
      if (s.includes('lost')) return 5;
      return 10;
    };
    const scored = clients
      .map(c => ({ ...c, score: getScore(c.stage) }))
      .sort((a, b) => b.score - a.score);
    const el = document.getElementById('analytics-top-leads');
    if (!el) return;
    if (!scored.length) { el.innerHTML = '<div class="text-muted" style="font-size:13px;">No clients</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:6px 0;color:var(--text2);font-size:10px;font-weight:700;text-transform:uppercase;">CLIENT</th>
        <th style="text-align:left;padding:6px 0;color:var(--text2);font-size:10px;font-weight:700;text-transform:uppercase;">STAGE</th>
        <th style="text-align:right;padding:6px 0;color:var(--text2);font-size:10px;font-weight:700;text-transform:uppercase;">SCORE</th>
      </tr></thead>
      <tbody>${scored.slice(0, 10).map(c => {
        const color = c.score >= 60 ? '#10b981' : c.score >= 30 ? '#f59e0b' : '#ef4444';
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 0;font-weight:600;color:var(--accent2);">${c.full_name}</td>
          <td style="padding:8px 0;color:var(--text2);">${c.stage || '—'}</td>
          <td style="padding:8px 0;text-align:right;">
            <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
              <div style="width:70px;height:5px;background:var(--border);border-radius:3px;">
                <div style="width:${c.score}%;height:100%;background:${color};border-radius:3px;"></div>
              </div>
              <span style="font-weight:800;color:${color};min-width:22px;text-align:right;">${c.score}</span>
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  },

  renderNeedsFollowUp(clients) {
    const now = new Date();
    const overdue = clients
      .filter(c => {
        const s = (c.stage || '').toLowerCase();
        // Skip only truly closed/lost clients
        return !s.includes('closed') && !s.includes('lost');
      })
      .map(c => ({ ...c, days: c.updated_at ? Math.floor((now - new Date(c.updated_at)) / 86400000) : 999 }))
      .filter(c => c.days >= 7)
      .sort((a, b) => b.days - a.days);
    const el = document.getElementById('analytics-followup');
    if (!el) return;
    if (!overdue.length) { el.innerHTML = '<div style="font-size:13px;color:var(--green);">✅ All clients up to date</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:6px 0;color:var(--text2);font-size:10px;font-weight:700;text-transform:uppercase;">CLIENT</th>
        <th style="text-align:left;padding:6px 0;color:var(--text2);font-size:10px;font-weight:700;text-transform:uppercase;">STAGE</th>
        <th style="text-align:right;padding:6px 0;color:var(--text2);font-size:10px;font-weight:700;text-transform:uppercase;">DAYS SINCE CONTACT</th>
      </tr></thead>
      <tbody>${overdue.slice(0, 8).map(c => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 0;font-weight:600;color:var(--accent2);">${c.full_name}</td>
          <td style="padding:8px 0;color:var(--text2);">${c.stage || '—'}</td>
          <td style="padding:8px 0;text-align:right;font-weight:700;color:var(--red);">${c.days} days</td>
        </tr>`).join('')}</tbody>
    </table>`;
  },

  renderViewingsData(clients, viewings) {
    // Build client id → full_name lookup
    const idToName = {};
    clients.forEach(c => { if (c.id) idToName[String(c.id)] = c.full_name || c.name || ''; });
    const viewingMap = {};
    viewings.forEach(v => {
      let n = (v.clients && v.clients.full_name) || '';
      if (!n) n = v.client_name || v.name || v.client || v.contact_name || '';
      if (!n && (v.client_id || v.clientId)) n = idToName[String(v.client_id || v.clientId)] || '';
      if (!n || n.length > 60 || /^\d|GMT|UTC|Standard Time/i.test(n)) return;
      viewingMap[n] = (viewingMap[n] || 0) + 1;
    });
    const emailMap = {};
    clients.forEach(c => { emailMap[c.full_name] = c.email || '—'; });
    const rows = Object.entries(viewingMap).sort((a, b) => b[1] - a[1]);
    const el = document.getElementById('analytics-viewings-data');
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div class="text-muted" style="font-size:13px;">No viewings data</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:10px 0;color:var(--text2);font-size:11px;font-weight:700;text-transform:uppercase;">CLIENT</th>
        <th style="text-align:left;padding:10px 0;color:var(--text2);font-size:11px;font-weight:700;text-transform:uppercase;">EMAIL</th>
        <th style="text-align:right;padding:10px 0;color:var(--text2);font-size:11px;font-weight:700;text-transform:uppercase;">VIEWINGS</th>
      </tr></thead>
      <tbody>${rows.map(([name, count]) => `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:10px 0;font-weight:600;color:var(--accent2);">${name}</td>
          <td style="padding:10px 0;color:var(--text2);">${emailMap[name] || '—'}</td>
          <td style="padding:10px 0;text-align:right;font-weight:800;">${count}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  }
};
