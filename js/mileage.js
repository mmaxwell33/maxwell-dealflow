// ─────────────────────────────────────────────────────────────────────────────
// js/mileage.js — Mileage logbook for CRA vehicle-expense tax compliance
//
// What this does:
//   • Stores every business drive in mileage_trips (RLS-scoped to the agent)
//   • Manual "Log a trip" modal with auto-distance estimate
//   • "Log drive to this property" shortcut on a viewing detail
//   • CSV export (for the accountant) and CRA-format PDF logbook (for records)
//   • Distance = OSM Nominatim geocode + Haversine × 1.3 road multiplier
//
// Phase 2 (future PR) will add the auto-push 30 min before a viewing.
// ─────────────────────────────────────────────────────────────────────────────

const Mileage = {
  all: [],
  filter: 'thisYear', // 'all' | 'thisYear' | 'thisQuarter' | 'thisMonth'

  // ── Load trips for current agent ─────────────────────────────────────────
  async load() {
    if (!currentAgent?.id) return;
    const { data, error } = await db.from('mileage_trips')
      .select('*')
      .eq('agent_id', currentAgent.id)
      .order('trip_date', { ascending: false })
      .order('started_at', { ascending: false });
    if (error) { console.warn('[Mileage] load failed:', error.message); return; }
    this.all = data || [];
    this.render();
  },

  // ── Render the Mileage tab ──────────────────────────────────────────────
  render() {
    const el = document.getElementById('mileage');
    if (!el) return;

    const trips = this.filtered();
    const totalKm = trips.reduce((s, t) => s + Number(t.distance_km || 0), 0);
    const tripCount = trips.length;
    const rate = Number(currentAgent?.per_km_rate || 0.73);
    const estValue = totalKm * rate;

    el.innerHTML = `
      <div style="max-width:960px;margin:0 auto;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
          <div>
            <h1 style="margin:0 0 4px;font-size:24px;">🚗 Mileage Logbook</h1>
            <div style="color:var(--text2);font-size:13px;">CRA-compliant vehicle log for tax filing</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn2" onclick="Mileage.backfillFromPastViewings()" title="Scan past viewings without mileage logs and create them in bulk">📥 Backfill past viewings</button>
            <button class="btn2 btn2-primary" onclick="Mileage.openLogModal()">+ Log a trip</button>
          </div>
        </div>

        <div class="card2" style="padding:18px;margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:18px;">
            <div>
              <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;">Trips</div>
              <div style="font-size:26px;font-weight:700;margin-top:4px;">${tripCount}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;">Total kilometers</div>
              <div style="font-size:26px;font-weight:700;margin-top:4px;">${totalKm.toFixed(1)} <span style="font-size:14px;font-weight:400;color:var(--text2);">km</span></div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;">Est. value @ $${rate.toFixed(2)}/km</div>
              <div style="font-size:26px;font-weight:700;margin-top:4px;">$${estValue.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${this._chip('all','All')}
            ${this._chip('thisYear','This year')}
            ${this._chip('thisQuarter','This quarter')}
            ${this._chip('thisMonth','This month')}
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn2" onclick="Mileage.exportCSV()">⬇ CSV</button>
            <button class="btn2 btn2-primary" onclick="Mileage.exportPDF()">📄 CRA logbook PDF</button>
          </div>
        </div>

        ${trips.length === 0 ? `
          <div class="card2" style="padding:48px 20px;text-align:center;">
            <div style="font-size:36px;margin-bottom:14px;opacity:0.6;">🚗</div>
            <div style="font-weight:600;margin-bottom:6px;font-size:15px;">No trips in this range</div>
            <div style="color:var(--text2);font-size:13px;margin-bottom:18px;max-width:380px;margin-left:auto;margin-right:auto;">
              Log your first trip to start building your CRA-compliant vehicle logbook &mdash; or pull in mileage from viewings you've already completed.
            </div>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
              <button class="btn2 btn2-primary" onclick="Mileage.openLogModal()">+ Log a trip</button>
              <button class="btn2" onclick="Mileage.backfillFromPastViewings()">📥 Backfill past viewings</button>
            </div>
          </div>
        ` : `
          <div style="display:grid;gap:8px;">
            ${trips.map(t => this._tripCard(t)).join('')}
          </div>
        `}
      </div>
    `;
  },

  _chip(key, label) {
    const active = this.filter === key;
    const style = active
      ? 'background:var(--accent);color:white;border-color:var(--accent);'
      : '';
    return `<button class="btn2" style="font-size:12px;padding:6px 12px;${style}" onclick="Mileage.setFilter('${key}')">${label}</button>`;
  },

  setFilter(key) { this.filter = key; this.render(); },

  filtered() {
    const now = new Date();
    const yStart = new Date(now.getFullYear(), 0, 1);
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.all.filter(t => {
      const d = new Date(t.trip_date);
      if (this.filter === 'thisYear')    return d >= yStart;
      if (this.filter === 'thisQuarter') return d >= qStart;
      if (this.filter === 'thisMonth')   return d >= mStart;
      return true;
    });
  },

  _tripCard(t) {
    const dest = App.esc(t.end_address || '');
    const client = t.client_name ? ` · ${App.esc(t.client_name)}` : '';
    const km = Number(t.distance_km || 0).toFixed(1);
    const rt = t.is_round_trip ? ' · round-trip' : '';
    return `
      <div class="card2" style="padding:13px 16px;cursor:pointer;" onclick="Mileage.openEditModal('${t.id}')">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dest}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:2px;">
              ${App.fmtDate(t.trip_date)} · ${App.esc(t.purpose)}${rt}${client}
            </div>
          </div>
          <div style="flex-shrink:0;text-align:right;">
            <div style="font-weight:700;font-size:16px;">${km} <span style="font-size:11px;color:var(--text2);font-weight:400;">km</span></div>
          </div>
        </div>
      </div>`;
  },

  // ── Manual trip log modal ────────────────────────────────────────────────
  openLogModal(prefill = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const purposes = ['Viewing', 'Listing appointment', 'Closing', 'Open house', 'Office / Broker', 'Other'];
    App.openModal(`
      <h2 style="margin-top:0;margin-bottom:4px;">Log a trip</h2>
      <div style="font-size:12px;color:var(--text2);margin-bottom:16px;">For your CRA vehicle logbook.</div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input class="form-input" id="mt-date" type="date" value="${prefill.trip_date || today}">
      </div>
      <div class="form-group">
        <label class="form-label">Destination</label>
        <input class="form-input" id="mt-end" placeholder="e.g. 12 Cathedral St, St. John's" value="${App.esc(prefill.end_address || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Starting from <span style="color:var(--text2);font-weight:400;">(blank = home base)</span></label>
        <input class="form-input" id="mt-start" placeholder="${App.esc(currentAgent?.home_base_address || 'Set home base in Settings')}" value="${App.esc(prefill.start_address || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Purpose</label>
        <select class="form-input" id="mt-purpose">
          ${purposes.map(p => `<option value="${p}" ${prefill.purpose === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Kilometers <span style="color:var(--text2);font-weight:400;">(blank = auto-estimate)</span></label>
        <input class="form-input" id="mt-km" type="number" step="0.1" placeholder="auto">
      </div>
      <div class="form-group">
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer;">
          <input id="mt-rt" type="checkbox" checked>
          <span>Round-trip (counts the drive home too)</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">Client <span style="color:var(--text2);font-weight:400;">(optional)</span></label>
        <select class="form-input" id="mt-client">
          <option value="">— None —</option>
          ${(typeof Clients !== 'undefined' ? (Clients.all || []) : []).map(c => `<option value="${c.id}" ${prefill.client_id === c.id ? 'selected' : ''}>${App.esc(c.full_name || '')}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes <span style="color:var(--text2);font-weight:400;">(optional)</span></label>
        <textarea class="form-input" id="mt-notes" rows="2"></textarea>
      </div>
      <button class="btn2 btn2-primary" style="width:100%;justify-content:center;" onclick="Mileage.saveTrip()">Save trip</button>
      <div id="mt-msg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
    `);
  },

  async saveTrip() {
    const date     = document.getElementById('mt-date').value;
    const end      = document.getElementById('mt-end').value.trim();
    const startRaw = document.getElementById('mt-start').value.trim();
    const purpose  = document.getElementById('mt-purpose').value;
    const kmRaw    = document.getElementById('mt-km').value.trim();
    const rt       = document.getElementById('mt-rt').checked;
    const clientId = document.getElementById('mt-client').value || null;
    const notes    = document.getElementById('mt-notes').value.trim();
    const msgEl    = document.getElementById('mt-msg');

    if (!date || !end) {
      if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = '⚠️ Date and destination required'; }
      return;
    }
    if (msgEl) { msgEl.style.color = 'var(--text2)'; msgEl.textContent = 'Saving…'; }

    const startAddr = startRaw || currentAgent?.home_base_address || '';

    // Compute km: manual entry wins; otherwise geocode + Haversine × 1.3
    let km = kmRaw ? Number(kmRaw) : 0;
    let startLat = null, startLng = null, endLat = null, endLng = null;

    if (!kmRaw) {
      try {
        if (startAddr) {
          const s = await this.geocode(startAddr);
          if (s) { startLat = s.lat; startLng = s.lng; }
        }
        if (startLat == null && currentAgent?.home_base_lat) {
          startLat = Number(currentAgent.home_base_lat);
          startLng = Number(currentAgent.home_base_lng);
        }
        const e = await this.geocode(end);
        if (e) { endLat = e.lat; endLng = e.lng; }
        if (startLat != null && endLat != null) {
          km = this.distanceKm(startLat, startLng, endLat, endLng);
          if (rt) km *= 2;
        } else if (msgEl) {
          msgEl.style.color = 'var(--yellow)';
          msgEl.textContent = 'Could not auto-estimate — please enter km manually.';
          return;
        }
      } catch (err) {
        console.warn('[Mileage] geocode failed', err);
      }
    } else if (rt && kmRaw) {
      // If user entered km manually AND ticked round-trip, assume they entered one-way
      // No — let's not assume. Trust the user's number as-is.
    }

    const client = clientId && typeof Clients !== 'undefined'
      ? (Clients.all || []).find(c => c.id === clientId)
      : null;

    const payload = {
      agent_id:       currentAgent.id,
      trip_date:      date,
      start_address:  startAddr || null,
      start_lat:      startLat,
      start_lng:      startLng,
      end_address:    end,
      end_lat:        endLat,
      end_lng:        endLng,
      distance_km:    Number(km.toFixed(2)),
      is_round_trip:  rt,
      purpose,
      client_id:      clientId,
      client_name:    client?.full_name || null,
      notes:          notes || null
    };

    const { error } = await db.from('mileage_trips').insert(payload);
    if (error) {
      if (msgEl) { msgEl.style.color = 'var(--red)'; msgEl.textContent = error.message; }
      return;
    }
    App.closeModal();
    App.toast(`✅ Trip logged · ${payload.distance_km} km`);
    await this.load();
  },

  // ── Edit existing trip ───────────────────────────────────────────────────
  openEditModal(id) {
    const t = this.all.find(x => x.id === id);
    if (!t) return;
    const purposes = ['Viewing', 'Listing appointment', 'Closing', 'Open house', 'Office / Broker', 'Other'];
    App.openModal(`
      <h2 style="margin-top:0;margin-bottom:16px;">Edit trip</h2>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input class="form-input" id="me-date" type="date" value="${t.trip_date}">
      </div>
      <div class="form-group">
        <label class="form-label">Destination</label>
        <input class="form-input" id="me-end" value="${App.esc(t.end_address || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Kilometers</label>
        <input class="form-input" id="me-km" type="number" step="0.1" value="${Number(t.distance_km).toFixed(2)}">
      </div>
      <div class="form-group">
        <label class="form-label">Purpose</label>
        <select class="form-input" id="me-purpose">
          ${purposes.map(p => `<option value="${p}" ${t.purpose === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer;">
          <input id="me-rt" type="checkbox" ${t.is_round_trip ? 'checked' : ''}>
          <span>Round-trip</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="me-notes" rows="2">${App.esc(t.notes || '')}</textarea>
      </div>
      <div style="display:grid;gap:8px;grid-template-columns:1fr 1fr;">
        <button class="btn2" style="color:var(--red);border-color:var(--red);" onclick="Mileage.deleteTrip('${t.id}')">Delete</button>
        <button class="btn2 btn2-primary" onclick="Mileage.updateTrip('${t.id}')">Save changes</button>
      </div>
    `);
  },

  async updateTrip(id) {
    const updates = {
      trip_date:     document.getElementById('me-date').value,
      end_address:   document.getElementById('me-end').value.trim(),
      distance_km:   Number(document.getElementById('me-km').value),
      purpose:       document.getElementById('me-purpose').value,
      is_round_trip: document.getElementById('me-rt').checked,
      notes:         document.getElementById('me-notes').value.trim() || null
    };
    const { error } = await db.from('mileage_trips').update(updates).eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.closeModal();
    App.toast('✅ Trip updated');
    await this.load();
  },

  async deleteTrip(id) {
    if (!confirm('Delete this trip from your logbook? This cannot be undone.')) return;
    const { error } = await db.from('mileage_trips').delete().eq('id', id);
    if (error) { App.toast('⚠️ ' + error.message, 'var(--red)'); return; }
    App.closeModal();
    App.toast('✅ Trip removed');
    await this.load();
  },

  // ── Shortcut from a viewing detail screen ───────────────────────────────
  logFromViewing(viewingId) {
    const v = (typeof Viewings !== 'undefined' ? Viewings.all : []).find(x => x.id === viewingId);
    if (!v) { App.toast('Viewing not found'); return; }
    this.openLogModal({
      trip_date:    v.viewing_date,
      end_address:  v.property_address,
      purpose:      'Viewing',
      client_id:    v.client_id
    });
  },

  // ── AUTO-LOG (no modal) ──────────────────────────────────────────────────
  // Fires automatically when a viewing flips to Completed (via
  // Viewings.markCompleted() or Notify.checkCompletedViewings() auto-flip).
  // Does the same work as logFromViewing() but silently — no modal, no
  // confirm. Idempotent: if a trip is already logged for this viewing,
  // it bails out. Fails silently if the agent has no home_base_address set
  // OR if geocoding doesn't return coordinates — so we never block the
  // existing post-viewing feedback flow on a mileage hiccup.
  //
  // Triggers a single quiet toast on success so the agent knows it
  // happened, with a hint to edit the km in the Mileage tab if the
  // calculated distance doesn't match their actual drive.
  async autoLogFromViewing(viewingId) {
    if (!currentAgent?.id || !viewingId) return;

    // Respect the "auto-prompt" setting — if the agent has turned mileage
    // prompts off, don't auto-log either. They can still manually log
    // from the viewing detail modal.
    if (currentAgent.mileage_prompts_enabled === false) return;

    // Skip if we've already logged a trip for this viewing — prevents
    // duplicates when markCompleted() and the auto-completion poller
    // both fire for the same viewing.
    const { data: existing } = await db.from('mileage_trips')
      .select('id').eq('agent_id', currentAgent.id)
      .eq('linked_viewing_id', viewingId).limit(1).maybeSingle();
    if (existing) return;

    // Pull the viewing record (with property address + client info)
    const v = (typeof Viewings !== 'undefined' ? Viewings.all : []).find(x => x.id === viewingId);
    if (!v || !v.property_address) return;

    const home = currentAgent.home_base_address;
    if (!home) {
      // No home base set — show a one-time hint so the agent knows
      // they can flip this on by adding a home base in Settings.
      App.toast?.('🚗 Set your home base in Settings to auto-log mileage', 'var(--text2)');
      return;
    }

    // Compute distance via the same path the manual log uses
    let km = 0;
    let startLat = currentAgent.home_base_lat;
    let startLng = currentAgent.home_base_lng;
    try {
      if (startLat == null || startLng == null) {
        const s = await this.geocode(home);
        if (s) { startLat = s.lat; startLng = s.lng; }
      }
      const e = await this.geocode(v.property_address);
      if (e && startLat != null && startLng != null) {
        km = this.distanceKm(startLat, startLng, e.lat, e.lng);
      }
    } catch (err) {
      console.warn('[Mileage] auto-log geocode failed', err);
    }
    if (!km || km <= 0) return; // Couldn't compute — don't insert a 0 km row

    // Sanity check — Maxwell works the Avalon Peninsula. Any geocoded
    // distance over 500 km means a geocoder hiccup picked the wrong
    // continent (which is exactly the 4,773 km bug that triggered this
    // fix). Refuse to insert; surface a toast so the agent knows to log
    // the trip manually with the correct km.
    if (km > 500) {
      console.warn('[Mileage] auto-log refused — implausible distance:', km, 'km for', v.property_address);
      App.toast?.(`⚠️ Couldn't auto-log mileage — distance looked off (${km.toFixed(0)} km). Log manually from the Mileage tab.`, 'var(--red)');
      return;
    }

    const client = (typeof Clients !== 'undefined' ? Clients.all : []).find(c => c.id === v.client_id);
    const clientName = client?.full_name || v.client_name || null;

    const { error } = await db.from('mileage_trips').insert({
      agent_id:           currentAgent.id,
      trip_date:          v.viewing_date || new Date().toISOString().slice(0,10),
      start_address:      home,
      start_lat:          startLat,
      start_lng:          startLng,
      end_address:        v.property_address,
      distance_km:        km,
      is_round_trip:      true,
      purpose:            'Viewing',
      linked_viewing_id:  v.id,
      client_id:          v.client_id || null,
      client_name:        clientName,
      notes:              'Auto-logged after viewing marked completed'
    });
    if (error) {
      console.warn('[Mileage] auto-log insert failed', error);
      return;
    }

    App.toast?.(`🚗 ${km.toFixed(1)} km auto-logged (Mileage tab to edit)`, 'var(--green)');
  },

  // ── BACKFILL FROM PAST VIEWINGS ──────────────────────────────────────────
  // One-shot bulk import: scan every past viewing the agent already has on
  // record (status Completed, Done, or Needs Follow-Up — i.e. anything that
  // implies a showing actually happened) and create a mileage_trips row for
  // any that don't already have one linked.
  //
  // CRA defensibility: reconstructed logs are acceptable when supported by
  // contemporaneous business records (the viewings table is that record).
  // Each backfilled trip is tagged in notes so it's transparent that this
  // came from reconstruction, not real-time logging. Going forward the
  // auto-log path keeps the logbook contemporaneous for new viewings.
  //
  // Idempotent: a viewing already linked to a trip is skipped on re-run.
  async backfillFromPastViewings() {
    if (!currentAgent?.id) return;
    if (!currentAgent.home_base_address) {
      App.toast('Set your home base in Settings → Mileage first.', 'var(--red)');
      return;
    }

    App.toast('🔍 Scanning past viewings…', 'var(--text2)');

    // 1. Pull past viewings that imply a drive happened.
    // NOTE: client_name lives on the `clients` table, NOT on `viewings`.
    // We join via the implicit FK so the backfill can label each trip
    // with the client's full name. (Earlier draft mistakenly selected
    // viewings.client_name directly and 42703'd at runtime.)
    const { data: viewings, error: vErr } = await db.from('viewings')
      .select('id, property_address, viewing_date, client_id, viewing_status, clients(full_name)')
      .eq('agent_id', currentAgent.id)
      .in('viewing_status', ['Completed', 'Done', 'Needs Follow-Up'])
      .not('property_address', 'is', null)
      .order('viewing_date', { ascending: false });
    if (vErr) { App.toast(`Couldn't load viewings: ${vErr.message}`, 'var(--red)'); return; }

    // 2. Filter out viewings already linked to a mileage trip
    const { data: existing, error: eErr } = await db.from('mileage_trips')
      .select('linked_viewing_id')
      .eq('agent_id', currentAgent.id)
      .not('linked_viewing_id', 'is', null);
    if (eErr) { App.toast(`Couldn't load existing trips: ${eErr.message}`, 'var(--red)'); return; }
    const linkedIds = new Set((existing || []).map(t => t.linked_viewing_id));
    const candidates = (viewings || []).filter(v => !linkedIds.has(v.id));

    if (!candidates.length) {
      App.toast('All past viewings already have mileage trips logged.', 'var(--text2)');
      return;
    }

    // 3. Confirm with the agent — they should see the count + know this is reconstructed
    const yearGroups = {};
    candidates.forEach(v => {
      const y = (v.viewing_date || '').slice(0, 4) || 'unknown';
      yearGroups[y] = (yearGroups[y] || 0) + 1;
    });
    const breakdown = Object.entries(yearGroups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([y, n]) => `${y}: ${n} viewing${n === 1 ? '' : 's'}`)
      .join('<br>');

    App.openModal(`
      <div style="font-size:18px;font-weight:800;margin-bottom:6px;">🚗 Backfill mileage from past viewings</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:18px;line-height:1.55;">
        Found <strong style="color:var(--text);">${candidates.length}</strong> past viewings without a mileage log.<br>
        ${breakdown}
      </div>
      <div style="background:var(--bg2);padding:12px 14px;border-radius:8px;font-size:12.5px;color:var(--text2);margin-bottom:18px;line-height:1.5;">
        Each backfilled trip will use your <strong>home base</strong> as the
        starting address and the viewing's property address as the destination.
        Round-trip is assumed. Each row is tagged in the notes field as
        reconstructed from a viewing record &mdash; defensible for CRA when
        supported by the viewing data the trip references.
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn2 btn2-primary" style="flex:1;justify-content:center;" onclick="Mileage._runBackfill()">Log ${candidates.length} trip${candidates.length === 1 ? '' : 's'}</button>
        <button class="btn2 btn2-ghost" style="flex:1;justify-content:center;" onclick="App.closeModal()">Cancel</button>
      </div>
    `);
    Mileage._backfillQueue = candidates;
  },

  // Actual insert loop. Sequenced so we don't hammer Nominatim with parallel
  // requests (their public endpoint asks for ~1 req/sec).
  async _runBackfill() {
    const queue = Mileage._backfillQueue || [];
    Mileage._backfillQueue = null;
    App.closeModal();
    if (!queue.length) return;

    let ok = 0, failed = 0;
    App.toast(`Backfilling ${queue.length} trips… this may take a minute.`, 'var(--text2)');

    // Resolve home base coords once — same coords reused for every row.
    let homeLat = currentAgent.home_base_lat;
    let homeLng = currentAgent.home_base_lng;
    if (homeLat == null || homeLng == null) {
      const h = await this.geocode(currentAgent.home_base_address);
      if (h) { homeLat = h.lat; homeLng = h.lng; }
    }
    if (homeLat == null || homeLng == null) {
      App.toast('Could not geocode your home base. Check the address in Settings.', 'var(--red)');
      return;
    }

    for (const v of queue) {
      try {
        const e = await this.geocode(v.property_address);
        if (!e) { failed++; continue; }
        const km = this.distanceKm(homeLat, homeLng, e.lat, e.lng);
        if (!km || km <= 0 || km > 500) { failed++; continue; }

        const { error } = await db.from('mileage_trips').insert({
          agent_id:           currentAgent.id,
          trip_date:          v.viewing_date || new Date().toISOString().slice(0,10),
          start_address:      currentAgent.home_base_address,
          start_lat:          homeLat,
          start_lng:          homeLng,
          end_address:        v.property_address,
          distance_km:        km,
          is_round_trip:      true,
          purpose:            'Viewing',
          linked_viewing_id:  v.id,
          client_id:          v.client_id || null,
          client_name:        v.clients?.full_name || null,
          notes:              'Backfilled from historical viewing record',
        });
        if (error) failed++; else ok++;

        // Polite throttle for Nominatim's public endpoint (~1 req/sec)
        await new Promise(r => setTimeout(r, 1100));
      } catch (err) {
        failed++;
        console.warn('[Mileage] backfill row failed', v.id, err);
      }
    }

    await this.load();
    if (failed === 0) {
      App.toast(`✅ Backfilled ${ok} trip${ok === 1 ? '' : 's'}`, 'var(--green)');
    } else {
      App.toast(`Backfill complete. ${ok} logged, ${failed} skipped (couldn't geocode or distance out of range).`, 'var(--text2)');
    }
  },

  // ── Geocoding via OSM Nominatim (free, no key) ──────────────────────────
  // Cached in-session so we don't hit Nominatim twice for the same address.
  //
  // BUG FIX: the previous version sent the bare address with no country or
  // viewport context. Nominatim then matched the first hit in the world — so
  // "89 Firdale Drive" resolved to a Firdale Drive somewhere in BC and the
  // resulting Haversine distance from St. John's was 4,773 km. Two defences
  // now stack:
  //   (a) Bias the query toward Newfoundland: append ", St. John's, NL" if
  //       the address doesn't already include a province / country hint
  //   (b) Hard-restrict Nominatim with `countrycodes=ca` + an NL viewbox
  //       (-58, 46 to -52, 52) with `bounded=1` so a no-match-in-NL returns
  //       null rather than picking the closest hit in the rest of the world
  // Without (b), a literally-typed address that doesn't exist in NL would
  // still wander to wherever Nominatim found a match.
  _geoCache: {},
  async geocode(address) {
    if (!address) return null;
    const raw = address.trim();
    const key = raw.toLowerCase();
    if (this._geoCache[key]) return this._geoCache[key];

    // (a) Append local context if the caller didn't include it. We check for
    // "NL", "Newfoundland", or "Canada" — any of those means the caller
    // already knows what they're doing and we leave the query alone.
    const hasContext = /\b(NL|Newfoundland|Labrador|Canada|St\.?\s*John[s']?s)\b/i.test(raw);
    const query = hasContext ? raw : `${raw}, St. John's, NL, Canada`;

    try {
      // (b) Hard-restrict to Canada + NL viewbox.
      // viewbox order = lon1,lat1,lon2,lat2 (left, top, right, bottom).
      // NL roughly: lng -58 to -52, lat 46 to 52.
      const params = new URLSearchParams({
        format:        'json',
        limit:         '1',
        q:             query,
        countrycodes:  'ca',
        viewbox:       '-58.0,52.0,-52.0,46.0',
        bounded:       '1',
      });
      const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const arr = await res.json();
      if (arr && arr.length) {
        const r = { lat: Number(arr[0].lat), lng: Number(arr[0].lon) };
        this._geoCache[key] = r;
        return r;
      }
    } catch (err) {
      console.warn('[Mileage] geocode error', err);
    }
    return null;
  },

  // ── Distance: Haversine × 1.3 road multiplier ───────────────────────────
  // Industry-standard CRA-defensible estimate when actual odometer not used.
  distanceKm(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180;
    const R = 6371; // earth radius km
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1.3;
  },

  // ── CSV export ───────────────────────────────────────────────────────────
  exportCSV() {
    const trips = this.filtered();
    if (!trips.length) { App.toast('No trips in this range'); return; }
    const rows = [['Date', 'Destination', 'Purpose', 'Client', 'Kilometers', 'Round-trip', 'Notes']];
    // Oldest first for accountant readability
    trips.slice().reverse().forEach(t => rows.push([
      t.trip_date,
      t.end_address || '',
      t.purpose,
      t.client_name || '',
      Number(t.distance_km).toFixed(2),
      t.is_round_trip ? 'Yes' : 'No',
      (t.notes || '').replace(/[\r\n]+/g, ' ')
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mileage-${this.filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ── PDF export — CRA-format vehicle logbook ─────────────────────────────
  // Opens a print window with a professional serif layout. Cream/charcoal,
  // tabular numbers, running total column, signature line. CRA-aligned columns.
  exportPDF() {
    const trips = this.filtered();
    if (!trips.length) { App.toast('No trips in this range'); return; }

    const totalKm    = trips.reduce((s, t) => s + Number(t.distance_km || 0), 0);
    const rate       = Number(currentAgent?.per_km_rate || 0.73);
    const totalValue = totalKm * rate;
    const today      = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const agentName  = currentAgent?.full_name || currentAgent?.name || 'Agent';
    const brokerage  = currentAgent?.brokerage || 'eXp Realty';
    const rangeLabel = ({
      all:         'Complete logbook',
      thisYear:    `Tax year ${new Date().getFullYear()}`,
      thisQuarter: 'Current quarter',
      thisMonth:   'Current month'
    })[this.filter] || 'Logbook';

    // Oldest first, with running total
    let running = 0;
    const rowsHtml = trips.slice().reverse().map(t => {
      running += Number(t.distance_km);
      const km = Number(t.distance_km).toFixed(1);
      const dest = (t.end_address || '').replace(/</g, '&lt;');
      const purp = (t.purpose || '').replace(/</g, '&lt;') + (t.is_round_trip ? ' <span class="rt">(RT)</span>' : '');
      const cli  = (t.client_name || '—').replace(/</g, '&lt;');
      return `<tr>
        <td>${t.trip_date}</td>
        <td class="dest">${dest}</td>
        <td>${purp}</td>
        <td class="cli">${cli}</td>
        <td class="num">${km}</td>
        <td class="num run">${running.toFixed(1)}</td>
      </tr>`;
    }).join('');

    const safe = s => String(s).replace(/</g, '&lt;');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Vehicle Logbook · ${safe(agentName)} · ${safe(rangeLabel)}</title>
<style>
  @page { size: letter; margin: 0.55in 0.6in 0.65in; }
  * { box-sizing: border-box; }
  html, body { background: #faf7ee; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 10pt; color: #1c1c1c; margin: 0; line-height: 1.42; }
  .doc { max-width: 7.3in; margin: 0 auto; }
  .brand { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8.5pt; letter-spacing: 2px; color: #6b6b6b; text-transform: uppercase; margin-bottom: 4px; }
  h1 { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 22pt; font-weight: 600; margin: 0 0 2px; letter-spacing: -0.4px; }
  .subtitle { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5pt; color: #555; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 22px; }
  .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 28px; font-size: 10pt; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid #c8bfa6; }
  .meta b { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8.2pt; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.9px; font-weight: 600; display: block; margin-bottom: 2px; }
  .summary { background: #efe8d3; border: 1px solid #c8bfa6; padding: 14px 18px; margin-bottom: 22px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .summary .stat b { display: block; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 7.6pt; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.9px; font-weight: 600; margin-bottom: 3px; }
  .summary .stat span { font-size: 17pt; font-weight: 600; color: #1c1c1c; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  thead th { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 7.8pt; text-transform: uppercase; letter-spacing: 0.8px; color: #555; text-align: left; padding: 9px 6px; border-bottom: 1.6px solid #1c1c1c; font-weight: 600; }
  tbody td { padding: 7px 6px; border-bottom: 1px solid #e1d8be; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.run { color: #6b6b6b; }
  td.dest { font-weight: 500; }
  td.cli { color: #444; }
  .rt { color: #6b6b6b; font-size: 8pt; }
  tbody tr:nth-child(even) td { background: #f3ecd6; }
  .sigblock { margin-top: 44px; padding-top: 6px; border-top: 1.2px solid #1c1c1c; max-width: 280px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8.5pt; color: #555; text-transform: uppercase; letter-spacing: 0.9px; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #c8bfa6; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8pt; color: #6b6b6b; display: flex; justify-content: space-between; letter-spacing: 0.3px; }
  .disclaimer { margin-top: 8px; font-size: 8pt; color: #6b6b6b; font-style: italic; }
  @media print { body { background: white; } .summary { background: #efe8d3 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } tbody tr:nth-child(even) td { background: #f3ecd6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body><div class="doc">
  <div class="brand">Maxwell DealFlow · CRA Vehicle Logbook</div>
  <h1>Vehicle Logbook</h1>
  <div class="subtitle">${safe(rangeLabel)}</div>
  <div class="meta">
    <div><b>Prepared by</b>${safe(agentName)}</div>
    <div><b>Brokerage</b>${safe(brokerage)}</div>
    <div><b>Date generated</b>${today}</div>
    <div><b>Per-km rate (CRA)</b>$${rate.toFixed(3)} / km</div>
  </div>
  <div class="summary">
    <div class="stat"><b>Total trips</b><span>${trips.length}</span></div>
    <div class="stat"><b>Total kilometers</b><span>${totalKm.toFixed(1)}</span></div>
    <div class="stat"><b>Estimated value</b><span>$${totalValue.toFixed(2)}</span></div>
  </div>
  <table>
    <thead><tr>
      <th>Date</th>
      <th>Destination</th>
      <th>Purpose</th>
      <th>Client</th>
      <th class="num">KM</th>
      <th class="num">Running total</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="sigblock">Signature &amp; date</div>
  <div class="disclaimer">Self-employed agents deduct actual vehicle expenses multiplied by business-use percentage. This logbook supports that percentage. The "estimated value" shown above is informational only.</div>
  <div class="footer">
    <div>${safe(agentName)} · ${safe(brokerage)}</div>
    <div>Generated ${today}</div>
  </div>
</div></body></html>`;

    const w = window.open('', '_blank');
    if (!w) { App.toast('Pop-up blocked — allow pop-ups to export PDF'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch(e) {} }, 450);
  }
};

window.Mileage = Mileage;
