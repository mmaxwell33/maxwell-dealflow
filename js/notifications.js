// Maxwell DealFlow CRM — Client Notification System
// Every email goes to Approvals first — Maxwell approves before it sends

const Notify = {

  // ── EMAIL TEMPLATES ────────────────────────────────────────────────────────

  templates: {

    viewing_confirmation: (client, viewing, agent) => ({
      subject: `Your Viewing is Confirmed — ${viewing.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

Your property viewing has been confirmed. Here are the details:

📍 Property: ${viewing.property_address}${viewing.mls_number ? `\n🏷️ MLS#: ${viewing.mls_number}` : ''}${viewing.list_price ? `\n💰 List Price: ${App.fmtMoney(viewing.list_price)}` : ''}
📅 Date: ${new Date(viewing.viewing_date).toLocaleDateString('en-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}${viewing.viewing_time ? `\n⏰ Time: ${viewing.viewing_time.slice(0,5)}` : ''}

${viewing.agent_notes ? `📝 Notes: ${viewing.agent_notes}\n` : ''}
Please don't hesitate to reach out if you have any questions or need to reschedule.

Looking forward to showing you this property!

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    viewing_followup: (client, viewing, feedback, agent) => ({
      subject: `Follow-Up: ${viewing.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

Thank you for viewing ${viewing.property_address} ${feedback === 'interested' ? '— great choice! 🌟' : feedback === 'good' ? '— glad you liked it!' : 'today.'}

${feedback === 'interested' ? `Based on your strong interest, I'd recommend we discuss making an offer soon. Properties like this don't stay on the market long!\n\nWould you like to schedule a call to go over the offer process?` : feedback === 'good' ? `I'm glad you found it interesting. Would you like to see any other properties, or would you like to discuss this one further?` : `No worries at all — finding the right home takes time. I have other listings that might be a better fit. Shall I send some options your way?`}

Let me know your thoughts!

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    offer_submitted: (client, offer, agent) => ({
      subject: `Your Offer Has Been Submitted — ${offer.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

Great news! Your offer has been officially submitted. Here's a summary:

📍 Property: ${offer.property_address}
💰 Offer Amount: ${App.fmtMoney(offer.offer_amount)}${offer.list_price ? `\n🏷️ List Price: ${App.fmtMoney(offer.list_price)}` : ''}
📅 Offer Date: ${App.fmtDate(offer.offer_date)}${offer.conditions ? `\n📋 Conditions: ${offer.conditions}` : ''}

I will keep you updated as soon as I hear back from the seller's agent. This process typically takes 24–48 hours.

Stay tuned — I'll be in touch!

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    offer_accepted: (client, offer, agent) => ({
      subject: `🎉 Your Offer Was Accepted! — ${offer.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

CONGRATULATIONS! 🎉 Your offer of ${App.fmtMoney(offer.offer_amount)} on ${offer.property_address} has been ACCEPTED!

This is a huge milestone. Here's what happens next:

${offer.conditions ? `📋 Conditions to fulfill:\n${offer.conditions}\n\n` : ''}✅ Next Steps:
1. We will work through any conditions (financing, inspection, etc.)
2. Your lawyer will be in touch to begin the conveyancing process
3. We will schedule any inspections or walkthroughs
4. On closing day — the keys are yours! 🔑

I'll be guiding you every step of the way. Please don't hesitate to call or message me anytime.

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    conditions_reminder: (client, deal, daysLeft, conditionType, agent) => ({
      subject: `⏰ Reminder: ${conditionType} Condition Due in ${daysLeft} Day${daysLeft !== 1 ? 's' : ''}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

This is a friendly reminder that your ${conditionType.toLowerCase()} condition for ${deal.property_address} is due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.

📍 Property: ${deal.property_address}
⏰ ${conditionType} Deadline: ${conditionType === 'Financing' ? App.fmtDate(deal.financing_date) : App.fmtDate(deal.inspection_date)}

${conditionType === 'Financing' ? 'Please ensure your mortgage lender has all required documents. Contact me immediately if you need more time or if there are any issues.' : 'Please confirm your inspection appointment is booked. Let me know if you need a referral for a home inspector.'}

Time is of the essence — please reach out right away if anything needs attention.

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    closing_countdown: (client, deal, daysLeft, agent) => ({
      subject: `🔑 ${daysLeft === 1 ? 'TOMORROW is Closing Day!' : `Closing Day in ${daysLeft} Days`} — ${deal.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

${daysLeft === 1 ? '🔑 Tomorrow is the big day!' : `🏠 You are ${daysLeft} days away from closing!`}

📍 Property: ${deal.property_address}
📅 Closing Date: ${App.fmtDate(deal.closing_date)}

${daysLeft <= 3 ? `✅ Final Closing Checklist:
• Confirm with your lawyer that all documents are signed
• Arrange certified funds / bank draft for closing costs
• Confirm utilities transfer (hydro, water, gas, internet)
• Arrange moving company if not done yet
• Do a final walkthrough of the property
• Bring valid photo ID on closing day

` : `📋 Things to start preparing:
• Touch base with your lawyer about closing documents
• Start planning your move — book a moving company soon
• Begin arranging utility transfers
• Contact your insurance company for home insurance

`}I'm here for any questions. This is an exciting time!

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    deal_closed: (client, deal, agent) => ({
      subject: `🏠 Congratulations on Your New Home! — ${deal.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

CONGRATULATIONS! 🎉🏠🔑

The keys to ${deal.property_address} are now yours! What an incredible journey — I'm so proud to have been your agent through this process.

A few important reminders:
• Keep all your closing documents in a safe place
• Change the locks on your new home
• Update your address with Canada Post, CRA, your bank, etc.
• Register for any applicable home owner grants in your province

It has been an absolute pleasure working with you. I hope you love your new home!

If you have a moment, I would truly appreciate a Google review or a referral to anyone you know looking to buy or sell. It means the world to a Realtor® 🙏

Thank you again,

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.

P.S. Don't hesitate to reach out anytime — even just to say hello from your new home! 😊`
    }),

    ready_to_offer: (client, viewing, agent) => ({
      subject: `Ready to Make an Offer? — ${viewing.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

Based on your strong interest in ${viewing.property_address}, I wanted to reach out about the next step — making an offer!

Here's what happens when we submit an offer:
1. We agree on an offer price together
2. I prepare the offer documents on your behalf
3. The offer is submitted to the seller's agent
4. The seller can Accept, Counter, or Reject the offer
5. If accepted — you're on your way to owning this home! 🔑

To get started, simply reply to this email with:
• The price you'd like to offer
• Any conditions you want included (financing, inspection, etc.)
• Or let me know if you'd like more time to think it over

I'm here to guide you every step of the way. No pressure — just let me know what you'd like to do!

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    offer_countered: (client, offer, counterAmount, message, agent) => ({
      subject: `The Seller Has Countered Your Offer — ${offer.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

I have an update on your offer for ${offer.property_address}.

The seller has responded with a COUNTER OFFER:

Your Offer: ${App.fmtMoney(offer.offer_amount)}
Seller's Counter: ${App.fmtMoney(counterAmount)}
${message ? `\nSeller's Notes: ${message}\n` : ''}
You have a few options:
1. ✅ Accept the counter offer at ${App.fmtMoney(counterAmount)}
2. 🔄 Submit a new counter offer at a different price
3. ❌ Decline and walk away

Please reply or call me as soon as possible — counter offers are time-sensitive!

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    offer_rejected: (client, offer, message, agent) => ({
      subject: `Update on Your Offer — ${offer.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

I wanted to update you on your offer for ${offer.property_address}.

Unfortunately, the seller has decided not to accept your offer at this time.${message ? `\n\nSeller's message: ${message}` : ''}

While this is disappointing, please know this happens and it's part of the process. The good news is:
• There are many other great properties available
• Your offer experience has prepared us well for the next one
• I'm already looking for similar properties for you

I'll be in touch shortly with some new options. Please don't hesitate to reach out if you have any questions.

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    welcome_email: (client, intake, agent) => {
      const firstName = client.full_name?.split(' ')[0] || client.first_name || 'there';
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const agentWebsite = agent.website_url || 'maxwellmidodzi.exprealty.com';
      const agentAddress = agent.brokerage_address || '33 Pippy PL, Suite 101, St. John\'s, NL A1B 3X2';

      // Build criteria rows
      const criteriaLines = [];
      if (intake.property_types) criteriaLines.push(`🏠 <strong>Property Type:</strong> ${intake.property_types}`);
      if (intake.bedrooms) criteriaLines.push(`🛏 <strong>Bedrooms:</strong> ${intake.bedrooms}`);
      if (intake.bathrooms) criteriaLines.push(`🛁 <strong>Bathrooms:</strong> ${intake.bathrooms}`);
      if (intake.budget_max) criteriaLines.push(`💰 <strong>Budget:</strong> Up to ${Number(intake.budget_max).toLocaleString('en-CA', {style:'currency',currency:'CAD',maximumFractionDigits:0})}`);
      if (intake.preferred_areas) criteriaLines.push(`📍 <strong>Areas:</strong> ${intake.preferred_areas}`);
      if (intake.timeline) criteriaLines.push(`📅 <strong>Timeline:</strong> ${intake.timeline}`);
      if (intake.must_haves) criteriaLines.push(`✅ <strong>Must-Haves:</strong> ${intake.must_haves}`);
      const criteriaHTML = criteriaLines.length
        ? criteriaLines.map(l => `<p style="margin:6px 0;font-size:14px;color:#333;">${l}</p>`).join('')
        : `<p style="margin:6px 0;font-size:14px;color:#333;">Your preferences have been noted.</p>`;

      const steps = [
        { n:1, color:'#4f46e5', title:'Discovery Call', desc:"We'll discuss your needs, budget, and timeline" },
        { n:2, color:'#059669', title:'Property Search', desc:"I'll share listings that match your criteria" },
        { n:3, color:'#d97706', title:'Viewings', desc:"We'll tour properties together" },
        { n:4, color:'#7c3aed', title:'Offer & Closing', desc:"I'll negotiate the best deal for you" }
      ];

      const stepsHTML = steps.map((s, i) => `
        <tr>
          <td style="padding:14px 0;${i < steps.length-1 ? 'border-bottom:1px solid #eee;' : ''}">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:40px;vertical-align:middle;">
                <div style="width:32px;height:32px;border-radius:50%;background:${s.color};color:#fff;font-weight:bold;font-size:15px;text-align:center;line-height:32px;">${s.n}</div>
              </td>
              <td style="padding-left:12px;vertical-align:middle;">
                <span style="font-weight:bold;color:#111;">${s.title}</span>
                <span style="color:#555;"> — ${s.desc}</span>
              </td>
            </tr></table>
          </td>
        </tr>`).join('');

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%;">

      <tr><td style="padding:32px 40px 24px;">
        <p style="margin:0 0 8px;font-size:28px;">🎉 <strong style="color:#4f46e5;">Welcome!</strong></p>
        <p style="margin:0 0 20px;font-size:16px;color:#111;">Hi ${firstName},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">Thank you for choosing me as your real estate agent! I'm excited to help you find your perfect home.</p>
        <p style="margin:0 0 20px;font-size:15px;color:#333;">Here's what happens next:</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden;padding:0 16px;">
          ${stepsHTML}
        </table>

        ${criteriaLines.length ? `
        <div style="margin-top:24px;padding:16px;background:#f9f9f9;border-radius:8px;">
          <p style="margin:0 0 10px;font-size:13px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:.05em;">Your Search Criteria on File</p>
          ${criteriaHTML}
        </div>` : ''}

        <p style="margin:24px 0 0;font-size:15px;color:#333;line-height:1.6;">Feel free to reach out anytime — I'm here to help!</p>
      </td></tr>

      <tr><td style="padding:24px 40px;border-top:1px solid #eee;">
        <p style="margin:0 0 4px;font-size:14px;color:#555;">Regards,</p>
        <p style="margin:0 0 2px;font-size:15px;font-weight:bold;color:#111;">${agentName}</p>
        <p style="margin:0 0 2px;font-size:13px;color:#555;">REALTOR® | eXp Realty</p>
      </td></tr>

      <tr><td style="background:#f8f8f8;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;color:#888;">Phone: ${agentPhone} | Email: <a href="mailto:${agentEmail}" style="color:#4f46e5;">${agentEmail}</a></p>
        <p style="margin:0 0 4px;font-size:12px;color:#888;">eXp Realty, ${agentAddress}</p>
        <p style="margin:0;font-size:12px;color:#888;"><a href="https://${agentWebsite}" style="color:#4f46e5;">${agentWebsite}</a></p>
      </td></tr>

      <tr><td style="padding:16px 40px;background:#f8f8f8;border-top:1px solid #eee;">
        <p style="margin:0;font-size:11px;color:#aaa;line-height:1.6;text-align:center;">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

      const plainText = `Hi ${firstName},

Welcome! I'm ${agentName} and I'm thrilled to be working with you on your real estate journey.

Here's what happens next:
1. Discovery Call — We'll discuss your needs, budget, and timeline
2. Property Search — I'll share listings that match your criteria
3. Viewings — We'll tour properties together
4. Offer & Closing — I'll negotiate the best deal for you

Feel free to reach out anytime — I'm here to help!

Regards,
${agentName}
REALTOR® | eXp Realty
Phone: ${agentPhone} | Email: ${agentEmail}
eXp Realty, ${agentAddress}
${agentWebsite}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`;

      return {
        subject: `🎉 Welcome to eXp Realty, ${firstName}! — ${agentName}`,
        body: plainText,
        html
      };
    },
  },

  // ── QUEUE EMAIL FOR APPROVAL ───────────────────────────────────────────────

  async queue(type, clientId, clientName, clientEmail, emailSubject, emailBody, relatedId = null, htmlBody = null) {
    // Use agent id, or fall back to auth user id if agent record not in agents table
    const agentId = currentAgent?.id || (await db.auth.getUser())?.data?.user?.id;
    if (!agentId) return;
    const { error } = await db.from('approval_queue').insert({
      agent_id: agentId,
      client_name: clientName,
      client_email: clientEmail,
      approval_type: type,
      email_subject: emailSubject,
      email_body: emailBody,      // always plain text — shown in preview
      context_data: htmlBody || null, // HTML template stored here for sending
      related_id: relatedId,
      status: 'Pending'
    });
    if (!error) {
      // Update badge
      Notify.updateBadge();
      // ── PUSH NOTIFICATION TO AGENT ──────────────────────────────────────
      // Fire immediately — agent taps notification → lands on Approvals
      App.pushNotify(
        `📬 Action Required: ${type}`,
        `${clientName} — tap to review and send`,
        'approvals'
      );
      App.toast(`📬 Approval needed — check Approvals to send`, 'var(--accent2)');
    }
    return !error;
  },

  async updateBadge() {
    const agentId = currentAgent?.id || (await db.auth.getUser())?.data?.user?.id;
    if (!agentId) return;
    const { count } = await db.from('approval_queue')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .eq('status', 'Pending');
    const badge = document.getElementById('approvals-badge');
    if (badge) {
      badge.textContent = count || 0;
      badge.style.display = (count > 0) ? 'inline' : 'none';
    }
  },

  // ── TRIGGER FUNCTIONS (called from viewings/offers/pipeline) ───────────────

  async onViewingBooked(viewing, client) {
    const agent = currentAgent;
    const tmpl = Notify.templates.viewing_confirmation(client, viewing, agent);
    await Notify.queue(
      'Viewing Confirmation',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, viewing.id
    );
  },

  async onViewingFeedback(viewing, client, feedback) {
    if (!feedback || feedback === '') return;
    const agent = currentAgent;
    const tmpl = Notify.templates.viewing_followup(client, viewing, feedback, agent);
    await Notify.queue(
      'Post-Viewing Follow-Up',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, viewing.id
    );
  },

  async onReadyToOffer(viewing, client) {
    const agent = currentAgent;
    const tmpl = Notify.templates.ready_to_offer(client, viewing, agent);
    await Notify.queue(
      'Ready to Make an Offer? 🏠',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, viewing.id
    );
  },

  async onOfferCountered(offer, client, counterAmount, message) {
    const agent = currentAgent;
    const tmpl = Notify.templates.offer_countered(client, offer, counterAmount, message, agent);
    await Notify.queue(
      'Offer Countered 🔄',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, offer.id
    );
  },

  async onOfferRejected(offer, client, message) {
    const agent = currentAgent;
    const tmpl = Notify.templates.offer_rejected(client, offer, message, agent);
    await Notify.queue(
      'Offer Rejected ❌',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, offer.id
    );
  },

  async onOfferSubmitted(offer, client) {
    const agent = currentAgent;
    const tmpl = Notify.templates.offer_submitted(client, offer, agent);
    await Notify.queue(
      'Offer Submitted',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, offer.id
    );
  },

  async onOfferAccepted(offer, client) {
    const agent = currentAgent;
    const tmpl = Notify.templates.offer_accepted(client, offer, agent);
    await Notify.queue(
      'Offer Accepted 🎉',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, offer.id
    );
  },

  async onDealClosed(deal, client) {
    const agent = currentAgent;
    const clientObj = client || { full_name: deal.client_name, email: deal.client_email, id: deal.client_id };
    const tmpl = Notify.templates.deal_closed(clientObj, deal, agent);
    await Notify.queue(
      'Deal Closed 🏠',
      clientObj.id, clientObj.full_name, clientObj.email,
      tmpl.subject, tmpl.body, deal.id
    );
  },

  async onClientAdded(client, intake) {
    const agent = currentAgent;
    const tmpl = Notify.templates.welcome_email(client, intake, agent);
    await Notify.queue(
      'Welcome Email',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, null, tmpl.html
    );
  },

  async checkConditionDeadlines() {
    // Called on load — checks all active pipeline deals for upcoming deadlines
    if (!currentAgent?.id) return;
    const { data: deals } = await db.from('pipeline')
      .select('*, clients(full_name, email)')
      .eq('agent_id', currentAgent.id)
      .eq('status', 'Active')
      .neq('stage', 'Closed');
    if (!deals?.length) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const agent = currentAgent;

    for (const deal of deals) {
      const client = deal.clients || { full_name: deal.client_name, email: deal.client_email, id: deal.client_id };

      // Check financing deadline
      if (deal.financing_date) {
        const finDate = new Date(deal.financing_date);
        finDate.setHours(0,0,0,0);
        const daysLeft = Math.round((finDate - today) / (1000 * 60 * 60 * 24));
        if (daysLeft === 3 || daysLeft === 1) {
          // Check if we already queued this recently
          const { count } = await db.from('approval_queue')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', currentAgent.id)
            .eq('related_id', deal.id)
            .eq('approval_type', `Financing Reminder (${daysLeft}d)`)
            .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());
          if (!count) {
            const tmpl = Notify.templates.conditions_reminder(client, deal, daysLeft, 'Financing', agent);
            await Notify.queue(`Financing Reminder (${daysLeft}d)`, client.id, client.full_name, client.email, tmpl.subject, tmpl.body, deal.id);
          }
        }
      }

      // Check inspection deadline
      if (deal.inspection_date) {
        const insDate = new Date(deal.inspection_date);
        insDate.setHours(0,0,0,0);
        const daysLeft = Math.round((insDate - today) / (1000 * 60 * 60 * 24));
        if (daysLeft === 3 || daysLeft === 1) {
          const { count } = await db.from('approval_queue')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', currentAgent.id)
            .eq('related_id', deal.id)
            .eq('approval_type', `Inspection Reminder (${daysLeft}d)`)
            .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());
          if (!count) {
            const tmpl = Notify.templates.conditions_reminder(client, deal, daysLeft, 'Inspection', agent);
            await Notify.queue(`Inspection Reminder (${daysLeft}d)`, client.id, client.full_name, client.email, tmpl.subject, tmpl.body, deal.id);
          }
        }
      }

      // Check closing countdown
      if (deal.closing_date) {
        const closeDate = new Date(deal.closing_date);
        closeDate.setHours(0,0,0,0);
        const daysLeft = Math.round((closeDate - today) / (1000 * 60 * 60 * 24));
        if ([7, 3, 1].includes(daysLeft)) {
          const { count } = await db.from('approval_queue')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', currentAgent.id)
            .eq('related_id', deal.id)
            .eq('approval_type', `Closing Countdown (${daysLeft}d)`)
            .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());
          if (!count) {
            const tmpl = Notify.templates.closing_countdown(client, deal, daysLeft, agent);
            await Notify.queue(`Closing Countdown (${daysLeft}d)`, client.id, client.full_name, client.email, tmpl.subject, tmpl.body, deal.id);
          }
        }
      }
    }
  }
};
