// ─────────────────────────────────────────────────────────────────────────────
// Reviews — post-close client review collection
// Flow:
//   1. Pipeline closed-deal card → "📝 Request Review" button
//      → calls Reviews.request(dealId)
//      → creates a row in client_reviews with a token
//      → queues a review_request email through the existing Notify pipeline
//   2. Client clicks link in email → opens review.html?t=<token>
//      → fills 5 multi-choice questions + optional comments
//      → previews → submits (anon update via token)
//   3. Submission triggers a push notification to Maxwell
//   4. Maxwell sees all reviews in the Reviews screen (sidebar link)
// ─────────────────────────────────────────────────────────────────────────────

const Reviews = {
  all: [],

  // ─── Helpers ───────────────────────────────────────────────────────────────
  // Generate a fresh single-use token for one review row
  _newToken() {
    return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g,'').slice(0,32);
  },

  // Prompt the agent for additional CC people (e.g. spouse). Two simple
  // sequential prompts per person — name first, then email. Loops until the
  // agent leaves the name blank. Each CC gets their own row/token/private form.
  // Returns [{name, email}, ...] (possibly empty).
  _collectCC() {
    const out = [];
    while (true) {
      const label = out.length === 0
        ? 'Add a CC? Type their first name (or leave blank to skip).'
        : 'Add another CC? Type their first name (or leave blank to finish).';
      const name = (prompt(label, '') || '').trim();
      if (!name) break;

      const email = (prompt(`${name}'s email address:`, '') || '').trim();
      if (!email) { alert(`No email entered for ${name}. Skipping.`); continue; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert(`That doesn't look like a valid email. Skipping ${name}.`);
        continue;
      }
      out.push({ name, email });
    }
    return out;
  },

  // Send a review request from a closed deal
  async request(dealId) {
    if (!confirm('Send a review request email to this client?')) return;
    try {
      // Find the deal + client
      const deal = (Pipeline.all || []).find(d => d.id === dealId);
      if (!deal) { alert('Deal not found.'); return; }
      const { data: client } = await db.from('clients').select('*').eq('id', deal.client_id).single();
      // Fall back to the email stored on the deal row if the client record has none.
      const primaryEmail = client?.email || deal?.client_email;
      const primaryName  = client?.full_name || deal?.client_name || 'Client';
      if (!primaryEmail) { alert('Client has no email on file (checked both client record and deal).'); return; }

      // Build recipient list: primary client + optional CC (e.g., spouse).
      // Each recipient gets their own row, token, and private form.
      const recipients = [{ name: primaryName, email: primaryEmail }, ...Reviews._collectCC()];
      // One batch_id shared by all queued emails so a single approval ships them all.
      const batchId = recipients.length > 1 ? Reviews._newToken() : null;

      let queued = 0;
      for (const r of recipients) {
        const token = Reviews._newToken();
        const { error: insErr } = await db.from('client_reviews').insert({
          agent_id: currentAgent.id,
          client_id: client.id,
          pipeline_id: deal.id,
          token,
          property_address: deal.property_address || null,
          status: 'Pending'
        });
        if (insErr) { console.error(insErr); continue; }

        const tmpl = Reviews.template({ full_name: r.name, email: r.email }, deal, currentAgent, token);
        await Notify.queue(
          'Review Request 📝',
          client.id, r.name, r.email,
          tmpl.subject, tmpl.body, deal.id,
          null, null, null, null, batchId
        );
        queued++;
      }

      if (!queued) { alert('Could not create review request. See console.'); return; }
      alert(`✅ ${queued} review request${queued>1?'s':''} queued for approval.\n\n${batchId?'Approve any one — all '+queued+' send together.':'Approve from the Approvals screen to send.'}`);
    } catch (e) {
      console.error(e);
      alert('Error: ' + e.message);
    }
  },

  // Email template (kept here so it lives with the feature)
  template(client, deal, agent, token) {
    const firstName = client.full_name?.split(' ')[0] || 'there';
    const agentName = agent?.full_name || agent?.name || 'Maxwell Delali Midodzi';
    const agentPhone = agent?.phone || '(709) 325-0545';
    const agentEmail = agent?.email || 'Maxwell.Midodzi@exprealty.com';
    const link = `https://maxwell-dealflow.vercel.app/review.html?t=${token}`;
    const property = deal?.property_address ? ` at ${deal.property_address}` : '';
    return {
      subject: `How was your experience, ${firstName}? 🏡`,
      body: `Hi ${firstName},

Now that you're settled in${property}, I'd love to hear how I did as your Realtor®.

Your honest feedback helps me serve future clients better — and a kind review goes a long way for a Realtor®.

It only takes about 60 seconds. Just tap a few buttons:

   👉 ${link}

Thank you so much for trusting me with this milestone. It was a real privilege.

Warmly,

${agentName}
REALTOR® | eXp Realty
Phone: ${agentPhone} | Email: ${agentEmail}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com`
    };
  },

  // Load all reviews for the agent
  async load() {
    const wrap = document.getElementById('reviews-list');
    if (!wrap) return;
    wrap.innerHTML = '<div style="color:var(--text2);padding:20px;">Loading reviews...</div>';
    const { data, error } = await db.from('client_reviews')
      .select('*, clients(full_name)')
      .eq('agent_id', currentAgent.id)
      .order('created_at', { ascending: false });
    if (error) { wrap.innerHTML = '<div style="color:var(--red);padding:20px;">Error: ' + error.message + '</div>'; return; }
    Reviews.all = data || [];
    Reviews.render();
  },

  currentFilter: 'all',

  setFilter(key) {
    Reviews.currentFilter = key;
    Reviews.render();
  },

  render() {
    const wrap = document.getElementById('reviews-list');
    if (!wrap) return;
    const all = Reviews.all;
    if (!all.length) {
      wrap.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text2);">
        <div style="font-size:36px;margin-bottom:12px;">📝</div>
        <div style="font-size:15px;margin-bottom:6px;">No reviews yet</div>
        <div style="font-size:13px;">Send a check-in from a Client card or a Pipeline card.</div>
      </div>`;
      return;
    }

    const filter = Reviews.currentFilter || 'all';
    const list = filter === 'all' ? all : all.filter(r => (r.review_type || 'post_close') === filter);

    // Counts per type
    const counts = {
      all: all.length,
      search: all.filter(r => r.review_type === 'search').length,
      pre_closing: all.filter(r => r.review_type === 'pre_closing').length,
      post_close: all.filter(r => (r.review_type || 'post_close') === 'post_close').length,
      new_build_progress: all.filter(r => r.review_type === 'new_build_progress').length
    };

    const tab = (key, label) => `
      <button onclick="Reviews.setFilter('${key}')"
        style="padding:8px 14px;border:1px solid ${filter===key?'var(--accent)':'var(--border)'};background:${filter===key?'var(--accent)':'transparent'};color:${filter===key?'#fff':'var(--text2)'};border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
        ${label} <span style="opacity:.7;font-weight:400;">${counts[key]}</span>
      </button>`;

    // KPIs use the visible (filtered) list, except Avg Rating which only counts post-close
    const submitted = list.filter(r => r.status === 'Submitted');
    const pending = list.filter(r => r.status === 'Pending');
    const postCloseSubmitted = all.filter(r => (r.review_type || 'post_close') === 'post_close' && r.status === 'Submitted');
    const avgStars = postCloseSubmitted.length
      ? (postCloseSubmitted.reduce((s,r) => s + (r.overall_stars||0), 0) / postCloseSubmitted.length).toFixed(1)
      : '—';

    let html = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
        ${tab('all','All')}
        ${tab('search','🔎 Mid-search')}
        ${tab('pre_closing','📨 Pre-closing')}
        ${tab('post_close','⭐ Post-close')}
        ${tab('new_build_progress','🏗️ Build')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px;">
        <div class="card" style="padding:14px;"><div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;">Submitted</div><div style="font-size:24px;font-weight:700;color:var(--accent);margin-top:4px;">${submitted.length}</div></div>
        <div class="card" style="padding:14px;"><div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;">Pending</div><div style="font-size:24px;font-weight:700;color:var(--yellow);margin-top:4px;">${pending.length}</div></div>
        <div class="card" style="padding:14px;"><div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;">Avg Rating ★</div><div style="font-size:24px;font-weight:700;color:var(--green);margin-top:4px;">${avgStars}</div></div>
      </div>`;

    if (!list.length) {
      html += `<div style="text-align:center;padding:30px 20px;color:var(--text2);font-size:14px;">No reviews of this type yet.</div>`;
      wrap.innerHTML = html;
      return;
    }

    list.forEach(r => {
      const type = r.review_type || 'post_close';
      const typeLabel = type === 'search' ? '🔎 MID-SEARCH' : type === 'pre_closing' ? '📨 PRE-CLOSING' : type === 'new_build_progress' ? '🏗️ BUILD CHECK-IN' : '⭐ POST-CLOSE';
      const typeColor = type === 'search' ? 'var(--accent2)' : type === 'pre_closing' ? 'var(--yellow)' : type === 'new_build_progress' ? 'var(--accent)' : 'var(--green)';
      const name = r.clients?.full_name || '—';
      const date = r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : new Date(r.created_at).toLocaleDateString();
      const statusBadge = r.status === 'Submitted'
        ? `<span style="font-size:11px;color:var(--green);background:rgba(34,197,94,.12);padding:3px 8px;border-radius:6px;">Submitted</span>`
        : `<span style="font-size:11px;color:var(--yellow);background:rgba(245,158,11,.12);padding:3px 8px;border-radius:6px;">Pending</span>`;
      const deleteBtn = `<button class="btn btn-outline btn-sm" onclick="Reviews.deleteReview('${r.id}')" title="Delete this review" style="font-size:11px;padding:3px 8px;border-color:var(--red);color:var(--red);">🗑️ Delete</button>`;

      html += `
        <div class="card" style="padding:18px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:10px;">
            <div>
              <div style="font-size:10px;color:${typeColor};letter-spacing:.08em;font-weight:700;margin-bottom:4px;">${typeLabel}</div>
              <div style="font-size:15px;font-weight:600;color:var(--text1);">${name}</div>
              <div style="font-size:12px;color:var(--text2);margin-top:2px;">${r.property_address || ''} · ${date}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
              ${statusBadge}
              ${deleteBtn}
            </div>
          </div>`;

      if (r.status === 'Submitted') {
        if (type === 'post_close') {
          const stars = r.overall_stars ? '★'.repeat(r.overall_stars) + '☆'.repeat(5 - r.overall_stars) : '—';
          html += `
          <div style="font-size:18px;color:var(--accent);margin:8px 0;">${stars}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:13px;color:var(--text2);margin:8px 0;">
            <div><b style="color:var(--text1);">Communication:</b> ${r.communication || '—'}</div>
            <div><b style="color:var(--text1);">Knowledge:</b> ${r.knowledge || '—'}</div>
            <div><b style="color:var(--text1);">Negotiation:</b> ${r.negotiation || '—'}</div>
            <div><b style="color:var(--text1);">Would refer:</b> ${r.would_refer || '—'}</div>
          </div>
          ${r.comments ? `<div style="margin-top:10px;padding:12px;background:var(--bg);border-radius:8px;font-size:14px;color:var(--text1);font-style:italic;">"${r.comments}"</div>` : ''}
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" onclick="Reviews.copyText('${r.id}')">📋 Copy as text</button>
            <button class="btn btn-outline btn-sm" style="border-color:var(--accent);color:var(--accent);" onclick="Reviews.openShareModal('${r.id}')">🔗 Share to socials</button>
          </div>`;
        } else if (type === 'search') {
          html += `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;font-size:13px;color:var(--text2);margin:8px 0;">
            <div><b style="color:var(--text1);">Communication:</b> ${r.communication || '—'}</div>
            <div><b style="color:var(--text1);">Homes match wishes:</b> ${r.homes_match || '—'}</div>
          </div>
          ${r.comments ? `<div style="margin-top:10px;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text1);"><b>Most helpful:</b> ${r.comments}</div>` : ''}
          ${r.feedback_improve ? `<div style="margin-top:8px;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text1);"><b>Could improve:</b> ${r.feedback_improve}</div>` : ''}`;
        } else if (type === 'pre_closing') {
          html += `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;font-size:13px;color:var(--text2);margin:8px 0;">
            <div><b style="color:var(--text1);">Communication:</b> ${r.communication || '—'}</div>
            <div><b style="color:var(--text1);">Next steps clarity:</b> ${r.next_steps_clarity || '—'}</div>
          </div>
          ${r.comments ? `<div style="margin-top:10px;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text1);"><b>Stress points:</b> ${r.comments}</div>` : ''}
          ${r.feedback_improve ? `<div style="margin-top:8px;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text1);"><b>Feedback:</b> ${r.feedback_improve}</div>` : ''}`;
        } else if (type === 'new_build_progress') {
          const stars = r.overall_stars ? '★'.repeat(r.overall_stars) + '☆'.repeat(5 - r.overall_stars) : '—';
          html += `
          <div style="font-size:18px;color:var(--accent);margin:8px 0;">${stars}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;font-size:13px;color:var(--text2);margin:8px 0;">
            <div><b style="color:var(--text1);">Communication:</b> ${r.communication || '—'}</div>
            <div><b style="color:var(--text1);">Next steps clarity:</b> ${r.next_steps_clarity || '—'}</div>
          </div>
          ${r.comments ? `<div style="margin-top:10px;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text1);"><b>Stress points:</b> ${r.comments}</div>` : ''}
          ${r.feedback_improve ? `<div style="margin-top:8px;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text1);"><b>Feedback:</b> ${r.feedback_improve}</div>` : ''}`;
        }
      } else {
        html += `<div style="font-size:13px;color:var(--text2);">Awaiting client response. <button class="btn btn-outline btn-sm" onclick="Reviews.copyLink('${r.token}')" style="margin-left:6px;">Copy link</button></div>`;
      }

      html += `</div>`;
    });

    wrap.innerHTML = html;
  },

  copyLink(token) {
    const url = `https://maxwell-dealflow.vercel.app/review.html?t=${token}`;
    navigator.clipboard.writeText(url).then(() => alert('Link copied:\n' + url));
  },

  // Delete a review row (used to clean up duplicate / test-mode entries)
  async deleteReview(id) {
    const r = (Reviews.all || []).find(x => x.id === id);
    const name = r?.clients?.full_name || 'this client';
    const typeWord = r?.review_type === 'search' ? 'mid-search'
                   : r?.review_type === 'pre_closing' ? 'pre-closing'
                   : 'post-close';
    const statusWord = r?.status === 'Submitted' ? 'submitted' : 'pending';
    if (!confirm(`Delete this ${statusWord} ${typeWord} review for ${name}?\n\nThis cannot be undone.`)) return;
    try {
      const { error } = await db.from('client_reviews').delete().eq('id', id);
      if (error) throw error;
      if (typeof App !== 'undefined' && App.toast) App.toast('Review deleted', 'var(--accent)');
      await Reviews.load();
    } catch (e) {
      alert('Could not delete review: ' + (e.message || e));
    }
  },

  copyText(reviewId) {
    const r = Reviews.all.find(x => x.id === reviewId);
    if (!r) return;
    const stars = r.overall_stars ? '★'.repeat(r.overall_stars) + '☆'.repeat(5 - r.overall_stars) : '';
    const txt = `${stars}

Communication: ${r.communication || '—'}
Knowledge of area: ${r.knowledge || '—'}
Negotiation: ${r.negotiation || '—'}
Would refer: ${r.would_refer || '—'}

${r.comments || ''}

— ${r.clients?.full_name || 'Client'}`;
    navigator.clipboard.writeText(txt).then(() => alert('Review copied to clipboard.'));
  },

  // ─── MID-SEARCH CHECK-IN (private feedback while client is searching) ──────
  async requestSearch(clientId) {
    if (!confirm('Send a quick mid-search check-in to this client?\n\n(Private feedback — not for marketing.)')) return;
    try {
      const { data: client } = await db.from('clients').select('*').eq('id', clientId).single();
      if (!client?.email) { alert('Client has no email on file.'); return; }

      // Primary recipient + optional CC — each gets their own private form/row/token.
      const recipients = [{ name: client.full_name, email: client.email }, ...Reviews._collectCC()];
      // One batch_id shared by all queued emails so a single approval ships them all.
      const batchId = recipients.length > 1 ? Reviews._newToken() : null;

      let queued = 0;
      for (const r of recipients) {
        const token = Reviews._newToken();
        const { error: insErr } = await db.from('client_reviews').insert({
          agent_id: currentAgent.id, client_id: client.id, pipeline_id: null,
          review_type: 'search', token, status: 'Pending'
        });
        if (insErr) { console.error(insErr); continue; }
        const tmpl = Reviews.searchTemplate({ full_name: r.name }, currentAgent, token);
        await Notify.queue('Mid-search Check-in 📨', client.id, r.name, r.email, tmpl.subject, tmpl.body, null,
          null, null, null, null, batchId);
        queued++;
      }

      if (!queued) { alert('Could not create check-in. See console.'); return; }
      alert(`✅ ${queued} check-in${queued>1?'s':''} queued for approval.\n\n${batchId?'Approve any one — all '+queued+' send together.':'Approve from the Approvals screen to send.'}`);
    } catch (e) { console.error(e); alert('Error: ' + e.message); }
  },

  // ─── PRE-CLOSING CHECK-IN (private feedback during active deal) ────────────
  async requestPreClose(dealId) {
    if (!confirm('Send a pre-closing check-in to this client?\n\n(Private feedback — not for marketing.)')) return;
    try {
      const deal = (Pipeline.all || []).find(d => d.id === dealId);
      if (!deal) { alert('Deal not found.'); return; }
      const { data: client } = await db.from('clients').select('*').eq('id', deal.client_id).single();
      // Fall back to the email stored on the deal row if the client record has none.
      const primaryEmail = client?.email || deal?.client_email;
      const primaryName  = client?.full_name || deal?.client_name || 'Client';
      if (!primaryEmail) { alert('Client has no email on file (checked both client record and deal).'); return; }

      // Primary recipient + optional CC — each gets their own private form/row/token.
      const recipients = [{ name: primaryName, email: primaryEmail }, ...Reviews._collectCC()];
      // One batch_id shared by all queued emails so a single approval ships them all.
      const batchId = recipients.length > 1 ? Reviews._newToken() : null;

      let queued = 0;
      for (const r of recipients) {
        const token = Reviews._newToken();
        const { error: insErr } = await db.from('client_reviews').insert({
          agent_id: currentAgent.id, client_id: client.id, pipeline_id: deal.id,
          review_type: 'pre_closing', token,
          property_address: deal.property_address || null, status: 'Pending'
        });
        if (insErr) { console.error(insErr); continue; }
        const tmpl = Reviews.preCloseTemplate({ full_name: r.name }, deal, currentAgent, token);
        await Notify.queue('Pre-closing Check-in 📨', client.id, r.name, r.email, tmpl.subject, tmpl.body, deal.id,
          null, null, null, null, batchId);
        queued++;
      }

      if (!queued) { alert('Could not create check-in. See console.'); return; }
      alert(`✅ ${queued} check-in${queued>1?'s':''} queued for approval.\n\nApprove from the Approvals screen to send.`);
    } catch (e) { console.error(e); alert('Error: ' + e.message); }
  },

  searchTemplate(client, agent, token) {
    const firstName = client.full_name?.split(' ')[0] || 'there';
    const agentName = agent?.full_name || agent?.name || 'Maxwell Delali Midodzi';
    const link = `https://maxwell-dealflow.vercel.app/review.html?t=${token}`;
    return {
      subject: `Quick check-in: how's the search going, ${firstName}?`,
      body: `Hi ${firstName},

Quick pulse check while we keep searching — I just want to make sure I'm helping you the right way and there's nothing I should adjust.

Takes about 30 seconds — totally honest is best:

   👉 ${link}

This is private feedback for me to learn from. Not a public review.

Thank you,

${agentName}
REALTOR® | eXp Realty`
    };
  },

  preCloseTemplate(client, deal, agent, token) {
    const firstName = client.full_name?.split(' ')[0] || 'there';
    const agentName = agent?.full_name || agent?.name || 'Maxwell Delali Midodzi';
    const link = `https://maxwell-dealflow.vercel.app/review.html?t=${token}`;
    const property = deal?.property_address ? ` on ${deal.property_address}` : '';
    return {
      subject: `Quick check-in before closing, ${firstName}`,
      body: `Hi ${firstName},

Congrats on the accepted offer${property}! As we head into closing, a quick pulse check so I can keep things smooth and stress-free for you.

Takes about 30 seconds:

   👉 ${link}

This is private feedback — helps me catch anything I should adjust before closing day.

Thank you,

${agentName}
REALTOR® | eXp Realty`
    };
  },

  // ─── BUILD-IN-PROGRESS CHECK-IN (for new construction clients) ─────────────
  async requestNewBuildProgress(buildId) {
    if (!confirm('Send a build progress check-in to this client?\n\n(Private feedback on how the build experience is going.)')) return;
    try {
      const { data: build } = await db.from('new_builds').select('*, clients(*)').eq('id', buildId).single();
      if (!build) { alert('Build not found.'); return; }
      const client = build.clients;
      const primaryEmail = client?.email;
      const primaryName  = client?.full_name || build.client_name || 'Client';
      if (!primaryEmail) { alert('Client has no email on file.'); return; }

      // Primary recipient + optional CC — each gets their own private form/row/token.
      const recipients = [{ name: primaryName, email: primaryEmail }, ...Reviews._collectCC()];
      // One batch_id shared by all queued emails so a single approval ships them all.
      const batchId = recipients.length > 1 ? Reviews._newToken() : null;

      let queued = 0;
      for (const r of recipients) {
        const token = Reviews._newToken();
        const { error: insErr } = await db.from('client_reviews').insert({
          agent_id: currentAgent.id, client_id: client.id, pipeline_id: null,
          review_type: 'new_build_progress', token,
          property_address: build.lot_address || null, status: 'Pending'
        });
        if (insErr) { console.error(insErr); continue; }
        const tmpl = Reviews.newBuildTemplate({ full_name: r.name }, build, currentAgent, token);
        await Notify.queue('Build Progress Check-in 📨', client.id, r.name, r.email, tmpl.subject, tmpl.body, null,
          null, null, null, null, batchId);
        queued++;
      }

      if (!queued) { alert('Could not create check-in. See console.'); return; }
      alert(`✅ ${queued} check-in${queued>1?'s':''} queued for approval.\n\nApprove from the Approvals screen to send.`);
    } catch (e) { console.error(e); alert('Error: ' + e.message); }
  },

  newBuildTemplate(client, build, agent, token) {
    const firstName = client.full_name?.split(' ')[0] || 'there';
    const agentName = agent?.full_name || agent?.name || 'Maxwell Delali Midodzi';
    const link = `https://maxwell-dealflow.vercel.app/review.html?t=${token}`;
    return {
      subject: `Quick check-in on your build, ${firstName}`,
      body: `Hi ${firstName},

Your new build is moving along — I just want to make sure the experience is going the way you expected so far.

Takes about 30 seconds — totally honest is best:

   👉 ${link}

This is private feedback for me to learn from and adjust where I can. Not a public review.

Thank you,

${agentName}
REALTOR® | eXp Realty`
    };
  },

  // ─── SHARE TO SOCIAL MEDIA (post-close only) ───────────────────────────────
  openShareModal(reviewId) {
    const r = Reviews.all.find(x => x.id === reviewId);
    if (!r || r.status !== 'Submitted') return;
    const modal = document.getElementById('share-modal');
    if (!modal) { alert('Share modal not found.'); return; }

    const stars = '★'.repeat(r.overall_stars||5) + '☆'.repeat(5 - (r.overall_stars||5));
    const fullName = r.clients?.full_name || 'Client';
    const parts = fullName.trim().split(' ').filter(Boolean);
    const displayName = parts.length >= 2 ? `${parts[0]} ${parts[parts.length-1].charAt(0)}.` : (parts[0] || 'Client');
    const property = r.property_address || '';
    const closedDate = r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-US',{month:'short',year:'numeric'}) : '';
    const comment = r.comments || `Communication: ${r.communication}. Knowledge: ${r.knowledge}. Negotiation: ${r.negotiation}. Would refer: ${r.would_refer}.`;

    modal.querySelector('#share-card-stars').textContent = stars;
    modal.querySelector('#share-card-quote').textContent = comment;
    modal.querySelector('#share-card-client').textContent = '— ' + displayName;
    modal.querySelector('#share-card-property').textContent = property + (closedDate ? ` · Closed ${closedDate}` : '');
    modal.dataset.reviewId = reviewId;
    modal.style.display = 'flex';
  },

  closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (modal) modal.style.display = 'none';
  },

  _wrap(ctx, text, maxWidth) {
    const words = (text || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  },

  async share(action) {
    const modal = document.getElementById('share-modal');
    const reviewId = modal?.dataset.reviewId;
    const r = Reviews.all.find(x => x.id === reviewId);
    if (!r) return;

    const fullName = r.clients?.full_name || 'Client';
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    const displayName = parts.length >= 2 ? `${parts[0]} ${parts[parts.length-1].charAt(0)}.` : (parts[0] || 'Client');
    const stars = '★'.repeat(r.overall_stars||5);
    const property = r.property_address || '';
    const closedDate = r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-US',{month:'short',year:'numeric'}) : '';
    const comment = r.comments || `Communication: ${r.communication}. Knowledge: ${r.knowledge}. Negotiation: ${r.negotiation}. Would refer: ${r.would_refer}.`;
    const agentName = (currentAgent?.full_name || currentAgent?.name || 'Maxwell Midodzi');

    // Render to 1080×1080 canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 1080, 1080);
    bg.addColorStop(0, '#0A0E14'); bg.addColorStop(1, '#1A2030');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1080, 1080);

    // Radial accents
    const r1 = ctx.createRadialGradient(216, 0, 0, 216, 0, 540);
    r1.addColorStop(0, 'rgba(204,120,92,.30)'); r1.addColorStop(1, 'rgba(204,120,92,0)');
    ctx.fillStyle = r1; ctx.fillRect(0, 0, 1080, 1080);
    const r2 = ctx.createRadialGradient(864, 1080, 0, 864, 1080, 540);
    r2.addColorStop(0, 'rgba(91,91,214,.22)'); r2.addColorStop(1, 'rgba(91,91,214,0)');
    ctx.fillStyle = r2; ctx.fillRect(0, 0, 1080, 1080);

    // CLIENT REVIEW tag + stars
    ctx.fillStyle = '#CC785C';
    ctx.font = 'bold 22px -apple-system, system-ui, Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CLIENT REVIEW', 80, 130);
    ctx.fillStyle = '#F59E0B';
    ctx.font = '64px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(stars, 1000, 145);
    ctx.textAlign = 'left';

    // Big quote mark
    ctx.fillStyle = 'rgba(204,120,92,.30)';
    ctx.font = '240px Georgia, serif';
    ctx.fillText('\u201C', 70, 320);

    // Quote body — wrapped
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '500 52px Georgia, "Times New Roman", serif';
    const lines = Reviews._wrap(ctx, comment, 920).slice(0, 7);
    let y = 380;
    for (const ln of lines) { ctx.fillText(ln, 80, y); y += 70; }

    // Signature
    y = Math.max(y + 30, 720);
    ctx.fillStyle = '#CC785C';
    ctx.font = 'bold 34px -apple-system, system-ui, sans-serif';
    ctx.fillText('— ' + displayName, 80, y);
    y += 38;
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '22px -apple-system, system-ui, sans-serif';
    const propLine = property + (closedDate ? ` · Closed ${closedDate}` : '');
    ctx.fillText(propLine, 80, y);

    // Divider
    const divY = 900;
    const divGrad = ctx.createLinearGradient(80, divY, 1000, divY);
    divGrad.addColorStop(0, '#CC785C'); divGrad.addColorStop(1, 'rgba(204,120,92,0)');
    ctx.fillStyle = divGrad; ctx.fillRect(80, divY, 920, 2);

    // Agent block
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 40px -apple-system, system-ui, sans-serif';
    ctx.fillText(agentName, 80, divY + 55);
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '600 18px -apple-system, system-ui, sans-serif';
    ctx.fillText('REALTOR® · eXp REALTY', 80, divY + 88);

    // Verified badge
    ctx.fillStyle = '#CC785C';
    ctx.font = 'bold 18px -apple-system, system-ui, sans-serif';
    const badgeText = 'VERIFIED REVIEW';
    const tw = ctx.measureText(badgeText).width;
    const padX = 22, badgeW = tw + padX*2, badgeH = 50;
    const bx = 1000 - badgeW, by = divY + 35;
    ctx.strokeStyle = '#CC785C'; ctx.lineWidth = 2;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, badgeW, badgeH, 12); ctx.stroke(); }
    else { ctx.strokeRect(bx, by, badgeW, badgeH); }
    ctx.fillText(badgeText, bx + padX, by + 32);

    // Output
    canvas.toBlob(async (blob) => {
      if (!blob) { alert('Could not generate image.'); return; }
      const safeName = displayName.replace(/[^a-z0-9]+/gi,'_');
      const fileName = `review-${safeName}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      if (action === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Client Review', text: `Kind words from a recent client. 🏡` });
          Reviews.closeShareModal();
        } catch (e) { /* user cancelled — leave modal open */ }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (action === 'share') {
          alert('Your browser does not support direct sharing — the image was downloaded so you can post it manually.');
        }
        Reviews.closeShareModal();
      }
    }, 'image/png');
  }
};

window.Reviews = Reviews;
