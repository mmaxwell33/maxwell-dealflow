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
        <select class="form-input form-select" id="vf-status">
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
      <div id="vf-status" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async save(existingId = null) {
    const clientId = document.getElementById('vf-client').value;
    const address = document.getElementById('vf-address').value.trim();
    if (!clientId || !address) {
      document.getElementById('vf-status').textContent = '⚠️ Client and address required';
      return;
    }
    const client = Clients.all.find(c => c.id === clientId);
    const statusEl = document.getElementById('vf-status');
    statusEl.textContent = 'Saving...';
    const payload = {
      client_id: clientId,
      property_address: address,
      mls_number: document.getElementById('vf-mls').value.trim(),
      list_price: document.getElementById('vf-price').value || null,
      viewing_date: document.getElementById('vf-date').value,
      viewing_time: document.getElementById('vf-time').value || null,
      viewing_status: document.getElementById('vf-status-field')?.value || document.getElementById('vf-status').textContent !== 'Saving...' ? document.querySelector('#vf-status ~ select, select#vf-status')?.value || 'Scheduled' : 'Scheduled',
      agent_notes: document.getElementById('vf-notes').value.trim(),
      client_feedback: document.getElementById('vf-feedback').value || null,
      updated_at: new Date().toISOString()
    };
    // Fix: grab viewing_status from the select directly
    const statusSel = document.querySelector('select#vf-status') || document.querySelectorAll('select.form-input')[2];
    if (statusSel) payload.viewing_status = statusSel.value;

    let error;
    if (existingId) {
      ({ error } = await db.from('viewings').update(payload).eq('id', existingId));
    } else {
      ({ error } = await db.from('viewings').insert(payload));
      if (!error) {
        await App.logActivity('VIEWING_SCHEDULED', client?.full_name, client?.email,
          `Viewing scheduled: ${address}`, clientId);
        // Update client stage to Viewings if still Searching
        if (client?.stage === 'Searching') {
          await db.from('clients').update({ stage: 'Viewings' }).eq('id', clientId);
          Clients.load();
        }
      }
    }
    if (error) { statusEl.style.color='var(--red)'; statusEl.textContent = error.message; return; }
    App.closeModal();
    App.toast(existingId ? '✅ Viewing updated!' : '✅ Viewing booked!');
    Viewings.load(); App.loadOverview();
  },

  async openDetail(id) {
    const v = Viewings.all.find(x => x.id === id);
    if (!v) return;
    const client = Clients.all.find(c => c.id === v.client_id);
    App.openModal(`
      <div class="fw-800" style="font-size:16px;margin-bottom:4px;">${v.property_address}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:16px;">👤 ${v.clients?.full_name || client?.full_name || '—'}</div>
      <div class="card-sm" style="margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Date</div><div class="fw-700">${App.fmtDate(v.viewing_date)}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Time</div><div class="fw-700">${v.viewing_time?.slice(0,5)||'—'}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Status</div><div class="fw-700">${v.viewing_status||'—'}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">List Price</div><div class="fw-700">${App.fmtMoney(v.list_price)}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">MLS</div><div class="fw-700">${v.mls_number||'—'}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Feedback</div><div class="fw-700">${v.client_feedback||'—'}</div></div>
        </div>
      </div>
      ${v.agent_notes ? `<div class="card" style="margin-bottom:12px;"><div class="text-muted" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">Notes</div><div style="font-size:13px;">${v.agent_notes}</div></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-green" onclick="Offers.openAddForClient('${v.client_id}','${v.clients?.full_name||''}')">📄 Submit Offer</button>
        <button class="btn btn-outline" onclick="Viewings._showForm('${v.client_id}','',${JSON.stringify(v).replace(/"/g,'&quot;')})">✏️ Edit</button>
      </div>
    `);
  }
};
