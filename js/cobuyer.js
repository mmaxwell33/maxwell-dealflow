// Maxwell DealFlow CRM — Partner / co-buyer on a client
//
// A couple buying together is ONE client (the primary buyer) plus a partner
// stored as a client_contacts row with role 'co_buyer' (one per client, same
// table and upsert key as the lawyer / broker contacts). No migration needed.
//
// It is filled from three places: the intake form ("buying with a partner?"),
// the signed APS reader on New Builds, and Edit Client. The lawyer email reads
// it so the file names both purchasers and copies both of them.

const CoBuyer = {
  async get(clientId) {
    if (!clientId) return null;
    try {
      const { data } = await db.from('client_contacts')
        .select('name, email, phone').eq('client_id', clientId).eq('role', 'co_buyer').maybeSingle();
      return (data && (data.name || data.email)) ? data : null;
    } catch (e) { console.warn('[CoBuyer] read skipped:', e?.message || e); return null; }
  },

  // Never throws: a partner that fails to save must not undo the client or build.
  async save(clientId, p) {
    const name = (p?.name || '').trim(), email = (p?.email || '').trim(), phone = (p?.phone || '').trim();
    if (!clientId || (!name && !email)) return false;
    const { error } = await db.from('client_contacts').upsert({
      client_id: clientId, agent_id: currentAgent.id, role: 'co_buyer',
      name: name || null, email: email || null, phone: phone || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'client_id,role' });
    if (error) { console.warn('[CoBuyer] save failed:', error.message); return false; }
    return true;
  },

  // Copy of the template's client object with the partner attached
  async attach(client, clientId) {
    const out = { ...(client || {}) };
    const p = await CoBuyer.get(clientId || out.id);
    if (p) out.co_buyer = p;
    return out;
  },

  // Adds the partner's email to a CC list (comma separated), without duplicates
  cc(list, client) {
    const extra = client?.co_buyer?.email;
    const all = String(list || '').split(',').map(s => s.trim()).filter(Boolean);
    if (extra && !all.some(e => e.toLowerCase() === extra.toLowerCase())) all.push(extra);
    return all.length ? all.join(', ') : null;
  },
};
