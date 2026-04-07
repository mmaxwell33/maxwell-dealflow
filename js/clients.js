// Maxwell DealFlow CRM — Clients Module
const Clients = {
  all: [],
  archived: [],
  viewMode: 'active', // 'active' or 'archived'

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('clients')
      .select('*').eq('agent_id', currentAgent.id)
      .order('full_name');
    const all = data || [];
    Clients.all      = all.filter(c => c.status !== 'Archived');
    Clients.archived = all.filter(c => c.status === 'Archived');

    if (Clients.viewMode === 'archived') {
      Clients.renderArchived();
    } else {
      Clients.render(Clients.all);
    }
    Clients.updateArchiveBadge();
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
    el.innerHTML = `<div class="card" style="padding:0 16px;">` +
      list.map(c => `
        <div class="client-row" onclick="Clients.openDetail('${c.id}')">
          <div class="client-avatar" style="background:${App.avatarColor(c.full_name)}">
            ${App.initials(c.full_name)}
          </div>
          <div style="flex:1;min-width:0;">
            <div class="client-name">${c.full_name}</div>
            <div class="client-meta">${c.email || ''} · ${c.phone || ''}</div>
          </div>
          ${App.stageBadge(c.stage)}
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
            <div class="client-name">${c.full_name}</div>
            <div class="client-meta">${c.email || ''} · ${c.phone || ''}</div>
            ${c.archived_at ? `<div style="font-size:11px;color:var(--text2);">Archived ${App.fmtDate(c.archived_at)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn btn-sm btn-green" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();Clients.restore('${c.id}','${App.esc(c.full_name)}')">♻️ Restore</button>
            <button class="btn btn-sm btn-red"  style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();Clients.permanentDelete('${c.id}','${App.esc(c.full_name)}')">🗑 Delete</button>
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
              <div class="client-name">${c.full_name}</div>
              <div class="client-meta">${c.email || ''} · ${c.phone || ''}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn btn-sm btn-green" style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();Clients.restore('${c.id}','${App.esc(c.full_name)}')">♻️ Restore</button>
              <button class="btn btn-sm btn-red"  style="font-size:11px;padding:4px 8px;" onclick="event.stopPropagation();Clients.permanentDelete('${c.id}','${App.esc(c.full_name)}')">🗑 Delete</button>
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
      <button class="btn btn-primary btn-block" onclick="Clients.save()">Save Client</button>
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
    App.closeModal();
    App.toast('✅ Client added!');
    Clients.load();
    App.loadOverview();
  },

  async openDetail(id) {
    const c = Clients.all.find(x => x.id === id);
    if (!c) return;
    const { count: vc } = await db.from('viewings').select('*',{count:'exact',head:true}).eq('client_id',id);
    const { count: oc } = await db.from('offers').select('*',{count:'exact',head:true}).eq('client_id',id);

    App.openModal(`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <div class="client-avatar" style="background:${App.avatarColor(c.full_name)};width:52px;height:52px;font-size:20px;">
          ${App.initials(c.full_name)}
        </div>
        <div>
          <div class="fw-800" style="font-size:18px;">${c.full_name}</div>
          <div class="text-muted" style="font-size:13px;">${c.stage || 'No stage'}</div>
        </div>
        ${App.stageBadge(c.stage)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
        <div class="card-sm" style="text-align:center;">
          <div class="fw-800" style="font-size:20px;color:var(--accent2);">${vc||0}</div>
          <div style="font-size:11px;color:var(--text2);">Viewings</div>
        </div>
        <div class="card-sm" style="text-align:center;">
          <div class="fw-800" style="font-size:20px;color:var(--purple);">${oc||0}</div>
          <div style="font-size:11px;color:var(--text2);">Offers</div>
        </div>
        <div class="card-sm" style="text-align:center;">
          <div class="fw-800" style="font-size:20px;color:var(--green);">${c.status||'Active'}</div>
          <div style="font-size:11px;color:var(--text2);">Status</div>
        </div>
      </div>
      <div class="divider"></div>
      ${c.email ? `<div class="activity-row"><span style="font-size:18px;">📧</span><div><div class="activity-title">Email</div><div class="activity-meta">${c.email}</div></div></div>` : ''}
      ${c.phone ? `<div class="activity-row"><span style="font-size:18px;">📞</span><div><div class="activity-title">Phone</div><div class="activity-meta">${c.phone}</div></div></div>` : ''}
      ${c.price_range ? `<div class="activity-row"><span style="font-size:18px;">💰</span><div><div class="activity-title">Budget</div><div class="activity-meta">${c.price_range}</div></div></div>` : ''}
      ${c.city ? `<div class="activity-row"><span style="font-size:18px;">📍</span><div><div class="activity-title">Area</div><div class="activity-meta">${c.city}</div></div></div>` : ''}
      ${c.notes ? `<div class="card" style="margin-top:12px;"><div style="font-size:11px;color:var(--text2);margin-bottom:4px;">NOTES</div><div style="font-size:13px;">${c.notes}</div></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">
        <button class="btn btn-outline" onclick="Viewings.openAddForClient('${c.id}','${c.full_name}')">📅 Book Viewing</button>
        <button class="btn btn-green" onclick="Offers.openAddForClient('${c.id}','${c.full_name}')">📄 Add Offer</button>
      </div>
      <button class="btn btn-outline btn-block mt-8" onclick="Clients.openEdit('${c.id}')">✏️ Edit Client</button>
      <button class="btn btn-block mt-8" style="background:var(--red);color:#fff;" onclick="Clients.archive('${c.id}','${App.esc(c.full_name)}')">🗂 Archive Client</button>
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
        <button class="btn btn-red" onclick="Clients.archive('${c.id}','${App.esc(c.full_name)}')">🗂 Archive</button>
        <button class="btn btn-primary" onclick="Clients.update('${c.id}')">💾 Save</button>
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
    App.closeModal(); App.toast('✅ Client updated!');
    Clients.load(); App.loadOverview();
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
      updated_at: new Date().toISOString()
    }).eq('id', id);
    App.toast(`✅ ${name} restored to active clients!`, 'var(--green)');
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

  // Legacy method kept for backward compatibility
  async delete(id, name) {
    return Clients.archive(id, name);
  }
};
