// Maxwell DealFlow CRM — Viewings Module
const Viewings = {
  all: [],
  activeFilter: 'all',

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('viewings')
      .select('*, clients(full_name, email)')
      .order('viewing_date', { ascending: false })
      .limit(100);
    Viewings.all = data || [];
    Viewings.render(Viewings.all);
  },

  filter(f, btn) {
    Viewings.activeFilter = f;
    document.querySelectorAll('#screen-viewings .btn').forEach(b => {
      b.className = b === btn ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
    });
    const today = new Date().toISOString().slice(0,10);
    const filtered = Viewings.all.filter(v => {
      if (f === 'all') return true;
      if (f === 'today') return v.viewing_date === today;
      if (f === 'upcoming') return v.viewing_date > today && v.viewing_status !== 'Completed';
      if (f === 'completed') return v.viewing_status === 'Completed';
      return true;
    });
    Viewings.render(filtered);
  },

  render(list) {
    const el = document.getElementById('viewings-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-text">No viewings found</div><div class="empty-sub">Tap + Book to schedule a showing</div></div>`;
      return;
    }
    const statusColor = { Scheduled:'var(--accent2)', Confirmed:'var(--green)', Completed:'var(--text2)', Cancelled:'var(--red)' };
    el.innerHTML = list.map(v => `
      <div class="card" onclick="Viewings.openDetail('${v.id}')" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div class="fw-700" style="font-size:14px;flex:1;margin-right:8px;">${v.property_address || 'No address'}</div>
          <span style="font-size:11px;font-weight:700;color:${statusColor[v.viewing_status]||'var(--text2)'};">${v.viewing_status||'Scheduled'}</span>
        </div>
        <div class="text-muted" style="font-size:12px;margin-bottom:8px;">👤 ${v.clients?.full_name || '—'}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
          <span>📅 ${App.fmtDate(v.viewing_date)} ${v.viewing_time ? '· ' + v.viewing_time.slice(0,5) : ''}</span>
          ${v.list_price ? `<span class="text-accent fw-700">${App.fmtMoney(v.list_price)}</span>` : ''}
        </div>
        ${v.client_feedback ? `<div style="margin-top:6px;font-size:11px;padding:4px 8px;border-radius:6px;background:var(--bg2);display:inline-block;">
          ${v.client_feedback === 'good' ? '✅' : v.client_feedback === 'interested' ? '🌟' : '❌'} ${v.client_feedback}
        </div>` : ''}
      </div>`).join('');
  },

  openAdd() {
    Viewings._showForm(null, null, null);
  },

  openAddForClient(clientId, clientName) {
    App.closeModal();
    setTimeout(() => Viewings._showForm(clientId, clientName, null), 300);
  },

  _showForm(clientId, clientName, viewing) {
    const today = new Date().toISOString().slice(0,10);
    const clientOptions = Clients.all.map(c =>
      `<option value="${c.id}" ${c.id===clientId?'selected':''}>${c.full_name}</option>`
    ).join('');
    App.openModal(`
      <div class="modal-title">📅 ${viewing ? 'Edit' : 'Book'} Viewing</div>
      <div class="form-group">
        <label class="form-label">Client *</label>
        <select class="form-input form-select" id="vf-client">
          <option value="">-- Select Client --</option>
          ${clientOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Property Address *</label>
        <input class="form-input" id="vf-address" placeholder="123 Main St, St. John's NL" value="${viewing?.property_address||''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">MLS Number</label>
          <input class="form-input" id="vf-mls" placeholder="1234567" value="${viewing?.mls_number||''}">
        </div>
        <div class="form-group">
          <label class="form-label">List Price ($)</label>
          <input class="form-input" id="vf-price" type="number" placeholder="399000" value="${viewing?.list_price||''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Date *</label>
          <input class="form-input" id="vf-date" type="date" value="${viewing?.viewing_date||today}">
        </div>
        <div class="form-group">
          <label class="form-label">Time</label>
          <input class="form-input" id="vf-time" type="time" value="${viewing?.viewing_time||''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-input form-select" id="vf-vstatus">
          <option value="Scheduled" ${!viewing||viewing.viewing_status==='Scheduled'?'selected':''}>Scheduled</option>
          <option value="Confirmed" ${viewing?.viewing_status==='Confirmed'?'selected':''}>Confirmed</option>
          <option value="Completed" ${viewing?.viewing_status==='Completed'?'selected':''}>Completed</option>
          <option value="Cancelled" ${viewing?.viewing_status==='Cancelled'?'selected':''}>Cancelled</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Client Feedback</label>
        <select class="form-input form-select" id="vf-feedback">
          <option value="">-- Not yet --</option>
          <option value="good" ${viewing?.client_feedback==='good'?'selected':''}>✅ Good / Like it</option>
          <option value="interested" ${viewing?.client_feedback==='interested'?'selected':''}>🌟 Very Interested</option>
          <option value="pass" ${viewing?.client_feedback==='pass'?'selected':''}>❌ Pass</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Agent Notes</label>
        <textarea class="form-input" id="vf-notes" rows="2" placeholder="Notes...">${viewing?.agent_notes||''}</textarea>
      </div>
      <button class="btn btn-primary btn-block" onclick="Viewings.save(${viewing?`'${viewing.id}'`:'null'})">
        ${viewing ? '💾 Update Viewing' : '📅 Book Viewing'}
      </button>
      <div id="vf-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async save(existingId = null) {
    const clientId = document.getElementById('vf-client').value;
    const address = document.getElementById('vf-address').value.trim();
    const msgEl = document.getElementById('vf-msg');
    if (!clientId || !address) {
      if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent = '⚠️ Client and address required'; }
      return;
    }
    const client = Clients.all.find(c => c.id === clientId);
    if (msgEl) { msgEl.style.color='var(--text2)'; msgEl.textContent = 'Saving...'; }
    const payload = {
      client_id: clientId,
      property_address: address,
      mls_number: document.getElementById('vf-mls').value.trim(),
      list_price: document.getElementById('vf-price').value || null,
      viewing_date: document.getElementById('vf-date').value,
      viewing_time: document.getElementById('vf-time').value || null,
      viewing_status: document.getElementById('vf-vstatus')?.value || 'Scheduled',
      agent_notes: document.getElementById('vf-notes').value.trim(),
      client_feedback: document.getElementById('vf-feedback').value || null,
      updated_at: new Date().toISOString()
    };

    let error;
    if (existingId) {
      ({ error } = await db.from('viewings').update(payload).eq('id', existingId));
    } else {
      payload.agent_id = currentAgent?.id;
      ({ error } = await db.from('viewings').insert(payload));
      if (!error) {
        await App.logActivity('VIEWING_SCHEDULED', client?.full_name, client?.email,
          `Viewing scheduled: ${address}`, clientId);
        // Update client stage to Viewings if still Searching
        if (client?.stage === 'Searching') {
          await db.from('clients').update({ stage: 'Viewings' }).eq('id', clientId);
          Clients.load();
        }
        // Queue confirmation email for approval (works even if no email — shows placeholder)
        if (window.Notify) {
          const { data: newViewing } = await db.from('viewings').select('*').eq('client_id', clientId).order('created_at',{ascending:false}).limit(1).single();
          const viewingObj = newViewing || { ...payload, id: null };
          const clientObj = { ...client, email: client?.email || '(no email on file)' };
          await Notify.onViewingBooked(viewingObj, clientObj);
        }
      }
    }
    // If feedback was added on update, queue follow-up
    if (existingId && !error && payload.client_feedback && window.Notify) {
      const clientObj = { ...client, email: client?.email || '(no email on file)' };
      await Notify.onViewingFeedback(payload, clientObj, payload.client_feedback);
    }
    if (error) { if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent = error.message; } return; }
    App.closeModal();
    App.toast(existingId ? '✅ Viewing updated!' : '✅ Viewing booked!');
    Viewings.load(); App.loadOverview();
  },

  async openDetail(id) {
    const v = Viewings.all.find(x => x.id === id);
    if (!v) return;
    const client = Clients.all.find(c => c.id === v.client_id) || v.clients;
    const clientName = v.clients?.full_name || client?.full_name || '—';
    const isCompleted = v.viewing_status === 'Completed';
    const hasFeedback = !!v.client_feedback;

    // Post-viewing feedback section
    const feedbackSection = isCompleted && hasFeedback ? `
      <div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:8px;">📊 Viewing Outcome</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:20px;">${v.client_feedback==='interested'?'🌟':v.client_feedback==='good'?'✅':v.client_feedback==='pass'?'❌':'🔄'}</span>
          <div>
            <div class="fw-700">${v.client_feedback==='interested'?'Very Interested — Ready to Offer':v.client_feedback==='good'?'Good — Liked It':v.client_feedback==='pass'?'Pass — Continue Searching':'Needs Follow-Up'}</div>
            <div style="font-size:12px;color:var(--text2);">Email follow-up queued in Approvals</div>
          </div>
        </div>
      </div>` : isCompleted && !hasFeedback ? `
      <div style="background:var(--bg2);border:2px solid var(--accent2);border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;">📋 How did the viewing go?</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">Select the outcome to automatically queue a follow-up email to ${clientName.split(' ')[0]}:</div>
        <div style="display:grid;gap:8px;">
          <button class="btn btn-green" onclick="Viewings.recordFeedback('${v.id}','interested')">🌟 Very Interested — Wants to Make an Offer</button>
          <button class="btn btn-outline" onclick="Viewings.recordFeedback('${v.id}','good')" style="border-color:var(--accent2);color:var(--accent2);">✅ Good — Liked It, Needs More Time</button>
          <button class="btn btn-outline" onclick="Viewings.recordFeedback('${v.id}','pass')" style="border-color:var(--red);color:var(--red);">❌ Pass — Continue Searching</button>
        </div>
      </div>` : ``;

    App.openModal(`
      <div class="fw-800" style="font-size:16px;margin-bottom:2px;">${v.property_address}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:14px;">👤 ${clientName}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:12px;">
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Date</div><div class="fw-700">${App.fmtDate(v.viewing_date)}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Time</div><div class="fw-700">${v.viewing_time?.slice(0,5)||'—'}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Status</div><div class="fw-700">${v.viewing_status||'Scheduled'}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">List Price</div><div class="fw-700">${App.fmtMoney(v.list_price)||'—'}</div></div>
        ${v.mls_number?`<div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">MLS#</div><div class="fw-700">${v.mls_number}</div></div>`:''}
      </div>
      ${v.agent_notes ? `<div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:12px;font-size:13px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">📝 Notes</div>${App.esc(v.agent_notes)}</div>` : ''}
      ${feedbackSection}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
        ${!isCompleted ? `<button class="btn btn-primary" onclick="Viewings.markCompleted('${v.id}')">✅ Mark Completed</button>` : ''}
        ${v.client_feedback === 'interested' ? `<button class="btn btn-green" onclick="App.closeModal();setTimeout(()=>Offers.openAddForClient('${v.client_id}','${clientName}'),300)">📄 Prepare Offer</button>` : ''}
        <button class="btn btn-outline" onclick="App.closeModal();setTimeout(()=>Viewings._showForm('${v.client_id}','',${JSON.stringify(v).replace(/"/g,'&quot;')}),300)">✏️ Edit</button>
      </div>
    `);
  },

  async markCompleted(id) {
    await db.from('viewings').update({ viewing_status: 'Completed', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('✅ Viewing marked completed');
    await Viewings.load();
    App.closeModal();
    // Reopen detail with feedback prompt
    setTimeout(() => Viewings.openDetail(id), 400);
  },

  async recordFeedback(id, feedback) {
    await db.from('viewings').update({ client_feedback: feedback, updated_at: new Date().toISOString() }).eq('id', id);
    const v = Viewings.all.find(x => x.id === id) || {};
    const client = Clients.all.find(c => c.id === v.client_id);
    // Queue follow-up email for approval
    if (window.Notify && client?.email) {
      await Notify.onViewingFeedback({...v, client_feedback: feedback}, client, feedback);
      // If interested → also queue "Ready to make an offer?" email
      if (feedback === 'interested') {
        await Notify.onReadyToOffer({...v, client_feedback: feedback}, client);
      }
    }
    App.toast(feedback === 'interested' ? '🌟 Great! Follow-up + offer invitation queued in Approvals' : feedback === 'good' ? '✅ Follow-up email queued in Approvals' : '📬 Continue searching email queued in Approvals');
    await Viewings.load();
    App.closeModal();
    setTimeout(() => Viewings.openDetail(id), 400);
  }
};
