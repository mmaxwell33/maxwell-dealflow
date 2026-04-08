/**
 * Maxwell DealFlow CRM — Daily Automation Edge Function
 *
 * Runs every day at 8:00 AM local time (via pg_cron or Supabase scheduled invocations).
 * Scans all active pipeline deals for approaching deadlines and queues approval emails.
 *
 * What it does:
 *   1. Condition deadlines — queue reminder 3 days before and 1 day before expiry
 *   2. Walkthrough reminders — queue reminder 1 day before walkthrough
 *   3. Closing-day email — queue "Happy Closing Day!" on the closing date itself
 *   4. Post-closing referral — queue referral ask 7 days after closing
 *   5. Stale deal alerts — log a note if a deal has been stuck in same stage > 30 days
 *
 * Idempotency: Every approval_queue insert is guarded by checking for an existing
 * Pending row with the same (agent_id, related_id, approval_type) within 25 hours.
 * This means re-running the function (e.g., if cron fires twice) is safe.
 *
 * Environment variables required (set in Supabase dashboard → Settings → Edge Functions):
 *   SUPABASE_URL         — your project URL (auto-injected in Edge Functions)
 *   SUPABASE_SERVICE_KEY — service-role key with RLS bypass (NOT the anon key)
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
  conditions_deadline: string | null;
  walkthrough_date: string | null;
  closing_date: string | null;
  stage_updated_at: string | null;
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

  conditions_reminder_3d: (deal: PipelineDeal, agent: Agent): { subject: string; body: string } => ({
    subject: `⏰ Reminder: Conditions Deadline in 3 Days — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

Just a friendly reminder that the conditions on your accepted offer at ${deal.property_address} are due to be fulfilled in 3 days (${fmtDate(deal.conditions_deadline!)}).

Please ensure the following are in order:
• Financing approval from your lender
• Home inspection (if not yet completed)
• Any other conditions noted in your offer

If you have any questions or need help arranging anything, please reach out right away — we don't want to miss this deadline.

${sig(agent)}`,
  }),

  conditions_reminder_1d: (deal: PipelineDeal, agent: Agent): { subject: string; body: string } => ({
    subject: `🚨 URGENT: Conditions Deadline Tomorrow — ${deal.property_address}`,
    body: `Hi ${firstName(deal.client_name)},

IMPORTANT REMINDER — your conditions deadline for ${deal.property_address} is TOMORROW (${fmtDate(deal.conditions_deadline!)}).

If all conditions have been satisfied, please confirm with your lender and let me know so I can move the file forward.

If there are any concerns or outstanding items, please call me immediately so we can discuss your options.

This is a time-sensitive matter — please act today.

${sig(agent)}`,
  }),

  walkthrough_reminder: (deal: PipelineDeal, agent: Agent): { subject: string; body: string } => ({
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

  closing_day: (deal: PipelineDeal, agent: Agent): { subject: string; body: string } => ({
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

  post_closing_referral: (deal: PipelineDeal, agent: Agent): { subject: string; body: string } => ({
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
  deal: PipelineDeal,
  approvalType: string,
  subject: string,
  body: string,
): Promise<{ queued: boolean; error?: string }> {
  if (!deal.client_email) return { queued: false, error: 'no client email' };

  const dup = await isDuplicate(supabase, deal.agent_id, deal.id, approvalType);
  if (dup) return { queued: false, error: 'duplicate' };

  const { error } = await supabase.from('approval_queue').insert({
    agent_id: deal.agent_id,
    client_name: deal.client_name || 'Client',
    client_email: deal.client_email,
    approval_type: approvalType,
    email_subject: subject,
    email_body: body,
    related_id: deal.id,
    status: 'Pending',
  } as QueuedEmail);

  if (error) return { queued: false, error: error.message };
  return { queued: true };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  // Allow manual HTTP triggers (Supabase cron uses POST with empty body)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Optional bearer token guard ──────────────────────────────────────────────
  // Set CRON_SECRET in Supabase env to prevent unauthenticated manual triggers.
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Service-role client bypasses RLS — safe for server-side automation
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
    .select('id, agent_id, client_id, client_name, client_email, property_address, stage, conditions_deadline, walkthrough_date, closing_date, stage_updated_at')
    .not('stage', 'in', '("Closed","Fell Through","Withdrawn")');

  if (dealsErr || !deals) {
    return new Response(
      JSON.stringify({ error: 'Failed to load pipeline', detail: dealsErr?.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── 2. Load all agents (one lookup, used per deal) ─────────────────────────
  const agentIds = [...new Set(deals.map((d: PipelineDeal) => d.agent_id))];
  const { data: agents } = await supabase
    .from('agents')
    .select('id, full_name, email, phone')
    .in('id', agentIds);

  const agentMap = new Map<string, Agent>();
  for (const a of agents ?? []) {
    agentMap.set(a.id, a as Agent);
  }

  // ── 3. Process each deal ───────────────────────────────────────────────────
  for (const deal of deals as PipelineDeal[]) {
    summary.processed++;
    const agent = agentMap.get(deal.agent_id) ?? { id: deal.agent_id, full_name: null, email: null, phone: null };

    // ── 3a. Conditions deadline reminders ────────────────────────────────────
    if (deal.conditions_deadline && deal.stage === 'Conditions') {
      const condDate = new Date(deal.conditions_deadline);
      condDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((condDate.getTime() - today.getTime()) / 86_400_000);

      if (daysLeft === 3) {
        const tmpl = templates.conditions_reminder_3d(deal, agent);
        const result = await queueEmail(supabase, deal, 'Conditions Reminder (3 days)', tmpl.subject, tmpl.body);
        result.queued ? summary.queued++ : result.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${result.error}`);
      }

      if (daysLeft === 1) {
        const tmpl = templates.conditions_reminder_1d(deal, agent);
        const result = await queueEmail(supabase, deal, 'Conditions Reminder (1 day)', tmpl.subject, tmpl.body);
        result.queued ? summary.queued++ : result.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${result.error}`);
      }
    }

    // ── 3b. Walkthrough reminder (1 day before) ──────────────────────────────
    if (deal.walkthrough_date) {
      const walkDate = new Date(deal.walkthrough_date);
      walkDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((walkDate.getTime() - today.getTime()) / 86_400_000);

      if (daysLeft === 1) {
        const tmpl = templates.walkthrough_reminder(deal, agent);
        const result = await queueEmail(supabase, deal, 'Walkthrough Reminder (1 day)', tmpl.subject, tmpl.body);
        result.queued ? summary.queued++ : result.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${result.error}`);
      }
    }

    // ── 3c. Closing day email ────────────────────────────────────────────────
    if (deal.closing_date) {
      const closeDate = new Date(deal.closing_date);
      closeDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((closeDate.getTime() - today.getTime()) / 86_400_000);

      if (daysLeft === 0) {
        const tmpl = templates.closing_day(deal, agent);
        const result = await queueEmail(supabase, deal, 'Happy Closing Day! 🔑', tmpl.subject, tmpl.body);
        result.queued ? summary.queued++ : result.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${result.error}`);
      }
    }
  }

  // ── 4. Viewing feedback requests (viewing date passed, no feedback yet) ──────
  //    When a viewing date has passed and no client_feedback is recorded,
  //    queue a "How did the viewing go?" feedback request email.
  const { data: pastViewings } = await supabase
    .from('viewings')
    .select('id, agent_id, client_id, property_address, viewing_date, viewing_time, viewing_status')
    .eq('viewing_status', 'Scheduled')
    .is('client_feedback', null)
    .lte('viewing_date', todayStr);

  for (const v of (pastViewings ?? [])) {
    if (!v.client_id) continue;
    // Look up client email
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, full_name, email')
      .eq('id', v.client_id)
      .single();
    if (!clientRow?.email) continue;

    const agent = agentMap.get(v.agent_id) ?? { id: v.agent_id, full_name: null, email: null, phone: null };
    const viewDateFmt = new Date(v.viewing_date).toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const firstName = clientRow.full_name?.split(' ')[0] || 'there';

    const subject = `How Did the Viewing Go? — ${v.property_address}`;
    const body = `Hi ${firstName},

I hope you enjoyed viewing ${v.property_address} on ${viewDateFmt}!

I'd love to hear your thoughts. Here are a few questions to help guide our next steps:

🏠 Did the property meet your expectations?
📐 Did the size and layout work for you?
💰 Do you feel the asking price is fair?
❓ Do you have any questions or concerns?

Your honest feedback helps me find the perfect home for you. Feel free to reply directly to this email or give me a call.

${sig(agent)}`;

    // Dedup check using viewing id
    const windowStart = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { data: dupCheck } = await supabase
      .from('approval_queue')
      .select('id')
      .eq('agent_id', v.agent_id)
      .eq('related_id', v.id)
      .eq('approval_type', 'Post-Viewing Feedback Request')
      .eq('status', 'Pending')
      .gte('created_at', windowStart)
      .limit(1);

    if ((dupCheck?.length ?? 0) > 0) { summary.skipped_duplicate++; continue; }

    const { error: qErr } = await supabase.from('approval_queue').insert({
      agent_id: v.agent_id,
      client_name: clientRow.full_name,
      client_email: clientRow.email,
      approval_type: 'Post-Viewing Feedback Request',
      email_subject: subject,
      email_body: body,
      related_id: v.id,
      status: 'Pending',
    });

    if (qErr) { summary.errors.push(`viewing ${v.id}: ${qErr.message}`); }
    else {
      summary.queued++;
      // Also mark the viewing as needing follow-up so it doesn't pile up
      await supabase.from('viewings').update({ viewing_status: 'Needs Follow-Up' }).eq('id', v.id);
    }
  }

  // ── 5. Post-closing referral (7 days after closing) ───────────────────────
  //    Fetch recently-closed deals separately (stage = Closed, closed in last 8 days,
  //    check if exactly 7 days have passed)
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const eightDaysAgo = new Date(today.getTime() - 8 * 86_400_000).toISOString().slice(0, 10);

  const { data: closedDeals } = await supabase
    .from('pipeline')
    .select('id, agent_id, client_id, client_name, client_email, property_address, stage, closing_date, conditions_deadline, walkthrough_date, stage_updated_at')
    .eq('stage', 'Closed')
    .gte('closing_date', eightDaysAgo)
    .lte('closing_date', sevenDaysAgo);

  for (const deal of (closedDeals ?? []) as PipelineDeal[]) {
    if (!deal.closing_date) continue;
    const closeDate = new Date(deal.closing_date);
    closeDate.setHours(0, 0, 0, 0);
    const daysSinceClose = Math.round((today.getTime() - closeDate.getTime()) / 86_400_000);
    if (daysSinceClose !== 7) continue;

    const agent = agentMap.get(deal.agent_id) ?? { id: deal.agent_id, full_name: null, email: null, phone: null };
    const tmpl = templates.post_closing_referral(deal, agent);
    const result = await queueEmail(supabase, deal, 'Post-Closing Referral Request 🙏', tmpl.subject, tmpl.body);
    result.queued ? summary.queued++ : result.error === 'duplicate' ? summary.skipped_duplicate++ : summary.errors.push(`deal ${deal.id}: ${result.error}`);
  }

  // ── 6. Stale deal detection (stuck > 30 days in same non-terminal stage) ──
  //    Log to activity_log only — no email queued (Maxwell reviews manually)
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000).toISOString();

  const { data: staleDeals } = await supabase
    .from('pipeline')
    .select('id, agent_id, client_name, stage, stage_updated_at')
    .not('stage', 'in', '("Closed","Fell Through","Withdrawn")')
    .lt('stage_updated_at', thirtyDaysAgo);

  for (const deal of (staleDeals ?? [])) {
    if (!deal.stage_updated_at) continue;
    const dayStuck = Math.round(
      (today.getTime() - new Date(deal.stage_updated_at).getTime()) / 86_400_000,
    );
    await supabase.from('activity_log').insert({
      agent_id: deal.agent_id,
      activity_type: 'STALE_DEAL_ALERT',
      note: `Deal "${deal.client_name}" has been in stage "${deal.stage}" for ${dayStuck} days. Consider following up.`,
      related_id: deal.id,
    }).select(); // .select() suppresses no-return warning
  }

  // ── 7. Return summary ──────────────────────────────────────────────────────
  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
