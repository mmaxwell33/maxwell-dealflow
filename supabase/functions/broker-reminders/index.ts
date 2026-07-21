/**
 * Maxwell DealFlow CRM — Broker Reminders Edge Function
 *
 * Runs daily via pg_cron (migration 077). The broker rarely logs in, so this
 * nudges him BY EMAIL when a referred client needs attention:
 *   • rate hold expiring within 5 days
 *   • application sent > 2 days ago with no pre-approval status yet
 *
 * One digest email per broker. Idempotent: a referral won't be re-nudged within
 * 3 days (nudged_at). Every run writes a row to automation_log so a silently
 * dead job is visible (query: SELECT * FROM automation_log ORDER BY ran_at DESC).
 *
 * Deploy:  supabase functions deploy broker-reminders
 * Secrets it needs (same Gmail creds send-email already uses):
 *   GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function toBase64Url(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function buildRaw(to: string, from: string, subject: string, text: string): string {
  const body = base64Encode(new TextEncoder().encode(text));
  const lines = [
    `From: Maxwell DealFlow <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ];
  return toBase64Url(new TextEncoder().encode(lines.join('\r\n')));
}

async function getGmailToken(): Promise<string | null> {
  const id = Deno.env.get('GMAIL_CLIENT_ID'), secret = Deno.env.get('GMAIL_CLIENT_SECRET'), refresh = Deno.env.get('GMAIL_REFRESH_TOKEN');
  if (!id || !secret || !refresh) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const d = await r.json();
  return d.access_token || null;
}
async function sendMail(token: string, from: string, to: string, subject: string, text: string) {
  const raw = buildRaw(to, from, subject, text);
  await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
  let processed = 0;
  try {
    const todayMs = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const nudgeCutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();  // don't re-nudge within 3 days

    const { data: refs } = await db.from('broker_referral_requests')
      .select('id,broker_id,client_name,snapshot_rate_hold,snapshot_status,app_sent_at,nudged_at,status')
      .in('status', ['approved', 'sent']).not('broker_id', 'is', null);

    const { data: bks } = await db.from('agents').select('id,email,full_name,name').eq('role', 'broker');
    const brokers: Record<string, any> = {};
    (bks || []).forEach((b: any) => { brokers[b.id] = b; });

    const perBroker: Record<string, { reasons: string[]; ids: string[] }> = {};
    for (const r of (refs || [])) {
      if (r.nudged_at && r.nudged_at > nudgeCutoff) continue;
      const reasons: string[] = [];
      if (r.snapshot_rate_hold) {
        const d = Math.round((Date.parse(r.snapshot_rate_hold + 'T00:00:00Z') - todayMs) / 86_400_000);
        if (d >= 0 && d <= 5) reasons.push(`${r.client_name || 'A client'}: rate hold ${d === 0 ? 'expires today' : d === 1 ? 'expires tomorrow' : 'expires in ' + d + ' days'} (${r.snapshot_rate_hold}).`);
      }
      if (r.app_sent_at && !r.snapshot_status) {
        const d = Math.round((Date.now() - Date.parse(r.app_sent_at)) / 86_400_000);
        if (d >= 2) reasons.push(`${r.client_name || 'A client'}: you sent the application ${d} days ago and there is still no pre-approval recorded, worth a follow-up.`);
      }
      if (reasons.length) {
        (perBroker[r.broker_id] = perBroker[r.broker_id] || { reasons: [], ids: [] });
        perBroker[r.broker_id].reasons.push(...reasons);
        perBroker[r.broker_id].ids.push(r.id);
      }
    }

    let token: string | null = null;
    const stampIds: string[] = [];
    for (const bid of Object.keys(perBroker)) {
      const b = brokers[bid];
      if (!b || !b.email) continue;   // no email, leave unstamped so it retries later
      if (token === null) token = await getGmailToken();
      if (!token) break;              // Gmail not configured; don't stamp, will retry
      const who = b.full_name || b.name || 'there';
      const body = `Hi ${who},\n\nA quick nudge on your Financing Lane clients that need attention:\n\n`
        + perBroker[bid].reasons.map((x) => '  - ' + x).join('\n')
        + `\n\nOpen your lane: https://maxwellmidodzi.com/broker.html\n\nAutomated reminder from Maxwell's Financing Lane.`;
      await sendMail(token, Deno.env.get('GMAIL_USER') || '', b.email, 'Financing Lane: clients needing your attention', body);
      stampIds.push(...perBroker[bid].ids);
    }

    if (stampIds.length) {
      await db.from('broker_referral_requests').update({ nudged_at: new Date().toISOString() }).in('id', stampIds);
      processed = stampIds.length;
    }
    await db.from('automation_log').insert({ job_name: 'broker-reminders', rows_processed: processed, ok: true });
    return json({ ok: true, nudged: processed });
  } catch (e) {
    await db.from('automation_log').insert({ job_name: 'broker-reminders', rows_processed: processed, ok: false, error: String((e as Error)?.message ?? e) });
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
