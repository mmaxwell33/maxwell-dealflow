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
    const hst = gross * taxPct / 100;
    const grossPlusTax = gross + hst;
    const brokerFee = gross * brokerPct / 100;
    const net = grossPlusTax - brokerFee;
    prev.style.display = 'block';
    prev.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr auto;gap:4px;font-size:13px;">
        <span style="color:var(--text2);">Gross Commission (${rate}%):</span><span class="fw-700">${App.fmtMoney(gross)}</span>
        <span style="color:var(--text2);">HST / Tax (${taxPct}% on gross):</span><span style="color:var(--yellow);">+${App.fmtMoney(hst)}</span>
        <span style="color:var(--text2);">Gross + Tax:</span><span class="fw-700">${App.fmtMoney(grossPlusTax)}</span>
        <span style="color:var(--text2);">Brokerage Fee (${brokerPct}% on gross):</span><span style="color:var(--red);">-${App.fmtMoney(brokerFee)}</span>
        <span style="font-weight:800;color:var(--green);border-top:1px solid var(--border);padding-top:6px;margin-top:4px;">Net Earnings:</span><span style="font-weight:900;color:var(--green);border-top:1px solid var(--border);padding-top:6px;margin-top:4px;">${App.fmtMoney(net)}</span>
      </div>`;
  },

  renderSummary(list) {
    const totalVolume = list.reduce((s, c) => s + (c.sale_price || 0), 0);
    const grossComm = list.reduce((s, c) => s + (c.gross_commission || 0), 0);
    const hst = list.reduce((s, c) => s + (c.tax_amount || 0), 0);
    const brokerFees = list.reduce((s, c) => s + (c.brokerage_fee_amount || 0), 0);
    const netEarnings = list.reduce((s, c) => s + (c.net_commission || c.amount || 0), 0);
    const closedDeals = list.filter(c => c.status === 'Paid').length;

    const banner = document.getElementById('comm-net-display');
    if (banner) banner.textContent = App.fmtMoney(netEarnings);

    document.getElementById('commissions-summary').innerHTML = `
      <div class="stat-card stat-blue"><div class="stat-num" style="font-size:16px;">${App.fmtMoney(totalVolume)}</div><div class="stat-label">Total Volume Sold</div></div>
      <div class="stat-card stat-gold"><div class="stat-num" style="font-size:16px;">${App.fmtMoney(grossComm)}</div><div class="stat-label">Gross Commission</div></div>
      <div class="stat-card stat-yellow"><div class="stat-num" style="font-size:16px;color:var(--yellow);">${App.fmtMoney(hst)}</div><div class="stat-label">HST / Tax</div></div>
      <div class="stat-card stat-red"><div class="stat-num" style="font-size:16px;color:var(--red);">-${App.fmtMoney(brokerFees)}</div><div class="stat-label">Brokerage Fees</div></div>
      <div class="stat-card" style="border-left:3px solid var(--green);"><div class="stat-num" style="font-size:22px;color:var(--green);">${closedDeals}</div><div class="stat-label">Closed Deals</div></div>`;
  },

  render(list) {
    const el = document.getElementById('commissions-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-text">No commissions yet</div><div class="empty-sub">Use the form above to record your first commission</div></div>';
      return;
    }
    const th = (label, align) => `<th style="padding:10px 14px;text-align:${align||'left'};font-size:10px;color:var(--text2);font-weight:800;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">${label}</th>`;
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:12px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:1px;">
          📋 Commission History &nbsp;<span style="color:var(--accent2);">(${list.length} record${list.length!==1?'s':''})</span>
        </div>
        <button class="btn btn-outline btn-sm" onclick="Commission.load()">🔄 Refresh</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:720px;">
          <thead><tr style="border-bottom:2px solid var(--border);background:var(--bg);">
            ${th('Deal ID')}${th('Client')}${th('Property')}${th('Gross','right')}${th('HST','right')}${th('Fee','right')}${th('Net','right')}${th('Date')}${th('Status','center')}
          </tr></thead>
          <tbody>${list.map(c => `
            <tr style="border-bottom:1px solid var(--border);" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
              <td style="padding:11px 14px;font-size:10px;color:var(--text3);font-family:monospace;letter-spacing:0.5px;">#${(c.id||'').slice(-6).toUpperCase()}</td>
              <td style="padding:11px 14px;font-weight:700;white-space:nowrap;">${c.client_name||'—'}</td>
              <td style="padding:11px 14px;font-size:12px;color:var(--text2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.property_address||'—'}</td>
              <td style="padding:11px 14px;text-align:right;font-weight:700;">${App.fmtMoney(c.gross_commission||0)}</td>
              <td style="padding:11px 14px;text-align:right;color:var(--yellow);">+${App.fmtMoney(c.tax_amount||0)}</td>
              <td style="padding:11px 14px;text-align:right;color:var(--red);">-${App.fmtMoney(c.brokerage_fee_amount||0)}</td>
              <td style="padding:11px 14px;text-align:right;font-weight:900;color:var(--green);">${App.fmtMoney(c.net_commission||c.amount||0)}</td>
              <td style="padding:11px 14px;font-size:12px;color:var(--text2);white-space:nowrap;">${App.fmtDate(c.close_date)}</td>
              <td style="padding:11px 14px;text-align:center;"><span class="stage-badge ${c.status==='Paid'?'badge-accepted':'badge-conditions'}">${c.status||'Pending'}</span></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
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
    // Correct formula: HST adds to gross; brokerage is on gross only
    const gross = salePrice * rate / 100;
    const hst = gross * taxPct / 100;
    const grossPlusTax = gross + hst;
    const brokerFee = gross * brokerPct / 100;
    const net = grossPlusTax - brokerFee;
    msg.textContent = 'Saving...'; msg.style.color = 'var(--text2)';
    const closeDate = document.getElementById('cm-close-date')?.value || null;
    const { error } = await db.from('commissions').insert({
      agent_id: currentAgent.id, client_name: clientName, property_address: property,
      sale_price: salePrice, gross_commission: gross, tax_amount: hst,
      brokerage_fee_amount: brokerFee, net_commission: net,
      amount: net, close_date: closeDate, status: 'Pending'
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
    await Reports.populateClients();
    const [{ data: clients }, { data: pipeline }, { data: viewings }, { data: commissions }] = await Promise.all([
      db.from('clients').select('stage,status').eq('agent_id', currentAgent.id),
      db.from('pipeline').select('stage').eq('agent_id', currentAgent.id),
      db.from('viewings').select('viewing_status').eq('agent_id', currentAgent.id),
      db.from('commissions').select('net_commission,amount,status').eq('agent_id', currentAgent.id)
    ]);
    const activeClients = (clients||[]).filter(c => c.status !== 'Lost').length;
    const closedDeals = (pipeline||[]).filter(p => p.stage === 'Closed').length;
    const totalViewings = (viewings||[]).length;
    const totalNet = (commissions||[]).reduce((s,c) => s + (c.net_commission||c.amount||0), 0);
    const el = document.getElementById('rpt-quick-stats');
    if (el) el.innerHTML = `
      <div class="card"><div class="fw-800" style="margin-bottom:12px;">📈 Quick Overview</div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;"><span>Active Clients</span><span class="fw-700" style="color:var(--accent2);">${activeClients}</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;"><span>Closed Deals</span><span class="fw-700" style="color:var(--green);">${closedDeals}</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;"><span>Total Viewings</span><span class="fw-700" style="color:var(--accent2);">${totalViewings}</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;"><span>Net Commissions</span><span class="fw-700" style="color:var(--green);">${App.fmtMoney(totalNet)}</span></div>
      </div>
      <div class="card"><div class="fw-800" style="margin-bottom:12px;">💡 How to Use</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.8;">
          1. Select a client from the dropdown<br>
          2. Check the sections to include<br>
          3. Add any agent notes<br>
          4. Preview or send directly to client
        </div>
      </div>`;
  },

  async populateClients() {
    const sel = document.getElementById('rpt-client-sel');
    if (!sel) return;
    let clients = window.Clients?.all || [];
    if (!clients.length && currentAgent?.id) {
      const { data } = await db.from('clients').select('id,full_name,email').eq('agent_id', currentAgent.id).order('full_name');
      clients = data || [];
    }
    sel.innerHTML = '<option value="">-- Select Client --</option>' +
      clients.map(c => `<option value="${c.id}" data-email="${c.email||''}">${c.full_name}</option>`).join('');
  },

  async buildReport(clientId) {
    const { data: client } = await db.from('clients').select('*').eq('id', clientId).single();
    if (!client) return null;
    const [{ data: viewings }, { data: offers }] = await Promise.all([
      db.from('viewings').select('*').eq('client_id', clientId).order('viewing_date', { ascending: false }),
      db.from('pipeline').select('*').eq('agent_id', currentAgent.id)
    ]);
    const clientOffers = (offers||[]).filter(o => o.client_name === client.full_name);
    const sections = {
      info:      document.getElementById('rpt-sec-info')?.checked,
      criteria:  document.getElementById('rpt-sec-criteria')?.checked,
      viewings:  document.getElementById('rpt-sec-viewings')?.checked,
      offers:    document.getElementById('rpt-sec-offers')?.checked,
      stage:     document.getElementById('rpt-sec-stage')?.checked,
      nextsteps: document.getElementById('rpt-sec-nextsteps')?.checked
    };
    const notes = document.getElementById('rpt-notes')?.value.trim();
    const agentName = currentAgent.full_name || currentAgent.email || 'Your Agent';
    const dateStr = new Date().toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' });

    let html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#1e293b;">
      <h2 style="color:#0f172a;border-bottom:3px solid #0ea5e9;padding-bottom:12px;margin-bottom:4px;">📋 Client Report — ${client.full_name}</h2>
      <p style="color:#64748b;font-size:12px;margin-top:0;">Generated ${dateStr} · Agent: ${agentName}</p>`;

    if (sections.info) {
      html += `<h3 style="color:#0ea5e9;margin-top:20px;">👤 Client Information</h3>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          ${client.email ? `<tr><td style="padding:5px 0;color:#64748b;width:150px;">Email</td><td>${client.email}</td></tr>` : ''}
          ${client.phone ? `<tr><td style="padding:5px 0;color:#64748b;">Phone</td><td>${client.phone}</td></tr>` : ''}
          ${client.stage ? `<tr><td style="padding:5px 0;color:#64748b;">Stage</td><td><strong>${client.stage}</strong></td></tr>` : ''}
          ${client.status ? `<tr><td style="padding:5px 0;color:#64748b;">Status</td><td>${client.status}</td></tr>` : ''}
        </table>`;
    }

    if (sections.criteria) {
      html += `<h3 style="color:#0ea5e9;margin-top:20px;">🔍 Search Criteria</h3>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          ${(client.budget_min||client.budget_max) ? `<tr><td style="padding:5px 0;color:#64748b;width:150px;">Budget</td><td>${App.fmtMoney(client.budget_min)} – ${App.fmtMoney(client.budget_max)}</td></tr>` : ''}
          ${client.preferred_areas ? `<tr><td style="padding:5px 0;color:#64748b;">Areas</td><td>${client.preferred_areas}</td></tr>` : ''}
          ${client.bedrooms ? `<tr><td style="padding:5px 0;color:#64748b;">Bedrooms</td><td>${client.bedrooms}+</td></tr>` : ''}
          ${client.property_type ? `<tr><td style="padding:5px 0;color:#64748b;">Property Type</td><td>${client.property_type}</td></tr>` : ''}
        </table>`;
    }

    if (sections.viewings) {
      html += `<h3 style="color:#0ea5e9;margin-top:20px;">🏠 Properties Viewed (${(viewings||[]).length})</h3>`;
      if (!(viewings||[]).length) {
        html += `<p style="font-size:13px;color:#64748b;">No viewings recorded yet.</p>`;
      } else {
        html += `<table style="width:100%;font-size:13px;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;">
          <thead><tr style="background:#f1f5f9;"><th style="padding:8px 12px;text-align:left;">Property</th><th style="padding:8px 12px;text-align:left;">Date</th><th style="padding:8px 12px;text-align:left;">Status</th></tr></thead>
          <tbody>${(viewings||[]).slice(0,10).map(v => `
            <tr style="border-top:1px solid #e2e8f0;">
              <td style="padding:8px 12px;">${v.property_address||'—'}</td>
              <td style="padding:8px 12px;">${App.fmtDate(v.viewing_date)}</td>
              <td style="padding:8px 12px;">${v.viewing_status||'—'}</td>
            </tr>`).join('')}</tbody>
        </table>`;
      }
    }

    if (sections.offers) {
      html += `<h3 style="color:#0ea5e9;margin-top:20px;">📝 Offers Made (${clientOffers.length})</h3>`;
      if (!clientOffers.length) {
        html += `<p style="font-size:13px;color:#64748b;">No offers recorded yet.</p>`;
      } else {
        html += `<table style="width:100%;font-size:13px;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead><tr style="background:#f1f5f9;"><th style="padding:8px 12px;text-align:left;">Property</th><th style="padding:8px 12px;text-align:right;">Offer Amount</th><th style="padding:8px 12px;text-align:left;">Stage</th></tr></thead>
          <tbody>${clientOffers.map(o => `
            <tr style="border-top:1px solid #e2e8f0;">
              <td style="padding:8px 12px;">${o.property_address||'—'}</td>
              <td style="padding:8px 12px;text-align:right;font-weight:700;">${App.fmtMoney(o.offer_amount)}</td>
              <td style="padding:8px 12px;">${o.stage||'—'}</td>
            </tr>`).join('')}</tbody>
        </table>`;
      }
    }

    if (sections.stage) {
      html += `<h3 style="color:#0ea5e9;margin-top:20px;">📍 Current Stage</h3>
        <p style="font-size:13px;background:#f0fdf4;padding:12px;border-radius:6px;border-left:3px solid #10b981;">
          <strong>${client.stage || 'Not set'}</strong>${client.status ? ` &nbsp;·&nbsp; ${client.status}` : ''}
        </p>
        ${client.notes ? `<p style="font-size:13px;color:#475569;background:#f8fafc;padding:10px;border-radius:6px;">${client.notes}</p>` : ''}`;
    }

    if (sections.nextsteps) {
      const stageSteps = {
        'New Lead': ['Schedule initial consultation','Understand search criteria & budget','Set up MLS listing alerts'],
        'Active Search': ['Continue reviewing new listings','Schedule upcoming viewings','Refine search criteria based on feedback'],
        'Viewing': ['Review all viewed properties together','Identify top choices','Prepare for offer process'],
        'In Offer': ['Monitor offer status','Prepare conditions response','Keep client updated on timelines'],
        'Under Contract': ['Track all condition deadlines','Coordinate with lawyer & lender','Prepare for walkthrough & closing'],
        'Closed': ['Send post-closing follow-up','Request Google review or referral','Stay in touch for future needs']
      };
      const steps = stageSteps[client.stage] || ['Follow up within 7 days','Keep client updated on market activity','Schedule next check-in call'];
      html += `<h3 style="color:#0ea5e9;margin-top:20px;">🚀 Next Steps</h3>
        <ul style="font-size:13px;color:#374151;line-height:2.2;padding-left:20px;">
          ${steps.map(s => `<li>${s}</li>`).join('')}
        </ul>`;
    }

    if (notes) {
      html += `<h3 style="color:#0ea5e9;margin-top:20px;">📌 Agent Notes</h3>
        <p style="font-size:13px;color:#374151;background:#fffbeb;padding:14px;border-radius:6px;border-left:3px solid #f59e0b;">${notes}</p>`;
    }

    html += `<p style="font-size:11px;color:#94a3b8;margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;">
      Generated by Maxwell DealFlow CRM &nbsp;·&nbsp; ${agentName}
    </p></div>`;
    return { client, html };
  },

  async preview() {
    const sel = document.getElementById('rpt-client-sel');
    const msg = document.getElementById('rpt-msg');
    if (!sel?.value) { msg.style.color='var(--red)'; msg.textContent='⚠️ Please select a client first'; return; }
    msg.textContent = '⏳ Building preview...'; msg.style.color='var(--text2)';
    const result = await Reports.buildReport(sel.value);
    if (!result) { msg.style.color='var(--red)'; msg.textContent='⚠️ Could not load client data'; return; }
    msg.textContent = '';
    App.openModal(`
      <div class="modal-title" style="margin-bottom:12px;">👁 Report Preview — ${result.client.full_name}</div>
      <div style="max-height:65vh;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:16px;background:#fff;">
        ${result.html}
      </div>
    `);
  },

  async sendToClient() {
    const sel = document.getElementById('rpt-client-sel');
    const msg = document.getElementById('rpt-msg');
    if (!sel?.value) { msg.style.color='var(--red)'; msg.textContent='⚠️ Please select a client first'; return; }
    msg.textContent = '⏳ Building report...'; msg.style.color='var(--text2)';
    const result = await Reports.buildReport(sel.value);
    if (!result) { msg.style.color='var(--red)'; msg.textContent='⚠️ Could not load client data'; return; }
    const { client, html } = result;
    if (!client.email) { msg.style.color='var(--red)'; msg.textContent='⚠️ This client has no email on file'; return; }
    App.switchTab('email');
    setTimeout(() => {
      const clientSel = document.getElementById('email-client');
      if (clientSel) {
        for (let i = 0; i < clientSel.options.length; i++) {
          if (clientSel.options[i].value === client.id) { clientSel.selectedIndex = i; break; }
        }
        if (window.EmailSend?.onClientChange) EmailSend.onClientChange();
      }
      const subj = document.getElementById('email-subject');
      const body = document.getElementById('email-body');
      if (subj) subj.value = `Your Property Update — ${client.full_name}`;
      if (body) body.innerHTML = html;
    }, 350);
    App.toast('📋 Report ready in Email tab — review & send!');
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
    await NewBuilds.populateClients();
    NewBuilds.render(data || []);
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
    if (!showing) {
      NewBuilds.populateClients();
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  countMs() {
    const boxes = document.querySelectorAll('#newbuilds-form-wrap .nb-ms');
    const done = [...boxes].filter(b => b.checked).length;
    const el = document.getElementById('nb-ms-count');
    if (el) el.textContent = `${done} / 9 checked`;
  },

  // Maps milestone count → pipeline stage
  getStage(done) {
    if (done >= 9) return 'Closed';
    if (done >= 7) return 'Closing';
    if (done >= 4) return 'Conditions';
    return 'Accepted';
  },

  render(list) {
    const el = document.getElementById('newbuilds-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🏗️</div><div class="empty-text">No active builds yet</div><div class="empty-sub">Fill in the form above and click 📐 Create New Build — your build cards with milestone tracking and pipeline sync will appear here.</div></div>';
      return;
    }
    el.innerHTML = list.map(b => {
      const pm = b.pipeline_milestones || {};
      const done = NewBuilds.msLabels.filter((_, i) => pm[`step${i+1}`]?.done).length;
      const pct = Math.round((done / 9) * 100);
      const pipelineStage = NewBuilds.getStage(done);
      const barColor = done === 9 ? 'var(--green)' : done >= 7 ? 'var(--purple)' : done >= 4 ? 'var(--yellow)' : 'var(--accent2)';
      const stageColors = { Closed:'var(--green)', Closing:'var(--purple)', Conditions:'var(--yellow)', Accepted:'var(--accent2)' };
      return `<div class="card" style="margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="flex:1;">
            <div class="fw-800" style="font-size:15px;">${b.client_name||'—'}</div>
            <div class="text-muted" style="font-size:12px;">📍 ${b.lot_address||b.community||'—'} · 🏗️ ${b.builder||'—'}</div>
          </div>
          <span class="stage-badge badge-viewings">${b.status||'Active'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
          <span style="color:var(--text2);">Pipeline Stage:</span>
          <span class="fw-800" style="color:${stageColors[pipelineStage]||'var(--accent2)'};">${pipelineStage} · ${done}/9 milestones</span>
        </div>
        <div style="height:8px;background:var(--border);border-radius:4px;margin-bottom:10px;position:relative;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:width 0.4s;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;color:var(--text2);margin-bottom:10px;">
          ${b.purchase_price ? `<div>💰 <span class="fw-700">${App.fmtMoney(b.purchase_price)}</span></div>` : ''}
          ${b.est_completion_date ? `<div>📅 Est. Close: <span class="fw-700">${App.fmtDate(b.est_completion_date)}</span></div>` : ''}
          ${b.deposit_status ? `<div>🏦 Deposit: <span class="fw-700">${b.deposit_status}</span></div>` : ''}
          ${b.builder_contact ? `<div>👤 Contact: <span class="fw-700">${b.builder_contact}</span></div>` : ''}
        </div>
        <!-- Interactive Milestones -->
        <div style="margin-bottom:10px;">
          ${NewBuilds.msLabels.map((label, i) => {
            const checked = pm[`step${i+1}`]?.done;
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg);border-radius:5px;margin-bottom:3px;${checked?'border-left:2px solid var(--green);':''}">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;${checked?'color:var(--green);font-weight:600;':'color:var(--text2);'}">
                <input type="checkbox" class="nb-ms-card-${b.id}" onchange="NewBuilds.liveCount('${b.id}')" ${checked?'checked':''} style="width:14px;height:14px;cursor:pointer;">
                ${i+1}. ${label}
              </label>
              <span style="font-size:10px;${checked?'color:var(--green);':'color:var(--accent2);'}opacity:0.8;">${checked?'✓ Done':'Pending'}</span>
            </div>`;
          }).join('')}
        </div>
        <div id="nb-stage-preview-${b.id}" style="font-size:12px;color:var(--text2);margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="NewBuilds.updateMilestones('${b.id}')">💾 Save &amp; Sync Pipeline</button>
          <button class="btn btn-outline btn-sm" onclick="NewBuilds.notifyClient('${b.id}')">📧 Notify Client</button>
        </div>
        <div id="nb-card-msg-${b.id}" style="margin-top:6px;font-size:12px;"></div>
      </div>`;
    }).join('');
  },

  liveCount(id) {
    const boxes = document.querySelectorAll(`.nb-ms-card-${id}`);
    const done = [...boxes].filter(b => b.checked).length;
    const stage = NewBuilds.getStage(done);
    const prev = document.getElementById(`nb-stage-preview-${id}`);
    if (prev) prev.innerHTML = `→ Pipeline will update to: <span class="fw-700" style="color:var(--accent2);">${stage}</span> (${done}/9)`;
  },

  async updateMilestones(id) {
    const b = NewBuilds.all.find(x => x.id === id);
    if (!b) return;
    const boxes = document.querySelectorAll(`.nb-ms-card-${id}`);
    const milestones = {};
    boxes.forEach((box, i) => { milestones[`step${i+1}`] = { done: box.checked, label: NewBuilds.msLabels[i] }; });
    const done = [...boxes].filter(b => b.checked).length;
    const pipelineStage = NewBuilds.getStage(done);
    const isComplete = done === 9;
    const msg = document.getElementById(`nb-card-msg-${id}`);
    if (msg) { msg.style.color='var(--text2)'; msg.textContent='Saving...'; }

    // Save milestones to DB
    await db.from('new_builds').update({
      pipeline_milestones: milestones,
      status: isComplete ? 'Complete' : 'Active',
      updated_at: new Date().toISOString()
    }).eq('id', id);

    // Auto-sync pipeline stage + closing date
    await NewBuilds.syncPipeline(b, pipelineStage);

    if (msg) { msg.style.color='var(--green)'; msg.textContent=`✅ Saved! Pipeline → ${pipelineStage}`; }
    App.toast(`✅ Milestones saved · Pipeline → ${pipelineStage}`);

    if (isComplete) {
      setTimeout(() => App.toast('🎉 All milestones complete! Client has taken possession.'), 1000);
    }

    // After save, offer to notify client
    setTimeout(() => NewBuilds.notifyClient(id, pipelineStage, done), 600);
    NewBuilds.load();
  },

  async syncPipeline(build, pipelineStage) {
    const { data: existing } = await db.from('pipeline')
      .select('id').eq('agent_id', currentAgent.id).eq('client_name', build.client_name).limit(1);
    const updates = {
      stage: pipelineStage,
      updated_at: new Date().toISOString(),
      ...(build.est_completion_date ? { closing_date: build.est_completion_date } : {})
    };
    if (existing?.length) {
      await db.from('pipeline').update(updates).eq('id', existing[0].id);
    } else {
      await db.from('pipeline').insert({
        pipeline_id: 'BUILD-' + Date.now(),
        agent_id: currentAgent.id,
        client_name: build.client_name,
        property_address: build.lot_address || build.community || 'New Build',
        offer_amount: build.purchase_price || 0,
        acceptance_date: (build.created_at || new Date().toISOString()).slice(0,10),
        closing_date: build.est_completion_date || null,
        stage: pipelineStage,
        status: 'Active'
      });
    }
    if (typeof Pipeline !== 'undefined') Pipeline.load();
  },

  notifyClient(id, autoStage, autoDone) {
    const b = NewBuilds.all.find(x => x.id === id);
    if (!b) return;
    const pm = b.pipeline_milestones || {};
    const done = autoDone ?? NewBuilds.msLabels.filter((_, i) => pm[`step${i+1}`]?.done).length;
    const stage = autoStage || NewBuilds.getStage(done);
    const completedMs = NewBuilds.msLabels.filter((_, i) => pm[`step${i+1}`]?.done);
    const nextMs = NewBuilds.msLabels.find((_, i) => !pm[`step${i+1}`]?.done);

    App.openModal(`
      <div class="modal-title">📧 Notify Client — Build Update</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">Send a progress update to <strong>${b.client_name}</strong>.</div>
      <div class="card" style="margin-bottom:12px;font-size:13px;line-height:1.8;">
        <div>📋 Pipeline Stage: <span class="fw-800" style="color:var(--accent2);">${stage}</span></div>
        <div>✅ Milestones: <span class="fw-700">${done}/9 completed</span></div>
        ${b.est_completion_date ? `<div>📅 Est. Completion: <span class="fw-700">${App.fmtDate(b.est_completion_date)}</span></div>` : ''}
        ${nextMs ? `<div>⏭ Next Step: <span class="fw-700">${nextMs}</span></div>` : '<div style="color:var(--green);font-weight:700;">🎉 All milestones complete!</div>'}
      </div>
      <div class="form-group">
        <label class="form-label">ADD CUSTOM NOTE (OPTIONAL)</label>
        <textarea class="form-input" id="nb-notify-note" rows="3" placeholder="Any specific update for the client..."></textarea>
      </div>
      <button class="btn btn-primary btn-block" onclick="NewBuilds.sendClientUpdate('${id}')">📨 Open in Email Tab</button>
    `);
  },

  sendClientUpdate(id) {
    const b = NewBuilds.all.find(x => x.id === id);
    if (!b) return;
    const pm = b.pipeline_milestones || {};
    const done = NewBuilds.msLabels.filter((_, i) => pm[`step${i+1}`]?.done).length;
    const stage = NewBuilds.getStage(done);
    const completedMs = NewBuilds.msLabels.filter((_, i) => pm[`step${i+1}`]?.done);
    const nextMs = NewBuilds.msLabels.find((_, i) => !pm[`step${i+1}`]?.done);
    const customNote = document.getElementById('nb-notify-note')?.value?.trim() || '';
    const subject = `New Build Update: ${b.lot_address || 'Your Property'} — ${stage}`;
    const body = `Hi ${b.client_name},\n\nHere's your latest new build progress update:\n\n📋 Current Pipeline Stage: ${stage}\n✅ Milestones Completed: ${done} of 9\n${completedMs.map(m => `   ✓ ${m}`).join('\n')}\n${nextMs ? `\n⏭ Next Milestone: ${nextMs}` : '\n🎉 All milestones complete — congratulations!'}\n${b.est_completion_date ? `\n📅 Estimated Completion Date: ${App.fmtDate(b.est_completion_date)}` : ''}\n${b.deposit_status ? `🏦 Deposit Status: ${b.deposit_status}` : ''}\n${customNote ? `\n📝 Additional Notes:\n${customNote}` : ''}\n\nPlease don't hesitate to reach out if you have any questions or need anything.\n\nBest regards,\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545`;

    App.closeModal();
    App.switchTab('email');
    setTimeout(() => {
      const subEl = document.getElementById('email-subject');
      const bodyEl = document.getElementById('email-body');
      if (subEl) subEl.value = subject;
      if (bodyEl) bodyEl.innerHTML = body.replace(/\n/g, '<br>');
      App.toast('📧 Email pre-filled — select client and hit Send!');
    }, 400);
  },

  async save() {
    const st = document.getElementById('nb-status');
    if (!st) return;
    const clientSel = document.getElementById('nb-client-sel');
    const clientName = clientSel.options[clientSel.selectedIndex]?.dataset?.name || '';
    const clientId = clientSel.value;
    if (!clientName) { st.style.color='var(--red)'; st.textContent='⚠️ Please select a client'; return; }
    st.textContent = 'Saving...'; st.style.color = 'var(--text2)';
    const boxes = document.querySelectorAll('#newbuilds-form-wrap .nb-ms');
    const milestones = {};
    boxes.forEach((b, i) => { milestones[`step${i+1}`] = { done: b.checked, label: NewBuilds.msLabels[i] }; });
    const done = [...boxes].filter(b => b.checked).length;
    const pipelineStage = NewBuilds.getStage(done);
    const lotAddress = document.getElementById('nb-lot-address')?.value.trim() || '';
    const price = parseFloat(document.getElementById('nb-price')?.value) || 0;
    const completion = document.getElementById('nb-completion')?.value || null;

    const { data: saved, error } = await db.from('new_builds').insert({
      agent_id: currentAgent.id,
      client_name: clientName,
      builder: document.getElementById('nb-builder')?.value.trim() || '',
      lot_address: lotAddress,
      purchase_price: price,
      current_stage: document.getElementById('nb-stage')?.value || 'Lot Identified',
      est_completion_date: completion,
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
    }).select().single();

    if (error) {
      // Fallback minimal insert
      const { error: e2 } = await db.from('new_builds').insert({
        agent_id: currentAgent.id, client_name: clientName,
        builder: document.getElementById('nb-builder')?.value.trim()||'',
        community: lotAddress, purchase_price: price,
        notes: document.getElementById('nb-notes')?.value.trim()||'',
        status: 'Active', pipeline_milestones: milestones
      });
      if (e2) { st.style.color='var(--red)'; st.textContent=e2.message; return; }
    }

    // Auto-create / update pipeline entry
    const buildObj = saved || { client_name: clientName, lot_address: lotAddress, purchase_price: price, est_completion_date: completion };
    await NewBuilds.syncPipeline(buildObj, pipelineStage);

    App.toast('✅ New Build created! Pipeline entry auto-created.');
    st.style.color='var(--green)'; st.textContent=`✅ Build created · Pipeline → ${pipelineStage}`;
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

// ── INBOX ────────────────────────────────────────────────────────────────────
const Inbox = {
  _all: [],
  _tab: 'client',
  _selected: new Set(),

  async load() {
    if (!currentAgent?.id) return;
    const el = document.getElementById('inbox-list');
    if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';

    // Safety timeout — never spin forever
    const timer = setTimeout(() => {
      if (el && el.innerHTML.includes('spinner')) {
        el.innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><div class="empty-text">No emails logged yet</div><div class="empty-sub">Emails you send via the Send Email tab are logged here. Send one to get started!</div></div>';
      }
    }, 6000);

    try {
      const days = parseInt(document.getElementById('inbox-filter')?.value || '30');
      const since = new Date(Date.now() - days * 86400000).toISOString();

      // Run both queries in parallel
      const [emailRes, clientRes] = await Promise.all([
        db.from('email_inbox')
          .select('id,direction,recipient_name,recipient_email,sender_name,sender_email,subject,body,created_at')
          .eq('agent_id', currentAgent.id)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(100),
        db.from('clients')
          .select('id,full_name,email')
          .eq('agent_id', currentAgent.id)
          .limit(500)
      ]);

      clearTimeout(timer);
      Inbox._all = emailRes.data || [];

      // Build client lookup map
      const clientEmails = new Set();
      const clientMap = {};
      (clientRes.data || []).forEach(c => {
        if (c.email) {
          clientEmails.add(c.email.toLowerCase());
          clientMap[c.email.toLowerCase()] = c;
        }
      });
      Inbox._clientEmails = clientEmails;
      Inbox._clientMap = clientMap;
      Inbox._selected.clear();
      const ctr = document.getElementById('inbox-sel-count');
      if (ctr) ctr.textContent = '0';
      Inbox.showTab(Inbox._tab);
    } catch (err) {
      clearTimeout(timer);
      if (el) el.innerHTML = `<div class="empty-state"><div class="empty-icon">📬</div><div class="empty-text">No emails logged yet</div><div class="empty-sub">Emails you send via the Send Email tab are logged here.</div></div>`;
    }
  },

  showTab(tab) {
    Inbox._tab = tab;
    const btnClient = document.getElementById('inbox-tab-client');
    const btnExt = document.getElementById('inbox-tab-external');
    if (btnClient) {
      btnClient.style.background = tab === 'client' ? 'var(--accent)' : 'var(--card)';
      btnClient.style.color = tab === 'client' ? '#fff' : 'var(--text2)';
    }
    if (btnExt) {
      btnExt.style.background = tab === 'external' ? 'var(--accent)' : 'var(--card)';
      btnExt.style.color = tab === 'external' ? '#fff' : 'var(--text2)';
    }
    const ce = Inbox._clientEmails || new Set();
    const isClient = e => {
      const addr = (e.recipient_email || e.sender_email || '').toLowerCase();
      return ce.has(addr);
    };
    const filtered = Inbox._all.filter(e => tab === 'client' ? isClient(e) : !isClient(e));
    Inbox.renderList(filtered);
  },

  renderList(list) {
    const el = document.getElementById('inbox-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">${Inbox._tab === 'client' ? '👤' : '🌐'}</div><div class="empty-text">No ${Inbox._tab === 'client' ? 'client' : 'external'} emails found</div><div class="empty-sub">Try a wider date range or click Load Inbox.</div></div>`;
      return;
    }
    el.innerHTML = list.map(e => {
      const addr = (e.recipient_email || e.sender_email || '').toLowerCase();
      const client = Inbox._clientMap?.[addr];
      const name = e.recipient_name || e.sender_name || addr;
      const isSent = e.direction === 'sent';
      return `<div class="card" style="margin-bottom:8px;display:flex;align-items:flex-start;gap:10px;">
        <input type="checkbox" style="margin-top:3px;" onchange="Inbox.toggleSelect('${e.id}',this.checked)">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <div class="fw-700" style="font-size:13px;">${App.esc(name)}</div>
            <div style="font-size:11px;color:var(--text2);">${isSent ? '↗ Sent' : '↙ Received'} · ${App.timeAgo(e.created_at)}</div>
          </div>
          <div style="font-size:13px;font-weight:600;margin-bottom:3px;">${App.esc(e.subject || '(no subject)')}</div>
          <div style="font-size:12px;color:var(--text2);">${App.esc((e.body || '').slice(0,120))}${(e.body||'').length > 120 ? '…' : ''}</div>
          ${client ? `<div style="font-size:11px;color:var(--accent2);margin-top:4px;">👤 ${App.esc(client.full_name)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  },

  toggleSelect(id, checked) {
    if (checked) Inbox._selected.add(id); else Inbox._selected.delete(id);
    document.getElementById('inbox-sel-count').textContent = Inbox._selected.size;
  },

  selectAll() {
    const ce = Inbox._clientEmails || new Set();
    const isClient = e => { const addr = (e.recipient_email || e.sender_email || '').toLowerCase(); return ce.has(addr); };
    const filtered = Inbox._all.filter(e => Inbox._tab === 'client' ? isClient(e) : !isClient(e));
    filtered.forEach(e => Inbox._selected.add(e.id));
    document.getElementById('inbox-sel-count').textContent = Inbox._selected.size;
    Inbox.renderList(filtered); // re-render to show checked state (simple approach)
    App.toast(`☑️ ${Inbox._selected.size} selected`);
  },

  async trashSelected() {
    if (!Inbox._selected.size) { App.toast('⚠️ Nothing selected'); return; }
    if (!confirm(`Delete ${Inbox._selected.size} email(s) from the log? This cannot be undone.`)) return;
    const ids = [...Inbox._selected];
    await db.from('email_inbox').delete().in('id', ids);
    App.toast(`🗑 ${ids.length} email(s) removed.`);
    Inbox._selected.clear();
    Inbox.load();
  },

  async cleanNonClients() {
    if (!confirm('Remove all logged emails that are NOT from your clients? This cannot be undone.')) return;
    const ce = Inbox._clientEmails || new Set();
    const nonClientIds = Inbox._all.filter(e => {
      const addr = (e.recipient_email || e.sender_email || '').toLowerCase();
      return !ce.has(addr);
    }).map(e => e.id);
    if (!nonClientIds.length) { App.toast('✅ No non-client emails to clean.'); return; }
    await db.from('email_inbox').delete().in('id', nonClientIds);
    App.toast(`🧹 Removed ${nonClientIds.length} non-client email(s).`);
    Inbox.load();
  }
};

// ── AGENT PORTAL ─────────────────────────────────────────────────────────────
const AgentPortal = {
  async load() {
    AgentPortal.loadAgents();
  },

  toggleGuide() {
    const guide = document.getElementById('portal-guide');
    const arrow = document.getElementById('guide-arrow');
    if (!guide) return;
    const open = guide.style.display !== 'none';
    guide.style.display = open ? 'none' : 'block';
    if (arrow) arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
  },

  async deploy() {
    const name = document.getElementById('ap-name')?.value.trim();
    const email = document.getElementById('ap-email')?.value.trim();
    const phone = document.getElementById('ap-phone')?.value.trim() || '';
    const brokerage = document.getElementById('ap-brokerage')?.value.trim() || 'eXp Realty';
    const title = document.getElementById('ap-title')?.value.trim() || 'Real Estate Agent';
    const province = document.getElementById('ap-province')?.value || 'Newfoundland & Labrador';
    const msg = document.getElementById('ap-msg');

    if (!name || !email) { if (msg) { msg.style.color='var(--red)'; msg.textContent='⚠️ Name and email are required.'; } return; }
    if (msg) { msg.style.color='var(--text2)'; msg.textContent='Deploying...'; }

    // Insert into agents table
    const { error } = await db.from('agents').insert({
      full_name: name,
      email,
      phone,
      brokerage,
      title,
      province,
      created_by: currentAgent?.id || null,
      created_at: new Date().toISOString()
    });

    if (error) {
      if (msg) { msg.style.color='var(--red)'; msg.textContent=`⚠️ ${error.message}`; }
      return;
    }

    // Invite via Supabase Auth (requires admin key — attempt, may fail gracefully)
    try {
      await db.auth.admin?.inviteUserByEmail?.(email);
    } catch (_) {}

    if (msg) { msg.style.color='var(--green)'; msg.textContent=`✅ Agent portal deployed for ${name}! They'll receive an invite email.`; }
    App.toast(`🚀 Agent portal deployed for ${name}`);
    document.getElementById('ap-name').value = '';
    document.getElementById('ap-email').value = '';
    document.getElementById('ap-phone').value = '';
    AgentPortal.loadAgents();
  },

  async loadAgents() {
    const el = document.getElementById('ap-agents-list');
    if (!el) return;
    const { data } = await db.from('agents').select('*').order('created_at', { ascending: false });
    // Exclude self
    const list = (data || []).filter(a => a.id !== currentAgent?.id);
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-text">No agents deployed yet</div></div>';
      return;
    }
    el.innerHTML = list.map(a => `
      <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--accent2);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;">${(a.full_name||'?')[0].toUpperCase()}</div>
        <div style="flex:1;">
          <div class="fw-700">${App.esc(a.full_name||'Unknown')}</div>
          <div style="font-size:12px;color:var(--text2);">${App.esc(a.email||'')} · ${App.esc(a.brokerage||'')} · ${App.esc(a.province||'')}</div>
        </div>
        <span class="stage-badge badge-accepted" style="font-size:11px;">Active</span>
      </div>`).join('');
  }
};

// ── CLEANUP ──────────────────────────────────────────────────────────────────
const Cleanup = {
  init() {
    // Reset all panels on load
    ['cleanup-duplicates','cleanup-testdata','cleanup-orphans','cleanup-stale'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.innerHTML.includes('spinner')) return; // already loading
    });
  },

  async findDuplicates() {
    const el = document.getElementById('cleanup-duplicates');
    if (!el) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Scanning...</div>';
    const { data } = await db.from('clients').select('id,full_name,email').eq('agent_id', currentAgent.id);
    const clients = data || [];
    const nameMap = {}, emailMap = {};
    clients.forEach(c => {
      const n = (c.full_name||'').toLowerCase().trim();
      if (n) { nameMap[n] = nameMap[n] || []; nameMap[n].push(c); }
      const e = (c.email||'').toLowerCase().trim();
      if (e) { emailMap[e] = emailMap[e] || []; emailMap[e].push(c); }
    });
    const dupes = new Map();
    Object.values(nameMap).filter(g => g.length > 1).forEach(g => g.forEach(c => dupes.set(c.id, c)));
    Object.values(emailMap).filter(g => g.length > 1).forEach(g => g.forEach(c => dupes.set(c.id, c)));
    const list = [...dupes.values()];
    if (!list.length) { el.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">✅ No duplicates found!</div>'; return; }
    el.innerHTML = `<div style="font-size:12px;color:var(--yellow);margin-bottom:8px;">⚠️ ${list.length} potential duplicate(s) found:</div>` +
      list.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
        <input type="checkbox" id="dup-${c.id}">
        <div style="flex:1;font-size:13px;"><span class="fw-700">${App.esc(c.full_name)}</span> <span style="color:var(--text2);font-size:12px;">${App.esc(c.email||'no email')}</span></div>
        <button class="btn btn-sm" style="background:var(--red);color:#fff;font-size:11px;" onclick="Cleanup.deleteClient('${c.id}','${App.esc(c.full_name)}')">Delete</button>
      </div>`).join('') +
      `<button class="btn btn-sm" style="background:var(--red);color:#fff;margin-top:8px;" onclick="Cleanup.deleteChecked('dup-')">🗑 Delete Checked</button>`;
  },

  async findTestData() {
    const el = document.getElementById('cleanup-testdata');
    if (!el) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Scanning...</div>';
    const { data } = await db.from('clients').select('id,full_name,email').eq('agent_id', currentAgent.id);
    const test = (data || []).filter(c => /test|demo|sample|dummy|fake/i.test(c.full_name || ''));
    if (!test.length) { el.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">✅ No test data found!</div>'; return; }
    el.innerHTML = `<div style="font-size:12px;color:var(--yellow);margin-bottom:8px;">⚠️ ${test.length} test record(s) found:</div>` +
      test.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
        <input type="checkbox" id="tst-${c.id}" checked>
        <div style="flex:1;font-size:13px;"><span class="fw-700">${App.esc(c.full_name)}</span> <span style="color:var(--text2);font-size:12px;">${App.esc(c.email||'no email')}</span></div>
      </div>`).join('') +
      `<button class="btn btn-sm" style="background:var(--red);color:#fff;margin-top:8px;" onclick="Cleanup.deleteChecked('tst-')">🗑 Delete Checked</button>`;
  },

  async deleteTestData() {
    if (!confirm('Delete ALL clients with "test", "demo", "sample", "dummy", or "fake" in their name? This cannot be undone.')) return;
    const { data } = await db.from('clients').select('id,full_name').eq('agent_id', currentAgent.id);
    const testIds = (data || []).filter(c => /test|demo|sample|dummy|fake/i.test(c.full_name||'')).map(c => c.id);
    if (!testIds.length) { App.toast('✅ No test data to delete.'); return; }
    await db.from('clients').delete().in('id', testIds);
    App.toast(`🗑 Deleted ${testIds.length} test client(s).`);
    Cleanup.findTestData();
  },

  async findOrphans() {
    const el = document.getElementById('cleanup-orphans');
    if (!el) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Scanning...</div>';
    const { data: clients } = await db.from('clients').select('full_name').eq('agent_id', currentAgent.id);
    const validNames = new Set((clients||[]).map(c => (c.full_name||'').toLowerCase().trim()));

    const [vRes, pRes, cRes] = await Promise.all([
      db.from('viewings').select('id,client_name').eq('agent_id', currentAgent.id),
      db.from('pipeline').select('id,client_name').eq('agent_id', currentAgent.id),
      db.from('commissions').select('id,client_name').eq('agent_id', currentAgent.id)
    ]);

    const orphans = [];
    const check = (table, rows) => (rows||[]).forEach(r => {
      if (!validNames.has((r.client_name||'').toLowerCase().trim())) orphans.push({ table, id: r.id, name: r.client_name });
    });
    check('viewings', vRes.data); check('pipeline', pRes.data); check('commissions', cRes.data);

    if (!orphans.length) { el.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">✅ No orphaned records found!</div>'; return; }
    el.innerHTML = `<div style="font-size:12px;color:var(--yellow);margin-bottom:8px;">⚠️ ${orphans.length} orphaned record(s):</div>` +
      orphans.map(o => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
        <input type="checkbox" id="orp-${o.table}-${o.id}">
        <div style="flex:1;font-size:13px;"><span class="fw-700">${App.esc(o.name||'Unknown')}</span> <span style="color:var(--text2);font-size:11px;">[${o.table}]</span></div>
        <button class="btn btn-sm" style="background:var(--red);color:#fff;font-size:11px;" onclick="Cleanup.deleteOrphan('${o.table}','${o.id}')">Delete</button>
      </div>`).join('');
  },

  async findStale() {
    const el = document.getElementById('cleanup-stale');
    if (!el) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Scanning...</div>';
    const cutoff = new Date(Date.now() - 90*86400000).toISOString();
    const { data } = await db.from('clients').select('id,full_name,email,stage,updated_at')
      .eq('agent_id', currentAgent.id)
      .lte('updated_at', cutoff)
      .not('stage', 'in', '("Closed","Lost")');
    const list = data || [];
    if (!list.length) { el.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">✅ No stale clients found!</div>'; return; }
    el.innerHTML = `<div style="font-size:12px;color:var(--yellow);margin-bottom:8px;">⚠️ ${list.length} stale client(s) — no updates in 90+ days:</div>` +
      list.map(c => {
        const days = Math.floor((Date.now() - new Date(c.updated_at||c.created_at)) / 86400000);
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
          <input type="checkbox" id="stl-${c.id}">
          <div style="flex:1;font-size:13px;"><span class="fw-700">${App.esc(c.full_name)}</span> <span style="color:var(--text2);font-size:12px;">${c.stage||'—'} · ${days} days inactive</span></div>
          <button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="Cleanup.markInactive('${c.id}')">Mark Lost</button>
        </div>`;
      }).join('') +
      `<button class="btn btn-sm" style="background:var(--red);color:#fff;margin-top:8px;" onclick="Cleanup.deleteChecked('stl-')">🗑 Archive Checked</button>`;
  },

  async deleteClient(id, name) {
    if (!confirm(`Delete client "${name}"? This cannot be undone.`)) return;
    await db.from('clients').delete().eq('id', id);
    App.toast(`🗑 Deleted: ${name}`);
    Cleanup.findDuplicates();
  },

  async deleteOrphan(table, id) {
    if (!confirm(`Delete this ${table} record?`)) return;
    await db.from(table).delete().eq('id', id);
    App.toast(`🗑 Orphan removed from ${table}.`);
    Cleanup.findOrphans();
  },

  async markInactive(id) {
    await db.from('clients').update({ stage: 'Lost', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('✅ Marked as Lost.');
    Cleanup.findStale();
  },

  async deleteChecked(prefix) {
    const checked = [...document.querySelectorAll(`[id^="${prefix}"]`)].filter(i => i.checked);
    if (!checked.length) { App.toast('⚠️ Nothing checked.'); return; }
    if (!confirm(`Delete ${checked.length} record(s)? This cannot be undone.`)) return;
    for (const cb of checked) {
      const parts = cb.id.replace(prefix, '').split('-');
      if (prefix === 'dup-' || prefix === 'tst-' || prefix === 'stl-') {
        await db.from('clients').delete().eq('id', parts.join('-'));
      } else if (prefix === 'orp-') {
        const table = parts[0]; const id = parts.slice(1).join('-');
        await db.from(table).delete().eq('id', id);
      }
    }
    App.toast(`🗑 ${checked.length} record(s) deleted.`);
    // Reload relevant section
    if (prefix === 'dup-') Cleanup.findDuplicates();
    else if (prefix === 'tst-') Cleanup.findTestData();
    else if (prefix === 'stl-') Cleanup.findStale();
  }
};
