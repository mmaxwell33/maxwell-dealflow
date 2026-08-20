// Maxwell DealFlow CRM — MLS sheet intake (buy side)
//
// Booking a viewing means re-keying what is already printed on the MLS sheet.
// Dropping the sheet on the Book Viewing form reads it and fills the fields in
// place: address, MLS number, price, seller's direction, the offer deadline
// when the sheet states one, and a short plain-language note about the home
// that goes to the client under the booking details.
//
// THIS IS THE SAME READER AS THE OFFER PDFs. Same claude-chat edge function,
// same JSON schema, same rule: extraction fills a form, the form is confirmed
// by Maxwell, and only then is a row written (js/viewings.js → Viewings.save).
// Nothing here saves anything.
//
// The note is ASSEMBLED HERE from the facts that were read, not written free
// hand by the model. Same sentence order every time, and a fact the sheet does
// not state simply does not appear. That keeps a client-facing sentence out of
// the model's hands while still saving the typing.
//
// The sheet itself goes to the private deal-docs bucket and the viewing keeps
// the path, so any figure on a booking traces back to the page it was read off.
//
// Requires migration 096.

const MLSDrop = {
  MAX_MB: 20,                 // request ceiling is 32MB and base64 inflates ~33%
  MODEL: 'claude-opus-5',
  // What the reader can actually be handed. HEIC is deliberately absent: the
  // API does not accept it, and a photo picked through the iPhone file picker
  // arrives as JPEG anyway. A HEIC dragged off a Mac is refused by name below
  // rather than failing deep inside the request.
  IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  _busy: false,
  _file: null,                // the sheet behind the form currently open
  _read: false,

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

  // Every field is a string; empty means "not stated on the sheet". Strings
  // throughout for the same reason as the offer reader: it keeps null handling
  // out of the schema, and a half-read price surfaces as text to correct rather
  // than as a silently wrong number.
  SCHEMA: {
    type: 'object',
    properties: {
      property_address: { type: 'string', description: 'Full civic address including town and province, as written on the sheet.' },
      mls_number:       { type: 'string', description: 'MLS listing number, digits only. Empty if not stated.' },
      list_price:       { type: 'string', description: 'List price, digits only, no currency symbol, commas or decimals. Empty if not stated.' },
      property_type:    { type: 'string', enum: ['existing_home', 'new_build', ''], description: 'new_build for a build contract, a to-be-built home or a vacant lot. existing_home otherwise. Empty if it cannot be told.' },
      sellers_direction: { type: 'string', enum: ['Offers anytime', 'Offer date set', 'No conveyance', 'Seller reviewing offers', ''],
        description: "The seller's direction on offers, exactly one of the listed values. Empty unless the sheet states a direction." },
      offer_due_date:   { type: 'string', description: 'Offer presentation / review date as YYYY-MM-DD. Empty unless the sheet states one.' },
      offer_due_time:   { type: 'string', description: 'Offer presentation time as HH:MM on a 24 hour clock. Empty unless the sheet states one.' },

      // The facts the note is built from. Short values: these become one
      // sentence a buyer reads on their phone, not a spec sheet.
      year_built:     { type: 'string', description: 'Year the home was built, 4 digits. Empty if not stated.' },
      square_feet:    { type: 'string', description: 'Total finished floor area in square feet, digits only. Empty if not stated.' },
      style:          { type: 'string', description: 'Storey style as written, e.g. "Two storey", "Bungalow", "Split entry". Empty if not stated.' },
      bedrooms:       { type: 'string', description: 'Number of bedrooms, digits only. Empty if not stated.' },
      bathrooms:      { type: 'string', description: 'Number of bathrooms, e.g. "2.5". Empty if not stated.' },
      recent_updates: { type: 'string', description: 'Recent updates or replacements with their years, as a short comma separated list, e.g. "Shingles 2021, furnace 2019". Only items the sheet actually states. Empty if none.' },
      heating:        { type: 'string', description: 'Heat type as written, e.g. "Oil forced air", "Electric baseboard", "Mini split". Empty if not stated.' },
      garage:         { type: 'string', description: 'Garage or parking as written, e.g. "Attached single garage", "Detached double". Empty if not stated.' },
      lot:            { type: 'string', description: 'Lot description as written, e.g. "Fully fenced", "0.5 acre". Empty if not stated.' },
      taxes_annual:   { type: 'string', description: 'Annual property taxes, digits only. Empty if not stated.' },
      condo_fee:      { type: 'string', description: 'Monthly condo or strata fee, digits only. Empty if there is none.' },
    },
    required: ['property_address','mls_number','list_price','property_type','sellers_direction',
               'offer_due_date','offer_due_time','year_built','square_feet','style','bedrooms',
               'bathrooms','recent_updates','heating','garage','lot','taxes_annual','condo_fee'],
    additionalProperties: false,
  },

  // ── The drop target at the top of the Book Viewing form ───────────────────
  // Inline handlers, because the form is written with innerHTML through
  // App.openModal and any listener attached after render would be wiped the
  // next time the modal is opened. A file input sits behind it so this works on
  // a phone, where nothing drags.
  zone() {
    return `
      <div id="mls-zone"
           ondragover="event.preventDefault();this.style.borderColor='var(--accent2)';this.style.background='rgba(110,140,192,0.10)';"
           ondragleave="this.style.borderColor='var(--border)';this.style.background='rgba(110,140,192,0.04)';"
           ondrop="MLSDrop.onDrop(event)"
           onclick="document.getElementById('mls-file').click()"
           style="border:1.5px dashed var(--border);border-radius:11px;padding:16px 14px;text-align:center;cursor:pointer;margin-bottom:16px;background:rgba(110,140,192,0.04);transition:border-color 120ms,background 120ms;">
        <div style="font-size:12.5px;color:var(--text2);line-height:1.5;">
          📄 <strong style="color:var(--text1);">Drop the MLS sheet here</strong><br>
          <span style="font-size:11.5px;">or tap to choose a file or take a photo. PDF, JPG or PNG. It reads the address, MLS number, price and the key facts, then fills the form for you to check.</span>
        </div>
        <input type="file" id="mls-file" accept="application/pdf,image/*" capture="environment" style="display:none;"
               onchange="MLSDrop.onPick(event)">
      </div>
      <div id="mls-msg"></div>`;
  },

  onDrop(ev) {
    ev.preventDefault();
    const z = document.getElementById('mls-zone');
    if (z) { z.style.borderColor = 'var(--border)'; z.style.background = 'rgba(110,140,192,0.04)'; }
    MLSDrop.intake(Array.from(ev.dataTransfer?.files || []));
  },

  onPick(ev) {
    MLSDrop.intake(Array.from(ev.target?.files || []));
    ev.target.value = '';   // so the same file can be picked again after a mistake
  },

  intake(files) {
    const f = files[0];
    if (!f) return;
    const isPdf   = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
    const isImage = MLSDrop.IMAGE_TYPES.includes(f.type);
    if (!isPdf && !isImage) {
      // Say which file and why, because "unsupported" on its own sends people
      // back to the same HEIC twice.
      const heic = /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
      MLSDrop.note(heic
        ? `${MLSDrop.esc(f.name)} is a HEIC photo, which the reader cannot open. Export it as JPEG, or take the photo through the button above.`
        : `${MLSDrop.esc(f.name)} is not a PDF or a photo. Download the sheet from the board, or take a picture of it.`, 'warn');
      return;
    }
    if (f.size > MLSDrop.MAX_MB * 1024 * 1024) {
      MLSDrop.note(`${MLSDrop.esc(f.name)} is over ${MLSDrop.MAX_MB}MB, too large to read.`, 'warn');
      return;
    }
    MLSDrop.read(f, isPdf);
  },

  // ── Read the sheet ────────────────────────────────────────────────────────
  async read(file, isPdf) {
    if (MLSDrop._busy) return;
    MLSDrop._busy = true;
    MLSDrop.note(`<span class="spinner" style="display:inline-block;vertical-align:-3px;margin-right:8px;"></span>Reading ${MLSDrop.esc(file.name)}. This takes a few seconds.`, 'busy');

    try {
      const b64 = await MLSDrop.toBase64(file);
      const system =
        'You read residential real estate MLS listing sheets and return the key facts as JSON. ' +
        'Read only what the document actually says. If a field is not stated on the sheet, return ' +
        'an empty string for it. Never guess, never infer a value from context, and never carry a ' +
        'number over from one field to another. The listing is in Newfoundland and Labrador, Canada. ' +
        'Prices, square footage and taxes are digits only, with no currency symbol, commas or ' +
        'decimals. Dates are YYYY-MM-DD and times are HH:MM on a 24 hour clock.';

      const source = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image',    source: { type: 'base64', media_type: file.type,         data: b64 } };

      const { data, error } = await db.functions.invoke('claude-chat', {
        body: {
          system,
          model: MLSDrop.MODEL,
          max_tokens: 2000,
          output_config: { format: { type: 'json_schema', schema: MLSDrop.SCHEMA } },
          messages: [{
            role: 'user',
            content: [source, { type: 'text', text: 'Extract the listing facts from this MLS sheet.' }],
          }],
        },
      });

      if (error) throw new Error(error.message || 'Reader unavailable');
      if (data?.error) throw new Error(data.error);
      const parsed = MLSDrop.parse(data?.text);
      if (!parsed) throw new Error('The reader did not return readable fields.');

      MLSDrop.fill(parsed);
      MLSDrop._file = file;
      MLSDrop._read = true;
      MLSDrop.note(`✅ Read from <strong>${MLSDrop.esc(file.name)}</strong>. Check the highlighted fields against the sheet before you book. Nothing is saved until you do.`, 'ok');
    } catch (e) {
      // A failed read is never a dead end: the form is already open and empty,
      // so the booking goes ahead by hand exactly as it does today.
      console.warn('[MLSDrop] read failed:', e?.message || e);
      MLSDrop._file = null;
      MLSDrop._read = false;
      MLSDrop.note(`⚠️ ${MLSDrop.esc(e?.message || 'Could not read that sheet')}. Fill the form in by hand below.`, 'warn');
    } finally {
      MLSDrop._busy = false;
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

  // ── Fill the form that is already open ────────────────────────────────────
  // The Book Viewing form IS the confirmation step. Fields the reader filled
  // are outlined so the eye goes straight to what needs checking; a field the
  // sheet did not state is left exactly as it was.
  fill(x) {
    const set = (id, val) => {
      if (!val) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val;
      el.style.borderColor = 'var(--success)';
      el.style.background = 'rgba(22,163,74,0.07)';
    };
    const digits = v => String(v || '').replace(/[^0-9]/g, '');

    set('vf-address', x.property_address);
    set('vf-mls', digits(x.mls_number));
    set('vf-price', digits(x.list_price));
    set('vf-ptype', x.property_type);
    set('vf-sellers-dir', x.sellers_direction);
    set('vf-offer-date', x.offer_due_date);
    set('vf-offer-time', x.offer_due_time);
    set('vf-highlights', MLSDrop.compose(x));
  },

  // Build the client-facing note from the facts that were read. Fixed sentence
  // order, so it reads the same on every booking, and a fact the sheet did not
  // state is simply skipped rather than guessed at. The order is the order
  // buyers ask in: what is it, how big, what has been done to it, then the
  // running costs.
  compose(x) {
    const n = v => String(v || '').trim();
    const money = v => {
      const d = n(v).replace(/[^0-9]/g, '');
      return d ? Number(d).toLocaleString('en-CA') : '';
    };
    const parts = [];

    // What it is, and how old.
    const style = n(x.style);
    const year  = n(x.year_built);
    if (style && year)      parts.push(`${style}, built ${year}.`);
    else if (style)         parts.push(`${style}.`);
    else if (year)          parts.push(`Built ${year}.`);

    // How big.
    const sqft = money(x.square_feet);
    const bed  = n(x.bedrooms);
    const bath = n(x.bathrooms);
    const size = [];
    if (sqft) size.push(`about ${sqft} sq ft`);
    if (bed)  size.push(`${bed} bedroom${bed === '1' ? '' : 's'}`);
    if (bath) size.push(`${bath} bath${bath === '1' ? '' : 's'}`);
    if (size.length) {
      const joined = size.length > 1
        ? size.slice(0, -1).join(', ') + ' and ' + size[size.length - 1]
        : size[0];
      parts.push(joined.charAt(0).toUpperCase() + joined.slice(1) + '.');
    }

    // What has been done to it recently. This is the line buyers read twice.
    const updates = n(x.recent_updates);
    if (updates) parts.push(updates.replace(/\.$/, '') + '.');

    // Garage and lot.
    const outside = [n(x.garage), n(x.lot)].filter(Boolean);
    if (outside.length) parts.push(outside.join(', ').replace(/\.$/, '') + '.');

    // Running costs.
    const heat = n(x.heating);
    if (heat) parts.push(`${heat.charAt(0).toUpperCase() + heat.slice(1)} heat.`);
    const taxes = money(x.taxes_annual);
    if (taxes) parts.push(`Taxes about $${taxes} a year.`);
    const condo = money(x.condo_fee);
    if (condo) parts.push(`Condo fee $${condo} a month.`);

    return parts.join(' ');
  },

  note(html, kind) {
    const box = document.getElementById('mls-msg');
    if (!box) return;
    const style = kind === 'ok'
      ? 'background:var(--success-soft);border:1px solid var(--success);'
      : kind === 'warn'
        ? 'background:rgba(176,141,87,0.12);border:1px solid var(--yellow);'
        : 'background:var(--surface-2);border:1px solid var(--border);';
    box.innerHTML = `<div style="${style}border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12.5px;line-height:1.5;color:var(--text1);">${html}</div>`;
  },

  // Reset between openings of the form, so a sheet read for one booking never
  // gets attached to the next one.
  reset() {
    MLSDrop._file = null;
    MLSDrop._read = false;
    MLSDrop._busy = false;
  },

  // ── File the sheet, after the viewing row is saved ────────────────────────
  // Called by Viewings.save. Non-fatal by design: a storage hiccup must not
  // lose the booking, so this returns nulls and says so in the console rather
  // than throwing back into the save path.
  async store(viewingId) {
    const file = MLSDrop._file;
    if (!file) return null;
    try {
      const user = await App.getAuthUser();
      const uid  = user?.id || currentAgent.id;
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${uid}/viewing-${viewingId || 'new'}/${Date.now()}-${safe}`;
      const { error } = await db.storage.from('deal-docs').upload(path, file, { contentType: file.type });
      if (error) { console.warn('[MLSDrop] sheet upload failed (viewing still booked):', error.message); return null; }
      return {
        mls_doc_path: path,
        mls_doc_name: file.name,
        mls_extracted_at: MLSDrop._read ? new Date().toISOString() : null,
        mls_extraction_model: MLSDrop._read ? MLSDrop.MODEL : null,
      };
    } catch (e) {
      console.warn('[MLSDrop] sheet upload failed (viewing still booked):', e?.message || e);
      return null;
    }
  },

  // Open the stored sheet behind a viewing (private bucket, short-lived link)
  async openDoc(path) {
    const { data, error } = await db.storage.from('deal-docs').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { App.toast('⚠️ Could not open that file', 'var(--red)'); return; }
    window.open(data.signedUrl, '_blank');
  },
};
