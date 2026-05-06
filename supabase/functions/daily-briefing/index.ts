// Maxwell DealFlow — Daily Money Briefing edge function (v2)
//
// Generates Maxwell's personalised Canadian money briefing.
// Run daily at 09:00 UTC (~6:30 AM NDT, ~5:30 AM NST) via pg_cron, or manually invoke.
//
// v2 pipeline:
//   1. Fetch live data: BoC overnight rate (BoC Valet API, free, no key)
//   2. Call OpenAI gpt-4o-mini → rich JSON brief (snapshot, mortgage rates, 3 stories,
//      one-move-this-week, sources, audit footer, plus a 2-host podcast script)
//   3. Generate 2-voice podcast audio: each turn TTS'd in parallel (onyx for Host A,
//      nova for Host B), MP3 buffers concatenated for a single ~6-8 min file
//   4. Upload MP3 to storage; save brief to briefings table
//   5. Render the newsletter HTML (hero band, metric cards, mortgage rates, 3 stories,
//      one-move callout, sources) and email it with the MP3 attached
//
// Required Supabase secrets:
//   OPENAI_API_KEY      — gpt-4o-mini for briefing, tts-1 for audio
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — built-in

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Maxwell's profile (hardcoded for v1; later move to a user_briefing_settings table)
const PROFILE = {
  name: 'Maxwell',
  email: 'maxwelldelali22@gmail.com',
  city: "St. John's, Newfoundland",
  timezone: 'America/St_Johns',
  closing_target: 'June 2027',
  monthly_income: 4200,        // base salary; real-estate commissions are bonus
  monthly_fixed_costs: 3060,    // car 840 + rent 1500 + insurance 320 + brokerage 400
  monthly_savings_now: 1140,    // until July when sister finishes school
  monthly_savings_after_july: 2040,
  lump_sums: [
    { date: '2026-05-15', amount: 8000, label: 'incoming May 15' },
    { date: '2026-10-15', amount: 16000, label: 'incoming October' },
  ],
  trading_platform: 'Webull',
  accounts: {
    fhsa: { contributed_ytd: 0, annual_limit: 8000, lifetime_limit: 40000 },
    tfsa: { contributed_ytd: 0, room_2026: 7000 },
    rrsp: { contributed_ytd: 0 },
    hisa_cash: 0,
  },
  watchlist: ['XEQT', 'VFV', 'VEQT', 'ZSP', 'XIC', 'XGRO', '^GSPTSE'],
};

// CALL 1 — structured fields (gpt-4o-mini, fast + cheap)
const STRUCTURED_PROMPT = `You are a Canadian personal-finance research desk. You read Bank of Canada releases, StatsCan CPI, CMHC housing data, NLREA / CREA monthly reports, and TSX/ETF flows. You never invent numbers — when uncertain, use [NEEDS REVIEW].

Audience: Canadians saving for a first home (think first-time buyer in their late 20s / 30s, modest income, planning to close in 2027). Lives in ${PROFILE.city}. Watches XEQT, VFV, VEQT, ZSP, XIC, XGRO. Has FHSA, TFSA, RRSP room available.

Output ONE JSON object with this EXACT structure (no markdown, no prose outside JSON):
{
  "snapshot": {
    "boc_rate": "X.XX%",
    "boc_next_meeting": "Mon DD",
    "xeqt_close": "$XX.XX",
    "xeqt_change": "+X.X%",
    "nl_avg_home": "$XXX,XXX",
    "nl_avg_home_period": "Mon YYYY · NLREA",
    "cpi": "X.X%",
    "cpi_period": "Mon YYYY · YoY"
  },
  "mortgage_rates": {
    "fixed_5yr": "X.XX%",
    "variable": "X.XX%",
    "boc_overnight": "X.XX%",
    "monthly_pmt_400k": "~$X,XXX",
    "boc_next_decision": "Mon DD",
    "amortization_note": "On $400K at the fixed rate, 25-yr amortization."
  },
  "stories": [
    { "headline": "Concrete, specific. e.g. 'Oil at $XX keeps gasoline — and your grocery bill — under pressure.'",
      "body": "3-4 sentences of plain factual recap with at least one specific number and one named source. Define any acronym used.",
      "plain_english": "ONE sentence. What this means for first-time buyers." },
    { "headline": "...", "body": "...", "plain_english": "..." },
    { "headline": "...", "body": "...", "plain_english": "..." }
  ],
  "one_move": {
    "title": "One direct action this week. e.g. 'Top up the FHSA before the next paycheque.'",
    "explanation": "2-3 sentences. Why now, how much, which account. Reference a $1,000-$2,000/month savings rate."
  },
  "watch_list": [
    { "date": "Mon DD", "event": "CPI release / BoC decision / earnings", "matters_because": "one line on impact to mortgage rate or portfolio" },
    { "date": "Mon DD", "event": "...", "matters_because": "..." },
    { "date": "Mon DD", "event": "...", "matters_because": "..." }
  ],
  "sources": [
    { "label": "Bank of Canada interest rate", "url": "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/" },
    { "label": "BoC upcoming meetings", "url": "https://www.bankofcanada.ca/press/upcoming-events/" },
    { "label": "StatsCan CPI", "url": "https://www150.statcan.gc.ca/n1/daily-quotidien/" },
    { "label": "NLREA monthly stats", "url": "https://www.nlrea.ca/" },
    { "label": "Ratehub mortgage rates", "url": "https://www.ratehub.ca/" }
  ],
  "audit_footer": "Flag any specific data points marked [NEEDS REVIEW]. End with: 'This is a thinking tool, not financial advice. For real decisions, talk to a fee-only Certified Financial Planner who is accountable to you, not to commissions.'"
}

Rules:
- Use [NEEDS REVIEW] for unknown data. NEVER guess prices, closes, or rates.
- Cite Canadian sources only (BoC, StatsCan, CMHC, NLREA, CREA, Ratehub). NO US politics. NO tech-bro hype.
- Tone: direct, warm, plain. No jargon without immediately defining it.`;

// CALL 2 — podcast script ONLY (gpt-4o, dedicated to long output)
const PODCAST_PROMPT = `You are writing a NotebookLM-style two-host podcast script for a daily Canadian money show called "Today in Canadian Money."

THE TWO HOSTS:
- Host A is "Avery" — calm analyst voice. Explains rates, CPI, the macro picture. Knows the numbers.
- Host B is "Sam" — the everyday saver. Asks the questions a regular person would ask. Translates jargon. Makes it concrete.

AUDIENCE: General Canadian listener saving for a first home. Address them as "you," "if you're saving for a first home," "anyone watching their down payment grow." DO NOT use any specific person's name — this is a public podcast, not a personal voice memo.

OUTPUT FORMAT — JSON only, no markdown:
{
  "podcast": [
    { "speaker": "A", "text": "..." },
    { "speaker": "B", "text": "..." }
  ]
}

═══ HARD REQUIREMENTS — these will be programmatically measured ═══
1. EXACTLY 24 turns (no fewer than 22, no more than 26). Strictly alternating A, B, A, B, A, B...
2. EVERY TURN must be 60-100 words. NO short turns. NO one-sentence replies. If a turn is under 50 words, the whole episode is a failure.
3. TOTAL word count across all turns: 1500-1800 words. Target 1700. At ~150 words/min spoken, that's a 10-12 minute episode.
4. Before submitting, count your words. If under 1500, add detail and re-count. Do not submit a short episode.

═══ COMPREHENSION RULES — make it actually understandable ═══
Every time a host uses a financial term — even basic ones like "yield," "amortization," "CPI," "bond," "variable rate," "policy rate," "FHSA," "TFSA" — they MUST do this in the same turn:
  (a) Define the term in plain words (one sentence)
  (b) Give a concrete dollar example using real numbers

Good example:
  Avery: "The Bank of Canada cut its policy rate again. Quick reminder — the policy rate is just the price banks pay to borrow money overnight from the central bank. When that goes down, mortgage rates and HELOC rates usually follow. So if you're holding a four-hundred-thousand dollar variable mortgage, a quarter-point cut saves you about fifty-five bucks a month. Real money over the year."

Bad example (too short, no definition, no example):
  Avery: "BoC cut rates again. Mortgages should follow."

═══ NUMBERS RULES ═══
- Spell out numbers as a presenter would say them: "two and a quarter percent" — NOT "2.25%". "Four hundred thousand dollars" — NOT "$400,000". "April nineteenth" — NOT "April 19".
- Expand acronyms on first use: "First Home Savings Account, FHSA." "Tax-Free Savings Account, TFSA."

═══ EPISODE STRUCTURE (cover all of this) ═══
1. Open (Avery, 1 turn): say the date, preview what the show will cover today.
2. The snapshot (4-5 turns): BoC rate, what it means, CPI, oil context. Sam asks "so what does that mean for someone trying to buy a place this year?"
3. Mortgage rates (4-5 turns): fixed vs variable, the math on a real four-hundred-thousand-dollar mortgage, what's "amortization" — explain with a concrete monthly payment example.
4. The three stories (8-10 turns): walk through each. Avery gives the facts, Sam asks "ok, but what does that actually do to my finances?", Avery answers with a number.
5. The one move this week (2-3 turns): the concrete action, who it's for, how much, which account, why now.
6. Watch list (1-2 turns): 2-3 dates coming up that matter.
7. Close (Sam, 1 turn): EXACTLY this line — "That's the page for today. Stay steady. We'll do this again tomorrow."

═══ STYLE ═══
- Real conversation, not bullet-point reading. Hosts agree, gently push back, finish each other's thoughts, ask "wait — does that mean...?"
- No emojis. No markdown. No stage directions like "[laughs]". Just spoken prose.
- Warm Canadian tone. No US politics. No tech-bro hype.

If you generate fewer than 22 turns or fewer than 1500 total words, the response is rejected and the user gets nothing.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey    = Deno.env.get('OPENAI_API_KEY');

    if (!openaiKey)    return json({ error: 'OPENAI_API_KEY missing'    }, 500);

    const admin = createClient(supabaseUrl, serviceKey);

    // Today in NL time
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: PROFILE.timezone });

    console.log('[briefing] starting at', new Date().toISOString());

    // ── 1. Fetch BoC overnight rate (free, no key) ─────────────────────────
    let bocRate = '[NEEDS REVIEW]';
    try {
      const bocCtl = AbortSignal.timeout(5000);
      const bocRes = await fetch('https://www.bankofcanada.ca/valet/observations/V39079/json?recent=1', { signal: bocCtl });
      const bocJson = await bocRes.json();
      const obs = bocJson.observations?.[0];
      if (obs?.V39079?.v) bocRate = `${obs.V39079.v}% (as of ${obs.d})`;
      console.log('[briefing] BoC rate:', bocRate);
    } catch (e) {
      console.warn('[briefing] BoC fetch failed:', e?.message);
    }

    // ── 2. Build prompt with today's data ──────────────────────────────────
    const userPrompt = `Today is ${dateStr} (${PROFILE.timezone}).

Live data fetched:
- Bank of Canada overnight rate: ${bocRate}

For all other fields (CPI, ETF closes, TSX, CAD/USD, oil, NL home prices, mortgage rates), use your most recent knowledge or [NEEDS REVIEW] if uncertain.

Generate today's briefing as a single JSON object per the system prompt's schema. ONLY the JSON object, nothing else.`;

    // ── 3a. Call OpenAI #1: structured brief data (gpt-4o-mini, fast) ──────
    console.log('[briefing] LLM call 1: structured fields...');
    const llm1Start = Date.now();
    const llm1Res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: STRUCTURED_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(40000),
    });
    console.log('[briefing] LLM call 1 in', Date.now() - llm1Start, 'ms, status:', llm1Res.status);
    if (!llm1Res.ok) {
      const errText = await llm1Res.text();
      return json({ error: `OpenAI call 1 failed: ${llm1Res.status} ${errText}` }, 500);
    }
    const llm1Json = await llm1Res.json();
    const briefingText = llm1Json.choices?.[0]?.message?.content || '';
    let brief: any;
    try {
      brief = JSON.parse(briefingText);
    } catch (e) {
      return json({ error: `LLM call 1 non-JSON: ${briefingText.slice(0, 500)}` }, 500);
    }
    console.log('[briefing] structured fields parsed (snapshot, stories, mortgage_rates, one_move)');

    // ── 3b. Call OpenAI #2: podcast script ONLY (gpt-4o, long output) ─────
    // Splitting the call dramatically improves length compliance — gpt-4o-mini
    // was producing 300-word podcasts in single-call mode. Dedicated call gets
    // 1500+ words reliably.
    console.log('[briefing] LLM call 2: podcast script (dedicated)...');
    const llm2Start = Date.now();
    const podcastUserPrompt = `Today is ${dateStr} (${PROFILE.timezone}).

Use these facts (already researched) for today's episode:
${JSON.stringify({
  snapshot: brief.snapshot,
  mortgage_rates: brief.mortgage_rates,
  stories: brief.stories,
  one_move: brief.one_move,
  watch_list: brief.watch_list,
}, null, 2)}

Generate the podcast JSON now. Remember: 22-26 turns, every turn 60-100 words, total 1500-1800 words. ONLY the JSON object.`;

    const llm2Res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 8000,    // big budget — podcast alone is ~2500 tokens
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PODCAST_PROMPT },
          { role: 'user',   content: podcastUserPrompt },
        ],
      }),
      signal: AbortSignal.timeout(70000),
    });
    console.log('[briefing] LLM call 2 in', Date.now() - llm2Start, 'ms, status:', llm2Res.status);
    if (!llm2Res.ok) {
      const errText = await llm2Res.text();
      return json({ error: `OpenAI call 2 failed: ${llm2Res.status} ${errText}` }, 500);
    }
    const llm2Json = await llm2Res.json();
    const podcastText = llm2Json.choices?.[0]?.message?.content || '';
    try {
      const podcastObj = JSON.parse(podcastText);
      brief.podcast = Array.isArray(podcastObj.podcast) ? podcastObj.podcast : [];
    } catch (e) {
      return json({ error: `LLM call 2 non-JSON: ${podcastText.slice(0, 500)}` }, 500);
    }
    const podcastTurns = Array.isArray(brief.podcast) ? brief.podcast : [];
    const totalWords = podcastTurns.reduce((sum: number, t: any) => sum + ((t.text || '').trim().split(/\s+/).filter(Boolean).length), 0);
    console.log('[briefing] podcast — turns:', podcastTurns.length, 'words:', totalWords, '(~' + Math.round(totalWords / 150) + ' min spoken)');

    // ── 4. Generate 2-voice podcast audio via batched TTS ──────────────────
    // Each turn is TTS'd with a voice based on the speaker:
    //   speaker "A" (Avery, analyst) → onyx
    //   speaker "B" (Sam, host)      → nova
    // We batch in groups of 6 to stay under OpenAI's tts-1 concurrency limit.
    // Each call has a 20s timeout. If a turn fails, we substitute silence so the
    // whole episode still ships.
    console.log('[briefing] calling OpenAI TTS (2-voice, batched)...');
    const ttsStart = Date.now();
    const voiceFor = (speaker: string) => speaker === 'B' ? 'nova' : 'onyx';

    const ttsOne = async (turn: any, idx: number): Promise<ArrayBuffer> => {
      const text = (turn?.text || '').slice(0, 4000);
      if (!text) return new ArrayBuffer(0);
      try {
        const r = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'tts-1',
            voice: voiceFor(turn.speaker || 'A'),
            input: text,
            format: 'mp3',
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) {
          console.warn(`[briefing] TTS turn ${idx} failed status ${r.status}`);
          return new ArrayBuffer(0);
        }
        return await r.arrayBuffer();
      } catch (e: any) {
        console.warn(`[briefing] TTS turn ${idx} threw: ${e?.message}`);
        return new ArrayBuffer(0);
      }
    };

    const BATCH = 6;
    const ttsBuffers: ArrayBuffer[] = [];
    for (let i = 0; i < podcastTurns.length; i += BATCH) {
      const chunk = podcastTurns.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map((turn: any, j: number) => ttsOne(turn, i + j)));
      ttsBuffers.push(...results);
      console.log(`[briefing] TTS batch ${Math.floor(i/BATCH)+1} done (${ttsBuffers.length}/${podcastTurns.length} segments)`);
    }
    console.log('[briefing] TTS done in', Date.now() - ttsStart, 'ms, total segments:', ttsBuffers.length);

    // Concatenate MP3 byte arrays into one continuous file
    const totalLen = ttsBuffers.reduce((s, b) => s + b.byteLength, 0);
    const mp3Bytes = new Uint8Array(totalLen);
    let off = 0;
    for (const buf of ttsBuffers) {
      mp3Bytes.set(new Uint8Array(buf), off);
      off += buf.byteLength;
    }
    console.log('[briefing] stitched mp3 bytes:', mp3Bytes.length);

    // ── 5. Upload MP3 to Supabase Storage ──────────────────────────────────
    console.log('[briefing] uploading mp3...');
    const upStart = Date.now();
    const mp3Path = `${dateStr}.mp3`;
    let mp3Url: string | null = null;
    try {
      const uploadRes = await admin.storage.from('briefings-audio').upload(mp3Path, mp3Bytes, {
        contentType: 'audio/mpeg',
        upsert: true,
      });
      if (!uploadRes.error) {
        const { data: pub } = admin.storage.from('briefings-audio').getPublicUrl(mp3Path);
        mp3Url = pub?.publicUrl || null;
      } else {
        console.warn('[briefing] upload error:', uploadRes.error);
      }
    } catch (e) {
      console.warn('[briefing] MP3 upload failed:', e?.message);
    }
    console.log('[briefing] upload done in', Date.now() - upStart, 'ms, url:', mp3Url);

    // ── 6. Save the brief to briefings table ───────────────────────────────
    // Note: action_item / etf_call columns kept for back-compat with v1 migration.
    // We pack the v2-only fields (mortgage_rates, one_move, sources, podcast) into
    // action_item as a wrapper jsonb so we don't need a new migration tonight.
    console.log('[briefing] saving to DB...');
    try {
      await admin.from('briefings').upsert({
        date: dateStr,
        snapshot: brief.snapshot,
        stories: brief.stories,
        etf_call: null,
        action_item: {
          one_move: brief.one_move || null,
          mortgage_rates: brief.mortgage_rates || null,
          sources: brief.sources || null,
          podcast_turns: (brief.podcast || []).length,
        },
        watch_list: brief.watch_list,
        audit_footer: brief.audit_footer,
        written_brief_html: null, // we now render HTML server-side from structured fields
        spoken_script_text: (brief.podcast || []).map((t: any) => `[${t.speaker}] ${t.text}`).join('\n'),
        mp3_url: mp3Url,
        created_at: new Date().toISOString(),
      }, { onConflict: 'date' });
    } catch (e) {
      console.warn('[briefing] DB save failed:', e?.message);
    }

    // ── 7. Email Maxwell — link to the MP3 instead of attaching it ─────────
    // Free-tier edge functions hit WORKER_RESOURCE_LIMIT (~256 MB RAM) when
    // base64-encoding a 4-7 MB MP3 into a MIME multipart message. Since the
    // MP3 is already at a public URL, we just link to it. Same one-tap UX,
    // no memory limits, faster delivery, no 25 MB Gmail attachment cap.
    const niceDate = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-CA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: PROFILE.timezone,
    });
    const emailHtml = renderBriefingHtml(brief, dateStr, niceDate, mp3Url);

    console.log('[briefing] sending email (no attachment, link only)...');
    const emStart = Date.now();
    const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
      },
      body: JSON.stringify({
        to: PROFILE.email,
        subject: `Today in Canadian money — ${niceDate}`,
        body: `Listen to today's audio briefing: ${mp3Url || '(audio unavailable)'}\n\n${emailHtml.replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim().slice(0, 2000)}`,
        html: emailHtml,
        from_name: 'Maxwell Money Brief',
      }),
    });
    const emailJson = await emailRes.json().catch(() => ({}));
    console.log('[briefing] email response in', Date.now() - emStart, 'ms, status:', emailRes.status, 'body:', JSON.stringify(emailJson).slice(0, 300));
    console.log('[briefing] DONE.');

    return json({
      ok: true,
      date: dateStr,
      mp3_url: mp3Url,
      email_sent: !emailJson.error,
      email_response: emailJson,
      briefing_preview: {
        snapshot: brief.snapshot,
        action_item: brief.action_item,
      },
    });
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// HTML escape for any user-visible LLM text inserted into the email
function esc(s: any): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render the newsletter HTML — matches the "Today in Canadian money, in one page" layout.
// All inline styles (Gmail strips <style> blocks, etc.).
function renderBriefingHtml(brief: any, dateStr: string, niceDate: string, mp3Url: string | null): string {
  const snap     = brief.snapshot || {};
  const mort     = brief.mortgage_rates || {};
  const stories  = Array.isArray(brief.stories) ? brief.stories.slice(0, 3) : [];
  const oneMove  = brief.one_move || {};
  const watch    = Array.isArray(brief.watch_list) ? brief.watch_list.slice(0, 4) : [];
  const sources  = Array.isArray(brief.sources) ? brief.sources : [];
  const audit    = brief.audit_footer || 'This is a thinking tool, not financial advice. For real decisions, talk to a fee-only Certified Financial Planner.';

  const metricCard = (label: string, value: string, sub: string) => `
    <td width="50%" style="padding:18px 14px; vertical-align:top; text-align:center; background:#fefdf9;">
      <div style="font-size:11px; letter-spacing:0.14em; color:#8a90a8; text-transform:uppercase; font-family:-apple-system,Helvetica,sans-serif;">${esc(label)}</div>
      <div style="font-size:34px; font-weight:600; margin:8px 0 4px; color:#1a1d2e; font-family:Georgia,'Times New Roman',serif;">${esc(value)}</div>
      <div style="font-size:12px; color:#5b6079; font-family:-apple-system,Helvetica,sans-serif;">${esc(sub)}</div>
    </td>`;

  const storyBlock = (s: any, i: number) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px; border-collapse:collapse;">
      <tr>
        <td width="44" style="vertical-align:top; padding-top:4px;">
          <div style="font-size:13px; color:#8a90a8; letter-spacing:0.06em; font-family:-apple-system,Helvetica,sans-serif;">${String(i+1).padStart(2,'0')}</div>
        </td>
        <td>
          <h4 style="font-size:19px; line-height:1.35; font-weight:600; margin:0 0 10px; color:#1a1d2e; font-family:Georgia,'Times New Roman',serif;">${esc(s.headline || '')}</h4>
          <p style="font-size:15px; line-height:1.65; margin:0 0 12px; color:#1a1d2e; font-family:-apple-system,Helvetica,sans-serif;">${esc(s.body || '')}</p>
          <div style="background:#f5efdf; border-radius:6px; padding:12px 16px; font-size:14px; line-height:1.55; color:#3d4254; font-family:-apple-system,Helvetica,sans-serif;">
            <strong style="color:#5b6079;">Plain English →</strong> ${esc(s.plain_english || '')}
          </div>
        </td>
      </tr>
    </table>`;

  return `<!DOCTYPE html><html><body style="margin:0; padding:0; background:#fefdf9;">
<div style="font-family:Georgia,'Times New Roman',serif; max-width:680px; margin:0 auto; padding:0; color:#1a1d2e; background:#fefdf9;">

  <!-- Hero band -->
  <div style="background:#f5efdf; padding:36px 32px 32px;">
    <div style="font-size:13px; color:#5b6079; margin-bottom:14px; font-family:-apple-system,Helvetica,sans-serif;">As of <strong>${esc(niceDate)}</strong> · ${esc(PROFILE.city)}</div>
    <h1 style="font-size:34px; line-height:1.15; margin:0 0 12px; font-weight:600; color:#1a1d2e;">Today in Canadian money, <em style="font-weight:500;">in one page.</em></h1>
    <p style="font-size:15px; line-height:1.55; color:#3d4254; margin:0; font-style:italic;">Rates. Markets. Real estate. What it means for you — no jargon without a definition right next to it.</p>
  </div>

  <div style="padding:8px 24px 32px;">

    <!-- Audio play button — large, tappable, links to public MP3 -->
    ${mp3Url ? `<div style="margin:24px 0 32px; text-align:center;">
      <a href="${esc(mp3Url)}" style="display:inline-block; background:#1a1d2e; color:#fefdf9; padding:18px 28px; border-radius:8px; font-family:-apple-system,Helvetica,sans-serif; font-size:16px; font-weight:600; text-decoration:none;">
        ▶ &nbsp;Listen to today's briefing
      </a>
      <div style="font-family:-apple-system,Helvetica,sans-serif; font-size:12px; color:#8a90a8; margin-top:8px;">2 hosts · about 7 minutes · streams from anywhere</div>
    </div>` : ''}

    <!-- Metric cards (2x2) -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 32px; border-collapse:collapse;">
      <tr>
        ${metricCard('BoC Rate', snap.boc_rate || '—', `Next meeting ${snap.boc_next_meeting || '—'}`)}
        ${metricCard('XEQT Close', snap.xeqt_close || '—', snap.xeqt_change || '—')}
      </tr>
      <tr>
        ${metricCard('NL Avg Home', snap.nl_avg_home || '—', snap.nl_avg_home_period || '—')}
        ${metricCard('Inflation (CPI)', snap.cpi || '—', snap.cpi_period || '—')}
      </tr>
    </table>

    <!-- Mortgage rates -->
    <div style="margin:28px 0 8px;">
      <div style="font-size:12px; letter-spacing:0.14em; color:#8a90a8; text-transform:uppercase; font-family:-apple-system,Helvetica,sans-serif; margin-bottom:6px;">Mortgage rates today</div>
      <h3 style="font-size:24px; font-weight:600; margin:0 0 16px; color:#1a1d2e;">What the banks are charging</h3>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px; border-collapse:collapse;">
      <tr>
        <td width="50%" style="padding:14px 14px 14px 0; vertical-align:top; text-align:center;">
          <div style="font-size:30px; font-weight:600; color:#1a1d2e; font-family:Georgia,'Times New Roman',serif;">${esc(mort.fixed_5yr || '—')}</div>
          <div style="font-size:13px; color:#1a1d2e; font-weight:600; margin-top:6px; font-family:-apple-system,Helvetica,sans-serif;">5-year fixed</div>
          <div style="font-size:12px; color:#5b6079; margin-top:3px; font-family:-apple-system,Helvetica,sans-serif;">Locked in. Same payment for five years.</div>
        </td>
        <td width="50%" style="padding:14px 0 14px 14px; vertical-align:top; text-align:center;">
          <div style="font-size:30px; font-weight:600; color:#1a1d2e; font-family:Georgia,'Times New Roman',serif;">${esc(mort.variable || '—')}</div>
          <div style="font-size:13px; color:#1a1d2e; font-weight:600; margin-top:6px; font-family:-apple-system,Helvetica,sans-serif;">Variable</div>
          <div style="font-size:12px; color:#5b6079; margin-top:3px; font-family:-apple-system,Helvetica,sans-serif;">Moves with the Bank of Canada.</div>
        </td>
      </tr>
      <tr>
        <td width="50%" style="padding:14px 14px 14px 0; vertical-align:top; text-align:center;">
          <div style="font-size:30px; font-weight:600; color:#1a1d2e; font-family:Georgia,'Times New Roman',serif;">${esc(mort.monthly_pmt_400k || '—')}</div>
          <div style="font-size:13px; color:#1a1d2e; font-weight:600; margin-top:6px; font-family:-apple-system,Helvetica,sans-serif;">Monthly pmt</div>
          <div style="font-size:12px; color:#5b6079; margin-top:3px; font-family:-apple-system,Helvetica,sans-serif;">${esc(mort.amortization_note || 'On $400K at the fixed rate, 25-yr amortization.')}</div>
        </td>
        <td width="50%" style="padding:14px 0 14px 14px; vertical-align:top; text-align:center;">
          <div style="font-size:30px; font-weight:600; color:#1a1d2e; font-family:Georgia,'Times New Roman',serif;">${esc(mort.boc_overnight || snap.boc_rate || '—')}</div>
          <div style="font-size:13px; color:#1a1d2e; font-weight:600; margin-top:6px; font-family:-apple-system,Helvetica,sans-serif;">Bank of Canada</div>
          <div style="font-size:12px; color:#5b6079; margin-top:3px; font-family:-apple-system,Helvetica,sans-serif;">Next decision ${esc(mort.boc_next_decision || snap.boc_next_meeting || '—')}.</div>
        </td>
      </tr>
    </table>

    <!-- Three stories -->
    <div style="margin:32px 0 8px;">
      <div style="font-size:12px; letter-spacing:0.14em; color:#8a90a8; text-transform:uppercase; font-family:-apple-system,Helvetica,sans-serif; margin-bottom:6px;">What moved today</div>
      <h3 style="font-size:28px; font-weight:600; margin:0 0 24px; line-height:1.2; color:#1a1d2e;">Three stories that actually affect you</h3>
    </div>
    ${stories.map(storyBlock).join('')}

    <!-- One move -->
    ${oneMove.title ? `<div style="background:#1a1d2e; color:#fefdf9; padding:28px 26px; border-radius:8px; margin:32px 0;">
      <div style="font-size:11px; letter-spacing:0.16em; color:#8a90a8; text-transform:uppercase; margin-bottom:10px; font-family:-apple-system,Helvetica,sans-serif;">One move this week</div>
      <h3 style="font-size:22px; font-weight:600; line-height:1.3; margin:0 0 12px; color:#fefdf9;">${esc(oneMove.title)}</h3>
      <p style="font-size:15px; line-height:1.65; margin:0; color:#d4d6e0; font-family:-apple-system,Helvetica,sans-serif;">${esc(oneMove.explanation || '')}</p>
    </div>` : ''}

    <!-- Watch list -->
    ${watch.length ? `<div style="margin:32px 0 8px;">
      <div style="font-size:12px; letter-spacing:0.14em; color:#8a90a8; text-transform:uppercase; font-family:-apple-system,Helvetica,sans-serif; margin-bottom:6px;">Coming up</div>
      <h3 style="font-size:20px; font-weight:600; margin:0 0 12px; color:#1a1d2e;">Dates on the radar</h3>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px; border-collapse:collapse; font-family:-apple-system,Helvetica,sans-serif;">
      ${watch.map((w: any) => `<tr>
        <td width="80" style="padding:8px 12px 8px 0; vertical-align:top; font-size:13px; color:#5b5bd6; font-weight:600;">${esc(w.date || '—')}</td>
        <td style="padding:8px 0; vertical-align:top; font-size:14px; color:#1a1d2e;"><strong>${esc(w.event || '')}</strong> — <span style="color:#5b6079;">${esc(w.matters_because || '')}</span></td>
      </tr>`).join('')}
    </table>` : ''}

    <!-- Sources -->
    ${sources.length ? `<div style="margin:32px 0 8px;">
      <div style="font-size:12px; letter-spacing:0.14em; color:#8a90a8; text-transform:uppercase; font-family:-apple-system,Helvetica,sans-serif; margin-bottom:8px;">Sources</div>
    </div>
    <div style="font-size:14px; line-height:1.9; font-family:-apple-system,Helvetica,sans-serif;">
      ${sources.map((src: any) => `<a href="${esc(src.url)}" style="color:#5b5bd6; text-decoration:none; display:block;">${esc(src.label)}</a>`).join('')}
    </div>` : ''}

    <!-- Footer -->
    <hr style="border:none; border-top:1px solid #e8eaf2; margin:36px 0 18px;">
    <p style="font-size:11px; color:#8a90a8; font-style:italic; line-height:1.6; font-family:-apple-system,Helvetica,sans-serif;">${esc(audit)}</p>
    <p style="font-size:10px; color:#a8aebf; margin-top:14px; font-family:-apple-system,Helvetica,sans-serif;">Maxwell DealFlow · Personal Money Brief · ${esc(dateStr)}</p>
  </div>
</div>
</body></html>`;
}
