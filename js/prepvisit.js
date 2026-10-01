// Maxwell DealFlow CRM — Prep visits (cleaner, photographer, stager, handyman)
//
// Booked from a property's walkthrough record, because the visit is work on THAT
// house: the address, the units, the rooms and the open deficiencies are already
// known there, so the form arrives filled in.
//
//   Vendor  → gets a confirmation written TO them: their time, the place, what
//             would help most. Confirming, never directing.
//   Seller  → gets their own letter (never a CC, so nobody sees another
//             person's address), written to the owner.
//   Copies  → anyone else on the sale, unticked until Maxwell ticks them.
//
// All of it goes through Approvals as one batch, lands on the Calendar as a
// meetings row (kind 'prep_visit'), and is logged on the seller's activity.
//
// PAYMENT IS PRIVATE. details.payer / details.prepaid / details.amount are
// Maxwell's record of who pays and whether it is settled. The vendor letter only
// ever says who will look after payment, and says nothing at all once prepaid.
//
// Requires migration 110.

const PrepVisit = {

  visits:  [],
  vendors: [],
  _ctx:    null,   // { wt, seller, others } while the booking modal is open

  TRADES: {
    'Cleaner': {
      icon: '🧽', noun: 'a professional cleaning',
      intro: 'The home is being prepared for sale, so these are the areas that would make the biggest difference for photos and showings:',
      focus: ['Stove and oven', 'Range hood', 'Inside the fridge', 'Inside cabinets and drawers',
              'Carpets (shampoo or steam)', 'Bathroom grout and tile', 'Toilets, tubs and showers',
              'Mirrors and glass', 'Windows and sills (inside)', 'Baseboards',
              'Light fixtures and switches', 'Floors', 'Closets', 'Walls (spot clean)']
    },
    'Photographer': {
      icon: '📷', noun: 'professional photography',
      intro: 'The home is being prepared for its listing, and these are the shots I am hoping for:',
      focus: ['Interior photos', 'Exterior photos', 'Drone / aerial', 'Twilight exterior',
              'Floor plan', 'Virtual tour', 'Video walkthrough']
    },
    'Stager': {
      icon: '🛋️', noun: 'a staging visit',
      intro: 'The home is being prepared for sale, and these are the areas I would most value your eye on:',
      focus: ['Declutter plan', 'Furniture placement', 'Bring in furniture and decor',
              'Living room', 'Primary bedroom', 'Kitchen counters', 'Entrance', 'Curb appeal']
    },
    'Handyman': {
      icon: '🔧', noun: 'a repair visit',
      intro: 'The home is being prepared for sale, and these are the items I am hoping can be looked after:',
      focus: ['Patch and paint', 'Touch-up paint', 'Loose hardware', 'Replace bulbs', 'Caulking']
    },
    'Other': {
      icon: '🧰', noun: 'a visit',
      intro: 'The home is being prepared for sale, and these are the areas I would like to focus on:',
      focus: []
    }
  },

  ACCESS: {
    owner:    'The owner will let them in',
    me:       'I will meet them there',
    lockbox:  'Lockbox on the property',
    other:    'Other (describe below)'
  },

  AREAS_DEFAULT: ['Kitchen', 'Living room', 'Dining room', 'Bedrooms', 'Bathroom', 'Ensuite',
                  'Hallway / Stairs', 'Laundry', 'Entrance', 'Windows'],

  esc(s) { return (typeof Walkthrough !== 'undefined' ? Walkthrough.esc(s) : String(s ?? '')); },

  // A 2 apartment is the case that prompted this: top unit, basement unit.
  unitsFor(type) {
    const t = String(type || '');
    const base =
      t === '2 apartment'                     ? ['Top unit', 'Basement unit'] :
      t === '3 apartment'                     ? ['Top unit', 'Middle unit', 'Basement unit'] :
      t === 'Single family with in-law suite' ? ['Main house', 'In-law suite'] :
      t === 'Duplex'                          ? ['Unit A', 'Unit B'] :
      t === 'Multi-unit (4 or more)'          ? ['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4', 'Common areas'] :
                                                ['Whole home'];
    return [...base, 'Exterior and grounds'];
  },

  areasFor(rooms) {
    const names = (rooms || []).map(r => r.room_name).filter(Boolean);
    return [...new Set(names.length ? names : PrepVisit.AREAS_DEFAULT)];
  },

  fmtDateLong(d) {
    if (!d) return '';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  },
  fmt12h(t) {
    if (!t) return '';
    const [h, m] = String(t).split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  },
  first(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; },
  joinList(a) {
    if (!a.length) return '';
    if (a.length === 1) return a[0];
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  },
  unitsPhrase(units) {
    if (!units.length) return '';
    return units.length === 1 && units[0] !== 'Whole home' && units[0] !== 'Exterior and grounds'
      ? `${units[0].toLowerCase()} only`
      : PrepVisit.joinList(units.map(u => u.toLowerCase()));
  },

  // ── Loaded with the walkthrough ───────────────────────────────────────────
  // A missing column (110 not run yet) returns an error, not a throw: the
  // section then simply shows nothing booked rather than breaking the record.
  async loadFor(walkthroughId) {
    const { data, error } = await db.from('meetings')
      .select('*').eq('walkthrough_id', walkthroughId).eq('kind', 'prep_visit')
      .order('meeting_date', { ascending: false });
    if (error) console.warn('[PrepVisit] load skipped (run migration 110?):', error.message);
    PrepVisit.visits = error ? [] : (data || []);
    return PrepVisit.visits;
  },

  sectionHTML() {
    const P = PrepVisit, list = P.visits || [];
    const rows = list.map(v => {
      const d = v.details || {};
      const st = d.status || 'booked';
      const stc = st === 'done' ? 'var(--green)' : st === 'cancelled' ? 'var(--text2)' : 'var(--accent2)';
      const pay = d.payer === 'seller' ? 'Seller pays' : 'I pay';
      const paid = d.prepaid ? `<span style="color:var(--green);">Paid${d.paid_at ? ' ' + P.esc(App.fmtDate(d.paid_at)) : ''}</span>`
                             : `<span style="color:var(--yellow);">Not paid yet</span>`;
      const trade = P.TRADES[d.trade] || P.TRADES.Other;
      return `
        <div style="border:1px solid var(--border);border-radius:10px;padding:11px 12px;margin-bottom:8px;${st === 'cancelled' ? 'opacity:.6;' : ''}">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div style="font-weight:700;">${trade.icon} ${P.esc(d.trade || 'Visit')}: ${P.esc(v.builder_name || '')}</div>
            <span style="font-size:11px;font-weight:800;color:${stc};border:1px solid ${stc};border-radius:999px;padding:2px 8px;">${st === 'done' ? 'Done' : st === 'cancelled' ? 'Cancelled' : 'Booked'}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text2);margin-top:4px;">
            ${P.esc(App.fmtDate(v.meeting_date))}${v.meeting_time ? ' · ' + P.fmt12h(v.meeting_time) : ''}${(d.units || []).length ? ' · ' + P.esc(d.units.join(', ')) : ''}
          </div>
          <div style="font-size:12px;margin-top:4px;">🔒 ${pay}${d.amount ? ' · $' + P.esc(d.amount) : ''} · ${paid}</div>
          ${st === 'booked' ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-outline btn-sm" onclick="PrepVisit.setStatus('${v.id}','done')">✅ Mark done</button>
            ${d.prepaid ? '' : `<button class="btn btn-outline btn-sm" onclick="PrepVisit.markPaid('${v.id}')">💳 Mark paid</button>`}
            <button class="btn btn-outline btn-sm" onclick="PrepVisit.setStatus('${v.id}','cancelled')">✕ Cancel</button>
          </div>` : (!d.prepaid && st === 'done' ? `
          <div style="margin-top:8px;"><button class="btn btn-outline btn-sm" onclick="PrepVisit.markPaid('${v.id}')">💳 Mark paid</button></div>` : '')}
        </div>`;
    }).join('');

    return `
      <div class="card" style="padding:16px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:${list.length ? 10 : 4}px;">
          <div style="font-size:15px;font-weight:800;">🧽 Prep visits</div>
          <button class="btn btn-primary btn-sm" onclick="PrepVisit.openBook()">+ Book prep visit</button>
        </div>
        ${rows || `<div style="font-size:12.5px;color:var(--text2);">Cleaners, photographers, stagers and repairs booked for this home. Each one is confirmed to the vendor, copied to the seller, and kept here on the record.</div>`}
      </div>`;
  },

  // ── Booking modal ─────────────────────────────────────────────────────────
  async openBook() {
    const P = PrepVisit, W = Walkthrough, wt = W.current;
    if (!wt) return;
    const uid = await W.uid();

    const [vend, sellerQ, contactsQ, guestsQ] = await Promise.all([
      db.from('vendors').select('*').eq('agent_id', uid).order('name'),
      wt.client_id ? db.from('clients').select('id, full_name, email, phone').eq('id', wt.client_id).maybeSingle() : Promise.resolve({ data: null }),
      wt.client_id ? db.from('client_contacts').select('role, name, email').eq('client_id', wt.client_id) : Promise.resolve({ data: [] }),
      wt.client_id ? db.from('clients').select('full_name, email').eq('linked_client_id', wt.client_id) : Promise.resolve({ data: [] })
    ]);
    if (vend.error) { App.toast('⚠️ Run migration 110 in the Supabase SQL Editor first', 'var(--red)'); return; }

    P.vendors = vend.data || [];
    const seller = sellerQ.data || null;
    const ROLE = { mortgage_broker: 'Mortgage broker', lawyer: 'Lawyer', inspector: 'Inspector', builder: 'Builder', assisting_agent: 'Assisting agent' };
    const others = [
      ...(guestsQ.data || []).filter(g => g.email).map(g => ({ name: g.full_name, email: g.email, label: 'Linked to the seller' })),
      ...(contactsQ.data || []).filter(c => c.email).map(c => ({ name: c.name || ROLE[c.role] || c.role, email: c.email, label: ROLE[c.role] || c.role }))
    ];
    P._ctx = { wt, seller, others };

    const units = P.unitsFor(wt.property_type);
    const areas = P.areasFor(W.rooms);
    const chk = (group, val, on) => `
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
        <input type="checkbox" data-pv-${group} value="${P.esc(val)}" ${on ? 'checked' : ''}> ${P.esc(val)}
      </label>`;
    const grid = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;';

    App.openModal(`
      <div class="modal-title">Book prep visit</div>
      <div style="font-size:13px;color:var(--text2);margin:-4px 0 14px;">${P.esc(wt.property_address)}${wt.property_type ? ' · ' + P.esc(wt.property_type) : ''}${seller ? ' · 👤 ' + P.esc(seller.full_name) : ''}</div>

      <div class="form-group">
        <label class="form-label">Vendor</label>
        <select class="form-input form-select" id="pv-vendor" onchange="PrepVisit.onVendorPick()">
          <option value="">+ New vendor</option>
          ${P.vendors.map(v => `<option value="${v.id}">${P.esc(v.name)}${v.company ? ' (' + P.esc(v.company) + ')' : ''} · ${P.esc(v.trade)}</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="form-group"><label class="form-label">Trade</label>
          <select class="form-input form-select" id="pv-trade" onchange="PrepVisit.renderFocus()">
            ${Object.keys(P.TRADES).map(t => `<option>${t}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="pv-name" placeholder="e.g. Grace Whitfield"></div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="pv-email" type="email" placeholder="for their confirmation"></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="pv-phone" type="tel"></div>
      </div>
      <div class="form-group"><label class="form-label">Company <span style="color:var(--text2);font-weight:400;">(optional)</span></label><input class="form-input" id="pv-company"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="pv-date" type="date"></div>
        <div class="form-group"><label class="form-label">Time *</label><input class="form-input" id="pv-time" type="time" value="10:00"></div>
        <div class="form-group"><label class="form-label">About</label>
          <select class="form-input form-select" id="pv-hours">
            ${[1, 2, 3, 4, 6, 8].map(h => `<option value="${h}" ${h === 3 ? 'selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('')}
          </select></div>
      </div>

      <div class="form-group"><label class="form-label">Which part of the home</label>
        <div style="${grid}">${units.map(u => chk('unit', u, units.length === 2 && u === 'Whole home')).join('')}</div>
      </div>
      <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;margin:-4px 0 14px;color:var(--text2);">
        <input type="checkbox" id="pv-tenanted"> A tenant lives in the selected unit (the seller's letter reminds them about 24 hours' written notice)
      </label>

      <div class="form-group"><label class="form-label">Rooms</label>
        <div style="${grid}">${areas.map(a => chk('area', a, false)).join('')}</div>
      </div>

      <div class="form-group"><label class="form-label">Key focus</label>
        <div id="pv-focus"></div>
        <input class="form-input" id="pv-focus-extra" style="margin-top:6px;" placeholder="Add your own, separated by commas">
      </div>
      <div class="form-group"><label class="form-label">Note for the vendor <span style="color:var(--text2);font-weight:400;">(goes in their email)</span></label>
        <textarea class="form-input" id="pv-notes" rows="2" placeholder="e.g. If anything can be done with the carpet on the stairs, that would be wonderful"></textarea></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="form-group"><label class="form-label">Access</label>
          <select class="form-input form-select" id="pv-access">
            ${Object.entries(P.ACCESS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Access details <span style="color:var(--text2);font-weight:400;">(in vendor email)</span></label>
          <input class="form-input" id="pv-access-note" placeholder="e.g. side door, code by text"></div>
      </div>

      <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px;">
        <div style="font-size:12px;font-weight:800;color:var(--text2);letter-spacing:.04em;margin-bottom:8px;">🔒 PAYMENT · PRIVATE TO YOU</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin-bottom:8px;">
          <label><input type="radio" name="pv-payer" value="agent" checked> I pay</label>
          <label><input type="radio" name="pv-payer" value="seller"> Seller pays</label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;">
          <label style="font-size:13px;display:flex;gap:7px;align-items:center;"><input type="checkbox" id="pv-prepaid"> Already prepaid</label>
          <input class="form-input" id="pv-amount" inputmode="decimal" placeholder="Amount, e.g. 250">
        </div>
        <div style="font-size:11.5px;color:var(--text2);margin-top:6px;">Never shown to the vendor. Prepaid means their email says nothing about payment at all.</div>
      </div>

      <div class="form-group"><label class="form-label">Who gets a copy</label>
        ${seller ? `<label style="display:flex;gap:7px;font-size:13px;margin-bottom:6px;"><input type="checkbox" id="pv-copy-seller" ${seller.email ? 'checked' : 'disabled'}> ${P.esc(seller.full_name)} (seller)${seller.email ? '' : ' · no email on file'}</label>` : `<div style="font-size:12px;color:var(--yellow);margin-bottom:6px;">No seller attached to this walkthrough.</div>`}
        ${others.map((o, i) => `<label style="display:flex;gap:7px;font-size:13px;margin-bottom:6px;"><input type="checkbox" data-pv-copy="${i}"> ${P.esc(o.name)} · ${P.esc(o.label)}</label>`).join('')}
        <input class="form-input" id="pv-copy-extra" placeholder="Anyone else: email addresses, separated by commas">
      </div>

      <div id="pv-msg" style="font-size:12.5px;margin-bottom:8px;"></div>
      <button class="btn btn-primary btn-block" id="pv-save" onclick="PrepVisit.save()">📨 Book and queue the emails</button>
      <div style="font-size:11.5px;color:var(--text2);text-align:center;margin-top:6px;">Everything waits in Approvals for you to read before it sends.</div>
    `);
    P.renderFocus();
  },

  onVendorPick() {
    const v = PrepVisit.vendors.find(x => x.id === document.getElementById('pv-vendor').value);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('pv-name', v?.name); set('pv-email', v?.email); set('pv-phone', v?.phone); set('pv-company', v?.company);
    if (v?.trade && PrepVisit.TRADES[v.trade]) { document.getElementById('pv-trade').value = v.trade; PrepVisit.renderFocus(); }
  },

  // Trade suggestions first, then whatever the walkthrough already found open,
  // so a handyman visit can be built straight from the deficiency list.
  renderFocus() {
    const P = PrepVisit, el = document.getElementById('pv-focus');
    if (!el) return;
    const kept = new Set([...el.querySelectorAll('[data-pv-focus]:checked')].map(c => c.value));
    const trade = P.TRADES[document.getElementById('pv-trade').value] || P.TRADES.Other;
    const fromWalk = (Walkthrough.defects || [])
      .filter(d => !['done', 'declined'].includes(d.status))
      .map(d => `${d.area ? d.area + ': ' : ''}${d.item}`);
    const box = (val) => `
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
        <input type="checkbox" data-pv-focus value="${P.esc(val)}" ${kept.has(val) ? 'checked' : ''}> ${P.esc(val)}
      </label>`;
    const grid = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px;';
    el.innerHTML = `
      ${trade.focus.length ? `<div style="${grid}">${trade.focus.map(box).join('')}</div>` : ''}
      ${fromWalk.length ? `<div style="font-size:11.5px;color:var(--text2);margin:10px 0 6px;">From your walkthrough</div><div style="${grid}">${fromWalk.map(box).join('')}</div>` : ''}`;
  },

  collect() {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const ticked = g => [...document.querySelectorAll(`[data-pv-${g}]:checked`)].map(c => c.value);
    const { seller, others } = PrepVisit._ctx;
    const extraFocus = v('pv-focus-extra').split(',').map(s => s.trim()).filter(Boolean);
    const copies = [...document.querySelectorAll('[data-pv-copy]:checked')].map(c => others[+c.dataset.pvCopy]);
    v('pv-copy-extra').split(',').map(s => s.trim()).filter(s => /\S+@\S+\.\S+/.test(s))
      .forEach(e => copies.push({ name: '', email: e, label: 'Copy' }));
    return {
      vendorId: v('pv-vendor') || null,
      trade: v('pv-trade') || 'Other',
      name: v('pv-name'), email: v('pv-email'), phone: v('pv-phone'), company: v('pv-company'),
      date: v('pv-date'), time: v('pv-time'), hours: Number(v('pv-hours')) || 2,
      units: ticked('unit'), areas: ticked('area'),
      focus: [...ticked('focus'), ...extraFocus],
      tenanted: !!document.getElementById('pv-tenanted')?.checked,
      notes: v('pv-notes'),
      access: v('pv-access') || 'owner', accessNote: v('pv-access-note'),
      payer: document.querySelector('input[name="pv-payer"]:checked')?.value || 'agent',
      prepaid: !!document.getElementById('pv-prepaid')?.checked,
      amount: v('pv-amount').replace(/[^0-9.]/g, ''),
      copySeller: !!(seller?.email && document.getElementById('pv-copy-seller')?.checked),
      copies
    };
  },

  // ── Letters ───────────────────────────────────────────────────────────────
  vendorLetter(f, wt, seller, agent) {
    const P = PrepVisit, trade = P.TRADES[f.trade] || P.TRADES.Other;
    const dateStr = P.fmtDateLong(f.date);
    const where = wt.property_address + (f.units.length ? `, ${P.unitsPhrase(f.units)}` : '');
    const access = f.access === 'owner' ? `${seller?.full_name || 'The owner'}, the owner, will be home to let you in`
                 : f.access === 'me'    ? 'I will meet you there'
                 : f.access === 'lockbox' ? 'Lockbox on the property'
                 : '';
    const accessLine = [access, f.accessNote].filter(Boolean).join('. ');
    const lines = [`Date: ${dateStr}`, `Time: ${P.fmt12h(f.time)}`, `Location: ${where}`];
    if (accessLine) lines.push(`Access: ${accessLine}`);
    if (f.access === 'owner' && seller?.phone) lines.push(`On-site contact: ${seller.full_name}, ${seller.phone}`);

    const focus = f.focus.length ? `${trade.intro}\n\n${f.focus.map(x => '• ' + x).join('\n')}` : '';
    const rooms = f.areas.length ? `Rooms: ${P.joinList(f.areas)}.` : '';
    const pay = f.prepaid ? ''
              : f.payer === 'seller' ? `${P.first(seller?.full_name) === 'there' ? 'The owner' : P.first(seller?.full_name)} will look after payment with you directly.`
              : 'I will look after payment with you directly.';

    const body = [
      `Hi ${P.first(f.name)},`,
      'Thank you for making time for this. I am writing to confirm the details of your visit.',
      lines.join('\n') + EmailFormat.mapLinkPlain(wt.property_address),
      focus, rooms, f.notes, pay,
      'If anything here is outside what you normally offer, or you would suggest a different approach, I would be glad to hear it. If the time no longer suits you, just reply and we will find one that does.',
      'Thank you again,',
      EmailFormat.signaturePlain(agent),
      EmailFormat.disclaimerPlain().trim()
    ].filter(Boolean).join('\n\n');

    return { subject: `Confirming your visit at ${wt.property_address}, ${dateStr} at ${P.fmt12h(f.time)}`, body };
  },

  sellerLetter(f, wt, seller, agent) {
    const P = PrepVisit, trade = P.TRADES[f.trade] || P.TRADES.Other;
    const dateStr = P.fmtDateLong(f.date);
    const who = f.name + (f.company ? ` (${f.company})` : '');
    const lines = [`Date: ${dateStr}`, `Time: ${P.fmt12h(f.time)}`, `${f.trade === 'Other' ? 'Vendor' : f.trade}: ${who}`];
    if (f.units.length) lines.push(`Where: ${f.units.join(', ')}`);

    const focus = f.focus.length ? `What they will focus on:\n${f.focus.map(x => '• ' + x).join('\n')}` : '';
    const access = f.access === 'owner' ? `Would you be able to let ${P.first(f.name)} in at ${P.fmt12h(f.time)}?`
                 : f.access === 'me'    ? 'I will be there to let them in, so there is nothing you need to do.'
                 : f.access === 'lockbox' ? 'They will use the lockbox, so you do not need to be home.'
                 : '';
    const tenant = f.tenanted ? `As the ${f.units.length ? P.joinList(f.units.map(u => u.toLowerCase())) : 'unit'} is tenanted, please make sure your tenant has written notice of the visit at least 24 hours ahead.` : '';
    const pay = f.payer === 'seller'
      ? `As we discussed, payment for this visit is settled directly between you and ${P.first(f.name)}.`
      : 'This is complimentary, arranged and covered by me as part of preparing your home for sale.';

    const body = [
      `Hi ${P.first(seller.full_name)},`,
      `A quick note to let you know I have booked ${trade.noun} for ${wt.property_address} ahead of the listing.`,
      lines.join('\n'),
      focus, access, tenant, pay,
      'If that time does not work, let me know and I will rearrange it.',
      EmailFormat.signaturePlain(agent),
      EmailFormat.disclaimerPlain().trim()
    ].filter(Boolean).join('\n\n');

    return { subject: `${f.trade === 'Other' ? 'Visit' : f.trade} booked for ${wt.property_address}, ${dateStr} at ${P.fmt12h(f.time)}`, body };
  },

  copyLetter(f, wt, person, agent) {
    const P = PrepVisit, trade = P.TRADES[f.trade] || P.TRADES.Other;
    const dateStr = P.fmtDateLong(f.date);
    const body = [
      `Hi ${P.first(person.name)},`,
      `For your information, ${trade.noun} is booked at ${wt.property_address} on ${dateStr} at ${P.fmt12h(f.time)}, as part of preparing the home for sale. Nothing is needed from you.`,
      EmailFormat.signaturePlain(agent),
      EmailFormat.disclaimerPlain().trim()
    ].join('\n\n');
    return { subject: `For your information: ${f.trade === 'Other' ? 'visit' : f.trade.toLowerCase()} at ${wt.property_address}, ${dateStr}`, body };
  },

  // One event, so it lands on the vendor's and the seller's calendar.
  ics(f, wt, meetingId, agent) {
    const a = EmailFormat._agent(agent);
    const t = s => String(s || '').replace(/([,;\\])/g, '\\$1');
    const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');  // keeps toISOString's own Z
    const st = new Date(`${f.date}T${f.time}:00`);
    const en = new Date(st.getTime() + f.hours * 3600000);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maxwell DealFlow CRM//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:prep-${meetingId}@maxwell-dealflow`, `DTSTAMP:${z(new Date())}`,
      `DTSTART:${z(st)}`, `DTEND:${z(en)}`,
      `SUMMARY:${t((f.trade === 'Other' ? 'Visit' : f.trade) + ': ' + wt.property_address)}`,
      `DESCRIPTION:${t(f.name + ' at ' + wt.property_address)}\\nArranged by ${t(a.name)}\\n${t(a.phone)}`,
      `LOCATION:${t(wt.property_address)}`, 'STATUS:CONFIRMED', 'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return btoa(unescape(encodeURIComponent(ics)));
  },

  // ── Save ──────────────────────────────────────────────────────────────────
  async save() {
    const P = PrepVisit, { wt, seller } = P._ctx || {};
    const msg = (t, c) => { const el = document.getElementById('pv-msg'); if (el) { el.textContent = t; el.style.color = c || 'var(--text2)'; } };
    const f = P.collect();
    if (!f.name) return msg('Add the vendor\'s name.', 'var(--red)');
    if (!f.date || !f.time) return msg('Pick a date and time.', 'var(--red)');
    if (f.email && !/\S+@\S+\.\S+/.test(f.email)) return msg('That vendor email does not look right.', 'var(--red)');

    const btn = document.getElementById('pv-save'); if (btn) btn.disabled = true;
    msg('Saving…');
    const uid = await Walkthrough.uid();
    const now = new Date().toISOString();

    // Vendor: saved once, kept current from whatever was typed this time.
    const vrow = { agent_id: uid, name: f.name, trade: f.trade, email: f.email || null, phone: f.phone || null, company: f.company || null, updated_at: now };
    let vendorId = f.vendorId;
    const vq = vendorId
      ? await db.from('vendors').update(vrow).eq('id', vendorId).select('id').single()
      : await db.from('vendors').insert(vrow).select('id').single();
    if (vq.error) { if (btn) btn.disabled = false; return msg('⚠️ ' + vq.error.message + ' (run migration 110?)', 'var(--red)'); }
    vendorId = vq.data.id;

    const details = {
      trade: f.trade, units: f.units, areas: f.areas, focus: f.focus, tenanted: f.tenanted,
      access: f.access, access_note: f.accessNote, hours: f.hours,
      payer: f.payer, prepaid: f.prepaid, amount: f.amount || null, paid_at: f.prepaid ? now : null,
      status: 'booked',
      sent_to: [f.email, f.copySeller ? seller.email : null, ...f.copies.map(c => c.email)].filter(Boolean)
    };
    const { data: m, error } = await db.from('meetings').insert({
      agent_id: uid, kind: 'prep_visit',
      client_id: seller?.id || wt.client_id || null,
      client_name: seller?.full_name || null, client_email: seller?.email || null,
      builder_name: f.name, builder_email: f.email || null,
      location: wt.property_address, meeting_date: f.date, meeting_time: f.time,
      purpose: `${f.trade}: ${f.name}`, notes: f.notes || null,
      walkthrough_id: wt.id, vendor_id: vendorId, details
    }).select('*').single();
    if (error) { if (btn) btn.disabled = false; return msg('⚠️ ' + error.message + ' (run migration 110?)', 'var(--red)'); }

    // Separate letters, one batch: approving any one offers to send them all.
    const agent = currentAgent;
    const ics = P.ics(f, wt, m.id, agent);
    const sends = [];
    if (f.email) { const t = P.vendorLetter(f, wt, seller, agent); sends.push(['Prep Visit: Vendor', f.name, f.email, t, ics]); }
    if (f.copySeller) { const t = P.sellerLetter(f, wt, seller, agent); sends.push(['Prep Visit: Seller', seller.full_name, seller.email, t, ics]); }
    f.copies.forEach(c => { const t = P.copyLetter(f, wt, c, agent); sends.push(['Prep Visit: Copy', c.name || c.email, c.email, t, null]); });
    const batchId = sends.length > 1 ? crypto.randomUUID().replace(/-/g, '') : null;
    for (const [type, name, email, t, inv] of sends) {
      await Notify.queue(type, seller?.id || null, name, email, t.subject, t.body, m.id, null, inv, null, null, batchId);
    }

    await Walkthrough.log('PREP_VISIT_BOOKED', seller,
      `${f.trade} ${f.name} booked for ${wt.property_address} on ${f.date} at ${P.fmt12h(f.time)}` +
      `${f.units.length ? ' (' + f.units.join(', ') + ')' : ''}. ${f.payer === 'seller' ? 'Seller pays' : 'Agent pays'}` +
      `${f.amount ? ', $' + f.amount : ''}${f.prepaid ? ', prepaid' : ', not paid yet'}.`,
      wt.client_id);

    App.closeModal();
    App.toast(sends.length ? `📬 Booked. ${sends.length} email${sends.length > 1 ? 's' : ''} waiting in Approvals` : '✅ Booked (no emails: add the vendor\'s email to send one)', 'var(--green)');
    Walkthrough.open(wt.id);
  },

  // Status and payment changes are record-keeping only: nothing is emailed.
  async _patch(id, patch, logText) {
    const v = PrepVisit.visits.find(x => x.id === id);
    if (!v) return;
    const details = { ...(v.details || {}), ...patch };
    const { error } = await db.from('meetings').update({ details, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    const wt = Walkthrough.current;
    await Walkthrough.log('PREP_VISIT_UPDATED', wt?.clients, `${details.trade || 'Visit'} ${v.builder_name} at ${v.location} (${v.meeting_date}): ${logText}`, wt?.client_id);
    Walkthrough.open(wt.id);
  },

  async setStatus(id, status) {
    if (status === 'cancelled' && !confirm('Mark this visit as cancelled?\n\nThis only updates your record. Nobody is emailed, so let the vendor and seller know yourself.')) return;
    await PrepVisit._patch(id, { status, [status + '_at']: new Date().toISOString() }, status === 'done' ? 'marked done' : 'cancelled');
  },

  async markPaid(id) {
    await PrepVisit._patch(id, { prepaid: true, paid_at: new Date().toISOString() }, 'marked paid');
  }
};

window.PrepVisit = PrepVisit;
