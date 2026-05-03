/**
 * Maxwell DealFlow CRM — Daily Automation Edge Function
 *
 * Runs every day at 8:00 AM UTC (via pg_cron).
 * Scans all active pipeline deals for approaching deadlines and queues approval emails.
 *
 * What it does:
 *   1. Financing deadline — reminder 3 days before and 1 day before
 *   2. Inspection deadline — reminder 3 days before and 1 day before
 *   3. Walkthrough reminders — queue reminder 1 day before walkthrough
 *   4. Closing-day email — queue "Happy Closing Day!" on the closing date itself
 *   5. Post-closing referral — queue referral ask 7 days after closing
 *   6. Stale deal alerts — log a note if a deal has been stuck in same stage > 30 days
 *   7. Post-viewing feedback — for any viewing that happened today or earlier,
 *      status still Scheduled, no feedback yet → queue feedback request
 *
 * Idempotency: Every approval_queue insert is guarded by checking for an existing
 * Pending row with the same (agent_id, related_id, approval_type) within 25 hours.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PipelineDeal {
  id: string;
  agent_id: string;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  property_address: string | null;
  stage: string | null;
  financing_deadline: string | null;
  inspection_deadline: string | null;
  walkthrough_date: string | null;
  closing_date: string | null;
  updated_at: string | null;
}

interface Agent {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface QueuedEmail {
  agent_id: string;
  client_name: string;
  client_email: string;
  approval_type: string;
  email_subject: string;
  email_body: string;
  related_id: string;
  status: string;
}

// ─── Email template helpers ───────────────────────────────────────────────────

const sig = (agent: Agent) =>
  `${agent.full_name || 'Maxwell Delali Midodzi'}
REALTOR® | eXp Realty
Phone: ${agent.phone || '(709) 325-0545'} | Email: ${agent.email || 'Maxwell.Midodzi@exprealty.com'}
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`;

const firstName = (name: string | null) => name?.split(' ')[0] || 'there';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const templates = {

  financing_reminder_3d: (deal: PipelineDeal, agent: Agent) => ({
    subject: `⏰ Reminder: Financing Deadline in 3 Days — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

Just a friendly reminder that your financing deadline for ${deal.property_address} is in 3 days (${fmtDate(deal.financing_deadline!)}).

Please ensure your mortgage approval is confirmed with your lender. If there are any delays or concerns, please contact me immediately so we can discuss your options before the deadline.

${sig(agent)}`,
  }),

  financing_reminder_1d: (deal: PipelineDeal, agent: Agent) => ({
    subject: `🚨 URGENT: Financing Deadline Tomorrow — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

IMPORTANT REMINDER — your financing deadline for ${deal.property_address} is TOMORROW (${fmtDate(deal.financing_deadline!)}).

Please confirm with your lender today that your mortgage is approved. If there are any issues, call me immediately — this is time-sensitive.

${sig(agent)}`,
  }),

  inspection_reminder_3d: (deal: PipelineDeal, agent: Agent) => ({
    subject: `⏰ Reminder: Home Inspection Deadline in 3 Days — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

A quick reminder that your home inspection condition deadline for ${deal.property_address} is in 3 days (${fmtDate(deal.inspection_deadline!)}).

If you haven't already booked your inspection, please do so immediately. If you need a recommendation for a home inspector, I'm happy to help.

${sig(agent)}`,
  }),

  inspection_reminder_1d: (deal: PipelineDeal, agent: Agent) => ({
    subject: `🚨 URGENT: Inspection Deadline Tomorrow — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

IMPORTANT — your home inspection deadline for ${deal.property_address} is TOMORROW (${fmtDate(deal.inspection_deadline!)}).

Please ensure your inspection is complete and any concerns have been reviewed. Contact me right away if you need to discuss the results or next steps.

${sig(agent)}`,
  }),

  walkthrough_reminder: (deal: PipelineDeal, agent: Agent) => ({
    subject: `🏠 Reminder: Final Walkthrough Tomorrow — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

Just a reminder that your final walkthrough is scheduled for TOMORROW at ${deal.property_address}.

During the walkthrough, please check:
✅ All appliances and fixtures are working
✅ No new damage since your inspection
✅ All agreed-upon repairs have been completed
✅ The property is in the expected condition

I'll meet you there at the scheduled time. Please don't hesitate to reach out if you have any questions beforehand.

${sig(agent)}`,
  }),

  closing_day: (deal: PipelineDeal, agent: Agent) => ({
    subject: `🔑 Happy Closing Day! — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

Today is the big day — CLOSING DAY! 🎉🔑

Here's your closing day checklist:
✅ Bring valid government-issued photo ID
✅ Bring your certified cheque or confirm wire transfer is complete
✅ Meet with your lawyer to sign final documents
✅ Pick up your keys!

After today, ${deal.property_address} is officially YOURS.

It has been my absolute honour to help you through this journey. Congratulations on your new home! Please stay in touch — I'm always here for any real estate needs.

${sig(agent)}`,
  }),

  post_closing_referral: (deal: PipelineDeal, agent: Agent) => ({
    subject: `🏡 How's the New Home? — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

It's been about a week since you moved into your new home at ${deal.property_address} — I hope you're settling in beautifully!

I just wanted to check in and say it was truly a pleasure working with you throughout this process.

If you're happy with the experience, I'd be so grateful if you could take 2 minutes to leave me a Google Review — it helps other buyers find me and means the world to me:

👉 https://g.page/r/ [your-google-review-link]

Also, if any of your friends, family, or colleagues are thinking about buying or selling, I'd love to help them too. Referrals are the highest compliment you can give me!

Wishing you all the best in your new home,

${sig(agent)}`,
  }),

};

// ─── Idempotency check ────────────────────────────────────────────────────────

async function isDuplicate(
  supabase: ReturnType<typeof createClient>,
  agentId: string,
  relatedId: string,
  approvalType: string,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('approval_queue')
    .select('id')
    .eq('agent_id', agentId)
    .eq('related_id', relatedId)
    .eq('approval_type', approvalType)
    .eq('status', 'Pending')
    .gte('created_at', windowStart)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ─── Queue one approval email ─────────────────────────────────────────────────

async function queueEmail(
  supabase: ReturnType<typeof createClient>,
  agentId: string,
  clientName: string,
  clientEmail: string,
  relatedId: string,
  approvalType: string,
  subject: string,
  body: string,
): Promise<{ queued: boolean; error?: string }> {
  if (!clientEmail) return { queued: false, error: 'no client email' };

  const dup = await isDuplicate(supabase, agentId, relatedId, approvalType);
  if (dup) return { queued: false, error: 'duplicate' };

  const { error } = await supabase.from('approval_queue').insert({
    agent_id: agentId,
    client_name: clientName || 'Client',
    client_email: clientEmail,
    approval_type: approvalType,
    email_subject: subject,
    email_body: body,
    related_id: relatedId,
    status: 'Pending',
  } as QueuedEmail);

  if (error) return { queued: false, error: error.message };
  return { queued: true };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const summary = {
    processed: 0,
    queued: 0,
    skipped_duplicate: 0,
    errors: [] as string[],
    runAt: new Date().toISOString(),
  };

  // ── 1. Load all active pipeline deals ──────────────────────────────────────
  const { data: deals, error: dealsErr } = await supabase
    .from('pipeline')
    .select('id, agent_id, client_id, client_name, client_email, property_address, stage, financing_deadline, inspection_deadline, walkthrough_date, closing_date, updated_at')
    .not('stage', 'in', '("Closed","Fell Through","Withdrawn")');

  if (dealsErr || !deals) {
    return new Response(
      JSON.stringify({ error: 'Failed to load pipeline', detail: dealsErr?.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── 2. Load all agents ─────────────────────────────────────────────────────
  const agentIds = [...new Set(deals.map((d: PipelineDeal) => d.agent_id))];
  const { data: agents } = await supabase
    .from('agents')
    .select('id, full_name, email, phone');

  const agentMap = new Map<string, Agent>();
  for (const a of agents ?? []) agentMap.set(a.id, a as Agent);

  // ── 3. Process each active deal ────────────────────────────────────────────
  for (const deal of deals as PipelineDeal[]) {
    summary.processed++;
    const agent = agentMap.get(deal.agent_id) ?? { id: deal.agent_id, full_name: null, email: null, phone: null };

    const daysUntil = (dateStr: string | null): number | null => {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      return Math.round((d.getTime() - today.getTime()) / 86_400_000);
    };

    // ── 3a. Financing deadline reminders ────────────────────────────────────
    if (deal.financing_deadline) {
      const days = daysUntil(deal.financing_deadline);
      if (days === 3) {
        const t = templates.financing_reminder_3d(deal, agent);
        const r = await queueEmail(supabase, deal.agent_id, deal.client_name!, deal.client_email!, deal.id, 'Financing Reminder (3 days)', t.subject, t.body);
        r.queued ? summary.queued++ : r.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${r.error}`);
      }
      if (days === 1) {
        const t = templates.financing_reminder_1d(deal, agent);
        const r = await queueEmail(supabase, deal.agent_id, deal.client_name!, deal.client_email!, deal.id, 'Financing Reminder (1 day)', t.subject, t.body);
        r.queued ? summary.queued++ : r.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${r.error}`);
      }
    }

    // ── 3b. Inspection deadline reminders ───────────────────────────────────
    if (deal.inspection_deadline) {
      const days = daysUntil(deal.inspection_deadline);
      if (days === 3) {
        const t = templates.inspection_reminder_3d(deal, agent);
        const r = await queueEmail(supabase, deal.agent_id, deal.client_name!, deal.client_email!, deal.id, 'Inspection Reminder (3 days)', t.subject, t.body);
        r.queued ? summary.queued++ : r.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${r.error}`);
      }
      if (days === 1) {
        const t = templates.inspection_reminder_1d(deal, agent);
        const r = await queueEmail(supabase, deal.agent_id, deal.client_name!, deal.client_email!, deal.id, 'Inspection Reminder (1 day)', t.subject, t.body);
        r.queued ? summary.queued++ : r.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${r.error}`);
      }
    }

    // ── 3c. Walkthrough reminder ─────────────────────────────────────────────
    if (deal.walkthrough_date && daysUntil(deal.walkthrough_date) === 1) {
      const t = templates.walkthrough_reminder(deal, agent);
      const r = await queueEmail(supabase, deal.agent_id, deal.client_name!, deal.client_email!, deal.id, 'Walkthrough Reminder', t.subject, t.body);
      r.queued ? summary.queued++ : r.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${r.error}`);
    }

    // ── 3d. Closing day ──────────────────────────────────────────────────────
    if (deal.closing_date && daysUntil(deal.closing_date) === 0) {
      const t = templates.closing_day(deal, agent);
      const r = await queueEmail(supabase, deal.agent_id, deal.client_name!, deal.client_email!, deal.id, 'Closing Day', t.subject, t.body);
      r.queued ? summary.queued++ : r.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${r.error}`);
    }
  }

  // ── 4. Post-closing referral (7 days after closing) ───────────────────────
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const eightDaysAgo = new Date(today.getTime() - 8 * 86_400_000).toISOString().slice(0, 10);

  const { data: closedDeals } = await supabase
    .from('pipeline')
    .select('id, agent_id, client_id, client_name, client_email, property_address, stage, financing_deadline, inspection_deadline, walkthrough_date, closing_date, updated_at')
    .eq('stage', 'Closed')
    .gte('closing_date', eightDaysAgo)
    .lte('closing_date', sevenDaysAgo);

  for (const deal of (closedDeals ?? []) as PipelineDeal[]) {
    if (!deal.closing_date) continue;
    const closeDate = new Date(deal.closing_date);
    closeDate.setHours(0, 0, 0, 0);
    const daysSince = Math.round((today.getTime() - closeDate.getTime()) / 86_400_000);
    if (daysSince !== 7) continue;
    const agent = agentMap.get(deal.agent_id) ?? { id: deal.agent_id, full_name: null, email: null, phone: null };
    const t = templates.post_closing_referral(deal, agent);
    const r = await queueEmail(supabase, deal.agent_id, deal.client_name!, deal.client_email!, deal.id, 'Post-Closing Referral', t.subject, t.body);
    r.queued ? summary.queued++ : r.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${r.error}`);
  }

  // ── 5. Post-viewing feedback requests ─────────────────────────────────────
  // Any viewing where: date <= today, status = Scheduled, no client_feedback
  // These are viewings that happened but were never manually marked Completed
  const { data: pastViewings } = await supabase
    .from('viewings')
    .select('id, client_id, property_address, viewing_date, viewing_time, viewing_status')
    .eq('viewing_status', 'Scheduled')
    .is('client_feedback', null)
    .lte('viewing_date', todayStr);

  for (const v of (pastViewings ?? [])) {
    if (!v.client_id) continue;

    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, full_name, email, agent_id')
      .eq('id', v.client_id)
      .single();

    if (!clientRow?.email) continue;

    const agent = agentMap.get(clientRow.agent_id) ?? { id: clientRow.agent_id, full_name: null, email: null, phone: null };
    const viewDateFmt = fmtDate(v.viewing_date);
    const fn = firstName(clientRow.full_name);

    const subject = `How Did the Viewing Go? — ${v.property_address}`;
    const body = `Hi ${fn},

I hope you enjoyed viewing ${v.property_address} on ${viewDateFmt}!

I'd love to hear your thoughts — your feedback helps me find the perfect home for you:

🏠 Did the property meet your expectations?
📐 Did the size and layout work for you?
💰 Do you feel the asking price is fair?
❓ Any questions or concerns?

Feel free to reply directly to this email or give me a call anytime.

${sig(agent)}`;

    // Dedup check
    const windowStart = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { data: dupCheck } = await supabase
      .from('approval_queue')
      .select('id')
      .eq('agent_id', clientRow.agent_id)
      .eq('related_id', v.id)
      .eq('approval_type', 'Post-Viewing Feedback Request')
      .eq('status', 'Pending')
      .gte('created_at', windowStart)
      .limit(1);

    if ((dupCheck?.length ?? 0) > 0) { summary.skipped_duplicate++; continue; }

    const { error: qErr } = await supabase.from('approval_queue').insert({
      agent_id: clientRow.agent_id,
      client_name: clientRow.full_name,
      client_email: clientRow.email,
      approval_type: 'Post-Viewing Feedback Request',
      email_subject: subject,
      email_body: body,
      related_id: v.id,
      status: 'Pending',
    });

    if (qErr) {
      summary.errors.push(`viewing ${v.id}: ${qErr.message}`);
    } else {
      summary.queued++;
      // Mark the viewing as needing follow-up so it doesn't re-queue tomorrow
      await supabase.from('viewings').update({ viewing_status: 'Needs Follow-Up' }).eq('id', v.id);
    }
  }

  // ── 6. Stale deal detection (stuck > 30 days with no update) ──────────────
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000).toISOString();

  const { data: staleDeals } = await supabase
    .from('pipeline')
    .select('id, agent_id, client_name, stage, updated_at')
    .not('stage', 'in', '("Closed","Fell Through","Withdrawn")')
    .lt('updated_at', thirtyDaysAgo);

  for (const deal of (staleDeals ?? [])) {
    if (!deal.updated_at) continue;
    const dayStuck = Math.round((today.getTime() - new Date(deal.updated_at).getTime()) / 86_400_000);
    await supabase.from('activity_log').insert({
      agent_id: deal.agent_id,
      activity_type: 'STALE_DEAL_ALERT',
      note: `Deal "${deal.client_name}" has been in stage "${deal.stage}" for ${dayStuck} days with no updates. Consider following up.`,
      related_id: deal.id,
    }).select();
  }

  // ── 8. STAKEHOLDER NUDGE (T+48h, one-time) + AGENT ALERT (T+5d) ───────
  // For every non-client stakeholder that's been invited but hasn't acted:
  //   • At T+48h since invite, send ONE polite nudge (mark `last_nudged_at`).
  //   • At T+5d since invite, drop an agent-side activity_log alert so
  //     Maxwell can pick up the phone himself.
  const fortyEightHoursAgo = new Date(today.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const fiveDaysAgo        = new Date(today.getTime() -  5 * 86_400_000).toISOString();

  const { data: pendingStakes } = await supabase.from('deal_stakeholders')
    .select('id, agent_id, pipeline_id, client_id, role, name, email, token, created_at, last_accessed, completed_at, last_nudged_at')
    .is('revoked_at', null)
    .is('completed_at', null)
    .neq('role', 'client');

  const PORTAL_BASE = 'https://maxwell-dealflow.vercel.app/stakeholder.html';
  let nudgesQueued = 0, alertsLogged = 0;

  for (const s of (pendingStakes ?? [])) {
    const created = s.created_at ? new Date(s.created_at).getTime() : 0;
    const opened  = s.last_accessed ? new Date(s.last_accessed).getTime() : 0;
    const ageMs   = today.getTime() - created;

    // Skip if they've already opened — they're in motion, no nudge needed
    if (opened > 0) continue;

    // T+48h nudge — only ONCE (last_nudged_at must be null)
    if (ageMs >= 48 * 60 * 60 * 1000 && !s.last_nudged_at && s.email) {
      const portalUrl = `${PORTAL_BASE}?t=${s.token}`;
      const roleLbl = s.role === 'mortgage_broker' ? 'mortgage broker'
                    : s.role === 'inspector'       ? 'inspection'
                    : s.role === 'lawyer'          ? 'lawyer / notary'
                    : s.role;
      const first = (s.name || '').split(' ')[0] || 'there';
      // Look up client name + property for context
      const { data: pipe } = await supabase.from('pipeline')
        .select('client_name, property_address').eq('id', s.pipeline_id).single();
      const subj = `Quick reminder — your portal for ${pipe?.client_name || 'the deal'} on ${pipe?.property_address || ''}`;
      const body = `Hi ${first},

Just circling back — I sent you a portal link 48 hours ago for ${pipe?.client_name || 'my client'}'s deal on ${pipe?.property_address || 'the property'}. No urgency, but it would help me if you could open it when you have a moment so we can keep things moving.

Open your portal: ${portalUrl}

Thank you,

Maxwell Delali Midodzi
REALTOR® | eXp Realty
Phone: (709) 325-0545 | Email: Maxwell.Midodzi@exprealty.com
eXp Realty, 33 Pippy PL, Suite 101, St. John's, NL A1B 3X2
maxwellmidodzi.exprealty.com

──────────────────────────────────────────
CONFIDENTIALITY NOTICE: This email is confidential and intended only for the named recipient(s). Unauthorized access, use, or distribution is prohibited. If received in error, please notify the sender and delete immediately.`;

      await supabase.from('approval_queue').insert({
        agent_id: s.agent_id,
        client_name: s.name, client_email: s.email,
        approval_type: `Stakeholder nudge → ${roleLbl} 🔔`,
        email_subject: subj, email_body: body,
        related_id: s.pipeline_id, status: 'Pending'
      });
      await supabase.from('deal_stakeholders').update({
        last_nudged_at: new Date().toISOString()
      }).eq('id', s.id);
      nudgesQueued++;
    }

    // T+5d agent alert — only ONCE per stakeholder (we use activity_log for idempotency)
    if (ageMs >= 5 * 86_400_000) {
      // Check we haven't already logged this alert
      const { data: existing } = await supabase.from('activity_log')
        .select('id').eq('related_id', s.id)
        .eq('activity_type', 'STAKEHOLDER_STUCK_ALERT').limit(1);
      if (!existing?.length) {
        const { data: pipe } = await supabase.from('pipeline')
          .select('client_name, property_address').eq('id', s.pipeline_id).single();
        await supabase.from('activity_log').insert({
          agent_id: s.agent_id,
          activity_type: 'STAKEHOLDER_STUCK_ALERT',
          note: `${s.role.replace('_',' ')} ${s.name || ''} has not opened their portal for ${pipe?.client_name || 'a deal'} after 5 days. Consider calling them directly.`,
          related_id: s.id
        });
        alertsLogged++;
      }
    }
  }

  // Add to summary
  (summary as any).stakeholder_nudges_sent = nudgesQueued;
  (summary as any).stakeholder_alerts     = alertsLogged;

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
