// Maxwell DealFlow CRM — New Builds Module
// Tracks new construction builds with stage-by-stage progress updates.
// Each stage update: queues approval email to client (+ CC) + moves pipeline deal stage.

const NewBuilds = {
  all: [],

  FIXED_STAGES: [
    { key: 'deposit',           label: 'Deposit Paid',           dateField: 'deposit_date' },
    { key: 'pa_submitted',      label: 'Purchase Agreement',     dateField: 'pa_submitted_date' },
    { key: 'lot_identified',    label: 'Lot Identified',         dateField: 'lot_identified_date' },
    { key: 'lot_offer',         label: 'Lot Offer Accepted',     dateField: 'lot_offer_date' },
    { key: 'design_selections', label: 'Design Selections',      dateField: 'design_selections_date' },
    { key: 'construction_start',label: 'Construction Started',   dateField: 'construction_start_date' },
    { key: 'framing',           label: 'Framing',                dateField: 'framing_date' },
    { key: 'drywall',           label: 'Drywall',                dateField: 'drywall_date' },
    { key: 'finishes',          label: 'Finishes & Fixtures',    dateField: 'finishes_date' },
    { key: 'walkthrough',       label: 'Final Walkthrough',      dateField: 'walkthrough_date' },
    { key: 'closing',           label: 'Closing / Possession',   dateField: 'closing_date' },
  ],

  // Pipeline stage map: build stage → pipeline deal stage
  PIPELINE_MAP: {
    'Deposit Paid':          'Accepted',
    'Purchase Agreement':    'Accepted',
    'Lot Identified':        'Accepted',
    'Lot Offer Accepted':    'Accepted',
    'Design Selections':     'Conditions',
    'Construction Started':  'Conditions',
    'Framing':               'Conditions',
    'Drywall':               'Conditions',
    'Finishes & Fixtures':   'Walkthrough',
    'Final Walkthrough':     'Walkthrough',
    'Closing / Possession':  'Closed',
  },

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('new_builds')
      .select('*, clients(full_name, email)')
      .eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    NewBuilds.all = data || [];
    NewBuilds.render(NewBuilds.all);
  },

  render(list) {
    const el = document.getElementById('newbuilds-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🏗️</div><div class="empty-text">No new builds yet</div><div class="empty-sub">Tap + New Build to add a construction project</div></div>`;
      return;
    }

    el.innerHTML = list.map(b => {
      const stageIdx = NewBuilds.FIXED_STAGES.findIndex(s => s.label === b.current_stage);
      const total = NewBuilds.FIXED_STAGES.length;
      const done = stageIdx >= 0 ? stageIdx : 0;
      const pct = Math.round((done / total) * 100);

      return `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;" onclick="NewBuilds.openDetail('${b.id}')">
            <div class="fw-700" style="font-size:14px;flex:1;margin-right:8px;cursor:pointer;">${b.lot_address || 'No address'}</div>
            <span style="font-size:11px;font-weight:700;color:var(--accent);">${b.current_stage || 'No stage'}</span>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:8px;cursor:pointer;" onclick="NewBuilds.openDetail('${b.id}')">
            👤 ${b.clients?.full_name || b.client_name || '—'} &nbsp;•&nbsp; 🏗️ ${b.builder_name || '—'}
          </div>
          <!-- Progress bar -->
          <div style="height:6px;background:var(--bg2);border-radius:99px;overflow:hidden;margin-bottom:6px;">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--green),#34d399);border-radius:99px;"></div>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:10px;">${pct}% complete ${b.est_close_date ? '· Est. possession: ' + App.fmtDate(b.est_close_date) : ''}</div>
          <div style="display:flex;gap:8px;border-top:1px solid var(--border);padding-top:8px;">
            <button class="btn btn-primary btn-sm" style="flex:1;" onclick="NewBuilds.openDetail('${b.id}')">📋 Details</button>
            <button class="btn btn-sm" style="background:var(--accent2);color:#fff;" onclick="NewBuilds.updateStage('${b.id}')">🔄 Update Stage</button>
          </div>
        </div>`;
    }).join('');
  },

  openAdd() {
    NewBuilds._showForm(null);
  },

  async _showForm(build) {
    const clientOptions = Clients.all.map(c =>
      `<option value="${c.id}" ${c.id === build?.client_id ? 'selected' : ''}>${c.full_name}</option>`
    ).join('');

    App.openModal(`
      <div class="modal-title">🏗️ ${build ? 'Edit' : 'New'} Build</div>

      <div class="form-group">
        <label class="form-label">Client *</label>
        <select class="form-input form-select" id="nb-client">
          <option value="">-- Select Client --</option>
          ${clientOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Property / Lot Address *</label>
        <input class="form-input" id="nb-address" placeholder="15 Maple Drive, CBS, NL" value="${build?.lot_address || ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Builder Name</label>
          <input class="form-input" id="nb-builder" placeholder="Westcore Homes" value="${build?.builder_name || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Builder Contact</label>
          <input class="form-input" id="nb-builder-contact" placeholder="Phone or email" value="${build?.builder_contact || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Lot Price ($)</label>
          <input class="form-input" id="nb-price" type="number" placeholder="499000" value="${build?.lot_price || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Est. Possession Date</label>
          <input class="form-input" id="nb-close" type="date" value="${build?.est_close_date || ''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">CC Email — Additional Recipients (comma separated)</label>
        <input class="form-input" id="nb-cc" type="email" placeholder="spouse@email.com, partner@email.com" value="${build?.cc_email || ''}">
        <div style="font-size:11px;color:var(--text2);margin-top:4px;">Add co-buyer, spouse, or anyone else who should receive build updates</div>
      </div>
      <div class="form-group">
        <label class="form-label">Current Stage</label>
        <select class="form-input form-select" id="nb-stage">
          <option value="">-- Select stage --</option>
          ${NewBuilds.FIXED_STAGES.map(s => `<option value="${s.label}" ${build?.current_stage === s.label ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Deposit Amount ($)</label>
        <input class="form-input" id="nb-deposit" type="number" placeholder="10000" value="${build?.deposit_amount || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="nb-notes" rows="2" placeholder="Any additional notes...">${build?.notes || ''}</textarea>
      </div>
      <button class="btn btn-primary btn-block" onclick="NewBuilds.save(${build ? `'${build.id}'` : 'null'})">
        ${build ? '💾 Update Build' : '🏗️ Create Build'}
      </button>
      <div id="nb-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async save(existingId = null) {
    const clientId = document.getElementById('nb-client').value;
    const address = document.getElementById('nb-address').value.trim();
    const msgEl = document.getElementById('nb-msg');
    if (!clientId || !address) {
      if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent='⚠️ Client and address required'; }
      return;
    }
    if (msgEl) { msgEl.style.color='var(--text2)'; msgEl.textContent='Saving...'; }

    const client = Clients.all.find(c => c.id === clientId);
    const payload = {
      client_id: clientId,
      agent_id: currentAgent.id,
      client_name: client?.full_name,
      client_email: client?.email,
      cc_email: document.getElementById('nb-cc')?.value.trim() || null,
      lot_address: address,
      builder_name: document.getElementById('nb-builder').value.trim() || null,
      builder_contact: document.getElementById('nb-builder-contact').value.trim() || null,
      lot_price: document.getElementById('nb-price').value || null,
      est_close_date: document.getElementById('nb-close').value || null,
      current_stage: document.getElementById('nb-stage').value || null,
      deposit_amount: document.getElementById('nb-deposit').value || null,
      notes: document.getElementById('nb-notes').value.trim() || null,
      updated_at: new Date().toISOString()
    };

    let error;
    if (existingId) {
      ({ error } = await db.from('new_builds').update(payload).eq('id', existingId));
    } else {
      ({ error } = await db.from('new_builds').insert(payload));
    }

    if (error) { if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent=error.message; } return; }
    App.closeModal();
    App.toast(existingId ? '✅ Build updated!' : '✅ Build created!');
    NewBuilds.load();
  },

  async openDetail(id) {
    const b = NewBuilds.all.find(x => x.id === id);
    if (!b) return;
    const client = Clients.all.find(c => c.id === b.client_id) || b.clients;
    const clientName = b.clients?.full_name || client?.full_name || b.client_name || '—';

    const stageIdx = NewBuilds.FIXED_STAGES.findIndex(s => s.label === b.current_stage);
    const total = NewBuilds.FIXED_STAGES.length;
    const done = stageIdx >= 0 ? stageIdx : 0;
    const pct = Math.round((done / total) * 100);

    const stagesHtml = NewBuilds.FIXED_STAGES.map((s, i) => {
      const isDone = i < stageIdx;
      const isCurrent = s.label === b.current_stage;
      const icon = isDone ? '✅' : isCurrent ? '▶️' : '○';
      const color = isDone ? 'var(--green)' : isCurrent ? 'var(--accent)' : 'var(--text2)';
      const fw = isCurrent ? 'font-weight:700;' : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:16px;width:22px;text-align:center;">${icon}</span>
        <span style="font-size:13px;color:${color};${fw}">${s.label}</span>
      </div>`;
    }).join('');

    App.openModal(`
      <div class="fw-800" style="font-size:16px;margin-bottom:2px;">🏗️ ${b.lot_address}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:14px;">👤 ${clientName} ${b.builder_name ? '&nbsp;•&nbsp; 🏗️ ' + b.builder_name : ''}</div>

      <!-- Progress -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px;">
          <span>Build Progress</span><span>${pct}%</span>
        </div>
        <div style="height:8px;background:var(--bg2);border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--green),#34d399);border-radius:99px;"></div>
        </div>
      </div>

      <!-- Key info -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:14px;">
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Current Stage</div><div class="fw-700">${b.current_stage || '—'}</div></div>
        <div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Est. Possession</div><div class="fw-700">${b.est_close_date ? App.fmtDate(b.est_close_date) : '—'}</div></div>
        ${b.lot_price ? `<div style="background:var(--bg);padding:8px;border-radius:8px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Lot Price</div><div class="fw-700">${App.fmtMoney(b.lot_price)}</div></div>` : ''}
        ${b.cc_email ? `<div style="background:var(--bg);padding:8px;border-radius:8px;grid-column:span 2;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">CC Recipients</div><div class="fw-700" style="font-size:12px;">${b.cc_email}</div></div>` : ''}
      </div>

      <!-- Stages -->
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:8px;">Build Milestones</div>
        <div style="max-height:260px;overflow-y:auto;">${stagesHtml}</div>
      </div>

      <!-- Actions -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-primary" onclick="App.closeModal();setTimeout(()=>NewBuilds.updateStage('${b.id}'),300)">🔄 Update Stage</button>
        <button class="btn btn-outline" onclick="App.closeModal();setTimeout(()=>NewBuilds._showForm(${JSON.stringify(b).replace(/"/g,'&quot;')}),300)">✏️ Edit</button>
      </div>
    `);
  },

  async updateStage(id) {
    const b = NewBuilds.all.find(x => x.id === id);
    if (!b) return;

    const currentIdx = NewBuilds.FIXED_STAGES.findIndex(s => s.label === b.current_stage);
    const stageOptions = NewBuilds.FIXED_STAGES.map((s, i) =>
      `<option value="${s.label}" ${s.label === b.current_stage ? 'selected' : ''}>${i <= currentIdx ? '✅ ' : i === currentIdx + 1 ? '▶️ ' : '○  '}${s.label}</option>`
    ).join('');

    App.openModal(`
      <div class="modal-title">🔄 Update Build Stage</div>
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:16px;">${b.lot_address}</div>

      <div class="form-group">
        <label class="form-label">New Stage *</label>
        <select class="form-input form-select" id="us-stage">
          ${stageOptions}
          <option value="__custom__">+ Custom Stage...</option>
        </select>
      </div>
      <div id="us-custom-wrap" style="display:none;" class="form-group">
        <label class="form-label">Custom Stage Name</label>
        <input class="form-input" id="us-custom" placeholder="E.g. Tile Installation, Exterior Painting...">
      </div>
      <div class="form-group">
        <label class="form-label">Stage Date</label>
        <input class="form-input" id="us-date" type="date" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="form-group">
        <label class="form-label">Update Note (optional — included in client email)</label>
        <textarea class="form-input" id="us-note" rows="2" placeholder="E.g. Framing is looking great — on schedule for possession!"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Send Update Email to Client?</label>
        <select class="form-input form-select" id="us-send-email">
          <option value="yes">Yes — queue email for approval</option>
          <option value="no">No — just update the record</option>
        </select>
      </div>
      <button class="btn btn-primary btn-block" onclick="NewBuilds.saveStageUpdate('${id}')">✅ Save Stage Update</button>
      <div id="us-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);

    // Show/hide custom field
    document.getElementById('us-stage').addEventListener('change', (e) => {
      document.getElementById('us-custom-wrap').style.display = e.target.value === '__custom__' ? 'block' : 'none';
    });
  },

  async saveStageUpdate(id) {
    const b = NewBuilds.all.find(x => x.id === id);
    if (!b) return;
    const msgEl = document.getElementById('us-msg');

    let newStage = document.getElementById('us-stage').value;
    if (newStage === '__custom__') {
      newStage = document.getElementById('us-custom').value.trim();
      if (!newStage) {
        if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent='⚠️ Please enter a custom stage name'; }
        return;
      }
    }
    if (!newStage) {
      if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent='⚠️ Please select a stage'; }
      return;
    }

    const stageDate = document.getElementById('us-date').value;
    const sendEmail = document.getElementById('us-send-email').value === 'yes';
    if (msgEl) { msgEl.style.color='var(--text2)'; msgEl.textContent='Saving...'; }

    // Build payload — update the date field for this stage if it's a fixed stage
    const fixedStage = NewBuilds.FIXED_STAGES.find(s => s.label === newStage);
    const payload = {
      current_stage: newStage,
      updated_at: new Date().toISOString()
    };
    if (fixedStage && stageDate) payload[fixedStage.dateField] = stageDate;

    // Update stage_history (always append)
    const history = b.stage_history || [];
    history.push({ label: newStage, completed_at: stageDate || new Date().toISOString(), custom: !fixedStage });
    payload.stage_history = history;

    // Update pipeline deal stage automatically if mapped
    const pipelineStage = NewBuilds.PIPELINE_MAP[newStage];
    if (pipelineStage && b.client_id) {
      await db.from('pipeline')
        .update({ stage: pipelineStage, updated_at: new Date().toISOString() })
        .eq('client_id', b.client_id)
        .neq('stage', 'Closed');
    }

    const { error } = await db.from('new_builds').update(payload).eq('id', id);
    if (error) { if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent=error.message; } return; }

    // Queue email to client if requested
    if (sendEmail && typeof Notify !== 'undefined') {
      const client = Clients.all.find(c => c.id === b.client_id);
      if (client || b.client_email) {
        const clientObj = client || { full_name: b.client_name, email: b.client_email };

        // Get or create a build token for the tracker link
        let buildToken = null;
        const { data: existingToken } = await db.from('build_tokens')
          .select('token').eq('build_id', id).eq('active', true).limit(1).single();
        if (existingToken) {
          buildToken = existingToken.token;
        } else {
          buildToken = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
          await db.from('build_tokens').insert({ build_id: id, token: buildToken, active: true });
        }

        const tmpl = Notify.templates.build_update(clientObj, b, newStage, currentAgent, buildToken);
        // Queue with CC if the build has a cc_email
        await Notify.queue(
          'Build Update', clientObj.id || null, clientObj.full_name, clientObj.email,
          tmpl.subject, tmpl.body, id, tmpl.html, null, b.cc_email || null
        );
        App.pushNotify('🏗️ Build Update Queued', `Stage: ${newStage} — ${b.lot_address}`, 'approvals');
      }
    }

    App.closeModal();
    App.toast(`✅ Stage updated to "${newStage}"${sendEmail ? ' — email queued for approval' : ''}`);
    await NewBuilds.load();
  }
};
