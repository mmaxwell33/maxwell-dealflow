/**
 * Maxwell DealFlow CRM — Morning Briefing Edge Function
 *
 * Runs every day at 7:00 AM UTC (via pg_cron).
 * Sends Maxwell a summary email to maxwelldelali22@gmail.com covering:
 *
 *   1. Today's viewings — who, what property, what time
 *   2. Pending approvals — emails waiting for his review/send
 *   3. New intake forms — unreviewed client submissions
 *   4. Active pipeline deals — current stage snapshot
 *   5. Upcoming deadlines this week — financing, inspection, walkthrough, closing
 *   6. Stale deals — stuck > 14 days with no movement
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (timeStr: string | null) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

const daysUntil = (dateStr: string, today: Date): number => {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
};

// ─── MIME email builder ───────────────────────────────────────────────────────

function mimeEncodeHeader(value: string): string {
  if (!/[^\x20-\x7E]/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  return `=?UTF-8?B?${base64Encode(bytes)}?=`;
}

function toBase64Url(bytes: Uint8Array): string {
  return base64Encode(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildMimeEmail(to: string, subject: string, plainBody: string, htmlBody: string): Uint8Array {
  const boundary = `mdf_${Date.now().toString(36)}`;
  const enc = new TextEncoder();

  const mime = [
    `From: Maxwell DealFlow <maxwelldelali22@gmail.com>`,
    `To: ${to}`,
    `Subject: ${mimeEncodeHeader(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    qpEncode(plainBody),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    qpEncode(htmlBody),
    ``,
    `--${boundary}--`,
  ].join('\r\n');

  return enc.encode(mime);
}

function qpEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let out = '';
  let lineLen = 0;
  for (const byte of bytes) {
    let encoded: string;
    if (byte === 0x0D || byte === 0x0A) {
      out += byte === 0x0A ? '\r\n' : '';
      lineLen = 0;
      continue;
    } else if ((byte >= 33 && byte <= 126 && byte !== 61) || byte === 9 || byte === 32) {
      encoded = String.fromCharCode(byte);
    } else {
      encoded = `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    if (lineLen + encoded.length > 75) {
      out += '=\r\n';
      lineLen = 0;
    }
    out += encoded;
    lineLen += encoded.length;
  }
  return out;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const gmailRefreshToken = Deno.env.get('GMAIL_REFRESH_TOKEN')!;
  const gmailClientId = Deno.env.get('GMAIL_CLIENT_ID')!;
  const gmailClientSecret = Deno.env.get('GMAIL_CLIENT_SECRET')!;

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing env vars' }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const weekEnd = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  const dayName = today.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ── 1. Today's viewings ────────────────────────────────────────────────────
  const { data: todayViewings } = await supabase
    .from('viewings')
    .select('id, property_address, viewing_time, viewing_status, client_id')
    .eq('viewing_date', todayStr)
    .order('viewing_time', { ascending: true });

  // Get client names for each viewing
  const viewingsWithClients = await Promise.all((todayViewings ?? []).map(async (v: any) => {
    if (!v.client_id) return { ...v, client_name: 'Unknown Client' };
    const { data: c } = await supabase.from('clients').select('full_name').eq('id', v.client_id).single();
    return { ...v, client_name: c?.full_name || 'Unknown Client' };
  }));

  // ── 2. Pending approvals ───────────────────────────────────────────────────
  const { data: pendingApprovals } = await supabase
    .from('approval_queue')
    .select('id, approval_type, client_name, email_subject, created_at')
    .eq('status', 'Pending')
    .order('created_at', { ascending: true });

  // ── 3. New intake forms ────────────────────────────────────────────────────
  const { data: newIntakes } = await supabase
    .from('client_intake')
    .select('id, full_name, submitted_at, email')
    .eq('status', 'New')
    .order('submitted_at', { ascending: false });

  // ── 4. Active pipeline deals ───────────────────────────────────────────────
  const { data: activeDeals } = await supabase
    .from('pipeline')
    .select('id, client_name, property_address, stage, closing_date, financing_deadline, inspection_deadline, walkthrough_date, updated_at')
    .not('stage', 'in', '("Closed","Fell Through","Withdrawn")')
    .order('updated_at', { ascending: false });

  // ── 5. Upcoming deadlines this week ───────────────────────────────────────
  type Deadline = { label: string; address: string; daysLeft: number; date: string };
  const upcomingDeadlines: Deadline[] = [];
  for (const deal of (activeDeals ?? [])) {
    const checks: Array<{ field: string; label: string }> = [
      { field: 'financing_deadline', label: 'Financing' },
      { field: 'inspection_deadline', label: 'Inspection' },
      { field: 'walkthrough_date', label: 'Walkthrough' },
      { field: 'closing_date', label: 'Closing' },
    ];
    for (const { field, label } of checks) {
      const dateVal = (deal as any)[field];
      if (!dateVal) continue;
      const days = daysUntil(dateVal, today);
      if (days >= 0 && days <= 7) {
        upcomingDeadlines.push({
          label,
          address: deal.property_address || 'Unknown',
          daysLeft: days,
          date: fmtDate(dateVal),
        });
      }
    }
  }
  upcomingDeadlines.sort((a, b) => a.daysLeft - b.daysLeft);

  // ── 6. Stale deals (no update in 14+ days) ─────────────────────────────────
  const fourteenDaysAgo = new Date(today.getTime() - 14 * 86_400_000).toISOString();
  const staleDeals = (activeDeals ?? []).filter((d: any) => d.updated_at && d.updated_at < fourteenDaysAgo);

  // ── Build HTML email ───────────────────────────────────────────────────────

  const sectionStyle = 'margin: 0 0 28px 0;';
  const headingStyle = 'font-size: 16px; font-weight: 700; color: #1a1a2e; border-bottom: 2px solid #4f8ef7; padding-bottom: 6px; margin: 0 0 12px 0;';
  const tableStyle = 'width: 100%; border-collapse: collapse; font-size: 13px;';
  const thStyle = 'background: #f0f4ff; padding: 8px 10px; text-align: left; font-weight: 600; color: #444;';
  const tdStyle = 'padding: 8px 10px; border-bottom: 1px solid #eee; color: #333;';
  const badgeGreen = 'display:inline-block;background:#e6f9f0;color:#1a7a4a;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;';
  const badgeOrange = 'display:inline-block;background:#fff3e0;color:#b05e00;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;';
  const badgeRed = 'display:inline-block;background:#fdecea;color:#b71c1c;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;';

  // Section 1: Today's viewings
  let viewingsHtml = '';
  if (viewingsWithClients.length === 0) {
    viewingsHtml = `<p style="color:#888;font-style:italic;margin:0;">No viewings scheduled for today.</p>`;
  } else {
    viewingsHtml = `<table style="${tableStyle}">
      <tr><th style="${thStyle}">Time</th><th style="${thStyle}">Client</th><th style="${thStyle}">Property</th><th style="${thStyle}">Status</th></tr>
      ${viewingsWithClients.map((v: any) => `
        <tr>
          <td style="${tdStyle}">${fmtTime(v.viewing_time)}</td>
          <td style="${tdStyle}">${v.client_name}</td>
          <td style="${tdStyle}">${v.property_address || '—'}</td>
          <td style="${tdStyle}"><span style="${v.viewing_status === 'Completed' ? badgeGreen : badgeOrange}">${v.viewing_status}</span></td>
        </tr>`).join('')}
    </table>`;
  }

  // Section 2: Pending approvals
  let approvalsHtml = '';
  if (!pendingApprovals?.length) {
    approvalsHtml = `<p style="color:#888;font-style:italic;margin:0;">No pending approvals — you're all caught up! ✅</p>`;
  } else {
    approvalsHtml = `<table style="${tableStyle}">
      <tr><th style="${thStyle}">Type</th><th style="${thStyle}">Client</th><th style="${thStyle}">Subject</th><th style="${thStyle}">Queued</th></tr>
      ${pendingApprovals.map((a: any) => `
        <tr>
          <td style="${tdStyle}"><span style="${badgeOrange}">${a.approval_type}</span></td>
          <td style="${tdStyle}">${a.client_name}</td>
          <td style="${tdStyle}">${a.email_subject}</td>
          <td style="${tdStyle}">${fmtDate(a.created_at)}</td>
        </tr>`).join('')}
    </table>`;
  }

  // Section 3: New intakes
  let intakesHtml = '';
  if (!newIntakes?.length) {
    intakesHtml = `<p style="color:#888;font-style:italic;margin:0;">No new intake submissions.</p>`;
  } else {
    intakesHtml = `<table style="${tableStyle}">
      <tr><th style="${thStyle}">Name</th><th style="${thStyle}">Email</th><th style="${thStyle}">Submitted</th></tr>
      ${newIntakes.map((i: any) => `
        <tr>
          <td style="${tdStyle}">${i.full_name || '—'}</td>
          <td style="${tdStyle}">${i.email || '—'}</td>
          <td style="${tdStyle}">${fmtDate(i.submitted_at)}</td>
        </tr>`).join('')}
    </table>`;
  }

  // Section 4: Active pipeline
  let pipelineHtml = '';
  if (!activeDeals?.length) {
    pipelineHtml = `<p style="color:#888;font-style:italic;margin:0;">No active pipeline deals.</p>`;
  } else {
    pipelineHtml = `<table style="${tableStyle}">
      <tr><th style="${thStyle}">Client</th><th style="${thStyle}">Property</th><th style="${thStyle}">Stage</th><th style="${thStyle}">Closing</th></tr>
      ${activeDeals.map((d: any) => `
        <tr>
          <td style="${tdStyle}">${d.client_name || '—'}</td>
          <td style="${tdStyle}">${d.property_address || '—'}</td>
          <td style="${tdStyle}"><span style="${badgeGreen}">${d.stage}</span></td>
          <td style="${tdStyle}">${d.closing_date ? fmtDate(d.closing_date) : '—'}</td>
        </tr>`).join('')}
    </table>`;
  }

  // Section 5: Upcoming deadlines
  let deadlinesHtml = '';
  if (!upcomingDeadlines.length) {
    deadlinesHtml = `<p style="color:#888;font-style:italic;margin:0;">No deadlines in the next 7 days.</p>`;
  } else {
    deadlinesHtml = `<table style="${tableStyle}">
      <tr><th style="${thStyle}">Type</th><th style="${thStyle}">Property</th><th style="${thStyle}">Date</th><th style="${thStyle}">Days Left</th></tr>
      ${upcomingDeadlines.map((d) => {
        const badge = d.daysLeft === 0 ? badgeRed : d.daysLeft <= 2 ? badgeOrange : badgeGreen;
        const label = d.daysLeft === 0 ? 'TODAY' : `${d.daysLeft}d`;
        return `<tr>
          <td style="${tdStyle}">${d.label}</td>
          <td style="${tdStyle}">${d.address}</td>
          <td style="${tdStyle}">${d.date}</td>
          <td style="${tdStyle}"><span style="${badge}">${label}</span></td>
        </tr>`;
      }).join('')}
    </table>`;
  }

  // Section 6: Stale deals
  let staleHtml = '';
  if (!staleDeals.length) {
    staleHtml = `<p style="color:#888;font-style:italic;margin:0;">No stale deals — all deals have recent activity. 👍</p>`;
  } else {
    staleHtml = `<table style="${tableStyle}">
      <tr><th style="${thStyle}">Client</th><th style="${thStyle}">Property</th><th style="${thStyle}">Stage</th><th style="${thStyle}">Last Update</th></tr>
      ${staleDeals.map((d: any) => {
        const days = Math.round((today.getTime() - new Date(d.updated_at).getTime()) / 86_400_000);
        return `<tr>
          <td style="${tdStyle}">${d.client_name || '—'}</td>
          <td style="${tdStyle}">${d.property_address || '—'}</td>
          <td style="${tdStyle}">${d.stage}</td>
          <td style="${tdStyle}"><span style="${badgeRed}">${days} days ago</span></td>
        </tr>`;
      }).join('')}
    </table>`;
  }

  // ── Assemble counts for subject line ──────────────────────────────────────
  const pendingCount = pendingApprovals?.length ?? 0;
  const intakeCount = newIntakes?.length ?? 0;
  const viewingCount = viewingsWithClients.length;
  const deadlineCount = upcomingDeadlines.filter(d => d.daysLeft <= 2).length;

  const alerts = [];
  if (viewingCount > 0) alerts.push(`${viewingCount} viewing${viewingCount > 1 ? 's' : ''}`);
  if (pendingCount > 0) alerts.push(`${pendingCount} approval${pendingCount > 1 ? 's' : ''}`);
  if (intakeCount > 0) alerts.push(`${intakeCount} new lead${intakeCount > 1 ? 's' : ''}`);
  if (deadlineCount > 0) alerts.push(`${deadlineCount} urgent deadline${deadlineCount > 1 ? 's' : ''}`);

  const subjectSuffix = alerts.length > 0 ? ` — ${alerts.join(', ')}` : ' — All clear ✅';
  const subject = `☀️ Good Morning Maxwell${subjectSuffix}`;

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:700px;margin:0 auto;padding:20px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:12px 12px 0 0;padding:24px 28px;margin-bottom:0;">
      <div style="font-size:22px;font-weight:700;color:#fff;">☀️ Good Morning, Maxwell</div>
      <div style="font-size:13px;color:#a0b4d6;margin-top:4px;">${dayName}</div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        ${viewingCount > 0 ? `<span style="background:rgba(79,142,247,0.2);color:#a0c4ff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">📅 ${viewingCount} Viewing${viewingCount > 1 ? 's' : ''} Today</span>` : ''}
        ${pendingCount > 0 ? `<span style="background:rgba(255,152,0,0.2);color:#ffcc80;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">📬 ${pendingCount} Pending Approval${pendingCount > 1 ? 's' : ''}</span>` : ''}
        ${intakeCount > 0 ? `<span style="background:rgba(76,175,80,0.2);color:#a5d6a7;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">📋 ${intakeCount} New Lead${intakeCount > 1 ? 's' : ''}</span>` : ''}
        ${deadlineCount > 0 ? `<span style="background:rgba(244,67,54,0.2);color:#ef9a9a;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">⚠️ ${deadlineCount} Urgent Deadline${deadlineCount > 1 ? 's' : ''}</span>` : ''}
        ${alerts.length === 0 ? `<span style="background:rgba(76,175,80,0.2);color:#a5d6a7;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">✅ All clear — great day ahead!</span>` : ''}
      </div>
    </div>

    <!-- Content card -->
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

      <div style="${sectionStyle}">
        <div style="${headingStyle}">📅 Today's Viewings</div>
        ${viewingsHtml}
      </div>

      <div style="${sectionStyle}">
        <div style="${headingStyle}">📬 Pending Approvals</div>
        ${approvalsHtml}
      </div>

      <div style="${sectionStyle}">
        <div style="${headingStyle}">📋 New Client Leads</div>
        ${intakesHtml}
      </div>

      <div style="${sectionStyle}">
        <div style="${headingStyle}">🏠 Active Pipeline</div>
        ${pipelineHtml}
      </div>

      <div style="${sectionStyle}">
        <div style="${headingStyle}">⏰ Deadlines This Week</div>
        ${deadlinesHtml}
      </div>

      <div style="${sectionStyle}">
        <div style="${headingStyle}">⚠️ Deals Needing Attention</div>
        ${staleHtml}
      </div>

      <!-- Footer -->
      <div style="border-top:1px solid #eee;padding-top:16px;margin-top:8px;font-size:11px;color:#aaa;text-align:center;">
        Maxwell DealFlow CRM &nbsp;•&nbsp; Automated Morning Briefing &nbsp;•&nbsp; ${dayName}
      </div>
    </div>
  </div>
</body>
</html>`;

  // Plain text version
  const plainBody = `GOOD MORNING, MAXWELL — ${dayName}

TODAY'S VIEWINGS (${viewingCount})
${viewingsWithClients.length === 0 ? 'No viewings today.' : viewingsWithClients.map((v: any) => `  • ${fmtTime(v.viewing_time)} — ${v.client_name} @ ${v.property_address}`).join('\n')}

PENDING APPROVALS (${pendingCount})
${pendingApprovals?.length === 0 ? "You're all caught up!" : pendingApprovals!.map((a: any) => `  • [${a.approval_type}] ${a.client_name} — ${a.email_subject}`).join('\n')}

NEW CLIENT LEADS (${intakeCount})
${newIntakes?.length === 0 ? 'No new intakes.' : newIntakes!.map((i: any) => `  • ${i.full_name || 'Unknown'} (${i.email || '—'})`).join('\n')}

ACTIVE PIPELINE (${activeDeals?.length ?? 0} deals)
${activeDeals?.length === 0 ? 'No active deals.' : activeDeals!.map((d: any) => `  • ${d.client_name} — ${d.property_address} [${d.stage}]`).join('\n')}

UPCOMING DEADLINES THIS WEEK
${upcomingDeadlines.length === 0 ? 'No deadlines in the next 7 days.' : upcomingDeadlines.map(d => `  • ${d.label} — ${d.address} (${d.date}, ${d.daysLeft === 0 ? 'TODAY' : d.daysLeft + 'd'})`).join('\n')}

DEALS NEEDING ATTENTION
${staleDeals.length === 0 ? 'All deals have recent activity.' : staleDeals.map((d: any) => `  • ${d.client_name} — ${d.property_address} [${d.stage}]`).join('\n')}

--
Maxwell DealFlow CRM | Automated Morning Briefing`;

  // ── Send via Gmail API ─────────────────────────────────────────────────────
  if (!gmailRefreshToken || !gmailClientId || !gmailClientSecret) {
    // If Gmail env vars not set, just return the summary as JSON (useful for testing)
    return new Response(JSON.stringify({
      status: 'no_gmail_env',
      subject,
      viewings: viewingCount,
      pendingApprovals: pendingCount,
      newIntakes: intakeCount,
      upcomingDeadlines: upcomingDeadlines.length,
      staleDeals: staleDeals.length,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Get fresh access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: gmailClientId,
      client_secret: gmailClientSecret,
      refresh_token: gmailRefreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return new Response(JSON.stringify({ error: 'Failed to get Gmail access token', detail: tokenData }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const mimeBytes = buildMimeEmail('maxwelldelali22@gmail.com', subject, plainBody, htmlBody);
  const rawEmail = toBase64Url(mimeBytes);

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawEmail }),
  });

  const sendData = await sendRes.json();

  return new Response(JSON.stringify({
    status: sendData.id ? 'sent' : 'error',
    messageId: sendData.id,
    subject,
    viewings: viewingCount,
    pendingApprovals: pendingCount,
    newIntakes: intakeCount,
    upcomingDeadlines: upcomingDeadlines.length,
    staleDeals: staleDeals.length,
    error: sendData.error || undefined,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
