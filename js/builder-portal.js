// Maxwell DealFlow — Builder Portal
// Standalone page (builder.html) — token-gated, no login.
// Uses security-definer RPCs (builder_load, builder_check_step, etc.)
// so the anon key can only read/write the single build matching the token.

const BuilderPortal = {
  token: null,
  build: null,
  stages: [
    { key:'pre_construction', label:'📋 Pre-Construction', steps:[
      {key:'builder_contacted',  label:'Builder contacted'},
      {key:'lot_visited',        label:'Lot visited / site walk done'},
      {key:'plans_selections',   label:'Plans & design selections made'},
      {key:'aps_drafted',        label:'APS drafted and reviewed with client'},
      {key:'aps_signed',         label:'APS signed by client'},
      {key:'aps_sent_builder',   label:'APS sent to builder'},
      {key:'aps_sent_lender',    label:'APS sent to lender for financing'},
    ]},
    { key:'financing', label:'🏦 Financing', steps:[
      {key:'pre_asset_submitted', label:'Pre-asset submitted to lender'},
      {key:'pre_asset_approved',  label:'Pre-asset approved'},
      {key:'partial_approval',    label:'Partial financing approval received'},
      {key:'full_approval',       label:'Full financing approval received'},
    ]},
    { key:'construction', label:'🏗️ Construction', steps:[
      {key:'construction_started', label:'Builder starts construction'},
      {key:'foundation',           label:'Foundation poured'},
      {key:'framing',              label:'Framing complete'},
      {key:'roofing',              label:'Roofing complete'},
      {key:'rough_ins',            label:'Rough-ins (electrical & plumbing)'},
      {key:'insulation_drywall',   label:'Insulation & drywall'},
      {key:'cabinets_flooring',    label:'Cabinets & flooring'},
      {key:'finishes',             label:'Finishes & fixtures'},
    ]},
    { key:'conditions', label:'✅ Conditions & Closing Prep', steps:[
      {key:'inspection_done',    label:'Home inspection done'},
      {key:'conditions_waived',  label:'Conditions waived'},
      {key:'docs_attached',      label:'All documents attached'},
      {key:'lawyer_confirmed',   label:'Financing confirmed by lawyer'},
    ]},
    { key:'possession', label:'🎉 Possession', steps:[
      {key:'final_walkthrough',  label:'Final walkthrough with client'},
      {key:'ps_signed',          label:'P&S agreement signed'},
      {key:'closing_docs_sent',  label:'Closing documents sent to lawyer'},
      {key:'keys_handed',        label:'Keys handed to client'},
    ]},
  ],

  // ── INIT ────────────────────────────────────────────────────────────────
  async init() {
    this.token = new URLSearchParams(location.search).get('t');
    if (!this.token) return this._showError();

    const res = await this._rpc('builder_load', { p_token: this.token });
    if (!res || res.error) return this._showError();

    this.build = res.build;
    this.visitRequests = res.visit_requests || [];

    this._renderHeader();
    this._renderStages();
    this._renderVisitDropdown();
    this._renderCustomList();
    this._renderYourRequests();
    this._show('main');

    // Fire-and-forget access log. Also slides the rolling 90-day expiry forward.
    // We don't await this — portal renders immediately even if the log call is slow.
    this._logAccess();
    this._logPortalView();
  },

  async _logPortalView() {
    try {
      await this._rpc('log_portal_view', {
        p_page_type: 'builder',
        p_token: this.token,
        p_user_agent: (navigator.userAgent || '').slice(0, 400)
      });
    } catch (_) { /* silent */ }
  },

  async _logAccess() {
    try {
      await this._rpc('builder_log_access', {
        p_token: this.token,
        p_ua: (navigator.userAgent || '').slice(0, 400)
      });
    } catch (_) { /* silent — logging is best-effort */ }
  },

  async selfRevoke() {
    const ok = confirm(
      'Revoke this link now?\n\n' +
      'This will immediately disable this URL. You will need Maxwell to send you a new link to get back in.\n\n' +
      'Do this if you think the link was forwarded or seen by someone who should not have access.'
    );
    if (!ok) return;
    const res = await this._rpc('builder_self_revoke', { p_token: this.token });
    if (res && res.ok) {
      this._toast('🚫 Link revoked. Contact Maxwell for a new one.');
      setTimeout(() => this._showError(), 1400);
    } else {
      this._toast('⚠️ Could not revoke — call Maxwell at (709) 325-0545');
    }
  },

  _renderYourRequests() {
    const card = document.getElementById('your-requests-card');
    const list = document.getElementById('your-requests-list');
    if (!card || !list) return;
    const reqs = (this.visitRequests || []).slice(0, 8);
    if (reqs.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const fmt = (d, t) => {
      if (!d) return '—';
      const date = new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
      return t ? `${date} at ${(t+'').slice(0,5)}` : date;
    };
    list.innerHTML = reqs.map(r => {
      const label = r.stage_item_label || 'Client visit';
      let pill, body;
      if (r.status === 'pending') {
        pill = `<span style="background:#fff4ec;color:#b85432;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">⏳ Waiting for agent</span>`;
        body = `<div class="muted" style="font-size:13px;">You proposed ${fmt(r.proposed_date, r.proposed_time)}</div>`;
      } else if (r.status === 'approved') {
        pill = `<span style="background:#e8f6ee;color:#1f7a3a;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">✅ Confirmed</span>`;
        body = `<div style="font-size:14px;font-weight:600;margin-top:4px;">${fmt(r.final_date || r.proposed_date, r.final_time || r.proposed_time)}</div>`;
      } else if (r.status === 'rescheduled') {
        pill = `<span style="background:#fff4e5;color:#a6601a;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">🗓️ Agent proposed different time</span>`;
        body = `
          <div style="font-size:14px;font-weight:600;margin-top:4px;">Agent suggests: ${fmt(r.final_date, r.final_time)}</div>
          ${r.agent_response ? `<div class="muted" style="font-size:13px;font-style:italic;margin-top:4px;">"${r.agent_response}"</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
            <button class="btn" onclick="BuilderPortal.acceptAgentTime('${r.id}')">✅ Accept new time</button>
            <button class="btn" style="background:#fff;color:#CC785C;border:1px solid #CC785C;" onclick="BuilderPortal.openCounter('${r.id}')">🗓️ Propose another</button>
          </div>
          <div id="counter-form-${r.id}" style="display:none;margin-top:12px;padding:12px;background:#fafafa;border-radius:8px;">
            <div class="row">
              <div class="field"><label class="field-label">Date</label><input class="input" id="counter-date-${r.id}" type="date"></div>
              <div class="field"><label class="field-label">Time</label><input class="input" id="counter-time-${r.id}" type="time" value="10:00"></div>
            </div>
            <div class="field"><label class="field-label">Note (optional)</label><input class="input" id="counter-note-${r.id}" placeholder="e.g. Framing done mid-afternoon"></div>
            <button class="btn" onclick="BuilderPortal.submitCounter('${r.id}')">📤 Send counter-proposal</button>
          </div>`;
      } else if (r.status === 'declined') {
        pill = `<span style="background:#fde8e8;color:#9b2727;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">❌ Declined</span>`;
        body = `<div class="muted" style="font-size:13px;">${r.agent_response || 'Agent declined this request.'}</div>`;
      } else {
        pill = `<span class="muted" style="font-size:12px;">${r.status}</span>`;
        body = '';
      }
      return `
        <div style="border:1px solid #eee;border-radius:10px;padding:12px;margin-bottom:10px;background:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div style="font-weight:600;flex:1;min-width:200px;">${label}</div>
            ${pill}
          </div>
          ${body}
        </div>`;
    }).join('');
  },

  openCounter(reqId) {
    const el = document.getElementById('counter-form-' + reqId);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  },

  async acceptAgentTime(reqId) {
    const res = await this._rpc('builder_accept_reschedule', { p_token: this.token, p_request_id: reqId });
    if (res && res.ok) {
      this._toast('✅ Accepted — the agent and client will be notified.');
      setTimeout(() => this.init(), 800);
    } else {
      this._toast('⚠️ Could not accept — try again', true);
    }
  },

  async submitCounter(reqId) {
    const date = document.getElementById('counter-date-' + reqId)?.value;
    const time = document.getElementById('counter-time-' + reqId)?.value || '10:00';
    const note = document.getElementById('counter-note-' + reqId)?.value.trim() || null;
    if (!date) { this._toast('⚠️ Pick a date', true); return; }
    const res = await this._rpc('builder_counter_reschedule', {
      p_token: this.token, p_request_id: reqId, p_date: date, p_time: time, p_note: note
    });
    if (res && res.ok) {
      this._toast('📤 Counter-proposal sent to agent.');
      setTimeout(() => this.init(), 800);
    } else {
      this._toast('⚠️ Could not send — try again', true);
    }
  },

  // ── RENDER ──────────────────────────────────────────────────────────────
  _renderHeader() {
    const b = this.build;
    document.getElementById('build-address').textContent = b.lot_address || 'Your Build';
    const parts = [];
    if (b.builder_name) parts.push('🏗️ ' + b.builder_name);
    if (b.est_completion_date) parts.push('📅 Est. ' + this._fmt(b.est_completion_date));
    document.getElementById('build-meta').textContent = parts.join(' · ') || '';

    // Progress %
    const pm = b.pipeline_milestones || {};
    let total = 0, done = 0;
    this.stages.forEach(s => s.steps.forEach(st => {
      total++;
      if (pm?.[s.key]?.steps?.[st.key]) done++;
    }));
    const pct = total ? Math.round(done/total*100) : 0;
    document.getElementById('progress-pct').textContent = pct + '%';
    document.getElementById('progress-fill').style.width = pct + '%';
  },

  _renderStages() {
    const host = document.getElementById('stages-container');
    const pm = this.build.pipeline_milestones || {};
    host.innerHTML = this.stages.map((stage, idx) => {
      const steps = stage.steps;
      const stepState = pm?.[stage.key]?.steps || {};
      const doneCount = steps.filter(s => stepState[s.key]).length;
      const allDone = doneCount === steps.length;
      // Open the first non-complete stage by default
      const hasActivity = doneCount > 0;
      const shouldOpen = !allDone && (hasActivity || idx === this._firstIncompleteIndex(pm));
      return `
        <div class="stage${allDone?' done':''}${shouldOpen?' open':''}" id="stage-${stage.key}">
          <div class="stage-head" onclick="BuilderPortal._toggleStage('${stage.key}')">
            <span>${stage.label}</span>
            <span class="count">${doneCount}/${steps.length}${allDone?' ✓':''}</span>
          </div>
          <div class="stage-body">
            ${steps.map(st => `
              <div class="step${stepState[st.key]?' done':''}">
                <input type="checkbox" id="chk-${stage.key}-${st.key}"
                       ${stepState[st.key]?'checked':''}
                       onchange="BuilderPortal.checkStep('${stage.key}','${st.key}',this.checked)">
                <label for="chk-${stage.key}-${st.key}">${st.label}</label>
              </div>
            `).join('')}
          </div>
        </div>`;
    }).join('');
  },

  _firstIncompleteIndex(pm) {
    for (let i = 0; i < this.stages.length; i++) {
      const s = this.stages[i];
      const allDone = s.steps.every(st => pm?.[s.key]?.steps?.[st.key]);
      if (!allDone) return i;
    }
    return 0;
  },

  _renderVisitDropdown() {
    const sel = document.getElementById('visit-stage');
    const items = [];
    this.stages.forEach(s => s.steps.forEach(st => items.push(`${s.label.replace(/[📋🏦🏗️✅🎉]\s*/u,'')} — ${st.label}`)));
    sel.innerHTML = '<option value="">-- Select milestone --</option>' +
      items.map(i => `<option value="${i}">${i}</option>`).join('');
    // Default date = 3 days out
    const d = new Date(); d.setDate(d.getDate() + 3);
    document.getElementById('visit-date').value = d.toISOString().slice(0,10);
  },

  _renderCustomList() {
    const host = document.getElementById('custom-list');
    if (!host) return;
    const customItems = (this.build.stage_history || []).filter(h => h.custom && h.added_by === 'builder');
    if (!customItems.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div style="margin-top:12px;font-size:12px;color:var(--text2);font-weight:600;">Your custom tasks:</div>' +
      customItems.map(i => `
        <div class="custom-item">
          <span>${this._esc(i.label)}</span>
          ${i.due_date ? `<span class="due">Due ${this._fmt(i.due_date)}</span>` : ''}
        </div>`).join('');
  },

  _toggleStage(key) {
    const el = document.getElementById('stage-' + key);
    if (el) el.classList.toggle('open');
  },

  // ── ACTIONS ─────────────────────────────────────────────────────────────
  async checkStep(stageKey, stepKey, checked) {
    const res = await this._rpc('builder_check_step', {
      p_token: this.token, p_stage_key: stageKey, p_step_key: stepKey, p_checked: checked
    });
    if (res?.error) { this._toast('⚠️ Save failed — refresh and try again'); return; }
    // Update local state + re-render header progress
    if (!this.build.pipeline_milestones) this.build.pipeline_milestones = {};
    if (!this.build.pipeline_milestones[stageKey]) this.build.pipeline_milestones[stageKey] = { done:false, steps:{} };
    this.build.pipeline_milestones[stageKey].steps = this.build.pipeline_milestones[stageKey].steps || {};
    this.build.pipeline_milestones[stageKey].steps[stepKey] = checked;
    this._renderHeader();
    // Toggle strikethrough on the row
    const row = document.querySelector(`#chk-${stageKey}-${stepKey}`)?.closest('.step');
    if (row) row.classList.toggle('done', checked);
    this._toast(checked ? '✅ Saved — Maxwell notified' : '↶ Unchecked');
  },

  async addCustom() {
    const label = document.getElementById('custom-label').value.trim();
    const due   = document.getElementById('custom-due').value || null;
    if (!label) { this._toast('⚠️ Enter a task name'); return; }
    const res = await this._rpc('builder_add_custom', {
      p_token: this.token, p_label: label, p_due: due
    });
    if (res?.error) { this._toast('⚠️ Save failed'); return; }
    // Push into local state + re-render
    (this.build.stage_history = this.build.stage_history || []).push({
      label, custom:true, due_date:due, added_by:'builder', added_at:new Date().toISOString()
    });
    document.getElementById('custom-label').value = '';
    document.getElementById('custom-due').value = '';
    this._renderCustomList();
    this._toast('✅ Task added — Maxwell notified');
  },

  async submitVisit() {
    const stageItem = document.getElementById('visit-stage').value;
    const date = document.getElementById('visit-date').value;
    const time = document.getElementById('visit-time').value;
    const note = document.getElementById('visit-note').value.trim() || null;
    const msg  = document.getElementById('visit-msg');
    if (!stageItem || !date || !time) {
      msg.style.color = 'var(--red)'; msg.textContent = 'Please fill milestone, date, and time.';
      return;
    }
    msg.style.color = 'var(--text2)'; msg.textContent = 'Sending…';
    const res = await this._rpc('builder_request_visit', {
      p_token: this.token, p_stage_item: stageItem, p_date: date, p_time: time, p_note: note
    });
    if (res?.error) { msg.style.color='var(--red)'; msg.textContent='⚠️ Failed — try again'; return; }
    msg.style.color = 'var(--green)'; msg.textContent = '✅ Request sent to Maxwell. He will confirm a time with the client.';
    document.getElementById('visit-note').value = '';
    this._toast('📤 Visit request sent');
  },

  // ── HELPERS ─────────────────────────────────────────────────────────────
  async _rpc(fn, args) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(args)
      });
      if (!r.ok) return { error: 'http_' + r.status };
      return await r.json();
    } catch (e) { return { error: e.message }; }
  },

  _show(state) {
    ['loading','main','error'].forEach(s => {
      const el = document.getElementById('state-'+s);
      if (el) el.style.display = (s === state) ? 'block' : 'none';
    });
  },

  _showError() { this._show('error'); },

  _toast(txt) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = txt;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 2600);
  },

  _fmt(iso) {
    if (!iso) return '';
    const d = typeof iso === 'string' && iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString('en-CA', { month:'short', day:'numeric', year:'numeric' });
  },

  _esc(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
};

document.addEventListener('DOMContentLoaded', () => BuilderPortal.init());
