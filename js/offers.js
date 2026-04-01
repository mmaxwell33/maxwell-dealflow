// Maxwell DealFlow CRM — Offers & Pipeline Module
const Offers = {
  all: [],

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('offers')
      .select('*, clients(full_name,email)')
      .eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    Offers.all = data || [];
    Offers.render(Offers.all);
  },

  filter(f, btn) {
    document.querySelectorAll('#screen-offers .btn').forEach(b => {
      b.className = b === btn ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
    });
    const filtered = Offers.all.filter(o => {
      if (f === 'all') return true;
      if (f === 'submitted') return o.status === 'Submitted';
      if (f === 'accepted') return o.status === 'Accepted';
      if (f === 'pipeline') return ['Accepted','Conditions','Closing'].includes(o.status);
      return true;
    });
    Offers.render(filtered);
  },

  render(list) {
    const el = document.getElementById('offers-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-text">No offers yet</div><div class="empty-sub">Tap + Offer to track an offer</div></div>`;
      return;
    }
    const statusColor = {
      Submitted:'var(--accent2)', Accepted:'var(--green)',
      Rejected:'var(--red)', Conditions:'var(--yellow)', Closing:'var(--purple)'
    };
    el.innerHTML = list.map(o => `
      <div class="card" onclick="Offers.openDetail('${o.id}')" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div class="fw-700" style="font-size:14px;flex:1;margin-right:8px;">${o.property_address || '—'}</div>
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;background:var(--bg2);color:${statusColor[o.status]||'var(--text2)'};">${o.status}</span>
        </div>
        <div class="text-muted" style="font-size:12px;margin-bottom:6px;">👤 ${o.clients?.full_name||'—'}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
          <span class="text-accent fw-700">${App.fmtMoney(o.offer_amount)}</span>
          <span class="text-muted">${App.fmtDate(o.offer_date)}</span>
        </div>
      </div>`).join('');
  },

  openAdd() {
    Offers._showForm(null, null);
  },

  openAddForClient(clientId, clientName) {
    App.closeModal();
    setTimeout(() => Offers._showForm(clientId, clientName), 300);
  },

  _showForm(clientId, clientName) {
    const today = new Date().toISOString().slice(0,10);
    const clientOptions = Clients.all.map(c =>
      `<option value="${c.id}" ${c.id===clientId?'selected':''}>${c.full_name}</option>`
    ).join('');
    App.openModal(`
      <div class="modal-title">📄 Submit Offer</div>
      <div class="form-group">
        <label class="form-label">Client *</label>
        <select class="form-input form-select" id="of-client">
          <option value="">-- Select Client --</option>
          ${clientOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Property Address *</label>
        <input class="form-input" id="of-address" placeholder="123 Main St, St. John's NL">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">List Price ($)</label>
          <input class="form-input" id="of-listprice" type="number" placeholder="399000">
        </div>
        <div class="form-group">
          <label class="form-label">Offer Amount ($) *</label>
          <input class="form-input" id="of-amount" type="number" placeholder="390000">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Offer Date</label>
          <input class="form-input" id="of-date" type="date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input form-select" id="of-status">
            <option value="Submitted">Submitted</option>
            <option value="Accepted">Accepted ✅</option>
            <option value="Rejected">Rejected ❌</option>
            <option value="Conditions">Conditions</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Conditions (if any)</label>
        <textarea class="form-input" id="of-conditions" rows="2" placeholder="Financing, inspection..."></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="of-notes" rows="2" placeholder="Agent notes..."></textarea>
      </div>
      <button class="btn btn-primary btn-block" onclick="Offers.save()">📄 Submit Offer</button>
      <div id="of-status-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async save() {
    const clientId = document.getElementById('of-client').value;
    const address = document.getElementById('of-address').value.trim();
    const amount = document.getElementById('of-amount').value;
    if (!clientId || !address || !amount) {
      document.getElementById('of-status-msg').textContent = '⚠️ Client, address and amount required';
      return;
    }
    const client = Clients.all.find(c => c.id === clientId);
    const status = document.getElementById('of-status').value;
    const statusEl = document.getElementById('of-status-msg');
    statusEl.textContent = 'Submitting...';

    const offerId = 'OFFER-' + Date.now();
    const { data, error } = await db.from('offers').insert({
      offer_id: offerId,
      agent_id: currentAgent.id,
      client_id: clientId,
      property_address: address,
      list_price: document.getElementById('of-listprice').value || null,
      offer_amount: amount,
      offer_date: document.getElementById('of-date').value,
      status: status,
      conditions: document.getElementById('of-conditions').value.trim(),
      agent_notes: document.getElementById('of-notes').value.trim()
    }).select().single();

    if (error) { statusEl.style.color='var(--red)'; statusEl.textContent = error.message; return; }

    await App.logActivity('OFFER_SUBMITTED', client?.full_name, client?.email,
      `Offer submitted: ${App.fmtMoney(amount)} on ${address}`, clientId);

    // Update client stage
    if (client) {
      const stageMap = { Submitted:'Offers', Accepted:'Accepted', Conditions:'Conditions' };
      const newStage = stageMap[status];
      if (newStage) {
        await db.from('clients').update({ stage: newStage }).eq('id', clientId);
        Clients.load();
      }
    }

    // If accepted, create pipeline entry automatically
    if (status === 'Accepted') {
      await Pipeline.createFromOffer(data, client);
    }

    App.closeModal();
    App.toast(status === 'Accepted' ? '🎉 Offer accepted — Pipeline created!' : '✅ Offer submitted!');
    Offers.load(); App.loadOverview();
  },

  async openDetail(id) {
    const o = Offers.all.find(x => x.id === id);
    if (!o) return;
    const statusColor = { Submitted:'var(--accent2)', Accepted:'var(--green)', Rejected:'var(--red)', Conditions:'var(--yellow)' };
    App.openModal(`
      <div class="fw-800" style="font-size:16px;margin-bottom:4px;">${o.property_address}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:16px;">👤 ${o.clients?.full_name||'—'}</div>
      <div class="card-sm" style="margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Offer Amount</div><div class="fw-800 text-green" style="font-size:18px;">${App.fmtMoney(o.offer_amount)}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Status</div><div class="fw-800" style="font-size:15px;color:${statusColor[o.status]||'var(--text2)'};">${o.status}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">List Price</div><div class="fw-700">${App.fmtMoney(o.list_price)}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Date</div><div class="fw-700">${App.fmtDate(o.offer_date)}</div></div>
        </div>
      </div>
      ${o.conditions ? `<div class="card" style="margin-bottom:12px;"><div class="text-muted" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">Conditions</div><div style="font-size:13px;">${o.conditions}</div></div>` : ''}
      ${o.agent_notes ? `<div class="card" style="margin-bottom:12px;"><div class="text-muted" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">Notes</div><div style="font-size:13px;">${o.agent_notes}</div></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-green" onclick="Offers.updateStatus('${o.id}','Accepted')">✅ Mark Accepted</button>
        <button class="btn btn-red" onclick="Offers.updateStatus('${o.id}','Rejected')">❌ Mark Rejected</button>
      </div>
    `);
  },

  async updateStatus(id, status) {
    const o = Offers.all.find(x => x.id === id);
    await db.from('offers').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (status === 'Accepted' && o) {
      const client = Clients.all.find(c => c.id === o.client_id);
      await db.from('clients').update({ stage: 'Accepted' }).eq('id', o.client_id);
      await Pipeline.createFromOffer(o, client);
      App.toast('🎉 Accepted! Pipeline entry created.');
    } else {
      App.toast(`Offer marked ${status}`);
    }
    App.closeModal();
    Offers.load(); Clients.load(); Pipeline.load(); App.loadOverview();
  }
};

// ── PIPELINE ──
const Pipeline = {
  all: [],

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('pipeline')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    Pipeline.all = data || [];
    Pipeline.render(Pipeline.all);
  },

  async createFromOffer(offer, client) {
    const pipelineId = 'DEAL-' + Date.now();
    await db.from('pipeline').insert({
      pipeline_id: pipelineId,
      agent_id: currentAgent.id,
      client_id: offer.client_id,
      offer_id: offer.id,
      client_name: client?.full_name || offer.client_name,
      client_email: client?.email || '',
      property_address: offer.property_address,
      offer_amount: offer.offer_amount,
      acceptance_date: offer.offer_date || new Date().toISOString().slice(0,10),
      stage: 'Accepted',
      status: 'Active'
    });
    await App.logActivity('PIPELINE_CREATED', client?.full_name, client?.email,
      `Deal pipeline created: ${offer.property_address}`, offer.client_id);
    Pipeline.load();
  },

  render(list) {
    const el = document.getElementById('pipeline-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🚀</div><div class="empty-text">No active deals</div><div class="empty-sub">Accepted offers will appear here</div></div>`;
      return;
    }
    const stages = ['Accepted','Conditions','Closing','Closed'];
    const stageColor = { Accepted:'var(--accent2)', Conditions:'var(--yellow)', Closing:'var(--purple)', Closed:'var(--green)' };
    el.innerHTML = list.map(d => {
      const si = stages.indexOf(d.stage);
      return `
        <div class="card" onclick="Pipeline.openDetail('${d.id}')" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
            <div>
              <div class="fw-800" style="font-size:15px;">${d.client_name||'—'}</div>
              <div class="text-muted" style="font-size:12px;margin-top:2px;">${d.property_address||'—'}</div>
            </div>
            <span style="font-size:11px;font-weight:700;color:${stageColor[d.stage]||'var(--text2)'};">${d.stage}</span>
          </div>
          <div class="pipeline-bar">
            ${stages.map((s,i) => `<div class="pipeline-step ${i<si?'done':i===si?'active':''}"></div>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:6px;">
            <span class="text-accent fw-700">${App.fmtMoney(d.offer_amount)}</span>
            <span class="text-muted">${d.closing_date ? '🏠 Closes ' + App.fmtDate(d.closing_date) : 'No close date'}</span>
          </div>
        </div>`;
    }).join('');
  },

  async openDetail(id) {
    const d = Pipeline.all.find(x => x.id === id);
    if (!d) return;
    const stages = ['Accepted','Conditions','Closing','Closed'];
    App.openModal(`
      <div class="fw-800" style="font-size:17px;margin-bottom:2px;">${d.client_name}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:14px;">${d.property_address}</div>
      <div class="pipeline-bar" style="height:10px;margin-bottom:8px;">
        ${stages.map((s,i) => `<div class="pipeline-step ${stages.indexOf(d.stage)>i?'done':d.stage===s?'active':''}"></div>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:16px;">
        ${stages.map(s => `<span style="font-size:10px;color:${d.stage===s?'var(--accent2)':'var(--text3)'};">${s}</span>`).join('')}
      </div>
      <div class="card-sm" style="margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Offer Price</div><div class="fw-800 text-green">${App.fmtMoney(d.offer_amount)}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Stage</div><div class="fw-700">${d.stage}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Accepted</div><div class="fw-700">${App.fmtDate(d.acceptance_date)}</div></div>
          <div><div class="text-muted" style="font-size:10px;text-transform:uppercase;">Closing</div><div class="fw-700">${App.fmtDate(d.closing_date)}</div></div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Advance Stage To</label>
        <select class="form-input form-select" id="ps-stage">
          <option value="">-- Select --</option>
          ${stages.map(s => `<option value="${s}" ${d.stage===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Closing Date</label>
        <input class="form-input" id="ps-close" type="date" value="${d.closing_date||''}">
      </div>
      <button class="btn btn-primary btn-block" onclick="Pipeline.updateDeal('${d.id}')">💾 Update Deal</button>
    `);
  },

  async updateDeal(id) {
    const stage = document.getElementById('ps-stage').value;
    const closeDate = document.getElementById('ps-close').value;
    const updates = { updated_at: new Date().toISOString() };
    if (stage) updates.stage = stage;
    if (closeDate) updates.closing_date = closeDate;
    await db.from('pipeline').update(updates).eq('id', id);
    const d = Pipeline.all.find(x => x.id === id);
    await App.logActivity('PIPELINE_UPDATED', d?.client_name, d?.client_email,
      `Deal stage updated to: ${stage || d?.stage}`, d?.client_id);
    App.closeModal();
    App.toast('✅ Deal updated!');
    Pipeline.load(); App.loadOverview();
  }
};
