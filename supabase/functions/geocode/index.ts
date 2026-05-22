// ─────────────────────────────────────────────────────────────────────────────
// /functions/v1/geocode — MapTiler proxy for the Mileage Logbook
//
// Replaces direct Nominatim calls from the browser. Why move it server-side:
//   - The MapTiler API key (MAPTILER_KEY secret) stays out of client JS
//   - We control the parameter contract (country=ca, NL bbox, proximity)
//     in one place rather than scattering it through Mileage.geocode()
//   - Rate limiting is per-project, not per-IP — much friendlier for an
//     agent who might burst 14 backfill requests at once
//
// Contract:
//   GET /functions/v1/geocode?q=<address>
//
// Returns:
//   { lat: number, lng: number, label: string }   // best match
//   { error: string }                              // no match or upstream error
//
// CORS: open to the agent's authenticated browser. Auth required (Bearer
// token) so an anonymous caller can't burn through the MapTiler quota.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // Require an authenticated session so we don't expose the MapTiler quota
  // to unauthenticated callers. Any Supabase session token is acceptable —
  // we just want a "this came from someone in our app" signal.
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return json({ error: 'Authentication required' }, 401);
  }

  const key = Deno.env.get('MAPTILER_KEY');
  if (!key) {
    return json({ error: 'MAPTILER_KEY not configured' }, 500);
  }

  // Accept the query from either GET ?q= or POST body { q: "..." }
  let q = '';
  if (req.method === 'GET') {
    const url = new URL(req.url);
    q = url.searchParams.get('q') || '';
  } else if (req.method === 'POST') {
    try { const body = await req.json(); q = String(body.q || ''); } catch { /* ignore */ }
  }
  q = q.trim();
  if (!q) return json({ error: 'Missing q parameter' }, 400);

  // ── Build the MapTiler request ────────────────────────────────────────────
  // Endpoint: https://api.maptiler.com/geocoding/{q}.json
  // Restrictions we apply:
  //   country=ca       — only Canadian results, period
  //   proximity=-52.7,47.5  — bias results toward St. John's, NL
  //   limit=1          — we only want the best match
  //
  // We deliberately do NOT use bbox here. MapTiler honours country+proximity
  // without the brittle "no result outside bbox" problem that broke the
  // Nominatim version. If a NL address can't be found, MapTiler returns []
  // rather than picking the closest hit in another province.
  //
  // We append ", St. John's, NL, Canada" to addresses missing province
  // context so addresses like "89 Firdale Drive" resolve correctly.
  const hasContext = /\b(NL|Newfoundland|Labrador|Canada|St\.?\s*John[s']?s)\b/i.test(q);
  const query = hasContext ? q : `${q}, St. John's, NL, Canada`;

  const params = new URLSearchParams({
    key,
    country:   'ca',
    proximity: '-52.7126,47.5615',  // St. John's
    limit:     '1',
    language:  'en',
  });

  const upstreamUrl = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?${params}`;

  try {
    const res = await fetch(upstreamUrl, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return json({ error: `MapTiler ${res.status}`, detail: body.slice(0, 240) }, 502);
    }
    const data = await res.json();

    // MapTiler returns a GeoJSON FeatureCollection. Coordinates are [lng, lat].
    const f = data?.features?.[0];
    if (!f?.geometry?.coordinates || f.geometry.coordinates.length < 2) {
      return json({ error: 'No match', query }, 404);
    }
    const [lng, lat] = f.geometry.coordinates;
    return json({ lat: Number(lat), lng: Number(lng), label: f.place_name || query });
  } catch (e) {
    return json({ error: 'Upstream fetch failed', detail: String(e).slice(0, 240) }, 502);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
