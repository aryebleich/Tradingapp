# Pro review: brokerage-grade polish, trust and revenue (2026-11-20)

How this review was done: the marketing site, sign-up, onboarding and the app were opened in Chromium against the mock broker, signed out and signed in, at 1280px and 375px, in English and Yiddish. Each screen was checked with axe-core (WCAG 2.0/2.1 A and AA) and screenshotted. The code behind each finding was read (public/index.html via scripts/home.py, site.css, app.html, app.js, public/pages/, src/fees.js). The rules are LEGAL_REVIEW.md, COMPLIANCE_REVIEW.md and the existing disclaimers.

**Status:** most findings are fixed in this round; the "Status after this round" section at the end lists them and what is left.

## 1. First impression

- **Marketing site.** The page is already complete: one clear headline ("Trade every day. Invest for a lifetime."), a live, illustrative dashboard as the product picture, "Two ways to grow your money", how it works, Reality Check, security ("You stay in control"), a live demo, pricing with Monthly/Yearly and a comparison table, an FAQ and a final call to action. axe found no violations at 1280 or 375px, in English or Yiddish.
  - The header has no link to the security section, which is the strongest trust signal for a brokerage-grade product.
  - The final call to action has no risk link beside it.
- **The homepage copy is under legal review.** LEGAL_REVIEW.md L9–L12: a redesigned homepage was not released because its new copy was never signed off. A rewrite of the headline and sections would repeat that problem. Structure and trust links can change; new claims need sign-off first.
- **Sign-up.** A single card, centred on a blank page. It has no `<h1>` (the title is an h2), and on desktop nothing reminds the visitor what they get or that no card is needed. Most sign-up drop-off happens at this screen.
- **Onboarding** (`#/start`) is good: 5 steps, a progress bar, "nothing here uses real money", and a clear skip.
- **Home after onboarding.** The "Get started" list:
  - puts "Try a ready-made strategy" before "Place your first paper trade";
  - its first-trade step links to `#/dashboard`, the page you are already on, so the click does nothing;
  - there is no next step after the first trade.
- **The app's browser titles are all "Brightolio".** Tabs, history and screen readers cannot tell pages apart (WCAG 2.4.2 Page Titled).

## 2. Consistency

- **Visual basics are consistent.** Fonts (Inter, with Rubik for Yiddish), colours, radii and buttons come from theme.css and layout.css. Layout v2 (DESIGN_SYSTEM.md) holds spacing, tables and focus rings.
- **Empty states differ page by page:** "None yet", "Nothing yet", "No positions. Place a trade", and bare table rows. Few of them say what to do next, against DESIGN_SYSTEM.md "Empty states give the next step".
- **Loading states.** Skeletons are used on page load and on Home. Some cards still say "Loading…" in plain text.
- **Error messages** are generally plain words. Server faults read "The server is busy, please try again." (fine). The upgrade window says "is a Pro feature" even to a Pro member who reached a limit of their own plan.
- **Wording.** "Paper", "practice money" and "test money" are all used for the same idea. The pills on Home are now "Paper" and "LIVE MONEY".

## 3. Trust signals

- **Present:** risk wording in every footer and in the app menu; /risk, /terms, /privacy, /security, /insurance and /status pages; "not a broker-dealer"; investor protection page; passkeys, account lock and 2FA; step-up before trading and transfers; a password and an "I understand" box on every money-moving confirm; risk notices with a 10-second wait before options, crypto and margin.
- **Gaps:**
  - The security section is not reachable from the homepage header.
  - Sign-up shows no security or "no card needed" line.
  - The regulatory status line is still open with Legal (LEGAL_REVIEW.md L6). Nothing was added here; it stays a Legal item.
- **Performance fees.** In registered-adviser mode, plans carry a performance fee (src/fees.js perfFee). Members see their own rate on Plans & billing, but not the rate of each plan before they choose one, because the owner decided the rates are private (test/batch22). The fee is off in the default software-only mode, so nothing is hidden today. Before adviser mode is switched on, the owner must decide whether each plan's rate is shown at the point of choice. That is recorded in NEEDS_REVIEW.md and not changed here.

## 4. Speed, accessibility (WCAG AA) and mobile

- **axe-core:**
  - 0 violations on the homepage (English and Yiddish), Security, Status, Login, Get started, Marketplace, AI bots, Developer API and Settings.
  - Home and Plans & billing each have one colour-contrast failure.
  - Invite & earn has one form field without a label.
  - Sign-up has no `<h1>`.
- **Mobile (375px):** no page scrolls sideways (checked in the previous structure work as well). The homepage is long on phones (about 24,000px), but each section is self-contained. The order ticket and confirms work.
- **Speed:** the app loads page files on demand (lazyRoutes) and prefetches in a hidden frame. Assets carry content-hash versions. app.js is about 250 KB uncompressed. The rest is fine at this size.

## 5. Revenue

- **Plans & billing (`#/funding`)** has 4 plans, Monthly/Yearly ("2 months free"), "Most popular" on Pro, "You won't be charged until it ends, and you can cancel anytime", and Stripe checkout and portal. What is missing:
  - The side-by-side comparison table that the homepage has: the clearest way to see what Pro adds over Starter.
  - The yearly price per month, shown only under the card in small type.
- **Upgrade prompts** come at the right moment: a 402 from a paid feature opens the upgrade window. Its problems:
  - It always offers Pro, even to Pro members who reached a Pro limit; they need Elite.
  - It has a hard-coded fallback price ($29/$290) that does not match the real plan ($53/$530).
  - It always checks out monthly.
  - It does not say what stays free.
- **Free vs paid** is clear on the pricing pages. Inside the app, most paid limits are explained only when reached, which is the honest moment, so no banners were added.
- **Referrals (`#/referrals`):** clear offer, link, milestones. One unlabeled field (the invite link input).
- **Marketplace, sponsored news, API:**
  - The Marketplace is free to browse and to copy from, with no upsell gap.
  - Sponsored news is labelled (Admin → Sponsored).
  - The Developer API states its plan limits on the page.
- **Where users drop off:**
  - sign-up (no reassurance);
  - the first Home visit (the first-trade step does nothing);
  - the plan choice (no comparison inside the app);
  - the paid-limit window (the wrong plan for paid members, the wrong fallback price).

## 6. The 20 highest-impact fixes

Ranked by effect on trust and revenue against effort (H/M/L).

| # | Fix | Trust | Revenue | Effort | Done here |
|---|---|---|---|---|---|
| 1 | Upgrade window: offer the plan that actually unlocks the limit (next plan up), real prices from the plan data, Monthly/Yearly choice, "what stays free", "no charge until the trial ends, cancel anytime" | H | H | L | Yes |
| 2 | Plan comparison table on Plans & billing, from the same data as the homepage table | M | H | L | Yes |
| 3 | Yearly price shown as a monthly amount on the card ("$44.17/month, billed $530 yearly"), so the saving is visible | M | M | L | Yes |
| 4 | Get started: first trade first, and the step jumps to the ticket instead of doing nothing; then first strategy, then backtest | M | H | L | Yes |
| 5 | After the first trade, point to the first strategy (one "Next step" line on Home) | L | M | L | Yes |
| 6 | Sign-up: an `<h1>` and, on desktop, a short factual panel on what you get (practice money, no card, cancel anytime) and how the account is protected | H | H | L | Yes |
| 7 | Page titles for every app screen ("Plans & billing · Brightolio") | M | L | L | Yes |
| 8 | Fix the axe failures (contrast on Home and Plans & billing, the unlabeled invite field) | H | L | L | Yes |
| 9 | One empty-state component (what is empty plus the next step) used on Home, Orders and Billing history | M | M | L | Yes |
| 10 | Homepage header: a Security link, so the trust section is one tap away | H | M | L | Yes |
| 11 | Risk link beside the final homepage call to action (already approved wording: footer disclosure link, no new claim) | H | L | L | Yes |
| 12 | One word for practice money in the app ("Paper" on pills, "practice money" in sentences), documented in DESIGN_SYSTEM.md | M | L | L | Rule written; wider copy pass later |
| 13 | Remaining "Loading…" text in cards replaced by skeletons | L | L | M | Partly (Home, layout.js already does this) |
| 14 | Regulatory status line in the footer | H | M | — | Legal (L6), not changed |
| 15 | Show each plan's performance-fee rate at the point of choice when adviser mode is on | H | M | L | Owner decision (NEEDS_REVIEW.md) |
| 16 | Shorter homepage on phones (collapse secondary sections) | L | M | M | Later: copy and order need legal review (L9–L12) |
| 17 | Product screenshots of real screens (order desk, Reality Check) on the homepage | M | M | M | Later: images must be labelled illustrative (L2) |
| 18 | In-app "Unlock with Pro" labels on paid-only controls before they are pressed | M | M | M | Later: needs a list of paid controls per page |
| 19 | Customer stories | M | M | — | Not done: only with real, verifiable members and consent (no invented reviews) |
| 20 | Smaller app.js (split Home and settings into lazy files) | L | L | M | Later |

## 7. Rules followed

- No promise of returns, nothing "guaranteed" or "risk-free". All risk wording stays, and none of it is hidden or moved down.
- No dark patterns: no countdowns, no fake scarcity, no invented reviews, no pre-ticked paid add-ons. Cancel stays one tap ("Manage billing" opens the Stripe portal).
- No feature or data removed, and old routes kept.
- Live-money actions keep their password, step-up and confirm steps.
- New homepage and sign-up copy is factual (taken from the plan data and existing pages) and is listed in LEGAL_REVIEW.md (L13–L15) for sign-off.

## Status after this round

Built: fixes 1 to 11, the rule for 12 and part of 13. The others are open, for the reasons in the table: Legal (14), an owner decision (15), copy that needs legal review (16, 17), or work for a later round (18, 20). Customer stories (19) only with real, consenting members. Details of each change: CHANGELOG_AI.md, 2026-11-20 entries; decisions: DECISIONS.md P2-1 onward.
