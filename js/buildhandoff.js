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
  // ── Offer first, like Submit Offer ─────────────────────────────────────────
  // A signed APS the builder has not accepted is an OFFER, not a deal: it goes
  // in Offers → Submitted (property_type 'new_build') and the build is held as
  // status 'Offer Submitted' (hidden from the New Builds list, no Pipeline row,
  // no commission). Tapping Accepted on the offer runs the normal accepted
  // window (Pipeline.askAcceptanceDetails → createFromOfferWithDates), which
  // creates the deal + commission and then calls onOfferAccepted below.
  async submitOffer(build, conditions = null) {
    const fmt = d => (d && App.fmtDate) ? App.fmtDate(d) : d;
    const cond = [conditions?.financing ? `Financing by ${fmt(conditions.financing)}` : '',
                  conditions?.inspection ? `Inspection by ${fmt(conditions.inspection)}` : ''].filter(Boolean).join(', ');
    const { data, error } = await db.from('offers').insert({
      offer_id: 'OFFER-' + Date.now(),
      agent_id: currentAgent.id,
      client_id: build.client_id || null,
      property_address: build.lot_address || 'New build',
      mls_number: build.mls_number || null,
      offer_amount: build.purchase_price || 0,
      offer_date: build.pa_submitted_date || new Date().toISOString().slice(0, 10),
      status: 'Submitted',
      property_type: 'new_build',
      conditions: cond,
      agent_notes: `New build with ${build.builder_name || 'the builder'}. Signed APS uploaded; build tracker waits in New Builds until accepted.`,
      followup_notified: false,
    }).select().single();
    if (error) {
      console.warn('[BuildHandoff] offer insert failed:', error.message);
      App.toast('⚠️ Build saved, but the offer was not added to Offers: ' + error.message, 'var(--yellow)');
      return null;
    }
    await App.logActivity('OFFER_SUBMITTED', build.client_name, null,
      `New build offer submitted: ${App.fmtMoney(build.purchase_price || 0)} on ${build.lot_address || ''}`, build.client_id || null);
    if (typeof Offers !== 'undefined') Offers.all = [data, ...(Offers.all || [])];
    return data;
  },

  // The submitted new-build offer for a build (newest), if any
  async offerFor(build) {
    if (!build?.client_id) return null;
    const { data } = await db.from('offers').select('*')
      .eq('agent_id', currentAgent.id).eq('client_id', build.client_id)
      .eq('property_type', 'new_build').eq('status', 'Submitted')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data || null;
  },

  // Same as Offers.sellerAccepted, but loads the client itself (a client just
  // added from the APS is not in Clients.all yet).
  async accept(offer) {
    if (!offer) { App.toast('⚠️ No submitted offer found for this build. Accept it from Offers.', 'var(--yellow)'); return; }
    let client = (typeof Clients !== 'undefined' ? (Clients.all || []).find(c => c.id === offer.client_id) : null);
    if (!client && offer.client_id) {
      const { data } = await db.from('clients').select('*').eq('id', offer.client_id).maybeSingle();
      client = data || null;
    }
    await db.from('offers').update({ status: 'Accepted', updated_at: new Date().toISOString() }).eq('id', offer.id);
    if (offer.client_id) await db.from('clients').update({ stage: 'Accepted' }).eq('id', offer.client_id);
    offer.status = 'Accepted';
    Pipeline.askAcceptanceDetails(offer, client);
  },

  // Called by createFromOfferWithDates once the accepted deal + commission
  // exist. The build goes live in New Builds, the signed APS becomes the deal's
  // accepted offer (so the lawyer and lender get it), and the buyers get the
  // congratulations with their selections. Returns true when that
  // congratulations was queued, so the generic "Offer Accepted" email is skipped.
  async onOfferAccepted({ buildId, pipelineId, clientId, acceptDate, closeDate }) {
    if (!buildId) return false;
    try {
      const { data: b } = await db.from('new_builds').select('*').eq('id', buildId).maybeSingle();
      if (!b) return false;
      await db.from('new_builds').update({
        status: 'Active',
        pa_accepted_date: b.pa_accepted_date || acceptDate || new Date().toISOString().slice(0, 10),
        ...(closeDate ? { est_completion_date: closeDate } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', buildId);

      // Signed APS from the client folder → deal documents, once
      if (pipelineId && clientId) {
        const { data: doc } = await db.from('client_documents').select('file_path, file_name')
          .eq('client_id', clientId).eq('category', 'aps').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (doc?.file_path) {
          const { data: blob } = await db.storage.from('client-docs').download(doc.file_path);
          if (blob) await BuildHandoff.attachAps(pipelineId, new File([blob], doc.file_name || 'Signed APS.pdf', { type: 'application/pdf' }));
        }
      }

      if (typeof BuildSelections !== 'undefined') return await BuildSelections.queueWelcome(buildId);
    } catch (e) { console.warn('[BuildHandoff] onOfferAccepted:', e?.message || e); }
    return false;
  },

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
    // auth.uid() folder, same as confirmAcceptance, so the storage policy passes
    const folder = (await App.getAuthUser())?.id || currentAgent.id;
    const path = `${folder}/${dealId}/${Date.now()}-${safe}`;
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
