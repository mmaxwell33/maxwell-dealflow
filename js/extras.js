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
  },

  renderSummary(list) {
    const total = list.reduce((s, c) => s + (c.amount || 0), 0);
    const paid = list.filter(c => c.status === 'Paid').reduce((s, c) => s + (c.amount || 0), 0);
    const pending = list.filter(c => c.status === 'Pending').reduce((s, c) => s + (c.amount || 0), 0);
    document.getElementById('commissions-summary').innerHTML = `
      <div class="stat-card stat-gold"><div class="stat-num" style="font-size:20px;">${App.fmtMoney(total)}</div><div class="stat-label">Total Earned</div></div>
      <div class="stat-card stat-green"><div class="stat-num" style="font-size:20px;">${App.fmtMoney(paid)}</div><div class="stat-label">Paid Out</div></div>
      <div class="stat-card stat-cyan"><div class="stat-num" style="font-size:20px;">${App.fmtMoney(pending)}</div><div class="stat-label">Pending</div></div>
      <div class="stat-card stat-blue"><div class="stat-num" style="font-size:20px;">${list.length}</div><div class="stat-label">Total Deals</div></div>`;
  },

  render(list) {
    const el = document.getElementById('commissions-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-text">No commissions yet</div><div class="empty-sub">Closed deals will appear here</div></div>';
      return;
    }
    el.innerHTML = `<div class="card" style="padding:0;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid var(--border);">
            <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Client</th>
            <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Property</th>
            <th style="padding:12px 16px;text-align:right;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Sale Price</th>
            <th style="padding:12px 16px;text-align:right;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Commission</th>
            <th style="padding:12px 16px;text-align:center;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Status</th>
            <th style="padding:12px 16px;text-align:left;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;">Close Date</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(c => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:12px 16px;font-weight:700;">${c.client_name || '—'}</td>
              <td style="padding:12px 16px;font-size:13px;color:var(--text2);">${c.property_address || '—'}</td>
              <td style="padding:12px 16px;text-align:right;font-weight:700;">${App.fmtMoney(c.sale_price)}</td>
              <td style="padding:12px 16px;text-align:right;font-weight:800;color:var(--green);">${App.fmtMoney(c.amount)}</td>
              <td style="padding:12px 16px;text-align:center;"><span class="stage-badge ${c.status==='Paid'?'badge-accepted':'badge-conditions'}">${c.status||'Pending'}</span></td>
              <td style="padding:12px 16px;font-size:13px;color:var(--text2);">${App.fmtDate(c.close_date)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  },

  openAdd() {
    App.openModal(`
      <div class="modal-title">💰 Add Commission</div>
      <div class="form-group">
        <label class="form-label">Client Name</label>
        <input class="form-input" id="cm-client" placeholder="Client name">
      </div>
      <div class="form-group">
        <label class="form-label">Property Address</label>
        <input class="form-input" id="cm-property" placeholder="123 Main St">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Sale Price</label>
          <input class="form-input" id="cm-sale" type="number" placeholder="450000">
        </div>
        <div class="form-group">
          <label class="form-label">Commission ($)</label>
          <input class="form-input" id="cm-amount" type="number" placeholder="11250">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Close Date</label>
          <input class="form-input" id="cm-date" type="date">
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input form-select" id="cm-status">
            <option>Pending</option><option>Paid</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Commission.save()">💾 Save Commission</button>
      <div id="cm-status-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async save() {
    const st = document.getElementById('cm-status-msg');
    st.textContent = 'Saving...';
    const { error } = await db.from('commissions').insert({
      agent_id: currentAgent.id,
      client_name: document.getElementById('cm-client').value.trim(),
      property_address: document.getElementById('cm-property').value.trim(),
      sale_price: parseFloat(document.getElementById('cm-sale').value) || 0,
      amount: parseFloat(document.getElementById('cm-amount').value) || 0,
      close_date: document.getElementById('cm-date').value,
      status: document.getElementById('cm-status').value
    });
    if (error) { st.style.color = 'var(--red)'; st.textContent = error.message; return; }
    App.closeModal(); App.toast('✅ Commission saved!');
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

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('new_builds')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    NewBuilds.all = data || [];
    NewBuilds.render(data || []);
  },

  render(list) {
    const el = document.getElementById('newbuilds-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🏗️</div><div class="empty-text">No new builds tracked</div><div class="empty-sub">Click + New Build to add one</div></div>';
      return;
    }
    const stages = ['Lot Visited','Pre-Approval Sent','Plans/Design','APS Status','Client Decision','Final P&S Sent','Documents Attached','Final Financing','Possession'];
    el.innerHTML = list.map(b => {
      const pm = b.pipeline_milestones || {};
      const done = stages.filter((_, i) => pm[`step${i+1}`]?.done).length;
      return `<div class="card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <div style="flex:1;">
            <div class="fw-800">${b.client_name || 'Unknown Client'}</div>
            <div class="text-muted" style="font-size:12px;">📍 ${b.community || b.builder || '—'}</div>
          </div>
          <span class="stage-badge badge-viewings">${b.status || 'Active'}</span>
        </div>
        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
            <span class="text-muted">Milestone Progress</span>
            <span class="fw-700 text-accent">${done}/9</span>
          </div>
          <div class="pipeline-bar">${stages.map((_, i) => `<div class="pipeline-step ${pm[`step${i+1}`]?.done ? 'done' : ''}"></div>`).join('')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${stages.slice(0, done + 1).map((s, i) => i <= done ? `<span style="font-size:11px;color:var(--green);">✓ ${s}</span>` : '').filter(Boolean).join('<span style="color:var(--border);">·</span>')}
        </div>
      </div>`;
    }).join('');
  },

  openAdd() {
    App.openModal(`
      <div class="modal-title">🏗️ New Build</div>
      <div class="form-group">
        <label class="form-label">Client Name *</label>
        <input class="form-input" id="nb-client" placeholder="Client name">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Builder</label>
          <input class="form-input" id="nb-builder" placeholder="Builder name">
        </div>
        <div class="form-group">
          <label class="form-label">Community / Area</label>
          <input class="form-input" id="nb-community" placeholder="Community">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Lot / Unit</label>
          <input class="form-input" id="nb-lot" placeholder="Lot 14">
        </div>
        <div class="form-group">
          <label class="form-label">Purchase Price</label>
          <input class="form-input" id="nb-price" type="number" placeholder="450000">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="nb-notes" rows="3" placeholder="Any notes..."></textarea>
      </div>
      <button class="btn btn-primary btn-block" onclick="NewBuilds.save()">💾 Save New Build</button>
      <div id="nb-status" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async save() {
    const st = document.getElementById('nb-status');
    const name = document.getElementById('nb-client').value.trim();
    if (!name) { st.textContent = '⚠️ Client name required'; return; }
    st.textContent = 'Saving...';
    const { error } = await db.from('new_builds').insert({
      agent_id: currentAgent.id,
      client_name: name,
      builder: document.getElementById('nb-builder').value.trim(),
      community: document.getElementById('nb-community').value.trim(),
      lot_number: document.getElementById('nb-lot').value.trim(),
      purchase_price: parseFloat(document.getElementById('nb-price').value) || 0,
      notes: document.getElementById('nb-notes').value.trim(),
      status: 'Active',
      pipeline_milestones: {}
    });
    if (error) { st.style.color = 'var(--red)'; st.textContent = error.message; return; }
    App.closeModal(); App.toast('✅ New Build added!');
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

  init() {
    const sel = document.getElementById('email-client');
    if (!sel) return;
    if (window.Clients?.all?.length) {
      sel.innerHTML = '<option value="">— Select client —</option>' +
        Clients.all.map(c => `<option value="${c.id}" data-name="${c.full_name}" data-email="${c.email}">${c.full_name} — ${c.email || 'no email'}</option>`).join('');
    }
  },

  loadTemplate() {
    const key = document.getElementById('email-template').value;
    const t = EmailSend.templates[key];
    if (!t) return;
    document.getElementById('email-subject').value = t.subject;
    const clientSel = document.getElementById('email-client');
    const clientName = clientSel.options[clientSel.selectedIndex]?.dataset?.name || 'there';
    document.getElementById('email-body').value = t.body.replace('[CLIENT_NAME]', clientName);
  },

  preview() {
    const subject = document.getElementById('email-subject').value;
    const body = document.getElementById('email-body').value;
    App.openModal(`
      <div class="modal-title">👁 Email Preview</div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">SUBJECT</div>
        <div class="fw-700">${subject || '(no subject)'}</div>
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;white-space:pre-wrap;font-size:13px;line-height:1.6;">${body || '(no content)'}</div>
    `);
  },

  send() {
    const st = document.getElementById('email-status');
    const clientSel = document.getElementById('email-client');
    const opt = clientSel.options[clientSel.selectedIndex];
    if (!opt?.value) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Please select a client'; return; }
    const subject = document.getElementById('email-subject').value.trim();
    const body = document.getElementById('email-body').value.trim();
    if (!subject) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Subject is required'; return; }
    const mailto = `mailto:${opt.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto);
    App.toast('📨 Email client opened!');
    App.logActivity('EMAIL_SENT', opt.dataset.name, opt.dataset.email, `Email sent: ${subject}`);
    st.style.color = 'var(--green)';
    st.textContent = '✅ Email opened in your mail app!';
  }
};
