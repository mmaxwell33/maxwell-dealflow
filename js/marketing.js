// ─────────────────────────────────────────────────────────────────────────
// marketing.js — Deal-post generator (board-approved, brand-board session).
//
// Turns a closed/accepted deal into a branded 1080x1080 Instagram graphic +
// an editable AI caption, then lets Maxwell download / copy / share it. It
// NEVER auto-publishes and there is NO "post to Instagram" button — Instagram
// does not allow programmatic posting from a personal account, so the honest
// flow is: generate -> preview/edit -> download image + copy caption -> he posts.
//
// The card layout matches Maxwell's real Instagram posts exactly:
//   • navy top band: status word (SOLD / OFFER ACCEPTED) in white serif + blue rule
//   • listing photo (he uploads it) with a centred white "SQF · BED · BATH" strip
//   • navy footer: name + REALTOR®, MLS®#, blue-dot contact (phone · email ·
//     website), and eXp Realty + ST. JOHN'S, NEWFOUNDLAND on the right
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

  TEMPLATES: {
    sold:     { label: 'Just Sold',      status: 'SOLD',           hint: 'A closed, completed deal.' },
    accepted: { label: 'Offer Accepted', status: 'OFFER ACCEPTED', hint: 'Under contract — best posted once the deal is firm.' },
  },

  current: 'sold',

  openComposer(prefill = {}) {
    const m = document.getElementById('marketing-modal');
    if (!m) { alert('Marketing composer not found.'); return; }
    Marketing.current = prefill.template || 'sold';
    Marketing._photoDataUrl = null; Marketing._photoImg = null;
    m.querySelector('#mk-area').value  = prefill.area || '';
    m.querySelector('#mk-sqft').value  = prefill.sqft || '';
    m.querySelector('#mk-beds').value  = prefill.beds || '';
    m.querySelector('#mk-baths').value = prefill.baths || '';
    m.querySelector('#mk-mls').value   = prefill.mls || '';
    m.querySelector('#mk-caption').value = '';
    m.querySelector('#mk-consent').checked = false;
    const fp = m.querySelector('#mk-photo'); if (fp) fp.value = '';
    Marketing._setTemplateUI();
    Marketing._syncConsent();
    m.style.display = 'flex';
    Marketing.render();
  },

  close() {
    const m = document.getElementById('marketing-modal');
    if (m) m.style.display = 'none';
  },

  setTemplate(t) { Marketing.current = t; Marketing._setTemplateUI(); Marketing.render(); },

  _setTemplateUI() {
    document.querySelectorAll('#marketing-modal .mk-tab').forEach(b => b.classList.toggle('active', b.dataset.tpl === Marketing.current));
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
    const v = id => (m.querySelector('#' + id)?.value || '').trim();
    return { area: v('mk-area'), sqft: v('mk-sqft'), beds: v('mk-beds'), baths: v('mk-baths'), mls: v('mk-mls') };
  },

  // Build the 1080x1080 card. Layout matches Maxwell's real posts.
  _draw() {
    const f = Marketing._fields();
    const tpl = Marketing.TEMPLATES[Marketing.current];
    const agentName = (currentAgent?.full_name || 'Maxwell Midodzi').replace(/\s+/g, ' ').trim();
    const phone = currentAgent?.phone || '709-325-0545';
    const email = currentAgent?.email || 'maxwell.midodzi@exprealty.com';
    const web = Marketing.WEB;
    const DOT = '   ·   ';

    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    const TOP = 196, BOT = 288, MIDy = TOP, MIDh = 1080 - TOP - BOT;

    ctx.fillStyle = Marketing.DEEP; ctx.fillRect(0, 0, 1080, 1080);

    // middle: listing photo (cover) or branded navy fallback
    if (Marketing._photoImg && Marketing._photoDataUrl) {
      const img = Marketing._photoImg;
      const scale = Math.max(1080 / img.width, MIDh / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.save(); ctx.beginPath(); ctx.rect(0, MIDy, 1080, MIDh); ctx.clip();
      ctx.drawImage(img, (1080 - w) / 2, MIDy + (MIDh - h) / 2, w, h);
      ctx.restore();
    } else {
      const g = ctx.createLinearGradient(0, MIDy, 1080, MIDy + MIDh);
      g.addColorStop(0, '#12203f'); g.addColorStop(1, Marketing.DEEP);
      ctx.fillStyle = g; ctx.fillRect(0, MIDy, 1080, MIDh);
      if (f.area) {
        ctx.fillStyle = Marketing.WHITE; ctx.textAlign = 'center';
        ctx.font = '600 58px Georgia, "Times New Roman", serif';
        ctx.fillText(f.area, 540, MIDy + MIDh / 2);
        ctx.textAlign = 'left';
      }
    }

    // centred white SQF · BED · BATH strip near the bottom of the photo
    const specs = [];
    if (f.sqft)  specs.push(f.sqft.replace(/,/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' SQF');
    if (f.beds)  specs.push(f.beds + ' BED');
    if (f.baths) specs.push(f.baths + ' BATH');
    if (specs.length) {
      const label = specs.join(DOT);
      ctx.font = '700 30px Georgia, "Times New Roman", serif';
      const tw = ctx.measureText(label).width, padX = 42, sh = 72, sw = tw + padX * 2;
      const sx = (1080 - sw) / 2, sy = MIDy + MIDh - sh - 38;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 6); ctx.fill(); }
      else ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = Marketing.NAVY; ctx.textAlign = 'center';
      ctx.fillText(label, 540, sy + sh / 2 + 11);
      ctx.textAlign = 'left';
    }

    // top band: status word + wide blue rule
    ctx.fillStyle = Marketing.NAVY; ctx.fillRect(0, 0, 1080, TOP);
    ctx.fillStyle = Marketing.WHITE; ctx.textAlign = 'center';
    let fs = 90; ctx.font = `700 ${fs}px Georgia, "Times New Roman", serif`;
    const spaced = tpl.status.split('').join(' ');
    while (ctx.measureText(spaced).width > 960 && fs > 38) { fs -= 4; ctx.font = `700 ${fs}px Georgia, serif`; }
    ctx.fillText(spaced, 540, TOP / 2 + fs / 3);
    ctx.fillStyle = Marketing.BLUE; ctx.fillRect(70, TOP - 28, 940, 5);
    ctx.textAlign = 'left';

    // bottom band
    const by = 1080 - BOT;
    ctx.fillStyle = Marketing.NAVY; ctx.fillRect(0, by, 1080, BOT);

    // left: name / MLS / contact with blue dots
    ctx.fillStyle = Marketing.WHITE;
    ctx.font = '800 42px Georgia, "Times New Roman", serif';
    ctx.fillText(agentName + ', REALTOR®', 60, by + 64);
    let ly = by + 104;
    if (f.mls) {
      ctx.fillStyle = Marketing.GREY;
      ctx.font = '600 24px -apple-system, system-ui, sans-serif';
      ctx.fillText('MLS® #' + f.mls, 60, ly); ly += 44;
    }
    const dot = (x, y) => { ctx.fillStyle = Marketing.BLUE; ctx.beginPath(); ctx.arc(x + 6, y - 8, 6, 0, Math.PI * 2); ctx.fill(); };
    ctx.font = '600 24px -apple-system, system-ui, sans-serif';
    dot(60, ly); ctx.fillStyle = Marketing.WHITE; ctx.fillText(phone, 82, ly);
    const pw = ctx.measureText(phone).width;
    dot(82 + pw + 28, ly); ctx.fillStyle = Marketing.WHITE; ctx.fillText(email, 82 + pw + 28 + 22, ly);
    ly += 40;
    dot(60, ly); ctx.fillStyle = Marketing.WHITE; ctx.fillText(web, 82, ly);

    // right: eXp Realty + location
    ctx.textAlign = 'right';
    ctx.fillStyle = Marketing.WHITE;
    ctx.font = '800 46px -apple-system, system-ui, sans-serif';
    ctx.fillText('eXp Realty', 1020, by + 68);
    ctx.fillStyle = Marketing.GREY;
    ctx.font = '600 20px -apple-system, system-ui, sans-serif';
    ctx.fillText("ST. JOHN'S, NEWFOUNDLAND", 1020, by + 104);
    ctx.textAlign = 'left';

    return canvas;
  },

  render() {
    const host = document.getElementById('mk-preview');
    if (!host) return;
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
    const system = `You write Instagram captions for Maxwell Midodzi, a REALTOR® with eXp Realty in St. John's, Newfoundland. His voice: warm, sincere, gratitude-forward, plain-spoken — never hype. Rules: open with one short warm line; 2-4 short sentences; a soft call to action ("Thinking about buying or selling? Reach out."); NEVER mention a sale price; NEVER name the client; refer to the area only, not a street number; end with a contact block on its own lines "Maxwell Midodzi, REALTOR®", "eXp Realty | St. John's, NL", the phone, the email, and "maxwellmidodzi.com"; then 8-10 relevant hashtags (local St. John's/NL + category + brand). No emojis in the first line; at most one elsewhere.`;
    const user = `Write a caption for a "${tpl.label}" post. Area: ${f.area || "St. John's"}. ${f.beds ? f.beds + ' bed. ' : ''}${f.baths ? f.baths + ' bath. ' : ''}${f.sqft ? f.sqft + ' sq ft.' : ''}`;
    try {
      const { data, error } = await db.functions.invoke('claude-chat', {
        body: { system, messages: [{ role: 'user', content: user }], model: 'claude-haiku-4-5', max_tokens: 600 }
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      ta.value = (data?.text || '').trim();
    } catch (e) {
      ta.value = `${tpl.status === 'SOLD' ? 'Another one closed' : 'Another one under contract'} in ${f.area || "St. John's"}. Grateful to have helped — every deal is a real family and a real milestone.\n\nThinking about buying or selling? Reach out, I'm happy to walk you through it.\n\nMaxwell Midodzi, REALTOR®\neXp Realty | St. John's, NL\n709-325-0545\nmaxwell.midodzi@exprealty.com\nmaxwellmidodzi.com\n\n#StJohnsRealEstate #NLRealEstate #Newfoundland #${tpl.status === 'SOLD' ? 'JustSold' : 'UnderContract'} #eXpRealty`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Regenerate caption'; }
    }
  },

  _toBlob() { return new Promise(res => Marketing._draw().toBlob(b => res(b), 'image/png')); },

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
        .select('id, property_address, status, mls_number, clients(full_name)')
        .in('status', ['Accepted','Conditions','Closing']);
      (offers || []).forEach(o => items.push({
        template: 'accepted', address: o.property_address || '', mls: o.mls_number || '',
        client: o.clients?.full_name || '', tag: o.status,
      }));
    } catch (e) {}
    try {
      const { data: pipe } = await db.from('pipeline').select('*');
      (pipe || []).forEach(p => {
        const stage = (p.current_stage || p.stage || p.status || '').toString();
        if (/clos(ed|ing)|sold|complete/i.test(stage)) {
          const addr = (p.property_address || '').trim();
          const existing = items.find(i => i.address.trim().toLowerCase() === addr.toLowerCase());
          if (existing) { existing.template = 'sold'; existing.tag = 'Closed'; if (!existing.mls && p.mls_number) existing.mls = p.mls_number; }
          else items.push({ template: 'sold', address: addr, mls: p.mls_number || '', client: '', tag: 'Closed' });
        }
      });
    } catch (e) {}

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
    Marketing.openComposer({ template: it.template, area: Marketing._area(it.address), mls: it.mls || '' });
    setTimeout(() => Marketing.genCaption(), 100);
  },
};

window.Marketing = Marketing;
