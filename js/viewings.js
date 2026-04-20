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
    // Phase 2.B.3: viewing status → pill2 variant
    const statusPill = {
      Scheduled: 'pill2-indigo',
      Confirmed: 'pill2-green',
      Completed: 'pill2-neutral',
      Cancelled: 'pill2-coral'
    };
    const fb = (x) => x === 'good' ? '✅ Good' : x === 'interested' ? '🌟 Interested' : '❌ Not a fit';
    el.innerHTML = list.map(v => {
      const st = v.viewing_status || 'Scheduled';
      return `
      <div class="card2" style="margin-bottom:10px;">
        <div class="card2-header" style="margin-bottom:6px;cursor:pointer;" onclick="Viewings.openDetail('${v.id}')">
          <div class="card2-title" style="flex:1;margin-right:8px;">${v.property_address || 'No address'}</div>
          <span class="pill2 ${statusPill[st]||'pill2-neutral'}">${st}</span>
        </div>
        <div class="card2-sub" style="margin-bottom:8px;cursor:pointer;" onclick="Viewings.openDetail('${v.id}')">👤 ${App.privateName(v.clients?.full_name || '')}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;cursor:pointer;" onclick="Viewings.openDetail('${v.id}')">
          <span style="color:var(--text2);">📅 ${App.fmtDate(v.viewing_date)} ${v.viewing_time ? '· ' + v.viewing_time.slice(0,5) : ''}</span>
          ${v.list_price ? `<span style="color:var(--accent2);font-weight:700;">${App.fmtMoney(v.list_price)}</span>` : ''}
        </div>
        ${v.client_feedback ? `<div style="margin-top:8px;"><span class="pill2 pill2-neutral">${fb(v.client_feedback)}</span></div>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">
          <button class="btn2 btn2-ghost btn2-sm" style="flex:1;justify-content:center;" onclick="Viewings.openDetail('${v.id}')">✏️ Details</button>
          <button class="btn2 btn2-sm" style="background:var(--red);color:#fff;" onclick="Viewings.deleteViewing('${v.id}')">🗑 Delete</button>
        </div>
      </div>`;
    }).join('');
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
        <div class="form-group">
          <label class="form-label">Duration</label>
          <select class="form-input form-select" id="vf-duration">
            <option value="10" ${viewing?.viewing_duration===10?'selected':''}>10 minutes</option>
            <option value="15" ${viewing?.viewing_duration===15?'selected':''}>15 minutes</option>
            <option value="30" ${(!viewing?.viewing_duration||viewing?.viewing_duration===30)?'selected':''}>30 minutes</option>
            <option value="45" ${viewing?.viewing_duration===45?'selected':''}>45 minutes</option>
            <option value="60" ${viewing?.viewing_duration===60?'selected':''}>1 hour</option>
            <option value="90" ${viewing?.viewing_duration===90?'selected':''}>1.5 hours</option>
            <option value="120" ${viewing?.viewing_duration===120?'selected':''}>2 hours</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">CC Email (optional — e.g. second buyer, co-purchaser)</label>
        <input class="form-input" id="vf-cc" type="email" placeholder="other@email.com" value="${viewing?.cc_email||''}">
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
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Offer Due Date</label>
          <input class="form-input" id="vf-offer-date" type="date" value="${viewing?.offer_due_date||''}">
        </div>
        <div class="form-group">
          <label class="form-label">Offer Due Time</label>
          <input class="form-input" id="vf-offer-time" type="time" value="${viewing?.offer_due_time||''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Seller's Direction</label>
        <select class="form-input form-select" id="vf-sellers-dir">
          <option value="" ${!viewing?.sellers_direction?'selected':''}>-- Not specified --</option>
          <option value="Offers anytime" ${viewing?.sellers_direction==='Offers anytime'?'selected':''}>Offers anytime</option>
          <option value="Offer date set" ${viewing?.sellers_direction==='Offer date set'?'selected':''}>Offer date set</option>
          <option value="No conveyance" ${viewing?.sellers_direction==='No conveyance'?'selected':''}>No conveyance</option>
          <option value="Seller reviewing offers" ${viewing?.sellers_direction==='Seller reviewing offers'?'selected':''}>Seller reviewing offers</option>
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
      viewing_duration: parseInt(document.getElementById('vf-duration')?.value || '30'),
      cc_email: document.getElementById('vf-cc')?.value.trim() || null,
      offer_due_date: document.getElementById('vf-offer-date').value || null,
      offer_due_time: document.getElementById('vf-offer-time').value || null,
      sellers_direction: document.getElementById('vf-sellers-dir').value || null,
      viewing_status: document.getElementById('vf-vstatus')?.value || 'Scheduled',
      agent_notes: document.getElementById('vf-notes').value.trim(),
      client_feedback: document.getElementById('vf-feedback').value || null,
      updated_at: new Date().toISOString()
    };

    // Snapshot old cc_email before update (to detect if CC was just added)
    const oldViewing = existingId ? Viewings.all.find(v => v.id === existingId) : null;

    let error;
    if (existingId) {
      ({ error } = await db.from('viewings').update(payload).eq('id', existingId));
      if (!error) {
        // Re-send confirmation as "Update" email if client has an email on file
        if (typeof Notify !== 'undefined' && client?.email) {
          const updatedViewing = { ...oldViewing, ...payload, id: existingId };
          await Notify.onViewingBooked(updatedViewing, client, true); // true = isUpdate
        }
      }
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
        // ── AUTO-QUEUE VIEWING CONFIRMATION EMAIL FOR APPROVAL ────────────
        // Fetch the newly inserted viewing so we have its id for dedup
        const { data: newViewing } = await db.from('viewings')
          .select('*')
          .eq('client_id', clientId)
          .eq('property_address', address)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (typeof Notify !== "undefined" && newViewing) {
          await Notify.onViewingBooked(newViewing, client);
        }
      }
    }
    // If feedback was added on update, queue follow-up
    if (existingId && !error && payload.client_feedback && typeof Notify !== "undefined") {
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
        ${v.offer_due_date?`<div style="background:var(--bg);padding:8px;border-radius:8px;grid-column:span 2;"><div style="font-size:10px;font-weight:700;color:var(--accent2);text-transform:uppercase;">⏰ Offers Due</div><div class="fw-700">${App.fmtDate(v.offer_due_date)}${v.offer_due_time?' at '+v.offer_due_time.slice(0,5):''}</div></div>`:''}
        ${v.sellers_direction?`<div style="background:var(--bg);padding:8px;border-radius:8px;grid-column:span 2;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Seller's Direction</div><div class="fw-700">${v.sellers_direction}</div></div>`:''}
      </div>
      ${v.agent_notes ? `<div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:12px;font-size:13px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">📝 Notes</div>${App.esc(v.agent_notes)}</div>` : ''}
      ${feedbackSection}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
        ${!isCompleted ? `<button class="btn btn-primary" onclick="Viewings.markCompleted('${v.id}')">✅ Mark Completed</button>` : ''}
        ${v.client_feedback === 'interested' ? `<button class="btn btn-green" onclick="App.closeModal();setTimeout(()=>Offers.openAddForClient('${v.client_id}','${clientName}'),300)">📄 Prepare Offer</button>` : ''}
        <button class="btn btn-outline" onclick="App.closeModal();setTimeout(()=>Viewings._showForm('${v.client_id}','',${JSON.stringify(v).replace(/"/g,'&quot;')}),300)">✏️ Edit</button>
        <button class="btn btn-red" onclick="Viewings.deleteViewing('${v.id}')">🗑 Delete</button>
      </div>
      ${isCompleted ? `
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:8px;">📞 Manual Override — Client Called You?</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">Record the client's decision manually. This will expire any pending email response link.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button class="btn btn-sm" style="background:var(--green);color:#fff;" onclick="Viewings.manualOverride('${v.id}','make_offer')">🏠 Make Offer</button>
          <button class="btn btn-sm btn-outline" onclick="Viewings.manualOverride('${v.id}','continue_searching')">🔍 Keep Searching</button>
          <button class="btn btn-sm btn-outline" style="border-color:var(--red);color:var(--red);" onclick="Viewings.manualOverride('${v.id}','not_a_fit')">❌ Not a Fit</button>
          <button class="btn btn-sm btn-outline" onclick="Viewings.manualOverride('${v.id}','rescheduled')">📅 Reschedule</button>
        </div>
      </div>` : ''}
    `);
  },

  async markCompleted(id) {
    await db.from('viewings').update({ viewing_status: 'Completed', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('✅ Viewing marked completed');
    await Viewings.load();
    App.closeModal();
    // Show agent feedback modal — how did the viewing go?
    setTimeout(() => Viewings.agentFeedbackModal(id), 400);
  },

  // ── AGENT FEEDBACK MODAL ─────────────────────────────────────────────────
  // Fires right after agent taps "Mark Completed" — collects how it went
  agentFeedbackModal(id) {
    const v = Viewings.all.find(x => x.id === id) || {};
    const client = Clients.all.find(c => c.id === v.client_id);
    const clientName = client?.full_name || v.client_name || 'Client';
    App.openModal(`
      <div style="font-size:16px;font-weight:800;margin-bottom:4px;">🏠 How did the viewing go?</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:20px;">${clientName} · ${v.property_address || '—'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <button class="btn btn-primary" style="padding:14px 8px;font-size:14px;font-weight:700;"
          onclick="Viewings.confirmOffer('${id}')">✅ Good</button>
        <button class="btn btn-outline" style="padding:14px 8px;font-size:14px;"
          onclick="Viewings.manualOverride('${id}','rescheduled')">📅 Reschedule</button>
        <button class="btn btn-outline" style="padding:14px 8px;font-size:14px;border-color:var(--red);color:var(--red);"
          onclick="Viewings.manualOverride('${id}','not_a_fit')">❌ Pass</button>
        <button class="btn btn-outline" style="padding:14px 8px;font-size:14px;"
          onclick="Viewings.manualOverride('${id}','continue_searching')">🔍 Keep Searching</button>
      </div>
    `);
  },

  // ── OFFER CONFIRMATION MODAL ──────────────────────────────────────────────
  // Fires when agent taps "Good" — asks if they want to send offer invitation
  confirmOffer(id) {
    const v = Viewings.all.find(x => x.id === id) || {};
    const client = Clients.all.find(c => c.id === v.client_id);
    const clientName = client?.full_name || v.client_name || 'Client';
    const firstName = clientName.split(' ')[0];
    App.openModal(`
      <div style="font-size:16px;font-weight:800;margin-bottom:4px;">🌟 Great viewing!</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:20px;">Is ${firstName} ready to move forward with an offer?</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <button class="btn btn-primary" style="padding:14px 8px;font-size:14px;font-weight:700;"
          onclick="Viewings.recordFeedback('${id}','interested')">🏠 Yes — Send Offer Invitation</button>
        <button class="btn btn-outline" style="padding:14px 8px;font-size:14px;"
          onclick="Viewings.recordFeedback('${id}','good')">🔍 No — Keep Searching</button>
      </div>
    `);
  },

  async recordFeedback(id, feedback) {
    await db.from('viewings').update({ client_feedback: feedback, updated_at: new Date().toISOString() }).eq('id', id);
    const v = Viewings.all.find(x => x.id === id) || {};
    const client = Clients.all.find(c => c.id === v.client_id);
    const clientObj = { ...client, email: client?.email || '(no email on file)' };
    const firstName = clientObj.full_name?.split(' ')[0] || 'your client';

    if (typeof Notify !== "undefined") {
      // Queue follow-up email and immediately auto-approve it — no manual Approvals stop
      await Notify.onViewingFeedback({...v, client_feedback: feedback}, clientObj, feedback);
      // Find the queued row and approve it right away
      const { data: { user } } = await db.auth.getUser();
      const agentId = user?.id || currentAgent?.id;
      if (agentId) {
        const { data: queued } = await db.from('approval_queue')
          .select('id').eq('agent_id', agentId).eq('status', 'Pending')
          .eq('approval_type', 'Post-Viewing Follow-Up').eq('related_id', id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (queued?.id && typeof Approvals !== 'undefined') {
          setTimeout(() => Approvals.approve(queued.id), 500);
        }
      }

      if (feedback === 'interested') {
        // Generate a unique response token so client can respond via the web page
        const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days
        await db.from('viewing_responses').insert({
          viewing_id: id,
          client_id: v.client_id,
          agent_id: agentId || null,
          property_address: v.property_address || null,
          list_price: v.list_price || null,
          mls_number: v.mls_number || null,
          client_name: clientObj.full_name || null,
          client_email: clientObj.email || null,
          token,
          expires_at: expiresAt,
          expired: false
        });
        const viewingWithToken = { ...v, client_feedback: feedback, _responseToken: token };
        await Notify.onReadyToOffer(viewingWithToken, clientObj);
        // Auto-approve the "Ready to Make an Offer?" email too
        if (agentId) {
          const { data: offerQ } = await db.from('approval_queue')
            .select('id').eq('agent_id', agentId).eq('status', 'Pending')
            .eq('approval_type', 'Ready to Make an Offer?').eq('related_id', id)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (offerQ?.id && typeof Approvals !== 'undefined') {
            setTimeout(() => Approvals.approve(offerQ.id), 1200);
          }
        }
      }
    }

    // Show contextual toast with what just happened — no "check Approvals" needed
    const toastMsg = feedback === 'interested'
      ? `🌟 ${firstName} — follow-up + offer invitation sent automatically`
      : feedback === 'good'
      ? `✅ ${firstName} — follow-up email sent automatically`
      : `📬 ${firstName} — "keep searching" email sent automatically`;
    App.toast(toastMsg, 'var(--green)');

    await Viewings.load();
    App.closeModal();

    if (feedback !== 'interested') {
      setTimeout(() => Viewings.openDetail(id), 400);
    }
  },

  // Manual override — agent records client decision without waiting for email response
  async manualOverride(viewingId, decision) {
    const decisions = {
      make_offer: { client_response: 'make_offer', client_feedback: 'interested' },
      continue_searching: { client_response: 'continue_searching', client_feedback: 'good' },
      not_a_fit: { client_response: 'not_a_fit', client_feedback: 'pass' },
      cancelled: { viewing_status: 'Cancelled', client_feedback: null },
      rescheduled: { viewing_status: 'Rescheduled', client_feedback: null }
    };
    const update = decisions[decision];
    if (!update) return;

    // Expire any open response tokens for this viewing
    await db.from('viewing_responses').update({ expired: true }).eq('viewing_id', viewingId).eq('expired', false);

    await db.from('viewings').update({ ...update, updated_at: new Date().toISOString() }).eq('id', viewingId);

    if (decision === 'make_offer') {
      const v = Viewings.all.find(x => x.id === viewingId) || {};
      const client = Clients.all.find(c => c.id === v.client_id);
      await Viewings.load();
      App.closeModal();
      // Open full manual offer entry modal
      setTimeout(() => Viewings.openManualOfferModal(v, client), 300);
      return;
    } else if (decision === 'cancelled') {
      App.toast('❌ Viewing marked cancelled. Response link expired.');
    } else if (decision === 'rescheduled') {
      App.toast('📅 Viewing marked for rescheduling. Response link expired.');
    } else {
      App.toast('✅ Decision recorded manually. Response link expired.');
    }

    await Viewings.load();
    App.closeModal();
    if (typeof PendingOffers !== 'undefined') PendingOffers.load();
  },

  async deleteViewing(id) {
    if (!confirm('Delete this viewing? This cannot be undone.')) return;
    const { error } = await db.from('viewings').delete().eq('id', id);
    if (error) { App.toast('❌ Could not delete: ' + error.message, 'var(--red)'); return; }
    App.closeModal();
    App.toast('🗑 Viewing deleted');
    Viewings.load();
    App.loadOverview();
  },

  // ── MANUAL OFFER ENTRY MODAL ───────────────────────────────────────────────
  openManualOfferModal(v, client) {
    const clientName = client?.full_name || v.client_name || '—';
    const today = new Date().toISOString().slice(0, 10);
    App.openModal(`
      <div style="font-size:16px;font-weight:800;margin-bottom:4px;">📄 Log Offer Manually</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;">
        ${clientName} · ${v.property_address || '—'}
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">OFFER AMOUNT ($)</label>
          <input class="form-input" id="mo-offer-amt" type="number" placeholder="e.g. 430000" value="${v.list_price || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">ASKING / LIST PRICE ($)</label>
          <input class="form-input" id="mo-list-price" type="number" placeholder="e.g. 450000" value="${v.list_price || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">OFFER DATE</label>
          <input class="form-input" id="mo-offer-date" type="date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">OFFER STATUS</label>
          <select class="form-input form-select" id="mo-offer-status" onchange="
            const map = {Submitted:'In Offer',Accepted:'Accepted',Countered:'In Offer',Rejected:'In Offer'};
            const ps = document.getElementById('mo-pipeline-stage');
            if (ps) ps.value = map[this.value] || 'In Offer';
          ">
            <option value="Submitted">Submitted</option>
            <option value="Accepted">Accepted ✅</option>
            <option value="Countered">Countered 🔄</option>
            <option value="Rejected">Rejected ❌</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">CONDITIONS (optional)</label>
        <input class="form-input" id="mo-conditions" placeholder="e.g. Financing, Home Inspection">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">FINANCING DATE</label>
          <input class="form-input" id="mo-fin-date" type="date">
        </div>
        <div class="form-group">
          <label class="form-label">INSPECTION DATE</label>
          <input class="form-input" id="mo-ins-date" type="date">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">CLOSING DATE</label>
          <input class="form-input" id="mo-close-date" type="date">
        </div>
        <div class="form-group">
          <label class="form-label">PIPELINE STAGE</label>
          <select class="form-input form-select" id="mo-pipeline-stage">
            <option value="In Offer">In Offer</option>
            <option value="Accepted">Accepted</option>
            <option value="Conditions">Conditions</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>
      <div style="background:var(--bg2);border-radius:8px;padding:12px;margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--accent2);text-transform:uppercase;margin-bottom:10px;">🏦 Deposit Cheque — Due to Seller's Agent Within 24 Hours</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">DEPOSIT AMOUNT ($)</label>
            <input class="form-input" id="mo-deposit-amt" type="number" placeholder="e.g. 5000">
          </div>
          <div class="form-group">
            <label class="form-label">DEPOSIT DUE BY</label>
            <input class="form-input" id="mo-deposit-due" type="datetime-local">
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;">
          <input type="checkbox" id="mo-deposit-sent" style="width:16px;height:16px;cursor:pointer;">
          <label for="mo-deposit-sent" style="cursor:pointer;">Deposit already sent ✅</label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">NOTES</label>
        <input class="form-input" id="mo-notes" placeholder="e.g. Seller accepted at asking, waived inspection">
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" style="flex:1;" onclick="Viewings.submitManualOffer('${v.id}','${client?.id || ''}','${clientName.replace(/'/g,"\\'")}','${v.property_address?.replace(/'/g,"\\'") || ''}','${client?.email || ''}')">
          🚀 Save Offer &amp; Add to Pipeline
        </button>
      </div>
      <div id="mo-status" style="font-size:13px;text-align:center;margin-top:8px;"></div>
    `);
  },

  async submitManualOffer(viewingId, clientId, clientName, propertyAddress, clientEmail) {
    const st = document.getElementById('mo-status');
    if (st) { st.textContent = 'Saving...'; st.style.color = 'var(--text2)'; }

    const offerAmt   = parseFloat(document.getElementById('mo-offer-amt')?.value) || 0;
    const listPrice  = parseFloat(document.getElementById('mo-list-price')?.value) || 0;
    const offerDate  = document.getElementById('mo-offer-date')?.value || null;
    const offerStatus = document.getElementById('mo-offer-status')?.value || 'Submitted';
    const conditions = document.getElementById('mo-conditions')?.value?.trim() || null;
    const finDate    = document.getElementById('mo-fin-date')?.value || null;
    const insDate    = document.getElementById('mo-ins-date')?.value || null;
    const closeDate  = document.getElementById('mo-close-date')?.value || null;
    const pipeStage  = document.getElementById('mo-pipeline-stage')?.value || 'In Offer';
    const notes      = document.getElementById('mo-notes')?.value?.trim() || null;
    const depositAmt  = parseFloat(document.getElementById('mo-deposit-amt')?.value) || null;
    const depositDue  = document.getElementById('mo-deposit-due')?.value
      ? new Date(document.getElementById('mo-deposit-due').value).toISOString()
      : (offerStatus === 'Accepted' && offerDate
          ? new Date(new Date(offerDate + 'T12:00:00').getTime() + 24 * 60 * 60 * 1000).toISOString()
          : null);
    const depositSent = document.getElementById('mo-deposit-sent')?.checked || false;

    if (!offerAmt) {
      if (st) { st.textContent = '⚠️ Please enter an offer amount'; st.style.color = 'var(--red)'; }
      return;
    }

    // 1. Save to offers table
    const { data: offer, error: offerErr } = await db.from('offers').insert({
      agent_id: currentAgent.id,
      client_id: clientId || null,
      client_name: clientName,
      property_address: propertyAddress,
      list_price: listPrice || null,
      offer_amount: offerAmt,
      offer_date: offerDate,
      status: offerStatus,
      conditions: conditions,
      notes: notes,
    }).select().maybeSingle();

    if (offerErr) {
      if (st) { st.textContent = '❌ ' + offerErr.message; st.style.color = 'var(--red)'; }
      return;
    }

    // 2. Upsert pipeline entry
    const { data: existing } = await db.from('pipeline')
      .select('id').eq('agent_id', currentAgent.id)
      .ilike('client_name', clientName).limit(1).maybeSingle();

    const pipelineData = {
      agent_id: currentAgent.id,
      client_name: clientName,
      client_id: clientId || null,
      client_email: clientEmail || null,
      property_address: propertyAddress,
      offer_amount: offerAmt,
      stage: pipeStage,
      status: 'Active',
      financing_deadline: finDate || null,
      inspection_deadline: insDate || null,
      closing_date: closeDate || null,
      deposit_amount: depositAmt,
      deposit_due_date: depositDue,
      deposit_sent: depositSent,
      deposit_sent_at: depositSent ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    let pipelineErr = null;
    if (existing?.id) {
      const { error: updErr } = await db.from('pipeline').update(pipelineData).eq('id', existing.id);
      pipelineErr = updErr;
    } else {
      pipelineData.pipeline_id = 'OFFER-' + Date.now();
      pipelineData.acceptance_date = offerDate;
      const { error: insErr } = await db.from('pipeline').insert(pipelineData);
      pipelineErr = insErr;
    }
    if (pipelineErr) {
      if (st) { st.textContent = '❌ Pipeline error: ' + pipelineErr.message; st.style.color = 'var(--red)'; }
      return;
    }

    // 3. Queue email(s) for approval
    if (clientEmail && typeof Notify !== 'undefined') {
      const agent = currentAgent;
      const clientObj = { id: clientId || null, full_name: clientName, email: clientEmail };
      const offerObj = {
        property_address: propertyAddress,
        offer_amount: offerAmt,
        list_price: listPrice,
        offer_date: offerDate,
        conditions,
        financing_date: finDate,
        inspection_date: insDate,
        closing_date: closeDate,
        deposit_amount: depositAmt,
        deposit_due_date: depositDue,
        deposit_sent: depositSent,
      };

      if (offerStatus === 'Accepted') {
        // Offer accepted — queue the rich checklist email with all next steps
        await Notify.onOfferAcceptedWithChecklist(offerObj, clientObj, offer?.id || null);
      } else {
        // Offer submitted / countered / rejected — queue standard submitted email
        const tmpl = Notify.templates.offer_submitted(clientObj, offerObj, agent);
        await Notify.queue('Offer Submitted', clientId || null, clientName, clientEmail, tmpl.subject, tmpl.body, offer?.id || null);
      }
    }

    if (st) { st.textContent = '✅ Saved!'; st.style.color = 'var(--green)'; }
    App.toast(`✅ Offer logged & ${clientName} added to Pipeline (${pipeStage})`, 'var(--green)');

    setTimeout(() => {
      App.closeModal();
      Viewings.load();
      App.loadOverview();
      if (typeof Pipeline !== 'undefined') Pipeline.load();
      if (typeof Offers !== 'undefined') Offers.load?.();
    }, 600);
  },
};
