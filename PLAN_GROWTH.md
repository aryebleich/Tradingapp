# Growth plan: features, plans and build order (2026-11-22)

Written as a product lead would before building. The benchmark is what Robinhood (simple and fast), Interactive Brokers (depth and data), Public (one stock page with everything on it) and Composer (rules-based automation with honest backtests) do well. The rule is to **improve and connect what exists, never build a second copy**.

## 1. What already exists (searched in public/pages/, src/ and FEATURES.md)

| Area | Already there | Where |
|---|---|---|
| Stock page | Stock & fund analyzer: price trend, P/E, P/B, P/S, net margin, growth (one year, SEC data), technicals (50/200-day, RSI), earnings vs expectations (Finnhub key) | `public/pages/invest.js` (analyze), `src/invest.js /analyze`, `src/fundamentals.js` |
| Fundamentals | SEC XBRL frames (one year, all filers); company facts for a 5-year checklist | `src/fundamentals.js`, `src/wealth.js fundamentals()` |
| Earnings | Analyst estimates, surprises and an earnings calendar with a Finnhub key; calendar page | `src/events.js`, `#/calendar`, `#/analyze/earnings` |
| Technicals | Indicators and patterns, chart with drawing tools, AI explainer | `public/chart.js`, `public/indicators.js`, `src/ta.js`, `#/tradetools` |
| Scanners | Rule and pattern scanners, saved and run on a schedule, alerts; a growth and value screen | `src/scanner.js`, `src/fundamentals.js screen()` |
| Rates | Fed funds, Treasuries and mortgages from FRED; Fed news | `src/instruments.js`, `#/invest/alpaca-tools` |
| Dividends | Dividend reinvestment (DRIP), Alpaca corporate actions | `src/wealth.js runDrip()`, `#/wealth?tab=drip` |
| Passive | Index funds, S&P 500 plan, automated portfolios (robo), rules across accounts, long-term view, scheduled trades | `lowcost`, `sp500`, `robo`, `rules`, `longterm`, `schedule` |
| Active | Scanner, watchlists, AI signals, journal, performance (time-weighted return) | `scanner`, `watchlists`, `aisignals`, `insights` |
| Funds | Low-cost funds table (cost, kind, minimum), mutual funds tab | `#/wealth/lowcost`, `#/invest` |
| Futures | Futures tab (contracts by group, paper) | `#/invest` |
| Diversification | Sector and region split, warnings | `src/wealth.js diversification()` |
| AI long/short portfolios | Styles, risk levels, hedges, weekly book, paper automatic | `src/aifunds.js`, `#/portfolios/aifunds` |
| Intraday | Bots checked every 15 minutes or hourly; kill switch; risk limits | `src/scanner.js runIntradayBots()`, `src/risk.js` |
| News and AI | News with tone, StockTwits, AI brief, AI signals, news to trades | `src/sentiment.js`, `src/aisignals.js`, `src/aitools.js` |

## 2. What the data and the broker really allow

- **SEC EDGAR (free, no key):**
  - company facts give every reported annual figure (revenue, gross and operating income, net income, EPS, operating cash flow, capital spending, assets, liabilities, equity, debt, cash, shares, dividends declared per share);
  - submissions give the industry (SIC) and the dates of 8-K "Results of operations" reports (item 2.02), which are the earnings report dates.
  - **So:** 5-year statements, ratios, trailing P/E history, EV/EBITDA, payout ratio, dividend growth and past earnings dates are possible for US filers.
- **Analyst estimates** (forward P/E, expected EPS and revenue, guidance, upcoming dates) need the Finnhub key. Without it, the page says so and shows the next date as *estimated* (about 91 days after the last report).
- **Prices:** Alpaca (IEX feed) plus Yahoo, Stooq and others, with fallback.
  - Bars and the top of book (bid, ask, sizes) are available.
  - Market depth (level 2) is not offered by Alpaca's retail API or the free providers. The page shows the top of book and says depth is not available.
  - Buy and sell volume is *estimated* from where each bar closed in its range; it is labelled indicative.
- **Rates:** FRED history for the Fed funds rate, 2-year and 10-year yields; the S&P 500 and sector ETFs from price history. The Fed's 2026 meeting calendar is fixed and public; later years are shown as "not yet published".
- **Broker:**
  - Alpaca trades US stocks, ETFs, options and crypto. It does not trade mutual funds or futures.
  - Futures can be traded at tastytrade, TradeStation and Charles Schwab (not through Brightolio's connection today), so futures stay research and paper.
  - Mutual funds show the closest low-cost ETF.
- **Speed:** retail APIs work in hundreds of milliseconds and have rate limits, and US rules limit day trades on margin accounts under $25,000 (pattern day trader). True high-frequency trading is impossible here and is never claimed.

## 3. Features: the professional version, who, plan and money

Plans today are Starter (free), Pro, Elite and Ultimate. Here **Free = Starter, Pro = Pro, Premium = Elite and Ultimate** (DECISIONS.md G-1).

| # | Feature | Professional version (what it does) | For | Plan | How it earns |
|---|---|---|---|---|---|
| 1 | P/E and valuation | Trailing P/E, forward P/E (with a key), PEG, P/S, EV/EBITDA; P/E against its own 5-year average and against its sector; P/E chart by year; "expensive / fair / cheap compared with its history" with the method shown | Long-term investor, beginner | Free (current values), Pro (5-year history and chart) | Upgrade trigger with sample data |
| 2 | Growth-at-a-price scanner | Presets "Growth worth paying for" and "Expensive and weakening"; filters on P/E, EPS growth, revenue trend, beats, margins, free cash flow; saved filters with daily alerts | Active trader, investor | Free (presets, view), Pro (save and alert) | Upgrade trigger |
| 3 | Earnings | Past report dates and EPS (SEC), expected vs actual and surprises (with a key), price move after each report, next date (confirmed or estimated); on the stock page and the calendar | All | Free | Engagement, Pro reminders |
| 4 | Fundamentals | 5-year income, balance sheet and cash flow, key ratios (margins, ROE, debt/equity, free cash flow), and a plain-language summary of strengths and risks (AI when set up, rules otherwise) | Investor | Free (latest), Pro (5 years and AI) | Upgrade trigger |
| 5 | Technicals | Chart with 20/50/200-day averages, RSI, MACD, volume, support and resistance; a plain-words read of the trend | Active trader | Free | Engagement |
| 6 | Supply and demand | Top of book, estimated buy vs sell volume, volume profile, unusual-volume flag, "buyers or sellers in control" gauge, all labelled indicative | Active trader | Pro | Upgrade trigger |
| 7 | Rates vs stocks | Fed funds, 2-year, 10-year and the curve (10y−2y) against the S&P 500 and sectors; what rates tend to do to growth, dividend and bank stocks; next Fed meeting | All | Free | Trust and content (SEO) |
| 8 | Dividends | Yield, payout ratio, growth history and streak, ex and pay dates (Alpaca corporate actions), safety score with its parts, calendar, 12-month income forecast for the portfolio, DRIP | Income investor | Free (stock), Pro (portfolio forecast) | Upgrade trigger, retention |
| 9 | Passive investing | One place: index portfolios by risk level, automatic rebalancing, recurring deposits, fees compared; connects lowcost, sp500, robo, longterm | Beginner, long-term | Free (plan), Pro (automation on real accounts) | Subscription |
| 10 | Active investing | One desk: scanner, watchlists, trade ideas, journal, performance against the S&P 500 | Active trader | Free (view), Pro (automation) | Subscription |
| 11 | Funds and ETFs | Search and compare by cost, 1/3/5-year returns, risk (volatility, worst drop) and similarity (return correlation as an overlap stand-in); a mutual fund points to its closest low-cost ETF | Investor | Free | Trust |
| 12 | Futures | Contract specs (size, tick, months), an approximate margin with its date, the roll calendar, charts; research and paper only; which brokers trade futures | Active trader | Free (research), Pro (paper bots) | Upgrade trigger |
| 13 | Diversification with AI | Score from sector, region, asset type, single-stock weight, fund overlap and correlation; up to 3 suggestions, each with "why" and a one-click preview on the ticket (never an automatic trade) | All | Free (score), Pro (suggestions) | Upgrade trigger |
| 14 | AI long/short portfolios (was "AI hedge funds") | Each shows its strategy, rules, backtest, live paper record, drawdown, fees (none beyond the plan) and risk level; follow with a position-size limit; never called a hedge fund or a regulated fund | Active trader | Pro | Subscription |
| 15 | AI morning news picks | Before the open: news and pre-market movers ranked, an allocation proposed with reasons and sources; approve-each or automatic; daily budget, per-stock limit, stop loss, daily loss limit; paper by default, live only with opt-in and step-up; the real hit rate with losses | Active trader | Pro (paper), Elite (live) | Subscription, Premium |
| 16 | AI intraday trading (never called HFT) | Short-term rules every 5 minutes within rate limits and the pattern-day-trader rule; a high-dividend list with "hold over ex-dividend dates" on or off; risk caps, kill switch, paper first, full trade log | Active trader | Elite | Premium |
| 17 | Company card before every buy | Above the confirm on the ticket, the Trade page, Equalize, Playbooks and bots: what it does, sector, market cap, P/E vs sector, last and next earnings, dividend yield, 52-week range, headlines, one-line strengths and risks. Never blocks the order; "Don't show for this stock" | All | Free | Trust (fewer regretted trades) |
| 18 | Gaps vs top brokerages | See section 5 | | | |

## 4. Ranked build order (effect on revenue and trust against effort)

1. **One stock page with valuation, fundamentals, earnings, dividends, technicals and supply and demand** (1, 3, 4, 5, 6, 8). One server module (`src/stock.js`) on data already used; the biggest gain in trust and the base for the rest.
2. **The company card before every buy** (17). Small, trust-heavy, uses step 1.
3. **Growth-at-a-price scanner** (2). Pure filters on step 1's data; a clear Pro trigger (save and alert).
4. **Rates vs stocks** (7). FRED is already wired; strong content.
5. **Diversification score and suggestions** (13). Extends `diversification()`; Pro trigger.
6. **AI morning news picks** (15). Revenue (Pro and Premium); paper first; honest track record.
7. **AI intraday engine** (16). Premium; strict limits; paper first.
8. **AI long/short portfolios: record, rules, follow limit, naming** (14).
9. **Dividend portfolio income and calendar** (8, the portfolio part).
10. **Passive and Active hubs** (9, 10): connect existing pages, fees compared.
11. **Funds compare** (11) and **futures specs and roll calendar** (12).
12. **Gaps** (18) and **site-wide polish and pricing** (Phase 2).

## 5. Gaps against top brokerages (feature 18)

Compared with Robinhood, IBKR, Public and Composer, the most valuable missing items that the data allows:

1. **Earnings and ex-dividend reminders** for holdings and watchlists (a notice the day before).
2. **Stock comparison side by side** (valuation, growth, dividends, risk for 2–4 symbols) on the stock page.
3. **Fundamental alerts** (P/E below its average, a new dividend increase) from the saved scanner filters.
4. **52-week high and low and gap flags** on the stock page and in the card.

Left out on purpose: analyst price targets and ratings (need a paid feed, and they read as advice), IPO allocations (need a broker program), and copy-trading of real people's live money (exists only with consent, in the Marketplace).

## 6. Rules carried through every feature

- Every AI pick, score, label or forecast says it is not investment advice, and none promises returns.
- Track records show losses.
- Paper is the default; live automation needs opt-in, limits and step-up.
- Data that is delayed, estimated or indicative is labelled.
- Provider calls are cached, with clean fallbacks that say what is missing.
- No routes removed.
- Tests cover the valuation math, the scanner filters, the news-allocation caps, the intraday limits and the pre-buy card.
