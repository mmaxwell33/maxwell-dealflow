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

// ── Profile (hardcoded for v1; later move to a user_briefing_settings table)
// NOT used by name in podcast — it's used as context for personal plan only.
const PROFILE = {
  name: 'Maxwell',                                    // referenced in email salutation only, NOT podcast
  email: 'maxwelldelali22@gmail.com',
  city: "St. John's, Newfoundland",
  timezone: 'America/St_Johns',
  closing_target: 'June 2027',
  monthly_income: 4200,                               // base salary
  monthly_fixed_costs: 3060,                          // car 840 + rent 1500 + insurance 320 + brokerage 400
  monthly_savings_now: 1140,                          // until July when sister finishes school
  monthly_savings_after_july: 2040,
  // Real-estate commissions (taxable income, deposit straight to bank — NOT yet allocated):
  upcoming_cash: [
    { date: '2026-05-17', amount: 9000, source: 'real estate commission' },
    { date: '2026-10-17', amount: 16000, source: 'real estate commission' },
    // More cash coming "soon" — date unknown. Will be added when known.
  ],
  trading_platform: 'Webull',
  // NL combined federal + provincial marginal rate at $50K-$93K total income ≈ 29.5%
  // (Federal 20.5% + NL 14.5% past $44K). Use 28% as conservative blend for planning.
  marginal_tax_rate_pct: 28,
  // Accounts NOT YET OPENED — every briefing should remind to open these on Webull.
  accounts_opened: { fhsa: false, tfsa: false, rrsp: false },
  accounts: {
    fhsa: { contributed_ytd: 0, annual_limit: 8000, lifetime_limit: 40000 },
    tfsa: { contributed_ytd: 0, room_2026: 7000 },
    rrsp: { contributed_ytd: 0, room_estimate: 7560 },  // 18% of $42K prior-year income
    hisa_cash: 0,
  },
  // Real estate commission income YTD — used for tax planning (RRSP deduction value)
  re_commissions_ytd: 0,
  // Risk tolerance: open to taking risk for upside. Core/satellite split:
  //   Core (boring ETFs):   75-80%
  //   Satellite (risk-on):  20-25% — momentum / earnings-catalyst / swing trades
  risk_appetite: 'moderate-high — wants growth + willing to swing-trade with a slice',
  // Emergency fund target based on monthly_fixed_costs (3-6 months runway):
  //   Floor: 3 × 3060 = $9,180
  //   Target: 6 × 3060 = $18,360
  // Currently: $0. Built from October $14K (since May $9K should max FHSA before Dec 31).
  emergency_fund_target_cad: 9180,
  watchlist: ['XEQT.TO', 'VFV.TO', 'VEQT.TO', 'ZSP.TO', 'XIC.TO', 'XGRO.TO', 'RY.TO', 'TD.TO', 'BMO.TO'],
  // Risk-on satellite watchlist — for swing/momentum trades
  satellite_watchlist: ['SHOP.TO', 'BAM.TO', 'CNR.TO', 'BN.TO', 'NVDA', 'AAPL', 'GOOGL'],
};

// CALL 1 — structured fields (gpt-4o-mini, fast + cheap)
const STRUCTURED_PROMPT = `You are a Canadian personal-finance research desk + portfolio coach. You read Bank of Canada releases, StatsCan CPI, CMHC housing data, NLREA / CREA monthly reports, and TSX/ETF flows. You never invent numbers — when uncertain, use [NEEDS REVIEW].

═══ THE LISTENER'S CURRENT SITUATION (use this for the personal_plan section) ═══
CASH FLOW (use these numbers in the math — quote them in dollars):
- Monthly day-job income: $${PROFILE.monthly_income}/month gross base salary
- Monthly fixed expenses: $${PROFILE.monthly_fixed_costs}/month (car ~$840, rent ~$1,500, insurance ~$320, brokerage fees ~$400)
- Monthly net savings BEFORE July: ~$${PROFILE.monthly_savings_now}/month available for investing
- Monthly net savings AFTER July: ~$${PROFILE.monthly_savings_after_july}/month (sister moves out, frees up cash)
- That means between May and December the listener has ~7 months × $${PROFILE.monthly_savings_now} (May–Jul) + 5 months × $${PROFILE.monthly_savings_after_july} (Aug–Dec) ≈ $${(3 * PROFILE.monthly_savings_now + 5 * PROFILE.monthly_savings_after_july).toLocaleString()} in regular savings on top of commissions
- Marginal tax rate: ${PROFILE.marginal_tax_rate_pct}% (NL combined fed+prov)

INCOMING REAL-ESTATE COMMISSIONS (taxable side income, currently in chequing):
- $${PROFILE.upcoming_cash[0].amount.toLocaleString()} on ${PROFILE.upcoming_cash[0].date} (${PROFILE.upcoming_cash[0].source})
- $${PROFILE.upcoming_cash[1].amount.toLocaleString()} on ${PROFILE.upcoming_cash[1].date} (${PROFILE.upcoming_cash[1].source})
- Plus more commissions expected — date unknown, but listener actively closing deals

TARGET CLOSE: ${PROFILE.closing_target} for first home — ~14 months runway from May 2026
LOCATION: ${PROFILE.city}

ACCOUNTS — ALL THREE STILL UNOPENED on ANY broker as of today. Must open by May 20, 2026 (before May 17 cash arrives) to deploy this year:
- FHSA: $${PROFILE.accounts.fhsa.annual_limit}/yr room ($${PROFILE.accounts.fhsa.lifetime_limit} lifetime). Tax-deductible going in, tax-free coming out. PRIORITY 1.
- TFSA: $${PROFILE.accounts.tfsa.room_2026} room for 2026. Tax-free growth.
- RRSP: ~$${PROFILE.accounts.rrsp.room_estimate} room. Tax-deductible — best for sheltering commission income.

Trading platforms to choose from (recommend ONE primary): Wealthsimple Trade, Questrade, Interactive Brokers Canada, Webull Canada.
Watchlist (core): ${PROFILE.watchlist.join(', ')}
Satellite watchlist (risk-on): ${PROFILE.satellite_watchlist.join(', ')}

CRITICAL: Every plan must explicitly reference the listener's monthly savings rate ($${PROFILE.monthly_savings_now}-$${PROFILE.monthly_savings_after_july}/mo) AND the commission timeline. Do NOT recommend a deposit larger than what's actually arriving.

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
  "audit_footer": "Flag any specific data points marked [NEEDS REVIEW]. End with: 'This is a thinking tool, not financial advice. For real decisions, talk to a fee-only Certified Financial Planner who is accountable to you, not to commissions.'",

  "personal_plan": {
    "emergency_fund": {
      "target_cad": ${PROFILE.emergency_fund_target_cad},
      "target_months": "3 months at $${PROFILE.monthly_fixed_costs}/month fixed costs",
      "current_cad": 0,
      "strategy": "Build the emergency fund out of October's $14K — NOT May's $9K. Reason: FHSA room expires Dec 31; the May money should max it for the tax refund. The October cash arrives with enough time to build the buffer before any rate-cut-driven home purchase rush in Q1 2027.",
      "where_to_park_it": "High-interest savings ETF (CASH.TO at ~4.5% gross) inside the TFSA, OR a 1-year cashable GIC at a credit union. NOT a regular bank chequing account."
    },
    "trading_platforms": [
      {
        "name": "Wealthsimple Trade",
        "fees": "Free stock + ETF trades, no account fees",
        "pros": ["Simplest UI, fastest to onboard", "Free FHSA / TFSA / RRSP", "Auto-rebalancing in Wealthsimple Invest", "Canadian"],
        "cons": ["No US-listed stock orders in CAD without 1.5% conversion", "No GIC marketplace", "Limited order types"],
        "best_for": "First-time investor who wants simple, free, and Canadian"
      },
      {
        "name": "Questrade",
        "fees": "Free ETF buys, $4.95-$9.95 stock trades",
        "pros": ["Full registered accounts (FHSA, TFSA, RRSP)", "GIC marketplace built-in", "Norbert's Gambit for cheap CAD→USD"],
        "cons": ["UI more complex", "Inactivity fees if balance under $5K"],
        "best_for": "Someone who'll buy GICs + ETFs + occasional individual stocks"
      },
      {
        "name": "Interactive Brokers Canada",
        "fees": "$1-2 per stock trade, currency-conversion under 0.05%",
        "pros": ["Cheapest by far for active trading", "Best for US stocks in USD", "Margin + options"],
        "cons": ["Steep learning curve", "Tax forms more involved"],
        "best_for": "Serious risk-on trading; not necessary if just holding ETFs"
      },
      {
        "name": "Webull Canada",
        "fees": "Free trades",
        "pros": ["Free; supports FHSA/TFSA/RRSP since 2024"],
        "cons": ["Newer in Canada — fewer reviews", "Customer service not as established as Wealthsimple"],
        "best_for": "Free trading with day-trading-style charts"
      }
    ],
    "platform_recommendation": {
      "primary": "Wealthsimple Trade",
      "reasoning": "For a first-time-buyer 2027 horizon: simplest path. Free trades on FHSA/TFSA/RRSP, no minimums, fast Canadian KYC. The 1.5% conversion fee on US stocks doesn't matter much for a core/satellite portfolio that's mostly Canadian-listed ETFs. Open it this week.",
      "secondary": "Add Questrade later if you want GICs in the mix — they have a better GIC marketplace than Wealthsimple."
    },
    "monthly_savings_deployment": {
      "summary": "How to deploy the listener's REGULAR monthly savings (not the lump-sum commissions) — auto-transfers from chequing into the right accounts every payday.",
      "may_jun_jul_monthly": {
        "available_cad": ${PROFILE.monthly_savings_now},
        "split": "$900/mo → FHSA, $240/mo → TFSA. Set up automatic biweekly transfers on payday so you never see the money in chequing.",
        "rationale": "$${PROFILE.monthly_income} income minus $${PROFILE.monthly_fixed_costs} expenses = $${PROFILE.monthly_savings_now} discretionary. Deploy ALL of it now while FHSA room is open and tax refund matters."
      },
      "aug_to_dec_monthly": {
        "available_cad": ${PROFILE.monthly_savings_after_july},
        "split": "$1,500/mo → FHSA (until annual $8K cap is hit, ~5 months at this rate), then redirect to TFSA. $540/mo → emergency fund / TFSA mix.",
        "rationale": "Sister moves out July → frees $${PROFILE.monthly_savings_after_july - PROFILE.monthly_savings_now}/mo extra. Deploy aggressively into tax-sheltered accounts before Dec 31."
      },
      "total_year_end_estimate": {
        "from_monthly_savings": "May–Jul: 3 × $${PROFILE.monthly_savings_now} = $${(3 * PROFILE.monthly_savings_now).toLocaleString()}. Aug–Dec: 5 × $${PROFILE.monthly_savings_after_july} = $${(5 * PROFILE.monthly_savings_after_july).toLocaleString()}. SUBTOTAL: $${(3 * PROFILE.monthly_savings_now + 5 * PROFILE.monthly_savings_after_july).toLocaleString()}",
        "from_commissions": "May $9,000 + October $16,000 = $25,000",
        "grand_total_deployable_2026": "Approximately $${(3 * PROFILE.monthly_savings_now + 5 * PROFILE.monthly_savings_after_july + 9000 + 16000).toLocaleString()} by Dec 31 — that fully fills FHSA + TFSA + half RRSP for 2026",
        "tax_refund_potential": "If $8K to FHSA + $4K-$8K to RRSP — combined refund ~$3,360 to $4,480 at ${PROFILE.marginal_tax_rate_pct}% marginal rate"
      }
    },
    "this_week_distribution_9k": {
      "summary": "How to split the $9,000 hitting the bank on May 17",
      "fhsa_amount": 8000,
      "fhsa_reasoning": "Max out FHSA first — tax-deductible AND tax-free for first home. Room expires Dec 31.",
      "tfsa_amount": 1000,
      "tfsa_reasoning": "Park $1,000 in TFSA as starter — emergency fund builds from October.",
      "estimated_tax_refund": "$8,000 × ${PROFILE.marginal_tax_rate_pct}% = ~$2,240 refund at tax time"
    },
    "october_distribution_16k": {
      "summary": "How to split the $16,000 hitting in October — full picture",
      "emergency_fund_amount": 6000,
      "emergency_fund_reasoning": "Build the safety buffer FIRST — 2 months of expenses ($3,060/mo × ~2 = $6K). Park in CASH.TO inside TFSA at ~4.5% yield. Listener still has time to top this up to 3 months before closing.",
      "tfsa_amount": 6000,
      "tfsa_reasoning": "Top up TFSA toward 2026 limit. Combined with $1K from May ($1K equity) + $6K emergency in CASH.TO = $13K of $13K room used cleanly.",
      "rrsp_amount": 4000,
      "rrsp_reasoning": "Shelter the commission income. RRSP deduction at ${PROFILE.marginal_tax_rate_pct}% marginal rate triggers a tax refund — deploy the refund as additional FHSA contribution next year.",
      "estimated_tax_refund": "$4,000 RRSP × ${PROFILE.marginal_tax_rate_pct}% = ~$1,120 refund"
    },
    "core_picks": [
      {
        "ticker": "XEQT.TO",
        "stance": "Buy & hold (CORE)",
        "allocation_pct_of_invested": 60,
        "reasoning": "Globally diversified all-equity ETF — best one-fund solution. 99% of single-stock risk eliminated.",
        "buy_zone_cad": "Anytime under $30 — DCA over 4 months",
        "hold_until": "${PROFILE.closing_target} closing",
        "sell_trigger": "Trim to 30% if BoC raises 50bps in a single decision"
      },
      {
        "ticker": "VFV.TO",
        "stance": "Buy & hold (CORE)",
        "allocation_pct_of_invested": 15,
        "reasoning": "S&P 500 exposure in CAD. Adds US-tech growth.",
        "buy_zone_cad": "Below $130",
        "hold_until": "${PROFILE.closing_target} closing",
        "sell_trigger": "If S&P 500 -15% peak-to-trough → trim to 5%"
      }
    ],
    "satellite_risk_picks": [
      {
        "ticker": "SHOP.TO or BN.TO",
        "stance": "Swing-trade (SATELLITE)",
        "allocation_pct_of_invested": 15,
        "reasoning": "Higher-conviction Canadian growth name. Take a small position, set a target sell price 15-25% above buy. This is the 'make money fast' slice.",
        "buy_zone_cad": "Define on the dip — wait for a 5-8% pullback from 20-day high",
        "hold_until": "Take profit at +20% or earnings beat — whichever first",
        "sell_trigger": "Hard stop at -10% from entry, OR sell half at +15%, let rest ride"
      },
      {
        "ticker": "Earnings-catalyst pick (rotate quarterly)",
        "stance": "Tactical buy 1-2 weeks before earnings (SATELLITE)",
        "allocation_pct_of_invested": 10,
        "reasoning": "Identify a Canadian name with strong recent guidance heading into a quarterly print. Hold through earnings, sell the next day regardless of result.",
        "buy_zone_cad": "1-2 weeks before earnings on a quiet trading day",
        "hold_until": "Day after earnings",
        "sell_trigger": "Sell at open the day after earnings — booked"
      }
    ],
    "tax_strategy": {
      "filing_year": "2026 (file by Apr 30, 2027 — right at closing)",
      "expected_refund_rough": "~$3,360 if you fully use FHSA ($8K) + RRSP ($4K) this year. That refund becomes extra closing money.",
      "tip_1": "Real-estate commissions are self-employment income — track car / brokerage / MLS / phone expenses for the T2125 deduction.",
      "tip_2": "FHSA contributions made Jan-Feb 2027 still count for 2026 tax year (60-day rule).",
      "tip_3": "Once commissions cross $50K/year, talk to an accountant about a Personal Real Estate Corporation (PREC) for income deferral."
    },
    "wealth_wisdom_today": {
      "figure": "Pick ONE wealth-builder from history. Rotate daily. Examples: Cosimo de' Medici (15th c. banker who funded the Renaissance), Jakob Fugger (16th c. richest man), Hetty Green (19th c. 'Witch of Wall Street', frugal contrarian), Andrew Carnegie, John D. Rockefeller, Warren Buffett, Charlie Munger, John Bogle, Li Ka-shing, Naval Ravikant, Ray Dalio.",
      "principle": "ONE crisp principle — e.g., 'Be greedy when others are fearful' (Buffett). 'The first rule is don't lose money' (Buffett). 'Spend less than you earn, invest the difference, do that for forty years' (Bogle). 'Compound interest is the eighth wonder of the world' (attributed Einstein/Rothschild).",
      "how_it_applies_today": "Connect the principle to today's specific decision. e.g., If snapshot shows BoC cut + market dip → 'Hetty Green bought after panic in 1907 — today's pullback is the kind of moment she'd use.'"
    },
    "next_steps": [
      "1. This week: Open Wealthsimple Trade. Apply for FHSA + TFSA + RRSP all at once (KYC = 1 business day)",
      "2. May 17: When the $9K lands, transfer $8,000 to FHSA, $1,000 to TFSA",
      "3. Same day: place limit-buy orders for XEQT.TO and VFV.TO per the buy zones",
      "4. After confirming the core position, allocate ~15% to a satellite swing pick (SHOP.TO or BN.TO)",
      "5. Oct 17: When the $14K lands, $5K → CASH.TO emergency fund, $5K → TFSA, $4K → RRSP"
    ]
  }
}

Rules:
- Use [NEEDS REVIEW] for unknown data. NEVER guess prices, closes, or rates.
- Cite Canadian sources only (BoC, StatsCan, CMHC, NLREA, CREA, Ratehub). NO US politics. NO tech-bro hype.
- The personal_plan should re-state the SAME plan every day until the listener confirms accounts are opened — repetition is FINE for a habit-forming brief. Update sell_trigger evaluations daily based on the snapshot data (e.g., if BoC actually raised 50bps, the sell signal IS triggered).
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
1. EXACTLY 20 turns (no fewer than 18, no more than 22). Strictly alternating A, B, A, B, A, B...
2. EVERY TURN must be 55-85 words. NO short turns. NO one-sentence replies. If a turn is under 50 words, the whole episode is a failure.
3. TOTAL word count across all turns: 1300-1500 words. Target 1400. At ~150 words/min spoken, that's a 9-10 minute episode (HARD CAP — do NOT exceed 10 minutes).
4. Before submitting, count your words. If under 1300, add detail. If over 1500, trim. Aim for the target.

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

═══ EPISODE STRUCTURE (10 min max — listener-specific plan is the heart) ═══
1. Open (Avery, 1 turn): date, headline of the day, preview the plan.
2. Snapshot (2 turns): BoC rate, CPI in plain language. Sam asks the "what does that mean?" question.
3. Mortgage rates (2 turns): fixed vs variable + dollar example on a $400K mortgage.
4. Three stories (4-5 turns): walk through each — Avery facts, Sam translates.
5. **THE PERSONAL PLAN — heart of the show (8-10 turns):**
   - **Monthly cash flow FIRST** (1-2 turns): Avery — "Before we talk lump sums, the foundation is the monthly paycheque. The listener earns about four thousand two hundred a month gross from their day job. Fixed costs — car, rent, insurance, brokerage fees — eat about three thousand sixty. That leaves eleven hundred and forty a month of free cash to invest, growing to about two thousand forty after July when their sister moves out. So between May and December, that's roughly thirteen thousand five hundred and sixty in regular monthly savings — independent of any commission. The play is automatic transfers on payday: nine hundred a month into the FHSA, two hundred forty into the TFSA, until July. Then it bumps to fifteen hundred FHSA, five forty TFSA. That alone fills the FHSA almost entirely by year-end before we even count commissions."
   - **Emergency fund SECOND**: Avery — "Three months of expenses safely parked. Roughly nine thousand in cash that should never be in stocks. Build it from October's sixteen thousand, not May's nine thousand — FHSA room expires December 31."
   - **Platform choice**: Sam — "Wait, where do I even open this stuff?" Avery walks through the options: Wealthsimple Trade (simplest, free), Questrade (more features), Interactive Brokers (cheapest for active traders), Webull. Avery's pick: "Wealthsimple Trade for simplicity. Free FHSA, TFSA, RRSP, fast Canadian onboarding. Add Questrade later if you want a GIC marketplace."
   - **The May nine-thousand split**: Eight thousand to FHSA (max it), one thousand to TFSA. At twenty-eight percent marginal tax, that FHSA earns about a twenty-two-hundred-dollar refund.
   - **The October fourteen-thousand split**: Five thousand to emergency fund (CASH-dot-T-O at four-and-a-half percent yield inside TFSA). Five thousand more to TFSA. Four thousand to RRSP for another tax-shelter hit.
   - **Core picks** (60% XEQT, 15% VFV) — Avery explains each with a definition and an example.
   - **Satellite risk picks** — "And the slice for taking risk: about fifteen percent in a Canadian growth name like SHOP-dot-T-O (Shopify) or BN-dot-T-O (Brookfield). Buy the dip, set a target sell at plus twenty percent. Hard stop at minus ten. The point of this slice is to make money fast and book it."
   - **Sell triggers**: BoC raises 50bps in a single decision → trim XEQT. S&P drops 15% → trim VFV. Satellite hits +20% → take profits.
6. **Wealth wisdom of the day** (1-2 turns): Avery quotes ONE figure from history (Buffett, Bogle, Hetty Green, Cosimo de' Medici, Li Ka-shing, etc.) with their core principle, and Sam connects it to today's plan. Rotate daily — never the same person back-to-back.
7. Watch list (1 turn): 2 dates coming up.
8. Close (Sam, 1 turn): EXACTLY — "That's the page for today. Stay steady. We'll do this again tomorrow."

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

    // ── 1. Fetch live data: BoC rate + Tavily news in parallel ─────────────
    const tavilyKey = Deno.env.get('TAVILY_API_KEY');

    const fetchBoc = async (): Promise<string> => {
      try {
        const r = await fetch('https://www.bankofcanada.ca/valet/observations/V39079/json?recent=1', { signal: AbortSignal.timeout(5000) });
        const j = await r.json();
        const obs = j.observations?.[0];
        if (obs?.V39079?.v) return `${obs.V39079.v}% (as of ${obs.d})`;
      } catch (e: any) { console.warn('[briefing] BoC fetch failed:', e?.message); }
      return '[NEEDS REVIEW]';
    };

    const tavilySearch = async (query: string, days = 2): Promise<{ answer: string; sources: Array<{title: string; url: string; snippet: string}> }> => {
      if (!tavilyKey) return { answer: '', sources: [] };
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tavilyKey}` },
          body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: true, days, topic: 'news' }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) {
          console.warn(`[briefing] tavily "${query.slice(0, 40)}" status ${r.status}`);
          return { answer: '', sources: [] };
        }
        const d = await r.json();
        return {
          answer: d.answer || '',
          sources: (d.results || []).slice(0, 5).map((res: any) => ({
            title: res.title || '',
            url: res.url || '',
            snippet: (res.content || '').slice(0, 350),
          })),
        };
      } catch (e: any) {
        console.warn(`[briefing] tavily error "${query.slice(0, 40)}":`, e?.message);
        return { answer: '', sources: [] };
      }
    };

    console.log('[briefing] fetching BoC + Tavily live news (parallel)...');
    const newsStart = Date.now();
    const [bocRate, finNews, stJohnsNews, marketNews, mortgageNews] = await Promise.all([
      fetchBoc(),
      tavilySearch('Canadian personal finance news Bank of Canada FHSA TFSA RRSP', 2),
      tavilySearch("St. John's Newfoundland real estate housing news today", 3),
      tavilySearch('XEQT VFV TSX S&P 500 Canadian ETF close today', 1),
      tavilySearch('Canada 5-year fixed variable mortgage rates today', 3),
    ]);
    console.log('[briefing] live data done in', Date.now() - newsStart, 'ms — BoC:', bocRate, '| news bytes:', JSON.stringify({ finNews, stJohnsNews, marketNews, mortgageNews }).length);

    // ── 2. Build prompt with today's data ──────────────────────────────────
    const formatNews = (label: string, n: any) => {
      if (!n.answer && (!n.sources || !n.sources.length)) return `${label}: (no live data)\n`;
      const sourceLines = (n.sources || []).map((s: any) =>
        `  • ${s.title}\n    ${s.url}\n    ${s.snippet}`
      ).join('\n');
      return `${label}:\nSummary: ${n.answer || '(none)'}\nSources:\n${sourceLines}\n`;
    };

    const userPrompt = `Today is ${dateStr} (${PROFILE.timezone}).

═══ LIVE DATA — fetched ${new Date().toISOString()} ═══

Bank of Canada overnight rate: ${bocRate}

${formatNews('CANADIAN FINANCE NEWS (last 2 days)', finNews)}
${formatNews("ST. JOHN'S NEWFOUNDLAND NEWS (last 3 days)", stJohnsNews)}
${formatNews('CANADIAN MARKETS — XEQT, VFV, TSX, S&P 500 (last 1 day)', marketNews)}
${formatNews('CANADIAN MORTGAGE RATES (last 3 days)', mortgageNews)}

═══ INSTRUCTIONS ═══
1. USE THE LIVE FACTS ABOVE for the snapshot, mortgage_rates, and stories sections. Quote real numbers from the source snippets where available.
2. Cite the actual Tavily source URLs in the "sources" field — replace generic links with the real URLs returned above.
3. For at least ONE of the three stories, use a St. John's / Newfoundland local angle if the news above contains anything relevant.
4. ONLY use [NEEDS REVIEW] if neither the live data nor your knowledge has the figure.
5. NEVER repeat advice that's already been delivered — focus today on what's NEW (new BoC commentary, new stock moves, new dates announced).

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
        max_tokens: 5000,        // bumped — personal_plan schema is large (platforms + picks + wisdom + ...)
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: STRUCTURED_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(75000),  // 75s — was 50s, larger schema needs more time
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
      signal: AbortSignal.timeout(110000),  // 110s — gpt-4o producing 1500-word podcast can take 60-90s
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

    // Concatenate MP3 byte arrays into one continuous file.
    // CRITICAL: each TTS segment ships with its own ID3v2 tag at the start.
    // If we naive-concat, multiple ID3 tags appear mid-file and decoders
    // (Chrome/iOS) refuse to determine duration → play button does nothing.
    // Fix: keep the first segment's ID3 tag (so the file has valid metadata),
    // strip ID3 from segments 2+, and concat the audio frames cleanly.
    const stripId3 = (b: Uint8Array): Uint8Array => {
      if (b.length < 10) return b;
      // ID3v2 magic: bytes [0,1,2] == "ID3" (0x49, 0x44, 0x33)
      if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
        // Synchsafe size: each byte uses only 7 bits
        const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
        return b.subarray(10 + size);
      }
      return b;
    };

    const cleanedBuffers = ttsBuffers.map((buf, i) => {
      const arr = new Uint8Array(buf);
      return i === 0 ? arr : stripId3(arr);
    });
    const totalLen = cleanedBuffers.reduce((s, b) => s + b.byteLength, 0);
    const mp3Bytes = new Uint8Array(totalLen);
    let off = 0;
    for (const buf of cleanedBuffers) {
      mp3Bytes.set(buf, off);
      off += buf.byteLength;
    }
    console.log('[briefing] stitched mp3 bytes:', mp3Bytes.length, '(after ID3 strip)');

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
          personal_plan: brief.personal_plan || null,
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
  return renderEmailShell(brief, dateStr, niceDate, mp3Url);
}

function renderPersonalPlan(plan: any): string {
  if (!plan || typeof plan !== 'object') return '';
  const monthly   = plan.monthly_savings_deployment || {};
  const may       = plan.this_week_distribution_9k || {};
  const oct       = plan.october_distribution_16k || plan.october_distribution_14k || {};
  const corePicks = Array.isArray(plan.core_picks) ? plan.core_picks : (Array.isArray(plan.stock_picks) ? plan.stock_picks : []);
  const satPicks  = Array.isArray(plan.satellite_risk_picks) ? plan.satellite_risk_picks : [];
  const tax       = plan.tax_strategy || {};
  const ef        = plan.emergency_fund || {};
  const platforms = Array.isArray(plan.trading_platforms) ? plan.trading_platforms : [];
  const platRec   = plan.platform_recommendation || {};
  const wisdom    = plan.wealth_wisdom_today || {};
  const nextSteps = Array.isArray(plan.next_steps) ? plan.next_steps : [];

  const cashRow = (label: string, amount: number, account: string, why: string) => `
    <tr>
      <td style="padding:10px 12px; border-bottom:1px solid #e8eaf2; font-family:-apple-system,Helvetica,sans-serif; font-size:14px; color:#1a1d2e;"><strong>$${amount.toLocaleString()}</strong></td>
      <td style="padding:10px 12px; border-bottom:1px solid #e8eaf2; font-family:-apple-system,Helvetica,sans-serif; font-size:14px; color:#5b5bd6; font-weight:600;">${esc(account)}</td>
      <td style="padding:10px 12px; border-bottom:1px solid #e8eaf2; font-family:-apple-system,Helvetica,sans-serif; font-size:13px; color:#5b6079;">${esc(why)}</td>
    </tr>`;

  const pickCard = (p: any) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px; border-collapse:collapse; background:#f5efdf; border-radius:6px;">
      <tr>
        <td style="padding:14px 18px; vertical-align:top; font-family:-apple-system,Helvetica,sans-serif;">
          <div style="font-size:11px; letter-spacing:0.12em; color:#8a90a8; text-transform:uppercase;">${esc(p.stance || 'Hold')}</div>
          <div style="font-size:18px; font-weight:600; color:#1a1d2e; margin:4px 0;">${esc(p.ticker || '—')} <span style="font-size:13px; color:#5b6079; font-weight:400;">· ${esc(p.allocation_pct ?? '—')}% allocation</span></div>
          <div style="font-size:13px; line-height:1.5; color:#3d4254; margin-bottom:8px;">${esc(p.reasoning || '')}</div>
          <div style="font-size:12px; color:#5b6079;">
            <strong>Buy zone:</strong> ${esc(p.buy_zone_cad || 'Anytime')}<br>
            <strong>Hold until:</strong> ${esc(p.hold_until || '—')}<br>
            <strong style="color:#c44;">Sell trigger:</strong> ${esc(p.sell_trigger || 'None')}
          </div>
        </td>
      </tr>
    </table>`;

  const platformRow = (p: any) => `
    <tr>
      <td style="padding:10px 12px; border-bottom:1px solid #e8eaf2; font-family:-apple-system,Helvetica,sans-serif; font-size:14px; color:#1a1d2e; font-weight:600; vertical-align:top;">${esc(p.name || '')}</td>
      <td style="padding:10px 12px; border-bottom:1px solid #e8eaf2; font-family:-apple-system,Helvetica,sans-serif; font-size:13px; color:#5b6079; vertical-align:top;">${esc(p.fees || '')}</td>
      <td style="padding:10px 12px; border-bottom:1px solid #e8eaf2; font-family:-apple-system,Helvetica,sans-serif; font-size:13px; color:#5b6079; vertical-align:top;">${esc(p.best_for || '')}</td>
    </tr>`;

  return `
    <!-- Personal plan section -->
    <div style="margin:36px 0 8px;">
      <div style="font-size:12px; letter-spacing:0.14em; color:#8a90a8; text-transform:uppercase; font-family:-apple-system,Helvetica,sans-serif; margin-bottom:6px;">Your plan</div>
      <h3 style="font-size:26px; font-weight:600; margin:0 0 18px; line-height:1.2; color:#1a1d2e;">This week's playbook</h3>
    </div>

    ${ef.target_cad ? `<div style="background:#fef3f2; border-left:4px solid #d04a3c; padding:16px 18px; margin:0 0 22px; font-family:-apple-system,Helvetica,sans-serif; font-size:14px; line-height:1.55; color:#3d4254;">
      <div style="font-size:11px; letter-spacing:0.14em; color:#8a90a8; text-transform:uppercase; margin-bottom:6px;">Safety first — emergency fund</div>
      <div style="font-size:18px; font-weight:600; color:#1a1d2e; margin-bottom:8px;">Target: $${ef.target_cad.toLocaleString()} <span style="font-size:13px; font-weight:400; color:#5b6079;">(${esc(ef.target_months || '')})</span></div>
      <div style="margin-bottom:6px;"><strong>Strategy:</strong> ${esc(ef.strategy || '')}</div>
      <div><strong>Where:</strong> ${esc(ef.where_to_park_it || '')}</div>
    </div>` : ''}

    ${platforms.length ? `<h4 style="font-size:17px; font-weight:600; margin:18px 0 8px; color:#1a1d2e; font-family:-apple-system,Helvetica,sans-serif;">Trading platforms — your options</h4>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px; border-collapse:collapse; border:1px solid #e8eaf2; border-radius:6px;">
      <tr style="background:#f8f7f3;">
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Platform</td>
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Fees</td>
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Best for</td>
      </tr>
      ${platforms.map(platformRow).join('')}
    </table>
    ${platRec.primary ? `<div style="background:#1a1d2e; color:#fefdf9; padding:14px 18px; border-radius:6px; margin:0 0 22px; font-family:-apple-system,Helvetica,sans-serif; font-size:14px; line-height:1.55;">
      <strong style="color:#a8a8ff;">▸ Recommended:</strong> ${esc(platRec.primary)}<br>
      <span style="color:#d4d6e0; font-size:13px;">${esc(platRec.reasoning || '')}</span>${platRec.secondary ? `<br><span style="color:#a8aebf; font-size:12px; font-style:italic;">Secondary: ${esc(platRec.secondary)}</span>` : ''}
    </div>` : ''}` : ''}

    ${monthly.summary ? `<div style="background:#eef5ff; border-left:4px solid #3b6cb5; padding:16px 18px; margin:0 0 22px; font-family:-apple-system,Helvetica,sans-serif; font-size:14px; line-height:1.55; color:#1a1d2e;">
      <div style="font-size:11px; letter-spacing:0.14em; color:#8a90a8; text-transform:uppercase; margin-bottom:8px;">Monthly savings deployment</div>
      <div style="font-size:15px; font-weight:600; margin-bottom:10px;">From your $${PROFILE.monthly_income.toLocaleString()}/mo income − $${PROFILE.monthly_fixed_costs.toLocaleString()}/mo expenses</div>

      <div style="margin-bottom:10px;">
        <div style="font-size:13px; color:#5b6079; margin-bottom:2px;"><strong style="color:#1a1d2e;">May–July:</strong> $${PROFILE.monthly_savings_now}/month available</div>
        <div style="font-size:12px; color:#5b6079; padding-left:12px;">→ ${esc(monthly.may_jun_jul_monthly?.split || `$900 FHSA + $240 TFSA per month`)}</div>
      </div>

      <div style="margin-bottom:10px;">
        <div style="font-size:13px; color:#5b6079; margin-bottom:2px;"><strong style="color:#1a1d2e;">August–December:</strong> $${PROFILE.monthly_savings_after_july}/month available <span style="font-size:11px; font-style:italic;">(sister moves out)</span></div>
        <div style="font-size:12px; color:#5b6079; padding-left:12px;">→ ${esc(monthly.aug_to_dec_monthly?.split || `$1,500 FHSA + $540 TFSA per month`)}</div>
      </div>

      <div style="background:#fff; padding:10px 12px; border-radius:6px; margin-top:10px; font-size:12px; color:#3d4254;">
        <div style="margin-bottom:3px;"><strong>Year-end estimate (monthly only):</strong> ~$${((3 * PROFILE.monthly_savings_now) + (5 * PROFILE.monthly_savings_after_july)).toLocaleString()}</div>
        <div style="margin-bottom:3px;"><strong>+ Commissions:</strong> $25,000 ($9K May + $16K Oct)</div>
        <div><strong style="color:#1a8a4f;">Total deployable by Dec 31, 2026: ~$${((3 * PROFILE.monthly_savings_now) + (5 * PROFILE.monthly_savings_after_july) + 25000).toLocaleString()}</strong></div>
      </div>
    </div>` : ''}

    <h4 style="font-size:17px; font-weight:600; margin:18px 0 8px; color:#1a1d2e; font-family:-apple-system,Helvetica,sans-serif;">$9,000 incoming May 17 — distribution</h4>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px; border-collapse:collapse; border:1px solid #e8eaf2; border-radius:6px;">
      <tr style="background:#f8f7f3;">
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Amount</td>
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Account</td>
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Why</td>
      </tr>
      ${cashRow('FHSA', may.fhsa_amount || 0, 'FHSA', may.fhsa_reasoning || '')}
      ${cashRow('TFSA', may.tfsa_amount || 0, 'TFSA', may.tfsa_reasoning || '')}
    </table>
    <div style="font-size:13px; color:#1a8a4f; font-weight:600; font-family:-apple-system,Helvetica,sans-serif; margin:0 0 22px;">Estimated tax refund: ${esc(may.estimated_tax_refund || '—')}</div>

    <h4 style="font-size:17px; font-weight:600; margin:18px 0 8px; color:#1a1d2e; font-family:-apple-system,Helvetica,sans-serif;">$16,000 incoming October — distribution</h4>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px; border-collapse:collapse; border:1px solid #e8eaf2; border-radius:6px;">
      <tr style="background:#f8f7f3;">
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Amount</td>
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Account</td>
        <td style="padding:8px 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:11px; color:#8a90a8; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; border-bottom:1px solid #e8eaf2;">Why</td>
      </tr>
      ${oct.emergency_fund_amount ? cashRow('EF', oct.emergency_fund_amount || 0, 'Emergency fund', oct.emergency_fund_reasoning || '') : ''}
      ${cashRow('TFSA', oct.tfsa_amount || 0, 'TFSA', oct.tfsa_reasoning || '')}
      ${cashRow('RRSP', oct.rrsp_amount || 0, 'RRSP', oct.rrsp_reasoning || '')}
    </table>
    <div style="font-size:13px; color:#1a8a4f; font-weight:600; font-family:-apple-system,Helvetica,sans-serif; margin:0 0 28px;">Estimated tax refund: ${esc(oct.estimated_tax_refund || '—')}</div>

    ${corePicks.length ? `<h4 style="font-size:17px; font-weight:600; margin:18px 0 8px; color:#1a1d2e; font-family:-apple-system,Helvetica,sans-serif;">Core picks <span style="font-size:13px; font-weight:400; color:#5b6079;">— boring, diversified, hold to closing</span></h4>
    ${corePicks.map(pickCard).join('')}` : ''}

    ${satPicks.length ? `<h4 style="font-size:17px; font-weight:600; margin:24px 0 8px; color:#1a1d2e; font-family:-apple-system,Helvetica,sans-serif;">Satellite — risk-on, swing-trade <span style="font-size:13px; font-weight:400; color:#5b6079;">(15-25% slice)</span></h4>
    <div style="background:#fef3f2; border-left:3px solid #d04a3c; padding:10px 14px; margin:0 0 12px; font-family:-apple-system,Helvetica,sans-serif; font-size:13px; color:#5b6079; line-height:1.55;">
      <strong style="color:#1a1d2e;">⚡ Higher risk:</strong> these can lose money fast. Hard stops are non-negotiable. Take profits when they hit — don't get greedy.
    </div>
    ${satPicks.map(pickCard).join('')}` : ''}

    ${tax.expected_refund_rough ? `<div style="background:#f0f9f4; border-left:4px solid #1a8a4f; padding:14px 18px; margin:22px 0; font-family:-apple-system,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#1a1d2e;">
      <strong>Tax strategy:</strong> ${esc(tax.expected_refund_rough)}<br>
      <span style="font-size:13px; color:#5b6079;">${esc(tax.tip_1 || '')} ${esc(tax.tip_2 || '')} ${esc(tax.tip_3 || '')}</span>
    </div>` : ''}

    ${wisdom.figure ? `<div style="background:#f5efdf; padding:20px 24px; border-radius:8px; margin:24px 0; font-family:Georgia,'Times New Roman',serif;">
      <div style="font-size:11px; letter-spacing:0.16em; color:#8a90a8; text-transform:uppercase; margin-bottom:8px; font-family:-apple-system,Helvetica,sans-serif;">Wealth wisdom · today's voice</div>
      <div style="font-size:18px; font-style:italic; line-height:1.5; color:#1a1d2e; margin-bottom:10px;">"${esc(wisdom.principle || '')}"</div>
      <div style="font-size:13px; color:#5b6079; font-family:-apple-system,Helvetica,sans-serif; margin-bottom:8px;">— ${esc(wisdom.figure)}</div>
      ${wisdom.how_it_applies_today ? `<div style="font-size:13px; color:#3d4254; line-height:1.5; font-family:-apple-system,Helvetica,sans-serif;"><strong>Today:</strong> ${esc(wisdom.how_it_applies_today)}</div>` : ''}
    </div>` : ''}

    ${nextSteps.length ? `<div style="background:#1a1d2e; color:#fefdf9; padding:22px 24px; border-radius:8px; margin:22px 0;">
      <div style="font-size:11px; letter-spacing:0.16em; color:#8a90a8; text-transform:uppercase; margin-bottom:10px; font-family:-apple-system,Helvetica,sans-serif;">Action checklist</div>
      <ol style="margin:0; padding-left:20px; font-family:-apple-system,Helvetica,sans-serif; font-size:14px; line-height:1.8; color:#fefdf9;">
        ${nextSteps.map((s: string) => `<li>${esc(s)}</li>`).join('')}
      </ol>
    </div>` : ''}
  `;
}

function renderEmailShell(brief: any, dateStr: string, niceDate: string, mp3Url: string | null): string {
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

    <!-- Personal plan — cash distribution, stock picks, tax strategy -->
    ${renderPersonalPlan(brief.personal_plan)}

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
