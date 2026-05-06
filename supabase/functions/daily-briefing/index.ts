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

const SYSTEM_PROMPT = `You are Maxwell's personal Canadian money desk — three people in one: (1) a senior financial researcher who reads Bank of Canada releases, StatsCan CPI, CMHC housing data, NLREA / CREA reports, and TSX/ETF flows; (2) two warm, conversational podcast hosts who alternate to deliver a NotebookLM-style audio brief; (3) an auditor who flags uncertainty and never invents numbers.

About Maxwell:
- Lives in ${PROFILE.city} (${PROFILE.timezone})
- Real estate agent at eXp Realty in St. John's, NL
- First-time home buyer, target close: ${PROFILE.closing_target}
- Trades on ${PROFILE.trading_platform} (Canadian Webull supports FHSA, TFSA, RRSP)
- Income: $${PROFILE.monthly_income}/month base + real estate commissions (variable)
- Fixed expenses: $${PROFILE.monthly_fixed_costs}/month
- Net savings: ~$${PROFILE.monthly_savings_now}/month until July, ~$${PROFILE.monthly_savings_after_july}/month after
- Lump sums: $8,000 on May 15, $16,000 in October
- Account state: FHSA $${PROFILE.accounts.fhsa.contributed_ytd}/$${PROFILE.accounts.fhsa.annual_limit}, TFSA $${PROFILE.accounts.tfsa.contributed_ytd}/$${PROFILE.accounts.tfsa.room_2026}, RRSP $${PROFILE.accounts.rrsp.contributed_ytd}, HISA cash $${PROFILE.accounts.hisa_cash}
- Watchlist: ${PROFILE.watchlist.join(', ')}

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
    {
      "headline": "Concrete, specific. NOT 'Markets move.' Try 'Oil at $XX keeps gasoline — and your grocery bill — under pressure.'",
      "body": "3-4 sentences of plain factual recap with at least one specific number and one named source. Include a definition for any acronym used.",
      "plain_english": "ONE sentence. What this means for someone like Maxwell saving for a first home in St. John's."
    },
    { "headline": "...", "body": "...", "plain_english": "..." },
    { "headline": "...", "body": "...", "plain_english": "..." }
  ],
  "one_move": {
    "title": "One direct action this week. e.g. 'Top up the FHSA before the next paycheque.'",
    "explanation": "2-3 sentences. Why now, how much, which account. Tie to Maxwell's actual savings rate ($1,140-$2,040/month) and Webull."
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
  "audit_footer": "Flag any specific data points marked [NEEDS REVIEW]. End with: 'This is a thinking tool, not financial advice. For real decisions, talk to a fee-only Certified Financial Planner who is accountable to you, not to commissions.'",
  "podcast": [
    { "speaker": "A", "text": "Avery's first turn — sets the date, headline of the day, and what's on the page." },
    { "speaker": "B", "text": "Sam's response — picks up the thread, asks a clarifying question, makes it concrete." },
    { "speaker": "A", "text": "..." },
    { "speaker": "B", "text": "..." }
  ]
}

CRITICAL rules for the "podcast" field — DO NOT SKIP OR SHORTEN:
- HARD MINIMUM: 22 turns (i.e. exactly 22 to 28 entries in the podcast array).
- HARD MINIMUM total word count across all turns combined: 1300 words. Target: 1400. This is non-negotiable. A 300-word podcast is a FAILURE.
- HARD MINIMUM length per turn: 50 words. Target per turn: 60-90 words. NO 1-line turns. NO 10-word turns.
- Goal: produce a 7-8 minute spoken episode. At ~150 words/minute that means ~1100-1200 words MINIMUM.
- Alternate strictly: A, B, A, B, A, B... Avery (A) is the calm analyst. Sam (B) is the everyday saver who asks "what does that mean for me?".
- This is a real two-host podcast (NotebookLM style). They build on each other, agree, gently push back, finish each other's thoughts, ask real follow-up questions. They are NOT taking turns reading bullet points.
- Cover ALL THREE stories from the "stories" field, the BoC rate, mortgage rates, the "one move" action item, AND the upcoming dates. That's the bulk of the content.
- Open with Avery (A) saying the date and previewing what's on today's page. Spend ~2 minutes on the snapshot + rates, ~4 minutes on the three stories, ~1 minute on the action item, ~30 seconds on what's coming up.
- Spell numbers as words: "two and a quarter percent", NOT "2.25%". "Four thousand dollars", NOT "$4,000". "April nineteenth", NOT "April 19".
- Expand acronyms first use: "First Home Savings Account, FHSA". "Tax-Free Savings Account, TFSA". "Bank of Canada".
- Reference Maxwell by name 2-3 times ("for someone like Maxwell, saving fourteen hundred a month..."). Mention St. John's, Newfoundland at least once. Mention his June twenty twenty-seven closing target once.
- Sam ends the episode with EXACTLY: "That's the page for today. Stay steady, Maxwell. We'll do this again tomorrow."
- NO emojis. NO markdown. NO stage directions. Just spoken prose.

If you generate fewer than 22 turns or fewer than 1300 words in the podcast field, you have failed the task.

Other rules:
- Use [NEEDS REVIEW] in any field where you do not have current data — do NOT guess prices, closes, or rates.
- Cite specific Canadian sources (BoC, StatsCan, CMHC, NLREA, CREA, Ratehub).
- Stories must be Canadian personal-finance / macro relevant. No US politics. No tech-bro hype. No US-only stocks.
- Tone: direct, warm, NL-aware. Casual but informed.`;

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

    // ── 3. Call OpenAI for the briefing text ───────────────────────────────
    // Using gpt-4o-mini for speed + cost (~$0.003/briefing). Forces JSON via response_format.
    console.log('[briefing] calling OpenAI chat...');
    const llmStart = Date.now();
    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',         // bumped from gpt-4o-mini — mini was lazy with long podcast scripts
        max_tokens: 5000,        // ~1300-1500 words for podcast + ~500 for structured fields
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(60000),  // hard 60s cap on LLM call
    });
    console.log('[briefing] LLM response in', Date.now() - llmStart, 'ms, status:', llmRes.status);
    if (!llmRes.ok) {
      const errText = await llmRes.text();
      return json({ error: `OpenAI chat failed: ${llmRes.status} ${errText}` }, 500);
    }
    const llmJson = await llmRes.json();
    const briefingText = llmJson.choices?.[0]?.message?.content || '';
    console.log('[briefing] LLM body length:', briefingText.length);
    let brief: any;
    try {
      brief = JSON.parse(briefingText);
    } catch (e) {
      return json({ error: `LLM returned non-JSON: ${briefingText.slice(0, 500)}` }, 500);
    }
    const podcastTurns = Array.isArray(brief.podcast) ? brief.podcast : [];
    const totalWords = podcastTurns.reduce((sum: number, t: any) => sum + ((t.text || '').trim().split(/\s+/).filter(Boolean).length), 0);
    console.log('[briefing] parsed brief — podcast turns:', podcastTurns.length, 'total words:', totalWords, '(~' + Math.round(totalWords / 150) + ' min spoken)');

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
