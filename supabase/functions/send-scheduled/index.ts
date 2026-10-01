// Maxwell DealFlow CRM — send-scheduled edge function
//
// Called by pg_cron every 5 minutes (migration 111). Sends every approval_queue
// row whose status is 'Scheduled' and whose scheduled_at has passed.
//
// The app already prepared each message when Maxwell tapped Schedule (the same
// de-dash, disclaimer, integrity guard and click tracking as Approve), so this
// function does no rewriting: it resolves staged attachments, hands the payload
// to send-email as a system call, and records the result the way approve() does.
//
//   claim    Scheduled → Sending, conditional on the status, so overlapping
//            runs can never send the same email twice.
//   success  email_inbox row, activity_log row, status Approved, staged files
//            removed.
//   failure  status Failed with send_error in context_data (the shape
//            Approvals already shows and retries), plus a push to his phone.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface Attachment { filename: string; mime_type: string; data?: string; path?: string }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db  = createClient(url, svc);
  const summary = { due: 0, sent: 0, failed: 0, errors: [] as string[] };

  // A run that died mid-send leaves its row in 'Sending'. After 15 minutes it is
  // surfaced as Failed rather than retried: whether Gmail got it is unknown, and
  // a double send to a client is worse than asking Maxwell to check Sent first.
  const stale = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: stuck } = await db.from('approval_queue')
    .select('id, context_data').eq('status', 'Sending').lt('updated_at', stale);
  for (const s of stuck ?? []) {
    const ctx = (s.context_data && typeof s.context_data === 'object') ? s.context_data : {};
    await db.from('approval_queue').update({
      status: 'Failed', updated_at: new Date().toISOString(),
      context_data: { ...ctx, send_error: 'Scheduled send was interrupted. It may have gone out: check your Sent mail before retrying.', failed_at: new Date().toISOString() },
    }).eq('id', s.id).eq('status', 'Sending');
  }

  const nowIso = new Date().toISOString();
  const { data: due, error } = await db.from('approval_queue')
    .select('id, agent_id, client_name, client_email, email_subject, scheduled_payload')
    .eq('status', 'Scheduled')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at')
    .limit(15);
  if (error) return json({ error: error.message }, 500);
  summary.due = due?.length ?? 0;

  for (const row of due ?? []) {
    // Claim it. Zero rows back means another run already has it.
    const { data: claimed } = await db.from('approval_queue')
      .update({ status: 'Sending', updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'Scheduled').select('id');
    if (!claimed?.length) continue;

    const p = row.scheduled_payload ?? {};
    const staged: string[] = [];
    try {
      if (!p.to || !p.subject) throw new Error('Scheduled email has no recipient or subject');

      // Staged attachments are storage paths; inline ones carry their data.
      let attachments: Attachment[] | null = null;
      if (Array.isArray(p.attachments) && p.attachments.length) {
        attachments = [];
        for (const a of p.attachments as Attachment[]) {
          if (a?.data) { attachments.push(a); continue; }
          if (!a?.path) continue;
          const { data: blob, error: dlErr } = await db.storage.from('email-attachments').download(a.path);
          if (dlErr || !blob) throw new Error(`Attachment "${a.filename}" could not be loaded, so the email was not sent without it`);
          attachments.push({ filename: a.filename, mime_type: a.mime_type, data: base64Encode(new Uint8Array(await blob.arrayBuffer())) });
          staged.push(a.path);
        }
      }

      const res = await fetch(`${url}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${svc}`, apikey: svc },
        body: JSON.stringify({
          to: p.to, cc: p.cc ?? null, bcc: p.bcc ?? null,
          subject: p.subject, body: p.body ?? '', html: p.html ?? null, ics: p.ics ?? null,
          attachments, from_name: p.from_name ?? 'Maxwell Midodzi', from_email: null,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.error) throw new Error(result.error || result.message || `send-email returned ${res.status}`);

      if (staged.length) await db.storage.from('email-attachments').remove(staged).catch(() => {});

      const sentAt = new Date().toISOString();
      await db.from('email_inbox').insert({
        agent_id: row.agent_id, direction: 'sent',
        recipient_name: row.client_name || '', recipient_email: row.client_email,
        sender_name: p.from_name || 'Maxwell Midodzi', sender_email: p.sender_email || null,
        subject: p.subject, body: p.body || '', sent_html: p.html || null,
        gmail_message_id: result.gmail_message_id || null, gmail_thread_id: result.gmail_thread_id || null,
        message_key: p.message_key || null, is_read: true, created_at: sentAt,
      });
      await db.from('approval_queue').update({ status: 'Approved', updated_at: sentAt }).eq('id', row.id);
      await db.from('activity_log').insert({
        agent_id: row.agent_id, activity_type: 'EMAIL_SENT',
        description: `Scheduled email sent: ${p.subject}`,
        client_name: row.client_name, client_email: row.client_email,
      });
      summary.sent++;
    } catch (e) {
      const msg = String((e as Error)?.message || e).slice(0, 500);
      summary.failed++;
      summary.errors.push(`${row.id}: ${msg}`);

      // Merge into context_data so the html/ics a retry needs survive.
      const { data: full } = await db.from('approval_queue').select('context_data').eq('id', row.id).single();
      const ctx = (full?.context_data && typeof full.context_data === 'object') ? full.context_data : {};
      await db.from('approval_queue').update({
        status: 'Failed', updated_at: new Date().toISOString(),
        context_data: { ...ctx, send_error: `Scheduled send failed: ${msg}`, failed_at: new Date().toISOString() },
      }).eq('id', row.id);

      try {
        const { data: subs } = await db.from('push_subscriptions')
          .select('endpoint, p256dh, auth').eq('agent_id', row.agent_id);
        if (subs?.length) {
          await fetch(`${url}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${svc}`, apikey: svc },
            body: JSON.stringify({
              title: '⚠️ Scheduled email did not send',
              body: `${row.client_name || 'An email'}: ${p.subject || ''}. Tap to retry.`.slice(0, 180),
              tab: 'approvals',
              subscriptions: subs.map((x: { endpoint: string; p256dh: string; auth: string }) =>
                ({ endpoint: x.endpoint, keys: { p256dh: x.p256dh, auth: x.auth } })),
            }),
          });
        }
      } catch (_) { /* the Failed status is the durable record */ }
    }
  }

  return json(summary);
});
