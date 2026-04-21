// Maxwell DealFlow CRM — Clients Module
const Clients = {
  all: [],
  archived: [],
  viewMode: 'active', // 'active' or 'archived'

  async load() {
    if (!currentAgent?.id) return;
    // Pull clients + live activity in parallel so we can derive the TRUE stage.
    // clients.stage is a stale manual field — source of truth lives in
    // pipeline / offers / viewings tables.
    const [clientsRes, offersRes, pipelineRes, viewingsRes] = await Promise.all([
      db.from('clients').select('*').eq('agent_id', currentAgent.id).order('full_name'),
      db.from('offers').select('client_id,status').eq('agent_id', currentAgent.id),
      db.from('pipeline').select('client_id,stage').eq('agent_id', currentAgent.id),
      db.from('viewings').select('client_id').eq('agent_id', currentAgent.id)
    ]);
    const all      = clientsRes.data   || [];
    const offers   = offersRes.data    || [];
    const pipeline = pipelineRes.data  || [];
    const viewings = viewingsRes.data  || [];

    // Annotate each client with a derived stage reflecting real activity
    all.forEach(c => { c._derivedStage = Clients._deriveStage(c, offers, pipeline, viewings); });

    Clients.all      = all.filter(c => c.status !== 'Archived');
    Clients.archived = all.filter(c => c.status === 'Archived');

    if (Clients.viewMode === 'archived') {
      Clients.renderArchived();
    } else {
      Clients.render(Clients.all);
    }
    Clients.updateArchiveBadge();
  },

  // Derive the TRUE stage of a client from the most advanced activity found
  // across pipeline → offers → viewings. Falls back to stored clients.stage.
  _deriveStage(c, offers, pipeline, viewings) {
    const pipes = pipeline.filter(p => p.client_id === c.id);
    const offs  = offers.filter(o => o.client_id === c.id);
    const views = viewings.filter(v => v.client_id === c.id);

    // Pipeline wins (most advanced)
    if (pipes.some(p => p.stage === 'Closing'))    return 'Closing';
    if (pipes.some(p => p.stage === 'Conditions')) return 'Conditions';
    if (pipes.some(p => p.stage === 'Accepted'))   return 'Accepted';

    // Accepted offer that hasn't hit the pipeline yet
    if (offs.some(o => o.status === 'Accepted'))                      return 'Accepted';
    if (offs.some(o => ['Submitted','Countered'].includes(o.status))) return 'Offers';

    if (views.length) return 'Viewings';

    return c.stage || 'Searching';
  },

  updateArchiveBadge() {
    const badge = document.getElementById('archive-badge');
    if (badge) {
      badge.textContent = Clients.archived.length;
      badge.style.display = Clients.archived.length > 0 ? 'inline' : 'none';
    }
  },

  showActive() {
    Clients.viewMode = 'active';
    // Toggle button styles
    const btnActive  = document.getElementById('btn-view-active');
    const btnArchive = document.getElementById('btn-view-archive');
    if (btnActive)  { btnActive.style.background  = 'var(--accent)';  btnActive.style.color  = '#fff'; }
    if (btnArchive) { btnArchive.style.background = 'var(--card)';    btnArchive.style.color = 'var(--text2)'; }
    Clients.render(Clients.all);
  },

  showArchived() {
    Clients.viewMode = 'archived';
    const btnActive  = document.getElementById('btn-view-active');
    const btnArchive = document.getElementById('btn-view-archive');
    if (btnActive)  { btnActive.style.background  = 'var(--card)';    btnActive.style.color  = 'var(--text2)'; }
    if (btnArchive) { btnArchive.style.background = 'var(--accent)';  btnArchive.style.color = '#fff'; }
    Clients.renderArchived();
  },

  render(list) {
    const el = document.getElementById('clients-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-icon">👥</div>
        <div class="empty-text">No clients yet</div>
        <div class="empty-sub">Tap + Add to add your first client</div>
      </div>`;
      return;
    }
    // Phase 2.B: .card2 wrapper + .pill2 stage indicator built from
    // _derivedStage (true live stage) instead of stale c.stage.
    const stagePill = (s) => {
      const stage = s || 'Searching';
      const variant = stage === 'Closing'    ? 'pill2-indigo'
                    : stage === 'Conditions' ? 'pill2-amber'
                    : stage === 'Accepted'   ? 'pill2-green'
                    : stage === 'Offers'     ? 'pill2-indigo'
                    : stage === 'Viewings'   ? 'pill2-neutral'
                    : /* Searching */          'pill2-neutral';
      return `<span class="pill2 ${variant}">${stage}</span>`;
    };
    el.innerHTML = `<div class="card2" style="padding:0 16px;">` +
      list.map(c => `
        <div class="client-row" onclick="Clients.openDetail('${c.id}')">
          <div class="client-avatar" style="background:${App.avatarColor(c.full_name)}">
            ${App.initials(c.full_name)}
          </div>
          <div style="flex:1;min-width:0;">
            <div class="client-name">${App.privateName(c.full_name)}</div>
            <div class="client-meta">${App.privateContact(c.email, c.phone)}</div>
          </div>
          ${stagePill(c._derivedStage || c.stage)}
        </div>`).join('') + `</div>`;
  },

  renderArchived() {
    const el = document.getElementById('clients-list');
    if (!Clients.archived.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-icon">🗂</div>
        <div class="empty-text">No archived clients</div>
        <div class="empty-sub">Archived clients will appear here</div>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="card" style="padding:0 16px;">` +
      Clients.archived.map(c => `
        <div class="client-row" style="opacity:0.75;">
          <div class="client-avatar" style="background:#64748b;">
            ${App.initials(c.full_name)}
          </div>
          <div style="flex:1;min-width:0;">
            <div class="client-name">${App.privateName(c.full_name)}</div>
            <div class="client-meta">${App.privateContact(c.email, c.phone)}</div>
            ${c.archived_at ? `<div style="font-size:11px;color:var(--text2);">Archived ${App.fmtDate(c.archived_at)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn2 btn2-ghost btn2-sm" style="font-size:11px;" onclick="event.stopPropagation();Clients.restore('${c.id}','${App.esc(c.full_name)}')">♻️ Restore</button>
            <button class="btn2 btn2-coral btn2-sm" style="font-size:11px;" onclick="event.stopPropagation();Clients.permanentDelete('${c.id}','${App.esc(c.full_name)}')">🗑 Delete</button>
          </div>
        </div>`).join('') + `</div>`;
  },

  search(q) {
    if (Clients.viewMode === 'archived') {
      const filtered = Clients.archived.filter(c =>
        c.full_name?.toLowerCase().includes(q.toLowerCase()) ||
        c.email?.toLowerCase().includes(q.toLowerCase()) ||
        c.phone?.includes(q)
      );
      // Re-render archived with filter
      const el = document.getElementById('clients-list');
      if (!filtered.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">🗂</div><div class="empty-text">No matches</div></div>`;
        return;
      }
      el.innerHTML = `<div class="card" style="padding:0 16px;">` +
        filtered.map(c => `
          <div class="client-row" style="opacity:0.75;">
            <div class="client-avatar" style="background:#64748b;">${App.initials(c.full_name)}</div>
            <div style="flex:1;min-width:0;">
              <div class="client-name">${App.privateName(c.full_name)}</div>
              <div class="client-meta">${App.privateContact(c.email, c.phone)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn2 btn2-ghost btn2-sm" style="font-size:11px;" onclick="event.stopPropagation();Clients.restore('${c.id}','${App.esc(c.full_name)}')">♻️ Restore</button>
              <button class="btn2 btn2-coral btn2-sm" style="font-size:11px;" onclick="event.stopPropagation();Clients.permanentDelete('${c.id}','${App.esc(c.full_name)}')">🗑 Delete</button>
            </div>
          </div>`).join('') + `</div>`;
      return;
    }
    const filtered = Clients.all.filter(c =>
      c.full_name?.toLowerCase().includes(q.toLowerCase()) ||
      c.email?.toLowerCase().includes(q.toLowerCase()) ||
      c.phone?.includes(q)
    );
    Clients.render(filtered);
  },

  openAdd() {
    App.openModal(`
      <div class="modal-title">➕ Add Client</div>
      <div class="form-group">
        <label class="form-label">Full Name *</label>
        <input class="form-input" id="cf-name" placeholder="James Owusu">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-input" id="cf-email" type="email" placeholder="james@email.com">
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input class="form-input" id="cf-phone" type="tel" placeholder="(709) 555-1234">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Budget Min</label>
          <input class="form-input" id="cf-bmin" type="number" placeholder="300000">
        </div>
        <div class="form-group">
          <label class="form-label">Budget Max</label>
          <input class="form-input" id="cf-bmax" type="number" placeholder="500000">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Stage</label>
        <select class="form-input form-select" id="cf-stage">
          <option value="Searching">Searching</option>
          <option value="Viewings">Viewings</option>
          <option value="Offers">Offers</option>
          <option value="Accepted">Accepted</option>
          <option value="Conditions">Conditions</option>
          <option value="Closing">Closing</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">City / Area</label>
        <input class="form-input" id="cf-city" placeholder="St. John's NL">
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="cf-notes" rows="3" placeholder="Any notes..."></textarea>
      </div>
      <button class="btn2 btn2-primary" style="width:100%;justify-content:center;" onclick="Clients.save()">Save Client</button>
      <div id="cf-status" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async save() {
    const name = document.getElementById('cf-name').value.trim();
    if (!name) { document.getElementById('cf-status').textContent = '⚠️ Name is required'; return; }
    const statusEl = document.getElementById('cf-status');
    statusEl.textContent = 'Saving...';
    const { data, error } = await db.from('clients').insert({
      agent_id: currentAgent.id,
      full_name: name,
      email: document.getElementById('cf-email').value.trim(),
      phone: document.getElementById('cf-phone').value.trim(),
      price_range: `$${document.getElementById('cf-bmin').value||'0'} – $${document.getElementById('cf-bmax').value||'0'}`,
      stage: document.getElementById('cf-stage').value,
      city: document.getElementById('cf-city').value.trim(),
      notes: document.getElementById('cf-notes').value.trim(),
      status: 'Active'
    }).select().single();

    if (error) { statusEl.style.color='var(--red)'; statusEl.textContent = error.message; return; }
    await App.logActivity('CLIENT_ADDED', name, data.email, `New client added: ${name}`, data.id);

    // Queue welcome email for approval if client has an email
    if (data.email && typeof Notify !== "undefined") {
      await Notify.onClientAdded(data, {});
    }

    App.closeModal();
    App.toast('✅ Client added! Welcome email queued for approval.', 'var(--green)');
    Clients.load();
    App.loadOverview();
  },

  async openDetail(id) {
    const c = Clients.all.find(x => x.id === id);
    if (!c) return;
    const { count: vc } = await db.from('viewings').select('*',{count:'exact',head:true}).eq('client_id',id);
    const { count: oc } = await db.from('offers').select('*',{count:'exact',head:true}).eq('client_id',id);

    // Phase 2.B.4: stage pill uses same variant mapping as the Clients list
    // (see Clients.render) so detail + list stay visually consistent.
    const stage = c.stage || 'Searching';
    const stageVariant = stage === 'Closing'    ? 'pill2-indigo'
                       : stage === 'Conditions' ? 'pill2-amber'
                       : stage === 'Accepted'   ? 'pill2-green'
                       : stage === 'Offers'     ? 'pill2-indigo'
                       : stage === 'Viewings'   ? 'pill2-neutral'
                       : /* Searching */          'pill2-neutral';

    App.openModal(`
      <div class="card2" style="padding:16px;margin-bottom:12px;">
        <div class="card2-header">
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="client-avatar" style="background:${App.avatarColor(c.full_name)};width:52px;height:52px;font-size:20px;">
              ${App.initials(c.full_name)}
            </div>
            <div>
              <div class="card2-title" style="font-size:18px;">${c.full_name}</div>
              <div class="card2-sub">${stage}</div>
            </div>
          </div>
          <span class="pill2 ${stageVariant}">${stage}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
        <div class="card2" style="padding:12px 8px;text-align:center;">
          <div class="fw-800" style="font-size:20px;color:var(--accent2);">${vc||0}</div>
          <div style="font-size:11px;color:var(--text2);">Viewings</div>
        </div>
        <div class="card2" style="padding:12px 8px;text-align:center;">
          <div class="fw-800" style="font-size:20px;color:var(--purple);">${oc||0}</div>
          <div style="font-size:11px;color:var(--text2);">Offers</div>
        </div>
        <div class="card2" style="padding:12px 8px;text-align:center;">
          <div class="fw-800" style="font-size:20px;color:var(--green);">${c.status||'Active'}</div>
          <div style="font-size:11px;color:var(--text2);">Status</div>
        </div>
      </div>
      <div class="divider"></div>
      ${c.email ? `<div class="activity-row"><span style="font-size:18px;">📧</span><div><div class="activity-title">Email</div><div class="activity-meta">${c.email}</div></div></div>` : ''}
      ${c.phone ? `<div class="activity-row"><span style="font-size:18px;">📞</span><div><div class="activity-title">Phone</div><div class="activity-meta">${c.phone}</div></div></div>` : ''}
      ${c.price_range ? `<div class="activity-row"><span style="font-size:18px;">💰</span><div><div class="activity-title">Budget</div><div class="activity-meta">${c.price_range}</div></div></div>` : ''}
      ${c.city ? `<div class="activity-row"><span style="font-size:18px;">📍</span><div><div class="activity-title">Area</div><div class="activity-meta">${c.city}</div></div></div>` : ''}
      ${c.notes ? `<div class="card2" style="margin-top:12px;padding:12px;"><div style="font-size:11px;color:var(--text2);margin-bottom:4px;">NOTES</div><div style="font-size:13px;">${c.notes}</div></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="Viewings.openAddForClient('${c.id}','${c.full_name}')">📅 Book Viewing</button>
        <button class="btn2 btn2-primary" style="justify-content:center;" onclick="Offers.openAddForClient('${c.id}','${c.full_name}')">📄 Add Offer</button>
      </div>
      <button class="btn2 btn2-ghost" style="width:100%;justify-content:center;margin-top:8px;" onclick="Clients.openEdit('${c.id}')">✏️ Edit Client</button>
      <button class="btn2 btn2-primary" style="width:100%;justify-content:center;margin-top:8px;" onclick="App.closeModal();Clients.sendWelcome('${c.id}')">📧 Send Welcome Email</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="App.closeModal();Clients.archive('${c.id}','${App.esc(c.full_name)}')">🗂 Archive</button>
        <button class="btn2 btn2-coral" style="justify-content:center;" onclick="App.closeModal();Clients.confirmDelete('${c.id}','${App.esc(c.full_name)}')">🗑 Delete</button>
      </div>
    `);
  },

  openEdit(id) {
    const c = Clients.all.find(x => x.id === id);
    if (!c) return;
    App.openModal(`
      <div class="modal-title">✏️ Edit Client</div>
      <div class="form-group">
        <label class="form-label">Full Name *</label>
        <input class="form-input" id="ce-name" value="${c.full_name||''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-input" id="ce-email" type="email" value="${c.email||''}">
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input class="form-input" id="ce-phone" value="${c.phone||''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Stage</label>
        <select class="form-input form-select" id="ce-stage">
          ${['Searching','Viewings','Offers','Accepted','Conditions','Closing'].map(s=>
            `<option ${c.stage===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="ce-notes" rows="3">${c.notes||''}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="Clients.archive('${c.id}','${App.esc(c.full_name)}')">🗂 Archive</button>
        <button class="btn2 btn2-primary" style="justify-content:center;" onclick="Clients.update('${c.id}')">💾 Save</button>
      </div>
      <div id="ce-status" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async update(id) {
    const st = document.getElementById('ce-status');
    st.textContent = 'Saving...';
    const { error } = await db.from('clients').update({
      full_name: document.getElementById('ce-name').value.trim(),
      email: document.getElementById('ce-email').value.trim(),
      phone: document.getElementById('ce-phone').value.trim(),
      stage: document.getElementById('ce-stage').value,
      notes: document.getElementById('ce-notes').value.trim(),
      updated_at: new Date().toISOString()
    }).eq('id', id);
    if (error) { st.style.color='var(--red)'; st.textContent = error.message; return; }
    // Sync any pending approval emails for this client with updated name/email
    const newName  = document.getElementById('ce-name').value.trim();
    const newEmail = document.getElementById('ce-email').value.trim();
    const oldClient = Clients.all.find(x => x.id === id);
    if (oldClient) {
      await db.from('approval_queue')
        .update({ client_name: newName, client_email: newEmail, updated_at: new Date().toISOString() })
        .eq('agent_id', currentAgent.id)
        .eq('client_name', oldClient.full_name)
        .eq('status', 'Pending');
    }
    App.closeModal(); App.toast('✅ Client updated!');
    Clients.load(); App.loadOverview();
  },

  // ── SEND WELCOME EMAIL to existing client ───────────────────────────────────
  async sendWelcome(id) {
    const c = Clients.all.find(x => x.id === id);
    if (!c) return;
    if (!c.email) { App.toast('⚠️ This client has no email on file', 'var(--red)'); return; }
    if (typeof Notify !== "undefined") {
      await Notify.onClientAdded(c, {
        budget_max: c.budget_max || null,
        preferred_areas: c.preferred_areas || c.city || null,
        bedrooms: c.bedrooms || null,
        must_haves: null,
        timeline: null,
        property_types: null
      });
      App.switchTab('approvals');
      App.toast(`📧 Welcome email queued for ${c.full_name} — go approve it!`, 'var(--green)');
    }
  },

  // ── ARCHIVE (soft delete) ────────────────────────────────────────────────────
  async archive(id, name) {
    if (!confirm(`Archive ${name}?\n\nThey will be moved to the Archive tab. All their viewings, offers and history are preserved. You can restore them anytime.`)) return;
    await db.from('clients').update({
      status: 'Archived',
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', id);
    App.closeModal();
    App.toast(`🗂 ${name} archived. Tap Archive tab to restore.`, 'var(--accent2)');
    Clients.load();
    App.loadOverview();
  },

  // ── RESTORE from archive ─────────────────────────────────────────────────────
  async restore(id, name) {
    await db.from('clients').update({
      status: 'Active',
      archived_at: null,
      stage: 'Searching',
      updated_at: new Date().toISOString()
    }).eq('id', id);
    App.toast(`✅ ${name} reactivated — ready for a new search!`, 'var(--green)');
    Clients.load();
    App.loadOverview();
  },

  // ── PERMANENT DELETE ─────────────────────────────────────────────────────────
  async permanentDelete(id, name) {
    if (!confirm(`⚠️ Permanently delete "${name}"?\n\nThis will remove the client record completely. Their viewings and offer history will remain in the database but will be unlinked.\n\nThis CANNOT be undone. Are you sure?`)) return;
    const { error } = await db.from('clients').delete().eq('id', id);
    if (error) { App.toast(`❌ Error: ${error.message}`, 'var(--red)'); return; }
    App.toast(`🗑 ${name} permanently deleted.`, 'var(--red)');
    Clients.load();
    App.loadOverview();
  },

  confirmDelete(id, name) {
    App.openModal(`
      <div class="modal-title">🗑 Delete Client</div>
      <p style="color:var(--text2);margin-bottom:20px;">Permanently delete <strong>${App.esc(name)}</strong>? This cannot be undone. Their pipeline and offer history will remain in the database.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="App.closeModal()">Cancel</button>
        <button class="btn2 btn2-coral" style="justify-content:center;" onclick="App.closeModal();Clients.permanentDelete('${id}','${App.esc(name)}')">🗑 Yes, Delete</button>
      </div>
    `);
  },

  // Legacy method kept for backward compatibility
  async delete(id, name) {
    return Clients.archive(id, name);
  }
};
