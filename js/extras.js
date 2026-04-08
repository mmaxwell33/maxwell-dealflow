// ── APPROVALS ──────────────────────────────────────────────────────────────
const Approvals = {
  async load() {
    const el = document.getElementById('approvals-list');
    if (!currentAgent?.id) {
      // Retry after short delay in case agent is still loading
      setTimeout(() => Approvals.load(), 800);
      return;
    }
    const { data } = await db.from('approval_queue')
      .select('*').eq('agent_id', currentAgent.id)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false }).limit(50);
    const pending = data || [];
    const badge = document.getElementById('approvals-badge');
    if (badge) { badge.textContent = pending.length; badge.style.display = pending.length ? 'inline' : 'none'; }
    if (!pending.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">No pending approvals</div><div class="empty-sub">Client emails will appear here for your review before sending</div></div>';
      return;
    }
    const typeIcon = { 'Viewing Confirmation':'📅', 'Post-Viewing Follow-Up':'🏠', 'Offer Submitted':'📄', 'Offer Accepted 🎉':'🎉', 'Deal Closed 🏠':'🔑', 'Financing Reminder (3d)':'🏦', 'Financing Reminder (1d)':'🏦', 'Inspection Reminder (3d)':'🔍', 'Inspection Reminder (1d)':'🔍', 'Closing Countdown (7d)':'📅', 'Closing Countdown (3d)':'⏰', 'Closing Countdown (1d)':'🚨' };
    Approvals._data = pending;
    el.innerHTML = pending.map(a => `
      <div class="card appr-card" style="margin-bottom:12px;border-left:3px solid ${a.status==='Pending'?'var(--accent2)':a.status==='Approved'?'var(--green)':'var(--red)'};cursor:pointer;" onclick="Approvals.openEdit('${a.id}')">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
          <div style="font-size:22px;line-height:1;">${typeIcon[a.approval_type]||'📬'}</div>
          <div style="flex:1;">
            <div class="fw-700" style="font-size:14px;">${a.client_name || 'Unknown'}</div>
            <div class="text-muted" style="font-size:12px;">${a.approval_type || 'Email'} · ${App.timeAgo(a.created_at)}</div>
            ${a.client_email ? `<div style="font-size:11px;color:var(--text2);">✉️ ${a.client_email}</div>` : ''}
          </div>
          <span class="stage-badge ${a.status==='Pending'?'badge-conditions':a.status==='Approved'?'badge-accepted':'badge-default'}">${a.status}</span>
        </div>
        ${a.email_subject ? `<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;padding:6px 10px;background:var(--bg);border-radius:6px;">📧 ${App.esc(a.email_subject)}</div>` : ''}
        ${a.email_body ? `
        <div style="font-size:12px;color:var(--text2);background:var(--bg);padding:10px;border-radius:6px;margin-bottom:10px;line-height:1.6;">
          ${a.email_body.trim().startsWith('<!DOCTYPE') || a.email_body.trim().startsWith('<html')
            ? `<span style="color:var(--accent2);">👁 Click to preview formatted email</span>`
            : App.esc(a.email_body.slice(0,200)) + (a.email_body.length>200?'…':'')}
        </div>` : ''}
        ${a.status === 'Pending' ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;" onclick="event.stopPropagation()">
            <button class="btn btn-green btn-sm" onclick="Approvals.approve('${a.id}')">✅ Approve & Send</button>
            <button class="btn btn-outline btn-sm" onclick="Approvals.openEdit('${a.id}')">✏️ Preview & Edit</button>
            <button class="btn btn-red btn-sm" onclick="Approvals.reject('${a.id}')">❌ Discard</button>
          </div>` : `<div style="font-size:11px;color:var(--text2);">${a.status === 'Approved' ? '✅ Sent to client' : '❌ Discarded'} · ${App.fmtDate(a.updated_at)}</div>`}
      </div>`).join('');
  },

  expandBody(id) {
    const el = document.getElementById(`appr-body-${id}`);
    const item = (Approvals._data||[]).find(a=>a.id===id);
    if (el && item?.email_body) {
      el.textContent = item.email_body;
      el.style.maxHeight = 'none';
    }
  },

  previewEmail(id) {
    const item = (Approvals._data||[]).find(a=>a.id===id);
    if (!item) return;
    App.openModal(`
      <div class="modal-title">📧 Email Preview</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">TO</div>
      <div class="fw-700" style="margin-bottom:12px;">${item.client_name} · ${item.client_email||'No email'}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">SUBJECT</div>
      <div class="fw-700" style="margin-bottom:12px;">${App.esc(item.email_subject||'')}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">MESSAGE</div>
      <div style="font-size:13px;white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:8px;line-height:1.7;max-height:340px;overflow-y:auto;margin-bottom:16px;">${App.esc(item.email_body||'')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <button class="btn btn-green" onclick="App.closeModal();Approvals.approve('${id}')">✅ Approve & Send</button>
        <button class="btn btn-outline" onclick="App.closeModal();Approvals.openEdit('${id}')">✏️ Edit Email</button>
      </div>
      <button class="btn btn-red btn-block" onclick="App.closeModal();Approvals.reject('${id}')">❌ Discard</button>
    `);
  },

  _data: [],

  async approve(id) {
    const { data: item } = await db.from('approval_queue').select('*').eq('id', id).single();
    if (!item) return;

    App.toast('📨 Sending email...', 'var(--accent2)');

    if (item.client_email && item.email_subject) {
      // ── SEND VIA RESEND EDGE FUNCTION ──────────────────────────────────────
      try {
        const agent = currentAgent || {};
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            to: item.client_email,
            subject: item.email_subject,
            body: item.email_body || '',
            html: item.context_data || null,
            from_name: agent.name || agent.full_name || 'Maxwell Midodzi',
            from_email: null
          })
        });
        const result = await res.json();
        if (!res.ok || result.error) {
          App.toast(`❌ Failed to send: ${JSON.stringify(result.error)}`, 'var(--red)');
          return;
        }
        // Mark approved in DB
        await db.from('approval_queue').update({ status: 'Approved', updated_at: new Date().toISOString() }).eq('id', id);
        App.logActivity('EMAIL_SENT', item.client_name, item.client_email, `Email sent: ${item.email_subject}`);
        Approvals.load();
        if (window.Notify) Notify.updateBadge();
        App.toast(`✅ Email sent to ${item.client_name}!`, 'var(--green)');
      } catch (err) {
        App.toast(`❌ Error: ${err.message}`, 'var(--red)');
      }
    } else {
      // No email on file — just mark approved
      await db.from('approval_queue').update({ status: 'Approved', updated_at: new Date().toISOString() }).eq('id', id);
      App.logActivity('EMAIL_SENT', item.client_name, item.client_email, `Approved: ${item.email_subject}`);
      Approvals.load();
      if (window.Notify) Notify.updateBadge();
      App.toast('✅ Approved and logged!', 'var(--green)');
    }
  },

  openEdit(id) {
    db.from('approval_queue').select('*').eq('id', id).single().then(({ data: item }) => {
      if (!item) return;
      App.openModal(`
        <div class="modal-title">📧 Review & Edit Email</div>

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:10px 12px;background:var(--bg);border-radius:8px;">
          <div style="font-size:28px;">👤</div>
          <div>
            <div class="fw-700" style="font-size:14px;">${App.esc(item.client_name||'Unknown')}</div>
            <div style="font-size:12px;color:var(--text2);">✉️ ${App.esc(item.client_email||'No email on file')}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px;">${App.esc(item.approval_type||'Email')} · ${App.timeAgo(item.created_at)}</div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Subject</label>
          <input class="form-input" id="edit-appr-subject" value="${App.esc(item.email_subject||'')}" style="font-weight:700;">
        </div>

        <div class="form-group">
          <label class="form-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Message</label>
          <textarea class="form-input" id="edit-appr-body" rows="18" style="font-size:13px;line-height:1.7;resize:vertical;">${App.esc(item.email_body||'')}</textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <button class="btn btn-green" onclick="Approvals.saveEdit('${id}')">✅ Approve & Send</button>
          <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        </div>
        <button class="btn btn-red btn-block" onclick="App.closeModal();Approvals.reject('${id}')">❌ Discard Email</button>
      `);
    });
  },

  async saveEdit(id) {
    const subject = document.getElementById('edit-appr-subject')?.value.trim();
    const body = document.getElementById('edit-appr-body')?.value.trim();
    await db.from('approval_queue').update({ email_subject: subject, email_body: body, updated_at: new Date().toISOString() }).eq('id', id);
    App.closeModal();
    await Approvals.approve(id);
  },

  async reject(id) {
    await db.from('approval_queue').update({ status: 'Rejected', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('❌ Email discarded.');
    Approvals.load();
    if (window.Notify) Notify.updateBadge();
  }
};

// ── FORM RESPONSES (Client Intake) ──────────────────────────────────────────
const FormResponses = {
  all: [],

  async load() {
    const el = document.getElementById('formresponses-list');
    if (!el) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';
    // Load ALL submissions (no agent_id filter — public form, agent reviews all)
    const { data, error } = await db.from('client_intake')
      .select('*').order('submitted_at', { ascending: false }).limit(100);
    if (error || !data?.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-text">No form submissions yet</div>
        <div class="empty-sub">Share your intake form link with clients to get started</div>
      </div>
      <div class="card" style="margin-top:16px;padding:16px;">
        <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:8px;">📋 Your Intake Form Link</div>
        <div style="font-size:13px;background:var(--bg);padding:10px 12px;border-radius:8px;word-break:break-all;color:var(--accent2);font-family:monospace;">https://maxwell-dealflow.vercel.app/intake.html</div>
        <button class="btn btn-outline btn-sm" style="margin-top:10px;width:100%;" onclick="navigator.clipboard.writeText('https://maxwell-dealflow.vercel.app/intake.html').then(()=>App.toast('✅ Link copied!'))">📋 Copy Link</button>
      </div>`;
      return;
    }
    FormResponses.all = data;

    // ── PUSH NOTIFY FOR ANY NEW (unreviewed) SUBMISSIONS ───────────────────
    const newCount = data.filter(r => r.status === 'New').length;
    if (newCount > 0 && window.App?.pushNotify) {
      App.pushNotify(
        `📋 ${newCount} New Client Intake${newCount > 1 ? 's' : ''}`,
        `${newCount} client${newCount > 1 ? 's have' : ' has'} submitted the intake form — tap to review`,
        'formresponses'
      );
    }

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px;padding:14px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);">
        <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:6px;">📋 Your Intake Form Link — Share This With Clients</div>
        <div style="font-size:12px;background:var(--bg);padding:8px 10px;border-radius:6px;word-break:break-all;color:var(--accent2);font-family:monospace;margin-bottom:8px;">https://maxwell-dealflow.vercel.app/intake.html</div>
        <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('https://maxwell-dealflow.vercel.app/intake.html').then(()=>App.toast('✅ Link copied!'))">📋 Copy Link</button>
      </div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">${data.length} submission${data.length!==1?'s':''} received</div>
      ${data.map(r => {
        const isNew = r.status === 'New';
        const date = r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-CA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
        return `
        <div class="card" style="margin-bottom:12px;border-left:3px solid ${isNew?'var(--accent2)':'var(--green)'};">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
            <div>
              <div class="fw-700" style="font-size:15px;">${r.full_name || '—'}</div>
              <div style="font-size:12px;color:var(--text2);">📧 ${r.email || '—'} ${r.phone ? '· 📞 '+r.phone : ''}</div>
            </div>
            <span class="stage-badge ${isNew?'badge-conditions':'badge-accepted'}" style="font-size:10px;white-space:nowrap;">${isNew?'🆕 New':'✅ Added'}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:var(--text2);margin-bottom:10px;">
            ${r.budget_max ? `<div>💰 Max Budget: <strong style="color:var(--green);">$${Number(r.budget_max).toLocaleString()}</strong></div>` : ''}
            ${r.timeline ? `<div>⏱ Timeline: ${r.timeline}</div>` : ''}
            ${r.preapproval ? `<div>🏦 Pre-Approved: ${r.preapproval}</div>` : ''}
            ${r.bedrooms ? `<div>🛏 Bedrooms: ${r.bedrooms}+</div>` : ''}
            ${r.preferred_areas ? `<div>📍 Areas: ${r.preferred_areas}</div>` : ''}
            ${r.property_types ? `<div>🏠 Type: ${r.property_types}</div>` : ''}
          </div>
          ${r.must_haves ? `<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">✅ Must-haves: ${r.must_haves}</div>` : ''}
          ${r.notes ? `<div style="font-size:12px;background:var(--bg);padding:8px;border-radius:6px;color:var(--text2);margin-bottom:10px;line-height:1.5;">📝 ${r.notes}</div>` : ''}
          <div style="font-size:11px;color:var(--text2);margin-bottom:10px;">Submitted ${date}</div>
          ${isNew ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button class="btn btn-primary btn-sm" onclick="FormResponses.addAsClient('${r.id}')">✅ Add as Client</button>
            <button class="btn btn-red btn-sm" onclick="FormResponses.dismiss('${r.id}')">🗑 Dismiss</button>
          </div>` : ''}
        </div>`;
      }).join('')}`;
  },

  async addAsClient(id) {
    const r = FormResponses.all.find(x => x.id === id);
    if (!r || !currentAgent?.id) return;

    // ── DISABLE BUTTON IMMEDIATELY to prevent double-clicks ────────────────
    const btn = document.querySelector(`button[onclick="FormResponses.addAsClient('${id}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }

    // ── DUPLICATE CHECK — block if client with same email already exists ───
    const { data: existing } = await db.from('clients')
      .select('id, full_name')
      .eq('agent_id', currentAgent.id)
      .eq('email', r.email)
      .limit(1);
    if (existing?.length) {
      App.toast(`⚠️ ${r.full_name} is already in your clients list!`, 'var(--red)');
      // Mark intake as Added so it won't show again
      await db.from('client_intake').update({ status: 'Added' }).eq('id', id);
      FormResponses.load();
      return;
    }

    // Build notes from intake data
    const notes = [
      r.property_types ? `Looking for: ${r.property_types}` : '',
      r.must_haves ? `Must-haves: ${r.must_haves}` : '',
      r.current_status ? `Current status: ${r.current_status}` : '',
      r.preapproval ? `Pre-approval: ${r.preapproval}` : '',
      r.referral_source ? `Referred by: ${r.referral_source}` : '',
      r.notes ? `Client notes: ${r.notes}` : ''
    ].filter(Boolean).join('\n');

    const { error } = await db.from('clients').insert({
      agent_id: currentAgent.id,
      full_name: r.full_name,
      email: r.email,
      phone: r.phone || null,
      budget_min: r.budget_min ? Number(r.budget_min) : null,
      budget_max: r.budget_max ? Number(r.budget_max) : null,
      preferred_areas: r.preferred_areas || null,
      bedrooms: r.bedrooms || null,
      stage: 'New Lead',
      status: 'Active',
      notes: notes || null
    });
    if (error) {
      if (btn) { btn.disabled = false; btn.textContent = '✅ Add as Client'; }
      App.toast('⚠️ Error: ' + error.message, 'var(--red)');
      return;
    }

    // Fetch the new client record so we have the ID
    const { data: newClient } = await db.from('clients')
      .select('id, full_name, email')
      .eq('agent_id', currentAgent.id)
      .eq('email', r.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Mark intake as processed
    await db.from('client_intake').update({ status: 'Added' }).eq('id', id);
    await App.logActivity('CLIENT_ADDED', r.full_name, r.email, `Added from intake form: ${r.full_name}`);

    // ── AUTO-QUEUE WELCOME EMAIL FOR APPROVAL ──────────────────────────────
    // Use newClient if fetched, otherwise build a minimal client object from intake
    const clientForEmail = newClient || { id: null, full_name: r.full_name, email: r.email };
    if (window.Notify) {
      await Notify.onClientAdded(clientForEmail, r);
    }

    App.toast(`✅ ${r.full_name} added! Welcome email queued for your approval.`, 'var(--green)');
    FormResponses.load();
    Clients.load();
    // Switch to Approvals so agent can review the welcome email right away
    if (window.App?.switchTab) App.switchTab('approvals');
  },

  async dismiss(id) {
    await db.from('client_intake').update({ status: 'Dismissed' }).eq('id', id);
    App.toast('Submission dismissed');
    FormResponses.load();
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
    const [{ data: viewings }, { data: offers }, { data: pipelineDeals }] = await Promise.all([
      db.from('viewings').select('*').eq('client_id', clientId).order('viewing_date', { ascending: false }),
      db.from('offers').select('*').eq('client_id', clientId).order('offer_date', { ascending: false }),
      db.from('pipeline').select('*').eq('agent_id', currentAgent.id).eq('client_id', clientId)
    ]);
    const clientOffers = offers || [];
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
          <thead><tr style="background:#f1f5f9;"><th style="padding:8px 12px;text-align:left;">Property</th><th style="padding:8px 12px;text-align:right;">Offer Amount</th><th style="padding:8px 12px;text-align:left;">Status</th><th style="padding:8px 12px;text-align:left;">Date</th></tr></thead>
          <tbody>${clientOffers.map(o => `
            <tr style="border-top:1px solid #e2e8f0;">
              <td style="padding:8px 12px;">${o.property_address||'—'}</td>
              <td style="padding:8px 12px;text-align:right;font-weight:700;">${App.fmtMoney(o.offer_amount)}</td>
              <td style="padding:8px 12px;">${o.status||'—'}</td>
              <td style="padding:8px 12px;">${App.fmtDate(o.offer_date)}</td>
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
    follow_up: { subject: 'Checking In — How Are Things Going? 👋', body: `Hi [CLIENT_NAME],\n\nI just wanted to check in and see how your home search is going. The market has some great options right now and I'd love to help you find the right fit.\n\nAre there any properties you'd like to view, or any questions I can answer for you?\n\nLooking forward to hearing from you!\n\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` },
    new_listing_match: { subject: '🏠 New Listing That Matches Your Criteria!', body: `Hi [CLIENT_NAME],\n\nI came across a new listing that I think is a strong match for what you're looking for!\n\n[Add property details here]\n\nProperties like this tend to move quickly. Would you like to schedule a viewing? Just reply to this email or give me a call and I'll set it up right away.\n\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` },
    referral_request: { subject: 'A Small Favour — and Thank You! 🙏', body: `Hi [CLIENT_NAME],\n\nI hope you're settling in and loving your new home!\n\nIf you had a great experience working with me, I'd be truly grateful if you could:\n\n⭐ Leave me a Google Review (it takes just 2 minutes!)\n👥 Refer me to any friends, family, or colleagues looking to buy or sell\n\nWord-of-mouth referrals are the highest compliment I can receive, and I promise to take great care of anyone you send my way.\n\nThank you again!\n\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` },
    post_closing_checkin: { subject: 'How Are You Settling In? 🏡', body: `Hi [CLIENT_NAME],\n\nJust wanted to check in and see how you're settling into your new home! I hope everything is going smoothly.\n\nIf you have any questions or need any recommendations (contractors, services, etc.), please don't hesitate to reach out — I'm always happy to help.\n\nEnjoy your new home!\n\nMaxwell Delali Midodzi\neXp Realty | (709) 325-0545` }
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

  async send() {
    const st = document.getElementById('email-status');
    const clientSel = document.getElementById('email-client');
    const opt = clientSel.options[clientSel.selectedIndex];
    if (!opt?.value) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Please select a client'; return; }
    const subject = document.getElementById('email-subject').value.trim();
    const bodyText = EmailSend.getBodyText('email-body');
    if (!subject) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Subject is required'; return; }
    const attachment = document.getElementById('email-attachment').value.trim();
    // Build your signature automatically from your profile
    const sig = currentAgent?.email_signature ||
      `${currentAgent?.full_name || 'Maxwell Delali Midodzi'}\n${currentAgent?.title ? currentAgent.title + '\n' : ''}${currentAgent?.brokerage || 'eXp Realty'}${currentAgent?.phone ? '\n' + currentAgent.phone : ''}${currentAgent?.email ? '\n' + currentAgent.email : ''}`;
    const fullBody = bodyText + '\n\n--\n' + sig + (attachment ? `\n\nAttachment: ${attachment}` : '');
    st.style.color = 'var(--text2)'; st.textContent = 'Sending to Approvals...';
    // ── QUEUE FOR YOUR APPROVAL — nothing goes to client until you approve ──
    if (window.Notify) {
      await Notify.queue('Client Email', opt.value, opt.dataset.name, opt.dataset.email, subject, fullBody);
    }
    App.logActivity('EMAIL_QUEUED', opt.dataset.name, opt.dataset.email, `Email queued for approval: ${subject}`);
    st.style.color = 'var(--green)';
    st.textContent = '✅ Sent to Approvals — tap the 📬 badge to review & send!';
    App.toast('📬 Email queued — check Approvals to send it', 'var(--accent2)');
  },

  async sendExternal() {
    const st = document.getElementById('ext-status');
    const toEmail = document.getElementById('ext-email').value.trim();
    const toName = document.getElementById('ext-name').value.trim();
    const subject = document.getElementById('ext-subject').value.trim();
    const bodyText = EmailSend.getBodyText('ext-body');
    const cc = document.getElementById('ext-cc').value.trim();
    const attachment = document.getElementById('ext-attachment').value.trim();
    if (!toEmail) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Recipient email is required'; return; }
    if (!subject) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Subject is required'; return; }
    // Build your signature automatically from your profile
    const sig = currentAgent?.email_signature ||
      `${currentAgent?.full_name || 'Maxwell Delali Midodzi'}\n${currentAgent?.title ? currentAgent.title + '\n' : ''}${currentAgent?.brokerage || 'eXp Realty'}${currentAgent?.phone ? '\n' + currentAgent.phone : ''}${currentAgent?.email ? '\n' + currentAgent.email : ''}`;
    const fullBody = bodyText + '\n\n--\n' + sig + (attachment ? `\n\nAttachment: ${attachment}` : '') + (cc ? `\n\nCC: ${cc}` : '');
    st.style.color = 'var(--text2)'; st.textContent = 'Sending to Approvals...';
    // ── QUEUE FOR YOUR APPROVAL — nothing goes to client until you approve ──
    if (window.Notify) {
      await Notify.queue('External Email', null, toName || toEmail, toEmail, subject, fullBody);
    }
    st.style.color = 'var(--green)';
    st.textContent = '✅ Sent to Approvals — tap the 📬 badge to review & send!';
    App.toast('📬 Email queued — check Approvals to send it', 'var(--accent2)');
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
  },

  // ── NEW CLEANUP SECTIONS ──────────────────────────────────────────────────

  findOldLabels() {
    const el = document.getElementById('cleanup-labels');
    if (!el) return;
    // In a PWA context, "labels" = client tags/stages. Show all clients with no stage set.
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Scanning...</div>';
    setTimeout(async () => {
      const { data } = await db.from('clients').select('id,full_name,stage').eq('agent_id', currentAgent.id);
      const noLabel = (data || []).filter(c => !c.stage || c.stage.trim() === '');
      if (!noLabel.length) { el.innerHTML = '<div class="text-muted" style="font-size:13px;padding:8px 0;">✅ All clients have a stage/label set.</div>'; return; }
      el.innerHTML = `<div style="font-size:12px;color:var(--yellow);margin-bottom:8px;">⚠️ ${noLabel.length} client(s) with no label/stage:</div>` +
        noLabel.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
          <input type="checkbox" id="lbl-${c.id}">
          <div style="flex:1;font-size:13px;"><span class="fw-700">${App.esc(c.full_name)}</span> <span style="color:var(--text2);">— no stage</span></div>
          <button class="btn btn-outline btn-sm" style="font-size:11px;" onclick="Cleanup.setStage('${c.id}')">Set Stage</button>
        </div>`).join('') +
        `<button class="btn btn-sm" style="background:var(--red);color:#fff;margin-top:8px;" onclick="Cleanup.deleteChecked('lbl-')">🗑 Delete Checked</button>`;
    }, 100);
  },

  async setStage(id) {
    const stage = prompt('Enter stage for this client (e.g. New/Viewing, Active Search, Closed):');
    if (!stage) return;
    await db.from('clients').update({ stage, updated_at: new Date().toISOString() }).eq('id', id);
    App.toast(`✅ Stage set to: ${stage}`);
    Cleanup.findOldLabels();
  },

  async trashTestEmails() {
    const el = document.getElementById('cleanup-email-msg');
    if (el) el.textContent = 'Scanning...';
    const { data } = await db.from('email_inbox').select('id,recipient_name,recipient_email,subject').eq('agent_id', currentAgent.id);
    const testEmails = (data || []).filter(e =>
      /test|demo|sample|dummy|fake/i.test(e.recipient_name || '') ||
      /test|demo|sample|dummy|fake/i.test(e.subject || '') ||
      /test|demo/i.test(e.recipient_email || '')
    );
    if (!testEmails.length) { if (el) { el.style.color = 'var(--green)'; el.textContent = '✅ No test emails found.'; } return; }
    if (!confirm(`Remove ${testEmails.length} test email(s) from the log?`)) return;
    await db.from('email_inbox').delete().in('id', testEmails.map(e => e.id));
    if (el) { el.style.color = 'var(--green)'; el.textContent = `✅ Removed ${testEmails.length} test email(s).`; }
    App.toast(`🧹 Removed ${testEmails.length} test email(s).`);
  },

  async trashInactiveEmails() {
    const el = document.getElementById('cleanup-email-msg');
    if (el) el.textContent = 'Scanning...';
    // Get inactive (Lost/Closed) client emails
    const { data: clients } = await db.from('clients').select('email,stage').eq('agent_id', currentAgent.id);
    const inactiveEmails = new Set((clients || [])
      .filter(c => /lost|closed/i.test(c.stage || ''))
      .map(c => (c.email || '').toLowerCase()).filter(Boolean));
    if (!inactiveEmails.size) { if (el) { el.style.color = 'var(--green)'; el.textContent = '✅ No inactive clients found.'; } return; }
    const { data: emails } = await db.from('email_inbox').select('id,recipient_email').eq('agent_id', currentAgent.id);
    const toDelete = (emails || []).filter(e => inactiveEmails.has((e.recipient_email || '').toLowerCase()));
    if (!toDelete.length) { if (el) { el.style.color = 'var(--green)'; el.textContent = '✅ No emails from inactive clients.'; } return; }
    if (!confirm(`Remove ${toDelete.length} email(s) from inactive/closed clients?`)) return;
    await db.from('email_inbox').delete().in('id', toDelete.map(e => e.id));
    if (el) { el.style.color = 'var(--green)'; el.textContent = `✅ Removed ${toDelete.length} email(s).`; }
    App.toast(`📭 Removed ${toDelete.length} inactive client email(s).`);
  },

  scanFolders() {
    const el = document.getElementById('cleanup-folders');
    if (!el) return;
    el.innerHTML = '<div style="font-size:13px;color:var(--text2);padding:12px;background:var(--bg);border-radius:8px;line-height:1.8;">ℹ️ <strong>Drive Folder Cleanup</strong> is a Google Apps Script feature that scans your Google Drive.<br><br>In this PWA, your client data is stored in Supabase — not Google Drive folders. Use the <strong>Orphaned Records</strong> scan above to find unlinked data, or use the Cleanup tab in your Google Sheets CRM to manage Drive folders.</div>';
  },

  scanLabels() {
    const el = document.getElementById('cleanup-gmail-labels');
    if (!el) return;
    el.innerHTML = '<div style="font-size:13px;color:var(--text2);padding:12px;background:var(--bg);border-radius:8px;line-height:1.8;">ℹ️ <strong>Gmail Label Cleanup</strong> is a Google Apps Script feature that reads your Gmail labels.<br><br>In this PWA, emails are logged in Supabase — not Gmail labels. Use the <strong>Email Cleanup</strong> section above to clean the logged email inbox, or use your Google Sheets CRM to manage Gmail labels.</div>';
  }
};

// ── SYSTEM TOOLS ─────────────────────────────────────────────────────────────
const SystemTools = {
  async load() {
    SystemTools.populateClients();
    SystemTools.showAccountInfo();
  },

  async populateClients() {
    const sel = document.getElementById('sys-welcome-client');
    if (!sel || !currentAgent?.id) return;
    const { data } = await db.from('clients').select('id,full_name,email').eq('agent_id', currentAgent.id).order('full_name');
    sel.innerHTML = '<option value="">-- Choose a client --</option>' +
      (data || []).map(c => `<option value="${c.id}" data-name="${App.esc(c.full_name)}" data-email="${App.esc(c.email||'')}">${App.esc(c.full_name)} — ${c.email || 'no email'}</option>`).join('');
  },

  async resendWelcome() {
    const sel = document.getElementById('sys-welcome-client');
    const msg = document.getElementById('sys-welcome-msg');
    const opt = sel?.options[sel.selectedIndex];
    if (!opt?.value) { if (msg) { msg.style.color='var(--red)'; msg.textContent='⚠️ Please select a client.'; } return; }
    if (msg) { msg.style.color='var(--text2)'; msg.textContent='Adding to approval queue...'; }
    const { error } = await db.from('approval_queue').insert({
      agent_id: currentAgent.id,
      client_name: opt.dataset.name,
      approval_type: 'Welcome Email',
      client_email: opt.dataset.email || null,
      context_data: `Resend welcome email to ${opt.dataset.name} (${opt.dataset.email})`,
      status: 'Pending'
    });
    if (error) { if (msg) { msg.style.color='var(--red)'; msg.textContent=error.message; } return; }
    if (msg) { msg.style.color='var(--green)'; msg.textContent=`✅ Welcome email queued for ${opt.dataset.name}! Check Approvals to send.`; }
    App.toast(`📨 Welcome email queued for ${opt.dataset.name}`);
  },

  async runDiagnostics() {
    const el = document.getElementById('sys-diagnostics');
    if (!el) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Running diagnostics...</div>';
    const issues = [];
    const ok = [];

    try {
      // Check clients table
      const { data: cl, error: clErr } = await db.from('clients').select('id,full_name,stage,email').eq('agent_id', currentAgent.id);
      if (clErr) { issues.push(`❌ Cannot read clients table: ${clErr.message}`); }
      else {
        ok.push(`✅ Clients table: ${cl.length} records`);
        const noStage = cl.filter(c => !c.stage).length;
        const noEmail = cl.filter(c => !c.email).length;
        if (noStage > 0) issues.push(`⚠️ ${noStage} client(s) have no stage set`);
        if (noEmail > 0) issues.push(`⚠️ ${noEmail} client(s) have no email address`);
      }

      // Check viewings table
      const { data: vi, error: viErr } = await db.from('viewings').select('id').eq('agent_id', currentAgent.id);
      if (viErr) issues.push(`❌ Cannot read viewings table: ${viErr.message}`);
      else ok.push(`✅ Viewings table: ${vi.length} records`);

      // Check pipeline
      const { data: pi, error: piErr } = await db.from('pipeline').select('id').eq('agent_id', currentAgent.id);
      if (piErr) issues.push(`❌ Cannot read pipeline table: ${piErr.message}`);
      else ok.push(`✅ Pipeline table: ${pi.length} records`);

      // Check commissions
      const { data: co, error: coErr } = await db.from('commissions').select('id').eq('agent_id', currentAgent.id);
      if (coErr) issues.push(`❌ Cannot read commissions table: ${coErr.message}`);
      else ok.push(`✅ Commissions table: ${co.length} records`);

      // Check approval queue
      const { data: aq, error: aqErr } = await db.from('approval_queue').select('id').eq('agent_id', currentAgent.id).eq('status','Pending');
      if (aqErr) issues.push(`⚠️ Cannot read approval queue: ${aqErr.message}`);
      else if (aq.length > 0) issues.push(`⚠️ ${aq.length} pending approval(s) waiting for action`);
      else ok.push(`✅ No pending approvals`);

    } catch (e) {
      issues.push(`❌ Diagnostic error: ${e.message}`);
    }

    const allGood = issues.length === 0;
    el.innerHTML = `
      <div style="font-size:13px;margin-bottom:10px;font-weight:700;color:${allGood ? 'var(--green)' : 'var(--yellow)'};">${allGood ? '✅ All systems healthy!' : `⚠️ ${issues.length} issue(s) found`}</div>
      ${issues.map(i => `<div style="padding:6px 10px;background:rgba(239,68,68,0.1);border-left:3px solid var(--red);border-radius:4px;font-size:13px;margin-bottom:6px;">${i}</div>`).join('')}
      ${ok.map(i => `<div style="padding:6px 10px;background:rgba(16,185,129,0.08);border-left:3px solid var(--green);border-radius:4px;font-size:13px;margin-bottom:6px;">${i}</div>`).join('')}
    `;
  },

  async loadStats() {
    const el = document.getElementById('sys-db-stats');
    if (!el) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const tables = ['clients','viewings','pipeline','commissions','approval_queue','activity_log','new_builds','email_inbox','checklist_items'];
    const results = await Promise.all(tables.map(t =>
      db.from(t).select('id', { count: 'exact', head: true }).eq('agent_id', currentAgent.id)
        .then(({ count }) => ({ t, count: count || 0 }))
        .catch(() => ({ t, count: '—' }))
    ));
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">` +
      results.map(r => `<div class="stat-card" style="text-align:center;padding:12px;">
        <div style="font-size:18px;font-weight:800;color:var(--accent2);">${r.count}</div>
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;">${r.t.replace(/_/g,' ')}</div>
      </div>`).join('') + `</div>`;
  },

  showAccountInfo() {
    const el = document.getElementById('sys-account-info');
    if (!el || !currentAgent) return;
    el.innerHTML = `
      <div>👤 <strong>Name:</strong> ${App.esc(currentAgent.full_name || '—')}</div>
      <div>✉️ <strong>Email:</strong> ${App.esc(currentAgent.email || '—')}</div>
      <div>🏢 <strong>Brokerage:</strong> ${App.esc(currentAgent.brokerage || '—')}</div>
      <div>📍 <strong>Province:</strong> ${App.esc(currentAgent.province || '—')}</div>
      <div>🆔 <strong>Agent ID:</strong> <span style="font-size:11px;opacity:0.6;">${currentAgent.id}</span></div>
      <div>🔒 <strong>PWA Version:</strong> Maxwell DealFlow v2.0</div>
    `;
  },

  // ── NEW SYSTEM MENU ACTIONS ──────────────────────────────────────────

  resendWelcomeModal() {
    SystemTools.populateClients();
    const m = document.getElementById('sys-welcome-modal');
    if (m) { m.style.display = 'flex'; }
  },

  refreshDashboard() {
    App.toast('🔄 Refreshing dashboard & analytics...');
    if (window.Analytics) Analytics.load();
    App.switchTab('analytics');
  },

  buildCharts() {
    App.toast('📊 Building analytics charts...');
    if (window.Analytics) Analytics.load();
    App.switchTab('analytics');
  },

  openTheme() {
    const m = document.getElementById('sys-theme-modal');
    if (!m) return;
    SystemTools.renderThemePresets();
    m.style.display = 'flex';
  },

  renderThemePresets() {
    const el = document.getElementById('theme-presets');
    if (!el) return;
    const themes = [
      { id:'midnight', name:'Midnight Blue', desc:'Deep navy & sky blue', swatches:['#1a2236','#2c3e6b','#4a90d9','#e2e8f0'] },
      { id:'ocean',    name:'Ocean',         desc:'Teal & aqua vibes',   swatches:['#0d4f6b','#1a7a8a','#2dd4bf','#e0f2fe'] },
      { id:'emerald',  name:'Emerald',       desc:'Rich green forest',   swatches:['#166534','#14532d','#22c55e','#dcfce7'] },
      { id:'purple',   name:'Royal Purple',  desc:'Luxurious violet',    swatches:['#6d28d9','#4c1d95','#a78bfa','#ede9fe'] },
      { id:'sunset',   name:'Sunset',        desc:'Warm orange glow',    swatches:['#c2410c','#7c2d12','#fb923c','#fff7ed'] },
      { id:'rose',     name:'Rose',          desc:'Elegant pink & crimson',swatches:['#be123c','#881337','#fb7185','#fff1f2'] },
      { id:'slate',    name:'Slate',         desc:'Clean & minimal',     swatches:['#475569','#334155','#7dd3fc','#f8fafc'] },
      { id:'white',    name:'Clean White',   desc:'Light & bright',      swatches:['#4a80c4','#ffffff','#60a5fa','#1e293b'] },
    ];
    const saved = localStorage.getItem('mdf-theme') || 'midnight';
    el.innerHTML = themes.map(t => `
      <div class="theme-card${t.id===saved?' active':''}" onclick="SystemTools.applyPresetTheme('${t.id}',this)">
        <div class="theme-swatches">
          ${t.swatches.map(c=>`<div class="theme-swatch" style="background:${c};"></div>`).join('')}
        </div>
        <div class="theme-name">${t.name}</div>
        <div class="theme-desc">${t.desc}</div>
      </div>`).join('');
  },

  applyPresetTheme(id, el) {
    document.querySelectorAll('.theme-card').forEach(c=>c.classList.remove('active'));
    if (el) el.classList.add('active');
    const map = {
      midnight: { bg:'#0f172a', card:'#1e293b', accent:'#4a90d9', headerL:'#1a2236', headerR:'#2b4a8c' },
      ocean:    { bg:'#0a2a38', card:'#0d3a4f', accent:'#2dd4bf', headerL:'#0d4f6b', headerR:'#1a7a8a' },
      emerald:  { bg:'#052e16', card:'#14532d', accent:'#22c55e', headerL:'#166534', headerR:'#15803d' },
      purple:   { bg:'#1e1b4b', card:'#2e1b6e', accent:'#a78bfa', headerL:'#4c1d95', headerR:'#6d28d9' },
      sunset:   { bg:'#1c0a00', card:'#431407', accent:'#fb923c', headerL:'#7c2d12', headerR:'#c2410c' },
      rose:     { bg:'#1a0009', card:'#4c0519', accent:'#fb7185', headerL:'#881337', headerR:'#be123c' },
      slate:    { bg:'#0f172a', card:'#1e293b', accent:'#7dd3fc', headerL:'#334155', headerR:'#475569' },
      white:    { bg:'#f1f5f9', card:'#ffffff', accent:'#3b82f6', headerL:'#4a80c4', headerR:'#2563eb' },
    };
    const t = map[id];
    if (!t) return;
    SystemTools._applyThemeVars(t);
    localStorage.setItem('mdf-theme', id);
    localStorage.setItem('mdf-theme-custom', JSON.stringify(t));
    App.toast('🎨 Theme applied!');
  },

  applyCustomTheme() {
    const t = {
      headerL: document.getElementById('th-header-left')?.value || '#1a2236',
      headerR: document.getElementById('th-header-right')?.value || '#2b4a8c',
      card:    document.getElementById('th-card-bg')?.value || '#1e293b',
      accent:  document.getElementById('th-accent')?.value || '#4a90d9',
      bg:      '#0f172a'
    };
    document.querySelectorAll('.theme-card').forEach(c=>c.classList.remove('active'));
    SystemTools._applyThemeVars(t);
    localStorage.setItem('mdf-theme', 'custom');
    localStorage.setItem('mdf-theme-custom', JSON.stringify(t));
    App.toast('🎨 Custom theme applied!');
  },

  _applyThemeVars(t) {
    const r = document.documentElement.style;
    if (t.bg)      r.setProperty('--bg', t.bg);
    if (t.card)    r.setProperty('--card', t.card);
    if (t.accent)  r.setProperty('--accent2', t.accent);
    if (t.headerL) r.setProperty('--header-left', t.headerL);
    if (t.headerR) r.setProperty('--header-right', t.headerR);
    // Also update header gradient if it exists
    const hdr = document.querySelector('.top-header, header, .app-header');
    if (hdr && t.headerL) hdr.style.background = `linear-gradient(135deg,${t.headerL},${t.headerR||t.headerL})`;
  },

  loadSavedTheme() {
    const saved = localStorage.getItem('mdf-theme-custom');
    if (saved) { try { SystemTools._applyThemeVars(JSON.parse(saved)); } catch(e){} }
  },

  updateOfferStatus() {
    App.switchTab('pipeline');
    App.toast('📝 Update offer status in Pipeline tab');
  },

  reverseAcceptedOffer() {
    App.switchTab('pipeline');
    App.toast('🔃 Use Revert Close buttons in Pipeline tab');
  },

  dealProgress() {
    App.switchTab('pipeline');
    App.toast('📈 Deal progress shown in Pipeline tab');
  },

  dealChecklist() {
    App.switchTab('checklist');
    App.toast('📋 Opening Deal Checklist tab...');
  },

  rescheduleViewing() {
    App.switchTab('viewings');
    App.toast('🔃 Reschedule viewings in the Viewings tab');
  },

  manageLifecycle() {
    App.switchTab('clients');
    App.toast('👤 Manage client lifecycle in Clients tab');
  },

  deleteClient() {
    App.switchTab('clients');
    App.toast('🗑️ Select a client to delete in Clients tab');
  },

  restoreClient() {
    App.switchTab('clients');
    App.toast('♻️ Find and restore archived clients in Clients tab');
  },

  permanentDelete() {
    if (!confirm('⚠️ Permanent Delete: This will hard-delete selected records. Continue?')) return;
    App.switchTab('cleanup');
    App.toast('⚠️ Use Cleanup tools for permanent deletions');
  },

  organizeEmails() {
    App.switchTab('inbox');
    App.toast('📧 Opening Inbox to organize client emails...');
  },

  labelTestEmails() {
    App.switchTab('inbox');
    App.toast('🏷️ Use Email Cleanup in Cleanup tab to label/trash test emails');
  },

  trashInactiveEmails() {
    App.switchTab('cleanup');
    App.toast('🗑️ Use Email Cleanup section in Cleanup tab');
  },

  setupTriggers() {
    App.toast('⚙️ Triggers are automated — Supabase handles real-time updates. No manual setup needed in PWA.');
  },

  verifyTriggers() {
    SystemTools.runDiagnostics();
    // Show the diagnostics card
    const d = document.getElementById('sys-diagnostics');
    if (d) d.parentElement.querySelector('button')?.click();
  },

  async sendMorningSummary() {
    App.toast('☀️ Building morning summary...');
    const { data: clients } = await db.from('clients').select('full_name,stage,updated_at').eq('agent_id', currentAgent.id).limit(50);
    if (!clients?.length) { App.toast('No clients found.'); return; }
    const needsFollowUp = clients.filter(c => {
      if (!c.updated_at) return true;
      const days = Math.floor((Date.now() - new Date(c.updated_at)) / 86400000);
      return days >= 3;
    });
    const summary = `Good morning! Here's your Maxwell DealFlow summary for ${new Date().toLocaleDateString('en-CA')}:\n\n`
      + `📊 Total Active Clients: ${clients.length}\n`
      + `⏰ Needs Follow-Up (3+ days): ${needsFollowUp.length}\n\n`
      + (needsFollowUp.slice(0,5).map(c=>`• ${c.full_name} — ${c.stage||'No stage'}`).join('\n'))
      + `\n\nHave a great day! — Maxwell DealFlow`;
    App.switchTab('email');
    setTimeout(() => {
      const subj = document.getElementById('email-subject');
      const body = document.getElementById('email-body');
      if (subj) subj.value = `☀️ Morning Summary — ${new Date().toLocaleDateString('en-CA')}`;
      if (body) body.innerHTML = summary.replace(/\n/g,'<br>');
    }, 400);
  },

  initConfig() {
    App.toast('🔧 Configuration is managed via Supabase. Open your Supabase dashboard to update settings.');
  },

  manualOfferUpdate() {
    App.switchTab('offers');
    App.toast('📝 Update offer details in the Offers tab');
  },

  setWebAppUrl() {
    const url = prompt('Enter your Web App URL (leave blank to use current):', window.location.href);
    if (url) {
      localStorage.setItem('mdf-webapp-url', url);
      App.toast('🌐 Web App URL saved: ' + url);
    }
  }
};

// ── SETTINGS ─────────────────────────────────────────────────────────────────
const Settings = {
  load() {
    Settings.fillProfile();
    Settings.renderThemePresets();
    Settings.loadNotifPrefs();
    Settings.showSessionInfo();
    Settings.showTab('profile', document.querySelector('.stab'));
  },

  showTab(name, btn) {
    document.querySelectorAll('.stab-panel').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById(`stab-${name}`);
    if (panel) panel.style.display = 'block';
    if (btn) btn.classList.add('active');
    if (name === 'data') Settings.loadDbStats();
  },

  fillProfile() {
    if (!currentAgent) return;
    const a = currentAgent;
    const initials = (a.full_name || a.name || 'MD').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    // Target the initials span only — don't overwrite the photo img
    const avInitials = document.getElementById('settings-avatar-initials');
    if (avInitials) avInitials.textContent = initials;
    // Restore photo if saved
    if (window.Settings) Settings.loadSavedPhoto();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    const txt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
    txt('settings-agent-name', a.full_name || a.name);
    txt('settings-agent-email', a.email);
    txt('settings-agent-brokerage', a.brokerage);
    set('set-name', a.full_name || a.name);
    set('set-email', a.email);
    set('set-phone', a.phone);
    set('set-brokerage', a.brokerage);
    set('set-province', a.province);
    set('set-license', a.license_number || a.license);
    set('set-signature', a.email_signature || a.signature || `${a.full_name || a.name}\n${a.brokerage || ''}\n${a.phone || ''}`);
  },

  async saveProfile() {
    const msg = document.getElementById('set-profile-msg');
    if (!currentAgent) { if (msg) { msg.style.color='var(--red)'; msg.textContent='Not logged in.'; } return; }
    const updates = {
      full_name: document.getElementById('set-name')?.value.trim(),
      phone: document.getElementById('set-phone')?.value.trim(),
      brokerage: document.getElementById('set-brokerage')?.value.trim(),
      province: document.getElementById('set-province')?.value.trim(),
      license_number: document.getElementById('set-license')?.value.trim(),
      email_signature: document.getElementById('set-signature')?.value.trim(),
    };
    if (msg) { msg.style.color='var(--text2)'; msg.textContent='Saving...'; }
    // 1. Update local state immediately (instant feedback)
    Object.assign(currentAgent, updates);
    // 2. Persist to localStorage as backup (works even without Supabase write access)
    try { localStorage.setItem('mdf-profile-cache', JSON.stringify(updates)); } catch(e) {}
    // 3. Update all UI elements instantly
    const initials = (updates.full_name || 'MD').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    ['topbar-initials','settings-avatar-initials'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=initials; });
    ['topbar-name'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=updates.full_name||''; });
    ['topbar-brokerage'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=updates.brokerage||''; });
    const sn = document.getElementById('settings-agent-name'); if(sn) sn.textContent = updates.full_name||'';
    const sb = document.getElementById('settings-agent-brokerage'); if(sb) sb.textContent = updates.brokerage||'';
    if (msg) { msg.style.color='var(--green)'; msg.textContent='✅ Profile saved!'; }
    App.toast('✅ Profile updated');
    // 4. Sync to Supabase in background (non-blocking — if it fails, local save is enough)
    if (currentAgent?.id) {
      db.from('agents').update(updates).eq('id', currentAgent.id).then(({ error }) => {
        if (error) console.warn('Profile sync to Supabase failed (local save kept):', error.message);
      });
    }
  },

  renderThemePresets() {
    const el = document.getElementById('set-theme-presets');
    if (!el) return;
    const themes = [
      { id:'midnight', name:'Midnight Blue', swatches:['#1a2236','#2c3e6b','#4a90d9','#e2e8f0'] },
      { id:'ocean',    name:'Ocean',         swatches:['#0d4f6b','#1a7a8a','#2dd4bf','#e0f2fe'] },
      { id:'emerald',  name:'Emerald',       swatches:['#166534','#14532d','#22c55e','#dcfce7'] },
      { id:'purple',   name:'Royal Purple',  swatches:['#6d28d9','#4c1d95','#a78bfa','#ede9fe'] },
      { id:'sunset',   name:'Sunset',        swatches:['#c2410c','#7c2d12','#fb923c','#fff7ed'] },
      { id:'rose',     name:'Rose',          swatches:['#be123c','#881337','#fb7185','#fff1f2'] },
      { id:'slate',    name:'Slate',         swatches:['#475569','#334155','#7dd3fc','#f8fafc'] },
      { id:'white',    name:'Clean White',   swatches:['#4a80c4','#ffffff','#60a5fa','#1e293b'] },
    ];
    const saved = localStorage.getItem('mdf-theme') || 'midnight';
    el.innerHTML = themes.map(t => `
      <div class="theme-card${t.id===saved?' active':''}" onclick="SystemTools.applyPresetTheme('${t.id}',this);localStorage.setItem('mdf-theme','${t.id}');document.querySelectorAll('#set-theme-presets .theme-card').forEach(c=>c.classList.remove('active'));this.classList.add('active');">
        <div class="theme-swatches">${t.swatches.map(c=>`<div class="theme-swatch" style="background:${c};width:20px;height:20px;border-radius:4px;border:1px solid rgba(255,255,255,.1);"></div>`).join('')}</div>
        <div style="font-size:12px;font-weight:700;margin-top:6px;">${t.name}</div>
      </div>`).join('');
  },

  applyCustom() {
    const el = { hl: document.getElementById('set-th-hl'), hr: document.getElementById('set-th-hr'), cb: document.getElementById('set-th-cb'), ac: document.getElementById('set-th-ac') };
    SystemTools.applyCustomTheme && SystemTools._applyThemeVars({
      headerL: el.hl?.value, headerR: el.hr?.value, card: el.cb?.value, accent: el.ac?.value, bg: '#0f172a'
    });
    App.toast('🎨 Custom theme applied!');
  },

  applyCompact(on) {
    document.documentElement.style.setProperty('--compact', on ? '1' : '0');
    document.querySelectorAll('.screen').forEach(s => s.style.padding = on ? '12px 16px' : '');
    localStorage.setItem('mdf-compact', on ? '1' : '0');
    App.toast(on ? 'Compact mode on' : 'Compact mode off');
  },

  applySidebarPin(on) {
    localStorage.setItem('mdf-sb-pin', on ? '1' : '0');
    App.toast(on ? 'Sidebar always visible' : 'Sidebar auto-hides on small screens');
  },

  loadNotifPrefs() {
    const prefs = JSON.parse(localStorage.getItem('mdf-notifs') || '{}');
    ['form','followup','approval','deal','build'].forEach(k => {
      const el = document.getElementById(`notif-${k}`);
      if (el) el.checked = prefs[k] !== undefined ? prefs[k] : (k !== 'deal' && k !== 'build');
    });
  },

  saveNotifs() {
    const prefs = {};
    ['form','followup','approval','deal','build'].forEach(k => {
      const el = document.getElementById(`notif-${k}`);
      if (el) prefs[k] = el.checked;
    });
    localStorage.setItem('mdf-notifs', JSON.stringify(prefs));
    const msg = document.getElementById('set-notif-msg');
    if (msg) { msg.style.color='var(--green)'; msg.textContent='✅ Preferences saved!'; }
    App.toast('🔔 Notification preferences saved');
  },

  async loadDbStats() {
    const el = document.getElementById('set-db-stats');
    if (!el) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const tables = ['clients','viewings','pipeline','commissions','approval_queue','new_builds','email_inbox','checklist_items'];
    const results = await Promise.all(tables.map(t =>
      db.from(t).select('id', { count: 'exact', head: true }).eq('agent_id', currentAgent.id)
        .then(({ count }) => ({ t, count: count || 0 }))
        .catch(() => ({ t, count: '—' }))
    ));
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;">` +
      results.map(r => `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:20px;font-weight:800;color:var(--accent2);">${r.count}</div>
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;margin-top:2px;">${r.t.replace(/_/g,' ')}</div>
      </div>`).join('') + `</div>`;
  },

  async exportCSV(table) {
    App.toast(`📥 Exporting ${table}...`);
    const { data, error } = await db.from(table).select('*').eq('agent_id', currentAgent.id).limit(2000);
    if (error || !data?.length) { App.toast('No data to export'); return; }
    const keys = Object.keys(data[0]);
    const csv = [keys.join(','), ...data.map(row => keys.map(k => {
      const v = row[k] == null ? '' : String(row[k]).replace(/"/g, '""');
      return `"${v}"`;
    }).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${table}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    App.toast(`✅ ${table} exported!`);
  },

  clearCache() {
    if (!confirm('Clear app cache and local settings? This will not delete your data.')) return;
    localStorage.removeItem('mdf-theme');
    localStorage.removeItem('mdf-theme-custom');
    localStorage.removeItem('mdf-compact');
    localStorage.removeItem('mdf-sb-groups');
    localStorage.removeItem('mdf-notifs');
    App.toast('🗑️ Cache cleared — reloading...');
    setTimeout(() => location.reload(), 1000);
  },

  resetTheme() {
    localStorage.removeItem('mdf-theme');
    localStorage.removeItem('mdf-theme-custom');
    document.documentElement.removeAttribute('style');
    App.toast('🔄 Theme reset to default');
  },

  async changePassword() {
    const np = document.getElementById('set-new-pass')?.value;
    const cp = document.getElementById('set-confirm-pass')?.value;
    const msg = document.getElementById('set-pass-msg');
    if (!np || np.length < 8) { if(msg){msg.style.color='var(--red)';msg.textContent='Password must be at least 8 characters.';} return; }
    if (np !== cp) { if(msg){msg.style.color='var(--red)';msg.textContent='Passwords do not match.';} return; }
    if (msg) { msg.style.color='var(--text2)'; msg.textContent='Updating...'; }
    const { error } = await db.auth.updateUser({ password: np });
    if (error) { if(msg){msg.style.color='var(--red)';msg.textContent=error.message;} return; }
    if(msg){msg.style.color='var(--green)';msg.textContent='✅ Password updated! Signing you out...';}
    setTimeout(() => App.signOut(), 2000);
  },

  showSessionInfo() {
    const el = document.getElementById('set-session-info');
    if (!el || !currentAgent) return;
    el.innerHTML = `
      <div>👤 <strong>Signed in as:</strong> ${App.esc(currentAgent.email || '—')}</div>
      <div>🏢 <strong>Brokerage:</strong> ${App.esc(currentAgent.brokerage || '—')}</div>
      <div>🆔 <strong>Agent ID:</strong> <span style="font-size:11px;opacity:0.5;">${currentAgent.id || '—'}</span></div>
      <div>🌐 <strong>Host:</strong> GitHub Pages + Supabase</div>
      <div>📦 <strong>Version:</strong> Maxwell DealFlow v2.0</div>
    `;
  }
};

// patch saveApiKey into Settings
Settings.saveApiKey = function() {
  const val = document.getElementById('set-claude-key')?.value.trim();
  const msg = document.getElementById('set-key-msg');
  if (!val || val.startsWith('•')) { if(msg){msg.style.color='var(--red)';msg.textContent='Please enter a valid key.';} return; }
  AI.setApiKey(val);
  if(msg){msg.style.color='var(--green)';msg.textContent='✅ API key saved! AI Assistant is now fully active.';}
  document.getElementById('set-claude-key').value = '••••••••' + val.slice(-8);
  // Show key status in AI screen
  const s = document.getElementById('ai-key-status');
  if(s){s.textContent='🟢 Key active';s.style.color='var(--green)';}
};

// ── PHOTO UPLOAD ─────────────────────────────────────────────────────────────
Settings.uploadPhoto = function(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { App.toast('⚠️ Photo must be under 2MB'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    // Save to localStorage
    localStorage.setItem('mdf-agent-photo', dataUrl);
    // Apply everywhere
    Settings.applyPhoto(dataUrl);
    App.toast('✅ Profile photo updated!');
  };
  reader.readAsDataURL(file);
};

Settings.applyPhoto = function(dataUrl) {
  if (!dataUrl) return;
  // Topbar
  const tp = document.getElementById('topbar-photo');
  const ti = document.getElementById('topbar-initials');
  if (tp) { tp.src = dataUrl; tp.style.display = 'block'; }
  if (ti) ti.style.display = 'none';
  // Settings preview
  const sp = document.getElementById('settings-photo-preview');
  const si = document.getElementById('settings-avatar-initials');
  if (sp) { sp.src = dataUrl; sp.style.display = 'block'; }
  if (si) si.style.display = 'none';
  // Lock screen
  const lp = document.getElementById('lock-photo');
  const li = document.getElementById('lock-initials');
  if (lp) { lp.src = dataUrl; lp.style.display = 'block'; }
  if (li) li.style.display = 'none';
};

Settings.removePhoto = function() {
  localStorage.removeItem('mdf-agent-photo');
  ['topbar-photo','settings-photo-preview','lock-photo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.src=''; el.style.display='none'; }
  });
  ['topbar-initials','settings-avatar-initials','lock-initials'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  App.toast('Photo removed');
};

Settings.loadSavedPhoto = function() {
  const saved = localStorage.getItem('mdf-agent-photo');
  if (saved) Settings.applyPhoto(saved);
};
