// ── CALENDAR ─────────────────────────────────────────────────────────────────
const Calendar = {
  _year:   null,
  _month:  null,
  _events: [],
  _view:   'month', // 'month' | 'list'

  async load() {
    const now = new Date();
    if (Calendar._year === null) {
      Calendar._year  = now.getFullYear();
      Calendar._month = now.getMonth();
    }
    await Calendar.fetchEvents();
    Calendar.render();
  },

  async fetchEvents() {
    // Pipeline milestone dates
    const { data: deals } = await db.from('pipeline')
      .select('id, client_name, property_address, acceptance_date, financing_date, inspection_date, walkthrough_date, closing_date, stage')
      .order('closing_date', { ascending: true });

    // Scheduled viewings
    const { data: viewings } = await db.from('viewings')
      .select('id, client_name, address, viewing_date, viewing_time, viewing_status')
      .order('viewing_date', { ascending: true })
      .limit(150);

    const events = [];

    const addDealEvent = (date, label, type, icon, clientName, address, dealId) => {
      if (!date) return;
      events.push({ date: date.slice(0,10), label, type, icon, client: clientName || '—', sub: address || '', dealId });
    };

    (deals || []).forEach(d => {
      const name    = d.client_name      || '';
      const addr    = d.property_address || '';
      addDealEvent(d.acceptance_date, 'Accepted',    'accepted',    '✅', name, addr, d.id);
      addDealEvent(d.financing_date,  'Financing',   'financing',   '🏦', name, addr, d.id);
      addDealEvent(d.inspection_date, 'Inspection',  'inspection',  '🔍', name, addr, d.id);
      addDealEvent(d.walkthrough_date,'Walkthrough', 'walkthrough', '🚶', name, addr, d.id);
      addDealEvent(d.closing_date,    'Closing Day', 'closing',     '🔑', name, addr, d.id);
    });

    (viewings || []).forEach(v => {
      if (!v.viewing_date) return;
      events.push({
        date:   v.viewing_date.slice(0,10),
        label:  'Showing',
        type:   'viewing',
        icon:   '📅',
        client: v.client_name || '—',
        sub:    v.address     || '',
        time:   v.viewing_time ? v.viewing_time.slice(0,5) : null,
        status: v.viewing_status
      });
    });

    Calendar._events = events.sort((a,b) => a.date.localeCompare(b.date));
  },

  // ── Render dispatcher ────────────────────────────────────────────────────
  render() {
    const view = Calendar._view;
    document.querySelectorAll('.cal-view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    if (view === 'month') Calendar._renderMonth();
    else                  Calendar._renderList();
  },

  // ── Month grid ───────────────────────────────────────────────────────────
  _renderMonth() {
    const el = document.getElementById('calendar-content');
    if (!el) return;

    const year  = Calendar._year;
    const month = Calendar._month;
    const today = new Date().toISOString().slice(0,10);
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    document.getElementById('cal-month-label').textContent = `${MONTHS[month]} ${year}`;

    const firstDow   = new Date(year, month, 1).getDay();
    const daysInMon  = new Date(year, month + 1, 0).getDate();

    // Build map of events for this month
    const evMap = {};
    Calendar._events.forEach(e => {
      const [ey, em] = e.date.split('-').map(Number);
      if (ey !== year || em - 1 !== month) return;
      const d = parseInt(e.date.split('-')[2]);
      if (!evMap[d]) evMap[d] = [];
      evMap[d].push(e);
    });

    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let html = `<div class="cal-day-headers">` + DAYS.map(d => `<div class="cal-day-hdr">${d}</div>`).join('') + `</div>`;
    html += `<div class="cal-grid">`;

    for (let i = 0; i < firstDow; i++) html += `<div class="cal-cell cal-empty"></div>`;

    for (let day = 1; day <= daysInMon; day++) {
      const ds   = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const evs  = evMap[day] || [];
      const isTd = ds === today;
      html += `<div class="cal-cell${isTd?' cal-today':''}${evs.length?' cal-has-events':''}" onclick="Calendar.showDay('${ds}')">
        <div class="cal-date-num${isTd?' cal-today-num':''}">${day}</div>`;
      const show  = evs.slice(0,2);
      const extra = evs.length - 2;
      show.forEach(e => { html += `<div class="cal-chip cal-chip-${e.type}">${e.label}</div>`; });
      if (extra > 0) html += `<div class="cal-chip-more">+${extra}</div>`;
      html += `</div>`;
    }
    html += `</div>`;

    // Legend + upcoming below grid
    html += Calendar._legendHtml();
    el.innerHTML = html;

    Calendar._renderUpcomingInline();
  },

  _legendHtml() {
    const types = [
      ['viewing','📅','Showing'],
      ['accepted','✅','Accepted'],
      ['financing','🏦','Financing'],
      ['inspection','🔍','Inspection'],
      ['walkthrough','🚶','Walkthrough'],
      ['closing','🔑','Closing']
    ];
    return `<div class="cal-legend">` +
      types.map(([t,,label]) => `<span class="cal-legend-item"><span class="cal-dot cal-dot-${t}"></span>${label}</span>`).join('') +
      `</div>`;
  },

  _renderUpcomingInline() {
    let el = document.getElementById('cal-upcoming');
    if (!el) return;
    const today = new Date().toISOString().slice(0,10);
    const upcoming = Calendar._events
      .filter(e => e.date >= today)
      .slice(0,12);

    if (!upcoming.length) {
      el.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="empty-icon">📅</div><div class="empty-text">No upcoming events</div></div>`;
      return;
    }
    // Group by date with a header per day
    let lastDate = null;
    let rows = '';
    upcoming.forEach(e => {
      if (e.date !== lastDate) {
        const d = new Date(e.date + 'T12:00:00');
        const hdr = d.toLocaleDateString('en-CA', { weekday:'short', month:'short', day:'numeric' });
        rows += `<div class="cal-upcm-date-hdr">${hdr}</div>`;
        lastDate = e.date;
      }
      rows += Calendar._upcomingRow(e, true);
    });
    el.innerHTML = rows;
  },

  _upcomingRow(e, hideDate = false) {
    return `<div class="cal-upcm-item cal-upcm-${e.type}">
      <div class="cal-dot cal-dot-${e.type}" style="flex-shrink:0;margin-top:3px;"></div>
      <div style="flex:1;min-width:0;">
        <div class="cal-upcm-label">${e.icon} ${e.label}</div>
        <div class="cal-upcm-meta">${App.esc(e.client)}${e.sub ? ' · ' + App.esc(e.sub.split(',')[0]) : ''}${e.time ? ' · ⏰ ' + e.time : ''}</div>
      </div>
      ${hideDate ? '' : `<div class="cal-upcm-date">${App.fmtDate(e.date)}</div>`}
    </div>`;
  },

  // ── List view ────────────────────────────────────────────────────────────
  _renderList() {
    const el = document.getElementById('calendar-content');
    if (!el) return;
    const today = new Date().toISOString().slice(0,10);
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    document.getElementById('cal-month-label').textContent = 'All Events';

    const upcoming = Calendar._events.filter(e => e.date >= today);
    const past     = Calendar._events.filter(e => e.date < today).reverse().slice(0,20);

    const section = (title, evs) => {
      if (!evs.length) return '';
      return `<div class="cal-list-section">
        <div class="cal-list-hdr">${title}</div>
        ${evs.map(e => Calendar._upcomingRow(e)).join('')}
      </div>`;
    };

    el.innerHTML = `
      <div class="card" style="padding:12px 16px;margin-bottom:12px;">
        ${section('Upcoming', upcoming) || '<div class="empty-state" style="padding:20px;"><div class="empty-icon">📅</div><div class="empty-text">No upcoming events</div></div>'}
      </div>
      ${past.length ? `<div class="card" style="padding:12px 16px;">${section('Past (last 20)', past)}</div>` : ''}
    `;
  },

  // ── Day detail popup ─────────────────────────────────────────────────────
  showDay(ds) {
    const evs = Calendar._events.filter(e => e.date === ds);
    if (!evs.length) return;
    const fmtd = new Date(ds + 'T12:00:00').toLocaleDateString('en-CA', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
    App.openModal(`
      <div class="modal-title">📅 ${fmtd}</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;">
      ${evs.map(e => `
        <div class="cal-day-ev">
          <div class="cal-dot cal-dot-${e.type}" style="flex-shrink:0;margin-top:4px;"></div>
          <div>
            <div style="font-size:14px;font-weight:700;">${e.icon} ${e.label}</div>
            <div style="font-size:12px;color:var(--text2);">${App.esc(e.client)}${e.sub ? ' · ' + App.esc(e.sub) : ''}${e.time ? ' · ⏰ ' + e.time : ''}</div>
          </div>
        </div>`).join('')}
      </div>
    `);
  },

  // ── Navigation ───────────────────────────────────────────────────────────
  prev() {
    if (Calendar._view === 'list') return;
    Calendar._month--;
    if (Calendar._month < 0) { Calendar._month = 11; Calendar._year--; }
    Calendar.render();
  },

  next() {
    if (Calendar._view === 'list') return;
    Calendar._month++;
    if (Calendar._month > 11) { Calendar._month = 0; Calendar._year++; }
    Calendar.render();
  },

  goToday() {
    const now = new Date();
    Calendar._year  = now.getFullYear();
    Calendar._month = now.getMonth();
    Calendar.render();
  },

  setView(v) {
    Calendar._view = v;
    Calendar.render();
  }
};
