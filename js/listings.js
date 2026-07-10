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
    el.innerHTML = Listings.all.map(l => Listings.card(l)).join('');
  },

  // ── Lifecycle progress bar (7 fixed stages) ──
  stageBar(l) {
    if (l.listing_status === 'withdrawn') {
      return `<div style="font-size:12px;color:var(--red);font-weight:700;margin:8px 0;">◾ Withdrawn</div>`;
    }
    const idx = Math.max(0, Listings.STATUS_FLOW.indexOf(l.listing_status));
    const pct = Math.round(((idx + 1) / Listings.STATUS_FLOW.length) * 100);
    const segs = Listings.STATUS_FLOW.map((s, i) => {
      const on = i <= idx;
      return `<div style="flex:1;height:8px;border-radius:99px;background:${on ? 'var(--accent)' : 'var(--bg2)'};"></div>`;
    }).join('<div style="width:3px;"></div>');
    return `
      <div style="margin:10px 0 4px;">
        <div style="display:flex;align-items:center;">${segs}</div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-top:4px;">
          <span>📍 <strong style="color:var(--accent2);">${Listings.STATUS_LABEL[l.listing_status] || l.listing_status}</strong></span>
          <span>${pct}%</span>
        </div>
      </div>`;
  },

  // ── Offers section (Phase 2) ──
  offersSection(l) {
    const offers = Listings._offers[l.id] || [];
    const asking = Number(l.asking_price || l.list_price || 0);
    const closed = !!l.bidding_closed_at;
    let rows = '';
    if (!offers.length) {
      rows = `<div style="font-size:12px;color:var(--text2);padding:4px 0;">No offers logged yet.</div>`;
    } else if (!closed) {
      // Bidding open — show in the order received
      rows = offers.map(o => `
        <div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <span>📄 Offer #${o.offer_no}${o.buyer_name ? ' · ' + Listings.esc(o.buyer_name) : ''}${o.conditions ? ' · <span style="color:var(--text2);font-size:11px;">' + Listings.esc(o.conditions) + '</span>' : ''}</span>
          <span class="fw-700">${Listings.money(o.amount)}</span>
        </div>`).join('');
    } else {
      // Bidding closed — auto-rank highest → lowest with % vs asking
      const ranked = offers.slice().sort((a, b) => Number(b.amount) - Number(a.amount));
      rows = ranked.map((o, i) => {
        const pct = asking ? ((Number(o.amount) - asking) / asking * 100) : null;
        const pctTxt = pct === null ? '' :
          `<span style="font-size:11px;font-weight:700;color:${pct >= 0 ? 'var(--green)' : 'var(--red)'};">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs asking</span>`;
        const top = i === 0;
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 8px;margin-bottom:4px;border-radius:8px;font-size:13px;${top ? 'background:rgba(34,197,94,0.10);border:1px solid var(--green);' : 'background:var(--bg);'}">
            <span>${top ? '🏆' : `#${i + 1}`} Offer #${o.offer_no}${o.buyer_name ? ' · ' + Listings.esc(o.buyer_name) : ''}${o.conditions ? ' · <span style="color:var(--text2);font-size:11px;">' + Listings.esc(o.conditions) + '</span>' : ''}</span>
            <span style="text-align:right;"><span class="fw-800">${Listings.money(o.amount)}</span><br>${pctTxt}</span>
          </div>`;
      }).join('');
    }
    const bidBtns = closed
      ? `<button class="btn btn-sm" style="background:var(--accent);color:#fff;" onclick="Listings.sendSnapshot('${l.id}')">📊 Send Seller Snapshot</button>
         <button class="btn btn-outline btn-sm" onclick="Listings.reopenBidding('${l.id}')">↩︎ Reopen Bidding</button>`
      : `<button class="btn btn-sm" style="background:var(--accent);color:#fff;" onclick="Listings.addOffer('${l.id}')">➕ Log Offer</button>
         ${offers.length ? `<button class="btn btn-outline btn-sm" style="border-color:var(--yellow);color:var(--yellow);" onclick="Listings.endBidding('${l.id}')">🔨 End Bidding & Rank</button>` : ''}`;
    return `
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-size:12px;font-weight:800;letter-spacing:0.04em;color:var(--text2);">OFFERS (${offers.length})${closed ? ' · <span style="color:var(--yellow);">BIDDING CLOSED — RANKED</span>' : ''}</div>
        </div>
        ${rows}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">${bidBtns}</div>
      </div>`;
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
          <div>⏰ Offer deadline<br><strong style="color:var(--yellow);">${Listings.fmtD(l.offer_review_deadline)}</strong></div>
          <div>🎯 Target sold<br><strong>${Listings.fmtD(l.target_sold_date)}</strong></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${preMls ? `<button class="btn btn-sm" style="background:var(--green);color:#fff;" onclick="Listings.markListed('${l.id}')">🏷️ Mark Listed on MLS</button>` : ''}
          ${l.listing_status !== 'sold' && l.listing_status !== 'withdrawn' ? `<button class="btn btn-outline btn-sm" onclick="Listings.advance('${l.id}')">➡️ Advance Stage</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="Listings.setDates('${l.id}')">📅 Set Dates</button>
        </div>
        ${Listings.offersSection(l)}
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
      <div class="form-group"><label class="form-label">Offer review deadline (when you review all offers with the seller)</label>
        <input class="form-input" type="date" id="ld-deadline" value="${l.offer_review_deadline || ''}"></div>
      <div class="form-group"><label class="form-label">Target sold date</label>
        <input class="form-input" type="date" id="ld-target" value="${l.target_sold_date || ''}"></div>
      <button class="btn btn-primary btn-block" onclick="Listings.saveDates('${l.id}')">Save Dates</button>
    `);
  },

  async saveDates(id) {
    const { error } = await db.from('listings').update({
      listed_at:             document.getElementById('ld-listed')?.value || null,
      offer_review_deadline: document.getElementById('ld-deadline')?.value || null,
      target_sold_date:      document.getElementById('ld-target')?.value || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.closeModal();
    App.toast('📅 Dates saved', 'var(--green)');
    Listings.load();
  },

  // ── Phase 2 actions ──
  addOffer(listingId) {
    const l = Listings.all.find(x => x.id === listingId);
    if (!l) return;
    if (l.bidding_closed_at) { App.toast('Bidding is closed — reopen it to log more offers', 'var(--yellow)'); return; }
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
      `\n\nThe highest offer isn't always the strongest — conditions and deposits matter too. Let's talk through these together and pick the one that's right for you.\n\nCall me any time, or reply to this email.`;

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
};
