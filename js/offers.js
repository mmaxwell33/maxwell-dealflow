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
    if (typeof PendingRequests !== 'undefined') PendingRequests.loadBadge();
  },

  filter(f, btn) {
    document.querySelectorAll('#screen-offers .btn').forEach(b => {
      b.className = b === btn ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
    });
    const offersList   = document.getElementById('offers-list');
    const requestsList = document.getElementById('requests-list');
    if (f === 'requests') {
      if (offersList)   offersList.style.display   = 'none';
      if (requestsList) requestsList.style.display = 'block';
      PendingRequests.load();
      return;
    }
    if (offersList)   offersList.style.display   = 'block';
    if (requestsList) requestsList.style.display = 'none';
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
    // Phase 2.B.3: map each status to a pill2 variant
    const statusPill = {
      Submitted: 'pill2-indigo',
      Accepted:  'pill2-green',
      Rejected:  'pill2-coral',
      Conditions:'pill2-amber',
      Closing:   'pill2-indigo'
    };
    el.innerHTML = list.map(o => `
      <div class="card2" onclick="Offers.openDetail('${o.id}')" style="margin-bottom:10px;cursor:pointer;">
        <div class="card2-header" style="margin-bottom:6px;">
          <div class="card2-title" style="flex:1;margin-right:8px;">${o.property_address || '—'}</div>
          <span class="pill2 ${statusPill[o.status]||'pill2-neutral'}">${o.status}</span>
        </div>
        ${o.mls_number ? `<div style="font-size:11px;color:var(--text2);margin-bottom:4px;">MLS# ${App.esc(o.mls_number)}</div>` : ''}
        <div class="card2-sub" style="margin-bottom:8px;">👤 ${o.clients?.full_name||'—'}</div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--accent2);font-weight:700;">${App.fmtMoney(o.offer_amount)}</span>
          <span style="color:var(--text2);">${App.fmtDate(o.offer_date)}</span>
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
      <div class="modal-title">Submit Offer</div>
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
      <div class="form-group">
        <label class="form-label">MLS Number <span style="color:var(--text2);font-weight:400;">(optional)</span></label>
        <input class="form-input" id="of-mls" placeholder="1284567">
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
      <div class="form-group">
        <label class="form-label">⏰ When do you expect the seller to respond?</label>
        <input class="form-input" id="of-response-due" type="datetime-local">
        <div style="font-size:11px;color:var(--text2);margin-top:4px;">Optional — system will remind you at this time if no response is logged yet</div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Offers.save()">Submit Offer</button>
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
      mls_number: document.getElementById('of-mls')?.value.trim() || null,
      list_price: document.getElementById('of-listprice').value || null,
      offer_amount: amount,
      offer_date: document.getElementById('of-date').value,
      status: status,
      conditions: document.getElementById('of-conditions').value.trim(),
      agent_notes: document.getElementById('of-notes').value.trim(),
      seller_response_due: document.getElementById('of-response-due')?.value ? new Date(document.getElementById('of-response-due').value).toISOString() : null,
      followup_notified: false
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

    // If accepted, ask for the closing details + commission, THEN create pipeline + commission row
    if (status === 'Accepted') {
      App.closeModal();
      Pipeline.askAcceptanceDetails(data, client);
      Offers.load(); App.loadOverview();
      return;
    }

    App.closeModal();
    App.toast('✅ Offer submitted!');
    Offers.load(); App.loadOverview();
  },

  async openDetail(id) {
    const o = Offers.all.find(x => x.id === id);
    if (!o) return;
    const statusColor = { Submitted:'var(--accent2)', Accepted:'var(--green)', Rejected:'var(--red)', Conditions:'var(--yellow)', Countered:'var(--purple)' };
    const isPending = ['Submitted','Conditions'].includes(o.status);
    App.openModal(`
      <div class="fw-800" style="font-size:16px;margin-bottom:2px;">${o.property_address}</div>
      ${o.mls_number ? `<div class="text-muted" style="font-size:12px;margin-bottom:2px;">MLS# ${App.esc(o.mls_number)}</div>` : ''}
      <div class="text-muted" style="font-size:13px;margin-bottom:14px;">👤 ${o.clients?.full_name||'—'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:var(--bg);padding:10px;border-radius:8px;grid-column:1/-1;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Offer Amount</div><div class="fw-800" style="font-size:22px;color:var(--green);">${App.fmtMoney(o.offer_amount)}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Status</div><div class="fw-700" style="color:${statusColor[o.status]||'var(--text2)'};">${o.status}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">List Price</div><div class="fw-700">${App.fmtMoney(o.list_price)||'—'}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Offer Date</div><div class="fw-700">${App.fmtDate(o.offer_date)}</div></div>
      </div>
      ${o.conditions ? `<div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Conditions</div><div style="font-size:13px;">${App.esc(o.conditions)}</div></div>` : ''}
      ${o.agent_notes ? `<div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Notes</div><div style="font-size:13px;">${App.esc(o.agent_notes)}</div></div>` : ''}
      ${isPending ? `
      <div style="background:var(--bg2);border:2px solid var(--accent2);border-radius:10px;padding:14px;margin-bottom:10px;">
        <div style="font-size:13px;font-weight:700;margin-bottom:6px;">Seller Response?</div>
        ${o.seller_response_due ? `<div style="font-size:11px;color:var(--yellow);margin-bottom:10px;">⏰ Follow-up scheduled: <strong>${new Date(o.seller_response_due).toLocaleString()}</strong></div>` : ''}
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">Select the seller's response to automatically notify your buyer:</div>
        <div style="display:grid;gap:8px;">
          <button class="btn btn-green" onclick="Offers.sellerAccepted('${o.id}')">✅ Seller Accepted — Offer is firm!</button>
          <button class="btn btn-outline" onclick="Offers.sellerCountered('${o.id}')" style="border-color:var(--purple);color:var(--purple);">🔄 Seller Countered — Enter counter amount</button>
          <button class="btn btn-red" onclick="Offers.sellerRejected('${o.id}')">❌ Seller Rejected — Notify buyer</button>
          <button class="btn btn-outline" onclick="Offers.snoozeFollowUp('${o.id}')" style="border-color:var(--yellow);color:var(--yellow);">⏳ Still Waiting — Set new reminder</button>
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
    App.closeModal();
    Pipeline.askAcceptanceDetails(o, client);
    Offers.load(); Clients.load(); App.loadOverview();
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
        <button class="btn btn-primary" onclick="Offers.confirmCounter('${id}')">Queue Notification</button>
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
        <button class="btn btn-red" onclick="Offers.confirmRejection('${id}')">Queue Notification</button>
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
  },

  // ── SELLER FOLLOW-UP AUTOMATION ───────────────────────────────────────────
  async checkFollowUps() {
    if (!currentAgent?.id) return;
    try {
      const now = new Date().toISOString();
      const { data } = await db.from('offers')
        .select('id, property_address, offer_amount, clients(full_name)')
        .eq('agent_id', currentAgent.id)
        .in('status', ['Submitted', 'Conditions'])
        .eq('followup_notified', false)
        .lte('seller_response_due', now)
        .not('seller_response_due', 'is', null);
      if (!data?.length) return;
      for (const o of data) {
        App.pushNotify(
          `⏰ Seller Response Due`,
          `${o.property_address || 'Offer'} — Did the seller respond? Tap to log: Accepted, Countered, or Rejected`,
          'offers'
        );
        App.toast(`⏰ Follow-up: ${o.property_address} — open offer to log seller response`, 'var(--yellow)');
        await db.from('offers').update({ followup_notified: true }).eq('id', o.id);
        const local = Offers.all.find(x => x.id === o.id);
        if (local) local.followup_notified = true;
      }
    } catch(e) {}
  },

  snoozeFollowUp(id) {
    const o = Offers.all.find(x => x.id === id);
    if (!o) return;
    const now = new Date();
    const plus1h  = new Date(now.getTime() + 1 * 60 * 60 * 1000).toISOString().slice(0,16);
    const plus2h  = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0,16);
    const plus4h  = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0,16);
    const tomorrow = new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString().slice(0,16);
    App.openModal(`
      <div class="modal-title">⏳ Still Waiting — Set Reminder</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:14px;">📍 ${App.esc(o.property_address)}</div>
      <div style="display:grid;gap:8px;margin-bottom:14px;">
        <button class="btn btn-outline" onclick="Offers.saveSnooze('${id}','${plus1h}')" style="text-align:left;">⏰ In 1 hour</button>
        <button class="btn btn-outline" onclick="Offers.saveSnooze('${id}','${plus2h}')" style="text-align:left;">⏰ In 2 hours</button>
        <button class="btn btn-outline" onclick="Offers.saveSnooze('${id}','${plus4h}')" style="text-align:left;">⏰ In 4 hours</button>
        <button class="btn btn-outline" onclick="Offers.saveSnooze('${id}','${tomorrow}')" style="text-align:left;">🌅 Tomorrow morning</button>
      </div>
      <div class="form-group">
        <label class="form-label">Or pick a specific time</label>
        <input class="form-input" id="snooze-time" type="datetime-local" value="${plus2h}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-primary" onclick="Offers.saveSnooze('${id}',document.getElementById('snooze-time').value)">Set Reminder</button>
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
      </div>
    `);
  },

  async saveSnooze(id, datetime) {
    if (!datetime) { App.toast('⚠️ Pick a time first', 'var(--red)'); return; }
    await db.from('offers').update({
      seller_response_due: new Date(datetime).toISOString(),
      followup_notified: false,
      updated_at: new Date().toISOString()
    }).eq('id', id);
    const local = Offers.all.find(x => x.id === id);
    if (local) { local.seller_response_due = new Date(datetime).toISOString(); local.followup_notified = false; }
    App.closeModal();
    App.toast(`⏰ Reminder set for ${new Date(datetime).toLocaleString()}`, 'var(--yellow)');
    setTimeout(() => Offers.openDetail(id), 300);
  }
};

// ── PIPELINE ──
const Pipeline = {
  all: [],
  currentFilter: 'all',  // 'all' | 'existing_home' | 'new_build'

  setFilter(key) {
    Pipeline.currentFilter = key;
    Pipeline.render(Pipeline.all);
  },

  // ── Status-ticker cooldown state machine ─────────────────────────────
  // The ticker should only flash on screen a few times per day (so it's
  // attention-grabbing without being noise). Each "appearance" is 2 cycles
  // of the marquee animation (~90s). After it shows, it goes silent for
  // a cooldown period that grows: 30 min → 1.5 hr → 5 hr → 8 hr.
  // Max 5 appearances per day. State persists in localStorage so quickly
  // switching tabs and coming back doesn't bypass the cooldown. New day
  // (date change) resets the counter.
  shouldShowTicker() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      let state = JSON.parse(localStorage.getItem('df-ticker-state') || 'null');
      if (!state || state.date !== today) {
        state = { date: today, showCount: 0, nextShowAt: null };
      }
      // Already used today's allotment?
      if (state.showCount >= 5) return false;
      // In cooldown?
      if (state.nextShowAt && new Date(state.nextShowAt).getTime() > Date.now()) return false;

      // Time to show. Advance counter, set next cooldown.
      const cooldownsMin = [30, 90, 300, 480];  // gap before show 2, 3, 4, 5
      const cdMin = cooldownsMin[state.showCount];
      state.showCount += 1;
      state.nextShowAt = (state.showCount < 5)
        ? new Date(Date.now() + (cdMin || 480) * 60 * 1000).toISOString()
        : null;
      localStorage.setItem('df-ticker-state', JSON.stringify(state));
      return true;
    } catch (e) {
      return true;  // fail open so the ticker still works if localStorage breaks
    }
  },

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('pipeline')
      .select('*').eq('agent_id', currentAgent.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    Pipeline.all = data || [];

    // Fetch linked new_builds rows for any new-build pipeline rows.
    // Used by the status-ticker on new-build cards (and any other
    // build-aware UI we add later).
    Pipeline._buildsByName = {};
    const buildClientNames = Pipeline.all
      .filter(d => d.deal_type === 'new_build' && d.client_name)
      .map(d => d.client_name);
    if (buildClientNames.length) {
      const { data: builds } = await db.from('new_builds')
        .select('id, client_name, builder_name, pipeline_milestones, current_stage')
        .eq('agent_id', currentAgent.id)
        .in('client_name', buildClientNames);
      (builds || []).forEach(b => { Pipeline._buildsByName[b.client_name] = b; });
    }

    Pipeline.render(Pipeline.all);
  },

  // Build status messages — keyed off the first incomplete major stage
  // in pipeline_milestones. Used by the marquee ticker on new-build cards.
  buildStatusMessage(d, build) {
    const firstName = (d?.client_name || '').split(' ')[0] || 'there';
    const pm = build?.pipeline_milestones || {};
    const stageOrder = ['pre_construction','financing','construction','conditions','possession'];

    // Find the first incomplete stage (the one we're "currently in")
    let currentKey = null;
    for (const key of stageOrder) {
      if (!pm[key]?.done) { currentKey = key; break; }
    }
    if (!currentKey) {
      return `🎉 Build complete — congrats and welcome home, ${firstName}!`;
    }
    const messages = {
      pre_construction: `📋 Pre-construction underway — finalizing plans, paperwork, and design selections. I'll keep you posted as items get checked off.`,
      financing:        `🏦 Financing in progress — once everything is approved your agent will notify you.`,
      construction:     `🏗️ Construction in motion — I'll update you as foundation, framing, drywall, and finishes get done.`,
      conditions:       `📑 Closing prep underway — inspection, conditions, and final paperwork being handled. Almost there.`,
      possession:       `🔑 Final stretch — final walkthrough and key handover coming up. You're almost home.`
    };
    return messages[currentKey];
  },

  // Compute % of build steps complete from pipeline_milestones JSONB.
  // Used by the progress bar on new-build pipeline cards.
  buildPercent(build) {
    const pm = build?.pipeline_milestones || {};
    let done = 0, total = 0;
    ['pre_construction','financing','construction','conditions','possession'].forEach(stageKey => {
      const stage = pm[stageKey] || {};
      const steps = stage.steps || {};
      Object.values(steps).forEach(stepDone => {
        total++;
        if (stepDone) done++;
      });
    });
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  },

  // Generic stage-aware message for existing-home pipeline deals.
  // Used by the marquee ticker on existing-home pipeline cards.
  dealStatusMessage(d) {
    if (d.stage === 'Closed' || d.stage === 'Fell Through' || d.stage === 'Withdrawn') return '';
    const firstName = (d?.client_name || '').split(' ')[0] || 'there';

    // Compute display-stage like the badge does — financing date passed = under contract
    const today = new Date(new Date().toDateString());
    const finPast = d.financing_date && new Date(d.financing_date+'T00:00:00') <= today;
    const insPast = d.inspection_date && new Date(d.inspection_date+'T00:00:00') <= today;
    const walkPast = d.walkthrough_date && new Date(d.walkthrough_date+'T00:00:00') <= today;

    if (walkPast) return `🔑 Final walkthrough complete — closing day is almost here. We're nearly home, ${firstName}.`;
    if (insPast)  return `📑 Inspection complete — handling conditions and approvals. Closing prep underway.`;
    if (finPast)  return `🏦 Financing locked in — under contract and on track to closing. I'll keep you posted.`;
    return `📋 Offer accepted — initial paperwork in motion. I'll let you know as each milestone clears.`;
  },

  // Single source of truth for the progress-bar color.
  // Strictly on-theme: coral ramp during the deal, success-green on close.
  // Ramp:  0–49% accent2  → 50–99% accent  → 100% success  · Fell Through red
  barColor(pct, status) {
    if (status === 'closed') return 'var(--success)';
    if (status === 'fell')   return 'var(--red)';
    if (pct >= 100)          return 'var(--success)';
    if (pct >= 50)           return 'var(--accent)';
    return 'var(--accent2)';
  },

  // Show modal to capture closing dates + commission rate before creating pipeline
  askAcceptanceDetails(offer, client) {
    const today = new Date().toISOString().slice(0,10);
    const addDays = n => { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
    Pipeline._pendingOffer = offer;
    Pipeline._pendingClient = client;
    App.openModal(`
      <div class="modal-title">🎉 Offer Accepted — Closing Details</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:14px;">
        ${App.esc(offer.property_address)} · ${App.fmtMoney(offer.offer_amount)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">📅 Inspection Date</label>
          <input class="form-input" type="date" id="ad-inspection" value="${addDays(7)}">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">📅 Financing Date</label>
          <input class="form-input" type="date" id="ad-financing" value="${addDays(10)}">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">📅 Final Walkthrough</label>
          <input class="form-input" type="date" id="ad-walkthrough" value="${addDays(28)}">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">📅 Final Closing Date</label>
          <input class="form-input" type="date" id="ad-closing" value="${addDays(30)}">
        </div>
      </div>
      <div class="form-group" style="margin-top:14px;">
        <label class="form-label">💰 Your Commission %</label>
        <select class="form-input" id="ad-comm-rate" onchange="Pipeline.toggleCustomRate()">
          <option value="1.5">1.5%</option>
          <option value="2.5" selected>2.5%</option>
          <option value="3.5">3.5%</option>
          <option value="4.5">4.5%</option>
          <option value="custom">Custom...</option>
        </select>
        <input class="form-input" type="number" step="0.01" id="ad-comm-custom" placeholder="Enter custom % (e.g. 2.75)" style="display:none;margin-top:8px;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">
        <button class="btn btn-primary" onclick="Pipeline.confirmAcceptance()">Confirm & Move to Pipeline</button>
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
      </div>
    `);
  },

  toggleCustomRate() {
    const sel = document.getElementById('ad-comm-rate');
    const inp = document.getElementById('ad-comm-custom');
    inp.style.display = sel.value === 'custom' ? 'block' : 'none';
  },

  async confirmAcceptance() {
    const offer = Pipeline._pendingOffer;
    const client = Pipeline._pendingClient;
    if (!offer) { App.closeModal(); return; }
    const ins = document.getElementById('ad-inspection').value;
    const fin = document.getElementById('ad-financing').value;
    const walk = document.getElementById('ad-walkthrough').value;
    const close = document.getElementById('ad-closing').value;
    const sel = document.getElementById('ad-comm-rate').value;
    let rate = sel === 'custom'
      ? parseFloat(document.getElementById('ad-comm-custom').value)
      : parseFloat(sel);
    if (!rate || rate <= 0 || rate > 20) { App.toast('⚠️ Enter a valid commission %', 'var(--red)'); return; }

    // Stash the dates onto the offer so createFromOffer + checklist generator pick them up
    offer.inspection_date = ins;
    offer.financing_date = fin;
    offer.walkthrough_date = walk;
    offer.closing_date = close;

    await Pipeline.createFromOfferWithDates(offer, client, { ins, fin, walk, close, rate });
    Pipeline._pendingOffer = null; Pipeline._pendingClient = null;
    App.closeModal();
    App.toast('🎉 Pipeline created + Commission row added (status: Pending)');
    Pipeline.load(); Commission.load && Commission.load(); App.loadOverview();
  },

  // Wraps createFromOffer + inserts the Commission row in the same step
  async createFromOfferWithDates(offer, client, dates) {
    const today = new Date().toISOString().slice(0,10);
    const acceptDate = offer.offer_date || today;

    const _pInsert = {
      pipeline_id: crypto.randomUUID(),
      agent_id: currentAgent.id,
      client_id: offer.client_id,
      client_name: client?.full_name || offer.client_name,
      client_email: client?.email || '',
      property_address: offer.property_address,
      mls_number: offer.mls_number || null,
      offer_amount: offer.offer_amount,
      acceptance_date: acceptDate,
      inspection_date: dates.ins || null,
      financing_date:  dates.fin || null,
      walkthrough_date: dates.walk || null,
      closing_date:    dates.close || null,
      commission_rate: dates.rate || null,
      stage: 'Accepted',
      status: 'Active'
    };
    let pipelineId = null;
    const { data: pipelineRow, error } = await db.from('pipeline').insert(_pInsert).select('id').single();
    pipelineId = pipelineRow?.id || null;
    if (error) {
      // Fallback for older RLS configs: retry without commission_rate column if it doesn't exist
      const fallback = { ..._pInsert };
      delete fallback.commission_rate;
      await db.from('pipeline').insert(fallback);
      const { data: latest } = await db.from('pipeline')
        .select('id').eq('agent_id', currentAgent.id)
        .eq('property_address', offer.property_address)
        .order('created_at', { ascending: false }).limit(1).single();
      pipelineId = latest?.id || null;
    }

    // Build & insert the Commission row (status=Pending, will flip on close/fell-through)
    const sale = parseFloat(offer.offer_amount) || 0;
    const rate = parseFloat(dates.rate) || 2.5;
    const brokerPct = 20;
    const taxPct = 15;
    const gross = sale * rate / 100;
    const hst = gross * taxPct / 100;
    const brokerFee = gross * brokerPct / 100;
    const net = (gross + hst) - brokerFee;
    await db.from('commissions').insert({
      agent_id: currentAgent.id,
      client_name: client?.full_name || offer.client_name,
      property_address: offer.property_address,
      sale_price: sale,
      commission_rate: rate,
      gross_commission: gross,
      hst_collected: hst,
      brokerage_fee_rate: brokerPct,
      brokerage_fees: brokerFee,
      agent_net: net,
      close_date: dates.close || null,
      status: 'Pending'
    });

    await Pipeline.generateChecklist(pipelineId, offer, client, acceptDate);
    if (typeof Notify !== "undefined" && client?.email) {
      try { await Notify.onOfferAccepted(offer, client); } catch(_){}
    }
    await App.logActivity('PIPELINE_CREATED', client?.full_name, client?.email,
      `Deal pipeline + commission created: ${offer.property_address}`, offer.client_id);
  },

  async createFromOffer(offer, client) {
    const today = new Date().toISOString().slice(0,10);
    const acceptDate = offer.offer_date || today;

    // Insert pipeline record and get its ID back
    const _pInsert = {
      pipeline_id: crypto.randomUUID(),
      agent_id: currentAgent.id,
      client_id: offer.client_id,
      client_name: client?.full_name || offer.client_name,
      client_email: client?.email || '',
      property_address: offer.property_address,
      mls_number: offer.mls_number || null,
      offer_amount: offer.offer_amount,
      acceptance_date: acceptDate,
      stage: 'Accepted',
      status: 'Active'
    };
    const { data: pipelineRow, error } = await db.from('pipeline')
      .insert(_pInsert).select('id').single();

    let pipelineId = pipelineRow?.id || null;
    if (error) {
      console.warn('Pipeline insert error:', error.message);
      // Fallback: insert without select (older Supabase RLS configs)
      await db.from('pipeline').insert(_pInsert);
      // Re-fetch the new row's ID so checklist generation can proceed
      const { data: latest } = await db.from('pipeline')
        .select('id').eq('agent_id', currentAgent.id)
        .eq('property_address', offer.property_address)
        .order('created_at', { ascending: false }).limit(1).single();
      pipelineId = latest?.id || null;
    }

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
    // Skipped optional milestones (inspection_skipped / walkthrough_skipped)
    // count toward the DONE total — the agent has consciously decided not to
    // do them, so they shouldn't drag the progress bar down. Total always = 5.
    const milestones = [
      { date: d.acceptance_date,  skipped: false },
      { date: d.financing_date,   skipped: false },
      { date: d.inspection_date,  skipped: !!d.inspection_skipped },
      { date: d.walkthrough_date, skipped: !!d.walkthrough_skipped },
      { date: d.closing_date,     skipped: false }
    ];
    const doneInt = milestones.filter(m => m.skipped || isPast(m.date)).length;
    let done = doneInt;
    // Continuous creep: between milestones, bar climbs gradually toward closing.
    if (d.closing_date && d.acceptance_date) {
      const start = new Date(d.acceptance_date+'T00:00:00').getTime();
      const end   = new Date(d.closing_date  +'T00:00:00').getTime();
      const now   = today.getTime();
      if (end > start && now > start && now < end) {
        const frac = (now - start) / (end - start);
        done = Math.max(done, frac * milestones.length);
      }
    }
    return { done, doneInt, total: milestones.length };
  },

  render(list) {
    const el = document.getElementById('pipeline-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🚀</div><div class="empty-text">No active deals</div><div class="empty-sub">Accepted offers will appear here</div></div>`;
      return;
    }
    // Decide ONCE per render whether the status ticker should appear.
    // Stored on Pipeline._tickerActive and read by both card variants
    // (existing-home and new-build) — keeps the cooldown counter from
    // advancing once per card rendered.
    Pipeline._tickerActive = Pipeline.shouldShowTicker();

    // ── Apply deal_type filter (All / Existing Home / New Build) ──
    const filter = Pipeline.currentFilter || 'all';
    const filtered = filter === 'all' ? list : list.filter(d => (d.deal_type || 'existing_home') === filter);

    // Counts for filter chip labels
    const counts = {
      all: list.length,
      existing_home: list.filter(d => (d.deal_type || 'existing_home') === 'existing_home').length,
      new_build: list.filter(d => d.deal_type === 'new_build').length
    };
    const chip = (key, label) => `
      <button onclick="Pipeline.setFilter('${key}')"
        style="padding:7px 14px;border:1px solid ${filter===key?'var(--accent)':'var(--border)'};background:${filter===key?'var(--accent)':'transparent'};color:${filter===key?'#fff':'var(--text2)'};border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
        ${label} <span style="opacity:.7;font-weight:400;">${counts[key]}</span>
      </button>`;
    const filterRow = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        ${chip('all','All')}
        ${chip('existing_home','🏠 Existing Home')}
        ${chip('new_build','🏗️ New Build')}
      </div>`;

    const active = filtered.filter(d => !['Closed','Fell Through'].includes(d.stage));
    const closed = filtered.filter(d => d.stage === 'Closed');
    const fell = filtered.filter(d => d.stage === 'Fell Through');

    const card = (d) => {
      // ── NEW BUILD CARDS — distinct rendering for deal_type='new_build' ──
      if (d.deal_type === 'new_build') {
        return Pipeline.newBuildCard(d);
      }

      const isClosed = d.stage === 'Closed';
      const isFell = d.stage === 'Fell Through';

      // Progress bar: % based on how many milestone dates have passed (with daily creep toward closing)
      const { done, doneInt, total } = Pipeline.milestonesDone(d);
      const pct = isClosed ? 100 : isFell ? 0 : Math.round((done / total) * 100);
      const barColor = Pipeline.barColor(pct, isClosed ? 'closed' : isFell ? 'fell' : 'active');

      const steps = ['Accepted','Conditions','Closing','Closed'];
      const si = steps.indexOf(d.stage);
      const badge = isClosed ? 'badge-accepted' : isFell ? 'badge-rejected' : si>=2?'badge-viewings':'badge-conditions';
      const statusLine = isClosed ? '<span style="color:var(--green);">✅ Deal Complete</span>' : isFell ? '<span style="color:var(--red);">❌ Deal Fell Through</span>' : `<span style="color:var(--text2);">📋 Stage: ${d.stage}</span>`;

      // Clean date field — live progress preview on change.
      // skipKey: when set ('inspection' or 'walkthrough'), renders a small
      // Do/Skip dropdown above the date input so optional milestones can be
      // waived without dragging the progress bar down.
      const dateField = (label, icon, inputId, dateVal, skipKey) => {
        const readonly = isClosed || isFell;
        const onChange = readonly ? '' : `oninput="Pipeline.previewProgress('${d.id}')"`;
        const isSkipped = skipKey === 'inspection'  ? !!d.inspection_skipped
                        : skipKey === 'walkthrough' ? !!d.walkthrough_skipped
                        : false;
        const skipDD = skipKey ? `
          <select class="form-input" id="${inputId}-skip" style="font-size:11px;padding:3px 6px;margin-bottom:4px;width:100%;" ${readonly?'disabled':''}
            onchange="Pipeline.toggleSkip('${d.id}','${skipKey}',this.value==='skip')">
            <option value="do"   ${isSkipped?'':'selected'}>Do ${label.toLowerCase()}</option>
            <option value="skip" ${isSkipped?'selected':''}>Skip ${label.toLowerCase()}</option>
          </select>` : '';
        const dateInputStyle = `font-size:12px;padding:5px 8px;${isSkipped?'opacity:.45;pointer-events:none;':''}`;
        return `<div>
          <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:3px;">${icon} ${label}${isSkipped?' <span style="color:var(--text3);font-weight:500;">(skipped)</span>':''}</div>
          ${skipDD}
          <input class="form-input" type="date" id="${inputId}" value="${dateVal||''}" style="${dateInputStyle}" ${onChange} ${readonly||isSkipped?'readonly':''}>
        </div>`;
      };

      const updatedAt = d.updated_at ? new Date(d.updated_at) : null;
      const updatedStr = updatedAt ? updatedAt.toLocaleString() : '—';

      // ── Deposit 48-hour deadline tracker ──────────────────────────────────────
      const depositBlock = (() => {
        const markBtn = `<button class="btn btn-sm" style="background:var(--green);color:#fff;font-size:11px;padding:3px 8px;white-space:nowrap;" onclick="Pipeline.markDepositPaid('${d.id}')">✅ Mark Paid</button>`;
        if (d.deposit_paid) {
          return `<div style="padding:4px 10px;background:rgba(34,197,94,0.1);border:1px solid var(--green);border-radius:6px;font-size:12px;color:var(--green);font-weight:600;margin-bottom:10px;">📥 Deposit: ✅ Paid</div>`;
        }
        if (!d.acceptance_date || isClosed || isFell) {
          return `<div style="padding:4px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text2);display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;"><span>📥 Deposit not yet paid</span>${!isClosed&&!isFell?markBtn:''}</div>`;
        }
        const deadline = new Date(d.acceptance_date + 'T00:00:00');
        deadline.setHours(deadline.getHours() + 48);
        const diffMs = deadline - Date.now();
        const diffH  = Math.floor(Math.abs(diffMs) / 3600000);
        const diffM  = Math.floor((Math.abs(diffMs) % 3600000) / 60000);
        if (diffMs <= 0) {
          return `<div style="padding:6px 10px;background:rgba(220,38,38,0.12);border:1px solid var(--red);border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;"><span style="color:var(--red);font-weight:700;font-size:12px;">🔴 Deposit OVERDUE — ${diffH}h past due</span>${markBtn}</div>`;
        }
        const color = diffH < 6 ? 'var(--red)' : diffH < 24 ? 'var(--yellow)' : 'var(--accent2)';
        const bg    = diffH < 6 ? 'rgba(220,38,38,0.08)' : diffH < 24 ? 'rgba(234,179,8,0.08)' : 'var(--bg)';
        const left  = diffH > 0 ? `${diffH}h ${diffM}m` : `${diffM}m`;
        return `<div style="padding:6px 10px;background:${bg};border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;"><span style="color:${color};font-weight:600;font-size:12px;">⏰ Deposit due in ${left}</span>${markBtn}</div>`;
      })();

      // Stage-aware status ticker (existing-home variant) — silent if closed/fell-through
      // or if the daily cooldown has us in a quiet window.
      const dealTickerMsg = (isClosed || isFell || !Pipeline._tickerActive) ? '' : Pipeline.dealStatusMessage(d);
      const dealTickerHtml = dealTickerMsg ? `<div class="deal-ticker-pl"><span>${dealTickerMsg}</span></div>` : '';

      return `<div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div><div class="fw-800" style="font-size:15px;">${d.client_name||'—'}</div><div class="text-muted" style="font-size:12px;margin-top:2px;">📍 ${d.property_address||'—'}</div></div>
          <span class="stage-badge ${badge}">${isClosed ? 'CLOSED' : isFell ? 'FELL THROUGH' : (d.financing_date && new Date(d.financing_date+'T00:00:00') <= new Date(new Date().toDateString())) ? 'UNDER CONTRACT' : 'IN PROGRESS'}</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;margin-bottom:4px;">
          <div id="pl-bar-${d.id}" style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.4s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--text3);margin-bottom:8px;">
          <span id="pl-milestone-lbl-${d.id}" title="Bar auto-advances as each milestone date passes">${doneInt} of ${total} milestones passed ⓘ</span>
          <span id="pl-pct-lbl-${d.id}">${pct}%</span>
        </div>
        ${dealTickerHtml}
        <div style="font-size:12px;margin-bottom:8px;">${statusLine}</div>
        <div style="font-size:13px;margin-bottom:6px;">💰 Offer: <strong id="pl-price-${d.id}">${App.fmtMoney(d.offer_amount)}</strong> <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;margin-left:4px;" onclick="Pipeline.editPrice('${d.id}', ${Number(d.offer_amount)||0})">✏️ Edit</button></div>
        ${depositBlock}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          ${dateField('Acceptance','✅',`pl-acc-${d.id}`,d.acceptance_date)}
          ${dateField('Financing','🏦',`pl-fin-${d.id}`,d.financing_date)}
          ${dateField('Inspection','🔍',`pl-ins-${d.id}`,d.inspection_date,'inspection')}
          ${dateField('Walkthrough','🚶',`pl-walk-${d.id}`,d.walkthrough_date,'walkthrough')}
          ${dateField('Closing','📅',`pl-close-${d.id}`,d.closing_date)}
        </div>
        ${!isClosed && !isFell ? `<button class="btn btn-primary btn-block" style="margin-bottom:8px;" onclick="Pipeline.saveDates('${d.id}')">Save Dates</button>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isClosed ? `<button class="btn btn-outline btn-sm" onclick="Reviews.request('${d.id}')">📝 Request Review</button>
          <button class="btn btn-outline btn-sm" onclick="Pipeline.revertClose('${d.id}')">🔄 Revert Close</button>` : ''}
          ${isFell ? `<button class="btn btn-outline btn-sm" onclick="Pipeline.reactivate('${d.id}')">🔄 Reactivate</button>` : ''}
          ${!isClosed && !isFell ? `
            <button class="btn btn-green btn-sm" onclick="Pipeline.closeDeal('${d.id}')">✅ Mark Closed</button>
            <button class="btn btn-red btn-sm" onclick="Pipeline.markFellThrough('${d.id}')">❌ Fell Through</button>
            <button class="btn btn-outline btn-sm" onclick="Pipeline.openStageModal('${d.id}')">📋 Stage</button>
            <button class="btn btn-outline btn-sm" style="border-color:var(--accent);color:var(--accent);" onclick="Reviews.requestPreClose('${d.id}')">📨 Pre-closing Check-in</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="Pipeline.openChecklist('${d.id}')">☑️ Checklist</button>
          <button class="btn btn-outline btn-sm" onclick="Pipeline.sharePortal('${d.id}')">🔗 Portal</button>
          <button class="btn btn-outline btn-sm" onclick="Pipeline.resendPortal('${d.id}')">📨 Resend</button>
          <button class="btn btn-outline btn-sm" onclick="Pipeline.exportPdf('${d.id}')">📄 PDF</button>
          <button class="btn btn-outline btn-sm" style="border-color:var(--yellow);color:var(--yellow);" onclick="Pipeline.archive('${d.id}')">📦 Archive</button>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px;" id="pl-updated-${d.id}">🕐 Updated: ${updatedStr}</div>
      </div>`;
    };

    let html = filterRow;
    if (!filtered.length) {
      html += `<div style="text-align:center;padding:30px 20px;color:var(--text2);font-size:14px;">No deals of this type yet.</div>`;
    } else {
      html += active.map(d => card(d)).join('');
    }

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

  // ── NEW BUILD CARD — distinct rendering for deal_type='new_build' deals ──
  // Shows builder context + a button to jump into the New Builds tab
  // for milestone management. Pipeline row stays in sync via syncPipeline().
  newBuildCard(d) {
    const isClosed = d.stage === 'Closed';
    const isFell   = d.stage === 'Fell Through';
    const statusLabel = isClosed ? 'CLOSED'
                      : isFell   ? 'FELL THROUGH'
                      : '🏗️ NEW BUILD';
    const badgeColor = isClosed ? 'var(--green)'
                     : isFell   ? 'var(--red)'
                     : 'var(--accent)';
    const badgeBg = isClosed ? 'rgba(34,197,94,.12)'
                  : isFell   ? 'rgba(220,38,38,.12)'
                  : 'rgba(204,120,92,.12)';
    const updatedAt = d.updated_at ? new Date(d.updated_at) : null;
    const updatedStr = updatedAt ? updatedAt.toLocaleString() : '—';

    // Pull linked new_builds row (loaded in Pipeline.load) so the ticker
    // and progress bar can read pipeline_milestones for live stage data.
    const linkedBuild = (Pipeline._buildsByName || {})[d.client_name];
    const tickerMsg   = Pipeline.buildStatusMessage(d, linkedBuild);
    const tickerHtml  = (isClosed || isFell || !Pipeline._tickerActive)
      ? ''
      : `<div class="build-ticker"><span>${tickerMsg}</span></div>`;

    // Build-progress bar: % of all steps complete across the 5 milestone sections
    const { done: bDone, total: bTotal, pct: bPct } = Pipeline.buildPercent(linkedBuild);
    const barColor = isClosed ? 'var(--green)' : isFell ? 'var(--red)' : 'linear-gradient(90deg,var(--accent),var(--accent2))';
    const progressHtml = bTotal > 0 ? `
      <div style="height:6px;background:var(--border);border-radius:3px;margin-bottom:4px;">
        <div style="height:100%;width:${isClosed?100:bPct}%;background:${barColor};border-radius:3px;transition:width 0.4s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--text3);margin-bottom:8px;">
        <span>${bDone} of ${bTotal} build steps complete</span>
        <span>${isClosed?100:bPct}%</span>
      </div>` : '';

    return `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--accent);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div class="fw-800" style="font-size:15px;">${d.client_name||'—'}</div>
          <div class="text-muted" style="font-size:12px;margin-top:2px;">📍 ${d.property_address||'—'}</div>
        </div>
        <span style="font-size:10px;color:${badgeColor};background:${badgeBg};padding:3px 10px;border-radius:8px;font-weight:700;letter-spacing:1px;white-space:nowrap;">${statusLabel}</span>
      </div>
      ${progressHtml}
      ${tickerHtml}
      <div style="font-size:12px;color:var(--text2);margin-bottom:6px;">📋 Stage: ${d.stage}</div>
      <div style="font-size:13px;margin-bottom:4px;">💰 Build value: <strong>${App.fmtMoney(d.offer_amount)}</strong></div>
      ${d.closing_date ? `<div style="font-size:13px;margin-bottom:10px;">📅 Est. possession: <strong>${App.fmtDate(d.closing_date)}</strong></div>` : '<div style="margin-bottom:10px;"></div>'}
      <div style="display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:8px;">
        ${isClosed || isFell ? '' : `
        <button class="btn btn-sm" style="background:var(--accent);color:#fff;" onclick="Pipeline.openBuildDetail('${d.id}')">🏗️ Manage Build</button>
        <button class="btn btn-green btn-sm" onclick="Pipeline.closeDeal('${d.id}')">✅ Mark Closed</button>
        <button class="btn btn-red btn-sm" onclick="Pipeline.markFellThrough('${d.id}')">❌ Fell Through</button>`}
        <button class="btn btn-outline btn-sm" onclick="Pipeline.sharePortal('${d.id}')">🔗 Portal</button>
        <button class="btn btn-outline btn-sm" style="border-color:var(--yellow);color:var(--yellow);" onclick="Pipeline.archive('${d.id}')">📦 Archive</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px;">🕐 Updated: ${updatedStr}</div>
    </div>`;
  },

  // Tap "Manage Build" on a new-build pipeline card → switch to New Builds tab
  // and try to scroll to the matching build. Match by client_name (the same key
  // syncPipeline used to link them).
  openBuildDetail(pipelineId) {
    const d = Pipeline.all.find(x => x.id === pipelineId);
    if (!d) return;
    if (typeof App !== 'undefined' && App.switchTab) {
      App.switchTab('newbuilds');
    }
    // After tab switches, try to open the matching build's detail view
    setTimeout(() => {
      if (typeof NewBuilds === 'undefined' || !NewBuilds.all) return;
      const build = NewBuilds.all.find(b => b.client_name === d.client_name);
      if (build && typeof NewBuilds.openDetail === 'function') {
        NewBuilds.openDetail(build.id);
      }
    }, 250);
  },

  // Live-update progress bar as dates are typed — no DB write
  previewProgress(id) {
    const acc  = document.getElementById(`pl-acc-${id}`)?.value  || null;
    const fin  = document.getElementById(`pl-fin-${id}`)?.value  || null;
    const ins  = document.getElementById(`pl-ins-${id}`)?.value  || null;
    const walk = document.getElementById(`pl-walk-${id}`)?.value || null;
    const close= document.getElementById(`pl-close-${id}`)?.value|| null;
    const insSkip  = document.getElementById(`pl-ins-${id}-skip`)?.value  === 'skip';
    const walkSkip = document.getElementById(`pl-walk-${id}-skip`)?.value === 'skip';
    const preview = {
      acceptance_date: acc, financing_date: fin,
      inspection_date: ins, walkthrough_date: walk, closing_date: close,
      inspection_skipped: insSkip, walkthrough_skipped: walkSkip
    };
    const { done, doneInt, total } = Pipeline.milestonesDone(preview);
    const pct = Math.round((done / total) * 100);
    const bar = document.getElementById(`pl-bar-${id}`);
    if (bar) { bar.style.width = `${pct}%`; bar.style.background = Pipeline.barColor(pct, 'active'); }
    const lbl = document.getElementById(`pl-milestone-lbl-${id}`);
    if (lbl) lbl.textContent = `${doneInt} of ${total} milestones passed ⓘ`;
    const pctLbl = document.getElementById(`pl-pct-lbl-${id}`);
    if (pctLbl) pctLbl.textContent = `${pct}%`;
  },

  // Live-toggle a skip dropdown — re-renders previewProgress + clears the
  // date input visual state without touching the DB. Persisted on Save Dates.
  toggleSkip(id, key, skipped) {
    const dateInput = document.getElementById(key === 'inspection' ? `pl-ins-${id}` : `pl-walk-${id}`);
    if (dateInput) {
      dateInput.style.opacity = skipped ? '.45' : '';
      dateInput.style.pointerEvents = skipped ? 'none' : '';
      if (skipped) dateInput.removeAttribute('readonly'); else dateInput.removeAttribute('readonly');
    }
    Pipeline.previewProgress(id);
  },

  async saveDates(id) {
    const acc  = document.getElementById(`pl-acc-${id}`)?.value  || null;
    const fin  = document.getElementById(`pl-fin-${id}`)?.value  || null;
    const ins  = document.getElementById(`pl-ins-${id}`)?.value  || null;
    const walk = document.getElementById(`pl-walk-${id}`)?.value || null;
    const close= document.getElementById(`pl-close-${id}`)?.value|| null;
    const insSkip  = document.getElementById(`pl-ins-${id}-skip`)?.value  === 'skip';
    const walkSkip = document.getElementById(`pl-walk-${id}-skip`)?.value === 'skip';
    const now  = new Date().toISOString();

    // Try saving all 5 milestone dates + skip flags
    let { error } = await db.from('pipeline').update({
      updated_at:           now,
      acceptance_date:      acc,
      financing_date:       fin,
      inspection_date:      ins,
      walkthrough_date:     walk,
      closing_date:         close,
      inspection_skipped:   insSkip,
      walkthrough_skipped:  walkSkip,
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
      acceptance_date:      acc,
      financing_date:       fin,
      inspection_date:      ins,
      walkthrough_date:     walk,
      closing_date:         close,
      inspection_skipped:   insSkip,
      walkthrough_skipped:  walkSkip,
    });
    if (rec) Object.assign(rec, merged);

    // Auto-advance stage to "Under Contract" once financing date has passed
    // (financing approved → deal is officially under contract until closing).
    if (fin && rec) {
      const finPast = new Date(fin + 'T00:00:00') <= new Date(new Date().toDateString());
      const isLockedStage = ['Closed','Fell Through','Under Contract','Closing'].includes(rec.stage);
      if (finPast && !isLockedStage) {
        await db.from('pipeline').update({ stage: 'Under Contract', updated_at: now }).eq('id', id);
        rec.stage = 'Under Contract';
        if (rec.client_id) {
          await db.from('clients').update({ stage: 'Under Contract', updated_at: now }).eq('id', rec.client_id);
        }
      }
    }

    // Update progress bar % in-place — no full reload needed
    const { done, doneInt, total } = Pipeline.milestonesDone(merged);
    const pct = Math.round((done / total) * 100);
    const bar = document.getElementById(`pl-bar-${id}`);
    const status = rec?.stage === 'Closed' ? 'closed' : rec?.stage === 'Fell Through' ? 'fell' : 'active';
    if (bar) { bar.style.width = `${pct}%`; bar.style.background = Pipeline.barColor(pct, status); }
    const lbl = document.getElementById(`pl-milestone-lbl-${id}`);
    if (lbl) lbl.textContent = `${doneInt} of ${total} milestones passed ⓘ`;
    const pctLbl = document.getElementById(`pl-pct-lbl-${id}`);
    if (pctLbl) pctLbl.textContent = `${pct}%`;
    const updEl = document.getElementById(`pl-updated-${id}`);
    if (updEl) updEl.textContent = `🕐 Updated: ${new Date(now).toLocaleString()}`;

    App.toast('💾 Dates saved!');
    if (typeof Calendar !== 'undefined') Calendar.refresh?.();
  },

  async editPrice(id, currentAmount) {
    const input = prompt('New purchase price (numbers only, no $ or commas):', currentAmount);
    if (input === null) return;
    const newAmt = parseFloat(String(input).replace(/[^\d.]/g, ''));
    if (!newAmt || newAmt <= 0) { App.toast('⚠️ Invalid amount'); return; }

    const rec = Pipeline.all?.find(x => x.id === id);
    if (!rec) return;
    const oldAmt = Number(rec.offer_amount) || 0;
    if (newAmt === oldAmt) return;

    const now = new Date().toISOString();

    const { error: pErr } = await db.from('pipeline')
      .update({ offer_amount: newAmt, updated_at: now }).eq('id', id);
    if (pErr) { App.toast('⚠️ Pipeline update failed'); return; }

    const { data: comm } = await db.from('commissions')
      .select('id, commission_rate, brokerage_fee_rate')
      .eq('agent_id', currentAgent.id)
      .eq('property_address', rec.property_address)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (comm) {
      const rate      = parseFloat(comm.commission_rate)    || 2.5;
      const brokerPct = parseFloat(comm.brokerage_fee_rate) || 20;
      const taxPct    = 15;
      const gross     = newAmt * rate / 100;
      const hst       = gross * taxPct / 100;
      const brokerFee = gross * brokerPct / 100;
      const net       = (gross + hst) - brokerFee;
      await db.from('commissions').update({
        sale_price:        newAmt,
        gross_commission:  gross,
        hst_collected:     hst,
        brokerage_fees:    brokerFee,
        agent_net:         net,
        updated_at:        now,
      }).eq('id', comm.id);
    }

    rec.offer_amount = newAmt;
    const el = document.getElementById(`pl-price-${id}`);
    if (el) el.textContent = App.fmtMoney(newAmt);

    await App.logActivity('PIPELINE_PRICE_EDITED', rec.client_name, rec.client_email,
      `Price changed: ${App.fmtMoney(oldAmt)} → ${App.fmtMoney(newAmt)} on ${rec.property_address}`);

    App.toast(`✅ Price updated → ${App.fmtMoney(newAmt)}`);
  },

  async markDepositPaid(id) {
    const { error } = await db.from('pipeline')
      .update({ deposit_paid: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { App.toast('⚠️ Could not mark deposit paid'); return; }
    const rec = Pipeline.all?.find(x => x.id === id);
    if (rec) rec.deposit_paid = true;
    App.toast('📥 Deposit marked as paid!');
    Pipeline.render(Pipeline.all);
  },

  async closeDeal(id) {
    const close = document.getElementById(`pl-close-${id}`)?.value || new Date().toISOString().slice(0,10);
    await db.from('pipeline').update({ stage: 'Closed', closing_date: close, updated_at: new Date().toISOString() }).eq('id', id);
    const d = Pipeline.all.find(x => x.id === id);
    // Auto-flip the linked commission row from Pending → Closed
    if (d?.property_address) {
      await db.from('commissions')
        .update({ status: 'Closed', close_date: close, updated_at: new Date().toISOString() })
        .eq('agent_id', currentAgent.id)
        .eq('property_address', d.property_address)
        .in('status', ['Pending']);
    }
    // Update client stage to Closed and auto-archive (can be reactivated later via Restore)
    if (d?.client_id) {
      await db.from('clients').update({
        stage: 'Closed',
        status: 'Archived',
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', d.client_id);
    }
    await App.logActivity('DEAL_CLOSED', d?.client_name, d?.client_email, `Deal closed: ${d?.property_address}`, d?.client_id);
    // Queue closing congratulations email for approval
    if (typeof Notify !== "undefined" && d?.client_email) {
      const client = { id: d.client_id, full_name: d.client_name, email: d.client_email };
      await Notify.onDealClosed(d, client);
    }
    App.toast('✅ Deal closed & client archived! 🎉 Congrats email queued in Approvals.');
    Pipeline.load(); Clients.load(); App.loadOverview();
    if (typeof Calendar !== 'undefined') Calendar.refresh?.();
  },

  async markFellThrough(id) {
    const d = Pipeline.all.find(x => x.id === id);
    await db.from('pipeline').update({ stage: 'Fell Through', updated_at: new Date().toISOString() }).eq('id', id);
    // Auto-archive the linked commission row (deal fell through, agent not paid)
    if (d?.property_address) {
      await db.from('commissions')
        .update({ status: 'Archived', updated_at: new Date().toISOString() })
        .eq('agent_id', currentAgent.id)
        .eq('property_address', d.property_address)
        .in('status', ['Pending', 'Closed']);
    }
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
    if (typeof Calendar !== 'undefined') Calendar.refresh?.();
  },

  async reactivate(id) {
    await db.from('pipeline').update({ stage: 'Accepted', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('🔄 Deal reactivated!');
    Pipeline.load();
    if (typeof Calendar !== 'undefined') Calendar.refresh?.();
  },

  async revertClose(id) {
    await db.from('pipeline').update({ stage: 'Closing', updated_at: new Date().toISOString() }).eq('id', id);
    const d = Pipeline.all.find(x => x.id === id);
    // Un-archive client since the close was reverted
    if (d?.client_id) {
      await db.from('clients').update({
        stage: 'Closing',
        status: 'Active',
        archived_at: null,
        updated_at: new Date().toISOString()
      }).eq('id', d.client_id);
    }
    App.toast('🔄 Deal reverted — client restored to active');
    Pipeline.load(); Clients.load();
    if (typeof Calendar !== 'undefined') Calendar.refresh?.();
  },

  // ── ARCHIVE / RESTORE / DELETE FOREVER ─────────────────────────────────
  archived: [],

  async archive(id) {
    const rec = Pipeline.all?.find(x => x.id === id);
    if (!rec) return;
    if (!confirm(`Archive this deal?\n\n${rec.client_name || ''} — ${rec.property_address || ''}\n\nIt will be hidden from the Pipeline but can be restored from the Archive view.`)) return;
    const now = new Date().toISOString();
    const { error } = await db.from('pipeline')
      .update({ archived_at: now, updated_at: now }).eq('id', id);
    if (error) { App.toast('⚠️ Archive failed'); return; }
    await App.logActivity('PIPELINE_ARCHIVED', rec.client_name, rec.client_email,
      `Archived deal: ${rec.property_address}`, rec.client_id);
    App.toast('📦 Deal archived');
    Pipeline.load();
    if (App.loadOverview) App.loadOverview();
  },

  async loadArchive() {
    if (!currentAgent?.id) return;
    const el = document.getElementById('pipeline-archive-list');
    if (el) el.innerHTML = `<div class="loading"><div class="spinner"></div> Loading...</div>`;
    const { data } = await db.from('pipeline')
      .select('*').eq('agent_id', currentAgent.id)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });
    Pipeline.archived = data || [];
    Pipeline.renderArchive(Pipeline.archived);
  },

  renderArchive(list) {
    const el = document.getElementById('pipeline-archive-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">Archive is empty</div><div class="empty-sub">Archived deals will appear here</div></div>`;
      return;
    }
    el.innerHTML = list.map(d => {
      const archStr = d.archived_at ? new Date(d.archived_at).toLocaleString() : '—';
      const stageBadge = d.stage === 'Closed' ? 'badge-accepted'
                       : d.stage === 'Fell Through' ? 'badge-rejected'
                       : 'badge-conditions';
      return `<div class="card" style="margin-bottom:12px;opacity:0.92;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div>
            <div class="fw-800" style="font-size:15px;">${App.esc(d.client_name||'—')}</div>
            <div class="text-muted" style="font-size:12px;margin-top:2px;">📍 ${App.esc(d.property_address||'—')}</div>
          </div>
          <span class="stage-badge ${stageBadge}">${App.esc(d.stage||'—')}</span>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px;">💰 ${App.fmtMoney(d.offer_amount)}</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:10px;">📦 Archived: ${archStr}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="Pipeline.restore('${d.id}')">🔄 Restore</button>
          <button class="btn btn-red btn-sm" onclick="Pipeline.confirmDeleteForever('${d.id}')">🗑️ Delete Forever</button>
        </div>
      </div>`;
    }).join('');
  },

  async restore(id) {
    const rec = Pipeline.archived?.find(x => x.id === id);
    if (!rec) return;
    const now = new Date().toISOString();
    const { error } = await db.from('pipeline')
      .update({ archived_at: null, updated_at: now }).eq('id', id);
    if (error) { App.toast('⚠️ Restore failed'); return; }
    await App.logActivity('PIPELINE_RESTORED', rec.client_name, rec.client_email,
      `Restored deal: ${rec.property_address}`, rec.client_id);
    App.toast('🔄 Deal restored to Pipeline');
    Pipeline.loadArchive();
    if (App.loadOverview) App.loadOverview();
  },

  confirmDeleteForever(id) {
    const rec = Pipeline.archived?.find(x => x.id === id);
    if (!rec) return;
    App.openModal(`
      <div class="modal-title" style="color:var(--red);">🗑️ Delete Forever</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:14px;">
        This will permanently delete the deal and all associated checklist items, tasks, commissions,
        activity log entries, and approval queue entries. <strong style="color:var(--red);">This cannot be undone.</strong>
      </div>
      <div style="background:var(--bg);padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:13px;">
        <div class="fw-700">${App.esc(rec.client_name||'—')}</div>
        <div style="color:var(--text2);">${App.esc(rec.property_address||'—')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Type <strong style="color:var(--red);">DELETE</strong> to confirm</label>
        <input class="form-input" id="del-confirm-input" placeholder="DELETE" autocomplete="off"
               oninput="document.getElementById('del-confirm-btn').disabled = this.value !== 'DELETE';">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button id="del-confirm-btn" class="btn btn-red" disabled onclick="Pipeline.deleteForever('${id}')">🗑️ Delete Forever</button>
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
      </div>
    `);
    setTimeout(() => document.getElementById('del-confirm-input')?.focus(), 50);
  },

  async deleteForever(id) {
    const input = document.getElementById('del-confirm-input')?.value;
    if (input !== 'DELETE') { App.toast('⚠️ You must type DELETE to confirm'); return; }
    const rec = Pipeline.archived?.find(x => x.id === id);
    if (!rec) { App.closeModal(); return; }

    // Cascade delete in dependency order. Each step is best-effort: if a table
    // does not have a matching FK column we swallow the error and continue,
    // so a missing column does not block the final pipeline-row delete.
    const safe = async (label, fn) => {
      try { await fn(); }
      catch (e) { console.warn(`[deleteForever] ${label} skipped:`, e?.message || e); }
    };

    // 1. checklist_items (by pipeline_id)
    await safe('checklist_items', () =>
      db.from('checklist_items').delete().eq('pipeline_id', id));

    // 2. pipeline_tasks (by pipeline_id)
    await safe('pipeline_tasks', () =>
      db.from('pipeline_tasks').delete().eq('pipeline_id', id));

    // 3. commissions (matched by agent + property address — same shape as closeDeal)
    if (rec.property_address) {
      await safe('commissions', () =>
        db.from('commissions').delete()
          .eq('agent_id', currentAgent.id)
          .eq('property_address', rec.property_address));
    }

    // 4. activity_log (best-effort: by client_id)
    if (rec.client_id) {
      await safe('activity_log', () =>
        db.from('activity_log').delete()
          .eq('agent_id', currentAgent.id)
          .eq('client_id', rec.client_id));
    }

    // 5. approval_queue (best-effort: by agent + client email)
    if (rec.client_email) {
      await safe('approval_queue', () =>
        db.from('approval_queue').delete()
          .eq('agent_id', currentAgent.id)
          .eq('client_email', rec.client_email));
    }

    // 6. pipeline row itself — this is the only step whose error must surface.
    const { error } = await db.from('pipeline').delete().eq('id', id);
    if (error) {
      App.toast('⚠️ Delete failed: ' + (error.message || 'unknown error'), 'var(--red)');
      return;
    }

    App.closeModal();
    App.toast('🗑️ Deal permanently deleted');
    Pipeline.loadArchive();
    if (App.loadOverview) App.loadOverview();
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
      <button class="btn btn-primary btn-block" onclick="Pipeline.updateStage('${d.id}')">Update Stage</button>
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
        ${p.email && p.role !== 'Agent' ? `<button style="background:var(--accent-soft);border:1px solid var(--accent);color:var(--accent);cursor:pointer;font-size:12px;padding:4px 10px;border-radius:6px;font-weight:600;margin-right:6px;" onclick="Pipeline.sendPortalLink(${i})" title="Send portal link">🔗 Portal</button>` : ''}
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

  async sendPortalLink(idx) {
    const id = Pipeline._roomId;
    if (!id) return;
    const d = Pipeline.all.find(x => x.id === id);
    if (!d) return;
    const parties = JSON.parse(localStorage.getItem(`df-room-${id}`) || '[]');
    const p = parties[idx];
    if (!p || !p.email) { App.toast('WARN: This party has no email'); return; }

    const roleMap = {
      'Buyer': 'client', 'Seller': 'client',
      'Lawyer / Notary': 'lawyer',
      'Home Inspector': 'inspector',
      'Mortgage Broker': 'mortgage_broker',
      'Lender / Bank': 'mortgage_broker',
      'Appraiser': 'appraiser',
      'Insurance': 'insurance'
    };
    const dbRole = roleMap[p.role] || 'other';
    const rolePretty = p.role || 'Stakeholder';

    if (!confirm(`Send portal link to ${p.name} (${p.email})?\n\nThey will get a private, expiring link to view this deal's progress.`)) return;

    const { data, error } = await db.rpc('stakeholder_create', {
      p_pipeline_id: id,
      p_client_id:   d.client_id,
      p_agent_id:    currentAgent?.id,
      p_role:        dbRole,
      p_name:        p.name,
      p_email:       p.email,
      p_phone:       p.phone || null,
      p_notes:       null
    });
    if (error || !data?.ok) {
      console.error('stakeholder_create', error || data);
      App.toast(`Could not create portal link: ${error?.message || data?.error || 'unknown error'}`, 'var(--red)');
      return;
    }

    const portalUrl = data.portal_url;
    const subject = `Your deal portal — ${d.property_address || 'progress link'}`;
    const plainBody =
      `Hi ${p.name.split(' ')[0]},\n\n` +
      `I have set up a private progress portal for you on the ${d.property_address || 'deal'}.\n\n` +
      `View it here: ${portalUrl}\n\n` +
      `This link is private to you and expires in 90 days (auto-extends each time you visit). ` +
      `You can revoke it any time from the portal itself.\n\n` +
      `— Maxwell Delali Midodzi\neXp Realty · (709) 325-0545`;
    const html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1b1b1b;">' +
        '<div style="background:linear-gradient(135deg,#CC785C 0%,#B3654A 100%);color:#fff;padding:24px;border-radius:14px;margin-bottom:18px;">' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.85;margin-bottom:6px;">' + App.esc(rolePretty) + ' Portal</div>' +
          '<h1 style="margin:0 0 4px;font-size:22px;">Your deal portal is ready</h1>' +
          '<p style="margin:0;opacity:.92;font-size:14px;">' + App.esc(d.property_address || '') + '</p>' +
        '</div>' +
        '<p>Hi ' + App.esc(p.name.split(' ')[0]) + ',</p>' +
        '<p>I have set up a private progress portal so you can follow this deal in real time — milestones, dates, key documents, all in one place.</p>' +
        '<p style="text-align:center;margin:26px 0;"><a href="' + portalUrl + '" style="background:#CC785C;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block;">View your deal portal →</a></p>' +
        '<p style="font-size:13px;color:#6b6b6b;">🔒 This link is private to you and expires in 90 days. It auto-extends every time you visit. You can revoke it any time from the portal itself.</p>' +
        '<hr style="border:none;border-top:1px solid #e5e1da;margin:24px 0;">' +
        '<p style="font-size:13px;color:#6b6b6b;">— Maxwell Delali Midodzi<br>eXp Realty · <a href="tel:7093250545" style="color:#CC785C;">(709) 325-0545</a></p>' +
      '</div>';

    await Notify.queue(
      'Portal Invite',
      d.client_id,
      p.name,
      p.email,
      subject,
      plainBody,
      null,
      html
    );
    App.toast(`Portal invite for ${p.name} queued in Approvals`);
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

    // Document checklist with category groups, required/optional flags
    const CATS = [
      {
        name: 'Agreement & Offer',
        icon: '📄',
        docs: [
          { name: 'Accepted Offer to Purchase',          req: true  },
          { name: 'Counter-Offer / Amendment (if any)',  req: false },
          { name: 'Buyer Representation Agreement',      req: true  },
          { name: 'Schedule A — Additional Clauses',     req: false },
        ]
      },
      {
        name: 'Financial & Mortgage',
        icon: '🏦',
        docs: [
          { name: 'Mortgage Pre-Approval Letter',        req: true  },
          { name: 'Deposit Receipt / Proof of Funds',    req: true  },
          { name: 'Financing Condition Waiver',          req: false },
          { name: 'Mortgage Commitment Letter',          req: false },
        ]
      },
      {
        name: 'Inspection & Due Diligence',
        icon: '🔍',
        docs: [
          { name: 'Home Inspection Report',              req: true  },
          { name: 'Inspection Condition Waiver',         req: true  },
          { name: 'Septic / Well Inspection (if rural)', req: false },
          { name: 'Condo Status Certificate',            req: false },
        ]
      },
      {
        name: 'Title & Closing',
        icon: '🔑',
        docs: [
          { name: 'Title Search / Certificate',          req: true  },
          { name: 'Closing Statement / Adjustment Sheet',req: true  },
          { name: 'Final Walkthrough Confirmation',      req: true  },
          { name: 'Transfer / Deed of Land',             req: true  },
        ]
      },
      {
        name: 'Insurance & Additional',
        icon: '🛡️',
        docs: [
          { name: 'Home Insurance Binder / Proof',       req: true  },
          { name: 'UFFI / Insulation Warranty',          req: false },
          { name: 'Chattels & Fixtures List',            req: false },
          { name: 'Strata / HOA Docs (if applicable)',   req: false },
        ]
      }
    ];

    // Flatten for index-based storage
    const ALL_DOCS = CATS.flatMap(c => c.docs);
    const checked  = JSON.parse(localStorage.getItem(`df-room-docs-${id}`) || '[]');
    const reqTotal = ALL_DOCS.filter(d => d.req).length;
    const reqDone  = ALL_DOCS.filter((d, i) => d.req && checked.includes(i)).length;
    const allDone  = ALL_DOCS.filter((d, i) => checked.includes(i)).length;
    const pct      = reqTotal ? Math.round(reqDone / reqTotal * 100) : 0;

    // Progress header
    let html = `
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:700;color:var(--text);">${reqDone} of ${reqTotal} required docs completed</span>
          <span style="font-size:12px;color:var(--text2);">${allDone} / ${ALL_DOCS.length} total</span>
        </div>
        <div style="background:var(--border);border-radius:6px;height:6px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${pct===100?'var(--green)':pct>=60?'var(--accent)':'var(--accent2)'};border-radius:6px;transition:width .3s;"></div>
        </div>
      </div>`;

    let globalIdx = 0;
    for (const cat of CATS) {
      html += `<div class="rdoc-category">
        <div class="rdoc-cat-header">${cat.icon} ${cat.name}</div>`;
      cat.docs.forEach((doc, localIdx) => {
        const i = globalIdx++;
        const done = checked.includes(i);
        const badge = doc.req
          ? `<span class="rdoc-badge rdoc-req">Required</span>`
          : `<span class="rdoc-badge rdoc-opt">If Applicable</span>`;
        html += `
        <div class="room-doc-item ${done ? 'checked' : ''}" onclick="Pipeline.toggleDoc(${i})">
          <div class="rdoc-check ${done ? 'rdoc-check-done' : ''}">
            ${done ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
          </div>
          <div class="rdoc-body">
            <span class="rdoc-name ${done ? 'rdoc-name-done' : ''}">${App.esc(doc.name)}</span>
            ${badge}
          </div>
          <span class="rdoc-num">${(localIdx + 1).toString().padStart(2, '0')}</span>
        </div>`;
      });
      html += `</div>`;
    }
    el.innerHTML = html;
  },

  toggleDoc(idx) {
    const id = Pipeline._roomId;
    if (!id) return;
    const checked = JSON.parse(localStorage.getItem(`df-room-docs-${id}`) || '[]');
    const pos = checked.indexOf(idx);
    if (pos === -1) checked.push(idx); else checked.splice(pos, 1);
    localStorage.setItem(`df-room-docs-${id}`, JSON.stringify(checked));
    Pipeline.renderDocs();
  },

  // ── Client Portal ─────────────────────────────────────────────────────────
  async sharePortal(dealId) {
    const d = (Pipeline.all || []).find(x => x.id === dealId);
    if (!d) { App.toast('Deal not found', 'var(--red)'); return; }

    // Auto-link by name if the pipeline row was created without a client_id.
    // Self-heals legacy rows so Maxwell can send portal links to anyone in
    // the Pipeline tab without needing a SQL fix per client.
    if (!d.client_id) {
      const name = (d.client_name || '').trim();
      if (!name) {
        App.toast('This deal has no client name — cannot link portal', 'var(--red)');
        return;
      }
      let match = (typeof Clients !== 'undefined' && Clients.all)
        ? Clients.all.find(c => (c.full_name || '').trim().toLowerCase() === name.toLowerCase())
        : null;
      if (!match) {
        const { data: rows } = await db.from('clients')
          .select('id, full_name, email')
          .ilike('full_name', name)
          .limit(2);
        if (rows && rows.length === 1) match = rows[0];
        else if (rows && rows.length > 1) {
          App.toast(`⚠️ Multiple clients named "${name}" — link manually first`, 'var(--red)');
          return;
        }
      }
      if (!match) {
        App.toast(`⚠️ No client record found for "${name}" — add one in Clients first`, 'var(--red)');
        return;
      }
      const { error: linkErr } = await db.from('pipeline')
        .update({ client_id: match.id, updated_at: new Date().toISOString() })
        .eq('id', d.id);
      if (linkErr) { App.toast('Could not auto-link client: ' + linkErr.message, 'var(--red)'); return; }
      d.client_id = match.id;
      if (!d.client_email && match.email) d.client_email = match.email;
      App.toast(`🔗 Auto-linked deal to ${match.full_name}`, 'var(--green)');
    }

    App.toast('Creating portal link…');

    db.rpc('stakeholder_create', {
      p_pipeline_id: d.id,
      p_client_id:   d.client_id,
      p_agent_id:    (typeof currentAgent !== 'undefined' && currentAgent) ? currentAgent.id : null,
      p_role:        'client',
      p_name:        d.client_name || 'Client',
      p_email:       d.client_email || ((typeof currentAgent !== 'undefined' && currentAgent) ? currentAgent.email : 'no-email@example.com'),
      p_phone:       null,
      p_notes:       'Created from Pipeline → sharePortal modal'
    }).then(({ data, error }) => {
      if (error || !data || !data.ok) {
        const msg = (error && error.message) || (data && data.error) || 'Could not create portal link';
        App.toast(msg, 'var(--red)');
        return;
      }
      const url = data.portal_url;

      // If the client has an email on file, queue a branded portal-invite email
      // in Approvals (same pattern as Transaction Room → sendPortalLink).
      // Otherwise fall back to a Copy Link modal so Maxwell can share manually.
      const hasEmail = !!d.client_email;
      const clientFirst = (d.client_name || 'Client').split(' ')[0];
      const subject = `Your deal portal — ${d.property_address || 'progress link'}`;
      const plainBody =
        `Hi ${clientFirst},\n\n` +
        `I have set up a private progress portal for you on the ${d.property_address || 'deal'}.\n\n` +
        `View it here: ${url}\n\n` +
        `This link is private to you and expires in 90 days (auto-extends each time you visit). ` +
        `You can revoke it any time from the portal itself.\n\n` +
        `— Maxwell Delali Midodzi\neXp Realty · (709) 325-0545`;
      const html =
        '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1b1b1b;">' +
          '<div style="background:linear-gradient(135deg,#CC785C 0%,#B3654A 100%);color:#fff;padding:24px;border-radius:14px;margin-bottom:18px;">' +
            '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.85;margin-bottom:6px;">Client Portal</div>' +
            '<h1 style="margin:0 0 4px;font-size:22px;">Your deal portal is ready</h1>' +
            '<p style="margin:0;opacity:.92;font-size:14px;">' + App.esc(d.property_address || '') + '</p>' +
          '</div>' +
          '<p>Hi ' + App.esc(clientFirst) + ',</p>' +
          '<p>I have set up a private progress portal so you can follow this deal in real time — milestones, dates, key documents, all in one place.</p>' +
          '<p style="text-align:center;margin:26px 0;"><a href="' + url + '" style="background:#CC785C;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block;">View your deal portal →</a></p>' +
          '<p style="font-size:13px;color:#6b6b6b;">🔒 This link is private to you and expires in 90 days. It auto-extends every time you visit. You can revoke it any time from the portal itself.</p>' +
          '<hr style="border:none;border-top:1px solid #e5e1da;margin:24px 0;">' +
          '<p style="font-size:13px;color:#6b6b6b;">— Maxwell Delali Midodzi<br>eXp Realty · <a href="tel:7093250545" style="color:#CC785C;">(709) 325-0545</a></p>' +
        '</div>';

      if (hasEmail && typeof Notify !== 'undefined' && Notify.queue) {
        Notify.queue('Portal Invite', d.client_id, d.client_name, d.client_email, subject, plainBody, null, html)
          .then(() => App.toast(`📧 Portal invite for ${d.client_name} queued in Approvals`, 'var(--green)'))
          .catch(e => {
            console.error('Notify.queue portal invite', e);
            App.toast('⚠️ Could not queue invite — copy link manually', 'var(--red)');
          });
      } else {
        const safeUrl = url.replace(/'/g, "\\'");
        const noEmailNote = hasEmail
          ? ''
          : `<p style="font-size:12px;color:var(--yellow);margin:0 0 12px;">⚠️ This client has no email on file — copy the link and share it manually.</p>`;
        App.openModal(`
          <div class="modal-title">\u{1F517} Client Portal Link</div>
          <p style="font-size:13px;color:var(--text2);margin:10px 0 12px;">Share this link with <strong>${App.esc(d.client_name||'your client')}</strong>. They'll see deal status, key dates, and your contact info — no login required.</p>
          ${noEmailNote}
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;word-break:break-all;font-size:12px;color:var(--accent2);margin-bottom:14px;">${App.esc(url)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${safeUrl}').then(()=>App.toast('✅ Link copied!','var(--green)'))">Copy Link</button>
            <button class="btn btn-outline" onclick="window.open('${safeUrl}','_blank')">Preview</button>
          </div>
        `);
      }
    });
  },

  // ── RESEND EXISTING PORTAL LINK (with editable CC) ─────────────────────
  // Re-emails the already-issued portal link to the client + anyone added in CC.
  // Does NOT issue a new token. Existing link keeps working untouched.
  // Use case: forgot to CC the spouse/co-buyer the first time → click 📨 Resend
  // → enter the missing email in CC → both get the same email with the same URL.
  async resendPortal(dealId) {
    const d = (Pipeline.all || []).find(x => x.id === dealId);
    if (!d) { App.toast('Deal not found', 'var(--red)'); return; }
    if (!d.client_email) { App.toast('Client has no email on file — use 🔗 Portal first', 'var(--red)'); return; }

    // Look up the existing active client portal token for this deal.
    const { data: stake, error: stErr } = await db.from('deal_stakeholders')
      .select('token')
      .eq('pipeline_id', dealId)
      .eq('role', 'client')
      .is('revoked_at', null)
      .gt('token_expires', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (stErr) { App.toast('Lookup failed: ' + stErr.message, 'var(--red)'); return; }
    if (!stake || !stake.token) {
      App.toast('No active portal link found — click 🔗 Portal to create one first', 'var(--red)');
      return;
    }

    App.openModal(`
      <div class="modal-title">📨 Resend Portal Link</div>
      <p style="font-size:13px;color:var(--text2);margin:10px 0 14px;">
        Resend the <strong>same existing link</strong> to <strong>${App.esc(d.client_name||'your client')}</strong>.
        Add anyone you forgot to copy (spouse, co-buyer) in the CC field — they will receive the same link.
        <br><br>
        <span style="color:var(--accent2);">🔒 The existing link is not changed.</span>
      </p>
      <div class="form-group">
        <label class="form-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">To</label>
        <input class="form-input" id="rsd-to" value="${App.esc(d.client_email)}" style="font-size:13px;">
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">CC (comma-separated)</label>
        <input class="form-input" id="rsd-cc" placeholder="spouse@email.com, co-buyer@email.com" style="font-size:13px;">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="Pipeline._submitResendPortal('${dealId}','${stake.token}')">📧 Queue in Approvals</button>
      </div>
    `);
  },

  async _submitResendPortal(dealId, token) {
    const d = (Pipeline.all || []).find(x => x.id === dealId);
    if (!d) return;
    const toEmail = (document.getElementById('rsd-to')?.value || '').trim();
    const ccEmail = (document.getElementById('rsd-cc')?.value || '').trim() || null;
    if (!/^\S+@\S+\.\S+$/.test(toEmail)) { App.toast('⚠️ Valid To email required', 'var(--red)'); return; }

    const url = `${location.origin}/portal.html?t=${token}`;
    const clientFirst = (d.client_name || 'Client').split(' ')[0];
    const subject = `Reminder: your deal portal — ${d.property_address || 'progress link'}`;
    const plainBody =
      `Hi ${clientFirst},\n\n` +
      `Just resending the link to your private deal portal for ${d.property_address || 'your deal'}.\n\n` +
      `View it here: ${url}\n\n` +
      `This is the same private link as before — no new login. ` +
      `If you have already opened it, your previous bookmark still works.\n\n` +
      `— Maxwell Delali Midodzi\neXp Realty · (709) 325-0545`;
    const html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1b1b1b;">' +
        '<div style="background:linear-gradient(135deg,#CC785C 0%,#B3654A 100%);color:#fff;padding:24px;border-radius:14px;margin-bottom:18px;">' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.85;margin-bottom:6px;">Client Portal</div>' +
          '<h1 style="margin:0 0 4px;font-size:22px;">Your deal portal — reminder</h1>' +
          '<p style="margin:0;opacity:.92;font-size:14px;">' + App.esc(d.property_address || '') + '</p>' +
        '</div>' +
        '<p>Hi ' + App.esc(clientFirst) + ',</p>' +
        '<p>Just resending the link to your private progress portal. This is the same link as before — no new login.</p>' +
        '<p style="text-align:center;margin:26px 0;"><a href="' + url + '" style="background:#CC785C;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block;">View your deal portal →</a></p>' +
        '<p style="font-size:13px;color:#6b6b6b;">🔒 This is the same private link issued earlier. It auto-extends every time you visit.</p>' +
        '<hr style="border:none;border-top:1px solid #e5e1da;margin:24px 0;">' +
        '<p style="font-size:13px;color:#6b6b6b;">— Maxwell Delali Midodzi<br>eXp Realty · <a href="tel:7093250545" style="color:#CC785C;">(709) 325-0545</a></p>' +
      '</div>';

    try {
      // Direct insert into approval_queue (bypasses Notify.queue) so we can
      // tag context_data.is_resend = true. The Approvals dedup check at
      // js/extras.js will skip the 24h-block when this flag is present,
      // since a resend is intentional (Maxwell explicitly asked for it).
      const { data: { user } } = await db.auth.getUser();
      const agentId = user?.id || (typeof currentAgent !== 'undefined' && currentAgent ? currentAgent.id : null);
      if (!agentId) { App.toast('Not signed in', 'var(--red)'); return; }
      const safeHtml = btoa(unescape(encodeURIComponent(html)));
      const { error: qErr } = await db.from('approval_queue').insert({
        agent_id: agentId,
        client_name: d.client_name,
        client_email: toEmail,
        approval_type: 'Portal Invite',
        email_subject: subject,
        email_body: plainBody,
        status: 'Pending',
        context_data: { html: safeHtml, cc: ccEmail, is_resend: true }
      });
      if (qErr) throw qErr;
      App.closeModal();
      App.toast('✅ Resend queued in Approvals', 'var(--green)');
      if (typeof Approvals !== 'undefined') setTimeout(() => Approvals.load(), 500);
    } catch (e) {
      console.error('resend portal queue', e);
      App.toast('⚠️ Could not queue — try again', 'var(--red)');
    }
  },

  // ── PDF Deal Summary ──────────────────────────────────────────────────────
  exportPdf(dealId) {
    const d = (Pipeline.all || []).find(x => x.id === dealId);
    if (!d) { App.toast('Deal not found', 'var(--red)'); return; }

    const esc  = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const fmtD = s => s ? new Date(s+'T12:00:00').toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric',year:'numeric'}) : '—';
    const fmtM = n => n ? '$' + Number(n).toLocaleString() : '—';
    const today = new Date().toISOString().slice(0,10);

    const milestones = [
      { label: 'Offer Accepted',       icon: '✅', date: d.acceptance_date  },
      { label: 'Financing Condition',  icon: '🏦', date: d.financing_date   },
      { label: 'Inspection Condition', icon: '🔍', date: d.inspection_date  },
      { label: 'Final Walkthrough',    icon: '🚶', date: d.walkthrough_date },
      { label: 'Closing Day',          icon: '🔑', date: d.closing_date     }
    ];
    const done = milestones.filter(m => m.date && m.date <= today).length;
    const pct  = Math.round(done / milestones.length * 100);

    const msRows = milestones.map(m => {
      const isDone  = m.date && m.date <= today;
      const isToday = m.date === today;
      return `<tr>
        <td style="padding:8px 12px;font-size:13px;">${m.icon} ${m.label}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:${isDone?700:400};color:${isDone?'#10b981':isToday?'#f59e0b':'#374151'};">${fmtD(m.date)}</td>
        <td style="padding:8px 12px;font-size:12px;color:${isDone?'#10b981':'#9ca3af'};font-weight:700;">${isDone?'✓ Done':'Pending'}</td>
      </tr>`;
    }).join('');

    const agentName = currentAgent?.full_name || currentAgent?.name || 'Maxwell Midodzi';
    const agentEmail = currentAgent?.email || '';
    const agentPhone = currentAgent?.phone || '';
    const now = new Date().toLocaleDateString('en-CA',{month:'long',day:'numeric',year:'numeric'});

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Deal Summary — ${esc(d.client_name||'Deal')}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#111;padding:32px;}
      .header{display:flex;align-items:center;gap:14px;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #5b5bd6;}
      .logo{width:44px;height:44px;background:#5b5bd6;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#fff;}
      h1{font-size:22px;font-weight:800;color:#111;}
      .sub{font-size:12px;color:#6b7280;margin-top:2px;}
      .section{margin-bottom:24px;}
      .section-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:10px;}
      .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
      .info-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;}
      .info-lbl{font-size:10px;font-weight:700;text-transform:uppercase;color:#9ca3af;margin-bottom:3px;}
      .info-val{font-size:14px;font-weight:700;color:#111;}
      table{width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;}
      th{background:#f3f4f6;padding:9px 12px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;}
      tr:nth-child(even){background:#fff;}
      .prog-bar{height:8px;background:#e5e7eb;border-radius:8px;overflow:hidden;margin:6px 0;}
      .prog-fill{height:100%;background:#5b5bd6;border-radius:8px;}
      .agent-box{display:flex;align-items:center;gap:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;}
      .agent-av{width:42px;height:42px;border-radius:50%;background:#5b5bd6;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:800;}
      .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;}
      @media print{body{padding:20px;}button{display:none;}}
    </style>
    </head><body>
    <div class="header">
      <div class="logo">MD</div>
      <div>
        <h1>${esc(d.client_name||'Deal Summary')}</h1>
        <div class="sub">📍 ${esc(d.property_address||'—')} · Stage: ${esc(d.stage||'—')} · Generated ${now}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Deal Overview</div>
      <div class="info-grid">
        <div class="info-box"><div class="info-lbl">Offer Amount</div><div class="info-val">${fmtM(d.offer_amount)}</div></div>
        <div class="info-box"><div class="info-lbl">Stage</div><div class="info-val">${esc(d.stage||'—')}</div></div>
        <div class="info-box"><div class="info-lbl">Deposit Paid</div><div class="info-val">${d.deposit_paid?'Yes':'No'}</div></div>
        <div class="info-box">
          <div class="info-lbl">Progress (${pct}%)</div>
          <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;"></div></div>
          <div style="font-size:11px;color:#6b7280;">${done} of ${milestones.length} milestones</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Milestone Dates</div>
      <table><thead><tr><th>Milestone</th><th>Date</th><th>Status</th></tr></thead><tbody>${msRows}</tbody></table>
    </div>

    <div class="section">
      <div class="section-title">Your Agent</div>
      <div class="agent-box">
        <div class="agent-av">${(agentName||'MA').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
        <div>
          <div style="font-size:14px;font-weight:700;">${esc(agentName)}</div>
          <div style="font-size:12px;color:#6b7280;">eXp Realty${agentEmail?' · '+esc(agentEmail):''}${agentPhone?' · '+esc(agentPhone):''}</div>
        </div>
      </div>
    </div>

    <div class="footer">Generated by Maxwell DealFlow CRM · Confidential</div>

    <div style="text-align:center;margin-top:20px;">
      <button onclick="window.print()" style="padding:10px 24px;background:#5b5bd6;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">🖨️ Print / Save PDF</button>
    </div>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }
};

// ── PENDING REQUESTS (client offer submissions from respond page) ────────────
const PendingRequests = {
  all: [],

  async load() {
    if (!currentAgent?.id) return;
    const el = document.getElementById('requests-list');
    if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';
    const { data } = await db.from('pending_offers')
      .select('*')
      .eq('agent_id', currentAgent.id)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false });
    PendingRequests.all = data || [];
    PendingRequests.render(PendingRequests.all);
    PendingRequests._updateBadge(PendingRequests.all.length);
  },

  async loadBadge() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('pending_offers')
      .select('id')
      .eq('agent_id', currentAgent.id)
      .eq('status', 'Pending');
    PendingRequests._updateBadge((data || []).length);
  },

  _updateBadge(count) {
    const badge = document.getElementById('requests-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  },

  render(list) {
    const el = document.getElementById('requests-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📬</div><div class="empty-text">No pending requests</div><div class="empty-sub">Client offer requests from your viewing links will appear here</div></div>`;
      return;
    }
    el.innerHTML = list.map(r => `
      <div class="card" style="margin-bottom:10px;border-left:3px solid var(--accent2);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div class="fw-700" style="font-size:14px;flex:1;margin-right:8px;">${r.property_address || '—'}</div>
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;background:var(--bg2);color:var(--accent2);">New</span>
        </div>
        <div class="text-muted" style="font-size:12px;margin-bottom:4px;">👤 ${r.client_name || '—'}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px;">
          <span class="text-accent fw-700">${r.offer_amount ? App.fmtMoney(r.offer_amount) : 'No amount given'}</span>
          <span class="text-muted">${App.fmtDate((r.created_at||'').slice(0,10))}</span>
        </div>
        ${r.client_note ? `<div style="background:var(--bg);border-radius:6px;padding:8px;font-size:12px;color:var(--text2);margin-bottom:8px;">💬 "${App.esc(r.client_note)}"</div>` : ''}
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" onclick="PendingRequests.prepare('${r.id}')">📄 Prepare Offer →</button>
          <button class="btn btn-outline btn-sm" onclick="PendingRequests.dismiss('${r.id}')">✕ Dismiss</button>
        </div>
      </div>`).join('');
  },

  async prepare(id) {
    const r = PendingRequests.all.find(x => x.id === id);
    if (!r) return;
    await db.from('pending_offers').update({ status: 'Processing', updated_at: new Date().toISOString() }).eq('id', id);
    Offers._showForm(r.client_id, r.client_name);
    setTimeout(() => {
      const addr = document.getElementById('of-address');
      const amt  = document.getElementById('of-amount');
      const lp   = document.getElementById('of-listprice');
      if (addr) addr.value = r.property_address || '';
      if (amt)  amt.value  = r.offer_amount || '';
      if (lp)   lp.value   = r.list_price || '';
    }, 150);
    PendingRequests.load();
  },

  async dismiss(id) {
    await db.from('pending_offers').update({ status: 'Dismissed', updated_at: new Date().toISOString() }).eq('id', id);
    PendingRequests.load();
  }
};
