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
    Walkthrough.current = null;
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
            <option>Detached</option><option>Semi-detached</option>
            <option>Townhouse</option><option>Condo</option><option>Other</option>
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
        <button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="Walkthrough.editHeaderModal()">✏️ Edit property details</button>
      </div>`;
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
          ${locked ? '' : `<button class="btn btn-outline btn-sm" onclick="Walkthrough.roomModal()">＋ Add room</button>`}
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
            ${['Detached','Semi-detached','Townhouse','Condo','Other'].map(t => `<option${wt.property_type === t ? ' selected' : ''}>${t}</option>`).join('')}
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
