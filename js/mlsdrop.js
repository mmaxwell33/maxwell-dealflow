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
      // ── The gate. Asked FIRST and answered for every file. ──────────────
      // Without this a receipt comes back as a sheet with every field empty,
      // which reads like a bad read of a good document instead of the wrong
      // document. Naming what the file actually is turns a shrug into an
      // instruction.
      document_type: { type: 'string', enum: ['mls_listing_sheet', 'other'],
        description: 'mls_listing_sheet ONLY if this document is a real estate listing sheet or property detail sheet for one specific property, carrying at minimum a civic address together with listing details. other for anything else at all: a receipt, an invoice, a bank statement, a purchase offer or contract, an inspection report, a piece of ID, a screenshot, a photo of a room or a building with no listing data on it, or a page too blurry or dark to read.' },
      document_description: { type: 'string',
        description: 'When document_type is other, a short plain description of what the document actually appears to be, lower case, no trailing period, e.g. "a grocery store receipt", "a home inspection report", "a photo of a kitchen", "a page too blurry to read". Empty when document_type is mls_listing_sheet.' },

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
      // The descriptions below are written against how Matrix actually prints a
      // sheet, not how a listing sheet might ideally be laid out.
      year_built:     { type: 'string', description: 'Year the home was built, 4 digits only. Sheets often print this as "Yr Built/Desc: 1966/-" or alongside a separate building age; take the 4 digit year and ignore the rest.' },
      square_feet:    { type: 'string', description: 'Total finished floor area in square feet, digits only, no commas. Sheets often list each floor separately (main floor, 2nd floor, basement) alongside a combined total such as "Square FT/M"; use the stated total. Empty if no total is stated.' },
      style:          { type: 'string', description: 'Storey style as written, e.g. "Detached, 2 Storey", "Bungalow", "Split entry". Empty if not stated.' },
      bedrooms:       { type: 'string', description: 'Number of bedrooms, digits only. Empty if not stated.' },
      bathrooms:      { type: 'string', description: 'Total bathrooms as a decimal count, e.g. "2.5". Sheets commonly print full and half baths separately as "2 \\ 1" or "2/1", meaning 2 full and 1 half: convert that to "2.5". Never return the raw "2 \\ 1" form. Empty if not stated.' },
      recent_updates: { type: 'string', description: 'Recent updates or replacements with their years, as a short comma separated list, e.g. "Roof shingles 2021, mini splits added". These are usually written in the prose property description rather than in a labelled field, so read the description for them. Only items the sheet actually states, and only genuine updates, not standard features. Empty if none.' },
      heating:        { type: 'string', description: 'Heat type as written, e.g. "Oil forced air", "Electric baseboard", "Mini split". Empty if not stated.' },
      garage:         { type: 'string', description: 'Garage or parking as written, e.g. "Attached single garage", "Detached double". Empty if not stated.' },
      lot:            { type: 'string', description: 'Lot description as written, e.g. "Fully fenced", "0.5 acre". Empty if not stated.' },
      taxes_annual:   { type: 'string', description: 'Annual property taxes, digits only. Empty if not stated.' },
      condo_fee:      { type: 'string', description: 'Monthly condo or strata fee, digits only. Empty if there is none.' },
    },
    required: ['document_type','document_description',
               'property_address','mls_number','list_price','property_type','sellers_direction',
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
        'decimals. Dates are YYYY-MM-DD and times are HH:MM on a 24 hour clock. ' +
        'Before anything else, decide whether this document really is a listing sheet. If it is ' +
        'not, set document_type to other, say plainly in document_description what it appears to ' +
        'be, and leave every other field empty. Do not try to salvage listing fields out of a ' +
        'document that is not a listing sheet.';

      const source = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image',    source: { type: 'base64', media_type: file.type,         data: b64 } };

      const { data, error } = await db.functions.invoke('claude-chat', {
        body: {
          system,
          model: MLSDrop.MODEL,
          // Thinking is ON BY DEFAULT on claude-opus-5, and max_tokens caps
          // thinking and the answer together. At 2000 a long sheet can spend
          // the budget reasoning and return JSON cut off mid-object, which
          // looks exactly like a bad read. Give it room, and keep the thinking
          // short with low effort: reading labelled fields off a page is
          // recognition, not reasoning.
          max_tokens: 6000,
          output_config: {
            effort: 'low',
            format: { type: 'json_schema', schema: MLSDrop.SCHEMA },
          },
          messages: [{
            role: 'user',
            content: [source, { type: 'text', text: 'Extract the listing facts from this MLS sheet.' }],
          }],
        },
      });

      if (error) throw new Error(await MLSDrop.edgeError(error));
      if (data?.error) throw new Error(data.error);
      const parsed = MLSDrop.parse(data?.text);
      if (!parsed) throw new Error('The reader did not return readable fields.');

      // ── The wrong document is a different answer from a bad read ─────────
      // Nothing is filled and the file is not kept, so a receipt dropped by
      // mistake cannot end up attached to a booking. The message names what
      // the file looks like, because "unsupported" sends people back to the
      // same file twice.
      if (parsed.document_type !== 'mls_listing_sheet') {
        const what = String(parsed.document_description || '').trim();
        MLSDrop._file = null;
        MLSDrop._read = false;
        MLSDrop.note(
          `⚠️ That is not an MLS listing sheet${what ? `. It looks like ${MLSDrop.esc(what)}` : ''}. ` +
          `Nothing has been filled in. Drop the listing sheet for the property instead, or fill the form in by hand below.`,
          'warn');
        return;
      }

      // Claimed to be a sheet but carried no address. There is nothing to book
      // against, so treat it the same way: say so, fill nothing.
      if (!String(parsed.property_address || '').trim()) {
        MLSDrop._file = null;
        MLSDrop._read = false;
        MLSDrop.note(
          `⚠️ That looks like a listing sheet, but no property address could be read off it. ` +
          `If it is a photo, try a straighter and better lit one, or fill the form in by hand below.`,
          'warn');
        return;
      }

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

  // supabase-js collapses EVERY non-2xx from an edge function into the same
  // sentence: "Edge Function returned a non-2xx status code". That sentence
  // cannot be acted on. The real reason is in the response body, which is
  // exactly where claude-chat puts it (no API key on the server, rate limit,
  // whatever Anthropic said), so read it back out and say that instead.
  async edgeError(error) {
    const res = error?.context;
    const status = res?.status ?? error?.status;
    // Always put the raw object in the console. Whatever the shapes turn out
    // to be in the wild, there is then something to read.
    console.warn('[MLSDrop] edge function failed', { status, error, context: res });

    // The body carries claude-chat's own message. Read it defensively: it may
    // be JSON, it may be plain text, and the stream may already be consumed,
    // so try every route rather than assuming one.
    // Read the body ONCE, as text, from a clone. Reading it twice disturbs the
    // stream and every later attempt then fails, which is how the first version
    // of this lost a perfectly readable message.
    let raw = null;
    if (res) {
      try { raw = await res.clone().text(); }
      catch (e) { try { raw = await res.text(); } catch (e2) { /* genuinely gone */ } }
    }
    if (raw && raw.trim()) {
      let detail;
      try {
        const parsed = JSON.parse(raw);
        detail = String(parsed.error || parsed.message || '').trim();
      } catch (e) {
        detail = raw.trim().slice(0, 300);   // not JSON, show what there is
      }
      if (detail) return status ? `${detail} (status ${status})` : detail;
    }

    // No readable body. The status code alone still says a lot.
    if (status === 401 || status === 403) return 'Your DealFlow session has expired. Sign out, sign back in, and drop the sheet again.';
    if (status === 429) return 'The reader has hit its limit for this hour. It resets at the top of the next hour.';
    if (status === 404) return 'The claude-chat function is not deployed to Supabase.';
    if (status === 413) return 'That file is too large for the reader. Try a smaller PDF or a lower resolution photo.';
    if (status === 500) return 'The reader is not configured on the server. Check that ANTHROPIC_API_KEY is set in the Supabase edge function secrets.';
    if (status === 502) return 'The server reached Anthropic and Anthropic refused the request. Open the browser console for the exact reason, and check the claude-chat function logs in Supabase.';
    if (status) return `The reader failed with status ${status}. The browser console has the details.`;
    return error?.message || 'Reader unavailable';
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
