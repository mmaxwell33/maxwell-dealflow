import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Weekly Data Backup Edge Function
 *
 * Exports all critical data for the agent to a JSON snapshot
 * and emails it to the agent as a backup attachment.
 *
 * Triggered by Supabase Cron (pg_cron) every Sunday at 2:00 AM,
 * or can be triggered manually by calling this function.
 *
 * What it backs up:
 *   - All clients
 *   - All viewings
 *   - All offers
 *   - All pipeline records
 *   - All activity logs (last 90 days)
 *
 * Backup is emailed directly to the agent's Gmail as a JSON attachment.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') || '';
    const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const GMAIL_USER      = Deno.env.get('GMAIL_USER') || 'maxwelldelali22@gmail.com';
    const CLIENT_ID       = Deno.env.get('GMAIL_CLIENT_ID');
    const CLIENT_SECRET   = Deno.env.get('GMAIL_CLIENT_SECRET');
    const REFRESH_TOKEN   = Deno.env.get('GMAIL_REFRESH_TOKEN');

    if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) throw new Error('Gmail secrets not set');

    // Use service role key to read ALL data (bypasses RLS for backup purposes)
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch all critical tables
    const [clientsRes, viewingsRes, offersRes, pipelineRes, activityRes] = await Promise.all([
      db.from('clients').select('*').order('created_at', { ascending: false }),
      db.from('viewings').select('*').order('created_at', { ascending: false }),
      db.from('offers').select('*').order('created_at', { ascending: false }),
      db.from('pipeline').select('*').order('created_at', { ascending: false }),
      db.from('activity_log').select('*')
        .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }),
    ]);

    const backupDate = new Date().toISOString().slice(0, 10);
    const backup = {
      generated_at: new Date().toISOString(),
      generated_by: 'Maxwell DealFlow CRM — Automated Weekly Backup',
      data: {
        clients:      clientsRes.data  || [],
        viewings:     viewingsRes.data || [],
        offers:       offersRes.data   || [],
        pipeline:     pipelineRes.data || [],
        activity_log: activityRes.data || [],
      },
      summary: {
        total_clients:  (clientsRes.data  || []).length,
        total_viewings: (viewingsRes.data || []).length,
        total_offers:   (offersRes.data   || []).length,
        pipeline_deals: (pipelineRes.data || []).length,
        activity_entries: (activityRes.data || []).length,
      }
    };

    const backupJson = JSON.stringify(backup, null, 2);
    const backupBase64 = btoa(unescape(encodeURIComponent(backupJson)));
    const filename = `maxwell-dealflow-backup-${backupDate}.json`;

    // Get Gmail access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Gmail token failed: ' + JSON.stringify(tokenData));

    // Build backup email with JSON attachment
    const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
    const emailLines = [
      `From: Maxwell DealFlow CRM <${GMAIL_USER}>`,
      `To: ${GMAIL_USER}`,
      `Subject: 🔒 Weekly Backup — Maxwell DealFlow CRM — ${backupDate}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;padding:20px;">
        <h2 style="color:#1a6ef5;">📦 Weekly Data Backup</h2>
        <p>Your Maxwell DealFlow CRM data has been automatically backed up.</p>
        <table style="border-collapse:collapse;width:100%;max-width:400px;margin:20px 0;">
          <tr style="background:#f5f5f5;"><td style="padding:8px 12px;font-weight:bold;">Date</td><td style="padding:8px 12px;">${backupDate}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;">Clients</td><td style="padding:8px 12px;">${backup.summary.total_clients}</td></tr>
          <tr style="background:#f5f5f5;"><td style="padding:8px 12px;font-weight:bold;">Viewings</td><td style="padding:8px 12px;">${backup.summary.total_viewings}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:bold;">Offers</td><td style="padding:8px 12px;">${backup.summary.total_offers}</td></tr>
          <tr style="background:#f5f5f5;"><td style="padding:8px 12px;font-weight:bold;">Pipeline Deals</td><td style="padding:8px 12px;">${backup.summary.pipeline_deals}</td></tr>
        </table>
        <p style="font-size:13px;color:#666;">The full backup is attached as <strong>${filename}</strong>.
        Store it somewhere safe (Google Drive, email archive).<br>
        This backup was generated automatically by your DealFlow system.</p>
        <p style="font-size:11px;color:#aaa;margin-top:30px;">Maxwell DealFlow CRM — Automated Backup System</p>
      </body></html>`,
      '',
      `--${boundary}`,
      `Content-Type: application/json; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      backupBase64,
      '',
      `--${boundary}--`,
    ];

    const rawEmail = emailLines.join('\r\n');
    const encoder = new TextEncoder();
    const rawBytes = encoder.encode(rawEmail);
    let binary = '';
    rawBytes.forEach(b => binary += String.fromCharCode(b));
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error('Gmail send failed: ' + JSON.stringify(sendData));

    return new Response(JSON.stringify({
      success: true,
      backup_date: backupDate,
      summary: backup.summary,
      message: `Backup emailed to ${GMAIL_USER}`,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Backup error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
