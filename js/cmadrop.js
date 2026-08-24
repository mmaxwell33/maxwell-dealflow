// Maxwell DealFlow CRM — CMA intake and the letter that comes out of it
//
// A CMA is a grid of comparables written for an agent. The client gets it as
// an attachment they mostly do not open. What they want to know is what homes
// like this one have been going for lately, and what that means for their
// number. This reads the CMA Maxwell supplies, pulls out what sold in the last
// three months, and writes that in plain sentences with the original attached.
//
// SAME MACHINE AS THE MLS READER. claude-chat, a fixed JSON schema, a
// wrong-document gate, and the rule that extraction fills a form which Maxwell
// confirms. Nothing is sent from here: the letter goes to approval_queue like
// every other email the app produces, and he approves it there.
//
// TWO GATES, DELIBERATELY. This one puts sold prices in a client's inbox under
// his name, which is a longer fall than a mis-read booking form. So the figures
// are shown as fields to check BEFORE the letter is drafted, and the letter is
// then held in Approvals before it goes. Do not add auto-approve to this one.
//
// NOTHING IS SOURCED HERE. Every figure comes off the document he supplied. The
// reader does not know the market and is told repeatedly not to pretend it does.
//
// Requires migrations 096, 098 and 099.

const CMADrop = {
  MAX_MB: 20,
  MODEL: 'claude-opus-5',
  IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  _busy: false,
  _file: null,
  _read: null,      // the parsed extraction
  _side: 'buyer',
  _clientId: '',
  _viewingId: '',

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  money(n) {
    const v = Number(String(n ?? '').replace(/[^0-9.]/g, ''));
    return isFinite(v) && v ? '$' + Math.round(v).toLocaleString('en-CA') : '';
  },

  SCHEMA: {
    type: 'object',
    properties: {
      // The gate, asked first, same reason as the MLS reader: a wrong document
      // that returns empty fields reads like a bad scan of the right one.
      document_type: { type: 'string', enum: ['cma_or_sold_report', 'other'],
        description: 'cma_or_sold_report ONLY if this document is a comparative market analysis, a sold-comparables report, or a market/sales report listing specific properties that have SOLD, each with a sold price. other for anything else at all: a single listing sheet for one property currently for sale, a purchase offer, a receipt, an invoice, an inspection report, a photo, or a page too unclear to read.' },
      document_description: { type: 'string',
        description: 'When document_type is other, a short plain description of what it appears to be, lower case, no trailing period, e.g. "a listing sheet for one property", "a home inspection report". Empty otherwise.' },

      subject_address: { type: 'string', description: 'The subject property the analysis is about, if the document names one. Empty if it does not. Do not guess it from the comparables.' },

      // The sales. This is the whole point of the document.
      comparables: {
        type: 'array',
        description: 'Every property in the document that has SOLD, one entry each. Properties merely listed or pending are NOT sales and must be left out. Empty array if the document names no completed sales.',
        items: {
          type: 'object',
          properties: {
            address:        { type: 'string', description: 'Civic address as written.' },
            sold_price:     { type: 'string', description: 'Final sold price, digits only, no currency symbol or commas. Not the asking price. Empty if the document gives no sold price.' },
            sold_date:      { type: 'string', description: 'Date it sold, as YYYY-MM-DD. Empty if not stated.' },
            days_on_market: { type: 'string', description: 'Days on market, digits only. Empty if not stated.' },
            note:           { type: 'string', description: 'At most one short clause on what distinguishes this home, only if the document states it, e.g. "finished basement", "no garage", "newer roof". Empty if the document says nothing distinguishing. Never invent one.' },
          },
          required: ['address','sold_price','sold_date','days_on_market','note'],
          additionalProperties: false,
        },
      },
    },
    required: ['document_type','document_description','subject_address','comparables'],
    additionalProperties: false,
  },

  // ── Opening the form ──────────────────────────────────────────────────────
  open(clientId = '') {
    CMADrop.reset();
    CMADrop._clientId = clientId || '';
    const clientOptions = (typeof Clients !== 'undefined' ? Clients.all : [])
      .map(c => `<option value="${c.id}" ${c.id === clientId ? 'selected' : ''}>${App.esc(c.full_name)}</option>`).join('');
    App.openModal(`
      <div class="modal-title">📊 Send a CMA</div>
      <div class="form-group">
        <label class="form-label">Client *</label>
        <select class="form-input form-select" id="cma-client" onchange="CMADrop.onClient()">
          <option value="">-- Select Client --</option>
          ${clientOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Which property</label>
        <select class="form-input form-select" id="cma-property" onchange="CMADrop.onProperty()">
          <option value="">-- Pick a client first --</option>
        </select>
        <div id="cma-known"></div>
      </div>
      <div class="form-group">
        <label class="form-label">This is for *</label>
        <div style="display:inline-flex;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:4px;gap:4px;">
          <button type="button" class="cl-chip" id="cma-side-buyer"  aria-pressed="true"  onclick="CMADrop.setSide('buyer')">🔑 A buyer</button>
          <button type="button" class="cl-chip" id="cma-side-seller" aria-pressed="false" onclick="CMADrop.setSide('seller')">🏷️ A seller</button>
        </div>
        <div id="cma-side-hint" style="font-size:11.5px;color:var(--text2);margin-top:6px;line-height:1.5;">
          Same sales either way. A buyer gets a suggested opening range, a seller a suggested listing range.
        </div>
      </div>
      ${CMADrop.zone()}
      <div id="cma-body"></div>
    `);
    if (clientId) CMADrop.onClient();
  },

  zone() {
    return `
      <div id="cma-zone"
           ondragover="event.preventDefault();this.style.borderColor='var(--accent2)';this.style.background='rgba(110,140,192,0.10)';"
           ondragleave="this.style.borderColor='var(--border)';this.style.background='rgba(110,140,192,0.04)';"
           ondrop="CMADrop.onDrop(event)"
           style="border:1.5px dashed var(--border);border-radius:11px;padding:16px 14px;text-align:center;margin-bottom:14px;background:rgba(110,140,192,0.04);transition:border-color 120ms,background 120ms;">
        <div style="font-size:12.5px;color:var(--text2);line-height:1.5;">
          📄 <strong style="color:var(--text1);">Drop the CMA here</strong><br>
          <span style="font-size:11.5px;">PDF, JPG or PNG. It reads what has sold recently and writes it up against the property above.</span>
        </div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:11px;flex-wrap:wrap;">
          <button type="button" class="btn2 btn2-sm" onclick="event.stopPropagation();document.getElementById('cma-file').click()"
                  style="background:var(--accent);color:#0A0E14;font-weight:700;">📎 Choose a file</button>
          <button type="button" class="btn2 btn2-ghost btn2-sm" onclick="event.stopPropagation();document.getElementById('cma-photo').click()"
                  style="border:1px solid var(--border);">📷 Take a photo</button>
        </div>
        <input type="file" id="cma-file"  accept="application/pdf,image/*" style="display:none;" onchange="CMADrop.onPick(event)">
        <input type="file" id="cma-photo" accept="image/*" capture="environment" style="display:none;" onchange="CMADrop.onPick(event)">
      </div>
      <div id="cma-msg"></div>`;
  },

  setSide(side) {
    CMADrop._side = (side === 'seller') ? 'seller' : 'buyer';
    const b = document.getElementById('cma-side-buyer'), s = document.getElementById('cma-side-seller');
    if (b) b.setAttribute('aria-pressed', CMADrop._side === 'buyer'  ? 'true' : 'false');
    if (s) s.setAttribute('aria-pressed', CMADrop._side === 'seller' ? 'true' : 'false');
    // The letter already drafted was written for the other side, so rewrite it.
    if (CMADrop._read) CMADrop.draft();
  },

  // ── Which property ────────────────────────────────────────────────────────
  // The list is what this client has actually viewed, because the viewing
  // already holds the address, the MLS number, the price and the facts read off
  // the sheet. Typing any of that again would be re-keying data we have.
  onClient() {
    const id = document.getElementById('cma-client')?.value || '';
    CMADrop._clientId = id;
    CMADrop._viewingId = '';
    const sel = document.getElementById('cma-property');
    if (!sel) return;
    const seen = (typeof Viewings !== 'undefined' ? Viewings.all : [])
      .filter(v => v.client_id === id && v.property_address)
      .sort((a, b) => new Date(b.viewing_date || 0) - new Date(a.viewing_date || 0));
    sel.innerHTML =
      `<option value="">-- Pick a property --</option>` +
      seen.map(v => `<option value="${v.id}">${App.esc(v.property_address)}${v.viewing_date ? ' · viewed ' + App.esc(App.fmtDate(v.viewing_date)) : ''}${v.list_price ? ' · ' + CMADrop.money(v.list_price) : ''}</option>`).join('') +
      // A seller listing their own home never viewed it. Locking the feature
      // behind a viewing would rule out listing presentations entirely.
      `<option value="__typed">Another property, type it in</option>`;
    CMADrop.onProperty();
  },

  onProperty() {
    const sel = document.getElementById('cma-property');
    const box = document.getElementById('cma-known');
    if (!sel || !box) return;
    const val = sel.value;
    CMADrop._viewingId = (val && val !== '__typed') ? val : '';
    if (val === '__typed') {
      box.innerHTML = `<input class="form-input" id="cma-typed-address" placeholder="12 Cheeseman Drive, St. John's NL" style="margin-top:8px;">`;
      return;
    }
    const v = CMADrop.viewing();
    if (!v) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;margin-top:8px;">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--success);margin-bottom:7px;">Already on file for this one</div>
        <div style="font-size:12.5px;color:var(--text2);line-height:1.7;">
          ${v.mls_number ? `<strong style="color:var(--text1);">MLS#</strong> ${App.esc(v.mls_number)} &nbsp;` : ''}
          ${v.list_price ? `<strong style="color:var(--text1);">Asking</strong> ${CMADrop.money(v.list_price)}` : ''}
          ${v.sellers_direction ? `<br><strong style="color:var(--text1);">Seller's direction</strong> ${App.esc(v.sellers_direction)}` : ''}
          ${v.property_highlights ? `<br><span style="font-style:italic;">${App.esc(v.property_highlights)}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.5;">
          Read off the MLS sheet when you booked the viewing. The letter compares the sold homes against this.
        </div>
      </div>`;
  },

  viewing() {
    if (!CMADrop._viewingId || typeof Viewings === 'undefined') return null;
    return Viewings.all.find(v => v.id === CMADrop._viewingId) || null;
  },

  subjectAddress() {
    const v = CMADrop.viewing();
    if (v) return v.property_address || '';
    return document.getElementById('cma-typed-address')?.value.trim() || '';
  },

  // ── Reading the document ──────────────────────────────────────────────────
  onDrop(ev) {
    ev.preventDefault();
    const z = document.getElementById('cma-zone');
    if (z) { z.style.borderColor = 'var(--border)'; z.style.background = 'rgba(110,140,192,0.04)'; }
    CMADrop.intake(Array.from(ev.dataTransfer?.files || []));
  },
  onPick(ev) { CMADrop.intake(Array.from(ev.target?.files || [])); ev.target.value = ''; },

  intake(files) {
    const f = files[0];
    if (!f) return;
    if (!CMADrop._clientId)      { CMADrop.note('Pick the client first, so the letter knows who it is addressed to.', 'warn'); return; }
    if (!CMADrop.subjectAddress()) { CMADrop.note('Pick the property first, or type an address, so the sales have something to be compared against.', 'warn'); return; }
    const isPdf   = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
    const isImage = CMADrop.IMAGE_TYPES.includes(f.type);
    if (!isPdf && !isImage) {
      const heic = /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
      CMADrop.note(heic
        ? `${CMADrop.esc(f.name)} is a HEIC photo, which the reader cannot open. Export it as JPEG, or use the camera button.`
        : `${CMADrop.esc(f.name)} is not a PDF or a photo.`, 'warn');
      return;
    }
    if (f.size > CMADrop.MAX_MB * 1024 * 1024) { CMADrop.note(`${CMADrop.esc(f.name)} is over ${CMADrop.MAX_MB}MB, too large to read.`, 'warn'); return; }
    CMADrop.read(f, isPdf);
  },

  async read(file, isPdf) {
    if (CMADrop._busy) return;
    CMADrop._busy = true;
    CMADrop.note(`<span class="spinner" style="display:inline-block;vertical-align:-3px;margin-right:8px;"></span>Reading ${CMADrop.esc(file.name)}. Pulling out what has sold and when.`, 'busy');
    try {
      const b64 = await CMADrop.toBase64(file);
      const system =
        'You read comparative market analyses and sold-property reports, and return the completed SALES as JSON. ' +
        'Read only what the document says. A property that is merely listed, pending or conditionally sold is NOT ' +
        'a sale and must be left out; only include properties with a final sold price. If a field is not stated, ' +
        'return an empty string for it. Never guess a price, a date or a number of days on market, and never carry ' +
        'a figure from one property to another. Prices are digits only with no currency symbol, commas or decimals. ' +
        'Dates are YYYY-MM-DD. You do not know this market and must not add sales, context or opinion of your own: ' +
        'everything you return has to be on the page in front of you. ' +
        'Before anything else, decide whether this really is a market analysis or sold report. If it is not, set ' +
        'document_type to other, say what it appears to be, and return no comparables.';
      const source = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image',    source: { type: 'base64', media_type: file.type,         data: b64 } };

      const { data, error } = await db.functions.invoke('claude-chat', {
        body: {
          system, model: CMADrop.MODEL, max_tokens: 8000,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: CMADrop.SCHEMA } },
          messages: [{ role: 'user', content: [source, { type: 'text', text: 'Extract every completed sale from this analysis.' }] }],
        },
      });
      if (error) throw new Error(await CMADrop.edgeError(error));
      if (data?.error) throw new Error(data.error);
      const parsed = CMADrop.parse(data?.text);
      if (!parsed) throw new Error('The reader did not return readable figures.');

      if (parsed.document_type !== 'cma_or_sold_report') {
        const what = String(parsed.document_description || '').trim();
        CMADrop._file = null; CMADrop._read = null;
        CMADrop.note(`⚠️ That is not a market analysis${what ? `. It looks like ${CMADrop.esc(what)}` : ''}. Nothing has been drafted. Drop the CMA or sold report instead.`, 'warn');
        return;
      }
      const sales = (parsed.comparables || []).filter(c => String(c.sold_price || '').replace(/[^0-9]/g, ''));
      if (!sales.length) {
        CMADrop._file = null; CMADrop._read = null;
        CMADrop.note('⚠️ No completed sales could be read off that document. Homes that are listed or pending are not sales, so there is nothing to compare against.', 'warn');
        return;
      }
      parsed.comparables = sales;
      CMADrop._file = file;
      CMADrop._read = parsed;
      CMADrop.draft();
    } catch (e) {
      console.warn('[CMADrop] read failed:', e?.message || e);
      CMADrop._file = null; CMADrop._read = null;
      CMADrop.note(`⚠️ ${CMADrop.esc(e?.message || 'Could not read that document')}.`, 'warn');
    } finally {
      CMADrop._busy = false;
    }
  },

  // ── The window ────────────────────────────────────────────────────────────
  // Three months is what Maxwell asked for, because it is what tells a client
  // how the street is behaving NOW. A quiet street can produce one sale in
  // three months, so it widens to six rather than hand over a letter with one
  // comparable in it, and the letter says it widened.
  windowed(sales) {
    const now = Date.now();
    const monthsAgo = m => now - m * 30.44 * 86400000;
    const dated = sales.map(s => ({ ...s, _t: s.sold_date ? new Date(s.sold_date + 'T12:00:00').getTime() : NaN }));
    const within = m => dated.filter(s => !isNaN(s._t) && s._t >= monthsAgo(m));
    const three = within(3);
    if (three.length >= 3 || dated.every(s => isNaN(s._t))) {
      return { list: (three.length ? three : dated), months: 3, widened: false };
    }
    const six = within(6);
    if (six.length > three.length) return { list: six, months: 6, widened: true };
    return { list: three.length ? three : dated, months: 3, widened: false };
  },

  // ── Drafting ──────────────────────────────────────────────────────────────
  // Assembled here, not written by the model, for the same reason as the MLS
  // note but with more at stake: every number in this letter came off the
  // document, and a sentence generated around those numbers is a sentence
  // nobody checked. Fixed shape, fixed order, editable before it queues.
  draft() {
    const x = CMADrop._read;
    if (!x) return;
    const v = CMADrop.viewing();
    const addr = CMADrop.subjectAddress();
    const w = CMADrop.windowed(x.comparables);
    const sorted = [...w.list].sort((a, b) => (Number(b.sold_price) || 0) - (Number(a.sold_price) || 0));
    const prices = sorted.map(s => Number(String(s.sold_price).replace(/[^0-9]/g, ''))).filter(Boolean);
    const low = Math.min(...prices), high = Math.max(...prices);

    const lines = sorted.map(s => {
      const bits = [`${s.address} sold for ${CMADrop.money(s.sold_price)}`];
      if (s.sold_date) bits.push(`on ${App.fmtDate(s.sold_date)}`);
      let line = bits.join(' ');
      if (s.days_on_market) line += `, in ${s.days_on_market} days`;
      line += '.';
      if (s.note) line += ` ${s.note.charAt(0).toUpperCase() + s.note.slice(1).replace(/\.$/, '')}.`;
      return line;
    });

    const n = sorted.length;
    const opening = CMADrop._side === 'buyer'
      ? `Before you settle on a number for ${addr}, here is what has actually been selling nearby. I have attached the full analysis.`
      : `Before we settle on a listing price for ${addr}, here is what has actually been selling nearby. I have attached the full analysis.`;

    const windowLine = w.widened
      ? `Only ${w.list.length === 1 ? 'one home' : w.list.length + ' homes'} sold close by in the last three months, so I have gone back six to give you more to compare against. Each sale below carries its date.`
      : `${n === 1 ? 'One home' : n + ' homes'} close by in size and age sold in the last three months:`;

    const rangeLine = prices.length > 1
      ? `So homes like this have been trading between ${CMADrop.money(low)} and ${CMADrop.money(high)}.`
      : `That is the only recent sale close enough to compare against, so treat it as a single data point rather than a pattern.`;

    // The subject's own facts, when a viewing gave us them, are what make this
    // a comparison rather than a list.
    const subjectLine = v && (v.list_price || v.property_highlights)
      ? `For reference, ${addr}${v.list_price ? ` is asking ${CMADrop.money(v.list_price)}` : ''}.`
      : '';

    const closing = CMADrop._side === 'buyer'
      ? `Once you have had a look, tell me where you want to come in and I will put the numbers together.`
      : `Once you have had a look, we can settle on a number and get it ready to go.`;

    const letter = [
      opening, '',
      windowLine,
      ...lines.map(l => '- ' + l), '',
      rangeLine,
      subjectLine,
      '',
      closing,
    ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();

    CMADrop.note(`✅ Read from <strong>${CMADrop.esc(CMADrop._file?.name || 'the file')}</strong>. Check every figure against the document before you send. Nothing is queued until you do.`, 'ok');

    document.getElementById('cma-body').innerHTML = `
      <div class="form-group">
        <label class="form-label">Sold in the last ${w.months} months <span style="text-transform:none;letter-spacing:0;color:var(--accent2);">(${n})</span></label>
        <textarea class="form-input" id="cma-comps" rows="${Math.min(7, n + 1)}" style="border-color:var(--success);background:rgba(22,163,74,.07);font-family:ui-monospace,Menlo,monospace;font-size:12px;">${sorted.map(s =>
          `${s.address} | ${CMADrop.money(s.sold_price)} | ${s.sold_date || 'no date'} | ${s.days_on_market || '?'} days`).join('\n')}</textarea>
        <div style="font-size:11.5px;color:var(--text2);margin-top:5px;line-height:1.5;">
          ${w.widened ? '⚠️ Fewer than three sales fell in the last 3 months, so the window was widened to 6 and the letter says so.' : 'Check these against the document. This is the part a client will act on.'}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">They sold between</label>
          <input class="form-input" value="${CMADrop.money(low)} to ${CMADrop.money(high)}" readonly style="border-color:var(--success);background:rgba(22,163,74,.07);">
        </div>
        <div class="form-group">
          <label class="form-label">${CMADrop._side === 'buyer' ? 'Suggested opening' : 'Suggested listing'} range</label>
          <input class="form-input" id="cma-sug-low"  type="number" placeholder="low"  value="">
        </div>
        <div class="form-group">
          <label class="form-label">&nbsp;</label>
          <input class="form-input" id="cma-sug-high" type="number" placeholder="high" value="">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">What the client will read <span style="text-transform:none;letter-spacing:0;color:var(--accent2);">(editable)</span></label>
        <textarea class="form-input" id="cma-letter" rows="12" style="line-height:1.6;">${App.esc(letter)}</textarea>
        <div style="font-size:11.5px;color:var(--text2);margin-top:5px;line-height:1.5;">
          Add your range and your recommendation in your own words. The sales above are facts off the document; the advice is yours.
        </div>
      </div>
      <button class="btn2 btn2-primary" style="width:100%;justify-content:center;" onclick="CMADrop.queue()">Send to Approvals</button>
      <div style="font-size:11.5px;color:var(--text3);margin-top:8px;line-height:1.5;text-align:center;">
        Nothing is emailed from here. It waits in Approvals for you to read it again.
      </div>`;
  },

  // ── Queue it ──────────────────────────────────────────────────────────────
  async queue() {
    if (CMADrop._busy) return;
    const client = (typeof Clients !== 'undefined' ? Clients.all : []).find(c => c.id === CMADrop._clientId);
    if (!client)       { CMADrop.note('Pick a client first.', 'warn'); return; }
    if (!client.email) { CMADrop.note(`${App.esc(client.full_name)} has no email address on file, so there is nowhere to send this.`, 'warn'); return; }
    const letter = document.getElementById('cma-letter')?.value.trim();
    if (!letter)       { CMADrop.note('The letter is empty.', 'warn'); return; }

    CMADrop._busy = true;
    CMADrop.note('<span class="spinner" style="display:inline-block;vertical-align:-3px;margin-right:8px;"></span>Filing it and queuing the email…', 'busy');
    try {
      const x = CMADrop._read || {};
      const addr = CMADrop.subjectAddress();
      const v = CMADrop.viewing();
      const w = CMADrop.windowed(x.comparables || []);
      const prices = w.list.map(s => Number(String(s.sold_price).replace(/[^0-9]/g, ''))).filter(Boolean);
      const b64 = CMADrop._file ? await CMADrop.toBase64(CMADrop._file) : null;

      // The row first, so the analysis survives even if the email fails.
      const row = {
        agent_id: currentAgent.id,
        client_id: CMADrop._clientId,
        viewing_id: CMADrop._viewingId || null,
        side: CMADrop._side,
        property_address: addr,
        mls_number: v?.mls_number || null,
        list_price: v?.list_price || null,
        comparables: w.list.map(s => ({
          address: s.address, sold_price: s.sold_price, sold_date: s.sold_date,
          days_on_market: s.days_on_market, note: s.note,
        })),
        window_months: w.months,
        window_widened: w.widened,
        sold_low: prices.length ? Math.min(...prices) : null,
        sold_high: prices.length ? Math.max(...prices) : null,
        suggested_low:  parseFloat(document.getElementById('cma-sug-low')?.value)  || null,
        suggested_high: parseFloat(document.getElementById('cma-sug-high')?.value) || null,
        letter,
        doc_name: CMADrop._file?.name || null,
        extracted_at: new Date().toISOString(),
        extraction_model: CMADrop.MODEL,
      };
      const { data: saved, error: rowErr } = await db.from('cmas').insert(row).select('id').single();
      if (rowErr) console.warn('[CMADrop] could not file the analysis:', rowErr.message);

      // Then the email, with the original attached.
      if (typeof Notify !== 'undefined') {
        const tmpl = Notify.templates.cma_letter(client, { property_address: addr, letter, side: CMADrop._side }, currentAgent);
        await Notify.queue(
          'Market Analysis',
          client.id, client.full_name, client.email,
          tmpl.subject, tmpl.body, saved?.id || null,
          tmpl.html, null, null,
          b64 ? [{ filename: CMADrop._file.name, mime_type: CMADrop._file.type || 'application/pdf', data: b64 }] : null
        );
      }
      await App.logActivity('CMA_SENT', client.full_name, client.email, `Market analysis queued for ${addr}`, client.id);
      App.closeModal();
      App.toast('✅ Market analysis queued in Approvals');
      if (typeof Approvals !== 'undefined' && Approvals.load) Approvals.load();
    } catch (e) {
      console.warn('[CMADrop] queue failed:', e?.message || e);
      CMADrop.note(`⚠️ ${CMADrop.esc(e?.message || 'Could not queue that')}.`, 'warn');
    } finally {
      CMADrop._busy = false;
    }
  },

  // ── Plumbing shared with the MLS reader ───────────────────────────────────
  toBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error || new Error('Could not open the file'));
      r.readAsDataURL(file);
    });
  },

  parse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) {}
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    return null;
  },

  async edgeError(error) {
    const res = error?.context;
    const status = res?.status ?? error?.status;
    console.warn('[CMADrop] edge function failed', { status, error });
    let raw = null;
    if (res) { try { raw = await res.clone().text(); } catch (e) { try { raw = await res.text(); } catch (e2) {} } }
    if (raw && raw.trim()) {
      let detail;
      try { const p = JSON.parse(raw); detail = String(p.error || p.message || '').trim(); }
      catch (e) { detail = raw.trim().slice(0, 300); }
      if (detail) return status ? `${detail} (status ${status})` : detail;
    }
    if (status === 401 || status === 403) return 'Your DealFlow session has expired. Sign out, sign back in, and try again.';
    if (status === 429) return 'The reader has hit its limit for this hour.';
    if (status === 500) return 'The reader is not configured on the server. Check ANTHROPIC_API_KEY in the Supabase secrets.';
    if (status) return `The reader failed with status ${status}. The browser console has the details.`;
    return error?.message || 'Reader unavailable';
  },

  note(html, kind) {
    const box = document.getElementById('cma-msg');
    if (!box) return;
    const style = kind === 'ok'
      ? 'background:var(--success-soft);border:1px solid var(--success);'
      : kind === 'warn'
        ? 'background:rgba(176,141,87,0.12);border:1px solid var(--yellow);'
        : 'background:var(--surface-2);border:1px solid var(--border);';
    box.innerHTML = `<div style="${style}border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12.5px;line-height:1.5;color:var(--text1);">${html}</div>`;
  },

  reset() {
    CMADrop._busy = false;
    CMADrop._file = null;
    CMADrop._read = null;
    CMADrop._side = 'buyer';
    CMADrop._clientId = '';
    CMADrop._viewingId = '';
  },
};
