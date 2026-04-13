# Maxwell DealFlow CRM — Complete System Guide
### How It Works, How Intelligent It Is, and How to Position It
**Built for:** Maxwell Delali Midodzi, REALTOR® | eXp Realty
**Version:** 2026 | Fully deployed at Vercel + Supabase

---

## PART 1 — WHAT THIS SYSTEM IS

Maxwell DealFlow is a **custom-built, AI-powered real estate CRM** designed from the ground up for one agent: you. It is not a modified template, not a white-label product, and not a generic tool. Every screen, automation, and notification was built specifically around how you work — from the moment a client books a viewing, all the way through to closing day and the post-close referral email that goes out 7 days later.

The system runs as a **Progressive Web App (PWA)** — meaning it installs on your phone and computer like a native app, works offline, sends real background push notifications to your phone, and loads instantly. No App Store. No download. Just a URL.

---

## PART 2 — THE TECHNOLOGY STACK (Every Tool and Why)

### Frontend
| Tool | What it is | Why we used it |
|------|-----------|----------------|
| **Vanilla JavaScript** | Plain JS, no framework | Fast load, zero dependencies, works on any device |
| **CSS custom properties** | Theme variables | Powers the dark/light auto mode with one toggle |
| **PWA / Service Worker** | Makes the app installable | Push notifications, offline support, home screen icon |
| **Web Push API (VAPID)** | Native push protocol | Sends real notifications to your phone even when the app is closed |

### Backend
| Tool | What it is | Why we used it |
|------|-----------|----------------|
| **Supabase** | PostgreSQL database + auth + edge functions | Your entire data layer — clients, deals, emails, everything lives here |
| **Supabase Auth** | JWT-based login | Secure agent login, row-level security on all data |
| **Supabase Edge Functions** | Deno serverless functions | Run server-side logic (send emails, push notifications, daily jobs) without a backend server |
| **pg_cron** | Scheduled jobs inside Postgres | Runs daily automation at 7AM and 8AM every day automatically |
| **Vercel** | Hosting + CDN | Deploys the app globally in seconds every time you push to GitHub |
| **GitHub** | Version control | Stores every change ever made to the app; auto-triggers Vercel deploy on push |

### AI & Communication
| Tool | What it is | Why we used it |
|------|-----------|----------------|
| **Claude API (Anthropic)** | Large language model | Powers the AI assistant built into your CRM — answers real estate questions, drafts emails |
| **Gmail API (OAuth2)** | Email sending + reading | Sends all your client emails through your own Gmail account, and syncs inbox replies back in |
| **VAPID / RFC 8291** | Web push encryption standard | End-to-end encrypted push notifications — Apple and Google push servers require this |

### Why no monthly SaaS fee?
Every tool above has a **free or near-free tier** that covers a solo agent's usage:
- Supabase free tier: 500MB database, 500K edge function calls/month
- Vercel free tier: unlimited personal deployments
- Gmail API: free for personal use
- Claude API: pay-per-use (cents per request)

A comparable commercial CRM would cost **$70–$500/month**. This system costs you essentially **$0/month**.

---

## PART 3 — THE INTELLIGENCE LAYER (What Makes It Smart)

This is not a dumb form-and-list app. There are **5 layers of intelligence** built in.

### Layer 1 — Claude AI Assistant (On-Demand Intelligence)
Every screen has access to the AI assistant via the FAB menu. You can ask it:
- "Draft a follow-up email for Abraham Ayuba after his inspection"
- "What should I say to a buyer who's nervous about the financing condition?"
- "Summarise the market at 615 Topsail Road"

It knows the context of your CRM and responds like a real estate expert. It runs through a Supabase Edge Function so your Claude API key is never exposed to the browser.

### Layer 2 — Daily Automation (8AM Every Day — Automatic)
Every morning at 8AM UTC, a serverless function scans every active pipeline deal and:

1. **3 days before financing deadline** → queues a reminder email to the client
2. **1 day before financing deadline** → queues a urgent reminder
3. **3 days before inspection** → queues inspection prep email
4. **1 day before inspection** → queues final reminder
5. **1 day before walkthrough** → queues walkthrough reminder
6. **On closing day** → queues a "Happy Closing Day!" email
7. **7 days after closing** → queues a referral request email
8. **Deals stuck > 30 days** → logs a stale deal alert
9. **Viewings with no feedback** → queues a viewing feedback request

None of this requires you to do anything. It runs automatically, every day.

### Layer 3 — Morning Briefing (7AM Every Day — In Your Inbox)
Every morning at 7AM, before you start work, you receive a summary email covering:
- Today's viewings (who, where, what time)
- Pending approvals waiting for your review
- New client intake forms submitted overnight
- Active pipeline deals and their current stage
- All deadlines coming up this week
- Any deals that have stalled without movement

You wake up knowing exactly what the day holds.

### Layer 4 — Smart Approval Queue (Human-in-the-Loop AI)
No email ever goes out to a client without your approval first. The system queues every automated email for your review. You see the subject, the body, the recipient — you tap Approve or Reject. This keeps you in control while automation handles the drafting and timing.

### Layer 5 — Web Push Notifications (Real-Time Alerts on Your Phone)
When something needs your attention — a new intake form, a pending approval, a deal update — your phone gets a real background push notification, even if the app is closed. This uses the full VAPID/RFC 8291 encryption stack, the same protocol used by professional notification services.

---

## PART 4 — FULL FEATURE LIST (Every Screen and What It Does)

### Core Workflow
| Screen | Purpose |
|--------|---------|
| **Overview / Dashboard** | Live stats: viewings booked, deals in pipeline, closed deals. Activity feed showing every recent action. |
| **Clients** | Full client database. Add, search, view history. Privacy masking on names/emails/phones by default. |
| **Viewings** | Schedule and track property viewings. Auto-sends feedback request to buyer after the showing. |
| **Offers** | Submit and track offers on properties. Status tracking per offer. |
| **Pending Offers** | Dedicated queue for offers awaiting acceptance. |
| **Pipeline** | Deal management from Accepted → Conditions → Closing → Closed. Milestone dates (financing, inspection, walkthrough, closing), progress bar, IN PROGRESS / CLOSED / FELL THROUGH badges. |
| **Approvals** | Email approval queue. Every automated email stops here for your tap before sending. |

### Communication
| Screen | Purpose |
|--------|---------|
| **Email Compose** | Write and send emails to clients through your Gmail. |
| **Inbox** | Syncs client reply emails from Gmail back into the CRM. |
| **Broadcast Email** | Send a single email to a filtered segment of clients at once. |
| **Client Portal** | Shareable read-only link (no login needed) showing a client their deal progress, milestone dates, and next steps. |
| **Client Intake Form** | Public form clients fill out to submit their details. Auto-creates a client record and queues a welcome email. |
| **Viewing Feedback** | Dedicated respond page where buyers rate a property after a showing. Very Interested automatically triggers a follow-up sequence. |

### Business Intelligence
| Screen | Purpose |
|--------|---------|
| **Analytics** | Charts and metrics on your business performance over time. |
| **Reports** | Generate and send formatted client reports. |
| **Commissions** | Record every deal's commission. Calculates gross, brokerage split, HST, and net. Running total and YTD earnings. |
| **Calendar** | Month and list view of every milestone date across all active deals — financing, inspection, walkthrough, closing, viewings. |
| **Tracker** | Property tracker for monitoring specific listings. |
| **Checklist** | Task management — deal-specific and general tasks. |

### Operations
| Screen | Purpose |
|--------|---------|
| **Transaction Room** | SkySlope-inspired document checklist per deal. Track which documents are received, pending, or waived. |
| **New Builds** | Dedicated module for tracking new construction deals. |
| **Activity Log** | Full audit trail of every action taken in the system. |
| **Cleanup Tools** | Find and merge duplicate clients, clean stale data. |
| **System Health** | Monitor edge function status, database health, and automation status. |
| **Agent Portal** | Agent-facing overview and settings. |
| **Settings** | App preferences, notification settings, theme. |

### Standalone Pages
| Page | Purpose |
|------|---------|
| `portal.html` | Client portal — shareable deal status link |
| `intake.html` | Client intake form — public-facing |
| `respond.html` | Viewing feedback page — sent to buyer after showing |
| `build.html` | New build progress tracker — shareable with buyer |

---

## PART 5 — THE AUTOMATION TIMELINE (A Deal from Start to Finish)

Here is exactly what happens automatically when you work a deal through Maxwell DealFlow:

**Day 0 — New Client**
→ Client fills intake form → CRM creates client record → Welcome email queued for your approval

**Day 1 — Viewing Booked**
→ You schedule the viewing → Confirmation queued for client
→ After the viewing, feedback request auto-sent to buyer
→ If buyer says "Very Interested" → follow-up sequence triggers automatically

**Day 3 — Offer Submitted**
→ You submit the offer → Offer tracked in system
→ Status visible in Pending Offers queue

**Day 5 — Offer Accepted**
→ Deal moves to Pipeline → Stage: Accepted → Badge: IN PROGRESS
→ You set financing, inspection, walkthrough, closing dates
→ Calendar immediately shows all dates

**Day 5 to Closing — Daily Automation Takes Over**
→ 3 days before financing: reminder email queued
→ 1 day before financing: urgent reminder queued
→ 3 days before inspection: reminder queued
→ 1 day before inspection: urgent reminder queued
→ 1 day before walkthrough: reminder queued
→ Closing day: "Happy Closing Day!" email queued
→ Every morning: briefing email tells you what's due

**Closing Day**
→ You tap "Mark Closed" → Deal stage → Closed → Badge: CLOSED
→ Commission entry created → Net earnings updated

**+7 Days After Closing**
→ Referral request email automatically queued

---

## PART 6 — COMPETITIVE ANALYSIS

### What exists in the market

| CRM | Price | What it does well | What it lacks |
|-----|-------|-------------------|---------------|
| **Follow Up Boss** | $69–$1,000+/mo | Lead aggregation, team routing, fast mobile app | No transaction management, no daily briefing, no push notifications, not customisable |
| **LionDesk** | $39–$49/mo | Video email, drip campaigns, budget-friendly | Dated interface, limited analytics, no pipeline milestone tracking |
| **kvCORE / BoldTrail** | Enterprise pricing | Full brokerage suite, IDX website, marketing automation | Built for brokerages, not individual agents; expensive; rigid workflow |
| **Lofty** | $500+/mo | Lead scoring, AI follow-up, IDX integration | Designed for lead gen, not transaction management; expensive |
| **Rechat** | Custom pricing | AI assistant ("Lucy"), deal tracking, checklists | General market, not personalised; monthly SaaS dependency |
| **Wise Agent** | $49/mo | Transaction management, checklists | No AI, no push notifications, outdated UX |

### Where Maxwell DealFlow is different

**1. Zero monthly cost**
Every competitor charges $39–$1,000+/month. Maxwell DealFlow runs on free tiers. Over 3 years, that's $1,400–$36,000 saved.

**2. Built for your exact workflow**
No other CRM sends you a personalised 7AM morning briefing email. No other CRM auto-requests viewing feedback and triggers a follow-up based on the response. These are workflows built for you specifically.

**3. Real Claude AI — not rule-based chatbots**
Competitors use rule-based "AI" that follows scripts. Maxwell DealFlow connects to Claude (Anthropic's model) — a real large language model that understands context, drafts emails, answers complex questions, and reasons about your deals.

**4. Real push notifications**
Most web CRMs use in-app notifications only (useless when the app is closed). Maxwell DealFlow uses the full VAPID/RFC 8291 push stack — the same standard used by professional notification services like Firebase. Your phone gets a real notification even with the browser closed.

**5. Complete transaction management**
Follow Up Boss and LionDesk focus on lead management, not deal closing. Maxwell DealFlow tracks the full deal lifecycle: milestone dates, document checklist, client portal, PDF summary, commission calculation.

**6. It's yours**
You own the code. You own the data. No vendor lock-in. No price increases. No terms-of-service changes. If Supabase shut down tomorrow, you could move the data and redeploy in a few hours.

---

## PART 7 — HOW TO POSITION THIS

### If a client or colleague asks about your "system":

> "I run a fully custom AI-powered CRM I had built specifically for my workflow. It tracks every client, every deal, every deadline — and it sends me a briefing every morning before I start work. Every email to a client goes through an approval queue, so nothing automated ever goes out without my eyes on it. It's built on the same database technology as companies like GitHub and Notion."

### If another agent asks how you never miss a deadline:

> "My system automatically tracks every financing condition, inspection date, walkthrough, and closing date across all my active deals. Three days before any deadline, I get a reminder. The day before, I get another one. On closing day, it sends the client a congratulations email automatically. I set the dates once and don't have to think about it again."

### If you want to market this as a differentiator to clients:

> "When your deal is in my pipeline, you get access to a personal portal where you can check your deal status, milestone dates, and what's coming next — at any time, from any device. No need to call or email me to find out where things stand."

### If you want to monetise this system:

This CRM is a significant asset. Options:
1. **License it to other eXp agents** — sell access to a hosted version for $49–$99/month (the market charges $39–$1,000, so $49 is very competitive)
2. **Use it as a listing pitch differentiator** — show sellers and buyers the level of systems behind your business
3. **Build it into a team** — if you hire agents under you, they're already onboarded to a professional-grade system from Day 1

---

## PART 8 — WHAT'S BEEN BUILT (Complete Feature Count)

- **25+ screens** inside the app
- **6 Supabase Edge Functions** (email sending, push notifications, daily automation, morning briefing, inbox sync, weekly backup)
- **18 database tables** (clients, viewings, offers, pipeline, commissions, approvals, checklist, activity log, push subscriptions, and more)
- **4 standalone pages** (portal, intake form, viewing feedback, build progress)
- **1 service worker** (PWA, offline support, push handling)
- **Full VAPID/RFC 8291 push stack** (end-to-end encrypted notifications)
- **Gmail OAuth2 integration** (send and receive emails through your own account)
- **Claude AI integration** (real LLM assistant, not a chatbot)
- **pg_cron scheduled jobs** (daily automation at 7AM and 8AM every day)
- **Automated deal lifecycle** (from viewing request to 7-day post-close referral)

---

*Guide prepared April 2026. System live at Vercel. Database at Supabase project: bxwmbrdndsetjwcexwpc.*
