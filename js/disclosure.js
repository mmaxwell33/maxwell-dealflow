// Maxwell DealFlow CRM — Dual-Representation Disclosure Module (seller-side feature)
//
// Signatures themselves are handled OUTSIDE DealFlow (Authentisign, board e-sign,
// or paper). DealFlow's job is to:
//   1. Detect when a deal involves both a buyer-client AND seller-client that
//      belong to Maxwell (dual representation under TRESA / NL Real Estate Trading Act).
//   2. Create two disclosure rows — one per client — to track signature status.
//   3. Provide a UI banner that the agent confirms once both clients have signed
//      in their external system. Optionally archive the signed PDF in Supabase Storage.
//   4. Gate the pipeline from advancing past "Offer Received" until both confirmed.
//
// This module is the data layer + banner helper. UI integration into the deal
// detail view is a surgical follow-up that hooks Disclosure.bannerHtml() into
// the existing Pipeline.renderDetail() render path.

const Disclosure = {

  // ── DETECTION ─────────────────────────────────────────────────────────────
  // Returns true if both clientIds belong to the current agent. This is the
  // signal that a dual-rep situation exists and disclosures are required.
  async detect(buyerClientId, sellerClientId) {
    if (!buyerClientId || !sellerClientId) return false;
    if (!currentAgent?.id) return false;
    if (buyerClientId === sellerClientId) return false;  // same person — not dual rep
    const { data, error } = await db.from('clients')
      .select('id, client_type')
      .eq('agent_id', currentAgent.id)
      .in('id', [buyerClientId, sellerClientId]);
    if (error || !data) return false;
    // Both client rows must come back — meaning both are Maxwell's clients.
    return data.length === 2;
  },

  // ── CREATE TWO DISCLOSURE ROWS FOR A TRANSACTION ──────────────────────────
  // Call once when a dual-rep transaction is opened (after detect() returns true).
  // Returns the inserted disclosure ids.
  async createForTransaction({ transactionId, buyPipelineId, sellPipelineId, buyerClientId, sellerClientId }) {
    if (!currentAgent?.id) return null;
    if (!transactionId)    return null;
    const rows = [
      {
        agent_id:        currentAgent.id,
        transaction_id:  transactionId,
        pipeline_id:     buyPipelineId  || null,
        client_id:       buyerClientId  || null,
        client_role:     'buyer',
        status:          'pending'
      },
      {
        agent_id:        currentAgent.id,
        transaction_id:  transactionId,
        pipeline_id:     sellPipelineId || null,
        client_id:       sellerClientId || null,
        client_role:     'seller',
        status:          'pending'
      }
    ];
    const { data, error } = await db.from('disclosures').insert(rows).select('id, client_role');
    if (error) {
      console.error('Disclosure.createForTransaction error:', error);
      if (window.App?.toast) App.toast(`⚠️ ${error.message}`, 'var(--red)');
      return null;
    }
    // Stamp the pipeline rows with the transaction_id so they're linked.
    const pipelineIds = [buyPipelineId, sellPipelineId].filter(Boolean);
    if (pipelineIds.length) {
      await db.from('pipeline').update({ transaction_id: transactionId }).in('id', pipelineIds);
    }
    if (window.App?.logActivity) {
      App.logActivity('DUAL_REP_DETECTED', '', '', `Dual representation flagged for transaction ${transactionId}`);
    }
    return data;
  },

  // ── LIST DISCLOSURES FOR A TRANSACTION ────────────────────────────────────
  async listForTransaction(transactionId) {
    if (!transactionId) return [];
    const { data, error } = await db.from('disclosures')
      .select('*')
      .eq('agent_id', currentAgent.id)
      .eq('transaction_id', transactionId)
      .order('client_role', { ascending: true });
    if (error) return [];
    return data || [];
  },

  // ── CONFIRM A DISCLOSURE (signed externally) ──────────────────────────────
  // Maxwell flips a disclosure to 'confirmed' once the client has signed in the
  // external system. Optional `signedFile` archives the PDF in Supabase Storage.
  async confirm(disclosureId, signedFile = null, notes = null) {
    if (!disclosureId || !currentAgent?.id) return false;
    let signedPath = null;

    if (signedFile) {
      const ext  = (signedFile.name || 'signed.pdf').split('.').pop();
      const path = `${currentAgent.id}/${disclosureId}-${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from('disclosures').upload(path, signedFile, {
        cacheControl: '3600',
        upsert: false
      });
      if (upErr) {
        console.error('Disclosure.confirm upload error:', upErr);
        if (window.App?.toast) App.toast(`⚠️ Upload failed: ${upErr.message}`, 'var(--red)');
        return false;
      }
      signedPath = path;
    }

    const updateRow = {
      status:        'confirmed',
      confirmed_at:  new Date().toISOString(),
      confirmed_by:  currentAgent.id,
      notes:         notes || null
    };
    if (signedPath) updateRow.signed_pdf_path = signedPath;

    const { error } = await db.from('disclosures').update(updateRow).eq('id', disclosureId);
    if (error) {
      console.error('Disclosure.confirm error:', error);
      if (window.App?.toast) App.toast(`⚠️ ${error.message}`, 'var(--red)');
      return false;
    }
    if (window.App?.logActivity) {
      App.logActivity('DISCLOSURE_CONFIRMED', '', '', `Disclosure ${disclosureId} confirmed (signed externally)`);
    }
    return true;
  },

  // ── CAN THE PIPELINE ADVANCE? ─────────────────────────────────────────────
  // Returns true if all disclosures for a transaction are confirmed (or waived).
  // Pipeline UI should call this before allowing a stage change past
  // "Offer Received" on a row with a transaction_id.
  async canAdvance(transactionId) {
    if (!transactionId) return true;  // single rep — always free to advance
    const rows = await Disclosure.listForTransaction(transactionId);
    if (!rows.length) return true;    // no disclosures recorded — nothing blocking
    return rows.every(r => r.status === 'confirmed' || r.status === 'waived');
  },

  // ── BANNER HTML — drop-in for the deal detail view ────────────────────────
  // Returns an HTML string (no DOM mutation) suitable for innerHTML insertion
  // at the top of a deal detail view. Empty string if no transaction is set.
  // Caller is responsible for placing it in the layout.
  async bannerHtml(pipelineRow) {
    if (!pipelineRow?.transaction_id) return '';
    const rows = await Disclosure.listForTransaction(pipelineRow.transaction_id);
    if (!rows.length) return '';
    const buyer  = rows.find(r => r.client_role === 'buyer');
    const seller = rows.find(r => r.client_role === 'seller');
    const allDone = rows.every(r => r.status === 'confirmed' || r.status === 'waived');

    const tick = (s) => s === 'confirmed' ? '✅' : (s === 'waived' ? '➖' : '⏳');
    const lbl  = (s) => s === 'confirmed' ? 'Signed' : (s === 'waived' ? 'Waived' : 'Pending');

    return `
      <div style="margin-bottom:14px;padding:16px 18px;border-radius:12px;
                  background:${allDone ? 'rgba(16,185,129,.08)' : 'rgba(245,158,11,.10)'};
                  border:1px solid ${allDone ? 'rgba(16,185,129,.30)' : 'rgba(245,158,11,.35)'};">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:22px;">${allDone ? '✅' : '⚠️'}</span>
          <strong style="color:var(--text1);font-size:15px;">
            ${allDone ? 'Disclosures complete' : 'Dual Representation — Disclosures Required'}
          </strong>
        </div>
        <div style="font-size:13px;color:var(--text2);line-height:1.6;">
          You represent both sides of this deal. Confirm that each client has signed
          the dual-representation disclosure in your external signing system before
          the deal can advance past "Offer Received".
        </div>
        <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;">
            <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Buyer-side</div>
            <div style="margin-top:4px;font-size:14px;color:var(--text1);">${tick(buyer?.status||'pending')} ${lbl(buyer?.status||'pending')}</div>
            ${buyer && buyer.status === 'pending' ? `<button onclick="Disclosure.uiConfirm('${buyer.id}','buyer')" style="margin-top:8px;padding:6px 12px;border:none;background:var(--accent);color:#fff;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Confirm signed</button>` : ''}
          </div>
          <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;">
            <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Seller-side</div>
            <div style="margin-top:4px;font-size:14px;color:var(--text1);">${tick(seller?.status||'pending')} ${lbl(seller?.status||'pending')}</div>
            ${seller && seller.status === 'pending' ? `<button onclick="Disclosure.uiConfirm('${seller.id}','seller')" style="margin-top:8px;padding:6px 12px;border:none;background:var(--accent);color:#fff;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Confirm signed</button>` : ''}
          </div>
        </div>
      </div>
    `;
  },

  // ── UI confirmation handler (called from banner button onclick) ──────────
  async uiConfirm(disclosureId, role) {
    // Lightweight modal: ask if Maxwell wants to attach the signed PDF.
    const wantsUpload = confirm(
      `Confirm the ${role} has signed the dual-representation disclosure in your external system?\n\n` +
      `OK = Confirm + optionally upload a signed copy for your records\n` +
      `Cancel = Don't confirm yet`
    );
    if (!wantsUpload) return;

    // Hidden file picker for optional PDF archive
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,image/*';
    input.onchange = async (e) => {
      const f = e.target.files?.[0] || null;
      const ok = await Disclosure.confirm(disclosureId, f);
      if (ok) {
        if (window.App?.toast) App.toast(`✅ ${role} disclosure confirmed`, 'var(--green)');
        // Refresh the deal detail view if Pipeline.renderDetail is loaded
        if (typeof Pipeline !== 'undefined' && typeof Pipeline.refreshOpenDetail === 'function') {
          Pipeline.refreshOpenDetail();
        } else if (typeof Pipeline !== 'undefined' && typeof Pipeline.load === 'function') {
          Pipeline.load();
        }
      }
    };
    // Give the user the option to skip the file upload
    const skip = confirm('Attach a signed PDF / image for your records?\n\nOK = pick a file\nCancel = confirm without attachment');
    if (skip) {
      input.click();
    } else {
      const ok = await Disclosure.confirm(disclosureId, null);
      if (ok && window.App?.toast) App.toast(`✅ ${role} disclosure confirmed`, 'var(--green)');
      if (ok && typeof Pipeline !== 'undefined' && typeof Pipeline.load === 'function') {
        Pipeline.load();
      }
    }
  }
};

// Expose globally so inline onclick handlers in bannerHtml() can call it
window.Disclosure = Disclosure;
