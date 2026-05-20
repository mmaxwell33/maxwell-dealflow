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
          <div style="display:flex;gap:8px;">
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
            <div style="color:var(--text2);font-size:13px;margin-bottom:18px;max-width:340px;margin-left:auto;margin-right:auto;">
              Log your first trip to start building your CRA-compliant vehicle logbook.
            </div>
            <button class="btn2 btn2-primary" onclick="Mileage.openLogModal()">+ Log a trip</button>
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

  // ── Geocoding via OSM Nominatim (free, no key) ──────────────────────────
  // Cached in-session so we don't hit Nominatim twice for the same address.
  _geoCache: {},
  async geocode(address) {
    if (!address) return null;
    const key = address.trim().toLowerCase();
    if (this._geoCache[key]) return this._geoCache[key];
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
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
