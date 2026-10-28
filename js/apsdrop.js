// Maxwell DealFlow CRM — Signed Agreement of Purchase and Sale intake (new builds)
//
// Dropping the signed APS on the Start a New Build form reads it and fills the
// form: buyer, builder, lot address, price, deposit, the signed and completion
// dates, and any upgrades or conditions into Notes.
//
// THE READER NEVER SAVES. It only fills the form on screen. Maxwell checks every
// field against the document and presses Create New Build himself.
//
// If the buyer is not already a client, the form offers to add them: the client
// row is written only when the build is created, never on read.
//
// After the build is saved, the PDF goes into that client's document folder
// (client-docs bucket, category "aps"), so the source is one tap away.
//
// Same reader as OfferDrop and MLSDrop: the claude-chat edge function, so the
// API key stays server side. No migration needed.

const ApsDrop = {
  MAX_MB: 20,
  MODEL: 'claude-opus-5',
  _file: null,          // the PDF waiting to be filed once the build saves
  _newClient: null,     // { name, email, phone } when the buyer is not yet a client
  _busy: false,

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

  // Strings throughout, empty meaning "not stated", for the same reason as
  // OfferDrop: a half-read number surfaces as text to correct, not a wrong value.
  SCHEMA: {
    type: 'object',
    properties: {
      buyer_names:      { type: 'string', description: 'Full name(s) of the buyer(s) / purchaser(s) exactly as written. Several buyers joined with " and ".' },
      buyer_email:      { type: 'string', description: 'Email of the first buyer. Empty if not stated.' },
      buyer_phone:      { type: 'string', description: 'Phone of the first buyer. Empty if not stated.' },
      co_buyer_email:   { type: 'string', description: 'Email(s) of any other buyer(s), comma separated. Empty if not stated.' },
      builder_name:     { type: 'string', description: 'The vendor / seller / builder company name.' },
      builder_contact:  { type: 'string', description: "Name of the builder's representative or signing officer. Empty if not stated." },
      builder_email:    { type: 'string', description: "Builder's email address. Empty if not stated." },
      lot_address:      { type: 'string', description: 'The property being bought: lot number and civic address if given, e.g. "Lot 14, 47 Sprucewood Crescent, Paradise NL".' },
      mls_number:       { type: 'string', description: 'MLS number if the document states one. Empty otherwise.' },
      purchase_price:   { type: 'string', description: 'Total purchase price, digits only, no currency symbol, commas or decimals.' },
      deposit_amount:   { type: 'string', description: 'Total deposit amount, digits only. If several deposits, the sum. Empty if not stated.' },
      deposit_date:     { type: 'string', description: 'Date the (first) deposit is due or was paid, YYYY-MM-DD. Empty if not stated.' },
      offer_date:       { type: 'string', description: 'Date the buyer signed / made the offer, YYYY-MM-DD. Empty if not stated.' },
      accepted_date:    { type: 'string', description: 'Date the vendor accepted / the agreement was fully signed, YYYY-MM-DD. Empty if not stated.' },
      completion_date:  { type: 'string', description: 'Completion / closing / possession date, YYYY-MM-DD. Empty if not stated.' },
      flooring:         { type: 'string', description: 'Flooring selection if stated, e.g. "Hardwood / Tile". Empty otherwise.' },
      notes:            { type: 'string', description: 'Short summary of upgrades, inclusions, and conditions with their deadlines (e.g. "Financing by 2026-11-15"). One or two lines. Empty if none.' },
    },
    required: ['buyer_names','buyer_email','buyer_phone','co_buyer_email','builder_name','builder_contact',
               'builder_email','lot_address','mls_number','purchase_price','deposit_amount','deposit_date',
               'offer_date','accepted_date','completion_date','flooring','notes'],
    additionalProperties: false,
  },

  // ── Drop zone, rendered into #nb-aps-zone at the top of the form ──────────
  zone() {
    return `
      <div id="aps-zone"
           ondragover="event.preventDefault();this.style.borderColor='var(--accent2)';this.style.background='rgba(124,124,255,0.08)';"
           ondragleave="this.style.borderColor='var(--border)';this.style.background='transparent';"
           ondrop="ApsDrop.onDrop(event)"
           onclick="document.getElementById('aps-file').click()"
           style="border:1.5px dashed var(--border);border-radius:10px;padding:14px;text-align:center;cursor:pointer;margin-bottom:16px;transition:border-color 120ms,background 120ms;">
        <div style="font-size:13px;color:var(--text2);line-height:1.5;">
          📄 <strong style="color:var(--text1);">Drop the signed Purchase and Sale Agreement here</strong><br>
          <span style="font-size:11.5px;">or tap to choose the PDF. It fills the form below for you to check before you create the build.</span>
        </div>
        <input type="file" id="aps-file" accept="application/pdf" style="display:none;" onchange="ApsDrop.onPick(event)">
      </div>
      <div id="aps-result"></div>`;
  },

  mount() {
    const el = document.getElementById('nb-aps-zone');
    if (el && !document.getElementById('aps-zone')) el.innerHTML = ApsDrop.zone();
  },

  onDrop(ev) {
    ev.preventDefault();
    const z = document.getElementById('aps-zone');
    if (z) { z.style.borderColor = 'var(--border)'; z.style.background = 'transparent'; }
    ApsDrop.intake(Array.from(ev.dataTransfer?.files || [])[0]);
  },

  onPick(ev) {
    ApsDrop.intake(ev.target?.files?.[0]);
    ev.target.value = '';
  },

  intake(file) {
    if (!file) return;
    if (!(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))) { App.toast('That is not a PDF. Choose the signed agreement as a PDF.', 'var(--yellow)'); return; }
    if (file.size > ApsDrop.MAX_MB * 1024 * 1024) { App.toast(`${file.name} is over ${ApsDrop.MAX_MB}MB, too large to read`, 'var(--red)'); return; }
    ApsDrop.read(file);
  },

  // ── Read the document ─────────────────────────────────────────────────────
  async read(file) {
    if (ApsDrop._busy) return;
    ApsDrop._busy = true;
    const box = document.getElementById('aps-result');
    if (box) box.innerHTML = `<div class="loading" style="margin:-6px 0 14px;"><div class="spinner"></div> Reading ${ApsDrop.esc(file.name)}…</div>`;

    try {
      const b64 = await OfferDrop.toBase64(file);
      const system =
        'You read signed Agreements of Purchase and Sale for newly built homes in Newfoundland and Labrador ' +
        'and return the key terms as JSON. Read only what the document actually says. If a field is not stated, ' +
        'return an empty string. Never guess and never carry a number from one field to another. The buyer is the ' +
        'purchaser; the builder is the vendor. Amounts are digits only with no currency symbol, commas or decimals. ' +
        'Dates are YYYY-MM-DD.';

      const { data, error } = await db.functions.invoke('claude-chat', {
        body: {
          system,
          model: ApsDrop.MODEL,
          max_tokens: 2000,
          output_config: { format: { type: 'json_schema', schema: ApsDrop.SCHEMA } },
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
              { type: 'text', text: 'Extract the agreement terms from this document.' },
            ],
          }],
        },
      });

      if (error) throw new Error(error.message || 'Reader unavailable');
      if (data?.error) throw new Error(data.error);
      const x = OfferDrop.parse(data?.text);
      if (!x) throw new Error('The reader did not return readable fields.');

      ApsDrop._file = file;
      ApsDrop.fill(x);
    } catch (e) {
      console.warn('[ApsDrop] read failed:', e?.message || e);
      // Not a dead end: the PDF is still kept and filed when the build saves.
      ApsDrop._file = file;
      if (box) box.innerHTML = ApsDrop.banner('red',
        `⚠️ Could not read the agreement (${ApsDrop.esc(e?.message || 'unknown error')}). Fill the form by hand. The PDF will still be filed to the client when you create the build.`);
    } finally {
      ApsDrop._busy = false;
    }
  },

  banner(kind, html) {
    const c = kind === 'red' ? ['rgba(239,68,68,0.12)', 'var(--red)'] : ['rgba(34,197,94,0.10)', 'var(--green)'];
    return `<div style="background:${c[0]};border:1px solid ${c[1]};border-radius:8px;padding:10px 12px;margin:-6px 0 14px;font-size:12.5px;color:var(--text1);line-height:1.5;">${html}</div>`;
  },

  // ── Fill the form (empty values never overwrite what is already typed) ────
  fill(x) {
    // A stale localStorage draft must not land on top of what was just read
    if (typeof NewBuilds !== 'undefined') NewBuilds.clearDraft();
    const digits = s => String(s || '').replace(/[^0-9.]/g, '');
    const date = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : '';
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

    set('nb-builder',         x.builder_name);
    set('nb-lot-address',     x.lot_address);
    set('nb-price',           digits(x.purchase_price));
    set('nb-mls-number',      x.mls_number);
    set('nb-completion',      date(x.completion_date));
    set('nb-flooring',        x.flooring);
    set('nb-builder-contact', x.builder_contact);
    set('nb-builder-email',   x.builder_email);
    set('nb-notes',           x.notes);
    set('nb-cc-email',        x.co_buyer_email);
    set('nb-deposit-amount',  digits(x.deposit_amount));
    set('nb-deposit-date',    date(x.deposit_date));
    set('nb-pa-submitted',    date(x.offer_date));
    set('nb-pa-accepted',     date(x.accepted_date));

    const match = ApsDrop.matchClient(x.buyer_names);
    const box = document.getElementById('aps-result');
    let clientHtml;
    if (match) {
      ApsDrop._newClient = null;
      clientHtml = `Client matched: <strong>${ApsDrop.esc(match.text)}</strong> (already in DealFlow).`;
    } else if (x.buyer_names) {
      ApsDrop.addNewClientOption(x.buyer_names);
      ApsDrop._newClient = { name: x.buyer_names, email: x.buyer_email || '', phone: x.buyer_phone || '' };
      clientHtml = `
        <strong>${ApsDrop.esc(x.buyer_names)}</strong> is not in DealFlow yet. They will be added as a client when you create the build:
        <div class="form-row" style="margin-top:8px;">
          <div class="form-group"><label class="form-label">CLIENT NAME</label><input class="form-input" id="aps-new-name" value="${ApsDrop.esc(x.buyer_names)}" oninput="ApsDrop.syncNewName()"></div>
          <div class="form-group"><label class="form-label">EMAIL</label><input class="form-input" id="aps-new-email" type="email" value="${ApsDrop.esc(x.buyer_email)}" placeholder="buyer@email.com"></div>
          <div class="form-group"><label class="form-label">PHONE</label><input class="form-input" id="aps-new-phone" value="${ApsDrop.esc(x.buyer_phone)}" placeholder="709-555-0123"></div>
        </div>`;
    } else {
      clientHtml = 'No buyer name found. Pick the client from the list.';
    }

    if (box) box.innerHTML = ApsDrop.banner('green',
      `✅ Read from <strong>${ApsDrop.esc(ApsDrop._file?.name || 'the agreement')}</strong>. ` +
      `<span style="color:var(--text2);">Check every figure against the document before you create the build. Nothing is saved until you do.</span>` +
      `<div style="margin-top:8px;">${clientHtml}</div>`);
  },

  // Loose name match: "John Smith and Jane Smith" finds the client "John Smith"
  matchClient(buyerNames) {
    const sel = document.getElementById('nb-client-sel');
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    const buyers = norm(buyerNames);
    if (!sel || !buyers) return null;
    for (const opt of sel.options) {
      const n = norm(opt.dataset?.name);
      if (opt.value && opt.value !== '__new__' && n && (buyers.includes(n) || n.includes(buyers))) {
        sel.value = opt.value;
        return opt;
      }
    }
    return null;
  },

  addNewClientOption(name) {
    const sel = document.getElementById('nb-client-sel');
    if (!sel) return;
    let opt = sel.querySelector('option[value="__new__"]');
    if (!opt) { opt = document.createElement('option'); opt.value = '__new__'; sel.insertBefore(opt, sel.options[1] || null); }
    opt.dataset.name = name;
    opt.textContent = '➕ New client: ' + name;
    sel.value = '__new__';
  },

  syncNewName() {
    const name = document.getElementById('aps-new-name')?.value.trim() || '';
    const opt = document.querySelector('#nb-client-sel option[value="__new__"]');
    if (opt) { opt.dataset.name = name; opt.textContent = '➕ New client: ' + name; }
  },

  // Called by NewBuilds.save() when "New client" is selected. Returns the new id.
  async createClient() {
    const name  = document.getElementById('aps-new-name')?.value.trim() || ApsDrop._newClient?.name || '';
    if (!name) throw new Error('Client name is required');
    const { data, error } = await db.from('clients').insert({
      agent_id: currentAgent.id,
      full_name: name,
      email: document.getElementById('aps-new-email')?.value.trim() || '',
      phone: document.getElementById('aps-new-phone')?.value.trim() || '',
      stage: 'Accepted',
      client_type: 'buyer',
      notes: 'Added from signed new build Purchase and Sale Agreement',
      status: 'Active',
    }).select().single();
    if (error) throw error;
    await App.logActivity('CLIENT_ADDED', name, data.email, `New client added from signed APS: ${name}`, data.id);
    ApsDrop._newClient = null;
    return data;
  },

  // Called by NewBuilds.save() after the build is written. Non-fatal: the build
  // is already saved, so a storage hiccup is only reported, never thrown.
  async afterSave(clientId, lotAddress) {
    const file = ApsDrop._file;
    ApsDrop._file = null;
    const box = document.getElementById('aps-result');
    if (box) box.innerHTML = '';
    if (!file || !clientId) return;
    try {
      const user = await App.getAuthUser();
      const uid = user?.id || currentAgent?.id;
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${uid}/${clientId}/${Date.now()}-${safe}`;
      const { error: upErr } = await db.storage.from('client-docs').upload(path, file, { contentType: 'application/pdf' });
      if (upErr) throw upErr;
      const { error: insErr } = await db.from('client_documents').insert({
        agent_id: uid, client_id: clientId, category: 'aps', source: 'new_build',
        property_address: lotAddress || null, status: 'Signed',
        file_path: path, file_name: file.name, file_size_bytes: file.size,
      });
      if (insErr) throw insErr;
      App.toast('📁 Signed agreement filed to the client folder', 'var(--green)');
    } catch (e) {
      console.warn('[ApsDrop] filing the PDF failed (build still saved):', e?.message || e);
      App.toast('⚠️ Build saved, but the PDF could not be filed. Add it from the client folder.', 'var(--yellow)');
    }
  },
};
