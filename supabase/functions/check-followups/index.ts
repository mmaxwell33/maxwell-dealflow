import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * check-followups — Server-side cron edge function
 *
 * Runs every 5 minutes (scheduled via Supabase cron).
 * Finds offers where seller_response_due has passed and followup_notified = false,
 * sends a real Web Push notification to the agent's devices, then marks the offer notified.
 *
 * Required Supabase secrets (already set for send-push):
 *   SUPABASE_URL              – auto-injected by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY – auto-injected by Supabase runtime
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? '';
    const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const PUSH_URL      = `${SUPABASE_URL}/functions/v1/send-push`;

    // Service-role client bypasses RLS — safe for server-side cron
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const now = new Date().toISOString();

    // ── Find all overdue, unnotified offers ──────────────────────────────────
    const { data: overdue, error } = await db
      .from('offers')
      .select('id, property_address, offer_amount, agent_id, client_name, clients(full_name)')
      .in('status', ['Submitted', 'Conditions'])
      .eq('followup_notified', false)
      .lte('seller_response_due', now)
      .not('seller_response_due', 'is', null);

    if (error) throw new Error(`DB query failed: ${error.message}`);

    if (!overdue?.length) {
      return new Response(JSON.stringify({ checked: 0, notified: 0, message: 'No overdue follow-ups' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    let notified = 0;
    const results: object[] = [];

    for (const offer of overdue) {
      // ── Get agent's push subscriptions ─────────────────────────────────────
      const { data: subs } = await db
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('agent_id', offer.agent_id);

      if (!subs?.length) {
        results.push({ offer_id: offer.id, skipped: 'no push subscriptions' });
        continue;
      }

      const clientName = (offer as any).clients?.full_name || offer.client_name || 'Your client';
      const title = '⏰ Seller Response Due';
      const body  = `${offer.property_address} — Did the seller respond to ${clientName}'s offer? Open app to log: Accepted, Countered, or Rejected.`;

      // ── Fire push via send-push edge function ───────────────────────────────
      const pushRes = await fetch(PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'apikey': SERVICE_KEY,
        },
        body: JSON.stringify({
          title,
          body,
          tab: 'offers',
          subscriptions: subs.map(s => ({
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth }
          }))
        })
      });

      const pushJson = await pushRes.json().catch(() => ({}));

      // ── Mark offer as notified ──────────────────────────────────────────────
      await db.from('offers')
        .update({ followup_notified: true, updated_at: new Date().toISOString() })
        .eq('id', offer.id);

      notified++;
      results.push({
        offer_id: offer.id,
        property: offer.property_address,
        push_sent: pushJson
      });
    }

    return new Response(
      JSON.stringify({ checked: overdue.length, notified, results }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
