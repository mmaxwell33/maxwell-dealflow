// Maxwell DealFlow CRM — track-click edge function
//
// Logs a click on a link in a sent email, then redirects to the real URL.
//
// The destination is looked up from email_links BY ID. The caller never supplies
// a URL, so this cannot be turned into an open redirect for phishing. Unknown or
// malformed ids fall back to the public site rather than erroring at the client.
//
// Required migration: 085_email_link_clicks.sql

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FALLBACK = 'https://maxwellmidodzi.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const redirect = (url: string) =>
  new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });

serve(async (req) => {
  try {
    const id = new URL(req.url).searchParams.get('l') || '';
    if (!UUID_RE.test(id)) return redirect(FALLBACK);

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const { data: link } = await db
      .from('email_links')
      .select('id, url, click_count, first_clicked_at')
      .eq('id', id)
      .single();

    // Only ever redirect to a stored http(s) destination.
    const target = link?.url && /^https?:\/\//i.test(link.url) ? link.url : FALLBACK;

    if (link) {
      const now = new Date().toISOString();
      // Fire and forget: a logging failure must never cost the client their click.
      db.from('email_links').update({
        click_count: (link.click_count || 0) + 1,
        first_clicked_at: link.first_clicked_at || now,
        last_clicked_at: now,
      }).eq('id', id).then(() => {}, () => {});
    }

    return redirect(target);
  } catch (_e) {
    return redirect(FALLBACK);
  }
});
