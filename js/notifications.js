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
📅 Offer Date: ${App.fmtDate(offer.offer_date)}${offer.conditions ? `\nConditions: ${offer.conditions}` : ''}

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

${offer.conditions ? `Conditions to fulfill:\n${offer.conditions}\n\n` : ''}✅ Next Steps:
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

    // ── OFFER ACCEPTED WITH FULL CLOSING CHECKLIST ────────────────────────────
    offer_accepted_checklist: (client, offer, agent) => {
      const firstName = client.full_name?.split(' ')[0] || 'there';
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const agentWebsite = agent.website_url || 'maxwellmidodzi.exprealty.com';

      const fmtDate = (d) => d ? new Date(String(d).slice(0,10) + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : null;

      const offerAmtFmt = App.fmtMoney(offer.offer_amount);
      const listPriceFmt = offer.list_price ? App.fmtMoney(offer.list_price) : null;
      const finDateFmt = fmtDate(offer.financing_date);
      const insDateFmt = fmtDate(offer.inspection_date);
      const closeDateFmt = fmtDate(offer.closing_date);

      const depositAmtFmt = offer.deposit_amount ? App.fmtMoney(offer.deposit_amount) : null;
      const depositDueFmt = offer.deposit_due_date
        ? new Date(offer.deposit_due_date).toLocaleString('en-CA', { weekday:'long', month:'long', day:'numeric', hour:'numeric', minute:'2-digit' })
        : null;

      // Deal summary table rows — same style as viewing confirmation
      const tableRows = [];
      tableRows.push(`<tr><td class="lb">Property</td><td class="vl"><strong>${offer.property_address}</strong></td></tr>`);
      tableRows.push(`<tr><td class="lb">Your Offer</td><td class="vl" style="color:#1a6ef5;font-weight:700;">${offerAmtFmt}</td></tr>`);
      if (listPriceFmt) tableRows.push(`<tr><td class="lb">List Price</td><td class="vl">${listPriceFmt}</td></tr>`);
      if (offer.conditions) tableRows.push(`<tr><td class="lb">Conditions</td><td class="vl">${offer.conditions}</td></tr>`);
      if (depositAmtFmt) tableRows.push(`<tr><td class="lb">Deposit</td><td class="vl">${depositAmtFmt}${offer.deposit_sent ? ' <span style="color:#059669;font-weight:700;">✅ Sent</span>' : ' <span style="color:#d97706;font-weight:700;">⏰ Due within 24 hrs</span>'}</td></tr>`);
      if (finDateFmt) tableRows.push(`<tr><td class="lb">Financing By</td><td class="vl">${finDateFmt}</td></tr>`);
      if (insDateFmt) tableRows.push(`<tr><td class="lb">Inspection On</td><td class="vl">${insDateFmt}</td></tr>`);
      if (closeDateFmt) tableRows.push(`<tr><td class="lb">Closing Date</td><td class="vl">${closeDateFmt}</td></tr>`);

      // Checklist rows — deposit is always first when accepted
      const depositItem = offer.deposit_sent
        ? `🏦 <strong>Deposit Cheque</strong> — ✅ Deposit of ${depositAmtFmt || 'the agreed amount'} has been sent to the seller's agent.`
        : `🏦 <strong>Deposit Cheque ⚠️ URGENT</strong> — A deposit of ${depositAmtFmt || 'the agreed amount'} must be delivered to the seller's agent <strong>within 24 hours</strong>${depositDueFmt ? ` (by ${depositDueFmt})` : ''}. Please arrange this immediately.`;

      const checklistItems = [
        depositItem,
        offer.conditions
          ? `📋 <strong>Conditions Period</strong> — Your conditions (${offer.conditions}) must be satisfied before the deal is firm.`
          : `📋 <strong>No Conditions</strong> — Your deal is already firm!`,
        finDateFmt
          ? `🏦 <strong>Financing Approval</strong> — Ensure your lender has everything they need. Deadline: ${finDateFmt}.`
          : `🏦 <strong>Financing Approval</strong> — Stay in close contact with your mortgage lender.`,
        insDateFmt
          ? `🔍 <strong>Home Inspection</strong> — Scheduled for ${insDateFmt}. Let me know if you need an inspector referral.`
          : `🔍 <strong>Home Inspection</strong> — Contact me if you need a referral for a qualified home inspector.`,
        `⚖️ <strong>Lawyer / Conveyancing</strong> — Contact a real estate lawyer in NL right away to begin the title transfer process.`,
        `🚶 <strong>Final Walkthrough</strong> — We'll do a final walkthrough before closing to confirm the property is as agreed.`,
        closeDateFmt
          ? `🔑 <strong>Closing Day — ${closeDateFmt}</strong> — Your lawyer will finalize all documents and funds. Keys are yours!`
          : `🔑 <strong>Closing Day</strong> — Your lawyer will finalize all documents and transfer funds. Keys are yours!`,
      ];

      const prepItems = [
        `Contact your real estate lawyer immediately`,
        `Stay in close contact with your mortgage lender and respond to requests quickly`,
        `Book a moving company for your closing date`,
        `Arrange utility transfers — hydro, water, gas, internet`,
        `Set up home insurance before closing`,
        `Update your address with Canada Post, CRA, and your bank after closing`,
      ];

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        body{margin:0;padding:20px;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;}
        .wrap{max-width:560px;margin:0 auto;}
        table.dt{width:100%;border-collapse:collapse;margin:20px 0 24px;}
        table.dt tr{border-bottom:1px solid #eee;}
        table.dt tr:last-child{border-bottom:none;}
        table.dt td.lb{padding:9px 12px;color:#888;font-size:13px;width:38%;vertical-align:top;}
        table.dt td.vl{padding:9px 12px;color:#222;font-size:14px;font-weight:500;}
        hr{border:none;border-top:1px solid #eee;margin:24px 0;}
        .sig-name{font-weight:700;font-size:15px;}
        .sig-line{font-size:13px;color:#555;margin:2px 0;}
        .sig-line a{color:#1a6ef5;text-decoration:none;}
        .confidential{font-size:10px;color:#bbb;margin-top:20px;line-height:1.5;}
        .checklist-item{padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;}
        .checklist-item:last-child{border-bottom:none;}
        .prep-item{padding:5px 0;font-size:13px;color:#555;}
      </style></head><body><div class="wrap">
        <p>Hi ${firstName},</p>
        <p>🎉 <strong>Congratulations — your offer has been accepted!</strong> This is a huge milestone and I'm so excited for you. Here is a summary of your deal and a step-by-step checklist for everything that happens between now and closing day.</p>
        <table class="dt">${tableRows.join('')}</table>
        <p><strong>Your Closing Checklist</strong></p>
        <div>${checklistItems.map(item => `<div class="checklist-item">${item}</div>`).join('')}</div>
        <p style="margin-top:20px;"><strong>Start Planning Now</strong></p>
        <div>${prepItems.map(item => `<div class="prep-item">• ${item}</div>`).join('')}</div>
        <p style="margin-top:20px;">I'll be with you every step of the way. Please don't hesitate to call or message me anytime.</p>
        <hr>
        <p>Best regards,</p>
        <p class="sig-name">${agentName}</p>
        <p class="sig-line">REALTOR® | eXp Realty</p>
        <p class="sig-line"><a href="tel:${agentPhone}">${agentPhone}</a> &nbsp;|&nbsp; <a href="mailto:${agentEmail}">${agentEmail}</a></p>
        <p class="sig-line">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p>
        <p class="sig-line"><a href="https://${agentWebsite}">${agentWebsite}</a></p>
        <p class="confidential">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>
      </div></body></html>`;

      const body = `Hi ${firstName},

CONGRATULATIONS — your offer has been accepted! 🎉

Property:     ${offer.property_address}
Your Offer:   ${offerAmtFmt}${listPriceFmt ? `\nList Price:   ${listPriceFmt}` : ''}${offer.conditions ? `\nConditions:   ${offer.conditions}` : ''}${finDateFmt ? `\nFinancing By: ${finDateFmt}` : ''}${insDateFmt ? `\nInspection:   ${insDateFmt}` : ''}${closeDateFmt ? `\nClosing Date: ${closeDateFmt}` : ''}

YOUR CLOSING CHECKLIST:
${offer.deposit_sent ? `🏦 Deposit — ✅ ${depositAmtFmt || 'deposit'} sent to seller's agent.` : `🏦 DEPOSIT ⚠️ URGENT — ${depositAmtFmt || 'Deposit'} must reach seller's agent within 24 hours!${depositDueFmt ? ` Due by: ${depositDueFmt}.` : ''}`}
${offer.conditions ? `Conditions — ${offer.conditions} must be satisfied before the deal is firm.` : `📋 No conditions — your deal is already firm!`}
🏦 Financing — stay in close contact with your lender.${finDateFmt ? ` Deadline: ${finDateFmt}.` : ''}
🔍 Home Inspection — ${insDateFmt ? `scheduled for ${insDateFmt}.` : 'contact me for an inspector referral.'}
⚖️ Lawyer — contact a real estate lawyer right away to begin conveyancing.
🚶 Final Walkthrough — we'll confirm the property is as agreed before closing.
🔑 Closing Day${closeDateFmt ? ` — ${closeDateFmt}` : ''} — keys are yours once everything clears!

START PLANNING NOW:
• Contact your real estate lawyer immediately
• Stay in close contact with your mortgage lender
• Book a moving company for your closing date
• Arrange utility transfers (hydro, water, gas, internet)
• Set up home insurance before closing
• Update your address with Canada Post, CRA, and your bank after closing

I'll be with you every step of the way. Call or message me anytime!

Best regards,
${agentName}
REALTOR® | eXp Realty
${agentPhone} | ${agentEmail}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
${agentWebsite}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`;

      return {
        subject: `🎉 Congratulations — Your Offer Was Accepted! — ${offer.property_address}`,
        body,
        html
      };
    },

    conditions_reminder: (client, deal, daysLeft, conditionType, agent) => ({
      subject: `Reminder: ${conditionType} Condition Due in ${daysLeft} Day${daysLeft !== 1 ? 's' : ''}`,
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
      const agentWebsite = agent.website_url || 'maxwellmidodzi.exprealty.com';
      const responseLink = viewing._responseToken
        ? `https://maxwell-dealflow.vercel.app/respond?t=${viewing._responseToken}`
        : `https://maxwell-dealflow.vercel.app/respond?viewing_id=${viewing.id}&client_id=${client.id}`;
      const listPrice = viewing.list_price ? Number(viewing.list_price).toLocaleString('en-CA', {style:'currency',currency:'CAD',maximumFractionDigits:0}) : '';

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        body{margin:0;padding:20px;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;}
        .wrap{max-width:560px;margin:0 auto;}
        .cal-btn{display:block;text-align:center;background:#1a6ef5;color:#ffffff !important;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;margin:0 0 8px;}
        hr{border:none;border-top:1px solid #eee;margin:24px 0;}
        .sig-name{font-weight:700;font-size:15px;}
        .sig-line{font-size:13px;color:#555;margin:2px 0;}
        .sig-line a{color:#1a6ef5;text-decoration:none;}
        .confidential{font-size:10px;color:#bbb;margin-top:20px;line-height:1.5;}
      </style></head><body><div class="wrap">
        <p>Hi ${firstName},</p>
        <p>Based on your strong interest in <strong>${viewing.property_address}</strong>, I wanted to reach out about the next step.</p>
        ${listPrice ? `<p><strong>List Price:</strong> ${listPrice}</p>` : ''}
        <p>I've set up a simple page where you can let me know what you'd like to do — just click the button below:</p>
        <p>• <strong>Make an Offer</strong> — enter your preferred price and any notes<br>• <strong>Continue Searching</strong> — keep looking at other options<br>• <strong>Pass</strong> — this one isn't the right fit</p>
        <a class="cal-btn" href="${responseLink}">Let Me Know Your Decision</a>
        <p style="font-size:12px;color:#999;margin:0 0 24px;">No pressure — take your time. I'm here whenever you're ready.</p>
        <hr>
        <p>Best regards,</p>
        <p class="sig-name">${agentName}</p>
        <p class="sig-line">REALTOR® | eXp Realty</p>
        <p class="sig-line"><a href="tel:${agentPhone}">${agentPhone}</a> &nbsp;|&nbsp; <a href="mailto:${agentEmail}">${agentEmail}</a></p>
        <p class="sig-line">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p>
        <p class="sig-line"><a href="https://${agentWebsite || 'maxwellmidodzi.exprealty.com'}">${agentWebsite || 'maxwellmidodzi.exprealty.com'}</a></p>
        <p class="confidential">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>
      </div></body></html>`;

      return {
        subject: `Ready to Make an Offer? - ${viewing.property_address}`,
        body: `Hi ${firstName},

Based on your strong interest in ${viewing.property_address}, I wanted to reach out about the next step.
${listPrice ? `\nList Price: ${listPrice}\n` : ''}
I've set up a simple page where you can let me know what you'd like to do:
Click here to respond: ${responseLink}

Your options:
• Make an Offer — enter your preferred price and any notes
• Continue Searching — keep looking at other options
• Pass — this one isn't the right fit

No pressure — take your time. I'm here whenever you're ready!

Best regards,
${agentName}
REALTOR® | eXp Realty
${agentPhone} | ${agentEmail}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`,
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

    // ── OFFER ACCEPTED — full handoff dispatch templates ──────────────────
    // Used by Pipeline.submitAcceptedFlow when the agent taps "✅ Offer Accepted".
    // Each template matches Maxwell's professional eXp footer + confidentiality block.

    offer_accepted_client: (client, deal, agent, portalUrl) => {
      const first = client.full_name?.split(' ')[0] || 'there';
      const fmtDate = (d) => d ? (typeof App !== 'undefined' && App.fmtDate ? App.fmtDate(d) : d) : '—';
      return {
        subject: `🎉 Congratulations on your accepted offer — ${deal.property_address}`,
        body: `Hi ${first},

Congratulations — your offer has been accepted on ${deal.property_address}!

📍 Property: ${deal.property_address}
💰 Offer Amount: ${deal.offer_amount ? '$' + Number(deal.offer_amount).toLocaleString() : '—'}
📅 Closing Date: ${fmtDate(deal.closing_date)}
🏦 Financing Deadline: ${fmtDate(deal.financing_date)}
${deal.inspection_date ? '🔍 Inspection: ' + fmtDate(deal.inspection_date) : (deal.inspection_skipped ? '🔍 Inspection: Waived' : '')}

✅ Here's what happens next:
• I've sent the accepted offer and MLS listing to your lawyer — they'll be in touch within 24-48 hours to walk you through their requirements
• Your mortgage broker has the file and is starting the financing approval process
${deal.inspection_date ? '• Your inspector has been scheduled and will reach out to coordinate the visit' : ''}
• You can track your full deal progress here at any time:
   👉 ${portalUrl}

Take a moment to celebrate — this is a big milestone. I'll keep you updated as each piece of the process moves forward, and I'm here for any questions along the way.

Maxwell Delali Midodzi
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
      };
    },

    offer_accepted_broker: (brokerName, client, deal, agent, portalUrl) => {
      const first = brokerName?.split(' ')[0] || 'there';
      const clientFirst = client.full_name?.split(' ')[0] || 'the client';
      const fmtDate = (d) => d ? (typeof App !== 'undefined' && App.fmtDate ? App.fmtDate(d) : d) : '—';
      return {
        subject: `New file for your client — ${client.full_name || 'Buyer'} · ${deal.property_address}`,
        body: `Hi ${first},

${client.full_name || 'My buyer'}'s offer was accepted today on ${deal.property_address}. Please find the accepted offer and the MLS listing attached for your file.

📍 Property: ${deal.property_address}
💰 Purchase Price: ${deal.offer_amount ? '$' + Number(deal.offer_amount).toLocaleString() : '—'}
📅 Closing Date: ${fmtDate(deal.closing_date)}
🏦 Financing Deadline: ${fmtDate(deal.financing_date)}

📑 Attached:
• Accepted Offer
• MLS Listing

${clientFirst}'s contact information if you need to reach them directly is on file. Please let me know once financing is locked in or if you need anything further from my end.${portalUrl ? `

If it's easier to track on your end, I've set up a private portal for this deal where you can mark each step complete:
   👉 ${portalUrl}` : ''}

Maxwell Delali Midodzi
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
      };
    },

    offer_accepted_inspector: (inspectorName, client, deal, agent, portalUrl) => {
      const first = inspectorName?.split(' ')[0] || 'there';
      const fmtDate = (d) => d ? (typeof App !== 'undefined' && App.fmtDate ? App.fmtDate(d) : d) : '—';
      return {
        subject: `Inspection request — ${deal.property_address} · ${fmtDate(deal.inspection_date) || 'date TBD'}`,
        body: `Hi ${first},

I have a buyer with an accepted offer on ${deal.property_address}. I'd like to book an inspection — the MLS listing is attached for your reference.

📍 Property: ${deal.property_address}
📅 Proposed Inspection Date: ${fmtDate(deal.inspection_date)}
👤 Buyer: ${client.full_name || '—'}

📑 Attached:
• MLS Listing

Please confirm availability for the proposed date or send back a few options that work, and I'll coordinate access with the listing agent. Once the inspection is complete, please send me the report directly.${portalUrl ? `

I've also set up a private portal where you can confirm completion when the inspection is done:
   👉 ${portalUrl}` : ''}

Maxwell Delali Midodzi
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
      };
    },

    offer_accepted_lawyer: (lawyerName, client, deal, agent, portalUrl) => {
      const first = lawyerName?.split(' ')[0] || 'Counsel';
      const clientFirst = client.full_name?.split(' ')[0] || 'the buyer';
      const fmtDate = (d) => d ? (typeof App !== 'undefined' && App.fmtDate ? App.fmtDate(d) : d) : '—';
      return {
        subject: `New file for your client — ${client.full_name || 'Buyer'} · ${deal.property_address}`,
        body: `Hi ${first},

${client.full_name || 'My buyer'}'s offer was accepted today on ${deal.property_address}. Please find the accepted offer and the MLS listing attached.

📍 Property: ${deal.property_address}
💰 Purchase Price: ${deal.offer_amount ? '$' + Number(deal.offer_amount).toLocaleString() : '—'}
📅 Closing Date: ${fmtDate(deal.closing_date)}
🏦 Financing Deadline: ${fmtDate(deal.financing_date)}

📑 Attached:
• Accepted Offer
• MLS Listing

I've cc'd ${clientFirst} on this email so you have an open line of communication for any documentation requests on your end. Please let me know if you need anything additional from me to move forward.${portalUrl ? `

I've also set up a private portal where you can mark title search, funds-in-trust, and ready-to-close as each step completes:
   👉 ${portalUrl}` : ''}

Maxwell Delali Midodzi
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
      };
    },

    // ── DEAL CLOSED — thank-you fan-out to all stakeholders ──────────────
    closing_day_stakeholder_thanks: (stakeholderName, role, client, deal, agent) => {
      const first = stakeholderName?.split(' ')[0] || 'there';
      const fmtDate = (d) => d ? (typeof App !== 'undefined' && App.fmtDate ? App.fmtDate(d) : d) : '—';
      const roleLbl = role === 'mortgage_broker' ? 'work on the financing'
                    : role === 'inspector'       ? 'thorough inspection'
                    : role === 'lawyer'          ? 'work on the legal side'
                    : role === 'builder'         ? 'work throughout the build'
                    : 'work on this file';
      return {
        subject: `Thank you — ${client.full_name || 'client'}'s deal closed on ${fmtDate(deal.closing_date)}`,
        body: `Hi ${first},

Wanted to send a quick note: ${client.full_name || 'my client'}'s deal on ${deal.property_address} closed today.

📍 Property: ${deal.property_address}
📅 Closed: ${fmtDate(deal.closing_date)}

Thank you for your ${roleLbl} on this one — it was a pleasure working with you, and I appreciated the responsiveness throughout.

I'll keep you in mind for the next file. If you have a moment, please feel free to reply with any feedback on how we worked together — always trying to make the process smoother for the next deal.

Maxwell Delali Midodzi
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
      };
    },

    walkthrough_reminder: (client, deal, agent) => ({
      subject: `Reminder: Final Walkthrough Tomorrow — ${deal.property_address}`,
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

      const agentWebsite = agent.website_url || 'maxwellmidodzi.exprealty.com';

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        body{margin:0;padding:20px;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;}
        .wrap{max-width:560px;margin:0 auto;}
        .cal-btn{display:block;text-align:center;background:#1a6ef5;color:#ffffff !important;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;margin:0 0 8px;}
        hr{border:none;border-top:1px solid #eee;margin:24px 0;}
        .sig-name{font-weight:700;font-size:15px;}
        .sig-line{font-size:13px;color:#555;margin:2px 0;}
        .sig-line a{color:#1a6ef5;text-decoration:none;}
        .confidential{font-size:10px;color:#bbb;margin-top:20px;line-height:1.5;}
        .stage-row{padding:8px 0;border-bottom:1px solid #eee;font-size:14px;}
        .stage-row:last-child{border-bottom:none;}
      </style></head><body><div class="wrap">
        <p>Hi ${firstName},</p>
        <p>🏗️ Exciting news — your new home at <strong>${build.lot_address}</strong> has reached a new milestone!</p>
        <p><strong>Current Stage: ▶️ ${newStage}</strong></p>
        ${estCloseStr ? `<p>📅 <strong>Estimated Possession Date:</strong> ${estCloseStr}</p>` : ''}
        <p><strong>Build Progress</strong></p>
        <div>${STAGE_ORDER.map(s => {
          const isDone = STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(newStage);
          const isCurrent = s === newStage;
          const icon = isDone ? '✅' : isCurrent ? '▶️' : '○';
          const color = isDone ? '#059669' : isCurrent ? '#1a6ef5' : '#9ca3af';
          const weight = isCurrent ? 'font-weight:700;' : '';
          return `<div class="stage-row" style="color:${color};${weight}">${icon}&nbsp; ${s}</div>`;
        }).join('')}</div>
        <br>
        <a class="cal-btn" href="${trackerLink}">View Full Build Progress →</a>
        <p style="font-size:12px;color:#999;margin:0 0 16px;">Click above to view your complete build tracker.</p>
        <p>If you have any questions about this stage or the construction timeline, please don't hesitate to reach out.</p>
        <hr>
        <p>Best regards,</p>
        <p class="sig-name">${agentName}</p>
        <p class="sig-line">REALTOR® | eXp Realty</p>
        <p class="sig-line"><a href="tel:${agentPhone}">${agentPhone}</a> &nbsp;|&nbsp; <a href="mailto:${agentEmail}">${agentEmail}</a></p>
        <p class="sig-line">eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2</p>
        <p class="sig-line"><a href="https://${agentWebsite}">${agentWebsite}</a></p>
        <p class="confidential">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>
      </div></body></html>`;

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
${listing.mls_number ? `🏷️ MLS#: ${listing.mls_number}\n` : ''}${listing.list_price ? `💰 List Price: ${App.fmtMoney(listing.list_price)}\n` : ''}${listing.bedrooms ? `🛏 Bedrooms: ${listing.bedrooms}\n` : ''}${listing.notes ? `Notes: ${listing.notes}\n` : ''}
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

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        body{margin:0;padding:20px;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;color:#222;line-height:1.6;}
        .wrap{max-width:560px;margin:0 auto;}
        hr{border:none;border-top:1px solid #eee;margin:24px 0;}
        .sig-name{font-weight:700;font-size:15px;}
        .sig-line{font-size:13px;color:#555;margin:2px 0;}
        .sig-line a{color:#1a6ef5;text-decoration:none;}
        .confidential{font-size:10px;color:#bbb;margin-top:20px;line-height:1.5;}
        .step-row{padding:12px 0;border-bottom:1px solid #eee;font-size:14px;}
        .step-row:last-child{border-bottom:none;}
      </style></head><body><div class="wrap">
        <p>Hi ${firstName},</p>
        <p>🎉 <strong>Welcome!</strong> Thank you for choosing me as your real estate agent. I'm excited to help you find your perfect home.</p>
        <p><strong>Here's what happens next:</strong></p>
        <div>
          ${steps.map(s => `<div class="step-row"><strong>${s.n}. ${s.title}</strong> — ${s.desc}</div>`).join('')}
        </div>
        ${criteriaLines.length ? `
        <p style="margin-top:20px;"><strong>Your Search Criteria on File</strong></p>
        <div>${criteriaHTML}</div>` : ''}
        <p style="margin-top:20px;">Feel free to reach out anytime — I'm here to help!</p>
        <hr>
        <p>Best regards,</p>
        <p class="sig-name">${agentName}</p>
        <p class="sig-line">REALTOR® | eXp Realty</p>
        <p class="sig-line"><a href="tel:${agentPhone}">${agentPhone}</a> &nbsp;|&nbsp; <a href="mailto:${agentEmail}">${agentEmail}</a></p>
        <p class="sig-line">eXp Realty, ${agentAddress}</p>
        <p class="sig-line"><a href="https://${agentWebsite}">${agentWebsite}</a></p>
        <p class="confidential">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>
      </div></body></html>`;

      const plainText = `Hi ${firstName},

Welcome! I'm ${agentName} and I'm thrilled to be working with you on your real estate journey.

Here's what happens next:
1. Discovery Call — We'll discuss your needs, budget, and timeline
2. Property Search — I'll share listings that match your criteria
3. Viewings — We'll tour properties together
4. Offer & Closing — I'll negotiate the best deal for you

Feel free to reach out anytime — I'm here to help!

Best regards,
${agentName}
REALTOR® | eXp Realty
${agentPhone} | ${agentEmail}
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

  async queue(type, clientId, clientName, clientEmail, emailSubject, emailBody, relatedId = null, htmlBody = null, icsBase64 = null, ccEmail = null, fileAttachments = null, batchId = null) {
    // Always use the Supabase Auth UID — this must match auth.uid() for RLS to pass
    const { data: { user } } = await db.auth.getUser();
    const agentId = user?.id || currentAgent?.id;
    if (!agentId) { console.error('Notify.queue: no auth user found'); return; }
    // Pack html + ics + real file attachments into context_data
    let contextData = null;
    if (htmlBody || icsBase64 || ccEmail || fileAttachments?.length) {
      const safeHtml = htmlBody ? btoa(unescape(encodeURIComponent(htmlBody))) : null;
      contextData = {
        html: safeHtml, ics: icsBase64 || null, cc: ccEmail || null,
        attachments: fileAttachments?.length ? fileAttachments : null
      };
    }
    const insertRow = {
      agent_id: agentId,
      client_name: clientName,
      client_email: clientEmail,
      approval_type: type,
      email_subject: emailSubject,
      email_body: emailBody,
      status: 'Pending'
    };
    // Only include optional fields when they have actual values — never send null for jsonb columns
    if (contextData !== null) insertRow.context_data = contextData;
    if (relatedId) insertRow.related_id = relatedId;
    if (batchId)   insertRow.batch_id   = batchId;
    const { data: queued, error } = await db.from('approval_queue').insert(insertRow).select('id').single();
    if (error) {
      console.error('Notify.queue insert error:', error);
      App.toast(`⚠️ ${error.code || ''} ${error.message} | hint: ${error.hint || ''} | details: ${error.details || ''}`, 'var(--red)');
      return false;
    }
    // ── AUTO-APPROVE CHECK ──────────────────────────────────────────────
    const ap = JSON.parse(localStorage.getItem('df-auto-approve') || '{}');
    const t = type.toLowerCase();
    const shouldAuto = (
      (ap.viewing  && (t.startsWith('viewing') || t.startsWith('post-viewing'))) ||
      (ap.offer    && t.includes('offer')) ||
      (ap.reminder && (t.includes('reminder') || t.includes('countdown') || t.includes('closing day'))) ||
      (ap.followup && t.includes('follow-up')) ||
      (ap.morning  && t.includes('morning'))
    );
    if (shouldAuto && queued?.id) {
      setTimeout(() => { if (typeof Approvals !== 'undefined') Approvals.approve(queued.id); }, 700);
      Notify.updateBadge();
      App.toast(`⚡ Auto-sending: ${type}`, 'var(--green)');
      return true;
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
    const { data: { user } } = await db.auth.getUser();
    const agentId = user?.id || currentAgent?.id;
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

  // Rich version with full closing checklist — used from manual offer entry
  async onOfferAcceptedWithChecklist(offer, client, offerId = null) {
    const agent = currentAgent;
    const tmpl = Notify.templates.offer_accepted_checklist(client, offer, agent);
    await Notify.queue(
      'Offer Accepted 🎉',
      client.id || null, client.full_name, client.email,
      tmpl.subject, tmpl.body, offerId,
      tmpl.html   // rich HTML with full checklist + next steps
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
    const justCompletedIds = [];

    for (const v of viewings) {
      if (!v.viewing_date) continue;

      // Calculate when the viewing actually ends (start + actual viewing duration)
      let viewingEndTime;
      if (v.viewing_time) {
        viewingEndTime = new Date(v.viewing_date + 'T' + v.viewing_time);
        viewingEndTime.setMinutes(viewingEndTime.getMinutes() + (v.viewing_duration || 30)); // use saved duration
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

      // Determine when to trigger: right after viewing if urgent, or +5 min buffer if not
      let triggerTime;
      if (hasUrgentDeadline) {
        triggerTime = viewingEndTime; // No buffer — notify immediately after viewing ends
      } else {
        triggerTime = new Date(viewingEndTime.getTime() + 5 * 60 * 1000); // 5 min buffer
      }

      if (now > triggerTime) {
        // Time has passed — auto-complete this viewing
        await db.from('viewings').update({
          viewing_status: 'Completed',
          updated_at: new Date().toISOString()
        }).eq('id', v.id);

        completedCount++;
        justCompletedIds.push(v.id);

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

    // If any viewings were auto-completed — show feedback modal automatically
    if (completedCount > 0) {
      if (typeof Viewings !== 'undefined') {
        await Viewings.load();
        // Pop the agent feedback modal so they don't have to tap anything
        setTimeout(() => Viewings.agentFeedbackModal(justCompletedIds[0]), 600);
      }
      App.toast(
        `🏠 ${completedCount} viewing${completedCount > 1 ? 's' : ''} done — how did it go?`,
        'var(--accent2)'
      );
    }

    // ── Also surface feedback modal for viewings already Completed but no response yet ──
    // Handles the push-tap scenario: agent taps notification, opens app,
    // checkCompletedViewings runs — viewing is already Completed but agent never responded
    if (completedCount === 0 && typeof Viewings !== 'undefined') {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: needsReply } = await db.from('viewings')
        .select('id')
        .in('client_id', clientIds)
        .eq('viewing_status', 'Completed')
        .is('client_feedback', null)
        .is('client_response', null)
        .gte('updated_at', twoHoursAgo)
        .limit(1)
        .maybeSingle();
      if (needsReply?.id) {
        await Viewings.load();
        setTimeout(() => Viewings.agentFeedbackModal(needsReply.id), 600);
      }
    }
  }
};
