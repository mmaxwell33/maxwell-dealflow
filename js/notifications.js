// Maxwell DealFlow CRM — Client Notification System v2
// Every email goes to Approvals first — Maxwell approves before it sends

// ── EmailFormat ──────────────────────────────────────────────────────────────
// Single source of truth for email styling, signature, disclaimer, and body
// wrapping. Used by both Notify templates (in this file) and EmailSend
// (in extras.js). Designed for maximum compatibility across Gmail, Outlook
// for Mac/Windows/Web, Apple Mail, Thunderbird, mobile clients.
//
// Why tables for the signature instead of <div>s: Outlook for Windows
// renders <div> spacing inconsistently. Tables with explicit cellpadding +
// inline styles render correctly everywhere.
//
// Why Unicode emojis for icons (📞 ✉️ 🌐) instead of SVG/PNG: ~95% client
// support out of the box, no asset hosting, no CSP issues. The 5% of clients
// that strip emojis (some corporate Outlook variants) still see the label
// text after the icon, so signature stays readable.
// ─────────────────────────────────────────────────────────────────────────────

const EmailFormat = {

  // Pull agent contact fields with sensible defaults.
  // Note: "role" here is the job title (e.g. "REALTOR® | eXp Realty"), never
  // agent.role — that column is the app permission flag ('agent'/'broker')
  // and must not leak into client-facing signatures.
  _agent(agent) {
    const a = agent || {};
    return {
      name:    a.full_name || a.name || 'Maxwell Delali Midodzi',
      role:    'REALTOR® | eXp Realty',
      phone:   a.phone || '709.325.0545',
      email:   a.email || 'maxwell.midodzi@exprealty.com',
      website: a.website_url || 'maxwellmidodzi.com',
    };
  },

  // Strip non-digit chars from phone for tel: links
  _phoneTel(phone) {
    return String(phone || '').replace(/[^0-9+]/g, '');
  },

  // ── Shared <style> block used in the <head> of every wrapped HTML email ──
  // PR #43: stripped the "newsletter" container (max-width 600px, centered,
  // cream background, heavy padding) per Maxwell's 2026-05-18 feedback —
  // emails were rendering as a narrow column with empty space on both
  // sides, looking like a marketing template rather than a real personal
  // email. Now the body fills the natural width of the email client's
  // reading pane, just like a Gmail-composed email. Signature styling
  // stays — that's where icons + brand still belong.
  styles() {
    return `
      body{margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222222;line-height:1.5;}
      /* Body paragraphs — generous spacing so the email actually breathes */
      .body p{margin:0 0 12px;}
      .body p:last-child{margin-bottom:0;}
      .body strong{color:#000000;}
      /* Data tables (used by Notify templates for viewing/offer details) */
      table.dt{width:100%;border-collapse:collapse;margin:20px 0 24px;}
      table.dt tr{border-bottom:1px solid #e6e6e6;}
      table.dt tr:last-child{border-bottom:none;}
      table.dt td.lb,table.dt td.label{padding:10px 12px;color:#6b7280;font-size:13px;width:38%;vertical-align:top;}
      table.dt td.vl,table.dt td.value{padding:10px 12px;color:#1a1917;font-size:14px;font-weight:500;}
      /* Calendar / CTA button */
      .cal-btn{display:block;text-align:center;background:#1a6ef5;color:#ffffff !important;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:6px;margin:20px 0 8px;}
      .cal-note{font-size:12px;color:#9ca3af;margin:0 0 24px;}
      /* Signature block */
      hr.sig-divider{border:none;border-top:1px solid #e6e6e6;margin:28px 0 20px;}
      table.sig{border-collapse:collapse;margin:0;}
      table.sig td{font-family:'Helvetica Neue',Arial,sans-serif;padding:0;}
      .sig-name{font-size:16px;font-weight:600;color:#0f172a;letter-spacing:-0.005em;padding-bottom:2px;}
      .sig-role{font-size:13px;color:#6b7280;padding-bottom:14px;}
      .sig-row{font-size:14px;color:#374151;padding:3px 0;}
      .sig-row a{color:#374151;text-decoration:none;border-bottom:1px solid transparent;}
      .sig-row a:hover{border-bottom-color:#1a6ef5;}
      .sig-icon{display:inline-block;width:22px;}
      /* Disclaimer */
      hr.dis-divider{border:none;border-top:1px solid #e6e6e6;margin:20px 0 12px;}
      .disclaimer{font-size:10.5px;color:#9ca3af;line-height:1.55;margin:0;}
      .disclaimer strong{color:#6b7280;font-weight:600;}
    `;
  },

  // ── HTML signature block ──
  // If the agent has saved a custom signature in Settings, that's the single
  // source of truth and is used verbatim (so what Maxwell sees in Settings ->
  // Email Signature is what clients actually receive). Otherwise falls back
  // to the generated contact-block signature.
  signatureHTML(agent) {
    const custom = (agent && agent.email_signature || '').trim();
    if (custom) {
      const escaped = custom
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      return `
      <p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:#202124;">${escaped}</p>`;
    }
    const a = EmailFormat._agent(agent);
    const tel = EmailFormat._phoneTel(a.phone);
    // Plain "real email" signature (no icons / no big bold name / no table) so the
    // rendered HTML matches the clean plain-text look, not a designed template block.
    return `
      <p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:#202124;">
        ${a.name}<br>
        ${a.role}<br>
        Phone: <a href="tel:${tel}" style="color:#1a73e8;text-decoration:none;">${a.phone}</a> | Email: <a href="mailto:${a.email}" style="color:#1a73e8;text-decoration:none;">${a.email}</a><br>
        eXp Realty, 33 Pippy Place, Suite 101, St. John's, NL A1B 3X2<br>
        <a href="https://${a.website}" style="color:#1a73e8;text-decoration:none;">${a.website}</a>
      </p>`;
  },

  // ── HTML disclaimer block — separator + confidentiality notice (plain, readable) ──
  disclaimerHTML() {
    return `
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0 10px;">
      <p style="margin:0;font-size:12px;line-height:1.5;color:#5f6368;">CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.</p>`;
  },

  // ── Plain-text signature (for Gmail's plain-text fallback) ──
  // Same custom-signature-wins rule as signatureHTML() above.
  signaturePlain(agent) {
    const custom = (agent && agent.email_signature || '').trim();
    if (custom) return custom;
    const a = EmailFormat._agent(agent);
    return `${a.name}\n${a.role}\n\n📞   ${a.phone}\n✉️   ${a.email}\n🌐   ${a.website}`;
  },

  // ── Plain-text disclaimer ──
  disclaimerPlain() {
    return `\n---\n\nCONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`;
  },

  // ── Map block — pin + address + "open map" button ──
  // Emails can't embed a live zoomable map (they're static documents), so this
  // deep-links to Google Maps: the client taps once and gets the full
  // interactive map — zoom, street view, directions. No API key, renders in
  // every email client. Skips itself when no address is available.
  _mapUrl(address) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address || ''); },
  mapBlockHTML(address) {
    if (!address) return '';
    return `
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:14px 0;border:1px solid #e0e0e0;border-radius:10px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:12px;color:#5f6368;margin-bottom:2px;">📍 LOCATION</div>
          <div style="font-size:14px;font-weight:600;color:#202124;margin-bottom:10px;">${address}</div>
          <a href="${EmailFormat._mapUrl(address)}" target="_blank" style="display:inline-block;background:#1a73e8;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:9px 16px;border-radius:8px;">🗺️ Open Map — zoom in &amp; get directions</a>
        </td></tr>
      </table>`;
  },
  mapLinkPlain(address) {
    if (!address) return '';
    return `\n\n📍 Map & directions: ${EmailFormat._mapUrl(address)}`;
  },

  // ── Convert user-typed body to HTML with proper paragraph spacing ──
  // Input may be plain text with \n\n paragraph breaks, OR already-rich HTML
  // (from a contenteditable editor). Detects which and produces a body
  // wrapped in <div class="body"> with real <p> tags between paragraphs.
  bodyHTML(bodyText) {
    if (!bodyText) return '<div class="body"></div>';
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(bodyText);
    if (looksLikeHtml) {
      // Already HTML — trust it but wrap in .body so paragraph CSS applies.
      // Convert any stray double newlines to paragraph breaks too.
      return `<div class="body">${bodyText}</div>`;
    }
    // Plain text: escape HTML, then split into paragraphs on blank lines.
    const escaped = bodyText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const paragraphs = escaped
      .split(/\n\s*\n/)              // blank-line separators
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)  // single \n inside paragraphs becomes <br>
      .join('\n      ');
    return `<div class="body">\n      ${paragraphs}\n    </div>`;
  },

  // ── Full HTML email wrapper — body + signature + disclaimer ──
  // Used by EmailSend (manual compose). Notify templates assemble their
  // own body content but reuse styles() + signatureHTML() + disclaimerHTML().
  //
  // PR #41: removed the inline "📎 Attachment: filename" line. Email
  // clients already display attachments as native chips below the body;
  // a text line in the body is redundant and looks amateurish.
  htmlEmail(bodyContent, agent) {
    // PR #43: no .wrap container — body flows naturally to the width of
    // the recipient's email reading pane, matching how a Gmail-composed
    // email looks. Removes the "centered newsletter column" feel.
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${EmailFormat.styles()}</style>
</head><body>
${bodyContent}
${EmailFormat.signatureHTML(agent)}
${EmailFormat.disclaimerHTML()}
</body></html>`;
  },
};

const Notify = {

  // ── EMAIL TEMPLATES ────────────────────────────────────────────────────────

  templates: {

    viewing_confirmation: (client, viewing, agent, isUpdate = false) => {
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const agentWebsite = agent.website_url || 'maxwellmidodzi.com';
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
      const body = `Hi ${firstName},\n\n${introLine}\n\nProperty: ${viewing.property_address}${viewing.mls_number ? '\nMLS#: ' + viewing.mls_number : ''}${viewing.list_price ? '\nList Price: ' + App.fmtMoney(viewing.list_price) : ''}\nDate: ${dateStr}${timeStr ? '\nTime: ' + fmt12h(timeStr) : ''}${offerDueLine}${sellersLine}${viewing.agent_notes ? '\nNotes: ' + viewing.agent_notes : ''}\n\nA calendar invite is attached — open it to add this viewing to your calendar.${EmailFormat.mapLinkPlain(viewing.property_address)}\n\nLooking forward to seeing you!\n\n${EmailFormat.signaturePlain(agent)}`;

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

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${firstName},</p>
        <p>${isUpdate ? 'Your viewing details have been <strong>updated</strong>. Here is the latest information:' : 'Your viewing has been confirmed. Here are the details:'}</p>
        <table class="dt">${tableRows.join('')}</table>
        <a class="cal-btn" href="${gcalUrl}" target="_blank">Add to Calendar</a>
        <p class="cal-note">Click the button above to add this viewing to your Google Calendar. An .ics file is also attached for other calendar apps.</p>
        ${EmailFormat.mapBlockHTML(viewing.property_address)}
        <p>Please don't hesitate to reach out if you have any questions or need to reschedule.</p>
        <p>Looking forward to seeing you!</p>
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;

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
        `ATTENDEE;CN=${client.full_name};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${client.email || agentEmail}`,
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const icsBase64 = btoa(unescape(encodeURIComponent(icsContent)));

      return { subject: isUpdate ? `Viewing Update - ${viewing.property_address}` : `Viewing Confirmed - ${viewing.property_address}`, body, html, ics: icsBase64 };
    },

    // ── BUILDER MEETING INVITE ─────────────────────────────────────────────
    // Mirrors the viewing-confirmed template: details table + Add-to-Calendar
    // button + an attached .ics. Used when scheduling a meeting between the
    // client and a builder.
    builder_meeting: (client, meeting, agent) => {
      const a = EmailFormat._agent(agent);
      const agentName = a.name, agentPhone = a.phone, agentEmail = a.email;
      const firstName = client.full_name?.split(' ')[0] || 'there';
      const dateStr = new Date(meeting.meeting_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      const fmt12h = (t) => { if (!t) return null; const [h,m] = t.split(':').map(Number); const ap = h>=12?'PM':'AM'; return `${h%12||12}:${String(m).padStart(2,'0')} ${ap}`; };
      const timeStr = meeting.meeting_time ? meeting.meeting_time.slice(0,5) : null;
      const builder = meeting.builder_name || 'the builder';
      // If the client may not recognise the name, the form passes a role label
      // (e.g. "builder", "electrician") so the email reads "Dave, the builder".
      const builderRole = meeting.builder_label ? `, the ${meeting.builder_label}` : '';
      const builderFull = builder + builderRole;
      const loc = meeting.location || 'TBD';

      const rows = [];
      // (No "Builder" row — the intro line already says "your meeting with X".)
      rows.push(`<tr><td class="label">Location</td><td class="value">${loc}</td></tr>`);
      rows.push(`<tr><td class="label">Date</td><td class="value">${dateStr}</td></tr>`);
      if (timeStr) rows.push(`<tr><td class="label">Time</td><td class="value">${fmt12h(timeStr)}</td></tr>`);
      if (meeting.notes) rows.push(`<tr><td class="label">Notes</td><td class="value">${meeting.notes}</td></tr>`);

      // Google Calendar "Add to Calendar" link
      let gStart, gEnd;
      if (meeting.meeting_time) {
        const [gh, gm] = meeting.meeting_time.split(':');
        const s = new Date(`${meeting.meeting_date}T${gh.padStart(2,'0')}:${gm.padStart(2,'0')}:00`);
        const e = new Date(s.getTime() + 60*60*1000); // 1 hour
        gStart = s.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
        gEnd   = e.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
      } else { gStart = meeting.meeting_date.replace(/-/g,''); gEnd = gStart; }
      const gcalUrl = `https://calendar.google.com/calendar/event?action=TEMPLATE&text=${encodeURIComponent('Meeting with ' + builder)}&dates=${gStart}/${gEnd}&location=${encodeURIComponent(loc)}&details=${encodeURIComponent('Builder meeting arranged by ' + agentName + '\nPhone: ' + agentPhone + '\nEmail: ' + agentEmail)}`;

      // Mirror the viewing-confirmation template exactly: same intro→table→
      // Add-to-Calendar→cal-note→reach-out line→sign-off→signature→disclaimer.
      const body = `Hi ${firstName},\n\nI've arranged your meeting with ${builderFull}.\n\nLocation: ${loc}\nDate: ${dateStr}${timeStr ? '\nTime: ' + fmt12h(timeStr) : ''}${meeting.notes ? '\nNotes: ' + meeting.notes : ''}\n\nA calendar invite is attached — open it to add this meeting to your calendar.${EmailFormat.mapLinkPlain(meeting.location)}\n\nPlease don't hesitate to reach out if you have any questions or need to reschedule.\n\nLooking forward to it!\n\n${EmailFormat.signaturePlain(agent)}`;

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${firstName},</p>
        <p>I've arranged your meeting with <strong>${builder}</strong>${builderRole}. Here are the details:</p>
        <table class="dt">${rows.join('')}</table>
        <a class="cal-btn" href="${gcalUrl}" target="_blank">Add to Calendar</a>
        <p class="cal-note">Click the button above to add this meeting to your Google Calendar. An .ics file is also attached for other calendar apps.</p>
        ${EmailFormat.mapBlockHTML(meeting.location)}
        <p>Please don't hesitate to reach out if you have any questions or need to reschedule.</p>
        <p>Looking forward to it!</p>
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;

      // ── .ICS INVITE ────────────────────────────────────────────────────────
      const uid = `meeting-${meeting.id || Date.now()}@maxwell-dealflow`;
      const dtStamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'') + 'Z';
      let dtStart, dtEnd;
      if (meeting.meeting_time) {
        const [h, m] = meeting.meeting_time.split(':');
        const s = new Date(`${meeting.meeting_date}T${h.padStart(2,'0')}:${m.padStart(2,'0')}:00`);
        const e = new Date(s.getTime() + 60*60*1000);
        dtStart = s.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'') + 'Z';
        dtEnd   = e.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'') + 'Z';
      } else { dtStart = meeting.meeting_date.replace(/-/g,''); dtEnd = dtStart; }
      const dateProps = meeting.meeting_time
        ? `DTSTART:${dtStart}\r\nDTEND:${dtEnd}`
        : `DTSTART;VALUE=DATE:${dtStart}\r\nDTEND;VALUE=DATE:${dtEnd}`;
      const icsContent = [
        'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Maxwell DealFlow CRM//EN','CALSCALE:GREGORIAN','METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        dateProps,
        `SUMMARY:Meeting with ${builder}`,
        `DESCRIPTION:Builder meeting arranged by ${agentName}\\n${agentPhone}\\n${agentEmail}${meeting.notes ? '\\nNotes: ' + meeting.notes : ''}`,
        `LOCATION:${loc}`,
        `ORGANIZER;CN=${agentName}:mailto:${agentEmail}`,
        `ATTENDEE;CN=${client.full_name || 'Client'};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${client.email || agentEmail}`,
        'STATUS:CONFIRMED','SEQUENCE:0','END:VEVENT','END:VCALENDAR'
      ].join('\r\n');
      const icsBase64 = btoa(unescape(encodeURIComponent(icsContent)));

      return { subject: `Meeting with ${builder} — ${dateStr}`, body, html, ics: icsBase64 };
    },

    viewing_followup: (client, viewing, feedback, agent) => ({
      subject: `Follow-Up: ${viewing.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

Thank you for viewing ${viewing.property_address} ${feedback === 'interested' ? '— great choice! 🌟' : feedback === 'good' ? '— glad you liked it!' : 'today.'}

${feedback === 'interested' ? `Based on your strong interest, I'd recommend we discuss making an offer soon. Properties like this don't stay on the market long!\n\nWould you like to schedule a call to go over the offer process?` : feedback === 'good' ? `I'm glad you found it interesting. Would you like to see any other properties, or would you like to discuss this one further?` : `No worries at all — finding the right home takes time. I have other listings that might be a better fit. Shall I send some options your way?`}

Let me know your thoughts!

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    // ── OFFER ACCEPTED WITH FULL CLOSING CHECKLIST ────────────────────────────
    offer_accepted_checklist: (client, offer, agent) => {
      const firstName = client.full_name?.split(' ')[0] || 'there';
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const agentWebsite = agent.website_url || 'maxwellmidodzi.com';

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

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${firstName},</p>
        <p>🎉 <strong>Congratulations — your offer has been accepted!</strong> This is a huge milestone and I'm so excited for you. Here is a summary of your deal and a step-by-step checklist for everything that happens between now and closing day.</p>
        <table class="dt">${tableRows.join('')}</table>
        <p><strong>Your Closing Checklist</strong></p>
        <div>${checklistItems.map(item => `<div class="checklist-item">${item}</div>`).join('')}</div>
        <p style="margin-top:20px;"><strong>Start Planning Now</strong></p>
        <div>${prepItems.map(item => `<div class="prep-item">• ${item}</div>`).join('')}</div>
        <p style="margin-top:20px;">I'll be with you every step of the way. Please don't hesitate to call or message me anytime.</p>
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;

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
${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.

P.S. Don't hesitate to reach out anytime — even just to say hello from your new home! 😊`
    }),

    ready_to_offer: (client, viewing, agent) => {
      const firstName = client.full_name?.split(' ')[0] || 'there';
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const agentWebsite = agent.website_url || 'maxwellmidodzi.com';
      const responseLink = viewing._responseToken
        ? `https://maxwellmidodzi.com/respond?t=${viewing._responseToken}`
        : `https://maxwellmidodzi.com/respond?viewing_id=${viewing.id}&client_id=${client.id}`;
      const listPrice = viewing.list_price ? Number(viewing.list_price).toLocaleString('en-CA', {style:'currency',currency:'CAD',maximumFractionDigits:0}) : '';

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${firstName},</p>
        <p>Based on your strong interest in <strong>${viewing.property_address}</strong>, I wanted to reach out about the next step.</p>
        ${listPrice ? `<p><strong>List Price:</strong> ${listPrice}</p>` : ''}
        <p>I've set up a simple page where you can let me know what you'd like to do — just click the button below:</p>
        <p>• <strong>Make an Offer</strong> — enter your preferred price and any notes<br>• <strong>Continue Searching</strong> — keep looking at other options<br>• <strong>Pass</strong> — this one isn't the right fit</p>
        <a class="cal-btn" href="${responseLink}">Let Me Know Your Decision</a>
        <p style="font-size:12px;color:#999;margin:0 0 24px;">No pressure — take your time. I'm here whenever you're ready.</p>
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;

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
${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

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

Property: ${deal.property_address}
${deal.list_price ? 'List Price: $' + Number(deal.list_price).toLocaleString() + '\n' : ''}Purchase Price: ${deal.offer_amount ? '$' + Number(deal.offer_amount).toLocaleString() : '—'}
Closing Date: ${fmtDate(deal.closing_date)}
Financing Deadline: ${fmtDate(deal.financing_date)}

BUYER CONTACT
   Name: ${client.full_name || '—'}
   Email: ${client.email || '—'}
   Phone: ${client.phone || '—'}

Attached:
• Accepted Offer
• MLS Listing

Please let me know once financing is locked in or if you need anything further from my end.${portalUrl ? `

If it's easier to track on your end, I've set up a private portal for this deal where you can mark each step complete:
   ${portalUrl}` : ''}

${EmailFormat.signaturePlain(agent)}

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

Property: ${deal.property_address}
Proposed Inspection Date: ${fmtDate(deal.inspection_date)}

BUYER CONTACT
   Name: ${client.full_name || '—'}
   Email: ${client.email || '—'}
   Phone: ${client.phone || '—'}

Attached:
• MLS Listing

Please confirm availability for the proposed date or send back a few options that work, and I'll coordinate access with the listing agent. Once the inspection is complete, please send me the report directly.${portalUrl ? `

I've also set up a private portal where you can confirm completion when the inspection is done:
   ${portalUrl}` : ''}

${EmailFormat.signaturePlain(agent)}

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

Property: ${deal.property_address}
${deal.list_price ? 'List Price: $' + Number(deal.list_price).toLocaleString() + '\n' : ''}Purchase Price: ${deal.offer_amount ? '$' + Number(deal.offer_amount).toLocaleString() : '—'}
Closing Date: ${fmtDate(deal.closing_date)}
Financing Deadline: ${fmtDate(deal.financing_date)}

BUYER CONTACT
   Name: ${client.full_name || '—'}
   Email: ${client.email || '—'}
   Phone: ${client.phone || '—'}

Attached:
• Accepted Offer
• MLS Listing

I've cc'd ${clientFirst} on this email so you have an open line of communication for any documentation requests on your end. Please let me know if you need anything additional from me to move forward.${portalUrl ? `

I've also set up a private portal where you can mark title search, funds-in-trust, and ready-to-close as each step completes:
   ${portalUrl}` : ''}

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
      };
    },

    // ── Closing rescheduled — sent when Pipeline.rescheduleClosing fires.
    // reason: a human-friendly label ('Lender / financing delay' etc).
    // notes:  optional free text — the lawyer/lender's actual words. Only
    // included when present so the buyer doesn't get awkward empty sections.
    closing_rescheduled: (client, deal, reason, notes, agent) => ({
      subject: `Closing Date Update — ${deal.property_address}`,
      body: `Hi ${client.full_name?.split(' ')[0] || 'there'},

I wanted to give you a quick heads-up: the closing on ${deal.property_address} has been rescheduled.

📅 Original closing date: ${App.fmtDate(deal.original_closing_date)}
📅 New expected closing date: ${App.fmtDate(deal.closing_date)}

Reason: ${reason}${notes ? `\n\nDetails: ${notes}` : ''}

This kind of adjustment is fairly normal when financing, legal, or paperwork timelines need a little more room — it does not change the deal itself, just the date the keys change hands. I'm coordinating with the parties involved to keep everything on track for the new date.

Your live deal portal has been updated automatically. You'll see the new countdown and the reason for the change there as well.

If you have any questions or concerns, please call or text me anytime.

${EmailFormat.signaturePlain(agent)}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

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

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

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

${EmailFormat.signaturePlain(agent)}

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
        ? `https://maxwellmidodzi.com/build?t=${buildToken}`
        : `https://maxwellmidodzi.com/build`;

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

      const agentWebsite = agent.website_url || 'maxwellmidodzi.com';

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
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
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
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

${EmailFormat.signaturePlain(agent)}${EmailFormat.disclaimerPlain()}`;

      return {
        subject: `🏗️ Build Update — ${newStage} | ${build.lot_address}`,
        body,
        html
      };
    },

    // Build update for a NON-client stakeholder (lawyer / lender). Same milestone
    // content, but professional framing and a link to THEIR stakeholder portal
    // (not the buyer tracker). recipient = { name }, buyerName = the buyer.
    build_update_stakeholder: (recipient, buyerName, build, newStage, agent, portalUrl, roleLabel) => {
      const firstName = (recipient?.name || '').split(' ')[0] || 'there';
      const role = roleLabel || 'stakeholder';
      const estClose = build.est_close_date || build.closing_date;
      const estCloseStr = estClose ? new Date(estClose).toLocaleDateString('en-CA',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) : null;
      const link = portalUrl || 'https://maxwellmidodzi.com/portal';
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${firstName},</p>
        <p>A quick construction update on <strong>${buyerName || 'your client'}</strong>'s new build at <strong>${build.lot_address || 'the property'}</strong>, for your file.</p>
        <p><strong>Current Stage: ▶️ ${newStage}</strong></p>
        ${estCloseStr ? `<p>📅 <strong>Estimated Possession:</strong> ${estCloseStr}</p>` : ''}
        <br>
        <a class="cal-btn" href="${link}">View live progress in your portal →</a>
        <p style="font-size:12px;color:#999;margin:0 0 16px;">Your secure ${role} portal shows the full build timeline, closing details, and documents.</p>
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;
      const body = `Hi ${firstName},

A quick construction update on ${buyerName || 'your client'}'s new build at ${build.lot_address || 'the property'}, for your file.

Current Stage: ${newStage}
${estCloseStr ? `Estimated Possession: ${estCloseStr}` : ''}

View live progress in your portal: ${link}

Best regards,
${EmailFormat.signaturePlain(agent)}`;
      return {
        subject: `🏗️ Build Update — ${newStage} | ${build.lot_address || ''} (${buyerName || ''})`,
        body,
        html
      };
    },

    // New-build handoff snapshot for a stakeholder (lawyer / lender). Sent from the
    // New Build card so the recipient sees the builder, price, deposit, and
    // purchase-agreement details in one place, plus their portal link.
    // Client introduction to the lawyer / lender. Introduces the buyer, states the
    // accepted offer + purchase price, notes the attached MLS + APS, and hands off.
    // NO portal link — the client is CC'd on this email (see notifyStakeholders), so
    // a portal link here would give the client access to the stakeholder's portal.
    build_details_stakeholder: (recipient, roleLabel, build, agent) => {
      const first = (recipient?.name || '').split(' ')[0] || 'there';
      const money = (n) => n ? '$' + Number(n).toLocaleString() : null;
      const buyer = (build.clients && build.clients.full_name) || build.client_name || 'my client';
      const buyerFirst = String(buyer).split(' ')[0] || 'the client';
      const property = build.lot_address || 'the property';
      const price = money(build.purchase_price) || money(build.lot_price);
      const priceHtml = price ? ` at a purchase price of <strong>${price}</strong>` : '';
      const priceTxt  = price ? ` at a purchase price of ${price}` : '';
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${first},</p>
        <p>I hope you're doing well.</p>
        <p>I'm pleased to introduce my client, <strong>${buyer}</strong>. They have an accepted offer in place for <strong>${property}</strong>${priceHtml}.</p>
        <p>I've attached the <strong>MLS listing</strong> and the <strong>fully executed Agreement of Purchase &amp; Sale</strong> for your review. I'll leave you and ${buyerFirst} to connect directly on next steps, required documents, and closing details.</p>
        <p>If anything further is needed from me in the meantime, please don't hesitate to reach out.</p>
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;
      const body = `Hi ${first},

I hope you're doing well.

I'm pleased to introduce my client, ${buyer}. They have an accepted offer in place for ${property}${priceTxt}.

I've attached the MLS listing and the fully executed Agreement of Purchase & Sale for your review. I'll leave you and ${buyerFirst} to connect directly on next steps, required documents, and closing details.

If anything further is needed from me in the meantime, please don't hesitate to reach out.

Best regards,
${EmailFormat.signaturePlain(agent)}${EmailFormat.disclaimerPlain()}`;
      return {
        subject: `Introducing ${buyer} — ${property}`,
        body,
        html
      };
    },

    // Private portal link for a lawyer / lender — sent ONLY to that stakeholder
    // (never CC the client, or they'd get access to the stakeholder's portal).
    stakeholder_portal_link: (recipient, roleLabel, build, agent, portalUrl) => {
      const first = (recipient?.name || '').split(' ')[0] || 'there';
      const property = build.lot_address || 'this transaction';
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${first},</p>
        <p>Here is your secure ${roleLabel.toLowerCase()} portal for <strong>${property}</strong>. It shows the current status, key dates, and documents for this file.</p>
        <p style="text-align:center;margin:24px 0;"><a class="cal-btn" href="${portalUrl}">Open your ${roleLabel} portal →</a></p>
        <p style="font-size:13px;color:#666;">Or copy this link:<br><a href="${portalUrl}" style="word-break:break-all;">${portalUrl}</a></p>
        <p style="font-size:12px;color:#999;">This link is private to you — please don't forward it.</p>
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;
      const body = `Hi ${first},

Here is your secure ${roleLabel.toLowerCase()} portal for ${property}:
${portalUrl}

It shows the current status, key dates, and documents for this file. This link is private to you — please don't forward it.

Best regards,
${EmailFormat.signaturePlain(agent)}${EmailFormat.disclaimerPlain()}`;
      return { subject: `Your ${roleLabel} portal — ${property}`, body, html };
    },

    // ── BRIEF RE-ENGAGEMENT TEMPLATES ─────────────────────────────────────────
    // Short, friendly nudges sent automatically when a client has no activity
    // in the last N days.  All four end with a soft CTA + the eXp signature.
    reengagement_brief: (client, agent) => {
      const first = client.full_name?.split(' ')[0] || 'there';
      return {
        subject: `Quick check-in — anything I can help with?`,
        body: `Hi ${first},

It's been a little quiet on my end and I just wanted to check in. Are you still actively looking, or has anything changed on your timeline?

Either way — even a one-line reply helps me know how to support you best from here.

${EmailFormat.signaturePlain(agent)}${EmailFormat.disclaimerPlain()}`
      };
    },

    reengagement_buyer_match: (client, agent) => {
      const first = client.full_name?.split(' ')[0] || 'there';
      const areas = client.preferred_areas || 'your preferred areas';
      return {
        subject: `Still looking in ${areas}? — a few new ones worth a peek`,
        body: `Hi ${first},

A few homes have hit the market in ${areas} that line up with the budget and bedroom count we talked about. Want me to send the shortlist?

If your search has paused or shifted, just say the word — no pressure, just keeping you in the loop.

${EmailFormat.signaturePlain(agent)}${EmailFormat.disclaimerPlain()}`
      };
    },

    reengagement_pre_approval: (client, agent) => {
      const first = client.full_name?.split(' ')[0] || 'there';
      return {
        subject: `Quick nudge on the pre-approval`,
        body: `Hi ${first},

Just circling back — you mentioned your pre-approval was in progress. Has the mortgage broker confirmed your number yet? Once we have that locked in, we can move quickly when the right place comes up.

Happy to recommend a broker if you're still shopping around.

${EmailFormat.signaturePlain(agent)}${EmailFormat.disclaimerPlain()}`
      };
    },

    reengagement_seller: (client, agent) => {
      const first = client.full_name?.split(' ')[0] || 'there';
      return {
        subject: `Where are we at on the sale?`,
        body: `Hi ${first},

Wanted to check in on your selling plans. The market has shifted a bit — happy to do a fresh comparable-sales pull so you know what your home would list for today.

Even if you're just curious, no obligation. Reply or give me a quick call when you have a minute.

${EmailFormat.signaturePlain(agent)}${EmailFormat.disclaimerPlain()}`
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

${EmailFormat.signaturePlain(agent)}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`
    }),

    welcome_email: (client, intake, agent, opts = {}) => {
      const firstName = client.full_name?.split(' ')[0] || client.first_name || 'there';
      const agentName = agent.full_name || agent.name || 'Maxwell Delali Midodzi';
      const agentPhone = agent.phone || '(709) 325-0545';
      const agentEmail = agent.email || 'Maxwell.Midodzi@exprealty.com';
      const agentWebsite = agent.website_url || 'maxwellmidodzi.com';
      const agentAddress = agent.brokerage_address || '33 Pippy PL, Suite 101, St. John\'s, NL A1B 3X2';

      // ── CONTEXT-AWARE OPENING ──────────────────────────────────────────────
      // Pick a welcome variant from the client's situation (intake.current_status
      // + property type). Subject + opening change; the steps/criteria/signature
      // below stay shared since they apply to every buyer. Falls back to a warm
      // general welcome if the situation is unknown.
      const _status = (intake.current_status || '').toLowerCase();
      let _situation = 'default';
      if (/relocat/.test(_status))                          _situation = 'relocating';
      else if (/invest|rental|portfolio|income/.test(_status)) _situation = 'investor';
      else if (/homeowner|own a home|buying another/.test(_status)) _situation = 'move_up';
      else if (/rent|family|friends/.test(_status))         _situation = 'first_time';
      const _variants = {
        first_time: {
          subject: `Welcome, ${firstName} — let's find your first home`,
          html: `🎉 <strong>Welcome!</strong> Buying your first home is a big (and exciting) step — and I've got you. I'll walk you through every stage, explain the jargon in plain English, and make sure you never feel rushed or in the dark.`,
          text: `Welcome! Buying your first home is a big, exciting step — and I've got you. I'll walk you through every stage and make sure you never feel rushed or in the dark.`
        },
        move_up: {
          subject: `Welcome, ${firstName} — on to your next home`,
          html: `🎉 <strong>Welcome!</strong> Since you already own, the secret to a smooth move is timing — lining up the sale of your current place with the purchase of the next so you're never caught in between. I'll help you map that out, and we'll factor your equity into the plan.`,
          text: `Welcome! Since you already own, the secret to a smooth move is timing — lining up the sale of your current place with buying the next. I'll help you map that out and factor your equity into the plan.`
        },
        relocating: {
          subject: `Welcome to the area, ${firstName}!`,
          html: `🎉 <strong>Welcome!</strong> Relocating is a big move, so my job is to make the Newfoundland side seamless. I'll get you up to speed on the neighbourhoods that fit your life, and we can handle most of the search remotely — video tours, virtual updates, the works.`,
          text: `Welcome! Relocating is a big move, so my job is to make the Newfoundland side seamless. I'll get you up to speed on the right neighbourhoods, and we can handle most of the search remotely.`
        },
        investor: {
          subject: `Welcome, ${firstName} — let's grow the portfolio`,
          html: `🎉 <strong>Welcome!</strong> For an investment purchase it's all about the numbers — rental demand, cash flow, and the right pockets of the market. I'll bring you opportunities that make sense on paper, not just ones that show well.`,
          text: `Welcome! For an investment purchase it's all about the numbers — rental demand, cash flow, and the right areas. I'll bring you opportunities that make sense on paper.`
        },
        default: {
          subject: `Welcome to eXp Realty, ${firstName}!`,
          html: `🎉 <strong>Welcome!</strong> Thank you for choosing me as your real estate agent. I'm excited to help you find your perfect home.`,
          text: `Welcome! I'm ${agentName} and I'm thrilled to be working with you on your real estate journey.`
        }
      };
      const _v = _variants[_situation] || _variants.default;

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

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${firstName},</p>
        <p>${_v.html}</p>
        <p><strong>Here's what happens next:</strong></p>
        <div>
          ${steps.map(s => `<div class="step-row"><strong>${s.n}. ${s.title}</strong> — ${s.desc}</div>`).join('')}
        </div>
        ${criteriaLines.length ? `
        <p style="margin-top:20px;"><strong>Your Search Criteria on File</strong></p>
        <div>${criteriaHTML}</div>` : ''}
        <p style="margin-top:20px;">Feel free to reach out anytime — I'm here to help!</p>
        ${opts.referralToken ? `
        <div style="margin-top:18px;padding:14px 16px;background:#FAFAF9;border-left:3px solid #0F172A;border-radius:8px;">
          <p style="margin:0 0 10px;font-size:13px;font-style:italic;color:#555;">One more thing — I work with a great mortgage broker here in Newfoundland day to day. If you'd ever like a second opinion or a smoother financing process, I'm happy to introduce you — no pressure at all.</p>
          <a href="https://maxwellmidodzi.com/refer.html?t=${opts.referralToken}" style="display:inline-block;background:#0F172A;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:9px 18px;border-radius:6px;">Yes, introduce me →</a>
        </div>` : ''}
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;

      const plainText = `Hi ${firstName},

${_v.text}

Here's what happens next:
1. Discovery Call — We'll discuss your needs, budget, and timeline
2. Property Search — I'll share listings that match your criteria
3. Viewings — We'll tour properties together
4. Offer & Closing — I'll negotiate the best deal for you

Feel free to reach out anytime — I'm here to help!
${opts.referralToken ? `\nP.S. — I also work with a great mortgage broker here in Newfoundland day to day. If you'd ever like an introduction, just let me know: https://maxwellmidodzi.com/refer.html?t=${opts.referralToken}\n` : ''}
Best regards,
${EmailFormat.signaturePlain(agent)}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`;

      return {
        subject: `${_v.subject} — ${agentName}`,
        body: plainText,
        html
      };
    },

    // ── MORTGAGE BROKER INTRO ──────────────────────────────────────────────
    // Modelled on Maxwell's own past intro email: greet the broker, warmly
    // connect them to the client, then "[Client], meet [Broker] — my go-to
    // mortgage broker", and step back with "I'll let you two take it from
    // here!". Simple, no criteria snapshot, no dollar figures (the broker
    // assesses affordability). Pronoun-free — uses the broker's name. Uses the
    // standard EmailFormat signature + confidentiality footer like every other
    // app email, so it doesn't duplicate sign-offs.
    broker_intro: (client, intake, agent, broker) => {
      const clientFirst = client.full_name?.split(' ')[0] || 'there';
      const brokerFirst = (broker?.name || '').split(' ')[0] || 'my broker';
      const brokerName  = broker?.name || 'my mortgage broker';

      const plainText =
`Hi ${brokerFirst},

Wanted to connect you with ${clientFirst}! ${clientFirst} is looking at getting into homeownership soon, and I thought a quick conversation with you would be a great starting point — just to understand the process and know where things stand.

${clientFirst}, meet ${brokerName} — my go-to mortgage broker, who'll walk you through everything you need to know.

I'll let you two take it from here!

${EmailFormat.signaturePlain(agent)}${EmailFormat.disclaimerPlain()}`;

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${brokerFirst},</p>
        <p>Wanted to connect you with ${clientFirst}! ${clientFirst} is looking at getting into homeownership soon, and I thought a quick conversation with you would be a great starting point — just to understand the process and know where things stand.</p>
        <p>${clientFirst}, meet <strong>${brokerName}</strong> — my go-to mortgage broker, who'll walk you through everything you need to know.</p>
        <p>I'll let you two take it from here!</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;

      return {
        subject: `Introduction – ${clientFirst} & ${brokerFirst}`,
        body: plainText,
        html
      };
    },

    // ── SELLER WELCOME EMAIL (seller-side feature) ─────────────────────────
    // Sent after a seller intake is converted into a client. Sets expectations
    // for the free consultation, positions Maxwell as the marketing expert,
    // and signs off as eXp Realty. Signatures (disclosures, listing agreement,
    // etc.) are handled outside DealFlow — this email is purely the warm intro.
    seller_welcome_email: (client, intake, agent) => {
      const firstName    = client.full_name?.split(' ')[0] || client.first_name || 'there';
      const agentName    = agent?.full_name || agent?.name || 'Maxwell Delali Midodzi';
      const agentPhone   = agent?.phone   || '(709) 325-0545';
      const agentEmail   = agent?.email   || 'Maxwell.Midodzi@exprealty.com';
      const agentWebsite = agent?.website_url      || 'maxwellmidodzi.com';
      const agentAddress = agent?.brokerage_address || '33 Pippy PL, Suite 101, St. John\'s, NL A1B 3X2';
      const propAddr     = intake?.property_address || null;
      const timeline     = intake?.sell_timeline    || null;

      // Property summary block (only if we have one)
      const propLines = [];
      if (propAddr)                  propLines.push(`📍 <strong>Property:</strong> ${propAddr}`);
      if (intake?.property_type)     propLines.push(`🏠 <strong>Type:</strong> ${intake.property_type}`);
      if (intake?.property_bedrooms) propLines.push(`🛏 <strong>Bedrooms:</strong> ${intake.property_bedrooms}`);
      if (timeline)                  propLines.push(`📅 <strong>Timeline:</strong> ${timeline}`);
      const propertyHTML = propLines.length
        ? propLines.map(l => `<p style="margin:6px 0;font-size:14px;color:#333;">${l}</p>`).join('')
        : '';

      const steps = [
        { n:1, color:'#4f46e5', title:'Personal Call',             desc:'I\'ll call you within 24 hours to introduce myself and book the consultation' },
        { n:2, color:'#059669', title:'Free Consultation',         desc:'30–45 minutes (in person or Zoom) to walk through your home and your goals' },
        { n:3, color:'#d97706', title:'Comparative Market Analysis', desc:'A full report on comparable sales so we price your home right from day one' },
        { n:4, color:'#7c3aed', title:'Marketing Plan',            desc:'Professional photos, MLS exposure, social media, and staging guidance' },
        { n:5, color:'#0891b2', title:'Sold',                       desc:'I guide you from listing through offers, conditions, and closing' }
      ];

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>
        <p>Hi ${firstName},</p>
        <p>Thanks for reaching out about selling your home. I'm <strong>${agentName}</strong> with eXp Realty, and I'm looking forward to helping you through this.</p>
        <p>I'll <strong>personally call you within 24 hours</strong> to introduce myself and book your free consultation at a time that works for you.</p>
        ${propLines.length ? `<p style="margin-top:18px;"><strong>Here's what you told me about your property:</strong></p><div class="prop-box">${propertyHTML}</div>` : ''}
        <p><strong>Here's what happens next:</strong></p>
        <div>
          ${steps.map(s => `<div class="step-row"><strong>${s.n}. ${s.title}</strong> — ${s.desc}</div>`).join('')}
        </div>
        <p style="margin-top:20px;">Selling a home is a big decision and I take that seriously. Whether you're ready to list this month or just exploring, the consultation is free and there's no obligation. My job is to give you the information you need to make the right call for you and your family.</p>
        <p>Talk soon!</p>
        <p>Best regards,</p>
        ${EmailFormat.signatureHTML(agent)}
        ${EmailFormat.disclaimerHTML()}
      </body></html>`;

      const plainText = `Hi ${firstName},

Thanks for reaching out about selling your home. I'm ${agentName} with eXp Realty, and I'm looking forward to helping you through this.

I'll personally call you within 24 hours to introduce myself and book your free consultation at a time that works for you.
${propAddr ? `\nProperty on file: ${propAddr}${timeline ? ` (timeline: ${timeline})` : ''}\n` : ''}
Here's what happens next:
1. Personal Call — I'll call you within 24 hours to introduce myself and book the consultation
2. Free Consultation — 30–45 minutes (in person or Zoom) to walk through your home and your goals
3. Comparative Market Analysis — a full report on comparable sales so we price your home right from day one
4. Marketing Plan — professional photos, MLS exposure, social media, and staging guidance
5. Sold — I guide you from listing through offers, conditions, and closing

Selling a home is a big decision and I take that seriously. Whether you're ready to list this month or just exploring, the consultation is free and there's no obligation. My job is to give you the information you need to make the right call for you and your family.

Talk soon!

Best regards,
${EmailFormat.signaturePlain(agent)}

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`;

      return {
        subject: `Thanks for reaching out, ${firstName} — Maxwell here`,
        body: plainText,
        html
      };
    },
  },

  // ── QUEUE EMAIL FOR APPROVAL ───────────────────────────────────────────────

  // Make emails read like Maxwell wrote them, not AI: strip em/en dashes and
  // replace them with natural punctuation. Keeps number ranges (24–48 → 24-48)
  // and tidies "Day! — X" → "Day! X", "complete — just" → "complete, just".
  deDash(s) {
    if (!s || typeof s !== 'string') return s;
    return s
      .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')   // number ranges → hyphen
      .replace(/([!?:.])\s*[—–]\s*/g, '$1 ')      // after end-punctuation → space
      .replace(/\s*[—–]\s*/g, ', ')               // mid-sentence → comma
      .replace(/[—–]/g, '-');                     // any leftover → hyphen
  },

  async queue(type, clientId, clientName, clientEmail, emailSubject, emailBody, relatedId = null, htmlBody = null, icsBase64 = null, ccEmail = null, fileAttachments = null, batchId = null) {
    // Always use the Supabase Auth UID — this must match auth.uid() for RLS to pass
    const user = await App.getAuthUser();
    const agentId = user?.id || currentAgent?.id;
    if (!agentId) { console.error('Notify.queue: no auth user found'); return; }

    // Human tone: strip em/en dashes from every outgoing email before it's queued.
    emailSubject = Notify.deDash(emailSubject);
    emailBody    = Notify.deDash(emailBody);
    htmlBody     = Notify.deDash(htmlBody);

    // Consistency net: if a template only supplied plain text (no HTML version),
    // auto-wrap it in the SAME branded shell every other email uses — so every
    // email renders with the same fonts, spacing and white background (the
    // "real Gmail" look) across Gmail/Yahoo/Outlook, never as raw plain text.
    // The wrap degrades gracefully (plain <p> paragraphs) if a client strips
    // <style>. Templates that already have HTML are left untouched.
    if (!htmlBody && emailBody) {
      htmlBody = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${EmailFormat.styles()}</style></head><body>${EmailFormat.bodyHTML(emailBody)}</body></html>`;
    }

    // Offload file attachments to storage so the approval row stays small. Storing
    // base64 inline blows past the row/request size limit for anything but tiny files
    // (that's why large attachments silently failed to queue). Each attachment is
    // uploaded to the private email-attachments bucket and referenced by path;
    // approve() downloads + attaches at send time, then deletes it. Falls back to
    // inline base64 per-file if the upload fails (e.g. bucket not created yet).
    let attachmentRefs = null;
    if (fileAttachments?.length) {
      attachmentRefs = [];
      for (const f of fileAttachments) {
        if (!f?.data) { attachmentRefs.push(f); continue; }  // already a ref, or nothing to store
        try {
          const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
          const safe  = (f.filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
          const path  = `${agentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
          const { error: upErr } = await db.storage.from('email-attachments')
            .upload(path, new Blob([bytes], { type: f.mime_type || 'application/octet-stream' }));
          if (upErr) { attachmentRefs.push(f); }  // fall back to inline
          else       { attachmentRefs.push({ filename: f.filename, mime_type: f.mime_type, path }); }
        } catch (e) { attachmentRefs.push(f); }   // fall back to inline
      }
    }

    // Pack html + ics + real file attachments into context_data
    let contextData = null;
    if (htmlBody || icsBase64 || ccEmail || attachmentRefs?.length) {
      const safeHtml = htmlBody ? btoa(unescape(encodeURIComponent(htmlBody))) : null;
      contextData = {
        html: safeHtml, ics: icsBase64 || null, cc: ccEmail || null,
        attachments: attachmentRefs?.length ? attachmentRefs : null
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
    const user = await App.getAuthUser();
    const agentId = user?.id || currentAgent?.id;
    if (!agentId) return;
    const { count } = await db.from('approval_queue')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .in('status', ['Pending', 'Failed']);
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

  // Builder meeting invite — emails the client the .ics, CC the builder.
  async onBuilderMeeting(meeting, client) {
    const agent = currentAgent;
    const tmpl = Notify.templates.builder_meeting(client, meeting, agent);
    await Notify.queue(
      'Builder Meeting',
      client.id || null, client.full_name || meeting.client_name, client.email || meeting.client_email,
      tmpl.subject, tmpl.body, meeting.id,
      tmpl.html,
      tmpl.ics,
      meeting.builder_email || null   // CC the builder
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
    // Soft broker offer: only when the buyer ALREADY has a broker / pre-approval
    // (not "need guidance" — that path gets the full auto-intro — and not cash),
    // and a broker is configured in Settings. Create a tokenised request row so
    // the welcome email can show a "Yes, introduce me" button that routes back
    // here for the agent's approval.
    let referralToken = null;
    const pa = (intake?.preapproval || '').toLowerCase();
    const eligible = pa && !/need guidance|not yet/.test(pa) && !/cash/.test(pa);
    if (eligible && agent?.broker_email && client?.id) {
      try {
        const user = await App.getAuthUser();
        const agentId = user?.id || agent.id;
        const token = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
        const { error } = await db.from('broker_referral_requests').insert({
          agent_id: agentId, client_id: client.id,
          client_name: client.full_name || null, client_email: client.email || null,
          token, status: 'offered'
        });
        if (!error) referralToken = token;
        else console.warn('[referral offer] skipped:', error.message);
      } catch (e) { console.warn('[referral offer] skipped:', e?.message || e); }
    }
    const tmpl = Notify.templates.welcome_email(client, intake, agent, { referralToken });
    await Notify.queue(
      'Welcome Email',
      client.id, client.full_name, client.email,
      tmpl.subject, tmpl.body, null, tmpl.html
    );
  },

  // Warm intro to the agent's mortgage broker. Queued for approval like every
  // other outbound email — Maxwell reviews before it sends. The PRIMARY
  // recipient is the broker; the client AND Maxwell are CC'd (client so they
  // connect directly, Maxwell so he keeps his own copy). No-op if no broker
  // email is configured.
  async onBrokerReferral(client, intake) {
    const agent = currentAgent || {};
    const broker = { name: agent.broker_name, email: agent.broker_email };
    if (!broker.email) return false;            // referrals off until a broker is set
    const tmpl = Notify.templates.broker_intro(client, intake, agent, broker);
    // CC the client + Maxwell. Comma-joined, de-duplicated, empties dropped.
    const cc = [client.email, agent.email]
      .filter(Boolean)
      .filter((e, i, arr) => arr.indexOf(e) === i)
      .join(', ') || null;
    await Notify.queue(
      'Mortgage Broker Intro',
      client.id, broker.name || 'Mortgage Broker', broker.email,
      tmpl.subject, tmpl.body, null, tmpl.html,
      null,   // ics
      cc      // CC: client + Maxwell
    );
    return true;
  },

  // Seller-side parallel of onClientAdded — keeps buyer welcome path untouched.
  async onSellerClientAdded(client, intake) {
    const agent = currentAgent;
    const tmpl = Notify.templates.seller_welcome_email(client, intake, agent);
    await Notify.queue(
      'Seller Welcome Email',
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

  // ── INACTIVE CLIENT RE-ENGAGEMENT ─────────────────────────────────────────
  // Scans for clients with no activity in the last N days and queues a
  // stage-appropriate re-engagement email through the approval queue.
  // Maxwell can approve, edit, or skip in the Approvals tab.
  // Idempotent via activity_log key — won't re-queue the same client within 14 days.
  async checkInactiveClients(daysThreshold = 7) {
    if (!currentAgent?.id) return { queued: 0, skipped: 0 };
    const agent = currentAgent;
    const now = new Date();
    const cutoff = new Date(now.getTime() - daysThreshold * 86400000).toISOString();
    const recencyWindow = new Date(now.getTime() - 14 * 86400000).toISOString();

    try {
      // 1. Find active clients with no recent updated_at
      const { data: stale, error } = await db.from('clients')
        .select('id, full_name, email, phone, stage, status, client_type, preapproval, preferred_areas, updated_at')
        .eq('agent_id', agent.id)
        .neq('status', 'Archived')
        .lt('updated_at', cutoff)
        .not('email', 'is', null)
        .limit(20);
      if (error) { console.error('[checkInactiveClients] query failed:', error); return { queued: 0, skipped: 0 }; }
      if (!stale?.length) return { queued: 0, skipped: 0 };

      // 2. Skip clients we've already nudged in the last 14 days
      const { data: recentLogs } = await db.from('activity_log')
        .select('client_email')
        .eq('agent_id', agent.id)
        .eq('activity_type', 'REENGAGEMENT_QUEUED')
        .gte('created_at', recencyWindow);
      const recentEmails = new Set((recentLogs || []).map(r => r.client_email));

      // Stages where a "still searching?" check-in is WRONG: the client is
      // mid-deal or finished — already bought, sold, fell through, or under
      // contract. Re-engagement only makes sense for quiet EARLY-stage leads.
      const SKIP_STAGES = ['Accepted', 'Conditions', 'Closing', 'Closed', 'Fell Through', 'Done', 'Withdrawn', 'Sold'];

      // Belt-and-suspenders: also exclude anyone who has a closed / fell-through
      // / in-progress deal in the PIPELINE, even if their clients.stage field
      // wasn't updated. So a buyer who closed never gets a "still looking?" nudge.
      let inDealClientIds = new Set();
      try {
        const { data: dealRows } = await db.from('pipeline')
          .select('client_id, stage').eq('agent_id', agent.id);
        const doneOrActive = ['Accepted', 'Conditions', 'Closing', 'Closed', 'Fell Through', 'Done', 'Withdrawn', 'Sold'];
        (dealRows || []).forEach(d => {
          if (d.client_id && doneOrActive.includes((d.stage || '').trim())) inDealClientIds.add(d.client_id);
        });
      } catch (_) { /* non-fatal — stage filter still applies */ }

      let queued = 0, skipped = 0;
      for (const c of stale) {
        if (recentEmails.has(c.email)) { skipped++; continue; }
        // Don't nudge clients who've bought / closed / are mid-deal — by their
        // own stage OR by any matching pipeline deal.
        if (SKIP_STAGES.includes((c.stage || '').trim())) { continue; }
        if (inDealClientIds.has(c.id)) { continue; }

        // 3. Pick a template based on client state — variety + relevance
        let templateName, queueLabel;
        const isSeller = (c.client_type || '').toLowerCase() === 'seller';
        const preApproval = (c.preapproval || '').toLowerCase();
        const isPreApprovalInProgress = preApproval.includes('progress') || preApproval.includes('pending');

        if (isSeller) {
          templateName = 'reengagement_seller';
          queueLabel = 'Re-engagement (seller) 📨';
        } else if (isPreApprovalInProgress) {
          templateName = 'reengagement_pre_approval';
          queueLabel = 'Re-engagement (pre-approval) 📨';
        } else if (c.preferred_areas) {
          templateName = 'reengagement_buyer_match';
          queueLabel = 'Re-engagement (buyer match) 📨';
        } else {
          templateName = 'reengagement_brief';
          queueLabel = 'Re-engagement (check-in) 📨';
        }

        const tmpl = Notify.templates[templateName](c, agent);
        await Notify.queue(queueLabel, c.id, c.full_name, c.email, tmpl.subject, tmpl.body, null);

        // Log so we don't re-queue this same client in the next 14 days
        try {
          await App.logActivity('REENGAGEMENT_QUEUED', c.full_name, c.email,
            `Re-engagement email queued via ${templateName}`, c.id);
        } catch(_) {}
        queued++;
      }
      if (queued > 0) {
        App.toast(`📨 ${queued} re-engagement email${queued === 1 ? '' : 's'} queued in Approvals${skipped > 0 ? ` · ${skipped} skipped (already nudged recently)` : ''}`, 'var(--accent2)');
      }
      return { queued, skipped };
    } catch (e) {
      console.error('[checkInactiveClients] error:', e);
      return { queued: 0, skipped: 0 };
    }
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
      // Auto-log mileage trips for each auto-completed viewing. Silent —
      // each call no-ops if already logged or if the agent has no home
      // base set. Fired in parallel since they're independent DB inserts.
      if (typeof Mileage !== 'undefined') {
        justCompletedIds.forEach(vid => {
          Mileage.autoLogFromViewing(vid).catch(err => console.warn('[Mileage] auto-log error', err));
        });
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
