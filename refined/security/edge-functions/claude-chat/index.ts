// Maxwell DealFlow CRM — Claude Chat edge function
//
// Purpose: keep the Anthropic API key on the server.
// Before this function existed, ai.js called api.anthropic.com directly
// from the browser using a key stored in localStorage. That key could
// leak from any device and hit usage caps. This function forwards the
// request, adds the API key from Supabase secrets, and returns the reply.
//
// Required Supabase secret:
//   ANTHROPIC_API_KEY   — your Claude API key (starts with sk-ant-)
//
// Called by: js/ai.js → AI.callClaude()
//
// Request body:
//   { system: string, messages: Array<{role: "user"|"assistant", content: string}>, model?: string, max_tokens?: number }
// Response body:
//   { text: string }   on success
//   { error: string }  on failure

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth: require a real signed-in Supabase user ──────────────────────
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing bearer token' }, 401);
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    // ── Validate body ────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const system     = typeof body.system === 'string' ? body.system : '';
    const messages   = Array.isArray(body.messages) ? body.messages : [];
    const model      = typeof body.model === 'string' ? body.model : 'claude-haiku-4-5';
    const maxTokens  = Number.isFinite(body.max_tokens) ? body.max_tokens : 1500;

    if (!messages.length) return json({ error: 'No messages provided' }, 400);

    // ── Get API key from Supabase secrets (never exposed to browser) ─────
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured on server' }, 500);

    // ── Call Anthropic ───────────────────────────────────────────────────
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return json({ error: err?.error?.message || `Claude API error ${res.status}` }, 502);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return json({ text }, 200);
  } catch (err) {
    return json({ error: (err as Error).message || 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
