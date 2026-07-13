/**
 * Maxwell DealFlow CRM — Morning Briefing Edge Function
 *
 * Runs every day at 10:30 UTC (~8:00 AM Newfoundland) via pg_cron —
 * see migration 053_schedule_morning_briefing.sql.
 * Sends Maxwell a summary email to AGENT_EMAIL (falls back to GMAIL_USER) covering:
 *
 *   1. Today's viewings — who, what property, what time
 *   2. Pending approvals — emails waiting for his review/send
 *   3. Offers awaiting seller response — Submitted/Countered, with response-due
 *   4. New intake forms — unreviewed client submissions
 *   5. Active pipeline deals — current stage snapshot
 *   6. Deadlines — overdue (last 7 days) and upcoming (next 7 days)
 *   7. Stale deals — stuck > 14 days with no movement
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Maxwell works out of Newfoundland — all "what day is it" logic uses this zone
const TZ = 'America/St_Johns';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const fmtTime = (timeStr: string | null) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
};

// Plain YYYY-MM-DD dates (closing_date, deadlines) — format as-is, no TZ shift
const fmtDate = (iso: string) =>
  new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

// Full timestamptz values (created_at, submitted_at) — show Newfoundland local day
const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ,
  });

// Mirror of app.js fmtMoney — whole dollars, CAD-style grouping
const fmtMoney = (n: unknown): string => {
  const num = Number(n);
  if (!isFinite(num) || num === 0) return '—';
  return '$' + Math.round(num).toLocaleString('en-CA');
};

const daysUntil = (dateStr: string, today: Date): number => {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
};

// Mirror of offers.js stage-badge logic — keeps email in sync with UI badge
const displayStage = (deal: any, today: Date): string => {
  if (deal.stage === 'Closed') return 'Closed';
  if (deal.stage === 'Fell Through') return 'Fell Through';
  if (deal.stage === 'Under Contract') return 'Under Contract';
  if (deal.financing_date) {
    const fd = new Date(deal.financing_date + 'T00:00:00Z');
    if (fd <= today) return 'Under Contract';
  }
  return deal.stage;
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

  const fromName = Deno.env.get('AGENT_NAME') || 'Maxwell DealFlow';
  const fromAddr = Deno.env.get('GMAIL_USER');
  if (!fromAddr) throw new Error('GMAIL_USER not configured');

  const mime = [
    `From: ${fromName} <${fromAddr}>`,
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
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

  // "Today" = today in Newfoundland, not UTC. Edge functions run in UTC, and
  // NT is UTC-2:30/-3:30 — a naive new Date() flips to tomorrow at 21:30 local.
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now); // YYYY-MM-DD
  const today = new Date(todayStr + 'T00:00:00Z'); // UTC-midnight anchor for day math

  const dayName = now.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });

  // Swallowing query errors made failures invisible — collect and report them
  const queryErrors: string[] = [];
  const trackErr = (label: string, error: { message?: string } | null) => {
    if (error) {
      console.error(`morning-briefing: ${label} query failed —`, error.message);
      queryErrors.push(`${label}: ${error.message}`);
    }
  };

  // ── 1. Today's viewings ────────────────────────────────────────────────────
  const { data: todayViewings, error: viewErr } = await supabase
    .from('viewings')
    .select('id, property_address, viewing_time, viewing_status, client_id')
    .eq('viewing_date', todayStr)
    .order('viewing_time', { ascending: true });
  trackErr('viewings', viewErr);

  // Resolve client names in one batched query (was one query per viewing)
  const clientIds = [...new Set((todayViewings ?? []).map((v: any) => v.client_id).filter(Boolean))];
  const nameById: Record<string, string> = {};
  if (clientIds.length) {
    const { data: cs } = await supabase.from('clients').select('id, full_name').in('id', clientIds);
    for (const c of (cs ?? [])) nameById[c.id] = c.full_name;
  }
  const viewingsWithClients = (todayViewings ?? []).map((v: any) => ({
    ...v, client_name: nameById[v.client_id] || 'Unknown Client',
  }));

  // ── 2. Pending approvals ───────────────────────────────────────────────────
  const { data: pendingApprovals, error: apprErr } = await supabase
    .from('approval_queue')
    .select('id, approval_type, client_name, email_subject, created_at')
    .eq('status', 'Pending')
    .order('created_at', { ascending: true });
  trackErr('approval_queue', apprErr);

  // ── 2b. Failed sends — client emails that did NOT go out ───────────────────
  // The silent-delivery guard: a send that errored is marked status 'Failed'
  // (see js/extras.js Approvals._markFailed) instead of vanishing. Surface it
  // loudly here so a dropped client email can't sit unnoticed.
  const { data: failedSends, error: failedErr } = await supabase
    .from('approval_queue')
    .select('id, approval_type, client_name, email_subject, created_at')
    .eq('status', 'Failed')
    .order('created_at', { ascending: true });
  trackErr('approval_queue(failed)', failedErr);

  // ── 3. New intake forms ────────────────────────────────────────────────────
  const { data: newIntakes, error: intakeErr } = await supabase
    .from('client_intake')
    .select('id, full_name, submitted_at, email')
    .eq('status', 'New')
    .order('submitted_at', { ascending: false });
  trackErr('client_intake', intakeErr);

  // ── 4. Active pipeline deals ───────────────────────────────────────────────
  // NOTE: the deadline columns are financing_date / inspection_date (see
  // migration 013) — there are no *_deadline columns on pipeline.
  // 'Done' and 'Sold' are legacy terminal stages (see clients.js getStage and
  // notifications.js SKIP_STAGES) — exclude them or old deals show as active.
  const { data: activeDeals, error: pipeErr } = await supabase
    .from('pipeline')
    .select('id, client_name, property_address, stage, closing_date, financing_date, inspection_date, inspection_skipped, walkthrough_date, walkthrough_skipped, updated_at')
    .not('stage', 'in', '("Closed","Fell Through","Withdrawn","Done","Sold")')
    .order('updated_at', { ascending: false });
  trackErr('pipeline', pipeErr);

  // ── 4b. Offers awaiting seller response ────────────────────────────────────
  const { data: openOffers, error: offerErr } = await supabase
    .from('offers')
    .select('id, client_name, property_address, offer_amount, offer_date, seller_response_due, status')
    .in('status', ['Submitted', 'Countered'])
    .order('offer_date', { ascending: true });
  trackErr('offers', offerErr);

  // ── 5. Upcoming deadlines this week ───────────────────────────────────────
  type Deadline = { label: string; client: string; address: string; daysLeft: number; date: string };
  const upcomingDeadlines: Deadline[] = [];
  for (const deal of (activeDeals ?? [])) {
    const checks: Array<{ field: string; label: string; skipFlag?: string }> = [
      { field: 'financing_date', label: 'Financing' },
      { field: 'inspection_date', label: 'Inspection', skipFlag: 'inspection_skipped' },
      { field: 'walkthrough_date', label: 'Walkthrough', skipFlag: 'walkthrough_skipped' },
      { field: 'closing_date', label: 'Closing' },
    ];
    for (const { field, label, skipFlag } of checks) {
      if (skipFlag && (deal as any)[skipFlag]) continue; // buyer waived this milestone
      const dateVal = (deal as any)[field];
      if (!dateVal) continue;
      const days = daysUntil(dateVal, today);
      // Include the last 7 days too — a missed deadline on an active deal is
      // the most urgent thing in this email, not something to hide.
      if (days >= -7 && days <= 7) {
        upcomingDeadlines.push({
          label,
          client: deal.client_name || '—',
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
  const headingStyle = 'font-size: 16px; font-weight: 700; color: #1a1a2e; border-bottom: 2px solid #CC785C; padding-bottom: 6px; margin: 0 0 12px 0;';
  const tableStyle = 'width: 100%; border-collapse: collapse; font-size: 13px;';
  const thStyle = 'background: #FBEFE8; padding: 8px 10px; text-align: left; font-weight: 600; color: #444;';
  const tdStyle = 'padding: 8px 10px; border-bottom: 1px solid #eee; color: #333;';
  const badgeGreen = 'display:inline-block;background:#e6f9f0;color:#1a7a4a;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;';
  const badgeOrange = 'display:inline-block;background:#fff3e0;color:#b05e00;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;';
  const badgeRed = 'display:inline-block;background:#fdecea;color:#b71c1c;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;';
  // inline-block + margins instead of flex — flex is stripped by several email clients
  const chipStyle = 'display:inline-block;background:rgba(255,255,255,0.22);color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin:0 8px 6px 0;';

  // Section 0: Failed sends — client emails that did NOT go out (most urgent)
  let failedHtml = '';
  if (failedSends?.length) {
    failedHtml = `<table style="${tableStyle}">
      <tr><th style="${thStyle}">Type</th><th style="${thStyle}">Client</th><th style="${thStyle}">Subject</th><th style="${thStyle}">Queued</th></tr>
      ${failedSends.map((a: any) => `
        <tr>
          <td style="${tdStyle}"><span style="${badgeRed}">${esc(a.approval_type)}</span></td>
          <td style="${tdStyle}">${esc(a.client_name)}</td>
          <td style="${tdStyle}">${esc(a.email_subject)}</td>
          <td style="${tdStyle}">${fmtStamp(a.created_at)}</td>
        </tr>`).join('')}
    </table>`;
  }

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
          <td style="${tdStyle}">${esc(v.client_name)}</td>
          <td style="${tdStyle}">${esc(v.property_address) || '—'}</td>
          <td style="${tdStyle}"><span style="${v.viewing_status === 'Completed' ? badgeGreen : badgeOrange}">${esc(v.viewing_status)}</span></td>
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
          <td style="${tdStyle}"><span style="${badgeOrange}">${esc(a.approval_type)}</span></td>
          <td style="${tdStyle}">${esc(a.client_name)}</td>
          <td style="${tdStyle}">${esc(a.email_subject)}</td>
          <td style="${tdStyle}">${fmtStamp(a.created_at)}</td>
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
          <td style="${tdStyle}">${esc(i.full_name) || '—'}</td>
          <td style="${tdStyle}">${esc(i.email) || '—'}</td>
          <td style="${tdStyle}">${fmtStamp(i.submitted_at)}</td>
        </tr>`).join('')}
    </table>`;
  }

  // Section 3b: Offers awaiting seller response
  let offersHtml = '';
  if (!openOffers?.length) {
    offersHtml = `<p style="color:#888;font-style:italic;margin:0;">No offers awaiting a response.</p>`;
  } else {
    offersHtml = `<table style="${tableStyle}">
      <tr><th style="${thStyle}">Client</th><th style="${thStyle}">Property</th><th style="${thStyle}">Offer</th><th style="${thStyle}">Status</th><th style="${thStyle}">Response Due</th></tr>
      ${openOffers.map((o: any) => {
        // seller_response_due is a full timestamptz — resolve to its NT-local
        // day first, or the UTC date flips the day for evening deadlines
        const dueDays = o.seller_response_due
          ? daysUntil(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(o.seller_response_due)), today)
          : null;
        const dueBadge = dueDays === null ? '' :
          dueDays < 0 ? `<span style="${badgeRed}">OVERDUE</span>` :
          dueDays === 0 ? `<span style="${badgeOrange}">TODAY</span>` :
          `<span style="${badgeGreen}">${dueDays}d</span>`;
        return `<tr>
          <td style="${tdStyle}">${esc(o.client_name) || '—'}</td>
          <td style="${tdStyle}">${esc(o.property_address) || '—'}</td>
          <td style="${tdStyle}">${fmtMoney(o.offer_amount)}</td>
          <td style="${tdStyle}"><span style="${o.status === 'Countered' ? badgeOrange : badgeGreen}">${esc(o.status)}</span></td>
          <td style="${tdStyle}">${o.seller_response_due ? `${fmtStamp(o.seller_response_due)} ${dueBadge}` : '—'}</td>
        </tr>`;
      }).join('')}
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
          <td style="${tdStyle}">${esc(d.client_name) || '—'}</td>
          <td style="${tdStyle}">${esc(d.property_address) || '—'}</td>
          <td style="${tdStyle}"><span style="${badgeGreen}">${esc(displayStage(d, today))}</span></td>
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
      <tr><th style="${thStyle}">Type</th><th style="${thStyle}">Client</th><th style="${thStyle}">Property</th><th style="${thStyle}">Date</th><th style="${thStyle}">Days Left</th></tr>
      ${upcomingDeadlines.map((d) => {
        const badge = d.daysLeft <= 0 ? badgeRed : d.daysLeft <= 2 ? badgeOrange : badgeGreen;
        const label = d.daysLeft < 0 ? `OVERDUE ${-d.daysLeft}d` : d.daysLeft === 0 ? 'TODAY' : `${d.daysLeft}d`;
        return `<tr>
          <td style="${tdStyle}">${d.label}</td>
          <td style="${tdStyle}">${esc(d.client)}</td>
          <td style="${tdStyle}">${esc(d.address)}</td>
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
          <td style="${tdStyle}">${esc(d.client_name) || '—'}</td>
          <td style="${tdStyle}">${esc(d.property_address) || '—'}</td>
          <td style="${tdStyle}">${esc(d.stage)}</td>
          <td style="${tdStyle}"><span style="${badgeRed}">${days} days ago</span></td>
        </tr>`;
      }).join('')}
    </table>`;
  }

  // ── Assemble counts for subject line ──────────────────────────────────────
  const pendingCount = pendingApprovals?.length ?? 0;
  const failedCount = failedSends?.length ?? 0;
  const intakeCount = newIntakes?.length ?? 0;
  const viewingCount = viewingsWithClients.length;
  const offerCount = openOffers?.length ?? 0;
  const deadlineCount = upcomingDeadlines.filter(d => d.daysLeft <= 2).length;

  const alerts = [];
  if (failedCount > 0) alerts.push(`⚠️ ${failedCount} FAILED send${failedCount > 1 ? 's' : ''}`);
  if (viewingCount > 0) alerts.push(`${viewingCount} viewing${viewingCount > 1 ? 's' : ''}`);
  if (pendingCount > 0) alerts.push(`${pendingCount} approval${pendingCount > 1 ? 's' : ''}`);
  if (offerCount > 0) alerts.push(`${offerCount} open offer${offerCount > 1 ? 's' : ''}`);
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
    <div style="background:linear-gradient(135deg,#CC785C 0%,#D98B6F 100%);border-radius:12px 12px 0 0;padding:24px 28px;margin-bottom:0;">
      <div style="font-size:22px;font-weight:700;color:#fff;">☀️ Good Morning, Maxwell</div>
      <div style="font-size:13px;color:#FBE4D6;margin-top:4px;">${dayName}</div>
      <div style="margin-top:16px;">
        ${failedCount > 0 ? `<span style="${chipStyle}">⚠️ ${failedCount} Failed Send${failedCount > 1 ? 's' : ''}</span>` : ''}
        ${viewingCount > 0 ? `<span style="${chipStyle}">📅 ${viewingCount} Viewing${viewingCount > 1 ? 's' : ''} Today</span>` : ''}
        ${pendingCount > 0 ? `<span style="${chipStyle}">📬 ${pendingCount} Pending Approval${pendingCount > 1 ? 's' : ''}</span>` : ''}
        ${offerCount > 0 ? `<span style="${chipStyle}">📝 ${offerCount} Open Offer${offerCount > 1 ? 's' : ''}</span>` : ''}
        ${intakeCount > 0 ? `<span style="${chipStyle}">📋 ${intakeCount} New Lead${intakeCount > 1 ? 's' : ''}</span>` : ''}
        ${deadlineCount > 0 ? `<span style="${chipStyle}">⚠️ ${deadlineCount} Urgent Deadline${deadlineCount > 1 ? 's' : ''}</span>` : ''}
        ${alerts.length === 0 ? `<span style="${chipStyle}">✅ All clear — great day ahead!</span>` : ''}
      </div>
    </div>

    <!-- Content card -->
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

      ${failedCount > 0 ? `<div style="${sectionStyle}">
        <div style="${headingStyle}">⚠️ Failed Sends — NOT Delivered</div>
        <p style="color:#b71c1c;font-size:12px;margin:0 0 10px;">These client emails failed to send and are still sitting in Approvals. Open DealFlow and tap <strong>Retry send</strong>.</p>
        ${failedHtml}
      </div>` : ''}

      <div style="${sectionStyle}">
        <div style="${headingStyle}">📅 Today's Viewings</div>
        ${viewingsHtml}
      </div>

      <div style="${sectionStyle}">
        <div style="${headingStyle}">📬 Pending Approvals</div>
        ${approvalsHtml}
      </div>

      <div style="${sectionStyle}">
        <div style="${headingStyle}">📝 Offers Awaiting Response</div>
        ${offersHtml}
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

      <!-- CTA -->
      <div style="text-align:center;margin:4px 0 20px 0;">
        <a href="https://maxwell-dealflow.vercel.app" style="display:inline-block;background:#CC785C;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 32px;border-radius:8px;">Open DealFlow →</a>
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
${failedCount > 0 ? `
⚠️ FAILED SENDS — NOT DELIVERED (${failedCount})
${failedSends!.map((a: any) => `  • [${a.approval_type}] ${a.client_name} — ${a.email_subject}`).join('\n')}
` : ''}
TODAY'S VIEWINGS (${viewingCount})
${viewingsWithClients.length === 0 ? 'No viewings today.' : viewingsWithClients.map((v: any) => `  • ${fmtTime(v.viewing_time)} — ${v.client_name} @ ${v.property_address}`).join('\n')}

PENDING APPROVALS (${pendingCount})
${!pendingApprovals?.length ? "You're all caught up!" : pendingApprovals.map((a: any) => `  • [${a.approval_type}] ${a.client_name} — ${a.email_subject}`).join('\n')}

OFFERS AWAITING RESPONSE (${offerCount})
${!openOffers?.length ? 'No offers awaiting a response.' : openOffers.map((o: any) => `  • ${o.client_name || '—'} — ${o.property_address || '—'} @ ${fmtMoney(o.offer_amount)} [${o.status}]`).join('\n')}

NEW CLIENT LEADS (${intakeCount})
${!newIntakes?.length ? 'No new intakes.' : newIntakes.map((i: any) => `  • ${i.full_name || 'Unknown'} (${i.email || '—'})`).join('\n')}

ACTIVE PIPELINE (${activeDeals?.length ?? 0} deals)
${!activeDeals?.length ? 'No active deals.' : activeDeals.map((d: any) => `  • ${d.client_name} — ${d.property_address} [${d.stage}]`).join('\n')}

UPCOMING DEADLINES THIS WEEK
${upcomingDeadlines.length === 0 ? 'No deadlines in the next 7 days.' : upcomingDeadlines.map(d => `  • ${d.label} — ${d.client} @ ${d.address} (${d.date}, ${d.daysLeft < 0 ? 'OVERDUE ' + (-d.daysLeft) + 'd' : d.daysLeft === 0 ? 'TODAY' : d.daysLeft + 'd'})`).join('\n')}

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
      failedSends: failedCount,
      openOffers: offerCount,
      newIntakes: intakeCount,
      upcomingDeadlines: upcomingDeadlines.length,
      staleDeals: staleDeals.length,
      queryErrors: queryErrors.length ? queryErrors : undefined,
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

  const briefingTo = Deno.env.get('AGENT_EMAIL') || Deno.env.get('GMAIL_USER');
  if (!briefingTo) {
    return new Response(JSON.stringify({ error: 'AGENT_EMAIL / GMAIL_USER not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const mimeBytes = buildMimeEmail(briefingTo, subject, plainBody, htmlBody);
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
    failedSends: failedCount,
    openOffers: offerCount,
    newIntakes: intakeCount,
    upcomingDeadlines: upcomingDeadlines.length,
    staleDeals: staleDeals.length,
    queryErrors: queryErrors.length ? queryErrors : undefined,
    error: sendData.error || undefined,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
