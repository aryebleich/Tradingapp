# Feature registry

Every feature in the master plan (docs/research/master-plan.md), one row each, checked against the code (src/, public/pages/, the routes in public/app.js), not only the docs. It is the shared list for Claude, Codex and Grok: **every pull request that adds or changes a feature updates its row**, and `npm test` fails when a page or route is missing from "Every page" at the bottom (test/feature-registry.test.js). The summary is rebuilt by `node scripts/registry.mjs` (the test checks it is current).

How to read a row:
- **Status:** `done` (works, tested, in the menu), `partial` (exists but short of professional), `missing`.
- **Where:** the files and the route (`#/...`) when it exists.
- **Tier:** the plan that unlocks it (DECISIONS.md MP-3): Free (Starter), Pro, Elite, Ultimate, Institutional. These are the app's plan names; the master plan's Plus, Pro and Elite map to Pro, Elite and Ultimate.
- **Flag:** `legal` = needs-legal-review (LEGAL_REVIEW.md L-MP); built only behind its Admin switch, off until the owner signs off (OWN-04). `licensed` = needs a commercial data license before paying customers see it. `delayed` = free source, labelled delayed. `member` = the member's own broker data. `—` = none.
- **V/E:** value 1–5 / effort 1–5 (higher value and lower effort first).

<!-- summary:start -->
## Summary

Rebuilt by `node scripts/registry.mjs` from the rows below: 287 features.

| Section | Done | Partial | Missing |
| --- | --- | --- | --- |
| 1. Professional trading terminal | 7 | 8 | 3 |
| 2. Brightolio AI | 13 | 6 | 0 |
| 3. Advanced market scanners | 6 | 11 | 2 |
| 4. Automated trading ecosystem | 15 | 3 | 0 |
| 5. Institutional financial intelligence | 5 | 6 | 5 |
| 6. Complete portfolio management | 15 | 1 | 0 |
| 7. Financial news and intelligence center | 6 | 5 | 4 |
| 8. Advanced options trading | 9 | 3 | 2 |
| 9. Fundamental research terminal | 5 | 8 | 2 |
| 10. Global multi-asset platform | 4 | 8 | 0 |
| 11. Brightolio Social | 3 | 4 | 7 |
| 12. Brightolio Marketplace | 0 | 5 | 8 |
| 13. Brightolio Academy | 1 | 9 | 2 |
| 14. Professional trade journal | 5 | 3 | 4 |
| 15. Advanced alerts and monitoring | 7 | 4 | 3 |
| 16. Brightolio Enterprise | 0 | 13 | 5 |
| 17. Brightolio Developer Cloud | 1 | 6 | 5 |
| 18. Mobile and desktop ecosystem | 6 | 5 | 1 |
| 19. Security and infrastructure | 10 | 7 | 1 |
| **All** | **118** | **115** | **54** |

### The 20 biggest gaps

Missing or partial rows with the highest value for the effort (V/E), legal and licensed rows left out (they wait for sign-off or a license):

| # | ID | Feature | Status | V/E |
| --- | --- | --- | --- | --- |
| 1 | S-07 | Penny stock scanner | missing | 3/1 |
| 2 | T-16 | Trading hotkeys | missing | 4/2 |
| 3 | I-03 | Congressional stock trading tracker | missing | 4/2 |
| 4 | N-13 | Real-time news alerts | missing | 4/2 |
| 5 | F-08 | Discounted cash flow models | missing | 4/2 |
| 6 | J-08 | Time-of-day performance | missing | 4/2 |
| 7 | AL-05 | News alerts | missing | 4/2 |
| 8 | T-05 | Multiple synchronized charts | partial | 4/2 |
| 9 | S-04 | Unusual volume scanner | partial | 4/2 |
| 10 | S-05 | Breakout scanner | partial | 4/2 |
| 11 | S-13 | Dividend scanner | partial | 4/2 |
| 12 | S-19 | Financial market heatmaps | partial | 4/2 |
| 13 | I-05 | SEC filings monitor | partial | 4/2 |
| 14 | I-16 | Economic intelligence dashboard | partial | 4/2 |
| 15 | N-03 | Economic calendars | partial | 4/2 |
| 16 | F-02 | Balance sheets | partial | 4/2 |
| 17 | F-03 | Income statements | partial | 4/2 |
| 18 | F-04 | Cash flow statements | partial | 4/2 |
| 19 | F-07 | Valuation calculators | partial | 4/2 |
| 20 | F-10 | Company financial health scores | partial | 4/2 |
<!-- summary:end -->

## 1. Professional trading terminal

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Real-time market data | partial | src/streams.js, src/alpaca/stream.js, src/datasources.js | Consolidated (SIP) quotes for paying users need an exchange license; today real time is the IEX feed or the member's own broker feed. "Delayed" labels on every quote that is not real time | Terminal | Free | licensed | 5/4 |
| T-02 | Advanced interactive charts | done | public/chart.js, #/chart | Tick and second charts, saved chart templates | Terminal | Free | — | 5/3 |
| T-03 | Hundreds of technical indicators | partial | public/chart.js (14 built in), public/script.js (custom indicators) | A library of 100+ ready indicators with search | Terminal | Pro | — | 4/3 |
| T-04 | Custom drawing tools | partial | public/chart.js (trend line, horizontal line, box, Fibonacci; per device) | Channels, text, measure, pitchfork; drawings saved to the account, not the device | Terminal | Free | — | 3/2 |
| T-05 | Multiple synchronized charts | partial | public/chart.js (1/2/4-chart layouts) | Linked symbol, timeframe and crosshair across the panes | Terminal | Pro | — | 4/2 |
| T-06 | Level II market data | partial | public/chart.js order-book ladder (depth for crypto, top of book for stocks) | Level II for stocks needs an exchange depth license | Terminal | Elite | licensed | 3/4 |
| T-07 | Market depth visualization | partial | public/chart.js ladder | A depth chart; stock depth needs the Level II license | Terminal | Elite | licensed | 3/3 |
| T-08 | Time and sales | missing | — | The tape from the trade stream (src/streams.js), with size filters | Terminal | Pro | member | 3/2 |
| T-09 | Advanced order types | done | src/paperorders.js, src/alpaca/trading.js, public/pages/orderdesk.js, #/trade | — | Terminal | Free | — | 5/3 |
| T-10 | One-click trading | partial | public/chart.js click-to-trade | An opt-in one-click mode for paper first, step-up before live (never the default) | Terminal | Pro | — | 3/2 |
| T-11 | Options chains | done | src/optionsdesk.js, public/pages/optionsdesk.js, #/options | — | Terminal | Free | member | 5/3 |
| T-12 | Options strategy builder | done | src/options.js, public/pages/optionslab.js, #/optionslab | — | Terminal | Pro | — | 4/3 |
| T-13 | Extended-hours trading | partial | src/alpaca/trading.js (extended_hours), src/active.js | Extended hours on every broker that offers it, and in the paper simulator | Terminal | Free | — | 3/2 |
| T-14 | Multi-broker order execution | done | src/ext/brokers.js, src/brokers.js, #/brokers | — | Terminal | Free | — | 5/4 |
| T-15 | Customizable trading workspaces | done | public/app.js workspace, #/workspace | Saved to the account (today partly per device) | Terminal | Pro | — | 3/2 |
| T-16 | Trading hotkeys | missing | — (only "/" and Ctrl+K for search) | Configurable keys for buy, sell, cancel all, flatten; paper first, step-up for live | Terminal | Elite | — | 4/2 |
| T-17 | Market replay | missing | — | Replay a past session bar by bar on the chart with paper orders | Terminal | Elite | — | 3/4 |
| T-18 | Paper trading | done | src/brokers.js paper simulator, src/paperorders.js, #/trade | — | Terminal | Free | — | 5/1 |

## 2. Brightolio AI

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | AI trading copilot | done | src/chat.js, src/aitrading.js, public/pages/studio.js, #/ai | Confidence on each answer (A-19) | AI | Free | — | 5/2 |
| A-02 | AI stock research | done | src/stock.js, src/research.js, #/analyze | — | AI | Free | — | 5/2 |
| A-03 | AI portfolio analysis | done | src/pnlwhy.js, src/diversify.js, #/dashboard, #/diversify | — | AI | Pro | — | 4/2 |
| A-04 | AI-powered market scanner | partial | src/aisignals.js (nightly), #/aisignals | Scans run on demand in plain words, with the matches explained | AI | Elite | — | 4/3 |
| A-05 | AI news interpretation | done | src/sentiment.js daily brief, #/news | — | AI | Pro | — | 4/2 |
| A-06 | AI earnings analysis | done | src/intel.js earnings-call summaries, #/earnings | — | AI | Elite | — | 4/2 |
| A-07 | AI options strategy analysis | done | src/optionsdesk.js AI strategist, #/options | — | AI | Elite | — | 4/2 |
| A-08 | AI risk detection | partial | src/portfoliorisk.js, src/tradetools/aiguard.js, #/riskview | Watches for new risks on its own and alerts (concentration, drawdown, earnings ahead) | AI | Elite | — | 4/3 |
| A-09 | AI technical analysis | done | src/chartcopilot.js, src/chat.js technical_snapshot, #/chart | — | AI | Free | — | 4/2 |
| A-10 | AI fundamental analysis | done | src/stock.js AI summary, #/analyze | — | AI | Pro | — | 4/2 |
| A-11 | AI-generated daily market briefings | done | src/sentiment.js, src/newspicks.js, src/brief.js, #/brief | — | AI | Free | — | 4/2 |
| A-12 | AI trade journal analysis | partial | src/insights.js, src/extras.js coach, #/insights | An AI review of the journal: patterns, mistakes, a plan (J-06, J-12) | AI | Elite | — | 4/3 |
| A-13 | AI strategy generator | done | src/ai.js, src/playbooks.js aiBuild, #/playbooks | — | AI | Pro | — | 5/2 |
| A-14 | AI financial report reader | done | src/research.js (10-K, 10-Q from EDGAR), #/research | — | AI | Pro | — | 4/2 |
| A-15 | Conversational stock screening | partial | src/plainresearch.js, src/intel.js "ask in plain words" | One box that turns a sentence into a saved scanner and shows the rules it used | AI | Pro | — | 5/3 |
| A-16 | Voice-controlled financial assistant | done | public/pages/studio.js (browser voice), src/hotline.js, #/hotline | — | AI | Free | — | 3/2 |
| A-17 | Personalized market intelligence | partial | src/newspicks.js, src/brief.js | A feed built from the member's holdings, watchlists and interests | AI | Elite | — | 4/3 |
| A-18 | AI agents that continuously monitor investments | partial | src/ml.js, src/agentic.js, #/agents, #/agenthub | Agents that watch chosen symbols and alert with their reasons, within the plan's AI caps | AI | Elite | — | 4/3 |
| A-19 | Reasoning, sources and confidence on every AI answer | done | src/ai-evidence.js on the chat, stock summaries, Why your P/L moved, AI tools, AI morning picks and AI signals (as forecasts, never "high"), and the options desk strategist, explainer and review; shown by evidenceHtml in public/app.js | — | AI | Free | — | 5/3 |

## 3. Advanced market scanners

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | Real-time stock scanner | partial | src/scanner.js (every 5 minutes on paid plans), #/scanner | Streaming scans on live ticks (needs T-01's real-time data) | Scanner | Elite | licensed | 4/4 |
| S-02 | Premarket scanner | done | src/extscan.js, /api/scanners/extended, the premarket card on #/scanner (public/pages/build.js) | Volume for the session itself needs minute bars; consolidated (SIP) prices need the data subscription | Scanner | Pro | member | 4/2 |
| S-03 | After-hours scanner | done | src/extscan.js, /api/scanners/extended, the after-hours card on #/scanner (public/pages/build.js) | Volume for the session itself needs minute bars; consolidated (SIP) prices need the data subscription | Scanner | Pro | member | 4/2 |
| S-04 | Unusual volume scanner | partial | src/scanner.js volume rules, src/overview.js most actives | A preset with relative volume against the 20-day average | Scanner | Pro | — | 4/2 |
| S-05 | Breakout scanner | partial | src/scanner.js rules and candlestick patterns | Presets: 52-week high, range breakout, with the chart | Scanner | Pro | — | 4/2 |
| S-06 | Momentum scanner | partial | #/leaders (New leaders) | Rate-of-change and relative-strength presets | Scanner | Pro | — | 3/2 |
| S-07 | Penny stock scanner | missing | — | A preset (price under $5) with liquidity and risk warnings | Scanner | Pro | — | 3/1 |
| S-08 | Options flow scanner | partial | src/intel.js unusual flow from the chain (delay by plan) | Market-wide flow from a paid vendor needs a license; today it is per symbol from the chain | Scanner | Elite | licensed | 4/4 |
| S-09 | Unusual options activity | partial | src/intel.js | A market-wide list (S-08's license) | Scanner | Elite | licensed | 4/3 |
| S-10 | Short squeeze indicators | partial | src/shortdesk.js, src/intel.js (FINRA short volume) | Short interest (FINRA, twice a month) and days to cover in one score, labelled delayed | Scanner | Pro | delayed | 3/2 |
| S-11 | Insider buying tracker | done | src/insiders.js (EDGAR Form 4, a job every 30 minutes), /api/insiders, #/insiders (Research → Insider trades), a link from the stock page | Alerts on a watched symbol (AL-07); saved cluster presets | Scanner | Pro | delayed | 5/2 |
| S-12 | Institutional ownership tracker | partial | src/institutions.js (13F by manager), #/institutions | Per-stock ownership: which funds hold it and what changed | Intelligence | Pro | delayed | 4/3 |
| S-13 | Dividend scanner | partial | src/income.js (holdings), #/dividends | A market-wide scanner: yield, safety, growth (queue row FEAT-01) | Scanner | Pro | — | 4/2 |
| S-14 | Undervalued stock scanner | done | src/stock.js growth-at-a-price, src/plainresearch.js, #/valuescan | — | Scanner | Free | — | 4/2 |
| S-15 | Earnings scanner | partial | src/events.js, #/earnings | Upcoming and surprise scans with the reaction | Scanner | Pro | — | 3/2 |
| S-16 | Sector rotation scanner | missing | — (the sector heatmap in #/tradetools) | Relative strength of sectors over time, with the leaders in each | Scanner | Pro | — | 3/2 |
| S-17 | Cryptocurrency scanner | done | src/scanner.js (crypto at any hour), #/scanner | — | Scanner | Free | — | 3/2 |
| S-18 | Custom scanner builder | done | src/scanner.js, src/engine.js rule language, #/scanner | — | Scanner | Free | — | 5/3 |
| S-19 | Financial market heatmaps | partial | src/tradetools/math.js sector heatmap, #/tradetools | A market treemap (S&P 500 by sector and size) on the market overview | Scanner | Free | — | 4/2 |

## 4. Automated trading ecosystem

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AT-01 | No-code trading bot builder | done | src/aibots.js, src/playbooks.js, #/aibots, #/playbooks | — | AutoTrade | Free | — | 5/3 |
| AT-02 | Algorithmic trading | done | src/engine.js, src/scheduler.js, #/bots | — | AutoTrade | Pro | — | 5/3 |
| AT-03 | Automated entry and exit rules | done | src/engine.js rule language | — | AutoTrade | Free | — | 5/2 |
| AT-04 | Strategy backtesting | done | src/engine.js, src/rotation/engine.js, #/backtest | — | AutoTrade | Free | — | 5/2 |
| AT-05 | Historical market simulation | partial | the backtests (daily and intraday bars) | A tick or minute replay with fills, queue and slippage (with T-17) | AutoTrade | Ultimate | — | 3/4 |
| AT-06 | Forward testing | done | paper deployment, walk-forward (src/engine.js), #/strategies | — | AutoTrade | Free | — | 4/2 |
| AT-07 | Automated stop-loss management | done | src/engine.js stopLoss, src/risk.js | — | AutoTrade | Free | — | 5/2 |
| AT-08 | Trailing stops | done | src/engine.js trailingStop, src/paperorders.js | — | AutoTrade | Free | — | 4/2 |
| AT-09 | Automatic position sizing | done | src/tradetools/math.js, src/pairslive.js sizing, #/tradetools | — | AutoTrade | Pro | — | 4/2 |
| AT-10 | Portfolio rebalancing | done | src/rules.js, src/playbooks.js, #/rules | — | Portfolio | Pro | — | 4/2 |
| AT-11 | Webhook-triggered strategies | done | src/signals.js, #/signals | — | AutoTrade | Free | — | 4/2 |
| AT-12 | Python strategy support | partial | src/code.js (Python in the browser), src/quantconnect.js, #/code, #/quantconnect | Python strategies that run on the server's paper engine on a schedule | AutoTrade | Ultimate | — | 3/4 |
| AT-13 | Custom scripting language | done | public/script.js, src/scripts.js | — | AutoTrade | Pro | — | 4/3 |
| AT-14 | Cloud-hosted trading bots | done | src/scheduler.js, src/jobs.js, src/orderqueue.js | — | AutoTrade | Pro | — | 5/3 |
| AT-15 | Automated trading schedules | done | src/schedule-plan.js, #/schedule | — | AutoTrade | Free | — | 3/2 |
| AT-16 | Emergency shutdown controls | done | src/risk.js kill switch, #/risk | — | AutoTrade | Free | — | 5/1 |
| AT-17 | Strategy performance monitoring | done | src/insights.js by strategy, src/playbooks.js history | — | AutoTrade | Pro | — | 4/2 |
| AT-18 | Trading bot marketplace | partial | src/market.js, #/aimarket, #/sharedstrategies (free sharing) | Paid listings and revenue share wait for the legal switch (L-MP2) | Marketplace | Elite | legal | 4/4 |

## 5. Institutional financial intelligence

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I-01 | Hedge fund holdings tracker | done | src/institutions.js, #/institutions | — | Intelligence | Pro | delayed | 4/2 |
| I-02 | 13F filing analysis | done | src/institutions.js (changes since last quarter) | — | Intelligence | Pro | delayed | 4/2 |
| I-03 | Congressional stock trading tracker | missing | — | Periodic transaction reports from the House Clerk and Senate disclosure sites (public), with the filing lag shown | Intelligence | Pro | delayed | 4/2 |
| I-04 | Insider transactions | done | src/insiders.js (EDGAR Form 4, a job every 30 minutes), /api/insiders, #/insiders (Research → Insider trades), a link from the stock page | Alerts on a watched symbol (AL-07); saved cluster presets | Intelligence | Free | delayed | 5/2 |
| I-05 | SEC filings monitor | partial | src/research.js (summaries on request) | A feed of new 8-K, 10-Q, 10-K, S-1 for watched symbols with alerts | Intelligence | Pro | delayed | 4/2 |
| I-06 | Institutional ownership changes | partial | src/institutions.js | Per stock, quarter over quarter (with S-12) | Intelligence | Pro | delayed | 3/2 |
| I-07 | Dark pool data analytics | done | src/intel.js (FINRA daily Reg SHO files, free) | Weekly ATS volume per venue (FINRA, free, 2–4 weeks late) | Intelligence | Elite | delayed | 3/2 |
| I-08 | Institutional options activity | partial | src/intel.js large premium from the chain | Block and sweep detection needs a paid flow feed | Intelligence | Elite | licensed | 3/4 |
| I-09 | Analyst ratings and price targets | partial | src/stock.js (Finnhub, where the key allows) | Ratings history; the data needs a commercial-use license | Intelligence | Elite | licensed | 3/3 |
| I-10 | Short interest analytics | partial | src/intel.js short volume | Short interest twice a month from FINRA, days to cover | Intelligence | Pro | delayed | 3/2 |
| I-11 | Corporate buyback tracker | missing | — | Buyback authorizations from 8-K and 10-Q text (EDGAR) | Intelligence | Elite | delayed | 2/3 |
| I-12 | IPO tracker | done | src/events.js (Finnhub), #/calendar | — | Intelligence | Free | — | 3/2 |
| I-13 | Merger and acquisition tracker | missing | — | Deals from 8-K item 1.01/2.01 and S-4 filings | Intelligence | Elite | delayed | 2/3 |
| I-14 | Institutional capital flow analysis | missing | — | Built on 13F changes across all managers | Intelligence | Ultimate | delayed | 2/4 |
| I-15 | ETF fund flow tracking | missing | — | Shares outstanding changes × price from issuer files (free) | Intelligence | Elite | — | 3/3 |
| I-16 | Economic intelligence dashboard | partial | src/rates.js, #/rates | GDP, CPI, jobs, PMI from FRED and BLS (free) on one page | Intelligence | Free | — | 4/2 |

## 6. Complete portfolio management

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | Multiple brokerage accounts in one dashboard | done | src/consolidate.js, src/money.js, #/accounts | — | Portfolio | Free | member | 5/3 |
| P-02 | Real-time profit and loss | done | #/positions, #/dashboard | — | Portfolio | Free | member | 5/2 |
| P-03 | Historical portfolio performance | done | src/insights.js, src/longterm.js, #/longterm | — | Portfolio | Free | — | 4/2 |
| P-04 | Net worth dashboard | done | src/money.js, src/brief.js, #/money | — | Portfolio | Pro | — | 4/2 |
| P-05 | Dividend income forecasting | done | src/income.js, #/dividends | — | Portfolio | Free | — | 4/2 |
| P-06 | Portfolio diversification analysis | done | src/diversify.js, #/diversify | — | Portfolio | Free | — | 4/2 |
| P-07 | Risk exposure monitoring | done | src/portfoliorisk.js, #/riskview | — | Portfolio | Free | — | 4/2 |
| P-08 | Sector allocation | done | src/portfoliorisk.js | — | Portfolio | Free | — | 3/1 |
| P-09 | Portfolio optimization | partial | src/rotation (optimizer for strategies), #/robo | Mean-variance and risk-parity targets for the member's own holdings, as an illustration | Portfolio | Elite | — | 3/3 |
| P-10 | Tax-loss harvesting analysis | done | src/taxpilot.js, #/taxpilot | — | Portfolio | Elite | — | 4/2 |
| P-11 | Capital gains tracking | done | src/tax.js, #/tax | — | Portfolio | Free | — | 4/2 |
| P-12 | Retirement planning | done | src/retirement.js, #/retirement | — | Portfolio | Free | — | 3/2 |
| P-13 | Benchmark comparisons | done | src/longterm.js, src/insights.js | — | Portfolio | Free | — | 3/1 |
| P-14 | Portfolio stress testing | done | src/portfoliorisk.js | — | Portfolio | Pro | — | 4/2 |
| P-15 | Investment scenario simulations | done | src/insights.js what-if, src/sp500.js, #/sp500 | — | Portfolio | Free | — | 3/2 |
| P-16 | Tax reporting exports | done | src/books.js, src/statement.js, #/books | — | Portfolio | Elite | — | 4/2 |

## 7. Financial news and intelligence center

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N-01 | Breaking financial news | done | src/sentiment.js (broker news feed), #/news | — | Intelligence | Free | member | 4/2 |
| N-02 | Company-specific news feeds | done | #/news, #/analyze | — | Intelligence | Free | member | 4/2 |
| N-03 | Economic calendars | partial | src/events.js, #/calendar | Economic releases (CPI, jobs, GDP) with consensus and actual | Intelligence | Free | — | 4/2 |
| N-04 | Earnings calendars | done | src/events.js, #/calendar, #/earnings | — | Intelligence | Free | — | 4/2 |
| N-05 | Dividend calendars | partial | src/income.js (ex-dates of holdings) | A market-wide ex-dividend calendar | Intelligence | Free | — | 3/2 |
| N-06 | Federal Reserve announcements | partial | src/rates.js | FOMC dates, statements and the rate decision on the calendar | Intelligence | Free | — | 3/2 |
| N-07 | Live earnings call transcripts | partial | src/intel.js (paste a transcript to summarize) | Live transcripts need a licensed provider | Intelligence | Elite | licensed | 3/4 |
| N-08 | AI-generated news summaries | done | src/sentiment.js | — | AI | Pro | — | 4/2 |
| N-09 | News sentiment analysis | done | src/sentiment.js | — | Intelligence | Pro | — | 3/2 |
| N-10 | Social media sentiment tracking | done | src/sentiment.js (StockTwits) | — | Intelligence | Pro | — | 3/2 |
| N-11 | Global economic events | missing | — | Central banks and major releases worldwide on the calendar | Intelligence | Pro | — | 2/3 |
| N-12 | Personalized financial newsletters | partial | src/brief.js weekly brief | A daily email or in-app letter built from the member's holdings (opt-in) | Intelligence | Pro | — | 3/2 |
| N-13 | Real-time news alerts | missing | — | A headline about a watched symbol sends an alert (with AL-05) | Intelligence | Pro | member | 4/2 |
| N-14 | Historical news archives | missing | — | Search past headlines per symbol (from the broker news API's history) | Intelligence | Elite | member | 2/3 |
| N-15 | Geopolitical risk monitoring | missing | — | A risk index from news topics, explained, never a prediction | Intelligence | Elite | — | 2/4 |

## 8. Advanced options trading

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O-01 | Real-time options chains | done | src/optionsdesk.js, #/options | Real time depends on the member's feed (OPRA license otherwise) | Terminal | Free | member | 5/3 |
| O-02 | Options profit and loss calculator | done | src/options.js payoff, #/optionslab | — | Terminal | Free | — | 4/2 |
| O-03 | Options Greeks visualization | done | src/optionsdesk.js (every Greek, portfolio Greeks) | — | Terminal | Pro | — | 4/2 |
| O-04 | Implied volatility analytics | partial | src/optionsdesk.js (IV per contract, expected move) | IV rank and percentile from IV history | Terminal | Elite | — | 4/3 |
| O-05 | Probability analysis | done | src/optionsdesk.js (chance in the money, of profit) | — | Terminal | Pro | — | 4/2 |
| O-06 | Multi-leg strategy builder | done | src/options.js templates, #/optionslab | — | Terminal | Pro | — | 4/3 |
| O-07 | Options expiration analytics | partial | src/optionsdesk.js expected move per expiration | Max pain and open interest by strike per expiration | Terminal | Elite | — | 3/2 |
| O-08 | Gamma exposure analysis | missing | — | Dealer gamma by strike from open interest (an estimate, labelled so) | Terminal | Ultimate | — | 3/3 |
| O-09 | Options liquidity analysis | partial | src/optionsdesk.js bid/ask and open interest | A liquidity score per contract with a warning on wide spreads | Terminal | Pro | — | 3/2 |
| O-10 | Strategy simulations | done | src/options.js what-if curves | — | Terminal | Pro | — | 3/2 |
| O-11 | Covered call scanner | done | src/options.js, #/optionslab | — | Scanner | Elite | — | 3/2 |
| O-12 | Cash-secured put scanner | done | src/options.js, #/optionslab | — | Scanner | Elite | — | 3/2 |
| O-13 | Options risk management | done | src/optionsdesk.js portfolio Greeks, src/risk.js | — | Terminal | Pro | — | 4/2 |
| O-14 | Volatility surface visualization | missing | — | A 3-D or heatmap surface of IV by strike and expiration | Terminal | Ultimate | — | 2/3 |

## 9. Fundamental research terminal

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Company financial statements | done | src/stock.js, src/fundamentals.js (SEC XBRL), #/analyze | — | Intelligence | Free | delayed | 5/3 |
| F-02 | Balance sheets | partial | src/fundamentals.js (key figures) | The full statement, 10 years, quarterly and annual | Intelligence | Pro | delayed | 4/2 |
| F-03 | Income statements | partial | src/fundamentals.js | The full statement, 10 years | Intelligence | Pro | delayed | 4/2 |
| F-04 | Cash flow statements | partial | src/fundamentals.js | The full statement, 10 years | Intelligence | Pro | delayed | 4/2 |
| F-05 | Historical financial ratios | done | src/stock.js (5 years) | — | Intelligence | Pro | — | 4/2 |
| F-06 | Revenue forecasts | partial | src/stock.js (EPS estimates where Finnhub allows) | Consensus revenue needs a licensed estimates feed | Intelligence | Elite | licensed | 3/3 |
| F-07 | Valuation calculators | partial | src/stock.js valuation against its own history | Multiples and a fair-value range the member can change (with F-08) | Intelligence | Pro | — | 4/2 |
| F-08 | Discounted cash flow models | missing | — | A DCF with the member's inputs, defaults from filings, labelled an illustration | Intelligence | Pro | — | 4/2 |
| F-09 | Competitor comparisons | done | #/compare | — | Intelligence | Free | — | 4/2 |
| F-10 | Company financial health scores | partial | src/income.js dividend safety | Piotroski F-score and Altman Z from filings, explained | Intelligence | Pro | — | 4/2 |
| F-11 | Industry analysis | partial | src/fundamentals.js industry, src/stock.js sector | Industry pages with peers and their figures | Intelligence | Pro | — | 3/3 |
| F-12 | Earnings history | done | src/stock.js (8-K dates, EPS) | — | Intelligence | Free | — | 3/1 |
| F-13 | Corporate management profiles | missing | — | Officers and directors from proxy and Form 3/4 filings | Intelligence | Elite | delayed | 2/3 |
| F-14 | Global company database | partial | src/search.js (US listings and funds) | Companies outside the US need a licensed feed | Intelligence | Ultimate | licensed | 3/5 |
| F-15 | Custom fundamental screening | done | src/plainresearch.js, #/valuescan | — | Scanner | Free | — | 4/2 |

## 10. Global multi-asset platform

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M-01 | Stocks | done | #/trade | — | Terminal | Free | — | 5/1 |
| M-02 | Options | done | #/options | — | Terminal | Free | — | 5/1 |
| M-03 | Cryptocurrency | done | Alpaca crypto, #/trade | — | Terminal | Free | — | 4/1 |
| M-04 | Futures | partial | src/instruments.js, #/invest | Research and quotes; trading only where the member's broker offers futures | Terminal | Elite | member | 3/4 |
| M-05 | Forex | partial | #/currencies | Quotes and conversion; trading through a broker that offers it | Terminal | Elite | member | 2/4 |
| M-06 | ETFs | done | #/trade, #/lowcost | — | Terminal | Free | — | 5/1 |
| M-07 | Bonds | partial | #/alpaca-tools (bonds, rates) | Bond search and yields beyond Treasuries | Terminal | Pro | member | 3/3 |
| M-08 | Commodities | partial | through ETFs and futures (#/invest) | A commodities page with the main contracts | Terminal | Pro | — | 2/3 |
| M-09 | REITs | partial | src/fundamentals.js, src/invest.js | REIT metrics (FFO, payout) | Terminal | Pro | — | 2/2 |
| M-10 | Mutual funds | partial | src/search.js, #/lowcost | Fund pages with costs and holdings (N-PORT, free) | Terminal | Free | delayed | 3/2 |
| M-11 | Global indexes | partial | src/overview.js (US indexes) | Major world indexes on the overview | Terminal | Free | — | 3/2 |
| M-12 | Fixed income | partial | #/alpaca-tools, #/rates | Treasury ladder and yield curve tools | Terminal | Pro | — | 2/3 |

## 11. Brightolio Social

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SO-01 | Investor profiles | done | src/profiles.js, public/pages/profile.js | — | Social | Free | — | 3/2 |
| SO-02 | Trader communities | partial | src/fleet.js signal channels, #/signalchannels | Community spaces with moderation and reporting | Social | Free | — | 3/4 |
| SO-03 | Public and private groups | missing | — | Groups with owners, invites and moderation | Social | Pro | — | 2/4 |
| SO-04 | Direct messaging | missing | — | Member-to-member messages with blocking and reporting | Social | Pro | — | 2/4 |
| SO-05 | Live trading discussion rooms | missing | — | Rooms on the live channel (SSE), moderated | Social | Elite | — | 2/4 |
| SO-06 | Verified trader performance | done | src/profiles.js (real results, one day late), #/traders | — | Social | Free | — | 4/3 |
| SO-07 | Shareable trading charts | partial | public/chart.js snapshots | A public link to a chart image with the disclosures | Social | Free | — | 3/2 |
| SO-08 | Published investment research | missing | — | Member posts with the "not advice" line and moderation | Social | Pro | legal | 2/3 |
| SO-09 | Community indicators | partial | public/script.js sharing in the marketplace | A gallery of shared indicators | Social | Free | — | 3/2 |
| SO-10 | Strategy sharing | done | src/market.js, #/sharedstrategies, #/sharedportfolios | — | Social | Free | — | 4/2 |
| SO-11 | Copy trading through compliant arrangements | partial | src/fleet.js, src/playbooks.js (paper or approve each trade; real-money automatic copy only in adviser mode) | Real-money copy waits for the legal switch (L-MP1) | Social | Elite | legal | 4/4 |
| SO-12 | Paper trading competitions | missing | — | Monthly paper contests with risk-adjusted ranking, no prizes in money until reviewed | Social | Free | — | 3/2 |
| SO-13 | Paid creator memberships | missing | — | Paid memberships that give trade ideas wait for the legal switch (L-MP2) | Social | Elite | legal | 3/4 |
| SO-14 | Expert livestreams | missing | — | Embedded live video with a moderated chat | Social | Elite | legal | 2/4 |

## 12. Brightolio Marketplace

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MK-01 | Premium indicators | missing | — | Paid indicator listings (no trade ideas, so no legal switch), revenue share | Marketplace | Pro | — | 3/4 |
| MK-02 | Trading strategies | partial | src/market.js (free sharing), #/marketplace | Paid strategy listings wait for the legal switch (L-MP2) | Marketplace | Elite | legal | 4/4 |
| MK-03 | Automated trading bots | partial | #/aimarket | Paid bot listings wait for the legal switch (L-MP2) | Marketplace | Elite | legal | 4/4 |
| MK-04 | Professional research reports | missing | — | Paid reports by vetted authors wait for the legal switch | Marketplace | Elite | legal | 2/4 |
| MK-05 | Custom dashboards | missing | — | Shareable dashboard layouts | Marketplace | Pro | — | 2/3 |
| MK-06 | Premium scanners | missing | — | Shared and paid scanner presets | Marketplace | Pro | — | 3/3 |
| MK-07 | Trading education courses | missing | — | Paid courses by instructors (AC-11) | Academy | Pro | — | 2/4 |
| MK-08 | Financial newsletters | missing | — | Paid newsletters wait for the legal switch (they can give trade ideas) | Marketplace | Pro | legal | 2/4 |
| MK-09 | Third-party integrations | partial | TradingView webhooks (src/signals.js), QuickBooks, Plaid, QuantConnect | An integrations directory with install and remove | Marketplace | Free | — | 3/3 |
| MK-10 | Custom AI financial agents | partial | src/mcp.js, src/agentic.js, #/agenthub | Listing third-party agents, within the AI caps | Marketplace | Elite | — | 3/4 |
| MK-11 | Marketplace reviews | missing | — | Verified-purchase reviews only (never invented ones), with reporting | Marketplace | Free | — | 2/2 |
| MK-12 | Creator revenue dashboards | missing | — | Sales, refunds and payouts (Stripe Connect, test mode) | Marketplace | Pro | — | 2/3 |
| MK-13 | Developer publishing tools | partial | publish with a backtest (src/playbooks.js) | Versioned listings, review queue, payouts | Marketplace | Pro | — | 2/3 |

## 13. Brightolio Academy

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AC-01 | Beginner investing courses | partial | #/learn, public/pages/guides.js | Structured courses with lessons in order and progress | Academy | Free | — | 4/3 |
| AC-02 | Advanced trading courses | partial | public/pages/guides-more.js | Structured advanced tracks | Academy | Pro | — | 3/3 |
| AC-03 | Options education | partial | src/lessons.js (unlock lessons) | A full options course | Academy | Free | — | 3/2 |
| AC-04 | Technical analysis training | partial | #/learn glossary and guides | A course with chart exercises | Academy | Free | — | 3/2 |
| AC-05 | Fundamental analysis training | partial | #/learn | A course built on the research pages | Academy | Free | — | 3/2 |
| AC-06 | Risk management courses | partial | src/lessons.js risk notices | A course tied to the risk limits | Academy | Free | — | 3/2 |
| AC-07 | Interactive examinations | partial | src/lessons.js (questions before high-risk instruments) | Quizzes per course with a score | Academy | Free | — | 3/2 |
| AC-08 | AI financial tutor | partial | #/ai (explains) | A tutor mode that teaches and quizzes, within the AI caps | Academy | Pro | — | 4/2 |
| AC-09 | Practice trading accounts | done | the paper account | — | Academy | Free | — | 5/1 |
| AC-10 | Educational market simulations | partial | #/ofi lab sample, #/sp500 projection | Guided scenarios on the paper account (a crash, a rally) | Academy | Free | — | 3/3 |
| AC-11 | Professional instructor marketplace | missing | — | Instructors publish courses (MK-07) | Academy | Pro | — | 2/4 |
| AC-12 | Course completion certificates | missing | — | A certificate page per finished course (not a license or credential) | Academy | Free | — | 2/2 |

## 14. Professional trade journal

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J-01 | Automatic trade imports | done | src/insights.js automatic journal (every connected account) | — | Portfolio | Free | member | 4/2 |
| J-02 | Trading performance analytics | done | src/insights.js, #/insights | — | Portfolio | Free | — | 4/2 |
| J-03 | Win and loss statistics | done | src/insights.js round trips | — | Portfolio | Free | — | 4/1 |
| J-04 | Trading psychology journal | missing | — | A note, mood and plan per trade, private to the member | Portfolio | Pro | — | 3/2 |
| J-05 | Risk-to-reward calculations | done | src/tradetools/math.js, #/tradetools | — | Portfolio | Free | — | 3/1 |
| J-06 | Trading mistake detection | partial | src/extras.js coach | Rules that flag oversizing, no stop, revenge trades | Portfolio | Elite | — | 4/3 |
| J-07 | Best-performing strategies | done | src/insights.js P/L by strategy | — | Portfolio | Free | — | 3/1 |
| J-08 | Time-of-day performance | missing | — | P/L by hour and weekday from the journal | Portfolio | Pro | — | 4/2 |
| J-09 | AI performance coaching | partial | src/extras.js coach | An AI review with the data it used and its confidence | AI | Elite | — | 4/3 |
| J-10 | Daily trading reports | partial | src/brief.js (weekly) | An end-of-day report (opt-in) | Portfolio | Pro | — | 3/2 |
| J-11 | Historical trade replay | missing | — | A trade drawn on the chart of its day | Portfolio | Elite | — | 3/3 |
| J-12 | Personalized trading improvement plans | missing | — | A plan from J-06 and J-09 with goals the member sets | AI | Elite | — | 3/3 |

## 15. Advanced alerts and monitoring

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AL-01 | Price alerts | done | src/scheduler.js, src/streams.js (on the tick), #/schedule | — | Scanner | Free | — | 5/1 |
| AL-02 | Volume alerts | partial | src/scanner.js volume rules | A one-tap volume spike alert | Scanner | Pro | — | 3/2 |
| AL-03 | Technical indicator alerts | done | src/scanner.js rules, src/scripts.js alerts | — | Scanner | Pro | — | 4/2 |
| AL-04 | Options activity alerts | missing | — | Alerts on unusual flow for watched symbols (S-08 data) | Scanner | Elite | licensed | 3/3 |
| AL-05 | News alerts | missing | — | A headline on a watched symbol alerts (N-13) | Scanner | Pro | member | 4/2 |
| AL-06 | Portfolio risk alerts | partial | src/risk.js limits | Alerts on drawdown, concentration and margin before limits trip | Portfolio | Pro | — | 4/2 |
| AL-07 | Insider transaction alerts | missing | — | Form 4 on a watched symbol alerts (I-04) | Intelligence | Pro | delayed | 3/2 |
| AL-08 | Custom conditional alerts | done | src/scripts.js, src/scanner.js | — | Scanner | Pro | — | 4/2 |
| AL-09 | AI-generated event alerts | partial | src/aisignals.js | Alerts with the AI's reason and confidence (A-18) | AI | Elite | — | 3/3 |
| AL-10 | Email notifications | done | src/notify-user.js | — | Scanner | Free | — | 4/1 |
| AL-11 | SMS notifications | done | src/notify-user.js (paid plans with a verified phone) | — | Scanner | Pro | — | 3/1 |
| AL-12 | Mobile push notifications | done | src/webpush.js (VAPID, RFC 8291), public/sw.js, Settings → Notifications (public/pages/push.js), src/notify-user.js | — | Apps | Free | — | 5/2 |
| AL-13 | Webhook integrations | done | src/signals.js | — | Developer Cloud | Free | — | 4/2 |
| AL-14 | Automated daily reports | partial | src/brief.js weekly | A daily report option (J-10) | Portfolio | Pro | — | 3/2 |

## 16. Brightolio Enterprise

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | Hedge fund dashboards | missing | — | Fund-level P/L, exposure and risk across accounts | Enterprise | Institutional | — | 3/4 |
| E-02 | Financial adviser portals | partial | adviser mode (src/admin-site.js, RIA steps) | Client households, billing and reports; only with the owner's registration (legal) | Enterprise | Institutional | legal | 3/5 |
| E-03 | Institutional portfolio management | partial | src/consolidate.js, src/rules.js | Models across many client accounts | Enterprise | Institutional | — | 3/4 |
| E-04 | Multi-user workspaces | missing | — | Teams that share watchlists, strategies and research | Enterprise | Institutional | — | 3/4 |
| E-05 | Client management | missing | — | A client list with accounts and notes (adviser mode) | Enterprise | Institutional | legal | 2/4 |
| E-06 | Custom financial reporting | partial | src/statement.js PDF statements | Report builder with the firm's branding | Enterprise | Institutional | — | 2/3 |
| E-07 | Order management systems | partial | src/orderqueue.js durable queue | Blotter, staging, approvals across users | Enterprise | Institutional | — | 2/5 |
| E-08 | Execution management systems | partial | src/execution.js smart routing | Algorithms (TWAP, VWAP) and broker selection per order | Enterprise | Institutional | — | 2/5 |
| E-09 | Institutional risk management | partial | src/risk.js per user | Firm-wide limits across users and accounts | Enterprise | Institutional | — | 3/4 |
| E-10 | Compliance monitoring | partial | src/tradetools compliance log, audit_log | Surveillance reports and reviews for the firm | Enterprise | Institutional | — | 2/4 |
| E-11 | Trade allocation | partial | src/equalize.js, src/rules.js | Block orders allocated across accounts by rule | Enterprise | Institutional | — | 2/4 |
| E-12 | Professional data exports | partial | CSV exports on several pages | Scheduled exports of every table, API-backed | Enterprise | Elite | — | 3/2 |
| E-13 | Role-based permissions | partial | admin and member roles (src/db.js) | Custom roles per team | Enterprise | Institutional | — | 3/3 |
| E-14 | White-label trading platforms | missing | — | Branding and domain per firm | Enterprise | Institutional | — | 2/5 |
| E-15 | Enterprise API access | partial | src/apiv1.js | Higher limits and SLAs per contract (DEV-01) | Developer Cloud | Institutional | — | 3/3 |
| E-16 | Dedicated infrastructure | missing | — | A separate server per firm (deploy/ scripts per tenant) | Enterprise | Institutional | — | 1/5 |
| E-17 | Single sign-on | partial | Google and GitHub sign-in (src/google.js, src/github.js) | SAML and OpenID Connect per firm | Enterprise | Institutional | — | 3/3 |
| E-18 | Institutional audit trails | partial | audit_log (src/db.js), Admin → Security log | Exportable, tamper-evident audit per firm | Enterprise | Institutional | — | 3/3 |

## 17. Brightolio Developer Cloud

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | Financial data APIs | partial | src/apiv1.js | Market data through the API needs redistribution rights (only the member's own data or free sources) | Developer Cloud | Elite | licensed | 3/3 |
| D-02 | Real-time WebSocket feeds | missing | — (the app's own SSE channel is internal) | A public stream for API keys, licensed data only | Developer Cloud | Ultimate | licensed | 2/4 |
| D-03 | Historical market data APIs | partial | src/apiv1.js backtests | Raw bars through the API need redistribution rights | Developer Cloud | Elite | licensed | 2/3 |
| D-04 | Financial research APIs | partial | src/apiv1.js, src/mcp.js | Endpoints for filings, 13F, scores (free sources) | Developer Cloud | Elite | delayed | 3/2 |
| D-05 | Strategy development SDK | missing | — | A small JavaScript and Python client for /api/v1 | Developer Cloud | Elite | — | 3/3 |
| D-06 | Developer documentation | done | #/developers | — | Developer Cloud | Free | — | 3/1 |
| D-07 | API usage dashboards | missing | — | Calls per key and day against the plan's limit (DEV-01) | Developer Cloud | Elite | — | 3/2 |
| D-08 | Paid API subscriptions | missing | — | Per-plan API limits and metering (DEV-01) | Developer Cloud | Elite | — | 4/3 |
| D-09 | Custom financial applications | partial | API keys with scopes, src/mcp.js | OAuth apps for third parties | Developer Cloud | Ultimate | — | 2/4 |
| D-10 | Third-party plugin framework | missing | — | Sandboxed plugins for pages and charts | Developer Cloud | Ultimate | — | 2/5 |
| D-11 | Developer sandbox | partial | the paper account through /api/v1 | Test keys that can only reach paper, documented | Developer Cloud | Free | — | 3/2 |
| D-12 | AI financial intelligence API | partial | src/mcp.js (Brightolio as an MCP server) | Metered AI endpoints within the $0 caps | Developer Cloud | Elite | — | 3/3 |

## 18. Mobile and desktop ecosystem

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AP-01 | Android application | done | android/, #/android | — | Apps | Free | — | 4/1 |
| AP-02 | iPhone application | partial | public/manifest.webmanifest, public/sw.js, public/pages/push.js install guide on #/android | Installable from Safari with push and offline watchlists (APP-02); a native iPhone app is the later row NATIVE-01 | Apps | Free | — | 4/2 |
| AP-03 | Windows application | partial | public/manifest.webmanifest, public/sw.js, public/pages/push.js install guide on #/android | Installable from Edge and Chrome (APP-02); a desktop wrapper is the later row NATIVE-01 | Apps | Free | — | 4/2 |
| AP-04 | Mac application | partial | public/manifest.webmanifest, public/sw.js, public/pages/push.js install guide on #/android | Installable from Safari, Chrome and Edge (APP-02); a desktop wrapper is the later row NATIVE-01 | Apps | Free | — | 4/2 |
| AP-05 | Tablet-optimized interface | partial | public/site.css responsive layout | A two-pane layout at tablet widths | Apps | Free | — | 3/2 |
| AP-06 | Synchronized watchlists | done | watchlists on the server, #/watchlists; offline copy in public/sw.js | — | Apps | Free | — | 4/1 |
| AP-07 | Cloud-saved workspaces | partial | #/workspace | Layouts and drawings saved to the account | Apps | Pro | — | 3/2 |
| AP-08 | Mobile trading widgets | missing | — | Home-screen widgets (Android first) | Apps | Pro | — | 2/3 |
| AP-09 | Biometric authentication | done | passkeys (src/security.js, WebAuthn) | — | Apps | Free | — | 4/1 |
| AP-10 | Multi-monitor desktop support | done | public/chart.js pop-out windows | — | Apps | Elite | — | 3/1 |
| AP-11 | Cross-device notifications | done | push on every device that turned it on (src/webpush.js), email and SMS (src/notify-user.js) | — | Apps | Free | — | 4/2 |
| AP-12 | Custom themes and layouts | done | public/app.js themes (light, dark, system) | — | Apps | Free | — | 2/1 |

## 19. Security and infrastructure

| ID | Feature | Status | Where | Missing to be professional | Product | Tier | Flag | V/E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | Two-factor authentication and passkeys | done | src/auth.js TOTP, src/security.js passkeys, src/mfa-policy.js, #/security | — | Security | Free | — | 5/1 |
| SEC-02 | Encrypted financial information | done | src/crypto.js (AES-256-GCM for broker keys at rest), src/keystore.js | — | Security | Free | — | 5/1 |
| SEC-03 | Secure brokerage connections | done | OAuth and encrypted keys (src/ext/brokers.js) | — | Security | Free | — | 5/1 |
| SEC-04 | Fraud detection | partial | Stripe checks, sign-in lockout and rate limits (src/auth.js) | Signals on unusual sign-ins and withdrawals, with review | Security | Free | — | 3/3 |
| SEC-05 | Account activity monitoring | done | sessions and sign-in history (src/security.js), #/security | — | Security | Free | — | 4/1 |
| SEC-06 | DDoS protection | partial | rate limits, load shedding (src/reliability.js), the optional Cloudflare edge (edge/) | The edge switched on for the main address | Security | Free | — | 4/2 |
| SEC-07 | Automated backups | done | src/backup.js | — | Security | Free | — | 5/1 |
| SEC-08 | Disaster recovery | partial | restore workflow (MIGRATION_ORACLE.md) | A tested restore drill on a schedule | Security | Free | — | 4/2 |
| SEC-09 | High-availability infrastructure | partial | one Oracle VM, cluster per CPU (src/bus.js) | A second server and failover | Security | Free | — | 3/4 |
| SEC-10 | Real-time system monitoring | done | src/trust.js status, /healthz, the deep check | — | Security | Free | — | 4/1 |
| SEC-11 | Market data validation | partial | stale checks and source labels (src/desk.js, src/datasources.js) | Cross-checks between sources with an alert on a bad print | Security | Free | — | 4/2 |
| SEC-12 | Duplicate order prevention | done | idempotency keys, the order queue claim (src/orderqueue.js) | — | Security | Free | — | 5/1 |
| SEC-13 | Automated security testing | done | release-gates.yml (audit, secrets scan), the test suite | — | Security | Free | — | 4/1 |
| SEC-14 | User permission management | partial | admin and member roles | Roles per team (E-13) | Security | Free | — | 3/3 |
| SEC-15 | Regulatory reporting infrastructure | missing | — | Only if Brightolio registers (Phase 6); the owner decides | Security | Institutional | legal | 1/5 |
| SEC-16 | Market data licensing and access controls | partial | data delay by plan (src/aiplans.js: end of day, 15-minute delay, real time) | A source-by-source license table and "delayed" labels everywhere (see Data sources) | Security | Free | licensed | 4/2 |
| SEC-17 | Subscription and billing management | done | src/fees.js, src/prices.js (Admin → Prices, #/admin-prices), src/stripe-client.js, #/funding (Stripe test mode) | Live billing waits for the owner; every price is entered by the owner | Security | Free | — | 5/2 |
| SEC-18 | Customer support administration | done | Admin → Support inbox (#/admin-support) | — | Security | Free | — | 4/1 |

## Data sources and their terms

Free and allowed sources first; a licensed source is used only with the member's own subscription, or after the owner signs a license (OWN-06). Delayed data is labelled delayed.

| Source | What | Terms (summary, checked 2026-11-26) | Flag |
| --- | --- | --- | --- |
| SEC EDGAR | Filings, XBRL facts, 13F, Form 3/4/5, N-PORT | Public domain; fair access: under 10 requests a second with a User-Agent naming the app | delayed |
| FINRA Reg SHO daily files | Short sale volume by venue | Free, end of day | delayed |
| FINRA short interest | Short interest twice a month | Free, published about a week after the settlement date | delayed |
| FINRA ATS transparency | Weekly off-exchange (dark-pool) volume per venue | Free, 2–4 weeks late | delayed |
| House Clerk and Senate eFD | Members' periodic transaction reports | Public; reported up to 45 days after the trade | delayed |
| FRED, BLS | Economic series | Free with attribution | — |
| The member's broker (Alpaca, Schwab, tastytrade, Tradier, TradeStation) | Quotes, bars, news, positions, orders | The member's own feed under their broker agreement; not redistributed to others | member |
| Alpaca market data (the site's keys) | IEX real time; SIP with a paid subscription | IEX is free; SIP shown to paying users needs the subscription and exchange agreements | licensed |
| Finnhub, Twelve Data, Alpha Vantage, FMP, Tiingo, Polygon (free tiers) | Quotes, history, earnings, estimates | Free tiers are mostly for personal or evaluation use; commercial display needs their paid plan | licensed |
| Yahoo Finance, Stooq | Daily history fallback | Not licensed for commercial redistribution; a fallback only, to be replaced before paying customers rely on it | licensed |
| StockTwits | Social sentiment | API terms require attribution; commercial use under their terms | — |
| OPRA (options) | Real-time options | Through the member's broker only; a direct feed needs an OPRA license | licensed |

## Every page

Every page and route of the app, with the registry rows it serves (the test fails when one is missing). Route names are the address after `#/`; files are in public/pages/.

| Page | Rows |
| --- | --- |
| #/dashboard | P-02, A-03 |
| #/start | AC-01 |
| #/trade | T-09, T-18, M-01 |
| #/positions | P-02 |
| #/orders | T-09 |
| #/watchlists | AP-06 |
| #/markets | S-19, M-11 |
| #/analyze | A-02, F-01 |
| #/earnings | A-06, S-15 |
| #/compare | F-09 |
| #/research | A-14 |
| #/news | N-01, N-09 |
| #/intel | I-07, S-08 |
| #/institutions | I-01, I-02 |
| #/insiders | I-04, S-11 |
| #/rates | I-16, N-06 |
| #/scanner | S-18, S-17 |
| #/leaders | S-06 |
| #/valuescan | S-14, F-15 |
| #/ai | A-01, A-16 |
| #/aitools | A-15 |
| #/calendar | N-03, N-04, I-12 |
| #/active | T-13 |
| #/chart | T-02, T-03, T-04, T-05 |
| #/options | T-11, O-01 |
| #/optionslab | T-12, O-02, O-06 |
| #/short | S-10 |
| #/tradetools | AT-09, J-05, S-19 |
| #/workspace | T-15, AP-07 |
| #/text | A-16 |
| #/hotline | A-16 |
| #/wealth | P-15 |
| #/sp500 | P-15 |
| #/lowcost | M-06, M-10 |
| #/passive | P-06 |
| #/dividends | P-05, S-13 |
| #/portfolios | AT-10 |
| #/robo | P-09 |
| #/aifunds | A-17 |
| #/rules | AT-10 |
| #/invest | M-04, M-08 |
| #/alpaca-tools | M-07, M-12 |
| #/tokenized | M-01 |
| #/values | S-18 |
| #/spend | P-04 |
| #/strategies | AT-04, AT-06 |
| #/strategy | AT-04 |
| #/playbooks | AT-01, A-13 |
| #/playbook | AT-01 |
| #/backtest | AT-04 |
| #/bots | AT-02 |
| #/aibots | AT-01 |
| #/agents | A-18 |
| #/intraday | AT-02 |
| #/signals | AT-11 |
| #/aisignals | A-04, AL-09 |
| #/fleet | SO-11 |
| #/newspicks | A-11 |
| #/schedule | AT-15, AL-01 |
| #/pairs | AT-02 |
| #/statarb | AT-02 |
| #/livepairs | AT-02 |
| #/ofi | AC-10 |
| #/marketplace | MK-02 |
| #/traders | SO-06 |
| #/aimarket | AT-18, MK-03 |
| #/sharedstrategies | SO-10 |
| #/sharedportfolios | SO-10 |
| #/signalchannels | SO-02 |
| #/developers | D-06 |
| #/agenthub | MK-10, D-12 |
| #/code | AT-12 |
| #/quantconnect | AT-12 |
| #/alpaca-dev | D-11 |
| #/insights | J-01, J-02 |
| #/longterm | P-03 |
| #/execution | E-08 |
| #/riskview | P-07 |
| #/risk | AT-16 |
| #/margin | P-07 |
| #/diversify | P-06 |
| #/tax | P-11 |
| #/taxpilot | P-10 |
| #/money | P-04 |
| #/private | P-04 |
| #/currencies | M-05 |
| #/retirement | P-12 |
| #/brief | A-11 |
| #/accounts | P-01 |
| #/brokers | T-14 |
| #/account | P-01 |
| #/funding | SEC-17 |
| #/referrals | SEC-17 |
| #/learn | AC-01 |
| #/security | SEC-01, SEC-05 |
| #/protection | SEC-03 |
| #/android | AP-01 |
| #/settings | AP-12 |
| #/business | E-06 |
| #/invoices | E-06 |
| #/books | P-16 |
| #/bank | P-04 |
| #/inventory | E-06 |
| #/payroll | E-06 |
| #/bizreports | E-06 |
| #/halal | S-18 |
| #/luach | N-03 |
| #/admin | SEC-18 |
| #/admin-users | SEC-14 |
| #/admin-admins | SEC-14 |
| #/admin-support | SEC-18 |
| #/admin-comms | SEC-18 |
| #/admin-phone | A-16 |
| #/admin-phoneaccts | A-16 |
| #/admin-money | SEC-17 |
| #/admin-prices | SEC-17 |
| #/admin-sponsored | N-01 |
| #/admin-upgrades | E-02 |
| #/admin-readme | D-06 |
| #/admin-seo | SEC-18 |
| #/admin-strategies | SO-10 |
| #/admin-trust | SEC-10 |
| #/admin-agents | A-18 |
| #/admin-ai | A-19 |
| #/admin-aichat | A-01 |
| #/admin-routing | E-08 |
| #/admin-keys | SEC-02 |
| #/admin-security | SEC-01 |
| #/admin-data | SEC-16, T-01 |
| #/admin-hosting | SEC-09 |
| #/admin-database | SEC-07 |
| #/admin-setup | SEC-17 |
| #/admin-analytics | SEC-17 |
| #/admin-alpaca | T-14 |
| #/admin-business | E-02 |

| Page file (public/pages/) | Rows |
| --- | --- |
| addons.js | AP-12 |
| admin-ops.js | SEC-10 |
| aichat.js | A-01 |
| aitools.js | A-15 |
| aitrade.js | A-04 |
| altlive.js | P-04 |
| alts.js | P-04 |
| analytics-admin.js | SEC-17 |
| analytics.js | P-03 |
| bell.js | AL-01 |
| brokers.js | T-14 |
| build.js | AT-01 |
| business.js | E-06 |
| chatmd.js | A-01 |
| clock.js | N-03 |
| combined.js | P-01 |
| comms.js | SEC-18 |
| extras.js | J-06 |
| glossary.js | AC-04 |
| growth.js | S-14 |
| guides-more.js | AC-02 |
| guides.js | AC-01 |
| insiders.js | I-04, S-11 |
| instruments.js | M-04 |
| invest.js | M-04 |
| luach.js | N-03 |
| money.js | P-04 |
| ofilab.js | AC-10 |
| optionsdesk.js | O-01 |
| optionslab.js | O-06 |
| orderdesk.js | T-09 |
| owner.js | SEC-18 |
| pairs.js | AT-02 |
| playbooks.js | AT-01 |
| pnlwhy.js | A-03 |
| profile.js | SO-01 |
| push.js | AL-12, AP-02 |
| protect.js | SEC-01 |
| retirement.js | P-12 |
| riskpages.js | P-07 |
| rules.js | AT-10 |
| search.js | F-14 |
| signals.js | AT-11 |
| simple.js | AC-01 |
| social.js | SO-06 |
| sp500.js | P-15 |
| sponsored.js | N-01 |
| start.js | AC-01 |
| stock.js | F-01 |
| strategies.js | AT-04 |
| studio.js | A-01 |
| tools.js | AT-09 |
| tradetools.js | J-05 |
| trading.js | T-09, T-18 |
| trust-admin.js | SEC-10 |
| voice-admin.js | A-16 |
| wealth.js | P-15 |
| when.js | AT-15 |
