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
      db.from('viewings').select('*').eq('agent_id', agentId),
      db.from('pipeline').select('*').eq('agent_id', agentId),
      db.from('commissions').select('*').eq('agent_id', agentId),
      db.from('approval_queue').select('*').eq('agent_id', agentId).eq('status', 'Pending')
    ]);

    const cl = clients || [];
    const vi = viewings || [];
    const pi = pipeline || [];
    const ap = approvals || [];

    // Stat cards
    const activeClients = cl.filter(c => c.status === 'Active').length;
    const totalClients = cl.length;
    const activeDeals = pi.filter(p => p.status === 'Active').length;
    const pipelineValue = pi.reduce((s, p) => s + (p.offer_amount || 0), 0);
    const closedDeals = pi.filter(p => p.stage === 'Closed').length;
    const convRate = totalClients > 0 ? Math.round((closedDeals / totalClients) * 100) : 0;
    const viewingsThisMonth = vi.filter(v => v.viewing_date && new Date(v.viewing_date) >= monthAgo).length;
    const pendingApprovals = ap.length;
    const newClients30d = cl.filter(c => new Date(c.created_at) >= monthAgo).length;
    const followUp = cl.filter(c =>
      c.status === 'Active' &&
      (!c.updated_at || (now - new Date(c.updated_at)) > 7 * 24 * 60 * 60 * 1000)
    ).length;

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
    Analytics.renderViewingsOverTime(vi);
    Analytics.renderViewingsPerClient(vi);
    Analytics.renderStageDistribution(cl);
    Analytics.renderBudgetDistribution(cl);
    Analytics.renderViewingStatus(vi);
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
    const stages = ['Lost', 'Active Search', 'Under Contract', 'New/Viewing', 'In Offer', 'Closed'];
    const colors = ['#475569', '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444'];
    const counts = stages.map(s => clients.filter(c => c.stage === s).length);
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

  renderViewingsOverTime(viewings) {
    const dateMap = {};
    viewings.forEach(v => {
      if (!v.viewing_date) return;
      const d = v.viewing_date.substring(0, 10);
      dateMap[d] = (dateMap[d] || 0) + 1;
    });
    const dates = Object.keys(dateMap).sort().slice(-30);
    Analytics.destroy('viewings-time');
    const ctx = document.getElementById('chart-viewings-time');
    if (!ctx) return;
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

  renderViewingsPerClient(viewings) {
    const clientMap = {};
    viewings.forEach(v => { const n = v.client_name || 'Unknown'; clientMap[n] = (clientMap[n] || 0) + 1; });
    const sorted = Object.entries(clientMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
    Analytics.destroy('viewings-client');
    const ctx = document.getElementById('chart-viewings-client');
    if (!ctx) return;
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
    const stages = ['Lost', 'Active Search', 'Under Contract', 'New/Viewing', 'In Offer', 'Closed'];
    const colors = ['#475569', '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444'];
    const counts = stages.map(s => clients.filter(c => c.stage === s).length);
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
      const b = c.budget_max || c.budget_min || 0;
      if (b < 200000) counts[0]++;
      else if (b < 400000) counts[1]++;
      else if (b < 600000) counts[2]++;
      else if (b < 800000) counts[3]++;
      else counts[4]++;
    });
    Analytics.destroy('budget-dist');
    const ctx = document.getElementById('chart-budget-dist');
    if (!ctx) return;
    Analytics.charts['budget-dist'] = new Chart(ctx.getContext('2d'), {
      type: 'pie',
      data: { labels: ranges, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } } }
      }
    });
  },

  renderViewingStatus(viewings) {
    const statuses = ['Scheduled', 'Completed', 'Cancelled', 'No-Show'];
    const colors = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b'];
    const counts = statuses.map(s => viewings.filter(v => v.viewing_status === s).length);
    Analytics.destroy('viewing-status');
    const ctx = document.getElementById('chart-viewing-status');
    if (!ctx) return;
    Analytics.charts['viewing-status'] = new Chart(ctx.getContext('2d'), {
      type: 'pie',
      data: { labels: statuses, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } } }
      }
    });
  }
};
