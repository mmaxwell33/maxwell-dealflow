// js/dealroom.js
// Transaction Room storage: the parties list and the document ticks for a deal.
//
// These used to live only in this browser's localStorage (df-room-<id> and
// df-room-docs-<id>), so a party added on the phone never showed on the laptop
// and clearing the browser lost them. They now live in the deal_room table
// (migration 126), one row per deal, own rows only.
//
// Moving old data: the first time a Room is opened on a device that still has
// the old localStorage copy, it is merged into the database row (parties
// de-duplicated by name and email, ticks combined) and the local copy is
// removed once the save succeeds.
//
// Before migration 126 is run, or if the database is unreachable, the Room
// keeps working from localStorage exactly as before.
//
// Document ticks are stored by document NAME. The old copy stored them by
// position in the list, which silently pointed at the wrong document whenever
// the list changed.

const DealRoom = {
  _state: {},       // pipelineId -> { parties: [], docs_done: [names] }
  _legacyIdx: {},   // pipelineId -> old index-based ticks waiting for the doc list
  _dbOk: true,

  // ── Pure helpers (unit tested) ────────────────────────────────────────────
  partyKey(p) {
    return `${String(p?.name || '').trim().toLowerCase()}|${String(p?.email || '').trim().toLowerCase()}`;
  },

  mergeParties(a, b) {
    const out = [];
    const seen = new Set();
    for (const p of [...(a || []), ...(b || [])]) {
      if (!p || !String(p.name || '').trim()) continue;
      const k = DealRoom.partyKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: p.name, role: p.role || '', email: p.email || '', phone: p.phone || '' });
    }
    return out;
  },

  indexesToNames(indexes, docNames) {
    return [...new Set((indexes || [])
      .map(i => docNames[i])
      .filter(Boolean))];
  },

  namesToIndexes(names, docNames) {
    const set = new Set(names || []);
    return docNames.map((n, i) => (set.has(n) ? i : -1)).filter(i => i >= 0);
  },

  // ── Local copy (old storage, and the fallback) ────────────────────────────
  _readLocal(id) {
    try {
      return {
        parties: JSON.parse(localStorage.getItem(`df-room-${id}`) || 'null'),
        docIdx:  JSON.parse(localStorage.getItem(`df-room-docs-${id}`) || 'null'),
      };
    } catch (_) { return { parties: null, docIdx: null }; }
  },
  _writeLocal(id) {
    if (DealRoom._dbOk) return;
    try { localStorage.setItem(`df-room-${id}`, JSON.stringify(DealRoom._state[id]?.parties || [])); } catch (_) {}
  },
  _clearLocal(id) {
    try { localStorage.removeItem(`df-room-${id}`); localStorage.removeItem(`df-room-docs-${id}`); } catch (_) {}
  },

  // ── Load / save ───────────────────────────────────────────────────────────
  // defaults: the Agent and Buyer rows used when a deal has no parties yet.
  async load(id, defaults) {
    const local = DealRoom._readLocal(id);
    let row = null;
    try {
      const { data, error } = await db.from('deal_room')
        .select('parties, docs_done').eq('pipeline_id', id).maybeSingle();
      if (error) throw error;
      row = data;
      DealRoom._dbOk = true;
    } catch (e) {
      console.warn('[DealRoom] database not available, using this device only:', e?.message || e);
      DealRoom._dbOk = false;
    }

    const hadLocal = !!(local.parties?.length || local.docIdx?.length);
    const parties = DealRoom.mergeParties(row?.parties || [], local.parties || []);
    DealRoom._state[id] = {
      parties: parties.length ? parties : DealRoom.mergeParties(defaults, []),
      docs_done: Array.isArray(row?.docs_done) ? row.docs_done.slice() : [],
    };
    if (local.docIdx?.length) DealRoom._legacyIdx[id] = local.docIdx;

    // Save when there is something new to store: a first visit, or old local
    // data to move up. Ticks by position are moved when the doc list is known
    // (checkedIndexes), so the local copy is only cleared after that.
    if (DealRoom._dbOk && (!row || hadLocal)) {
      const ok = await DealRoom.save(id);
      if (ok && !local.docIdx?.length) DealRoom._clearLocal(id);
    }
    return DealRoom._state[id];
  },

  async save(id) {
    const s = DealRoom._state[id];
    if (!s) return false;
    if (!DealRoom._dbOk) { DealRoom._writeLocal(id); return false; }
    const { error } = await db.from('deal_room').upsert({
      pipeline_id: id,
      agent_id: currentAgent?.id,
      parties: s.parties,
      docs_done: s.docs_done,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'pipeline_id' });
    if (error) {
      console.error('[DealRoom] save failed:', error);
      App.toast(`⚠️ Room not saved: ${error.message}`, 'var(--red)');
      return false;
    }
    return true;
  },

  // ── Parties ───────────────────────────────────────────────────────────────
  parties(id) {
    return DealRoom._state[id]?.parties || DealRoom._readLocal(id).parties || [];
  },
  async addParty(id, p) {
    const s = DealRoom._state[id] || (DealRoom._state[id] = { parties: [], docs_done: [] });
    s.parties = DealRoom.mergeParties(s.parties, [p]);
    return DealRoom.save(id);
  },
  async removeParty(id, idx) {
    const s = DealRoom._state[id];
    if (!s) return false;
    s.parties.splice(idx, 1);
    return DealRoom.save(id);
  },

  // ── Document ticks ────────────────────────────────────────────────────────
  // Called by renderDocs with the full doc list. Returns ticked positions for
  // drawing, and finishes moving any old position-based ticks.
  checkedIndexes(id, allDocs) {
    const names = (allDocs || []).map(d => d.name);
    DealRoom._docNames = names;
    const s = DealRoom._state[id] || (DealRoom._state[id] = { parties: [], docs_done: [] });
    const legacy = DealRoom._legacyIdx[id];
    if (legacy) {
      delete DealRoom._legacyIdx[id];
      s.docs_done = [...new Set([...s.docs_done, ...DealRoom.indexesToNames(legacy, names)])];
      // Offline, the local copy stays as it is (still by position) until the
      // database is reachable; it is never cleared without a successful save.
      if (DealRoom._dbOk) DealRoom.save(id).then(ok => { if (ok) DealRoom._clearLocal(id); });
    }
    return DealRoom.namesToIndexes(s.docs_done, names);
  },
  toggleDoc(id, idx) {
    const name = (DealRoom._docNames || [])[idx];
    if (!name) return;
    const s = DealRoom._state[id] || (DealRoom._state[id] = { parties: [], docs_done: [] });
    const at = s.docs_done.indexOf(name);
    if (at === -1) s.docs_done.push(name); else s.docs_done.splice(at, 1);
    if (!DealRoom._dbOk) {
      try { localStorage.setItem(`df-room-docs-${id}`, JSON.stringify(DealRoom.namesToIndexes(s.docs_done, DealRoom._docNames))); } catch (_) {}
      return;
    }
    DealRoom.save(id);
  },
};

if (typeof window !== 'undefined') window.DealRoom = DealRoom;
