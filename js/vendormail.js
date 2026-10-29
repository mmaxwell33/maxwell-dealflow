// Maxwell DealFlow CRM — Vendor emails for new-build selections (migration 117)
//
// Each buyer selection on a build (flooring, cabinets, lighting...) can email
// its vendor: "my clients are building with X at Y, attached is the floor
// plan, when can they come in?", with the buyers copied so the vendor replies
// to everyone.
//   • Waits for the money to be safe: financing approved (or no financing
//     condition) AND the deposit to the builder submitted. When both are true
//     every vendor email is drafted into Approvals at once, plus one short
//     heads-up to the buyers. Nothing is ever sent without Maxwell's approval.
//   • "Email vendor" on a selection drafts one now, ahead of the gate.
//   • "Different vendor" asks another vendor for a price-match quote, tracked
//     as its own row under the selection.
//   • Vendors only ever get the floor plan pages cut from the APS, never the
//     agreement itself (price, deposit and the buyers' details).
//   • Vendor emails are remembered (build_vendors) for the next build.
//   • Track record per selection: drafted, sent, replied (matched from the
//     inbox), booked, done.

const VendorMail = {
  TYPE: 'Vendor Selection Email',
  CLIENT_TYPE: 'Vendor Heads-up',
  PDFLIB: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  _track: {},     // selection id -> { approval, sentAt, repliedAt }
  _builds: {},    // build id -> { deal }

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  emailOk(e) { return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(e || '').trim()); },

  // Vendor columns for a row written from the APS reader
  vendorFields(r) {
    const email = String(r.vendor_email || '').trim()
      || (String(r.vendor_contact || '').match(/[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}/i) || [''])[0];
    const out = {};
    if (email) out.vendor_email = email;
    if (r.vendor_phone) out.vendor_phone = r.vendor_phone;
    if (r.vendor_address) out.vendor_address = r.vendor_address;
    if (r.allowance) out.allowance = r.allowance;
    return out;
  },

  // ── Vendor book ───────────────────────────────────────────────────────────
  key(name) { return String(name || '').trim().toLowerCase().replace(/\s+/g, ' '); },

  async remember({ name, email, phone, address }) {
    if (!name || !VendorMail.emailOk(email)) return;
    const user = await App.getAuthUser();
    const row = { agent_id: user?.id || currentAgent.id, name: name.trim(), name_key: VendorMail.key(name),
                  email: email.trim(), updated_at: new Date().toISOString() };
    if (phone) row.phone = phone;
    if (address) row.address = address;
    const { error } = await db.from('build_vendors').upsert(row, { onConflict: 'agent_id,name_key' });
    if (error) console.warn('[VendorMail] vendor book skipped (run migration 117):', error.message);
  },

  // Selections on a build that have a vendor name but no email: fill from the book
  async fillFromBook(buildId) {
    const { data: rows } = await db.from('build_selections').select('id, vendor_name, vendor_email, vendor_phone, vendor_address')
      .eq('build_id', buildId);
    const need = (rows || []).filter(r => r.vendor_name && !r.vendor_email);
    if (!need.length) return 0;
    const { data: book } = await db.from('build_vendors').select('*').in('name_key', [...new Set(need.map(r => VendorMail.key(r.vendor_name)))]);
    let n = 0;
    for (const r of need) {
      const v = (book || []).find(b => b.name_key === VendorMail.key(r.vendor_name));
      if (!v?.email) continue;
      await db.from('build_selections').update({
        vendor_email: v.email, vendor_phone: r.vendor_phone || v.phone || null,
        vendor_address: r.vendor_address || v.address || null,
      }).eq('id', r.id);
      n++;
    }
    return n;
  },

  // ── Floor plan: only those pages of the APS ───────────────────────────────
  async _pdfLib() {
    if (window.PDFLib) return window.PDFLib;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = VendorMail.PDFLIB; s.onload = res; s.onerror = () => rej(new Error('PDF tool did not load'));
      document.head.appendChild(s);
    });
    return window.PDFLib;
  },

  async saveFloorPlan(buildId, clientId, file, pages) {
    try {
      const { PDFDocument } = await VendorMail._pdfLib();
      const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const idx = [...new Set(pages)].map(n => n - 1).filter(i => i >= 0 && i < src.getPageCount()).sort((a, b) => a - b);
      if (!idx.length) return false;
      const out = await PDFDocument.create();
      (await out.copyPages(src, idx)).forEach(p => out.addPage(p));
      const bytes = await out.save();
      const name = 'Floor plan.pdf';
      const user = await App.getAuthUser();
      const path = `${user?.id || currentAgent.id}/${clientId}/${Date.now()}-Floor_plan.pdf`;
      const { error: upErr } = await db.storage.from('client-docs').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
      if (upErr) throw upErr;
      await db.from('client_documents').insert({
        agent_id: user?.id || currentAgent.id, client_id: clientId, category: 'floor_plan', source: 'new_build',
        file_path: path, file_name: name, file_size_bytes: bytes.length,
      });
      const { error } = await db.from('new_builds').update({ floor_plan_path: path, floor_plan_name: name }).eq('id', buildId);
      if (error) throw error;
      App.toast(`📐 Floor plan saved (page${idx.length > 1 ? 's' : ''} ${idx.map(i => i + 1).join(', ')}). It goes to the vendors.`, 'var(--green)');
      return true;
    } catch (e) {
      console.warn('[VendorMail] floor plan skipped:', e?.message || e);
      App.toast('⚠️ Floor plan not saved. Attach it when you email a vendor.', 'var(--yellow)');
      return false;
    }
  },

  // ── The gate: financing approved + deposit submitted ──────────────────────
  async dealFor(b) {
    if (!b?.client_id && !b?.client_name) return null;
    let q = db.from('pipeline').select('*').eq('agent_id', currentAgent.id).order('created_at', { ascending: false });
    q = b.client_id ? q.eq('client_id', b.client_id) : q.eq('client_name', b.client_name);
    const { data } = await q;
    return (data || []).find(r => r.deal_type === 'new_build') || (data || [])[0] || null;
  },

  gate(b, deal) {
    const fs = deal && typeof Pipeline !== 'undefined' ? Pipeline.conditionState(deal, 'financing') : null;
    const financing = !!deal && deal.stage !== 'Fell Through' && (fs === 'cleared' || fs === 'none');
    const deposit = !!(b.deposit_submitted_at || ['Paid', 'Waived'].includes(b.deposit_status) || deal?.deposit_paid);
    return { financing, deposit, open: financing && deposit && b.status !== 'Offer Submitted' && !!b.pa_accepted_date };
  },

  async markDeposit(buildId) {
    const b = (NewBuilds.all || []).find(x => x.id === buildId);
    if (!b) return;
    const now = new Date().toISOString();
    const { error } = await db.from('new_builds').update({ deposit_submitted_at: now, deposit_status: 'Paid', updated_at: now }).eq('id', buildId);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    Object.assign(b, { deposit_submitted_at: now, deposit_status: 'Paid' });
    const deal = await VendorMail.dealFor(b);
    if (deal && !deal.deposit_paid) { await db.from('pipeline').update({ deposit_paid: true, updated_at: now }).eq('id', deal.id); deal.deposit_paid = true; }
    VendorMail._builds[buildId] = { deal };
    await App.logActivity('DEPOSIT_SUBMITTED', b.client_name, null, `Deposit submitted to ${b.builder_name || 'the builder'} for ${b.lot_address || 'the build'}`, b.client_id || null);
    App.toast('💰 Deposit submitted', 'var(--green)');
    const n = await VendorMail.checkGate(buildId);
    if (!n && !VendorMail.gate(b, deal).financing) App.toast('Vendor emails go to Approvals once financing is approved.', 'var(--text2)');
    if (typeof BuildSelections !== 'undefined') BuildSelections.paint(NewBuilds.all || []);
  },

  // Pipeline.confirmCondition / waive call this when financing clears
  async onFinancingCleared(dealId) {
    const { data: deal } = await db.from('pipeline').select('client_id, client_name').eq('id', dealId).maybeSingle();
    if (!deal) return 0;
    let q = db.from('new_builds').select('id').is('vendor_emails_released_at', null);
    q = deal.client_id ? q.eq('client_id', deal.client_id) : q.eq('client_name', deal.client_name);
    const { data: builds } = await q;
    let n = 0;
    for (const b of builds || []) n += await VendorMail.checkGate(b.id);
    return n;
  },

  // Catch-up when New Builds loads (no timer): a build whose gate opened
  // somewhere this app did not see (e.g. financing answered from a phone alert).
  async checkAll(list) {
    for (const b of (list || []).filter(x => !x.vendor_emails_released_at && x.pa_accepted_date && x.status !== 'Offer Submitted' && x.status !== 'Complete'
                                             && (x.deposit_submitted_at || ['Paid', 'Waived'].includes(x.deposit_status)))) {
      await VendorMail.checkGate(b.id);
    }
  },

  async checkGate(buildId) {
    const { data: b, error } = await db.from('new_builds').select('*').eq('id', buildId).maybeSingle();
    if (error || !b || b.vendor_emails_released_at) return 0;
    const deal = await VendorMail.dealFor(b);
    if (!VendorMail.gate(b, deal).open) return 0;
    // Claim it once, so two devices never draft the emails twice
    const { data: claimed } = await db.from('new_builds').update({ vendor_emails_released_at: new Date().toISOString() })
      .eq('id', buildId).is('vendor_emails_released_at', null).select('id');
    if (!claimed?.length) return 0;
    await VendorMail.fillFromBook(buildId);
    const { data: sels } = await db.from('build_selections').select('*').eq('build_id', buildId);
    const due = (sels || []).filter(s => s.status !== 'done' && !s.vendor_queued_at && s.kind !== 'price_match');
    const ready = due.filter(s => VendorMail.emailOk(s.vendor_email));
    const sent = [];
    for (const s of ready) if (await VendorMail.draft(b, s, { quiet: true })) sent.push(s);
    if (sent.length) await VendorMail.headsUp(b, sent);
    const missing = due.length - ready.length;
    App.toast(`📬 Financing and deposit are done. ${sent.length} vendor email${sent.length === 1 ? '' : 's'} in Approvals${missing ? `. ${missing} selection${missing === 1 ? ' needs' : 's need'} a vendor email address` : ''}.`, 'var(--green)');
    if (typeof BuildSelections !== 'undefined') BuildSelections.paint(NewBuilds.all || []);
    return sent.length;
  },

  // ── Drafting ──────────────────────────────────────────────────────────────
  _b64(buf) {
    const bytes = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },

  async _file(path, name) {
    const { data: blob, error } = await db.storage.from('client-docs').download(path);
    if (error || !blob) { console.warn('[VendorMail] attachment skipped:', name, error?.message); return null; }
    return { filename: name, mime_type: blob.type || 'application/pdf', data: VendorMail._b64(await blob.arrayBuffer()) };
  },

  // Draft one vendor email into Approvals. opts.floorPlan (default true when
  // the build has one), opts.files (extra [{path,name}] already uploaded).
  async draft(b, s, { quiet = false, floorPlan = true, quote = false } = {}) {
    if (!VendorMail.emailOk(s.vendor_email)) { if (!quiet) App.toast('⚠️ Add the vendor email first', 'var(--yellow)'); return false; }
    const { client, cc } = await BuildSelections._recipient(b);
    const ccList = [client.email, ...String(cc || '').split(',')].map(x => String(x || '').trim()).filter(VendorMail.emailOk);
    const files = [];
    const labels = [];
    if (floorPlan && b.floor_plan_path) {
      const f = await VendorMail._file(b.floor_plan_path, b.floor_plan_name || 'Floor plan.pdf');
      if (f) { files.push(f); labels.push('floor plan'); }
    }
    for (const x of (s.vendor_files || [])) {
      const f = await VendorMail._file(x.path, x.name);
      if (f) { files.push(f); labels.push(String(x.name || 'file').replace(/\.[a-z0-9]+$/i, '')); }
    }
    const t = Notify.templates.vendor_selection_request(client, b, s, currentAgent, { quote, files: labels });
    const ok = await Notify.queue(VendorMail.TYPE, b.client_id || null, `${s.vendor_name || 'Vendor'} (${client.full_name || b.client_name})`,
      s.vendor_email.trim(), t.subject, t.body, b.id, null, null, [...new Set(ccList)].join(', ') || null,
      files.length ? files : null, null, { selection_id: s.id, vendor: true });
    if (ok === false) return false;
    const now = new Date().toISOString();
    const { data: q } = await db.from('approval_queue').select('id').eq('related_id', b.id).eq('approval_type', VendorMail.TYPE)
      .eq('context_data->>selection_id', s.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    await db.from('build_selections').update({ vendor_queued_at: now, vendor_approval_id: q?.id || null, updated_at: now }).eq('id', s.id);
    await App.logActivity('VENDOR_EMAIL_DRAFTED', b.client_name, s.vendor_email,
      `${quote ? 'Quote request' : s.item + ' email'} to ${s.vendor_name || s.vendor_email} drafted for approval`, b.client_id || null);
    return true;
  },

  async headsUp(b, sels) {
    const { client, cc } = await BuildSelections._recipient(b);
    if (!client.email) return false;
    const t = Notify.templates.vendor_contacted_client(client, b, sels, currentAgent);
    return Notify.queue(VendorMail.CLIENT_TYPE, client.id || null, client.full_name, client.email, t.subject, t.body, b.id, null, null, cc);
  },

  // ── Compose window: Email vendor / Different vendor ──────────────────────
  // mode: 'send' (this selection's vendor) | 'quote' (a different vendor)
  openCompose(buildId, selId, mode = 'send') {
    const b = (NewBuilds.all || []).find(x => x.id === buildId);
    const s = (BuildSelections._byBuild[buildId] || []).find(x => x.id === selId);
    if (!b || !s) return;
    const quote = mode === 'quote';
    const v = k => VendorMail.esc(quote ? '' : (s[k] || ''));
    const g = VendorMail.gate(b, VendorMail._builds[buildId]?.deal);
    VendorMail._pending = [];
    App.openModal(`
      <div class="modal-title">${quote ? `🔁 Ask a different vendor: ${VendorMail.esc(s.item)}` : `✉️ Email the ${VendorMail.esc(String(s.item).toLowerCase())} vendor`}</div>
      ${!quote && !g.open ? `<div style="font-size:12px;color:var(--yellow);margin-bottom:12px;line-height:1.5;">${!g.financing && !g.deposit ? 'Financing is not approved and the deposit is not submitted yet.' : !g.financing ? 'Financing is not approved yet.' : 'The deposit is not submitted yet.'} You can still send this one now.</div>` : ''}
      <div class="form-row">
        <div class="form-group"><label class="form-label">VENDOR *</label>
          <input class="form-input" id="vm-name" value="${v('vendor_name')}" placeholder="e.g. Kent Flooring Centre" onchange="VendorMail.lookup()"></div>
        <div class="form-group"><label class="form-label">VENDOR EMAIL *</label>
          <input class="form-input" id="vm-email" type="email" value="${v('vendor_email')}" placeholder="vendor@example.com"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">PHONE</label><input class="form-input" id="vm-phone" value="${v('vendor_phone')}"></div>
        <div class="form-group"><label class="form-label">SHOWROOM ADDRESS</label><input class="form-input" id="vm-address" value="${v('vendor_address')}"></div>
      </div>
      <div class="form-group"><label class="form-label">WHAT THE CLIENTS WANT (OPTIONAL, GOES IN THE EMAIL)</label>
        <textarea class="form-input" id="vm-note" rows="2" placeholder="e.g. Light oak hardwood on the main floor, grey tile in both bathrooms">${VendorMail.esc(s.vendor_note || '')}</textarea></div>
      <div style="font-size:12.5px;margin-bottom:10px;">
        <div style="font-weight:700;margin-bottom:6px;">📎 Attachments</div>
        ${b.floor_plan_path
          ? `<label style="display:flex;gap:8px;align-items:center;margin-bottom:6px;"><input type="checkbox" id="vm-fp" checked style="width:16px;height:16px;"> 📐 ${VendorMail.esc(b.floor_plan_name || 'Floor plan.pdf')} <span style="color:var(--text2);">(floor plan pages only)</span></label>`
          : `<div style="color:var(--text2);margin-bottom:6px;">No floor plan on file. Attach one below and tick "use for every vendor".</div>`}
        ${(quote ? [] : (s.vendor_files || [])).map((f, i) => `<label style="display:flex;gap:8px;align-items:center;margin-bottom:6px;"><input type="checkbox" id="vm-old-${i}" checked style="width:16px;height:16px;"> ${VendorMail.esc(f.name)}</label>`).join('')}
        <div id="vm-new-files"></div>
        <input type="file" id="vm-file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx,.xlsx" style="font-size:12px;" onchange="VendorMail.addFiles(event)">
        ${!b.floor_plan_path ? `<label style="display:flex;gap:8px;align-items:center;margin-top:6px;"><input type="checkbox" id="vm-fp-save" style="width:16px;height:16px;"> Use the first file as the floor plan for every vendor on this build</label>` : ''}
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin-bottom:12px;"><input type="checkbox" id="vm-heads" ${quote ? '' : 'checked'} style="width:16px;height:16px;"> Also send the buyers a short heads-up</label>
      <div style="font-size:11.5px;color:var(--text2);margin-bottom:12px;line-height:1.5;">The buyers are copied so the vendor replies to everyone. It goes to Approvals first, nothing is sent until you approve it.</div>
      <button class="btn btn-primary btn-block" onclick="VendorMail.sendCompose('${buildId}','${selId}','${mode}')">📬 Put in Approvals</button>
      <div id="vm-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async lookup() {
    const name = document.getElementById('vm-name')?.value;
    const em = document.getElementById('vm-email');
    if (!name || !em || em.value) return;
    const { data } = await db.from('build_vendors').select('*').eq('name_key', VendorMail.key(name)).maybeSingle();
    if (!data) return;
    em.value = data.email || '';
    const ph = document.getElementById('vm-phone'); if (ph && !ph.value) ph.value = data.phone || '';
    const ad = document.getElementById('vm-address'); if (ad && !ad.value) ad.value = data.address || '';
  },

  addFiles(ev) {
    const list = Array.from(ev.target?.files || []).filter(f => f.size <= 15 * 1024 * 1024);
    VendorMail._pending = [...(VendorMail._pending || []), ...list];
    const box = document.getElementById('vm-new-files');
    if (box) box.innerHTML = VendorMail._pending.map(f => `<div style="margin-bottom:6px;">✅ ${VendorMail.esc(f.name)}</div>`).join('');
    ev.target.value = '';
  },

  async sendCompose(buildId, selId, mode) {
    const msg = document.getElementById('vm-msg');
    const say = (t, c = 'var(--red)') => { if (msg) { msg.style.color = c; msg.textContent = t; } };
    const val = id => document.getElementById(id)?.value.trim() || '';
    const name = val('vm-name'), email = val('vm-email');
    if (!name) return say('⚠️ Add the vendor name');
    if (!VendorMail.emailOk(email)) return say('⚠️ Add a valid vendor email');
    const b = (NewBuilds.all || []).find(x => x.id === buildId);
    const s = (BuildSelections._byBuild[buildId] || []).find(x => x.id === selId);
    if (!b || !s) return;
    say('⏳ Preparing…', 'var(--text2)');
    const quote = mode === 'quote';
    const user = await App.getAuthUser();
    const uid = user?.id || currentAgent.id;

    // Upload new files to the client folder so they stay on the record
    const uploaded = [];
    for (const f of VendorMail._pending || []) {
      const path = `${uid}/${b.client_id || buildId}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error } = await db.storage.from('client-docs').upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (error) return say('⚠️ ' + f.name + ': ' + error.message);
      if (b.client_id) await db.from('client_documents').insert({ agent_id: uid, client_id: b.client_id, category: 'vendor', source: 'new_build', file_path: path, file_name: f.name, file_size_bytes: f.size });
      uploaded.push({ path, name: f.name });
    }
    VendorMail._pending = [];
    if (uploaded.length && document.getElementById('vm-fp-save')?.checked) {
      await db.from('new_builds').update({ floor_plan_path: uploaded[0].path, floor_plan_name: uploaded[0].name }).eq('id', buildId);
      Object.assign(b, { floor_plan_path: uploaded[0].path, floor_plan_name: uploaded[0].name });
      uploaded.shift();
    }
    const kept = (quote ? [] : (s.vendor_files || [])).filter((_, i) => document.getElementById('vm-old-' + i)?.checked !== false);
    const files = [...kept, ...uploaded];
    const fields = { vendor_name: name, vendor_email: email, vendor_phone: val('vm-phone') || null,
                     vendor_address: val('vm-address') || null, vendor_note: val('vm-note') || null, vendor_files: files.length ? files : null };

    let row;
    if (quote) {
      const { data, error } = await db.from('build_selections').insert({
        agent_id: uid, build_id: buildId, client_id: b.client_id || null, item: s.item, details: s.details,
        due_date: s.due_date, allowance: s.allowance || null, status: 'to_book', source: 'manual',
        kind: 'price_match', parent_id: s.id, ...fields,
      }).select().single();
      if (error) return say('⚠️ ' + error.message + (/column/.test(error.message) ? ' (run migration 117)' : ''));
      row = data;
    } else {
      const { error } = await db.from('build_selections').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', selId);
      if (error) return say('⚠️ ' + error.message + (/column/.test(error.message) ? ' (run migration 117)' : ''));
      row = { ...s, ...fields };
    }
    await VendorMail.remember({ name, email, phone: fields.vendor_phone, address: fields.vendor_address });
    const useFp = !!b.floor_plan_path && document.getElementById('vm-fp')?.checked !== false;
    const heads = document.getElementById('vm-heads')?.checked;
    if (!await VendorMail.draft(b, row, { floorPlan: useFp, quote })) return say('⚠️ Could not queue the email');
    if (heads) await VendorMail.headsUp(b, [row]);
    App.closeModal();
    App.toast(`📬 ${quote ? 'Quote request' : 'Vendor email'} is in Approvals`, 'var(--green)');
    BuildSelections.paint(NewBuilds.all || []);
  },

  // ── Track record ──────────────────────────────────────────────────────────
  // One pass per paint: the approvals of these selections + vendor replies in
  // the inbox. Sent / replied times are written back once, so later loads are cheap.
  async track(rows) {
    const out = {};
    const live = (rows || []).filter(r => r.vendor_queued_at);
    if (!live.length) { VendorMail._track = out; return out; }
    const ids = live.map(r => r.vendor_approval_id).filter(Boolean);
    const { data: aq } = ids.length
      ? await db.from('approval_queue').select('id, status, updated_at').in('id', ids) : { data: [] };
    const emails = [...new Set(live.map(r => String(r.vendor_email || '').toLowerCase()).filter(Boolean))];
    const since = live.map(r => r.vendor_queued_at).sort()[0];
    const { data: inbox } = emails.length
      ? await db.from('email_inbox').select('direction, sender_email, recipient_email, gmail_thread_id, created_at')
          .gte('created_at', since).or(emails.map(e => `sender_email.ilike.${e},recipient_email.ilike.${e}`).join(','))
          .order('created_at', { ascending: true }).limit(500)
      : { data: [] };
    for (const r of live) {
      const em = String(r.vendor_email || '').toLowerCase();
      const a = (aq || []).find(x => x.id === r.vendor_approval_id) || null;
      const sentRow = (inbox || []).find(m => m.direction === 'sent' && String(m.recipient_email).toLowerCase() === em && m.created_at >= r.vendor_queued_at);
      const sentAt = r.vendor_sent_at || sentRow?.created_at || (a?.status === 'Approved' ? a.updated_at : null);
      const reply = sentAt ? (inbox || []).find(m => m.direction === 'received' && m.created_at > sentAt
        && (String(m.sender_email).toLowerCase() === em || (sentRow?.gmail_thread_id && m.gmail_thread_id === sentRow.gmail_thread_id))) : null;
      const repliedAt = r.vendor_replied_at || reply?.created_at || null;
      out[r.id] = { approval: a?.status || null, sentAt, repliedAt };
      const upd = {};
      if (sentAt && !r.vendor_sent_at) upd.vendor_sent_at = sentAt;
      if (repliedAt && !r.vendor_replied_at) upd.vendor_replied_at = repliedAt;
      if (Object.keys(upd).length) { Object.assign(r, upd); db.from('build_selections').update(upd).eq('id', r.id).then(() => {}); }
    }
    VendorMail._track = out;
    return out;
  },

  // "Drafted Nov 3 → Sent Nov 3 → Replied Nov 4 → Booked Nov 12 → Done"
  trailHtml(r) {
    if (!r.vendor_queued_at) return '';
    const t = VendorMail._track[r.id] || {};
    const d = x => App.fmtDate(String(x).slice(0, 10));
    const steps = [];
    if (t.approval === 'Skipped') steps.push(`<span style="color:var(--text2);">Email skipped in Approvals</span>`);
    else if (t.sentAt) steps.push(`Emailed ${d(t.sentAt)}`);
    else steps.push(`<span style="color:var(--yellow);">Waiting in Approvals</span>`);
    if (t.repliedAt) steps.push(`<span style="color:var(--green);">Replied ${d(t.repliedAt)}</span>`);
    else if (t.sentAt) steps.push(`<span style="color:var(--text2);">No reply yet</span>`);
    if (r.appointment_date) steps.push(`Booked ${d(r.appointment_date)}`);
    if (r.status === 'done') steps.push(`<span style="color:var(--green);">Done</span>`);
    return `<div style="font-size:11px;color:var(--text2);margin-top:2px;">✉️ ${steps.join(' → ')}</div>`;
  },

  // Card banner above the selections: where the gate stands, and the deposit button
  gateHtml(b) {
    const deal = VendorMail._builds[b.id]?.deal;
    if (b.vendor_emails_released_at) return '';
    if (b.status === 'Offer Submitted' || !b.pa_accepted_date) return '';
    const g = VendorMail.gate(b, deal);
    const tick = (ok, label) => `<span style="color:${ok ? 'var(--green)' : 'var(--text2)'};">${ok ? '✅' : '⏳'} ${label}</span>`;
    return `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:7px 10px;border-top:1px solid var(--border);font-size:11.5px;">
      <span style="font-weight:700;">Vendor emails wait for:</span>
      ${tick(g.financing, 'Financing approved')} ${tick(g.deposit, 'Deposit submitted')}
      ${g.deposit ? '' : `<button class="btn btn-outline btn-sm" style="font-size:10.5px;padding:2px 8px;margin-left:auto;" onclick="VendorMail.markDeposit('${b.id}')">💰 Deposit submitted</button>`}
    </div>`;
  },

  // ── Re-read the APS already on file ───────────────────────────────────────
  // For a build uploaded before vendor emails existed: reads the filed APS
  // again, fills in vendor emails / phones / addresses / allowances that are
  // missing (never overwrites what Maxwell typed), adds any selection that is
  // not on the card yet (never a duplicate), and cuts the floor plan pages.
  _same(a, b) {
    const w = x => String(x || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !['the','and','selection','selections','pickup','pick'].includes(t));
    const A = w(a), B = w(b);
    return A.some(t => B.some(u => u.startsWith(t.slice(0, 5)) || t.startsWith(u.slice(0, 5))));
  },

  _lastRead: {},   // build id -> { ok, html } shown on the card after a re-read

  _note(buildId, ok, text) {
    VendorMail._lastRead[buildId] = { ok, text };
    App.toast((ok ? '✅ ' : '⚠️ ') + text, ok ? 'var(--green)' : 'var(--yellow)');
    if (typeof BuildSelections !== 'undefined') BuildSelections.paintOne(buildId);
  },

  _timeout(p, secs, what) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took longer than ${secs} seconds. Try again in a minute.`)), secs * 1000))]);
  },

  async rereadAps(buildId) {
    if (VendorMail._rereading) { App.toast('📄 Still reading the APS, one moment…', 'var(--accent2)'); return; }
    const b = (NewBuilds.all || []).find(x => x.id === buildId);
    if (!b) { App.toast('⚠️ Build not found. Reload the page and try again.', 'var(--yellow)'); return; }
    VendorMail._rereading = true;
    // Show it is working straight away, before anything is fetched
    VendorMail._lastRead[buildId] = { ok: true, text: 'Looking for the signed APS…' };
    BuildSelections.paintOne(buildId);
    try {
      // A build saved without its client link: find the client by name and link it,
      // so the APS can be found and the vendor emails can copy the buyers
      if (!b.client_id && b.client_name) {
        const { data: cs } = await db.from('clients').select('id, full_name').eq('agent_id', currentAgent.id).ilike('full_name', b.client_name.trim());
        if (cs?.length === 1) {
          await db.from('new_builds').update({ client_id: cs[0].id, updated_at: new Date().toISOString() }).eq('id', buildId);
          b.client_id = cs[0].id;
        }
      }
      if (!b.client_id) return VendorMail._note(buildId, false, `No client named ${b.client_name || 'on this build'} found. Pick the client in Edit Details, then tap Re-read again.`);
      // The APS in the client folder, else the accepted offer on the Pipeline deal
      let bucket = 'client-docs';
      let { data: doc } = await db.from('client_documents').select('file_path, file_name')
        .eq('client_id', b.client_id).eq('category', 'aps').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!doc?.file_path) {
        const deal = await VendorMail.dealFor(b);
        if (deal) {
          ({ data: doc } = await db.from('deal_documents').select('file_path, file_name')
            .eq('pipeline_id', deal.id).eq('doc_type', 'accepted_offer').order('created_at', { ascending: false }).limit(1).maybeSingle());
          bucket = 'deal-docs';
        }
      }
      if (!doc?.file_path) return VendorMail._note(buildId, false, 'No signed APS on file for this client. Add the selections with "+ Add selection", or upload the APS to the client folder.');
      VendorMail._lastRead[buildId] = { ok: true, text: `Reading ${doc.file_name || 'the APS'}… this takes about 20 seconds.` };
      BuildSelections.paintOne(buildId);
      const { data: blob, error: dlErr } = await VendorMail._timeout(db.storage.from(bucket).download(doc.file_path), 45, 'Opening the APS');
      if (dlErr || !blob) throw new Error(dlErr?.message || 'could not open the file');
      const file = new File([blob], doc.file_name || 'APS.pdf', { type: 'application/pdf' });
      const x = await VendorMail._timeout(ApsDrop.extract(file, {
        schema: ApsDrop.APPENDIX_SCHEMA, effort: 'low', max_tokens: 8000,
        prompt: "List every selection the buyers must make themselves from the builder's appendix / schedules (flooring, cabinets, countertops, tile, lighting, colours...), with the vendor's name, email, phone, address, allowance, what to choose and the deadline, and the page numbers of any floor plan. Ignore everything else.",
      }), 150, 'Reading the APS');

      const { data: have } = await db.from('build_selections').select('*').eq('build_id', buildId);
      const rows = (have || []).filter(r => r.kind !== 'price_match');
      let filled = 0, added = 0;
      const toAdd = [];
      for (const sel of (x.selections || []).filter(r => r.item)) {
        const f = VendorMail.vendorFields(sel);
        const match = rows.find(r => VendorMail._same(r.item, sel.item));
        if (!match) { toAdd.push(sel); continue; }
        const upd = {};
        for (const k of ['vendor_email', 'vendor_phone', 'vendor_address', 'allowance']) if (f[k] && !match[k]) upd[k] = f[k];
        if (sel.vendor_name && !match.vendor_name) upd.vendor_name = sel.vendor_name;
        if (sel.vendor_contact && !match.vendor_contact) upd.vendor_contact = sel.vendor_contact;
        if (sel.details && !match.details) upd.details = sel.details;
        if (/^\d{4}-\d{2}-\d{2}$/.test(sel.due_date || '') && !match.due_date) upd.due_date = sel.due_date;
        if (!Object.keys(upd).length) continue;
        const { error } = await db.from('build_selections').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', match.id);
        if (error) throw new Error(error.message + (/column/.test(error.message) ? ' (run migration 117)' : ''));
        filled++;
      }
      if (toAdd.length) added = await BuildSelections.saveFromAps(buildId, b.client_id, toAdd);
      const pages = (x.floor_plan_pages || []).filter(n => Number.isInteger(n) && n > 0);
      let plan = false;
      if (!b.floor_plan_path && pages.length) {
        plan = await VendorMail.saveFloorPlan(buildId, b.client_id, file, pages);
        if (plan) { const { data: nb } = await db.from('new_builds').select('floor_plan_path, floor_plan_name').eq('id', buildId).maybeSingle(); if (nb) Object.assign(b, nb); }
      }
      await VendorMail.fillFromBook(buildId);
      const found = (x.selections || []).filter(r => r.item).length;
      const parts = [`Read ${doc.file_name || 'the APS'}: ${found ? `${found} selection${found === 1 ? '' : 's'} in the appendix` : 'no buyer selections found in it'}`];
      if (filled) parts.push(`vendor details added to ${filled} selection${filled === 1 ? '' : 's'}`);
      if (added) parts.push(`${added} new selection${added === 1 ? '' : 's'} added`);
      if (plan) parts.push('floor plan saved');
      else if (!b.floor_plan_path && !pages.length) parts.push('no floor plan found in the APS, attach one when you email a vendor');
      if (!found) parts.push('add them with "+ Add selection"');
      if (toAdd.length && !added) parts.push('the new selections could not be saved');
      await BuildSelections.paint(NewBuilds.all || []);
      VendorMail._note(buildId, !!found && !(toAdd.length && !added), parts.join(', ') + '.');
    } catch (e) {
      console.warn('[VendorMail] re-read failed:', e?.message || e);
      VendorMail._note(buildId, false, 'Could not re-read the APS: ' + (e?.message || 'unknown error'));
    } finally {
      VendorMail._rereading = false;
    }
  },

  // Called from BuildSelections.paint with the builds on screen
  async prime(list) {
    for (const b of list || []) {
      if (b.vendor_emails_released_at || b.status === 'Offer Submitted' || !b.pa_accepted_date) continue;
      if (VendorMail._builds[b.id]) continue;
      VendorMail._builds[b.id] = { deal: await VendorMail.dealFor(b) };
    }
  },
};
