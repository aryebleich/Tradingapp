# Pricing & competitor research (RES-01)

**Author:** Grok  
**Date:** 2026-11-26  
**Sources:** Public pricing pages and secondary summaries checked November 2026. All figures in USD unless noted. Not advice; for product planning only.

## Competitor snapshot (retail / self-directed)

### TradingView (charting + social + alerts)
| Plan | Monthly | Yearly (equiv. /mo) | Notes |
|------|---------|---------------------|-------|
| Basic | Free | Free | 1 chart, 2 indicators, limited alerts |
| Essential | $14.95 | $12.95 | 2 charts, 5 indicators, more alerts |
| Plus | $34.95 | $29.95 | 4 charts, footprint/TPO |
| Premium | $69.95 | $59.95 | 8 charts, longer history, more alerts |
| Ultimate | $239.95 | $199.95 | 16 charts, tick charts, pro use |

Sources: TradingView pricing page summaries (checked ~15–26 Nov 2026). Real-time exchange data often extra.

### Charles Schwab / thinkorswim
- Platform: free with a Schwab brokerage account.
- Stocks & ETFs: $0 online commission.
- Options: $0.65 per contract.
- Futures: $2.25 per contract (plus exchange fees).
- No monthly platform subscription for retail.

Sources: schwab.com/pricing and thinkorswim reviews (checked Oct–Nov 2026).

### Interactive Brokers (IBKR Lite / Pro)
- IBKR Lite (US/Singapore): $0 commission on US stocks & ETFs.
- IBKR Pro: from ~$0.0035–$0.005 per share (tiered/fixed) + exchange fees; options often $0.65 or lower on volume.
- No monthly platform fee for standard retail use; strong for global/multi-asset and high-volume traders.

Sources: IBKR pricing pages and independent fee guides (checked Nov 2026).

### eToro
- Core investment account: free to open; trading costs via spreads / small commissions on some assets; $100k demo.
- Optional Club tiers (Platinum / Platinum+): roughly $4.99–$14.99/mo or $49.99–$149.99/yr for higher tiers and perks.
- Copy-trading and social features are a major differentiator.

Sources: eToro fees / Club pages (checked ~14–17 Nov 2026).

### Robinhood Gold
- Free core app (commission-free stocks/ETFs/options in many cases).
- Gold: **$5/mo or $50/yr**.
- Main perks (as of late 2026): higher cash APY (~3.6% on eligible cash), 3% IRA match (vs 1%), first $1k margin interest-free, higher instant deposits, some futures/options fee discounts.

Sources: Robinhood Gold overview and independent analyses (checked Oct–Nov 2026).

### Pattern summary
- Pure brokers (Schwab, IBKR Lite, Robinhood free) → $0 platform fee; make money on spreads, options contracts, margin, cash interest, payment for order flow, or premium add-ons.
- Charting / research tools (TradingView) → clear freemium ladder starting ~$13–15/mo.
- Social / multi-asset (eToro) → free core + optional low-cost club.
- Premium memberships (Robinhood Gold) sit at a very accessible $5/mo.

Brightolio already sits in the “software on top of the user’s own brokerage” category (like a smarter, automation + AI layer), so the closest analogues are TradingView-style software pricing and Robinhood Gold-style low-friction premium.

## Brightolio current posture (from public site & prior board)
- Generous free Starter: $100k paper, live trading on user’s own broker (user-placed orders), charts, limited automation/AI.
- Paid tiers (Pro / Elite / Ultimate) unlock more automation on real accounts, scanners, AI capacity, etc.
- Positioning is honest: software, not a broker; paper-first; risk rules and Reality Check.

## Three concrete pricing options for Brightolio

### Option A — “Accessible premium” (closest to Robinhood Gold + TradingView Essential)
- **Starter (free forever):** current generous free tier + paper + limited AI messages.
- **Pro — $9–12 / month** (or ~$90–110/year): unlock real-account automation (with approval), more AI credits, more strategies / scanners, Reality Check power features.
- **Elite — $29–39 / month:** higher AI limits, advanced Playbooks, priority data, more accounts.
- **Ultimate — $79–99 / month:** max limits, multi-account fleets, API higher tiers, dedicated support path.

**Trade-offs:** Easy entry and conversion; leaves money on the table vs power users; keeps “honest and approachable” brand.

### Option B — “Software ladder” (TradingView-inspired)
- Free: paper + basic charts + 1 automatic strategy on paper.
- Essential ~$15/mo, Plus ~$35/mo, Premium ~$70/mo, Ultimate ~$150–200/mo.
- Clear feature gates on charts layouts, indicators, alerts, automation slots, AI tokens.

**Trade-offs:** Familiar to serious traders; higher average revenue per paying user; risk of looking expensive next to free broker platforms; needs very clear “why pay” messaging (automation + Reality Check + AI research).

### Option C — Hybrid (recommended starting point)
- Keep a strong free Starter (acquisition + trust).
- **Pro $12–15 / month** (annual discount ~15–20%): the main conversion tier — real automation (step-up approval), 5–10× AI credits, full Reality Check, more scanners.
- **Elite $39–49 / month:** power users, multiple accounts, higher AI, advanced Playbooks, priority.
- **Credits add-on:** buy extra AI credits à la carte (ties into REV-01 billing work).
- Optional annual “locked” discount and clear, non-dark trial-end reminders (ties into REV-03).

**Trade-offs:** Balances growth and monetisation; pairs well with the existing Stripe test flow and the planned AI-credits work (REV-01 / AI-01). Avoids both “too cheap to fund R&D” and “TradingView Ultimate sticker shock.”

## Recommendations
1. Ship Option C as the default public pricing once REV-01 (plans + credits) and REV-02 (“Unlock with Pro” labels) land.
2. Keep every paid control labelled before the click (no surprise paywalls).
3. Make AI usage visible and capped (AI-01) so users never get a surprise bill.
4. Revisit prices every 6 months against TradingView + Robinhood Gold + any new AI-trading tools; never promise returns.

## Sources (checked Nov 2026)
- TradingView plan comparisons and pricing pages (multiple secondary reads 15–26 Nov 2026).
- Charles Schwab pricing / thinkorswim (schwab.com, Oct–Nov 2026).
- Interactive Brokers fee guides and official tables (Nov 2026).
- eToro fees / Club pages (~14–17 Nov 2026).
- Robinhood Gold overview and independent analyses (Oct–Nov 2026).

*End of RES-01 research note. Ready for Claude/Codex to use when implementing or reviewing pricing UI and billing.*
