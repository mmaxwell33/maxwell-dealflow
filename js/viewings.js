// Maxwell DealFlow CRM — Viewings Module
const Viewings = {
  all: [],
  activeFilter: 'all',

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('viewings')
      .select('*, clients(full_name, email)')
      .order('viewing_date', { ascending: false })
      .limit(100);
    Viewings.all = data || [];
    Viewings.render(Viewings.all);
  },

  filter(f, btn) {
    Viewings.activeFilter = f;
    // Phase 2.B.10: scoped to #viewings-filter so the "+ Book" button
    // in the section header is no longer swept when a filter chip is tapped.
    document.querySelectorAll('#viewings-filter .btn2').forEach(b => {
      b.className = b === btn ? 'btn2 btn2-primary btn2-sm' : 'btn2 btn2-ghost btn2-sm';
    });
    const today = new Date().toISOString().slice(0,10);
    const filtered = Viewings.all.filter(v => {
      if (f === 'all') return true;
      if (f === 'today') return v.viewing_date === today;
      if (f === 'upcoming') return v.viewing_date > today && v.viewing_status !== 'Completed';
      if (f === 'completed') return v.viewing_status === 'Completed';
      return true;
    });
    Viewings.render(filtered);
  },

  render(list) {
    const el = document.getElementById('viewings-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-text">No viewings found</div><div class="empty-sub">Tap + Book to schedule a showing</div></div>`;
      return;
    }
    // Phase 2.B.3: viewing status → pill2 variant
    const statusPill = {
      Scheduled: 'pill2-indigo',
      Confirmed: 'pill2-green',
      Completed: 'pill2-neutral',
      Cancelled: 'pill2-coral'
    };
    const fb = (x) => x === 'good' ? '✅ Good' : x === 'interested' ? '🌟 Interested' : '❌ Not a fit';
    el.innerHTML = list.map(v => {
      const st = v.viewing_status || 'Scheduled';
      return `
      <div class="card2" style="margin-bottom:10px;">
        <div class="card2-header" style="margin-bottom:6px;cursor:pointer;" onclick="Viewings.openDetail('${v.id}')">
          <div class="card2-title" style="flex:1;margin-right:8px;">${v.property_address || 'No address'}</div>
          <span class="pill2 ${statusPill[st]||'pill2-neutral'}">${st}</span>
        </div>
        <div class="card2-sub" style="margin-bottom:8px;cursor:pointer;" onclick="Viewings.openDetail('${v.id}')">👤 ${App.privateName(v.clients?.full_name || '')}${(() => { const c = Clients.all.find(x => x.id === v.client_id) || {}; return c.is_guest ? ` <span class="pill2 pill2-amber">${c.linked_client_id ? '🔗 Stand-in' : 'Guest'}</span>` : ''; })()}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;cursor:pointer;" onclick="Viewings.openDetail('${v.id}')">
          <span style="color:var(--text2);">📅 ${App.fmtDate(v.viewing_date)} ${v.viewing_time ? '· ' + v.viewing_time.slice(0,5) : ''}</span>
          ${v.list_price ? `<span style="color:var(--accent2);font-weight:700;">${App.fmtMoney(v.list_price)}</span>` : ''}
        </div>
        ${v.client_feedback ? `<div style="margin-top:8px;"><span class="pill2 pill2-neutral">${fb(v.client_feedback)}</span></div>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">
          <button class="btn2 btn2-ghost btn2-sm" style="flex:1;justify-content:center;" onclick="Viewings.openDetail('${v.id}')">Details</button>
          <button class="btn2 btn2-sm" style="background:var(--red);color:#fff;" onclick="Viewings.deleteViewing('${v.id}')">Delete</button>
        </div>
      </div>`;
    }).join('');
  },

  openAdd() {
    Viewings._showForm(null, null, null);
  },

  openAddForClient(clientId, clientName) {
    App.closeModal();
    setTimeout(() => Viewings._showForm(clientId, clientName, null), 300);
  },

  // 'client' = pick from the roster, 'guest' = type a name for someone who
  // isn't in the system yet. Reset every time the form opens.
  _who: 'client',

  _setWho(mode) {
    Viewings._who = (mode === 'guest') ? 'guest' : 'client';
    const sel   = document.getElementById('vf-client');
    const guest = document.getElementById('vf-guest-fields');
    const bC    = document.getElementById('vf-who-client');
    const bG    = document.getElementById('vf-who-guest');
    if (sel)   sel.style.display   = (Viewings._who === 'guest') ? 'none' : '';
    if (guest) guest.style.display = (Viewings._who === 'guest') ? '' : 'none';
    if (bC) bC.setAttribute('aria-pressed', Viewings._who === 'client' ? 'true' : 'false');
    if (bG) bG.setAttribute('aria-pressed', Viewings._who === 'guest'  ? 'true' : 'false');
    if (Viewings._who === 'guest') document.getElementById('vf-guest-name')?.focus();
  },

  _showForm(clientId, clientName, viewing) {
    const today = new Date().toISOString().slice(0,10);
    Viewings._who = 'client';
    const clientOptions = Clients.all.map(c =>
      `<option value="${c.id}" ${c.id===clientId?'selected':''}>${App.esc(c.full_name)}${c.is_guest ? ' (guest)' : ''}</option>`
    ).join('');
    // Guest mode is offered on NEW bookings only. Editing an existing viewing
    // already has a clients row behind it — swapping that for a typed name
    // would orphan the confirmation email and the feedback token.
    const whoToggle = viewing ? '' : `
      <div style="display:inline-flex;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:4px;gap:4px;margin-bottom:8px;">
        <button type="button" class="cl-chip" id="vf-who-client" aria-pressed="true"  onclick="Viewings._setWho('client')">👤 My client</button>
        <button type="button" class="cl-chip" id="vf-who-guest"  aria-pressed="false" onclick="Viewings._setWho('guest')">✨ Guest</button>
      </div>`;
    // A sheet read for a previous booking must never be attached to this one.
    if (typeof MLSDrop !== 'undefined') MLSDrop.reset();
    App.openModal(`
      <div class="modal-title">📅 ${viewing ? 'Edit' : 'Book'} Viewing</div>
      ${typeof MLSDrop !== 'undefined' ? MLSDrop.zone() : `
      <div style="border:1px solid var(--yellow);background:rgba(176,141,87,0.12);border-radius:9px;padding:11px 13px;margin-bottom:14px;font-size:12.5px;color:var(--text1);line-height:1.5;">
        ⚠️ The MLS sheet reader did not load, so there is nothing to drop a sheet on.
        <span style="color:var(--text2);">Booking by hand below works exactly as it always has. A hard reload usually fixes it: hold Shift and press reload.</span>
      </div>`}
      <div class="form-group">
        <label class="form-label">Client *</label>
        ${whoToggle}
        <select class="form-input form-select" id="vf-client">
          <option value="">-- Select Client --</option>
          ${clientOptions}
        </select>
        <div id="vf-guest-fields" style="display:none;">
          <input class="form-input" id="vf-guest-name" placeholder="Guest's full name *" style="margin-bottom:8px;">
          <div class="form-row" style="margin-bottom:0;">
            <div class="form-group" style="margin-bottom:0;">
              <input class="form-input" id="vf-guest-email" type="email" placeholder="Email (for the confirmation)">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <input class="form-input" id="vf-guest-phone" type="tel" placeholder="Phone">
            </div>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:8px;">
            Books exactly like a normal viewing, including the confirmation email and
            feedback link. They stay off your client roster and out of Broadcast until
            you promote them, which is one button on the viewing.
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Property Address *</label>
        <input class="form-input" id="vf-address" placeholder="123 Main St, St. John's NL" value="${viewing?.property_address||''}">
      </div>
      <div class="form-group">
        <label class="form-label">Property Type</label>
        <select class="form-input form-select" id="vf-ptype">
          <option value="existing_home" ${viewing?.property_type!=='new_build'?'selected':''}>🏠 Existing Home</option>
          <option value="new_build" ${viewing?.property_type==='new_build'?'selected':''}>🏗️ New Build / Lot</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">MLS Number</label>
          <input class="form-input" id="vf-mls" placeholder="1234567" value="${viewing?.mls_number||''}">
        </div>
        <div class="form-group">
          <label class="form-label">List Price ($)</label>
          <input class="form-input" id="vf-price" type="number" placeholder="399000" value="${viewing?.list_price||''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Date *</label>
          <input class="form-input" id="vf-date" type="date" value="${viewing?.viewing_date||today}">
        </div>
        <div class="form-group">
          <label class="form-label">Time</label>
          <input class="form-input" id="vf-time" type="time" value="${viewing?.viewing_time||''}">
        </div>
        <div class="form-group">
          <label class="form-label">Duration</label>
          <select class="form-input form-select" id="vf-duration">
            <option value="10" ${viewing?.viewing_duration===10?'selected':''}>10 minutes</option>
            <option value="15" ${viewing?.viewing_duration===15?'selected':''}>15 minutes</option>
            <option value="30" ${(!viewing?.viewing_duration||viewing?.viewing_duration===30)?'selected':''}>30 minutes</option>
            <option value="45" ${viewing?.viewing_duration===45?'selected':''}>45 minutes</option>
            <option value="60" ${viewing?.viewing_duration===60?'selected':''}>1 hour</option>
            <option value="90" ${viewing?.viewing_duration===90?'selected':''}>1.5 hours</option>
            <option value="120" ${viewing?.viewing_duration===120?'selected':''}>2 hours</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">CC Email (optional — e.g. second buyer, co-purchaser)</label>
        <input class="form-input" id="vf-cc" type="email" placeholder="other@email.com" value="${viewing?.cc_email||''}">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-input form-select" id="vf-vstatus">
          <option value="Scheduled" ${!viewing||viewing.viewing_status==='Scheduled'?'selected':''}>Scheduled</option>
          <option value="Confirmed" ${viewing?.viewing_status==='Confirmed'?'selected':''}>Confirmed</option>
          <option value="Completed" ${viewing?.viewing_status==='Completed'?'selected':''}>Completed</option>
          <option value="Cancelled" ${viewing?.viewing_status==='Cancelled'?'selected':''}>Cancelled</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Client Feedback</label>
        <select class="form-input form-select" id="vf-feedback">
          <option value="">-- Not yet --</option>
          <option value="good" ${viewing?.client_feedback==='good'?'selected':''}>✅ Good / Like it</option>
          <option value="interested" ${viewing?.client_feedback==='interested'?'selected':''}>🌟 Very Interested</option>
          <option value="pass" ${viewing?.client_feedback==='pass'?'selected':''}>❌ Pass</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Offer Due Date</label>
          <input class="form-input" id="vf-offer-date" type="date" value="${viewing?.offer_due_date||''}">
        </div>
        <div class="form-group">
          <label class="form-label">Offer Due Time</label>
          <input class="form-input" id="vf-offer-time" type="time" value="${viewing?.offer_due_time||''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Seller's Direction</label>
        <select class="form-input form-select" id="vf-sellers-dir">
          <option value="" ${!viewing?.sellers_direction?'selected':''}>-- Not specified --</option>
          <option value="Offers anytime" ${viewing?.sellers_direction==='Offers anytime'?'selected':''}>Offers anytime</option>
          <option value="Offer date set" ${viewing?.sellers_direction==='Offer date set'?'selected':''}>Offer date set</option>
          <option value="No conveyance" ${viewing?.sellers_direction==='No conveyance'?'selected':''}>No conveyance</option>
          <option value="Seller reviewing offers" ${viewing?.sellers_direction==='Seller reviewing offers'?'selected':''}>Seller reviewing offers</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">About This Home <span style="text-transform:none;letter-spacing:0;color:var(--accent2);">(goes to the client, in italics)</span></label>
        <textarea class="form-input" id="vf-highlights" rows="4" placeholder="Two storey, built 1998. About 1,840 sq ft with 3 bedrooms and 2.5 baths. Shingles replaced 2021.">${viewing?.property_highlights||''}</textarea>
        <div style="font-size:11.5px;color:var(--text2);margin-top:5px;line-height:1.5;">
          Written from the facts on the MLS sheet. Edit or clear it. Cleared means the client email carries no note at all.
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Agent Notes <span style="text-transform:none;letter-spacing:0;color:var(--text2);">(private, never sent to the client)</span></label>
        <textarea class="form-input" id="vf-notes" rows="2" placeholder="Your own note on this showing...">${viewing?.agent_notes||''}</textarea>
      </div>
      <button class="btn2 btn2-primary" style="width:100%;justify-content:center;" onclick="Viewings.save(${viewing?`'${viewing.id}'`:'null'})">
        ${viewing ? 'Update Viewing' : 'Book Viewing'}
      </button>
      <div id="vf-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  // Create the minimal clients row that backs a guest viewing. Returns the new
  // row, or null on failure (the caller shows the message).
  //
  // email_consent is 'none' ON PURPOSE: this person asked for one showing, so
  // the transactional confirmation for that showing is fine, but they must
  // never land in a Broadcast send. Promotion (Clients.promoteGuest) is what
  // moves them to 'implied'.
  async _createGuest(msgEl) {
    const name  = document.getElementById('vf-guest-name')?.value.trim();
    const email = document.getElementById('vf-guest-email')?.value.trim() || '';
    const phone = document.getElementById('vf-guest-phone')?.value.trim() || '';
    if (!name) {
      if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent = "⚠️ Guest's name is required"; }
      return null;
    }
    // That email may already be on this agent's list: a past client booking
    // again, the same guest booked twice, or someone sitting in the Archive.
    // clients is UNIQUE on (agent_id, email), so inserting would fail with a
    // raw Postgres constraint error. Book onto the record that already exists
    // instead of refusing the booking.
    if (email) {
      const existing = await Viewings._findClientByEmail(email);
      if (existing) {
        // Ask first when the match is not obviously the same person in front
        // of him: a different name on file (a couple sharing an inbox, or a
        // typo), or a record sitting in the Archive where the booking would
        // otherwise land out of sight. Both are Maxwell's call, not ours.
        const archived   = (existing.status || '') === 'Archived';
        const nameDiffers = (existing.full_name || '').trim().toLowerCase() !== name.toLowerCase();
        if (archived || nameDiffers) {
          const who = existing.full_name + (archived ? ' (archived)' : '');
          if (!confirm(`${email} is already on your list as ${who}.\n\nBook this viewing under that record?`)) {
            if (msgEl) { msgEl.style.color='var(--text2)'; msgEl.textContent = 'Cancelled. Use a different email, or pick them under "My client".'; }
            return null;
          }
        }
        await App.logActivity('GUEST_VIEWING_BOOKED', existing.full_name, existing.email || null,
          `Viewing booked onto the existing record for ${existing.email}`, existing.id);
        return { ...existing, _reused: true };
      }
    }
    const { data, error } = await db.from('clients').insert({
      agent_id: currentAgent.id,
      full_name: name,
      // NULL rather than '', so two guests booked with no email on file do not
      // collide with each other on that same (agent_id, email) constraint.
      email: email || null,
      phone,
      stage: 'Searching', status: 'Active',
      is_guest: true, guest_since: new Date().toISOString(),
      email_consent: 'none', consent_source: 'guest viewing request',
      notes: 'Guest. Booked a viewing before joining the roster.'
    }).select().single();
    if (error) {
      // Lost a race, or a stored variant the lookup above did not match. The
      // answer is the same one: use the row that exists.
      if (email && (error.code === '23505' || /duplicate|unique/i.test(error.message || ''))) {
        const existing = await Viewings._findClientByEmail(email);
        if (existing) return { ...existing, _reused: true };
        if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent = `⚠️ ${email} is already on your client list. Pick them under "My client" instead.`; }
        return null;
      }
      if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent = error.message; }
      return null;
    }
    await App.logActivity('GUEST_VIEWING_BOOKED', name, email || null,
      `Guest added from a viewing booking: ${name}`, data.id);
    return data;
  },

  // The one client of this agent holding that email, or null. Archived clients
  // count: they are kept out of Clients.all but they still hold the unique
  // constraint. Matching is case-insensitive locally and exact on the server
  // (no ilike, because '_' in an email is a LIKE wildcard and would match the
  // wrong person).
  async _findClientByEmail(email) {
    const needle = email.trim().toLowerCase();
    if (typeof Clients !== 'undefined') {
      const local = [...(Clients.all || []), ...(Clients.archived || [])]
        .find(c => (c.email || '').trim().toLowerCase() === needle);
      if (local) return local;
    }
    // Not in memory: could have been created since the last load.
    const { data } = await db.from('clients').select('*')
      .eq('agent_id', currentAgent.id).eq('email', email.trim()).limit(1);
    return (data && data[0]) || null;
  },

  // Write the viewing, surviving a database that has not had migration 096 yet.
  // property_highlights is the only new column in the payload; if the server
  // does not know it, drop it and write the booking anyway. Losing a booking
  // over a column that only adds a line to an email would be the wrong trade.
  async _write(payload, existingId) {
    const run = p => existingId
      ? db.from('viewings').update(p).eq('id', existingId)
      : db.from('viewings').insert(p);
    let { error } = await run(payload);
    if (error && /property_highlights/.test(error.message || '')) {
      const rest = { ...payload };
      delete rest.property_highlights;
      ({ error } = await run(rest));
      if (!error) App.toast('⚠️ Viewing saved, but the client note needs migration 096', 'var(--yellow)');
    }
    return error;
  },

  // File the MLS sheet this booking was read from, and record where it went.
  // Everything here is best-effort: the viewing is already saved, and neither a
  // storage hiccup nor a missing migration 096 should surface as a failure on a
  // booking that went through.
  async _attachSheet(viewingId) {
    if (typeof MLSDrop === 'undefined' || (!MLSDrop._file && !MLSDrop._remarks)) return;
    const doc = await MLSDrop.store(viewingId);
    if (!doc) return;
    const { error } = await db.from('viewings').update(doc).eq('id', viewingId);
    if (error) console.warn('[Viewings] could not record the MLS sheet path:', error.message);
  },

  async save(existingId = null) {
    const address = document.getElementById('vf-address').value.trim();
    const msgEl = document.getElementById('vf-msg');
    const isGuest = !existingId && Viewings._who === 'guest';
    let clientId = isGuest ? '' : document.getElementById('vf-client').value;
    if ((!isGuest && !clientId) || !address) {
      if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent = '⚠️ Client and address required'; }
      return;
    }
    if (msgEl) { msgEl.style.color='var(--text2)'; msgEl.textContent = 'Saving...'; }
    // A guest becomes a real (flagged) clients row first, so everything below —
    // the insert, the confirmation email, the feedback token — runs unchanged.
    let guestRow = null;
    if (isGuest) {
      guestRow = await Viewings._createGuest(msgEl);
      if (!guestRow) return;
      clientId = guestRow.id;
      // Only a genuinely new guest joins the in-memory roster. A reused record
      // is already there (or is archived, and belongs in the Archive).
      if (!guestRow._reused) Clients.all.push({ ...guestRow, _derivedStage: 'Searching' });
    }
    const client = guestRow || Clients.all.find(c => c.id === clientId);
    const payload = {
      client_id: clientId,
      property_address: address,
      property_type: document.getElementById('vf-ptype')?.value || 'existing_home',
      mls_number: document.getElementById('vf-mls').value.trim(),
      list_price: document.getElementById('vf-price').value || null,
      viewing_date: document.getElementById('vf-date').value,
      viewing_time: document.getElementById('vf-time').value || null,
      viewing_duration: parseInt(document.getElementById('vf-duration')?.value || '30'),
      cc_email: document.getElementById('vf-cc')?.value.trim() || null,
      offer_due_date: document.getElementById('vf-offer-date').value || null,
      offer_due_time: document.getElementById('vf-offer-time').value || null,
      sellers_direction: document.getElementById('vf-sellers-dir').value || null,
      viewing_status: document.getElementById('vf-vstatus')?.value || 'Scheduled',
      // Empty box means no note in the client email at all, so store NULL
      // rather than '' and let the template's truthiness check do its job.
      property_highlights: document.getElementById('vf-highlights')?.value.trim() || null,
      agent_notes: document.getElementById('vf-notes').value.trim(),
      client_feedback: document.getElementById('vf-feedback').value || null,
      updated_at: new Date().toISOString()
    };

    // Snapshot old cc_email before update (to detect if CC was just added)
    const oldViewing = existingId ? Viewings.all.find(v => v.id === existingId) : null;

    let error;
    if (existingId) {
      error = await Viewings._write(payload, existingId);
      if (!error) {
        await Viewings._attachSheet(existingId);
        // Re-send confirmation as "Update" email if client has an email on file
        if (typeof Notify !== 'undefined' && client?.email) {
          const updatedViewing = { ...oldViewing, ...payload, id: existingId };
          await Notify.onViewingBooked(updatedViewing, client, true); // true = isUpdate
        }
      }
    } else {
      error = await Viewings._write(payload, null);
      if (!error) {
        await App.logActivity('VIEWING_SCHEDULED', client?.full_name, client?.email,
          `Viewing scheduled: ${address}`, clientId);
        // Update client stage to Viewings if still Searching
        if (client?.stage === 'Searching') {
          await db.from('clients').update({ stage: 'Viewings' }).eq('id', clientId);
          Clients.load();
        }
        // ── AUTO-QUEUE VIEWING CONFIRMATION EMAIL FOR APPROVAL ────────────
        // Fetch the newly inserted viewing so we have its id for dedup
        const { data: newViewing } = await db.from('viewings')
          .select('*')
          .eq('client_id', clientId)
          .eq('property_address', address)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (newViewing) await Viewings._attachSheet(newViewing.id);
        // Guests are often booked from a phone call with no email on file —
        // queuing a confirmation with no recipient would just leave a dead row
        // in Approvals. Roster clients keep their existing behaviour.
        if (typeof Notify !== "undefined" && newViewing && !(isGuest && !client.email)) {
          await Notify.onViewingBooked(newViewing, client);
        }
      }
    }
    // NOTE: editing a viewing's feedback no longer auto-emails the client.
    // Client emails are driven only by the explicit post-viewing buttons
    // (Good → "ready to make an offer?" invitation, which goes through
    // Approvals). Keep-searching / Pass never email the client.
    if (error) { if (msgEl) { msgEl.style.color='var(--red)'; msgEl.textContent = error.message; } return; }
    App.closeModal();
    App.toast(existingId ? '✅ Viewing updated!'
      : isGuest ? `✅ Viewing booked for ${client.full_name.split(' ')[0]}${guestRow?._reused ? ' (already on your list)' : ' (guest)'}`
      : '✅ Viewing booked!');
    Viewings.load(); App.loadOverview();
    if (isGuest && typeof Clients !== 'undefined') Clients.load();
  },

  // Deadline that drives the viewing lock: the offer due date/time you set, or
  // (if none) 4 days after the viewing date (internal, not shown to clients).
  _deadline(v) {
    if (v.offer_due_date) return new Date(v.offer_due_date + 'T' + (v.offer_due_time || '23:59') + ':00');
    if (v.viewing_date)   { const d = new Date(v.viewing_date + 'T23:59:59'); d.setDate(d.getDate() + 4); return d; }
    return null;
  },
  // Locked (read-only) once the outcome is recorded OR the deadline has passed.
  _isLocked(v) {
    if (v.client_feedback) return true;
    const dl = Viewings._deadline(v);
    return !!(dl && new Date() > dl);
  },
  async reopenDetail(id) {
    const ok = await App.requireDeletePin({
      title: 'Reopen viewing',
      message: 'This viewing is settled. Enter your PIN to reopen it and make changes.',
      confirmText: '🔓 Reopen'
    });
    if (!ok) return;
    App.closeModal();
    setTimeout(() => Viewings.openDetail(id, true), 200);
  },

  async openDetail(id, unlocked = false) {
    const v = Viewings.all.find(x => x.id === id);
    if (!v) return;
    const locked = Viewings._isLocked(v) && !unlocked;
    const lockReason = v.client_feedback ? "the client's decision is already recorded" : 'the offer deadline has passed';
    const lockTitle  = v.client_feedback ? 'Viewing settled — locked' : '⏰ Offer deadline passed — locked';
    const lockIcon   = v.client_feedback ? '🔒' : '⏰';
    const client = Clients.all.find(c => c.id === v.client_id) || v.clients;
    const clientName = v.clients?.full_name || client?.full_name || '—';
    const isCompleted = v.viewing_status === 'Completed';
    const hasFeedback = !!v.client_feedback;

    // Guest viewings: two ways out, and the card asks which. Either the guest
    // was standing in for someone already on the roster (link — the offer runs
    // under that client and the guest stays a guest, migration 097), or the
    // guest is the buyer themselves (promote, migration 088). Shown whether or
    // not the viewing is locked, because that call often lands after the
    // showing is settled. Card markup lives in Clients so the guest's own
    // record and this screen can never drift apart.
    const guestSection = (client?.is_guest && client?.id && typeof Clients?.guestCardHTML === 'function')
      ? Clients.guestCardHTML(client)
      : '';

    // Phase 2.B.8: Post-viewing feedback section \u2014 card2 wrappers,
    // btn2 variants preserve color semantics (primary/ghost/coral).
    const feedbackSection = isCompleted && hasFeedback ? `
      <div class="card2" style="padding:12px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:8px;">📊 Viewing Outcome</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:20px;">${v.client_feedback==='interested'?'🌟':v.client_feedback==='good'?'✅':v.client_feedback==='pass'?'❌':'🔄'}</span>
          <div>
            <div class="fw-700">${v.client_feedback==='interested'?'Very Interested — Ready to Offer':v.client_feedback==='good'?'Good — Liked It':v.client_feedback==='pass'?'Pass — Continue Searching':'Needs Follow-Up'}</div>
            <div style="font-size:12px;color:var(--text2);">Email follow-up queued in Approvals</div>
          </div>
        </div>
      </div>` : (isCompleted && !hasFeedback && !locked) ? `
      <div class="card2" style="padding:14px;margin-bottom:12px;border-color:var(--accent2);">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;">📋 How did the viewing go?</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">Select the outcome to automatically queue a follow-up email to ${clientName.split(' ')[0]}:</div>
        <div style="display:grid;gap:8px;">
          <button class="btn2 btn2-primary" style="justify-content:center;" onclick="Viewings.recordFeedback('${v.id}','interested')">🌟 Very Interested — Wants to Make an Offer</button>
          <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="Viewings.recordFeedback('${v.id}','good')">✅ Good — Liked It, Needs More Time</button>
          <button class="btn2 btn2-coral" style="justify-content:center;" onclick="Viewings.recordFeedback('${v.id}','pass')">❌ Pass — Continue Searching</button>
        </div>
      </div>` : ``;

    App.openModal(`
      <div class="fw-800" style="font-size:16px;margin-bottom:2px;">${v.property_address}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:14px;">👤 ${clientName}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:12px;">
        <div class="card2" style="padding:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Date</div><div class="fw-700">${App.fmtDate(v.viewing_date)}</div></div>
        <div class="card2" style="padding:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Time</div><div class="fw-700">${v.viewing_time?.slice(0,5)||'—'}</div></div>
        <div class="card2" style="padding:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Status</div><div class="fw-700">${v.viewing_status||'Scheduled'}</div></div>
        <div class="card2" style="padding:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">List Price</div><div class="fw-700">${App.fmtMoney(v.list_price)||'—'}</div></div>
        ${v.mls_number?`<div class="card2" style="padding:10px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">MLS#</div><div class="fw-700">${v.mls_number}</div></div>`:''}
        ${v.offer_due_date?`<div class="card2" style="padding:10px;grid-column:span 2;"><div style="font-size:10px;font-weight:700;color:var(--accent2);text-transform:uppercase;">⏰ Offers Due</div><div class="fw-700">${App.fmtDate(v.offer_due_date)}${v.offer_due_time?' at '+v.offer_due_time.slice(0,5):''}</div></div>`:''}
        ${v.sellers_direction?`<div class="card2" style="padding:10px;grid-column:span 2;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Seller's Direction</div><div class="fw-700">${v.sellers_direction}</div></div>`:''}
      </div>
      ${v.agent_notes ? `<div class="card2" style="padding:12px;margin-bottom:12px;font-size:13px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Notes</div>${App.esc(v.agent_notes)}</div>` : ''}
      ${v.property_highlights ? `<div class="card2" style="padding:12px;margin-bottom:12px;font-size:13px;"><div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">About This Home <span style="text-transform:none;letter-spacing:0;color:var(--accent2);font-weight:600;">· sent to the client</span></div><div style="font-style:italic;color:var(--text2);line-height:1.6;">${App.esc(v.property_highlights)}</div></div>` : ''}
      ${v.listing_remarks ? `<div class="card2" style="padding:12px;margin-bottom:12px;font-size:13px;">
        <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Listing Remarks <span style="text-transform:none;letter-spacing:0;color:var(--yellow);font-weight:600;">· yours only, never sent</span></div>
        <div style="color:var(--text2);line-height:1.6;max-height:190px;overflow-y:auto;">${App.esc(v.listing_remarks)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:7px;line-height:1.5;">The listing brokerage's own wording, kept word for word from the sheet.</div>
      </div>` : ''}
      ${guestSection}
      ${feedbackSection}
      ${locked ? `
      <div class="card2" style="padding:12px;margin-bottom:12px;border-color:var(--accent2);display:flex;gap:10px;align-items:center;">
        <span style="font-size:18px;">${lockIcon}</span>
        <div style="flex:1;"><div class="fw-700" style="font-size:13px;">${lockTitle}</div><div style="font-size:12px;color:var(--text2);">Read-only because ${lockReason}. Reopen with your PIN to change it.</div></div>
        <button class="btn2 btn2-ghost btn2-sm" style="flex:none;" onclick="Viewings.reopenDetail('${v.id}')">🔓 Reopen</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="App.closeModal();setTimeout(()=>Mileage.logFromViewing('${v.id}'),300)">🚗 Log drive</button>
        <button class="btn2 btn2-coral" style="justify-content:center;" onclick="Viewings.deleteViewing('${v.id}')">Delete</button>
      </div>` : `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
        ${!isCompleted ? `<button class="btn2 btn2-primary" style="justify-content:center;" onclick="Viewings.markCompleted('${v.id}')">✅ Mark Completed</button>` : ''}
        ${v.client_feedback === 'interested' ? `<button class="btn2 btn2-primary" style="justify-content:center;" onclick="App.closeModal();setTimeout(()=>Offers.openAddForClient('${v.client_id}','${clientName}'),300)">📄 Prepare Offer</button>` : ''}
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="App.closeModal();setTimeout(()=>Viewings._showForm('${v.client_id}','',${JSON.stringify(v).replace(/"/g,'&quot;')}),300)">Edit</button>
        <button class="btn2 btn2-coral" style="justify-content:center;" onclick="Viewings.deleteViewing('${v.id}')">Delete</button>
      </div>
      <button class="btn2 btn2-ghost" style="justify-content:center;width:100%;margin-top:8px;font-size:13px;" onclick="App.closeModal();setTimeout(()=>Mileage.logFromViewing('${v.id}'),300)">🚗 Log drive to this property</button>
      ${isCompleted ? `
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:8px;">📞 Manual Override — Client Called You?</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">Record the client's decision manually. This will expire any pending email response link.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button class="btn2 btn2-primary btn2-sm" style="justify-content:center;" onclick="Viewings.manualOverride('${v.id}','make_offer')">🏠 Make Offer</button>
          <button class="btn2 btn2-ghost btn2-sm" style="justify-content:center;" onclick="Viewings.manualOverride('${v.id}','continue_searching')">🔍 Keep Searching</button>
          <button class="btn2 btn2-coral btn2-sm" style="justify-content:center;" onclick="Viewings.manualOverride('${v.id}','not_a_fit')">❌ Not a Fit</button>
          <button class="btn2 btn2-ghost btn2-sm" style="justify-content:center;" onclick="Viewings.manualOverride('${v.id}','rescheduled')">📅 Reschedule</button>
        </div>
      </div>` : ''}
      `}
    `);
  },

  async markCompleted(id) {
    await db.from('viewings').update({ viewing_status: 'Completed', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('✅ Viewing marked completed');
    await Viewings.load();
    App.closeModal();
    // Auto-log the mileage trip in the background (silent — no extra modal).
    // Fire-and-forget; failures are swallowed inside autoLogFromViewing so
    // a mileage hiccup never blocks the feedback modal flow below.
    if (typeof Mileage !== 'undefined') {
      Mileage.autoLogFromViewing(id).catch(err => console.warn('[Mileage] auto-log error', err));
    }
    // Show agent feedback modal — how did the viewing go?
    setTimeout(() => Viewings.agentFeedbackModal(id), 400);
  },

  // ── AGENT FEEDBACK MODAL ─────────────────────────────────────────────────
  // Fires right after agent taps "Mark Completed" — collects how it went
  agentFeedbackModal(id) {
    const v = Viewings.all.find(x => x.id === id) || {};
    const client = Clients.all.find(c => c.id === v.client_id);
    const clientName = client?.full_name || v.client_name || 'Client';
    App.openModal(`
      <div style="font-size:16px;font-weight:800;margin-bottom:4px;">🏠 How did the viewing go?</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:20px;">${clientName} · ${v.property_address || '—'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <button class="btn2 btn2-primary" style="padding:14px 8px;font-size:14px;font-weight:700;justify-content:center;"
          onclick="Viewings.confirmOffer('${id}')">✅ Good</button>
        <button class="btn2 btn2-ghost" style="padding:14px 8px;font-size:14px;justify-content:center;"
          onclick="Viewings.manualOverride('${id}','rescheduled')">📅 Reschedule</button>
        <button class="btn2 btn2-coral" style="padding:14px 8px;font-size:14px;justify-content:center;"
          onclick="Viewings.manualOverride('${id}','not_a_fit')">❌ Pass</button>
        <button class="btn2 btn2-ghost" style="padding:14px 8px;font-size:14px;justify-content:center;"
          onclick="Viewings.manualOverride('${id}','continue_searching')">🔍 Keep Searching</button>
      </div>
    `);
  },

  // ── OFFER CONFIRMATION MODAL ──────────────────────────────────────────────
  // Fires when agent taps "Good" — asks if they want to send offer invitation
  confirmOffer(id) {
    const v = Viewings.all.find(x => x.id === id) || {};
    const client = Clients.all.find(c => c.id === v.client_id);
    const clientName = client?.full_name || v.client_name || 'Client';
    const firstName = clientName.split(' ')[0];
    App.openModal(`
      <div style="font-size:16px;font-weight:800;margin-bottom:4px;">🌟 Great viewing!</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:20px;">Is ${firstName} ready to move forward with an offer?</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <button class="btn2 btn2-primary" style="padding:14px 8px;font-size:14px;font-weight:700;justify-content:center;"
          onclick="Viewings.recordFeedback('${id}','interested')">🏠 Yes — Send Offer Invitation</button>
        <button class="btn2 btn2-ghost" style="padding:14px 8px;font-size:14px;justify-content:center;"
          onclick="Viewings.recordFeedback('${id}','good')">🔍 No — Keep Searching</button>
      </div>
    `);
  },

  async recordFeedback(id, feedback) {
    await db.from('viewings').update({ client_feedback: feedback, updated_at: new Date().toISOString() }).eq('id', id);
    const v = Viewings.all.find(x => x.id === id) || {};
    const client = Clients.all.find(c => c.id === v.client_id);
    const clientObj = { ...client, email: client?.email || '(no email on file)' };
    const firstName = clientObj.full_name?.split(' ')[0] || 'your client';

    // Only the "interested → ready to make an offer" path emails the client.
    // "Good — keep searching" and "Pass" record the outcome SILENTLY — no email
    // ever goes to the client on keep-searching/pass (Maxwell's call).
    if (feedback === 'interested' && typeof Notify !== "undefined") {
      const user = await App.getAuthUser();
      const agentId = user?.id || currentAgent?.id;
      // Unique response token so the client can reply via the web page.
      const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days
      await db.from('viewing_responses').insert({
        viewing_id: id,
        client_id: v.client_id,
        agent_id: agentId || null,
        property_address: v.property_address || null,
        list_price: v.list_price || null,
        mls_number: v.mls_number || null,
        client_name: clientObj.full_name || null,
        client_email: clientObj.email || null,
        token,
        expires_at: expiresAt,
        expired: false
      });
      const viewingWithToken = { ...v, client_feedback: feedback, _responseToken: token };
      // Queue the "Ready to Make an Offer?" invitation. It stays PENDING in
      // Approvals so Maxwell reviews and sends it himself — it is NOT
      // auto-approved (Maxwell wants the offer invitation to go through his
      // approval before it reaches the client).
      await Notify.onReadyToOffer(viewingWithToken, clientObj);
    }

    // Contextual toast — make it clear whether anything was sent.
    const toastMsg = feedback === 'interested'
      ? `🌟 ${firstName} — offer invitation queued in Approvals for your review`
      : feedback === 'good'
      ? `✅ Noted — ${firstName} liked it, still searching. No email sent.`
      : `📝 Noted — ${firstName} passed. No email sent.`;
    App.toast(toastMsg, 'var(--green)');

    await Viewings.load();
    App.closeModal();

    if (feedback !== 'interested') {
      setTimeout(() => Viewings.openDetail(id), 400);
    }
  },

  // Manual override — agent records client decision without waiting for email response
  async manualOverride(viewingId, decision) {
    const decisions = {
      make_offer: { client_response: 'make_offer', client_feedback: 'interested' },
      continue_searching: { client_response: 'continue_searching', client_feedback: 'good' },
      not_a_fit: { client_response: 'not_a_fit', client_feedback: 'pass' },
      cancelled: { viewing_status: 'Cancelled', client_feedback: null },
      rescheduled: { viewing_status: 'Rescheduled', client_feedback: null }
    };
    const update = decisions[decision];
    if (!update) return;

    // Expire any open response tokens for this viewing
    await db.from('viewing_responses').update({ expired: true }).eq('viewing_id', viewingId).eq('expired', false);

    await db.from('viewings').update({ ...update, updated_at: new Date().toISOString() }).eq('id', viewingId);

    if (decision === 'make_offer') {
      const v = Viewings.all.find(x => x.id === viewingId) || {};
      const client = Clients.all.find(c => c.id === v.client_id);
      await Viewings.load();
      App.closeModal();
      // Open full manual offer entry modal
      setTimeout(() => Viewings.openManualOfferModal(v, client), 300);
      return;
    } else if (decision === 'cancelled') {
      App.toast('❌ Viewing marked cancelled. Response link expired.');
    } else if (decision === 'rescheduled') {
      App.toast('📅 Viewing marked for rescheduling. Response link expired.');
    } else {
      App.toast('✅ Decision recorded manually. Response link expired.');
    }

    await Viewings.load();
    App.closeModal();
    if (typeof PendingOffers !== 'undefined') PendingOffers.load();
  },

  async deleteViewing(id) {
    if (!confirm('Delete this viewing? This cannot be undone.')) return;
    const { error } = await db.from('viewings').delete().eq('id', id);
    if (error) { App.toast('❌ Could not delete: ' + error.message, 'var(--red)'); return; }
    App.closeModal();
    App.toast('🗑 Viewing deleted');
    Viewings.load();
    App.loadOverview();
  },

  // ── MANUAL OFFER ENTRY MODAL ───────────────────────────────────────────────
  openManualOfferModal(v, client) {
    const clientName = client?.full_name || v.client_name || '—';
    const today = new Date().toISOString().slice(0, 10);
    App.openModal(`
      <div style="font-size:16px;font-weight:800;margin-bottom:4px;">📄 Log Offer Manually</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;">
        ${clientName} · ${v.property_address || '—'}${v.property_type === 'new_build' ? ' · 🏗️ New Build' : ''}
      </div>
      <input type="hidden" id="mo-property-type" value="${v.property_type || 'existing_home'}">

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">OFFER AMOUNT ($)</label>
          <input class="form-input" id="mo-offer-amt" type="number" placeholder="e.g. 430000" value="${v.list_price || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">ASKING / LIST PRICE ($)</label>
          <input class="form-input" id="mo-list-price" type="number" placeholder="e.g. 450000" value="${v.list_price || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">OFFER DATE</label>
          <input class="form-input" id="mo-offer-date" type="date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">OFFER STATUS</label>
          <select class="form-input form-select" id="mo-offer-status" onchange="
            const map = {Submitted:'In Offer',Accepted:'Accepted',Countered:'In Offer',Rejected:'In Offer'};
            const ps = document.getElementById('mo-pipeline-stage');
            if (ps) ps.value = map[this.value] || 'In Offer';
          ">
            <option value="Submitted">Submitted</option>
            <option value="Accepted">Accepted ✅</option>
            <option value="Countered">Countered 🔄</option>
            <option value="Rejected">Rejected ❌</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">CONDITIONS (optional)</label>
        <input class="form-input" id="mo-conditions" placeholder="e.g. Financing, Home Inspection">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">FINANCING DATE</label>
          <input class="form-input" id="mo-fin-date" type="date">
        </div>
        <div class="form-group">
          <label class="form-label">INSPECTION DATE</label>
          <input class="form-input" id="mo-ins-date" type="date">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">CLOSING DATE</label>
          <input class="form-input" id="mo-close-date" type="date">
        </div>
        <div class="form-group">
          <label class="form-label">PIPELINE STAGE</label>
          <select class="form-input form-select" id="mo-pipeline-stage">
            <option value="In Offer">In Offer</option>
            <option value="Accepted">Accepted</option>
            <option value="Conditions">Conditions</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>
      <div style="background:var(--bg2);border-radius:8px;padding:12px;margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--accent2);text-transform:uppercase;margin-bottom:10px;">🏦 Deposit Cheque — Due to Seller's Agent Within 24 Hours</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">DEPOSIT AMOUNT ($)</label>
            <input class="form-input" id="mo-deposit-amt" type="number" placeholder="e.g. 5000">
          </div>
          <div class="form-group">
            <label class="form-label">DEPOSIT DUE BY</label>
            <input class="form-input" id="mo-deposit-due" type="datetime-local">
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;">
          <input type="checkbox" id="mo-deposit-sent" style="width:16px;height:16px;cursor:pointer;">
          <label for="mo-deposit-sent" style="cursor:pointer;">Deposit already sent ✅</label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">NOTES</label>
        <input class="form-input" id="mo-notes" placeholder="e.g. Seller accepted at asking, waived inspection">
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn2 btn2-ghost" style="justify-content:center;" onclick="App.closeModal()">Cancel</button>
        <button class="btn2 btn2-primary" style="flex:1;justify-content:center;" onclick="Viewings.submitManualOffer('${v.id}','${client?.id || ''}','${clientName.replace(/'/g,"\\'")}','${v.property_address?.replace(/'/g,"\\'") || ''}','${client?.email || ''}')">
          🚀 Save Offer &amp; Add to Pipeline
        </button>
      </div>
      <div id="mo-status" style="font-size:13px;text-align:center;margin-top:8px;"></div>
    `);
  },

  async submitManualOffer(viewingId, clientId, clientName, propertyAddress, clientEmail) {
    const st = document.getElementById('mo-status');
    if (st) { st.textContent = 'Saving...'; st.style.color = 'var(--text2)'; }

    const offerAmt   = parseFloat(document.getElementById('mo-offer-amt')?.value) || 0;
    const listPrice  = parseFloat(document.getElementById('mo-list-price')?.value) || 0;
    const offerDate  = document.getElementById('mo-offer-date')?.value || null;
    const offerStatus = document.getElementById('mo-offer-status')?.value || 'Submitted';
    const conditions = document.getElementById('mo-conditions')?.value?.trim() || null;
    const finDate    = document.getElementById('mo-fin-date')?.value || null;
    const insDate    = document.getElementById('mo-ins-date')?.value || null;
    const closeDate  = document.getElementById('mo-close-date')?.value || null;
    const pipeStage  = document.getElementById('mo-pipeline-stage')?.value || 'In Offer';
    const notes      = document.getElementById('mo-notes')?.value?.trim() || null;
    const propertyType = document.getElementById('mo-property-type')?.value || 'existing_home';
    const depositAmt  = parseFloat(document.getElementById('mo-deposit-amt')?.value) || null;
    const depositDue  = document.getElementById('mo-deposit-due')?.value
      ? new Date(document.getElementById('mo-deposit-due').value).toISOString()
      : (offerStatus === 'Accepted' && offerDate
          ? new Date(new Date(offerDate + 'T12:00:00').getTime() + 24 * 60 * 60 * 1000).toISOString()
          : null);
    const depositSent = document.getElementById('mo-deposit-sent')?.checked || false;

    if (!offerAmt) {
      if (st) { st.textContent = '⚠️ Please enter an offer amount'; st.style.color = 'var(--red)'; }
      return;
    }

    // 1. Save to offers table
    const { data: offer, error: offerErr } = await db.from('offers').insert({
      agent_id: currentAgent.id,
      client_id: clientId || null,
      client_name: clientName,
      property_address: propertyAddress,
      list_price: listPrice || null,
      offer_amount: offerAmt,
      offer_date: offerDate,
      status: offerStatus,
      conditions: conditions,
      notes: notes,
      property_type: propertyType,
    }).select().maybeSingle();

    if (offerErr) {
      if (st) { st.textContent = '❌ ' + offerErr.message; st.style.color = 'var(--red)'; }
      return;
    }

    // 2. Upsert pipeline entry
    const { data: existing } = await db.from('pipeline')
      .select('id').eq('agent_id', currentAgent.id)
      .ilike('client_name', clientName).limit(1).maybeSingle();

    const pipelineData = {
      agent_id: currentAgent.id,
      client_name: clientName,
      client_id: clientId || null,
      client_email: clientEmail || null,
      property_address: propertyAddress,
      offer_amount: offerAmt,
      stage: pipeStage,
      status: 'Active',
      // Both column pairs exist in pipeline; UI/calendar read *_date while the
      // daily-automation reminders and stakeholder portals read *_deadline —
      // write both so every reader sees the dates (boardroom fix, Jul 2026)
      financing_deadline: finDate || null,
      inspection_deadline: insDate || null,
      financing_date: finDate || null,
      inspection_date: insDate || null,
      closing_date: closeDate || null,
      deposit_amount: depositAmt,
      deposit_due_date: depositDue,
      deposit_sent: depositSent,
      deposit_sent_at: depositSent ? new Date().toISOString() : null,
      deal_type: propertyType,
      updated_at: new Date().toISOString(),
    };

    let pipelineErr = null;
    if (existing?.id) {
      const { error: updErr } = await db.from('pipeline').update(pipelineData).eq('id', existing.id);
      pipelineErr = updErr;
    } else {
      pipelineData.pipeline_id = 'OFFER-' + Date.now();
      pipelineData.acceptance_date = offerDate;
      const { error: insErr } = await db.from('pipeline').insert(pipelineData);
      pipelineErr = insErr;
    }
    if (pipelineErr) {
      if (st) { st.textContent = '❌ Pipeline error: ' + pipelineErr.message; st.style.color = 'var(--red)'; }
      return;
    }

    // 2b. New build → the deal is tagged deal_type='new_build' on the pipeline row
    // above. The construction tracker is created via the rich New Build form.
    // Guarded so this can never throw if the helper isn't on the live module.
    if (propertyType === 'new_build' && typeof NewBuilds !== 'undefined' && typeof NewBuilds.ensureFromDeal === 'function') {
      await NewBuilds.ensureFromDeal({
        client_id: clientId || null,
        client_name: clientName,
        client_email: clientEmail || null,
        lot_address: propertyAddress,
        offer_amount: offerAmt,
        closing_date: closeDate,
      });
    }

    // 3. Queue email(s) for approval
    if (clientEmail && typeof Notify !== 'undefined') {
      const agent = currentAgent;
      const clientObj = { id: clientId || null, full_name: clientName, email: clientEmail };
      const offerObj = {
        property_address: propertyAddress,
        offer_amount: offerAmt,
        list_price: listPrice,
        offer_date: offerDate,
        conditions,
        financing_date: finDate,
        inspection_date: insDate,
        closing_date: closeDate,
        deposit_amount: depositAmt,
        deposit_due_date: depositDue,
        deposit_sent: depositSent,
      };

      if (offerStatus === 'Accepted') {
        // Offer accepted — queue the rich checklist email with all next steps
        await Notify.onOfferAcceptedWithChecklist(offerObj, clientObj, offer?.id || null);
      } else {
        // Offer submitted / countered / rejected — queue standard submitted email
        const tmpl = Notify.templates.offer_submitted(clientObj, offerObj, agent);
        await Notify.queue('Offer Submitted', clientId || null, clientName, clientEmail, tmpl.subject, tmpl.body, offer?.id || null);
      }
    }

    if (st) { st.textContent = '✅ Saved!'; st.style.color = 'var(--green)'; }
    App.toast(`✅ Offer logged & ${clientName} added to Pipeline (${pipeStage})`, 'var(--green)');

    setTimeout(() => {
      App.closeModal();
      Viewings.load();
      App.loadOverview();
      if (typeof Pipeline !== 'undefined') Pipeline.load();
      if (typeof Offers !== 'undefined') Offers.load?.();
    }, 600);
  },
};

// ── BUILDER MEETING ─────────────────────────────────────────────────────────
// Quick scheduler (like a viewing) for a client↔builder meeting. Saves to the
// `meetings` table (shows on the Calendar) and queues an .ics invite email to
// the client, CC the builder — all through Approvals.
const Meetings = {
  openForm(prefillClientId) {
    const today = new Date().toISOString().slice(0,10);
    const clientOpts = (typeof Clients !== 'undefined' ? Clients.all : []).map(c =>
      `<option value="${c.id}" ${c.id===prefillClientId?'selected':''}>${App.esc(c.full_name)}</option>`).join('');
    App.openModal(`
      <div class="modal-title">🏗️ Book Builder Meeting</div>
      <div class="form-group">
        <label class="form-label">Client *</label>
        <select class="form-input form-select" id="mt-client" onchange="Meetings.onClientChange()"><option value="">Select client…</option>${clientOpts}<option value="__other__">➕ Other (not in my system)</option></select>
      </div>
      <div class="form-group" id="mt-other-fields" style="display:none;">
        <label class="form-label">New Client Name *</label>
        <input class="form-input" id="mt-other-name" placeholder="e.g. Jane Smith">
        <label class="form-label" style="margin-top:8px;">New Client Email <span style="color:var(--text2);font-weight:400;">(optional — for the invite)</span></label>
        <input class="form-input" id="mt-other-email" type="email" placeholder="client@example.com">
      </div>
      <div class="form-group">
        <label class="form-label">Builder Name *</label>
        <input class="form-input" id="mt-builder" placeholder="e.g. Dave Power (a name, not an email)">
      </div>
      <div class="form-group">
        <label class="form-label">Builder Email <span style="color:var(--text2);font-weight:400;">(optional — to CC them the invite)</span></label>
        <input class="form-input" id="mt-builder-email" type="email" placeholder="builder@example.com">
      </div>
      <div class="form-group">
        <label class="form-label">Does the client know who this person is?</label>
        <select class="form-input form-select" id="mt-knows" onchange="Meetings.onKnowsChange()">
          <option value="yes">Yes — just use their name</option>
          <option value="no">No — add a label to their name in the email</option>
        </select>
      </div>
      <div class="form-group" id="mt-role-field" style="display:none;">
        <label class="form-label">Who are they?</label>
        <select class="form-input form-select" id="mt-role">
          <option value="builder">a builder</option>
          <option value="electrician">an electrician</option>
          <option value="plumber">a plumber</option>
          <option value="contractor">a contractor</option>
          <option value="home inspector">a home inspector</option>
          <option value="mortgage broker">a mortgage broker</option>
          <option value="lawyer">a lawyer</option>
          <option value="appraiser">an appraiser</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Location *</label>
        <input class="form-input" id="mt-location" placeholder="e.g. Show home, 12 Kenmount Rd">
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="form-group">
          <label class="form-label">Date *</label>
          <input class="form-input" id="mt-date" type="date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">Time</label>
          <input class="form-input" id="mt-time" type="time">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <textarea class="form-input" id="mt-notes" rows="2" placeholder="Anything the client should know…"></textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;cursor:pointer;">
        <input type="checkbox" id="mt-email" checked> Email the client an invite (and CC the builder)
      </label>
      <div id="mt-msg" style="font-size:13px;margin-bottom:8px;"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-primary" onclick="Meetings.save()">📅 Book Meeting</button>
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
      </div>
    `);
  },

  // Show the manual name/email fields only when "Other (not in my system)" is picked.
  onClientChange() {
    const sel = document.getElementById('mt-client')?.value;
    const box = document.getElementById('mt-other-fields');
    if (box) box.style.display = (sel === '__other__') ? 'block' : 'none';
  },

  // Show the role dropdown only when the client does NOT know who the person is,
  // so the email can read "Dave, the builder" instead of just "Dave".
  onKnowsChange() {
    const knows = document.getElementById('mt-knows')?.value;
    const box = document.getElementById('mt-role-field');
    if (box) box.style.display = (knows === 'no') ? 'block' : 'none';
  },

  async save() {
    const msg = document.getElementById('mt-msg');
    const set = (t, c) => { if (msg) { msg.style.color = c; msg.textContent = t; } };
    const clientId = document.getElementById('mt-client')?.value || '';
    const isOther  = clientId === '__other__';
    const builder  = document.getElementById('mt-builder')?.value.trim() || '';
    const location = document.getElementById('mt-location')?.value.trim() || '';
    const date     = document.getElementById('mt-date')?.value || '';
    if (!clientId) { set('⚠️ Select a client', 'var(--red)'); return; }
    if (isOther && !document.getElementById('mt-other-name')?.value.trim()) { set('⚠️ Enter the new client name', 'var(--red)'); return; }
    if (!builder)  { set('⚠️ Enter the builder name', 'var(--red)'); return; }
    if (/@/.test(builder)) { set('⚠️ That looks like an email. Put the builder\'s NAME here (e.g. Dave Power) and their email in the Builder Email field below.', 'var(--red)'); return; }
    if (!location) { set('⚠️ Enter the location', 'var(--red)'); return; }
    if (!date)     { set('⚠️ Pick a date', 'var(--red)'); return; }
    set('Saving…', 'var(--text2)');

    const client = isOther
      ? { full_name: document.getElementById('mt-other-name')?.value.trim() || null,
          email:     document.getElementById('mt-other-email')?.value.trim() || null }
      : ((typeof Clients !== 'undefined' ? Clients.all : []).find(c => c.id === clientId) || {});
    const user = await App.getAuthUser();
    const agentId = user?.id || currentAgent?.id;
    const row = {
      agent_id: agentId,
      client_id: isOther ? null : clientId,
      client_name: client.full_name || null,
      client_email: client.email || null,
      builder_name: builder,
      builder_email: document.getElementById('mt-builder-email')?.value.trim() || null,
      location,
      meeting_date: date,
      meeting_time: document.getElementById('mt-time')?.value || null,
      notes: document.getElementById('mt-notes')?.value.trim() || null
    };
    const { data: saved, error } = await db.from('meetings').insert(row).select('id').single();
    if (error) {
      set('❌ ' + (error.message || 'Save failed') + (error.code === '42P01' ? ' — run migration 051_builder_meetings' : ''), 'var(--red)');
      return;
    }

    // Email the client the invite (+ CC builder), queued for approval.
    const wantEmail = document.getElementById('mt-email')?.checked;
    // If the client doesn't know who this person is, label them in the email.
    const builderLabel = (document.getElementById('mt-knows')?.value === 'no')
      ? (document.getElementById('mt-role')?.value || null) : null;
    if (wantEmail && typeof Notify !== 'undefined') {
      if (client.email) {
        await Notify.onBuilderMeeting({ ...row, id: saved?.id, builder_label: builderLabel }, client);
      } else {
        App.toast('⚠️ No email on file for this client — meeting saved, invite not sent', 'var(--yellow)');
      }
    }

    App.closeModal();
    App.toast(wantEmail ? '🏗️ Meeting booked — invite queued in Approvals' : '🏗️ Meeting booked & added to your calendar', 'var(--green)');
    if (typeof Calendar !== 'undefined' && Calendar.load) Calendar.load();
    if (App.loadOverview) App.loadOverview();
  },

  // Delete a builder meeting (e.g. a test). PIN-gated like every other delete.
  async delete(id) {
    const ok = await App.requireDeletePin({
      title: 'Delete Meeting',
      message: 'Delete this builder meeting? It will be removed from your calendar. This cannot be undone.'
    });
    if (!ok) return;
    const { error } = await db.from('meetings').delete().eq('id', id);
    if (error) { App.toast('⚠️ ' + (error.message || 'Delete failed'), 'var(--red)'); return; }
    App.closeModal();
    App.toast('🗑️ Meeting deleted');
    if (typeof Calendar !== 'undefined' && Calendar.refresh) Calendar.refresh();
    if (App.loadOverview) App.loadOverview();
  }
};

// ── CLIENT APPOINTMENT ───────────────────────────────────────────────────────
// Meet a client at one or more locations to pick out finishes (flooring,
// cabinets, countertops…). Saves to the same `meetings` table with kind =
// 'appointment' and a `stops` array, shows on the Calendar, and emails the
// client one Add-to-Calendar invite covering every stop — the viewing-email flow.
const Appointments = {
  TYPES: ['Flooring','Kitchen cabinets','Countertops','Lighting','Appliances','Tile','Paint & finishes','Plumbing fixtures','Other'],
  _n: 0,

  _typeOpts() { return Appointments.TYPES.map(t => `<option value="${t}">${t}</option>`).join(''); },

  _stopRow(i) {
    return `
      <div class="appt-stop" data-i="${i}" style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.3px;">Stop ${i + 1}</span>
          <button type="button" onclick="Appointments.removeStop(${i})" style="background:none;border:none;color:var(--red);font-size:12px;cursor:pointer;${i === 0 ? 'visibility:hidden;' : ''}">✕ remove</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <select class="form-input form-select appt-type">${Appointments._typeOpts()}</select>
          <input class="form-input appt-time" type="time">
        </div>
        <input class="form-input appt-type-other" placeholder="Describe it (only if you picked Other)" style="display:none;margin-bottom:8px;">
        <input class="form-input appt-addr" placeholder="Address / place — e.g. Kent, 20 Stavanger Dr">
      </div>`;
  },

  openForm(prefillClientId) {
    Appointments._n = 0;
    const today = new Date().toISOString().slice(0,10);
    const clientOpts = (typeof Clients !== 'undefined' ? Clients.all : []).map(c =>
      `<option value="${c.id}" ${c.id === prefillClientId ? 'selected' : ''}>${App.esc(c.full_name)}</option>`).join('');
    App.openModal(`
      <div class="modal-title">📍 Set Up Appointment</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">Meet your client at one or more spots to pick out finishes. They get an Add-to-Calendar invite, just like a viewing.</div>
      <div class="form-group">
        <label class="form-label">Client *</label>
        <select class="form-input form-select" id="appt-client" onchange="Appointments.onClientChange()"><option value="">Select client…</option>${clientOpts}<option value="__other__">➕ Other (not in my system)</option></select>
      </div>
      <div class="form-group" id="appt-other-fields" style="display:none;">
        <label class="form-label">New Client Name *</label>
        <input class="form-input" id="appt-other-name" placeholder="e.g. Jane Smith">
        <label class="form-label" style="margin-top:8px;">New Client Email <span style="color:var(--text2);font-weight:400;">(optional — for the invite)</span></label>
        <input class="form-input" id="appt-other-email" type="email" placeholder="client@example.com">
      </div>
      <div class="form-group">
        <label class="form-label">Date *</label>
        <input class="form-input" id="appt-date" type="date" value="${today}">
      </div>
      <label class="form-label">Locations *</label>
      <div id="appt-stops">${Appointments._stopRow(0)}</div>
      <button type="button" class="btn btn-outline btn-sm" onclick="Appointments.addStop()" style="margin-bottom:12px;">＋ Add another location</button>
      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <textarea class="form-input" id="appt-notes" rows="2" placeholder="Anything the client should know…"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">CC <span style="color:var(--text2);font-weight:400;">(optional — separate multiple with commas)</span></label>
        <input class="form-input" id="appt-cc" type="text" placeholder="e.g. spouse@email.com, builder@email.com">
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;cursor:pointer;">
        <input type="checkbox" id="appt-email" checked> Email the client an invite with Add-to-Calendar
      </label>
      <div id="appt-msg" style="font-size:13px;margin-bottom:8px;"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-primary" onclick="Appointments.save()">📅 Book Appointment</button>
        <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
      </div>
    `);
    Appointments._wireOtherToggles();
  },

  // Reveal a stop's free-text box only when its type is "Other".
  _wireOtherToggles() {
    document.querySelectorAll('#appt-stops .appt-stop').forEach(row => {
      const sel = row.querySelector('.appt-type');
      const oth = row.querySelector('.appt-type-other');
      if (sel && oth) sel.onchange = () => { oth.style.display = sel.value === 'Other' ? 'block' : 'none'; };
    });
  },

  onClientChange() {
    const sel = document.getElementById('appt-client')?.value;
    const box = document.getElementById('appt-other-fields');
    if (box) box.style.display = (sel === '__other__') ? 'block' : 'none';
  },

  addStop() {
    Appointments._n += 1;
    const host = document.getElementById('appt-stops');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', Appointments._stopRow(Appointments._n));
    Appointments._wireOtherToggles();
  },

  removeStop(i) {
    const row = document.querySelector(`#appt-stops .appt-stop[data-i="${i}"]`);
    if (row) row.remove();
  },

  _collectStops() {
    const stops = [];
    document.querySelectorAll('#appt-stops .appt-stop').forEach(row => {
      let type = row.querySelector('.appt-type')?.value || '';
      if (type === 'Other') type = (row.querySelector('.appt-type-other')?.value.trim() || 'Other');
      const address = row.querySelector('.appt-addr')?.value.trim() || '';
      const time = row.querySelector('.appt-time')?.value || '';
      if (address) stops.push({ type, address, time: time || null });
    });
    return stops;
  },

  async save() {
    const msg = document.getElementById('appt-msg');
    const set = (t, c) => { if (msg) { msg.style.color = c; msg.textContent = t; } };
    const clientId = document.getElementById('appt-client')?.value || '';
    const isOther  = clientId === '__other__';
    const date     = document.getElementById('appt-date')?.value || '';
    const stops    = Appointments._collectStops();
    if (!clientId) { set('⚠️ Select a client', 'var(--red)'); return; }
    if (isOther && !document.getElementById('appt-other-name')?.value.trim()) { set('⚠️ Enter the new client name', 'var(--red)'); return; }
    if (!date) { set('⚠️ Pick a date', 'var(--red)'); return; }
    if (!stops.length) { set('⚠️ Add at least one location with an address', 'var(--red)'); return; }
    set('Saving…', 'var(--text2)');

    const client = isOther
      ? { full_name: document.getElementById('appt-other-name')?.value.trim() || null,
          email:     document.getElementById('appt-other-email')?.value.trim() || null }
      : ((typeof Clients !== 'undefined' ? Clients.all : []).find(c => c.id === clientId) || {});
    const user = await App.getAuthUser();
    const agentId = user?.id || currentAgent?.id;
    // Sort stops by time so the calendar + email read top-to-bottom through the day.
    stops.sort((a, b) => (a.time || '99') > (b.time || '99') ? 1 : -1);
    const types = stops.map(s => s.type);
    const purpose = types.length > 1 ? `${types[0]} +${types.length - 1} more` : types[0];
    const row = {
      agent_id: agentId,
      kind: 'appointment',
      client_id: isOther ? null : clientId,
      client_name: client.full_name || null,
      client_email: client.email || null,
      builder_name: null,
      builder_email: null,
      purpose,
      stops,
      location: stops[0].address,           // primary location (map link)
      meeting_date: date,
      meeting_time: stops[0].time || null,   // earliest stop drives calendar sort
      notes: document.getElementById('appt-notes')?.value.trim() || null
    };
    const { data: saved, error } = await db.from('meetings').insert(row).select('id').single();
    if (error) {
      set('❌ ' + (error.message || 'Save failed') + (/kind|stops|purpose|column/i.test(error.message || '') ? ' — run migration 084_appointment_meetings' : ''), 'var(--red)');
      return;
    }

    const wantEmail = document.getElementById('appt-email')?.checked;
    const cc = document.getElementById('appt-cc')?.value.trim() || null;
    let emailed = false;
    if (wantEmail && typeof Notify !== 'undefined') {
      if (client.email) {
        await Notify.onAppointment({ ...row, id: saved?.id, cc }, client);
        emailed = true;
      } else {
        App.toast('⚠️ No email on file for this client — appointment saved, invite not sent', 'var(--yellow)');
      }
    }

    App.closeModal();
    App.toast(emailed ? '📍 Appointment booked — invite queued in Approvals' : '📍 Appointment booked & added to your calendar', 'var(--green)');
    if (typeof Calendar !== 'undefined' && Calendar.load) Calendar.load();
    if (App.loadOverview) App.loadOverview();
  }
};
