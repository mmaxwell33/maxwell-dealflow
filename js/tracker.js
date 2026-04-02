// ── TRACKER ─────────────────────────────────────────────────────────────────
const Tracker = {
  all: [],

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('clients')
      .select('*').eq('agent_id', currentAgent.id)
      .order('updated_at', { ascending: false });
    Tracker.all = data || [];
    Tracker.render(Tracker.all);
  },

  search(q) {
    const filtered = Tracker.all.filter(c =>
      (c.full_name || '').toLowerCase().includes(q.toLowerCase()) ||
      (c.stage || '').toLowerCase().includes(q.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(q.toLowerCase())
    );
    Tracker.render(filtered);
  },

  render(list) {
    const el = document.getElementById('tracker-list');
    const now = new Date();
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-text">No clients to track</div></div>';
      return;
    }
    el.innerHTML = list.map(c => {
      const name = c.full_name || 'Unknown';
      const needsFollowUp = !c.updated_at || (now - new Date(c.updated_at)) > 7 * 24 * 60 * 60 * 1000;
      return `
        <div class="card" style="margin-bottom:12px;${needsFollowUp ? 'border-left:3px solid var(--red);' : ''}">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <div class="client-avatar" style="background:${App.avatarColor(name)};">${App.initials(name)}</div>
            <div style="flex:1;">
              <div class="fw-700">${name}</div>
              <div class="text-muted" style="font-size:12px;">${c.stage || 'No Stage'} · Updated ${App.timeAgo(c.updated_at)}</div>
            </div>
            ${needsFollowUp ? '<span class="stage-badge badge-pending" style="font-size:10px;">Follow Up</span>' : `<span class="stage-badge badge-accepted" style="font-size:10px;">${c.status || 'Active'}</span>`}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:var(--text2);margin-bottom:10px;">
            ${c.email ? `<div>✉️ ${c.email}</div>` : ''}
            ${c.phone ? `<div>📞 ${c.phone}</div>` : ''}
            ${(c.budget_min || c.budget_max) ? `<div>💰 ${App.fmtMoney(c.budget_min)} – ${App.fmtMoney(c.budget_max)}</div>` : ''}
            ${c.preferred_areas ? `<div>📍 ${c.preferred_areas}</div>` : (c.city ? `<div>📍 ${c.city}</div>` : '')}
          </div>
          ${c.notes ? `<div style="font-size:12px;color:var(--text2);padding:8px;background:var(--bg);border-radius:6px;margin-bottom:10px;line-height:1.5;">${c.notes}</div>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${c.email ? `<a href="mailto:${c.email}" class="btn btn-outline btn-sm">✉️ Email</a>` : ''}
            ${c.phone ? `<a href="tel:${c.phone}" class="btn btn-outline btn-sm">📞 Call</a>` : ''}
            <button class="btn btn-outline btn-sm" onclick="Clients.openDetail('${c.id}')">👁 View</button>
          </div>
        </div>`;
    }).join('');
  }
};

// ── CHECKLIST ────────────────────────────────────────────────────────────────
const Checklist = {
  all: [],
  currentFilter: 'all',

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('checklist_items')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    Checklist.all = data || [];
    Checklist.applyFilter();
  },

  filter(f, btn) {
    Checklist.currentFilter = f;
    document.querySelectorAll('#screen-checklist .filter-btn').forEach(b => {
      b.classList.remove('btn-primary'); b.classList.add('btn-outline');
    });
    if (btn) { btn.classList.remove('btn-outline'); btn.classList.add('btn-primary'); }
    Checklist.applyFilter();
  },

  applyFilter() {
    let list = Checklist.all;
    if (Checklist.currentFilter === 'pending') list = list.filter(t => !t.done);
    if (Checklist.currentFilter === 'done') list = list.filter(t => t.done);
    Checklist.render(list);
  },

  render(list) {
    const el = document.getElementById('checklist-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">No tasks yet</div><div class="empty-sub">Click + Task to add one</div></div>';
      return;
    }
    el.innerHTML = list.map(t => `
      <div class="card" style="margin-bottom:8px;display:flex;align-items:flex-start;gap:12px;${t.done ? 'opacity:0.65;' : ''}">
        <input type="checkbox" ${t.done ? 'checked' : ''} onchange="Checklist.toggle('${t.id}',this.checked)" style="width:18px;height:18px;cursor:pointer;margin-top:2px;flex-shrink:0;">
        <div style="flex:1;">
          <div style="font-weight:700;${t.done ? 'text-decoration:line-through;' : ''}">${t.title}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px;">
            ${t.client_name ? `👤 ${t.client_name}` : ''}
            ${t.due_date ? ` · Due ${App.fmtDate(t.due_date)}` : ''}
          </div>
        </div>
        ${t.priority ? `<span class="stage-badge ${t.priority === 'High' ? 'badge-pending' : t.priority === 'Medium' ? 'badge-viewings' : 'badge-default'}" style="font-size:10px;">${t.priority}</span>` : ''}
        <button class="btn btn-outline btn-sm" onclick="Checklist.delete('${t.id}')" style="flex-shrink:0;">🗑</button>
      </div>`).join('');
  },

  async toggle(id, done) {
    await db.from('checklist_items').update({ done, updated_at: new Date().toISOString() }).eq('id', id);
    const item = Checklist.all.find(t => t.id === id);
    if (item) item.done = done;
    Checklist.applyFilter();
  },

  async delete(id) {
    await db.from('checklist_items').delete().eq('id', id);
    Checklist.all = Checklist.all.filter(t => t.id !== id);
    Checklist.applyFilter();
    App.toast('🗑 Task deleted');
  },

  openAdd() {
    App.openModal(`
      <div class="modal-title">➕ New Task</div>
      <div class="form-group">
        <label class="form-label">Task Title *</label>
        <input class="form-input" id="ck-title" placeholder="What needs to be done?">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Due Date</label>
          <input class="form-input" id="ck-due" type="date">
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select class="form-input form-select" id="ck-priority">
            <option value="">None</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Related Client (Optional)</label>
        <input class="form-input" id="ck-client" placeholder="Client name">
      </div>
      <button class="btn btn-primary btn-block" onclick="Checklist.save()">💾 Save Task</button>
      <div id="ck-status" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async save() {
    const st = document.getElementById('ck-status');
    const title = document.getElementById('ck-title').value.trim();
    if (!title) { st.textContent = '⚠️ Title required'; return; }
    st.textContent = 'Saving...';
    const { error } = await db.from('checklist_items').insert({
      agent_id: currentAgent.id,
      title,
      due_date: document.getElementById('ck-due').value || null,
      priority: document.getElementById('ck-priority').value || null,
      client_name: document.getElementById('ck-client').value.trim() || null,
      done: false
    });
    if (error) { st.style.color = 'var(--red)'; st.textContent = error.message; return; }
    App.closeModal(); App.toast('✅ Task added!');
    Checklist.load();
  }
};

// ── INBOX ────────────────────────────────────────────────────────────────────
const Inbox = {
  all: [],

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('email_inbox')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false }).limit(50);
    Inbox.all = data || [];
    Inbox.render(Inbox.all);
  },

  render(list) {
    const el = document.getElementById('inbox-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📬</div>
        <div class="empty-text">Your inbox is empty</div>
        <div class="empty-sub">Emails you send to clients are logged here</div>
      </div>`;
      return;
    }
    el.innerHTML = list.map(e => `
      <div class="card" style="margin-bottom:8px;cursor:pointer;" onclick="Inbox.view('${e.id}')">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:22px;">${e.direction === 'sent' ? '📤' : '📥'}</div>
          <div style="flex:1;min-width:0;">
            <div class="fw-700" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.subject || '(no subject)'}</div>
            <div class="text-muted" style="font-size:12px;">
              ${e.direction === 'sent'
                ? `To: ${e.recipient_name || e.recipient_email || '—'}`
                : `From: ${e.sender_name || e.sender_email || '—'}`}
              · ${App.timeAgo(e.created_at)}
            </div>
          </div>
          <span class="stage-badge ${e.direction === 'sent' ? 'badge-accepted' : 'badge-viewings'}" style="font-size:10px;">${e.direction || 'sent'}</span>
        </div>
      </div>`).join('');
  },

  view(id) {
    const e = Inbox.all.find(x => x.id === id);
    if (!e) return;
    App.openModal(`
      <div class="modal-title">📧 ${e.subject || '(no subject)'}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">
        ${e.direction === 'sent'
          ? `To: ${e.recipient_name || ''} &lt;${e.recipient_email || ''}&gt;`
          : `From: ${e.sender_name || ''} &lt;${e.sender_email || ''}&gt;`}
        · ${App.fmtDate(e.created_at)}
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;white-space:pre-wrap;font-size:13px;line-height:1.6;">${e.body || '(no content)'}</div>
    `);
  },

  openCompose() {
    App.switchTab('email');
  }
};

// ── FORM RESPONSES ───────────────────────────────────────────────────────────
const FormResponses = {
  all: [],

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('form_responses')
      .select('*').eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false }).limit(50);
    FormResponses.all = data || [];
    FormResponses.render(FormResponses.all);
  },

  render(list) {
    const el = document.getElementById('formresponses-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-text">No form responses yet</div>
        <div class="empty-sub">Client inquiries submitted via your web form will appear here</div>
      </div>`;
      return;
    }
    el.innerHTML = list.map(r => `
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div class="client-avatar" style="background:${App.avatarColor(r.name || 'U')};width:36px;height:36px;font-size:13px;">${App.initials(r.name || 'U')}</div>
          <div style="flex:1;">
            <div class="fw-700">${r.name || 'Unknown'}</div>
            <div class="text-muted" style="font-size:12px;">${r.email || ''} · ${App.timeAgo(r.created_at)}</div>
          </div>
          <span class="stage-badge ${r.status === 'New' ? 'badge-pending' : 'badge-accepted'}">${r.status || 'New'}</span>
        </div>
        ${r.message ? `<div style="font-size:13px;color:var(--text2);padding:8px;background:var(--bg);border-radius:6px;margin-bottom:8px;line-height:1.5;">${r.message}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${r.email ? `<a href="mailto:${r.email}" class="btn btn-outline btn-sm">✉️ Reply</a>` : ''}
          <button class="btn btn-primary btn-sm" onclick="FormResponses.addAsClient('${r.id}')">➕ Add as Client</button>
          <button class="btn btn-outline btn-sm" onclick="FormResponses.markRead('${r.id}')">✓ Mark Read</button>
        </div>
      </div>`).join('');
  },

  addAsClient(id) {
    const r = FormResponses.all.find(x => x.id === id);
    if (!r) return;
    App.toast('📝 Opening Add Client — prefill name/email from form');
    Clients.openAdd();
    setTimeout(() => {
      const nameEl = document.getElementById('cl-name');
      const emailEl = document.getElementById('cl-email');
      if (nameEl && r.name) nameEl.value = r.name;
      if (emailEl && r.email) emailEl.value = r.email;
    }, 200);
  },

  async markRead(id) {
    await db.from('form_responses').update({ status: 'Read' }).eq('id', id);
    const r = FormResponses.all.find(x => x.id === id);
    if (r) r.status = 'Read';
    FormResponses.render(FormResponses.all);
    App.toast('✓ Marked as read');
  }
};
