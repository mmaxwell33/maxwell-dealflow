// Maxwell DealFlow CRM — Listings (Seller Pipeline), Phase 1+2
// Phase 1: listings board — each seller property as a card with lifecycle bar,
//          listed / offer-deadline / target-sold dates, MLS#, asking price.
// Phase 2: offer bidding board — log competing offers (auto-numbered), end
//          bidding, auto-rank vs asking price with % over/under.
// Listings rows are auto-created when a seller is added from their intake form
// (see extras.js addFromIntake) — this screen makes them visible and workable.

const Listings = {
  all: [],
  _offers: {},   // listing_id -> [offers]

  STATUS_FLOW: ['pre_listing','cma_delivered','agreement_signed','prep','active','under_contract','sold'],
  STATUS_LABEL: {
    pre_listing:      'Pre-Listing',
    cma_delivered:    'CMA Delivered',
    agreement_signed: 'Agreement Signed',
    prep:             'Prep',
    active:           'Active on MLS',
    under_contract:   'Under Contract',
    sold:             'Sold',
    withdrawn:        'Withdrawn',
  },

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  money(n) { return (typeof App !== 'undefined' && App.fmtMoney) ? App.fmtMoney(n || 0) : '$' + Number(n || 0).toLocaleString(); },
  fmtD(d) { return d ? ((typeof App !== 'undefined' && App.fmtDate) ? App.fmtDate(d) : String(d).slice(0, 10)) : '—'; },

  async load() {
    if (!currentAgent?.id) return;
    const el = document.getElementById('listings-list');
    if (!el) return;
    const { data, error } = await db.from('listings')
      .select('*, clients(full_name, email)')
      .eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    if (error) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Listings unavailable</div><div class="empty-sub">${Listings.esc(error.message)} — check migrations 038 + 058 ran in Supabase.</div></div>`;
      return;
    }
    Listings.all = data || [];
    Listings._offers = {};
    const ids = Listings.all.map(l => l.id);
    if (ids.length) {
      const { data: offs, error: offErr } = await db.from('listing_offers')
        .select('*').in('listing_id', ids).order('offer_no', { ascending: true });
      if (offErr) console.warn('[Listings] listing_offers unavailable (run migration 058):', offErr.message);
      (offs || []).forEach(o => { (Listings._offers[o.listing_id] = Listings._offers[o.listing_id] || []).push(o); });
      // Showings on these listings (migration 091) — non-fatal if not migrated yet.
      if (typeof Showings !== 'undefined') await Showings.loadFor(ids);
    }
    Listings.render();
  },

  render() {
    const el = document.getElementById('listings-list');
    if (!el) return;
    if (!Listings.all.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🏷️</div><div class="empty-text">No listings yet</div><div class="empty-sub">When a seller submits their intake form and you add them as a client, their property appears here automatically.</div></div>`;
      return;
    }
    el.innerHTML = Listings.deadlineBanner() + Listings.all.map(l => Listings.card(l)).join('');
  },

  // ── Offer deadline watcher ────────────────────────────────────────────────
  // An offer review deadline that only sits on a card is a deadline you find
  // out about afterwards. Anything landing within 3 days shows a banner at the
  // top of the board and offers a seller email, DRAFTED not sent: it goes to
  // Approvals like everything else, where it can be edited before it leaves.
  DEADLINE_WINDOW_DAYS: 3,

  _daysUntil(d) {
    if (!d) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const x = new Date(String(d).slice(0, 10) + 'T00:00:00');
    return Math.round((x - t) / 86400000);
  },

  dueSoon() {
    return Listings.all.filter(l => {
      if (['sold', 'withdrawn'].includes(l.listing_status)) return false;
      if (l.bidding_closed_at) return false;   // already reviewing, no nudge needed
      const n = Listings._daysUntil(l.offer_review_deadline);
      return n !== null && n >= 0 && n <= Listings.DEADLINE_WINDOW_DAYS;
    });
  },

  deadlineBanner() {
    const due = Listings.dueSoon();
    if (!due.length) return '';
    return due.map(l => {
      const n = Listings._daysUntil(l.offer_review_deadline);
      const when = n === 0 ? 'TODAY' : n === 1 ? 'TOMORROW' : `in ${n} days`;
      const nOffers = (Listings._offers[l.id] || []).length;
      return `
        <div style="background:rgba(234,179,8,0.12);border:1px solid var(--yellow);border-radius:10px;padding:12px 14px;margin-bottom:14px;">
          <div style="font-size:13px;font-weight:800;color:var(--yellow);margin-bottom:4px;">⏰ Offer review ${when} — ${Listings.esc(l.property_address)}</div>
          <div style="font-size:12.5px;color:var(--text2);margin-bottom:9px;">
            ${Listings.fmtD(l.offer_review_deadline)} · ${nOffers} offer${nOffers === 1 ? '' : 's'} logged${typeof Showings !== 'undefined' ? ` · ${Showings.countSince(l.id, 7)} showing${Showings.countSince(l.id, 7) === 1 ? '' : 's'} in the last 7 days` : ''}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm" style="background:var(--accent);color:#fff;" onclick="Listings.draftDeadlineEmail('${l.id}')">✍️ Draft seller email</button>
            <button class="btn btn-outline btn-sm" onclick="Listings.setDates('${l.id}')">📅 Move the date</button>
          </div>
        </div>`;
    }).join('');
  },

  // Background check — runs on an interval from app.js, so the nudge arrives
  // even when the Listings tab is closed. Pushes once per listing per day.
  async checkDeadlines() {
    if (!currentAgent?.id) return;
    // Local calendar dates, not UTC — see Showings._localISO for why.
    const localISO = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const today = localISO(new Date());
    const limit = new Date(); limit.setDate(limit.getDate() + Listings.DEADLINE_WINDOW_DAYS);
    const { data, error } = await db.from('listings')
      .select('id, property_address, offer_review_deadline, offer_deadline_alert_at, listing_status, bidding_closed_at')
      .eq('agent_id', currentAgent.id)
      .not('offer_review_deadline', 'is', null)
      .gte('offer_review_deadline', today)
      .lte('offer_review_deadline', localISO(limit));
    if (error || !data?.length) return;
    for (const l of data) {
      if (['sold', 'withdrawn'].includes(l.listing_status) || l.bidding_closed_at) continue;
      // Once a day at most
      if (l.offer_deadline_alert_at && (Date.now() - new Date(l.offer_deadline_alert_at).getTime()) < 20 * 3600 * 1000) continue;
      const n = Listings._daysUntil(l.offer_review_deadline);
      const when = n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
      if (App.pushNotify) App.pushNotify('⏰ Offer review ' + when, l.property_address, 'listings');
      await db.from('listings').update({ offer_deadline_alert_at: new Date().toISOString() }).eq('id', l.id);
    }
  },

  // Drafts the "we review offers on X" note to the seller. Queued to Approvals,
  // never sent from here — Approvals has Edit Email for the final wording.
  async draftDeadlineEmail(listingId) {
    const l = Listings.all.find(x => x.id === listingId);
    if (!l) return;
    const sellerEmail = l.clients?.email;
    if (!sellerEmail) { App.toast('⚠️ This seller has no email on file — add it on their client record first', 'var(--red)'); return; }
    if (typeof Notify === 'undefined' || !Notify.queue) { App.toast('⚠️ Email system not loaded — reload and retry', 'var(--red)'); return; }

    const first = (l.clients?.full_name || 'there').split(' ')[0];
    const n = Listings._daysUntil(l.offer_review_deadline);
    const when = n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
    const nOffers = (Listings._offers[listingId] || []).length;
    const nShow = (typeof Showings !== 'undefined') ? Showings.countSince(listingId, 7) : 0;

    const body =
      `Hi ${first},\n\n` +
      `A quick note that we review offers on ${l.property_address} ${when}, on ${Listings.fmtD(l.offer_review_deadline)}.\n\n` +
      `Where things stand right now:\n` +
      `  • ${nOffers} offer${nOffers === 1 ? '' : 's'} received so far\n` +
      (nShow ? `  • ${nShow} showing${nShow === 1 ? '' : 's'} in the last 7 days\n` : '') +
      `\nOn the day I will walk you through every offer side by side, the price alongside the conditions and the deposit, so you can see the whole picture before you decide anything. Nothing gets accepted or declined without you.\n\n` +
      `If you would like to talk before then, call me any time.\n\n` +
      `Best regards,\n` +
      ((typeof EmailFormat !== 'undefined' && EmailFormat.signaturePlain) ? EmailFormat.signaturePlain(currentAgent) : (currentAgent?.full_name || 'Maxwell Delali Midodzi')) +
      ((typeof EmailFormat !== 'undefined' && EmailFormat.disclaimerPlain) ? EmailFormat.disclaimerPlain() : '');

    const ok = await Notify.queue('Offer Review Reminder', l.client_id,
      l.clients?.full_name || 'Seller', sellerEmail,
      `Offer review ${when} for ${l.property_address}`, body, l.id);
    if (ok) {
      App.toast('✍️ Draft queued — open Approvals to edit and send', 'var(--green)');
      if (App.pushNotify) App.pushNotify('✍️ Seller draft ready', l.property_address, 'approvals');
    } else {
      App.toast('⚠️ Could not queue the draft', 'var(--red)');
    }
  },

  // ── Lifecycle progress bar (7 fixed stages, labelled) ──
  // Reads as "Stage X of 7" with a name under every segment — NOT a % —
  // because "Active on MLS" is stage 5/7 and a naked "71%" made a freshly
  // listed property look almost sold.
  STAGE_SHORT: ['Pre-List','CMA','Agreement','Prep','Active','Contract','Sold'],
  stageBar(l) {
    if (l.listing_status === 'withdrawn') {
      return `<div style="font-size:12px;color:var(--red);font-weight:700;margin:8px 0;">◾ Withdrawn</div>`;
    }
    const idx = Math.max(0, Listings.STATUS_FLOW.indexOf(l.listing_status));
    const segs = Listings.STATUS_FLOW.map((s, i) => {
      const done = i < idx, cur = i === idx;
      const barBg = (done || cur) ? 'var(--accent)' : 'var(--bg2)';
      const lblStyle = cur
        ? 'color:var(--accent2);font-weight:800;'
        : done ? 'color:var(--text2);font-weight:500;'
               : 'color:var(--text2);opacity:0.45;font-weight:500;';
      return `<div style="flex:1;min-width:0;text-align:center;">
        <div style="height:8px;border-radius:99px;background:${barBg};margin:0 1.5px;"></div>
        <div style="font-size:9.5px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${lblStyle}">${cur ? '📍 ' : ''}${Listings.STAGE_SHORT[i]}</div>
      </div>`;
    }).join('');
    return `
      <div style="margin:10px 0 4px;">
        <div style="display:flex;align-items:flex-start;">${segs}</div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-top:5px;">
          <span><strong style="color:var(--accent2);">${Listings.STATUS_LABEL[l.listing_status] || l.listing_status}</strong></span>
          <span>Stage ${idx + 1} of ${Listings.STATUS_FLOW.length}</span>
        </div>
      </div>`;
  },

  // ── When bidding actually ends ────────────────────────────────────────────
  // Offers are not accepted up to midnight on the deadline date. They are
  // presented to the seller at a set time, and that instant is the close. So
  // bidding is closed once EITHER the agent closed it by hand, OR the
  // presentation time has arrived. Time is plain 'HH:MM' in local time and is
  // read as local here, which is what "2 PM" on a listing agreement means.
  presentationAt(l) {
    if (!l.offer_review_deadline) return null;
    const d = String(l.offer_review_deadline).slice(0, 10);
    const t = /^\d{1,2}:\d{2}$/.test(l.offer_review_time || '') ? l.offer_review_time : null;
    if (!t) return null;                       // date with no time never auto-closes
    const dt = new Date(`${d}T${t.padStart(5, '0')}:00`);
    return isNaN(dt.getTime()) ? null : dt;
  },

  biddingClosed(l) {
    if (l.bidding_closed_at) return true;
    const at = Listings.presentationAt(l);
    return !!at && Date.now() >= at.getTime();
  },

  fmtTime(t) {
    if (!/^\d{1,2}:\d{2}$/.test(t || '')) return '';
    const [h, m] = t.split(':');
    const H = parseInt(h, 10);
    return `${H % 12 === 0 ? 12 : H % 12}:${m} ${H >= 12 ? 'PM' : 'AM'}`;
  },

  // ── Offers section (Phase 2) ──
  offersSection(l) {
    const offers = Listings._offers[l.id] || [];
    const asking = Number(l.asking_price || l.list_price || 0);
    const closed = Listings.biddingClosed(l);
    const autoClosed = closed && !l.bidding_closed_at;
    let rows = '';
    if (!offers.length) {
      rows = `<div style="font-size:12px;color:var(--text2);padding:4px 0;">No offers logged yet.</div>`;
    } else if (!closed) {
      // Bidding open — show in the order received
      rows = offers.map(o => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <span>📄 Offer #${o.offer_no}${o.buyer_name ? ' · ' + Listings.esc(o.buyer_name) : ''}${o.conditions ? ' · <span style="color:var(--text2);font-size:11px;">' + Listings.esc(o.conditions) + '</span>' : ''}${o.document_path ? ` · <a href="javascript:void(0)" onclick="OfferDrop.openDoc('${Listings.esc(o.document_path)}')" style="font-size:11px;color:var(--accent2);">PDF</a>` : ''}</span>
          <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span class="fw-700">${Listings.money(o.amount)}</span>
            <button class="btn btn-outline btn-sm" style="padding:2px 7px;font-size:10.5px;" onclick="Listings.editOffer('${o.id}')">✏️</button>
            <button class="btn btn-outline btn-sm" style="padding:2px 7px;font-size:10.5px;border-color:var(--red);color:var(--red);" onclick="Listings.deleteOffer('${o.id}')">🗑</button>
          </span>
        </div>`).join('');
    } else {
      // Bidding closed — auto-rank highest → lowest with % vs asking.
      // Phase 4: each offer gets a "Pick Winner" button; once picked, the winner
      // is badged and the rest show as declined.
      const ranked = offers.slice().sort((a, b) => Number(b.amount) - Number(a.amount));
      const winner = offers.find(o => o.status === 'winner');
      rows = ranked.map((o, i) => {
        const pct = asking ? ((Number(o.amount) - asking) / asking * 100) : null;
        const pctTxt = pct === null ? '' :
          `<span style="font-size:11px;font-weight:700;color:${pct >= 0 ? 'var(--green)' : 'var(--red)'};">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs asking</span>`;
        const isWin = o.status === 'winner';
        const declined = !!winner && !isWin;
        const style = isWin ? 'background:rgba(34,197,94,0.14);border:1px solid var(--green);'
                    : (!winner && i === 0) ? 'background:rgba(34,197,94,0.08);border:1px solid var(--green);'
                    : 'background:var(--bg);' + (declined ? 'opacity:0.55;' : '');
        const tag = isWin ? '🏆 <strong style="color:var(--green);">WINNER</strong> · '
                  : declined ? '<span style="font-size:10px;color:var(--text2);font-weight:700;">DECLINED</span> · '
                  : `${i === 0 ? '🏆' : '#' + (i + 1)} `;
        const pickBtn = !winner
          ? `<button class="btn btn-sm" style="background:var(--green);color:#fff;padding:3px 9px;font-size:11px;flex-shrink:0;" onclick="Listings.pickWinner('${l.id}','${o.id}')">🏆 Pick</button>`
          : '';
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 8px;margin-bottom:4px;border-radius:8px;font-size:13px;${style}">
            <span>${tag}Offer #${o.offer_no}${o.buyer_name ? ' · ' + Listings.esc(o.buyer_name) : ''}${o.conditions ? ' · <span style="color:var(--text2);font-size:11px;">' + Listings.esc(o.conditions) + '</span>' : ''}${o.document_path ? ` · <a href="javascript:void(0)" onclick="OfferDrop.openDoc('${Listings.esc(o.document_path)}')" style="font-size:11px;color:var(--accent2);">PDF</a>` : ''}</span>
            <span style="display:flex;align-items:center;gap:8px;"><span style="text-align:right;"><span class="fw-800">${Listings.money(o.amount)}</span><br>${pctTxt}</span>
              ${winner ? '' : `<button class="btn btn-outline btn-sm" style="padding:2px 7px;font-size:10.5px;" onclick="Listings.editOffer('${o.id}')">✏️</button>`}${pickBtn}</span>
          </div>`;
      }).join('');
    }
    const hasWinner = offers.some(o => o.status === 'winner');
    const bidBtns = closed
      ? `<button class="btn btn-sm" style="background:var(--accent);color:#fff;" onclick="Listings.sendSnapshot('${l.id}')">📊 Send Seller Snapshot</button>
         ${hasWinner
           ? `<span style="font-size:11px;color:var(--green);font-weight:700;align-self:center;">✅ Winner picked — sell-side deal in Pipeline</span>`
           : `<button class="btn btn-outline btn-sm" onclick="Listings.reopenBidding('${l.id}')">↩︎ Reopen Bidding</button>`}`
      : `<button class="btn btn-sm" style="background:var(--accent);color:#fff;" onclick="Listings.addOffer('${l.id}')">➕ Log Offer</button>
         ${offers.length ? `<button class="btn btn-outline btn-sm" style="border-color:var(--yellow);color:var(--yellow);" onclick="Listings.endBidding('${l.id}')">🔨 End Bidding & Rank</button>` : ''}`;
    return `
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-size:12px;font-weight:800;letter-spacing:0.04em;color:var(--text2);">OFFERS (${offers.length})${closed ? ' · <span style="color:var(--yellow);">BIDDING CLOSED, RANKED</span>' : ''}</div>
        </div>
        ${autoClosed ? `<div style="font-size:11.5px;color:var(--yellow);margin-bottom:6px;">⏰ Closed automatically at the presentation time${l.offer_review_time ? ', ' + Listings.fmtTime(l.offer_review_time) : ''}. Move the date or time to take more offers.</div>` : ''}
        ${rows}
        ${closed ? '' : (typeof OfferDrop !== 'undefined' ? OfferDrop.zone(l.id) : '')}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">${bidBtns}</div>
      </div>`;
  },

  // ── Edit / delete a logged offer ──────────────────────────────────────────
  // Anything read off a PDF or typed in a hurry can be wrong. Every field on a
  // logged offer stays editable right up until a winner is picked.
  editOffer(offerId) {
    let o = null, listingId = null;
    Object.keys(Listings._offers).forEach(lid => {
      const f = (Listings._offers[lid] || []).find(x => x.id === offerId);
      if (f) { o = f; listingId = lid; }
    });
    if (!o) return;
    const l = Listings.all.find(x => x.id === listingId);
    const d = v => v ? String(v).slice(0, 10) : '';
    App.openModal(`
      <div class="modal-title">✏️ Edit Offer #${o.offer_no}${l ? ' — ' + Listings.esc(l.property_address) : ''}</div>
      ${o.document_name ? `<div style="font-size:12px;color:var(--text2);margin-bottom:12px;">Read from ${Listings.esc(o.document_name)}${o.document_path ? ` · <a href="javascript:void(0)" onclick="OfferDrop.openDoc('${Listings.esc(o.document_path)}')" style="color:var(--accent2);">open the PDF</a>` : ''}</div>` : ''}
      <div class="form-row">
        <div class="form-group"><label class="form-label">Offer Amount ($) *</label>
          <input class="form-input" type="number" id="oe-amount" value="${o.amount || ''}"></div>
        <div class="form-group"><label class="form-label">Deposit ($)</label>
          <input class="form-input" type="number" id="oe-deposit" value="${o.deposit || ''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Buyer</label>
          <input class="form-input" id="oe-buyer" value="${Listings.esc(o.buyer_name || '')}"></div>
        <div class="form-group"><label class="form-label">Buyer's Agent</label>
          <input class="form-input" id="oe-agent" value="${Listings.esc(o.buyer_agent || '')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Agent Email</label>
          <input class="form-input" type="email" id="oe-agent-email" value="${Listings.esc(o.buyer_agent_email || '')}"></div>
        <div class="form-group"><label class="form-label">Brokerage</label>
          <input class="form-input" id="oe-brokerage" value="${Listings.esc(o.brokerage || '')}"></div>
      </div>
      <div class="form-group"><label class="form-label">Conditions</label>
        <input class="form-input" id="oe-cond" value="${Listings.esc(o.conditions || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Inspection deadline</label>
          <input class="form-input" type="date" id="oe-insp" value="${d(o.inspection_date)}"></div>
        <div class="form-group"><label class="form-label">Financing deadline</label>
          <input class="form-input" type="date" id="oe-fin" value="${d(o.financing_date)}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Closing date</label>
          <input class="form-input" type="date" id="oe-close" value="${d(o.closing_date)}"></div>
        <div class="form-group"><label class="form-label">Irrevocable until</label>
          <input class="form-input" id="oe-irrev" value="${Listings.esc(o.irrevocable_until || '')}"></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Listings.saveOfferEdit('${offerId}')">Save Offer #${o.offer_no}</button>
      <div id="oe-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async saveOfferEdit(offerId) {
    const msg = document.getElementById('oe-msg');
    const amount = parseFloat(document.getElementById('oe-amount')?.value);
    if (!amount || amount <= 0) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Offer amount is required'; } return; }
    const val = id => document.getElementById(id)?.value.trim() || null;
    const patch = {
      amount,
      deposit: parseFloat(document.getElementById('oe-deposit')?.value) || null,
      buyer_name:        val('oe-buyer'),
      buyer_agent:       val('oe-agent'),
      buyer_agent_email: val('oe-agent-email'),
      brokerage:         val('oe-brokerage'),
      conditions:        val('oe-cond'),
      inspection_date:   val('oe-insp'),
      financing_date:    val('oe-fin'),
      closing_date:      val('oe-close'),
      irrevocable_until: val('oe-irrev'),
    };
    let { error } = await db.from('listing_offers').update(patch).eq('id', offerId);
    if (error) {
      // Pre-092 schema: save what the old shape can hold rather than nothing.
      ['buyer_agent_email','brokerage','inspection_date','financing_date','closing_date','irrevocable_until']
        .forEach(k => delete patch[k]);
      ({ error } = await db.from('listing_offers').update(patch).eq('id', offerId));
      if (!error) App.toast('⚠️ Saved, but the extra fields need migration 092', 'var(--yellow)');
    }
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }
    App.closeModal();
    App.toast('✏️ Offer updated', 'var(--green)');
    Listings.load();
  },

  async deleteOffer(offerId) {
    if (!confirm('Delete this offer? The attached PDF stays in the deal files.')) return;
    const { error } = await db.from('listing_offers').delete().eq('id', offerId);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.toast('🗑 Offer deleted', 'var(--text2)');
    Listings.load();
  },

  card(l) {
    const seller = l.clients?.full_name || '—';
    const asking = l.asking_price || l.list_price;
    const preMls = ['pre_listing','cma_delivered','agreement_signed','prep'].includes(l.listing_status);
    return `
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div class="fw-800" style="font-size:15px;">${Listings.esc(l.property_address)}</div>
            <div style="font-size:12px;color:var(--text2);">👤 ${Listings.esc(seller)} ${l.mls_number ? '&nbsp;·&nbsp; MLS# ' + Listings.esc(l.mls_number) : ''}</div>
          </div>
          <div style="text-align:right;">
            <div class="fw-800" style="font-size:15px;color:var(--green);">${asking ? Listings.money(asking) : '—'}</div>
            <div style="font-size:11px;color:var(--text2);">Asking</div>
          </div>
        </div>
        ${Listings.stageBar(l)}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0;font-size:12px;">
          <div>📅 Listed<br><strong>${Listings.fmtD(l.listed_at)}</strong></div>
          <div>⏰ Offers presented<br><strong style="color:var(--yellow);">${Listings.fmtD(l.offer_review_deadline)}</strong>${l.offer_review_time ? `<br><span style="color:var(--yellow);font-size:11px;">${Listings.fmtTime(l.offer_review_time)}</span>` : ''}</div>
          <div>🎯 Target sold<br><strong>${Listings.fmtD(l.target_sold_date)}</strong></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${preMls ? `<button class="btn btn-sm" style="background:var(--green);color:#fff;" onclick="Listings.markListed('${l.id}')">🏷️ Mark Listed on MLS</button>` : ''}
          ${l.listing_status !== 'sold' && l.listing_status !== 'withdrawn' ? `<button class="btn btn-outline btn-sm" onclick="Listings.advance('${l.id}')">➡️ Advance Stage</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="Listings.setDates('${l.id}')">📅 Set Dates</button>
          <button class="btn btn-outline btn-sm" onclick="Listings.editListing('${l.id}')">✏️ Edit</button>
          <button class="btn btn-outline btn-sm" style="border-color:var(--red);color:var(--red);" onclick="Listings.deleteListing('${l.id}')">🗑 Delete</button>
        </div>
        ${Listings.offersSection(l)}
        ${typeof Showings !== 'undefined' ? Showings.section(l) : ''}
      </div>`;
  },

  // ── Phase 1 actions ──
  async markListed(id) {
    const l = Listings.all.find(x => x.id === id);
    if (!l) return;
    const mls = prompt('MLS number for this listing:', l.mls_number || '');
    if (mls === null) return;
    const { error } = await db.from('listings').update({
      listing_status: 'active',
      mls_number: mls.trim() || l.mls_number || null,
      listed_at: l.listed_at || new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.toast('🏷️ Listing is Active on MLS', 'var(--green)');
    Listings.load();
  },

  async advance(id) {
    const l = Listings.all.find(x => x.id === id);
    if (!l) return;
    const idx = Listings.STATUS_FLOW.indexOf(l.listing_status);
    const next = Listings.STATUS_FLOW[Math.min(idx + 1, Listings.STATUS_FLOW.length - 1)];
    if (next === l.listing_status) return;
    if (!confirm(`Move ${l.property_address} to "${Listings.STATUS_LABEL[next]}"?`)) return;
    const patch = { listing_status: next, updated_at: new Date().toISOString() };
    if (next === 'active' && !l.listed_at) patch.listed_at = new Date().toISOString().slice(0, 10);
    if (next === 'sold') patch.sold_at = new Date().toISOString().slice(0, 10);
    const { error } = await db.from('listings').update(patch).eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.toast(`➡️ ${Listings.STATUS_LABEL[next]}`, 'var(--green)');
    Listings.load();
  },

  setDates(id) {
    const l = Listings.all.find(x => x.id === id);
    if (!l) return;
    App.openModal(`
      <div class="modal-title">📅 Listing Dates — ${Listings.esc(l.property_address)}</div>
      <div class="form-group"><label class="form-label">Listed on MLS</label>
        <input class="form-input" type="date" id="ld-listed" value="${l.listed_at || ''}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Offer presentation date</label>
          <input class="form-input" type="date" id="ld-deadline" value="${l.offer_review_deadline || ''}"></div>
        <div class="form-group"><label class="form-label">Presentation time</label>
          <input class="form-input" type="time" id="ld-time" value="${l.offer_review_time || ''}"></div>
      </div>
      <div style="font-size:11.5px;color:var(--text2);margin:-6px 0 14px;line-height:1.5;">
        This is when you sit down with the seller and go through the offers. Bidding closes at that moment, so anything after it is late. Leave the time blank and nothing closes on its own.
      </div>
      <div class="form-group"><label class="form-label">Target sold date</label>
        <input class="form-input" type="date" id="ld-target" value="${l.target_sold_date || ''}"></div>
      <button class="btn btn-primary btn-block" onclick="Listings.saveDates('${l.id}')">Save Dates</button>
    `);
  },

  async saveDates(id) {
    const { error } = await db.from('listings').update({
      listed_at:             document.getElementById('ld-listed')?.value || null,
      offer_review_deadline: document.getElementById('ld-deadline')?.value || null,
      offer_review_time:     document.getElementById('ld-time')?.value || null,
      target_sold_date:      document.getElementById('ld-target')?.value || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) {
      // Pre-092 schema: keep the dates rather than lose the whole save.
      if (/offer_review_time/.test(error.message || '')) {
        const { error: e2 } = await db.from('listings').update({
          listed_at:             document.getElementById('ld-listed')?.value || null,
          offer_review_deadline: document.getElementById('ld-deadline')?.value || null,
          target_sold_date:      document.getElementById('ld-target')?.value || null,
          updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (!e2) { App.closeModal(); App.toast('📅 Dates saved. The time needs migration 092.', 'var(--yellow)'); Listings.load(); return; }
      }
      App.toast('⚠️ ' + error.message, 'var(--red)'); return;
    }
    App.closeModal();
    App.toast('📅 Dates saved', 'var(--green)');
    Listings.load();
  },

  // ── Edit listing basics (address / asking price / MLS) ──
  // Needed because intake-created listings can arrive without an asking price
  // (free-text intake didn't parse) — and ranking vs asking depends on it.
  editListing(id) {
    const l = Listings.all.find(x => x.id === id);
    if (!l) return;
    App.openModal(`
      <div class="modal-title">✏️ Edit Listing</div>
      <div class="form-group"><label class="form-label">Property Address *</label>
        <input class="form-input" id="le-address" value="${Listings.esc(l.property_address || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Asking Price ($)</label>
          <input class="form-input" type="number" id="le-asking" value="${l.asking_price || l.list_price || ''}" placeholder="575000"></div>
        <div class="form-group"><label class="form-label">MLS Number</label>
          <input class="form-input" id="le-mls" value="${Listings.esc(l.mls_number || '')}" placeholder="1299703"></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Listings.saveEditListing('${id}')">Save Listing</button>
      <div id="le-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async saveEditListing(id) {
    const address = document.getElementById('le-address')?.value.trim();
    const msg = document.getElementById('le-msg');
    if (!address) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Address is required'; } return; }
    const asking = parseFloat(document.getElementById('le-asking')?.value) || null;
    const { error } = await db.from('listings').update({
      property_address: address,
      asking_price: asking,
      mls_number: document.getElementById('le-mls')?.value.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }
    App.closeModal();
    App.toast('✏️ Listing updated', 'var(--green)');
    Listings.load();
  },

  // ── Delete a listing (its logged offers cascade-delete with it) ──
  // Does NOT touch the seller client or any pipeline deal — a sell-side deal
  // created from Pick Winner stays; its listing link just clears.
  async deleteListing(id) {
    const l = Listings.all.find(x => x.id === id);
    if (!l) return;
    const nOffers = (Listings._offers[id] || []).length;
    if (!confirm(`Delete the listing for ${l.property_address}?\n\n${nOffers ? nOffers + ' logged offer' + (nOffers === 1 ? '' : 's') + ' will be deleted with it. ' : ''}The seller client and any pipeline deal are NOT affected.`)) return;
    const { error } = await db.from('listings').delete().eq('id', id);
    if (error) { App.toast('⚠️ Delete failed: ' + error.message, 'var(--red)'); return; }
    App.toast('🗑 Listing deleted', 'var(--green)');
    Listings.load();
  },

  // ── Phase 2 actions ──
  addOffer(listingId) {
    const l = Listings.all.find(x => x.id === listingId);
    if (!l) return;
    if (Listings.biddingClosed(l)) {
      App.toast(l.bidding_closed_at
        ? 'Bidding is closed. Reopen it to log more offers.'
        : 'The presentation time has passed. Move the date or time to take more offers.', 'var(--yellow)');
      return;
    }
    const n = (Listings._offers[listingId] || []).length + 1;
    App.openModal(`
      <div class="modal-title">➕ Log Offer #${n} — ${Listings.esc(l.property_address)}</div>
      <div class="form-group"><label class="form-label">Offer Amount ($) *</label>
        <input class="form-input" type="number" id="lo-amount" placeholder="585000"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Buyer / Buyer's side (optional)</label>
          <input class="form-input" id="lo-buyer" placeholder="e.g. Smith family"></div>
        <div class="form-group"><label class="form-label">Buyer's Agent (optional)</label>
          <input class="form-input" id="lo-agent" placeholder="Agent name"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Deposit ($, optional)</label>
          <input class="form-input" type="number" id="lo-deposit" placeholder="20000"></div>
        <div class="form-group"><label class="form-label">Conditions (optional)</label>
          <input class="form-input" id="lo-cond" placeholder="Financing, inspection…"></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Listings.saveOffer('${listingId}')">Save Offer #${n}</button>
      <div id="lo-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async saveOffer(listingId) {
    const amount = parseFloat(document.getElementById('lo-amount')?.value);
    const msg = document.getElementById('lo-msg');
    if (!amount || amount <= 0) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Offer amount required'; } return; }
    const user = await App.getAuthUser();
    const uid = user?.id || currentAgent.id;
    const offerNo = (Listings._offers[listingId] || []).length + 1;
    const { error } = await db.from('listing_offers').insert({
      agent_id: uid,
      listing_id: listingId,
      offer_no: offerNo,
      buyer_name:  document.getElementById('lo-buyer')?.value.trim() || null,
      buyer_agent: document.getElementById('lo-agent')?.value.trim() || null,
      amount,
      deposit: parseFloat(document.getElementById('lo-deposit')?.value) || null,
      conditions: document.getElementById('lo-cond')?.value.trim() || null,
    });
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }
    App.closeModal();
    App.toast(`📄 Offer #${offerNo} logged`, 'var(--green)');
    Listings.load();
  },

  async endBidding(listingId) {
    const l = Listings.all.find(x => x.id === listingId);
    if (!l) return;
    const n = (Listings._offers[listingId] || []).length;
    if (!confirm(`End bidding on ${l.property_address}?\n\n${n} offer${n === 1 ? '' : 's'} will be ranked against the asking price (highest first).`)) return;
    const { error } = await db.from('listings').update({ bidding_closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', listingId);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.toast('🔨 Bidding closed — offers ranked vs asking', 'var(--green)');
    Listings.load();
  },

  async reopenBidding(listingId) {
    if ((Listings._offers[listingId] || []).some(o => o.status === 'winner')) {
      App.toast('A winner has already been picked — bidding can\'t be reopened', 'var(--yellow)'); return;
    }
    // Clearing the manual close is not enough if the presentation time itself
    // has passed — that instant is the real close, so it has to move.
    const l = Listings.all.find(x => x.id === listingId);
    const at = l ? Listings.presentationAt(l) : null;
    if (at && Date.now() >= at.getTime()) {
      App.toast('The presentation time has passed. Open Set Dates and move it to reopen.', 'var(--yellow)');
      Listings.setDates(listingId);
      return;
    }
    const { error } = await db.from('listings').update({ bidding_closed_at: null, updated_at: new Date().toISOString() }).eq('id', listingId);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.toast('↩︎ Bidding reopened', 'var(--text2)');
    Listings.load();
  },

  // ── Phase 3: Seller snapshot — branded email with ranked offers + bar chart ──
  // Email-safe visualization: inline-styled divs only (no <script>, no external
  // images), so the "chart" renders in Gmail/Outlook. Queued via Notify.queue →
  // Approvals, same as every other email — nothing sends without Maxwell.
  async sendSnapshot(listingId) {
    const l = Listings.all.find(x => x.id === listingId);
    if (!l) return;
    const offers = (Listings._offers[listingId] || []).slice().sort((a, b) => Number(b.amount) - Number(a.amount));
    if (!offers.length) { App.toast('No offers to send — log offers first', 'var(--yellow)'); return; }
    const sellerName  = l.clients?.full_name || 'Seller';
    const sellerEmail = l.clients?.email || null;
    if (!sellerEmail) { App.toast('⚠️ This seller has no email on file — add it on their client record first', 'var(--red)'); return; }
    if (typeof Notify === 'undefined' || !Notify.queue) { App.toast('⚠️ Email system not loaded — reload and retry', 'var(--red)'); return; }

    const first  = sellerName.split(' ')[0];
    const asking = Number(l.asking_price || l.list_price || 0);
    const maxVal = Math.max(asking, Number(offers[0].amount));
    const pctOf  = amt => asking ? ((Number(amt) - asking) / asking * 100) : null;
    const barW   = amt => Math.max(8, Math.round(Number(amt) / maxVal * 100));

    // Chart + table rows (inline styles only — email-safe)
    const chartRows = offers.map((o, i) => {
      const pct = pctOf(o.amount);
      const top = i === 0;
      const barColor = top ? '#157347' : '#8a8f98';
      const pctTxt = pct === null ? '' :
        ` <span style="font-weight:700;color:${pct >= 0 ? '#157347' : '#c0392b'};">(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</span>`;
      return `
        <div style="margin:0 0 10px;">
          <div style="font-size:13px;color:#202124;margin-bottom:3px;">${top ? '🏆 ' : ''}<strong>Offer #${o.offer_no}</strong>${o.buyer_agent ? ' · via ' + Listings.esc(o.buyer_agent) : ''} — <strong>${Listings.money(o.amount)}</strong>${pctTxt}</div>
          <div style="background:#eef0f3;border-radius:6px;height:18px;width:100%;"><div style="background:${barColor};border-radius:6px;height:18px;width:${barW(o.amount)}%;"></div></div>
          ${o.conditions ? `<div style="font-size:11.5px;color:#5f6368;margin-top:2px;">Conditions: ${Listings.esc(o.conditions)}${o.deposit ? ' · Deposit: ' + Listings.money(o.deposit) : ''}</div>` : (o.deposit ? `<div style="font-size:11.5px;color:#5f6368;margin-top:2px;">Deposit: ${Listings.money(o.deposit)}</div>` : '')}
        </div>`;
    }).join('');
    const askingBar = asking ? `
        <div style="margin:0 0 14px;">
          <div style="font-size:13px;color:#5f6368;margin-bottom:3px;">Asking price — <strong>${Listings.money(asking)}</strong></div>
          <div style="background:#eef0f3;border-radius:6px;height:18px;width:100%;"><div style="background:#c9ced6;border:1px dashed #8a8f98;border-radius:6px;height:16px;width:${barW(asking)}%;"></div></div>
        </div>` : '';

    const sig = (typeof EmailFormat !== 'undefined') ? EmailFormat.signatureHTML(currentAgent) : '';
    const dis = (typeof EmailFormat !== 'undefined') ? EmailFormat.disclaimerHTML() : '';
    const styles = (typeof EmailFormat !== 'undefined' && EmailFormat.styles) ? EmailFormat.styles() : '';
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body>
      <p>Hi ${Listings.esc(first)},</p>
      <p>Bidding has closed on <strong>${Listings.esc(l.property_address)}</strong> — here's the full picture of every offer received, ranked against your asking price:</p>
      ${askingBar}
      ${chartRows}
      <p style="font-size:13px;color:#5f6368;">The highest offer isn't always the strongest — conditions and deposits matter too. Nothing is decided without you: let's talk through these together and pick the one that's right for you.</p>
      <p>Call me any time, or reply to this email.</p>
      <p>Best regards,</p>
      ${sig}
      ${dis}
    </body></html>`;

    const plain = `Hi ${first},\n\nBidding has closed on ${l.property_address}. Here are all ${offers.length} offers, ranked against your asking price${asking ? ' of ' + Listings.money(asking) : ''}:\n\n` +
      offers.map((o, i) => {
        const pct = pctOf(o.amount);
        return `${i === 0 ? '#1 (HIGHEST)' : '#' + (i + 1)}  Offer #${o.offer_no} — ${Listings.money(o.amount)}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs asking)` : ''}${o.conditions ? ` · Conditions: ${o.conditions}` : ''}${o.deposit ? ` · Deposit: ${Listings.money(o.deposit)}` : ''}`;
      }).join('\n') +
      `\n\nThe highest offer isn't always the strongest — conditions and deposits matter too. Let's talk through these together and pick the one that's right for you.\n\nCall me any time, or reply to this email.\n\nBest regards,\n` +
      ((typeof EmailFormat !== 'undefined' && EmailFormat.signaturePlain) ? EmailFormat.signaturePlain(currentAgent) : (currentAgent.full_name || currentAgent.name || 'Maxwell Delali Midodzi')) +
      ((typeof EmailFormat !== 'undefined' && EmailFormat.disclaimerPlain) ? EmailFormat.disclaimerPlain() : '');

    const subject = `📊 Offer Summary — ${l.property_address} (${offers.length} offer${offers.length === 1 ? '' : 's'})`;
    App.toast('Preparing snapshot…', 'var(--accent2)');
    const ok = await Notify.queue('Seller Offer Snapshot', l.client_id, sellerName, sellerEmail, subject, plain, l.id, html);
    if (ok) {
      App.toast('📊 Snapshot queued — check Approvals to review & send', 'var(--green)');
      if (App.pushNotify) App.pushNotify('📊 Seller snapshot queued', `${sellerName} · ${l.property_address}`, 'approvals');
    } else {
      App.toast('⚠️ Could not queue the snapshot — see the error above', 'var(--red)');
    }
  },

  // ── The two emails that go out the moment the seller decides ──────────────
  // One to the agent whose offer was accepted, three to the ones whose were not.
  // Both are queued to Approvals, never sent from here, so they can be added to
  // before they go.
  //
  // What the declines deliberately do NOT carry: the winning price, who won, or
  // anything about the other offers. Saying it was competitive and how many came
  // in is normal and useful to the agent on the other end. Anything past that is
  // the seller's business, not theirs.
  async queueOutcomeEmails(listingId, winnerOfferId) {
    const l = Listings.all.find(x => x.id === listingId);
    const offers = Listings._offers[listingId] || [];
    const winner = offers.find(o => o.id === winnerOfferId);
    if (!l || !winner) return { queued: 0, missing: [] };
    if (typeof Notify === 'undefined' || !Notify.queue) return { queued: 0, missing: [] };

    const n = offers.length;
    const addr = l.property_address;
    const agent = currentAgent;
    const sig = (typeof EmailFormat !== 'undefined') ? EmailFormat.signatureHTML(agent) : '';
    const dis = (typeof EmailFormat !== 'undefined') ? EmailFormat.disclaimerHTML() : '';
    const styles = (typeof EmailFormat !== 'undefined' && EmailFormat.styles) ? EmailFormat.styles() : '';
    const sigP = (typeof EmailFormat !== 'undefined' && EmailFormat.signaturePlain) ? EmailFormat.signaturePlain(agent) : (agent.full_name || 'Maxwell Delali Midodzi');
    const disP = (typeof EmailFormat !== 'undefined' && EmailFormat.disclaimerPlain) ? EmailFormat.disclaimerPlain() : '';
    const wrap = inner => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body>${inner}${sig}${dis}</body></html>`;
    // Agents sign offers as "C. Squires" as often as "Cathy Squires". Taking the
    // first token blindly greets them as "Hi C.," so an initial keeps the surname.
    const first = full => {
      const s = String(full || '').trim();
      if (!s) return 'there';
      const parts = s.split(/\s+/);
      return (parts.length > 1 && /^[A-Za-z]\.?$/.test(parts[0])) ? s : parts[0];
    };

    // How busy it was, in words. Only said when it is actually true.
    const competitive = n > 1
      ? `We received ${n} offers on this property, so it was a competitive review.`
      : '';

    let queued = 0;
    const missing = [];

    // ── The winning agent ──
    if (winner.buyer_agent_email) {
      const wName = winner.buyer_agent || 'there';
      const subject = `Offer accepted — ${addr}`;
      const plain =
`Hi ${first(wName)},

Good news. Your clients' offer on ${addr} has been accepted by the seller.

I will send the executed documents shortly. In the meantime, please confirm:

- The deposit, so it reaches our brokerage within the agreed time
- Your lawyer's details for the file
${winner.conditions ? `- Your timeline for ${winner.conditions.toLowerCase()}\n` : ''}
Congratulations to you and your clients. Call me any time.

${sigP}${disP}`;
      const html = wrap(`
        <p>Hi ${Listings.esc(first(wName))},</p>
        <p>Good news. Your clients' offer on <strong>${Listings.esc(addr)}</strong> has been accepted by the seller.</p>
        <p>I will send the executed documents shortly. In the meantime, please confirm:</p>
        <ul>
          <li>The deposit, so it reaches our brokerage within the agreed time</li>
          <li>Your lawyer's details for the file</li>
          ${winner.conditions ? `<li>Your timeline for ${Listings.esc(winner.conditions.toLowerCase())}</li>` : ''}
        </ul>
        <p>Congratulations to you and your clients. Call me any time.</p>`);
      const ok = await Notify.queue('Offer accepted → buyer agent 📨', l.client_id,
        wName, winner.buyer_agent_email, subject, plain, l.id, html);
      if (ok) queued++;
    } else {
      missing.push(`${winner.buyer_agent || 'the winning agent'} (accepted)`);
    }

    // ── Everyone else ──
    for (const o of offers) {
      if (o.id === winnerOfferId) continue;
      if (!o.buyer_agent_email) { missing.push(o.buyer_agent || `Offer #${o.offer_no}`); continue; }
      const name = o.buyer_agent || 'there';
      const subject = `Thank you for your offer — ${addr}`;
      const plain =
`Hi ${first(name)},

Thank you for bringing your clients to ${addr}, and for the work that went into your offer.

The seller has reviewed everything and has accepted another offer, and that agent has been notified. ${competitive}

I am sorry it did not go your way this time. Please do pass on my thanks to your clients. If they are still looking, tell me what they are after and I will let you know the moment something suitable comes up.

${sigP}${disP}`;
      const html = wrap(`
        <p>Hi ${Listings.esc(first(name))},</p>
        <p>Thank you for bringing your clients to <strong>${Listings.esc(addr)}</strong>, and for the work that went into your offer.</p>
        <p>The seller has reviewed everything and has accepted another offer, and that agent has been notified. ${Listings.esc(competitive)}</p>
        <p>I am sorry it did not go your way this time. Please do pass on my thanks to your clients. If they are still looking, tell me what they are after and I will let you know the moment something suitable comes up.</p>`);
      const ok = await Notify.queue('Offer declined → buyer agent 📨', l.client_id,
        name, o.buyer_agent_email, subject, plain, l.id, html);
      if (ok) queued++;
    }

    return { queued, missing };
  },

  // ── Phase 4: pick the winning offer → sell-side pipeline deal ──────────────
  // Marks the chosen offer 'winner' (others 'declined'), moves the listing to
  // Under Contract, and creates a SELL-side pipeline deal for the seller with
  // the closing dates — so financing/conditions/closing/lawyer run through the
  // same Pipeline + stakeholder flow as every other deal. Maxwell emails the
  // winning buyer's side himself (their email isn't captured on logged offers).
  pickWinner(listingId, offerId) {
    const l = Listings.all.find(x => x.id === listingId);
    const o = (Listings._offers[listingId] || []).find(x => x.id === offerId);
    if (!l || !o) return;
    const today = new Date().toISOString().slice(0, 10);
    App.openModal(`
      <div class="modal-title">🏆 Accept Offer #${o.offer_no} — ${Listings.money(o.amount)}</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px;">${Listings.esc(l.property_address)} · Seller: ${Listings.esc(l.clients?.full_name || '—')}<br>All other offers will be marked <strong>Declined</strong>, the listing moves to <strong>Under Contract</strong>, and a sell-side deal is created in your Pipeline.</div>
      <div class="form-group"><label class="form-label">Acceptance date</label>
        <input class="form-input" type="date" id="pw-acc" value="${today}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Financing deadline (optional)</label>
          <input class="form-input" type="date" id="pw-fin"></div>
        <div class="form-group"><label class="form-label">Closing date (optional)</label>
          <input class="form-input" type="date" id="pw-close" value="${l.target_sold_date || ''}"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Your listing commission (%) — as agreed with the seller</label>
        <select class="form-input form-select" id="pw-rate">
          <option value="1">1%</option>
          <option value="1.5">1.5%</option>
          <option value="2">2%</option>
          <option value="2.5" selected>2.5%</option>
          <option value="3">3%</option>
          <option value="3.5">3.5%</option>
          <option value="4">4%</option>
          <option value="5">5%</option>
        </select>
        <div style="font-size:11px;color:var(--text2);margin-top:4px;">Recorded in your Commissions section, marked <strong>SELL</strong> side. On a dual agency you'll have this plus the buy-side commission recorded at offer acceptance.</div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Listings.confirmWinner('${listingId}','${offerId}')">🏆 Accept & Create Pipeline Deal</button>
      <div id="pw-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async confirmWinner(listingId, offerId) {
    const l = Listings.all.find(x => x.id === listingId);
    const o = (Listings._offers[listingId] || []).find(x => x.id === offerId);
    const msg = document.getElementById('pw-msg');
    if (!l || !o) return;
    const acc   = document.getElementById('pw-acc')?.value || new Date().toISOString().slice(0, 10);
    const fin   = document.getElementById('pw-fin')?.value || null;
    const close = document.getElementById('pw-close')?.value || null;
    if (msg) { msg.style.color = 'var(--text2)'; msg.textContent = 'Creating deal…'; }

    // 1. Mark winner / decline the rest
    const { error: e1 } = await db.from('listing_offers').update({ status: 'declined' }).eq('listing_id', listingId).neq('id', offerId);
    const { error: e2 } = await db.from('listing_offers').update({ status: 'winner' }).eq('id', offerId);
    if (e1 || e2) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + ((e1 || e2).message); } return; }

    // 2. Listing → Under Contract
    await db.from('listings').update({ listing_status: 'under_contract', updated_at: new Date().toISOString() }).eq('id', listingId);

    // 3. Sell-side pipeline deal — agent_id MUST be auth.uid() for RLS (same as buy side)
    const user = await App.getAuthUser();
    const uid = user?.id || currentAgent.id;
    const dealRow = {
      pipeline_id: (crypto.randomUUID ? crypto.randomUUID() : 'SELL-' + Date.now()),
      agent_id: uid,
      client_id: l.client_id || null,
      client_name: l.clients?.full_name || 'Seller',
      client_email: l.clients?.email || '',
      property_address: l.property_address,
      mls_number: l.mls_number || null,
      offer_amount: Number(o.amount) || 0,
      acceptance_date: acc,
      financing_date: fin,
      financing_deadline: fin,
      closing_date: close,
      stage: 'Accepted',
      status: 'Active',
      deal_type: 'existing_home',
      deal_side: 'sell',
      listing_id: listingId,
      // Deposits are due within 24 hours of acceptance unless the offer said
      // otherwise. Carried onto the deal so it can be asked about, not assumed.
      deposit_due_date: (() => { const d = new Date(acc + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })(),
    };
    let { data: newDeal, error: e3 } = await db.from('pipeline').insert(dealRow).select('id').single();
    if (e3 && /deposit_due_date/.test(e3.message || '')) {
      // Pre-093 schema. The deal matters more than the deposit date.
      delete dealRow.deposit_due_date;
      ({ data: newDeal, error: e3 } = await db.from('pipeline').insert(dealRow).select('id').single());
    }
    if (e3) {
      if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Deal not created: ' + e3.message + ' — the winner IS marked; add the deal manually in Pipeline.'; }
      console.error('[confirmWinner] pipeline insert failed:', e3);
      Listings.load();
      return;
    }

    // Record the SELL-side commission — mirrors the buy-side acceptance flow
    // (20% brokerage fee, 15% HST, status Pending; flips on close/fell-through).
    // Tagged deal_side='sell' so it shows a SELL badge in Commission history.
    // On a dual agency this sits alongside the buy-side commission recorded at
    // offer acceptance — the two agreed commissions, both counted in totals.
    const rate = parseFloat(document.getElementById('pw-rate')?.value) || 2.5;
    const sale = Number(o.amount) || 0;
    const gross = sale * rate / 100;
    const hst = gross * 0.15;
    const brokerFee = gross * 0.20;
    const commRow = {
      agent_id: currentAgent.id,
      client_name: l.clients?.full_name || 'Seller',
      property_address: l.property_address,
      sale_price: sale,
      commission_rate: rate,
      gross_commission: gross,
      hst_collected: hst,
      brokerage_fee_rate: 20,
      brokerage_fees: brokerFee,
      agent_net: (gross + hst) - brokerFee,
      close_date: close || null,
      status: 'Pending',
      deal_side: 'sell',
    };
    let { error: cErr } = await db.from('commissions').insert(commRow);
    if (cErr) {
      // Older schema without deal_side (migration 059 not run) — record it anyway
      delete commRow.deal_side;
      ({ error: cErr } = await db.from('commissions').insert(commRow));
    }
    if (cErr) {
      console.warn('[confirmWinner] commission insert failed:', cErr.message);
      App.toast('⚠️ Deal created, but the commission could not be recorded — add it on the Commissions screen', 'var(--yellow)');
    }

    // Phase 5: dual-agency auto-link — if Maxwell ALSO represents the buyer on
    // this same property (a live buy-side deal at the same address), link the
    // two deals into one transaction so the Pipeline shows them as one
    // colour-coded dual-agency group. Best-effort — never blocks the winner flow.
    try {
      const { data: buySide } = await db.from('pipeline')
        .select('id').eq('agent_id', uid).eq('deal_side', 'buy')
        .ilike('property_address', l.property_address)
        .is('archived_at', null)
        .not('stage', 'in', '("Closed","Fell Through")')
        .limit(1).maybeSingle();
      if (buySide?.id && newDeal?.id) {
        const txn = crypto.randomUUID ? crypto.randomUUID() : 'txn-' + Date.now();
        await db.from('pipeline').update({ transaction_id: txn, updated_at: new Date().toISOString() }).in('id', [buySide.id, newDeal.id]);
        App.toast('🤝 Dual agency detected — buyer & seller deals linked in Pipeline', 'var(--accent2)');
      }
    } catch (e) { console.warn('[dual-agency auto-link] skipped:', e?.message || e); }

    if (typeof App.logActivity === 'function') {
      App.logActivity('OFFER_WON', l.clients?.full_name, l.clients?.email,
        `Accepted Offer #${o.offer_no} (${Listings.money(o.amount)}) on ${l.property_address} — sell-side deal created`, l.client_id);
    }
    // The sell-side task list. Best effort, same as the commission: a checklist
    // that fails to build must not undo an accepted offer.
    if (newDeal?.id && typeof Pipeline !== 'undefined' && Pipeline.generateSellerChecklist) {
      try {
        await Pipeline.generateSellerChecklist(newDeal.id,
          { ...dealRow, id: newDeal.id }, l.clients, acc);
      } catch (e) { console.warn('[confirmWinner] seller checklist skipped:', e?.message || e); }
    }

    // Notify the agents on both sides. Best effort: the deal is already made,
    // so a mail failure must never undo it, but it does get said out loud.
    let outcome = { queued: 0, missing: [] };
    try {
      outcome = await Listings.queueOutcomeEmails(listingId, offerId);
    } catch (e) { console.warn('[confirmWinner] outcome emails skipped:', e?.message || e); }

    App.closeModal();
    App.toast(`🏆 Offer #${o.offer_no} accepted — deal in Pipeline${cErr ? '' : ` + ${rate}% commission recorded`}`, 'var(--green)');
    if (outcome.queued) {
      App.toast(`📨 ${outcome.queued} agent email${outcome.queued === 1 ? '' : 's'} waiting in Approvals`, 'var(--accent2)');
    }
    if (outcome.missing.length) {
      App.toast(`⚠️ No email on file for ${outcome.missing.join(', ')} — you'll need to call them`, 'var(--yellow)');
    }
    if (App.pushNotify) App.pushNotify('🏆 Offer accepted', `${l.property_address} · ${Listings.money(o.amount)}`, 'approvals');
    Listings.load();
    if (typeof Pipeline !== 'undefined' && typeof currentTab !== 'undefined' && currentTab === 'pipeline') Pipeline.load();
  },
};
