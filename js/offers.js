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

    // Queue notification emails for approval
    if (window.Notify && client?.email) {
      await Notify.onOfferSubmitted(data, client);
      if (status === 'Accepted') await Notify.onOfferAccepted(data, client);
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
      // Queue accepted notification for approval
      if (window.Notify && client?.email) await Notify.onOfferAccepted(o, client);
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
    const active = list.filter(d => !['Closed','Fell Through'].includes(d.stage));
    const closed = list.filter(d => d.stage === 'Closed');
    const fell = list.filter(d => d.stage === 'Fell Through');

    const card = (d) => {
      const isClosed = d.stage === 'Closed';
      const isFell = d.stage === 'Fell Through';
      const steps = ['Accepted','Conditions','Closing','Closed'];
      const si = steps.indexOf(d.stage);
      const pct = isClosed ? 100 : isFell ? 0 : Math.max(10, Math.round((Math.max(0,si) / (steps.length-1)) * 100));
      const barColor = isClosed ? 'var(--green)' : isFell ? 'var(--red)' : 'var(--accent2)';
      const badge = isClosed ? 'badge-accepted' : isFell ? 'badge-rejected' : si>=2?'badge-viewings':'badge-conditions';
      const statusLine = isClosed ? '<span style="color:var(--green);">✅ Deal Complete</span>' : isFell ? '<span style="color:var(--red);">❌ Deal Fell Through</span>' : `<span style="color:var(--text2);">📋 Stage: ${d.stage}</span>`;
      return `<div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div><div class="fw-800" style="font-size:15px;">${d.client_name||'—'}</div><div class="text-muted" style="font-size:12px;margin-top:2px;">📍 ${d.property_address||'—'}</div></div>
          <span class="stage-badge ${badge}">${d.stage}</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;margin-bottom:8px;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;"></div>
        </div>
        <div style="font-size:12px;margin-bottom:8px;">${statusLine}</div>
        <div style="font-size:13px;margin-bottom:10px;">💰 Offer: <strong>${App.fmtMoney(d.offer_amount)}</strong>${d.deposit_paid?' · 📥 Deposit: Yes':' · 📥 Deposit: No'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <div><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:3px;">✅ Acceptance</div><input class="form-input" type="date" id="pl-acc-${d.id}" value="${d.acceptance_date||''}" style="font-size:12px;padding:5px 8px;"></div>
          <div><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:3px;">🏦 Financing</div><input class="form-input" type="date" id="pl-fin-${d.id}" value="${d.financing_date||''}" style="font-size:12px;padding:5px 8px;"></div>
          <div><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:3px;">🔍 Inspection</div><input class="form-input" type="date" id="pl-ins-${d.id}" value="${d.inspection_date||''}" style="font-size:12px;padding:5px 8px;"></div>
          <div><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:3px;">🚶 Walkthrough</div><input class="form-input" type="date" id="pl-walk-${d.id}" value="${d.walkthrough_date||''}" style="font-size:12px;padding:5px 8px;"></div>
          <div><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:3px;">📅 Closing</div><input class="form-input" type="date" id="pl-close-${d.id}" value="${d.closing_date||''}" style="font-size:12px;padding:5px 8px;"></div>
        </div>
        <button class="btn btn-primary btn-block" style="margin-bottom:8px;" onclick="Pipeline.saveDates('${d.id}')">💾 Save Dates</button>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isClosed ? `<button class="btn btn-outline btn-sm" onclick="Pipeline.revertClose('${d.id}')">🔄 Revert Close</button>` : ''}
          ${isFell ? `<button class="btn btn-outline btn-sm" onclick="Pipeline.reactivate('${d.id}')">🔄 Reactivate</button>` : ''}
          ${!isClosed && !isFell ? `
            <button class="btn btn-green btn-sm" onclick="Pipeline.closeDeal('${d.id}')">✅ Mark Closed</button>
            <button class="btn btn-red btn-sm" onclick="Pipeline.markFellThrough('${d.id}')">❌ Fell Through</button>
            <button class="btn btn-outline btn-sm" onclick="Pipeline.openStageModal('${d.id}')">📋 Stage</button>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px;">Updated: ${d.updated_at ? new Date(d.updated_at).toLocaleString() : '—'}</div>
      </div>`;
    };

    let html = active.map(d => card(d)).join('');

    if (closed.length) {
      html += `<div style="margin:16px 0 8px;display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="Pipeline.toggleSection(this)">
        <span style="color:var(--green);font-size:16px;">🟢</span>
        <span class="fw-800" style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Closed Deals (${closed.length})</span>
        <span style="margin-left:auto;color:var(--text3);">▲</span>
      </div><div>${closed.map(d => card(d)).join('')}</div>`;
    }
    if (fell.length) {
      html += `<div style="margin:16px 0 8px;display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="Pipeline.toggleSection(this)">
        <span style="color:var(--red);font-size:16px;">🔴</span>
        <span class="fw-800" style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Fell Through (${fell.length})</span>
        <span style="margin-left:auto;color:var(--text3);">▲</span>
      </div><div>${fell.map(d => card(d)).join('')}</div>`;
    }

    el.innerHTML = html || `<div class="empty-state"><div class="empty-icon">🚀</div><div class="empty-text">No active deals</div></div>`;
  },

  toggleSection(hdr) {
    const section = hdr.nextElementSibling;
    if (section) section.style.display = section.style.display === 'none' ? 'block' : 'none';
  },

  async saveDates(id) {
    const acc = document.getElementById(`pl-acc-${id}`)?.value;
    const fin = document.getElementById(`pl-fin-${id}`)?.value;
    const ins = document.getElementById(`pl-ins-${id}`)?.value;
    const walk = document.getElementById(`pl-walk-${id}`)?.value;
    const close = document.getElementById(`pl-close-${id}`)?.value;
    const updates = { updated_at: new Date().toISOString() };
    if (acc) updates.acceptance_date = acc;
    if (close) updates.closing_date = close;
    if (fin) updates.financing_date = fin;
    if (ins) updates.inspection_date = ins;
    if (walk) updates.walkthrough_date = walk;
    const { error } = await db.from('pipeline').update(updates).eq('id', id);
    if (error) {
      // Fallback: save only known columns
      await db.from('pipeline').update({ updated_at: updates.updated_at, acceptance_date: acc||undefined, closing_date: close||undefined }).eq('id', id);
    }
    App.toast('💾 Dates saved!');
    Pipeline.load();
  },

  async closeDeal(id) {
    const close = document.getElementById(`pl-close-${id}`)?.value || new Date().toISOString().slice(0,10);
    await db.from('pipeline').update({ stage: 'Closed', closing_date: close, updated_at: new Date().toISOString() }).eq('id', id);
    const d = Pipeline.all.find(x => x.id === id);
    await App.logActivity('DEAL_CLOSED', d?.client_name, d?.client_email, `Deal closed: ${d?.property_address}`, d?.client_id);
    // Queue congratulations email for approval
    if (window.Notify && d?.client_email) await Notify.onDealClosed(d, null);
    App.toast('✅ Deal marked Closed! 🎉');
    Pipeline.load(); App.loadOverview();
  },

  async markFellThrough(id) {
    await db.from('pipeline').update({ stage: 'Fell Through', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('❌ Deal marked Fell Through');
    Pipeline.load();
  },

  async reactivate(id) {
    await db.from('pipeline').update({ stage: 'Accepted', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('🔄 Deal reactivated!');
    Pipeline.load();
  },

  async revertClose(id) {
    await db.from('pipeline').update({ stage: 'Closing', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('🔄 Deal reverted to Closing');
    Pipeline.load();
  },

  openStageModal(id) {
    const d = Pipeline.all.find(x => x.id === id);
    if (!d) return;
    const stages = ['Accepted','Conditions','Closing'];
    App.openModal(`
      <div class="modal-title">📋 Update Stage</div>
      <div class="fw-700" style="margin-bottom:12px;">${d.client_name} — ${d.property_address}</div>
      <div class="form-group">
        <label class="form-label">Current Stage</label>
        <select class="form-input form-select" id="ps-stage">
          ${stages.map(s => `<option value="${s}" ${d.stage===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary btn-block" onclick="Pipeline.updateStage('${d.id}')">💾 Update Stage</button>
    `);
  },

  async updateStage(id) {
    const stage = document.getElementById('ps-stage').value;
    await db.from('pipeline').update({ stage, updated_at: new Date().toISOString() }).eq('id', id);
    const d = Pipeline.all.find(x => x.id === id);
    await App.logActivity('PIPELINE_UPDATED', d?.client_name, d?.client_email, `Stage → ${stage}`, d?.client_id);
    App.closeModal(); App.toast('✅ Stage updated!');
    Pipeline.load(); App.loadOverview();
  }
};
