// ─────────────────────────────────────────────────────────────────────────
// marketing.js — Deal-post generator (board-approved, brand-board session).
//
// Turns a closed/accepted deal into a branded 1080x1080 Instagram graphic +
// a short, human caption, then lets Maxwell download / copy / share it. It
// NEVER auto-publishes and there is NO "post to Instagram" button — Instagram
// does not allow programmatic posting from a personal account, so the honest
// flow is: generate -> preview/edit -> download image + copy caption -> he posts.
//
// The card layout copies Maxwell's real Instagram posts:
//   • thin navy top band: ACCEPTED OFFER / JUST SOLD in light, widely spaced
//     capitals, with a thin blue rule under it
//   • listing photo (he uploads it) filling the middle edge to edge
//   • white strip: the place (e.g. "Southlands") in a large serif, with a small
//     spaced subline "NEW CONSTRUCTION · ST. JOHN'S, NL" (or EXISTING HOME)
//   • navy footer: name + REALTOR®, phone | email, and eXp Realty +
//     ST. JOHN'S, NEWFOUNDLAND on the right
//
// Compliance guardrails (per Abena): consent gate before any action; NO sold
// price; area/neighbourhood only, never a civic number; eXp Realty + REALTOR®
// baked in (NL advertising law). Official eXp palette (navy + royal blue +
// white). Stateless — only an activity_log entry on generate.
// ─────────────────────────────────────────────────────────────────────────

const Marketing = {
  NAVY:  '#0C0F24',
  DEEP:  '#0A1628',
  BLUE:  '#19469D',
  BLUE2: '#4A74B4',
  WHITE: '#FAFAF7',
  GREY:  '#B7C0D8',
  WEB:   'maxwellmidodzi.com',
  // The public address on his posts (his login email can differ).
  EMAIL: 'maxwell.midodzi@exprealty.com',

  TEMPLATES: {
    sold:     { label: 'Just Sold',      status: 'JUST SOLD',      hint: 'A closed, completed deal.' },
    accepted: { label: 'Offer Accepted', status: 'ACCEPTED OFFER', hint: 'Under contract. Best posted once the deal is firm.' },
  },
  // Resale vs new construction changes the subline on the card and the caption.
  KINDS: {
    existing: { label: 'Existing home',    sub: 'EXISTING HOME' },
    new:      { label: 'New construction', sub: 'NEW CONSTRUCTION' },
  },

  // Background colour options for the top/bottom bands. Navy is the eXp default;
  // the others are tasteful dark alternatives. White text + white logo work on
  // all of them. `band` = the two bands, `deep` = the photo-fallback base,
  // `rule` = the accent rule + contact dots.
  THEMES: {
    navy:     { label: 'Navy',       band: '#0C0F24', deep: '#0A1628', rule: '#19469D' },
    black:    { label: 'Black',      band: '#000000', deep: '#050505', rule: '#19469D' },
    charcoal: { label: 'Charcoal',   band: '#1B2130', deep: '#141922', rule: '#4A74B4' },
    forest:   { label: 'Forest',     band: '#0F2A1E', deep: '#0A1F16', rule: '#2E7D53' },
    burgundy: { label: 'Burgundy',   band: '#2A0F16', deep: '#1E0A10', rule: '#9B2D3D' },
    royal:    { label: 'Royal Blue', band: '#10275E', deep: '#0A1A42', rule: '#4A74B4' },
  },

  current: 'sold',
  kind: 'existing',
  // 'branded' = the navy-band card (all contact details on the image).
  // 'clean'   = full-bleed photo with one soft panel: status, specs, and who you
  //             are. Far less busy; MLS/phone/email/website live in the caption.
  layout: 'branded',
  theme: 'navy',
  // Real font sizes in px (what the number box shows) and drag offsets in canvas
  // px, per zone. On the branded card 'specs' is the place name in the white
  // strip. The clean layout keeps its own original sizes.
  sizes:    { head: 34, specs: 64, name: 36 },
  offsets:  { head: { x: 0, y: 0 }, specs: { x: 0, y: 0 }, name: { x: 0, y: 0 }, panel: { x: 0, y: 0 } },
  DEFAULTS: { head: 34, specs: 64, name: 36 },
  CLEAN_DEFAULTS: { head: 90, specs: 30, name: 42 },
  DEF_WEIGHTS:       { head: 'slim', specs: 'slim', name: 'normal' },
  CLEAN_DEF_WEIGHTS: { head: 'bold', specs: 'bold', name: 'bold' },
  // Font families. Canvas can only use fonts already on the device, so these are
  // all system faces present on Mac/iOS, each with a serif + sans pairing.
  FONTS: {
    signature: { label: 'Signature', serif: 'Didot, "Bodoni 72", "Playfair Display", Georgia, serif', sans: '"Helvetica Neue", "Avenir Next", Arial, sans-serif' },
    classic:   { label: 'Classic',   serif: 'Georgia, "Times New Roman", serif',         sans: '-apple-system, system-ui, sans-serif' },
    elegant:   { label: 'Elegant',   serif: 'Didot, "Playfair Display", Georgia, serif', sans: 'Optima, Candara, sans-serif' },
    modern:    { label: 'Modern',    serif: '"Helvetica Neue", Arial, sans-serif',        sans: '"Helvetica Neue", Arial, sans-serif' },
    geometric: { label: 'Geometric', serif: 'Futura, "Avenir Next", sans-serif',          sans: '"Avenir Next", Futura, sans-serif' },
  },
  font: 'signature',
  // Per-zone weight: bold, normal, or slim.
  weights:  { head: 'slim', specs: 'slim', name: 'normal' },
  WEIGHT_IX: { bold: 0, normal: 1, slim: 2 },
  WEIGHTS:  { head: [700, 500, 300], specs: [700, 500, 400], name: [800, 600, 400] },
  // Each block drags only inside its own horizontal band (top band / photo /
  // footer). Without this, blocks could be piled on top of each other into an
  // unusable mess. [minY, maxY] on the 1080 card.
  BOUNDS:   { head: [0, 96], specs: [780, 896], name: [896, 1080], panel: [0, 1080] },
  sizeZone: 'head',            // which zone the number box + drag handles target
  captionStyle: 'warm',
  _hits: {},                   // zone -> {x,y,w,h} hit boxes recorded during _draw
  _drag: null,

  _theme() { return Marketing.THEMES[Marketing.theme] || Marketing.THEMES.navy; },

  openComposer(prefill = {}) {
    const m = document.getElementById('marketing-modal');
    if (!m) { alert('Marketing composer not found.'); return; }
    Marketing.current = prefill.template || 'sold';
    Marketing.kind = prefill.kind === 'new' ? 'new' : 'existing';
    // Which client's folder the finished post gets filed into (null when the
    // composer is opened standalone rather than from a deal).
    Marketing._clientId = prefill.clientId || null;
    Marketing._address  = prefill.address  || '';
    Marketing.theme = 'navy';
    Marketing.layout = 'branded';
    Marketing.sizes = { ...Marketing.DEFAULTS };
    Marketing.offsets = { head: { x: 0, y: 0 }, specs: { x: 0, y: 0 }, name: { x: 0, y: 0 }, panel: { x: 0, y: 0 } };
    Marketing.weights = { ...Marketing.DEF_WEIGHTS };
    Marketing.font = 'signature';
    Marketing._capIx = 0; Marketing._autoCap = '';
    Marketing.sizeZone = 'head';
    Marketing.captionStyle = 'warm';
    Marketing._photoDataUrl = null; Marketing._photoImg = null;
    m.querySelector('#mk-area').value  = prefill.area || '';
    m.querySelector('#mk-place').value = prefill.place || '';
    m.querySelector('#mk-sqft').value  = prefill.sqft || '';
    m.querySelector('#mk-beds').value  = prefill.beds || '';
    m.querySelector('#mk-baths').value = prefill.baths || '';
    m.querySelector('#mk-mls').value   = prefill.mls || '';
    m.querySelector('#mk-caption').value = '';
    m.querySelector('#mk-consent').checked = false;
    const fp = m.querySelector('#mk-photo'); if (fp) fp.value = '';
    Marketing._setTemplateUI();
    Marketing._setStyleUI();
    Marketing._syncConsent();
    m.style.display = 'flex';
    Marketing.render();
    // If this property is one of Maxwell's OWN listings, its real specs are on
    // file, so fill them in. Buyer-side deals have no stored specs, so those
    // stay blank and get typed by hand rather than guessed.
    Marketing._prefillSpecsFromListing(prefill.mls || '', prefill.address || '');
  },

  // Best-effort: never blocks the composer, never overwrites a typed value.
  async _prefillSpecsFromListing(mls, address) {
    if (!mls && !address) return;
    try {
      let q = db.from('listings').select('bedrooms, bathrooms, sqft, mls_number, property_address');
      q = mls ? q.eq('mls_number', mls) : q.ilike('property_address', `%${address}%`);
      const { data } = await q.limit(1);
      const L = (data || [])[0];
      if (!L) return;
      const m = document.getElementById('marketing-modal');
      if (!m || m.style.display === 'none') return;
      const put = (id, val) => {
        const el = m.querySelector('#' + id);
        if (el && !el.value && val) el.value = String(val).trim();
      };
      put('mk-sqft',  L.sqft);
      put('mk-beds',  L.bedrooms);
      put('mk-baths', L.bathrooms);
      Marketing.render();
    } catch (e) { /* no listing match, or table unavailable — type them manually */ }
  },

  close() {
    const m = document.getElementById('marketing-modal');
    if (m) m.style.display = 'none';
  },

  setTemplate(t) { Marketing.current = t; Marketing._setTemplateUI(); Marketing.render(); Marketing._refreshCaption(); },
  setKind(k)     { Marketing.kind = k;    Marketing._setTemplateUI(); Marketing.render(); Marketing._refreshCaption(); },

  _setTemplateUI() {
    document.querySelectorAll('#marketing-modal .mk-tab').forEach(b => b.classList.toggle('active', b.dataset.tpl === Marketing.current));
    document.querySelectorAll('#marketing-modal .mk-kind').forEach(b => b.classList.toggle('active', b.dataset.kind === Marketing.kind));
    const hint = document.getElementById('mk-tpl-hint');
    if (hint) hint.textContent = Marketing.TEMPLATES[Marketing.current].hint;
  },

  // Reflect the current background / text-size / caption-style choices on their
  // buttons. Colour swatches get a ring via inline style (they aren't .btns).
  _setStyleUI() {
    const m = document.getElementById('marketing-modal');
    if (!m) return;
    m.querySelectorAll('.mk-theme').forEach(b => {
      const on = b.dataset.theme === Marketing.theme;
      b.classList.toggle('active', on);
      b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
      b.style.boxShadow   = on ? '0 0 0 2px var(--accent)' : 'none';
    });
    m.querySelectorAll('.mk-layout').forEach(b => b.classList.toggle('active', b.dataset.layout === Marketing.layout));
    // The per-zone resize buttons only apply to the branded card; the clean
    // layout sizes its one panel from the same numbers.
    m.querySelectorAll('.mk-zone').forEach(b => b.classList.toggle('active', b.dataset.zone === Marketing.sizeZone));
    const box = m.querySelector('#mk-size-num');
    if (box) box.value = Marketing.sizes[Marketing.sizeZone];
    const curW = Marketing.weights[Marketing.sizeZone] || 'normal';
    m.querySelectorAll('.mk-weight').forEach(b => b.classList.toggle('active', b.dataset.weight === curW));
    m.querySelectorAll('.mk-font').forEach(b => b.classList.toggle('active', b.dataset.font === Marketing.font));
    m.querySelectorAll('.mk-capstyle').forEach(b => b.classList.toggle('active', b.dataset.style === Marketing.captionStyle));
  },

  setTheme(t)      { Marketing.theme = t; Marketing._setStyleUI(); Marketing.render(); },
  setSizeZone(z)   { Marketing.sizeZone = z; Marketing._setStyleUI(); Marketing.render(); },
  // Font size as a real number (px on the 1080x1080 card).
  setFontSize(px)  {
    const n = Math.max(10, Math.min(200, parseInt(px, 10) || Marketing.DEFAULTS[Marketing.sizeZone]));
    Marketing.sizes[Marketing.sizeZone] = n;
    Marketing._setStyleUI(); Marketing.render();
  },
  nudgeFontSize(d) { Marketing.setFontSize(Marketing.sizes[Marketing.sizeZone] + d); },
  setWeight(w) {
    Marketing.weights[Marketing.sizeZone] = w;
    Marketing._setStyleUI(); Marketing.render();
  },
  setFont(f) {
    Marketing.font = f;
    Marketing._setStyleUI(); Marketing.render();
  },
  // Show/hide the design controls so the composer stays calm until you edit.
  toggleEdit() {
    const p = document.getElementById('mk-edit-panel');
    const b = document.getElementById('mk-edit-btn');
    if (!p) return;
    const open = p.style.display === 'none' || !p.style.display;
    p.style.display = open ? 'flex' : 'none';
    if (b) { b.classList.toggle('active', open); b.textContent = open ? '\u2713 Done editing' : '\u270e Edit design'; }
  },
  setLayout(l) {
    Marketing.layout = l;
    // Positions, sizes and weights are layout-specific, so start from its defaults.
    Marketing.sizeZone = 'head';
    Marketing.resetLayout();
  },
  resetLayout() {
    const clean = Marketing.layout === 'clean';
    Marketing.sizes = { ...(clean ? Marketing.CLEAN_DEFAULTS : Marketing.DEFAULTS) };
    Marketing.offsets = { head: { x: 0, y: 0 }, specs: { x: 0, y: 0 }, name: { x: 0, y: 0 }, panel: { x: 0, y: 0 } };
    Marketing.weights = { ...(clean ? Marketing.CLEAN_DEF_WEIGHTS : Marketing.DEF_WEIGHTS) };
    Marketing._setStyleUI(); Marketing.render();
  },
  setCaptionStyle(s) { Marketing.captionStyle = s; Marketing._capIx = 0; Marketing._setStyleUI(); Marketing.genCaption(); },

  // Download/share need BOTH the client's consent and a listing photo — a post
  // with the empty navy fallback isn't something to publish. Copy caption stays
  // available (it's just text) once consent is given.
  _syncConsent() {
    const ok = !!document.getElementById('mk-consent')?.checked;
    const hasPhoto = !!Marketing._photoDataUrl;
    const set = (id, enabled) => {
      const b = document.getElementById(id);
      if (b) { b.disabled = !enabled; b.style.opacity = enabled ? '1' : '.45'; b.style.pointerEvents = enabled ? 'auto' : 'none'; }
    };
    set('mk-copy', ok);
    set('mk-download', ok && hasPhoto);
    set('mk-share',    ok && hasPhoto);
    const hint = document.getElementById('mk-photo-hint');
    if (hint) hint.style.display = (ok && !hasPhoto) ? 'block' : 'none';
  },

  onPhoto(input) {
    const f = input.files && input.files[0];
    if (!f) { Marketing._photoDataUrl = null; Marketing.render(); Marketing._syncConsent(); return; }
    const reader = new FileReader();
    reader.onload = e => {
      Marketing._photoDataUrl = e.target.result;
      Marketing.render();
      Marketing._syncConsent();   // a photo is required before download/share
    };
    reader.readAsDataURL(f);
  },

  _fields() {
    const m = document.getElementById('marketing-modal');
    const v = id => (m.querySelector('#' + id)?.value || '').trim();
    return { area: v('mk-area'), place: v('mk-place'), sqft: v('mk-sqft'), beds: v('mk-beds'), baths: v('mk-baths'), mls: v('mk-mls') };
  },

  // Build the 1080x1080 card. Layout matches Maxwell's real posts.
  _draw() {
    const f = Marketing._fields();
    const tpl = Marketing.TEMPLATES[Marketing.current];
    const agentName = (currentAgent?.full_name || 'Maxwell Midodzi').replace(/\s+/g, ' ').trim();
    const phone = currentAgent?.phone || '709-325-0545';
    const email = Marketing.EMAIL;

    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    const TOP = 96, BOT = 300, MIDy = TOP, MIDh = 1080 - TOP - BOT;
    const TH = Marketing._theme();          // chosen background theme
    const SZ = Marketing.sizes   || { ...Marketing.DEFAULTS };
    const OF = Object.assign({ head:{x:0,y:0}, specs:{x:0,y:0}, name:{x:0,y:0}, panel:{x:0,y:0} }, Marketing.offsets || {});
    // Chosen weight per zone (bold / normal / slim) and the chosen font pairing.
    const WG = Marketing.weights || Marketing.DEF_WEIGHTS;
    const wt = z => Marketing.WEIGHTS[z][Marketing.WEIGHT_IX[WG[z]] ?? 0];
    const FT = Marketing.FONTS[Marketing.font] || Marketing.FONTS.signature;
    // The clean layout uses one family throughout; the branded card pairs the
    // serif (place, name) with a light sans (status, sublines), like his posts.
    const SF = FT.serif;
    Marketing._hits = {};                   // rebuilt every draw for drag hit-testing

    ctx.fillStyle = TH.deep; ctx.fillRect(0, 0, 1080, 1080);

    // ── CLEAN LAYOUT ────────────────────────────────────────────────────────
    // Photo edge to edge, with a single soft panel carrying only what matters:
    // the status, the specs, and who you are. Everything else (MLS, phone,
    // email, website) belongs in the caption, which is what keeps this uncluttered.
    if (Marketing.layout === 'clean') {
      if (Marketing._photoImg && Marketing._photoDataUrl) {
        const img = Marketing._photoImg;
        const scale = Math.max(1080 / img.width, 1080 / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (1080 - w) / 2, (1080 - h) / 2, w, h);
      } else {
        const g = ctx.createLinearGradient(0, 0, 1080, 1080);
        g.addColorStop(0, TH.band); g.addColorStop(1, TH.deep);
        ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1080);
      }

      const specsLine = [
        f.sqft  ? f.sqft.replace(/,/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' SQF' : '',
        f.beds  ? f.beds  + ' BED'  : '',
        f.baths ? f.baths + ' BATH' : ''
      ].filter(Boolean).join('  ·  ');
      const titleStr = tpl.status.split('').join(' ');
      const brandStr = 'REALTOR® | eXp Realty';

      // Size the panel around its contents.
      let tFs = Math.round(SZ.head * 0.52); const sFs = Math.round(SZ.specs * 0.85), nFs = Math.round(SZ.name * 0.62);
      ctx.font = `${wt('head')} ${tFs}px ${SF}`;
      let maxW = ctx.measureText(titleStr).width;
      if (specsLine) { ctx.font = `${wt('specs')} ${sFs}px ${SF}`; maxW = Math.max(maxW, ctx.measureText(specsLine).width); }
      ctx.font = `${wt('name')} ${nFs}px ${SF}`;
      maxW = Math.max(maxW, ctx.measureText(agentName).width);

      const padX = 56, padY = 44;
      const pw = Math.min(1080 - 80, Math.max(560, maxW + padX * 2));
      // Never let the letterspaced status run past the panel edges.
      ctx.font = `${wt('head')} ${tFs}px ${SF}`;
      while (ctx.measureText(titleStr).width > pw - padX * 2 && tFs > 16) {
        tFs -= 1; ctx.font = `${wt('head')} ${tFs}px ${SF}`;
      }
      const ph = padY * 2 + tFs + (specsLine ? sFs + 26 : 0) + 34 + nFs + 26;
      const px = (1080 - pw) / 2 + OF.panel.x;
      const py = 1080 * 0.60 + OF.panel.y;

      ctx.fillStyle = 'rgba(250,250,247,.90)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 4); ctx.fill(); }
      else ctx.fillRect(px, py, pw, ph);

      let cy = py + padY + tFs;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `${wt('head')} ${tFs}px ${SF}`;
      ctx.fillText(titleStr, px + pw / 2, cy);
      if (specsLine) {
        cy += sFs + 26;
        ctx.fillStyle = '#4a4a4a';
        ctx.font = `${wt('specs')} ${sFs}px ${SF}`;
        ctx.fillText(specsLine, px + pw / 2, cy);
      }
      // Name + brokerage, right-aligned inside the panel.
      cy += 34 + nFs;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `${wt('name')} ${nFs}px ${SF}`;
      ctx.fillText(agentName, px + pw - padX, cy);
      ctx.fillStyle = TH.rule;
      ctx.font = `700 ${Math.round(nFs * 0.62)}px ${SF}`;
      ctx.fillText(brandStr, px + pw - padX, cy + Math.round(nFs * 0.82));
      ctx.textAlign = 'left';

      Marketing._hits.panel = { x: px, y: py, w: pw, h: ph };
      return canvas;
    }

    // ── BRANDED LAYOUT: copies Maxwell's own posts ──────────────────────────
    const STRIP = 116, sy0 = 1080 - BOT, fy = sy0 + STRIP;   // white strip, then footer
    const SANS = FT.sans;
    const RULE = Marketing.theme === 'navy' ? Marketing.BLUE2 : TH.rule;
    const kind = Marketing.KINDS[Marketing.kind] || Marketing.KINDS.existing;
    const area = f.area || "St. John's";
    const place = f.place || area;
    // Letter-spaced text drawn a character at a time, since canvas
    // letterSpacing is not in every Safari the app runs on.
    const trackW = (str, gap) => [...str].reduce((s, c) => s + ctx.measureText(c).width, 0) + gap * Math.max(0, [...str].length - 1);
    const track = (str, x, y, gap, align = 'left') => {
      const w = trackW(str, gap);
      let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      ctx.textAlign = 'left';
      [...str].forEach(c => { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + gap; });
      return w;
    };

    // middle: listing photo (cover), edge to edge
    if (Marketing._photoImg && Marketing._photoDataUrl) {
      const img = Marketing._photoImg;
      const scale = Math.max(1080 / img.width, MIDh / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.save(); ctx.beginPath(); ctx.rect(0, MIDy, 1080, MIDh); ctx.clip();
      ctx.drawImage(img, (1080 - w) / 2, MIDy + (MIDh - h) / 2, w, h);
      ctx.restore();
    } else {
      const g = ctx.createLinearGradient(0, MIDy, 1080, MIDy + MIDh);
      g.addColorStop(0, TH.band); g.addColorStop(1, TH.deep);
      ctx.fillStyle = g; ctx.fillRect(0, MIDy, 1080, MIDh);
      ctx.fillStyle = 'rgba(183,192,216,.55)';
      ctx.font = `300 26px ${SANS}`;
      track('ADD THE LISTING PHOTO', 540, MIDy + MIDh / 2 + 9, 6, 'center');
    }

    // ── LAYER 1: fixed chrome (bands, rules, eXp logo) ──────────────────────
    // Painted BEFORE the draggable text below: draw order is z-order on a
    // canvas, so a band filled after a block would bury it when dragged.
    ctx.fillStyle = TH.band;   ctx.fillRect(0, 0, 1080, TOP);         // top band
    ctx.fillStyle = RULE;      ctx.fillRect(0, TOP - 6, 1080, 6);     // rule under it
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, sy0, 1080, STRIP);     // place strip
    ctx.fillStyle = TH.band;   ctx.fillRect(0, fy, 1080, 1080 - fy);  // footer
    ctx.fillStyle = RULE;      ctx.fillRect(0, fy, 1080, 4);          // rule over it

    // right of footer: official eXp logo (flipped to white) + location
    const logo = Marketing._expLogo;
    ctx.fillStyle = Marketing.GREY;
    if (logo && logo.complete && logo.naturalWidth) {
      const lw = 170, lh = lw * (logo.naturalHeight / logo.naturalWidth);
      ctx.save();
      ctx.filter = 'invert(1)';   // solid-black logo -> white; transparent stays transparent
      ctx.drawImage(logo, 1022 - lw, fy + 34, lw, lh);
      ctx.restore();
      ctx.fillStyle = Marketing.GREY;
      ctx.font = `400 15px ${SANS}`;
      track("ST. JOHN'S, NEWFOUNDLAND", 1022, fy + 34 + lh + 30, 3, 'right');
    } else {
      ctx.fillStyle = Marketing.WHITE;
      ctx.font = `700 46px ${SANS}`; ctx.textAlign = 'right';
      ctx.fillText('eXp Realty', 1022, fy + 80);
      ctx.fillStyle = Marketing.GREY;
      ctx.font = `400 15px ${SANS}`;
      track("ST. JOHN'S, NEWFOUNDLAND", 1022, fy + 116, 3, 'right');
    }

    // optional specs, quietly on the right of the white strip
    const specs = [];
    if (f.beds)  specs.push(f.beds + ' BED');
    if (f.baths) specs.push(f.baths + ' BATH');
    if (f.sqft)  specs.push(f.sqft.replace(/,/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' SQ FT');
    let specsW = 0;
    if (specs.length) {
      ctx.fillStyle = '#5A6275';
      ctx.font = `400 16px ${SANS}`;
      specsW = track(specs.join('  ·  '), 1022, sy0 + STRIP / 2 + 6, 2.5, 'right');
    }

    // ── LAYER 2: the draggable text, always painted on top ──────────────────

    // status word: light, thin, widely spaced capitals
    ctx.fillStyle = Marketing.WHITE;
    let fs = SZ.head; ctx.font = `${wt('head')} ${fs}px ${SANS}`;
    while (trackW(tpl.status, fs * 0.5) > 960 && fs > 14) { fs -= 1; ctx.font = `${wt('head')} ${fs}px ${SANS}`; }
    const headX = 540 + OF.head.x, headY = (TOP - 6) / 2 + fs * 0.36 + OF.head.y;
    const headW = track(tpl.status, headX, headY, fs * 0.5, 'center');
    Marketing._hits.head = { x: headX - headW / 2, y: headY - fs * 0.8, w: headW, h: fs * 1.1 };

    // place name in a large serif, with the spaced subline under it
    const px = 58 + OF.specs.x, py = sy0 + 64 + OF.specs.y;
    const placeMax = (specs.length ? 1022 - specsW - 40 : 1022) - px;
    let pfs = SZ.specs; ctx.font = `${wt('specs')} ${pfs}px ${SF}`;
    while (ctx.measureText(place).width > placeMax && pfs > 18) { pfs -= 2; ctx.font = `${wt('specs')} ${pfs}px ${SF}`; }
    ctx.fillStyle = TH.band; ctx.textAlign = 'left';
    ctx.fillText(place, px, py);
    const placeW = ctx.measureText(place).width;
    // "NEW CONSTRUCTION · ST. JOHN'S, NL"; when the place IS the town, name the province instead
    const subline = `${kind.sub}  ·  ${place.toLowerCase() === area.toLowerCase() ? 'NEWFOUNDLAND AND LABRADOR' : area.toUpperCase() + ', NL'}`;
    ctx.fillStyle = '#5A6275';
    ctx.font = `400 15px ${SANS}`;
    const subW = track(subline, px, py + 32, 3);
    Marketing._hits.specs = { x: px, y: py - pfs * 0.78, w: Math.max(placeW, subW), h: pfs * 0.78 + 38 };

    // name + phone | email, moving together as the "Name" block
    const parts = agentName.split(' ');
    const nameStr = (parts.length > 2 ? parts[0] + ' ' + parts[parts.length - 1] : agentName) + ', REALTOR®';
    const nx = 58 + OF.name.x, ny = fy + 72 + OF.name.y;
    let nfs = SZ.name; ctx.font = `${wt('name')} ${nfs}px ${SF}`;
    while (ctx.measureText(nameStr).width > 680 && nfs > 18) { nfs -= 2; ctx.font = `${wt('name')} ${nfs}px ${SF}`; }
    ctx.fillStyle = Marketing.WHITE;
    ctx.fillText(nameStr, nx, ny);
    const nameW = ctx.measureText(nameStr).width;
    ctx.fillStyle = Marketing.GREY;
    ctx.font = `400 21px ${SANS}`;
    const contact = [phone, email].filter(Boolean).join('   |   ');
    ctx.fillText(contact, nx, ny + 46);
    const contactW = ctx.measureText(contact).width;
    Marketing._hits.name = { x: nx, y: ny - nfs * 0.8, w: Math.max(nameW, contactW), h: nfs * 0.8 + 56 };

    return canvas;
  },

  // Drag any text block straight on the preview. Pointer coords are converted
  // from CSS pixels to the card's 1080x1080 space so dragging tracks the cursor
  // exactly at any preview size.
  _bindDrag(canvas) {
    const toCard = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (1080 / r.width), y: (e.clientY - r.top) * (1080 / r.height) };
    };
    const zoneAt = (p) => {
      // Topmost-first so an overlapping block picks the one you'd expect.
      for (const z of ['specs', 'head', 'name']) {
        const h = Marketing._hits[z];
        if (h && p.x >= h.x - 10 && p.x <= h.x + h.w + 10 && p.y >= h.y - 8 && p.y <= h.y + h.h + 8) return z;
      }
      return null;
    };

    canvas.addEventListener('pointerdown', (e) => {
      const p = toCard(e);
      const z = zoneAt(p);
      if (!z) return;
      e.preventDefault();
      if (Marketing.sizeZone !== z) { Marketing.sizeZone = z; Marketing._setStyleUI(); }
      const hit = Marketing._hits[z];
      const off = Marketing.offsets[z];
      Marketing._drag = {
        zone: z, startX: p.x, startY: p.y, ox: off.x, oy: off.y,
        // Where the block sits with NO offset, plus its size — used to keep it
        // on the card while dragging (otherwise it slides off and looks deleted).
        natX: hit.x - off.x, natY: hit.y - off.y, w: hit.w, h: hit.h
      };

      const onMove = (ev) => {
        if (!Marketing._drag) return;
        const q = toCard(ev);
        const d = Marketing._drag;
        const M = 8;  // keep at least this many px from the card edges
        let ox = d.ox + (q.x - d.startX);
        let oy = d.oy + (q.y - d.startY);

        // Horizontal: stay on the card, and snap to dead-centre when close.
        ox = Math.max(M - d.natX, Math.min((1080 - M - d.w) - d.natX, ox));
        const centredOx = (1080 - d.w) / 2 - d.natX;
        if (Math.abs(ox - centredOx) < 18) ox = centredOx;

        // Vertical: stay inside this block's own band so nothing piles up.
        const [bTop, bBot] = Marketing.BOUNDS[d.zone];
        const minOy = (bTop + 4) - d.natY;
        const maxOy = (bBot - 4 - d.h) - d.natY;
        oy = Math.max(minOy, Math.min(Math.max(minOy, maxOy), oy));

        Marketing.offsets[d.zone] = { x: Math.round(ox), y: Math.round(oy) };
        Marketing.render();
      };
      const onUp = () => {
        Marketing._drag = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  },

  render() {
    const host = document.getElementById('mk-preview');
    if (!host) return;
    if (Marketing._expLogo && !Marketing._expLogo.complete) {
      Marketing._expLogo.addEventListener('load', () => Marketing.render(), { once: true });
    }
    const doDraw = () => {
      const canvas = Marketing._draw();
      host.innerHTML = '';
      canvas.style.width = '100%'; canvas.style.height = 'auto';
      canvas.style.borderRadius = '10px'; canvas.style.display = 'block';
      canvas.style.cursor = 'move';
      canvas.style.touchAction = 'none';
      host.appendChild(canvas);
      // Selection outline is drawn on the PREVIEW canvas only — _draw() stays
      // clean, so the downloaded/shared image never contains this guide.
      const hit = Marketing._hits[Marketing.sizeZone];
      if (hit) {
        const c = canvas.getContext('2d');
        c.save();
        c.strokeStyle = 'rgba(124,124,255,.95)'; c.lineWidth = 3; c.setLineDash([10, 7]);
        c.strokeRect(hit.x - 10, hit.y - 8, hit.w + 20, hit.h + 16);
        c.restore();
      }
      Marketing._bindDrag(canvas);
    };
    if (Marketing._photoDataUrl && (!Marketing._photoImg || Marketing._photoImg.src !== Marketing._photoDataUrl)) {
      const img = new Image();
      img.onload = () => { Marketing._photoImg = img; doDraw(); };
      img.onerror = () => { Marketing._photoImg = null; Marketing._photoDataUrl = null; doDraw(); };
      img.src = Marketing._photoDataUrl;
    } else {
      if (!Marketing._photoDataUrl) Marketing._photoImg = null;
      doDraw();
    }
  },

  // Captions are written from short, plain templates in Maxwell's own voice
  // rather than by AI, so they read like him and never like a press release.
  // They change with the deal: Offer Accepted vs Just Sold, and existing home
  // vs new construction. ↻ cycles to the next wording in the same style.
  // Rules: two or three short lines, no names, no price, no dashes.
  CAPTIONS: {
    accepted: {
      existing: {
        warm:  ["Congratulations to my clients on their accepted offer on a beautiful home in {loc}! 🎉\nSo happy for you, and excited for what comes next.",
                "Accepted offer! 🏡 Huge congratulations to my clients on their new home in {loc}.\nNext stop, closing day!",
                "Offer accepted! 🎉 So proud of my clients on landing a lovely home in {loc}.\nThank you for trusting me with your search."],
        short: ["Accepted offer in {loc}! 🎉 Congrats to my clients.",
                "Offer accepted! 🏡 Congratulations to my clients on their home in {loc}.",
                "Another accepted offer in {loc}. Congrats to my clients! 🎉"],
        professional: ["Pleased to share an accepted offer for my clients in {loc}.\nCongratulations, and thank you for trusting me with your search.",
                "Accepted offer in {loc}. Congratulations to my clients, and thank you for letting me be part of it.",
                "Happy to share that my clients have an accepted offer on a home in {loc}.\nCongratulations!"],
      },
      new: {
        warm:  ["Congratulations to my clients on their accepted offer on a brand new home in {loc}! 🎉\nCan't wait to see it come together.",
                "Accepted offer on new construction in {loc}! 🏡 So excited for my clients as they watch their new home being built.",
                "Offer accepted! 🎉 My clients are building their new home in {loc}.\nSo happy for you, and I can't wait for move in day."],
        short: ["Accepted offer on a new build in {loc}! 🎉 Congrats to my clients.",
                "New construction, offer accepted in {loc}! 🏡 Congratulations to my clients.",
                "Brand new home, accepted offer in {loc}. Congrats to my clients! 🎉"],
        professional: ["Pleased to share an accepted offer on new construction in {loc}{town}.\nCongratulations to my clients, and thank you for trusting me with this one.",
                "Accepted offer on a new build in {loc}{town}. Congratulations to my clients!",
                "Happy to share that my clients have an accepted offer on a new home in {loc}{town}.\nCongratulations!"],
      },
    },
    sold: {
      existing: {
        warm:  ["Just sold in {loc}! 🎉 Congratulations to my clients, and thank you for trusting me with such a big move.",
                "Sold! 🔑 Congratulations to my clients on their home in {loc}.\nIt was a pleasure working with you.",
                "Another one closed in {loc}! 🎉 So happy for my clients.\nThank you for letting me be part of it."],
        short: ["Just sold in {loc}! 🔑 Congrats to my clients.",
                "Sold in {loc}! 🎉 Congratulations to my clients.",
                "Another one closed in {loc}. Congrats to my clients! 🔑"],
        professional: ["Another home sold in {loc}.\nThank you to my clients for trusting me with such a big move. Congratulations!",
                "Just sold in {loc}. Congratulations to my clients, and thank you for the trust.",
                "Pleased to share another sale in {loc}. Congratulations to my clients!"],
      },
      new: {
        warm:  ["Keys to a brand new home in {loc}! 🔑 Congratulations to my clients.\nWelcome home!",
                "Just sold! 🎉 Congratulations to my clients on their brand new home in {loc}.\nEnjoy every moment of it.",
                "From blueprint to keys in hand in {loc}! 🔑 So happy for my clients.\nWelcome home."],
        short: ["Sold! New construction in {loc}. 🔑 Congrats to my clients.",
                "Brand new and just sold in {loc}! 🎉 Congrats to my clients.",
                "New build, keys in hand in {loc}! 🔑 Congratulations to my clients."],
        professional: ["Just sold: new construction in {loc}{town}.\nCongratulations to my clients, and thank you for trusting me with this one.",
                "Pleased to share another new build sold in {loc}{town}. Congratulations to my clients!",
                "Another new construction home sold in {loc}{town}. Congratulations to my clients!"],
      },
    },
  },

  genCaption(next) {
    const ta = document.getElementById('mk-caption');
    if (!ta) return;
    const f = Marketing._fields();
    const area = f.area || "St. John's";
    const loc = f.place || area;
    const kind = Marketing.kind === 'new' ? 'new' : 'existing';
    const style = Marketing.captionStyle in Marketing.CAPTIONS.sold.existing ? Marketing.captionStyle : 'warm';
    const pool = Marketing.CAPTIONS[Marketing.current === 'sold' ? 'sold' : 'accepted'][kind][style];
    if (next) Marketing._capIx = (Marketing._capIx || 0) + 1;
    const line = pool[(Marketing._capIx || 0) % pool.length]
      .replace(/\{loc\}/g, loc)
      .replace(/\{town\}/g, loc.toLowerCase() === area.toLowerCase() ? '' : ', ' + area);
    const tags = ['#StJohnsRealEstate', '#NLRealEstate',
      Marketing.current === 'sold' ? '#JustSold' : '#AcceptedOffer',
      ...(kind === 'new' ? ['#NewConstruction'] : []), '#eXpRealty'].join(' ');
    ta.value = Marketing._autoCap = `${line}\n\n${tags}`;
  },

  // Template / home type changed: rewrite the caption to match, unless he has
  // already typed his own.
  _refreshCaption() {
    const ta = document.getElementById('mk-caption');
    if (ta && (!ta.value.trim() || ta.value === Marketing._autoCap)) Marketing.genCaption();
  },

  _toBlob() { return new Promise(res => Marketing._draw().toBlob(b => res(b), 'image/png')); },

  // File the finished graphic into the client's folder (same bucket + table the
  // Client Docs screen uses), so every post is kept with the deal it belongs to.
  // Best-effort: a storage hiccup must never block the download itself.
  async _saveToClientFolder(blob) {
    if (!Marketing._clientId || !blob) return false;
    try {
      const user = await App.getAuthUser();
      const uid = user?.id || currentAgent?.id;
      if (!uid) return false;
      const label = (Marketing._address || Marketing._fields().area || 'post').replace(/[^a-zA-Z0-9]+/g, '_');
      const fileName = `${Marketing.current === 'sold' ? 'just-sold' : 'offer-accepted'}-${label}.png`;
      const path = `${uid}/${Marketing._clientId}/${Date.now()}-${fileName}`;
      const { error: upErr } = await db.storage.from('client-docs').upload(path, blob);
      if (upErr) { console.warn('[marketing] folder upload failed:', upErr.message); return false; }
      const { error: insErr } = await db.from('client_documents').insert({
        agent_id: uid, client_id: Marketing._clientId, category: 'marketing', source: 'marketing',
        file_path: path, file_name: fileName, file_size_bytes: blob.size,
      });
      if (insErr) { console.warn('[marketing] folder record failed:', insErr.message); return false; }
      return true;
    } catch (e) { console.warn('[marketing] folder save skipped:', e?.message || e); return false; }
  },

  async download() {
    if (!document.getElementById('mk-consent')?.checked) return;
    if (!Marketing._photoDataUrl) { App.toast('📷 Add a listing photo first', 'var(--yellow)'); return; }
    const blob = await Marketing._toBlob();
    if (!blob) { alert('Could not generate the image.'); return; }
    // Save to the client folder first, then hand the file to the browser.
    const filed = await Marketing._saveToClientFolder(blob);
    const name = `${Marketing.current}-${(Marketing._fields().area || 'post').replace(/[^a-z0-9]+/gi,'_')}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Marketing._log();
    if (filed) App.toast('📁 Saved to the client folder', 'var(--green)');
    else if (Marketing._clientId) App.toast('⬇ Downloaded (folder save skipped)', 'var(--yellow)');
  },

  async copyCaption() {
    if (!document.getElementById('mk-consent')?.checked) return;
    const text = document.getElementById('mk-caption')?.value || '';
    try { await navigator.clipboard.writeText(text); Marketing._flash('mk-copy', 'Copied ✓'); }
    catch (e) { alert('Copy failed — select the caption text and copy manually.'); }
  },

  async share() {
    if (!document.getElementById('mk-consent')?.checked) return;
    const blob = await Marketing._toBlob();
    if (!blob) { alert('Could not generate the image.'); return; }
    const name = `${Marketing.current}-post.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const caption = document.getElementById('mk-caption')?.value || '';
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: caption }); Marketing._log(); }
      catch (e) { /* cancelled */ }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert('Your browser can\'t share directly — the image was downloaded. Open Instagram, add it, and paste the caption.');
      Marketing._log();
    }
  },

  _flash(id, txt) {
    const b = document.getElementById(id); if (!b) return;
    const old = b.textContent; b.textContent = txt;
    setTimeout(() => { b.textContent = old; }, 1400);
  },

  _log() {
    try { if (App?.logActivity) App.logActivity('marketing', '', '', `Created a ${Marketing.TEMPLATES[Marketing.current].label} post`); } catch (e) {}
  },

  TOWNS: ["St. John's","St John's","Mount Pearl","Paradise","Conception Bay South",
          "CBS","Torbay","Portugal Cove","Bay Roberts","Holyrood","Logy Bay",
          "Pouch Cove","Flatrock","Witless Bay","Bauline","Petty Harbour"],

  _area(addr) {
    if (!addr) return '';
    const hit = Marketing.TOWNS.find(t => addr.toLowerCase().includes(t.toLowerCase()));
    if (hit) return hit === "St John's" ? "St. John's" : (hit === 'CBS' ? 'Conception Bay South' : hit);
    const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1].replace(/\b(NL|Newfoundland|A\d[A-Z]\s?\d[A-Z]\d)\b/gi,'').trim() : '';
  },

  async loadFolder() {
    const host = document.getElementById('marketing-folder');
    if (!host) return;
    host.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:20px 0;">Loading your deals…</div>';
    const items = [];
    try {
      const { data: offers } = await db.from('offers')
        .select('id, client_id, property_address, status, mls_number, property_type, clients(full_name)')
        .in('status', ['Accepted','Conditions','Closing']);
      (offers || []).forEach(o => items.push({
        template: 'accepted', address: o.property_address || '', mls: o.mls_number || '',
        client: o.clients?.full_name || '', clientId: o.client_id || null, tag: o.status,
        kind: o.property_type === 'new_build' ? 'new' : 'existing',
      }));
    } catch (e) {}
    try {
      const { data: pipe } = await db.from('pipeline').select('*');
      (pipe || []).forEach(p => {
        const stage = (p.current_stage || p.stage || p.status || '').toString();
        if (/clos(ed|ing)|sold|complete/i.test(stage)) {
          const addr = (p.property_address || '').trim();
          const existing = items.find(i => i.address.trim().toLowerCase() === addr.toLowerCase());
          if (existing) {
            existing.template = 'sold'; existing.tag = 'Closed';
            if (!existing.mls && p.mls_number) existing.mls = p.mls_number;
            if (!existing.clientId && p.client_id) existing.clientId = p.client_id;
            if (p.deal_type === 'new_build') existing.kind = 'new';
          }
          else items.push({ template: 'sold', address: addr, mls: p.mls_number || '', client: p.client_name || '', clientId: p.client_id || null, tag: 'Closed',
                            kind: p.deal_type === 'new_build' ? 'new' : 'existing' });
        }
      });
    } catch (e) {}
    // New builds: put the development name (e.g. "Southlands") on the post.
    if (items.some(i => i.kind === 'new' && i.clientId)) {
      try {
        const { data: builds } = await db.from('new_builds').select('client_id, community');
        items.forEach(i => {
          const b = i.kind === 'new' && (builds || []).find(x => x.client_id === i.clientId && x.community);
          if (b) i.place = b.community.trim();
        });
      } catch (e) {}
    }

    if (!items.length) {
      host.innerHTML = `<div style="text-align:center;color:var(--text2);padding:40px 20px;border:1px dashed var(--border);border-radius:12px;">
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">No posts waiting yet</div>
        <div style="font-size:13px;max-width:44ch;margin:0 auto 16px;">When you mark an offer <b>Accepted</b> or close a deal, it shows up here ready to post. Or make one now.</div>
        <button class="btn btn-primary btn-sm" onclick="Marketing.openComposer()">＋ New post</button>
      </div>`;
      return;
    }

    items.sort((a, b) => (a.template === 'sold' ? 0 : 1) - (b.template === 'sold' ? 0 : 1));
    Marketing._drafts = {};
    host.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">` +
      items.map((it, i) => {
        Marketing._drafts[i] = it;
        const badge = it.template === 'sold' ? 'SOLD' : 'ACCEPTED';
        const badgeBg = it.template === 'sold' ? 'var(--green-soft)' : 'var(--accent-soft)';
        const badgeCol = it.template === 'sold' ? 'var(--green)' : 'var(--accent)';
        return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:10px;font-weight:800;letter-spacing:.5px;padding:3px 9px;border-radius:20px;background:${badgeBg};color:${badgeCol};">${badge}</span>
            ${it.mls ? `<span style="font-size:11px;color:var(--text3);">MLS# ${App.esc(it.mls)}</span>` : ''}
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px;">${App.esc(it.address || '—')}</div>
          <div style="font-size:11.5px;color:var(--text3);margin-bottom:14px;">${it.client ? 'Client: ' + App.esc(it.client) + ' · ' : ''}Area on post: ${App.esc(Marketing._area(it.address)) || '—'}</div>
          <button class="btn btn-primary btn-sm" style="width:100%;" onclick="Marketing.prepareFromDraft(${i})">Prepare post →</button>
        </div>`;
      }).join('') + `</div>`;
  },

  prepareFromDraft(i) {
    const it = (Marketing._drafts || {})[i];
    if (!it) return Marketing.openComposer();
    Marketing.openComposer({
      template: it.template, area: Marketing._area(it.address), mls: it.mls || '',
      clientId: it.clientId || null, address: it.address || '',
      kind: it.kind || 'existing', place: it.place || ''
    });
    setTimeout(() => Marketing.genCaption(), 100);
  },
};

// Preload the official eXp logo once so it's ready when a card is drawn.
Marketing._expLogo = new Image();
Marketing._expLogo.src = '/icons/exp-logo.png';

window.Marketing = Marketing;
