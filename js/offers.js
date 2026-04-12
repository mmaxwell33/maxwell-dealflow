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
    if (typeof Notify !== "undefined" && client?.email) {
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
    const statusColor = { Submitted:'var(--accent2)', Accepted:'var(--green)', Rejected:'var(--red)', Conditions:'var(--yellow)', Countered:'var(--purple)' };
    const isPending = ['Submitted','Conditions'].includes(o.status);
    App.openModal(`
      <div class="fw-800" style="font-size:16px;margin-bottom:2px;">${o.property_address}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:14px;">👤 ${o.clients?.full_name||'—'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:var(--bg);padding:10px;border-radius:8px;grid-column:1/-1;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Offer Amount</div><div class="fw-800" style="font-size:22px;color:var(--green);">${App.fmtMoney(o.offer_amount)}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Status</div><div class="fw-700" style="color:${statusColor[o.status]||'var(--text2)'};">${o.status}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">List Price</div><div class="fw-700">${App.fmtMoney(o.list_price)||'—'}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Offer Date</div><div class="fw-700">${App.fmtDate(o.offer_date)}</div></div>
      </div>
      ${o.conditions ? `<div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">📋 Conditions</div><div style="font-size:13px;">${App.esc(o.conditions)}</div></div>` : ''}
      ${o.agent_notes ? `<div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">📝 Notes</div><div style="font-size:13px;">${App.esc(o.agent_notes)}</div></div>` : ''}
      ${isPending ? `
      <div style="background:var(--bg2);border:2px solid var(--accent2);border-radius:10px;padding:14px;margin-bottom:10px;">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;">📬 Seller Response?</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">Select the seller's response to automatically notify your buyer:</div>
        <div style="display:grid;gap:8px;">
          <button class="btn btn-green" onclick="Offers.sellerAccepted('${o.id}')">✅ Seller Accepted — Offer is firm!</button>
          <button class="btn btn-outline" onclick="Offers.sellerCountered('${o.id}')" style="border-color:var(--purple);color:var(--purple);">🔄 Seller Countered — Enter counter amount</button>
          <button class="btn btn-red" onclick="Offers.sellerRejected('${o.id}')">❌ Seller Rejected — Notify buyer</button>
        </div>
      </div>` : o.status === 'Accepted' ? `<div style="background:rgba(34,197,94,.1);border:1px solid var(--green);border-radius:10px;padding:12px;margin-bottom:10px;text-align:center;"><div style="font-size:20px;">🎉</div><div class="fw-700" style="color:var(--green);">Offer Accepted — Deal in Pipeline!</div></div>` : o.status === 'Rejected' ? `<div style="background:rgba(239,68,68,.1);border:1px solid var(--red);border-radius:10px;padding:12px;margin-bottom:10px;text-align:center;"><div class="fw-700" style="color:var(--red);">❌ Offer Rejected</div></div>` : ''}
      <button class="btn btn-outline btn-block" style="margin-top:4px;" onclick="App.closeModal()">Close</button>
    `);
  },

  async sellerAccepted(id) {
    const o = Offers.all.find(x => x.id === id);
    if (!o) return;
    const client = Clients.all.find(c => c.id === o.client_id);
    await db.from('offers').update({ status: 'Accepted', updated_at: new Date().toISOString() }).eq('id', id);
    await db.from('clients').update({ stage: 'Accepted' }).eq('id', o.client_id);
    if (typeof Notify !== "undefined" && client?.email) await Notify.onOfferAccepted(o, client);
    await Pipeline.createFromOffer(o, client);
    App.closeModal();
    App.toast('🎉 Accepted! Buyer notified (check Approvals) + Pipeline created!');
    Offers.load(); Clients.load(); Pipeline.load(); App.loadOverview();
  },

  sellerCountered(id) {
    const o = Offers.all.find(x => x.id === id);
    if (!o) return;
    App.openModal(`
      <div class="modal-title">🔄 Seller Countered</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">Your offer: <strong>${App.fmtMoney(o.offer_amount)}</strong> on ${o.property_address}</div>
      <div class="form-group">
        <label class="form-label">Seller's Counter Amount ($) *</label>
        <input class="form-input" id="counter-amount" type="number" placeholder="e.g. 385000">
      </div>
      <div class="form-group">
        <label class="form-label">Message to buyer (optional)</label>
        <textarea class="form-input" id="counter-msg" rows="3" placeholder="e.g. Seller is firm on closing date of May 15..."></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-primary" onclick="Offers.confirmCounter('${id}')">📬 Queue Notification</button>
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
      </div>
    `);
  },

  async confirmCounter(id) {
    const o = Offers.all.find(x => x.id === id);
    const counterAmount = document.getElementById('counter-amount')?.value;
    const msg = document.getElementById('counter-msg')?.value?.trim();
    if (!counterAmount) { App.toast('⚠️ Enter counter amount', 'var(--red)'); return; }
    const client = Clients.all.find(c => c.id === o.client_id);
    await db.from('offers').update({ status: 'Countered', agent_notes: (o.agent_notes||'') + `\nCounter: ${App.fmtMoney(counterAmount)}`, updated_at: new Date().toISOString() }).eq('id', id);
    if (typeof Notify !== "undefined" && client?.email) await Notify.onOfferCountered(o, client, counterAmount, msg);
    App.closeModal();
    App.toast('📬 Counter offer notification queued in Approvals!');
    Offers.load();
  },

  async sellerRejected(id) {
    const o = Offers.all.find(x => x.id === id);
    if (!o) return;
    App.openModal(`
      <div class="modal-title">❌ Seller Rejected Offer</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">${o.property_address} — ${App.fmtMoney(o.offer_amount)}</div>
      <div class="form-group">
        <label class="form-label">Message to buyer (optional)</label>
        <textarea class="form-input" id="reject-msg" rows="3" placeholder="e.g. Seller accepted another offer..."></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-red" onclick="Offers.confirmRejection('${id}')">📬 Queue Notification</button>
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
      </div>
    `);
  },

  async confirmRejection(id) {
    const o = Offers.all.find(x => x.id === id);
    const msg = document.getElementById('reject-msg')?.value?.trim();
    const client = Clients.all.find(c => c.id === o.client_id);
    await db.from('offers').update({ status: 'Rejected', updated_at: new Date().toISOString() }).eq('id', id);
    await db.from('clients').update({ stage: 'Searching' }).eq('id', o.client_id);
    if (typeof Notify !== "undefined" && client?.email) await Notify.onOfferRejected(o, client, msg);
    App.closeModal();
    App.toast('📬 Rejection notification queued. Client stage reset to Searching.');
    Offers.load(); Clients.load();
  },

  async updateStatus(id, status) {
    const o = Offers.all.find(x => x.id === id);
    await db.from('offers').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (status === 'Accepted' && o) {
      const client = Clients.all.find(c => c.id === o.client_id);
      await db.from('clients').update({ stage: 'Accepted' }).eq('id', o.client_id);
      // Queue accepted notification for approval
      if (typeof Notify !== "undefined" && client?.email) await Notify.onOfferAccepted(o, client);
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
    const today = new Date().toISOString().slice(0,10);
    const acceptDate = offer.offer_date || today;

    // Insert pipeline record and get its ID back
    const { data: pipelineRow, error } = await db.from('pipeline').insert({
      agent_id: currentAgent.id,
      client_id: offer.client_id,
      offer_id: offer.id,
      client_name: client?.full_name || offer.client_name,
      client_email: client?.email || '',
      property_address: offer.property_address,
      offer_amount: offer.offer_amount,
      acceptance_date: acceptDate,
      stage: 'Accepted',
      status: 'Active'
    }).select('id').single();

    if (error) {
      // Fallback: insert without select (older Supabase RLS configs)
      await db.from('pipeline').insert({
        agent_id: currentAgent.id,
        client_id: offer.client_id,
        client_name: client?.full_name || offer.client_name,
        client_email: client?.email || '',
        property_address: offer.property_address,
        offer_amount: offer.offer_amount,
        acceptance_date: acceptDate,
        stage: 'Accepted',
        status: 'Active'
      });
    }

    const pipelineId = pipelineRow?.id || null;

    // Auto-generate 22-task closing checklist
    await Pipeline.generateChecklist(pipelineId, offer, client, acceptDate);

    await App.logActivity('PIPELINE_CREATED', client?.full_name, client?.email,
      `Deal pipeline created: ${offer.property_address}`, offer.client_id);
    Pipeline.load();
  },

  // Generate the standard 22-task closing checklist
  async generateChecklist(pipelineId, offer, client, acceptDate) {
    if (!currentAgent?.id || !pipelineId) return;

    // Calculate relative due dates from acceptance date
    const addDays = (base, n) => {
      const d = new Date(base);
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };

    const tasks = [
      // Legal
      { title: 'Retain a real estate lawyer / notary', category: 'Legal', due: addDays(acceptDate, 2) },
      { title: 'Send accepted offer documents to lawyer', category: 'Legal', due: addDays(acceptDate, 3) },
      { title: 'Confirm deposit payment to listing brokerage', category: 'Legal', due: addDays(acceptDate, 5) },
      { title: 'Review lawyer\'s title search and insurance', category: 'Legal', due: addDays(acceptDate, 10) },
      // Financing
      { title: 'Confirm client has submitted mortgage application', category: 'Financing', due: addDays(acceptDate, 3) },
      { title: 'Provide all required documents to mortgage lender', category: 'Financing', due: addDays(acceptDate, 5) },
      { title: 'Confirm mortgage approval with lender', category: 'Financing', due: addDays(acceptDate, 8) },
      { title: 'Ensure financing condition is waived or extended', category: 'Financing', due: offer.financing_date || addDays(acceptDate, 10) },
      // Inspection
      { title: 'Book home inspection appointment', category: 'Inspection', due: addDays(acceptDate, 3) },
      { title: 'Attend home inspection with client', category: 'Inspection', due: addDays(acceptDate, 7) },
      { title: 'Review inspection report and negotiate repairs if needed', category: 'Inspection', due: addDays(acceptDate, 9) },
      { title: 'Ensure inspection condition is waived or resolved', category: 'Inspection', due: offer.inspection_date || addDays(acceptDate, 10) },
      // Insurance & Utilities
      { title: 'Remind client to arrange home insurance', category: 'General', due: addDays(acceptDate, 14) },
      { title: 'Remind client to transfer utilities (hydro, water, gas, internet)', category: 'General', due: addDays(acceptDate, 21) },
      // Moving
      { title: 'Remind client to book a moving company', category: 'Moving', due: addDays(acceptDate, 14) },
      { title: 'Confirm moving date and logistics with client', category: 'Moving', due: addDays(acceptDate, 28) },
      // Walkthrough & Closing
      { title: 'Schedule final walkthrough with client', category: 'General', due: offer.walkthrough_date || addDays(acceptDate, 28) },
      { title: 'Conduct final walkthrough of the property', category: 'General', due: offer.walkthrough_date || addDays(acceptDate, 28) },
      { title: 'Confirm all conditions have been met and waived', category: 'Legal', due: addDays(acceptDate, 12) },
      { title: 'Confirm closing costs with lawyer (client must prepare bank draft)', category: 'Legal', due: offer.closing_date ? addDays(offer.closing_date, -3) : addDays(acceptDate, 25) },
      { title: 'Coordinate key handover with listing agent', category: 'General', due: offer.closing_date || addDays(acceptDate, 30) },
      { title: 'Post-closing: send congratulations and request Google review', category: 'General', due: offer.closing_date ? addDays(offer.closing_date, 3) : addDays(acceptDate, 33) },
    ];

    const rows = tasks.map(t => ({
      agent_id: currentAgent.id,
      pipeline_id: pipelineId,
      client_id: offer.client_id || null,
      client_name: client?.full_name || '',
      title: t.title,
      category: t.category,
      due_date: t.due,
      done: false
    }));

    await db.from('deal_checklist').insert(rows);
  },

  // Returns true if a date string is in the past (milestone completed)
  milestonesDone(d) {
    const today = new Date(); today.setHours(0,0,0,0);
    const isPast = (dateStr) => {
      if (!dateStr) return false;
      const dt = new Date(dateStr); dt.setHours(0,0,0,0);
      return dt <= today;
    };
    const milestones = [d.acceptance_date, d.financing_date, d.inspection_date, d.walkthrough_date, d.closing_date];
    const done = milestones.filter(isPast).length;
    return { done, total: milestones.length };
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

      // Progress bar: % based on how many milestone dates have passed
      const { done, total } = Pipeline.milestonesDone(d);
      const pct = isClosed ? 100 : isFell ? 0 : Math.round((done / total) * 100);
      const barColor = isClosed ? 'var(--green)' : isFell ? 'var(--red)' : 'var(--accent2)';

      const steps = ['Accepted','Conditions','Closing','Closed'];
      const si = steps.indexOf(d.stage);
      const badge = isClosed ? 'badge-accepted' : isFell ? 'badge-rejected' : si>=2?'badge-viewings':'badge-conditions';
      const statusLine = isClosed ? '<span style="color:var(--green);">✅ Deal Complete</span>' : isFell ? '<span style="color:var(--red);">❌ Deal Fell Through</span>' : `<span style="color:var(--text2);">📋 Stage: ${d.stage}</span>`;

      // Clean date field — live progress preview on change
      const dateField = (label, icon, inputId, dateVal) => {
        const readonly = isClosed || isFell;
        const onChange = readonly ? '' : `oninput="Pipeline.previewProgress('${d.id}')"`;
        return `<div>
          <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:3px;">${icon} ${label}</div>
          <input class="form-input" type="date" id="${inputId}" value="${dateVal||''}" style="font-size:12px;padding:5px 8px;" ${onChange} ${readonly ? 'readonly' : ''}>
        </div>`;
      };

      const updatedAt = d.updated_at ? new Date(d.updated_at) : null;
      const updatedStr = updatedAt ? updatedAt.toLocaleString() : '—';

      return `<div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div><div class="fw-800" style="font-size:15px;">${d.client_name||'—'}</div><div class="text-muted" style="font-size:12px;margin-top:2px;">📍 ${d.property_address||'—'}</div></div>
          <span class="stage-badge ${badge}">${d.stage}</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;margin-bottom:4px;">
          <div id="pl-bar-${d.id}" style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.4s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--text3);margin-bottom:8px;">
          <span id="pl-milestone-lbl-${d.id}" title="Bar auto-advances as each milestone date passes">${done} of ${total} milestones passed ⓘ</span>
          <span id="pl-pct-lbl-${d.id}">${pct}%</span>
        </div>
        <div style="font-size:12px;margin-bottom:8px;">${statusLine}</div>
        <div style="font-size:13px;margin-bottom:10px;">💰 Offer: <strong>${App.fmtMoney(d.offer_amount)}</strong>${d.deposit_paid?' · 📥 Deposit: Yes':' · 📥 Deposit: No'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          ${dateField('Acceptance','✅',`pl-acc-${d.id}`,d.acceptance_date)}
          ${dateField('Financing','🏦',`pl-fin-${d.id}`,d.financing_date)}
          ${dateField('Inspection','🔍',`pl-ins-${d.id}`,d.inspection_date)}
          ${dateField('Walkthrough','🚶',`pl-walk-${d.id}`,d.walkthrough_date)}
          ${dateField('Closing','📅',`pl-close-${d.id}`,d.closing_date)}
        </div>
        ${!isClosed && !isFell ? `<button class="btn btn-primary btn-block" style="margin-bottom:8px;" onclick="Pipeline.saveDates('${d.id}')">💾 Save Dates</button>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isClosed ? `<button class="btn btn-outline btn-sm" onclick="Pipeline.revertClose('${d.id}')">🔄 Revert Close</button>` : ''}
          ${isFell ? `<button class="btn btn-outline btn-sm" onclick="Pipeline.reactivate('${d.id}')">🔄 Reactivate</button>` : ''}
          ${!isClosed && !isFell ? `
            <button class="btn btn-green btn-sm" onclick="Pipeline.closeDeal('${d.id}')">✅ Mark Closed</button>
            <button class="btn btn-red btn-sm" onclick="Pipeline.markFellThrough('${d.id}')">❌ Fell Through</button>
            <button class="btn btn-outline btn-sm" onclick="Pipeline.openStageModal('${d.id}')">📋 Stage</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="Pipeline.openChecklist('${d.id}')">☑️ Checklist</button>
          <button class="btn btn-outline btn-sm" onclick="Pipeline.openRoom('${d.id}')">🤝 Room</button>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px;" id="pl-updated-${d.id}">🕐 Updated: ${updatedStr}</div>
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

  // Live-update progress bar as dates are typed — no DB write
  previewProgress(id) {
    const acc  = document.getElementById(`pl-acc-${id}`)?.value  || null;
    const fin  = document.getElementById(`pl-fin-${id}`)?.value  || null;
    const ins  = document.getElementById(`pl-ins-${id}`)?.value  || null;
    const walk = document.getElementById(`pl-walk-${id}`)?.value || null;
    const close= document.getElementById(`pl-close-${id}`)?.value|| null;
    const preview = { acceptance_date: acc, financing_date: fin, inspection_date: ins, walkthrough_date: walk, closing_date: close };
    const { done, total } = Pipeline.milestonesDone(preview);
    const pct = Math.round((done / total) * 100);
    const bar = document.getElementById(`pl-bar-${id}`);
    if (bar) { bar.style.width = `${pct}%`; bar.style.background = pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--accent)' : 'var(--accent2)'; }
    const lbl = document.getElementById(`pl-milestone-lbl-${id}`);
    if (lbl) lbl.textContent = `${done} of ${total} milestones passed ⓘ`;
    const pctLbl = document.getElementById(`pl-pct-lbl-${id}`);
    if (pctLbl) pctLbl.textContent = `${pct}%`;
  },

  async saveDates(id) {
    const acc  = document.getElementById(`pl-acc-${id}`)?.value  || null;
    const fin  = document.getElementById(`pl-fin-${id}`)?.value  || null;
    const ins  = document.getElementById(`pl-ins-${id}`)?.value  || null;
    const walk = document.getElementById(`pl-walk-${id}`)?.value || null;
    const close= document.getElementById(`pl-close-${id}`)?.value|| null;
    const now  = new Date().toISOString();

    // Try saving all 5 milestone dates
    let { error } = await db.from('pipeline').update({
      updated_at:       now,
      acceptance_date:  acc,
      financing_date:   fin,
      inspection_date:  ins,
      walkthrough_date: walk,
      closing_date:     close,
    }).eq('id', id);

    // If financing/inspection columns don't exist yet, fall back to the 3 known columns
    if (error) {
      const fallback = await db.from('pipeline').update({
        updated_at:      now,
        acceptance_date: acc,
        walkthrough_date:walk,
        closing_date:    close,
      }).eq('id', id);
      if (fallback.error) {
        App.toast('⚠️ Save failed — please try again');
        return;
      }
    }

    // Build the locally-updated record for the progress calculation
    const rec = Pipeline.all?.find(x => x.id === id);
    const merged = Object.assign({}, rec, {
      acceptance_date:  acc,
      financing_date:   fin,
      inspection_date:  ins,
      walkthrough_date: walk,
      closing_date:     close,
    });
    if (rec) Object.assign(rec, merged);

    // Update progress bar % in-place — no full reload needed
    const { done, total } = Pipeline.milestonesDone(merged);
    const pct = Math.round((done / total) * 100);
    const bar = document.getElementById(`pl-bar-${id}`);
    if (bar) { bar.style.width = `${pct}%`; bar.style.background = pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--accent)' : 'var(--accent2)'; }
    const lbl = document.getElementById(`pl-milestone-lbl-${id}`);
    if (lbl) lbl.textContent = `${done} of ${total} milestones passed ⓘ`;
    const pctLbl = document.getElementById(`pl-pct-lbl-${id}`);
    if (pctLbl) pctLbl.textContent = `${pct}%`;
    const updEl = document.getElementById(`pl-updated-${id}`);
    if (updEl) updEl.textContent = `🕐 Updated: ${new Date(now).toLocaleString()}`;

    App.toast('💾 Dates saved!');
  },

  async closeDeal(id) {
    const close = document.getElementById(`pl-close-${id}`)?.value || new Date().toISOString().slice(0,10);
    await db.from('pipeline').update({ stage: 'Closed', closing_date: close, updated_at: new Date().toISOString() }).eq('id', id);
    const d = Pipeline.all.find(x => x.id === id);
    // Update client stage to Closed
    if (d?.client_id) {
      await db.from('clients').update({ stage: 'Closed', updated_at: new Date().toISOString() }).eq('id', d.client_id);
    }
    await App.logActivity('DEAL_CLOSED', d?.client_name, d?.client_email, `Deal closed: ${d?.property_address}`, d?.client_id);
    // Queue closing congratulations email for approval
    if (typeof Notify !== "undefined" && d?.client_email) {
      const client = { id: d.client_id, full_name: d.client_name, email: d.client_email };
      await Notify.onDealClosed(d, client);
    }
    App.toast('✅ Deal marked Closed! 🎉 Congrats email queued in Approvals.');
    Pipeline.load(); Clients.load(); App.loadOverview();
  },

  async markFellThrough(id) {
    const d = Pipeline.all.find(x => x.id === id);
    await db.from('pipeline').update({ stage: 'Fell Through', updated_at: new Date().toISOString() }).eq('id', id);
    // Reset client stage back to Searching so they stay active in the pipeline
    if (d?.client_id) {
      await db.from('clients').update({ stage: 'Searching', updated_at: new Date().toISOString() }).eq('id', d.client_id);
    }
    // Queue encouraging email to client
    if (typeof Notify !== "undefined" && d?.client_email) {
      const client = { id: d.client_id, full_name: d.client_name, email: d.client_email };
      await Notify.onDealFellThrough(d, client, null);
    }
    await App.logActivity('DEAL_FELL_THROUGH', d?.client_name, d?.client_email,
      `Deal fell through: ${d?.property_address}`, d?.client_id);
    App.toast('❌ Deal fell through — client notified (check Approvals)');
    Pipeline.load(); Clients.load(); App.loadOverview();
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
    // Keep client stage in sync with pipeline stage
    const clientStageMap = { Accepted: 'Accepted', Conditions: 'Conditions', Closing: 'Closing', Closed: 'Closing' };
    const clientStage = clientStageMap[stage];
    if (d?.client_id && clientStage) {
      await db.from('clients').update({ stage: clientStage, updated_at: new Date().toISOString() }).eq('id', d.client_id);
    }
    await App.logActivity('PIPELINE_UPDATED', d?.client_name, d?.client_email, `Stage → ${stage}`, d?.client_id);
    App.closeModal(); App.toast('✅ Stage updated!');
    Pipeline.load(); Clients.load(); App.loadOverview();
  },

  async openChecklist(pipelineId) {
    const d = Pipeline.all.find(x => x.id === pipelineId);
    if (!d) return;

    // Load tasks for this deal
    const { data: tasks } = await db.from('deal_checklist')
      .select('*')
      .eq('pipeline_id', pipelineId)
      .order('due_date', { ascending: true });

    if (!tasks?.length) {
      App.openModal(`
        <div class="modal-title">☑️ Closing Checklist — ${d.client_name}</div>
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-text">No checklist items yet</div>
          <div class="empty-sub">The checklist is auto-generated when an offer is accepted. This deal may have been created before this feature was added.</div>
        </div>
        <button class="btn btn-primary btn-block" onclick="Pipeline.regenerateChecklist('${pipelineId}')">🔄 Generate Checklist Now</button>
      `);
      return;
    }

    const today = new Date(); today.setHours(0,0,0,0);
    const doneCount = tasks.filter(t => t.done).length;
    const pct = Math.round((doneCount / tasks.length) * 100);

    // Group by category
    const categories = [...new Set(tasks.map(t => t.category))];
    const categoryIcons = { Legal: '⚖️', Financing: '🏦', Inspection: '🔍', Moving: '📦', General: '📋' };

    const taskRows = categories.map(cat => {
      const catTasks = tasks.filter(t => t.category === cat);
      return `
        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${categoryIcons[cat]||'📋'} ${cat}</div>
          ${catTasks.map(t => {
            const due = t.due_date ? new Date(t.due_date) : null;
            const isOverdue = due && !t.done && due < today;
            const dueTxt = due ? App.fmtDate(t.due_date) : '';
            return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border-radius:6px;margin-bottom:3px;${t.done?'opacity:0.55;':''}${isOverdue?'border-left:2px solid var(--red);':''}">
              <input type="checkbox" ${t.done?'checked':''} onchange="Pipeline.toggleChecklistItem('${t.id}','${pipelineId}',this.checked)" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
              <div style="flex:1;">
                <div style="font-size:13px;${t.done?'text-decoration:line-through;color:var(--text3);':''}">${App.esc(t.title)}</div>
                ${dueTxt ? `<div style="font-size:11px;color:${isOverdue?'var(--red)':'var(--text2)'};">${isOverdue?'⚠️ Overdue — ':'Due '}${dueTxt}</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>`;
    }).join('');

    App.openModal(`
      <div class="modal-title">☑️ Closing Checklist</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:10px;">📍 ${App.esc(d.property_address)} · ${App.esc(d.client_name)}</div>
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px;">
          <span>${doneCount} of ${tasks.length} tasks done</span>
          <span class="fw-700" style="color:var(--green);">${pct}%</span>
        </div>
        <div style="height:8px;background:var(--border);border-radius:4px;">
          <div style="height:100%;width:${pct}%;background:var(--green);border-radius:4px;transition:width 0.3s;"></div>
        </div>
      </div>
      <div style="max-height:55vh;overflow-y:auto;">${taskRows}</div>
      <button class="btn btn-outline btn-block" style="margin-top:12px;" onclick="App.closeModal()">Close</button>
    `);
  },

  async toggleChecklistItem(taskId, pipelineId, done) {
    const now = new Date().toISOString();
    await db.from('deal_checklist').update({
      done,
      done_at: done ? now : null,
      updated_at: now
    }).eq('id', taskId);
    // Refresh checklist in-place (re-open)
    await Pipeline.openChecklist(pipelineId);
  },

  async regenerateChecklist(pipelineId) {
    const d = Pipeline.all.find(x => x.id === pipelineId);
    if (!d) return;
    // Build a minimal offer-like object from pipeline data
    const fakeOffer = {
      client_id: d.client_id,
      offer_amount: d.offer_amount,
      property_address: d.property_address,
      financing_date: d.financing_date || null,
      inspection_date: d.inspection_date || null,
      walkthrough_date: d.walkthrough_date || null,
      closing_date: d.closing_date || null
    };
    const client = { full_name: d.client_name, email: d.client_email };
    await Pipeline.generateChecklist(pipelineId, fakeOffer, client, d.acceptance_date || new Date().toISOString().slice(0,10));
    App.toast('✅ Checklist generated!');
    await Pipeline.openChecklist(pipelineId);
  },

  // ── TRANSACTION ROOM ──────────────────────────────────────────────────────
  _roomId: null,

  openRoom(id) {
    const d = Pipeline.all.find(x => x.id === id);
    if (!d) return;
    Pipeline._roomId = id;

    const modal = document.getElementById('room-modal');
    const title = document.getElementById('room-deal-title');
    const sub   = document.getElementById('room-deal-sub');
    if (title) title.textContent = `🤝 Transaction Room — ${d.client_name || 'Deal'}`;
    if (sub)   sub.textContent   = `${d.property_address || ''} · $${Number(d.offer_amount||0).toLocaleString('en-CA')}`;

    // Default parties if none saved yet
    const saved = JSON.parse(localStorage.getItem(`df-room-${id}`) || 'null');
    if (!saved) {
      const defaults = [
        { name: currentAgent?.full_name || 'Maxwell', role: 'Agent', email: currentAgent?.email || '', phone: '' },
        { name: d.client_name || 'Buyer', role: 'Buyer', email: d.client_email || '', phone: '' }
      ];
      localStorage.setItem(`df-room-${id}`, JSON.stringify(defaults));
    }

    Pipeline.roomTab('parties', document.querySelector('.room-tab'));
    Pipeline.renderParties();
    if (modal) modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  },

  closeRoom() {
    const modal = document.getElementById('room-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    Pipeline._roomId = null;
  },

  roomTab(name, btn) {
    document.querySelectorAll('.room-tab').forEach(b => b.classList.remove('active'));
    ['parties','timeline','docs'].forEach(p => {
      const el = document.getElementById(`room-panel-${p}`);
      if (el) el.style.display = p === name ? 'block' : 'none';
    });
    if (btn) btn.classList.add('active');
    if (name === 'parties')  Pipeline.renderParties();
    if (name === 'timeline') Pipeline.renderTimeline();
    if (name === 'docs')     Pipeline.renderDocs();
  },

  renderParties() {
    const id = Pipeline._roomId;
    const el = document.getElementById('room-parties-list');
    if (!el || !id) return;
    const parties = JSON.parse(localStorage.getItem(`df-room-${id}`) || '[]');
    const roleColors = { Agent:'var(--accent2)', Buyer:'var(--green)', 'Mortgage Broker':'var(--yellow)', 'Lawyer / Notary':'var(--purple)', 'Home Inspector':'var(--cyan)', 'Lender / Bank':'var(--orange, #f97316)', default:'var(--text2)' };
    el.innerHTML = parties.length ? parties.map((p, i) => `
      <div class="room-party-row">
        <div class="room-party-avatar" style="background:${roleColors[p.role]||roleColors.default};">${(p.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;">${App.esc(p.name)}</div>
          <div style="font-size:12px;color:var(--text2);">${App.esc(p.role)}${p.email ? ' · ' + App.esc(p.email) : ''}${p.phone ? ' · ' + App.esc(p.phone) : ''}</div>
        </div>
        ${i >= 2 ? `<button style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;padding:0 4px;" onclick="Pipeline.removeParty(${i})" title="Remove">✕</button>` : ''}
      </div>`).join('') : '<div style="color:var(--text2);font-size:13px;text-align:center;padding:16px;">No parties yet.</div>';
  },

  addParty() {
    const id = Pipeline._roomId;
    if (!id) return;
    const name  = document.getElementById('room-new-name')?.value.trim();
    const role  = document.getElementById('room-new-role')?.value;
    const email = document.getElementById('room-new-email')?.value.trim();
    const phone = document.getElementById('room-new-phone')?.value.trim();
    if (!name) { App.toast('⚠️ Enter a name'); return; }
    const parties = JSON.parse(localStorage.getItem(`df-room-${id}`) || '[]');
    parties.push({ name, role, email, phone });
    localStorage.setItem(`df-room-${id}`, JSON.stringify(parties));
    ['room-new-name','room-new-email','room-new-phone'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
    Pipeline.renderParties();
    App.toast(`✅ ${name} added to room`);
  },

  removeParty(idx) {
    const id = Pipeline._roomId;
    if (!id) return;
    const parties = JSON.parse(localStorage.getItem(`df-room-${id}`) || '[]');
    parties.splice(idx, 1);
    localStorage.setItem(`df-room-${id}`, JSON.stringify(parties));
    Pipeline.renderParties();
  },

  renderTimeline() {
    const id = Pipeline._roomId;
    const el = document.getElementById('room-timeline-list');
    if (!el || !id) return;
    const d = Pipeline.all.find(x => x.id === id);
    if (!d) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const milestones = [
      { label: 'Acceptance',   icon: '✅', date: d.acceptance_date },
      { label: 'Financing',    icon: '🏦', date: d.financing_date },
      { label: 'Inspection',   icon: '🔍', date: d.inspection_date },
      { label: 'Walkthrough',  icon: '🚶', date: d.walkthrough_date },
      { label: 'Closing',      icon: '🏠', date: d.closing_date }
    ];
    el.innerHTML = milestones.map(m => {
      const dt = m.date ? new Date(m.date + 'T00:00:00') : null;
      const past   = dt && dt <= today;
      const today_ = dt && dt.getTime() === today.getTime();
      const color  = !dt ? 'var(--text3)' : past ? 'var(--green)' : today_ ? 'var(--yellow)' : 'var(--accent2)';
      const status = !dt ? 'No date set' : past ? 'Completed' : today_ ? 'Today!' : `${App.fmtDate(m.date)} (upcoming)`;
      return `<div class="room-timeline-item">
        <div class="room-tl-dot" style="background:${color};"></div>
        <div>
          <div style="font-weight:700;font-size:13px;">${m.icon} ${m.label}</div>
          <div style="font-size:12px;color:${color};">${status}</div>
        </div>
      </div>`;
    }).join('');
  },

  renderDocs() {
    const id = Pipeline._roomId;
    const el = document.getElementById('room-docs-list');
    if (!el || !id) return;
    const defaultDocs = [
      'Accepted Offer Agreement', 'Home Inspection Report',
      'Mortgage Approval Letter', 'Title Search / Certificate',
      'Home Insurance Proof', 'Final Walkthrough Notes',
      'Deposit Receipt', 'Closing Statement / Adjustment'
    ];
    const checked = JSON.parse(localStorage.getItem(`df-room-docs-${id}`) || '[]');
    el.innerHTML = defaultDocs.map((doc, i) => {
      const isChecked = checked.includes(i);
      return `<div class="room-doc-item ${isChecked ? 'checked' : ''}" onclick="Pipeline.toggleDoc(${i})">
        <span style="font-size:18px;">${isChecked ? '✅' : '⬜'}</span>
        <span style="font-size:13px;font-weight:${isChecked?'600':'400'};color:${isChecked?'var(--green)':'var(--text)'};">${App.esc(doc)}</span>
      </div>`;
    }).join('');
  },

  toggleDoc(idx) {
    const id = Pipeline._roomId;
    if (!id) return;
    const checked = JSON.parse(localStorage.getItem(`df-room-docs-${id}`) || '[]');
    const pos = checked.indexOf(idx);
    if (pos === -1) checked.push(idx); else checked.splice(pos, 1);
    localStorage.setItem(`df-room-docs-${id}`, JSON.stringify(checked));
    Pipeline.renderDocs();
  }
};
