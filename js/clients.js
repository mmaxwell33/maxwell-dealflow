// Maxwell DealFlow CRM — Clients Module
const Clients = {
  all: [],
  archived: [],
  viewMode: 'active', // 'active' or 'archived'

  // ── PR #26: stage filter + sort state, persisted in localStorage ──────
  // localStorage key: mdf-clients-view  = {"filter":"All","sort":"name"}
  // Read at load time, written on every chip click or sort change.
  filter: 'All',
  sort: 'name',
  // Stage list mirrors the pipeline lifecycle so a client's displayed stage
  // matches the most-advanced deal stage everywhere in the app. Order = the
  // path a deal walks: Searching → Viewings → Offers → Accepted →
  // Under Contract (auto-set when financing date passes) → Conditions →
  // Closing → Closed (or Fell Through as the terminal-bad branch).
  _STAGE_ORDER: ['Searching', 'Viewings', 'Offers', 'Accepted', 'Under Contract', 'Conditions', 'Closing', 'Closed', 'Fell Through'],

  _loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem('mdf-clients-view') || 'null');
      if (raw && typeof raw === 'object') {
        if (typeof raw.filter === 'string') Clients.filter = raw.filter;
        if (typeof raw.sort === 'string') Clients.sort = raw.sort;
      }
    } catch (_) {}
  },
  _savePrefs() {
    try {
      localStorage.setItem('mdf-clients-view', JSON.stringify({
        filter: Clients.filter, sort: Clients.sort
      }));
    } catch (_) {}
  },

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

    // PR #26: load persisted filter + sort preferences before first render
    Clients._loadPrefs();
    const sortSel = document.getElementById('clients-sort');
    if (sortSel) sortSel.value = Clients.sort;

    if (Clients.viewMode === 'archived') {
      Clients.renderArchived();
    } else {
      Clients.renderStageChips();
      Clients.render(Clients.all);
    }
    Clients.updateArchiveBadge();
  },

  // ── PR #26: stage filter chips + sort handlers ──────────────────────────

  renderStageChips() {
    const wrap = document.getElementById('clients-stage-chips');
    if (!wrap) return;
    // Toolbar only makes sense on the Active view
    const toolbar = document.getElementById('clients-toolbar');
    if (toolbar) toolbar.style.display = (Clients.viewMode === 'archived') ? 'none' : 'flex';

    // Count clients per derived stage
    const counts = { All: Clients.all.length };
    Clients._STAGE_ORDER.forEach(s => counts[s] = 0);
    Clients.all.forEach(c => {
      const stage = c._derivedStage || c.stage || 'Searching';
      if (counts.hasOwnProperty(stage)) counts[stage]++;
    });

    const chip = (label, count) => {
      const pressed = (Clients.filter === label) ? 'true' : 'false';
      const labelAttr = App.escAttr(label);
      return `<button class="cl-chip" aria-pressed="${pressed}"
                onclick="Clients.setFilter('${labelAttr}')">
                ${App.esc(label)}<span class="cl-chip-count">${count}</span>
              </button>`;
    };

    const chips = ['All', ...Clients._STAGE_ORDER]
      // Hide zero-count stage chips to reduce noise (always keep "All")
      .filter(s => s === 'All' || counts[s] > 0)
      .map(s => chip(s, counts[s]))
      .join('');
    wrap.innerHTML = chips;
  },

  setFilter(stage) {
    Clients.filter = stage || 'All';
    Clients._savePrefs();
    Clients.renderStageChips();
    Clients.render(Clients.all);
  },

  setSort(value) {
    Clients.sort = value || 'name';
    Clients._savePrefs();
    Clients.render(Clients.all);
  },

  // Apply current filter + sort to a list. Pure function — no DOM writes.
  _applyView(list) {
    let out = list;
    if (Clients.filter && Clients.filter !== 'All') {
      out = out.filter(c => (c._derivedStage || c.stage || 'Searching') === Clients.filter);
    }
    if (Clients.sort === 'recent') {
      // Newest created_at first; missing dates sink to the bottom
      out = [...out].sort((a, b) => {
        const ax = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bx = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bx - ax;
      });
    } else if (Clients.sort === 'stage') {
      // Most advanced first (Closing → Searching). Use _STAGE_ORDER index inverted.
      const rank = (s) => {
        const i = Clients._STAGE_ORDER.indexOf(s);
        return i === -1 ? 99 : (Clients._STAGE_ORDER.length - i);
      };
      out = [...out].sort((a, b) => {
        const ar = rank(a._derivedStage || a.stage);
        const br = rank(b._derivedStage || b.stage);
        if (br !== ar) return br - ar;
        // tie-break by name
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
    }
    // 'name' is the default — load() already sorted by full_name from Supabase
    return out;
  },

  // Derive the TRUE stage of a client from the most advanced activity found
  // across pipeline → offers → viewings. Falls back to stored clients.stage.
  //
  // Order matters here. Closed and Fell Through are checked FIRST because
  // they represent terminal pipeline states — a client whose deal closed
  // should display "Closed" even if they also had viewings or earlier
  // pipeline activity. Without this check the function falls through to the
  // stale clients.stage column, which was the bug that left James Owusu's
  // closed deal showing the wrong stage in the Clients list.
  _deriveStage(c, offers, pipeline, viewings) {
    const pipes = pipeline.filter(p => p.client_id === c.id);
    const offs  = offers.filter(o => o.client_id === c.id);
    const views = viewings.filter(v => v.client_id === c.id);

    // Terminal pipeline states win — most recent deal outcome is source of truth.
    // 'Done' is treated as a Closed alias because the deal-progress code uses
    // both ('isFullyClosed = stage==="Closed" || stage==="Done"', offers.js).
    // 'Withdrawn' is a Fell-Through alias for the same reason.
    if (pipes.some(p => p.stage === 'Closed' || p.stage === 'Done'))             return 'Closed';
    if (pipes.some(p => p.stage === 'Fell Through' || p.stage === 'Withdrawn'))  return 'Fell Through';

    // In-progress pipeline, most-advanced first. CRITICAL: Under Contract has
    // to be checked BEFORE the offer-status fallback below, otherwise clients
    // whose pipeline auto-advanced from Accepted → Under Contract still match
    // the 'Accepted' offer record and silently display the wrong stage.
    if (pipes.some(p => p.stage === 'Closing'))         return 'Closing';
    if (pipes.some(p => p.stage === 'Conditions'))      return 'Conditions';
    if (pipes.some(p => p.stage === 'Under Contract'))  return 'Under Contract';
    if (pipes.some(p => p.stage === 'Accepted'))        return 'Accepted';

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
    Clients.renderStageChips();
    Clients.render(Clients.all);
  },

  showArchived() {
    Clients.viewMode = 'archived';
    const btnActive  = document.getElementById('btn-view-active');
    const btnArchive = document.getElementById('btn-view-archive');
    if (btnActive)  { btnActive.style.background  = 'var(--card)';    btnActive.style.color  = 'var(--text2)'; }
    if (btnArchive) { btnArchive.style.background = 'var(--accent)';  btnArchive.style.color = '#fff'; }
    // PR #26: hide chip+sort toolbar on archived view (different list shape)
    const toolbar = document.getElementById('clients-toolbar');
    if (toolbar) toolbar.style.display = 'none';
    Clients.renderArchived();
  },

  render(list) {
    const el = document.getElementById('clients-list');
    // PR #26: apply filter + sort BEFORE checking empty state, so we can
    // distinguish "no clients at all" from "no clients matching this filter".
    const baseCount = list.length;
    const view = Clients._applyView(list);
    if (!view.length) {
      if (baseCount === 0) {
        el.innerHTML = `<div class="empty-state">
          <div class="empty-icon">👥</div>
          <div class="empty-text">No clients yet</div>
          <div class="empty-sub">Tap + Add to add your first client</div>
        </div>`;
      } else {
        el.innerHTML = `<div class="empty-state">
          <div class="empty-icon">🔎</div>
          <div class="empty-text">No clients in “${App.esc(Clients.filter)}”</div>
          <div class="empty-sub">Click <strong>All</strong> above to see everyone.</div>
        </div>`;
      }
      return;
    }
    list = view;
    // Phase 2.B: .card2 wrapper + .pill2 stage indicator built from
    // _derivedStage (true live stage) instead of stale c.stage.
    // Closed → green (success). Fell Through → red (negative outcome).
    // Under Contract → coral (signals "in motion, not yet final").
    const stagePill = (s) => {
      const stage = s || 'Searching';
      const variant = stage === 'Closed'         ? 'pill2-green'
                    : stage === 'Fell Through'   ? 'pill2-red'
                    : stage === 'Closing'        ? 'pill2-indigo'
                    : stage === 'Conditions'     ? 'pill2-amber'
                    : stage === 'Under Contract' ? 'pill2-coral'
                    : stage === 'Accepted'       ? 'pill2-green'
                    : stage === 'Offers'         ? 'pill2-indigo'
                    : stage === 'Viewings'       ? 'pill2-neutral'
                    : /* Searching */              'pill2-neutral';
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
    el.innerHTML = `<div class="card2" style="padding:0 16px;">` +
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
            <button class="btn2 btn2-ghost btn2-sm" style="font-size:11px;" onclick="event.stopPropagation();Clients.restore('${c.id}','${App.escAttr(c.full_name)}')">♻️ Restore</button>
            <button class="btn2 btn2-coral btn2-sm" style="font-size:11px;" onclick="event.stopPropagation();Clients.permanentDelete('${c.id}','${App.escAttr(c.full_name)}')">🗑 Delete</button>
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
      el.innerHTML = `<div class="card2" style="padding:0 16px;">` +
        filtered.map(c => `
          <div class="client-row" style="opacity:0.75;">
            <div class="client-avatar" style="background:#64748b;">${App.initials(c.full_name)}</div>
            <div style="flex:1;min-width:0;">
              <div class="client-name">${App.privateName(c.full_name)}</div>
              <div class="client-meta">${App.privateContact(c.email, c.phone)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn2 btn2-ghost btn2-sm" style="font-size:11px;" onclick="event.stopPropagation();Clients.restore('${c.id}','${App.escAttr(c.full_name)}')">♻️ Restore</button>
              <button class="btn2 btn2-coral btn2-sm" style="font-size:11px;" onclick="event.stopPropagation();Clients.permanentDelete('${c.id}','${App.escAttr(c.full_name)}')">🗑 Delete</button>
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
    // Closed → green, Fell Through → red, Under Contract → coral.
    const stage = c.stage || 'Searching';
    const stageVariant = stage === 'Closed'         ? 'pill2-green'
                       : stage === 'Fell Through'   ? 'pill2-red'
                       : stage === 'Closing'        ? 'pill2-indigo'
                       : stage === 'Conditions'     ? 'pill2-amber'
                       : stage === 'Under Contract' ? 'pill2-coral'
                       : stage === 'Accepted'       ? 'pill2-green'
                       : stage === 'Offers'         ? 'pill2-indigo'
                       : stage === 'Viewings'       ? 'pill2-neutral'
                       : /* Searching */              'pill2-neutral';

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
      <button class="btn2 btn2-ghost" style="width:100%;justify-content:center;margin-top:8px;border-color:var(--accent);color:var(--accent);" onclick="App.closeModal();Reviews.requestSearch('${c.id}')">📨 Mid-search Check-in</button>
      <button class="btn2 btn2-primary" style="width:100%;justify-content:center;margin-top:8px;" onclick="App.closeModal();Clients.sendWelcome('${c.id}')">📧 Send Welcome Email</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="App.closeModal();Clients.archive('${c.id}','${App.escAttr(c.full_name)}')">🗂 Archive</button>
        <button class="btn2 btn2-coral" style="justify-content:center;" onclick="App.closeModal();Clients.confirmDelete('${c.id}','${App.escAttr(c.full_name)}')">🗑 Delete</button>
      </div>
    `);
  },

  async openEdit(id) {
    const c = Clients.all.find(x => x.id === id);
    if (!c) return;

    // Load existing stakeholder contacts for this client (if any)
    const { data: contacts } = await db.from('client_contacts')
      .select('role, name, email, phone')
      .eq('client_id', id);
    const byRole = {};
    (contacts || []).forEach(r => { byRole[r.role] = r; });
    const get = (role, field) => (byRole[role]?.[field] || '');

    const stakeRow = (role, label, icon) => `
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:6px;letter-spacing:.06em;">
          ${icon} ${label.toUpperCase()}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <input class="form-input" id="ce-${role}-name"  placeholder="Name"  value="${App.esc(get(role,'name'))}"  style="font-size:13px;padding:8px;">
          <input class="form-input" id="ce-${role}-email" placeholder="Email" type="email" value="${App.esc(get(role,'email'))}" style="font-size:13px;padding:8px;">
        </div>
        <input class="form-input" id="ce-${role}-phone" placeholder="Phone (optional)" value="${App.esc(get(role,'phone'))}" style="font-size:13px;padding:8px;margin-top:6px;">
      </div>`;

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
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Min Budget ($)</label>
          <input class="form-input" id="ce-bmin" type="number" value="${c.budget_min!=null?c.budget_min:''}">
        </div>
        <div class="form-group">
          <label class="form-label">Max Budget ($)</label>
          <input class="form-input" id="ce-bmax" type="number" value="${c.budget_max!=null?c.budget_max:''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Pre-Approval Status</label>
        <select class="form-input form-select" id="ce-preapproval">
          ${['','Yes — fully pre-approved','In progress','Not yet — need guidance','Paying cash'].map(o=>
            `<option value="${o}" ${(c.preapproval||'')===o?'selected':''}>${o||'— Not set —'}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="ce-notes" rows="3">${c.notes||''}</textarea>
      </div>

      <!-- Their Stakeholders — saved once, reused on every deal -->
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">
          👥 Their Stakeholders
        </div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:10px;font-style:italic;">
          Save each contact once — every future deal pre-fills the Add-Stakeholder modal.
        </div>
        ${stakeRow('mortgage_broker', 'Mortgage Broker', '🏦')}
        ${stakeRow('lawyer',          'Lawyer / Notary', '⚖️')}
        ${stakeRow('inspector',       'Inspector',       '🔍')}
        ${stakeRow('builder',         'Builder',         '🏗️')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="Clients.archive('${c.id}','${App.escAttr(c.full_name)}')">🗂 Archive</button>
        <button class="btn2 btn2-primary" style="justify-content:center;" onclick="Clients.update('${c.id}')">💾 Save</button>
      </div>
      <div id="ce-status" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async update(id) {
    const st = document.getElementById('ce-status');
    st.textContent = 'Saving...';
    // Budget columns already exist on clients, so they go in the main update.
    const parseNum = (v) => { const n = Number(String(v||'').replace(/[^0-9.]/g,'')); return Number.isFinite(n) && n > 0 ? n : null; };
    const { error } = await db.from('clients').update({
      full_name: document.getElementById('ce-name').value.trim(),
      email: document.getElementById('ce-email').value.trim(),
      phone: document.getElementById('ce-phone').value.trim(),
      stage: document.getElementById('ce-stage').value,
      budget_min: parseNum(document.getElementById('ce-bmin')?.value),
      budget_max: parseNum(document.getElementById('ce-bmax')?.value),
      notes: document.getElementById('ce-notes').value.trim(),
      updated_at: new Date().toISOString()
    }).eq('id', id);
    if (error) { st.style.color='var(--red)'; st.textContent = error.message; return; }

    // Pre-approval lives in a column added by migration 049. Write it
    // separately + best-effort, so if that migration hasn't been run yet the
    // main save above still succeeds (we just log a hint).
    const preapproval = document.getElementById('ce-preapproval')?.value || null;
    const { error: paErr } = await db.from('clients').update({ preapproval }).eq('id', id);
    if (paErr) console.warn('Pre-approval not saved — run migration 049_client_preapproval.sql:', paErr.message);

    // Upsert any stakeholder contacts entered. Skip empty rows.
    const roles = ['mortgage_broker','lawyer','inspector','builder'];
    const contactRows = roles.map(role => {
      const name  = document.getElementById(`ce-${role}-name`)?.value.trim()  || '';
      const email = document.getElementById(`ce-${role}-email`)?.value.trim() || '';
      const phone = document.getElementById(`ce-${role}-phone`)?.value.trim() || '';
      if (!name && !email && !phone) return null;  // skip empty
      return {
        client_id: id, agent_id: currentAgent.id, role,
        name: name || null, email: email || null, phone: phone || null,
        updated_at: new Date().toISOString()
      };
    }).filter(Boolean);
    if (contactRows.length) {
      // upsert by (client_id, role) unique key
      const { error: cErr } = await db.from('client_contacts')
        .upsert(contactRows, { onConflict: 'client_id,role' });
      if (cErr) console.warn('client_contacts upsert:', cErr);
    }
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
        <button class="btn2 btn2-coral" style="justify-content:center;" onclick="App.closeModal();Clients.permanentDelete('${id}','${App.escAttr(name)}')">🗑 Yes, Delete</button>
      </div>
    `);
  },

  // Legacy method kept for backward compatibility
  async delete(id, name) {
    return Clients.archive(id, name);
  }
};
