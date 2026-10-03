// Maxwell DealFlow CRM — Listing launch plan
//
// Everything done to get one home ready to list: what, who does it, when, and
// the seller's signed OK to go ahead with photos. Lives on the property's
// walkthrough record, under Prep visits.
//
//   Units      → taken from the property type (a 2 apartment is Top unit +
//                Basement unit). Each is Vacant, Tenant lives here or Seller
//                lives here, and that choice loads its checklist.
//   Who        → a dropdown on every item. Seller items are ticked by the
//                seller on their link; everything else is ticked here.
//   When       → a fixed date, or one that follows the key dates (Before
//                photos, Photo day, Before going live...). Moving the shoot
//                moves everything tied to it.
//   Sign-off   → launch-plan.html?t=<token>. The seller ticks their items and
//                signs. The next time this record opens, the signed copy is
//                filed: PDF to their Documents, "Your signed copy" email to
//                Approvals with the PDF attached.
//
// Item notes are PRIVATE: the seller's link never returns them.
// Requires migration 112. Without it the section says so and nothing else on
// the record is affected.

const LaunchPlan = {

  plan:     null,
  items:    [],
  template: null,
  _missing: false,
  _wt:      null,

  ROLES: [
    ['agent', 'Maxwell'], ['seller', 'Seller'], ['tenant', 'Tenant'],
    ['cleaner', 'Cleaner'], ['painter', 'Painter'], ['handyman', 'Handyman'],
    ['photographer', 'Photographer / videographer'], ['stager', 'Stager'],
    ['printer', 'Print shop'], ['lawyer', 'Lawyer'], ['vendor', 'Other vendor']
  ],

  OCC: { vacant: 'Vacant', tenant: 'Tenant lives here', owner: 'Seller lives here' },

  PROPERTY: 'Whole property',

  // [key, title, who, due]. No fixed dates: those belong to one sale, not to
  // every sale. Due keys follow the plan's own dates.
  BUILT_IN: {
    vacant: [
      ['keys', 'Keys received', 'agent', null],
      ['paint', 'Painting complete', 'seller', '@by-photo'],
      ['cosmetic', 'Small cosmetic repairs', 'seller', '@by-photo'],
      ['clean', 'Deep clean', 'cleaner', '@by-photo'],
      ['basics', 'Household basics placed: toilet paper, hand soap, paper towels, garbage bags', 'agent', '@by-photo'],
      ['lights', 'Heat on, every light bulb working', 'agent', '@by-photo'],
      ['lockbox', 'Lockbox and showing instructions set', 'agent', '@by-live'],
      ['stage', 'Staging', 'stager', '@by-photo']
    ],
    tenant: [
      ['notice', 'Tenant given written notice of photo and showing times', 'agent', '@by-photo'],
      ['tidy', 'Unit cleaned and tidied', 'tenant', '@by-photo'],
      ['clutter', 'Clutter put away, surfaces clear', 'tenant', '@by-photo'],
      ['valuables', 'Valuables and medication secured', 'tenant', '@by-photo'],
      ['arrange', 'Furniture arranged for photos', 'agent', '@photo']
    ],
    owner: [
      ['tidy', 'Home cleaned and tidied', 'seller', '@by-photo'],
      ['declutter', 'Declutter: counters, closets, family photos', 'seller', '@by-photo'],
      ['valuables', 'Valuables and medication secured', 'seller', '@by-photo'],
      ['stage', 'Light staging', 'agent', '@by-photo'],
      ['pets', 'Plan for pets during showings', 'seller', '@by-live']
    ],
    property: [
      ['agentvisits', 'Agent preview visits, check everything is accurate', 'agent', '@by-photo'],
      ['sheets', 'Feature sheets printed for agents and buyers', 'agent', '@by-live'],
      ['photos', 'Photos and video shoot', 'photographer', '@photo'],
      ['photoreview', 'Photos sent to seller to review', 'agent', '@photo+24'],
      ['video', 'Video sent to seller to review', 'agent', '@photo+48'],
      ['final', 'Final seller viewing', 'seller', '@final'],
      ['live', 'Listing goes live', 'agent', '@live'],
      ['offers', 'Offers due', 'agent', '@offers']
    ]
  },

  // Type-ahead suggestions for Add. [title, who, 'unit' | 'property', when]
  LIBRARY: [
    ['Keys received', 'agent', 'unit', ''], ['Painting complete', 'painter', 'unit', 'before-photos'],
    ['Small cosmetic repairs', 'handyman', 'unit', 'before-photos'], ['Deep clean', 'cleaner', 'unit', 'before-photos'],
    ['Carpets steam cleaned', 'cleaner', 'unit', 'before-photos'], ['Windows washed inside and out', 'cleaner', 'unit', 'before-photos'],
    ['Household basics placed: toilet paper, hand soap, paper towels', 'agent', 'unit', 'before-photos'],
    ['Heat on, every light bulb working', 'agent', 'unit', 'before-photos'], ['Lockbox and showing instructions set', 'agent', 'unit', 'before-live'],
    ['Smoke and CO detectors working', 'seller', 'unit', 'before-photos'], ['Declutter: counters, closets, family photos', 'seller', 'unit', 'before-photos'],
    ['Valuables and medication secured', 'seller', 'unit', 'before-photos'], ['Plan for pets during showings', 'seller', 'unit', 'before-live'],
    ['Light staging', 'stager', 'unit', 'before-photos'], ['Full staging', 'stager', 'unit', 'before-photos'],
    ['Tenant given written notice of photo and showing times', 'agent', 'unit', 'before-photos'],
    ['Unit cleaned and tidied', 'tenant', 'unit', 'before-photos'], ['Furniture arranged for photos', 'agent', 'unit', 'photo-day'],
    ['Lawn cut, walkway clear', 'seller', 'property', 'before-photos'], ['Snow cleared, walkway salted', 'seller', 'property', 'before-live'],
    ['Garbage and recycling out of sight', 'seller', 'property', 'photo-day'], ['Cars moved out of the driveway', 'seller', 'property', 'photo-day'],
    ['Feature sheets printed for agents and buyers', 'agent', 'property', 'before-live'], ['Sign installed on the lawn', 'agent', 'property', 'before-live'],
    ['Agent preview visits, check everything is accurate', 'agent', 'property', 'before-photos'],
    ['Floor plan measured', 'photographer', 'property', 'photo-day'], ['Drone photos', 'photographer', 'property', 'photo-day'],
    ['Utility bills and property tax bill gathered', 'seller', 'property', 'before-live'], ['Survey and permits located', 'seller', 'property', 'before-live']
  ],

  WHEN: [
    ['', 'No date'], ['@by-photo', 'Before photos'], ['@photo', 'Photo day'],
    ['@by-final', 'Before final viewing'], ['@by-live', 'Before going live'], ['pick', 'Pick a date and time…']
  ],

  esc(s) { return (typeof Walkthrough !== 'undefined' ? Walkthrough.esc(s) : String(s ?? '')); },
  whoLabel(w) { return (LaunchPlan.ROLES.find(r => r[0] === w) || [w, 'Other vendor'])[1]; },
  whoColor(w) { return w === 'agent' ? 'var(--accent2)' : w === 'seller' ? '#0ea5e9' : 'var(--text2)'; },
  whoOptions(sel) { return LaunchPlan.ROLES.map(r => `<option value="${r[0]}"${r[0] === sel ? ' selected' : ''}>${r[1]}</option>`).join(''); },
  first(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; },

  // ── Dates ─────────────────────────────────────────────────────────────────
  parseLocal(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(v || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) : null;
  },
  // Same rule in launch-plan.html and _launch_item_needed_to_sign() in 112.
  neededToSign(due, photo) {
    if (!due) return true;
    if (due === '@by-photo' || due === '@photo') return true;
    if (due.charAt(0) === '@') return false;
    if (!photo) return true;
    return due <= photo;
  },
  resolveDue(due, dates) {
    const L = LaunchPlan, d = dates || {};
    if (!due) return null;
    if (due.charAt(0) !== '@') { const x = L.parseLocal(due); return x ? { d: x } : null; }
    const photo = L.parseLocal(d.photo);
    const map = {
      '@photo':    photo && { d: photo },
      '@by-photo': photo && { d: photo, by: true },
      '@photo+24': photo && { d: new Date(photo.getTime() + 864e5) },
      '@photo+48': photo && { d: new Date(photo.getTime() + 1728e5) },
      '@final':    L.parseLocal(d.final) && { d: L.parseLocal(d.final) },
      '@by-final': L.parseLocal(d.final) && { d: L.parseLocal(d.final), by: true },
      '@live':     L.parseLocal(d.live) && { d: L.parseLocal(d.live) },
      '@by-live':  L.parseLocal(d.live) && { d: L.parseLocal(d.live), by: true },
      '@offers':   L.parseLocal(d.offers) && { d: L.parseLocal(d.offers), dateOnly: true }
    };
    return map[due] || null;
  },
  fmtWhen(r) {
    if (!r || !r.d || isNaN(r.d)) return '';
    const d = r.d;
    let s = d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
    if (!r.dateOnly && (d.getHours() || d.getMinutes())) {
      s += ', ' + (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() >= 12 ? ' PM' : ' AM');
    }
    return (r.by ? 'By ' : '') + s;
  },
  // "Friday, October 2, 4:12 PM": signature times, written the same everywhere.
  fmtStamp(iso, long) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    const day = d.toLocaleDateString('en-CA', long ? { weekday: 'long', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric' });
    return day + ', ' + (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() >= 12 ? ' PM' : ' AM');
  },
  dueText(due, dates) {
    const r = LaunchPlan.resolveDue(due, dates);
    if (r) return LaunchPlan.fmtWhen(r);
    const pending = { '@photo': 'Photo day', '@by-photo': 'Before photos', '@photo+24': 'Photo day + 24 h', '@photo+48': 'Photo day + 48 h',
                      '@final': 'Final viewing', '@by-final': 'Before final viewing', '@live': 'Listing live', '@by-live': 'Before going live', '@offers': 'Offers due' };
    return pending[due] || '';
  },

  // ── Load ──────────────────────────────────────────────────────────────────
  async loadFor(walkthroughId) {
    const L = LaunchPlan;
    L.plan = null; L.items = []; L._missing = false;
    L._wt = typeof Walkthrough !== 'undefined' ? Walkthrough.current : null;
    try {
      const { data: plan, error } = await db.from('listing_launch_plans').select('*').eq('walkthrough_id', walkthroughId).maybeSingle();
      if (error) { L._missing = true; console.warn('[LaunchPlan] load skipped (run migration 112?):', error.message); return; }
      L.plan = plan || null;
      if (plan) {
        const { data: items, error: iErr } = await db.from('listing_launch_items').select('*')
          .eq('plan_id', plan.id).order('sort_order').order('created_at');
        if (iErr) { console.warn('[LaunchPlan] items', iErr.message); }
        L.items = items || [];
        // Signed on the seller's link since this record was last opened: file the copy.
        if (plan.status === 'signed' && !plan.copy_filed_at) L.fileSignedCopy();
      }
    } catch (e) {
      L._missing = true;
      console.warn('[LaunchPlan] load failed', e);
    }
  },

  async loadTemplate() {
    const L = LaunchPlan;
    if (L.template) return L.template;
    const uid = await Walkthrough.uid();
    const { data } = await db.from('launch_plan_templates').select('items').eq('agent_id', uid).maybeSingle();
    L.template = (data && data.items && typeof data.items === 'object' && !Array.isArray(data.items)) ? data.items : {};
    return L.template;
  },
  tplFor(kind) {
    const t = LaunchPlan.template || {};
    return Array.isArray(t[kind]) && t[kind].length ? t[kind] : LaunchPlan.BUILT_IN[kind] || [];
  },

  unitNames() { return (LaunchPlan.plan?.units || []).map(u => u.name); },

  // ── Section on the property record ────────────────────────────────────────
  sectionHTML() {
    const L = LaunchPlan, p = L.plan;
    const wrap = inner => `<div class="card" id="lp-section" style="padding:16px;margin-bottom:14px;">${inner}</div>`;
    const head = btn => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <div style="font-size:15px;font-weight:800;">📋 Launch plan</div>${btn}
      </div>`;

    if (L._missing) {
      return wrap(head('') + `<div style="font-size:12.5px;color:var(--yellow);">Launch plan needs migration 112. Run it in the Supabase SQL Editor, then reopen this record.</div>`);
    }
    if (!p) {
      return wrap(head(`<button class="btn btn-primary btn-sm" onclick="LaunchPlan.create()">+ Start launch plan</button>`) +
        `<div style="font-size:12.5px;color:var(--text2);">The checklist and dates for getting this home listed: who does what, and when. The seller ticks their items and signs off on their own link before photos.</div>`);
    }

    const live = L.items.filter(i => i.status !== 'skip');
    const done = live.filter(i => i.status === 'done').length;
    const now = new Date();
    const next = live.filter(i => i.status !== 'done')
      .map(i => ({ i, r: L.resolveDue(i.due, p.dates) }))
      .filter(x => x.r && x.r.d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
      .sort((a, b) => a.r.d - b.r.d)[0];
    const st = L.statusInfo();

    return wrap(head(`<span style="font-size:11px;font-weight:800;color:${st.c};border:1px solid ${st.c};border-radius:999px;padding:3px 9px;">${st.t}</span>`) + `
      <div style="font-size:13px;color:var(--text2);">${done} of ${live.length} done${next ? ` · Next: ${L.esc(next.i.title)} (${L.esc(L.fmtWhen(next.r))})` : ''}</div>
      ${st.note ? `<div style="font-size:12.5px;margin-top:6px;">${st.note}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-primary btn-sm" onclick="LaunchPlan.openEditor()">Open plan</button>
      </div>`);
  },

  statusInfo() {
    const L = LaunchPlan, p = L.plan;
    if (!p) return { t: '', c: 'var(--text2)' };
    if (p.status === 'signed') {
      const changed = L.changedSinceSigned();
      const when = L.fmtStamp(p.signed_at);
      let note = `✍️ Signed by ${L.esc(p.signed_name || 'the seller')}${when ? ', ' + L.esc(when) : ''}.`;
      if (p.media_approved_at) note += ' Photos and video approved.';
      if (changed) note += ` <span style="color:var(--yellow);">You changed the plan after they signed.</span>`;
      return changed ? { t: 'Changed since signed', c: 'var(--yellow)', note } : { t: 'Signed', c: 'var(--green)', note };
    }
    if (p.status === 'sent') {
      const open = L.sellerOpenToSign();
      return { t: 'Waiting for seller', c: 'var(--yellow)', note: open ? `${open} seller item${open === 1 ? '' : 's'} still to tick before they can sign.` : 'Their items are done. Waiting for the signature.' };
    }
    return { t: 'Draft', c: 'var(--text2)', note: '' };
  },

  sellerOpenToSign() {
    const L = LaunchPlan, photo = L.plan?.dates?.photo || null;
    return L.items.filter(i => i.who === 'seller' && i.status === 'open' && L.neededToSign(i.due, photo)).length;
  },

  // Only Maxwell's edits count. Ticks (either side) are progress, not changes.
  shape(list) {
    return (list || []).filter(i => i.status !== 'skip')
      .map(i => [i.unit, i.title, i.who, i.due || ''].join('|')).sort().join('\n');
  },
  changedSinceSigned() {
    const L = LaunchPlan, snap = L.plan?.signed_snapshot;
    if (!snap) return false;
    // Key order differs between Postgres jsonb and a JS object, so compare sorted.
    const norm = o => Object.keys(o || {}).filter(k => o[k]).sort().map(k => k + '=' + o[k]).join('&');
    const datesChanged = norm(snap.dates) !== norm(L.plan.dates);
    return datesChanged || L.shape(snap.items) !== L.shape(L.items);
  },

  refreshSection() {
    const el = document.getElementById('lp-section');
    if (el) el.outerHTML = LaunchPlan.sectionHTML();
  },

  // ── Create ────────────────────────────────────────────────────────────────
  async create() {
    const L = LaunchPlan, wt = Walkthrough.current;
    if (!wt) return;
    const uid = await Walkthrough.uid();
    await L.loadTemplate();
    const names = (typeof PrepVisit !== 'undefined' ? PrepVisit.unitsFor(wt.property_type) : ['Whole home'])
      .filter(n => n !== 'Exterior and grounds');
    const units = names.map(name => ({ name, occ: 'owner' }));

    const { data: plan, error } = await db.from('listing_launch_plans').insert({
      agent_id: uid, walkthrough_id: wt.id, client_id: wt.client_id || null, units, dates: {}
    }).select('*').single();
    if (error) { App.toast('⚠️ ' + error.message + ' (run migration 112?)', 'var(--red)'); return; }
    L.plan = plan;

    const rows = [];
    units.forEach(u => L.tplFor(u.occ).forEach(t => rows.push(L.rowFrom(t, u.name))));
    L.tplFor('property').forEach(t => rows.push(L.rowFrom(t, L.PROPERTY)));
    rows.forEach((r, n) => { r.sort_order = n * 10; });
    const { data: items, error: iErr } = await db.from('listing_launch_items').insert(rows).select('*');
    if (iErr) { App.toast('⚠️ ' + iErr.message, 'var(--red)'); }
    L.items = (items || []).sort((a, b) => a.sort_order - b.sort_order);

    await Walkthrough.log('LAUNCH_PLAN_STARTED', wt.clients, `Launch plan started for ${wt.property_address}`, wt.client_id);
    L.refreshSection();
    L.openEditor();
  },

  rowFrom(t, unit) {
    return {
      plan_id: LaunchPlan.plan.id, agent_id: LaunchPlan.plan.agent_id,
      item_key: t[0] || null, unit, title: t[1], who: t[2] || 'agent', due: t[3] || null, status: 'open'
    };
  },

  // ── Editor ────────────────────────────────────────────────────────────────
  async openEditor() {
    const L = LaunchPlan, p = L.plan, wt = Walkthrough.current;
    if (!p || !wt) return;
    L.loadTemplate().catch(() => {});
    const d = p.dates || {};
    const field = (id, label, type, val) => `
      <div class="form-group" style="margin-bottom:8px;"><label class="form-label" for="${id}">${label}</label>
        <input class="form-input" type="${type}" id="${id}" value="${L.esc(val || '')}" onchange="LaunchPlan.saveDates()"></div>`;

    App.openModal(`
      <div class="modal-title">📋 Launch plan</div>
      <div style="font-size:13px;color:var(--text2);margin:-4px 0 12px;">${L.esc(wt.property_address)}${wt.clients?.full_name ? ' · 👤 ' + L.esc(wt.clients.full_name) : ''}</div>

      <div id="lp-units"></div>

      <div style="font-size:13px;font-weight:800;margin:12px 0 6px;">Key dates</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${field('lp-photo', 'Photo shoot', 'datetime-local', d.photo)}
        ${field('lp-final', 'Final seller viewing', 'datetime-local', d.final)}
        ${field('lp-live', 'Listing goes live', 'datetime-local', d.live)}
        ${field('lp-offers', 'Offers due', 'date', d.offers)}
      </div>
      <div style="font-size:11.5px;color:var(--text2);margin-bottom:6px;">Photos to review = shoot + 24 hours. Video = shoot + 48 hours.</div>
      <div id="lp-warn"></div>

      <div id="lp-list" style="margin-top:12px;"></div>

      <div style="border-top:1px dashed var(--border);margin-top:12px;padding-top:12px;">
        <label class="form-label" for="lp-new">Add an item: start typing and pick, or type your own</label>
        <input class="form-input" id="lp-new" list="lp-lib" autocomplete="off" placeholder="e.g. snow, lawn, staging" oninput="LaunchPlan.onNewInput()" onkeydown="if(event.key==='Enter'){event.preventDefault();LaunchPlan.addItem();}">
        <datalist id="lp-lib">${L.LIBRARY.map(x => `<option value="${L.esc(x[0])}"></option>`).join('')}</datalist>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">
          <select class="form-input form-select" id="lp-new-unit" aria-label="Where"></select>
          <select class="form-input form-select" id="lp-new-who" aria-label="Who does it">${L.whoOptions('agent')}</select>
          <select class="form-input form-select" id="lp-new-when" aria-label="When" onchange="LaunchPlan.onNewWhen()">${L.WHEN.map(w => `<option value="${w[0]}">${w[1]}</option>`).join('')}</select>
          <button class="btn btn-primary" onclick="LaunchPlan.addItem()">Add</button>
        </div>
        <input class="form-input" type="datetime-local" id="lp-new-date" style="margin-top:6px;display:none;" aria-label="Date and time">
      </div>

      <div id="lp-foot" style="border-top:1px solid var(--border);margin-top:14px;padding-top:12px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-outline btn-sm" onclick="LaunchPlan.saveTemplate()">Save as my default checklist</button>
        <button class="btn btn-outline btn-sm" onclick="App.closeModal()">Close</button>
      </div>
    `);
    L.renderEditor();
  },

  renderEditor() {
    const L = LaunchPlan;
    if (!document.getElementById('lp-list')) { L.refreshSection(); return; }
    L.renderUnits(); L.renderWarnings(); L.renderList(); L.renderFoot(); L.fillUnitPicker();
    L.refreshSection();
  },

  renderUnits() {
    const L = LaunchPlan, el = document.getElementById('lp-units');
    if (!el) return;
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">` +
      (L.plan.units || []).map((u, n) => `
        <div class="form-group" style="margin-bottom:0;"><label class="form-label" for="lp-occ-${n}">${L.esc(u.name)}</label>
          <select class="form-input form-select" id="lp-occ-${n}" onchange="LaunchPlan.setOcc(${n}, this.value)">
            ${Object.keys(L.OCC).map(k => `<option value="${k}"${u.occ === k ? ' selected' : ''}>${L.OCC[k]}</option>`).join('')}
          </select></div>`).join('') + `</div>`;
  },

  renderWarnings() {
    const L = LaunchPlan, el = document.getElementById('lp-warn');
    if (!el) return;
    const d = L.plan.dates || {}, photo = L.parseLocal(d.photo), live = L.parseLocal(d.live), fin = L.parseLocal(d.final), off = L.parseLocal(d.offers);
    const w = [];
    if (!photo) w.push('Add the photo shoot date. The seller\'s "before photos" items and the review dates follow it.');
    if (photo && live) {
      const video = new Date(photo.getTime() + 1728e5);
      if (live < photo) w.push('The listing goes live before the photo shoot.');
      else if (live < video) w.push(`Video is due ${L.fmtWhen({ d: video })}, after the listing goes live. Move "live" later, or launch with photos and add the video after.`);
    }
    if (fin && live && fin > live) w.push('The final seller viewing is after the listing goes live.');
    if (off && live && new Date(off.getFullYear(), off.getMonth(), off.getDate(), 23, 59) < live) w.push('Offers are due before the listing goes live.');
    el.innerHTML = w.map(t => `<div style="font-size:12.5px;color:var(--yellow);border:1px solid var(--yellow);border-radius:8px;padding:7px 10px;margin-top:6px;">⚠️ ${L.esc(t)}</div>`).join('');
  },

  renderList() {
    const L = LaunchPlan, el = document.getElementById('lp-list');
    if (!el) return;
    const groups = [...L.unitNames(), L.PROPERTY];
    // Items left on a unit name that no longer exists still show, at the end.
    L.items.forEach(i => { if (!groups.includes(i.unit)) groups.push(i.unit); });
    el.innerHTML = groups.map(g => {
      const list = L.items.filter(i => i.unit === g);
      if (!list.length) return '';
      const live = list.filter(i => i.status !== 'skip');
      return `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin:12px 0 4px;">
          <div style="font-size:13.5px;font-weight:800;">${L.esc(g)}</div>
          <div style="font-size:11.5px;color:var(--text2);">${live.filter(i => i.status === 'done').length} of ${live.length} done</div>
        </div>
        ${list.map(i => L.rowHTML(i)).join('')}`;
    }).join('');
  },

  rowHTML(i) {
    const L = LaunchPlan, skip = i.status === 'skip', done = i.status === 'done';
    const when = L.dueText(i.due, L.plan.dates);
    const custom = !i.item_key || i.item_key.indexOf('c-') === 0;
    return `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:9px;align-items:start;padding:8px 0;border-bottom:1px solid var(--border);${skip ? 'opacity:.55;' : ''}">
        <button aria-label="${done ? 'Mark not done' : 'Mark done'}: ${L.esc(i.title)}" ${skip ? 'disabled' : ''}
          onclick="LaunchPlan.toggle('${i.id}')"
          style="width:26px;height:26px;border-radius:7px;cursor:pointer;font-weight:800;border:2px solid ${done ? 'var(--green)' : 'var(--border)'};background:${done ? 'var(--green)' : 'transparent'};color:#fff;">${done ? '✓' : ''}</button>
        <div style="min-width:0;">
          <div style="font-size:13.5px;font-weight:600;${skip ? 'text-decoration:line-through;' : ''}">${L.esc(i.title)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px;">
            <select aria-label="Who does: ${L.esc(i.title)}" onchange="LaunchPlan.setWho('${i.id}', this.value)"
              style="font-size:12px;font-weight:700;padding:2px 6px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:${L.whoColor(i.who)};">${L.whoOptions(i.who)}</select>
            ${when ? `<span style="font-size:12px;color:var(--text2);">${L.esc(when)}</span>` : ''}
            ${done && i.done_by === 'seller' ? `<span style="font-size:11.5px;color:var(--green);">ticked by seller</span>` : ''}
            <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11.5px;" onclick="LaunchPlan.toggleSkip('${i.id}')">${skip ? 'Restore' : 'Not needed'}</button>
            ${custom ? `<button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11.5px;" onclick="LaunchPlan.removeItem('${i.id}')">Remove</button>` : ''}
          </div>
        </div>
      </div>`;
  },

  renderFoot() {
    const L = LaunchPlan, el = document.getElementById('lp-foot'), p = L.plan, wt = Walkthrough.current;
    if (!el) return;
    const st = L.statusInfo();
    const email = wt?.clients?.email;
    const changed = p.status === 'signed' && L.changedSinceSigned();
    const btn = !wt?.client_id ? `<div style="font-size:12px;color:var(--yellow);">Attach a seller to this record to send the plan for sign-off.</div>`
      : !email ? `<div style="font-size:12px;color:var(--yellow);">This seller has no email address on file.</div>`
      : p.status === 'draft' ? `<button class="btn btn-primary" onclick="LaunchPlan.send()">📧 Send to seller for sign-off</button>`
      : p.status === 'sent' ? `<button class="btn btn-outline" onclick="LaunchPlan.send()">📧 Send the link again</button>`
      : changed ? `<button class="btn btn-primary" onclick="LaunchPlan.send(true)">📧 Ask seller to re-sign</button>` : '';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="font-size:13.5px;font-weight:800;">Seller sign-off</div>
        <span style="font-size:11px;font-weight:800;color:${st.c};border:1px solid ${st.c};border-radius:999px;padding:3px 9px;">${st.t}</span>
      </div>
      ${st.note ? `<div style="font-size:12.5px;color:var(--text2);margin:6px 0;">${st.note}</div>` : ''}
      <div style="margin-top:8px;">${btn}</div>`;
  },

  fillUnitPicker() {
    const L = LaunchPlan, sel = document.getElementById('lp-new-unit');
    if (!sel) return;
    const cur = sel.value;
    const opts = [...L.unitNames(), L.PROPERTY];
    sel.innerHTML = opts.map(o => `<option${o === cur ? ' selected' : ''}>${L.esc(o)}</option>`).join('');
  },

  // ── Edits (each one saved straight away) ──────────────────────────────────
  async _upd(id, patch) {
    const L = LaunchPlan, it = L.items.find(i => i.id === id);
    if (!it) return false;
    const before = { ...it };
    Object.assign(it, patch);
    L.renderEditor();
    const { error } = await db.from('listing_launch_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      Object.assign(it, before);
      L.renderEditor();
      App.toast('⚠️ Not saved: ' + error.message, 'var(--red)');
      return false;
    }
    return true;
  },

  toggle(id) {
    const it = LaunchPlan.items.find(i => i.id === id);
    if (!it || it.status === 'skip') return;
    const done = it.status !== 'done';
    return LaunchPlan._upd(id, { status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null, done_by: done ? 'agent' : null });
  },
  toggleSkip(id) {
    const it = LaunchPlan.items.find(i => i.id === id);
    if (!it) return;
    return LaunchPlan._upd(id, { status: it.status === 'skip' ? 'open' : 'skip', done_at: null, done_by: null });
  },
  setWho(id, who) {
    if (!LaunchPlan.ROLES.some(r => r[0] === who)) return;
    return LaunchPlan._upd(id, { who });
  },

  async removeItem(id) {
    const L = LaunchPlan, it = L.items.find(i => i.id === id);
    if (!it || !confirm(`Remove "${it.title}" from this plan?`)) return;
    const { error } = await db.from('listing_launch_items').delete().eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    L.items = L.items.filter(i => i.id !== id);
    L.renderEditor();
  },

  async _savePlan(patch) {
    const L = LaunchPlan;
    const { error } = await db.from('listing_launch_plans').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', L.plan.id);
    if (error) { App.toast('⚠️ Not saved: ' + error.message, 'var(--red)'); return false; }
    Object.assign(L.plan, patch);
    return true;
  },

  async saveDates() {
    const L = LaunchPlan, v = id => document.getElementById(id)?.value || null;
    const dates = { photo: v('lp-photo'), final: v('lp-final'), live: v('lp-live'), offers: v('lp-offers') };
    Object.keys(dates).forEach(k => { if (!dates[k]) delete dates[k]; });
    if (await L._savePlan({ dates })) { L.renderWarnings(); L.renderList(); L.renderFoot(); L.refreshSection(); }
  },

  // Switching a unit's type swaps its template items. Anything already done,
  // and anything added by hand, stays.
  async setOcc(n, occ) {
    const L = LaunchPlan, units = (L.plan.units || []).map(u => ({ ...u }));
    if (!units[n] || !L.OCC[occ] || units[n].occ === occ) return;
    const name = units[n].name;
    await L.loadTemplate();
    const drop = L.items.filter(i => i.unit === name && i.item_key && i.item_key.indexOf('c-') !== 0 && i.status !== 'done');
    if (drop.length) {
      const { error } = await db.from('listing_launch_items').delete().in('id', drop.map(i => i.id));
      if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); L.renderUnits(); return; }
    }
    L.items = L.items.filter(i => !drop.includes(i));
    const have = new Set(L.items.filter(i => i.unit === name).map(i => i.item_key));
    const base = Math.max(0, ...L.items.filter(i => i.unit === name).map(i => i.sort_order || 0));
    const rows = L.tplFor(occ).filter(t => !have.has(t[0])).map((t, k) => ({ ...L.rowFrom(t, name), sort_order: base + 1 + k }));
    if (rows.length) {
      const { data, error } = await db.from('listing_launch_items').insert(rows).select('*');
      if (error) App.toast('⚠️ ' + error.message, 'var(--red)');
      L.items = L.items.concat(data || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
    units[n].occ = occ;
    await L._savePlan({ units });
    L.renderEditor();
  },

  onNewInput() {
    const L = LaunchPlan, v = (document.getElementById('lp-new')?.value || '').trim().toLowerCase();
    const hit = L.LIBRARY.find(x => x[0].toLowerCase() === v);
    if (!hit) return;
    document.getElementById('lp-new-who').value = hit[1];
    const unitSel = document.getElementById('lp-new-unit');
    if (hit[2] === 'property') unitSel.value = L.PROPERTY;
    else if (unitSel.value === L.PROPERTY && L.unitNames().length) unitSel.value = L.unitNames()[0];
    const map = { '': '', 'before-photos': '@by-photo', 'photo-day': '@photo', 'before-live': '@by-live' };
    document.getElementById('lp-new-when').value = map[hit[3]] ?? '';
    document.getElementById('lp-new-date').style.display = 'none';
  },
  onNewWhen() {
    const pick = document.getElementById('lp-new-when').value === 'pick';
    const el = document.getElementById('lp-new-date');
    el.style.display = pick ? 'block' : 'none';
    if (pick) el.focus();
  },

  async addItem() {
    const L = LaunchPlan, title = (document.getElementById('lp-new')?.value || '').trim();
    if (!title) { document.getElementById('lp-new')?.focus(); App.toast('Type or pick an item first', 'var(--yellow)'); return; }
    const who = document.getElementById('lp-new-who').value;
    const unit = document.getElementById('lp-new-unit').value || L.PROPERTY;
    const wv = document.getElementById('lp-new-when').value;
    let due = wv || null;
    if (wv === 'pick') {
      due = document.getElementById('lp-new-date').value || null;
      if (!due) { document.getElementById('lp-new-date').focus(); App.toast('Pick a date and time, or choose another option', 'var(--yellow)'); return; }
    }
    const sort = Math.max(0, ...L.items.filter(i => i.unit === unit).map(i => i.sort_order || 0)) + 1;
    const { data, error } = await db.from('listing_launch_items').insert({
      plan_id: L.plan.id, agent_id: L.plan.agent_id, item_key: null, unit, title: title.slice(0, 300), who, due, status: 'open', sort_order: sort
    }).select('*').single();
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    L.items.push(data);
    L.items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    document.getElementById('lp-new').value = '';
    document.getElementById('lp-new-when').value = '';
    document.getElementById('lp-new-date').value = '';
    document.getElementById('lp-new-date').style.display = 'none';
    L.renderEditor();
    document.getElementById('lp-new')?.focus();
    App.toast(`Added for ${L.whoLabel(who)}`, 'var(--green)');
  },

  // The checklist as it stands becomes the starting list for every new seller,
  // per unit type. Fixed dates and ticks are not copied.
  async saveTemplate() {
    const L = LaunchPlan;
    await L.loadTemplate();
    const tpl = { ...(L.template || {}) };
    const strip = i => [i.item_key || ('c-' + i.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)), i.title, i.who,
                        i.due && i.due.charAt(0) === '@' ? i.due : null];
    const seen = new Set();
    (L.plan.units || []).forEach(u => {
      if (seen.has(u.occ)) return;   // first unit of each type speaks for that type
      seen.add(u.occ);
      tpl[u.occ] = L.items.filter(i => i.unit === u.name && i.status !== 'skip').map(strip);
    });
    tpl.property = L.items.filter(i => i.unit === L.PROPERTY && i.status !== 'skip').map(strip);
    const uid = await Walkthrough.uid();
    const { error } = await db.from('launch_plan_templates').upsert({ agent_id: uid, items: tpl, updated_at: new Date().toISOString() });
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    L.template = tpl;
    App.toast('✅ Saved. New sellers start from this checklist.', 'var(--green)');
  },

  // ── Send for sign-off ─────────────────────────────────────────────────────
  link() { return `${location.origin}/launch-plan.html?t=${LaunchPlan.plan.seller_token}`; },

  requestLetter(client, wt, again, agent) {
    const L = LaunchPlan, d = L.plan.dates || {};
    const mine = L.items.filter(i => i.who === 'seller' && i.status !== 'skip' && i.item_key !== 'final').length;
    const photo = L.parseLocal(d.photo);
    const body = [
      `Hi ${L.first(client.full_name)},`,
      again
        ? `I have made some changes to the plan for getting ${wt.property_address} ready to list since you signed it. Please look over the updated version and sign again.`
        : `Here is the plan for getting ${wt.property_address} ready to list: what is being done, who is looking after each part, and when.`,
      mine ? `There ${mine === 1 ? 'is 1 item' : `are ${mine} items`} on it for you. Please tick each one once it is done.` : 'Nothing on it needs doing by you.',
      `You can see it here:\n${L.link()}`,
      `Once your items are ticked, type your name at the bottom to sign. That tells me the home is ready and I can go ahead with photos${photo ? ` on ${L.fmtWhen({ d: photo })}` : ''}.`,
      'Signing confirms the home is ready to market. It does not replace your Listing Agreement.',
      EmailFormat.signaturePlain(agent),
      EmailFormat.disclaimerPlain().trim()
    ].join('\n\n');
    return { subject: `${again ? 'Updated: ' : ''}Your listing launch plan for ${wt.property_address}`, body };
  },

  async send(resign) {
    const L = LaunchPlan, wt = Walkthrough.current, client = wt?.clients;
    if (!wt?.client_id || !client) { App.toast('⚠️ Attach a seller first', 'var(--yellow)'); return; }
    if (!client.email) { App.toast('⚠️ That seller has no email address on file', 'var(--red)'); return; }
    if (!L.plan.dates?.photo && !confirm('There is no photo shoot date yet, so every seller item will be needed before they can sign. Send anyway?')) return;

    const now = new Date().toISOString();
    // sent_at is what makes the seller's link work, so it lands before the email.
    if (!await L._savePlan({ status: 'sent', sent_at: L.plan.sent_at || now })) return;
    const t = L.requestLetter(client, wt, !!resign, currentAgent);
    await Notify.queue('Launch Plan: Sign-off', wt.client_id, client.full_name, client.email, t.subject, t.body, L.plan.id);
    await Walkthrough.log('LAUNCH_PLAN_SENT', client, `Launch plan for ${wt.property_address} sent to ${client.full_name} for ${resign ? 're-' : ''}sign-off`, wt.client_id);
    App.toast('📧 Waiting in Approvals for your review', 'var(--green)');
    L.renderEditor();
  },

  // ── Signed copy ───────────────────────────────────────────────────────────
  // Runs from loadFor once per signature. copy_filed_at is claimed first, so
  // two open tabs cannot file it twice; if any step fails it is released and
  // the next open tries again.
  async fileSignedCopy() {
    const L = LaunchPlan, p = L.plan, wt = L._wt;
    if (!p || !wt || p.status !== 'signed' || p.copy_filed_at) return;
    const stamp = new Date().toISOString();
    const { data: claim, error: cErr } = await db.from('listing_launch_plans')
      .update({ copy_filed_at: stamp }).eq('id', p.id).is('copy_filed_at', null).eq('status', 'signed').select('id');
    if (cErr || !claim || !claim.length) return;
    p.copy_filed_at = stamp;
    try {
      if (typeof Reports === 'undefined' || !Reports.toPDF) throw new Error('PDF builder unavailable');
      const client = wt.clients || {};
      const { blob, base64 } = await Reports.toPDF({ full_name: client.full_name || 'Seller' }, L.signedHTML(p, wt));
      const safe = (wt.property_address || 'property').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      const sd = new Date(p.signed_at || stamp);   // local date, not UTC: a 9 PM signature is still today
      const ymd = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
      const fileName = `${safe}-Launch-Plan-Signed-${ymd}.pdf`;

      if (wt.client_id) {
        const path = `${p.agent_id}/${wt.client_id}/${Date.now()}-${fileName}`;
        const { error: upErr } = await db.storage.from('client-docs').upload(path, blob, { contentType: 'application/pdf' });
        if (upErr) throw upErr;
        const { error: docErr } = await db.from('client_documents').insert({
          agent_id: p.agent_id, client_id: wt.client_id, category: 'other', source: 'launch_plan',
          status: 'Signed', property_address: wt.property_address || null,
          file_path: path, file_name: fileName, file_size_bytes: blob.size
        });
        if (docErr) throw docErr;
      }

      if (client.email) {
        const when = L.fmtStamp(p.signed_at, true);
        const photo = L.parseLocal(p.dates?.photo);
        const body = [
          `Hi ${L.first(client.full_name)},`,
          `Thank you for signing off on the launch plan for ${wt.property_address}. Your signed copy is attached for your records.`,
          `Signed by ${p.signed_name} on ${when}.`,
          photo ? `Next is the photo shoot on ${L.fmtWhen({ d: photo })}. I will send the photos to you to review once they are ready.` : 'I will be in touch with the photo shoot date.',
          EmailFormat.signaturePlain(currentAgent),
          EmailFormat.disclaimerPlain().trim()
        ].join('\n\n');
        await Notify.queue('Launch Plan: Signed Copy', wt.client_id, client.full_name, client.email,
          `Your signed launch plan for ${wt.property_address}`, body, p.id, null, null, null,
          [{ filename: fileName, mime_type: 'application/pdf', data: base64 }]);
      }

      await Walkthrough.log('LAUNCH_PLAN_SIGNED', client, `${p.signed_name} signed the launch plan for ${wt.property_address}. Signed copy saved to Documents.`, wt.client_id);
      App.toast(`✍️ ${L.first(p.signed_name)} signed the launch plan. Copy saved to Documents and waiting in Approvals.`, 'var(--green)');
    } catch (e) {
      console.warn('[LaunchPlan] filing signed copy failed', e);
      await db.from('listing_launch_plans').update({ copy_filed_at: null }).eq('id', p.id).eq('copy_filed_at', stamp);
      p.copy_filed_at = null;
      App.toast('⚠️ The seller signed, but the signed copy could not be filed yet. It will retry next time you open this record.', 'var(--yellow)');
    }
    L.refreshSection();
  },

  // Built from the snapshot taken at the moment of signing, never the live
  // list, so later edits cannot change what the PDF says they signed.
  signedHTML(p, wt) {
    const L = LaunchPlan, esc = L.esc, snap = p.signed_snapshot || {}, dates = snap.dates || {};
    const items = snap.items || [];
    const agentName = currentAgent?.name || 'Maxwell Midodzi';
    const units = [...new Set(items.map(i => i.unit))];
    const rows = units.map(u => `
      <tr><td colspan="4" style="padding:12px 0 5px;font-size:13px;font-weight:800;color:#0F172A;">${esc(u)}</td></tr>
      ${items.filter(i => i.unit === u).map(i => `
        <tr style="border-bottom:1px solid #e6e6e6;">
          <td style="padding:6px 6px 6px 0;font-size:12.5px;color:#111;">${esc(i.title)}</td>
          <td style="padding:6px;font-size:12.5px;color:#444;">${esc(L.whoLabel(i.who))}</td>
          <td style="padding:6px;font-size:12.5px;color:#444;">${esc(L.dueText(i.due, dates) || '')}</td>
          <td style="padding:6px 0;font-size:12.5px;color:${i.status === 'done' ? '#059669' : '#777'};">${i.status === 'done' ? 'Done' : 'To do'}</td>
        </tr>`).join('')}`).join('');
    const dl = [['Photo shoot', dates.photo], ['Final seller viewing', dates.final], ['Listing goes live', dates.live], ['Offers due', dates.offers]]
      .filter(x => x[1]).map(x => `<div style="font-size:12.5px;color:#444;">${x[0]}: <strong>${esc(L.fmtWhen({ d: L.parseLocal(x[1]), dateOnly: x[0] === 'Offers due' }))}</strong></div>`).join('');
    const signedAt = new Date(p.signed_at).toLocaleString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    return `
      <div style="max-width:680px;margin:0 auto;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#222;padding:28px;">
        <div style="border-bottom:2px solid #0F172A;padding-bottom:14px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">Listing launch plan · signed copy</div>
          <div style="font-size:21px;font-weight:800;color:#0F172A;margin-top:5px;">${esc(wt.property_address)}</div>
          <div style="font-size:13px;color:#666;margin-top:4px;">Prepared for ${esc(wt.clients?.full_name || 'the seller')} by ${esc(agentName)}, eXp Realty</div>
        </div>
        ${dl ? `<div style="background:#f8faff;border:1px solid #dde8ff;border-radius:10px;padding:12px 14px;margin-bottom:12px;">${dl}</div>` : ''}
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:2px solid #ddd;">
            <th style="text-align:left;font-size:10.5px;color:#888;text-transform:uppercase;padding-bottom:6px;">Item</th>
            <th style="text-align:left;font-size:10.5px;color:#888;text-transform:uppercase;padding-bottom:6px;">Who</th>
            <th style="text-align:left;font-size:10.5px;color:#888;text-transform:uppercase;padding-bottom:6px;">When</th>
            <th style="text-align:left;font-size:10.5px;color:#888;text-transform:uppercase;padding-bottom:6px;">Status</th>
          </tr>${rows}
        </table>
        <div style="margin-top:20px;border:1px solid #86efac;background:#f0fdf4;border-radius:10px;padding:13px 15px;">
          <div style="font-size:12.5px;color:#166534;line-height:1.6;">${esc(L.consentText(wt.property_address, agentName))}</div>
          <div style="font-size:14px;font-weight:800;color:#111;margin-top:8px;">Signed electronically by ${esc(p.signed_name)}</div>
          <div style="font-size:12px;color:#444;">${esc(signedAt)}</div>
        </div>
        <div style="margin-top:18px;padding-top:12px;border-top:1px solid #e6e6e6;font-size:11px;color:#999;line-height:1.6;">
          This confirms the home is ready to market. It does not replace the Listing Agreement.
        </div>
      </div>`;
  },

  // The exact sentence the seller ticks on launch-plan.html.
  consentText(address, agentName) {
    return `I have reviewed this plan for ${address}. My items are complete, and I authorise ${agentName} of eXp Realty to proceed with photography and the listing launch on the dates shown.`;
  },

  // ── Prep visits ───────────────────────────────────────────────────────────
  // A visit marked done ticks its item here: the one it is linked to, or else
  // the first open item for that trade, which it then links. Never throws.
  async onPrepVisitDone(meetingId) {
    try {
      const L = LaunchPlan;
      if (!L.plan || !L.items.length || typeof PrepVisit === 'undefined') return;
      const v = (PrepVisit.visits || []).find(x => x.id === meetingId);
      const trade = String(v?.details?.trade || '').toLowerCase();
      const it = L.items.find(i => i.prep_visit_id === meetingId && i.status === 'open')
              || L.items.find(i => !i.prep_visit_id && i.who === trade && i.status === 'open');
      if (!it) return;
      const { error } = await db.from('listing_launch_items').update({
        status: 'done', done_at: new Date().toISOString(), done_by: 'agent', prep_visit_id: meetingId, updated_at: new Date().toISOString()
      }).eq('id', it.id);
      if (!error) App.toast(`Also ticked on the launch plan: ${it.title}`, 'var(--green)');
    } catch (e) { console.warn('[LaunchPlan] prep visit link skipped', e); }
  }
};

window.LaunchPlan = LaunchPlan;
