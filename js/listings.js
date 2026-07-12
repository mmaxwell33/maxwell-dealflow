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
            <span>${tag}Offer #${o.offer_no}${o.buyer_name ? ' · ' + Listings.esc(o.buyer_name) : ''}${o.conditions ? ' · <span style="color:var(--text2);font-size:11px;">' + Listings.esc(o.conditions) + '</span>' : ''}</span>
            <span style="display:flex;align-items:center;gap:8px;"><span style="text-align:right;"><span class="fw-800">${Listings.money(o.amount)}</span><br>${pctTxt}</span>${pickBtn}</span>
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
          <button class="btn btn-outline btn-sm" onclick="Listings.editListing('${l.id}')">✏️ Edit</button>
          <button class="btn btn-outline btn-sm" style="border-color:var(--red);color:var(--red);" onclick="Listings.deleteListing('${l.id}')">🗑 Delete</button>
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
    if ((Listings._offers[listingId] || []).some(o => o.status === 'winner')) {
      App.toast('A winner has already been picked — bidding can\'t be reopened', 'var(--yellow)'); return;
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
    const { data: newDeal, error: e3 } = await db.from('pipeline').insert({
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
      closing_date: close,
      stage: 'Accepted',
      status: 'Active',
      deal_type: 'existing_home',
      deal_side: 'sell',
      listing_id: listingId,
    }).select('id').single();
    if (e3) {
      if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Deal not created: ' + e3.message + ' — the winner IS marked; add the deal manually in Pipeline.'; }
      console.error('[confirmWinner] pipeline insert failed:', e3);
      Listings.load();
      return;
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
    App.closeModal();
    App.toast(`🏆 Offer #${o.offer_no} accepted — sell-side deal created in Pipeline`, 'var(--green)');
    if (App.pushNotify) App.pushNotify('🏆 Offer accepted', `${l.property_address} · ${Listings.money(o.amount)}`, 'approvals');
    Listings.load();
    if (typeof Pipeline !== 'undefined' && typeof currentTab !== 'undefined' && currentTab === 'pipeline') Pipeline.load();
  },
};
