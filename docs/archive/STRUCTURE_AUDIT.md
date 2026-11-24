# Structure audit

Audit of every page in the app (2026-11-18): what it does, who it is for, which pages do something similar, and what was done. Sources: the menu in `public/app.js` (CORE, NAV, BIZ_NAV), the page files in `public/pages/`, the page guides (`public/pages/guides.js`), FEATURES.md, DECISIONS.md, and a crawl of every page in a browser against the mock broker.

Audience: **Beginner** (new to investing), **Investor** (long term), **Active trader**, **Quant** (models, code, data), **Developer** (API and agents), **Admin** (the owner).

Recommendation: **Keep**, **Merge** (one page with tabs; every feature and all data stay), **Split**, **Move** (to another menu group), **Link together** (Related links).

## Findings

- **Too many groups, too many items.** The old menu had 9 member groups with 76 entries (plus 7 always shown); Investing had 13, Automation 12, Trading tools 11, Intelligence and Planning 10 each. The new one has 6 groups with 36 entries. It was organized by how features were built (Intelligence, Quant lab, Planning) rather than by what members want to do.
- **The same job in several places.** Bots in four pages across two groups (bots, aibots, agents, aifunds); strategies in three (strategies, playbooks, backtest); signals in three across two groups (signals, aisignals, fleet); research in five (research, news, intel, institutions, earnings); accounts in three; risk in three (riskview, risk, margin); taxes in two; text and phone in two pages that open with the same setup card.
- **Pages holding two jobs.** "Bonds, rates & crypto" also holds the Alpaca AI/CLI developer tools and the agent setup (split). Settings is 14 cards and 3,700px long, but it is already split into sections with a jump menu, so it was left as it is.
- **Features that do not point to each other.** Strategies, their backtest, their bot and their Marketplace listing are four pages with few links between them; AI signals do not link to the alert-to-trade setup; Margin and Short selling share a card but no link.
- **Already merged well:** Marketplace (6 pages with tabs) and My business (7 pages with tabs). Their pattern (separate routes, one tab strip) is the one used for the new merged pages.

## New structure

Core (always shown): Home, Get started, Trade, Positions, Orders, Watchlists, Market overview.

| Group | Items (tabs) |
|---|---|
| Research | Stock & fund analyzer (Stock & fund analyzer, Earnings vs expectations) · Research & news (Plain-language research, News & sentiment, Market intelligence, Institutional portfolios) · Scanners (Scanner, New leaders) · AI assistant (AI assistant, AI tools) · Calendar & events |
| Trade tools | Chart · Options (Options desk, Options lab) · Short selling · Planning tools · Workspace · Phone & text (Text commands, Phone hotline) |
| Invest | Investing toolkit (Investing toolkit, S&P 500 plan, Low-cost index & mutual funds) · Portfolios (Portfolios, Automated portfolios, AI hedge funds, Rules across accounts) · Futures, bonds & more (Futures, funds & savings, Bonds, rates & crypto, Tokenized securities) · Values investing · Invest as you spend |
| Automate | Strategies (Strategy library, Playbooks, Backtest) · Bots (My bots, AI bots, Forecasts & AI agents) · Alerts & signals (Alerts to trades, AI signals, Signal fleet) · Scheduled trades · Pairs & stat arb (Pairs trading, Statistical arbitrage) · Marketplace (Overview, Top traders, AI strategy marketplace, Strategies, Portfolios, Signal channels) · Developers (Developer API, Agents & API, Code lab, Cloud algorithms, Alpaca AI & CLI tools) |
| Track & plan | Performance (Insights & journal, Long-term view, Execution & routing) · Risk (Portfolio & risk, Risk controls, Margin center) · Taxes (Taxes, Tax autopilot) · All my money (All my money, Private markets, Currencies) · Retirement & IRAs · Weekly brief |
| Account & help | Accounts (All accounts, Choose your brokerage, Alpaca account) · Plans & billing · Invite & earn · Learning center · Security & protection (Security & help, Investor protection) · Android app · Settings |
| Admin (owner only, separate) | Admin groups and My business, unchanged |

6 member groups, 5 to 7 items each (was 9 groups, up to 13 items); 21 merged pages hold 62 tabs. A merged-away page lives at `#/<page>/<tab>` (for example `#/bots/aibots`). Its old address (`#/aibots`) redirects there, query string included.

## Every page

| Page | Old group | Purpose | Who it is for | Overlaps with | Recommendation | New place |
|---|---|---|---|---|---|---|
| `#/dashboard` | Core | Account value, chart, key numbers, positions, quick trade, recent orders | Everyone | positions, orders, trade (quick ticket), longterm | Keep | Core → Home |
| `#/start` | Core | Two-minute guided setup for new members (goal, practice money, first trade) | Beginner | learn, brokers | Keep (shows until finished) | Core |
| `#/trade` | Core | Order ticket for any account | Everyone | dashboard quick ticket, chart (ladder), options | Keep | Core |
| `#/positions` | Core | Holdings with cost, value and P/L | Everyone | dashboard, accounts (holdings across accounts), riskview | Keep; link to Risk | Core |
| `#/orders` | Core | Every order and its status (open, filled, cancelled) | Everyone | dashboard recent orders, execution | Keep; link to Execution quality | Core |
| `#/watchlists` | Core | Lists of symbols with live prices (Alpaca) | Active trader | markets (My watchlist card), aitools (theme to watchlist) | Keep; link to Scanners | Core |
| `#/markets` | Core | Indexes, sectors, movers, most active and news | Everyone | news, intel, leaders | Keep; link to Research & news | Core |
| `#/analyze` | Investing | One page per stock or fund: trend, valuation, growth, dividends, scores | Beginner, long-term investor | earnings (surprises), research (filings) | Merge: Earnings becomes a tab | Research → Stock & fund analyzer |
| `#/lowcost` | Investing | Index funds, ETFs and mutual funds compared by yearly cost | Beginner, long-term investor | wealth (Index funds tab), invest (Mutual funds tab), robo | Merge into Investing toolkit (tab) | Invest → Investing toolkit |
| `#/earnings` | Investing | Reported earnings against analyst expectations | Active trader, investor | analyze (earnings section), calendar (earnings dates), intel (call summaries) | Merge into Stock & fund analyzer (tab) | Research → Stock & fund analyzer |
| `#/institutions` | Investing | 13F holdings of large investors and their changes | Investor, quant | research, intel, sharedportfolios | Move to Research & news (tab); it is research, not a way to invest | Research → Research & news |
| `#/sp500` | Investing | A regular S&P 500 plan, run automatically | Beginner | wealth (Automatic investing tab), schedule (DCA), robo | Merge into Investing toolkit (tab); link to Scheduled trades | Invest → Investing toolkit |
| `#/wealth` | Investing | Ten long-term investing habits, each with a tool | Beginner, long-term investor | lowcost, sp500, robo, taxpilot, longterm | Keep as the main tab of Investing toolkit | Invest → Investing toolkit |
| `#/robo` | Investing | Questionnaire to a self-rebalancing fund mix | Beginner | portfolios, rules (one mix across accounts), wealth | Merge into Portfolios (tab) | Invest → Portfolios |
| `#/longterm` | Investing | Results over years: growth vs S&P 500, risk-adjusted returns, stress test | Long-term investor | insights, riskview, dashboard | Merge into Performance (tab): it reports on results | Track & plan → Performance |
| `#/invest` | Investing | Futures, mutual funds and savings / T-bills | Investor, active trader | alpaca-tools (Treasuries), lowcost (mutual funds) | Keep as main tab of Futures, bonds & more | Invest → Futures, bonds & more |
| `#/alpaca-tools` | Investing | Rates, Treasuries, crypto venues and also Alpaca AI/CLI tools and agent setup | Investor; developer for half the page | invest, tokenized, agenthub, developers | Split: market data stays (tab of Futures, bonds & more); developer tools move to a new Developers tab (alpaca-dev) | Invest → Futures, bonds & more |
| `#/tokenized` | Investing | Tokenized securities explained, with a price check | Investor | alpaca-tools (Tokenized card) | Merge into Futures, bonds & more (tab) | Invest → Futures, bonds & more |
| `#/values` | Investing | Values screens, maaser, Shabbos and Yom Tov trading pause | Values-led investor | luach (tzedakah ledger), risk (trading pause) | Keep | Invest |
| `#/spend` | Investing | Round-ups and invest-as-you-spend from linked cards | Beginner | money (banks and cards) | Keep; link to All my money | Invest |
| `#/chart` | Trading tools | Charts with drawing tools and a click-to-trade ladder | Active trader | trade, workspace | Keep | Trade tools |
| `#/options` | Trading tools | Options chain with Greeks; single-leg orders | Active trader | optionslab, alpaca-tools (multi-leg note) | Merge with Options lab: one Options page with two tabs | Trade tools → Options |
| `#/optionslab` | Trading tools | Multi-leg strategy builder with payoff and income scan | Active trader | options | Merge into Options (tab) | Trade tools → Options |
| `#/scanner` | Trading tools | Rule and pattern scanners, run around the clock | Active trader, quant | leaders, research (screen by numbers), aisignals | Keep as main tab of Scanners | Research → Scanners |
| `#/leaders` | Trading tools | Stocks that just became market leaders | Active trader | scanner, markets (movers) | Merge into Scanners (tab): it is a ready-made scan | Research → Scanners |
| `#/short` | Trading tools | Planning a short sale: borrow, squeeze, size | Active trader | margin (shares the margin card) | Keep; link to Margin center | Trade tools |
| `#/margin` | Trading tools | What the account may borrow, margin numbers and rules | Active trader | short, risk, riskview | Move into Risk (tab) | Track & plan → Risk |
| `#/calendar` | Trading tools | Earnings, IPOs, dividends, splits and holidays for the month | Everyone | earnings, luach | Move to Research | Research |
| `#/tradetools` | Trading tools | Position size, risk/reward, heatmap and AI explainers | Active trader | riskview, aitools | Keep | Trade tools |
| `#/execution` | Trading tools | Fill quality, routing and the order log | Active trader, quant | orders, insights (Live vs expected tab) | Move into Performance (tab) | Track & plan → Performance |
| `#/workspace` | Trading tools | Drag-and-drop panels layout | Active trader | dashboard, chart | Keep | Trade tools |
| `#/ai` | Intelligence | Chat assistant: prices, account questions, practice orders | Everyone | aitools, research, agenthub | Keep as main tab of AI assistant | Research → AI assistant |
| `#/aitools` | Intelligence | What-if scenarios, news to trades, theme to watchlist, head to head | Active trader | ai, news, tradetools (AI explainers) | Merge into AI assistant (tab) | Research → AI assistant |
| `#/research` | Intelligence | Plain-language company summaries and a number screen | Beginner, investor | analyze, news, intel, scanner | Keep as main tab of Research & news | Research → Research & news |
| `#/news` | Intelligence | Headlines with tone scores, StockTwits, audio brief | Everyone | research, intel, markets (News card), aitools (news to trades) | Merge into Research & news (tab) | Research → Research & news |
| `#/intel` | Intelligence | Options flow, dark-pool volume, earnings-call summaries, whale wallets | Active trader, quant | news, earnings, institutions | Merge into Research & news (tab) | Research → Research & news |
| `#/aisignals` | Intelligence | Nightly AI-picked setups with entry, stop and target; can auto-trade | Active trader | signals (alerts to trades), signalchannels, scanner | Merge into Alerts & signals (tab); link each signal to the alert-to-trade setup | Automate → Alerts & signals |
| `#/agents` | Intelligence | Train and test forecast models, run them as bots | Quant | aibots, bots, code | Merge into Bots (tab "Forecast models") | Automate → Bots |
| `#/aibots` | Intelligence | DCA, grid, scalping and plain-English bots | Beginner to active trader | bots, aimarket, playbooks | Merge into Bots (tab) | Automate → Bots |
| `#/agenthub` | Intelligence | Connect an outside AI agent to accounts, with limits and an activity log | Developer, quant | developers, alpaca-tools (agent card), ai | Merge into Developers (tab) | Automate → Developers |
| `#/developers` | Intelligence | Developer API keys, scopes and docs | Developer | agenthub, code, quantconnect | Keep as main tab of Developers | Automate → Developers |
| `#/playbooks` | Automation | Block-based strategies: build, backtest, deploy | Active trader, quant | strategies, backtest, aibots | Merge into Strategies (tab) | Automate → Strategies |
| `#/playbook` | (not in menu) | One Playbook: editor, backtest, deploy | Active trader, quant | strategies, backtest | Keep (opened from Playbooks); add Related links | Automate → Strategies (detail) |
| `#/strategies` | Automation | Strategy builder and library; community strategies | Active trader | playbooks, backtest, bots, sharedstrategies | Keep as main tab of Strategies; link to Backtest, Bots and Marketplace | Automate → Strategies |
| `#/backtest` | Automation | Replay a strategy over past prices | Active trader, quant | strategies, playbooks, code, statarb (own backtest) | Merge into Strategies (tab) | Automate → Strategies |
| `#/bots` | Automation | Saved strategies: deploy, stop, publish; bot activity | Active trader | aibots, agents, strategies | Keep as main tab of Bots | Automate → Bots |
| `#/schedule` | Automation | Orders at a time or on a repeat; price alerts by SMS | Everyone | sp500 (monthly plan), rules | Keep | Automate |
| `#/rules` | Automation | One target mix and automatic rules across accounts | Investor with several accounts | portfolios, robo, accounts (Equalize accounts), risk | Merge into Portfolios (tab) | Invest → Portfolios |
| `#/signals` | Automation | Webhook alerts (TradingView and others) turned into orders | Active trader | aisignals, fleet, signalchannels | Keep as main tab of Alerts & signals | Automate → Alerts & signals |
| `#/fleet` | Automation | Send one signal to many accounts; follow channels | Active trader, signal provider | signals, signalchannels | Merge into Alerts & signals (tab) | Automate → Alerts & signals |
| `#/portfolios` | Automation | Rule-built portfolios with rebalancing; community portfolios | Investor, quant | robo, aifunds, sharedportfolios, rules | Keep as main tab of Portfolios; link to Marketplace | Invest → Portfolios |
| `#/aifunds` | Automation | AI long/short "hedge fund" portfolios | Active trader, quant | portfolios, bots, statarb | Merge into Portfolios (tab): it builds and holds a portfolio | Invest → Portfolios |
| `#/text` | Automation | Account and trades by SMS | Everyone with a phone | hotline (same phone setup card) | Merge with Phone hotline: Phone & text | Trade tools → Phone & text |
| `#/hotline` | Automation | Account and trades by phone call | Everyone with a phone | text | Merge into Phone & text (tab) | Trade tools → Phone & text |
| `#/marketplace` | Marketplace | Overview of everything members share | Everyone | strategies, portfolios, aibots community parts | Keep (existing tabs) | Automate → Marketplace |
| `#/traders` | Marketplace | Members ranked by return; copy trading | Active trader | fleet (following), sharedportfolios | Keep (Marketplace tab) | Automate → Marketplace |
| `#/aimarket` | Marketplace | Shared AI bots | Active trader | aibots | Keep (Marketplace tab); link from AI bots | Automate → Marketplace |
| `#/sharedstrategies` | Marketplace | Shared strategies with backtests | Active trader | strategies (Community strategies card) | Keep (Marketplace tab); link from Strategies | Automate → Marketplace |
| `#/sharedportfolios` | Marketplace | Shared baskets | Investor | portfolios (Community tab) | Keep (Marketplace tab); link from Portfolios | Automate → Marketplace |
| `#/signalchannels` | Marketplace | Shared signal channels to follow | Active trader | fleet (Public channels) | Keep (Marketplace tab); link from Alerts & signals | Automate → Marketplace |
| `#/pairs` | Quant lab | Pair bots on two related stocks | Quant | statarb | Merge with Statistical arbitrage: Pairs & stat arb | Automate → Pairs & stat arb |
| `#/statarb` | Quant lab | Basket stat arb: matrix, signals, backtest, market scan | Quant | pairs, backtest | Merge into Pairs & stat arb (tab) | Automate → Pairs & stat arb |
| `#/code` | Quant lab | Python strategies backtested in the browser | Quant, developer | backtest, quantconnect | Merge into Developers (tab) | Automate → Developers |
| `#/quantconnect` | Quant lab | QuantConnect cloud backtests and live algorithms | Quant, developer | code, backtest | Merge into Developers (tab) | Automate → Developers |
| `#/riskview` | Planning | How risky the holdings are together; crash scenarios | Everyone | risk, margin, longterm (stress test), tradetools | Keep as main tab of Risk | Track & plan → Risk |
| `#/retirement` | Planning | IRAs, limits and a retirement planner | Beginner, long-term investor | wealth (Tax-advantaged accounts tab) | Keep; link to Investing toolkit | Track & plan |
| `#/money` | Planning | Net worth across banks, cards, crypto and brokerages | Everyone | accounts, private, spend | Keep as main tab of All my money | Track & plan → All my money |
| `#/currencies` | Planning | Currency converter at reference rates | Everyone | business (converter card) | Merge into All my money (tab) | Track & plan → All my money |
| `#/brief` | Planning | Weekly plain-English money brief (add-on) | Everyone | insights, news (AI brief) | Keep (add-on, can be switched off) | Track & plan |
| `#/insights` | Planning | Time-weighted return, profit by symbol and strategy, journal | Active trader | longterm, execution, pnlwhy card | Keep as main tab of Performance | Track & plan → Performance |
| `#/risk` | Planning | Order limits, daily loss limit and kill switch | Everyone who automates | riskview, margin, rules | Merge into Risk (tab) | Track & plan → Risk |
| `#/tax` | Planning | Realized gains, Schedule D, mark-to-market, bookkeeping export | Everyone, active trader | taxpilot, business books | Keep as main tab of Taxes | Track & plan → Taxes |
| `#/taxpilot` | Planning | Tax-loss harvesting and wash-sale guard (add-on) | Investor | tax, wealth (tax tab), robo (harvesting) | Merge into Taxes (tab, hidden when the add-on is off) | Track & plan → Taxes |
| `#/private` | Planning | Private investments and net worth | Investor | money | Merge into All my money (tab) | Track & plan → All my money |
| `#/brokers` | Accounts | Choose and connect a brokerage | Beginner | account, accounts | Merge into Accounts (tab) | Account & help → Accounts |
| `#/account` | Accounts | Alpaca connection and account opening | Everyone on Alpaca | brokers, accounts | Merge into Accounts (tab) | Account & help → Accounts |
| `#/accounts` | Accounts | Every connected account side by side, groups, equalize | Everyone with several accounts | money, rules, brokers | Keep as main tab of Accounts | Account & help → Accounts |
| `#/funding` | Accounts | Plans, credits, paper money, deposits, billing history | Everyone | referrals | Keep | Account & help |
| `#/referrals` | Accounts | Invite link and bonuses | Everyone | funding | Keep | Account & help |
| `#/learn` | Help & settings | Lessons, glossary and calculators | Beginner | guides on every page, protection | Keep | Account & help |
| `#/security` | Help & settings | Passkeys, account lock and support | Everyone | protection, settings (sign-in section) | Merge with Investor protection: Security & protection | Account & help → Security & protection |
| `#/protection` | Help & settings | What Brightolio is, fraud signs, data use, risks | Beginner | security, learn | Merge into Security & protection (tab) | Account & help → Security & protection |
| `#/android` | Help & settings | The Android app | Everyone | - | Keep | Account & help |
| `#/settings` | Help & settings | All settings: look, language, sign-in, data, optional features | Everyone | security, extras | Keep: long (14 cards), but already split into sections with a jump menu at the top (Optional features, Display and language, Sign-in, Data…); page-specific settings already moved to each page's gear | Account & help |
| `#/extras` | (not in menu) | My tools: optional tools the member switched on | Everyone | settings (Optional features) | Keep (appears in the menu when a tool is on) | Core |
| `#/luach` | (not in menu) | Hebrew calendar, zmanim, tzedakah ledger (optional tool) | Values-led investor | values, calendar | Keep (opened from My tools) | My tools |
| `#/business` | My business (admin) | Owner business dashboard | Admin | bizreports | Keep separate (admin only, already one page with tabs) | Admin → My business |
| `#/invoices` | My business (admin) | Invoices and payments | Admin | business | Keep (business tab) | Admin → My business |
| `#/books` | My business (admin) | Bookkeeping journal | Admin | tax (bookkeeping export) | Keep (business tab) | Admin → My business |
| `#/bank` | My business (admin) | Bank lines and receipts | Admin | money | Keep (business tab) | Admin → My business |
| `#/inventory` | My business (admin) | Products and stock | Admin | - | Keep (business tab) | Admin → My business |
| `#/payroll` | My business (admin) | Pay runs and W-2 totals | Admin | - | Keep (business tab) | Admin → My business |
| `#/bizreports` | My business (admin) | P&L, balance sheet, cash flow | Admin | business | Keep (business tab) | Admin → My business |
| `#/alpaca-dev` | (new) | Alpaca MCP server and CLI, connecting AI agents (split out of Bonds, rates & crypto) | Developer | agenthub, developers | New tab of Developers | Automate → Developers |

## Growth features (2026-11-22)

Where each feature from PLAN_GROWTH.md lives in the menu (DECISIONS.md G-3). Every new page is a tab of an existing merged page, except one new entry in Trade tools.

| Page | Purpose | Overlaps with | Recommendation | New place |
|---|---|---|---|---|
| `#/analyze?symbol=…&view=` | One stock page: overview, valuation, fundamentals, earnings, dividends, technicals, supply & demand | earnings, chart, tradetools, news | Extend (one page, sections) | Research → Stock & fund analyzer |
| `#/analyze/compare` | 2–4 stocks side by side | aitools (head to head) | New tab; links to head to head | Research → Stock & fund analyzer |
| `#/scanner/valuescan` | Growth at a price: fundamental presets, saved filters, alerts | scanner, fundamentals screen | New tab | Research → Scanners |
| `#/research/rates` | Rates vs stocks: Fed funds, 2y, 10y, curve against S&P 500 and sectors, next Fed meeting | alpaca-tools (rates card) | New tab; links both ways | Research → Research & news |
| `#/riskview/diversify` | Diversification score and suggestions with previews | riskview, wealth (diversify tab) | New tab; the wealth tab links to it | Track & plan → Risk |
| `#/signals/newspicks` | AI morning news picks with caps and a track record | aisignals, aitools (news to trades) | New tab | Automate → Alerts & signals |
| `#/bots/intraday` | AI intraday engine (every 5 minutes, limits, trade log) | bots (15-minute bots) | New tab | Automate → Bots |
| `#/wealth/passive` | Passive investing overview: portfolios by risk, rebalancing, deposits, fees | lowcost, sp500, robo, rules, longterm | New tab that connects them | Invest → Investing toolkit |
| `#/wealth/dividends` | Dividends & income: calendar, 12-month forecast, DRIP | wealth DRIP tab | New tab | Invest → Investing toolkit |
| `#/active` | Active trading desk: scanner, watchlists, ideas, journal, performance vs S&P 500 | scanner, watchlists, aisignals, insights | New entry that connects them | Trade tools |
