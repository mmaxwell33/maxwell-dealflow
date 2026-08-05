// Maxwell DealFlow CRM — broadcast-update edge function
//
// Lets the FOUNDER (Maxwell) post a "What's New" announcement that every agent
// using the app — including invited agents on their own isolated accounts —
// sees as a push notification, the same idea as an App Store update note.
//
// 1. Verifies the caller is the founder (agents.created_by IS NULL), same
//    check invite-agent already uses.
// 2. Inserts the announcement into product_updates with the service role
//    (product_updates has no client-writable RLS policy on purpose).
// 3. Fetches every agent's push subscriptions (service role — this table is
//    normally locked to agent_id = auth.uid()) and forwards them to the
//    already-deployed send-push function, which recognises the service-role
//    key as an internal system call. This reuses the tested VAPID/WebCrypto
//    code instead of duplicating it.
//
// Each agent's own client marks the announcement "seen" (product_update_acks)
// once they view it in-app — the push is just the tap on the shoulder.
//
// Required migration: 086_product_updates.sql

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing bearer token' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey      = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Auth context not configured' }, 500);

    // Identify the caller from their OWN token — never trust a posted agent id.
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Only the founder (agents row with created_by IS NULL) may broadcast —
    // an invited agent must never be able to push a notice to everyone else.
    const { data: callerRow } = await admin.from('agents').select('created_by').eq('id', user.id).single();
    if (!callerRow || callerRow.created_by !== null) {
      return json({ error: 'Only the account owner can post an update.' }, 403);
    }

    const { title, body } = await req.json();
    const cleanTitle = String(title || '').trim().slice(0, 120);
    const cleanBody  = String(body  || '').trim().slice(0, 2000);
    if (!cleanTitle || !cleanBody) return json({ error: 'title and body are required' }, 400);

    const { data: row, error: insErr } = await admin
      .from('product_updates')
      .insert({ posted_by: user.id, title: cleanTitle, body: cleanBody })
      .select('id')
      .single();
    if (insErr) return json({ error: insErr.message }, 500);

    // Fan out a push to every agent's every device. Best-effort: a push
    // failure must never make the announcement itself look like it failed —
    // it's already saved and every agent will see it in-app regardless.
    let notified = 0;
    try {
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth');
      if (subs?.length) {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}`, 'apikey': anonKey },
          body: JSON.stringify({
            title: '🎉 New in DealFlow',
            body: cleanTitle,
            tab: 'overview',
            subscriptions: subs.map(s => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })),
          }),
        });
        const pushJson = await res.json().catch(() => ({}));
        notified = pushJson.sent || 0;
      }
    } catch (e) {
      console.warn('[broadcast-update] push fan-out skipped:', e);
    }

    return json({ id: row.id, notified });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
