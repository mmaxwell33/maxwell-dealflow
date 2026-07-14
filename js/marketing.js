// ─────────────────────────────────────────────────────────────────────────
// marketing.js — Deal-post generator (board-approved, brand-board session).
//
// Turns a closed/accepted deal into a branded 1080×1080 Instagram graphic +
// an editable AI caption, then lets Maxwell download / copy / share it. It
// NEVER auto-publishes and there is NO "post to Instagram" button — Instagram
// does not allow programmatic posting from a personal account, so the honest
// flow is: generate → preview/edit → download image + copy caption → he posts.
//
// Compliance guardrails baked in (per Abena's ruling):
//   • Consent gate: the action buttons stay disabled until Maxwell confirms he
//     has the client's permission to share the deal publicly.
//   • NO sold price anywhere (Canadian sold data isn't public).
//   • Neighbourhood/area only — never a civic street number.
//   • eXp Realty + REALTOR® baked into the template (NL advertising law).
//
// Reuses the proven canvas → toBlob → navigator.share/download pattern from
// reviews.js. Official eXp palette (navy + royal blue + white) — not the CRM
// coral, not gold. Phase 1 is stateless: nothing is stored except an
// activity_log entry when a post is generated.
// ─────────────────────────────────────────────────────────────────────────

const Marketing = {
  // eXp brand palette (matches his real Instagram templates)
  NAVY:  '#0C0F24',
  DEEP:  '#0A1628',
  BLUE:  '#19469D',
  BLUE2: '#4A74B4',
  WHITE: '#FAFAF7',
  GREY:  '#B7C0D8',

  TEMPLATES: {
    sold:     { label: 'Just Sold',      status: 'SOLD',            hint: 'A closed, completed deal.' },
    accepted: { label: 'Offer Accepted', status: 'OFFER ACCEPTED',  hint: 'Under contract — post only once the deal is firm.' },
  },

  current: 'sold',

  openComposer(prefill = {}) {
    const m = document.getElementById('marketing-modal');
    if (!m) { alert('Marketing composer not found.'); return; }
    Marketing.current = prefill.template || 'sold';
    Marketing._photoDataUrl = null;
    // seed fields
    m.querySelector('#mk-area').value    = prefill.area || '';
    m.querySelector('#mk-beds').value    = prefill.beds || '';
    m.querySelector('#mk-baths').value   = prefill.baths || '';
    m.querySelector('#mk-highlight').value = prefill.highlight || '';
    m.querySelector('#mk-caption').value = '';
    m.querySelector('#mk-consent').checked = false;
    Marketing._setTemplateUI();
    Marketing._syncConsent();
    m.style.display = 'flex';
    Marketing.render();
  },

  close() {
    const m = document.getElementById('marketing-modal');
    if (m) m.style.display = 'none';
  },

  setTemplate(t) {
    Marketing.current = t;
    Marketing._setTemplateUI();
    Marketing.render();
  },

  _setTemplateUI() {
    document.querySelectorAll('#marketing-modal .mk-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tpl === Marketing.current);
    });
    const hint = document.getElementById('mk-tpl-hint');
    if (hint) hint.textContent = Marketing.TEMPLATES[Marketing.current].hint;
  },

  _syncConsent() {
    const ok = document.getElementById('mk-consent')?.checked;
    ['mk-download','mk-copy','mk-share'].forEach(id => {
      const b = document.getElementById(id);
      if (b) { b.disabled = !ok; b.style.opacity = ok ? '1' : '.45'; b.style.pointerEvents = ok ? 'auto' : 'none'; }
    });
  },

  onPhoto(input) {
    const f = input.files && input.files[0];
    if (!f) { Marketing._photoDataUrl = null; Marketing.render(); return; }
    const reader = new FileReader();
    reader.onload = e => { Marketing._photoDataUrl = e.target.result; Marketing.render(); };
    reader.readAsDataURL(f);
  },

  _fields() {
    const m = document.getElementById('marketing-modal');
    return {
      area:  (m.querySelector('#mk-area').value || '').trim(),
      beds:  (m.querySelector('#mk-beds').value || '').trim(),
      baths: (m.querySelector('#mk-baths').value || '').trim(),
      highlight: (m.querySelector('#mk-highlight').value || '').trim(),
    };
  },

  _wrap(ctx, text, maxWidth) {
    const words = (text || '').split(/\s+/); const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  },

  // Build the 1080×1080 card onto a canvas and return it.
  _draw() {
    const f = Marketing._fields();
    const tpl = Marketing.TEMPLATES[Marketing.current];
    const agentName = (currentAgent?.full_name || 'Maxwell Midodzi').replace(/\s+/g,' ').trim();
    const phone = currentAgent?.phone || '(709) 325-0545';
    const email = currentAgent?.email || 'Maxwell.Midodzi@exprealty.com';

    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    const TOP = 210, BOT = 250, MIDy = TOP, MIDh = 1080 - TOP - BOT;

    // ── middle band (photo or branded navy) ──
    if (Marketing._photoImg && Marketing._photoDataUrl) {
      const img = Marketing._photoImg;
      const scale = Math.max(1080 / img.width, MIDh / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.save(); ctx.beginPath(); ctx.rect(0, MIDy, 1080, MIDh); ctx.clip();
      ctx.drawImage(img, (1080 - w) / 2, MIDy + (MIDh - h) / 2, w, h);
      // dark scrim so the spec strip reads
      const sc = ctx.createLinearGradient(0, MIDy, 0, MIDy + MIDh);
      sc.addColorStop(0, 'rgba(10,22,40,.15)'); sc.addColorStop(1, 'rgba(10,22,40,.55)');
      ctx.fillStyle = sc; ctx.fillRect(0, MIDy, 1080, MIDh); ctx.restore();
    } else {
      const g = ctx.createLinearGradient(0, MIDy, 1080, MIDy + MIDh);
      g.addColorStop(0, '#12203f'); g.addColorStop(1, Marketing.DEEP);
      ctx.fillStyle = g; ctx.fillRect(0, MIDy, 1080, MIDh);
      const rg = ctx.createRadialGradient(880, MIDy + 120, 0, 880, MIDy + 120, 620);
      rg.addColorStop(0, 'rgba(25,70,157,.45)'); rg.addColorStop(1, 'rgba(25,70,157,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, MIDy, 1080, MIDh);
      // area name centred in the branded middle
      if (f.area) {
        ctx.fillStyle = Marketing.WHITE; ctx.textAlign = 'center';
        ctx.font = '600 60px Georgia, "Times New Roman", serif';
        ctx.fillText(f.area, 540, MIDy + MIDh / 2 + 6);
        ctx.textAlign = 'left';
      }
    }

    // ── spec strip (beds/baths/area) low on the middle band ──
    const specs = [];
    if (f.beds)  specs.push(f.beds + ' BED');
    if (f.baths) specs.push(f.baths + ' BATH');
    if (Marketing._photoDataUrl && f.area) specs.unshift(f.area.toUpperCase());
    if (specs.length) {
      const label = specs.join('   ·   ');
      ctx.font = '700 26px -apple-system, system-ui, Segoe UI, sans-serif';
      const tw = ctx.measureText(label).width, padX = 30, sh = 62, sw = tw + padX * 2;
      const sx = 60, sy = MIDy + MIDh - sh - 34;
      ctx.fillStyle = 'rgba(250,250,247,.92)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 8); ctx.fill(); }
      else ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = Marketing.NAVY; ctx.textAlign = 'left';
      ctx.fillText(label, sx + padX, sy + sh / 2 + 9);
    }

    // ── top band ──
    ctx.fillStyle = Marketing.NAVY; ctx.fillRect(0, 0, 1080, TOP);
    ctx.fillStyle = Marketing.WHITE; ctx.textAlign = 'center';
    // status word, letter-spaced serif, auto-fit
    let fs = 92; ctx.font = `700 ${fs}px Georgia, "Times New Roman", serif`;
    const spaced = tpl.status.split('').join(' ');
    while (ctx.measureText(spaced).width > 940 && fs > 40) { fs -= 4; ctx.font = `700 ${fs}px Georgia, serif`; }
    ctx.fillText(spaced, 540, TOP / 2 + fs / 3);
    // royal-blue divider under the word
    ctx.fillStyle = Marketing.BLUE; ctx.fillRect(440, TOP - 34, 200, 5);
    ctx.textAlign = 'left';

    // ── bottom band ──
    const by = 1080 - BOT;
    ctx.fillStyle = Marketing.NAVY; ctx.fillRect(0, by, 1080, BOT);
    ctx.fillStyle = Marketing.WHITE;
    ctx.font = '800 44px Georgia, "Times New Roman", serif';
    ctx.fillText(agentName + ', REALTOR®', 60, by + 78);
    ctx.fillStyle = Marketing.GREY;
    ctx.font = '600 26px -apple-system, system-ui, sans-serif';
    ctx.fillText(phone + '   ·   ' + email, 60, by + 128);
    if (f.highlight) {
      ctx.fillStyle = Marketing.BLUE2;
      ctx.font = 'italic 600 26px Georgia, serif';
      ctx.fillText(f.highlight, 60, by + 178);
    }
    // right: eXp Realty lockup
    ctx.textAlign = 'right';
    ctx.fillStyle = Marketing.WHITE;
    ctx.font = '800 40px -apple-system, system-ui, sans-serif';
    ctx.fillText('eXp Realty', 1020, by + 82);
    ctx.fillStyle = Marketing.GREY;
    ctx.font = '600 20px -apple-system, system-ui, sans-serif';
    ctx.fillText("ST. JOHN'S, NEWFOUNDLAND", 1020, by + 118);
    ctx.textAlign = 'left';

    return canvas;
  },

  render() {
    const host = document.getElementById('mk-preview');
    if (!host) return;
    // load photo if present, then draw
    const doDraw = () => {
      const canvas = Marketing._draw();
      host.innerHTML = '';
      canvas.style.width = '100%'; canvas.style.height = 'auto';
      canvas.style.borderRadius = '10px'; canvas.style.display = 'block';
      host.appendChild(canvas);
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

  async genCaption() {
    const btn = document.getElementById('mk-regen');
    const ta = document.getElementById('mk-caption');
    const f = Marketing._fields();
    const tpl = Marketing.TEMPLATES[Marketing.current];
    if (btn) { btn.disabled = true; btn.textContent = 'Writing…'; }
    const system = `You write Instagram captions for Maxwell Midodzi, a REALTOR® with eXp Realty in St. John's, Newfoundland. His voice: warm, sincere, gratitude-forward, plain-spoken — never hype, never "crushing it". Rules: open with one short warm line; 2-4 short sentences; a soft call to action ("Thinking about buying or selling? Reach out."); NEVER mention a sale price; NEVER name the client; refer to the area only, not a street number; end with a contact line "Maxwell Midodzi · REALTOR® · eXp Realty · St. John's, NL"; then 8-10 relevant hashtags (mix local St. John's/NL + category + brand). No emojis in the first line; at most one elsewhere.`;
    const user = `Write a caption for a "${tpl.label}" post. Area: ${f.area || 'St. John\'s'}. ${f.beds ? f.beds + ' bed. ' : ''}${f.baths ? f.baths + ' bath. ' : ''}${f.highlight ? 'Context: ' + f.highlight + '.' : ''}`;
    try {
      const { data, error } = await db.functions.invoke('claude-chat', {
        body: { system, messages: [{ role: 'user', content: user }], model: 'claude-haiku-4-5', max_tokens: 600 }
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      ta.value = (data?.text || '').trim();
    } catch (e) {
      // honest offline fallback — a starter he can edit
      ta.value = `${tpl.status === 'SOLD' ? 'Another one closed' : 'Another one under contract'} in ${f.area || "St. John's"}. Grateful to have helped — every deal is a real family and a real milestone.\n\nThinking about buying or selling? Reach out, I'm happy to walk you through it.\n\nMaxwell Midodzi · REALTOR® · eXp Realty · St. John's, NL\n#StJohnsRealEstate #NLRealEstate #Newfoundland #${tpl.status === 'SOLD' ? 'JustSold' : 'UnderContract'} #eXpRealty`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Regenerate caption'; }
    }
  },

  _toBlob() {
    return new Promise(res => Marketing._draw().toBlob(b => res(b), 'image/png'));
  },

  async download() {
    if (!document.getElementById('mk-consent')?.checked) return;
    const blob = await Marketing._toBlob();
    if (!blob) { alert('Could not generate the image.'); return; }
    const name = `${Marketing.current}-${(Marketing._fields().area || 'post').replace(/[^a-z0-9]+/gi,'_')}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Marketing._log();
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
      // desktop: no OS share sheet — download instead
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
    try {
      if (App?.logActivity) App.logActivity('marketing', '', '', `Created a ${Marketing.TEMPLATES[Marketing.current].label} post`);
    } catch (e) {}
  },
};

window.Marketing = Marketing;
