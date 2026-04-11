// Maxwell DealFlow CRM — Client Notification System v2
// Every email goes to Approvals first — Maxwell approves before it sends

const Notify = {

  // ── EMAIL TEMPLATES ────────────────────────────────────────────────────────

  templates: {

    viewing_confirmation: (client, viewing, agent, isUpdate = false) => {
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const agentWebsite = agent.website_url || 'maxwellmidodzi.exprealty.com';
      const firstName = client.full_name?.split(' ')[0] || 'there';
      const dateStr = new Date(viewing.viewing_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      const timeStr = viewing.viewing_time ? viewing.viewing_time.slice(0,5) : null;

      // Format time as 12h (e.g. 4:30 PM)
      const fmt12h = (t) => {
        if (!t) return null;
        const [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
      };

      const offerDueLine = viewing.offer_due_date
        ? `\n⏰ Offers Due: ${new Date(viewing.offer_due_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday:'long', month:'long', day:'numeric' })}${viewing.offer_due_time ? ' at ' + fmt12h(viewing.offer_due_time) : ''}`
        : '';
      const sellersLine = viewing.sellers_direction ? `\n📋 Seller's Direction: ${viewing.sellers_direction}` : '';

      // Plain text fallback
      const introLine = isUpdate
        ? `Your viewing details have been updated. Here is the latest information:`
        : `Your property viewing has been confirmed.`;
      const body = `Hi ${firstName},\n\n${introLine}\n\nProperty: ${viewing.property_address}${viewing.mls_number ? '\nMLS#: ' + viewing.mls_number : ''}${viewing.list_price ? '\nList Price: ' + App.fmtMoney(viewing.list_price) : ''}\nDate: ${dateStr}${timeStr ? '\nTime: ' + fmt12h(timeStr) : ''}${offerDueLine}${sellersLine}${viewing.agent_notes ? '\nNotes: ' + viewing.agent_notes : ''}\n\nA calendar invite is attached — open it to add this viewing to your calendar.\n\nLooking forward to seeing you!\n\n${agentName}\nREALTOR® | eXp Realty\n${agentPhone} | ${agentEmail}\neXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2`;

      // ── HTML EMAIL ─────────────────────────────────────────────────────────
      const tableRows = [];
      tableRows.push(`<tr><td class="label">Property</td><td class="value"><strong>${viewing.property_address}</strong></td></tr>`);
      if (viewing.mls_number) tableRows.push(`<tr><td class="label">MLS#</td><td class="value">${viewing.mls_number}</td></tr>`);
      if (viewing.list_price) tableRows.push(`<tr><td class="label">List Price</td><td class="value">${App.fmtMoney(viewing.list_price)}</td></tr>`);
      tableRows.push(`<tr><td class="label">Date</td><td class="value">${dateStr}</td></tr>`);
      if (timeStr) tableRows.push(`<tr><td class="label">Time</td><td class="value">${fmt12h(timeStr)}</td></tr>`);
      const durationMins = viewing.viewing_duration || 30;
      const durationLabel = durationMins < 60 ? `${durationMins} minutes` : durationMins === 60 ? '1 hour' : `${durationMins / 60} hours`;
      tableRows.push(`<tr><td class="label">Duration</td><td class="value">${durationLabel}</td></tr>`);
      if (viewing.offer_due_date) {
        const offerDue = new Date(viewing.offer_due_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
        tableRows.push(`<tr><td class="label" style="color:#e65c00;">Offers Due</td><td class="value" style="color:#e65c00;font-weight:600;">${offerDue}${viewing.offer_due_time ? ' at ' + fmt12h(viewing.offer_due_time) : ''}</td></tr>`);
      }
      if (viewing.sellers_direction) tableRows.push(`<tr><td class="label">Seller's Direction</td><td class="value">${viewing.sellers_direction}</td></tr>`);
      if (viewing.agent_notes) tableRows.push(`<tr><td class="label">Notes</td><td class="value">${viewing.agent_notes}</td></tr>`);

      // Build Google Calendar link so the "Add to Calendar" button actually works
      let gcalStart, gcalEnd;
      if (viewing.viewing_time) {
        const [gh, gm] = viewing.viewing_time.split(':');
        const gStart = new Date(`${viewing.viewing_date}T${gh.padStart(2,'0')}:${gm.padStart(2,'0')}:00`);
        const gEnd = new Date(gStart.getTime() + (viewing.viewing_duration || 30) * 60 * 1000);
        gcalStart = gStart.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
        gcalEnd = gEnd.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
      } else {
        gcalStart = viewing.viewing_date.replace(/-/g,'');
        gcalEnd = gcalStart;
      }
      const gcalUrl = `https://calendar.google.com/calendar/event?action=TEMPLATE&text=${encodeURIComponent('Property Viewing - ' + viewing.property_address)}&dates=${gcalStart}/${gcalEnd}&location=${encodeURIComponent(viewing.property_address)}&details=${encodeURIComponent('Viewing with ' + agentName + '\nPhone: ' + agentPhone + '\nEmail: ' + agentEmail + (viewing.mls_number ? '\nMLS#: ' + viewing.mls_number : ''))}`;

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        body{margin:0;padding:20px;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;}
        .wrap{max-width:560px;margin:0 auto;}
        table.dt{width:100%;border-collapse:collapse;margin:20px 0 24px;}
        table.dt tr{border-bottom:1px solid #eee;}
        table.dt tr:last-child{border-bottom:none;}
        table.dt td.lb{padding:9px 12px;color:#888;font-size:13px;width:38%;vertical-align:top;}
        table.dt td.vl{padding:9px 12px;color:#222;font-size:14px;font-weight:500;}
        .cal-btn{display:block;text-align:center;background:#1a6ef5;color:#ffffff !important;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;margin:0 0 8px;}
        .cal-note{font-size:12px;color:#999;margin:0 0 24px;}
        hr{border:none;border-top:1px solid #eee;margin:24px 0;}
        .sig-name{font-weight:700;font-size:15px;}
        .sig-line{font-size:13px;color:#555;margin:2px 0;}
        .sig-line a{color:#1a6ef5;text-decoration:none;}
        .confidential{font-size:10px;color:#bbb;margin-top:20px;line-height:1.5;}
      </style></head><body><div class="wrap">
        <p>Hi ${firstName},</p>
        <p>${isUpdate ? 'Your viewing details have been <strong>updated</strong>. Here is the latest information:' : 'Your viewing has been confirmed. Here are the details:'}</p>
        <table class="dt">${tableRows.join('')}</table>
        <a class="cal-btn" href="${gcalUrl}" target="_blank">Add to Calendar</a>
        <p class="cal-note">Click the button above to add this viewing to your Google Calendar. An .ics file is also attached for other calendar apps.</p>
        <p>Please don't hesitate to reach out if you have any questions or need to reschedule.</p>
        <p>Looking forward to seeing you!</p>
        <hr>
        <p>Best regards,</p>
        <p class="sig-name">${agentName}</p>
        <p class="sig-line">REALTOR® | eXp Realty</p>
        <p class="sig-line"><a href="tel:${agentPhone}">${agentPhone}</a> &nbsp;|&nbsp; <a href="mailto:${agentEmail}">${agentEmail}</a></p>
        <p class="sig-line">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p>
        <p class="sig-line"><a href="https://${agentWebsite}">${agentWebsite}</a></p>
        <p class="confidential">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>
      </div></body></html>`;

      // ── .ICS CALENDAR INVITE ───────────────────────────────────────────────
      const uid = `viewing-${viewing.id || Date.now()}@maxwell-dealflow`;
      const dtStamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'') + 'Z';
      let dtStart, dtEnd;
      if (viewing.viewing_time) {
        const [h, m] = viewing.viewing_time.split(':');
        const startDate = new Date(`${viewing.viewing_date}T${h.padStart(2,'0')}:${m.padStart(2,'0')}:00`);
        const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // 30 minutes
        dtStart = startDate.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'') + 'Z';
        dtEnd = endDate.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'') + 'Z';
      } else {
        dtStart = viewing.viewing_date.replace(/-/g,'');
        dtEnd = dtStart;
      }
      const isAllDay = !viewing.viewing_time;
      const dateProps = isAllDay
        ? `DTSTART;VALUE=DATE:${dtStart}\r\nDTEND;VALUE=DATE:${dtEnd}`
        : `DTSTART:${dtStart}\r\nDTEND:${dtEnd}`;

      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Maxwell DealFlow CRM//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        dateProps,
        `SUMMARY:Property Viewing \u2014 ${viewing.property_address}`,
        `DESCRIPTION:Viewing with ${agentName}\\n${agentPhone}\\n${agentEmail}${viewing.mls_number ? '\\nMLS#: ' + viewing.mls_number : ''}${viewing.agent_notes ? '\\nNotes: ' + viewing.agent_notes : ''}`,
        `LOCATION:${viewing.property_address}`,
        `ORGANIZER;CN=${agentName}:mailto:${agentEmail}`,
        `ATTENDEE;CN=${client.full_name};ROLE=REQ-PARTICIPANT:mailto:${client.email || agentEmail}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const icsBase64 = btoa(unescape(encodeURIComponent(icsContent)));

      return { subject: isUpdate ? `Viewing Update - ${viewing.property_address}` : `Viewing Confirmed - ${viewing.property_address}`, body, html, ics: icsBase64 };
    },

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

I will be in touch with you the moment I receive a response from the seller's agent.

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
      subject: `Your Offer Was Accepted! - ${offer.property_address}`,
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
      subject: `${daysLeft === 1 ? 'TOMORROW is Closing Day!' : `Closing Day in ${daysLeft} Days`} - ${deal.property_address}`,
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
      subject: `Congratulations on Your New Home! - ${deal.property_address}`,
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

    ready_to_offer: (client, viewing, agent) => {
      const firstName = client.full_name?.split(' ')[0] || 'there';
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const responseLink = viewing._responseToken
        ? `https://maxwell-dealflow.vercel.app/respond?t=${viewing._responseToken}`
        : `https://maxwell-dealflow.vercel.app/respond?viewing_id=${viewing.id}&client_id=${client.id}`;
      const listPrice = viewing.list_price ? Number(viewing.list_price).toLocaleString('en-CA', {style:'currency',currency:'CAD',maximumFractionDigits:0}) : '';

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%;">

      <tr><td style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);padding:28px 40px;text-align:center;">
        <p style="margin:0;font-size:24px;font-weight:bold;color:#fff;">Ready for the Next Step?</p>
        <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,.85);">${viewing.property_address}</p>
      </td></tr>

      <tr><td style="padding:32px 40px 24px;">
        <p style="margin:0 0 16px;font-size:16px;color:#111;">Hi ${firstName},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">Based on your strong interest in <strong>${viewing.property_address}</strong>, I wanted to reach out about the next step.</p>

        ${listPrice ? `<div style="background:#f0f7ff;border-radius:8px;padding:16px;margin-bottom:20px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.05em;">List Price</p>
          <p style="margin:4px 0 0;font-size:24px;font-weight:bold;color:#1d4ed8;">${listPrice}</p>
        </div>` : ''}

        <p style="margin:0 0 20px;font-size:15px;color:#333;line-height:1.6;">I've set up a simple page where you can let me know what you'd like to do. You have three options:</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr><td style="padding:12px;background:#f9fafb;border-radius:8px;margin-bottom:8px;">
            <p style="margin:0;font-size:14px;"><strong style="color:#059669;">Make an Offer</strong> - Enter your preferred price and any notes</p>
          </td></tr>
          <tr><td style="height:8px;"></td></tr>
          <tr><td style="padding:12px;background:#f9fafb;border-radius:8px;">
            <p style="margin:0;font-size:14px;"><strong style="color:#3b82f6;">Continue Searching</strong> - Keep looking at other options</p>
          </td></tr>
          <tr><td style="height:8px;"></td></tr>
          <tr><td style="padding:12px;background:#f9fafb;border-radius:8px;">
            <p style="margin:0;font-size:14px;"><strong style="color:#6b7280;">Pass</strong> - This one isn't the right fit</p>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center">
            <a href="${responseLink}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:bold;text-decoration:none;">Let Me Know Your Decision</a>
          </td></tr>
        </table>

        <p style="margin:24px 0 0;font-size:14px;color:#666;text-align:center;">No pressure - take your time. I'm here whenever you're ready.</p>
      </td></tr>

      <tr><td style="padding:24px 40px;border-top:1px solid #eee;">
        <p style="margin:0 0 2px;font-size:14px;color:#555;">Regards,</p>
        <p style="margin:0 0 2px;font-size:15px;font-weight:bold;color:#111;">${agentName}</p>
        <p style="margin:0 0 2px;font-size:13px;color:#555;">REALTOR&reg; | eXp Realty</p>
        <p style="margin:0;font-size:12px;color:#888;">Phone: ${agentPhone} | Email: ${agentEmail}</p>
        <p style="margin:0;font-size:12px;color:#888;">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p>
        <p style="margin:4px 0 0;font-size:12px;"><a href="https://maxwellmidodzi.exprealty.com" style="color:#3b82f6;text-decoration:none;">maxwellmidodzi.exprealty.com</a></p>
      </td></tr>

      <tr><td style="padding:16px 40px;background:#f9fafb;border-top:1px solid #eee;">
        <p style="margin:0;font-size:11px;color:#999;line-height:1.5;">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

      return {
        subject: `Ready to Make an Offer? - ${viewing.property_address}`,
        body: `Hi ${firstName},

Based on your strong interest in ${viewing.property_address}, I wanted to reach out about the next step.

${listPrice ? `List Price: ${listPrice}\n` : ''}
I've set up a simple page where you can let me know what you'd like to do:

Click here to respond: ${responseLink}

Your options:
- Make an Offer (enter your preferred price and any notes)
- Continue Searching (keep looking at other options)
- Pass (this one isn't the right fit)

No pressure - take your time. I'm here whenever you're ready!

${agentName}
REALTOR | eXp Realty
Phone: ${agentPhone} | Email: ${agentEmail}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com`,
        html
      };
    },

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

    walkthrough_reminder: (client, deal, agent) => ({
      subject: `🚶 Reminder: Final Walkthrough Tomorrow — ${deal.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

Just a friendly reminder that your final walkthrough is scheduled for TOMORROW at ${deal.property_address}.

📍 Property: ${deal.property_address}
📅 Walkthrough Date: ${App.fmtDate(deal.walkthrough_date)}

During the walkthrough, please:
• Check that all agreed-upon repairs have been completed
• Ensure all fixtures, appliances, and inclusions are present
• Test lights, faucets, and major systems
• Check for any new damage or issues since the inspection
• Make sure the property is in the condition agreed upon

If you notice anything concerning, contact me immediately — we still have time to address issues before closing.

I'll be there with you. See you tomorrow!

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    deal_fell_through: (client, deal, reason, agent) => ({
      subject: `An Update on Your Home Search - Let's Keep Going`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

I know this isn't the news we were hoping for regarding ${deal.property_address}. Sometimes deals don't work out, and while it can feel discouraging, please know this is a normal part of the home buying journey.${reason ? `\n\nReason: ${reason}` : ''}

Here's what I want you to remember:
• This experience has given us valuable information for the next offer
• The right home for you is still out there
• I'm already looking at new listings that match your criteria
• We know exactly what to look for and avoid next time

I'll be in touch very soon with new options. In the meantime, please feel free to reach out anytime — I'm here to support you through this.

We WILL find your perfect home. 💪

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    post_closing_referral: (client, deal, agent) => ({
      subject: `Congratulations Again - and a Small Favour - ${deal.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

I hope you're settling into ${deal.property_address} and loving every moment of your new home! It has been an absolute pleasure working with you on this journey.

Now that you're all moved in, I wanted to reach out with a small request.

If you had a great experience working with me, I'd be truly grateful if you could:

⭐ Leave me a Google Review — it takes just 2 minutes and means the world to a Realtor®
👥 Refer me to any friends, family, or colleagues who are thinking about buying or selling

Word-of-mouth referrals are the highest compliment I can receive, and I promise to take great care of anyone you send my way.

Thank you again for trusting me with such an important milestone. I hope to work with you again — or with the people you know — very soon!

Warmly,

${agent.full_name || agent.name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    // ── NEW BUILD UPDATE ──────────────────────────────────────────────────────
    build_update: (client, build, newStage, agent, buildToken) => {
      const firstName = client.full_name?.split(' ')[0] || 'there';
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const trackerLink = buildToken
        ? `https://maxwell-dealflow.vercel.app/build?t=${buildToken}`
        : `https://maxwell-dealflow.vercel.app/build`;

      const STAGE_ORDER = [
        'Deposit Paid','Purchase Agreement','Lot Identified','Lot Offer Accepted',
        'Design Selections','Construction Started','Framing','Drywall',
        'Finishes & Fixtures','Final Walkthrough','Closing / Possession'
      ];

      const stageRows = STAGE_ORDER.map(s => {
        const isDone = STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(newStage);
        const isCurrent = s === newStage;
        const icon = isDone ? '✅' : isCurrent ? '▶️' : '○';
        const color = isDone ? '#059669' : isCurrent ? '#1d4ed8' : '#9ca3af';
        const weight = isCurrent ? 'font-weight:700;' : '';
        return `<tr><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:${color};${weight}font-size:14px;">${icon}&nbsp; ${s}</td></tr>`;
      }).join('');

      const estClose = build.est_close_date || build.closing_date;
      const estCloseStr = estClose ? new Date(estClose).toLocaleDateString('en-CA',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) : null;

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%;">

      <tr><td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:28px 40px;text-align:center;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;">Maxwell DealFlow</p>
        <p style="margin:0;font-size:22px;font-weight:bold;color:#fff;">🏗️ Build Update</p>
        <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,.75);">${build.lot_address || 'Your New Home'}</p>
      </td></tr>

      <tr><td style="padding:32px 40px 24px;">
        <p style="margin:0 0 16px;font-size:16px;color:#111;">Hi ${firstName},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">Exciting news! Your new home at <strong>${build.lot_address}</strong> has reached a new milestone.</p>

        <div style="background:#dbeafe;border-radius:10px;padding:16px 20px;margin-bottom:24px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#1e40af;text-transform:uppercase;font-weight:700;letter-spacing:.05em;">Current Stage</p>
          <p style="margin:8px 0 0;font-size:20px;font-weight:800;color:#1d4ed8;">▶️ ${newStage}</p>
        </div>

        ${estCloseStr ? `<p style="margin:0 0 20px;font-size:14px;color:#555;">📅 <strong>Estimated Possession Date:</strong> ${estCloseStr}</p>` : ''}

        <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.04em;">Build Progress</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
          ${stageRows}
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr><td align="center">
            <a href="${trackerLink}" style="display:inline-block;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:bold;text-decoration:none;">View Full Build Progress →</a>
          </td></tr>
        </table>

        <p style="margin:0;font-size:14px;color:#555;line-height:1.6;">If you have any questions about this stage or the construction timeline, please don't hesitate to reach out.</p>
      </td></tr>

      <tr><td style="padding:24px 40px;border-top:1px solid #eee;">
        <p style="margin:0 0 2px;font-size:14px;color:#555;">Warm regards,</p>
        <p style="margin:0 0 2px;font-size:15px;font-weight:bold;color:#111;">${agentName}</p>
        <p style="margin:0 0 2px;font-size:13px;color:#555;">REALTOR® | eXp Realty</p>
        <p style="margin:0;font-size:12px;color:#888;">📞 ${agentPhone} &nbsp;|&nbsp; ✉️ ${agentEmail}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#888;">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p>
      </td></tr>

      <tr><td style="padding:16px 40px;background:#f9fafb;border-top:1px solid #eee;">
        <p style="margin:0;font-size:11px;color:#999;line-height:1.5;">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

      const body = `Hi ${firstName},

Exciting news! Your new home at ${build.lot_address} has reached a new milestone.

Current Stage: ▶️ ${newStage}
${estCloseStr ? `Estimated Possession: ${estCloseStr}` : ''}

Build Progress:
${STAGE_ORDER.map(s => {
  const isDone = STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(newStage);
  const isCurrent = s === newStage;
  return `${isDone ? '✅' : isCurrent ? '▶️' : '○'}  ${s}`;
}).join('\n')}

View your full build tracker: ${trackerLink}

If you have any questions, please don't hesitate to reach out.

${agentName}
REALTOR® | eXp Realty
Phone: ${agentPhone} | Email: ${agentEmail}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited.`;

      return {
        subject: `🏗️ Build Update — ${newStage} | ${build.lot_address}`,
        body,
        html
      };
    },

    new_listing_match: (client, listing, agent) => ({
      subject: `New Listing That Matches Your Criteria - ${listing.address || 'Check This Out!'}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

Great news — I found a listing that I think is a strong match for what you're looking for!

📍 Property: ${listing.address || '—'}
${listing.mls_number ? `🏷️ MLS#: ${listing.mls_number}\n` : ''}${listing.list_price ? `💰 List Price: ${App.fmtMoney(listing.list_price)}\n` : ''}${listing.bedrooms ? `🛏 Bedrooms: ${listing.bedrooms}\n` : ''}${listing.notes ? `📝 Notes: ${listing.notes}\n` : ''}
Based on your search criteria, I think this one is worth a look. Properties like this tend to move quickly in this market.

Would you like to schedule a viewing? Just reply to this email or give me a call and I'll set it up right away.

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
        subject: `Welcome to eXp Realty, ${firstName}! - ${agentName}`,
        body: plainText,
        html
      };
    },
  },

  // ── QUEUE EMAIL FOR APPROVAL ───────────────────────────────────────────────

  async queue(type, clientId, clientName, clientEmail, emailSubject, emailBody, relatedId = null, htmlBody = null, icsBase64 = null, ccEmail = null) {
    // Always use the Supabase Auth UID — this must match auth.uid() for RLS to pass
    const { data: { user } } = await db.auth.getUser();
    const agentId = user?.id || currentAgent?.id;
    if (!agentId) { console.error('Notify.queue: no auth user found'); return; }
    // Pack html + ics into context_data as JSON so both survive the single-column storage
    let contextData = null;
    if (htmlBody || icsBase64 || ccEmail) {
      contextData = JSON.stringify({ html: htmlBody || null, ics: icsBase64 || null, cc: ccEmail || null });
    }
    const insertRow = {
      agent_id: agentId,
      client_name: clientName,
      client_email: clientEmail,
      approval_type: type,
      email_subject: emailSubject,
      email_body: emailBody,
      context_data: contextData,
      status: 'Pending'
    };
    // Only include related_id if it has a value (avoids schema cache issues if column not yet refreshed)
    if (relatedId) insertRow.related_id = relatedId;
    const { error } = await db.from('approval_queue').insert(insertRow);
    if (error) {
      console.error('Notify.queue insert error:', error);
      App.toast(`⚠️ Could not queue approval: ${error.message}`, 'var(--red)');
      return false;
    }
    // Update badge
    Notify.updateBadge();
    // ── PUSH NOTIFICATION TO AGENT ──────────────────────────────────────
    App.pushNotify(
      `📬 Action Required: ${type}`,
      `${clientName} — tap to review and send`,
      'approvals'
    );
    App.toast(`📬 Approval needed — check Approvals to send`, 'var(--accent2)');
    return true;
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
    // Sync mobile bottom nav badge
    const mobBadge = document.getElementById('mob-approvals-badge');
    if (mobBadge) {
      mobBadge.textContent = count || 0;
      mobBadge.style.display = (count > 0) ? 'flex' : 'none';
    }
  },

  // ── TRIGGER FUNCTIONS (called from viewings/offers/pipeline) ───────────────

  async onViewingBooked(viewing, client, isUpdate = false) {
    const agent = currentAgent;
    const tmpl = Notify.templates.viewing_confirmation(client, viewing, agent, isUpdate);
    await Notify.queue(
      isUpdate ? 'Viewing Update' : 'Viewing Confirmation',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, viewing.id,
      tmpl.html,          // beautiful HTML email
      tmpl.ics,           // base64 .ics calendar invite
      viewing.cc_email || null  // CC second buyer if present
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
      'Ready to Make an Offer?',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, viewing.id,
      tmpl.html    // beautiful HTML email with interactive response link
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

  async onWalkthroughReminder(deal, client) {
    const agent = currentAgent;
    const tmpl = Notify.templates.walkthrough_reminder(client, deal, agent);
    await Notify.queue(
      'Walkthrough Reminder (1d)',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, deal.id
    );
  },

  async onDealFellThrough(deal, client, reason) {
    const agent = currentAgent;
    const tmpl = Notify.templates.deal_fell_through(client, deal, reason, agent);
    await Notify.queue(
      'Deal Fell Through 💔',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, deal.id
    );
  },

  async onPostClosingReferral(deal, client) {
    const agent = currentAgent;
    const tmpl = Notify.templates.post_closing_referral(client, deal, agent);
    await Notify.queue(
      'Post-Closing Referral Request',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, deal.id
    );
  },

  async onNewListingMatch(client, listing) {
    const agent = currentAgent;
    const tmpl = Notify.templates.new_listing_match(client, listing, agent);
    await Notify.queue(
      'New Listing Match 🏠',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, null
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

      // Check walkthrough reminder (1 day before)
      if (deal.walkthrough_date) {
        const walkDate = new Date(deal.walkthrough_date);
        walkDate.setHours(0,0,0,0);
        const daysLeft = Math.round((walkDate - today) / (1000 * 60 * 60 * 24));
        if (daysLeft === 1) {
          const { count } = await db.from('approval_queue')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', currentAgent.id)
            .eq('related_id', deal.id)
            .eq('approval_type', 'Walkthrough Reminder (1d)')
            .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());
          if (!count) {
            const tmpl = Notify.templates.walkthrough_reminder(client, deal, agent);
            await Notify.queue('Walkthrough Reminder (1d)', client.id, client.full_name, client.email, tmpl.subject, tmpl.body, deal.id);
          }
        }
      }

      // Check closing countdown (7d, 3d, 1d) + closing day (0d)
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
        // Closing day itself — queue Happy Closing Day email
        if (daysLeft === 0 && deal.stage !== 'Closed') {
          const { count } = await db.from('approval_queue')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', currentAgent.id)
            .eq('related_id', deal.id)
            .eq('approval_type', 'Happy Closing Day! 🔑')
            .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());
          if (!count) {
            const tmpl = Notify.templates.deal_closed(client, deal, agent);
            await Notify.queue('Happy Closing Day! 🔑', client.id, client.full_name, client.email, tmpl.subject, tmpl.body, deal.id);
          }
        }
      }
    }
  },

  // ── AUTO-COMPLETE PAST VIEWINGS & PROMPT FOR FEEDBACK ────────────────────
  // Called on app load — finds viewings where date+time have passed but status
  // is still "Scheduled". Auto-marks them "Completed" and pushes a notification
  // to the agent asking "How did the viewing go?"

  async checkCompletedViewings() {
    if (!currentAgent?.id) return;

    // Get agent's client IDs first (viewings table has no agent_id column)
    const { data: agentClients } = await db.from('clients')
      .select('id').eq('agent_id', currentAgent.id);
    const clientIds = (agentClients || []).map(c => c.id);
    if (!clientIds.length) return;

    // Get all scheduled/confirmed viewings for this agent's clients
    const { data: viewings } = await db.from('viewings')
      .select('*, clients(full_name, email)')
      .in('client_id', clientIds)
      .in('viewing_status', ['Scheduled', 'Confirmed'])
      .order('viewing_date', { ascending: false });

    if (!viewings?.length) return;

    const now = new Date();
    let completedCount = 0;

    for (const v of viewings) {
      if (!v.viewing_date) continue;

      // Calculate when the viewing actually ends (start + 30 min viewing duration)
      let viewingEndTime;
      if (v.viewing_time) {
        viewingEndTime = new Date(v.viewing_date + 'T' + v.viewing_time);
        viewingEndTime.setMinutes(viewingEndTime.getMinutes() + 30); // 30 min viewing
      } else {
        viewingEndTime = new Date(v.viewing_date + 'T23:59:59');
      }

      // Check if there's an offer deadline today — if so, skip the buffer
      // so agent gets notified ASAP to give the client time to respond
      let hasUrgentDeadline = false;
      if (v.offer_due_date) {
        const deadlineDate = new Date(v.offer_due_date + 'T' + (v.offer_due_time || '23:59') + ':00');
        const hoursUntilDeadline = (deadlineDate - now) / (1000 * 60 * 60);
        // Urgent if deadline is within 6 hours of viewing end
        if (hoursUntilDeadline <= 6 && hoursUntilDeadline > 0) {
          hasUrgentDeadline = true;
        }
      }

      // Determine when to trigger: right after viewing if urgent, or +1hr buffer if not
      let triggerTime;
      if (hasUrgentDeadline) {
        triggerTime = viewingEndTime; // No buffer — notify immediately after viewing ends
      } else {
        triggerTime = new Date(viewingEndTime.getTime() + 60 * 60 * 1000); // 1 hour buffer
      }

      if (now > triggerTime) {
        // Time has passed — auto-complete this viewing
        await db.from('viewings').update({
          viewing_status: 'Completed',
          updated_at: new Date().toISOString()
        }).eq('id', v.id);

        completedCount++;

        const clientName = v.clients?.full_name || 'your client';
        const address = v.property_address || 'the property';

        // Build notification message — flag urgency if offer deadline is close
        let notifBody = `${address} with ${clientName} - tap to record feedback`;
        if (hasUrgentDeadline) {
          const dueTime = v.offer_due_time ? v.offer_due_time.slice(0,5) : '';
          const fmtDue = dueTime ? (() => { const [h,m] = dueTime.split(':').map(Number); return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; })() : 'tonight';
          notifBody = `URGENT: Offers due ${fmtDue}! ${address} with ${clientName} - record feedback now`;
        }

        App.pushNotify(
          hasUrgentDeadline ? `Viewing done - offers due soon!` : `How was the viewing?`,
          notifBody,
          'viewings'
        );
      }
    }

    // If any viewings were auto-completed, refresh the viewings list and show toast
    if (completedCount > 0) {
      if (typeof Viewings !== "undefined") await Viewings.load();
      App.toast(
        `${completedCount} viewing${completedCount > 1 ? 's' : ''} completed — tap to record feedback`,
        'var(--accent2)'
      );
    }
  }
};
