// Maxwell DealFlow CRM — invite-agent edge function
//
// Creates a NEW agent's login + profile so the "Deploy Agent Account" button
// (Agent Portal) actually works. The browser app cannot do this itself:
//   • creating an auth user requires the service-role key (never allowed in a
//     browser — it bypasses RLS), and
//   • the `agents` table RLS ("agents_own": auth.uid() = id) blocks the anon
//     client from inserting a row for anyone but itself.
//
// This function runs server-side with the service-role key, so it can do both —
// and it sets the new agents row id EQUAL to the new auth user id, which is what
// keeps the new agent's account working (App.onSignedIn resolves the profile by
// id = auth.uid() first). A random id there is the bug that silently broke the
// old flow.
//
// Flow: verify caller is signed in → create the user with a temp password
// (email pre-confirmed so they can log in immediately, no SMTP dependency) →
// upsert the agents profile with the matching id → return the temp credentials
// for the inviter to pass along. The new agent can change the password in
// Settings after first sign-in.
//
// Required Supabase secret: SUPABASE_SERVICE_ROLE_KEY (already used by send-email).
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the runtime.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Readable temp password, e.g. "Deal-7Kd2Lm9QxB". No lookalike-only sets needed —
// the agent changes it after first login.
function genPassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `Deal-${s.slice(0, 10)}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!SERVICE_KEY) {
      return json({ error: 'Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing.' }, 500);
    }

    // 1) The caller must be a signed-in agent (so this can't be abused anonymously).
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user: inviter } } = await caller.auth.getUser();
    if (!inviter) return json({ error: 'Not authorized — please sign in and try again.' }, 401);

    // 2) Parse input.
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode ?? 'invite');

    // ── DELETE mode — remove an agent's login + profile row (service role) ──
    if (mode === 'delete') {
      const delId = String(body.id ?? '').trim();
      if (!delId) return json({ error: 'Missing agent id to delete.' }, 400);
      const adminDel = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await adminDel.from('agents').delete().eq('id', delId);               // removes profile (cascades their data)
      const { error: dErr } = await adminDel.auth.admin.deleteUser(delId);  // removes the login
      if (dErr && !/not.?found|does not exist/i.test(dErr.message)) return json({ error: dErr.message }, 500);
      return json({ ok: true, deleted: true, agent_id: delId });
    }

    // ── INVITE mode — validate input ──
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!name || !email) return json({ error: 'Name and email are required.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'That email address looks invalid.' }, 400);
    const phone = String(body.phone ?? '').trim();
    const brokerage = String(body.brokerage ?? '').trim() || 'eXp Realty';
    const title = String(body.title ?? '').trim() || 'Real Estate Agent';
    const province = String(body.province ?? '').trim() || 'Newfoundland & Labrador';

    // 3) Admin client (service role — bypasses RLS).
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 4) Create (or re-provision) the login. email_confirm:true → sign in now.
    const tempPassword = genPassword();
    let userId: string;
    let reprovisioned = false;

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: name, invited_by: inviter.email },
    });

    if (created?.user) {
      userId = created.user.id;
    } else {
      const already = /already|exists|registered/i.test(cErr?.message ?? '');
      if (!already) return json({ error: cErr?.message ?? 'Could not create the account.' }, 500);
      // Email already has a login — find it and reset the password so the invite
      // still hands back working credentials (also lets you re-test one email).
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users?.find((u) => (u.email ?? '').toLowerCase() === email);
      if (!existing) return json({ error: 'That email already has an account.' }, 409);
      userId = existing.id;
      reprovisioned = true;
      await admin.auth.admin.updateUserById(userId, { password: tempPassword, email_confirm: true });
    }

    // 5) Create/refresh the matching profile row — id MUST equal the auth uid.
    // Column names match the live agents table: name (not full_name), no province.
    const { error: aErr } = await admin.from('agents').upsert(
      {
        id: userId,
        name,
        email,
        phone,
        brokerage,
        title,
        created_by: inviter.id,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (aErr) {
      return json({
        ok: true,
        agent_id: userId,
        email,
        temp_password: tempPassword,
        reprovisioned,
        warning: `Login ready, but the profile row failed to save: ${aErr.message}`,
      });
    }

    return json({ ok: true, agent_id: userId, email, temp_password: tempPassword, reprovisioned });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
