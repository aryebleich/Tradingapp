# Insider and congressional trade trackers (RES-03)

Research for Brightolio feature registry gaps **S-11** (insider buying tracker), **I-04** (insider transactions), and **I-03** (congressional stock trading tracker). Date of research: **2026-11-26**. Public sources only. Not investment advice.

## Why these features

From `docs/FEATURE_REGISTRY.md` (the 20 biggest gaps):

| ID | Feature | Status | V/E | Flag |
| --- | --- | --- | --- | --- |
| S-11 | Insider buying tracker | missing | 5/2 | delayed |
| I-04 | Insider transactions | missing | 5/2 | delayed |
| I-03 | Congressional stock trading tracker | missing | 4/2 | delayed |

They are among the highest value-for-effort items that do **not** need a commercial data license. Raw data is public. Competitors already monetize polished versions; Brightolio can ship honest, delayed, source-linked trackers that fit Intelligence and Scanner products and support Plus conversion.

## Data sources (free / official)

### Corporate insiders (Form 4)

- **Upstream:** SEC EDGAR Form 4 (and Form 4/A amendments). Officers, directors, and 10% owners must report most transactions within **two business days**.
- **How to get it:** EDGAR daily index + ownership XML; or a thin parser over the same files. Commercial JSON wrappers (Form4API, EdgarKit, XOOMAR, Apify actors) exist; they are convenience, not exclusive data.
- **Practical notes (2026):**
  - One filing can hold several transactions; partial fills should be consolidated carefully.
  - Form 4/A must replace, not double-count, the original.
  - Code **P** = open-market/private purchase; **S** = sale; grants and option exercises are different codes and should be filterable.
  - **10b5-1** plan flags matter: scheduled sales are not discretionary conviction signals.
  - SEC fair-access rate limits apply if you hit EDGAR directly; identify the User-Agent as required.

Sources consulted:
- [SEC EDGAR](https://www.sec.gov/edgar) (canonical)
- Form4API buyer’s guide, updated 2026-11-16: https://www.form4api.com/guides/best-insider-trading-api
- OpenInsider / EDGAR DIY notes (DEV Community, Oct–Nov 2026)

### Congressional trades (STOCK Act)

- **Upstream:** Periodic Transaction Reports (PTRs).
  - House: Clerk of the House financial disclosure / PTR search and downloads.
  - Senate: Senate electronic financial disclosure (eFD).
- **Lag:** STOCK Act requires disclosure within **45 days** of the trade. Any product that treats these as timely signals is misleading unless it shows filing lag plainly.
- **Amounts:** disclosed as **ranges** (e.g. $1,001–$15,000), not exact dollars. Midpoints are estimates and must be labelled as such.
- **Open datasets / mirrors (for engineering reference, not required):** Hugging Face / NexusTrade congressional parquet (snapshot checked 2026-09-20); CapitolStockWatch open CSV feeds; DaveManuel.com House/Senate extracts (CC BY 4.0 noted on that site as of Nov 2026).

Sources consulted:
- House Clerk and Senate eFD (official)
- OQRO explainer on sources (reviewed Nov 2026): https://oqro.io/learn/blog/how-to-track-congress-stock-trades
- FatCat Watch source list; Capitol Trades; Quiver Quantitative public pages (prices as of late Oct / Nov 2026)

## Competitor snapshot (public pages, late 2026)

| Product | Insiders | Congress | Free tier | Paid (listed) |
| --- | --- | --- | --- | --- |
| OpenInsider | Form 4 screener, cluster buys | No | Full screener | — |
| Capitol Trades | No | House + Senate tables | Full product | — |
| Quiver Quantitative | Yes | Yes + other alt-data | Visitor plan (live lists) | ~$25–30/mo Premium |
| Unusual Whales | Partial / with flow | On paid plans | Delayed free | Retail from ~$50/mo |
| Finviz | Form 4 page | No | Free page | Elite ~$39.50/mo |

Brightolio does not need to beat Quiver on breadth on day one. It needs **trustworthy tables, filing links, lag labels, and cluster filters** inside the existing Intelligence UX.

## Product recommendation for Brightolio

### Phase 1 — Insider (S-11 + I-04 together)

**Build one module** covering market-wide and per-symbol Form 4:

1. **Market list (Scanner / Intelligence):** recent open-market **buys** (code P), filterable by min value, role (CEO/CFO/director), cluster (≥2 insiders, same issuer, short window).
2. **Symbol page strip:** last N Form 4 rows for the open symbol, with link to the EDGAR filing.
3. **Always show:** transaction date, filing date, **days lag**, insider name/title, shares, price or value, 10b5-1 flag when present, code (P/S/other).
4. **Copy (permanent):**  
   > Public Form 4 filings from SEC EDGAR. Filings can lag the trade by up to two business days. This is not investment advice; insiders can and do lose money.
5. **Tier:** Free for delayed market list + symbol strip; Plus for alerts and saved cluster presets (aligns with registry Plus on S-11).

**Do not** rank “best insiders” or promise alpha. Optional later: simple count of cluster events — never a performance claim without a full loss-inclusive methodology (same bar as AI picks).

### Phase 2 — Congress (I-03)

1. **Table:** member, chamber, ticker, transaction type, amount **range as filed**, transaction date, filing date, **days late vs 45-day rule**, link to official PTR.
2. **Filters:** chamber, party (if from public legislator metadata), ticker, min range floor.
3. **Copy:**  
   > Disclosures under the STOCK Act. Members may file up to 45 days after a trade. Amounts are ranges, not exact figures. Not investment advice.
4. **Tier:** Free browse; Plus for alerts when a watched symbol appears in a new PTR.

Avoid copy-trading Congress. That sits under marketplace / legal gates (L-MP).

### Engineering fit

- Prefer **EDGAR-first** for Form 4 (same pattern as existing research/EDGAR usage in the app). Paid Form-4 APIs only if ops cost of parsing exceeds value.
- Congress: start from official House/Senate publication paths; open mirrors can speed bootstrap but every row should retain provenance to the official filing.
- Jobs: nightly (or every few hours) ingest with idempotent accession / report ids; store raw filing URL.
- Rate limits and User-Agent for SEC; respectful crawl for House/Senate sites.
- Registry: update S-11, I-04, I-03 rows when shipped; flag stays `delayed`.

## Legal and honesty

- **Flag `delayed` is correct.** Do not market as real-time.
- Not personalized advice; no “trade with Pelosi” product without legal review.
- No promised returns from following insiders or members.
- Paper remains default for any related automation.

## Suggested queue rows (for AI_HANDOFF.md)

| ID | Priority | Suggested | Task and done when |
| --- | --- | --- | --- |
| FEAT-02 | 10 | Claude or Codex | Insider Form 4 tracker (S-11 + I-04): market buys list, cluster filter, per-symbol strip, EDGAR links, lag and not-advice copy, Plus alerts optional. Done when pages and tests are on main and registry rows are updated. |
| FEAT-03 | 11 | Claude or Codex | Congressional PTR tracker (I-03): House + Senate table with amount ranges, 45-day lag label, official filing links, not-advice copy. Done when the page and tests are on main and the registry row is updated. |

## Checks

- Research only; no app code in this note.
- Sources dated Oct–Nov 2026 where available.
- Aligns with growth-plan Intelligence pillar and master-plan section 5 without requiring OWN-05 data licenses.
