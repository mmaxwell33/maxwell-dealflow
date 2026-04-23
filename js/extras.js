// ── APPROVALS ──────────────────────────────────────────────────────────────
const Approvals = {
  async load() {
    const el = document.getElementById('approvals-list');
    // Always use auth.uid() to match RLS policy — same as what Notify.queue inserts
    const { data: { user } } = await db.auth.getUser();
    const agentId = user?.id || currentAgent?.id;
    if (!agentId) {
      setTimeout(() => Approvals.load(), 800);
      return;
    }
    const { data } = await db.from('approval_queue')
      .select('*').eq('agent_id', agentId)
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
            <button class="btn btn-sm" style="background:var(--text2);color:#fff;" onclick="Approvals.skip('${a.id}')">⏭ Skip (client aware)</button>
          </div>` : `<div style="font-size:11px;color:var(--text2);">${a.status === 'Approved' ? '✅ Sent to client' : '⏭ Skipped — client already aware'} · ${App.fmtDate(a.updated_at)}</div>`}
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
      <div class="modal-title">Email Preview</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">TO</div>
      <div class="fw-700" style="margin-bottom:12px;">${item.client_name} · ${item.client_email||'No email'}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">SUBJECT</div>
      <div class="fw-700" style="margin-bottom:12px;">${App.esc(item.email_subject||'')}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">MESSAGE</div>
      <div style="font-size:13px;white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:8px;line-height:1.7;max-height:340px;overflow-y:auto;margin-bottom:16px;">${App.esc(item.email_body||'')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <button class="btn btn-green" onclick="App.closeModal();Approvals.approve('${id}')">✅ Approve & Send</button>
        <button class="btn btn-outline" onclick="App.closeModal();Approvals.openEdit('${id}')">Edit Email</button>
      </div>
      <button class="btn btn-red btn-block" onclick="App.closeModal();Approvals.reject('${id}')">❌ Discard</button>
    `);
  },

  _data: [],

  _sending: new Set(), // in-memory lock — prevents double-tapping Approve

  async approve(id) {
    // ── SEND LOCK — block if already in flight ──────────────────────────────
    if (Approvals._sending.has(id)) {
      App.toast('⏳ Already sending this email — please wait', 'var(--yellow)');
      return;
    }
    Approvals._sending.add(id);

    const { data: item } = await db.from('approval_queue').select('*').eq('id', id).single();
    if (!item) { Approvals._sending.delete(id); return; }

    // ── DEDUP CHECK — block if same email already sent in last 24h ──────────
    try {
      const oneDayAgo = new Date(Date.now() - 24*60*60*1000).toISOString();
      const { data: dupes } = await db.from('approval_queue')
        .select('id')
        .eq('agent_id', item.agent_id)
        .eq('client_email', item.client_email || '')
        .eq('email_subject', item.email_subject || '')
        .eq('status', 'Approved')
        .gte('updated_at', oneDayAgo)
        .neq('id', id)
        .limit(1);
      if (dupes?.length) {
        App.toast('🛡️ Duplicate blocked — this exact email was already sent to this recipient within 24h', 'var(--yellow)');
        Approvals._sending.delete(id);
        return;
      }
    } catch { /* non-blocking — continue if check fails */ }

    App.toast('Sending email...', 'var(--accent2)');

    // Parse context_data — html, ics, cc, and real file attachments
    let htmlBody = null, icsAttachment = null, ccEmail = null, fileAttachments = null;
    if (item.context_data) {
      try {
        const ctx = typeof item.context_data === 'string' ? JSON.parse(item.context_data) : item.context_data;
        const rawHtml = ctx.html || null;
        if (rawHtml && !rawHtml.startsWith('<')) {
          try { htmlBody = decodeURIComponent(escape(atob(rawHtml))); } catch { htmlBody = rawHtml; }
        } else {
          htmlBody = rawHtml;
        }
        icsAttachment   = ctx.ics         || null;
        ccEmail         = ctx.cc          || null;
        fileAttachments = ctx.attachments || null; // [{filename,mime_type,data}]
      } catch {
        htmlBody = item.context_data;
      }
    }
    // Resolve the primary recipient: client email, or fall back to CC if client has no email
    const toEmail = item.client_email || ccEmail;
    const actualCc = item.client_email ? ccEmail : null; // don't CC if we used cc as primary

    if (toEmail && item.email_subject) {
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
            to: toEmail,
            cc: actualCc,
            subject: item.email_subject,
            body: item.email_body || '',
            html: htmlBody,
            ics: icsAttachment,
            attachments: fileAttachments || null,
            from_name: agent.name || agent.full_name || 'Maxwell Midodzi',
            from_email: null
          })
        });
        const result = await res.json();
        if (!res.ok || result.error) {
          const errMsg = result.error || result.message || JSON.stringify(result);
          App.toast(`❌ Email failed: ${errMsg}`, 'var(--red)');
          console.error('Email send error:', result);
          Approvals._sending.delete(id);
          return;
        }
        // Log sent email to inbox for threading
        try {
          await db.from('email_inbox').insert({
            agent_id: currentAgent.id,
            direction: 'sent',
            recipient_name: item.client_name || '',
            recipient_email: item.client_email,
            sender_name: agent.name || agent.full_name || 'Maxwell Midodzi',
            sender_email: agent.email || 'maxwelldelali22@gmail.com',
            subject: item.email_subject,
            body: item.email_body || '',
            gmail_message_id: result.gmail_message_id || null,
            gmail_thread_id: result.gmail_thread_id || null,
            is_read: true,
            created_at: new Date().toISOString()
          });
        } catch (logErr) { console.warn('Inbox log failed:', logErr); }
        // Mark approved in DB
        await db.from('approval_queue').update({ status: 'Approved', updated_at: new Date().toISOString() }).eq('id', id);
        App.logActivity('EMAIL_SENT', item.client_name, item.client_email, `Email sent: ${item.email_subject}`);
        Approvals.load();
        if (typeof Notify !== "undefined") Notify.updateBadge();
        if (typeof Inbox !== "undefined") Inbox.updateBadge();
        App.toast(`✅ Email sent to ${item.client_name}!`, 'var(--green)');
      } catch (err) {
        App.toast(`❌ Error: ${err.message}`, 'var(--red)');
      } finally {
        Approvals._sending.delete(id);
      }
    } else {
      // No email on file — just mark approved
      await db.from('approval_queue').update({ status: 'Approved', updated_at: new Date().toISOString() }).eq('id', id);
      App.logActivity('EMAIL_SENT', item.client_name, item.client_email, `Approved: ${item.email_subject}`);
      Approvals.load();
      if (typeof Notify !== "undefined") Notify.updateBadge();
      App.toast('✅ Approved and logged!', 'var(--green)');
      Approvals._sending.delete(id);
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
        <button class="btn btn-block" style="background:var(--text2);color:#fff;" onclick="App.closeModal();Approvals.skip('${id}')">⏭ Skip — client already aware</button>
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
    // "Reject" = skip this email, client is already aware. Pipeline continues unaffected.
    await db.from('approval_queue').update({ status: 'Skipped', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('⏭ Email skipped — pipeline continues.');
    Approvals.load();
    if (typeof Notify !== "undefined") Notify.updateBadge();
  },

  async skip(id) {
    await Approvals.reject(id);
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
        <button class="btn btn-outline btn-sm" style="margin-top:10px;width:100%;" onclick="navigator.clipboard.writeText('https://maxwell-dealflow.vercel.app/intake.html').then(()=>App.toast('✅ Link copied!'))">Copy Link</button>
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
        <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('https://maxwell-dealflow.vercel.app/intake.html').then(()=>App.toast('✅ Link copied!'))">Copy Link</button>
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
    if (typeof Notify !== "undefined") {
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

  // Auto-status from close_date: future=Pending, 0-2d=Closed, 2d+=Paid
  statusFrom(c) {
    if (!c.close_date) return 'Pending';
    const diff = (Date.now() - new Date(c.close_date + 'T12:00:00').getTime()) / 86400000;
    if (diff < 0) return 'Pending';
    if (diff < 2) return 'Closed';
    return 'Paid';
  },

  renderSummary(list) {
    const totalVolume = list.reduce((s, c) => s + (c.sale_price || 0), 0);
    const grossComm = list.reduce((s, c) => s + (c.gross_commission || 0), 0);
    const hst = list.reduce((s, c) => s + (c.hst_collected || 0), 0);
    const brokerFees = list.reduce((s, c) => s + (c.brokerage_fees || 0), 0);
    const netEarnings = list.reduce((s, c) => s + (c.agent_net || 0), 0);
    const closedDeals = list.filter(c => Commission.statusFrom(c) === 'Paid').length;

    const banner = document.getElementById('comm-net-display');
    if (banner) banner.textContent = App.fmtMoney(netEarnings);

    document.getElementById('commissions-summary').innerHTML = `
      <div class="stat2"><div class="stat2-lbl">Total Volume Sold</div><div class="stat2-num" style="font-size:18px;">${App.fmtMoney(totalVolume)}</div></div>
      <div class="stat2"><div class="stat2-lbl">Gross Commission</div><div class="stat2-num" style="font-size:18px;">${App.fmtMoney(grossComm)}</div></div>
      <div class="stat2"><div class="stat2-lbl">HST / Tax</div><div class="stat2-num" style="font-size:18px;color:var(--yellow);">${App.fmtMoney(hst)}</div></div>
      <div class="stat2"><div class="stat2-lbl">Brokerage Fees</div><div class="stat2-num" style="font-size:18px;color:var(--coral);">-${App.fmtMoney(brokerFees)}</div></div>
      <div class="stat2" style="border-left:3px solid var(--green);"><div class="stat2-lbl">Closed Deals</div><div class="stat2-num" style="color:var(--green);">${closedDeals}</div></div>`;
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
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;">
          Commission History &nbsp;<span style="color:var(--accent2);">(${list.length} record${list.length!==1?'s':''})</span>
        </div>
        <button class="btn2 btn2-ghost btn2-sm" onclick="Commission.load()">Refresh</button>
      </div>
      <div class="card2" style="padding:0;overflow:hidden;overflow-x:auto;">
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
              <td style="padding:11px 14px;text-align:right;color:var(--yellow);">+${App.fmtMoney(c.hst_collected||0)}</td>
              <td style="padding:11px 14px;text-align:right;color:var(--red);">-${App.fmtMoney(c.brokerage_fees||0)}</td>
              <td style="padding:11px 14px;text-align:right;font-weight:900;color:var(--green);">${App.fmtMoney(c.agent_net||0)}</td>
              <td style="padding:11px 14px;font-size:12px;color:var(--text2);white-space:nowrap;">${App.fmtDate(c.close_date)}</td>
              <td style="padding:11px 14px;text-align:center;">${(s=>
                `<span class="pill2 ${s==='Paid'?'pill2-green':s==='Closed'?'pill2-neutral':'pill2-amber'}">${s}</span>`
              )(Commission.statusFrom(c))}</td>
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
      sale_price: salePrice, commission_rate: rate, gross_commission: gross,
      hst_collected: hst, brokerage_fee_rate: brokerPct, brokerage_fees: brokerFee,
      agent_net: net, close_date: closeDate, status: 'Closed'
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
      db.from('commissions').select('agent_net,status').eq('agent_id', currentAgent.id)
    ]);
    const activeClients = (clients||[]).filter(c => c.status !== 'Lost').length;
    const closedDeals = (pipeline||[]).filter(p => p.stage === 'Closed').length;
    const totalViewings = (viewings||[]).length;
    const totalNet = (commissions||[]).reduce((s,c) => s + (c.agent_net||0), 0);
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

    // ─── Phase 2.C — Client Report v2 (branded, infographic layout) ───
    // Terracotta accent, Fraunces serif, timeline of viewings, progress bar, numbered next-steps.
    // Uses inline styles only (required for email compatibility — Gmail strips <style> tags).

    // Derived values
    const totalViewings = (viewings||[]).length;
    const totalOffers = clientOffers.length;
    const acceptedOffers = clientOffers.filter(o => /accept/i.test(o.status||'')).length;
    const createdAt = client.created_at ? new Date(client.created_at) : null;
    const daysActive = createdAt ? Math.max(1, Math.floor((Date.now() - createdAt.getTime())/(1000*60*60*24))) : 0;
    const reportId = `MX-${new Date().getFullYear()}-${String(client.id||'').replace(/-/g,'').slice(-4).toUpperCase() || '0000'}`;

    // Stage progress bar — 6 canonical stages
    const stageOrder = ['Active Search','In Offer','Under Contract','Conditions','Financing','Closed'];
    const stageAliases = { 'New Lead':0, 'Viewing':0, 'Active Search':0, 'In Offer':1, 'Accepted':2, 'Under Contract':2, 'Conditions':3, 'Financing':4, 'Closing':5, 'Closed':5 };
    const currentStageIdx = stageAliases[client.stage] ?? 0;

    // Preferred areas → chips
    const areaChips = (client.preferred_areas||'').split(/[,;]/).map(s => s.trim()).filter(Boolean);

    // Font stack (serif fallback for Fraunces so email clients without Google Fonts still look OK)
    const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
    const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
    const ACCENT = '#CC785C';
    const ACCENT2 = '#B3654A';

    let html = `<div style="font-family:${SANS};max-width:680px;margin:0 auto;background:#fff;color:#0A0A0A;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.08);">`;

    // HEADER
    html += `<div style="background:linear-gradient(135deg,${ACCENT} 0%,${ACCENT2} 100%);padding:36px 36px 32px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;opacity:0.85;margin-bottom:10px;">Client Progress Report</div>
      <div style="font-family:${SERIF};font-size:38px;font-weight:600;letter-spacing:-1px;line-height:1.05;margin-bottom:8px;">${client.full_name||'Client'}</div>
      <div style="font-size:14px;opacity:0.9;margin-bottom:18px;">Your property search journey · Prepared by ${agentName}</div>
      <div style="font-size:12px;opacity:0.85;">📅 ${dateStr} &nbsp;·&nbsp; 🏠 ${client.status||'Active'} · ${daysActive} day${daysActive===1?'':'s'} &nbsp;·&nbsp; 🔖 ${reportId}</div>
    </div>`;

    // SNAPSHOT STATS
    html += `<table role="presentation" style="width:100%;border-collapse:collapse;background:#E7E5E4;">
      <tr>
        <td style="background:#fff;padding:22px 16px;text-align:center;width:25%;border-right:1px solid #E7E5E4;">
          <div style="font-family:${SERIF};font-size:30px;font-weight:700;color:${ACCENT};line-height:1;margin-bottom:6px;">${totalViewings}</div>
          <div style="font-size:10px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:1px;">Viewings</div>
        </td>
        <td style="background:#fff;padding:22px 16px;text-align:center;width:25%;border-right:1px solid #E7E5E4;">
          <div style="font-family:${SERIF};font-size:30px;font-weight:700;color:${ACCENT};line-height:1;margin-bottom:6px;">${totalOffers}</div>
          <div style="font-size:10px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:1px;">Offers Made</div>
        </td>
        <td style="background:#fff;padding:22px 16px;text-align:center;width:25%;border-right:1px solid #E7E5E4;">
          <div style="font-family:${SERIF};font-size:30px;font-weight:700;color:${ACCENT};line-height:1;margin-bottom:6px;">${acceptedOffers}</div>
          <div style="font-size:10px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:1px;">Accepted</div>
        </td>
        <td style="background:#fff;padding:22px 16px;text-align:center;width:25%;">
          <div style="font-family:${SERIF};font-size:30px;font-weight:700;color:${ACCENT};line-height:1;margin-bottom:6px;">${daysActive}</div>
          <div style="font-size:10px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:1px;">Days Active</div>
        </td>
      </tr>
    </table>`;

    const sectionOpen = (title, sub) => `<div style="padding:28px 36px;border-bottom:1px solid #F3F1EC;">
      <div style="font-family:${SERIF};font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:4px;letter-spacing:-0.3px;">${title}</div>
      ${sub?`<div style="font-size:13px;color:#6B7280;margin-bottom:18px;">${sub}</div>`:''}`;
    const sectionClose = `</div>`;

    if (sections.info) {
      html += sectionOpen('Client Information', "Your profile on file.");
      html += `<table style="width:100%;font-size:13px;border-collapse:collapse;">
        ${client.full_name ? `<tr><td style="padding:8px 0;color:#6B7280;width:160px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Full Name</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;">${client.full_name}</td></tr>` : ''}
        ${client.phone ? `<tr><td style="padding:8px 0;color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Phone</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;">${client.phone}</td></tr>` : ''}
        ${client.email ? `<tr><td style="padding:8px 0;color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Email</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;">${client.email}</td></tr>` : ''}
      </table>`;
      html += sectionClose;
    }

    if (sections.criteria) {
      html += sectionOpen('Search Criteria', "What you're looking for.");
      html += `<table style="width:100%;font-size:13px;border-collapse:collapse;">
        ${(client.budget_min||client.budget_max) ? `<tr><td style="padding:8px 0;color:#6B7280;width:160px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Budget</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;">${App.fmtMoney(client.budget_min)} – ${App.fmtMoney(client.budget_max)}</td></tr>` : ''}
        ${client.bedrooms ? `<tr><td style="padding:8px 0;color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Bedrooms</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;">${client.bedrooms}+</td></tr>` : ''}
        ${client.property_type ? `<tr><td style="padding:8px 0;color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Property Type</td><td style="padding:8px 0;color:#0A0A0A;font-weight:500;">${client.property_type}</td></tr>` : ''}
      </table>`;
      if (areaChips.length) {
        html += `<div style="margin-top:16px;font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">Preferred Areas</div>
          <div>${areaChips.map(a => `<span style="display:inline-block;background:rgba(204,120,92,0.12);color:${ACCENT};font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;margin:0 6px 6px 0;">${a}</span>`).join('')}</div>`;
      }
      html += sectionClose;
    }

    if (sections.viewings) {
      html += sectionOpen(`Properties Viewed (${totalViewings})`, "Here's everywhere we've been together.");
      if (!totalViewings) {
        html += `<div style="font-size:13px;color:#6B7280;font-style:italic;">No viewings recorded yet.</div>`;
      } else {
        html += (viewings||[]).slice(0,15).map((v,i,arr) => {
          const isLast = i === arr.length-1;
          const liked = /(accept|like|interested|offer)/i.test(v.viewing_status||'');
          const passed = /(pass|reject|no)/i.test(v.viewing_status||'');
          const dotColor = liked ? ACCENT : (passed ? '#9CA3AF' : ACCENT);
          const tag = liked ? `<span style="display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:2px 7px;border-radius:4px;margin-left:6px;background:rgba(204,120,92,0.15);color:${ACCENT};vertical-align:middle;">${v.viewing_status}</span>` :
                      passed ? `<span style="display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:2px 7px;border-radius:4px;margin-left:6px;background:#F3F1EC;color:#6B7280;vertical-align:middle;">${v.viewing_status}</span>` : '';
          return `<table role="presentation" style="width:100%;border-collapse:collapse;${isLast?'':'margin-bottom:4px;'}">
            <tr>
              <td style="width:24px;vertical-align:top;padding-top:14px;">
                <div style="width:12px;height:12px;border-radius:50%;background:${dotColor};${passed?'':`box-shadow:0 0 0 3px rgba(204,120,92,0.15);`}"></div>
                ${isLast?'':`<div style="width:2px;height:calc(100% + 8px);background:#E7E5E4;margin:6px 0 0 5px;"></div>`}
              </td>
              <td style="padding:10px 0 14px 8px;">
                <div style="font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">${App.fmtDate(v.viewing_date)}</div>
                <div style="font-size:14px;font-weight:600;color:#0A0A0A;margin-bottom:3px;">${v.property_address||'—'}${tag}</div>
                ${v.notes ? `<div style="font-size:13px;color:#6B7280;line-height:1.5;">${v.notes}</div>` : ''}
              </td>
            </tr>
          </table>`;
        }).join('');
      }
      html += sectionClose;
    }

    if (sections.offers) {
      html += sectionOpen(`Offers Made (${totalOffers})`, "Every offer we've submitted on your behalf.");
      if (!totalOffers) {
        html += `<div style="font-size:13px;color:#6B7280;font-style:italic;">No offers recorded yet.</div>`;
      } else {
        html += clientOffers.map(o => {
          const st = (o.status||'').toLowerCase();
          const isAccepted = /accept/.test(st);
          const isCountered = /counter/.test(st);
          const isRejected = /reject|decline/.test(st);
          const cardStyle = isAccepted
            ? `border:1px solid ${ACCENT};background:linear-gradient(135deg,rgba(204,120,92,0.06),rgba(204,120,92,0.02));`
            : `border:1px solid #E7E5E4;background:#FAFAF9;`;
          const badgeStyle = isAccepted ? `background:rgba(204,120,92,0.15);color:${ACCENT};`
            : isCountered ? `background:#FEF3C7;color:#92400E;`
            : isRejected ? `background:rgba(185,28,28,0.12);color:#B91C1C;`
            : `background:#F3F1EC;color:#6B7280;`;
          const badgeLabel = isAccepted ? '✓ Accepted' : (o.status || 'Pending');
          return `<table role="presentation" style="width:100%;border-collapse:collapse;border-radius:10px;${cardStyle}margin-bottom:10px;">
            <tr>
              <td style="padding:16px 18px;">
                <div style="font-size:14px;font-weight:600;color:#0A0A0A;margin-bottom:3px;">${o.property_address||'—'}</div>
                <div style="font-size:12px;color:#6B7280;margin-bottom:6px;">Submitted ${App.fmtDate(o.offer_date)}</div>
                <span style="display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;padding:3px 8px;border-radius:4px;${badgeStyle}">${badgeLabel}</span>
              </td>
              <td style="padding:16px 18px;text-align:right;vertical-align:top;">
                <div style="font-family:${SERIF};font-size:22px;font-weight:700;color:${ACCENT};line-height:1;">${App.fmtMoney(o.offer_amount)}</div>
              </td>
            </tr>
          </table>`;
        }).join('');
      }
      html += sectionClose;
    }

    if (sections.stage) {
      html += sectionOpen('Current Stage', 'Where we are in the transaction.');
      // Progress bar — 6 segments
      html += `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:3px 0;margin-bottom:14px;">
        <tr>${stageOrder.map((_,i) => {
          const done = i < currentStageIdx;
          const active = i === currentStageIdx;
          const bg = (done||active) ? ACCENT : '#E7E5E4';
          return `<td style="height:6px;border-radius:3px;background:${bg};${active?`box-shadow:0 0 0 3px rgba(204,120,92,0.22);`:''}"></td>`;
        }).join('')}</tr>
      </table>`;
      html += `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:3px 0;margin-bottom:18px;">
        <tr>${stageOrder.map((label,i) => {
          const active = i === currentStageIdx;
          return `<td style="text-align:center;font-size:9px;font-weight:${active?800:600};color:${active?ACCENT:'#6B7280'};text-transform:uppercase;letter-spacing:0.5px;">${label}</td>`;
        }).join('')}</tr>
      </table>`;
      html += `<div style="background:#FAFAF9;border:1px solid #E7E5E4;border-left:3px solid ${ACCENT};border-radius:10px;padding:16px 18px;">
        <div style="font-family:${SERIF};font-size:17px;font-weight:600;color:#0A0A0A;margin-bottom:4px;">${client.stage||'Active Search'}${client.status?` · ${client.status}`:''}</div>
        ${client.notes?`<div style="font-size:13px;color:#6B7280;line-height:1.5;">${client.notes}</div>`:''}
      </div>`;
      html += sectionClose;
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
      html += sectionOpen('Next Steps', 'What to expect in the next two weeks.');
      html += steps.map((s,i) => `<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:10px;background:#FAFAF9;border:1px solid #E7E5E4;border-radius:10px;">
        <tr>
          <td style="width:48px;padding:14px 0 14px 16px;vertical-align:top;">
            <div style="width:28px;height:28px;border-radius:50%;background:${ACCENT};color:#fff;font-weight:700;font-size:13px;text-align:center;line-height:28px;">${i+1}</div>
          </td>
          <td style="padding:14px 16px 14px 6px;">
            <div style="font-size:14px;font-weight:600;color:#0A0A0A;">${s}</div>
          </td>
        </tr>
      </table>`).join('');
      html += sectionClose;
    }

    if (notes) {
      html += sectionOpen('A Note From ' + agentName.split(' ')[0], '');
      html += `<div style="font-size:14px;color:#0A0A0A;line-height:1.7;background:#FAFAF9;border-left:3px solid ${ACCENT};padding:16px 20px;border-radius:8px;font-style:italic;">"${notes}"</div>`;
      html += sectionClose;
    }

    // FOOTER
    html += `<div style="background:#FAFAF9;padding:26px 36px;text-align:center;border-top:1px solid #E7E5E4;">
      <div style="font-family:${SERIF};font-size:16px;font-weight:600;color:#0A0A0A;margin-bottom:3px;">${agentName}</div>
      <div style="font-size:12px;color:#6B7280;margin-bottom:12px;">REALTOR® · eXp Realty${currentAgent?.phone?` · ${currentAgent.phone}`:''}${currentAgent?.email?` · ${currentAgent.email}`:''}</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${ACCENT};">DealFlow</div>
    </div>`;

    html += `</div>`;
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

  // 4 major stages — each completion triggers a client email
  STAGES: [
    {
      key: 'pre_construction',
      label: '📋 Pre-Construction',
      pipelineStage: 'Accepted',
      emailOnComplete: true,
      emailSubject: 'Purchase Agreement Submitted — Your New Build',
      emailHeadline: 'Your Agreement for Purchase & Sale has been signed and submitted to the lender.',
      steps: [
        { key: 'builder_contacted',  label: 'Builder contacted',                          silent: true },
        { key: 'lot_visited',        label: 'Lot visited / site walk done',               silent: true },
        { key: 'plans_selections',   label: 'Plans & design selections made',             silent: true },
        { key: 'aps_drafted',        label: 'APS drafted and reviewed with client',       silent: true },
        { key: 'aps_signed',         label: 'APS signed by client',                       silent: true },
        { key: 'aps_sent_builder',   label: 'APS sent to builder',                        silent: true },
        { key: 'aps_sent_lender',    label: 'APS sent to lender for financing',           silent: true },
      ]
    },
    {
      key: 'financing',
      label: '🏦 Financing',
      pipelineStage: 'Conditions',
      emailOnComplete: true,
      emailSubject: 'Financing Approved — Your New Build is Firm!',
      emailHeadline: 'Your financing has been fully approved — the deal is now firm!',
      steps: [
        { key: 'pre_asset_submitted', label: 'Pre-asset submitted to lender',            silent: true },
        { key: 'pre_asset_approved',  label: 'Pre-asset approved',                       silent: true },
        { key: 'partial_approval',    label: 'Partial financing approval received',       silent: true },
        { key: 'full_approval',       label: 'Full financing approval received',          silent: true },
      ]
    },
    {
      key: 'construction',
      label: '🏗️ Construction',
      pipelineStage: 'Conditions',
      emailOnComplete: false,
      emailPerStep: true,   // each step ticked = one real-time client email
      steps: [
        { key: 'construction_started', label: 'Builder starts construction' },
        { key: 'foundation',           label: 'Foundation poured' },
        { key: 'framing',              label: 'Framing complete' },
        { key: 'roofing',              label: 'Roofing complete' },
        { key: 'rough_ins',            label: 'Rough-ins (electrical & plumbing)' },
        { key: 'insulation_drywall',   label: 'Insulation & drywall' },
        { key: 'cabinets_flooring',    label: 'Cabinets & flooring' },
        { key: 'finishes',             label: 'Finishes & fixtures' },
      ]
    },
    {
      key: 'conditions',
      label: '✅ Conditions & Closing Prep',
      pipelineStage: 'Conditions',
      emailOnComplete: true,
      emailSubject: 'Conditions Met — Your Deal is Completely Firm!',
      emailHeadline: 'All conditions have been met — your deal is completely firm and we are moving to closing.',
      steps: [
        { key: 'inspection_done',    label: 'Home inspection done',                       silent: true },
        { key: 'conditions_waived',  label: 'Conditions waived',                          silent: true },
        { key: 'docs_attached',      label: 'All documents attached',                     silent: true },
        { key: 'lawyer_confirmed',   label: 'Financing confirmed by lawyer',              silent: true },
      ]
    },
    {
      key: 'possession',
      label: '🎉 Possession',
      pipelineStage: 'Closed',
      emailOnComplete: true,
      emailSubject: '🎉 Congratulations — Possession Day!',
      emailHeadline: 'Congratulations — possession day has arrived! Here is a summary of your journey.',
      steps: [
        { key: 'final_walkthrough',  label: 'Final walkthrough with client',              silent: true },
        { key: 'ps_signed',          label: 'P&S agreement signed',                       silent: true },
        { key: 'closing_docs_sent',  label: 'Closing documents sent to lawyer',           silent: true },
        { key: 'keys_handed',        label: 'Keys handed to client',                      silent: true },
      ]
    },
  ],

  // msLabels kept for backwards compat with any old data reads
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
    // Always fetch fresh from DB to guarantee dropdown is populated
    let clients = [];
    if (currentAgent?.id) {
      const { data } = await db.from('clients').select('id,full_name').eq('agent_id', currentAgent.id).order('full_name');
      clients = data || [];
    }
    if (!clients.length) clients = window.Clients?.all || [];
    sel.innerHTML = '<option value="">-- Select Existing Client --</option>' +
      clients.map(c => `<option value="${c.id}" data-name="${c.full_name}">${c.full_name}</option>`).join('');

    // Populate datalists — seed with known NL builders + anything from saved builds
    const builds = NewBuilds.all || [];
    const unique = (arr) => [...new Set(arr.filter(Boolean))];

    const knownBuilders = [
      'McCrowe Homes and Renovations Inc.',
      'New Victorian Homes',
      'Westridge Homes',
      'Broadstreet Properties',
      'Krisdale Homes',
      'Rylyn Homes',
      'EasternEdge Homes',
      'Fusion Homes',
      'Southbrook Homes',
      'Cabot Homes',
      'Considine Construction',
      'Trinity Homes NL',
    ];
    const savedBuilders = unique(builds.map(b => b.builder_name || b.builder));
    const allBuilders   = unique([...savedBuilders, ...knownBuilders]);

    const knownFlooring = [
      'Hardwood / Tile',
      'Luxury Vinyl Plank (LVP)',
      'Carpet / Tile',
      'Engineered Hardwood',
      'Laminate / Tile',
      'Polished Concrete',
    ];
    const savedFlooring = unique(builds.map(b => b.flooring_selection));
    const allFlooring   = unique([...savedFlooring, ...knownFlooring]);

    const fill = (id, vals) => {
      const dl = document.getElementById(id);
      if (dl) dl.innerHTML = vals.map(v => `<option value="${v}">`).join('');
    };
    fill('dl-builder-name',    allBuilders);
    fill('dl-builder-contact', unique(builds.map(b => b.builder_contact)));
    fill('dl-flooring',        allFlooring);
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
      // Restore any previously typed (but unsaved) draft
      setTimeout(() => NewBuilds.restoreDraft(), 100);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  countMs() {
    const boxes = document.querySelectorAll('#newbuilds-form-wrap .nb-ms');
    const done = [...boxes].filter(b => b.checked).length;
    const el = document.getElementById('nb-ms-count');
    if (el) el.textContent = `${done} / 9 checked`;
  },

  // Maps major stage key → pipeline stage label
  getStage(stageKey) {
    const s = NewBuilds.STAGES.find(x => x.key === stageKey);
    return s ? s.pipelineStage : 'Accepted';
  },

  // Get current highest completed major stage for a build
  getCurrentMajorStage(pm) {
    let last = null;
    for (const stage of NewBuilds.STAGES) {
      if (pm[stage.key]?.done) last = stage;
    }
    return last;
  },

  // Count total steps done across all stages for progress bar
  countAllSteps(pm) {
    let done = 0, total = 0;
    for (const stage of NewBuilds.STAGES) {
      for (const step of stage.steps) {
        total++;
        if (pm[stage.key]?.steps?.[step.key]) done++;
      }
    }
    return { done, total };
  },

  render(list) {
    const el = document.getElementById('newbuilds-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🏗️</div><div class="empty-text">No active builds yet</div><div class="empty-sub">Click + New Build to add a construction project</div></div>';
      return;
    }
    el.innerHTML = list.map(b => {
      const pm = b.pipeline_milestones || {};
      const { done, total } = NewBuilds.countAllSteps(pm);
      const pct = Math.round((done / total) * 100);
      const majorStage = NewBuilds.getCurrentMajorStage(pm);
      const pipelineStage = majorStage?.pipelineStage || 'Accepted';
      const stageColors = { Closed:'var(--green)', Walkthrough:'var(--purple)', Conditions:'var(--yellow)', Accepted:'var(--accent2)' };
      const barColor = pct === 100 ? 'var(--green)' : pct >= 70 ? 'var(--purple)' : pct >= 40 ? 'var(--yellow)' : 'var(--accent2)';

      // Build grouped stage sections
      const stageSections = NewBuilds.STAGES.map(stage => {
        const stagePm = pm[stage.key] || { done: false, steps: {} };
        const stepsDone = stage.steps.filter(s => stagePm.steps?.[s.key]).length;
        const stepsTotal = stage.steps.length;
        const stageDone = stagePm.done;
        const headerColor = stageDone ? 'var(--green)' : stepsDone > 0 ? 'var(--yellow)' : 'var(--text2)';
        const headerBg = stageDone ? 'rgba(34,197,94,0.1)' : 'var(--bg)';

        const stepRows = stage.steps.map(step => {
          const checked = stagePm.steps?.[step.key] || false;
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px 6px 14px;font-size:12px;${checked ? 'color:var(--green);' : 'color:var(--text2);'}">
            <input type="checkbox" onchange="NewBuilds.checkStep('${b.id}','${stage.key}','${step.key}',this.checked)"
              ${checked ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer;accent-color:var(--green);">
            <span style="${checked ? 'text-decoration:line-through;opacity:0.7;' : ''}">${step.label}</span>
            ${checked ? '<span style="margin-left:auto;font-size:10px;opacity:0.6;">✓</span>' : ''}
          </div>`;
        }).join('');

        return `<div style="margin-bottom:6px;border-radius:8px;overflow:hidden;border:1px solid var(--border);">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:${headerBg};cursor:pointer;"
            onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
            <span style="font-size:13px;font-weight:700;color:${headerColor};">
              ${stageDone ? '✅' : stepsDone > 0 ? '🔄' : '⬜'} ${stage.label}
            </span>
            <span style="font-size:11px;font-weight:600;color:${headerColor};background:var(--bg2);padding:2px 8px;border-radius:10px;">
              ${stepsDone}/${stepsTotal} ${stageDone ? '· Complete' : ''}
            </span>
          </div>
          <div style="background:var(--bg2);">${stepRows}</div>
        </div>`;
      }).join('');

      return `<div class="card" style="margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="flex:1;">
            <div class="fw-800" style="font-size:15px;">${b.client_name||'—'}</div>
            <div class="text-muted" style="font-size:12px;">📍 ${b.lot_address||b.community||'—'} · 🏗️ ${b.builder_name||b.builder||'—'}</div>
          </div>
          <span class="stage-badge badge-viewings">${b.status||'Active'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
          <span style="color:var(--text2);">Pipeline Stage:</span>
          <span class="fw-800" style="color:${stageColors[pipelineStage]||'var(--accent2)'};">${pipelineStage} · ${pct}% complete</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:4px;margin-bottom:10px;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:width 0.4s;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;color:var(--text2);margin-bottom:10px;">
          ${b.purchase_price ? `<div>💰 <span class="fw-700">${App.fmtMoney(b.purchase_price)}</span></div>` : ''}
          ${b.est_completion_date ? `<div>📅 Est. Close: <span class="fw-700">${App.fmtDate(b.est_completion_date)}</span></div>` : ''}
          ${b.deposit_status ? `<div>🏦 Deposit: <span class="fw-700">${b.deposit_status}</span></div>` : ''}
          ${b.builder_contact ? `<div>👤 Contact: <span class="fw-700">${b.builder_contact}</span></div>` : ''}
        </div>
        <!-- Grouped Stage Sections -->
        <div style="margin-bottom:10px;">${stageSections}</div>
        <div id="nb-card-msg-${b.id}" style="margin-top:4px;font-size:12px;"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
          <button class="btn btn-outline btn-sm" onclick="NewBuilds.notifyClient('${b.id}')">📧 Notify Client</button>
        </div>
      </div>`;
    }).join('');
  },

  // Called on every checkbox change — silent save, smart email logic
  async checkStep(buildId, stageKey, stepKey, checked) {
    const b = NewBuilds.all.find(x => x.id === buildId);
    if (!b) return;
    const pm = JSON.parse(JSON.stringify(b.pipeline_milestones || {}));

    // Ensure structure exists
    if (!pm[stageKey]) pm[stageKey] = { done: false, steps: {} };
    if (!pm[stageKey].steps) pm[stageKey].steps = {};
    pm[stageKey].steps[stepKey] = checked;

    const stage = NewBuilds.STAGES.find(s => s.key === stageKey);
    const step = stage.steps.find(s => s.key === stepKey);
    const allStepsDone = stage.steps.every(s => pm[stageKey].steps[s.key]);
    const wasAlreadyDone = b.pipeline_milestones?.[stageKey]?.done;

    // Mark stage done/undone based on all steps
    pm[stageKey].done = allStepsDone;

    // Current stage label = highest stage that has any activity
    const majorStage = NewBuilds.getCurrentMajorStage(pm);
    const isComplete = pm['possession']?.done === true;
    const stageLabel = majorStage ? majorStage.label.replace(/[📋🏦🏗️✅🎉]\s*/u, '') : 'Pre-Construction';

    // Save to DB (silent for most, always saves)
    await db.from('new_builds').update({
      pipeline_milestones: pm,
      current_stage: stageLabel,
      status: isComplete ? 'Complete' : 'Active',
      updated_at: new Date().toISOString()
    }).eq('id', buildId);

    // Update local cache + re-render immediately
    b.pipeline_milestones = pm;
    NewBuilds.render(NewBuilds.all);

    // ── CONSTRUCTION STAGE: emailPerStep — each step queues its own email ──
    if (checked && stage.emailPerStep) {
      await NewBuilds.syncPipeline(b, stage.pipelineStage);
      await NewBuilds.autoQueueStageEmail(buildId, stageKey, stepKey);
      App.toast(`📬 Build update queued: "${step.label}"`, 'var(--green)');
      if (typeof Approvals !== 'undefined') setTimeout(() => Approvals.load(), 800);
      return;
    }

    // ── ALL OTHER STAGES: emailOnComplete — email only when ALL steps done ──
    if (stage.emailOnComplete && allStepsDone && !wasAlreadyDone) {
      await NewBuilds.syncPipeline(b, stage.pipelineStage);
      App.toast(`✅ ${stage.label} complete! Client update queued in Approvals.`, 'var(--green)');
      await NewBuilds.autoQueueStageEmail(buildId, stageKey, null);
      if (typeof Approvals !== 'undefined') setTimeout(() => Approvals.load(), 800);
    }
  },

  // Auto-queue client email — stepKey is non-null for construction per-step emails
  async autoQueueStageEmail(buildId, stageKey, stepKey) {
    const b = NewBuilds.all.find(x => x.id === buildId);
    if (!b) return;
    const stage = NewBuilds.STAGES.find(s => s.key === stageKey);
    if (!stage) return;

    // Look up client — robust fallback chain
    let clientEmail = b.client_email || null;
    let clientId    = b.client_id || null;
    if (!clientEmail) {
      let q = db.from('clients').select('id, email').eq('agent_id', currentAgent.id);
      const { data: cd } = await (clientId ? q.eq('id', clientId) : q.ilike('full_name', b.client_name || '')).limit(1).maybeSingle();
      if (!cd && b.client_name) {
        const { data: cd2 } = await db.from('clients').select('id, email').eq('agent_id', currentAgent.id)
          .ilike('full_name', `%${(b.client_name||'').split(' ')[0]}%`).limit(1).maybeSingle();
        if (cd2) { clientEmail = cd2.email; clientId = cd2.id; }
      } else if (cd) { clientEmail = cd.email; clientId = cd.id; }
    }
    if (!clientEmail) return;

    const firstName = (b.client_name || 'there').split(' ')[0];
    const pm = b.pipeline_milestones || {};
    const property = b.lot_address || 'Your Property';

    const { done: doneCount, total: totalCount } = NewBuilds.countAllSteps(pm);
    const pctVal = Math.round((doneCount / totalCount) * 100);
    const majorStageFull = NewBuilds.getCurrentMajorStage(pm);

    // ── CONSTRUCTION: per-step email ──
    if (stage.emailPerStep && stepKey) {
      const step = stage.steps.find(s => s.key === stepKey);
      const stepLabel = step?.label || stepKey;
      const subject = `🏗️ Build Update — ${stepLabel} · ${property}`;
      const customNote = `Your build has reached a new milestone: <strong>${stepLabel}</strong>`;
      const html = NewBuilds.buildEmailHtml({ b, pm, majorStage: majorStageFull, done: doneCount, total: totalCount, pct: pctVal, customNote, highlightStage: stageKey, highlightStep: stepKey });
      const plainBody = `Hi ${firstName},\n\nGreat news — your build has reached a new milestone: ${stepLabel}\n\nProperty: ${property}\n\n🏗️ Construction Progress:\n${stage.steps.map(s => `  ${pm[stageKey]?.steps?.[s.key] ? '✅' : '○'} ${s.label}`).join('\n')}${b.est_completion_date ? `\n\nEst. Possession: ${b.est_completion_date}` : ''}\n\nI will keep you updated as your home progresses.\n\nMaxwell Delali Midodzi · eXp Realty · (709) 325-0545`;
      if (typeof Notify !== 'undefined') {
        await Notify.queue('New Build Update', clientId, b.client_name, clientEmail, subject, plainBody, null, html, null, b.cc_email || null);
      }
      return;
    }

    // ── ALL OTHER STAGES: stage completion email ──
    const subject = `${stage.emailSubject} — ${property}`;
    const html = NewBuilds.buildEmailHtml({ b, pm, majorStage: majorStageFull, done: doneCount, total: totalCount, pct: pctVal, customNote: stage.emailHeadline, highlightStage: stageKey });
    const plainBody = `Hi ${firstName},\n\n${stage.emailHeadline}\n\nProperty: ${property}\n\nBuild Progress:\n${NewBuilds.STAGES.map(s => `  ${pm[s.key]?.done ? '✅' : '○'} ${s.label.replace(/[📋🏦🏗️✅🎉]\s*/u,'')}`).join('\n')}${b.est_completion_date ? `\n\nEst. Possession: ${b.est_completion_date}` : ''}\n\nI will be in touch as we move to the next stage.\n\nMaxwell Delali Midodzi · eXp Realty · (709) 325-0545`;
    if (typeof Notify !== 'undefined') {
      await Notify.queue('New Build Update', clientId, b.client_name, clientEmail, subject, plainBody, null, html, null, b.cc_email || null);
    }
  },

  // ── Shared rich email HTML builder ──────────────────────────────────────
  buildEmailHtml({ b, pm, majorStage, done, total, pct, customNote = '', highlightStage = null, highlightStep = null }) {
    const firstName = (b.client_name || 'there').split(' ')[0];
    const property  = b.lot_address || 'Your Property';

    // Pipeline dots row
    const pipelineHtml = NewBuilds.STAGES.map((s, i) => {
      const stageDone  = pm[s.key]?.done;
      const isCurrent  = majorStage?.key === s.key;
      const isHighlight = s.key === highlightStage;
      const bg   = stageDone ? '#10b981' : (isCurrent || isHighlight) ? '#0ea5e9' : '#e2e8f0';
      const fg   = stageDone || isCurrent || isHighlight ? '#fff' : '#94a3b8';
      const num  = stageDone ? '✓' : String(i + 1);
      const lbl  = s.label.replace(/[📋🏦🏗️✅🎉]\s*/u, '');
      const lineColor = stageDone ? '#10b981' : '#e2e8f0';
      const connector = i < NewBuilds.STAGES.length - 1
        ? `<td style="padding:0;vertical-align:middle;"><div style="height:3px;background:${lineColor};"></div></td>`
        : '';
      return `<td style="text-align:center;vertical-align:top;padding:0 2px;width:${Math.floor(100/NewBuilds.STAGES.length)}%;">
        <div style="width:34px;height:34px;border-radius:50%;background:${bg};color:${fg};font-size:13px;font-weight:700;line-height:34px;margin:0 auto 5px;text-align:center;">${num}</div>
        <div style="font-size:10px;line-height:1.3;color:${stageDone?'#10b981':(isCurrent||isHighlight)?'#0ea5e9':'#94a3b8'};font-weight:${(isCurrent||isHighlight)?'700':'400'};">${lbl}</div>
      </td>${connector}`;
    }).join('');

    // Stage detail rows
    const stageRowsHtml = NewBuilds.STAGES.map(s => {
      const stageDone  = pm[s.key]?.done;
      const isCurrent  = majorStage?.key === s.key;
      const stepsTotal = s.steps.length;
      const stepsDone  = s.steps.filter(st => pm[s.key]?.steps?.[st.key]).length;
      const rowBg  = stageDone ? '#f0fdf4' : isCurrent ? '#f0f9ff' : '#fafafa';
      const lbl    = s.label.replace(/[📋🏦🏗️✅🎉]\s*/u, '');
      const icon   = stageDone ? '✅' : isCurrent ? '▶️' : '○';
      const badge  = stageDone
        ? `<span style="background:#10b981;color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;">Complete</span>`
        : isCurrent
        ? `<span style="background:#0ea5e9;color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;">${stepsDone}/${stepsTotal} steps</span>`
        : `<span style="color:#94a3b8;font-size:11px;">Upcoming</span>`;
      return `<tr style="background:${rowBg};border-bottom:1px solid #e2e8f0;">
        <td style="padding:10px 14px;font-size:13px;font-weight:${isCurrent?'700':'400'};color:${stageDone?'#059669':isCurrent?'#0369a1':'#64748b'};">${icon} ${lbl}</td>
        <td style="padding:10px 14px;text-align:right;">${badge}</td>
      </tr>`;
    }).join('');

    const possessionHtml = b.est_completion_date
      ? `<p style="font-size:13px;background:#f0f9ff;padding:12px 14px;border-radius:6px;border-left:3px solid #0ea5e9;margin:0 0 16px;">
          📅 <strong>Estimated Possession:</strong> ${new Date(b.est_completion_date+'T12:00:00').toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
        </p>` : '';

    const noteHtml = customNote
      ? `<p style="font-size:13px;background:#fffbeb;padding:12px 14px;border-radius:6px;border-left:3px solid #f59e0b;margin:0 0 16px;line-height:1.6;">${customNote}</p>`
      : '';

    const agent = (typeof currentAgent !== 'undefined' && currentAgent) || {};
    const agentName    = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
    const agentPhone   = agent.phone    || '(709) 325-0545';
    const agentEmail   = agent.email    || 'Maxwell.Midodzi@exprealty.com';
    const agentWebsite = agent.website_url || 'maxwellmidodzi.exprealty.com';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:20px;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;}
  .wrap{max-width:560px;margin:0 auto;}
  hr{border:none;border-top:1px solid #eee;margin:24px 0;}
  .sig-name{font-weight:700;font-size:15px;margin:0 0 2px;}
  .sig-line{font-size:13px;color:#555;margin:2px 0;}
  .sig-line a{color:#1a6ef5;text-decoration:none;}
  .confidential{font-size:10px;color:#bbb;margin-top:20px;line-height:1.5;}
  .section-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#0ea5e9;margin:20px 0 8px;}
</style>
</head>
<body><div class="wrap">

  <p>Hi ${firstName},</p>
  <p>Here is your latest new build progress update for <strong>${property}</strong>.</p>
  ${b.builder_name ? `<p style="font-size:13px;color:#64748b;margin:-8px 0 16px;">Builder: ${b.builder_name}</p>` : ''}

  ${noteHtml}

  <!-- Pipeline -->
  <p class="section-label">Build Pipeline</p>
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:20px;"><tr>${pipelineHtml}</tr></table>

  <!-- Progress Bar -->
  <p class="section-label">Overall Progress — ${pct}%</p>
  <div style="background:#e2e8f0;height:10px;border-radius:6px;overflow:hidden;margin-bottom:4px;">
    <div style="background:linear-gradient(90deg,#0ea5e9,#10b981);height:10px;width:${pct}%;border-radius:6px;"></div>
  </div>
  <p style="font-size:12px;color:#94a3b8;margin:4px 0 20px;">${done} of ${total} steps completed</p>

  <!-- Stage Breakdown -->
  <p class="section-label">Stage Breakdown</p>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:20px;">
    ${stageRowsHtml}
  </table>

  ${possessionHtml}

  <p>Please don't hesitate to reach out if you have any questions.</p>
  <p>Looking forward to seeing this build through to possession!</p>

  <hr>
  <p>Best regards,</p>
  <p class="sig-name">${agentName}</p>
  <p class="sig-line">REALTOR® | eXp Realty</p>
  <p class="sig-line"><a href="tel:${agentPhone}">${agentPhone}</a> &nbsp;|&nbsp; <a href="mailto:${agentEmail}">${agentEmail}</a></p>
  <p class="sig-line">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p>
  <p class="sig-line"><a href="https://${agentWebsite}">${agentWebsite}</a></p>
  <p class="confidential">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>

</div></body></html>`;
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

  notifyClient(id) {
    const b = NewBuilds.all.find(x => x.id === id);
    if (!b) return;
    const pm = b.pipeline_milestones || {};
    const majorStage = NewBuilds.getCurrentMajorStage(pm);
    const { done, total } = NewBuilds.countAllSteps(pm);
    const pct = Math.round((done / total) * 100);

    App.openModal(`
      <div class="modal-title">📧 Notify Client — Build Update</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">Send a manual progress update to <strong>${b.client_name}</strong>.</div>
      <div class="card" style="margin-bottom:12px;font-size:13px;line-height:1.8;">
        <div>📋 Current Stage: <span class="fw-800" style="color:var(--accent2);">${majorStage ? majorStage.label : 'Getting Started'}</span></div>
        <div>✅ Progress: <span class="fw-700">${pct}% complete (${done}/${total} steps)</span></div>
        ${b.est_completion_date ? `<div>📅 Est. Possession: <span class="fw-700">${App.fmtDate(b.est_completion_date)}</span></div>` : ''}
      </div>
      <div class="form-group">
        <label class="form-label">CUSTOM NOTE (OPTIONAL)</label>
        <textarea class="form-input" id="nb-notify-note" rows="3" placeholder="Any specific update for the client..."></textarea>
      </div>
      <button class="btn btn-primary btn-block" onclick="NewBuilds.sendClientUpdate('${id}')">📨 Queue in Approvals</button>
    `);
  },

  async sendClientUpdate(id) {
    const b = NewBuilds.all.find(x => x.id === id);
    if (!b) return;
    const pm = b.pipeline_milestones || {};
    const majorStage = NewBuilds.getCurrentMajorStage(pm);
    const { done, total } = NewBuilds.countAllSteps(pm);
    const pct = Math.round((done / total) * 100);
    const customNote = document.getElementById('nb-notify-note')?.value?.trim() || '';

    // Look up client — try by client_id first, then fall back to name match
    let clientEmail = b.client_email || null;
    let clientId    = b.client_id || null;
    if (!clientEmail) {
      let q = db.from('clients').select('id, email, full_name').eq('agent_id', currentAgent.id);
      if (clientId) {
        q = q.eq('id', clientId);
      } else {
        q = q.ilike('full_name', b.client_name || '');
      }
      const { data: cd } = await q.limit(1).maybeSingle();
      if (!cd && b.client_name) {
        // last resort: loose name search
        const { data: cd2 } = await db.from('clients').select('id, email, full_name')
          .eq('agent_id', currentAgent.id).ilike('full_name', `%${(b.client_name||'').split(' ')[0]}%`).limit(1).maybeSingle();
        if (cd2) { clientEmail = cd2.email; clientId = cd2.id; }
      } else if (cd) {
        clientEmail = cd.email;
        clientId    = cd.id;
      }
    }

    const firstName = (b.client_name || 'there').split(' ')[0];
    const stageLabel = majorStage ? majorStage.label.replace(/[🏦📝💰🎉]\s*/,'') : 'Getting Started';
    const property = (b.lot_address || 'Your Property').replace(/[^\x20-\x7E]/g, '');
    const subject = `New Build Update - ${property}`;

    const stageRows = NewBuilds.STAGES.map(s => {
      const done2 = pm[s.key]?.done ? 'Done' : 'Pending';
      const lbl = s.label.replace(/[^\x20-\x7E]/g, '').trim();
      return `  ${done2} - ${lbl}`;
    }).join('\n');
    const possession = b.est_completion_date ? `\n\nEst. Possession: ${b.est_completion_date}` : '';
    const noteText = customNote ? `\n\nNotes: ${customNote.replace(/[^\x20-\x7E]/g, '')}` : '';
    const plainBody = `Hi ${firstName},\n\nNew Build Update - ${property}\n\nCurrent Stage: ${stageLabel.replace(/[^\x20-\x7E]/g,'')}\nProgress: ${pct}% (${done}/${total} steps)\n\n${stageRows}${possession}${noteText}\n\nI will be in touch as the build progresses.\n\nMaxwell Delali Midodzi - eXp Realty - (709) 325-0545`;

    // Build HTML email in default format
    const agent = (typeof currentAgent !== 'undefined' && currentAgent) || {};
    const agentName  = agent.full_name || 'Maxwell Delali Midodzi';
    const agentPhone = agent.phone    || '(709) 325-0545';
    const agentEmail = agent.email    || 'Maxwell.Midodzi@exprealty.com';
    const agentWeb   = agent.website_url || 'maxwellmidodzi.exprealty.com';
    const stageRowsHtml = NewBuilds.STAGES.map(s => {
      const isDone = pm[s.key]?.done;
      const lbl = s.label.replace(/[^\x20-\x7E]/g,'').trim();
      return `<tr><td class="lb">${lbl}</td><td class="vl" style="color:${isDone?'#059669':'#888'}">${isDone?'Complete':'Pending'}</td></tr>`;
    }).join('');
    const possessionRow = b.est_completion_date ? `<tr><td class="lb">Est. Possession</td><td class="vl">${b.est_completion_date}</td></tr>` : '';
    const noteHtml = customNote ? `<p style="font-size:14px;background:#fffbeb;padding:12px;border-left:3px solid #f59e0b;border-radius:4px;margin:0 0 16px;">${customNote.replace(/[^\x20-\x7E]/g,'')}</p>` : '';
    const htmlEmail = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:20px;background:#fff;font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.6}.wrap{max-width:560px;margin:0 auto}table.dt{width:100%;border-collapse:collapse;margin:0 0 20px}table.dt td{padding:8px 10px;border-bottom:1px solid #eee;font-size:14px}.lb{color:#888;width:45%}.vl{font-weight:700;color:#222}hr{border:none;border-top:1px solid #eee;margin:24px 0}.sig-name{font-weight:700;font-size:15px;margin:0 0 2px}.sig-line{font-size:13px;color:#555;margin:2px 0}.sig-line a{color:#1a6ef5;text-decoration:none}.confidential{font-size:10px;color:#bbb;margin-top:20px;line-height:1.5}</style></head><body><div class="wrap"><p>Hi ${firstName},</p><p>Here is your latest new build progress update for <strong>${property}</strong>.</p>${noteHtml}<table class="dt">${stageRowsHtml}${possessionRow}<tr><td class="lb">Overall Progress</td><td class="vl" style="color:#1a6ef5">${pct}% (${done}/${total} steps)</td></tr></table><hr><p>Best regards,</p><p class="sig-name">${agentName}</p><p class="sig-line">REALTOR&reg; | eXp Realty</p><p class="sig-line"><a href="tel:${agentPhone}">${agentPhone}</a> &nbsp;|&nbsp; <a href="mailto:${agentEmail}">${agentEmail}</a></p><p class="sig-line">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p><p class="sig-line"><a href="https://${agentWeb}">${agentWeb}</a></p><p class="confidential">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited.</p></div></body></html>`;
    const htmlB64 = btoa(unescape(encodeURIComponent(htmlEmail)));

    App.closeModal();

    // Direct insert — plain text body + base64 HTML in context_data
    const { data: { user } } = await db.auth.getUser();
    const agentId = user?.id || currentAgent?.id;
    const { error: qErr } = await db.from('approval_queue').insert({
      agent_id: agentId,
      client_name: (b.client_name || '').replace(/[^\x20-\x7E]/g, '').trim(),
      client_email: clientEmail || null,
      approval_type: 'New Build Update',
      email_subject: subject,
      email_body: plainBody,
      context_data: { html: htmlB64, ics: null, cc: b.cc_email || null },
      status: 'Pending'
    });
    if (qErr) {
      App.toast('Could not queue: ' + qErr.message, 'var(--red)');
    } else {
      App.toast('Build update queued in Approvals!', 'var(--green)');
      App.switchTab('approvals');
      if (typeof Approvals !== 'undefined') setTimeout(() => Approvals.load(), 600);
      if (typeof Notify !== 'undefined') Notify.updateBadge();
    }
  },

  // Save form fields to localStorage so data isn't lost on error
  saveDraft() {
    const fields = ['nb-builder','nb-lot-address','nb-price','nb-completion','nb-flooring',
                    'nb-builder-contact','nb-notes','nb-cc-email','nb-deposit-amount',
                    'nb-deposit-date','nb-deposit-status','nb-pa-submitted','nb-pa-accepted','nb-stage'];
    const draft = {};
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) draft[id] = el.value;
    });
    const sel = document.getElementById('nb-client-sel');
    if (sel) draft['nb-client-sel'] = sel.value;
    try { localStorage.setItem('nb_draft', JSON.stringify(draft)); } catch(e) {}
  },

  restoreDraft() {
    try {
      const raw = localStorage.getItem('nb_draft');
      if (!raw) return;
      const draft = JSON.parse(raw);
      Object.entries(draft).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
      });
    } catch(e) {}
  },

  clearDraft() {
    try { localStorage.removeItem('nb_draft'); } catch(e) {}
  },

  async save() {
    const st = document.getElementById('nb-status');
    if (!st) return;
    const clientSel = document.getElementById('nb-client-sel');
    const clientName = clientSel.options[clientSel.selectedIndex]?.dataset?.name || '';
    const clientId = clientSel.value;
    if (!clientName) { st.style.color='var(--red)'; st.textContent='⚠️ Please select a client'; return; }
    st.textContent = 'Saving...'; st.style.color = 'var(--text2)';
    NewBuilds.saveDraft(); // save to localStorage before attempting DB write
    // Initialize empty 4-stage milestone structure
    const milestones = {};
    NewBuilds.STAGES.forEach(s => {
      milestones[s.key] = { done: false, steps: {} };
      s.steps.forEach(step => { milestones[s.key].steps[step.key] = false; });
    });
    const pipelineStage = 'Accepted';
    const lotAddress = document.getElementById('nb-lot-address')?.value.trim() || '';
    const price = parseFloat(document.getElementById('nb-price')?.value) || 0;
    const completion = document.getElementById('nb-completion')?.value || null;

    const { data: saved, error } = await db.from('new_builds').insert({
      agent_id: currentAgent.id,
      client_name: clientName,
      client_id: clientId || null,
      builder_name: document.getElementById('nb-builder')?.value.trim() || '',
      lot_address: lotAddress,
      purchase_price: price,
      current_stage: document.getElementById('nb-stage')?.value || 'Pre-Construction',
      est_completion_date: completion,
      flooring_selection: document.getElementById('nb-flooring')?.value.trim() || '',
      builder_contact: document.getElementById('nb-builder-contact')?.value.trim() || '',
      notes: document.getElementById('nb-notes')?.value.trim() || '',
      cc_email: document.getElementById('nb-cc-email')?.value.trim() || null,
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
        builder_name: document.getElementById('nb-builder')?.value.trim()||'',
        lot_address: lotAddress, purchase_price: price,
        notes: document.getElementById('nb-notes')?.value.trim()||'',
        status: 'Active', pipeline_milestones: milestones
      });
      if (e2) { st.style.color='var(--red)'; st.textContent=e2.message; return; }
    }

    // Auto-create / update pipeline entry
    const buildObj = saved || { client_name: clientName, lot_address: lotAddress, purchase_price: price, est_completion_date: completion };
    await NewBuilds.syncPipeline(buildObj, pipelineStage);

    NewBuilds.clearDraft(); // clear saved draft on success
    App.toast('✅ New Build created! Pipeline entry auto-created.');
    st.style.color='var(--green)'; st.textContent=`✅ Build created · Pipeline → ${pipelineStage}`;
    NewBuilds.toggleForm();
    NewBuilds.load();
  }
};

// ── EMAIL SEND ──────────────────────────────────────────────────────────────
const EmailSend = {
  _emailFiles: [],  // [{filename, mime_type, data}] — files attached to client email
  _extFiles:   [],  // [{filename, mime_type, data}] — files attached to external email

  async addFiles(files, type) {
    const arr = type === 'email' ? EmailSend._emailFiles : EmailSend._extFiles;
    const MAX = 5 * 1024 * 1024; // 5 MB per file
    for (const file of Array.from(files)) {
      if (file.size > MAX) { App.toast(`⚠️ ${file.name} exceeds 5 MB — skipped`, 'var(--yellow)'); continue; }
      const data = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      arr.push({ filename: file.name, mime_type: file.type || 'application/octet-stream', data });
    }
    EmailSend.renderFileChips(type);
  },

  removeFile(type, idx) {
    const arr = type === 'email' ? EmailSend._emailFiles : EmailSend._extFiles;
    arr.splice(idx, 1);
    EmailSend.renderFileChips(type);
  },

  renderFileChips(type) {
    const arr = type === 'email' ? EmailSend._emailFiles : EmailSend._extFiles;
    const el  = document.getElementById(type === 'email' ? 'email-file-chips' : 'ext-file-chips');
    if (!el) return;
    el.innerHTML = arr.map((f, i) => `
      <div class="file-chip">
        📎 <span>${App.esc(f.filename)}</span>
        <button onclick="EmailSend.removeFile('${type}',${i})" title="Remove">✕</button>
      </div>`).join('');
  },

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

  // Build plain-text body with professional signature + disclaimer
  buildSignedBody(bodyText, attachment, cc) {
    const agent = currentAgent || {};
    const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
    const agentPhone = agent.phone || '(709) 325-0545';
    const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
    const agentWebsite = agent.website_url || 'maxwellmidodzi.exprealty.com';
    const plainSig = `Best regards,\n\n${agentName}\nREALTOR® | eXp Realty\n${agentPhone} | ${agentEmail}\neXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2\n${agentWebsite}`;
    const disclaimer = '\n\n──────────────────────────────────────────\nCONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.';
    let fullBody = bodyText + '\n\n' + plainSig;
    if (attachment) fullBody += `\n\nAttachment: ${attachment}`;
    if (cc) fullBody += `\n\nCC: ${cc}`;
    fullBody += disclaimer;
    return { plainSig, fullBody };
  },

  // Wrap email body in branded HTML — accepts plain text or HTML (auto-detects)
  wrapHtml(bodyText, sig, attachment) {
    const agent = currentAgent || {};
    const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
    const agentPhone = agent.phone || '(709) 325-0545';
    const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
    const agentWebsite = agent.website_url || 'maxwellmidodzi.exprealty.com';
    // If content is already HTML (from rich editor) use as-is; otherwise escape and convert newlines
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(bodyText);
    const bodyHtml = looksLikeHtml ? bodyText : bodyText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g, '<br>');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{margin:0;padding:20px;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;}
      .wrap{max-width:560px;margin:0 auto;}
      hr{border:none;border-top:1px solid #eee;margin:24px 0;}
      .sig-name{font-weight:700;font-size:15px;}
      .sig-line{font-size:13px;color:#555;margin:2px 0;}
      .sig-line a{color:#1a6ef5;text-decoration:none;}
      .confidential{font-size:10px;color:#bbb;margin-top:20px;line-height:1.5;}
    </style></head><body><div class="wrap">
      ${bodyHtml}
      ${attachment ? `<p style="font-size:13px;color:#555;margin-top:16px;">📎 Attachment: ${attachment}</p>` : ''}
      <hr>
      <p>Best regards,</p>
      <p class="sig-name">${agentName}</p>
      <p class="sig-line">REALTOR® | eXp Realty</p>
      <p class="sig-line"><a href="tel:${agentPhone}">${agentPhone}</a> &nbsp;|&nbsp; <a href="mailto:${agentEmail}">${agentEmail}</a></p>
      <p class="sig-line">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p>
      <p class="sig-line"><a href="https://${agentWebsite}">${agentWebsite}</a></p>
      <p class="confidential">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>
    </div></body></html>`;
  },

  async send() {
    const st = document.getElementById('email-status');
    const clientSel = document.getElementById('email-client');
    const opt = clientSel.options[clientSel.selectedIndex];
    if (!opt?.value) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Please select a client'; return; }
    const subject = document.getElementById('email-subject').value.trim();
    const bodyText = EmailSend.getBodyText('email-body');
    if (!subject) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Subject is required'; return; }
    const cc = document.getElementById('email-cc')?.value.trim() || null;
    const files = EmailSend._emailFiles.length ? [...EmailSend._emailFiles] : null;
    const { plainSig, fullBody: fb } = EmailSend.buildSignedBody(bodyText, '', cc);
    const htmlBody = EmailSend.wrapHtml(bodyText, plainSig, files?.map(f=>f.filename).join(', ') || '');
    st.style.color = 'var(--text2)'; st.textContent = 'Sending to Approvals...';
    if (typeof Notify !== "undefined") {
      await Notify.queue('Client Email', opt.value, opt.dataset.name, opt.dataset.email, subject, fb, null, htmlBody, null, cc, files);
    }
    App.logActivity('EMAIL_QUEUED', opt.dataset.name, opt.dataset.email, `Email queued: ${subject}${files ? ` (${files.length} attachment${files.length>1?'s':''})` : ''}`);
    // Clear attachments after queuing
    EmailSend._emailFiles = [];
    EmailSend.renderFileChips('email');
    st.style.color = 'var(--green)';
    st.textContent = `✅ Queued${files ? ` with ${files.length} attachment${files.length>1?'s':''}` : ''} — tap 📬 to review & send!`;
    App.toast('📬 Email queued — check Approvals to send it', 'var(--accent2)');
  },

  autoGreet() {
    const n = document.getElementById('ext-name')?.value.trim();
    const b = document.getElementById('ext-body');
    if (!n || !b || b.innerText.trim()) return;
    b.innerHTML = '<p>Hi ' + n.split(' ')[0] + ',</p><p><br></p>';
  },

  async sendExternal() {
    const st = document.getElementById('ext-status');
    const toEmail = document.getElementById('ext-email').value.trim();
    const toName = document.getElementById('ext-name').value.trim();
    const subject = document.getElementById('ext-subject').value.trim();
    const bodyText = EmailSend.getBodyText('ext-body');
    const cc = document.getElementById('ext-cc').value.trim();
    const files = EmailSend._extFiles.length ? [...EmailSend._extFiles] : null;
    if (!toEmail) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Recipient email is required'; return; }
    if (!subject) { st.style.color = 'var(--red)'; st.textContent = '⚠️ Subject is required'; return; }
    const { plainSig, fullBody: fb } = EmailSend.buildSignedBody(bodyText, '', cc);
    const htmlBody = EmailSend.wrapHtml(bodyText, plainSig, files?.map(f=>f.filename).join(', ') || '');
    st.style.color = 'var(--text2)'; st.textContent = 'Sending to Approvals...';
    if (typeof Notify !== "undefined") {
      await Notify.queue('External Email', null, toName || toEmail, toEmail, subject, fb, null, htmlBody, null, cc || null, files);
    }
    // Clear attachments after queuing
    EmailSend._extFiles = [];
    EmailSend.renderFileChips('ext');
    st.style.color = 'var(--green)';
    st.textContent = `✅ Queued${files ? ` with ${files.length} attachment${files.length>1?'s':''}` : ''} — tap 📬 to review & send!`;
    App.toast('📬 Email queued — check Approvals to send it', 'var(--accent2)');
  },

  handleExtDrop(event) {
    event.preventDefault();
    if (event.dataTransfer.files.length) {
      EmailSend.addFiles(event.dataTransfer.files, 'ext');
    }
  }
};

// ── BROADCAST EMAIL ──────────────────────────────────────────────────────────
const Broadcast = {
  _clients:  [],
  _selected: new Set(),

  async load() {
    const { data } = await db.from('clients')
      .select('id, full_name, email, status, label')
      .order('full_name', { ascending: true });
    Broadcast._clients = (data || []).filter(c => c.email);
    Broadcast._selected.clear();
    Broadcast.renderList();
    Broadcast.updateCount();
  },

  renderList(filter) {
    filter = filter || document.getElementById('bc-filter')?.value || 'all';
    const el = document.getElementById('bc-client-list');
    if (!el) return;
    let list = Broadcast._clients;
    if (filter === 'buyers')  list = list.filter(c => (c.label||'').toLowerCase().includes('buyer')  || (c.status||'').toLowerCase().includes('buyer'));
    if (filter === 'sellers') list = list.filter(c => (c.label||'').toLowerCase().includes('seller') || (c.status||'').toLowerCase().includes('seller'));
    if (filter === 'active')  list = list.filter(c => c.status && !['Inactive','Closed'].includes(c.status));
    if (!list.length) {
      el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">No clients with email addresses match this filter.</div>`;
      return;
    }
    el.innerHTML = list.map(c => {
      const on = Broadcast._selected.has(c.id);
      return `<div class="bc-row${on?' bc-row-on':''}" onclick="Broadcast.toggle('${c.id}')">
        <div class="bc-chk${on?' bc-chk-on':''}">${on?'✓':''}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${App.esc(c.full_name)}</div>
          <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${App.esc(c.email)}${c.status?' · '+c.status:''}</div>
        </div>
      </div>`;
    }).join('');
    Broadcast.updateCount();
  },

  toggle(id) {
    if (Broadcast._selected.has(id)) Broadcast._selected.delete(id);
    else Broadcast._selected.add(id);
    Broadcast.renderList();
  },

  selectAll() {
    Broadcast._clients.forEach(c => Broadcast._selected.add(c.id));
    Broadcast.renderList();
  },

  clearAll() {
    Broadcast._selected.clear();
    Broadcast.renderList();
  },

  updateCount() {
    const n   = Broadcast._selected.size;
    const btn = document.getElementById('bc-send-btn');
    const lbl = document.getElementById('bc-count-lbl');
    if (lbl) lbl.textContent = n ? `${n} selected` : 'No clients selected';
    if (btn) {
      btn.disabled      = n === 0;
      btn.textContent   = n ? `Send to ${n} client${n>1?'s':''}` : 'Send (select clients first)';
    }
  },

  async send() {
    const subject  = (document.getElementById('bc-subject')?.value  || '').trim();
    const bodyEl   = document.getElementById('bc-body');
    const bodyText = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';
    const bodyHtml = bodyEl ? bodyEl.innerHTML : '';
    if (!subject)   { App.toast('⚠️ Subject required', 'var(--red)'); return; }
    if (!bodyText)  { App.toast('⚠️ Message required', 'var(--red)'); return; }
    if (!Broadcast._selected.size) { App.toast('⚠️ Select at least one client', 'var(--red)'); return; }

    const btn = document.getElementById('bc-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Queuing…'; }

    const selected = Broadcast._clients.filter(c => Broadcast._selected.has(c.id));
    const wrappedHtml = typeof EmailSend !== 'undefined' ? EmailSend.wrapHtml(bodyText, '', '') : bodyHtml;

    let queued = 0;
    for (const c of selected) {
      await Notify.queue('Broadcast Email', c.id, c.full_name, c.email, subject, bodyText, null, wrappedHtml);
      queued++;
    }

    App.toast(`✅ ${queued} email${queued>1?'s':''} queued for approval`, 'var(--green)');
    Broadcast._selected.clear();
    if (document.getElementById('bc-subject'))  document.getElementById('bc-subject').value  = '';
    if (bodyEl) bodyEl.innerHTML = '';
    Broadcast.renderList();
  }
};

// ── INBOX ────────────────────────────────────────────────────────────────────
const Inbox = {
  _all: [],
  _threads: [],
  _syncing: false,
  _lastSync: 0,

  // ── LOAD: fetch all emails from local DB ──────────────────────────────────
  async load() {
    if (!currentAgent?.id) return;
    const el = document.getElementById('inbox-list');
    if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';

    const timer = setTimeout(() => {
      if (el && el.innerHTML.includes('spinner')) {
        el.innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><div class="empty-text">No conversations yet</div><div class="empty-sub">Send an email to a client, then sync to see replies.</div></div>';
      }
    }, 8000);

    try {
      const days = parseInt(document.getElementById('inbox-filter')?.value || '30');
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const [emailRes, clientRes] = await Promise.all([
        db.from('email_inbox')
          .select('id,direction,recipient_name,recipient_email,sender_name,sender_email,subject,body,created_at,gmail_thread_id,gmail_message_id,in_reply_to,is_read,gmail_internal_date')
          .eq('agent_id', currentAgent.id)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(200),
        db.from('clients')
          .select('id,full_name,email')
          .eq('agent_id', currentAgent.id)
          .limit(500)
      ]);

      clearTimeout(timer);
      Inbox._all = emailRes.data || [];

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

      Inbox._threads = Inbox.groupIntoThreads(Inbox._all);
      Inbox.renderThreadList();
      Inbox.updateBadge();
    } catch (err) {
      clearTimeout(timer);
      console.error('Inbox load error:', err);
      if (el) el.innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><div class="empty-text">No conversations yet</div><div class="empty-sub">Send an email and sync to see replies.</div></div>';
    }
  },

  // ── GMAIL SYNC: fetch new emails from Gmail API ───────────────────────────
  async syncGmail(silent) {
    if (Inbox._syncing) return;
    Inbox._syncing = true;
    const btn = document.getElementById('inbox-sync-btn');
    const status = document.getElementById('inbox-sync-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = '⏳ Syncing...';
    if (!silent) App.toast('📬 Syncing Gmail...', 'var(--accent2)');

    try {
      // Find latest gmail_internal_date or created_at to only fetch new emails
      let afterEpoch = 0;
      if (Inbox._all.length) {
        const dates = Inbox._all
          .map(e => new Date(e.gmail_internal_date || e.created_at).getTime())
          .filter(d => !isNaN(d));
        if (dates.length) afterEpoch = Math.floor(Math.max(...dates) / 1000) - 60; // 1 min overlap for safety
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-inbox`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ after_epoch: afterEpoch, max_results: 30 })
      });
      const data = await res.json();

      if (data.needs_scope) {
        if (status) status.textContent = '⚠️ Need Gmail read permission';
        App.toast('⚠️ Gmail sync needs updated OAuth token. See setup guide.', 'var(--accent2)');
        Inbox._syncing = false;
        if (btn) btn.disabled = false;
        return;
      }
      if (data.error) throw new Error(data.error);

      const emails = data.emails || [];
      let newCount = 0;
      const agentEmail = (currentAgent?.email || 'maxwelldelali22@gmail.com').toLowerCase();

      for (const em of emails) {
        // Skip if already in DB (dedup by gmail_message_id)
        const exists = Inbox._all.some(e => e.gmail_message_id === em.gmail_message_id);
        if (exists) continue;

        const isSent = em.from_email.toLowerCase() === agentEmail;
        const contactEmail = isSent ? em.to.replace(/.*</, '').replace(/>.*/, '').trim() : em.from_email;
        const contactName = isSent ? em.to.replace(/<.*/, '').trim() : em.from.replace(/<.*/, '').trim();

        try {
          await db.from('email_inbox').insert({
            agent_id: currentAgent.id,
            direction: isSent ? 'sent' : 'received',
            recipient_name: isSent ? contactName : (currentAgent.full_name || currentAgent.name || ''),
            recipient_email: isSent ? contactEmail : agentEmail,
            sender_name: isSent ? (currentAgent.full_name || currentAgent.name || '') : contactName,
            sender_email: isSent ? agentEmail : contactEmail,
            subject: em.subject || '(no subject)',
            body: em.body_text || '',
            gmail_message_id: em.gmail_message_id,
            gmail_thread_id: em.gmail_thread_id,
            in_reply_to: em.message_id_header || null,
            is_read: isSent, // sent = read, received = unread
            gmail_internal_date: em.date ? new Date(em.date).toISOString() : new Date().toISOString(),
            created_at: em.date ? new Date(em.date).toISOString() : new Date().toISOString()
          });
          newCount++;
        } catch (insertErr) {
          // Dedup constraint may fire — that's fine
          if (!insertErr.message?.includes('duplicate')) console.warn('Insert err:', insertErr);
        }
      }

      Inbox._lastSync = Date.now();
      if (status) status.textContent = `✅ Synced · ${newCount} new`;
      if (newCount > 0) {
        if (!silent) App.toast(`📬 ${newCount} new email(s) synced!`, 'var(--green)');
        // Send push notification for received emails
        if (typeof Notify !== 'undefined') {
          const received = emails.filter(e => e.from_email.toLowerCase() !== agentEmail);
          if (received.length) {
            App.toast(`📬 ${received.length} new reply(s) in your inbox`, 'var(--green)');
          }
        }
        await Inbox.load(); // Reload to show new emails
      } else {
        if (!silent) App.toast('✅ Inbox is up to date', 'var(--green)');
      }
      Inbox.updateBadge();
    } catch (err) {
      console.error('Gmail sync error:', err);
      if (status) status.textContent = '❌ Sync failed';
      if (!silent) App.toast(`❌ Sync failed: ${err.message}`, 'var(--red)');
    }
    Inbox._syncing = false;
    if (btn) btn.disabled = false;
  },

  // ── GROUP INTO THREADS ────────────────────────────────────────────────────
  groupIntoThreads(emails) {
    const threadMap = {};
    emails.forEach(e => {
      const key = e.gmail_thread_id || `solo_${e.id}`;
      if (!threadMap[key]) threadMap[key] = [];
      threadMap[key].push(e);
    });
    // Sort messages within each thread by date (oldest first)
    const threads = Object.entries(threadMap).map(([threadId, msgs]) => {
      msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const latest = msgs[msgs.length - 1];
      const unread = msgs.filter(m => !m.is_read && m.direction === 'received').length;
      // Determine contact: the non-agent email in the thread
      const agentEmail = (currentAgent?.email || 'maxwelldelali22@gmail.com').toLowerCase();
      let contact = '';
      let contactEmail = '';
      for (const m of msgs) {
        if (m.direction === 'sent') {
          contact = m.recipient_name || m.recipient_email || '';
          contactEmail = (m.recipient_email || '').toLowerCase();
        } else {
          contact = m.sender_name || m.sender_email || '';
          contactEmail = (m.sender_email || '').toLowerCase();
        }
        if (contactEmail && contactEmail !== agentEmail) break;
      }
      return {
        threadId,
        contact: contact || 'Unknown',
        contactEmail,
        subject: msgs[0].subject || '(no subject)',
        latest,
        messages: msgs,
        unread,
        lastDate: latest.created_at
      };
    });
    // Sort threads by latest message date (newest first)
    threads.sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
    return threads;
  },

  // ── RENDER THREAD LIST (WhatsApp-style) ───────────────────────────────────
  renderThreadList() {
    const el = document.getElementById('inbox-list');
    if (!el) return;
    const threads = Inbox._threads;
    if (!threads.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📬</div><div class="empty-text">No conversations yet</div><div class="empty-sub">Send an email to a client, then sync Gmail to see replies.</div></div>';
      return;
    }
    el.innerHTML = threads.map(t => {
      const client = Inbox._clientMap?.[t.contactEmail];
      const preview = (t.latest.body || '').replace(/\n/g, ' ').slice(0, 80);
      const isSent = t.latest.direction === 'sent';
      const unreadDot = t.unread > 0 ? `<span style="background:var(--accent);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;min-width:18px;text-align:center;">${t.unread}</span>` : '';
      return `<div class="card inbox-thread-card" style="margin-bottom:8px;cursor:pointer;border-left:3px solid ${t.unread > 0 ? 'var(--accent)' : 'transparent'};" onclick="Inbox.openThread('${t.threadId}')">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="width:36px;height:36px;border-radius:50%;background:${client ? 'var(--accent)' : 'var(--text2)'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;">${(t.contact[0] || '?').toUpperCase()}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
              <div class="fw-700" style="font-size:13px;${t.unread > 0 ? 'color:var(--text);' : 'color:var(--text2);'}">${App.esc(t.contact)}</div>
              <div style="font-size:11px;color:var(--text2);white-space:nowrap;">${App.timeAgo(t.lastDate)}</div>
            </div>
            <div style="font-size:12px;font-weight:600;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${App.esc(t.subject)}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <div style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${isSent ? '↗ You: ' : ''}${App.esc(preview)}${preview.length >= 80 ? '…' : ''}</div>
              ${unreadDot}
            </div>
            ${client ? `<div style="font-size:10px;color:var(--accent2);margin-top:2px;">👤 ${App.esc(client.full_name)}</div>` : `<div style="font-size:10px;color:var(--text2);margin-top:2px;">${t.messages.length} message${t.messages.length > 1 ? 's' : ''}</div>`}
          </div>
        </div>
      </div>`;
    }).join('');
  },

  // ── OPEN THREAD (professional email view) ────────────────────────────────
  async openThread(threadId) {
    const thread = Inbox._threads.find(t => t.threadId === threadId);
    if (!thread) return;

    // Mark all received messages as read
    const unreadIds = thread.messages.filter(m => !m.is_read && m.direction === 'received').map(m => m.id);
    if (unreadIds.length) {
      await db.from('email_inbox').update({ is_read: true }).in('id', unreadIds);
      thread.messages.forEach(m => { if (unreadIds.includes(m.id)) m.is_read = true; });
      thread.unread = 0;
      Inbox.updateBadge();
    }

    const msgs = thread.messages;

    // Build email message cards (Gmail-style collapsed/expanded)
    const emailCards = msgs.map((m, idx) => {
      const isSent = m.direction === 'sent';
      const senderLabel = isSent ? ('You') : App.esc(m.sender_name || m.sender_email || 'Client');
      const senderEmail = isSent ? (currentAgent?.email || '') : App.esc(m.sender_email || '');
      const time = new Date(m.created_at).toLocaleString('en-CA', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
      // Render HTML body if it looks like HTML, otherwise convert newlines
      const rawBody = m.body || '';
      const isHtml = rawBody.trim().startsWith('<') && rawBody.includes('<');
      const bodyContent = isHtml
        ? `<iframe srcdoc="${rawBody.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" style="width:100%;border:none;min-height:80px;background:#fff;" onload="this.style.height=(this.contentWindow.document.body.scrollHeight+20)+'px'" sandbox="allow-same-origin"></iframe>`
        : `<div style="white-space:pre-wrap;font-size:13px;line-height:1.6;color:var(--text);">${App.esc(rawBody).replace(/\n/g,'<br>')}</div>`;
      const isLast = idx === msgs.length - 1;
      const collapsed = !isLast && msgs.length > 2;
      return `<div class="inbox-msg-card" style="border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--card);overflow:hidden;">
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;${collapsed ? '' : 'border-bottom:1px solid var(--border);'}" onclick="this.parentElement.querySelector('.inbox-msg-body').classList.toggle('hidden');this.querySelector('.inbox-msg-chevron').classList.toggle('rotated')">
          <div style="width:32px;height:32px;border-radius:50%;background:${isSent ? 'var(--accent)' : 'var(--accent2)'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;">${(senderLabel[0]||'?').toUpperCase()}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
              <span class="fw-700" style="font-size:13px;">${senderLabel}</span>
              <span style="font-size:11px;color:var(--text2);">&lt;${senderEmail}&gt;</span>
            </div>
            ${collapsed ? `<div style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;">${App.esc(rawBody.slice(0,80))}…</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <span style="font-size:11px;color:var(--text2);">${time}</span>
            <span class="inbox-msg-chevron" style="font-size:12px;color:var(--text2);transition:transform 0.2s;${collapsed ? '' : 'transform:rotate(180deg);'} display:inline-block;">▼</span>
          </div>
        </div>
        <div class="inbox-msg-body${collapsed ? ' hidden' : ''}" style="padding:14px;">
          ${bodyContent}
        </div>
      </div>`;
    }).join('');

    // Avatar initials for contact
    const initials = (thread.contact || '?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();

    App.openModal(`
      <style>
        .inbox-msg-body.hidden { display:none; }
        .inbox-msg-chevron.rotated { transform:rotate(0deg) !important; }
        .inbox-reply-toolbar button { background:none;border:1px solid var(--border);border-radius:4px;padding:2px 7px;font-size:12px;cursor:pointer;color:var(--text);line-height:1.4; }
        .inbox-reply-toolbar button:hover { background:var(--accent);color:#fff;border-color:var(--accent); }
        .inbox-reply-editor { min-height:100px;max-height:200px;overflow-y:auto;outline:none;font-size:13px;line-height:1.6;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text); }
        .inbox-reply-editor:focus { border-color:var(--accent); }
        .inbox-attach-list { display:flex;flex-wrap:wrap;gap:6px;margin-top:6px; }
        .inbox-attach-chip { display:flex;align-items:center;gap:4px;background:var(--bg2,var(--bg));border:1px solid var(--border);border-radius:12px;padding:3px 10px;font-size:11px; }
        .inbox-attach-chip button { background:none;border:none;cursor:pointer;font-size:11px;color:var(--text2);padding:0 2px; }
      </style>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <button class="btn btn-outline btn-sm" onclick="App.closeModal();Inbox.renderThreadList();" style="padding:4px 10px;font-size:12px;">← Back</button>
        <div style="width:36px;height:36px;border-radius:50%;background:var(--accent2);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;">${initials}</div>
        <div style="flex:1;min-width:0;">
          <div class="fw-800" style="font-size:15px;">${App.esc(thread.contact)}</div>
          <div style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${App.esc(thread.subject)}</div>
        </div>
        <button class="btn btn-outline btn-sm" style="font-size:11px;color:var(--red);border-color:var(--red);padding:3px 8px;" onclick="Inbox.deleteThread('${threadId}')">🗑</button>
      </div>
      <div id="inbox-thread-messages" style="max-height:44vh;overflow-y:auto;padding-right:2px;margin-bottom:12px;">
        ${emailCards}
      </div>
      <div style="border:1px solid var(--border);border-radius:8px;background:var(--card);padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border);">
          <button id="inbox-mode-reply" onclick="Inbox.setMode('reply','${threadId}')" style="font-size:12px;padding:3px 10px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-weight:600;">↩ Reply</button>
          <button id="inbox-mode-forward" onclick="Inbox.setMode('forward','${threadId}')" style="font-size:12px;padding:3px 10px;border-radius:4px;border:1px solid var(--border);background:none;color:var(--text2);cursor:pointer;">⮕ Forward</button>
          <input type="hidden" id="inbox-compose-mode" value="reply">
        </div>
        <div style="display:flex;gap:6px;margin-bottom:4px;align-items:center;">
          <div style="font-size:12px;color:var(--text2);white-space:nowrap;min-width:52px;">To:</div>
          <div id="inbox-to-static" style="font-size:12px;flex:1;color:var(--text);">${App.esc(thread.contactEmail)}</div>
          <input id="inbox-to-input" type="email" class="form-input" style="display:none;flex:1;padding:4px 8px;font-size:12px;height:28px;" placeholder="recipient@email.com">
        </div>
        <div id="inbox-subject-row" style="display:none;gap:6px;margin-bottom:4px;align-items:center;">
          <div style="font-size:12px;color:var(--text2);white-space:nowrap;min-width:52px;">Subject:</div>
          <input id="inbox-fwd-subject" type="text" class="form-input" style="flex:1;padding:4px 8px;font-size:12px;height:28px;" value="Fwd: ${App.esc(thread.subject)}">
        </div>
        <div style="display:flex;gap:6px;margin-bottom:2px;align-items:center;">
          <label style="font-size:12px;color:var(--text2);white-space:nowrap;min-width:52px;">CC:</label>
          <input id="inbox-reply-cc" type="email" class="form-input" style="flex:1;padding:4px 8px;font-size:12px;height:28px;" placeholder="cc@email.com">
          <button onclick="var r=document.getElementById('inbox-bcc-row');r.style.display=r.style.display==='flex'?'none':'flex';" style="font-size:11px;color:var(--accent2);background:none;border:none;cursor:pointer;white-space:nowrap;padding:0 6px;">+ BCC</button>
        </div>
        <div id="inbox-bcc-row" style="display:none;gap:6px;margin-bottom:6px;align-items:center;">
          <label style="font-size:12px;color:var(--text2);white-space:nowrap;min-width:52px;">BCC:</label>
          <input id="inbox-reply-bcc" type="email" class="form-input" style="flex:1;padding:4px 8px;font-size:12px;height:28px;" placeholder="bcc@email.com">
        </div>
        <div class="inbox-reply-toolbar" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border);margin-top:6px;">
          <button onclick="document.getElementById('inbox-reply-editor').focus();document.execCommand('bold')" title="Bold"><b>B</b></button>
          <button onclick="document.getElementById('inbox-reply-editor').focus();document.execCommand('italic')" title="Italic"><i>I</i></button>
          <button onclick="document.getElementById('inbox-reply-editor').focus();document.execCommand('underline')" title="Underline"><u>U</u></button>
          <button onclick="document.getElementById('inbox-reply-editor').focus();document.execCommand('insertUnorderedList')" title="Bullet list">• List</button>
          <button onclick="document.getElementById('inbox-reply-editor').focus();document.execCommand('insertOrderedList')" title="Numbered list">1. List</button>
          <button onclick="(function(){const url=prompt('Link URL:');if(url){document.getElementById('inbox-reply-editor').focus();document.execCommand('createLink',false,url);}})()" title="Insert link">🔗</button>
          <button onclick="document.getElementById('inbox-reply-editor').focus();document.execCommand('removeFormat')" title="Clear formatting">✕ Format</button>
          <label style="cursor:pointer;" title="Attach file">
            <span class="btn btn-outline" style="font-size:12px;padding:2px 7px;border-radius:4px;cursor:pointer;">📎 Attach</span>
            <input type="file" id="inbox-attach-input" style="display:none;" multiple onchange="Inbox._handleAttachSelect(this)">
          </label>
        </div>
        <div id="inbox-reply-editor" class="inbox-reply-editor" contenteditable="true" data-placeholder="Type your reply…" style="margin-bottom:6px;" oninput="if(!this.innerHTML.trim()||this.innerHTML==='<br>'){this.innerHTML=''}"></div>
        <div id="inbox-attach-list" class="inbox-attach-list"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
          <div style="font-size:11px;color:var(--text2);">Your signature will be appended automatically.</div>
          <button class="btn btn-primary btn-sm" id="inbox-reply-btn" onclick="Inbox.sendReply('${threadId}')" style="font-size:13px;">📤 Send</button>
        </div>
      </div>
    `);

    // Scroll to bottom of messages
    setTimeout(() => {
      const container = document.getElementById('inbox-thread-messages');
      if (container) container.scrollTop = container.scrollHeight;
    }, 120);
  },

  // ── HANDLE ATTACHMENT FILE SELECT ─────────────────────────────────────────
  _pendingAttachments: [],

  _handleAttachSelect(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const list = document.getElementById('inbox-attach-list');
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        const base64 = (e.target.result).split(',')[1]; // strip data:...;base64,
        const att = { filename: file.name, mime_type: file.type || 'application/octet-stream', data: base64, size: file.size };
        Inbox._pendingAttachments.push(att);
        if (list) {
          const chip = document.createElement('div');
          chip.className = 'inbox-attach-chip';
          chip.dataset.filename = file.name;
          chip.innerHTML = `📎 ${App.esc(file.name)} <span style="color:var(--text2);">(${(file.size/1024).toFixed(0)}KB)</span> <button onclick="Inbox._removeAttachment('${file.name.replace(/'/g,"\\'")}',this.parentElement)">×</button>`;
          list.appendChild(chip);
        }
      };
      reader.readAsDataURL(file);
    });
    input.value = ''; // reset so same file can be re-added
  },

  _removeAttachment(filename, chipEl) {
    Inbox._pendingAttachments = Inbox._pendingAttachments.filter(a => a.filename !== filename);
    if (chipEl) chipEl.remove();
  },

  // ── SWITCH REPLY / FORWARD MODE ───────────────────────────────────────────
  setMode(mode, threadId) {
    const thread = Inbox._threads.find(t => t.threadId === threadId);
    if (!thread) return;
    const modeInput    = document.getElementById('inbox-compose-mode');
    const replyBtn     = document.getElementById('inbox-mode-reply');
    const fwdBtn       = document.getElementById('inbox-mode-forward');
    const toStatic     = document.getElementById('inbox-to-static');
    const toInput      = document.getElementById('inbox-to-input');
    const subjectRow   = document.getElementById('inbox-subject-row');
    const editor       = document.getElementById('inbox-reply-editor');
    if (!modeInput) return;
    modeInput.value = mode;
    const activeStyle  = 'font-size:12px;padding:3px 10px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-weight:600;';
    const inactiveStyle= 'font-size:12px;padding:3px 10px;border-radius:4px;border:1px solid var(--border);background:none;color:var(--text2);cursor:pointer;';
    if (mode === 'forward') {
      if (replyBtn)   replyBtn.style.cssText   = inactiveStyle;
      if (fwdBtn)     fwdBtn.style.cssText     = activeStyle;
      if (toStatic)   toStatic.style.display   = 'none';
      if (toInput)  { toInput.style.display = 'block'; toInput.style.flex = '1'; toInput.value = ''; toInput.placeholder = 'Forward to…'; }
      if (subjectRow) subjectRow.style.display = 'flex';
      // Pre-fill editor with quoted forwarded message
      if (editor) {
        const lastMsg = thread.messages[thread.messages.length - 1];
        const fwdDate = lastMsg.created_at ? new Date(lastMsg.created_at).toLocaleString() : '';
        const fwdFrom = lastMsg.direction === 'received'
          ? (lastMsg.sender_name || lastMsg.sender_email || thread.contact)
          : (currentAgent?.full_name || 'Maxwell Midodzi');
        const fwdBody = (lastMsg.body || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
        editor.innerHTML = `<br><br><div style="color:var(--text2);border-left:3px solid var(--border);padding-left:8px;margin-top:8px;font-size:12px;">---------- Forwarded message ----------<br>From: ${App.esc(fwdFrom)}<br>Date: ${App.esc(fwdDate)}<br>Subject: ${App.esc(thread.subject)}<br>To: ${App.esc(thread.contactEmail)}<br><br>${fwdBody}</div>`;
        editor.focus();
        const range = document.createRange();
        range.setStart(editor, 0);
        range.collapse(true);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }
    } else {
      if (replyBtn)   replyBtn.style.cssText   = activeStyle;
      if (fwdBtn)     fwdBtn.style.cssText     = inactiveStyle;
      if (toStatic)   toStatic.style.display   = 'block';
      if (toInput)    toInput.style.display    = 'none';
      if (subjectRow) subjectRow.style.display = 'none';
      if (editor)     editor.innerHTML         = '';
    }
  },

  // ── SEND REPLY ────────────────────────────────────────────────────────────
  async sendReply(threadId) {
    const thread = Inbox._threads.find(t => t.threadId === threadId);
    if (!thread) return;

    const editorEl = document.getElementById('inbox-reply-editor');
    const htmlContent = editorEl?.innerHTML?.trim() || '';
    const textContent = editorEl?.innerText?.trim() || '';

    if (!textContent) { App.toast('⚠️ Type a reply first'); return; }

    const mode      = document.getElementById('inbox-compose-mode')?.value || 'reply';
    const isForward = mode === 'forward';
    const ccEmail   = document.getElementById('inbox-reply-cc')?.value.trim() || null;
    const bccEmail  = document.getElementById('inbox-reply-bcc')?.value.trim() || null;
    const attachments = (Inbox._pendingAttachments || []).slice();

    const btn = document.getElementById('inbox-reply-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending…'; }

    try {
      const agent    = currentAgent || {};
      const agentEmail = agent.email || 'maxwelldelali22@gmail.com';

      // Mode-specific To / Subject
      const toEmail  = isForward
        ? (document.getElementById('inbox-to-input')?.value.trim() || '')
        : thread.contactEmail;
      const subject  = isForward
        ? (document.getElementById('inbox-fwd-subject')?.value.trim() || `Fwd: ${thread.subject}`)
        : (thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`);

      if (!toEmail) { App.toast('⚠️ Enter a recipient email'); if (btn) { btn.disabled = false; btn.textContent = '📤 Send'; } return; }

      // Threading headers — forward starts a fresh thread, reply chains
      const lastMsg      = thread.messages[thread.messages.length - 1];
      const gmailThreadId= isForward ? null : (threadId.startsWith('solo_') ? null : threadId);
      const inReplyTo    = isForward ? null : (lastMsg.in_reply_to || lastMsg.gmail_message_id || null);
      const references   = isForward ? null : (lastMsg.in_reply_to || null);

      // Build plain text body + signature
      const { plainSig, fullBody } = EmailSend.buildSignedBody(textContent, null, ccEmail || null);

      // Build branded HTML email using the rich content from editor
      const htmlBody = EmailSend.wrapHtml(htmlContent, plainSig, null);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          to: toEmail,
          cc: ccEmail || null,
          bcc: bccEmail || null,
          subject,
          body: fullBody,
          html: htmlBody,
          attachments: attachments.length ? attachments : null,
          from_name: agent.full_name || agent.name || 'Maxwell Midodzi',
          thread_id: gmailThreadId,
          in_reply_to: inReplyTo,
          references
        })
      });
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Send failed');

      // Log to email_inbox
      await db.from('email_inbox').insert({
        agent_id: currentAgent.id,
        direction: 'sent',
        recipient_name: isForward ? toEmail : thread.contact,
        recipient_email: toEmail,
        sender_name: agent.full_name || agent.name || '',
        sender_email: agentEmail,
        subject,
        body: textContent,
        gmail_message_id: result.gmail_message_id || null,
        gmail_thread_id: result.gmail_thread_id || gmailThreadId || null,
        is_read: true,
        created_at: new Date().toISOString()
      });

      // Clear pending attachments
      Inbox._pendingAttachments = [];

      App.toast(isForward ? '✅ Message forwarded!' : '✅ Reply sent!', 'var(--green)');
      App.closeModal();
      await Inbox.load(); // Refresh threads
    } catch (err) {
      App.toast(`❌ ${isForward ? 'Forward' : 'Reply'} failed: ${err.message}`, 'var(--red)');
      if (btn) { btn.disabled = false; btn.textContent = '📤 Send'; }
    }
  },

  // ── UPDATE BADGE ──────────────────────────────────────────────────────────
  async updateBadge() {
    try {
      if (!currentAgent?.id) return;
      const { count } = await db.from('email_inbox')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', currentAgent.id)
        .eq('direction', 'received')
        .eq('is_read', false);
      const n = count || 0;
      // Sidebar badge
      const sbBadge = document.getElementById('inbox-badge');
      if (sbBadge) { sbBadge.textContent = n; sbBadge.style.display = n > 0 ? 'inline' : 'none'; }
      // Mobile badge
      const mobBadge = document.getElementById('mob-inbox-badge');
      if (mobBadge) { mobBadge.textContent = n; mobBadge.style.display = n > 0 ? '' : 'none'; }
    } catch (_) {}
  },

  // ── DELETE THREAD ─────────────────────────────────────────────────────────
  async deleteThread(threadId) {
    const thread = Inbox._threads.find(t => t.threadId === threadId);
    if (!thread) return;
    if (!confirm(`Delete this conversation with ${thread.contact}? (${thread.messages.length} messages)`)) return;
    const ids = thread.messages.map(m => m.id);
    await db.from('email_inbox').delete().in('id', ids);
    App.toast('🗑 Conversation deleted');
    App.closeModal();
    await Inbox.load();
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
      `<button class="btn btn-sm" style="background:var(--red);color:#fff;margin-top:8px;" onclick="Cleanup.deleteChecked('dup-')">Delete Checked</button>`;
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
      `<button class="btn btn-sm" style="background:var(--red);color:#fff;margin-top:8px;" onclick="Cleanup.deleteChecked('tst-')">Delete Checked</button>`;
  },

  async deleteTestData() {
    if (!confirm('Delete ALL clients with "test", "demo", "sample", "dummy", or "fake" in their name? This cannot be undone.')) return;
    const { data } = await db.from('clients').select('id,full_name').eq('agent_id', currentAgent.id);
    const testIds = (data || []).filter(c => /test|demo|sample|dummy|fake/i.test(c.full_name||'')).map(c => c.id);
    if (!testIds.length) { App.toast('✅ No test data to delete.'); return; }
    await db.from('clients').delete().in('id', testIds);
    App.toast(`Deleted ${testIds.length} test client(s).`);
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
    App.toast(`Deleted: ${name}`);
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
        `<button class="btn btn-sm" style="background:var(--red);color:#fff;margin-top:8px;" onclick="Cleanup.deleteChecked('lbl-')">Delete Checked</button>`;
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
      context_data: { note: `Resend welcome email to ${opt.dataset.name} (${opt.dataset.email})` },
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

  // ── LIVE HEALTH DASHBOARD ─────────────────────────────────────────────────
  async runHealthCheck() {
    const setTile = (id, status, label) => {
      const tile = document.getElementById(id);
      if (!tile) return;
      const dot = tile.querySelector('.health-dot');
      if (dot) { dot.className = `health-dot ${status}`; }
      tile.querySelector('span:last-child') ? tile.querySelector('span:last-child').textContent = ' ' + label : null;
      // Update text node
      tile.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = ' ' + label; });
    };
    const summary = document.getElementById('health-summary');
    if (summary) summary.textContent = 'Checking systems…';

    // DB check
    try {
      const { error } = await db.from('clients').select('id', { count: 'exact', head: true }).eq('agent_id', currentAgent.id);
      setTile('ht-db', error ? 'err' : 'ok', error ? 'Database ✗' : 'Database ✓');
    } catch { setTile('ht-db', 'err', 'Database ✗'); }

    // Auth check
    try {
      const { data: { user } } = await db.auth.getUser();
      setTile('ht-auth', user ? 'ok' : 'err', user ? 'Auth ✓' : 'Auth ✗');
    } catch { setTile('ht-auth', 'err', 'Auth ✗'); }

    // Email service (ping edge function — just check reachable)
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, { method: 'OPTIONS', headers: { 'apikey': SUPABASE_ANON_KEY } });
      setTile('ht-email', r.ok || r.status === 200 || r.status === 204 || r.status === 401 ? 'ok' : 'warn', 'Email ✓');
    } catch { setTile('ht-email', 'warn', 'Email — no response'); }

    // Approval queue
    try {
      const { count } = await db.from('approval_queue').select('id', { count: 'exact', head: true }).eq('agent_id', currentAgent.id).eq('status', 'Pending');
      const c = count || 0;
      setTile('ht-queue', c > 5 ? 'warn' : 'ok', `Queue: ${c} pending`);
      const el = document.getElementById('hc-pending'); if (el) el.textContent = c;
    } catch { setTile('ht-queue', 'err', 'Queue ✗'); }

    // Counts
    try {
      const [cl, pi] = await Promise.all([
        db.from('clients').select('id', { count: 'exact', head: true }).eq('agent_id', currentAgent.id).neq('status', 'Archived'),
        db.from('pipeline').select('id', { count: 'exact', head: true }).eq('agent_id', currentAgent.id).not('stage', 'in', '("Closed","Fell Through")')
      ]);
      const ce = document.getElementById('hc-clients'); if (ce) ce.textContent = cl.count || 0;
      const de = document.getElementById('hc-deals');   if (de) de.textContent = pi.count || 0;
    } catch {}

    if (summary) summary.innerHTML = `<span style="color:var(--green);font-weight:600;">✅ Health check complete</span> — ${new Date().toLocaleTimeString()}`;
  },

  // ── TEST RUNNER ────────────────────────────────────────────────────────────
  async runTests() {
    const results = [];
    const set = (id, pass, label) => {
      results.push({ id, pass, label });
      const el = document.getElementById(id);
      if (el) { el.className = pass ? 'tr-pass' : 'tr-fail'; el.textContent = (pass ? '✅' : '❌') + ' ' + label; }
    };
    const skip = (id, label) => {
      const el = document.getElementById(id); if (el) { el.className = 'tr-skip'; el.textContent = '⏭ ' + label; }
    };

    // Reset
    ['tr-auth','tr-db','tr-write','tr-pipeline','tr-email','tr-neg-email','tr-neg-empty','tr-storage'].forEach(id => {
      const el = document.getElementById(id); if (el) { el.className=''; el.textContent = '🔄 ' + el.textContent.slice(2); }
    });

    // 1. Auth
    try {
      const { data: { user } } = await db.auth.getUser();
      set('tr-auth', !!user, `Auth — ${user ? 'session valid (' + (user.email || user.id.slice(0,8)) + ')' : 'no session'}`);
    } catch(e) { set('tr-auth', false, `Auth — error: ${e.message}`); }

    // 2. DB read
    try {
      const { data, error } = await db.from('clients').select('id').eq('agent_id', currentAgent.id).limit(1);
      set('tr-db', !error, `Database — ${error ? 'read failed: ' + error.message : 'clients table readable'}`);
    } catch(e) { set('tr-db', false, `Database — error: ${e.message}`); }

    // 3. DB write & rollback (insert then immediately delete)
    try {
      const testRow = { agent_id: currentAgent.id, full_name: '__TEST_ROW__', email: 'test@dealflow-test.internal', stage: 'Lead' };
      const { data: ins, error: insErr } = await db.from('clients').insert(testRow).select('id').single();
      if (insErr) { set('tr-write', false, `DB write — insert failed: ${insErr.message}`); }
      else {
        await db.from('clients').delete().eq('id', ins.id);
        set('tr-write', true, 'DB write — insert & rollback OK');
      }
    } catch(e) { set('tr-write', false, `DB write — error: ${e.message}`); }

    // 4. Pipeline integrity
    try {
      const { data: pl } = await db.from('pipeline').select('id,client_id').eq('agent_id', currentAgent.id);
      const orphans = (pl || []).filter(p => !p.client_id).length;
      set('tr-pipeline', orphans === 0, `Pipeline — ${orphans === 0 ? 'all deals have client IDs' : orphans + ' deal(s) missing client_id'}`);
    } catch(e) { set('tr-pipeline', false, `Pipeline — error: ${e.message}`); }

    // 5. Email edge function reachable
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, { method: 'OPTIONS', headers: { 'apikey': SUPABASE_ANON_KEY } });
      set('tr-email', r.status < 500, `Email service — HTTP ${r.status} (reachable)`);
    } catch(e) { set('tr-email', false, `Email service — unreachable: ${e.message}`); }

    // 6. Negative: invalid email format
    try {
      const { error } = await db.from('clients').insert({ agent_id: currentAgent.id, full_name: '__NEG_TEST__', email: 'not-an-email', stage: 'Lead' });
      if (error) { set('tr-neg-email', true, 'Negative — invalid email correctly rejected'); }
      else {
        // Clean up the inserted row
        await db.from('clients').delete().eq('full_name', '__NEG_TEST__').eq('agent_id', currentAgent.id);
        set('tr-neg-email', false, 'Negative — invalid email was accepted (check DB constraints)');
      }
    } catch(e) { set('tr-neg-email', true, `Negative — invalid email blocked: ${e.message}`); }

    // 7. Negative: empty name
    try {
      const { error } = await db.from('clients').insert({ agent_id: currentAgent.id, full_name: '', email: 'neg@test.com', stage: 'Lead' });
      if (error) { set('tr-neg-empty', true, 'Negative — empty name correctly rejected'); }
      else {
        await db.from('clients').delete().eq('email', 'neg@test.com').eq('agent_id', currentAgent.id);
        set('tr-neg-empty', false, 'Negative — empty name accepted (consider adding a DB constraint)');
      }
    } catch(e) { set('tr-neg-empty', true, `Negative — empty name blocked: ${e.message}`); }

    // 8. localStorage
    try {
      localStorage.setItem('_df_test', '1'); localStorage.removeItem('_df_test');
      set('tr-storage', true, 'Storage — localStorage accessible');
    } catch(e) { set('tr-storage', false, `Storage — localStorage blocked: ${e.message}`); }

    const passed = results.filter(r => r.pass).length;
    const sumEl = document.getElementById('test-runner-summary');
    if (sumEl) sumEl.innerHTML = `<span style="color:${passed===results.length?'var(--green)':'var(--yellow)'};font-weight:700;">${passed}/${results.length} tests passed</span> — ${new Date().toLocaleTimeString()}`;

    SystemTools._lastTestResults = results;
  },

  async emailTestReport() {
    const results = SystemTools._lastTestResults;
    if (!results?.length) { App.toast('⚠️ Run tests first'); return; }
    const passed = results.filter(r => r.pass).length;
    const body = [
      `DealFlow Test Report — ${new Date().toLocaleString()}`,
      `Result: ${passed}/${results.length} tests passed`,
      '',
      ...results.map(r => `${r.pass ? '✅' : '❌'} ${r.label}`)
    ].join('\n');
    await Notify.queue('Test Report', currentAgent.id, currentAgent.full_name, currentAgent.email,
      `DealFlow Test Report — ${passed}/${results.length} passed`, body);
    App.toast('📧 Test report queued in Approvals');
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
    App.toast('Refreshing dashboard & analytics...');
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
    App.toast('Theme applied!');
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
    if (name === 'diagnostics') Settings.runDiagnostics();
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
    // Load auto-approve prefs
    const ap = JSON.parse(localStorage.getItem('df-auto-approve') || '{}');
    const keys = ['viewing','offer','reminder','followup','morning'];
    keys.forEach(k => {
      const el = document.getElementById(`auto-${k}`);
      if (el) el.checked = !!ap[k];
    });
    // Sync master toggle — on if ALL individual toggles are on
    const masterEl = document.getElementById('auto-master-toggle');
    if (masterEl) {
      const allOn = keys.every(k => !!ap[k]);
      masterEl.checked = allOn;
      const lbl = document.getElementById('auto-master-label');
      if (lbl) lbl.textContent = allOn
        ? '✅ All emails send automatically — no approval needed'
        : 'Toggle individual email types below, or flip this to control all at once.';
    }
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

  saveAutoApprove() {
    const ap = {};
    ['viewing','offer','reminder','followup','morning'].forEach(k => {
      const el = document.getElementById(`auto-${k}`);
      if (el) ap[k] = el.checked;
    });
    localStorage.setItem('df-auto-approve', JSON.stringify(ap));
    const msg = document.getElementById('set-auto-msg');
    if (msg) { msg.style.color='var(--green)'; msg.textContent='⚡ Auto-approve settings saved!'; setTimeout(() => { msg.textContent=''; }, 3000); }
    App.toast('⚡ Auto-approve updated');
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

// ── MASTER APPROVAL TOGGLE ────────────────────────────────────────────────
Settings.handleMasterToggle = function(cb) {
  const isOn = cb.checked;
  ['viewing','offer','reminder','followup','morning'].forEach(id => {
    const el = document.getElementById(`auto-${id}`);
    if (el) el.checked = isOn;
  });
  const lbl = document.getElementById('auto-master-label');
  if (lbl) lbl.textContent = isOn
    ? '✅ All emails send automatically — no approval needed'
    : '🔴 All emails require your approval before sending to clients';
  Settings.saveAutoApprove();
};

// ── SYSTEM DIAGNOSTICS ────────────────────────────────────────────────────
Settings.runDiagnostics = async function() {
  const btn = document.getElementById('diag-run-btn');
  const out = document.getElementById('diag-results');
  if (!out) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning…'; }
  const checks = [];

  const card = (label, status, detail, healCode) => {
    const color = status === 'ok' ? 'var(--green)' : status === 'warn' ? 'var(--yellow)' : 'var(--red)';
    const icon  = status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : '🔴';
    const btn   = healCode ? `<button class="btn btn-sm btn-outline" style="font-size:11px;white-space:nowrap;flex-shrink:0;" onclick="${healCode}">🔧 Fix</button>` : '';
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--bg);border-radius:8px;margin-bottom:6px;border-left:3px solid ${color};">
      <span style="font-size:17px;line-height:1.3;">${icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--text);">${label}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${detail}</div>
      </div>${btn}
    </div>`;
  };

  const render = () => { out.innerHTML = checks.map(c => card(c.l, c.s, c.d, c.h)).join(''); };

  // 1. Agent session
  checks.push(currentAgent?.id
    ? { l:'Agent Session', s:'ok', d:`Logged in as ${currentAgent.full_name||currentAgent.email||'—'}` }
    : { l:'Agent Session', s:'fail', d:'No session found — please sign out and sign back in' });
  render();

  // 2. Supabase DB
  try {
    const { error } = await db.from('agents').select('id').eq('id', currentAgent?.id||'').limit(1);
    if (error) throw error;
    checks.push({ l:'Supabase Database', s:'ok', d:'Connection active — read/write working' });
  } catch(e) {
    checks.push({ l:'Supabase Database', s:'fail', d:`Cannot reach DB: ${e.message}`, h:`window.open('https://supabase.com','_blank')` });
  }
  render();

  // 3. Push subscriptions
  try {
    const { data: subs } = await db.from('push_subscriptions').select('id').eq('agent_id', currentAgent?.id||'');
    const n = subs?.length || 0;
    checks.push(n > 0
      ? { l:'Web Push Notifications', s:'ok', d:`${n} device(s) subscribed — push alerts will deliver` }
      : { l:'Web Push Notifications', s:'warn', d:'No push subscriptions — you will not receive background alerts', h:`App.subscribePush&&App.subscribePush().then(()=>App.toast('Push re-registered!'))` });
  } catch(e) {
    checks.push({ l:'Web Push Notifications', s:'warn', d:`Could not check subscriptions: ${e.message}` });
  }
  render();

  // 4. Service Worker
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    checks.push(regs.length > 0
      ? { l:'Service Worker', s:'ok', d:'Registered — offline mode and push delivery enabled' }
      : { l:'Service Worker', s:'warn', d:'Not registered — push notifications and offline mode may not work', h:`navigator.serviceWorker.register('/sw.js').then(()=>App.toast('Service worker registered!'))` });
  } else {
    checks.push({ l:'Service Worker', s:'warn', d:'Not supported by this browser — use Chrome or Safari 16.4+' });
  }
  render();

  // 5–7. Edge function pings (OPTIONS = reachable)
  const funcs = [
    { name:'Email Sending (send-email)',    slug:'send-email' },
    { name:'Gmail Inbox Sync (fetch-inbox)', slug:'fetch-inbox' },
    { name:'Morning Briefing',              slug:'morning-briefing' },
    { name:'Seller Follow-Ups (cron)',      slug:'check-followups' },
  ];
  for (const fn of funcs) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn.slug}`, { method:'OPTIONS', headers:{ 'apikey': SUPABASE_ANON_KEY } });
      checks.push((r.ok || r.status === 204)
        ? { l:fn.name, s:'ok', d:'Edge function reachable and responding' }
        : { l:fn.name, s:'warn', d:`Responded with status ${r.status} — check Supabase function logs` });
    } catch(e) {
      checks.push({ l:fn.name, s:'fail', d:`Unreachable: ${e.message} — check Supabase Edge Functions dashboard` });
    }
    render();
  }

  // 8. Key table record counts
  try {
    const tables = ['clients','viewings','pipeline','offers'];
    const results = await Promise.all(tables.map(t =>
      db.from(t).select('id',{count:'exact',head:true}).eq('agent_id',currentAgent?.id||'').then(({count})=>({t,n:count||0})).catch(()=>({t,n:'?'}))
    ));
    checks.push({ l:'Database Tables', s:'ok', d:results.map(r=>`${r.t}: ${r.n}`).join(' · ') });
  } catch(e) {
    checks.push({ l:'Database Tables', s:'warn', d:`Could not count records: ${e.message}` });
  }
  render();

  // 9. PWA mode
  const pwa = window.matchMedia('(display-mode:standalone)').matches || navigator.standalone;
  checks.push(pwa
    ? { l:'PWA / App Mode', s:'ok', d:'Running as installed app — full PWA mode active' }
    : { l:'PWA / App Mode', s:'warn', d:'Running in browser — install to your home screen for best experience and push reliability' });
  render();

  // 10. Approval queue backlog
  try {
    const { count } = await db.from('approval_queue').select('id',{count:'exact',head:true}).eq('agent_id',currentAgent?.id||'').eq('status','pending');
    const n = count || 0;
    checks.push(n === 0
      ? { l:'Approval Queue', s:'ok', d:'Queue is clear — no pending emails awaiting approval' }
      : { l:'Approval Queue', s:'warn', d:`${n} email(s) waiting for your approval`, h:`App.switchTab('approvals')` });
  } catch(e) {
    checks.push({ l:'Approval Queue', s:'warn', d:`Could not check queue: ${e.message}` });
  }
  render();

  // Summary bar
  const fails = checks.filter(c=>c.s==='fail').length;
  const warns = checks.filter(c=>c.s==='warn').length;
  const [bg, color, msg] = fails > 0
    ? ['rgba(239,68,68,0.1)','var(--red)',`🔴 ${fails} critical issue(s) — action required`]
    : warns > 0
    ? ['rgba(234,179,8,0.1)','var(--yellow)',`⚠️ ${warns} warning(s) — system is functional, some items need attention`]
    : ['rgba(34,197,94,0.1)','var(--green)','✅ All systems operational'];
  out.innerHTML += `<div style="margin-top:10px;padding:10px 14px;border-radius:8px;background:${bg};color:${color};font-weight:700;font-size:13px;">${msg}</div>`;

  if (btn) { btn.disabled=false; btn.textContent='Run Again'; }
};

// Phase 2.A moved the Claude API key server-side (Supabase secrets + claude-chat
// edge function). Settings.saveApiKey and its supporting UI have been removed
// in Phase 2.B.7 — see index.html stab-security section for the replacement.

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
