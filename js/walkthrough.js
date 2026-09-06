// Maxwell DealFlow CRM — Listing walkthrough capture (the seller consultation)
//
// The visit before the listing. Maxwell stands in the house with the seller,
// records what needs fixing, photographs it, and leaves. At home the record is
// already compiled: he previews it, sends it to the seller on a token link, the
// seller corrects what he got wrong, and he certifies the final version.
//
//   Deficiencies  → the point of the visit. What needs repair, how badly,
//                   roughly what it costs, with a photo of the actual corner.
//   Rooms         → the MLS record. Dimensions are TYPED, never from a photo.
//   Systems       → roof, furnace, water, septic. Year and condition.
//   Send          → seller reviews on walkthrough-review.html?t=<token>
//   Certify       → "initial consultation done". Stamped, dated, closed.
//
// WHY DEFICIENCIES ARE FIRST AND NOT A TAG ON A PHOTO:
// A defect has a life the rest of the record does not. It is found, priced,
// shown to the seller, fixed or declined, and then it matters AGAIN months
// later when the buyer's inspector finds the same crack. So it is a row with
// its own status, not a caption.
//
// PRIVACY: `agent_notes` on the walkthrough and any deficiency with
// seller_visible = false never reach the seller's page. That separation is the
// only reason Maxwell can write honestly while he is standing there.
//
// Requires migrations 101 and 104.

const Walkthrough = {

  // ── Loaded state ──────────────────────────────────────────────────────────
  all:      [],     // list view
  current:  null,   // the walkthrough being captured
  rooms:    [],
  defects:  [],
  photos:   [],
  edits:    [],     // seller's pending corrections
  _signed:  {},     // storage_path -> signed url, refreshed per open()
  _clients: [],

  // ── Vocabulary ────────────────────────────────────────────────────────────
  // These lists exist so the common case is a tap. Anything can still be typed;
  // nothing here is a constraint on what gets recorded.

  AREAS: ['Kitchen', 'Living room', 'Dining room', 'Primary bedroom', 'Bedroom',
          'Bathroom', 'Ensuite', 'Basement', 'Laundry', 'Hallway / Stairs',
          'Garage', 'Attic', 'Roof', 'Exterior / Siding', 'Windows', 'Doors',
          'Driveway / Walkway', 'Deck / Patio', 'Yard / Landscaping',
          'Foundation', 'Electrical', 'Plumbing', 'Heating', 'Water / Well',
          'Septic / Sewer'],

  // Generic first, because in practice most of what he writes down is one of
  // these six regardless of which room he is standing in.
  ITEMS_COMMON: ['Needs paint', 'Cracked or chipped', 'Water stain',
                 'Damaged flooring', 'Dated fixtures', 'Does not close or latch',
                 'Broken or missing hardware', 'Mould or mildew',
                 'Caulking failed', 'Damaged drywall'],

  ITEMS_BY_AREA: {
    'Kitchen':            ['Worn countertop', 'Cabinet doors misaligned', 'Appliance dated', 'Backsplash damaged'],
    'Bathroom':           ['Grout failing', 'Toilet running', 'Fan not venting', 'Vanity water damage'],
    'Ensuite':            ['Grout failing', 'Fan not venting', 'Shower door seal'],
    'Basement':           ['Efflorescence on wall', 'Musty smell', 'Floor drain blocked', 'Evidence of past water'],
    'Roof':               ['Shingles curling', 'Missing shingles', 'Flashing damaged', 'Moss growth'],
    'Exterior / Siding':  ['Siding cracked', 'Trim rotted', 'Paint peeling', 'Soffit damaged'],
    'Windows':            ['Seal failed / fogged', 'Rotted sill', 'Will not open', 'Screen missing'],
    'Foundation':         ['Visible crack', 'Parging failing', 'Grading slopes to house'],
    'Electrical':         ['Panel at capacity', 'Outlet not grounded', 'Knob and tube visible', 'Missing GFCI'],
    'Plumbing':           ['Slow drain', 'Visible leak', 'Corroded supply line', 'Low pressure'],
    'Heating':            ['Furnace past service life', 'No recent service record', 'Ducts dirty'],
    'Deck / Patio':       ['Boards soft or rotted', 'Railing loose', 'Needs re-staining'],
    'Driveway / Walkway': ['Cracked or heaved', 'Trip hazard'],
    'Yard / Landscaping': ['Overgrown', 'Tree overhanging roof', 'Fence damaged'],
    'Septic / Sewer':     ['No recent pump-out record', 'Odour at field'],
    'Water / Well':       ['No recent water test', 'Pressure tank dated']
  },

  SEVERITY: [
    { v: 'cosmetic',   label: 'Cosmetic',    sub: 'Worth doing for the photos',      color: '#94A3B8', icon: '🎨' },
    { v: 'should_fix', label: 'Should fix',  sub: 'Before we list',                  color: '#f59e0b', icon: '🔧' },
    { v: 'must_fix',   label: 'Must fix',    sub: 'A buyer inspection will find it', color: '#ef4444', icon: '⚠️' },
    { v: 'safety',     label: 'Safety',      sub: 'Deal with this first',            color: '#dc2626', icon: '🚨' }
  ],

  COST: [
    { v: 'under_500', label: 'Under $500' },
    { v: '500_2k',    label: '$500 to $2,000' },
    { v: '2k_10k',    label: '$2,000 to $10,000' },
    { v: 'over_10k',  label: 'Over $10,000' },
    { v: 'unknown',   label: 'Get a quote' }
  ],

  // Newfoundland housing stock, in roughly the order it comes up. "2 apartment"
  // is the local term for a house with a second self-contained unit and is what
  // a seller here will say at the door, so it is what the list says back to
  // them. An in-law suite is deliberately separate from a 2 apartment: the
  // suite is part of the family home, the apartment is income, and they are not
  // priced, insured or financed the same way.
  PROPERTY_TYPES: [
    'Single family',
    'Single family with in-law suite',
    '2 apartment',
    '3 apartment',
    'Semi-detached',
    'Row house / Townhouse',
    'Condo / Apartment unit',
    'Duplex',
    'Mini home',
    'Multi-unit (4 or more)',
    'Land / Lot',
    'Other'
  ],

  // A type saved before this list changed must still show as itself rather than
  // silently reverting to "Not set" the next time the record is edited.
  typeOptions(selected) {
    const list = Walkthrough.PROPERTY_TYPES.slice();
    if (selected && !list.includes(selected)) list.push(selected);
    return list.map(t =>
      `<option${selected === t ? ' selected' : ''}>${Walkthrough.esc(t)}</option>`).join('');
  },

  CONDITIONS: ['excellent', 'good', 'fair', 'needs work'],
  FLOORING:   ['Hardwood', 'Engineered hardwood', 'Laminate', 'Vinyl plank', 'Tile', 'Carpet', 'Concrete', 'Mixed'],
  ROOM_TYPES: ['Kitchen', 'Living', 'Dining', 'Bedroom', 'Bathroom', 'Family', 'Office', 'Laundry', 'Basement', 'Storage', 'Other'],

  // Systems worth a year and a condition. Deliberately short: the long version
  // never gets filled in, and an empty field on a seller's copy reads as
  // carelessness rather than as "not applicable".
  SYSTEMS: [
    { k: 'roof',        label: 'Roof' },
    { k: 'heating',     label: 'Heating / Furnace' },
    { k: 'water_heater',label: 'Water heater' },
    { k: 'windows',     label: 'Windows' },
    { k: 'electrical',  label: 'Electrical panel' },
    { k: 'plumbing',    label: 'Plumbing' },
    { k: 'insulation',  label: 'Insulation' },
    { k: 'water',       label: 'Water source' },
    { k: 'sewer',       label: 'Sewer / Septic' }
  ],

  STATUS_LABEL: {
    draft:           { t: 'In progress',     c: 'var(--yellow)' },
    sent_to_seller:  { t: 'With the seller', c: 'var(--accent2)' },
    seller_reviewed: { t: 'Seller replied',  c: '#f59e0b' },
    certified:       { t: 'Certified',       c: 'var(--green)' }
  },

  DEF_STATUS: { open: 'Open', scheduled: 'Scheduled', done: 'Done', declined: 'Declined' },

  // ── Small helpers ─────────────────────────────────────────────────────────
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  fmtD(d) { return d ? ((typeof App !== 'undefined' && App.fmtDate) ? App.fmtDate(d) : String(d).slice(0, 10)) : '—'; },

  sevMeta(v) { return Walkthrough.SEVERITY.find(s => s.v === v) || Walkthrough.SEVERITY[1]; },
  costLabel(v) { return (Walkthrough.COST.find(c => c.v === v) || {}).label || 'Get a quote'; },

  // Feet as a decimal (14.5) shown the way a measurement is written (14' 6").
  ftIn(n) {
    if (n === null || n === undefined || n === '') return '';
    const f = Math.floor(Number(n));
    const i = Math.round((Number(n) - f) * 12);
    if (i === 12) return `${f + 1}' 0"`;
    return `${f}' ${i}"`;
  },
  toFt(feet, inches) {
    const f = parseFloat(feet), i = parseFloat(inches);
    if (isNaN(f) && isNaN(i)) return null;
    return Number(((isNaN(f) ? 0 : f) + (isNaN(i) ? 0 : i) / 12).toFixed(2));
  },

  async uid() {
    const user = await App.getAuthUser();
    return user?.id || currentAgent?.id || null;
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LIST
  // ══════════════════════════════════════════════════════════════════════════

  async load() {
    const el = document.getElementById('screen-walkthrough');
    if (!el) return;
    // A live conversation outlives navigation on purpose: he will step out of
    // this screen to check something mid-sentence and the recording should not
    // die for it. The fixed bar keeps it visible and stoppable from anywhere.
    // What must not happen is `current` going null underneath a phrase arriving.
    if (!Walkthrough._listening) Walkthrough.current = null;
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text2);">Loading walkthroughs…</div>`;

    const uid = await Walkthrough.uid();
    if (!uid) { el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text2);">Not signed in.</div>`; return; }

    const { data, error } = await db.from('walkthroughs')
      .select('*, clients(full_name, email)')
      .eq('agent_id', uid)
      .order('created_at', { ascending: false });

    if (error) {
      el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--red);">
        Could not load walkthroughs.<br><span style="font-size:12px;color:var(--text2);">${Walkthrough.esc(error.message)}</span>
        <div style="font-size:12px;color:var(--text2);margin-top:10px;">If this says the table does not exist, run migrations 101 and 104 in the Supabase SQL Editor.</div>
      </div>`;
      return;
    }
    Walkthrough.all = data || [];

    // Pending-correction counts, so a seller who replied is visible from the
    // list rather than only after opening the walkthrough.
    let pendingBy = {};
    const ids = Walkthrough.all.map(w => w.id);
    if (ids.length) {
      const { data: eds } = await db.from('walkthrough_seller_edits')
        .select('walkthrough_id').in('walkthrough_id', ids).eq('resolution', 'pending');
      (eds || []).forEach(e => { pendingBy[e.walkthrough_id] = (pendingBy[e.walkthrough_id] || 0) + 1; });
    }

    el.innerHTML = Walkthrough.listHTML(pendingBy);
  },

  listHTML(pendingBy) {
    const w = Walkthrough;
    const head = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px;">
        <div>
          <div style="font-size:20px;font-weight:800;">Seller Walkthroughs</div>
          <div style="font-size:12.5px;color:var(--text2);margin-top:2px;">
            The listing consultation, recorded in the room. Deficiencies, photos, and the seller's own review.
          </div>
        </div>
        <button class="btn btn-primary" onclick="Walkthrough.newModal()">＋ New Walkthrough</button>
      </div>`;

    if (!w.all.length) {
      return head + `
        <div style="background:var(--card);border:1px dashed var(--border);border-radius:14px;padding:36px 24px;text-align:center;margin-top:18px;">
          <div style="font-size:34px;margin-bottom:10px;">🏚️</div>
          <div style="font-weight:700;margin-bottom:6px;">No walkthroughs yet</div>
          <div style="font-size:13px;color:var(--text2);max-width:440px;margin:0 auto;">
            Start one at the door. Add deficiencies room by room as you find them, then send the compiled record to the seller before you certify it.
          </div>
        </div>`;
    }

    const cards = w.all.map(x => {
      const st = w.STATUS_LABEL[x.status] || w.STATUS_LABEL.draft;
      const pend = pendingBy[x.id] || 0;
      const seller = x.clients?.full_name || 'No seller linked yet';
      return `
        <div class="card" style="padding:14px 16px;margin-bottom:10px;cursor:pointer;" onclick="Walkthrough.open('${x.id}')">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div style="min-width:0;">
              <div style="font-weight:750;font-size:15px;overflow:hidden;text-overflow:ellipsis;">${w.esc(x.property_address)}</div>
              <div style="font-size:12.5px;color:var(--text2);margin-top:3px;">
                ${w.esc(seller)} · started ${w.fmtD(x.created_at)}${x.certified_at ? ' · certified ' + w.fmtD(x.certified_at) : ''}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <span style="font-size:11px;font-weight:800;color:${st.c};border:1px solid ${st.c};border-radius:999px;padding:3px 9px;white-space:nowrap;">${st.t}</span>
              ${pend ? `<div style="margin-top:6px;font-size:11px;font-weight:800;color:#f59e0b;">${pend} correction${pend === 1 ? '' : 's'} waiting</div>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    return head + `<div style="margin-top:16px;">${cards}</div>`;
  },

  // ── New walkthrough ───────────────────────────────────────────────────────
  // Address only. The seller can be attached at the door or afterwards, but the
  // record cannot be SENT without one, which is enforced in sendToSeller().
  async newModal() {
    const uid = await Walkthrough.uid();
    if (!Walkthrough._clients.length) {
      const { data } = await db.from('clients')
        .select('id, full_name, email').eq('agent_id', uid).order('full_name');
      Walkthrough._clients = data || [];
    }
    const opts = Walkthrough._clients
      .map(c => `<option value="${c.id}">${Walkthrough.esc(c.full_name)}</option>`).join('');

    App.openModal(`
      <div class="modal-title">🏚️ New Walkthrough</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:14px;">
        Start this at the door. Everything else can be filled in as you walk.
      </div>
      <div class="form-group">
        <label class="form-label">Property address *</label>
        <input class="form-input" id="wt-addr" placeholder="12 Waterford Bridge Road, St. John's" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Seller</label>
        <select class="form-input form-select" id="wt-client">
          <option value="">Attach later</option>${opts}
        </select>
        <div style="font-size:11.5px;color:var(--text2);margin-top:5px;">
          Needed before the record can be sent for review. It is what puts the walkthrough in their file.
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Property type</label>
          <select class="form-input form-select" id="wt-type">
            <option value="">Not set</option>
            ${Walkthrough.typeOptions(null)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Year built</label>
          <input class="form-input" type="number" id="wt-year" placeholder="1978" min="1700" max="2100">
        </div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Walkthrough.create()">Start Walkthrough</button>
      <div id="wt-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async create() {
    const msg  = document.getElementById('wt-msg');
    const addr = document.getElementById('wt-addr')?.value.trim();
    if (!addr) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ The address is required'; } return; }

    const uid = await Walkthrough.uid();
    const clientId = document.getElementById('wt-client')?.value || null;
    const yearRaw  = document.getElementById('wt-year')?.value;

    const { data, error } = await db.from('walkthroughs').insert({
      agent_id: uid,
      client_id: clientId || null,
      property_address: addr,
      property_type: document.getElementById('wt-type')?.value || null,
      year_built: yearRaw ? parseInt(yearRaw, 10) : null,
      status: 'draft'
    }).select().single();

    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }

    const c = Walkthrough._clients.find(x => x.id === clientId);
    await Walkthrough.log('WALKTHROUGH_STARTED', c, `Listing walkthrough started at ${addr}`, clientId);

    App.closeModal();
    App.toast('🏚️ Walkthrough started', 'var(--green)');
    Walkthrough.open(data.id);
  },

  // Milestones only. A row per cracked tile would bury the client's actual
  // history, so the feed gets started / sent / seller replied / certified.
  async log(type, client, desc, clientId) {
    if (!App.logActivity) return;
    try {
      await App.logActivity(type, client?.full_name || '', client?.email || null, desc, clientId || null);
    } catch (e) { console.warn('[Walkthrough.log]', e); }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CAPTURE
  // ══════════════════════════════════════════════════════════════════════════

  async open(id) {
    const el = document.getElementById('screen-walkthrough');
    if (!el) return;
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text2);">Opening…</div>`;

    const [{ data: wt, error }, rooms, defects, photos, edits] = await Promise.all([
      db.from('walkthroughs').select('*, clients(id, full_name, email)').eq('id', id).single(),
      db.from('walkthrough_rooms').select('*').eq('walkthrough_id', id).order('sort_order'),
      db.from('walkthrough_deficiencies').select('*').eq('walkthrough_id', id).order('sort_order'),
      db.from('walkthrough_photos').select('*').eq('walkthrough_id', id).order('sort_order'),
      db.from('walkthrough_seller_edits').select('*').eq('walkthrough_id', id).order('created_at')
    ]);

    if (error || !wt) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red);">Could not open that walkthrough.</div>`;
      return;
    }

    Walkthrough.current = wt;
    Walkthrough.rooms   = rooms.data   || [];
    Walkthrough.defects = defects.data || [];
    Walkthrough.photos  = photos.data  || [];
    Walkthrough.edits   = edits.data   || [];

    await Walkthrough.signPhotos();
    Walkthrough.render();
  },

  // One signed URL per photo, valid for an hour. The bucket is private, so this
  // is the only way any image renders.
  async signPhotos() {
    Walkthrough._signed = {};
    const paths = Walkthrough.photos.map(p => p.storage_path).filter(Boolean);
    if (!paths.length) return;
    const { data, error } = await db.storage.from('listing-photos').createSignedUrls(paths, 3600);
    if (error) { console.warn('[Walkthrough] signing failed', error.message); return; }
    (data || []).forEach(d => { if (d.signedUrl) Walkthrough._signed[d.path] = d.signedUrl; });
  },

  render() {
    const el = document.getElementById('screen-walkthrough');
    const w  = Walkthrough, wt = w.current;
    if (!el || !wt) return;

    const st = w.STATUS_LABEL[wt.status] || w.STATUS_LABEL.draft;
    const pending = w.edits.filter(e => e.resolution === 'pending').length;
    const locked = !!wt.certified_at;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="Walkthrough.load()">← All walkthroughs</button>
        <span style="font-size:11px;font-weight:800;color:${st.c};border:1px solid ${st.c};border-radius:999px;padding:3px 9px;">${st.t}</span>
        ${locked ? `<span style="font-size:11.5px;color:var(--text2);">Certified ${w.fmtD(wt.certified_at)}. The record is closed.</span>` : ''}
      </div>

      ${w.headerHTML()}
      ${pending ? w.editsHTML() : ''}
      ${w.defectsHTML()}
      ${w.roomsHTML()}
      ${w.systemsHTML()}
      ${w.notesHTML()}
      ${w.actionsHTML()}
    `;
  },

  headerHTML() {
    const w = Walkthrough, wt = w.current;
    const seller = wt.clients?.full_name;
    return `
      <div class="card" style="padding:16px;margin-bottom:14px;">
        <div style="font-size:18px;font-weight:800;">${w.esc(wt.property_address)}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:4px;">
          ${seller ? '👤 ' + w.esc(seller) : '<span style="color:var(--yellow);">⚠️ No seller attached yet</span>'}
          ${wt.property_type ? ' · ' + w.esc(wt.property_type) : ''}
          ${wt.year_built ? ' · built ' + wt.year_built : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button class="btn btn-outline btn-sm" onclick="Walkthrough.editHeaderModal()">✏️ Edit property details</button>
          ${wt.certified_at ? '' : w.listenButtonHTML()}
        </div>
      </div>`;
  },

  // The conversation control lives in the header because it belongs to the
  // whole visit, not to any one room.
  listenButtonHTML() {
    const w = Walkthrough;
    const n = (w.current.transcript || []).length;
    if (w._listening) {
      return `<button class="btn btn-sm" style="background:var(--red);color:#fff;" onclick="Walkthrough.listenStop()">⏹ Stop listening</button>`;
    }
    const done = w.current.transcript_processed_at;
    return `
      <button class="btn btn-sm" style="background:var(--accent);color:#fff;" onclick="Walkthrough.listenStart()">🎙️ ${n ? 'Keep listening' : 'Listen to the walk'}</button>
      ${n ? `<button class="btn btn-outline btn-sm" onclick="Walkthrough.processTranscript()">📝 Turn ${n} phrase${n === 1 ? '' : 's'} into notes${done ? ' again' : ''}</button>
             <button class="btn btn-outline btn-sm" onclick="Walkthrough.viewTranscript()">👁 Read it</button>` : ''}`;
  },

  // He should be able to see exactly what was captured, in his own words, and
  // throw it away if the room was too noisy to be worth anything.
  viewTranscript() {
    const w = Walkthrough;
    const lines = w.current.transcript || [];
    const body = lines.length ? lines.map(l => `
      <div style="padding:7px 0;border-bottom:1px solid var(--border);">
        ${l.area ? `<div style="font-size:11px;font-weight:800;color:var(--text2);letter-spacing:.04em;">${w.esc(l.area).toUpperCase()}</div>` : ''}
        <div style="font-size:13px;line-height:1.55;">${w.esc(l.text)}</div>
      </div>`).join('') : '<div style="font-size:13px;color:var(--text2);">Nothing captured.</div>';

    App.openModal(`
      <div class="modal-title">👁 What was captured</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:10px;">
        Text only, never audio. This stays private to you and is not part of the seller's copy.
      </div>
      <div style="max-height:56vh;overflow-y:auto;">${body}</div>
      ${lines.length ? `<button class="btn btn-outline btn-block" style="margin-top:12px;border-color:var(--red);color:var(--red);" onclick="Walkthrough.clearTranscript()">Delete the transcript</button>` : ''}
    `);
  },

  async clearTranscript() {
    const w = Walkthrough;
    if (!confirm('Delete everything captured on this walkthrough? Anything you already saved as a deficiency or a note is kept.')) return;
    const { error } = await db.from('walkthroughs')
      .update({ transcript: [], transcript_processed_at: null, updated_at: new Date().toISOString() })
      .eq('id', w.current.id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    w.current.transcript = [];
    w.current.transcript_processed_at = null;
    App.closeModal();
    w.render();
    App.toast('Transcript deleted', 'var(--text2)');
  },

  // ── Deficiencies ──────────────────────────────────────────────────────────
  defectsHTML() {
    const w = Walkthrough;
    const locked = !!w.current.certified_at;

    const counts = {};
    w.defects.forEach(d => { counts[d.severity] = (counts[d.severity] || 0) + 1; });
    const chips = w.SEVERITY.filter(s => counts[s.v])
      .map(s => `<span style="font-size:11px;font-weight:800;color:${s.color};border:1px solid ${s.color};border-radius:999px;padding:2px 8px;">${counts[s.v]} ${w.esc(s.label.toLowerCase())}</span>`)
      .join(' ');

    const rows = w.defects.length ? w.defects.map(d => {
      const s = w.sevMeta(d.severity);
      const pics = w.photos.filter(p => p.deficiency_id === d.id);
      const thumbs = pics.map(p => {
        const url = w._signed[p.storage_path];
        return url
          ? `<img src="${url}" alt="${w.esc(d.item)}" style="width:58px;height:58px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer;" onclick="Walkthrough.viewPhoto('${p.id}')">`
          : '';
      }).join('');

      return `
        <div style="border:1px solid var(--border);border-left:3px solid ${s.color};border-radius:10px;padding:11px 13px;margin-bottom:9px;${d.status === 'done' || d.status === 'declined' ? 'opacity:0.6;' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:14px;">${s.icon} ${w.esc(d.item)}</div>
              <div style="font-size:12.5px;color:var(--text2);margin-top:2px;">
                ${w.esc(d.area)} · ${w.esc(s.label)} · ${w.esc(w.costLabel(d.est_cost_band))}
                ${d.status !== 'open' ? ` · <strong style="color:var(--text1);">${w.esc(w.DEF_STATUS[d.status] || d.status)}</strong>` : ''}
                ${d.seller_visible ? '' : ' · <span style="color:var(--yellow);">private</span>'}
              </div>
              ${d.recommendation ? `<div style="font-size:12.5px;margin-top:6px;line-height:1.5;">${w.esc(d.recommendation)}</div>` : ''}
              ${thumbs ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">${thumbs}</div>` : ''}
            </div>
            ${locked ? '' : `
            <div style="display:flex;gap:5px;flex-shrink:0;">
              <button class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:11px;" title="Add photo" onclick="Walkthrough.pickPhoto('${d.id}')">📷</button>
              <button class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:11px;" title="Edit" onclick="Walkthrough.defectModal('${d.id}')">✏️</button>
              <button class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:11px;border-color:var(--red);color:var(--red);" title="Delete" onclick="Walkthrough.delDefect('${d.id}')">🗑</button>
            </div>`}
          </div>
        </div>`;
    }).join('') : `<div style="font-size:13px;color:var(--text2);padding:10px 0;">Nothing recorded yet. This is the part the seller is waiting to hear.</div>`;

    return `
      <div class="card" style="padding:16px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <div>
            <div style="font-size:15px;font-weight:800;">🔧 Deficiencies &amp; Repairs (${w.defects.length})</div>
            ${chips ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${chips}</div>` : ''}
          </div>
          ${locked ? '' : `<button class="btn btn-primary btn-sm" onclick="Walkthrough.defectModal()">＋ Add deficiency</button>`}
        </div>
        ${rows}
      </div>`;
  },

  // The capture modal. Built for one hand on a phone: area, item, one tap for
  // severity, one for cost. Everything below that is optional.
  defectModal(id) {
    const w = Walkthrough;
    const d = id ? w.defects.find(x => x.id === id) : null;

    // Rooms already added come first: if he has walked the kitchen, "Kitchen"
    // should be at the top of the list rather than alphabetically buried.
    const roomAreas = w.rooms.map(r => r.room_name).filter(Boolean);
    const areas = roomAreas.concat(w.AREAS.filter(a => !roomAreas.includes(a)));
    const areaOpts = areas.map(a => `<option value="${w.esc(a)}"${d && d.area === a ? ' selected' : ''}>${w.esc(a)}</option>`).join('');

    const sevBtns = w.SEVERITY.map(s => `
      <button type="button" class="wt-sev" data-v="${s.v}" onclick="Walkthrough.pickSev('${s.v}')"
        style="flex:1;min-width:118px;padding:9px 6px;border-radius:10px;cursor:pointer;text-align:center;
               border:2px solid ${(d ? d.severity : 'should_fix') === s.v ? s.color : 'var(--border)'};
               background:${(d ? d.severity : 'should_fix') === s.v ? s.color + '22' : 'transparent'};color:var(--text1);">
        <div style="font-size:17px;">${s.icon}</div>
        <div style="font-size:12px;font-weight:800;margin-top:2px;">${s.label}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:1px;line-height:1.3;">${s.sub}</div>
      </button>`).join('');

    const costBtns = w.COST.map(c => `
      <button type="button" class="wt-cost" data-v="${c.v}" onclick="Walkthrough.pickCost('${c.v}')"
        style="padding:6px 11px;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700;
               border:2px solid ${(d ? d.est_cost_band : 'unknown') === c.v ? 'var(--accent)' : 'var(--border)'};
               background:${(d ? d.est_cost_band : 'unknown') === c.v ? 'var(--accent)' : 'transparent'};
               color:${(d ? d.est_cost_band : 'unknown') === c.v ? '#fff' : 'var(--text1)'};">${c.label}</button>`).join('');

    const statusOpts = Object.entries(w.DEF_STATUS)
      .map(([k, v]) => `<option value="${k}"${d && d.status === k ? ' selected' : ''}>${v}</option>`).join('');

    App.openModal(`
      <div class="modal-title">${d ? '✏️ Edit deficiency' : '🔧 Add deficiency'}</div>

      <div class="form-group">
        <label class="form-label">Where *</label>
        <select class="form-input form-select" id="wt-d-area" onchange="Walkthrough.refreshItemChips()">${areaOpts}</select>
      </div>

      <div class="form-group">
        <label class="form-label">What needs attention *</label>
        <input class="form-input" id="wt-d-item" placeholder="Cracked tile behind the stove" value="${d ? w.esc(d.item) : ''}" autocomplete="off">
        <div id="wt-d-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;"></div>
      </div>

      <div class="form-group">
        <label class="form-label">How serious</label>
        <div style="display:flex;gap:7px;flex-wrap:wrap;">${sevBtns}</div>
        <input type="hidden" id="wt-d-sev" value="${d ? w.esc(d.severity) : 'should_fix'}">
      </div>

      <div class="form-group">
        <label class="form-label">Rough cost to put right</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${costBtns}</div>
        <input type="hidden" id="wt-d-cost" value="${d ? w.esc(d.est_cost_band) : 'unknown'}">
        <div style="font-size:11.5px;color:var(--text2);margin-top:6px;">
          A band, never a figure. A precise number from you is a number the seller will hold you to.
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">What you would do about it</label>
        <textarea class="form-input" id="wt-d-rec" rows="2" placeholder="Replace the two cracked tiles and regrout that section before photos.">${d ? w.esc(d.recommendation || '') : ''}</textarea>
      </div>

      ${d ? `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input form-select" id="wt-d-status">${statusOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Status note</label>
          <input class="form-input" id="wt-d-statusnote" placeholder="Seller booked the tiler for the 14th" value="${w.esc(d.status_note || '')}">
        </div>
      </div>` : ''}

      <label style="display:flex;align-items:center;gap:9px;font-size:13px;cursor:pointer;margin:4px 0 14px;">
        <input type="checkbox" id="wt-d-visible" ${(!d || d.seller_visible) ? 'checked' : ''} style="width:16px;height:16px;">
        <span>Show this to the seller
          <span style="display:block;font-size:11.5px;color:var(--text2);">Turn off for pricing judgement you would not put in writing to them.</span>
        </span>
      </label>

      <button class="btn btn-primary btn-block" onclick="Walkthrough.saveDefect(${d ? `'${d.id}'` : 'null'}, false)">${d ? 'Save changes' : 'Save'}</button>
      ${d ? '' : `<button class="btn btn-outline btn-block" style="margin-top:8px;" onclick="Walkthrough.saveDefect(null, true)">Save and add another</button>`}
      <div id="wt-d-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);

    Walkthrough.refreshItemChips();
  },

  // Item suggestions follow the area, because "shingles curling" is never a
  // useful suggestion while he is standing in a bathroom.
  refreshItemChips() {
    const w = Walkthrough;
    const box = document.getElementById('wt-d-chips');
    if (!box) return;
    const area = document.getElementById('wt-d-area')?.value || '';
    const specific = w.ITEMS_BY_AREA[area] || [];
    const list = specific.concat(w.ITEMS_COMMON).slice(0, 10);
    box.innerHTML = list.map(i => `
      <button type="button" class="btn btn-outline btn-sm" style="padding:3px 9px;font-size:11.5px;"
        onclick="document.getElementById('wt-d-item').value=${JSON.stringify(i).replace(/"/g, '&quot;')};document.getElementById('wt-d-item').focus();">${w.esc(i)}</button>`).join('');
  },

  pickSev(v) {
    document.getElementById('wt-d-sev').value = v;
    document.querySelectorAll('.wt-sev').forEach(b => {
      const s = Walkthrough.sevMeta(b.dataset.v);
      const on = b.dataset.v === v;
      b.style.borderColor = on ? s.color : 'var(--border)';
      b.style.background  = on ? s.color + '22' : 'transparent';
    });
  },

  pickCost(v) {
    document.getElementById('wt-d-cost').value = v;
    document.querySelectorAll('.wt-cost').forEach(b => {
      const on = b.dataset.v === v;
      b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
      b.style.background  = on ? 'var(--accent)' : 'transparent';
      b.style.color       = on ? '#fff' : 'var(--text1)';
    });
  },

  async saveDefect(id, again) {
    const w = Walkthrough;
    const msg  = document.getElementById('wt-d-msg');
    const area = document.getElementById('wt-d-area')?.value.trim();
    const item = document.getElementById('wt-d-item')?.value.trim();
    if (!item) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Say what needs attention'; } return; }

    const uid = await w.uid();
    const room = w.rooms.find(r => r.room_name === area);
    const payload = {
      area,
      item,
      severity:       document.getElementById('wt-d-sev')?.value || 'should_fix',
      est_cost_band:  document.getElementById('wt-d-cost')?.value || 'unknown',
      recommendation: document.getElementById('wt-d-rec')?.value.trim() || null,
      seller_visible: !!document.getElementById('wt-d-visible')?.checked,
      room_id:        room ? room.id : null,
      updated_at:     new Date().toISOString()
    };
    if (id) {
      payload.status      = document.getElementById('wt-d-status')?.value || 'open';
      payload.status_note = document.getElementById('wt-d-statusnote')?.value.trim() || null;
    }

    let error;
    if (id) {
      ({ error } = await db.from('walkthrough_deficiencies').update(payload).eq('id', id));
    } else {
      payload.walkthrough_id = w.current.id;
      payload.agent_id       = uid;
      payload.sort_order     = w.defects.length;
      ({ error } = await db.from('walkthrough_deficiencies').insert(payload));
    }
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }

    App.toast(id ? 'Updated' : '🔧 Deficiency recorded', 'var(--green)');
    if (again) {
      // Keep the area, clear the rest. Three problems in one bathroom is the
      // normal case, and re-picking the room each time is the friction that
      // makes people stop recording them.
      const keepArea = area;
      App.closeModal();
      await w.reloadDefects();
      w.defectModal();
      const sel = document.getElementById('wt-d-area');
      if (sel) { sel.value = keepArea; w.refreshItemChips(); }
      return;
    }
    App.closeModal();
    await w.reloadDefects();
    w.render();
  },

  async reloadDefects() {
    const { data } = await db.from('walkthrough_deficiencies')
      .select('*').eq('walkthrough_id', Walkthrough.current.id).order('sort_order');
    Walkthrough.defects = data || [];
  },

  async delDefect(id) {
    const d = Walkthrough.defects.find(x => x.id === id);
    if (!d || !confirm(`Remove "${d.item}" from this walkthrough?`)) return;
    const pics = Walkthrough.photos.filter(p => p.deficiency_id === id);
    if (pics.length) {
      await db.storage.from('listing-photos').remove(pics.map(p => p.storage_path)).catch(() => {});
      await db.from('walkthrough_photos').delete().eq('deficiency_id', id);
      Walkthrough.photos = Walkthrough.photos.filter(p => p.deficiency_id !== id);
    }
    const { error } = await db.from('walkthrough_deficiencies').delete().eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    await Walkthrough.reloadDefects();
    Walkthrough.render();
    App.toast('Removed', 'var(--text2)');
  },

  // ── Photos ────────────────────────────────────────────────────────────────
  // No `capture` attribute on the input on purpose: with it, iOS opens straight
  // to the camera and drops the photo library, so a shot taken two minutes ago
  // could not be attached. Without it he gets both.
  pickPhoto(defectId, roomId) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.multiple = true;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const files = Array.from(inp.files || []);
      inp.remove();
      if (files.length) await Walkthrough.uploadPhotos(files, defectId || null, roomId || null);
    });
    inp.click();
  },

  // Phone photos are 3 to 5 MB each and sixty of them is a quarter gigabyte of
  // storage for a house that may not even list. Resized to 1600px on the long
  // edge at JPEG 0.8 they are around 300 KB and still show a hairline crack.
  async compress(file) {
    if (!file.type.startsWith('image/')) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 600 * 1024) return file;   // already small
      const cv = document.createElement('canvas');
      cv.width  = Math.round(bitmap.width  * scale);
      cv.height = Math.round(bitmap.height * scale);
      cv.getContext('2d').drawImage(bitmap, 0, 0, cv.width, cv.height);
      bitmap.close?.();
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.8));
      return (blob && blob.size < file.size) ? blob : file;
    } catch (e) {
      console.warn('[Walkthrough] compress failed, uploading original', e);
      return file;
    }
  },

  async uploadPhotos(files, defectId, roomId) {
    const w = Walkthrough;
    const uid = await w.uid();
    if (!uid) { App.toast('Not signed in', 'var(--red)'); return; }

    App.toast(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`, 'var(--accent2)');
    let ok = 0;
    for (const file of files) {
      const blob = await w.compress(file);
      // agent_id/walkthrough_id/... — the storage policy in 101 keys on that
      // first folder being auth.uid(), so this prefix is load-bearing.
      const path = `${uid}/${w.current.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const { error: upErr } = await db.storage.from('listing-photos')
        .upload(path, blob, { contentType: blob.type || 'image/jpeg' });
      if (upErr) { console.warn('[Walkthrough] upload', upErr.message); continue; }

      const { data, error } = await db.from('walkthrough_photos').insert({
        walkthrough_id: w.current.id,
        agent_id: uid,
        room_id: roomId || null,
        deficiency_id: defectId || null,
        storage_path: path,
        kind: defectId ? 'defect' : (roomId ? 'room' : 'exterior'),
        sort_order: w.photos.length + ok
      }).select().single();
      if (error) { console.warn('[Walkthrough] photo row', error.message); continue; }
      w.photos.push(data);
      ok++;
    }

    if (!ok) { App.toast('⚠️ Upload failed. Check migration 101 has been run.', 'var(--red)'); return; }
    await w.signPhotos();
    w.render();
    App.toast(`📷 ${ok} photo${ok === 1 ? '' : 's'} added`, 'var(--green)');
  },

  viewPhoto(id) {
    const w = Walkthrough;
    const p = w.photos.find(x => x.id === id);
    if (!p) return;
    const url = w._signed[p.storage_path];
    const d = w.defects.find(x => x.id === p.deficiency_id);
    App.openModal(`
      <div class="modal-title">${d ? w.esc(d.area) + ': ' + w.esc(d.item) : '📷 Photo'}</div>
      ${url ? `<img src="${url}" style="width:100%;border-radius:10px;">` : '<div style="color:var(--text2);">Image unavailable.</div>'}
      <div class="form-group" style="margin-top:12px;">
        <label class="form-label">Caption</label>
        <input class="form-input" id="wt-p-cap" value="${w.esc(p.caption || '')}" placeholder="Behind the stove, second tile from the left">
      </div>
      <button class="btn btn-primary btn-block" onclick="Walkthrough.savePhotoCaption('${p.id}')">Save caption</button>
      ${w.current.certified_at ? '' : `<button class="btn btn-outline btn-block" style="margin-top:8px;border-color:var(--red);color:var(--red);" onclick="Walkthrough.delPhoto('${p.id}')">Delete photo</button>`}
    `);
  },

  async savePhotoCaption(id) {
    const cap = document.getElementById('wt-p-cap')?.value.trim() || null;
    const { error } = await db.from('walkthrough_photos').update({ caption: cap }).eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    const p = Walkthrough.photos.find(x => x.id === id);
    if (p) p.caption = cap;
    App.closeModal();
    App.toast('Caption saved', 'var(--green)');
  },

  async delPhoto(id) {
    const p = Walkthrough.photos.find(x => x.id === id);
    if (!p || !confirm('Delete this photo?')) return;
    await db.storage.from('listing-photos').remove([p.storage_path]).catch(() => {});
    const { error } = await db.from('walkthrough_photos').delete().eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    Walkthrough.photos = Walkthrough.photos.filter(x => x.id !== id);
    App.closeModal();
    Walkthrough.render();
    App.toast('Photo deleted', 'var(--text2)');
  },

  // ── Rooms ─────────────────────────────────────────────────────────────────
  roomsHTML() {
    const w = Walkthrough;
    const locked = !!w.current.certified_at;

    const rows = w.rooms.length ? w.rooms.map(r => {
      const dim = (r.length_ft && r.width_ft) ? `${w.ftIn(r.length_ft)} × ${w.ftIn(r.width_ft)}` : 'No dimensions';
      const src = r.dimension_source === 'mls_sheet' ? ' <span style="color:var(--yellow);">(from old MLS sheet)</span>'
                : r.dimension_source === 'measured'  ? ' <span style="color:var(--text2);">(measured)</span>' : '';
      const pics = w.photos.filter(p => p.room_id === r.id && !p.deficiency_id).length;
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;">${w.esc(r.room_name)}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:2px;">
              ${dim}${src}${r.condition ? ' · ' + w.esc(r.condition) : ''}${r.flooring ? ' · ' + w.esc(r.flooring) : ''}${pics ? ' · 📷 ' + pics : ''}
            </div>
          </div>
          ${locked ? '' : `
          <div style="display:flex;gap:5px;flex-shrink:0;">
            <button class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:11px;" onclick="Walkthrough.pickPhoto(null,'${r.id}')">📷</button>
            <button class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:11px;" onclick="Walkthrough.roomModal('${r.id}')">✏️</button>
            <button class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:11px;border-color:var(--red);color:var(--red);" onclick="Walkthrough.delRoom('${r.id}')">🗑</button>
          </div>`}
        </div>`;
    }).join('') : `<div style="font-size:13px;color:var(--text2);padding:8px 0;">No rooms added yet.</div>`;

    return `
      <div class="card" style="padding:16px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">
          <div style="font-size:15px;font-weight:800;">📐 Rooms (${w.rooms.length})</div>
          ${locked ? '' : `
          <div style="display:flex;gap:7px;flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" onclick="Walkthrough.pickPlan()">📄 Read a floor plan</button>
            <button class="btn btn-outline btn-sm" onclick="Walkthrough.roomModal()">＋ Add room</button>
          </div>`}
        </div>
        ${rows}
      </div>`;
  },

  roomModal(id) {
    const w = Walkthrough;
    const r = id ? w.rooms.find(x => x.id === id) : null;
    const splitFt = n => {
      if (n === null || n === undefined || n === '') return { f: '', i: '' };
      const f = Math.floor(Number(n));
      return { f, i: Math.round((Number(n) - f) * 12) };
    };
    const L = splitFt(r?.length_ft), W = splitFt(r?.width_ft);

    App.openModal(`
      <div class="modal-title">${r ? '✏️ Edit room' : '📐 Add room'}</div>

      <div style="border:1px solid var(--border);border-radius:10px;padding:11px 13px;margin-bottom:14px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-outline btn-sm" id="wt-mic" onclick="Walkthrough.micToggle()">🎤 Say the room</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="Walkthrough.pickMeter()">📷 Read a laser meter</button>
        </div>
        <div id="wt-mic-txt" style="font-size:12px;color:var(--text2);margin-top:8px;line-height:1.5;">
          Say it like: primary bedroom fourteen six by eleven three, hardwood, good.
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Room name *</label>
          <input class="form-input" id="wt-r-name" value="${r ? w.esc(r.room_name) : ''}" placeholder="Primary bedroom" list="wt-r-names" autocomplete="off">
          <datalist id="wt-r-names">${w.AREAS.map(a => `<option value="${w.esc(a)}"></option>`).join('')}</datalist>
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-input form-select" id="wt-r-type">
            <option value="">Not set</option>
            ${w.ROOM_TYPES.map(t => `<option${r && r.room_type === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>

      <label class="form-label">Dimensions</label>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
        <input class="form-input" type="number" id="wt-r-lf" placeholder="ft" style="width:74px;" value="${L.f}">
        <input class="form-input" type="number" id="wt-r-li" placeholder="in" style="width:74px;" value="${L.i}">
        <span style="color:var(--text2);">×</span>
        <input class="form-input" type="number" id="wt-r-wf" placeholder="ft" style="width:74px;" value="${W.f}">
        <input class="form-input" type="number" id="wt-r-wi" placeholder="in" style="width:74px;" value="${W.i}">
      </div>
      <div class="form-group">
        <label class="form-label">Where the measurement came from</label>
        <select class="form-input form-select" id="wt-r-src">
          <option value="typed"     ${r && r.dimension_source === 'typed'     ? 'selected' : ''}>Typed on site</option>
          <option value="measured"  ${r && r.dimension_source === 'measured'  ? 'selected' : ''}>Measured with a tape</option>
          <option value="mls_sheet" ${r && r.dimension_source === 'mls_sheet' ? 'selected' : ''}>Carried over from an old MLS sheet</option>
        </select>
        <div style="font-size:11.5px;color:var(--text2);margin-top:5px;">
          Never taken from a photograph. A wrong number on an MLS sheet is your signature on a wrong number.
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Condition</label>
          <select class="form-input form-select" id="wt-r-cond">
            <option value="">Not set</option>
            ${w.CONDITIONS.map(c => `<option${r && r.condition === c ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Flooring</label>
          <select class="form-input form-select" id="wt-r-floor">
            <option value="">Not set</option>
            ${w.FLOORING.map(f => `<option${r && r.flooring === f ? ' selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Note (yours, not the seller's)</label>
        <textarea class="form-input" id="wt-r-note" rows="2" placeholder="South facing, gets the afternoon light.">${r ? w.esc(r.note || '') : ''}</textarea>
      </div>

      <button class="btn btn-primary btn-block" onclick="Walkthrough.saveRoom(${r ? `'${r.id}'` : 'null'})">${r ? 'Save changes' : 'Add room'}</button>
      <div id="wt-r-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async saveRoom(id) {
    const w = Walkthrough;
    const msg = document.getElementById('wt-r-msg');
    const name = document.getElementById('wt-r-name')?.value.trim();
    if (!name) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Name the room'; } return; }

    const uid = await w.uid();
    const payload = {
      room_name: name,
      room_type: document.getElementById('wt-r-type')?.value || null,
      length_ft: w.toFt(document.getElementById('wt-r-lf')?.value, document.getElementById('wt-r-li')?.value),
      width_ft:  w.toFt(document.getElementById('wt-r-wf')?.value, document.getElementById('wt-r-wi')?.value),
      dimension_source: document.getElementById('wt-r-src')?.value || 'typed',
      condition: document.getElementById('wt-r-cond')?.value || null,
      flooring:  document.getElementById('wt-r-floor')?.value || null,
      note:      document.getElementById('wt-r-note')?.value.trim() || null,
      updated_at: new Date().toISOString()
    };

    let error;
    if (id) {
      ({ error } = await db.from('walkthrough_rooms').update(payload).eq('id', id));
    } else {
      payload.walkthrough_id = w.current.id;
      payload.agent_id = uid;
      payload.sort_order = w.rooms.length;
      ({ error } = await db.from('walkthrough_rooms').insert(payload));
    }
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }

    const { data } = await db.from('walkthrough_rooms')
      .select('*').eq('walkthrough_id', w.current.id).order('sort_order');
    w.rooms = data || [];
    App.closeModal();
    w.render();
    App.toast(id ? 'Room updated' : '📐 Room added', 'var(--green)');
  },

  async delRoom(id) {
    const r = Walkthrough.rooms.find(x => x.id === id);
    if (!r || !confirm(`Remove ${r.room_name}? Any deficiency found there is kept.`)) return;
    const { error } = await db.from('walkthrough_rooms').delete().eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    Walkthrough.rooms = Walkthrough.rooms.filter(x => x.id !== id);
    await Walkthrough.reloadDefects();   // room_id went null on theirs
    Walkthrough.render();
    App.toast('Room removed', 'var(--text2)');
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GETTING DIMENSIONS IN WITHOUT TYPING
  // ══════════════════════════════════════════════════════════════════════════
  //
  // WHAT IS NOT HERE, AND WHY: measuring a room from a photograph. A 2D image
  // carries no scale, so a wall is 10 feet or 12 feet depending on where the
  // camera stood, and nothing in the pixels resolves it. The iPhone Pro's LiDAR
  // does resolve it, to about a centimetre, but Apple exposes that only to
  // native apps through RoomPlan. Safari on iOS still publishes no WebXR AR or
  // depth API in 2026, so a web app cannot reach the scanner at all. That is a
  // door Apple has closed, not one we have failed to open.
  //
  // So the measuring stays where it is accurate (a tape, a laser, or Apple's
  // own Measure app) and what is solved here is the part that was actually
  // costing time: getting the number off the wall and into the record.
  //
  //   Voice        → say the room, it fills the form. Nothing to hold.
  //   Floor plan   → read every room off a plan or an old MLS sheet at once.
  //   Laser meter  → photograph the readout, it fills the two boxes.

  NUMWORDS: {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50
  },

  // "fourteen six by eleven three" -> "14 6 by 11 3". Speech recognition hands
  // back words for small numbers and digits for large ones, unpredictably, so
  // everything is levelled to digits before any pattern is looked for.
  normalizeNumbers(s) {
    const W = Walkthrough.NUMWORDS;
    const out = [];
    let acc = null;
    String(s).toLowerCase().replace(/,/g, ' ').split(/\s+/).forEach(tok => {
      const key = tok.replace(/[^a-z0-9]/g, '');
      if (key in W) {
        const v = W[key];
        // "twenty four" is one number; "twelve ten" is two.
        if (acc !== null && acc >= 20 && acc % 10 === 0 && v < 10) { acc += v; }
        else { if (acc !== null) out.push(String(acc)); acc = v; }
      } else {
        if (acc !== null) { out.push(String(acc)); acc = null; }
        out.push(tok);
      }
    });
    if (acc !== null) out.push(String(acc));
    return out.join(' ');
  },

  // Pulls a room out of a spoken sentence. Everything is optional except that
  // whatever IS found is filled and whatever is not is left alone, so a second
  // pass can add the flooring without wiping the dimensions.
  parseRoomSpeech(raw) {
    const w = Walkthrough;
    const norm = w.normalizeNumbers(raw);
    // Units are noise once the numbers are in order: "14 foot 6" and "14 6"
    // mean the same thing here.
    const t = norm.replace(/\b(foot|feet|ft|inch|inches|in)\b/g, ' ')
                  .replace(/\s+/g, ' ').trim();

    const out = { raw: String(raw).trim() };

    // "A [B] by C [D]" — the second number in each pair is inches when present.
    const m = t.match(/(\d+)(?:\s+(\d+))?\s*(?:by|x|×)\s*(\d+)(?:\s+(\d+))?/);
    if (m) {
      let lf = parseInt(m[1], 10);
      let li = m[2] ? parseInt(m[2], 10) : 0;
      let nameEnd = m.index;

      // "bedroom two eleven by ten" is bedroom NUMBER two, at 11 by 10. Read
      // literally it is a room 2 feet 11 inches long, which no room is. So when
      // two numbers are given and the first is 4 or less, it is a room number:
      // it belongs to the name and the second number is the real length. A
      // genuinely small space ("closet four by six") gives only one number
      // before the "by", so this never fires on it.
      if (m[2] && lf <= 4) {
        nameEnd = m.index + m[1].length;
        lf = li;
        li = 0;
      }

      out.length_ft = lf;
      out.length_in = li;
      out.width_ft  = parseInt(m[3], 10);
      out.width_in  = m[4] ? parseInt(m[4], 10) : 0;

      // The room name is whatever was said before the numbers started.
      const name = t.slice(0, nameEnd).replace(/\b(is|measures|measuring|the|a)\b/g, ' ')
                    .replace(/\s+/g, ' ').trim();
      if (name) out.room_name = name;
    } else {
      const name = t.replace(/\b(is|measures|measuring)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (name && name.length < 40) out.room_name = name;
    }

    // Flooring and condition are matched against the lists the form already
    // offers, so a spoken value always lands on a real option or is ignored.
    const low = ' ' + String(raw).toLowerCase() + ' ';
    const floor = w.FLOORING.find(f => low.includes(' ' + f.toLowerCase()));
    if (floor) out.flooring = floor;
    // Longest first so "needs work" is not shadowed by a partial match.
    const cond = w.CONDITIONS.slice().sort((a, b) => b.length - a.length)
                  .find(c => low.includes(' ' + c));
    if (cond) out.condition = cond;

    // Title case the name for the field, since recognition returns it lower.
    if (out.room_name) {
      out.room_name = out.room_name.charAt(0).toUpperCase() + out.room_name.slice(1);
    }
    return out;
  },

  // ── Voice ─────────────────────────────────────────────────────────────────
  _rec: null,

  micToggle() {
    const w = Walkthrough;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = document.getElementById('wt-mic');
    const out = document.getElementById('wt-mic-txt');

    if (!SR) {
      if (out) { out.style.color = 'var(--yellow)'; out.textContent = 'This browser will not do speech. Safari on the iPhone does.'; }
      return;
    }
    if (w._rec) { w._rec.stop(); return; }   // second tap stops it

    const rec = new SR();
    rec.lang = 'en-CA';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    w._rec = rec;

    if (btn) { btn.textContent = '⏹ Listening, tap to stop'; btn.style.borderColor = 'var(--red)'; btn.style.color = 'var(--red)'; }
    if (out) { out.style.color = 'var(--text2)'; out.textContent = 'Say it like: primary bedroom fourteen six by eleven three, hardwood, good'; }

    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      if (out) { out.style.color = 'var(--text1)'; out.textContent = '“' + text.trim() + '”'; }
      // Only fill on a final result. Filling on interim makes the fields
      // flicker through half-heard numbers while he is still talking.
      if (e.results[e.results.length - 1].isFinal) w.applyRoomSpeech(text);
    };
    rec.onerror = (e) => {
      if (out) { out.style.color = 'var(--red)'; out.textContent = e.error === 'not-allowed'
        ? 'Microphone blocked. Allow it for this site in Settings.'
        : 'Did not catch that. Tap and try again.'; }
    };
    rec.onend = () => {
      w._rec = null;
      if (btn) { btn.textContent = '🎤 Say the room'; btn.style.borderColor = ''; btn.style.color = ''; }
    };

    try { rec.start(); } catch (e) { w._rec = null; }
  },

  applyRoomSpeech(text) {
    const w = Walkthrough;
    const p = w.parseRoomSpeech(text);
    const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null && v !== '') el.value = v; };

    if (p.room_name) set('wt-r-name', p.room_name);
    if (p.length_ft !== undefined) {
      set('wt-r-lf', p.length_ft); set('wt-r-li', p.length_in);
      set('wt-r-wf', p.width_ft);  set('wt-r-wi', p.width_in);
    }
    if (p.flooring)  set('wt-r-floor', p.flooring);
    if (p.condition) set('wt-r-cond', p.condition);

    const out = document.getElementById('wt-mic-txt');
    if (out) {
      const got = [];
      if (p.room_name) got.push(p.room_name);
      if (p.length_ft !== undefined) got.push(`${w.ftIn(w.toFt(p.length_ft, p.length_in))} × ${w.ftIn(w.toFt(p.width_ft, p.width_in))}`);
      if (p.flooring) got.push(p.flooring);
      if (p.condition) got.push(p.condition);
      out.style.color = got.length ? 'var(--green)' : 'var(--yellow)';
      out.textContent = got.length
        ? '✓ ' + got.join(' · ') + '. Check it and save.'
        : 'Heard you, but nothing matched. Try: kitchen twelve by ten, tile, good.';
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LISTENING TO THE WHOLE CONVERSATION
  // ══════════════════════════════════════════════════════════════════════════
  //
  // The mic stays on while he talks the house over with the seller, tagged with
  // the room he is standing in. Afterwards the transcript is read once and comes
  // back as PROPOSED deficiencies and notes, which he ticks through before any
  // of it is saved. Nothing reaches the record, or the seller, unread.
  //
  // CONSENT IS A GATE, NOT A CHECKBOX. Section 184(2) of the Criminal Code makes
  // recording lawful for a participant, which covers Maxwell. PIPEDA is the part
  // that does not care: collecting a client's words commercially means telling
  // them, saying what it is for, and getting agreement. So the session will not
  // start until that is affirmed, and the affirmation is written to the
  // walkthrough and to activity_log at the same moment.
  //
  // NO AUDIO IS KEPT. The engine hands back text and the audio never touches
  // this app. That is worth saying out loud to the seller, because it is the
  // sentence that usually turns a no into a yes.
  //
  // ON IOS THIS WILL DROP OUT. Safari's speech engine stops itself after a
  // silence and is documented as unreliable in continuous mode. So: every final
  // phrase is appended and saved the moment it arrives, the session restarts
  // itself, and a stall is shown on the bar rather than hidden. A dropout costs
  // the sentence being spoken at that instant and nothing before it.

  _listen: null,       // the live recognition instance
  _listening: false,   // the SESSION is on, even if the engine is between restarts
  _area: '',           // the room he says he is standing in
  _saveTimer: null,

  // ── Consent ───────────────────────────────────────────────────────────────
  listenStart() {
    const w = Walkthrough, wt = w.current;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { App.toast('⚠️ This browser will not do speech. Safari on the iPhone does.', 'var(--yellow)'); return; }

    // Already consented on this walkthrough: do not ask twice in one house.
    if (wt.recording_consent_at) { w.listenGo(); return; }

    const seller = wt.clients?.full_name || 'the seller';
    App.openModal(`
      <div class="modal-title">🎙️ Before you start listening</div>
      <div style="font-size:13px;line-height:1.65;color:var(--text1);">
        You are allowed to record a conversation you are part of. You are not allowed to do it without telling ${w.esc(seller)}, because collecting their words for your business is a collection of their personal information.
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:13px 15px;margin:14px 0;">
        <div style="font-size:12px;font-weight:800;color:var(--text2);letter-spacing:.04em;margin-bottom:8px;">SAY SOMETHING LIKE</div>
        <div style="font-size:13.5px;line-height:1.6;font-style:italic;">
          “Do you mind if my phone takes notes while we walk? It writes down what we talk about so I can type it up properly for you afterwards. It does not keep any audio.”
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">What you told them, and what they said</label>
        <textarea class="form-input" id="wt-consent-note" rows="3"
          placeholder="Told ${w.esc(seller)} the phone would take notes of what we discussed so I could write it up, and that no audio is kept. She said go ahead.">Told ${w.esc(seller)} the phone would take written notes of what we discussed so I could write it up afterwards, and that no audio is kept. They agreed.</textarea>
      </div>
      <label style="display:flex;align-items:flex-start;gap:9px;font-size:13px;cursor:pointer;margin-bottom:14px;line-height:1.5;">
        <input type="checkbox" id="wt-consent-ok" style="width:16px;height:16px;flex-shrink:0;margin-top:2px;">
        <span>I have asked ${w.esc(seller)} and they agreed.</span>
      </label>
      <button class="btn btn-primary btn-block" onclick="Walkthrough.consentSave()">Start listening</button>
      <div style="font-size:11.5px;color:var(--text2);margin-top:10px;line-height:1.55;">
        This is written to their file with today's date. Only text is kept, never audio, and none of it reaches their review page unless you put it there.
      </div>
      <div id="wt-consent-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async consentSave() {
    const w = Walkthrough, wt = w.current;
    const msg = document.getElementById('wt-consent-msg');
    if (!document.getElementById('wt-consent-ok')?.checked) {
      if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Ask them first, then tick the box'; }
      return;
    }
    const note = document.getElementById('wt-consent-note')?.value.trim() || null;
    const now = new Date().toISOString();

    const { error } = await db.from('walkthroughs')
      .update({ recording_consent_at: now, recording_consent_note: note, updated_at: now })
      .eq('id', wt.id);
    if (error) {
      if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message + ' (run migration 105)'; }
      return;
    }
    wt.recording_consent_at = now;
    wt.recording_consent_note = note;

    // The activity row is the durable record, not the column.
    await w.log('WALKTHROUGH_RECORDING_CONSENT', wt.clients,
      `Consent given to take written notes of the walkthrough conversation at ${wt.property_address}. No audio kept. ${note || ''}`.trim(),
      wt.client_id);

    App.closeModal();
    w.listenGo();
  },

  // ── The session ───────────────────────────────────────────────────────────
  listenGo() {
    const w = Walkthrough;
    w._listening = true;
    w._area = w._area || (w.rooms[0]?.room_name || '');
    w.renderBar();
    w.engineStart();
    App.toast('🎙️ Listening. Say which room you are in as you move.', 'var(--green)');
  },

  engineStart() {
    const w = Walkthrough;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!w._listening || w._listen) return;

    const rec = new SR();
    rec.lang = 'en-CA';
    rec.continuous = true;
    rec.interimResults = true;
    w._listen = rec;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) w.pushPhrase(r[0].transcript);
        else interim += r[0].transcript;
      }
      const live = document.getElementById('wt-bar-live');
      if (live) live.textContent = interim ? '… ' + interim.trim() : '';
    };

    rec.onerror = (e) => {
      // 'no-speech' and 'aborted' are ordinary on iOS between restarts and are
      // not worth showing. Anything else is.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        w._listening = false;
        w.setBarState('Microphone blocked. Allow it for this site in Settings.', 'var(--red)');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        w.setBarState('Hiccup, picking back up…', 'var(--yellow)');
      }
    };

    // Safari ends the session on its own after a silence. Restarting is the
    // whole reason this survives a ten minute conversation.
    rec.onend = () => {
      w._listen = null;
      if (w._listening) setTimeout(() => w.engineStart(), 300);
      else w.renderBar();
    };

    try { rec.start(); }
    catch (e) { w._listen = null; if (w._listening) setTimeout(() => w.engineStart(), 600); }
  },

  listenStop() {
    const w = Walkthrough;
    w._listening = false;
    try { w._listen?.stop(); } catch (e) {}
    w._listen = null;
    w.saveTranscript(true);
    w.renderBar();
    const n = (w.current.transcript || []).length;
    App.toast(n ? `🎙️ Stopped. ${n} phrase${n === 1 ? '' : 's'} captured.` : 'Stopped. Nothing was captured.', 'var(--text2)');
    w.render();
  },

  // Each final phrase lands in the record immediately, tagged with the room, so
  // a dropped connection or a locked phone costs one sentence at most.
  pushPhrase(text) {
    const w = Walkthrough;
    const t = String(text || '').trim();
    if (!t || !w.current) return;
    w.current.transcript = w.current.transcript || [];
    w.current.transcript.push({ area: w._area || '', text: t, at: new Date().toISOString() });

    const tail = document.getElementById('wt-bar-tail');
    if (tail) tail.textContent = t;
    const count = document.getElementById('wt-bar-count');
    if (count) count.textContent = w.current.transcript.length;
    w.saveTranscript(false);
  },

  // Debounced: a phrase every few seconds should not be a write every few
  // seconds. Forced on stop.
  saveTranscript(now) {
    const w = Walkthrough;
    clearTimeout(w._saveTimer);
    if (!w.current) return;
    const write = async () => {
      if (!w.current) return;
      const { error } = await db.from('walkthroughs')
        .update({ transcript: w.current.transcript || [], updated_at: new Date().toISOString() })
        .eq('id', w.current.id);
      if (error) w.setBarState('⚠️ Not saving: ' + error.message, 'var(--red)');
    };
    if (now) return write();
    w._saveTimer = setTimeout(write, 4000);
  },

  setBarState(msg, color) {
    const el = document.getElementById('wt-bar-state');
    if (el) { el.textContent = msg; el.style.color = color || 'var(--text2)'; }
  },

  setArea(v) { Walkthrough._area = v; },

  // ── The bar ───────────────────────────────────────────────────────────────
  renderBar() {
    const w = Walkthrough;
    const existing = document.getElementById('wt-bar');
    if (!w._listening) { existing?.remove(); return; }

    const areas = w.rooms.map(r => r.room_name).filter(Boolean)
      .concat(w.AREAS.filter(a => !w.rooms.some(r => r.room_name === a)));
    const opts = areas.map(a => `<option${w._area === a ? ' selected' : ''}>${w.esc(a)}</option>`).join('');
    const n = (w.current.transcript || []).length;

    const html = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="display:inline-flex;align-items:center;gap:7px;font-weight:800;font-size:13px;color:var(--red);">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--red);display:inline-block;animation:wtpulse 1.2s infinite;"></span>
          Listening
        </span>
        <select class="form-input form-select" style="width:auto;min-width:150px;padding:5px 9px;font-size:12.5px;"
                onchange="Walkthrough.setArea(this.value)">${opts}</select>
        <span style="font-size:12px;color:var(--text2);"><span id="wt-bar-count">${n}</span> captured</span>
        <button class="btn btn-sm" style="background:var(--red);color:#fff;margin-left:auto;" onclick="Walkthrough.listenStop()">⏹ Stop</button>
      </div>
      <div id="wt-bar-tail" style="font-size:12.5px;color:var(--text1);margin-top:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
      <div id="wt-bar-live" style="font-size:12.5px;color:var(--text2);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
      <div id="wt-bar-state" style="font-size:11.5px;color:var(--text2);margin-top:4px;"></div>`;

    if (existing) { existing.innerHTML = html; return; }
    const bar = document.createElement('div');
    bar.id = 'wt-bar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:900;background:var(--card);border-top:2px solid var(--red);padding:10px 14px calc(10px + env(safe-area-inset-bottom));box-shadow:0 -4px 18px rgba(0,0,0,.25);';
    bar.innerHTML = html;
    document.body.appendChild(bar);
    if (!document.getElementById('wt-pulse-style')) {
      const s = document.createElement('style');
      s.id = 'wt-pulse-style';
      s.textContent = '@keyframes wtpulse{0%,100%{opacity:1}50%{opacity:.25}}';
      document.head.appendChild(s);
    }
  },

  // ── Turning the conversation into notes ───────────────────────────────────
  TRANSCRIPT_SCHEMA: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string', description: 'Two or three plain sentences the agent could say to the seller about the house overall, drawn only from what was actually discussed. Empty if the conversation does not support one.' },
      deficiencies: {
        type: 'array',
        description: 'Every repair, defect or thing needing attention that was actually discussed. Empty if none were.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            area: { type: 'string', description: 'The room or part of the house it concerns, as discussed.' },
            item: { type: 'string', description: 'What needs attention, as a short phrase, e.g. "Cracked tile behind the stove".' },
            severity: { type: 'string', enum: ['cosmetic', 'should_fix', 'must_fix', 'safety'],
              description: 'safety only if a hazard was described. must_fix if it was said a buyer or inspector would flag it. should_fix if it was said it should be done before listing. cosmetic otherwise.' },
            est_cost_band: { type: 'string', enum: ['under_500', '500_2k', '2k_10k', 'over_10k', 'unknown'],
              description: 'unknown unless a cost was actually mentioned in the conversation. Never estimate a cost that was not said aloud.' },
            recommendation: { type: 'string', description: 'What was said should be done about it, in plain words. Empty if nothing was said.' },
            said_by_seller: { type: 'string', enum: ['yes', 'no', 'unclear'],
              description: 'yes if this came from the seller rather than the agent. Used to flag things the agent has not verified himself.' }
          },
          required: ['area', 'item', 'severity', 'est_cost_band', 'recommendation', 'said_by_seller']
        }
      },
      notes: {
        type: 'array',
        description: 'Things worth recording that are not repairs: history, what stays with the house, what the seller wants, dates. Empty if none.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            area: { type: 'string' },
            note: { type: 'string', description: 'One plain sentence.' }
          },
          required: ['area', 'note']
        }
      }
    },
    required: ['summary', 'deficiencies', 'notes']
  },

  async processTranscript() {
    const w = Walkthrough;
    const lines = w.current.transcript || [];
    if (!lines.length) { App.toast('Nothing has been captured yet', 'var(--yellow)'); return; }
    if (w._reading) return;
    w._reading = true;
    App.toast('Reading the conversation. This takes a few seconds.', 'var(--accent2)');

    try {
      const doc = lines.map(l => `[${l.area || 'unspecified room'}] ${l.text}`).join('\n');
      const { data, error } = await db.functions.invoke('claude-chat', {
        body: {
          system:
            'You read a rough transcript of a real estate agent walking a house with the seller who owns it, ' +
            'and you pull out what was actually said. The property is in Newfoundland and Labrador, Canada. ' +
            'Each line is prefixed with the room the agent was standing in. ' +
            'This is speech-to-text from a phone in a busy room: it will contain misheard words, half sentences ' +
            'and both voices run together without labels. Work with that. ' +
            'Report only what was genuinely discussed. Never invent a defect, a cost, or a recommendation that ' +
            'was not said aloud, and never infer the condition of something nobody mentioned. If the transcript ' +
            'is too garbled to be sure of an item, leave it out rather than guessing at it. ' +
            'It is far better to return three things that were certainly said than ten that might have been.',
          model: 'claude-opus-5',
          max_tokens: 8000,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: w.TRANSCRIPT_SCHEMA } },
          messages: [{ role: 'user', content: [{ type: 'text', text:
            `Here is the conversation from the walkthrough at ${w.current.property_address}.\n\n${doc}` }] }]
        }
      });
      if (error) throw new Error(error.message || 'The reader could not be reached');
      if (data?.error) throw new Error(data.error);
      const parsed = MLSDrop.parse(data?.text);
      if (!parsed) throw new Error('The reader did not return anything readable');
      w.reviewProposals(parsed);
    } catch (e) {
      App.toast('⚠️ ' + (e.message || 'Could not read the conversation'), 'var(--red)');
    } finally {
      w._reading = false;
    }
  },

  // Everything arrives as a proposal with a tick beside it. This is the preview
  // he asked for: nothing from the conversation is in the record until he has
  // read it here, and nothing reaches the seller until the usual send after it.
  reviewProposals(p) {
    const w = Walkthrough;
    w._proposals = p;
    const defs = p.deficiencies || [];
    const notes = p.notes || [];

    const defRows = defs.map((d, i) => {
      const s = w.sevMeta(d.severity);
      return `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <input type="checkbox" class="wt-prop-def" data-i="${i}" checked style="width:16px;height:16px;flex-shrink:0;margin-top:3px;">
          <span style="flex:1;min-width:0;">
            <span style="font-weight:700;font-size:13.5px;">${s.icon} ${w.esc(d.area)}: ${w.esc(d.item)}</span>
            <span style="display:block;font-size:12px;color:var(--text2);margin-top:2px;">
              ${w.esc(s.label)} · ${w.esc(w.costLabel(d.est_cost_band))}${d.said_by_seller === 'yes' ? ' · <span style="color:var(--yellow);">they said this, you have not checked it</span>' : ''}
            </span>
            ${d.recommendation ? `<span style="display:block;font-size:12.5px;margin-top:4px;line-height:1.5;">${w.esc(d.recommendation)}</span>` : ''}
          </span>
        </label>`;
    }).join('');

    const noteRows = notes.map((n, i) => `
      <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <input type="checkbox" class="wt-prop-note" data-i="${i}" checked style="width:16px;height:16px;flex-shrink:0;margin-top:3px;">
        <span style="flex:1;min-width:0;font-size:12.5px;line-height:1.5;">
          <strong>${w.esc(n.area)}</strong> ${w.esc(n.note)}
        </span>
      </label>`).join('');

    App.openModal(`
      <div class="modal-title">📝 What I heard</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">
        Nothing here is saved yet. Untick anything wrong, save what is right, then edit it like anything else.
      </div>

      ${defs.length ? `
        <div style="font-size:12px;font-weight:800;color:var(--text2);letter-spacing:.04em;margin-bottom:2px;">DEFICIENCIES (${defs.length})</div>
        <div style="max-height:34vh;overflow-y:auto;margin-bottom:14px;">${defRows}</div>` :
        `<div style="font-size:13px;color:var(--text2);margin-bottom:14px;">No repairs were clearly discussed.</div>`}

      ${notes.length ? `
        <div style="font-size:12px;font-weight:800;color:var(--text2);letter-spacing:.04em;margin-bottom:2px;">NOTES (${notes.length})</div>
        <div style="max-height:24vh;overflow-y:auto;margin-bottom:14px;">${noteRows}</div>` : ''}

      ${p.summary ? `
        <label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer;margin-bottom:14px;">
          <input type="checkbox" id="wt-prop-summary" checked style="width:16px;height:16px;flex-shrink:0;margin-top:3px;">
          <span style="font-size:12.5px;line-height:1.55;">
            <strong style="display:block;margin-bottom:3px;">Use this as the summary</strong>
            ${w.esc(p.summary)}
          </span>
        </label>` : ''}

      <button class="btn btn-primary btn-block" onclick="Walkthrough.saveProposals()">Save the ticked items</button>
      <div id="wt-prop-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async saveProposals() {
    const w = Walkthrough;
    const p = w._proposals || {};
    const msg = document.getElementById('wt-prop-msg');
    const uid = await w.uid();

    const defs = [...document.querySelectorAll('.wt-prop-def')]
      .filter(c => c.checked).map(c => p.deficiencies[parseInt(c.dataset.i, 10)]);
    const notes = [...document.querySelectorAll('.wt-prop-note')]
      .filter(c => c.checked).map(c => p.notes[parseInt(c.dataset.i, 10)]);
    const useSummary = document.getElementById('wt-prop-summary')?.checked;

    if (defs.length) {
      const rows = defs.map((d, i) => {
        const room = w.rooms.find(r => r.room_name.toLowerCase() === String(d.area).toLowerCase());
        return {
          walkthrough_id: w.current.id,
          agent_id: uid,
          room_id: room ? room.id : null,
          area: d.area || 'Unspecified',
          item: d.item,
          severity: d.severity || 'should_fix',
          est_cost_band: d.est_cost_band || 'unknown',
          // Something the seller told him stays VISIBLE to them. Hiding it would
          // keep it out of the one place they can confirm or correct it, which
          // is the opposite of what the review loop is for. The "they said this"
          // flag is a prompt to go and look at it, not a reason to bury it.
          recommendation: d.recommendation || null,
          seller_visible: true,
          sort_order: w.defects.length + i
        };
      });
      const { error } = await db.from('walkthrough_deficiencies').insert(rows);
      if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }
    }

    // Notes and the summary are the agent's own text, so they go to the two
    // fields he already edits rather than anywhere new.
    const patch = { transcript_processed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (notes.length) {
      const block = notes.map(n => `${n.area}: ${n.note}`).join('\n');
      patch.agent_notes = (w.current.agent_notes ? w.current.agent_notes + '\n\n' : '') + block;
    }
    if (useSummary && p.summary) {
      patch.summary = (w.current.summary ? w.current.summary + '\n\n' : '') + p.summary;
    }
    const { error: uErr } = await db.from('walkthroughs').update(patch).eq('id', w.current.id);
    if (uErr) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + uErr.message; } return; }

    App.closeModal();
    App.toast(`📝 ${defs.length} deficienc${defs.length === 1 ? 'y' : 'ies'} and ${notes.length} note${notes.length === 1 ? '' : 's'} saved`, 'var(--green)');
    w.open(w.current.id);
  },

  // ── Reading a document ────────────────────────────────────────────────────
  // Same reader the MLS drop uses, so there is one extraction path in the app
  // rather than two that drift apart. MLSDrop.toBase64 and MLSDrop.parse are
  // reused directly for the same reason.

  PLAN_SCHEMA: {
    type: 'object',
    additionalProperties: false,
    properties: {
      document_type: { type: 'string', enum: ['floor_plan', 'mls_listing_sheet', 'other'],
        description: 'floor_plan for a drawn plan with room labels. mls_listing_sheet for a listing or property detail sheet carrying a room table. other for anything else at all, including a photograph of a room, a receipt, or a page too blurry to read.' },
      document_description: { type: 'string',
        description: 'When document_type is other, a short plain lower case description of what it actually appears to be, e.g. "a photo of a kitchen". Empty otherwise.' },
      rooms: {
        type: 'array',
        description: 'Every room the document states dimensions for. Empty if none are stated.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            room_name: { type: 'string', description: 'The room as labelled, e.g. "Kitchen", "Primary bedroom". Include the level when the document gives one, e.g. "Basement rec room".' },
            length_ft: { type: 'string', description: 'Whole feet, digits only. Convert from metres if the plan is metric. Empty if not stated.' },
            length_in: { type: 'string', description: 'Inches 0 to 11, digits only. "0" when the measurement is whole feet. Empty if no length is stated.' },
            width_ft:  { type: 'string', description: 'Whole feet, digits only. Empty if not stated.' },
            width_in:  { type: 'string', description: 'Inches 0 to 11, digits only. Empty if no width is stated.' },
            flooring:  { type: 'string', description: 'Flooring as stated, e.g. "Hardwood", "Tile". Empty if not stated.' }
          },
          required: ['room_name', 'length_ft', 'length_in', 'width_ft', 'width_in', 'flooring']
        }
      }
    },
    required: ['document_type', 'document_description', 'rooms']
  },

  METER_SCHEMA: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reading_found: { type: 'string', enum: ['yes', 'no'],
        description: 'yes only if a numeric distance reading is legible on a measuring device display in this photo.' },
      description:   { type: 'string', description: 'When reading_found is no, a short plain lower case description of what the photo shows instead.' },
      raw_reading:   { type: 'string', description: 'The reading exactly as it appears on the display, including units, e.g. "3.810 m" or "12 ft 6 in".' },
      length_ft: { type: 'string', description: 'The first reading in whole feet, digits only, converted from metric if needed.' },
      length_in: { type: 'string', description: 'Inches 0 to 11 for the first reading, digits only.' },
      width_ft:  { type: 'string', description: 'A second reading if the display shows two, in whole feet. Empty if only one reading is shown.' },
      width_in:  { type: 'string', description: 'Inches 0 to 11 for the second reading. Empty if only one reading is shown.' }
    },
    required: ['reading_found', 'description', 'raw_reading', 'length_ft', 'length_in', 'width_ft', 'width_in']
  },

  _reading: false,

  // Shared call. Returns the parsed object or throws with something sayable.
  async askClaude(file, schema, system, ask) {
    const isPdf = file.type === 'application/pdf';
    const b64 = await MLSDrop.toBase64(file);
    const source = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image',    source: { type: 'base64', media_type: file.type, data: b64 } };

    const { data, error } = await db.functions.invoke('claude-chat', {
      body: {
        system,
        model: 'claude-opus-5',
        max_tokens: 6000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: [source, { type: 'text', text: ask }] }]
      }
    });
    if (error) throw new Error(error.message || 'The reader could not be reached');
    if (data?.error) throw new Error(data.error);
    const parsed = MLSDrop.parse(data?.text);
    if (!parsed) throw new Error('The reader did not return anything readable');
    return parsed;
  },

  // ── Floor plan or MLS sheet, every room at once ───────────────────────────
  pickPlan() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/pdf,image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (f) await Walkthrough.readPlan(f);
    });
    inp.click();
  },

  async readPlan(file) {
    const w = Walkthrough;
    if (w._reading) return;
    if (file.size > 20 * 1024 * 1024) { App.toast('⚠️ That file is over 20 MB', 'var(--red)'); return; }
    w._reading = true;
    App.toast('Reading the plan. This takes a few seconds.', 'var(--accent2)');
    try {
      const parsed = await w.askClaude(file, w.PLAN_SCHEMA,
        'You read residential floor plans and MLS listing sheets and return the room dimensions as JSON. ' +
        'Read only what the document actually states. Never estimate a dimension from the drawing scale, ' +
        'from the size of a room on the page, or from anything other than a number printed on the document. ' +
        'If a room is drawn but carries no printed dimension, return it with empty dimensions rather than ' +
        'a guess. The property is in Newfoundland and Labrador, Canada. ' +
        'Before anything else decide whether this really is a floor plan or a listing sheet. If it is not, ' +
        'set document_type to other, say what it appears to be, and return no rooms.',
        'Read every room and its stated dimensions from this document.');

      if (parsed.document_type === 'other') {
        const what = String(parsed.document_description || '').trim();
        App.toast(`⚠️ That is not a floor plan${what ? '. It looks like ' + what : ''}`, 'var(--red)');
        return;
      }
      const rooms = (parsed.rooms || []).filter(r => String(r.room_name || '').trim());
      if (!rooms.length) { App.toast('⚠️ No rooms with dimensions could be read off that', 'var(--yellow)'); return; }
      w.planConfirm(rooms);
    } catch (e) {
      App.toast('⚠️ ' + (e.message || 'Could not read that'), 'var(--red)');
    } finally {
      w._reading = false;
    }
  },

  // Nothing is written until he has looked at it. A plan read wrong is a whole
  // set of wrong numbers rather than one, so the confirmation matters more here
  // than anywhere else in the module.
  planConfirm(rooms) {
    const w = Walkthrough;
    w._planRooms = rooms;
    const rows = rooms.map((r, i) => {
      const lf = parseInt(r.length_ft, 10), wf = parseInt(r.width_ft, 10);
      const dim = (!isNaN(lf) && !isNaN(wf))
        ? `${w.ftIn(w.toFt(lf, r.length_in))} × ${w.ftIn(w.toFt(wf, r.width_in))}`
        : '<span style="color:var(--yellow);">no dimension on the plan</span>';
      const dupe = w.rooms.some(x => x.room_name.toLowerCase() === String(r.room_name).toLowerCase());
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <input type="checkbox" class="wt-plan-row" data-i="${i}" ${dupe ? '' : 'checked'} style="width:16px;height:16px;flex-shrink:0;">
          <span style="flex:1;min-width:0;">
            <span style="font-weight:700;font-size:13.5px;">${w.esc(r.room_name)}</span>
            <span style="display:block;font-size:12px;color:var(--text2);">${dim}${r.flooring ? ' · ' + w.esc(r.flooring) : ''}${dupe ? ' · <span style="color:var(--yellow);">already added</span>' : ''}</span>
          </span>
        </label>`;
    }).join('');

    App.openModal(`
      <div class="modal-title">📄 ${rooms.length} room${rooms.length === 1 ? '' : 's'} read off the plan</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:10px;">
        These get saved as coming from the sheet, not measured by you, so a carried-over number is never mistaken for one you took yourself. Untick anything wrong.
      </div>
      <div style="max-height:44vh;overflow-y:auto;">${rows}</div>
      <button class="btn btn-primary btn-block" style="margin-top:14px;" onclick="Walkthrough.addPlanRooms()">Add the ticked rooms</button>
    `);
  },

  async addPlanRooms() {
    const w = Walkthrough;
    const picked = [...document.querySelectorAll('.wt-plan-row')]
      .filter(c => c.checked).map(c => w._planRooms[parseInt(c.dataset.i, 10)]);
    if (!picked.length) { App.closeModal(); return; }

    const uid = await w.uid();
    const rows = picked.map((r, i) => ({
      walkthrough_id: w.current.id,
      agent_id: uid,
      room_name: String(r.room_name).trim(),
      length_ft: w.toFt(r.length_ft, r.length_in),
      width_ft:  w.toFt(r.width_ft,  r.width_in),
      dimension_source: 'mls_sheet',
      flooring: r.flooring || null,
      sort_order: w.rooms.length + i
    }));

    const { error } = await db.from('walkthrough_rooms').insert(rows);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }

    const { data } = await db.from('walkthrough_rooms')
      .select('*').eq('walkthrough_id', w.current.id).order('sort_order');
    w.rooms = data || [];
    App.closeModal();
    w.render();
    App.toast(`📄 ${rows.length} room${rows.length === 1 ? '' : 's'} added from the plan`, 'var(--green)');
  },

  // ── Laser meter readout ───────────────────────────────────────────────────
  pickMeter() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (f) await Walkthrough.readMeter(f);
    });
    inp.click();
  },

  async readMeter(file) {
    const w = Walkthrough;
    const note = document.getElementById('wt-mic-txt');
    if (w._reading) return;
    w._reading = true;
    if (note) { note.style.color = 'var(--text2)'; note.textContent = 'Reading the display…'; }
    try {
      // Compressed first: a full resolution phone photo of a small LCD is
      // several megabytes of mostly wall.
      const blob = await w.compress(file);
      const shot = new File([blob], 'meter.jpg', { type: 'image/jpeg' });

      const parsed = await w.askClaude(shot, w.METER_SCHEMA,
        'You read the display of a laser distance meter, a tape measure app, or any measuring device, ' +
        'and return the distance as JSON. Read only the digits actually visible on the display. ' +
        'Never estimate a distance from the photograph itself. If the display is not legible, or the ' +
        'photo does not show a measuring device at all, set reading_found to no and say what it shows. ' +
        'Convert metric readings to feet and inches, rounding inches to the nearest whole inch.',
        'What distance is on this display?');

      if (parsed.reading_found !== 'yes') {
        const what = String(parsed.description || '').trim();
        if (note) { note.style.color = 'var(--yellow)'; note.textContent = `No reading visible${what ? '. It looks like ' + what : ''}.`; }
        return;
      }

      const set = (id, v) => { const el = document.getElementById(id); if (el && v !== '' && v !== undefined && v !== null) el.value = v; };
      set('wt-r-lf', parsed.length_ft); set('wt-r-li', parsed.length_in || 0);
      set('wt-r-wf', parsed.width_ft);  set('wt-r-wi', parsed.width_in || 0);
      // It came off a real instrument, so the record should say measured.
      const src = document.getElementById('wt-r-src');
      if (src) src.value = 'measured';

      if (note) {
        note.style.color = 'var(--green)';
        note.textContent = `✓ Read ${parsed.raw_reading || ''}. Check it before you save.`;
      }
    } catch (e) {
      if (note) { note.style.color = 'var(--red)'; note.textContent = '⚠️ ' + (e.message || 'Could not read that'); }
    } finally {
      w._reading = false;
    }
  },

  // ── Systems ───────────────────────────────────────────────────────────────
  systemsHTML() {
    const w = Walkthrough;
    const sys = w.current.systems || {};
    const locked = !!w.current.certified_at;
    const filled = w.SYSTEMS.filter(s => sys[s.k] && (sys[s.k].year || sys[s.k].condition || sys[s.k].note));

    const rows = filled.length ? filled.map(s => {
      const v = sys[s.k];
      return `
        <div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <span style="font-weight:650;">${w.esc(s.label)}</span>
          <span style="color:var(--text2);text-align:right;">
            ${v.year ? w.esc(v.year) : ''}${v.year && v.condition ? ' · ' : ''}${v.condition ? w.esc(v.condition) : ''}
            ${v.note ? `<div style="font-size:11.5px;">${w.esc(v.note)}</div>` : ''}
          </span>
        </div>`;
    }).join('') : `<div style="font-size:13px;color:var(--text2);padding:8px 0;">Nothing recorded yet.</div>`;

    return `
      <div class="card" style="padding:16px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">
          <div style="font-size:15px;font-weight:800;">🏠 Systems &amp; Exterior</div>
          ${locked ? '' : `<button class="btn btn-outline btn-sm" onclick="Walkthrough.systemsModal()">✏️ Edit</button>`}
        </div>
        ${rows}
      </div>`;
  },

  systemsModal() {
    const w = Walkthrough;
    const sys = w.current.systems || {};
    const rows = w.SYSTEMS.map(s => {
      const v = sys[s.k] || {};
      return `
        <div style="border-bottom:1px solid var(--border);padding:9px 0;">
          <div style="font-size:13px;font-weight:700;margin-bottom:6px;">${w.esc(s.label)}</div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;">
            <input class="form-input" id="wt-s-${s.k}-y" placeholder="Year" style="width:88px;" value="${w.esc(v.year || '')}">
            <select class="form-input form-select" id="wt-s-${s.k}-c" style="width:135px;">
              <option value="">Condition</option>
              ${w.CONDITIONS.map(c => `<option${v.condition === c ? ' selected' : ''}>${c}</option>`).join('')}
            </select>
            <input class="form-input" id="wt-s-${s.k}-n" placeholder="Note" style="flex:1;min-width:130px;" value="${w.esc(v.note || '')}">
          </div>
        </div>`;
    }).join('');

    App.openModal(`
      <div class="modal-title">🏠 Systems &amp; Exterior</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:8px;">Leave anything blank that does not apply. Blanks are simply left out of the seller's copy.</div>
      ${rows}
      <button class="btn btn-primary btn-block" style="margin-top:14px;" onclick="Walkthrough.saveSystems()">Save</button>
    `);
  },

  async saveSystems() {
    const w = Walkthrough;
    const out = {};
    w.SYSTEMS.forEach(s => {
      const year = document.getElementById(`wt-s-${s.k}-y`)?.value.trim();
      const cond = document.getElementById(`wt-s-${s.k}-c`)?.value;
      const note = document.getElementById(`wt-s-${s.k}-n`)?.value.trim();
      if (year || cond || note) out[s.k] = { year: year || null, condition: cond || null, note: note || null };
    });
    const { error } = await db.from('walkthroughs')
      .update({ systems: out, updated_at: new Date().toISOString() }).eq('id', w.current.id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    w.current.systems = out;
    App.closeModal();
    w.render();
    App.toast('Systems saved', 'var(--green)');
  },

  // ── Summary and private notes ─────────────────────────────────────────────
  notesHTML() {
    const w = Walkthrough, wt = w.current;
    const locked = !!wt.certified_at;
    return `
      <div class="card" style="padding:16px;margin-bottom:14px;">
        <div style="font-size:15px;font-weight:800;margin-bottom:10px;">📝 Summary</div>
        <div class="form-group">
          <label class="form-label">What you will tell the seller</label>
          <textarea class="form-input" id="wt-summary" rows="4" ${locked ? 'disabled' : ''}
            placeholder="The house shows well. The kitchen and the roof are the two things worth spending on before we list.">${w.esc(wt.summary || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label" style="color:var(--yellow);">🔒 Your private notes. Never sent, never shown to the seller</label>
          <textarea class="form-input" id="wt-notes" rows="3" ${locked ? 'disabled' : ''}
            placeholder="Wants 480 and it is a 435 house. Ex-husband on title, check before listing paperwork.">${w.esc(wt.agent_notes || '')}</textarea>
        </div>
        ${locked ? '' : `<button class="btn btn-outline btn-sm" onclick="Walkthrough.saveNotes()">Save summary &amp; notes</button>`}
      </div>`;
  },

  async saveNotes() {
    const w = Walkthrough;
    const { error } = await db.from('walkthroughs').update({
      summary:     document.getElementById('wt-summary')?.value.trim() || null,
      agent_notes: document.getElementById('wt-notes')?.value.trim() || null,
      updated_at:  new Date().toISOString()
    }).eq('id', w.current.id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    w.current.summary     = document.getElementById('wt-summary')?.value.trim() || null;
    w.current.agent_notes = document.getElementById('wt-notes')?.value.trim() || null;
    App.toast('Saved', 'var(--green)');
  },

  editHeaderModal() {
    const w = Walkthrough, wt = w.current;
    const opts = w._clients.map(c =>
      `<option value="${c.id}"${wt.client_id === c.id ? ' selected' : ''}>${w.esc(c.full_name)}</option>`).join('');
    App.openModal(`
      <div class="modal-title">✏️ Property details</div>
      <div class="form-group">
        <label class="form-label">Address *</label>
        <input class="form-input" id="wt-h-addr" value="${w.esc(wt.property_address)}">
      </div>
      <div class="form-group">
        <label class="form-label">Seller</label>
        <select class="form-input form-select" id="wt-h-client"><option value="">Not attached</option>${opts}</select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Property type</label>
          <select class="form-input form-select" id="wt-h-type">
            <option value="">Not set</option>
            ${w.typeOptions(wt.property_type)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Year built</label>
          <input class="form-input" type="number" id="wt-h-year" value="${wt.year_built || ''}">
        </div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Walkthrough.saveHeader()">Save</button>
    `);
  },

  async saveHeader() {
    const w = Walkthrough;
    const addr = document.getElementById('wt-h-addr')?.value.trim();
    if (!addr) { App.toast('⚠️ Address is required', 'var(--red)'); return; }
    const yr = document.getElementById('wt-h-year')?.value;
    const { error } = await db.from('walkthroughs').update({
      property_address: addr,
      client_id: document.getElementById('wt-h-client')?.value || null,
      property_type: document.getElementById('wt-h-type')?.value || null,
      year_built: yr ? parseInt(yr, 10) : null,
      updated_at: new Date().toISOString()
    }).eq('id', w.current.id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.closeModal();
    Walkthrough.open(w.current.id);
  },

  // ── The seller's corrections ──────────────────────────────────────────────
  // Accept or reject records the resolution. It deliberately does NOT overwrite
  // the record: the seller's account sits beside Maxwell's and he makes the
  // change himself, which is what keeps "she reviewed it" and "he certified it"
  // two separate facts rather than one.
  editsHTML() {
    const w = Walkthrough;
    const pend = w.edits.filter(e => e.resolution === 'pending');
    const rows = pend.map(e => `
      <div style="border:1px solid #f59e0b;border-radius:10px;padding:11px 13px;margin-bottom:9px;">
        <div style="font-size:12px;font-weight:800;color:#f59e0b;">${w.esc(e.field_label)}</div>
        ${e.agent_value || e.seller_value ? `
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:7px;font-size:12.5px;">
          <div><span style="color:var(--text2);">You wrote</span><br><strong>${w.esc(e.agent_value || '—')}</strong></div>
          <div><span style="color:var(--text2);">They say</span><br><strong>${w.esc(e.seller_value || '—')}</strong></div>
        </div>` : ''}
        ${e.seller_comment ? `<div style="font-size:12.5px;margin-top:7px;line-height:1.5;font-style:italic;">“${w.esc(e.seller_comment)}”</div>` : ''}
        <div style="display:flex;gap:7px;margin-top:10px;">
          <button class="btn btn-sm" style="background:var(--green);color:#fff;" onclick="Walkthrough.resolveEdit('${e.id}','accepted')">Accept</button>
          <button class="btn btn-outline btn-sm" onclick="Walkthrough.resolveEdit('${e.id}','rejected')">Keep mine</button>
        </div>
      </div>`).join('');

    return `
      <div class="card" style="padding:16px;margin-bottom:14px;border:1px solid #f59e0b;">
        <div style="font-size:15px;font-weight:800;margin-bottom:4px;">💬 The seller came back on ${pend.length} thing${pend.length === 1 ? '' : 's'}</div>
        <div style="font-size:12.5px;color:var(--text2);margin-bottom:11px;">
          Accepting records that they were right. Update the record yourself above, then certify.
        </div>
        ${rows}
      </div>`;
  },

  async resolveEdit(id, resolution) {
    const { error } = await db.from('walkthrough_seller_edits')
      .update({ resolution, resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    const e = Walkthrough.edits.find(x => x.id === id);
    if (e) { e.resolution = resolution; e.resolved_at = new Date().toISOString(); }
    Walkthrough.render();
    App.toast(resolution === 'accepted' ? 'Marked accepted' : 'Kept yours', 'var(--text2)');
  },

  // ── Actions ───────────────────────────────────────────────────────────────
  actionsHTML() {
    const w = Walkthrough, wt = w.current;
    const pending = w.edits.filter(e => e.resolution === 'pending').length;

    if (wt.certified_at) {
      return `
        <div class="card" style="padding:16px;">
          <div style="font-size:15px;font-weight:800;margin-bottom:6px;">✅ Consultation complete</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.6;">
            Certified ${w.fmtD(wt.certified_at)}. This is the seller-confirmed record of the property's condition on that date, and it is what the MLS entry should be built from.
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button class="btn btn-outline" onclick="Walkthrough.preview()">👁 View the record</button>
            <button class="btn btn-outline" onclick="Walkthrough.downloadPDF()">⬇︎ Download PDF</button>
          </div>
        </div>`;
    }

    const canSend = !!wt.client_id;
    return `
      <div class="card" style="padding:16px;">
        <div style="font-size:15px;font-weight:800;margin-bottom:10px;">Next</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="Walkthrough.preview()">👁 Preview what they will see</button>
          <button class="btn btn-outline" onclick="Walkthrough.downloadPDF()">⬇︎ Download PDF</button>
          <button class="btn btn-primary" ${canSend ? '' : 'disabled title="Attach a seller first"'} onclick="Walkthrough.sendToSeller()">
            ${wt.sent_to_seller_at ? '📧 Send again' : '📧 Send to seller for review'}
          </button>
          <button class="btn" style="background:var(--green);color:#fff;" onclick="Walkthrough.certify()">✅ Certify: consultation done</button>
        </div>
        ${!canSend ? `<div style="font-size:12px;color:var(--yellow);margin-top:9px;">Attach a seller before sending. It is what files this in their record.</div>` : ''}
        ${pending ? `<div style="font-size:12px;color:#f59e0b;margin-top:9px;">${pending} correction${pending === 1 ? '' : 's'} still unresolved above.</div>` : ''}
        ${wt.sent_to_seller_at ? `<div style="font-size:12px;color:var(--text2);margin-top:9px;">Sent ${w.fmtD(wt.sent_to_seller_at)}${wt.seller_reviewed_at ? ' · reviewed ' + w.fmtD(wt.seller_reviewed_at) : ' · not opened yet'}</div>` : ''}
      </div>`;
  },

  // ══════════════════════════════════════════════════════════════════════════
  // THE COMPILED RECORD
  // ══════════════════════════════════════════════════════════════════════════
  // One builder for the preview, the PDF and the email body, so what he checks
  // is exactly what the seller receives. agent_notes and any deficiency with
  // seller_visible = false are absent by construction, not by a filter someone
  // has to remember to apply.

  reportHTML() {
    const w = Walkthrough, wt = w.current;
    const esc = w.esc;
    const seller = wt.clients?.full_name || 'Seller';
    const visible = w.defects.filter(d => d.seller_visible);

    const defBlocks = w.SEVERITY.slice().reverse().map(s => {
      const list = visible.filter(d => d.severity === s.v);
      if (!list.length) return '';
      return `
        <div style="margin-bottom:18px;">
          <div style="font-size:12px;font-weight:700;color:${s.color};text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">${esc(s.label)}: ${esc(s.sub)}</div>
          ${list.map(d => `
            <div style="border-left:3px solid ${s.color};padding:6px 0 6px 11px;margin-bottom:10px;">
              <div style="font-weight:700;font-size:14px;color:#111;">${esc(d.area)}: ${esc(d.item)}</div>
              ${d.recommendation ? `<div style="font-size:13px;color:#444;margin-top:3px;line-height:1.55;">${esc(d.recommendation)}</div>` : ''}
              <div style="font-size:12px;color:#777;margin-top:3px;">
                Estimated cost: ${esc(w.costLabel(d.est_cost_band))}${d.status !== 'open' ? ' · ' + esc(w.DEF_STATUS[d.status] || d.status) : ''}
              </div>
            </div>`).join('')}
        </div>`;
    }).join('');

    const roomRows = w.rooms.map(r => `
      <tr style="border-bottom:1px solid #e6e6e6;">
        <td style="padding:7px 0;font-size:13px;color:#111;">${esc(r.room_name)}</td>
        <td style="padding:7px 0;font-size:13px;color:#444;">${(r.length_ft && r.width_ft) ? esc(w.ftIn(r.length_ft) + ' × ' + w.ftIn(r.width_ft)) : '—'}</td>
        <td style="padding:7px 0;font-size:13px;color:#444;">${esc(r.flooring || '—')}</td>
        <td style="padding:7px 0;font-size:13px;color:#444;">${esc(r.condition || '—')}</td>
      </tr>`).join('');

    const sys = wt.systems || {};
    const sysRows = w.SYSTEMS.filter(s => sys[s.k]).map(s => {
      const v = sys[s.k];
      return `<tr style="border-bottom:1px solid #e6e6e6;">
        <td style="padding:7px 0;font-size:13px;color:#111;">${esc(s.label)}</td>
        <td style="padding:7px 0;font-size:13px;color:#444;">${esc(v.year || '—')}</td>
        <td style="padding:7px 0;font-size:13px;color:#444;">${esc(v.condition || '—')}${v.note ? ' · ' + esc(v.note) : ''}</td>
      </tr>`;
    }).join('');

    return `
      <div style="max-width:680px;margin:0 auto;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#222;padding:28px;">
        <div style="border-bottom:2px solid #0F172A;padding-bottom:14px;margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">Pre-listing consultation</div>
          <div style="font-size:21px;font-weight:800;color:#0F172A;margin-top:5px;">${esc(wt.property_address)}</div>
          <div style="font-size:13px;color:#666;margin-top:4px;">
            Prepared for ${esc(seller)}${wt.property_type ? ' · ' + esc(wt.property_type) : ''}${wt.year_built ? ' · built ' + esc(wt.year_built) : ''}
          </div>
          <div style="font-size:12px;color:#888;margin-top:3px;">Walked ${esc(w.fmtD(wt.created_at))}${wt.certified_at ? ` · certified ${esc(w.fmtD(wt.certified_at))}` : ''}</div>
        </div>

        ${wt.summary ? `
        <div style="background:#f8faff;border:1px solid #dde8ff;border-radius:10px;padding:15px;margin-bottom:22px;">
          <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px;">Summary</div>
          <div style="font-size:14px;line-height:1.65;color:#222;">${esc(wt.summary).replace(/\n/g, '<br>')}</div>
        </div>` : ''}

        <div style="font-size:15px;font-weight:800;color:#0F172A;margin-bottom:12px;">What I would put right before we list</div>
        ${defBlocks || '<div style="font-size:13px;color:#666;margin-bottom:20px;">Nothing outstanding was recorded on this visit.</div>'}

        ${roomRows ? `
        <div style="font-size:15px;font-weight:800;color:#0F172A;margin:24px 0 10px;">Rooms</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:2px solid #ddd;">
            <th style="text-align:left;font-size:11px;color:#888;text-transform:uppercase;padding-bottom:6px;">Room</th>
            <th style="text-align:left;font-size:11px;color:#888;text-transform:uppercase;padding-bottom:6px;">Size</th>
            <th style="text-align:left;font-size:11px;color:#888;text-transform:uppercase;padding-bottom:6px;">Flooring</th>
            <th style="text-align:left;font-size:11px;color:#888;text-transform:uppercase;padding-bottom:6px;">Condition</th>
          </tr>${roomRows}
        </table>` : ''}

        ${sysRows ? `
        <div style="font-size:15px;font-weight:800;color:#0F172A;margin:24px 0 10px;">Systems</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:2px solid #ddd;">
            <th style="text-align:left;font-size:11px;color:#888;text-transform:uppercase;padding-bottom:6px;">Item</th>
            <th style="text-align:left;font-size:11px;color:#888;text-transform:uppercase;padding-bottom:6px;">Year</th>
            <th style="text-align:left;font-size:11px;color:#888;text-transform:uppercase;padding-bottom:6px;">Condition</th>
          </tr>${sysRows}
        </table>` : ''}

        <div style="margin-top:26px;padding-top:14px;border-top:1px solid #e6e6e6;font-size:11.5px;color:#999;line-height:1.6;">
          Cost figures are broad estimates from a visual walkthrough, not quotes, and not a substitute for a home inspection or a contractor's assessment.
          Room dimensions are approximate and should be verified before they are relied on.
        </div>
      </div>`;
  },

  preview() {
    App.openModal(`
      <div class="modal-title">👁 The seller's copy</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">
        Your private notes and anything marked private are not in here.
      </div>
      <div style="max-height:62vh;overflow-y:auto;border:1px solid var(--border);border-radius:10px;background:#fff;">
        ${Walkthrough.reportHTML()}
      </div>
      <button class="btn btn-outline btn-block" style="margin-top:12px;" onclick="Walkthrough.downloadPDF()">⬇︎ Download PDF</button>
    `);
  },

  // Reuses Reports.toPDF for the html2canvas sizing fix it already solved. Only
  // the filename is ours.
  async downloadPDF() {
    const w = Walkthrough, wt = w.current;
    if (typeof Reports === 'undefined' || !Reports.toPDF) { App.toast('⚠️ PDF builder unavailable', 'var(--red)'); return; }
    App.toast('Building PDF…', 'var(--accent2)');
    try {
      const { blob } = await Reports.toPDF({ full_name: wt.clients?.full_name || 'Seller' }, w.reportHTML());
      const safe = (wt.property_address || 'property').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${safe}-Walkthrough-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      App.toast('⚠️ ' + (e.message || 'PDF failed'), 'var(--red)');
    }
  },

  // ── Send ──────────────────────────────────────────────────────────────────
  async sendToSeller() {
    const w = Walkthrough, wt = w.current;
    const client = wt.clients;
    if (!wt.client_id || !client) { App.toast('⚠️ Attach a seller first', 'var(--yellow)'); return; }
    if (!client.email) { App.toast('⚠️ That seller has no email address on file', 'var(--red)'); return; }

    // sent_to_seller_at is what makes the token functions in 101 return
    // anything, so the stamp has to land before the email goes out.
    const { error } = await db.from('walkthroughs').update({
      sent_to_seller_at: new Date().toISOString(),
      status: 'sent_to_seller',
      updated_at: new Date().toISOString()
    }).eq('id', wt.id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }

    const link = `${location.origin}/walkthrough-review.html?t=${wt.seller_token}`;
    const visible = w.defects.filter(d => d.seller_visible);
    await Notify.onWalkthroughReview(client, wt, link, visible.length);

    await w.log('WALKTHROUGH_SENT', client,
      `Walkthrough record for ${wt.property_address} sent to ${client.full_name} for review (${visible.length} item${visible.length === 1 ? '' : 's'})`,
      wt.client_id);

    App.toast('📧 Queued in Approvals for your review', 'var(--green)');
    Walkthrough.open(wt.id);
  },

  // ── Certify ───────────────────────────────────────────────────────────────
  async certify() {
    const w = Walkthrough, wt = w.current;
    const pending = w.edits.filter(e => e.resolution === 'pending').length;
    if (pending && !confirm(`${pending} of the seller's corrections are still unresolved. Certify anyway?`)) return;
    if (!confirm('Certify this walkthrough?\n\nIt becomes the dated, seller-confirmed record of the property\'s condition and can no longer be edited.')) return;

    const uid = await w.uid();
    const { error } = await db.from('walkthroughs').update({
      certified_at: new Date().toISOString(),
      certified_by: uid,
      status: 'certified',
      updated_at: new Date().toISOString()
    }).eq('id', wt.id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }

    await w.log('WALKTHROUGH_CERTIFIED', wt.clients,
      `Listing consultation complete for ${wt.property_address}. Record certified with ${w.defects.length} item${w.defects.length === 1 ? '' : 's'} noted.`,
      wt.client_id);

    App.toast('✅ Certified. Consultation complete.', 'var(--green)');
    Walkthrough.open(wt.id);
  }
};

window.Walkthrough = Walkthrough;
