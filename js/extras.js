// ── APPROVALS ──────────────────────────────────────────────────────────────
const Approvals = {
  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('approval_queue')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false }).limit(50);
    const el = document.getElementById('approvals-list');
    if (!data?.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">No pending approvals</div><div class="empty-sub">All caught up!</div></div>';
      return;
    }
    const pending = data.filter(a => a.status === 'Pending');
    const badge = document.getElementById('approvals-badge');
    if (badge) { badge.textContent = pending.length; badge.style.display = pending.length ? 'inline' : 'none'; }
    el.innerHTML = data.map(a => `
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <div style="flex:1;">
            <div class="fw-700">${a.client_name || 'Unknown'}</div>
            <div class="text-muted" style="font-size:12px;">${a.action_type || 'Approval'} · ${App.timeAgo(a.created_at)}</div>
          </div>
          <span class="stage-badge ${a.status==='Pending'?'badge-conditions':a.status==='Approved'?'badge-accepted':'badge-default'}">${a.status}</span>
        </div>
        ${a.details ? `<div style="font-size:13px;color:var(--text2);margin-bottom:10px;">${a.details}</div>` : ''}
        ${a.status === 'Pending' ? `
          <div style="display:flex;gap:8px;">
            <button class="btn btn-green btn-sm" onclick="Approvals.approve('${a.id}')">✅ Approve</button>
            <button class="btn btn-red btn-sm" onclick="Approvals.reject('${a.id}')">❌ Reject</button>
          </div>` : ''}
      </div>`).join('');
  },

  async approve(id) {
    await db.from('approval_queue').update({ status: 'Approved', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('✅ Approved!');
    Approvals.load();
  },

  async reject(id) {
    await db.from('approval_queue').update({ status: 'Rejected', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('❌ Rejected.');
    Approvals.load();
  }
};

// ── ACTIVITY LOG ────────────────────────────────────────────────────────────
const ActivityLog = {
  all: [],

  async load() {
    if (!currentAgent?.id) return;
    const { data, error } = await db.from('activity_log')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false }).limit(100);
    if (error) {
      document.getElementById('activity-list').innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No activity yet</div><div class="empty-sub">Actions you take will appear here</div></div>`;
      return;
    }
    ActivityLog.all = data || [];
    ActivityLog.render(ActivityLog.all);
  },

  search(q) {
    const filtered = ActivityLog.all.filter(a =>
      (a.description || '').toLowerCase().includes(q.toLowerCase()) ||
      (a.client_name || '').toLowerCase().includes(q.toLowerCase()) ||
      (a.activity_type || '').toLowerCase().includes(q.toLowerCase())
    );
    ActivityLog.render(filtered);
  },

  render(list) {
    const el = document.getElementById('activity-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No activity found</div></div>';
      return;
    }
    el.innerHTML = list.map(a => `
      <div class="activity-row">
        <div class="activity-icon">${App.activityIcon(a.activity_type)}</div>
        <div style="flex:1;">
          <div class="activity-title">${a.description || a.activity_type || 'Activity'}</div>
          <div class="activity-meta">${a.client_name ? `👤 ${a.client_name} · ` : ''}${App.fmtDate(a.created_at)} · ${App.timeAgo(a.created_at)}</div>
        </div>
        <span style="font-size:10px;color:var(--text3);background:var(--bg);padding:2px 8px;border-radius:20px;border:1px solid var(--border);">${(a.activity_type||'').replace(/_/g,' ')}</span>
      </div>`).join('');
  }
};

// ── COMMISSIONS ─────────────────────────────────────────────────────────────
const Commission = {
  all: [],

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('commissions')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    Commission.all = data || [];
    Commission.renderSummary(data || []);
    Commission.render(data || []);
    Commission.populateClients();
  },

  async populateClients() {
    const sel = document.getElementById('cm-client-sel');
    if (!sel) return;
    let clients = window.Clients?.all || [];
    if (!clients.length && currentAgent?.id) {
      const { data } = await db.from('clients').select('id,full_name').eq('agent_id', currentAgent.id).order('full_name');
      clients = data || [];
    }
    sel.innerHTML = '<option value="">-- Select Client --</option>' +
      clients.map(c => `<option value="${c.id}" data-name="${c.full_name}">${c.full_name}</option>`).join('');
  },

  calcPreview() {
    const sale = parseFloat(document.getElementById('cm-sale')?.value) || 0;
    const rate = parseFloat(document.getElementById('cm-rate')?.value) || 0;
    const brokerPct = parseFloat(document.getElementById('cm-broker')?.value) || 0;
    const taxPct = parseFloat(document.getElementById('cm-tax')?.value) || 0;
    const prev = document.getElementById('cm-preview');
    if (!prev) return;
    if (!sale || !rate) { prev.style.display = 'none'; return; }
    const gross = sale * rate / 100;
    const brokerFee = gross * brokerPct / 100;
    const netBeforeTax = gross - brokerFee;
    const tax = netBeforeTax * taxPct / 100;
    const net = netBeforeTax - tax;
    prev.style.display = 'block';
    prev.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr auto;gap:4px;">
        <span style="color:var(--text2);">Gross Commission (${rate}%):</span><span class="fw-700">${App.fmtMoney(gross)}</span>
        <span style="color:var(--text2);">Brokerage Fee (${brokerPct}%):</span><span style="color:var(--red);">-${App.fmtMoney(brokerFee)}</span>
        <span style="color:var(--text2);">HST / Tax (${taxPct}%):</span><span style="color:var(--red);">-${App.fmtMoney(tax)}</span>
        <span style="font-weight:800;color:var(--green);border-top:1px solid var(--border);padding-top:4px;margin-top:2px;">Net Earnings:</span><span style="font-weight:900;color:var(--green);border-top:1px solid var(--border);padding-top:4px;margin-top:2px;">${App.fmtMoney(net)}</span>
      </div>`;
  },

  renderSummary(list) {
    const totalVolume = list.reduce((s, c) => s + (c.sale_price || 0), 0);
    const grossComm = list.reduce((s, c) => s + (c.gross_commission || c.amount || 0), 0);
    const hst = list.reduce((s, c) => s + (c.tax_amount || 0), 0);
    const brokerFees = list.reduce((s, c) => s + (c.brokerage_fee_amount || 0), 0);
    const netEarnings = list.reduce((s, c) => s + (c.net_commission || c.amount || 0), 0);
    const closedDeals = list.filter(c => c.status === 'Paid').length;

    const banner = document.getElementById('comm-net-display');
    if (banner) banner.textContent = App.fmtMoney(netEarnings);

    document.getElementById('commissions-summary').innerHTML = `
      <div class="stat-card stat-blue"><div class="stat-num" style="font-size:18px;">${App.fmtMoney(totalVolume)}</div><div class="stat-label">Total Volume Sold</div></div>
      <div class="stat-card stat-gold"><div class="stat-num" style="font-size:18px;">${App.fmtMoney(grossComm)}</div><div class="stat-label">Gross Commission</div></div>
      <div class="stat-card stat-yellow"><div class="stat-num" style="font-size:18px;color:var(--yellow);">${App.fmtMoney(hst)}</div><div class="stat-label">HST / Tax Collected</div></div>
      <div class="stat-card stat-red"><div class="stat-num" style="font-size:18px;color:var(--red);">-${App.fmtMoney(brokerFees)}</div><div class="stat-label">Brokerage Fees</div></div>`;
  },

  render(list) {
    const el = document.getElementById('commissions-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-text">No commissions yet</div><div class="empty-sub">Use the form above to record your first commission</div></div>';
      return;
    }
    el.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Client</th>
          <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Property</th>
          <th style="padding:12px 16px;text-align:right;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Sale Price</th>
          <th style="padding:12px 16px;text-align:right;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Net Commission</th>
          <th style="padding:12px 16px;text-align:center;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Status</th>
          <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Close Date</th>
        </tr></thead>
        <tbody>${list.map(c => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:12px 16px;font-weight:700;">${c.client_name||'—'}</td>
            <td style="padding:12px 16px;font-size:13px;color:var(--text2);">${c.property_address||'—'}</td>
            <td style="padding:12px 16px;text-align:right;font-weight:700;">${App.fmtMoney(c.sale_price)}</td>
            <td style="padding:12px 16px;text-align:right;font-weight:800;color:var(--green);">${App.fmtMoney(c.net_commission||c.amount)}</td>
            <td style="padding:12px 16px;text-align:center;"><span class="stage-badge ${c.status==='Paid'?'badge-accepted':'badge-conditions'}">${c.status||'Pending'}</span></td>
            <td style="padding:12px 16px;font-size:13px;color:var(--text2);">${App.fmtDate(c.close_date)}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  },

  async saveNew() {
    const msg = document.getElementById('cm-msg');
    const clientSel = document.getElementById('cm-client-sel');
    const clientName = clientSel.options[clientSel.selectedIndex]?.dataset?.name || clientSel.value;
    const salePrice = parseFloat(document.getElementById('cm-sale')?.value) || 0;
    const property = document.getElementById('cm-property')?.value.trim();
    if (!salePrice || !property) { msg.style.color='var(--red)'; msg.textContent='⚠️ Property address and sale price are required'; return; }
    const rate = parseFloat(document.getElementById('cm-rate')?.value) || 2.5;
    const brokerPct = parseFloat(document.getElementById('cm-broker')?.value) || 20;
    const taxPct = parseFloat(document.getElementById('cm-tax')?.value) || 15;
    const gross = salePrice * rate / 100;
    const brokerFee = gross * brokerPct / 100;
    const netBeforeTax = gross - brokerFee;
    const tax = netBeforeTax * taxPct / 100;
    const net = netBeforeTax - tax;
    msg.textContent = 'Saving...'; msg.style.color = 'var(--text2)';
    const closeDate = document.getElementById('cm-close-date')?.value || null;
    // Try full insert first, fallback to minimal if extra columns don't exist
    const { error } = await db.from('commissions').insert({
      agent_id: currentAgent.id, client_name: clientName, property_address: property,
      sale_price: salePrice, amount: net, close_date: closeDate, status: 'Pending'
    });
    if (error) { msg.style.color='var(--red)'; msg.textContent=error.message; return; }
    App.toast('✅ Commission recorded!');
    msg.style.color='var(--green)'; msg.textContent='✅ Saved!';
    document.getElementById('cm-sale').value=''; document.getElementById('cm-property').value='';
    document.getElementById('cm-preview').style.display='none';
    Commission.load();
  }
};

// ── REPORTS ─────────────────────────────────────────────────────────────────
const Reports = {
  async load() {
    if (!currentAgent?.id) return;
    const [{ data: clients }, { data: pipeline }, { data: viewings }, { data: commissions }] = await Promise.all([
      db.from('clients').select('stage,status').eq('agent_id', currentAgent.id),
      db.from('pipeline').select('stage,offer_amount').eq('agent_id', currentAgent.id),
      db.from('viewings').select('viewing_status,viewing_date').eq('agent_id', currentAgent.id),
      db.from('commissions').select('amount,status').eq('agent_id', currentAgent.id)
    ]);

    // Pipeline summary
    const pipelineStages = {};
    (pipeline || []).forEach(p => { pipelineStages[p.stage] = (pipelineStages[p.stage] || 0) + 1; });
    document.getElementById('report-pipeline').innerHTML = Object.entries(pipelineStages).map(([s,c]) =>
      `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <span>${s}</span><span class="fw-700 text-accent">${c}</span>
      </div>`).join('') || '<div class="text-muted" style="font-size:13px;">No pipeline data</div>';

    // Client stages
    const stageCounts = {};
    (clients || []).forEach(c => { stageCounts[c.stage||'Unknown'] = (stageCounts[c.stage||'Unknown'] || 0) + 1; });
    document.getElementById('report-stages').innerHTML = Object.entries(stageCounts).map(([s,c]) =>
      `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <span>${s}</span><span class="fw-700 text-accent">${c}</span>
      </div>`).join('') || '<div class="text-muted" style="font-size:13px;">No clients</div>';

    // Viewings
    const vTotal = (viewings||[]).length;
    const vDone = (viewings||[]).filter(v => v.viewing_status === 'Completed').length;
    document.getElementById('report-viewings').innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;"><span>Total Viewings</span><span class="fw-700 text-accent">${vTotal}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;"><span>Completed</span><span class="fw-700 text-green">${vDone}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;"><span>Scheduled</span><span class="fw-700 text-yellow">${vTotal - vDone}</span></div>`;

    // Commissions
    const cTotal = (commissions||[]).reduce((s,c) => s + (c.amount||0), 0);
    const cPaid = (commissions||[]).filter(c=>c.status==='Paid').reduce((s,c) => s + (c.amount||0), 0);
    document.getElementById('report-commissions').innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;"><span>Total</span><span class="fw-700 text-yellow">${App.fmtMoney(cTotal)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;"><span>Paid Out</span><span class="fw-700 text-green">${App.fmtMoney(cPaid)}</span></div>`;
  }
};

// ── NEW BUILDS ──────────────────────────────────────────────────────────────
const NewBuilds = {
  all: [],
  msLabels: ['Lot Visited','Pre-Approval Sent to Builder','Plans / Design Stage','Agreement for Purchase & Sale (APS)','Client Decision on APS','Final Purchase & Sale Agreement Sent','All Documents Attached','Final Financing Approval','🎉 Client Takes Possession'],

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('new_builds')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    NewBuilds.all = data || [];
    NewBuilds.renderStats(data || []);
    NewBuilds.render(data || []);
    NewBuilds.populateClients();
  },

  async populateClients() {
    const sel = document.getElementById('nb-client-sel');
    if (!sel) return;
    let clients = window.Clients?.all || [];
    if (!clients.length && currentAgent?.id) {
      const { data } = await db.from('clients').select('id,full_name').eq('agent_id', currentAgent.id).order('full_name');
      clients = data || [];
    }
    sel.innerHTML = '<option value="">-- Select Existing Client --</option>' +
      clients.map(c => `<option value="${c.id}" data-name="${c.full_name}">${c.full_name}</option>`).join('');
  },

  renderStats(list) {
    const el = document.getElementById('newbuilds-stats');
    if (!el) return;
    const active = list.filter(b => b.status === 'Active').length;
    const now = new Date();
    const closing = list.filter(b => {
      if (!b.est_completion_date) return false;
      const d = new Date(b.est_completion_date);
      return d >= now && d <= new Date(now.getTime() + 30*24*60*60*1000);
    }).length;
    const totalVal = list.reduce((s, b) => s + (b.purchase_price || 0), 0);
    // Stage breakdown text
    const stageMap = {};
    list.forEach(b => { const s = b.current_stage || 'Unknown'; stageMap[s] = (stageMap[s]||0)+1; });
    const topStage = Object.entries(stageMap).sort((a,b)=>b[1]-a[1])[0];
    const stageText = list.length ? (topStage ? `${topStage[0]} (${topStage[1]})` : '—') : 'No active builds';
    el.innerHTML = `
      <div class="stat-card stat-blue"><div class="stat-num">${active}</div><div class="stat-label">Active Builds</div></div>
      <div class="stat-card stat-green"><div class="stat-num">${closing}</div><div class="stat-label">Closing This Month</div></div>
      <div class="stat-card stat-gold"><div class="stat-num">${App.fmtMoney(totalVal)}</div><div class="stat-label">Total Build Value</div></div>
      <div class="stat-card stat-purple"><div class="stat-num" style="font-size:13px;line-height:1.3;">${stageText}</div><div class="stat-label">Stage Breakdown</div></div>`;
  },

  toggleForm() {
    const wrap = document.getElementById('newbuilds-form-wrap');
    if (!wrap) return;
    const showing = wrap.style.display !== 'none';
    wrap.style.display = showing ? 'none' : 'block';
    if (!showing) NewBuilds.populateClients();
  },

  countMs() {
    const boxes = document.querySelectorAll('#newbuilds-form-wrap .nb-ms');
    const done = [...boxes].filter(b => b.checked).length;
    const el = document.getElementById('nb-ms-count');
    if (el) el.textContent = `${done} / 9 checked`;
  },

  render(list) {
    const el = document.getElementById('newbuilds-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🏗️</div><div class="empty-text">No active builds. Click + New Build to start tracking.</div></div>';
      return;
    }
    el.innerHTML = list.map(b => {
      const pm = b.pipeline_milestones || {};
      const done = NewBuilds.msLabels.filter((_, i) => pm[`step${i+1}`]?.done).length;
      const pct = Math.round((done / 9) * 100);
      return `<div class="card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="flex:1;">
            <div class="fw-800" style="font-size:15px;">${b.client_name||'—'}</div>
            <div class="text-muted" style="font-size:12px;">📍 ${b.lot_address||b.community||'—'} · ${b.builder||'—'}</div>
          </div>
          <span class="stage-badge badge-viewings">${b.status||'Active'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px;">
          <span>Milestone Progress</span><span class="fw-700 text-accent">${done}/9</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;margin-bottom:8px;">
          <div style="height:100%;width:${pct}%;background:var(--accent2);border-radius:3px;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;color:var(--text2);">
          ${b.current_stage ? `<div>📋 Stage: <span class="fw-700">${b.current_stage}</span></div>` : ''}
          ${b.purchase_price ? `<div>💰 Price: <span class="fw-700">${App.fmtMoney(b.purchase_price)}</span></div>` : ''}
          ${b.est_completion_date ? `<div>📅 Est. Completion: <span class="fw-700">${App.fmtDate(b.est_completion_date)}</span></div>` : ''}
          ${b.deposit_status ? `<div>🏦 Deposit: <span class="fw-700">${b.deposit_status}</span></div>` : ''}
        </div>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">
          ${NewBuilds.msLabels.map((s,i) => pm[`step${i+1}`]?.done
            ? `<span style="font-size:10px;background:rgba(16,185,129,0.15);color:var(--green);padding:2px 7px;border-radius:10px;">✓ ${s}</span>` : '').filter(Boolean).join('')}
        </div>
      </div>`;
    }).join('');
  },

  async save() {
    const st = document.getElementById('nb-status');
    if (!st) return;
    const clientSel = document.getElementById('nb-client-sel');
    const clientName = clientSel.options[clientSel.selectedIndex]?.dataset?.name || '';
    if (!clientName) { st.style.color='var(--red)'; st.textContent='⚠️ Please select a client'; return; }
    st.textContent = 'Saving...'; st.style.color = 'var(--text2)';
    const boxes = document.querySelectorAll('#newbuilds-form-wrap .nb-ms');
    const milestones = {};
    boxes.forEach((b, i) => { milestones[`step${i+1}`] = { done: b.checked, label: NewBuilds.msLabels[i] }; });
    const { error } = await db.from('new_builds').insert({
      agent_id: currentAgent.id,
      client_name: clientName,
      builder: document.getElementById('nb-builder')?.value.trim() || '',
      lot_address: document.getElementById('nb-lot-address')?.value.trim() || '',
      purchase_price: parseFloat(document.getElementById('nb-price')?.value) || 0,
      current_stage: document.getElementById('nb-stage')?.value || 'Lot Identified',
      est_completion_date: document.getElementById('nb-completion')?.value || null,
      flooring_selection: document.getElementById('nb-flooring')?.value.trim() || '',
      builder_contact: document.getElementById('nb-builder-contact')?.value.trim() || '',
      notes: document.getElementById('nb-notes')?.value.trim() || '',
      deposit_amount: parseFloat(document.getElementById('nb-deposit-amount')?.value) || 0,
      deposit_date: document.getElementById('nb-deposit-date')?.value || null,
      deposit_status: document.getElementById('nb-deposit-status')?.value || 'Pending',
      pa_submitted_date: document.getElementById('nb-pa-submitted')?.value || null,
      pa_accepted_date: document.getElementById('nb-pa-accepted')?.value || null,
      pipeline_milestones: milestones,
      status: 'Active'
    });
    if (error) {
      // Fallback to minimal fields
      const { error: e2 } = await db.from('new_builds').insert({
        agent_id: currentAgent.id,
        client_name: clientName,
        builder: document.getElementById('nb-builder')?.value.trim() || '',
        community: document.getElementById('nb-lot-address')?.value.trim() || '',
        purchase_price: parseFloat(document.getElementById('nb-price')?.value) || 0,
        notes: document.getElementById('nb-notes')?.value.trim() || '',
        status: 'Active',
        pipeline_milestones: milestones
      });
      if (e2) { st.style.color='var(--red)'; st.textContent=e2.message; return; }
    }
    App.toast('✅ New Build created!');
    NewBuilds.toggleForm();
    NewBuilds.load();
  }
};

// ── EMAIL SEND ──────────────────────────────────────────────────────────────
const EmailSend = {
  templates: {
    viewing_scheduled: { subject: 'Your Viewing is Confirmed! 🏠', body: `Hi [CLIENT_NAME],\n\nGreat news! Your property viewing has been scheduled. I'm looking forward to showing you the property and helping you find your perfect home.\n\nPlease don't hesitate to reach out if you have any questions beforehand.\n\nBest regards,\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` },
    offer_submitted: { subject: 'Your Offer Has Been Submitted 📄', body: `Hi [CLIENT_NAME],\n\nI wanted to let you know that your offer has been officially submitted. I'll keep you updated as soon as we hear back from the sellers.\n\nFeel free to reach out if you have any questions.\n\nBest regards,\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` },
    offer_accepted: { subject: 'Congratulations — Your Offer Was Accepted! 🎉', body: `Hi [CLIENT_NAME],\n\nFantastic news — your offer has been ACCEPTED! This is such an exciting milestone and I'm thrilled for you.\n\nWe'll now begin the next steps in the process. I'll be in touch shortly with all the details.\n\nCongratulations again!\n\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` },
    conditions_met: { subject: 'Conditions Have Been Met ✅', body: `Hi [CLIENT_NAME],\n\nAll conditions on your purchase have been satisfied and the deal is now firm. We're moving forward!\n\nI'll keep you updated on the closing timeline.\n\nBest regards,\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` },
    property_report: { subject: 'Your Property Report is Ready 📊', body: `Hi [CLIENT_NAME],\n\nI've put together a property report based on your search criteria. Please review the attached listings and let me know which ones interest you.\n\nHappy to schedule viewings for any properties you'd like to see!\n\nBest regards,\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` },
    follow_up: { subject: 'Checking In — How Are Things Going? 👋', body: `Hi [CLIENT_NAME],\n\nI just wanted to check in and see how your home search is going. The market has some great options right now and I'd love to help you find the right fit.\n\nAre there any properties you'd like to view, or any questions I can answer for you?\n\nLooking forward to hearing from you!\n\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` }
  },

  async init() {
    const sel = document.getElementById('email-client');
    if (!sel) return;
    // Use cached clients or fetch fresh from DB
    let clients = window.Clients?.all || [];
    if (!clients.length && currentAgent?.id) {
      const { data } = await db.from('clients')
        .select('id,full_name,email').eq('agent_id', currentAgent.id).order('full_name');
      clients = data || [];
    }
    sel.innerHTML = '<option value="">— Choose a client —</option>' +
      clients.map(c => `<option value="${c.id}" data-name="${c.full_name}" data-email="${c.email || ''}">${c.full_name} — ${c.email || 'no email'}</option>`).join('');
    // Pre-load follow-up template
    EmailSend.loadTemplate();
  },

  loadTemplate() {
    const key = document.getElementById('email-template').value;
    const t = EmailSend.templates[key];
    if (!t) return;
    document.getElementById('email-subject').value = t.subject;
    const clientSel = document.getElementById('email-client');
    const clientName = clientSel.options[clientSel.selectedIndex]?.dataset?.name || 'there';
    const body = document.getElementById('email-body');
    if (body) body.innerHTML = t.body.replace('[CLIENT_NAME]', clientName).replace(/\n/g, '<br>');
  },

  formatBlock(tag, editorId) {
    const el = document.getElementById(editorId);
    if (el) el.focus();
    document.execCommand('formatBlock', false, tag);
  },

  insertLink(editorId) {
    const el = document.getElementById(editorId);
    if (el) el.focus();
    const url = prompt('Enter URL:');
    if (url) document.execCommand('createLink', false, url);
  },

  getBodyText(editorId) {
    const el = document.getElementById(editorId);
    return el ? el.innerText.trim() : '';
  },

  getBodyHtml(editorId) {
    const el = document.getElementById(editorId);
    return el ? el.innerHTML.trim() : '';
  },

  preview() {
    const subject = document.getElementById('email-subject').value;
    const body = EmailSend.getBodyHtml('email-body');
    App.openModal(`
      <div class="modal-title">👁 Email Preview</div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">SUBJECT</div>
        <div class="fw-700">${subject || '(no subject)'}</div>
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;font-size:13px;line-height:1.6;">${body || '(no content)'}</div>
    `);
  },

  send() {
    const st = document.getElementById('email-status');
    const clientSel = document.getElementById('email-client');
    const opt = clientSel.options[clientSel.selectedIndex];
    if (!opt?.value) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Please select a client'; return; }
    const subject = document.getElementById('email-subject').value.trim();
    const bodyText = EmailSend.getBodyText('email-body');
    if (!subject) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Subject is required'; return; }
    const attachment = document.getElementById('email-attachment').value.trim();
    const fullBody = bodyText + (attachment ? `\n\nAttachment: ${attachment}` : '');
    window.open(`mailto:${opt.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`);
    App.toast('📨 Email client opened!');
    App.logActivity('EMAIL_SENT', opt.dataset.name, opt.dataset.email, `Email sent: ${subject}`);
    st.style.color = 'var(--green)';
    st.textContent = '✅ Email opened in your mail app!';
    // Log to inbox
    if (currentAgent?.id) {
      db.from('email_inbox').insert({
        agent_id: currentAgent.id,
        direction: 'sent',
        recipient_name: opt.dataset.name,
        recipient_email: opt.dataset.email,
        subject,
        body: bodyText
      }).then(() => {});
    }
  },

  sendExternal() {
    const st = document.getElementById('ext-status');
    const toEmail = document.getElementById('ext-email').value.trim();
    const toName = document.getElementById('ext-name').value.trim();
    const subject = document.getElementById('ext-subject').value.trim();
    const bodyText = EmailSend.getBodyText('ext-body');
    const cc = document.getElementById('ext-cc').value.trim();
    const attachment = document.getElementById('ext-attachment').value.trim();
    if (!toEmail) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Recipient email is required'; return; }
    if (!subject) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Subject is required'; return; }
    const fullBody = bodyText + (attachment ? `\n\nAttachment: ${attachment}` : '');
    let mailto = `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fullBody)}`;
    if (cc) mailto += `&cc=${encodeURIComponent(cc)}`;
    window.open(mailto);
    App.toast('📨 External email client opened!');
    st.style.color = 'var(--green)';
    st.textContent = '✅ Email opened in your mail app!';
    // Log to inbox
    if (currentAgent?.id) {
      db.from('email_inbox').insert({
        agent_id: currentAgent.id,
        direction: 'sent',
        recipient_name: toName,
        recipient_email: toEmail,
        subject,
        body: bodyText
      }).then(() => {});
    }
  },

  handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length) {
      const dz = document.getElementById('ext-drop-zone');
      dz.textContent = `📎 ${files[0].name} (${(files[0].size/1024).toFixed(1)} KB) — attached`;
    }
  },

  showDropFile(input) {
    if (input.files.length) {
      const dz = document.getElementById('ext-drop-zone');
      dz.textContent = `📎 ${input.files[0].name} — ready to attach`;
    }
  }
};
