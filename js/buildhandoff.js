// Maxwell DealFlow CRM — New build → accepted-deal handoff
//
// NewBuilds.syncPipeline only ever made a bare Pipeline row (name, address,
// price, closing), so a new build never went through the accepted-offer
// process. After a build is saved, this:
//   1. links that Pipeline row to the client (client_id, client_email) and
//      marks it a new build
//   2. fills the acceptance date and the financing / inspection deadlines
//      (both column pairs, see migration 063) when the deal has none yet,
//      so the condition reminders run like any other deal
//   3. attaches the signed APS as the deal's "accepted offer", so the lender
//      and lawyer receive it
//   4. once the vendor has accepted (a "Purchase Agreement Accepted / Signed"
//      date), opens the existing Mark Offer Accepted window for that deal,
//      unless its stakeholder emails were already queued once.
//
// Nothing is sent from here. Mark Offer Accepted queues into Approvals as usual.
// The buyers' congratulations comes from New Builds (with their selections), so
// submitAcceptedFlow skips its own client congrats on new-build deals.

const BuildHandoff = {
  async run(build, { file = null, conditions = null } = {}) {
    if (!build?.client_name || !currentAgent?.id) return null;
    try {
      // Same match as syncPipeline, preferring the new-build row when the client has several
      const { data: rows } = await db.from('pipeline').select('*')
        .eq('agent_id', currentAgent.id).eq('client_name', build.client_name)
        .order('created_at', { ascending: false });
      const deal = (rows || []).find(r => r.deal_type === 'new_build') || (rows || [])[0];
      if (!deal) return null;

      let clientEmail = deal.client_email || null;
      if (build.client_id && !clientEmail) {
        const { data: c } = await db.from('clients').select('email').eq('id', build.client_id).maybeSingle();
        clientEmail = c?.email || null;
      }
      const fin = conditions?.financing || null, ins = conditions?.inspection || null;
      const updates = {
        ...(build.client_id && !deal.client_id ? { client_id: build.client_id } : {}),
        ...(clientEmail && !deal.client_email ? { client_email: clientEmail } : {}),
        ...(!deal.deal_type ? { deal_type: 'new_build' } : {}),
        ...(build.pa_accepted_date && deal.acceptance_date !== build.pa_accepted_date ? { acceptance_date: build.pa_accepted_date } : {}),
        ...(fin && !deal.financing_date ? { financing_date: fin, financing_deadline: fin } : {}),
        ...(ins && !deal.inspection_date ? { inspection_date: ins, inspection_deadline: ins } : {}),
      };
      if (Object.keys(updates).length) {
        const { error } = await db.from('pipeline').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', deal.id);
        if (error) console.warn('[BuildHandoff] pipeline update:', error.message);
        else Object.assign(deal, updates);
      }

      if (file) await BuildHandoff.attachAps(deal.id, file);

      // Mark Offer Accepted reads the deal from Pipeline.all
      if (typeof Pipeline !== 'undefined') Pipeline.all = [deal, ...(Pipeline.all || []).filter(x => x.id !== deal.id)];

      if (build.pa_accepted_date && typeof Pipeline !== 'undefined' && Pipeline.markAcceptedFlow) {
        const { count } = await db.from('approval_queue').select('id', { count: 'exact', head: true })
          .eq('agent_id', currentAgent.id).eq('related_id', deal.id).ilike('approval_type', 'Offer accepted%');
        if (!count) {
          // Let the save toasts and the welcome email settle before the window opens
          setTimeout(() => {
            Pipeline.markAcceptedFlow(deal.id);
            App.toast('🤝 Vendor accepted. Send the lender, lawyer and inspector their emails.', 'var(--accent2)');
          }, 700);
        }
      }
      return deal.id;
    } catch (e) {
      console.warn('[BuildHandoff] skipped:', e?.message || e);
      App.toast('⚠️ Build saved, but the Pipeline deal could not be set up. Use Mark Offer Accepted on the Pipeline.', 'var(--yellow)');
      return null;
    }
  },

  // The signed APS becomes the deal's accepted offer (once). Same bucket, path
  // and visibility as a file uploaded in Mark Offer Accepted.
  async attachAps(dealId, file) {
    const { data: have } = await db.from('deal_documents').select('id')
      .eq('pipeline_id', dealId).eq('doc_type', 'accepted_offer').limit(1);
    if (have?.length) return;
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${currentAgent.id}/${dealId}/${Date.now()}-${safe}`;
    const { error: upErr } = await db.storage.from('deal-docs').upload(path, file, { contentType: 'application/pdf' });
    if (upErr) { console.warn('[BuildHandoff] APS upload:', upErr.message); return; }
    const { error } = await db.from('deal_documents').insert({
      pipeline_id: dealId, agent_id: currentAgent.id, doc_type: 'accepted_offer',
      file_path: path, file_name: file.name, file_size_bytes: file.size,
      visible_to_roles: Pipeline.DOC_VISIBILITY?.accepted_offer || ['client','mortgage_broker','lawyer','builder'],
    });
    if (error) console.warn('[BuildHandoff] deal_documents insert:', error.message);
  },
};
