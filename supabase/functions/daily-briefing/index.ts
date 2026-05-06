// Maxwell DealFlow — Daily Money Briefing edge function
//
// Generates Albert's personalised Canadian money briefing.
// Run daily at 09:30 UTC (~6:00 AM NDT) via pg_cron, or manually invoke for testing.
//
// Pipeline:
//   1. Fetch live data: BoC overnight rate (BoC Valet API, free, no key)
//   2. Build prompt with Albert's profile + portfolio + market data
//   3. Call Claude (claude-haiku-4-5) → structured JSON briefing
//   4. Call OpenAI TTS (tts-1-hd, voice=onyx) → MP3 buffer
//   5. Save brief to briefings table; upload MP3 to storage
//   6. Email Albert via send-email edge fn with MP3 attached
//
// Required Supabase secrets:
//   OPENAI_API_KEY      — used for both the briefing text (gpt-4o-mini) and TTS audio (tts-1-hd)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — built-in

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Albert's profile (hardcoded for v1; later move to a user_briefing_settings table)
const PROFILE = {
  name: 'Albert',
  email: 'maxwelldelali22@gmail.com',
  city: 'St. John\'s, Newfoundland',
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

const SYSTEM_PROMPT = `You are Albert's personal Canadian money desk — three people in one. (1) A senior financial researcher who reads Bank of Canada releases, Statistics Canada CPI reports, CMHC housing data, and TSX/ETF flows. (2) A calm news presenter who can deliver a 4-minute spoken briefing without jargon. (3) An auditor who flags risks, conflicts, and anything that smells like hype. You also have the instincts of an experienced ETF and equity strategist who tracks the Canadian market — TSX, XEQT, VFV, VEQT, ZSP, XIC, XGRO, HXS, sector ETFs, GICs, and the major Canadian banks — and who understands when to buy, hold, trim, or sell based on macro signals (rates, CPI, employment, oil, CAD/USD).

About Albert:
- Lives in ${PROFILE.city} (${PROFILE.timezone})
- First-time home buyer, target close: ${PROFILE.closing_target}
- Trades on ${PROFILE.trading_platform} (Canadian Webull supports FHSA, TFSA, RRSP)
- Income: $${PROFILE.monthly_income}/month base salary + real estate commissions (variable)
- Fixed expenses: $${PROFILE.monthly_fixed_costs}/month
- Net savings: ~$${PROFILE.monthly_savings_now}/month until July, ~$${PROFILE.monthly_savings_after_july}/month after (sister finishes school)
- Lump sums incoming: $8,000 on May 15, $16,000 in October
- Ghanaian-Canadian, diaspora-aware tone — direct, warm, no fluff
- Account state: FHSA $${PROFILE.accounts.fhsa.contributed_ytd}/$${PROFILE.accounts.fhsa.annual_limit}, TFSA $${PROFILE.accounts.tfsa.contributed_ytd}/$${PROFILE.accounts.tfsa.room_2026}, RRSP $${PROFILE.accounts.rrsp.contributed_ytd}, HISA cash $${PROFILE.accounts.hisa_cash}

Output a single JSON object with this exact structure (no prose, no markdown fences, ONLY valid JSON):
{
  "snapshot": {
    "boc_rate": "X.XX% (BoC overnight)",
    "next_boc_meeting": "ISO date",
    "cpi_latest": "X.X% YoY (StatsCan, MMM YYYY)",
    "xeqt_close": "$XX.XX (+X.XX%)",
    "tsx_close": "XX,XXX (+X.XX%)",
    "cad_usd": "0.XXXX",
    "wti_oil": "$XX.XX USD",
    "nl_avg_home": "$XXX,XXX (CREA / NLREA)",
    "best_5yr_fixed": "X.XX%",
    "best_variable": "X.XX%"
  },
  "stories": [
    { "headline": "...", "facts": "2-3 sentence factual recap", "plain_english": "one-line translation for non-finance people" },
    { ... }, { ... }
  ],
  "etf_call": {
    "tickers": ["XEQT.TO"],
    "stance": "Buy" | "Add" | "Hold" | "Trim" | "Sell" | "Avoid",
    "reasoning": "two sentences",
    "worked_example": "If Albert puts $X today at $Y, that buys ~Z units. Assuming 7% real return over 14 months to closing, $X grows to ~$W. Assumptions stated."
  },
  "action_item": {
    "summary": "one-line directive",
    "exact_dollars": 0,
    "exact_account": "FHSA" | "TFSA" | "RRSP" | "HISA",
    "exact_day": "Mon/Tue/Wed/Thu/Fri",
    "ticker_buy": "XEQT.TO" | null,
    "limit_price": null | number,
    "tied_to_savings": "explanation linking this to Albert's $1,140-$2,040/month rate"
  },
  "watch_list": [
    { "date": "ISO", "event": "CPI / BoC decision / jobs / earnings", "matters_because": "what it means for Albert's mortgage rate or portfolio" },
    { ... }, { ... }
  ],
  "audit_footer": "any uncertainty flags + 'This is a thinking tool, not financial advice. For real decisions, talk to a fee-only Certified Financial Planner.'",
  "written_brief_html": "<div>... compact HTML, ready to paste into email body, with sections for snapshot, stories, ETF call, action, watchlist, audit footer ...</div>",
  "spoken_script_text": "PURE PROSE for text-to-speech. Spell numbers out as a presenter would say them: 'two and a quarter percent', NOT '2.25%'. Expand acronyms first time: 'Tax-Free Savings Account, TFSA'. No emojis. No markdown. End with: 'That's your briefing. Have a steady day, Albert.' Aim for 3-4 minutes when read at normal pace (~500-700 words)."
}

Rules:
- Use [NEEDS REVIEW] in any field where you do not have current data (do not guess).
- Cite sources where possible (BoC, StatsCan, CMHC, TSX, Yahoo Finance).
- Stories should be Canadian personal-finance / macro relevant. No US politics. No tech-bro news.
- Action item must reference Albert's actual savings rate and Webull as the platform.
- Spoken script must end with the exact closing line above.`;

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
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
      }),
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
      // OpenAI's response_format=json_object guarantees valid JSON; parse direct
      brief = JSON.parse(briefingText);
    } catch (e) {
      return json({ error: `LLM returned non-JSON: ${briefingText.slice(0, 500)}` }, 500);
    }
    console.log('[briefing] parsed brief, spoken_script_text length:', (brief.spoken_script_text || '').length);

    // ── 4. Generate audio via OpenAI TTS ───────────────────────────────────
    console.log('[briefing] calling OpenAI TTS...');
    const ttsStart = Date.now();
    // Truncate spoken text to 4000 chars (TTS limit is 4096) to keep TTS fast
    const ttsInput = (brief.spoken_script_text || 'No briefing content available today.').slice(0, 4000);
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1',          // tts-1 is ~3x faster than tts-1-hd, still very listenable
        voice: 'onyx',           // calm masculine voice
        input: ttsInput,
        format: 'mp3',
      }),
    });
    console.log('[briefing] TTS response in', Date.now() - ttsStart, 'ms, status:', ttsRes.status);
    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      return json({ error: `OpenAI TTS failed: ${ttsRes.status} ${errText}` }, 500);
    }
    const mp3Buffer = await ttsRes.arrayBuffer();
    const mp3Bytes = new Uint8Array(mp3Buffer);
    console.log('[briefing] mp3 bytes:', mp3Bytes.length);

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
    console.log('[briefing] saving to DB...');
    try {
      await admin.from('briefings').upsert({
        date: dateStr,
        snapshot: brief.snapshot,
        stories: brief.stories,
        etf_call: brief.etf_call,
        action_item: brief.action_item,
        watch_list: brief.watch_list,
        audit_footer: brief.audit_footer,
        written_brief_html: brief.written_brief_html,
        spoken_script_text: brief.spoken_script_text,
        mp3_url: mp3Url,
        created_at: new Date().toISOString(),
      }, { onConflict: 'date' });
    } catch (e) {
      console.warn('[briefing] DB save failed:', e?.message);
    }

    // ── 7. Email Albert with MP3 attached ──────────────────────────────────
    // Use base64-encoded MP3 as attachment via the existing send-email edge fn.
    // mp3 size for ~3-4 min @ tts-1 is ~1.5 MB → fine for gmail.
    // btoa(String.fromCharCode(...mp3Bytes)) blows the JS call-stack on multi-MB
    // arrays. Encode in 32 KB chunks instead.
    console.log('[briefing] base64 encoding mp3...');
    const b64Start = Date.now();
    let base64Mp3 = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < mp3Bytes.length; i += CHUNK) {
      base64Mp3 += String.fromCharCode(...mp3Bytes.subarray(i, i + CHUNK));
    }
    base64Mp3 = btoa(base64Mp3);
    console.log('[briefing] base64 done in', Date.now() - b64Start, 'ms, length:', base64Mp3.length);

    const emailHtml = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;color:#1a1d2e;line-height:1.55;padding:20px;max-width:640px;margin:0 auto;">
      <div style="font-size:11px;color:#5b6079;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Money Briefing · ${dateStr}</div>
      <h1 style="font-size:22px;margin:0 0 18px;">Good morning, ${PROFILE.name}.</h1>
      <p style="font-size:14px;color:#5b6079;margin:0 0 14px;">Your audio briefing is attached as an MP3 — tap to listen on your phone or in your car. Here's the written summary:</p>
      ${brief.written_brief_html || ''}
      <hr style="border:none;border-top:1px solid #e8eaf2;margin:24px 0;">
      <p style="font-size:11px;color:#8a90a8;font-style:italic;">${brief.audit_footer || 'This is a thinking tool, not financial advice.'}</p>
    </body></html>`;

    console.log('[briefing] sending email...');
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
        subject: `Your money briefing — ${dateStr}`,
        body: brief.written_brief_html?.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim() || 'See attached MP3.',
        html: emailHtml,
        from_name: 'Maxwell DealFlow Money Brief',
        attachments: [{
          filename: `briefing-${dateStr}.mp3`,
          mime_type: 'audio/mpeg',
          data: base64Mp3,
        }],
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
