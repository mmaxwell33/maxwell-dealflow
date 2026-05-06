// ─────────────────────────────────────────────────────────────────────────────
// Briefing — daily money brief tab inside the DealFlow PWA
// Reads from public.briefings (written each morning by the daily-briefing
// edge function). Renders today's brief at the top + a tappable archive
// of past days underneath. Audio plays inline via <audio> + the public
// mp3_url from Supabase storage.
// ─────────────────────────────────────────────────────────────────────────────

const Briefing = {
  // ─── Helpers ───────────────────────────────────────────────────────────────
  _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _formatDate(d) {
    if (!d) return '';
    try {
      const dt = new Date(d + 'T12:00:00');
      return dt.toLocaleDateString('en-CA', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
    } catch { return d; }
  },

  _shortDate(d) {
    if (!d) return '';
    try {
      const dt = new Date(d + 'T12:00:00');
      return dt.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch { return d; }
  },

  _todayStr() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/St_Johns' });
  },

  // ─── Main load ─────────────────────────────────────────────────────────────
  async load() {
    const container = document.getElementById('briefing-container');
    if (!container) return;
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2);">Loading today's briefing…</div>`;

    const today = Briefing._todayStr();

    try {
      // Fetch today's + archive in parallel
      const [todayRes, archiveRes] = await Promise.all([
        db.from('briefings').select('*').eq('date', today).maybeSingle(),
        db.from('briefings').select('date, snapshot, mp3_url, created_at').order('date', { ascending: false }).limit(30),
      ]);

      const todayBrief = todayRes.data;
      const archive = (archiveRes.data || []).filter(b => b.date !== today);

      let html = '';
      if (todayBrief) {
        html += Briefing._renderBrief(todayBrief, true);
      } else {
        html += `<div class="card" style="text-align:center;padding:32px 16px;margin-bottom:16px;">
          <div style="font-size:48px;">📭</div>
          <div style="font-size:16px;margin:10px 0;font-weight:600;">No briefing yet for today</div>
          <div style="font-size:13px;color:var(--text2);">It'll arrive automatically by ~6:30 AM Newfoundland time. Pull down to refresh.</div>
          <div style="margin-top:16px;"><button class="btn btn-outline btn-sm" onclick="Briefing.load()">🔄 Refresh</button></div>
        </div>`;
      }
      html += Briefing._renderArchive(archive);
      container.innerHTML = html;
    } catch (err) {
      console.error('[briefing] load error', err);
      container.innerHTML = `<div class="card" style="padding:20px;text-align:center;color:var(--red);">Failed to load briefings: ${Briefing._esc(err.message || String(err))}<br><button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="Briefing.load()">Try again</button></div>`;
    }
  },

  // ─── Render today's brief ──────────────────────────────────────────────────
  _renderBrief(b, isToday) {
    const snap     = b.snapshot || {};
    const action   = b.action_item || {};
    const mort     = action.mortgage_rates || {};
    const oneMove  = action.one_move || {};
    const sources  = action.sources || [];
    const stories  = Array.isArray(b.stories) ? b.stories.slice(0, 3) : [];
    const watch    = Array.isArray(b.watch_list) ? b.watch_list.slice(0, 4) : [];
    const audit    = b.audit_footer || '';

    const metric = (label, value, sub) => `
      <div style="background:var(--bg);padding:12px;border-radius:8px;text-align:center;">
        <div style="font-size:10px;letter-spacing:0.12em;color:var(--text2);text-transform:uppercase;">${Briefing._esc(label)}</div>
        <div style="font-size:22px;font-weight:700;color:var(--text1);margin:4px 0 2px;">${Briefing._esc(value || '—')}</div>
        <div style="font-size:11px;color:var(--text2);">${Briefing._esc(sub || '')}</div>
      </div>`;

    const story = (s, i) => `
      <div style="background:var(--bg);padding:12px;border-radius:8px;margin-bottom:10px;">
        <div style="font-size:11px;color:var(--text2);">${String(i+1).padStart(2,'0')}</div>
        <div style="font-weight:600;font-size:15px;margin:4px 0 6px;">${Briefing._esc(s.headline || '')}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:8px;">${Briefing._esc(s.body || '')}</div>
        ${s.plain_english ? `<div style="font-size:12px;background:var(--card);padding:8px 10px;border-radius:4px;border-left:3px solid var(--accent);">
          <strong style="color:var(--text2);">Plain English →</strong> ${Briefing._esc(s.plain_english)}
        </div>` : ''}
      </div>`;

    return `
      <div class="card" style="padding:14px;margin-bottom:16px;">
        ${!isToday ? `<div style="margin-bottom:12px;"><button class="btn btn-outline btn-sm" onclick="Briefing.load()">← Back to today</button></div>` : ''}

        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">${isToday ? "Today" : "Archive"} · ${Briefing._esc(Briefing._formatDate(b.date))}</div>
        <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;">Today in Canadian money</h2>

        ${b.mp3_url ? `<div style="margin-bottom:16px;background:var(--bg);padding:12px;border-radius:8px;">
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">▶ Audio briefing · 2 hosts · ~9 min</div>
          <audio controls preload="metadata" style="width:100%;" src="${Briefing._esc(b.mp3_url)}"></audio>
        </div>` : ''}

        <!-- Metric cards 2x2 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
          ${metric('BoC Rate', snap.boc_rate, 'Next ' + (snap.boc_next_meeting || ''))}
          ${metric('XEQT Close', snap.xeqt_close, snap.xeqt_change)}
          ${metric('NL Avg Home', snap.nl_avg_home, snap.nl_avg_home_period)}
          ${metric('Inflation', snap.cpi, snap.cpi_period)}
        </div>

        ${(mort.fixed_5yr || mort.variable) ? `<div style="background:var(--bg);padding:12px;border-radius:8px;margin-bottom:14px;">
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Mortgage rates today</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div><div style="font-size:18px;font-weight:700;">${Briefing._esc(mort.fixed_5yr || '—')}</div><div style="font-size:11px;color:var(--text2);">5-yr fixed</div></div>
            <div><div style="font-size:18px;font-weight:700;">${Briefing._esc(mort.variable || '—')}</div><div style="font-size:11px;color:var(--text2);">Variable</div></div>
            <div><div style="font-size:18px;font-weight:700;">${Briefing._esc(mort.monthly_pmt_400k || '—')}</div><div style="font-size:11px;color:var(--text2);">$400K monthly pmt</div></div>
            <div><div style="font-size:18px;font-weight:700;">${Briefing._esc(mort.boc_overnight || snap.boc_rate || '—')}</div><div style="font-size:11px;color:var(--text2);">BoC overnight</div></div>
          </div>
        </div>` : ''}

        <!-- Stories -->
        ${stories.length ? `<div style="margin-bottom:14px;">
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Three stories that affect you</div>
          ${stories.map(story).join('')}
        </div>` : ''}

        <!-- One move -->
        ${oneMove.title ? `<div style="background:var(--accent);color:#fff;padding:14px;border-radius:8px;margin-bottom:14px;">
          <div style="font-size:10px;opacity:0.75;text-transform:uppercase;letter-spacing:0.12em;">One move this week</div>
          <div style="font-weight:600;font-size:15px;margin:6px 0 6px;">${Briefing._esc(oneMove.title)}</div>
          <div style="font-size:13px;line-height:1.5;opacity:0.92;">${Briefing._esc(oneMove.explanation || '')}</div>
        </div>` : ''}

        <!-- Watch list -->
        ${watch.length ? `<div style="background:var(--bg);padding:12px;border-radius:8px;margin-bottom:14px;">
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Coming up</div>
          ${watch.map(w => `<div style="display:flex;gap:10px;padding:6px 0;font-size:13px;">
            <div style="min-width:64px;font-weight:600;color:var(--accent);">${Briefing._esc(w.date || '—')}</div>
            <div style="flex:1;color:var(--text2);"><strong style="color:var(--text1);">${Briefing._esc(w.event || '')}</strong> — ${Briefing._esc(w.matters_because || '')}</div>
          </div>`).join('')}
        </div>` : ''}

        <!-- Sources -->
        ${sources.length ? `<div style="margin-bottom:10px;">
          <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Sources</div>
          ${sources.map(s => `<a href="${Briefing._esc(s.url)}" target="_blank" rel="noopener" style="display:block;font-size:13px;color:var(--accent);text-decoration:none;padding:3px 0;">${Briefing._esc(s.label)}</a>`).join('')}
        </div>` : ''}

        ${audit ? `<div style="font-size:11px;color:var(--text2);font-style:italic;line-height:1.5;margin-top:14px;padding-top:14px;border-top:1px solid var(--bg);">${Briefing._esc(audit)}</div>` : ''}
      </div>
    `;
  },

  // ─── Render the archive list ───────────────────────────────────────────────
  _renderArchive(archive) {
    if (!archive || !archive.length) return '';
    return `
      <div class="card" style="padding:14px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:14px;font-weight:600;">📚 Archive</div>
          <div style="font-size:11px;color:var(--text2);">${archive.length} day${archive.length === 1 ? '' : 's'}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${archive.map(b => `
            <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border-radius:6px;cursor:pointer;" onclick="Briefing.openArchive('${Briefing._esc(b.date)}')">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;">${Briefing._esc(Briefing._shortDate(b.date))}</div>
                <div style="font-size:11px;color:var(--text2);">${Briefing._esc((b.snapshot && b.snapshot.boc_rate) || '')} ${b.snapshot && b.snapshot.xeqt_close ? '· ' + Briefing._esc(b.snapshot.xeqt_close) : ''}</div>
              </div>
              ${b.mp3_url ? '<div style="font-size:16px;color:var(--accent);">▶</div>' : '<div style="font-size:11px;color:var(--text2);">no audio</div>'}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  // ─── Open one archived day ─────────────────────────────────────────────────
  async openArchive(date) {
    const container = document.getElementById('briefing-container');
    if (!container) return;
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2);">Loading ${Briefing._esc(date)}…</div>`;
    try {
      const { data } = await db.from('briefings').select('*').eq('date', date).maybeSingle();
      if (!data) {
        container.innerHTML = `<div class="card" style="padding:20px;text-align:center;">No briefing found for ${Briefing._esc(date)}.<br><button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="Briefing.load()">Back</button></div>`;
        return;
      }
      const main = document.getElementById('main-content');
      if (main) main.scrollTop = 0;
      container.innerHTML = Briefing._renderBrief(data, false);
    } catch (err) {
      container.innerHTML = `<div class="card" style="padding:20px;text-align:center;color:var(--red);">Error: ${Briefing._esc(err.message || String(err))}<br><button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="Briefing.load()">Back</button></div>`;
    }
  },
};
