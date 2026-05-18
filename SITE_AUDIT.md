# Maxwell DealFlow — Phase 4 Site Audit

**Prepared for:** Maxwell Delali Midodzi
**Surface audited:** `/site/` marketing pages (post PR #36 honesty pass)
**Audit date:** 2026-05-18
**Auditor's stance:** Hostile reviewer. Would I send a friend here?

---

## TL;DR

The marketing site is **not yet production-ready**, even after PR #36 removed the fake stats. The honesty issue is closed, but several deeper problems remain:

- **The design reads as a template, not a person.** Generic coral-on-white, default sans-serif, no real photography, no proof of being a specific human practicing in a specific place.
- **The voice is corporate-friendly but anonymous.** Every sentence could appear on 10,000 other realtor sites. Nothing roots it in St. John's, in eXp Realty, in Maxwell.
- **There is no "trust hook"** beyond the brokerage logo (which isn't even shown — the brokerage is mentioned in text only).
- **Conversion paths are still over-engineered for the content present.** Two CTA buttons in the hero + two more at the bottom is the right *shape*, but the content sandwiched between them doesn't earn the click.

**Verdict:** keep deployed, do not promote until P0 + P1 items below are addressed. Best estimate: 6–10 hours of focused work to reach "I'd put this on my LinkedIn" quality.

---

## Severity Definitions

- **P0** — Damages credibility, leaks PII, or directly costs conversions. Fix before any link is shared with a real prospective client.
- **P1** — Visible quality gaps that erode trust over time. Fix before paid traffic or social posts point at the site.
- **P2** — Polish items, longer-term consistency, performance and SEO refinements.

---

# P0 Findings

## §P0.1 — No real photography of the agent

**File:** `site/about/index.html` line ~63
**Issue:** The about-page hero shows a gradient "MD" placeholder block where a headshot should be. Same on the landing nav avatar. For a real-estate agent, the "who am I dealing with" question is the most important conversion signal. A faceless gradient communicates either *I'm hiding* or *this is an unfinished template.*
**Fix:**
1. Maxwell takes/uses a professional headshot (or even a clean phone photo against a neutral wall).
2. Upload to `/site/img/maxwell.jpg` (and `/site/img/maxwell-2x.jpg` for retina).
3. Replace the `<div class="about-photo">MD</div>` block with `<img src="/site/img/maxwell.jpg" srcset="/site/img/maxwell.jpg 1x, /site/img/maxwell-2x.jpg 2x" alt="Maxwell Delali Midodzi, REALTOR at eXp Realty in St. John's">`.
4. Optional but valued: an "in the field" shot for the landing hero — Maxwell in front of a house, at a closing table, holding keys. Communicates the actual work.
**Effort:** Photo session = 30 min in person. Code swap = 5 min.
**Blocking?** Yes for any social-media promotion. Without a face, the site reads as a scam template.

## §P0.2 — No proof of identity beyond Maxwell's name

**File:** All `/site/*` pages.
**Issue:** Nothing on the site links to a verifiable second source. No brokerage registration number, no NLAR profile link, no LinkedIn, no Realtor.ca profile, no Google reviews link. A skeptical visitor cannot confirm Maxwell exists outside this one website.
**Fix:** Add a "Verify me" or "Find me elsewhere" footer section linking to:
- Maxwell's eXp Realty agent profile page (e.g. `https://exprealty.com/agent/maxwell-delali-midodzi`)
- Maxwell's NLAR registration number + link to the NLAR registry search
- Maxwell's Realtor.ca agent page
- Maxwell's LinkedIn (if professional)
- A phone number listed on his eXp profile (text-only link, not a tel: that might be wrong)

If Maxwell prefers not to publish a direct phone number on the marketing site, link to the brokerage's main switchboard with his name as a referral instruction.
**Effort:** 30 min to gather links + 10 min to add a "Verify" footer block.
**Blocking?** Yes for any cold-traffic promotion.

## §P0.3 — Lead times in the copy are unverified promises

**File:** `site/index.html` line 77, `site/about/index.html` body copy, both pages' footers.
**Issue:** Multiple pages say "I'll follow up within one business day" and "Response within one business day." If Maxwell can't honor this 100% of the time (vacation, busy weeks, sick days), it's a written promise broken on first contact. Real-estate consumers screenshot this stuff.
**Fix:** Soften to a verifiable phrasing: *"I aim to respond the same business day, and you'll always hear back within 48 business hours."* Or remove the SLA promise entirely and let the form's confirmation page set the expectation per-submission (which Maxwell controls live).
**Effort:** 5 min copy edit.
**Blocking?** Yes — published SLAs that the agent can't sustain are a complaints-board future.

## §P0.4 — Brokerage compliance disclosure is incomplete

**File:** Footers on both pages.
**Issue:** Newfoundland & Labrador (and most Canadian provinces) require real-estate marketing to include the brokerage name, address, and license/registration info. Current footer says "REALTOR® · eXp Realty" but no brokerage office address, no NLAR registration number, no "Brokerage:" label that a regulator would accept.
**Fix:** Audit eXp Realty's brokerage compliance guidance for what they require on agent-marketing sites (every brokerage has a marketing guide). Add the required fields to the footer block. Typical items:
- Brokerage legal name: "eXp Realty Canada, Inc." or similar
- Brokerage NL office address
- Brokerage NLAR registration number
- Agent's NLAR registration number
- "REALTOR® and the REALTOR® logo are controlled by The Canadian Real Estate Association (CREA)" disclaimer
**Effort:** 20 min research + 10 min code.
**Blocking?** Yes — could trigger a complaint to NLAR or eXp's compliance team.

---

# P1 Findings

## §P1.1 — Design is generic and "template-y"

**File:** `site/css/site.css` (entire stylesheet)
**Issue:** Coral accent on white background + system sans-serif + soft shadows is the default of every Webflow real-estate template from 2022. There is no design choice that makes this *Maxwell's* site. Compare to:
- **Compass.com** — restrained editorial typography, large-scale photography, deep navy + sand.
- **Engel & Völkers** — black + cream + crimson, very confident typography hierarchy.
- **Mike McCann (Philly realtor)** — bold red brand identity, dominant headshot, simple navigation.
- **Ryan Serhant** — black + gold, hospitality-grade photography, video hero.

Each of these makes a deliberate aesthetic claim. Maxwell's current site doesn't.
**Fix (proposed design directions for Maxwell to pick):**
1. **"Editorial Newfoundland"** — large serif headlines (Playfair Display or Tiempos Headline), muted slate-and-stone palette with one accent (could keep coral or move to a deeper rust), grain texture in section dividers. Echoes "old-money" realtor aesthetic but rooted in the Avalon.
2. **"Modern Canadian"** — clean geometric sans (Inter or Söhne), warm-white background, single confident dark accent (charcoal or navy), generous whitespace. Echoes Stripe / Linear / contemporary firms.
3. **"Local + warm"** — handwritten signature accent, photo-forward (Maxwell + Newfoundland landscapes), terracotta + sage palette. More personal, less corporate.

Maxwell picks one. Then the redesign PR locks in fonts, palette, photography treatment, and spacing rhythm.
**Effort:** Direction-setting = 1 hour conversation. Implementation = 4–6 hours.

## §P1.2 — Hero headline is generic

**File:** `site/index.html` line 61
**Issue:** "The home you want, on terms that work for you." Could be on any real-estate site in any province. Doesn't say *St. John's*, doesn't say *Maxwell*, doesn't differentiate.
**Fix:** Rewrite to root in place + person. Examples:
- "St. John's real estate, handled with the patience it deserves."
- "Newfoundland is my home. Helping you find yours."
- "From Mount Pearl to Pouch Cove — careful, honest real-estate help."
**Effort:** 15 min copy iteration. Maxwell picks final wording.

## §P1.3 — "Why work with me" cards are generic adjectives

**File:** `site/index.html` lines 156–171
**Issue:** "Local-first / Honest / Modern + responsive" are claimed by every realtor everywhere. Without proof, they don't differentiate.
**Fix:** Replace each adjective with a *specific behaviour* the visitor can verify on first contact:
- Instead of "Local-first" → "I'll name three neighbourhoods that might suit you on our first call — and three that won't."
- Instead of "Honest, even when it's awkward" → "I'll send you the listing's most recent sale-price history before we view it, so you walk in already informed."
- Instead of "Modern + responsive" → "You'll get a private deal-progress link where every milestone, document, and deadline is visible 24/7."
**Effort:** 30 min copy work + 10 min code.

## §P1.4 — About-page narrative is corporate-flat

**File:** `site/about/index.html` body paragraphs.
**Issue:** "I'm Maxwell Delali Midodzi, a REALTOR® serving St. John's…" reads like a bio template. No origin story (why real estate?), no Newfoundland rooting (born here? moved here?), no personality beat (hobby, family, anything that makes Maxwell a person).
**Fix:** A 3-paragraph narrative:
1. Why real estate, why now.
2. What Maxwell does *differently* (e.g. industry background, language(s), specific niche — first-time buyers? new-immigrant buyers? new builds?).
3. One personal note. Family, food, the local team Maxwell follows, the running route. One sentence that humanizes.

Should not feel "personal-brand-ey." Should feel like meeting Maxwell at a coffee shop.
**Effort:** 30–45 min writing session with Maxwell.

## §P1.5 — Specialty cards on About page reuse the landing-page card style

**File:** `site/about/index.html` "What I specialise in" section.
**Issue:** The 4 specialty cards (First-time buyers / New builds / Sellers / Move-up & relocation) are the same visual treatment as the landing-page cards. Duplicate visual rhythm makes the About page feel like a continuation of the landing rather than its own surface.
**Fix:** Use a different layout pattern on the About page — e.g. horizontal numbered list, or a small icon + headline + 1-sentence description without the boxed cards.
**Effort:** 30 min refactor.

## §P1.6 — No social proof anywhere

**Files:** All `/site/*` pages.
**Issue:** Removed the fake "50+ deals" stats in PR #36 (correct call). But the site now has *no* third-party validation. A new visitor sees only Maxwell's own claims about Maxwell.
**Fix:** Layered approach as Maxwell accumulates proof:
1. **Now:** 1–2 testimonial quotes (with consent) on the landing page. Even 1 real review reads as 10× more credible than fake stats.
2. **Soon:** A "Reviews" page reading from the existing `client_reviews` table with a `public_consent` boolean. Adds the consent column via migration, surfaces only consented reviews. (Was queued as `phase3/site-testimonials-with-consent`.)
3. **Eventually:** Realtor.ca and Google Business Profile reviews embedded or linked.
**Effort:** Testimonial page = 90 min once consent flow is in place. Inline first-quote = 15 min once Maxwell has a quote.

## §P1.7 — Mobile typography is functional but unrefined

**File:** `site/css/site.css` lines 222–227 (mobile media query) and `clamp()` usage in hero/section titles.
**Issue:** `clamp(34px, 6vw, 56px)` on the hero h1 works fine but on small phones the headline can wrap awkwardly into 4 lines. No control over line-break point. Lead paragraph is `clamp(17px, 2.2vw, 19px)` — fine, but no `max-width` on mobile so it stretches edge-to-edge in landscape mode.
**Fix:**
- Add `text-wrap: balance;` to h1 (one-line CSS, supported in all modern browsers).
- Add `max-width: 32ch;` to mobile hero h1 to encourage 2-line breaks.
- Add `padding: 0 16px;` to `.wrap` instead of `0 20px` on mobile so the content has tighter margins on small phones.
**Effort:** 15 min CSS pass.

## §P1.8 — No favicon variation; using a CRM PWA icon

**File:** `site/*/index.html` `<link rel="icon">` references.
**Issue:** Both pages point at `/icons/icon-192.png` which is the *agent CRM*'s PWA icon. The browser tab on the marketing site shows the same icon as Maxwell's internal tool. Visually muddles the two surfaces.
**Fix:** Create a separate marketing-site favicon — could be a wordmark "MM" in coral, or a small house glyph in the brand color. Drop as `/site/img/favicon.svg` and `/site/img/favicon-180.png` (for Apple touch icon).
**Effort:** 30 min in a vector tool + 5 min code.

---

# P2 Findings

## §P2.1 — Over-rounded card corners

**File:** `site/css/site.css` line 20 (`--r-md: 12px;`), line 21 (`--r-lg: 20px;`)
**Issue:** 12px and 20px corner radii give the site a "consumer app" feel rather than a "professional service" feel. Compare to Compass (sharp corners), Engel & Völkers (sharp), Stripe (4–8px max).
**Fix:** Reduce `--r-md` to 6px and `--r-lg` to 10px. Or go fully square corners (`0`) for a more editorial feel. This is a design-direction choice.

## §P2.2 — Footer "Independently owned and operated" boilerplate

**File:** `site/index.html` line 213, `site/about/index.html` line ~215.
**Issue:** Real estate boilerplate. Not wrong, but consumes line-real-estate without adding value. Most prospects don't know what it means.
**Fix:** Drop the line; the brokerage name + agent name already implies it. If compliance requires it (P0.4 audit), put it in a smaller compliance row separated from the warm footer copy.

## §P2.3 — Schema.org markup is correct but minimal

**File:** `site/index.html` lines 22–32, `site/about/index.html` lines 24–35.
**Issue:** The JSON-LD identifies Maxwell as a `RealEstateAgent` and `Person` but lacks:
- `image` (the headshot URL once it exists)
- `telephone` (if Maxwell publishes one)
- `address` (brokerage office address)
- `sameAs` array (links to Maxwell's other professional profiles)
- `priceRange` (Maxwell could indicate price range served)
**Fix:** Once P0.1 + P0.2 are resolved (photo + verifiable profiles), expand the JSON-LD with `image`, `sameAs: [exp profile, nlar, linkedin]`, `telephone`, `address`. Helps Google's Knowledge Panel show Maxwell as a real entity.

## §P2.4 — No 404 page at /site/

**File:** Missing `/site/404.html`.
**Issue:** Visiting a typo URL under `/site/` (e.g. `/site/about/maxwell` instead of `/site/about/`) returns the default Vercel 404. Out-of-brand experience.
**Fix:** Add a `/site/404.html` with the same nav + a "We didn't find that page" message + a link back to `/site/`. Vercel will serve it automatically for any `/site/*` not-found.

## §P2.5 — No analytics

**File:** None.
**Issue:** Maxwell can't tell which pages convert. Did the landing page send anyone to the buyer intake last month? Unknown.
**Fix:** Add Plausible Analytics (privacy-respecting, $9/month, GDPR-compliant) or Fathom. Single 1-line `<script>` in each page's `<head>`. Captures page views, referrers, conversion events (intake form submits). Maxwell sees a dashboard showing real visitor flow.
**Effort:** 30 min including sign-up.

## §P2.6 — Open Graph image is the CRM PWA icon

**File:** Both pages' `<meta property="og:image">` references.
**Issue:** Same problem as P1.8 — share previews on iMessage/Facebook/LinkedIn show the CRM's home-screen icon, not a marketing image.
**Fix:** Generate two proper Open Graph images at 1200×630:
- Landing: large headline text + Maxwell's headshot + brand color.
- About: Maxwell's headshot prominent with name + role overlay.
Drop as `/site/img/og-landing.jpg` and `/site/img/og-about.jpg`. Reference in respective `og:image` tags.
**Effort:** 45 min in Figma/Canva (template + 2 variants).

## §P2.7 — Pipeline filter UX bug (from Maxwell's 2026-05-18 feedback)

**File:** `js/offers.js` Pipeline render block (PR #28).
**Issue:** Maxwell reported clicking the "🏗️ New Build" chip causes a visible rearrange of the deals list. Without a screenshot, the most likely cause is one of:
- The filter narrows to zero new-build deals; the layout shifts because Active / Closed / Fell Through sections all empty out simultaneously, leaving only the chip row + a single "No deals match this filter" message — feels visually jarring.
- The sticky filter bar's intrinsic height changes when the third row's chip selection state updates (`.cl-chip-count` width on accent-pressed state may differ from non-pressed state), nudging the layout.
- A z-index or transform interaction between `.pl-filter-bar` and the deal cards underneath.
**Fix:** Requires repro. Maxwell needs to screenshot the before/after of clicking the chip with new-build = 0. Once we see what's actually shifting, fix is likely either a min-height on the deal list container or a stable chip-count cell width.
**Effort:** 15 min once we have the screenshot.

## §P2.8 — Accessibility — pill-style nav links could be more obvious

**File:** `site/css/site.css` lines 75–80 (`.nav-links`).
**Issue:** The two nav links (About / Contact) are styled as plain text. On hover they get a coral color change but no underline. Visually they read as decoration, not navigation, for some visitors.
**Fix:** Either a subtle underline on hover, or a slightly stronger weight/size, or pill-button styling consistent with the chips used in PR #26.

---

# Strategic Recommendations

## R1 — Treat the marketing site as a 12-month build, not a launch
Maxwell is 2 years into the industry. The site should grow with him. Don't ship "complete" — ship a v1 with the foundations, then layer:
- Month 1: Real photo, real bio, real verifiable identity links (P0.1, P0.2, P0.4).
- Month 2: Redesign for a confident professional aesthetic (P1.1, P1.7).
- Month 3: First testimonial (P1.6).
- Month 4–6: As deals close, anonymized "case study" posts (a single closing told as a story, not a stat).
- Month 6+: Reviews page reading from the existing `client_reviews` table.

## R2 — Until P0 items are closed, keep the site unindexed
Robots.txt already excludes the CRM. Consider also adding `<meta name="robots" content="noindex, nofollow">` temporarily to `/site/*` until the photo + verifiable identity + brokerage compliance are in place. Better to launch slow than to be the top Google result for "Maxwell Midodzi" with a half-finished site.

## R3 — One "anchor" piece of content, not a network
Instead of building 5 marketing pages (landing / about / sold / blog / listings), build 1 *great* landing page with everything a prospect needs:
- Maxwell's photo + 60-second video intro.
- 2 testimonials.
- The two intake CTAs.
- An "About Maxwell" expandable section *on the same page* (no separate `/about/` URL).
- A "How it works" 3-step strip.
- A footer with verifiable identity.

One excellent page outperforms five mediocre ones. Worth considering a v2 architectural simplification.

---

# What Is Solid

To be fair to the work shipped today:

✅ **Site architecture is clean.** Shared CSS, sensible directory structure, sitemap + robots correct.
✅ **SEO foundation is solid.** Canonical tags, JSON-LD, meta descriptions, OG cards — all in place even if values need polishing.
✅ **Accessibility baseline is honest.** Labels associated, focus rings, ARIA where appropriate, reduced-motion respected, semantic HTML.
✅ **Mobile-first responsive grid.** No horizontal scroll, sensible breakpoint at 720px.
✅ **Post-PR-#36 honesty.** No fake stats, no fabricated deals, intake-form CTAs trimmed to a reasonable density.
✅ **Performance.** Single CSS file, no JS framework, no waterfall fetches. LCP target should be < 1s on a fast connection.
✅ **No third-party trackers.** No GA, no Facebook Pixel, no anything. Privacy-by-default until P2.5 adds Plausible (which is privacy-respecting).

The bones are right. The flesh needs work.

---

# Recommended PR Sequence

1. **`phase4/site-noindex-temporary`** (10 min) — Add `<meta robots noindex>` to all `/site/*` pages until P0 items close. Highest-leverage protective move.
2. **`phase4/site-brokerage-compliance`** (45 min) — Audit eXp Realty's marketing guide, gather the required disclosure fields, add them to footers. Closes P0.4.
3. **`phase4/site-verifiable-identity`** (30 min once links collected) — Add the "Verify me" footer block with NLAR, eXp profile, Realtor.ca, LinkedIn links. Closes P0.2.
4. **Photo session (offline)** — Maxwell takes a headshot. 30 min in person.
5. **`phase4/site-real-photo`** (15 min after photo arrives) — Swap the `<div class="about-photo">` for real `<img>`. Closes P0.1.
6. **`phase4/site-sla-soften`** (10 min) — Replace "within one business day" with verifiable language. Closes P0.3.
7. **`phase4/site-pipeline-bug-fix`** (15 min after screenshot) — Investigate and patch the chip rearrange. Closes P2.7.
8. **`phase4/site-redesign-direction`** (1 hr conversation, no code) — Maxwell picks one of the three proposed aesthetic directions in P1.1.
9. **`phase4/site-redesign-v2`** (6 hours, multi-PR) — Implement the chosen direction. Replaces P1.1 + P1.2 + P1.3 + P1.4 + P1.5 + P1.7 + P1.8 + P2.1 + P2.2 + P2.6 — most of the visible polish work in one coordinated push.
10. **`phase4/site-analytics`** (30 min) — Add Plausible. Closes P2.5.
11. **`phase4/site-404`** (15 min) — Add `/site/404.html`. Closes P2.4.
12. **`phase3/site-testimonials-with-consent`** (90 min, was already queued) — Once Maxwell has 1+ consented reviews. Closes P1.6.

**Total estimated time to "I'd send this to my mother":** ~10 hours of focused work, spread across Maxwell's photo session + one weekend afternoon of redesign + Maxwell-side content writing.

---

*End of audit. — 2026-05-18*
