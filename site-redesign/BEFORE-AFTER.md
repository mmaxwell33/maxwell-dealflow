# Maxwell's Website — Before / After

**Built by the Closia board session, 2026-07-13.** This folder is a *proposal* — nothing here is live. Your real site at `/site/` is untouched.

## How to look at it

The redesign reuses your existing stylesheet, so it renders exactly like your real site will.

- **On your computer:** open `site-redesign/index.html` (homepage) and `site-redesign/start/index.html` (the Instagram landing page).
- **On your phone (the important one — 95% of your Instagram traffic is mobile):** this needs to be on a URL, not a folder. Ask me to deploy it to a Vercel *preview link* and you can open it on your phone before anything goes to the real site.

Two files:
- `index.html` — the rebuilt **homepage**
- `start/index.html` — a brand-new **`/start` page** built just for your Instagram link

---

## The one-line summary

Your current site copied the *look* of a big brokerage team's website (Nevin Hollett's). But his site is rented software built for a whole team — live MLS search, client logins, a chat team. Yours copied the shell without the engine, so it ended up with **a search bar that doesn't search, a map with fake pins, six fake "Example" listings, and — worst of all — a menu that completely disappears on phones.** The fix isn't to build more. It's to **remove the fake parts and lead with what's genuinely yours.**

---

## What changed, side by side

| | BEFORE (your live site) | AFTER (this redesign) |
|---|---|---|
| **Mobile menu** | ❌ Vanishes entirely on phones — no way to navigate | ✅ Working hamburger menu, all links + a "Book a call" button |
| **Hero** | Hotlinked video that phones often won't play + a 6-field "search" bar | One instant-loading background, one headline, **one** clear button: *Book a free 15-minute call* |
| **"Search" bar** | Looks like MLS search — but just emails you (admits it in fine print) | ❌ Removed — it over-promised |
| **The map** | Heavy 3D map with six **fake** "Example" pins | ❌ Removed from homepage (kept in your code — can return as its own lazy-loaded page later) |
| **"Recent Work"** | Six **fake** listings with made-up prices | ❌ Removed — empty-but-honest beats full-but-fake |
| **Photo of you** | None on the homepage | ✅ "Meet Maxwell" section right under the hero (add a real headshot) |
| **Social proof** | None | ✅ Honest credibility strip (REALTOR® · eXp · the Avalon · responds in 48h) — swap in real testimonials as you get them |
| **Photo grids** | Four near-identical stock-photo grids | Merged — one clean "Free guides" section instead |
| **Number of sections** | 14 heavy blocks | 9 focused blocks |
| **Your best assets** | Buried near the bottom | **Moved up:** honest voice, free NL guides, your client deal-portal |
| **Call-to-action** | 5 competing ones (buy/sell/search/coffee/email) | **One:** book a free 15-minute call |
| **Instagram destination** | The busy homepage | A dedicated **/start** page — one screen, one decision |
| **Compliance footer** | Missing | ✅ Added: CREA trademark line, brokerage address, "Brokered by eXp," "opinions my own," general disclaimer |
| **External things that can break** | Video + map + 46 hotlinked photos on the money page | Zero on the hero — it loads instantly and never goes blank |
| **"Agent Login" to your CRM** | Linked publicly on every page | ❌ Removed from public pages |

**What was kept** (your genuinely good work): the whole design system (colours, type), your honest plain-English voice, the FAQ + its Google rich-results schema, the free buyer/seller checklists, the deal-portal promise, and the About/Process pages.

---

## Before this can go LIVE — the board's launch gate (P0)

The redesign is safe to *look at* now. But **do not point Instagram at it** until these are done — they're about your licence and the law, not design:

1. **Confirm three things are literally true today** (they're claimed on your About page): that you are currently **licensed/registered** in NL, a current **CREA/NLAR member**, and **E&O insured**. Publishing these if any isn't true yet is false advertising. Only you can confirm this.
2. **Add an unsubscribe line** to your automated *marketing* emails (welcome + listing alerts). Your emails already carry your mailing address (good) — but there's no unsubscribe, which CASL requires the moment you email people who found you through Instagram. (Your normal deal/viewing emails are fine as-is — this is only for promotional blasts.)

## Should-fix soon (P1)
3. Confirm your exact eXp brokerage office address in the footer (I used 33 Pippy Place from your email templates — verify it).
4. Add a real headshot (a good phone photo in daylight beats a stock image).
5. Drop a St. John's photo at `site/img/hero.jpg` if you want a photo hero instead of the navy gradient.

---

## The domain question (how to make it genuine + own it)

- **Buy a `.ca` domain** (e.g. `maxwellmidodzi.ca`) at **Porkbun** — about **$8–9/year**. A `.ca` signals a real local Newfoundland agent.
- **Register it in YOUR name, in your own account** — that's what "deeded to you" means. Turn on **auto-renew + registrar lock + WHOIS privacy** so you never lose it and your home address stays private.
- **Don't** put "realtor" or "mls" in the domain name — CREA doesn't allow it.
- **Connect it to your existing site** in Vercel (Settings → Domains → Add) — free SSL, live within an hour. The domain must point to `/site`, not your CRM.
- Total: **~$8–9/year** (your hosting stays free). Optional pro email `maxwell@yourdomain.ca` free via Zoho, or just use your eXp email.

The domain is the **last** step, not the first — never gate the site launch on it.
