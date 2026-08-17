// Maxwell DealFlow CRM — Showings on MY listings (sell side)
//
// Bookings happen in Maxwell's external showing app. That app emails a
// confirmation; this module is the two-tap capture of it, the running record,
// and the seller-facing report built from that record.
//
//   Log Showing   → date + time dropdowns, brokerage of the showing agent
//   Feedback      → what the agent said afterwards (kept apart from the rating)
//   Send Report   → "N showings in the last 3 days", queued to Approvals so
//                   Maxwell reviews (and can edit) before the seller sees it
//
// Deliberately NOT reusing `viewings`: that table is the buy side (Maxwell's
// clients viewing other people's homes, scoped by client_id and RLS). This is
// the opposite direction and belongs to a listing, not a client.
//
// Requires migration 091.

const Showings = {
  _byListing: {},     // listing_id -> [showings]
  _brokerages: [],    // recently used, for the datalist

  // Starter brokerage list. Anything typed is kept and offered next time, so
  // this only has to cover the first few showings.
  SEED_BROKERAGES: ['eXp Realty', 'Royal LePage', 'RE/MAX', 'Keller Williams',
                    'Century 21', 'Sutton Group', 'Hanlon Realty', '3% Realty'],

  RATING_LABEL: { interested: '🟢 Interested', maybe: '🟡 Maybe', not_a_fit: '⚪ Not a fit' },

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  fmtD(d) { return d ? ((typeof App !== 'undefined' && App.fmtDate) ? App.fmtDate(d) : String(d).slice(0, 10)) : '—'; },

  // '14:30' -> '2:30 PM'. Showing apps hand back 24h; sellers read 12h.
  fmt12h(t) {
    if (!t) return '';
    const [h, m] = String(t).split(':');
    const H = parseInt(h, 10);
    if (isNaN(H)) return String(t);
    const ampm = H >= 12 ? 'PM' : 'AM';
    const h12 = H % 12 === 0 ? 12 : H % 12;
    return `${h12}:${m || '00'} ${ampm}`;
  },

  // LOCAL calendar date, never UTC. toISOString() is UTC, and Newfoundland runs
  // 2.5 hours behind it — so an evening showing logged as "Today" would save
  // with tomorrow's date and land in the wrong report window.
  _localISO(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); },
  _today() { return Showings._localISO(new Date()); },
  _daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return Showings._localISO(d); },

  // ── Load ──────────────────────────────────────────────────────────────────
  async loadFor(listingIds) {
    Showings._byListing = {};
    if (!listingIds || !listingIds.length) return;
    const { data, error } = await db.from('listing_showings')
      .select('*').in('listing_id', listingIds)
      .order('showing_date', { ascending: false })
      .order('showing_time', { ascending: false });
    if (error) {
      console.warn('[Showings] listing_showings unavailable (run migration 091):', error.message);
      return;
    }
    (data || []).forEach(s => { (Showings._byListing[s.listing_id] = Showings._byListing[s.listing_id] || []).push(s); });
    // Brokerage autocomplete, most recently used first
    const seen = [];
    (data || []).forEach(s => { if (s.brokerage && !seen.includes(s.brokerage)) seen.push(s.brokerage); });
    Showings._brokerages = seen;
  },

  // Showings in the last N days (inclusive of today)
  countSince(listingId, days) {
    const from = Showings._daysAgo(days - 1);
    return (Showings._byListing[listingId] || [])
      .filter(s => s.status !== 'cancelled' && s.showing_date >= from).length;
  },

  // ── Card section, rendered inside the listing card ────────────────────────
  section(l) {
    const rows = Showings._byListing[l.id] || [];
    const c3 = Showings.countSince(l.id, 3);
    const c7 = Showings.countSince(l.id, 7);
    const total = rows.filter(s => s.status !== 'cancelled').length;
    const recent = rows.slice(0, 3);

    const list = recent.length ? recent.map(s => {
      const rate = s.feedback_rating ? `<span style="font-size:11px;">${Showings.RATING_LABEL[s.feedback_rating] || ''}</span>` : '';
      const cancelled = s.status === 'cancelled';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12.5px;${cancelled ? 'opacity:0.5;text-decoration:line-through;' : ''}">
          <span>👀 ${Showings.fmtD(s.showing_date)}${s.showing_time ? ' · ' + Showings.fmt12h(s.showing_time) : ''}
            ${s.brokerage ? '· <strong>' + Showings.esc(s.brokerage) + '</strong>' : ''}
            ${s.showing_agent ? '<span style="color:var(--text2);"> (' + Showings.esc(s.showing_agent) + ')</span>' : ''}</span>
          <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;">${rate}
            <button class="btn btn-outline btn-sm" style="padding:2px 7px;font-size:10.5px;" onclick="Showings.feedbackModal('${s.id}')">${s.feedback ? '✏️' : '💬'}</button>
            <button class="btn btn-outline btn-sm" style="padding:2px 7px;font-size:10.5px;border-color:var(--red);color:var(--red);" onclick="Showings.del('${s.id}')">🗑</button>
          </span>
        </div>`;
    }).join('') : `<div style="font-size:12px;color:var(--text2);padding:4px 0;">No showings logged yet.</div>`;

    const more = rows.length > 3
      ? `<div style="font-size:11px;color:var(--text2);margin-top:5px;">+ ${rows.length - 3} more logged</div>` : '';

    return `
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-size:12px;font-weight:800;letter-spacing:0.04em;color:var(--text2);">
            SHOWINGS (${total})${c3 ? ` · <span style="color:var(--accent2);">${c3} in last 3 days</span>` : ''}${c7 ? ` · ${c7} in last 7` : ''}
          </div>
        </div>
        ${list}${more}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          <button class="btn btn-sm" style="background:var(--accent);color:#fff;" onclick="Showings.quickLog('${l.id}')">👀 Log Showing</button>
          ${total ? `<button class="btn btn-outline btn-sm" onclick="Showings.reportModal('${l.id}')">📈 Send Showing Report</button>` : ''}
        </div>
      </div>`;
  },

  // ── Quick log — built for speed with a confirmation email open beside it ──
  // Date and time are dropdowns (the two things the confirmation gives you),
  // brokerage autocompletes off what you have logged before.
  quickLog(listingId) {
    const l = (typeof Listings !== 'undefined') ? Listings.all.find(x => x.id === listingId) : null;
    const dateOpts = [0, 1, 2, 3, 4, 5, 6].map(n => {
      const d = Showings._daysAgo(n);
      const lbl = n === 0 ? 'Today' : n === 1 ? 'Yesterday' : Showings.fmtD(d);
      return `<option value="${d}">${lbl}${n <= 1 ? ' (' + Showings.fmtD(d) + ')' : ''}</option>`;
    }).join('');

    // 8:00 AM to 8:00 PM in 30 minute slots
    let timeOpts = '<option value="">Time not given</option>';
    for (let h = 8; h <= 20; h++) {
      for (const m of ['00', '30']) {
        const v = `${String(h).padStart(2, '0')}:${m}`;
        timeOpts += `<option value="${v}">${Showings.fmt12h(v)}</option>`;
      }
    }

    const brokerList = Showings._brokerages.concat(
      Showings.SEED_BROKERAGES.filter(b => !Showings._brokerages.includes(b))
    );

    App.openModal(`
      <div class="modal-title">👀 Log Showing${l ? ' — ' + Showings.esc(l.property_address) : ''}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">Straight off the confirmation from your showing app. Two dropdowns and the brokerage, then done.</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Date *</label>
          <select class="form-input form-select" id="sh-date">${dateOpts}<option value="__other">Other date…</option></select>
          <input class="form-input" type="date" id="sh-date-other" style="display:none;margin-top:6px;" value="${Showings._today()}">
        </div>
        <div class="form-group"><label class="form-label">Time</label>
          <select class="form-input form-select" id="sh-time">${timeOpts}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Brokerage doing the showing *</label>
        <input class="form-input" id="sh-brokerage" list="sh-brokerage-list" placeholder="Start typing…" autocomplete="off">
        <datalist id="sh-brokerage-list">${brokerList.map(b => `<option value="${Showings.esc(b)}"></option>`).join('')}</datalist>
        ${Showings._brokerages.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${
          Showings._brokerages.slice(0, 4).map(b =>
            `<button type="button" class="btn btn-outline btn-sm" style="padding:3px 9px;font-size:11px;" onclick="document.getElementById('sh-brokerage').value=this.textContent.trim()">${Showings.esc(b)}</button>`
          ).join('')}</div>` : ''}
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Showing agent (optional)</label>
          <input class="form-input" id="sh-agent" placeholder="Agent name"></div>
        <div class="form-group"><label class="form-label">Notes (optional)</label>
          <input class="form-input" id="sh-notes" placeholder="Second visit, brought family…"></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="Showings.save('${listingId}')">Save Showing</button>
      <div id="sh-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);

    const sel = document.getElementById('sh-date');
    if (sel) sel.addEventListener('change', function () {
      const other = document.getElementById('sh-date-other');
      if (other) other.style.display = this.value === '__other' ? 'block' : 'none';
    });
  },

  async save(listingId) {
    const msg = document.getElementById('sh-msg');
    const pick = document.getElementById('sh-date')?.value;
    const date = pick === '__other' ? document.getElementById('sh-date-other')?.value : pick;
    const brokerage = document.getElementById('sh-brokerage')?.value.trim();
    if (!date) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Pick a date'; } return; }
    if (!brokerage) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Brokerage is required — it is what the seller report is built on'; } return; }

    const user = await App.getAuthUser();
    const uid = user?.id || currentAgent.id;
    const { error } = await db.from('listing_showings').insert({
      agent_id: uid,
      listing_id: listingId,
      showing_date: date,
      showing_time: document.getElementById('sh-time')?.value || null,
      brokerage,
      showing_agent: document.getElementById('sh-agent')?.value.trim() || null,
      notes: document.getElementById('sh-notes')?.value.trim() || null,
      source: 'manual',
      status: 'booked',
    });
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }
    App.closeModal();
    App.toast('👀 Showing logged', 'var(--green)');
    if (typeof Listings !== 'undefined') Listings.load();
  },

  // ── Feedback after the showing ────────────────────────────────────────────
  feedbackModal(id) {
    let s = null;
    Object.values(Showings._byListing).forEach(arr => { const f = arr.find(x => x.id === id); if (f) s = f; });
    if (!s) return;
    const opt = (v, label) => `<option value="${v}"${s.feedback_rating === v ? ' selected' : ''}>${label}</option>`;
    App.openModal(`
      <div class="modal-title">💬 Showing Feedback</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">${Showings.fmtD(s.showing_date)}${s.showing_time ? ' · ' + Showings.fmt12h(s.showing_time) : ''}${s.brokerage ? ' · ' + Showings.esc(s.brokerage) : ''}</div>
      <div class="form-group"><label class="form-label">Read on it</label>
        <select class="form-input form-select" id="sf-rating">
          <option value="">Not given</option>
          ${opt('interested', '🟢 Interested')}
          ${opt('maybe', '🟡 Maybe')}
          ${opt('not_a_fit', '⚪ Not a fit')}
        </select></div>
      <div class="form-group"><label class="form-label">What the agent actually said</label>
        <textarea class="form-input" id="sf-text" rows="3" placeholder="Loved the kitchen, thought the yard was small for the price…">${Showings.esc(s.feedback || '')}</textarea>
        <div style="font-size:11px;color:var(--text2);margin-top:4px;">This is quoted to the seller as their words, kept separate from your read on it.</div></div>
      <div class="form-group"><label class="form-label">Status</label>
        <select class="form-input form-select" id="sf-status">
          <option value="booked"${s.status === 'booked' ? ' selected' : ''}>Booked</option>
          <option value="completed"${s.status === 'completed' ? ' selected' : ''}>Completed</option>
          <option value="cancelled"${s.status === 'cancelled' ? ' selected' : ''}>Cancelled</option>
          <option value="no_show"${s.status === 'no_show' ? ' selected' : ''}>No show</option>
        </select></div>
      <button class="btn btn-primary btn-block" onclick="Showings.saveFeedback('${id}')">Save Feedback</button>
      <div id="sf-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async saveFeedback(id) {
    const msg = document.getElementById('sf-msg');
    const text = document.getElementById('sf-text')?.value.trim() || null;
    const rating = document.getElementById('sf-rating')?.value || null;
    const { error } = await db.from('listing_showings').update({
      feedback: text,
      feedback_rating: rating || null,
      feedback_at: (text || rating) ? new Date().toISOString() : null,
      status: document.getElementById('sf-status')?.value || 'booked',
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ ' + error.message; } return; }
    App.closeModal();
    App.toast('💬 Feedback saved', 'var(--green)');
    if (typeof Listings !== 'undefined') Listings.load();
  },

  async del(id) {
    if (!confirm('Delete this showing record?')) return;
    const { error } = await db.from('listing_showings').delete().eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.toast('🗑 Showing deleted', 'var(--text2)');
    if (typeof Listings !== 'undefined') Listings.load();
  },

  // ── Seller report ─────────────────────────────────────────────────────────
  // Built from the record, never from memory. Facts (count, dates, brokerages,
  // quoted feedback) stay separate from the read on it — the thing every
  // showing-report guide says sellers actually need.
  reportModal(listingId) {
    const l = (typeof Listings !== 'undefined') ? Listings.all.find(x => x.id === listingId) : null;
    if (!l) return;
    const since = l.last_seller_report_at ? Showings.fmtD(l.last_seller_report_at) : null;
    App.openModal(`
      <div class="modal-title">📈 Showing Report — ${Showings.esc(l.property_address)}</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">
        ${since ? `Last report sent ${since}.` : 'No report sent yet on this listing.'}
        The draft goes to Approvals, where you can edit every word before it sends.</div>
      <div class="form-group"><label class="form-label">Cover the last…</label>
        <select class="form-input form-select" id="sr-days">
          <option value="3" selected>3 days</option>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
        </select></div>
      <div id="sr-preview" style="background:var(--bg);border-radius:8px;padding:12px;font-size:12.5px;line-height:1.6;max-height:260px;overflow-y:auto;margin-bottom:12px;white-space:pre-wrap;"></div>
      <button class="btn btn-primary btn-block" onclick="Showings.queueReport('${listingId}')">📨 Queue for my approval</button>
      <div id="sr-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
    const refresh = () => {
      const days = parseInt(document.getElementById('sr-days')?.value, 10) || 3;
      const r = Showings.buildReport(l, days);
      const box = document.getElementById('sr-preview');
      if (box) box.textContent = r ? r.plain : 'No showings in this window.';
    };
    document.getElementById('sr-days')?.addEventListener('change', refresh);
    refresh();
  },

  // Returns { subject, plain, html, count } or null when the window is empty.
  buildReport(l, days) {
    const from = Showings._daysAgo(days - 1);
    const prevFrom = Showings._daysAgo(days * 2 - 1);
    const all = Showings._byListing[l.id] || [];
    const rows = all.filter(s => s.status !== 'cancelled' && s.showing_date >= from);
    const prev = all.filter(s => s.status !== 'cancelled' && s.showing_date >= prevFrom && s.showing_date < from);
    if (!rows.length && !prev.length) return null;

    const sellerName = l.clients?.full_name || 'there';
    const first = String(sellerName).split(' ')[0];
    const n = rows.length;
    const trend = !prev.length ? '' :
      n > prev.length ? ` That is up from ${prev.length} in the ${days} days before.`
      : n < prev.length ? ` That is down from ${prev.length} in the ${days} days before.`
      : ` Same as the ${days} days before.`;

    const withFb = rows.filter(s => s.feedback);
    const offers = (typeof Listings !== 'undefined' && Listings._offers[l.id]) ? Listings._offers[l.id].length : 0;

    // Plain text
    const lines = rows.map(s =>
      `  • ${Showings.fmtD(s.showing_date)}${s.showing_time ? ' at ' + Showings.fmt12h(s.showing_time) : ''}${s.brokerage ? ', ' + s.brokerage : ''}`
    ).join('\n');
    const fbLines = withFb.map(s =>
      `  • ${s.brokerage || 'The showing agent'}: "${s.feedback}"`
    ).join('\n');

    const plain =
      `Hi ${first},\n\n` +
      `Here is where things stand at ${l.property_address} over the last ${days} days.\n\n` +
      `SHOWINGS BOOKED: ${n}.${trend}\n\n` +
      (lines ? `${lines}\n\n` : '') +
      (fbLines ? `WHAT THE AGENTS SAID\n${fbLines}\n\n` : `No written feedback has come back yet on these showings. I chase it up where an agent is willing to share.\n\n`) +
      (offers ? `OFFERS LOGGED SO FAR: ${offers}\n\n` : '') +
      `I will keep these coming as activity continues. If you want to talk through what the pattern is telling us, call me any time.\n\n` +
      `Best regards,\n` +
      ((typeof EmailFormat !== 'undefined' && EmailFormat.signaturePlain) ? EmailFormat.signaturePlain(currentAgent) : (currentAgent?.full_name || 'Maxwell Delali Midodzi')) +
      ((typeof EmailFormat !== 'undefined' && EmailFormat.disclaimerPlain) ? EmailFormat.disclaimerPlain() : '');

    // HTML — inline styles only, same email-safe approach as the offer snapshot
    const rowHtml = rows.map(s => `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #eef0f3;font-size:13px;color:#202124;">${Showings.fmtD(s.showing_date)}${s.showing_time ? '<br><span style="color:#5f6368;font-size:12px;">' + Showings.fmt12h(s.showing_time) + '</span>' : ''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #eef0f3;font-size:13px;color:#202124;">${Showings.esc(s.brokerage || 'Not given')}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #eef0f3;font-size:13px;color:#5f6368;">${s.feedback ? Showings.esc(s.feedback) : '<span style="color:#9aa0a6;">Awaiting feedback</span>'}</td>
      </tr>`).join('');

    const sig = (typeof EmailFormat !== 'undefined') ? EmailFormat.signatureHTML(currentAgent) : '';
    const dis = (typeof EmailFormat !== 'undefined') ? EmailFormat.disclaimerHTML() : '';
    const styles = (typeof EmailFormat !== 'undefined' && EmailFormat.styles) ? EmailFormat.styles() : '';

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body>
      <p>Hi ${Showings.esc(first)},</p>
      <p>Here is where things stand at <strong>${Showings.esc(l.property_address)}</strong> over the last ${days} days.</p>
      <div style="background:#f4f6f8;border-radius:10px;padding:18px 20px;margin:16px 0;text-align:center;">
        <div style="font-size:34px;font-weight:800;color:#157347;line-height:1;">${n}</div>
        <div style="font-size:13px;color:#5f6368;margin-top:4px;">showing${n === 1 ? '' : 's'} booked in the last ${days} days</div>
        ${trend ? `<div style="font-size:12.5px;color:#5f6368;margin-top:6px;">${Showings.esc(trend.trim())}</div>` : ''}
      </div>
      ${rows.length ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <th align="left" style="padding:7px 10px;border-bottom:2px solid #d7dbe0;font-size:11px;letter-spacing:0.05em;color:#5f6368;text-transform:uppercase;">When</th>
          <th align="left" style="padding:7px 10px;border-bottom:2px solid #d7dbe0;font-size:11px;letter-spacing:0.05em;color:#5f6368;text-transform:uppercase;">Brokerage</th>
          <th align="left" style="padding:7px 10px;border-bottom:2px solid #d7dbe0;font-size:11px;letter-spacing:0.05em;color:#5f6368;text-transform:uppercase;">What they said</th>
        </tr>${rowHtml}
      </table>` : ''}
      ${offers ? `<p style="font-size:13px;color:#202124;"><strong>Offers logged so far:</strong> ${offers}</p>` : ''}
      ${!withFb.length ? `<p style="font-size:13px;color:#5f6368;">No written feedback has come back yet on these showings. I chase it up where an agent is willing to share.</p>` : ''}
      <p>I will keep these coming as activity continues. If you want to talk through what the pattern is telling us, call me any time.</p>
      <p>Best regards,</p>
      ${sig}${dis}
    </body></html>`;

    return {
      subject: `Showing update for ${l.property_address} (${n} showing${n === 1 ? '' : 's'} in ${days} days)`,
      plain, html, count: n,
    };
  },

  async queueReport(listingId) {
    const l = (typeof Listings !== 'undefined') ? Listings.all.find(x => x.id === listingId) : null;
    const msg = document.getElementById('sr-msg');
    if (!l) return;
    const days = parseInt(document.getElementById('sr-days')?.value, 10) || 3;
    const sellerEmail = l.clients?.email;
    if (!sellerEmail) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ This seller has no email on file — add it on their client record first'; } return; }
    if (typeof Notify === 'undefined' || !Notify.queue) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Email system not loaded — reload and retry'; } return; }

    const r = Showings.buildReport(l, days);
    if (!r) { if (msg) { msg.style.color = 'var(--yellow)'; msg.textContent = 'Nothing to report in this window — log a showing first'; } return; }

    if (msg) { msg.style.color = 'var(--text2)'; msg.textContent = 'Queueing…'; }
    const ok = await Notify.queue('Seller Showing Report', l.client_id,
      l.clients?.full_name || 'Seller', sellerEmail, r.subject, r.plain, l.id, r.html);
    if (!ok) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Could not queue the report'; } return; }

    await db.from('listings').update({ last_seller_report_at: new Date().toISOString() }).eq('id', listingId);
    App.closeModal();
    App.toast('📈 Report queued — open Approvals to review, edit, and send', 'var(--green)');
    if (App.pushNotify) App.pushNotify('📈 Showing report ready', `${l.property_address} · ${r.count} showing${r.count === 1 ? '' : 's'}`, 'approvals');
    if (typeof Listings !== 'undefined') Listings.load();
  },
};
