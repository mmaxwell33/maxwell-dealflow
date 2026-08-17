// Maxwell DealFlow CRM — Offer PDF intake (sell side)
//
// Offers arrive as PDFs downloaded from the offer platform. Dropping one on a
// listing reads it and fills in the offer form: amount, deposit, buyer, buyer's
// agent and their contact, brokerage, conditions, and the inspection, financing
// and closing dates. The percentage over or under asking follows from the
// amount, so ranking is automatic once the number is in.
//
// THE MONEY IS NEVER SET BY THE READER. Extraction fills a form; the form is
// confirmed by Maxwell; only then is a row written. An offer amount is the one
// number in this system that must not be wrong, so it always passes a human.
//
// The PDF itself goes to the private deal-docs bucket and the row keeps the
// path, so any figure can be traced back to the page it was read off.
//
// Reading happens in the claude-chat edge function (the API key stays server
// side). Requires migration 092 and a redeploy of that function.

const OfferDrop = {
  MAX_MB: 20,                 // request ceiling is 32MB and base64 inflates ~33%
  MODEL: 'claude-opus-5',
  _queue: [],                 // remaining files when several are dropped at once
  _busy: false,

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

  // Every field is a string; empty means "not stated in the document". Strings
  // throughout on purpose: it removes null-handling from the schema, and a
  // half-read amount like "585,0" surfaces as text to correct rather than as a
  // silently wrong number.
  SCHEMA: {
    type: 'object',
    properties: {
      amount:            { type: 'string', description: 'Total purchase price offered, digits only, no currency symbol or commas. Empty if not stated.' },
      deposit:           { type: 'string', description: 'Deposit amount, digits only. Empty if not stated.' },
      buyer_name:        { type: 'string', description: 'Full name(s) of the buyer(s) as written on the offer.' },
      buyer_agent:       { type: 'string', description: "Name of the buyer's agent / salesperson." },
      buyer_agent_email: { type: 'string', description: "Email address of the buyer's agent. Empty if not stated." },
      buyer_agent_phone: { type: 'string', description: "Phone number of the buyer's agent. Empty if not stated." },
      brokerage:         { type: 'string', description: "The buyer agent's brokerage / firm name." },
      conditions:        { type: 'string', description: 'Short comma separated list of the conditions, e.g. "Financing, Inspection, Sale of buyer property". Empty if the offer is unconditional.' },
      inspection_date:   { type: 'string', description: 'Inspection condition deadline as YYYY-MM-DD. Empty if none.' },
      financing_date:    { type: 'string', description: 'Financing condition deadline as YYYY-MM-DD. Empty if none.' },
      closing_date:      { type: 'string', description: 'Completion / closing date as YYYY-MM-DD. Empty if not stated.' },
      irrevocable_until: { type: 'string', description: 'Irrevocable date and time as written, e.g. "May 14, 2026 at 5:00 PM". Empty if not stated.' },
    },
    required: ['amount','deposit','buyer_name','buyer_agent','buyer_agent_email','buyer_agent_phone',
               'brokerage','conditions','inspection_date','financing_date','closing_date','irrevocable_until'],
    additionalProperties: false,
  },

  // ── The drop target on the listing card ───────────────────────────────────
  // Inline handlers, because listings.js re-renders the board with innerHTML
  // and any listener attached after render would be wiped on the next refresh.
  // A file input sits behind it so this works on a phone, where nothing drags.
  zone(listingId) {
    return `
      <div id="od-zone-${listingId}"
           ondragover="event.preventDefault();this.style.borderColor='var(--accent2)';this.style.background='rgba(124,124,255,0.08)';"
           ondragleave="this.style.borderColor='var(--border)';this.style.background='transparent';"
           ondrop="OfferDrop.onDrop(event,'${listingId}')"
           onclick="document.getElementById('od-file-${listingId}').click()"
           style="margin-top:8px;border:1.5px dashed var(--border);border-radius:10px;padding:12px;text-align:center;cursor:pointer;transition:border-color 120ms,background 120ms;">
        <div style="font-size:12.5px;color:var(--text2);line-height:1.5;">
          📄 <strong style="color:var(--text1);">Drop the offer PDF here</strong><br>
          <span style="font-size:11.5px;">or tap to choose a file. It reads the offer and fills the form for you to check.</span>
        </div>
        <input type="file" id="od-file-${listingId}" accept="application/pdf" multiple style="display:none;"
               onchange="OfferDrop.onPick(event,'${listingId}')">
      </div>`;
  },

  onDrop(ev, listingId) {
    ev.preventDefault();
    const z = document.getElementById('od-zone-' + listingId);
    if (z) { z.style.borderColor = 'var(--border)'; z.style.background = 'transparent'; }
    OfferDrop.intake(listingId, Array.from(ev.dataTransfer?.files || []));
  },

  onPick(ev, listingId) {
    OfferDrop.intake(listingId, Array.from(ev.target?.files || []));
    ev.target.value = '';   // so the same file can be picked again after a mistake
  },

  intake(listingId, files) {
    const pdfs = files.filter(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (!pdfs.length) { App.toast('That is not a PDF. Download the offer from the platform and drop that file.', 'var(--yellow)'); return; }
    const tooBig = pdfs.find(f => f.size > OfferDrop.MAX_MB * 1024 * 1024);
    if (tooBig) { App.toast(`${tooBig.name} is over ${OfferDrop.MAX_MB}MB — too large to read`, 'var(--red)'); return; }
    // Several offers dropped together are handled one at a time: read, confirm,
    // save, then the next opens by itself.
    OfferDrop._queue = pdfs.slice(1).map(f => ({ listingId, file: f }));
    OfferDrop.read(listingId, pdfs[0]);
  },

  // ── Read the document ─────────────────────────────────────────────────────
  async read(listingId, file) {
    if (OfferDrop._busy) return;
    OfferDrop._busy = true;
    const l = (typeof Listings !== 'undefined') ? Listings.all.find(x => x.id === listingId) : null;
    const queued = OfferDrop._queue.length;

    App.openModal(`
      <div class="modal-title">📄 Reading the offer…</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.6;">
        ${OfferDrop.esc(file.name)}<br>
        Pulling out the amount, deposit, buyer, agent, and the condition dates.
        ${queued ? `<br><span style="color:var(--accent2);">${queued} more file${queued === 1 ? '' : 's'} after this one.</span>` : ''}
      </div>
      <div class="loading" style="margin-top:16px;"><div class="spinner"></div> This takes a few seconds…</div>
    `);

    try {
      const b64 = await OfferDrop.toBase64(file);
      const askingLine = l && (l.asking_price || l.list_price)
        ? `The asking price on this listing is ${l.asking_price || l.list_price}.` : '';

      const system =
        'You read residential real estate purchase offers and return the key terms as JSON. ' +
        'Read only what the document actually says. If a field is not stated in the document, ' +
        'return an empty string for it. Never guess, never infer a value from context, and never ' +
        'carry a number over from one field to another. Amounts are digits only with no currency ' +
        'symbol, no commas and no decimals. Dates are YYYY-MM-DD. ' + askingLine;

      const { data, error } = await db.functions.invoke('claude-chat', {
        body: {
          system,
          model: OfferDrop.MODEL,
          max_tokens: 2000,
          output_config: { format: { type: 'json_schema', schema: OfferDrop.SCHEMA } },
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
              { type: 'text', text: 'Extract the offer terms from this document.' },
            ],
          }],
        },
      });

      if (error) throw new Error(error.message || 'Reader unavailable');
      if (data?.error) throw new Error(data.error);
      const parsed = OfferDrop.parse(data?.text);
      if (!parsed) throw new Error('The reader did not return readable fields. You can still enter the offer by hand.');

      OfferDrop.confirm(listingId, file, parsed);
    } catch (e) {
      // A failed read is never a dead end: the same form opens empty so the
      // offer can still be entered by hand, with the file attached.
      console.warn('[OfferDrop] read failed:', e?.message || e);
      OfferDrop.confirm(listingId, file, null, e?.message || 'Could not read the document');
    } finally {
      OfferDrop._busy = false;
    }
  },

  toBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error || new Error('Could not open the file'));
      r.readAsDataURL(file);
    });
  },

  // Structured outputs make this exact, but the edge function only forwards
  // output_config once it has been redeployed. Until then the model answers in
  // prose-wrapped JSON, so fall back to the first {...} block in the text.
  parse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) {}
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    return null;
  },

  // ── Confirm before anything is written ────────────────────────────────────
  confirm(listingId, file, x, readError) {
    const l = (typeof Listings !== 'undefined') ? Listings.all.find(x2 => x2.id === listingId) : null;
    const n = (typeof Listings !== 'undefined' && Listings._offers[listingId] ? Listings._offers[listingId].length : 0) + 1;
    const v = k => OfferDrop.esc((x && x[k]) || '');
    const num = k => String((x && x[k]) || '').replace(/[^0-9.]/g, '');
    const asking = l ? Number(l.asking_price || l.list_price || 0) : 0;
    const amt = parseFloat(num('amount')) || 0;
    const pct = (asking && amt) ? ((amt - asking) / asking * 100) : null;
    const queued = OfferDrop._queue.length;

    App.openModal(`
      <div class="modal-title">📄 Offer #${n}${l ? ' — ' + OfferDrop.esc(l.property_address) : ''}</div>

      ${readError
        ? `<div style="background:rgba(239,68,68,0.12);border:1px solid var(--red);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;color:var(--text1);line-height:1.5;">
             ⚠️ ${OfferDrop.esc(readError)}<br>
             <span style="color:var(--text2);">Fill it in by hand below. The PDF still gets attached.</span>
           </div>`
        : `<div style="background:rgba(34,197,94,0.10);border:1px solid var(--green);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;color:var(--text1);line-height:1.5;">
             ✅ Read from <strong>${OfferDrop.esc(file.name)}</strong>. <span style="color:var(--text2);">Check every figure against the document before you save. Nothing is recorded until you do.</span>
           </div>`}

      <div class="form-row">
        <div class="form-group"><label class="form-label">Offer Amount ($) *</label>
          <input class="form-input" type="number" id="od-amount" value="${num('amount')}" placeholder="585000" oninput="OfferDrop.repct('${listingId}')">
          <div id="od-pct" style="font-size:11.5px;margin-top:4px;color:var(--text2);">${
            pct === null ? 'Set an asking price on the listing to see the percentage.'
              : `<strong style="color:${pct >= 0 ? 'var(--green)' : 'var(--red)'};">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs asking</strong>`}</div>
        </div>
        <div class="form-group"><label class="form-label">Deposit ($)</label>
          <input class="form-input" type="number" id="od-deposit" value="${num('deposit')}" placeholder="20000"></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label class="form-label">Buyer</label>
          <input class="form-input" id="od-buyer" value="${v('buyer_name')}" placeholder="Buyer name(s)"></div>
        <div class="form-group"><label class="form-label">Buyer's Agent</label>
          <input class="form-input" id="od-agent" value="${v('buyer_agent')}" placeholder="Agent name"></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label class="form-label">Agent Email</label>
          <input class="form-input" type="email" id="od-agent-email" value="${v('buyer_agent_email')}" placeholder="agent@brokerage.com">
          <div style="font-size:11px;color:var(--text2);margin-top:4px;">This is where the accept or decline notice goes.</div></div>
        <div class="form-group"><label class="form-label">Brokerage</label>
          <input class="form-input" id="od-brokerage" value="${v('brokerage')}" placeholder="Brokerage name"></div>
      </div>

      <div class="form-group"><label class="form-label">Conditions</label>
        <input class="form-input" id="od-cond" value="${v('conditions')}" placeholder="Financing, inspection"></div>

      <div class="form-row">
        <div class="form-group"><label class="form-label">Inspection deadline</label>
          <input class="form-input" type="date" id="od-insp" value="${v('inspection_date')}"></div>
        <div class="form-group"><label class="form-label">Financing deadline</label>
          <input class="form-input" type="date" id="od-fin" value="${v('financing_date')}"></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label class="form-label">Closing date</label>
          <input class="form-input" type="date" id="od-close" value="${v('closing_date')}"></div>
        <div class="form-group"><label class="form-label">Irrevocable until</label>
          <input class="form-input" id="od-irrev" value="${v('irrevocable_until')}" placeholder="May 14, 2026 at 5:00 PM"></div>
      </div>

      <button class="btn btn-primary btn-block" onclick="OfferDrop.save('${listingId}')">Save Offer #${n}${queued ? ` and open the next` : ''}</button>
      <div id="od-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
    OfferDrop._file = file;
    OfferDrop._read = !readError;
  },

  // Live percentage as the amount is corrected
  repct(listingId) {
    const l = (typeof Listings !== 'undefined') ? Listings.all.find(x => x.id === listingId) : null;
    const asking = l ? Number(l.asking_price || l.list_price || 0) : 0;
    const amt = parseFloat(document.getElementById('od-amount')?.value) || 0;
    const box = document.getElementById('od-pct');
    if (!box) return;
    if (!asking || !amt) { box.innerHTML = asking ? '' : 'Set an asking price on the listing to see the percentage.'; return; }
    const pct = (amt - asking) / asking * 100;
    box.innerHTML = `<strong style="color:${pct >= 0 ? 'var(--green)' : 'var(--red)'};">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs asking</strong>`;
  },

  async save(listingId) {
    const msg = document.getElementById('od-msg');
    const amount = parseFloat(document.getElementById('od-amount')?.value);
    if (!amount || amount <= 0) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Offer amount is required'; } return; }
    if (msg) { msg.style.color = 'var(--text2)'; msg.textContent = 'Saving…'; }

    const user = await App.getAuthUser();
    const uid = user?.id || currentAgent.id;
    const offerNo = ((typeof Listings !== 'undefined' && Listings._offers[listingId]) ? Listings._offers[listingId].length : 0) + 1;

    // Attach the source document. Non-fatal: a storage hiccup must not lose the
    // offer itself, so the row is written either way and the failure is said out loud.
    let docPath = null, docName = null;
    const file = OfferDrop._file;
    if (file) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${uid}/listing-${listingId}/${Date.now()}-${safe}`;
      const { error: upErr } = await db.storage.from('deal-docs').upload(path, file, { contentType: 'application/pdf' });
      if (upErr) console.warn('[OfferDrop] PDF upload failed (offer still saved):', upErr.message);
      else { docPath = path; docName = file.name; }
    }

    const val = id => document.getElementById(id)?.value.trim() || null;
    const row = {
      agent_id: uid,
      listing_id: listingId,
      offer_no: offerNo,
      amount,
      deposit: parseFloat(document.getElementById('od-deposit')?.value) || null,
      buyer_name:        val('od-buyer'),
      buyer_agent:       val('od-agent'),
      buyer_agent_email: val('od-agent-email'),
      brokerage:         val('od-brokerage'),
      conditions:        val('od-cond'),
      inspection_date:   val('od-insp'),
      financing_date:    val('od-fin'),
      closing_date:      val('od-close'),
      irrevocable_until: val('od-irrev'),
      document_path: docPath,
      document_name: docName,
      extracted_at: OfferDrop._read ? new Date().toISOString() : null,
      extraction_model: OfferDrop._read ? OfferDrop.MODEL : null,
    };

    let { error } = await db.from('listing_offers').insert(row);
    if (error) {
      // Older schema without migration 092 — keep the offer rather than lose it.
      ['buyer_agent_email','brokerage','inspection_date','financing_date','closing_date',
       'irrevocable_until','document_path','document_name','extracted_at','extraction_model']
        .forEach(k => delete row[k]);
      ({ error } = await db.from('listing_offers').insert(row));
      if (!error) App.toast('⚠️ Offer saved, but the extra fields need migration 092', 'var(--yellow)');
    }
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }

    if (typeof App.logActivity === 'function') {
      App.logActivity('OFFER_LOGGED', null, null,
        `Offer #${offerNo} logged on a listing${docName ? ' from ' + docName : ''}`, null);
    }

    App.closeModal();
    App.toast(`📄 Offer #${offerNo} saved${docPath ? ' with the PDF attached' : ''}`, 'var(--green)');
    if (typeof Listings !== 'undefined') await Listings.load();

    // Next file in the batch, if several were dropped together
    const next = OfferDrop._queue.shift();
    if (next) setTimeout(() => OfferDrop.read(next.listingId, next.file), 400);
  },

  // Open the stored PDF behind an offer (private bucket, short-lived link)
  async openDoc(path) {
    const { data, error } = await db.storage.from('deal-docs').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { App.toast('⚠️ Could not open that file', 'var(--red)'); return; }
    window.open(data.signedUrl, '_blank');
  },
};
