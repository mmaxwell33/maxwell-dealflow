// ─────────────────────────────────────────────────────────────────────────────
// check-completed-viewings — Maxwell DealFlow CRM
//
// Runs every 5 minutes via pg_cron (see migration 047). The job that the
// JavaScript browser-side `Notify.checkCompletedViewings()` was doing now
// happens server-side too — which means push notifications fire to the
// agent's phone EVEN WHEN THE APP IS CLOSED.
//
// What it does:
//   1. Pulls all viewings where viewing_status='Scheduled' and the viewing's
//      end time is in the past (with a 5-minute buffer, or no buffer if
//      there's an offer deadline within 6 hours).
//   2. Flips each one to viewing_status='Completed'.
//   3. For each, calls the existing /functions/v1/send-push edge function
//      with the agent's push subscriptions, firing a "How was the viewing?"
//      notification.
//
// Idempotency: a viewing only matches the query once (status flips to
// Completed on first run), so the same notification can't fire twice.
//
// Auth: uses SUPABASE_SERVICE_ROLE_KEY for both the database query and the
// send-push call. send-push recognises the service-role token as a system
// caller and accepts the request without a Bearer session token.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ViewingRow {
  id: string;
  agent_id: string;
  client_id: string | null;
  client_name: string | null;
  property_address: string | null;
  viewing_date: string;       // YYYY-MM-DD
  viewing_time: string | null; // HH:MM:SS
  duration_minutes: number | null;
  offer_due_date: string | null;
  offer_due_time: string | null;
}

interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date();
  const summary = { scanned: 0, completed: 0, pushSent: 0, pushFailed: 0, errors: [] as string[] };

  // ── 1. Pull all currently-Scheduled viewings whose viewing_date is today
  // or earlier. We filter by end-time client-side below so we can apply the
  // urgent-offer-deadline logic the browser version uses.
  const todayIso = now.toISOString().slice(0, 10);
  const { data: viewings, error: vErr } = await supabase
    .from('viewings')
    .select('id, agent_id, client_id, client_name, property_address, viewing_date, viewing_time, duration_minutes, offer_due_date, offer_due_time')
    .eq('viewing_status', 'Scheduled')
    .lte('viewing_date', todayIso);

  if (vErr) {
    return json({ error: vErr.message, summary }, 500);
  }
  summary.scanned = viewings?.length || 0;

  for (const v of (viewings as ViewingRow[]) || []) {
    try {
      // ── 2. Compute viewing end time (default 60 min if duration missing)
      const viewingStart = new Date(`${v.viewing_date}T${v.viewing_time || '12:00'}:00`);
      const durationMin = v.duration_minutes || 60;
      const viewingEnd = new Date(viewingStart.getTime() + durationMin * 60 * 1000);

      // ── 3. Trigger window — same logic as Notify.checkCompletedViewings:
      // urgent offer deadline (<=6h after viewing end) → no buffer; else +5 min
      let hasUrgentDeadline = false;
      if (v.offer_due_date) {
        const deadline = new Date(`${v.offer_due_date}T${v.offer_due_time || '23:59'}:00`);
        const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursUntilDeadline <= 6 && hoursUntilDeadline > 0) hasUrgentDeadline = true;
      }
      const triggerTime = hasUrgentDeadline
        ? viewingEnd
        : new Date(viewingEnd.getTime() + 5 * 60 * 1000);
      if (now < triggerTime) continue; // Not yet time

      // ── 4. Flip status to Completed
      const { error: uErr } = await supabase
        .from('viewings')
        .update({ viewing_status: 'Completed', updated_at: now.toISOString() })
        .eq('id', v.id)
        .eq('viewing_status', 'Scheduled'); // Optimistic guard against double-flips
      if (uErr) {
        summary.errors.push(`update ${v.id}: ${uErr.message}`);
        continue;
      }
      summary.completed += 1;

      // ── 5. Build the push payload
      const address = v.property_address || 'the property';
      const clientName = v.client_name || 'your client';
      let title = 'How was the viewing?';
      let body = `${address} with ${clientName} — tap to record feedback`;
      if (hasUrgentDeadline) {
        const t = v.offer_due_time ? v.offer_due_time.slice(0, 5) : '';
        const fmt = t ? (() => {
          const [h, m] = t.split(':').map(Number);
          return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
        })() : 'tonight';
        title = 'Viewing done — offers due soon!';
        body = `URGENT: Offers due ${fmt}! ${address} with ${clientName} — record feedback now`;
      }

      // ── 6. Pull the agent's push subscriptions
      const { data: subs, error: sErr } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('agent_id', v.agent_id);
      if (sErr) {
        summary.errors.push(`subs ${v.id}: ${sErr.message}`);
        continue;
      }
      if (!subs || subs.length === 0) continue; // Agent has no subscribed devices

      // ── 7. Call send-push with the service-role token (recognised as a
      // system caller; bypasses the user-session Bearer check).
      const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE}`,
          'apikey': SERVICE_ROLE,
        },
        body: JSON.stringify({
          title,
          body,
          tab: 'viewings',
          subscriptions: (subs as PushSub[]).map(s => ({
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          })),
        }),
      });
      if (pushRes.ok) {
        summary.pushSent += 1;
      } else {
        summary.pushFailed += 1;
        const txt = await pushRes.text().catch(() => '');
        summary.errors.push(`push ${v.id}: ${pushRes.status} ${txt.slice(0, 120)}`);
      }
    } catch (e) {
      summary.errors.push(`loop ${v.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return json({ ok: true, ...summary });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
