// Maxwell DealFlow CRM — Pending Offers Module
// Handles the "Clients Ready to Offer" dashboard section
// Populated when a client responds via respond.html OR agent manually records via viewings.js

const PendingOffers = {

  async load() {
    if (!currentAgent?.id) return;
    const { data } = await db.from('pending_offers')
      .select('*')
      .eq('agent_id', currentAgent.id)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false });

    const section = document.getElementById('pending-offers-section');
    const list = document.getElementById('pending-offers-list');
    if (!section || !list) return;

    if (!data?.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    list.innerHTML = data.map(o => `
      <div class="card" style="margin-bottom:10px;border-left:4px solid var(--green);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div class="fw-700" style="font-size:14px;">${o.client_name || '—'}</div>
          <span style="font-size:11px;font-weight:700;color:var(--green);">READY TO OFFER</span>
        </div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:4px;">🏠 ${o.property_address || '—'}</div>
        ${o.mls_number ? `<div style="font-size:12px;color:var(--text2);">MLS# ${App.esc(o.mls_number)}</div>` : ''}
        ${o.list_price ? `<div style="font-size:12px;color:var(--text2);">List Price: ${App.fmtMoney(o.list_price)}</div>` : ''}
        <div style="font-size:16px;font-weight:800;color:var(--green);margin:8px 0;">
          💰 Offer: ${App.fmtMoney(o.offer_amount)}
        </div>
        ${o.client_note ? `
          <div style="background:var(--bg2);border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:8px;">
            <span style="font-weight:700;color:var(--text2);">Client's Note:</span> ${App.esc(o.client_note)}
          </div>` : ''}
        <div style="font-size:11px;color:var(--text2);margin-bottom:10px;">Received: ${App.fmtDate(o.created_at)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
          <button class="btn btn-sm" style="background:var(--green);color:#fff;" onclick="PendingOffers.prepareOffer('${o.id}','${o.client_id}','${App.esc(o.client_name)}')">📝 Prepare Offer</button>
          <button class="btn btn-sm btn-outline" style="border-color:var(--red);color:var(--red);" onclick="PendingOffers.dismiss('${o.id}','rejected')">❌ Reject</button>
          <button class="btn btn-sm btn-outline" onclick="PendingOffers.dismiss('${o.id}','passed')">⏭️ Pass</button>
        </div>
      </div>
    `).join('');

    // Push notify agent if there are pending offers
    if (data.length > 0) {
      App.pushNotify(
        `🏠 ${data.length} Client${data.length > 1 ? 's' : ''} Ready to Offer`,
        `${data[0].client_name} — ${data[0].property_address} — ${App.fmtMoney(data[0].offer_amount)}`,
        'overview'
      );
    }
  },

  async loadAll() {
    await PendingOffers.load();
  },

  async prepareOffer(pendingId, clientId, clientName) {
    // Mark as in-progress
    await db.from('pending_offers').update({ status: 'Preparing', updated_at: new Date().toISOString() }).eq('id', pendingId);
    App.closeModal();
    App.toast('📝 Opening offer form...');
    // Open the offers form pre-filled with client
    if (typeof Offers !== 'undefined') {
      setTimeout(() => Offers.openAddForClient(clientId, clientName), 300);
    }
    // Refresh dashboard
    await PendingOffers.load();
  },

  async dismiss(pendingId, reason) {
    const label = reason === 'rejected' ? 'reject' : 'pass on';
    if (!confirm(`Are you sure you want to ${label} this offer interest?`)) return;
    await db.from('pending_offers').update({ status: reason === 'rejected' ? 'Rejected' : 'Passed', updated_at: new Date().toISOString() }).eq('id', pendingId);
    App.toast(reason === 'rejected' ? '❌ Offer interest rejected' : '⏭️ Passed on offer interest');
    await PendingOffers.load();
  }
};
