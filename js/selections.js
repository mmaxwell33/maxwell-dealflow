// Maxwell DealFlow CRM — Buyer selections on a new build (migration 116)
//
// The builder's appendix lists appointments the buyers must make themselves:
// choose flooring, cabinets, countertops, colours and so on, each with a vendor
// and a date. Each one is a build_selections row:
//   • filled by the APS reader (apsdrop.js) or added by hand on the build card
//   • listed in the buyers' congratulations email (new_build_welcome)
//   • reminded 7 and 2 days before the due date, the day before a booked
//     appointment, and weekly once overdue, until marked done
//   • "Mark done" ticks the matching checklist step (flooring → "Flooring
//     picked up", cabinets → "Cabinets picked up"), and ticking that step on
//     the checklist marks the selection done, so the two never disagree.
//
// Every email goes through Notify.queue, so it waits in Approvals unless that
// email type is set to auto-approve.

const BuildSelections = {
  _byBuild: {},   // build_id -> rows, filled by paint()

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

  // Which checklist step a selection ticks. Only steps that ARE a buyer pick.
  stepFor(item) {
    const t = String(item || '').toLowerCase();
    if (/floor/.test(t))           return { stage: 'construction', step: 'flooring_pickup' };
    if (/cabinet|kitchen/.test(t)) return { stage: 'construction', step: 'cabinets_pickup' };
    return null;
  },

  STATUS: {
    to_book: { label: 'To book', color: 'var(--yellow)' },
    booked:  { label: 'Booked',  color: 'var(--accent2)' },
    done:    { label: 'Done',    color: 'var(--green)' },
  },

  // ── Build card section ────────────────────────────────────────────────────
  // NewBuilds.render writes an empty #nb-sel-<id> per card; this fills them all
  // with one query, the same way the visit banners are painted.
  async paint(list) {
    const ids = (list || []).map(b => b.id);
    if (!ids.length) return;
    ids.forEach(id => { if (BuildSelections._byBuild[id]) BuildSelections.paintOne(id); }); // no flicker on re-render
    const { data, error } = await db.from('build_selections').select('*').in('build_id', ids)
      .order('due_date', { ascending: true, nullsFirst: false });
    if (error) { console.warn('[BuildSelections] load skipped (run migration 116):', error.message); return; }
    BuildSelections._byBuild = {};
    (data || []).forEach(r => (BuildSelections._byBuild[r.build_id] ||= []).push(r));
    if (typeof VendorMail !== 'undefined') {
      try { await VendorMail.prime(list); await VendorMail.track(data); } catch (e) { console.warn('[VendorMail] track skipped:', e?.message || e); }
    }
    ids.forEach(id => BuildSelections.paintOne(id));
  },

  paintOne(buildId) {
    const el = document.getElementById('nb-sel-' + buildId);
    if (!el) return;
    const all = BuildSelections._byBuild[buildId] || [];
    const rows = all.filter(r => r.kind !== 'price_match');
    const quotes = id => all.filter(r => r.kind === 'price_match' && r.parent_id === id);
    const b = (NewBuilds.all || []).find(x => x.id === buildId);
    const vm = typeof VendorMail !== 'undefined';
    const done = rows.filter(r => r.status === 'done').length;
    const linkBtn = 'background:none;border:none;color:var(--accent2);cursor:pointer;font-size:11px;font-weight:600;padding:0;';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const row = (r, isQuote = false) => {
      const st = BuildSelections.STATUS[r.status] || BuildSelections.STATUS.to_book;
      const overdue = r.status !== 'done' && r.due_date && new Date(r.due_date + 'T00:00:00') < today;
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;${isQuote ? 'padding-left:26px;background:var(--bg);' : ''}border-top:1px solid var(--border);font-size:12px;">
        <div style="flex:1;min-width:0;${r.status === 'done' ? 'opacity:0.65;' : ''}">
          <div style="font-weight:700;color:var(--text1);${r.status === 'done' ? 'text-decoration:line-through;' : ''}">${isQuote ? '🔁 Quote · ' : ''}${BuildSelections.esc(r.item)}${r.vendor_name ? ` <span style="font-weight:400;color:var(--text2);">· ${BuildSelections.esc(r.vendor_name)}</span>` : ''}${r.kind === 'other' ? ' <span style="font-weight:400;font-size:10.5px;color:var(--text2);">(other appointment)</span>' : ''}</div>
          ${r.details ? `<div style="color:var(--text2);">${BuildSelections.esc(r.details)}</div>` : ''}
          <div style="color:${overdue ? 'var(--red)' : 'var(--text2)'};">
            ${r.due_date ? `${overdue ? '⚠️ Overdue · ' : ''}Due ${App.fmtDate(r.due_date)}` : 'No due date'}${r.appointment_date && r.status === 'booked' ? ` · Appointment ${App.fmtDate(r.appointment_date)}` : ''}${r.allowance ? ` · Allowance ${BuildSelections.esc(r.allowance)}` : ''}
          </div>
          ${vm ? VendorMail.trailHtml(r) : ''}
          ${vm && r.status !== 'done' ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;">
            ${!isQuote ? `<button style="${linkBtn}" onclick="VendorMail.openCompose('${buildId}','${r.id}','send')">✉️ ${r.vendor_queued_at ? 'Email vendor again' : VendorMail.emailOk(r.vendor_email) ? 'Email vendor' : 'Add vendor email'}</button>
            <button style="${linkBtn}" onclick="VendorMail.openCompose('${buildId}','${r.id}','quote')">🔁 Different vendor</button>` : ''}
          </div>` : ''}
        </div>
        <span style="font-size:10.5px;font-weight:700;color:${st.color};white-space:nowrap;">${st.label}</span>
        ${r.status === 'done'
          ? `<button class="btn btn-outline btn-sm" style="font-size:10.5px;padding:2px 8px;" onclick="BuildSelections.setDone('${r.id}',false)">Undo</button>`
          : `<button class="btn btn-outline btn-sm" style="font-size:10.5px;padding:2px 8px;color:var(--green);border-color:var(--green);" onclick="BuildSelections.setDone('${r.id}',true)">✓ Mark done</button>`}
        <button class="btn btn-outline btn-sm" style="font-size:10.5px;padding:2px 8px;" onclick="BuildSelections.openEdit('${buildId}','${r.id}')">✏️</button>
      </div>`;
    };
    el.innerHTML = `
      <div style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg);">
          <span style="font-size:13px;font-weight:700;color:${rows.length && done === rows.length ? 'var(--green)' : 'var(--text1)'};">🎨 Buyer Selections</span>
          <span style="font-size:11px;font-weight:600;color:var(--text2);">${rows.length ? `${done}/${rows.length} done` : 'None yet'}</span>
        </div>
        ${rows.map(r => row(r) + quotes(r.id).map(q => row(q, true)).join('')).join('')}
        ${vm && b ? VendorMail.gateHtml(b) : ''}
        ${vm && VendorMail._lastRead[buildId] ? `<div style="padding:7px 10px;border-top:1px solid var(--border);font-size:11.5px;color:${VendorMail._lastRead[buildId].ok ? 'var(--text1)' : 'var(--yellow)'};">📄 ${BuildSelections.esc(VendorMail._lastRead[buildId].text)}</div>` : ''}
        ${vm && !rows.length ? `<div style="padding:7px 10px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text2);">Each selection gets its own ✉️ Email vendor button. Add them with "+ Add selection" or tap "📄 Re-read the APS".</div>` : ''}
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding:7px 10px;border-top:1px solid var(--border);">
          <button onclick="BuildSelections.openEdit('${buildId}')" style="background:none;border:none;color:var(--accent2);cursor:pointer;font-size:12px;font-weight:600;padding:0;">+ Add selection</button>
          <button onclick="BuildSelections.openEdit('${buildId}',null,'other')" style="background:none;border:none;color:var(--accent2);cursor:pointer;font-size:12px;font-weight:600;padding:0;">+ Other appointment</button>
          ${vm && b && (!b.floor_plan_path || !rows.length || rows.some(r => r.vendor_name && !r.vendor_email && r.status !== 'done')) ? `<button onclick="VendorMail.rereadAps('${buildId}')" style="background:none;border:none;color:var(--accent2);cursor:pointer;font-size:12px;font-weight:600;padding:0;">📄 Re-read the APS</button>` : ''}
          ${rows.some(r => r.status !== 'done') ? `<button onclick="BuildSelections.queueWelcome('${buildId}',true)" style="background:none;border:none;color:var(--accent2);cursor:pointer;font-size:12px;font-weight:600;padding:0;">📧 Email buyers their to-do list</button>` : ''}
        </div>
      </div>`;
  },

  // ── Add / edit ────────────────────────────────────────────────────────────
  openEdit(buildId, selId = null, kind = null) {
    const r = selId ? (BuildSelections._byBuild[buildId] || []).find(x => x.id === selId) : null;
    const other = (r?.kind || kind) === 'other';
    BuildSelections._editKind = r?.kind || kind || 'appendix';
    const v = k => BuildSelections.esc(r?.[k] || '');
    App.openModal(`
      <div class="modal-title">${other ? '📅' : '🎨'} ${r ? (other ? 'Edit appointment' : 'Edit selection') : (other ? 'Add another appointment' : 'Add a buyer selection')}</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">WHAT THEY PICK *</label>
          <input class="form-input" id="bs-item" value="${v('item')}" placeholder="${other ? 'e.g. Electrical walkthrough' : 'e.g. Flooring'}" list="bs-items">
          <datalist id="bs-items">${['Flooring','Kitchen cabinets','Countertops','Tile','Lighting fixtures','Plumbing fixtures','Paint colours','Exterior colours','Appliances','Hardware','Stairs and railings'].map(o => `<option value="${o}">`).join('')}</datalist></div>
        <div class="form-group"><label class="form-label">VENDOR</label>
          <input class="form-input" id="bs-vendor" value="${v('vendor_name')}" placeholder="e.g. Kent Flooring Centre"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">VENDOR EMAIL</label>
          <input class="form-input" id="bs-email" type="email" value="${v('vendor_email')}" placeholder="For the vendor email"></div>
        <div class="form-group"><label class="form-label">VENDOR CONTACT</label>
          <input class="form-input" id="bs-contact" value="${v('vendor_contact')}" placeholder="Phone or address"></div>
      </div>
      <div class="form-group"><label class="form-label">WHAT TO CHOOSE THERE</label>
        <input class="form-input" id="bs-details" value="${v('details')}" placeholder="e.g. Hardwood colour for main floor, tile for bathrooms"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">MUST BE DONE BY</label>
          <input class="form-input" type="date" id="bs-due" value="${v('due_date')}"></div>
        <div class="form-group"><label class="form-label">STATUS</label>
          <select class="form-input form-select" id="bs-status">
            ${Object.entries(BuildSelections.STATUS).map(([k, s]) => `<option value="${k}" ${(r?.status || 'to_book') === k ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">APPOINTMENT DATE</label>
          <input class="form-input" type="date" id="bs-appt" value="${v('appointment_date')}"></div>
      </div>
      <div style="font-size:11.5px;color:var(--text2);margin-bottom:12px;line-height:1.5;">The buyers are reminded 7 and 2 days before it is due, the day before a booked appointment, and weekly once overdue, until it is marked done.</div>
      <button class="btn btn-primary btn-block" onclick="BuildSelections.saveEdit('${buildId}',${selId ? `'${selId}'` : 'null'})">💾 Save selection</button>
      ${r ? `<button class="btn btn-outline btn-block" style="margin-top:8px;color:var(--red);border-color:var(--red);" onclick="BuildSelections.remove('${buildId}','${selId}')">🗑 Remove</button>` : ''}
      <div id="bs-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async saveEdit(buildId, selId) {
    const msg = document.getElementById('bs-msg');
    const val = id => document.getElementById(id)?.value.trim() || null;
    const item = val('bs-item');
    if (!item) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Say what they pick'; } return; }
    const old = selId ? (BuildSelections._byBuild[buildId] || []).find(x => x.id === selId) : null;
    const status = val('bs-status') || 'to_book';
    const row = {
      item, vendor_name: val('bs-vendor'), vendor_contact: val('bs-contact'), details: val('bs-details'),
      due_date: val('bs-due'), appointment_date: val('bs-appt'), status,
      updated_at: new Date().toISOString(),
    };
    // A new date is a new countdown, so earlier reminders no longer count
    if (old && (old.due_date !== row.due_date || old.appointment_date !== row.appointment_date)) row.last_reminder = null;
    // Migration 117 columns, only sent when used, so this still saves before it runs
    const email = val('bs-email');
    const extra = { ...(email || old?.vendor_email ? { vendor_email: email } : {}),
                    ...(!selId && BuildSelections._editKind !== 'appendix' ? { kind: BuildSelections._editKind } : {}) };
    let error;
    if (selId) ({ error } = await db.from('build_selections').update({ ...row, ...extra }).eq('id', selId));
    else {
      const b = (NewBuilds.all || []).find(x => x.id === buildId);
      const user = await App.getAuthUser();
      ({ error } = await db.from('build_selections').insert({ ...row, ...extra, agent_id: user?.id || currentAgent.id, build_id: buildId, client_id: b?.client_id || null, source: 'manual' }));
    }
    if (!error && email && typeof VendorMail !== 'undefined') VendorMail.remember({ name: row.vendor_name, email });
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }
    App.closeModal();
    // Status chosen here follows the same done rule as the button
    if ((old?.status === 'done') !== (status === 'done')) await BuildSelections._syncStep(buildId, item, status === 'done');
    await BuildSelections.paint(NewBuilds.all || []);
    App.toast('🎨 Selection saved', 'var(--green)');
  },

  async remove(buildId, selId) {
    if (!confirm('Remove this selection? The buyers will no longer be reminded about it.')) return;
    const { error } = await db.from('build_selections').delete().eq('id', selId);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.closeModal();
    await BuildSelections.paint(NewBuilds.all || []);
  },

  // ── Done ⇄ checklist ──────────────────────────────────────────────────────
  async setDone(selId, done) {
    const r = Object.values(BuildSelections._byBuild).flat().find(x => x.id === selId);
    if (!r) return;
    const { error } = await db.from('build_selections').update({
      status: done ? 'done' : (r.appointment_date ? 'booked' : 'to_book'),
      done_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }).eq('id', selId);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    await BuildSelections._syncStep(r.build_id, r.item, done);
    await BuildSelections.paint(NewBuilds.all || []);
    App.toast(done ? `✅ ${r.item} marked done` : `${r.item} reopened`, done ? 'var(--green)' : 'var(--text2)');
  },

  // Tick (or untick) the matching checklist step, through the normal checkStep
  async _syncStep(buildId, item, done) {
    const map = BuildSelections.stepFor(item);
    const b = (NewBuilds.all || []).find(x => x.id === buildId);
    if (!map || !b) return;
    if (!!b.pipeline_milestones?.[map.stage]?.steps?.[map.step] === done) return;
    BuildSelections._fromSelection = true;
    try { await NewBuilds.checkStep(buildId, map.stage, map.step, done); }
    finally { BuildSelections._fromSelection = false; }
  },

  // Called by NewBuilds.checkStep: ticking "Flooring picked up" by hand closes
  // the flooring selection too. Untick reopens it.
  async onStepChecked(buildId, stepKey, checked) {
    if (BuildSelections._fromSelection) return;
    const rows = (BuildSelections._byBuild[buildId] || [])
      .filter(r => BuildSelections.stepFor(r.item)?.step === stepKey && (r.status === 'done') !== checked);
    if (!rows.length) return;
    for (const r of rows) {
      await db.from('build_selections').update({
        status: checked ? 'done' : (r.appointment_date ? 'booked' : 'to_book'),
        done_at: checked ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
      }).eq('id', r.id);
    }
    await BuildSelections.paint(NewBuilds.all || []);
  },

  // ── Saved from the APS reader when the build is created ──────────────────
  async saveFromAps(buildId, clientId, rows) {
    const clean = (rows || []).filter(r => r.item);
    if (!buildId || !clean.length) return 0;
    const user = await App.getAuthUser();
    const base = r => ({
      agent_id: user?.id || currentAgent.id, build_id: buildId, client_id: clientId || null,
      item: r.item, vendor_name: r.vendor_name || null, vendor_contact: r.vendor_contact || null,
      details: r.details || null, due_date: /^\d{4}-\d{2}-\d{2}$/.test(r.due_date || '') ? r.due_date : null,
      status: 'to_book', source: 'aps',
    });
    const full = r => ({ ...base(r), ...(typeof VendorMail !== 'undefined' ? VendorMail.vendorFields(r) : {}) });
    let { error } = await db.from('build_selections').insert(clean.map(full));
    // Before migration 117 the vendor columns do not exist: save the selections without them
    if (error && /column|schema cache/i.test(error.message || '')) ({ error } = await db.from('build_selections').insert(clean.map(base)));
    if (error) { console.warn('[BuildSelections] save from APS failed (run migration 116):', error.message); App.toast('⚠️ Selections not saved: ' + error.message, 'var(--yellow)'); return 0; }
    if (typeof VendorMail !== 'undefined') await VendorMail.fillFromBook(buildId).catch(() => 0);
    return clean.length;
  },

  // ── Emails ────────────────────────────────────────────────────────────────
  async _recipient(b) {
    let client = { full_name: b.client_name };
    if (b.client_id) {
      const { data } = await db.from('clients').select('id, full_name, email, phone').eq('id', b.client_id).maybeSingle();
      if (data) client = data;
    }
    if (typeof CoBuyer !== 'undefined') client = await CoBuyer.attach(client, b.client_id);
    const cc = typeof CoBuyer !== 'undefined' ? CoBuyer.cc(b.cc_email, client) : (b.cc_email || null);
    return { client, cc };
  },

  // Congratulations + what-to-do list. Queued when a build is created, and on
  // demand from the card (manual = true) after selections are added by hand.
  async queueWelcome(buildId, manual = false) {
    const { data: b } = await db.from('new_builds').select('*').eq('id', buildId).maybeSingle();
    if (!b) return false;
    const { client, cc } = await BuildSelections._recipient(b);
    if (!client.email) { if (manual) App.toast('⚠️ This client has no email address', 'var(--yellow)'); return false; }
    const { data: sels } = await db.from('build_selections').select('*').eq('build_id', buildId);
    const t = Notify.templates.new_build_welcome(client, b, (sels || []).filter(s => s.kind !== 'price_match'), currentAgent);
    const ok = await Notify.queue('New Build Welcome 🎉', client.id || null, client.full_name, client.email,
      t.subject, t.body, buildId, null, null, cc);
    if (ok !== false) App.toast(manual ? '📬 To-do list email is in Approvals' : '📬 Congratulations email is in Approvals', 'var(--green)');
    if (typeof Notify !== 'undefined') Notify.updateBadge?.();
    return true;
  },

  // APS signed by the buyers but not yet accepted by the builder: the same
  // "Offer Submitted" email as the Submit Offer flow. The congratulations
  // (queueWelcome) waits until the builder accepts.
  async queueSubmitted(buildId) {
    const { data: b } = await db.from('new_builds').select('*').eq('id', buildId).maybeSingle();
    if (!b) return false;
    const { client, cc } = await BuildSelections._recipient(b);
    if (!client.email) return false;
    const offer = {
      property_address: b.lot_address || 'your new build', offer_amount: b.purchase_price,
      offer_date: b.pa_submitted_date || new Date().toISOString().slice(0, 10),
      property_type: 'new_build', builder_name: b.builder_name,
    };
    const t = Notify.templates.offer_submitted(client, offer, currentAgent);
    await Notify.queue('Offer Submitted', client.id || null, client.full_name, client.email,
      t.subject, t.body, buildId, null, null, cc);
    App.toast('📬 Offer Submitted email is in Approvals. The congratulations waits for the builder to accept.', 'var(--green)');
    Notify.updateBadge?.();
    return true;
  },

  // Daily check (app startup). One reminder per selection per milestone:
  // 7 days before, 2 days before, the day before a booked appointment, and
  // once a week while overdue. Stops the moment the selection is done.
  async checkReminders() {
    if (!currentAgent?.id || typeof Notify === 'undefined') return 0;
    const { data: rows, error } = await db.from('build_selections').select('*').neq('status', 'done');
    if (error || !rows?.length) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayDiff = d => Math.round((new Date(String(d).slice(0, 10) + 'T00:00:00') - today) / 86400000);
    const builds = {};
    let n = 0;
    for (const s of rows) {
      if (s.kind === 'price_match') continue;   // a quote request, not a buyer to-do
      let when = null;
      if (s.status === 'booked' && s.appointment_date) {
        if (dayDiff(s.appointment_date) === 1 && s.last_reminder !== 'appt') when = 'appt';
      } else if (s.due_date) {
        const left = dayDiff(s.due_date);
        if (left === 7 && s.last_reminder !== '7d') when = '7d';
        else if (left === 2 && s.last_reminder !== '2d') when = '2d';
        else if (left < 0 && (s.last_reminder !== 'overdue'
                 || !s.last_reminded_at || (Date.now() - new Date(s.last_reminded_at)) >= 7 * 86400000)) when = 'overdue';
      }
      if (!when) continue;
      if (!(s.build_id in builds)) {
        const { data: b } = await db.from('new_builds').select('*').eq('id', s.build_id).maybeSingle();
        builds[s.build_id] = b || null;
      }
      const b = builds[s.build_id];
      // No reminders until the builder has accepted (offer only submitted), or once the build is done
      if (!b || b.status === 'Complete' || !b.pa_accepted_date) continue;
      // Claim it first, so a second device opening the app today does not queue it again
      const { data: claimed } = await db.from('build_selections')
        .update({ last_reminder: when, last_reminded_at: new Date().toISOString() })
        .eq('id', s.id).is('done_at', null)
        .or(`last_reminder.is.null,last_reminder.neq.${when}${when === 'overdue' ? `,last_reminded_at.lt."${new Date(Date.now() - 7 * 86400000).toISOString()}"` : ''}`)
        .select('id');
      if (!claimed?.length) continue;
      const { client, cc } = await BuildSelections._recipient(b);
      if (!client.email) continue;
      const t = Notify.templates.selection_reminder(client, b, s, when, currentAgent);
      await Notify.queue(`Selection Reminder (${when === 'overdue' ? 'overdue' : when === 'appt' ? 'appointment' : when})`,
        client.id || null, client.full_name, client.email, t.subject, t.body, s.build_id, null, null, cc);
      n++;
    }
    if (n) Notify.updateBadge?.();
    return n;
  },
};
