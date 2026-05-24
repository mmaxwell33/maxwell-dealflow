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
  // Layout (top → bottom):
  //   1. Header  — title + Backfill / Log-a-trip actions
  //   2. Stats   — three premium cards (Trips, Kilometers, Claimable value)
  //   3. Controls — filter chips on the left, export buttons on the right
  //   4. Trips   — grouped by MONTH with a per-month subtotal line, each
  //                trip rendered as a rich card (date pill, route, meta
  //                chips, prominent km + $)
  //   5. Empty   — friendly empty-state when no trips match the filter
  render() {
    const el = document.getElementById('mileage');
    if (!el) return;

    const trips = this.filtered();
    const totalKm = trips.reduce((s, t) => s + Number(t.distance_km || 0), 0);
    const tripCount = trips.length;
    const rate = Number(currentAgent?.per_km_rate || 0.73);
    const estValue = totalKm * rate;
    const filterLabel = ({all:'all time', thisYear:'this year', thisQuarter:'this quarter', thisMonth:'this month'})[this.filter] || 'this period';

    el.innerHTML = `
      <div class="ml-wrap">
        <!-- ── HEADER ─────────────────────────────────────────────────── -->
        <header class="ml-header">
          <div class="ml-header-title">
            <h1>🚗 Mileage Logbook</h1>
            <p>CRA-compliant vehicle log for tax filing &middot; <span style="color:var(--text);">${filterLabel}</span></p>
          </div>
          <div class="ml-header-actions">
            <button class="btn2" onclick="Mileage.backfillFromPastViewings()" title="Scan past viewings without mileage logs and create them in bulk">📥 Backfill past viewings</button>
            <button class="btn2 btn2-primary" onclick="Mileage.openLogModal()">+ Log a trip</button>
          </div>
        </header>

        <!-- ── STATS ──────────────────────────────────────────────────── -->
        <section class="ml-stats">
          <div class="ml-stat">
            <div class="ml-stat-icon ml-stat-icon-blue">🚗</div>
            <div class="ml-stat-body">
              <div class="ml-stat-label">Trips</div>
              <div class="ml-stat-value">${tripCount}</div>
              <div class="ml-stat-hint">${tripCount === 1 ? 'logged' : 'logged'} ${filterLabel}</div>
            </div>
          </div>
          <div class="ml-stat">
            <div class="ml-stat-icon ml-stat-icon-coral">📍</div>
            <div class="ml-stat-body">
              <div class="ml-stat-label">Total kilometres</div>
              <div class="ml-stat-value">${totalKm.toFixed(1)} <span class="ml-stat-unit">km</span></div>
              <div class="ml-stat-hint">Round-trips counted both ways</div>
            </div>
          </div>
          <div class="ml-stat ml-stat-accent">
            <div class="ml-stat-icon ml-stat-icon-white">💰</div>
            <div class="ml-stat-body">
              <div class="ml-stat-label">Claimable @ $${rate.toFixed(2)}/km</div>
              <div class="ml-stat-value">$${estValue.toFixed(2)}</div>
              <div class="ml-stat-hint">Estimated CRA deduction</div>
            </div>
          </div>
        </section>

        <!-- ── CONTROLS ───────────────────────────────────────────────── -->
        <section class="ml-controls">
          <div class="ml-chips">
            ${this._chip('all','All')}
            ${this._chip('thisYear','This year')}
            ${this._chip('thisQuarter','This quarter')}
            ${this._chip('thisMonth','This month')}
          </div>
          <div class="ml-exports">
            <button class="btn2 ml-export-btn" onclick="Mileage.exportCSV()">
              <span class="ml-export-icon">⬇</span>
              <span>CSV</span>
            </button>
            <button class="btn2 btn2-primary ml-export-btn" onclick="Mileage.exportPDF()">
              <span class="ml-export-icon">📄</span>
              <span>CRA Logbook PDF</span>
            </button>
          </div>
        </section>

        <!-- ── TRIPS LIST or EMPTY STATE ──────────────────────────────── -->
        ${trips.length === 0 ? this._emptyState() : this._tripsByMonth(trips, rate)}
      </div>
    `;
  },

  // ── EMPTY STATE ─────────────────────────────────────────────────────────
  _emptyState() {
    return `
      <div class="ml-empty">
        <div class="ml-empty-icon">🚗</div>
        <h3>No trips in this range</h3>
        <p>Log your first trip to start building your CRA-compliant vehicle logbook &mdash; or pull in mileage from viewings you've already completed.</p>
        <div class="ml-empty-actions">
          <button class="btn2 btn2-primary" onclick="Mileage.openLogModal()">+ Log a trip</button>
          <button class="btn2" onclick="Mileage.backfillFromPastViewings()">📥 Backfill past viewings</button>
        </div>
      </div>`;
  },

  // ── TRIPS GROUPED BY MONTH ──────────────────────────────────────────────
  // Each month gets a header with subtotal (km + $) so a glance tells the
  // agent how much they drove + can claim per month — without computing
  // anything in their head.
  _tripsByMonth(trips, rate) {
    // Bucket trips into {YYYY-MM: [trips]} preserving insertion order
    const buckets = new Map();
    trips.forEach(t => {
      const key = (t.trip_date || '').slice(0, 7); // YYYY-MM
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    });
    const months = Array.from(buckets.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    return `
      <section class="ml-months">
        ${months.map(([ym, mTrips]) => {
          const mKm = mTrips.reduce((s, t) => s + Number(t.distance_km || 0), 0);
          const mValue = mKm * rate;
          const monthLabel = this._formatMonth(ym);
          return `
            <div class="ml-month-group">
              <div class="ml-month-header">
                <div class="ml-month-name">${monthLabel}</div>
                <div class="ml-month-stats">
                  <span>${mTrips.length} trip${mTrips.length === 1 ? '' : 's'}</span>
                  <span class="ml-dot">·</span>
                  <span>${mKm.toFixed(1)} km</span>
                  <span class="ml-dot">·</span>
                  <span class="ml-month-money">$${mValue.toFixed(2)}</span>
                </div>
              </div>
              <div class="ml-month-trips">
                ${mTrips.map(t => this._tripCard(t, rate)).join('')}
              </div>
            </div>`;
        }).join('')}
      </section>`;
  },

  _formatMonth(ym) {
    if (!ym) return 'Unknown';
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, (m || 1) - 1, 1);
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long' });
  },

  // ── FILTER CHIP ─────────────────────────────────────────────────────────
  // Active variant uses the coral brand colour. Inactive sits flat with a
  // subtle border so the active state has clear visual emphasis.
  _chip(key, label) {
    const active = this.filter === key;
    return `<button class="ml-chip ${active ? 'is-active' : ''}" onclick="Mileage.setFilter('${key}')">${label}</button>`;
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

  // ── TRIP CARD ──────────────────────────────────────────────────────────
  // Anatomy:
  //   [Date pill] [Route: from → to + meta chips] [km] [$value] [edit]
  // The date pill is a deliberate visual anchor on the left so the agent
  // can scan a long list and pick out a specific date instantly.
  _tripCard(t, rate) {
    const dest = App.esc(t.end_address || '');
    const from = App.esc(t.start_address || (currentAgent?.home_base_address || 'Home base'));
    const client = t.client_name ? App.esc(t.client_name) : '';
    const km = Number(t.distance_km || 0);
    const value = km * (rate || Number(currentAgent?.per_km_rate || 0.73));
    const d = new Date(t.trip_date);
    const day = isNaN(d) ? '—' : d.getDate();
    const monthAbbr = isNaN(d) ? '' : d.toLocaleDateString('en-CA', { month: 'short' }).toUpperCase();
    const purposeIcon = ({
      'Viewing':              '🏠',
      'Listing appointment':  '📋',
      'Closing':              '🤝',
      'Open house':           '🚪',
      'Office / Broker':      '🏢',
      'Other':                '📍',
    })[t.purpose] || '📍';

    return `
      <div class="ml-trip" onclick="Mileage.openEditModal('${t.id}')" title="Edit this trip">
        <div class="ml-trip-date">
          <div class="ml-trip-day">${day}</div>
          <div class="ml-trip-month">${monthAbbr}</div>
        </div>
        <div class="ml-trip-body">
          <div class="ml-trip-route">
            <span class="ml-trip-from">${from}</span>
            <span class="ml-trip-arrow">→</span>
            <span class="ml-trip-to">${dest}</span>
          </div>
          <div class="ml-trip-meta">
            <span class="ml-trip-tag">${purposeIcon} ${App.esc(t.purpose || 'Trip')}</span>
            ${t.is_round_trip ? '<span class="ml-trip-tag ml-trip-tag-muted">↔ Round-trip</span>' : '<span class="ml-trip-tag ml-trip-tag-muted">→ One-way</span>'}
            ${client ? `<span class="ml-trip-client">with ${client}</span>` : ''}
          </div>
        </div>
        <div class="ml-trip-stats">
          <div class="ml-trip-km">${km.toFixed(1)} <span class="ml-trip-unit">km</span></div>
          <div class="ml-trip-value">$${value.toFixed(2)}</div>
        </div>
        <button class="ml-trip-edit" onclick="event.stopPropagation();Mileage.openEditModal('${t.id}')" aria-label="Edit trip">⋯</button>
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
    //
    // Schema notes (learned the hard way this session):
    //   - viewings does NOT have a `client_name` column — join clients
    //     via FK and read clients.full_name instead
    //   - viewings does NOT have an `agent_id` column either — isolation
    //     happens via RLS on the row level. Same pattern Viewings.load()
    //     uses: no agent_id filter, trust RLS to return only this
    //     agent's rows.
    const { data: viewings, error: vErr } = await db.from('viewings')
      .select('id, property_address, viewing_date, client_id, viewing_status, clients(full_name)')
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

    let ok = 0, failGeo = 0, failDist = 0, failDb = 0;
    App.toast(`Backfilling ${queue.length} trips… this may take a minute.`, 'var(--text2)');

    // Resolve home base coords with a FRESH geocode every run. The stored
    // home_base_lat/lng might be from the old buggy geocoder that wandered
    // to BC for any address that didn't include "St. John's" — in which
    // case every distance below is 4,700+ km and the 500 km sanity check
    // kills every row. Re-geocode and persist back to agents so the
    // next save reflects the corrected coords.
    console.log('[Mileage] Re-geocoding home base:', currentAgent.home_base_address);
    const h = await this.geocode(currentAgent.home_base_address);
    if (!h) {
      App.toast('Could not geocode your home base. Check the address in Settings.', 'var(--red)');
      console.error('[Mileage] Home base geocode returned null for:', currentAgent.home_base_address);
      return;
    }
    const homeLat = h.lat, homeLng = h.lng;
    console.log('[Mileage] Home base resolved to:', homeLat, homeLng);
    // Persist the corrected coords back to the agent so future auto-logs
    // use them rather than the stale ones.
    await db.from('agents').update({
      home_base_lat: homeLat,
      home_base_lng: homeLng,
    }).eq('id', currentAgent.id);
    currentAgent.home_base_lat = homeLat;
    currentAgent.home_base_lng = homeLng;

    for (const v of queue) {
      try {
        console.log('[Mileage] Geocoding viewing:', v.property_address);
        const e = await this.geocode(v.property_address);
        if (!e) {
          console.warn('[Mileage] No geocode for:', v.property_address);
          failGeo++; continue;
        }
        const km = this.distanceKm(homeLat, homeLng, e.lat, e.lng);
        console.log(`[Mileage]   → ${e.lat.toFixed(4)},${e.lng.toFixed(4)} = ${km.toFixed(1)} km`);
        if (!km || km <= 0 || km > 500) {
          console.warn(`[Mileage]   ✗ Distance out of range (${km.toFixed(1)} km) — skipping`);
          failDist++; continue;
        }

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
        if (error) { console.error('[Mileage] insert failed:', error); failDb++; } else ok++;

        // Small throttle — we're now hitting MapTiler via our Edge Function
        // (100k/month free tier, no per-second rate limit) so 200ms is plenty.
        // Keeps the UI from feeling instantaneous and gives Supabase Functions
        // a beat between invocations.
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        failGeo++;
        console.warn('[Mileage] backfill row threw:', v.id, err);
      }
    }

    await this.load();
    const total = failGeo + failDist + failDb;
    console.log(`[Mileage] Backfill summary — ok:${ok}, geo-fail:${failGeo}, dist-out:${failDist}, db-fail:${failDb}`);
    if (total === 0) {
      App.toast(`✅ Backfilled ${ok} trip${ok === 1 ? '' : 's'}`, 'var(--green)');
    } else {
      App.toast(`Backfill: ${ok} logged · ${failGeo} couldn't geocode · ${failDist} out-of-range · ${failDb} db errors`, 'var(--text2)');
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

  // Geocode an address via our /functions/v1/geocode Edge Function (which
  // proxies to MapTiler using a server-side API key stored as MAPTILER_KEY
  // in Supabase secrets).
  //
  // Why we moved off Nominatim:
  //   - OSM's public endpoint rate-limits aggressively (1 req/sec per IP,
  //     with cool-down for abuse). After a few backfill runs Maxwell's IP
  //     was 429'ing and every geocode returned null. The "0 logged" bug.
  //   - MapTiler's free tier is 100k/month vs Nominatim's effective ~1k/day
  //     before throttling. With Maxwell's volume (~30/month) we'll never
  //     get close.
  //   - The Edge Function approach also keeps the API key off the client
  //     and applies country=ca + St. John's proximity in one server-side
  //     place rather than re-passing parameters from every caller.
  async geocode(address) {
    if (!address) return null;
    const raw = address.trim();
    const cacheKey = raw.toLowerCase();
    if (this._geoCache[cacheKey]) return this._geoCache[cacheKey];

    try {
      // Need an auth header on the Edge Function — any Supabase session
      // token is fine, we just want to prove the call came from the app.
      const { data: { session } } = await db.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        console.warn('[Mileage] geocode skipped — no auth session');
        return null;
      }

      const url = `${SUPABASE_URL}/functions/v1/geocode?q=${encodeURIComponent(raw)}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey':        SUPABASE_ANON_KEY,
          'Accept':        'application/json',
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('[Mileage] geocode failed:', res.status, body?.error || body);
        return null;
      }
      if (typeof body.lat === 'number' && typeof body.lng === 'number') {
        const r = { lat: body.lat, lng: body.lng };
        this._geoCache[cacheKey] = r;
        return r;
      }
    } catch (err) {
      console.warn('[Mileage] geocode request threw:', err);
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
