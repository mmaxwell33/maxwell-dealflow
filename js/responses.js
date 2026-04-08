// Maxwell DealFlow CRM — Client Responses Module
// Displays and manages client decisions from the interactive response page (respond.html)
// Responses come in after agent records "interested" feedback and client clicks the email link

const Responses = {
  all: [],

  async load() {
    const agentId = currentAgent?.id;
    if (!agentId) return;

    const { data, error } = await db.from('client_responses')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Responses load error:', error);
      document.getElementById('responses-list').innerHTML = '<div class="empty-state">Could not load responses</div>';
      return;
    }

    Responses.all = data || [];
    Responses.render();
    Responses.updateBadge();
  },

  render() {
    const container = document.getElementById('responses-list');
    if (!container) return;

    if (Responses.all.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="text-align:center;padding:40px 20px;">
          <div style="font-size:40px;margin-bottom:12px;">💬</div>
          <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">No Client Responses Yet</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.5;">When a client responds to a viewing follow-up email, their decision will appear here.</div>
        </div>`;
      return;
    }

    // Group: new first, then reviewed, then actioned
    const grouped = {
      new: Responses.all.filter(r => r.status === 'new'),
      reviewed: Responses.all.filter(r => r.status === 'reviewed'),
      actioned: Responses.all.filter(r => r.status === 'actioned')
    };

    let html = '';

    // New responses section
    if (grouped.new.length > 0) {
      html += `<div style="font-size:12px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding-top:8px;">New (${grouped.new.length})</div>`;
      grouped.new.forEach(r => { html += Responses._card(r, true); });
    }

    // Reviewed section
    if (grouped.reviewed.length > 0) {
      html += `<div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin:16px 0 8px;">Reviewed (${grouped.reviewed.length})</div>`;
      grouped.reviewed.forEach(r => { html += Responses._card(r, false); });
    }

    // Actioned section
    if (grouped.actioned.length > 0) {
      html += `<div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin:16px 0 8px;">Actioned (${grouped.actioned.length})</div>`;
      grouped.actioned.forEach(r => { html += Responses._card(r, false); });
    }

    container.innerHTML = html;
  },

  _card(r, isNew) {
    const typeConfig = {
      'make_offer': { icon: '🏠', label: 'Wants to Make an Offer', color: '#059669', bg: 'rgba(5,150,105,.1)' },
      'continue_searching': { icon: '🔍', label: 'Continue Searching', color: '#3b82f6', bg: 'rgba(59,130,246,.1)' },
      'pass': { icon: '➡️', label: 'Pass on Property', color: '#6b7280', bg: 'rgba(107,114,128,.1)' }
    };
    const cfg = typeConfig[r.response_type] || typeConfig['pass'];
    const clientName = r.client_name || '—';
    const date = r.created_at ? new Date(r.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const offerStr = r.offer_amount ? Number(r.offer_amount).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }) : '';
    const listStr = r.list_price ? Number(r.list_price).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }) : '';
    const border = isNew ? `border-left:4px solid ${cfg.color};` : '';
    const newDot = isNew ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;margin-right:6px;"></span>` : '';

    return `
      <div class="card" style="margin-bottom:10px;padding:14px;cursor:pointer;${border}" onclick="Responses.openDetail('${r.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${newDot}
            <span style="font-size:20px;">${cfg.icon}</span>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--text);">${App.esc(r.property_address || '—')}</div>
              <div style="font-size:12px;color:var(--text2);">Client ID: ${r.client_id?.slice(0,8) || '—'}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px;color:var(--text2);">${date}</div>
            <span style="display:inline-block;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:700;color:${cfg.color};background:${cfg.bg};margin-top:4px;">${cfg.label}</span>
          </div>
        </div>
        ${r.response_type === 'make_offer' && offerStr ? `
        <div style="display:flex;gap:8px;margin-top:8px;">
          <div style="flex:1;background:var(--bg);padding:8px 10px;border-radius:8px;">
            <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Offer Amount</div>
            <div style="font-size:15px;font-weight:800;color:#059669;">${offerStr}</div>
          </div>
          ${listStr ? `<div style="flex:1;background:var(--bg);padding:8px 10px;border-radius:8px;">
            <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">List Price</div>
            <div style="font-size:15px;font-weight:700;color:var(--text);">${listStr}</div>
          </div>` : ''}
        </div>` : ''}
        ${r.client_notes ? `<div style="background:var(--bg);padding:8px 10px;border-radius:8px;margin-top:8px;font-size:12px;color:var(--text2);"><span style="font-weight:700;">Notes:</span> ${App.esc(r.client_notes)}</div>` : ''}
      </div>`;
  },

  async openDetail(id) {
    const r = Responses.all.find(x => x.id === id);
    if (!r) return;

    // Get client name from clients table
    let clientName = '—';
    if (r.client_id) {
      const { data: client } = await db.from('clients').select('full_name').eq('id', r.client_id).single();
      if (client) clientName = client.full_name;
    }

    const typeConfig = {
      'make_offer': { icon: '🏠', label: 'Wants to Make an Offer', color: '#059669' },
      'continue_searching': { icon: '🔍', label: 'Continue Searching', color: '#3b82f6' },
      'pass': { icon: '➡️', label: 'Pass on Property', color: '#6b7280' }
    };
    const cfg = typeConfig[r.response_type] || typeConfig['pass'];
    const date = r.created_at ? new Date(r.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const offerStr = r.offer_amount ? Number(r.offer_amount).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }) : '';
    const listStr = r.list_price ? Number(r.list_price).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }) : '';
    const statusLabels = { 'new': 'New', 'reviewed': 'Reviewed', 'actioned': 'Actioned' };

    // Mark as reviewed if new — log activity and update client notes
    if (r.status === 'new') {
      await db.from('client_responses').update({ status: 'reviewed', updated_at: new Date().toISOString() }).eq('id', id);
      r.status = 'reviewed';
      Responses.updateBadge();

      // Log activity
      const actDesc = r.response_type === 'make_offer'
        ? `Client response: Wants to offer ${offerStr} on ${r.property_address}`
        : r.response_type === 'continue_searching'
        ? `Client response: Continue searching (${r.property_address})`
        : `Client response: Passed on ${r.property_address}`;
      App.logActivity('CLIENT_RESPONSE', clientName, null, actDesc, r.client_id);

      // Append note to client record
      if (r.client_id) {
        const { data: clientRec } = await db.from('clients').select('notes').eq('id', r.client_id).single();
        const timestamp = new Date().toLocaleDateString('en-CA');
        const notePrefix = clientRec?.notes ? clientRec.notes + '\n' : '';
        const newNote = r.response_type === 'make_offer'
          ? `[${timestamp}] Post-viewing response: Wants to offer ${offerStr} on ${r.property_address}${r.client_notes ? ' - Notes: ' + r.client_notes : ''}`
          : r.response_type === 'continue_searching'
          ? `[${timestamp}] Post-viewing response: Continue searching after viewing ${r.property_address}${r.client_notes ? ' - Notes: ' + r.client_notes : ''}`
          : `[${timestamp}] Post-viewing response: Passed on ${r.property_address}${r.client_notes ? ' - Notes: ' + r.client_notes : ''}`;
        await db.from('clients').update({ notes: notePrefix + newNote, updated_at: new Date().toISOString() }).eq('id', r.client_id);
      }
    }

    App.openModal(`
      <div class="fw-800" style="font-size:16px;margin-bottom:2px;">${App.esc(r.property_address || '—')}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:14px;">Client: ${App.esc(clientName)} | ${date}</div>

      <div style="background:var(--bg);border-radius:10px;padding:14px;margin-bottom:12px;text-align:center;">
        <span style="font-size:28px;">${cfg.icon}</span>
        <div style="font-size:15px;font-weight:700;color:${cfg.color};margin-top:4px;">${cfg.label}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px;">Status: ${statusLabels[r.status] || r.status}</div>
      </div>

      ${r.response_type === 'make_offer' ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:var(--bg);padding:10px;border-radius:8px;">
          <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">Offer Amount</div>
          <div style="font-size:18px;font-weight:800;color:#059669;">${offerStr || '—'}</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:8px;">
          <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;">List Price</div>
          <div style="font-size:18px;font-weight:700;color:var(--text);">${listStr || '—'}</div>
        </div>
      </div>` : ''}

      ${r.client_notes ? `
      <div style="background:var(--bg);border-radius:8px;padding:12px;margin-bottom:12px;">
        <div style="font-size:10px;font-weight:700;color:var(--text2);text-transform:uppercase;margin-bottom:4px;">Client Notes</div>
        <div style="font-size:13px;color:var(--text);line-height:1.5;">${App.esc(r.client_notes)}</div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
        ${r.response_type === 'make_offer' ? `
        <button class="btn btn-green" onclick="App.closeModal();setTimeout(()=>Offers.openAddForClient('${r.client_id}','${App.esc(clientName)}'),300)">📄 Prepare Offer</button>
        ` : ''}
        ${r.status !== 'actioned' ? `
        <button class="btn btn-primary" onclick="Responses.markActioned('${r.id}')">Mark as Actioned</button>
        ` : ''}
        <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
      </div>
    `);
  },

  async markActioned(id) {
    await db.from('client_responses').update({ status: 'actioned', updated_at: new Date().toISOString() }).eq('id', id);
    App.toast('Response marked as actioned');
    App.closeModal();
    await Responses.load();
  },

  async updateBadge() {
    // If data is loaded, use local count; otherwise do a quick DB count
    let newCount = 0;
    if (Responses.all.length > 0) {
      newCount = Responses.all.filter(r => r.status === 'new').length;
    } else {
      const agentId = currentAgent?.id;
      if (agentId) {
        const { count } = await db.from('client_responses')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agentId)
          .eq('status', 'new');
        newCount = count || 0;
      }
    }
    const badge = document.getElementById('responses-badge');
    if (badge) {
      badge.textContent = newCount || 0;
      badge.style.display = newCount > 0 ? 'inline-flex' : 'none';
    }
  }
};
