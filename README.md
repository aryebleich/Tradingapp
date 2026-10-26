# QuantPocket

[![CI](https://github.com/aryebleich/Tradingapp/actions/workflows/web-ci.yml/badge.svg)](https://github.com/aryebleich/Tradingapp/actions/workflows/web-ci.yml) [![Run app (end-to-end)](https://github.com/aryebleich/Tradingapp/actions/workflows/e2e.yml/badge.svg)](https://github.com/aryebleich/Tradingapp/actions/workflows/e2e.yml)

Backtest, paper trade and automate US stock strategies. A multi-user web platform built with Node 22, Express and SQLite/libSQL.

## Website features

- **Accounts and security**: scrypt password hashing, TOTP two-factor (any authenticator app), lockout after 5 bad passwords, rate limits, HttpOnly SameSite cookies, CSRF header check, session list with remote sign-out, security log. Broker keys are encrypted with AES-256-GCM.
- **Backtesting**: a rule language (SMA, EMA, RSI, Bollinger, MACD, breakouts, ROC) with stop loss, take profit, trailing stop, position size and trading costs. Results include CAGR, Sharpe, Sortino, drawdown, profit factor, a trade list, **walk-forward** out-of-sample checks and a **parameter optimizer** (`SMA({10,20,50})`).
- **Projected annual return**: 2,000 bootstrapped years from the strategy's own daily returns, showing the 5th, 50th and 95th percentiles and the chance of a losing year.
- **AI strategy builder**: describe an idea in English and get runnable rules. Uses Claude when `ANTHROPIC_API_KEY` is set, otherwise a keyword parser.
- **Paper trading**: a built-in $100k simulated account, plus Alpaca paper.
- **Live trading through Alpaca**: connect your own keys (paper or live), see positions and orders, and place market orders.
- **QuantConnect**: connect your API token, create cloud projects from LEAN templates or your own Python code, run cloud backtests and read their statistics.
- **Auto-trading bots**: deploy a saved strategy to paper or Alpaca. It checks its rules once every trading day between 3:30 and 4:00 pm New York time.
- **Scheduled trades**: one-off, daily, weekly (DCA) or monthly orders, and **price alerts** sent by SMS.
- **Text and phone hotline (Twilio)**: `BAL`, `POS`, `PRICE AAPL`, `BUY 5 AAPL <PIN>`, `DCA $50 SPY WEEKLY <PIN>`, `PAUSE <PIN>`. When calling, you enter your PIN, then use the keypad menu or say commands out loud ("buy five shares of Apple").
- **Portfolio chart**: the equity line is green above the starting value and red below it.
- **Tax information**: FIFO realized gains, short and long term, wash-sale flags, an estimated tax using your bracket, a loss carryforward, tax-loss harvesting ideas, and a Form 8949 CSV export.
- **Revenue**: monthly plans (Starter free, Pro $53, Elite $109, Ultimate $320; see docs/pricing-comparison.md) through Stripe Checkout, plus a **performance fee** (20%, 10%, 5% or 2.5% by plan) charged only on new profit above a high-water mark. The admin page shows MRR, fees due and collected, and deposits.
- **Debit card deposits**: Stripe Checkout. Credit cards are detected and refunded automatically.

## Alpaca trading (Broker API + Trading API + Market Data)

Everything starts in the **sandbox / paper** environment.

| Area | What's included | Alpaca API |
|---|---|---|
| Brokerage accounts | 4-step application (identity, contact, employment and disclosures, agreements). The SSN is sent to Alpaca and never stored. KYC tracking (Submitted → Approved → Active) with automatic status checks and notifications. Contact updates and account settings (PDT/DTBP checks, margin multiplier, shorting, fractional shares, options level, trading kill switch) | Broker API `POST/GET/PATCH /v1/accounts`, `/v1/trading/accounts/{id}/account/configurations` |
| Funding | Link bank accounts (ACH), deposits and withdrawals, cancel pending transfers | Broker API `/ach_relationships`, `/transfers` |
| Trading | Market, limit, stop, stop-limit and trailing stop; bracket, OCO and OTO; extended hours; crypto (market, limit, stop-limit); options single-leg and multi-leg spreads (2–4 legs); modify, cancel one or all orders; every order is reviewed before it is sent | Trading API v2 `/v2/orders` (or Broker `/v1/trading/accounts/{id}/orders`) |
| Portfolio | Balances, buying power (Reg T, day-trading, options), margin, PDT; equity chart for 1D–All, green/red against the period start; positions with live P/L; close full, by quantity or by %; close all; exercise options | `/account`, `/account/portfolio/history`, `/positions` |
| Market data | Live quotes (WebSocket relayed to the browser), candlestick charts from 1-minute to weekly bars, snapshots, most active, gainers and losers (stocks and crypto), news, option chains with IV and Greeks, corporate actions | `data.alpaca.markets` v2, v1beta1, v1beta3 |
| Watchlists | Create, rename, delete; add and remove symbols; live prices | `/watchlists` |
| Market info | Clock, 30-day trading calendar with early closes, dividends, splits, mergers and spinoffs | `/clock`, `/calendar`, `/corporate_actions/announcements` |

**Three ways for a user to connect.** One code path serves all three:
1. **Open a brokerage account** through the Broker API. Uses HTTP Basic auth with your broker key; trading goes through `/v1/trading/accounts/{id}/…`.
2. **Connect an existing Alpaca account with OAuth2** (authorization-code flow, `state` checked against CSRF, token stored encrypted). Uses `Authorization: Bearer`.
3. **Paste Alpaca API keys**. Sent as `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY` headers.

**Setup**
1. Alpaca dashboard → **Broker API** → sandbox keys → set `BROKER_API_KEY` and `BROKER_API_SECRET`.
2. Alpaca dashboard → **Trading API (paper)** → keys → set `ALPACA_KEY_ID` and `ALPACA_SECRET`. These are used for market data and the live price stream.
3. Optional, for OAuth: create an OAuth app with redirect URI `https://YOUR_APP/oauth/alpaca/callback`, then set `ALPACA_OAUTH_CLIENT_ID` and `ALPACA_OAUTH_CLIENT_SECRET`.
4. Optional: use OAuth client credentials instead of the key pair: set `BROKER_CLIENT_ID` and `BROKER_CLIENT_SECRET` (the server gets a token from `https://authx.alpaca.markets/v1/oauth2/token`, override with `BROKER_TOKEN_URL`).
5. Live trading later: set `BROKER_BASE_URL=https://broker-api.alpaca.markets` (production Broker API, requires Alpaca's approval) or use live keys / `ALPACA_OAUTH_ENV=live`. Live trading is limited to the Pro and Elite plans, and the app shows a **LIVE** badge and warning on every order.

**Account opening** (`/app#/open-account`, also on the Account page): a visitor creates a login, then fills five steps (Contact, Identity, Disclosures, Agreements, optional ID documents). The server builds and sends `POST /v1/accounts` (agreements carry `signed_at` and the user's IP), stores the returned account id against the user, and never stores the SSN or documents. Status changes come from Alpaca's event feed (`GET /v1/events/accounts/status`, one server-side SSE connection that resumes with `since_id`), are saved in `broker_events`, sent to the user by text or email and pushed to their open page. `ACTION_REQUIRED` shows an upload form (`POST /v1/accounts/{id}/documents/upload`). Hourly polling is the backup. All Alpaca calls run on the server; the browser never sees Broker API credentials.

**Yiddish with Yiddish Labs**: `npm run yiddish:export` writes every English string to `i18n/yiddish-labs/english.txt`. Translate it at https://app.yiddishlabs.com/app/quick-action, save the result as `i18n/yiddish-labs/yiddish.txt` (same line order), run `npm run yiddish:import`, then `python3 scripts/pages.py`. Imported strings override the built-in ones. Faster without an API plan: `npm run yiddish:parts` writes 16 numbered parts to `i18n/yiddish-labs/parts/`; paste each into Quick Action, save each answer as `part-NN.yi.txt`, then `npm run yiddish:import-parts` (lines that come back broken keep the current Yiddish). With an API key: `YIDDISH_LABS_API_KEY=... npm run yiddish:translate`. Set `YIDDISH_CREDIT=Yiddish Labs` to show the credit line.

Tests run the whole integration against a local mock of Alpaca (`test/mock-alpaca.js`), including the exact auth headers and request bodies. Check the first real sandbox calls in your own environment as well.

## Sign in with Google

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an **OAuth client ID** of type **Web application**.
2. Add the authorized redirect URI `https://YOUR_APP/auth/google/callback` (same host as `PUBLIC_URL`).
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The "Sign up with Google" buttons on the homepage and the app appear automatically once both are set.

New Google users get a confirmed email and no password (they can add one in Settings). A Google sign-in with the same email as an existing account links to it; if that account's email was never confirmed, its old password is discarded first.

## Sign in with GitHub

1. On GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Homepage URL: your `PUBLIC_URL`. Authorization callback URL: `https://YOUR_APP/auth/github/callback`.
3. Generate a client secret, then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (Render → Environment,
   or Admin → Keys). The GitHub buttons appear by themselves.

Only a **verified** email on GitHub is used. An existing account with the same email is linked, with the
same safety rule as Google.

## Admins and signing in by text message

- Built-in admins: `aryebleich@gmail.com`, `kk5185920061@gmail.com` and the phone `+1 845-772-8111`.
  `ADMIN_EMAIL` (comma-separated) still works too.
- **Admin → Admins** adds more admin emails and phones, with no restart.
- **`/app#/login-phone`** (not linked from the sign-in page) sends a 6-digit code to a verified phone. The owner's
  admin phones sign in to the owner account even before the number is linked. Real texts need Twilio.

## Admin → Keys: every key in one place, with .env import/export and Render

- Lists every setting by group. Secrets show masked (`sk_•••1234`).
- **Save** a value: it works at once and is kept encrypted in the database.
- **Import a .env file:** paste it or choose the file.
- **Export as .env:** downloads all real values. Your password is needed first.
- **Connect Render** once, so values are also written to Render and survive restarts:
  1. Render → **Account settings → API keys → Create API key**.
  2. Save it here as `RENDER_API_KEY`. On Render, `RENDER_SERVICE_ID` is already set; elsewhere, add it
     (the `srv-…` id from the service URL).
  3. Then **Load from Render**, **Send all to Render** (with an optional restart) and **Restart (deploy)**
     work from the page.

`ENCRYPTION_KEY`, `DATABASE_URL` and `DATABASE_AUTH_TOKEN` are only read at start-up: change them on
Render and restart. Changing `ENCRYPTION_KEY` makes stored broker keys unreadable.

## Business mode: software only (no license) or registered adviser

**Admin → Business mode** has two settings:

- **Software only** (default). Everything a license would require is turned off:
  - no performance fee;
  - no managed accounts;
  - no personal advice.

  Users run their own strategies on their own brokerage accounts. You earn from:
  - the plans (monthly or yearly);
  - the deposit service fee (`DEPOSIT_FEE_PERCENT` / `DEPOSIT_FEE_FIXED`);
  - referrals.

  **Live trading is open on every plan.** Free users place their own orders on their real accounts;
  automation on real money (bots, webhooks, automatic strategies, mirroring) is what they pay for.
- **Registered investment adviser.** Turn this on after registration is approved. You confirm the
  registration and enter the CRD number. It adds:
  - the performance fee on each plan;
  - the monthly fee assessment;
  - the fee pages and lines on the homepage.

**Is there a way to charge a performance fee without a license?** Not safely. A fee based on a client's
profits pays for investment results, which makes the business an investment adviser. Even registered
advisers may charge it only to **qualified clients** (Rule 205-3). Per-trade commissions raise
broker-dealer questions too.

Ways to earn more without a license:

- Raise plan prices, and push the yearly plan.
- Charge for add-ons: more strategies, webhooks or AI messages.
- Keep the deposit service fee.
- Ask Alpaca about partner revenue sharing on the Broker API accounts you open (by contract with them).

## Alerts to trades (webhooks)

Under **Alerts to trades** each user creates private webhook URLs for TradingView, TrendSpider, Zapier, scripts or AI agents. Each webhook has its accounts (paper and/or Alpaca), sizing (dollars, shares or from the alert) and risk rules (max position per ticker, max trades per day, allowed tickers; long-only). Messages can be JSON such as `{"ticker":"{{ticker}}","action":"{{strategy.order.action}}","quantity":"{{strategy.order.contracts}}"}` or text like `buy AAPL 10`. Free: 1 webhook, paper only. Pro: 10, including Alpaca. Elite: 50.

## Strategy library (the MULTI_STRATEGIES sheet)

**Strategies** in the app holds seven rotation strategies from the MULTI_STRATEGIES (v8.3) sheet: BG Ensemble, Multi-Model ETF Rotation (4 sleeves), Leveraged ETF Rotation, Gold Miner, Large-Cap Momentum, Large-Cap Pullback and Macro Rotation (`src/rotation/templates.js`). Each user copies one and can:

- **run it by hand**: today's walkdown with every value filled in from market data (Wilder RSI, SMAs, returns, Bollinger, momentum), any value can be overtyped like the sheet's yellow cells, then the orders are sized in whole shares and placed with one click;
- **run it automatically** on any connected account at a chosen time on each rebalance day (daily, Wednesday, or the first trading day of the month), with an optional trailing stop;
- **edit everything**: thresholds, indicators, tickers, sleeves, lists and parameters (form or JSON), preview and backtest before saving.

Not every rule was in the PDF export: Gold Miner shows only the steps on that day's path (the walk stops at "needs a rule"), and Leveraged ETF Rotation steps 4-12 are rebuilt from the public "TQQQ For The Long Term" logic and marked "check". Send the QuantConnect code or the sheet to fill them in exactly.

**Reality Check** compares each strategy's live daily results with its backtest (z-test on the mean daily return, plus a drawdown limit): Healthy / Watch / Drifting, a text or email when it gets worse, and optional auto-throttle (100% / 50% / 0% of the strategy's money). The **portfolio split** suggests win-rate weighted allocations (10%-70% each), like the sheet's PORTFOLIO_SPLIT tab.

## Pairs trading, S&P 500 plan, more brokerages

- **Pairs** (`src/pairs.js`): OLS hedge ratio on log prices, rolling z-score, Engle-Granger cointegration t-stat, half-life, walk-forward backtest (market-neutral and long-only), a scanner of 20 classic pairs, and pair bots that trade daily at 3:45 pm New York time.
- **S&P 500** (`src/sp500.js`): SPY record with dividends, projections resampled from real monthly history, and automatic monthly or weekly buys of VOO, SPLG, IVV or SPY.
- **Brokerages** (`src/ext/brokers.js`): Tradier (token), tastytrade (OAuth personal grant), Charles Schwab and TradeStation (OAuth; set the app keys above). They appear in every account picker; webhooks can send one alert to several accounts.

## Deposits, owner fees, AI phone assistant, Yiddish

- Deposits can go through **Stripe ACH** (0.8%, max $5), **Helcim** (interchange-plus; a regulated debit card costs about 0.55% + 47¢) or Stripe cards (2.9% + 30¢). `DEPOSIT_FEE_PERCENT` / `DEPOSIT_FEE_FIXED` add your service fee, shown before paying and recorded as revenue. Add the Stripe webhook events `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` for bank transfers. Check card-network and state rules on surcharges with a lawyer before charging a fee on card deposits.
- **AI assistant** (`src/assistant.js`): texts and calls to `TWILIO_FROM` that are not plain commands go to Claude, which answers questions or turns requests into the app's own commands. Trades still need the PIN (SMS) or the spoken read-back (calls).
- **Languages**: English and Yiddish (right-to-left) for the app (`public/i18n.js`, `public/i18n/yi.js`) and the homepage (`/yi`, generated from `scripts/home.py` + `scripts/yi_home.py`). Add a language by adding a dictionary.

## Professional site extras

- **Public homepage** at `/` with a live demo backtest, features, pricing, FAQ, and **Terms, Privacy, Risk Disclosure and Contact** pages. A support inbox is on the Admin page.
- **Password reset and email verification** by email (Resend), **data export and account deletion** in Settings, and an onboarding checklist.
- **SEO and sharing**: meta and Open Graph tags, social image, `robots.txt`, `sitemap.xml`, an installable app manifest and icon, and a custom 404 page.
- **Operations**: `/healthz`, gzip, security headers (CSP, HSTS), access log, graceful shutdown, CI tests, and free market data (Yahoo Finance daily) when no Alpaca key is set.

## Run it on GitHub

- **Automatic test run:** every push runs **Run app (end-to-end)** in GitHub Actions. It starts the server, then drives it with a real Chromium browser through the full desktop flow and a phone flow, and checks every page at iPhone 13 and iPhone SE sizes. Screenshots are attached to each run (Actions → the run → *Artifacts*). Start it by hand from Actions → *Run app (end-to-end)* → **Run workflow**.
- **Use the app inside GitHub (Codespaces):** on the repo page, click **Code → Codespaces → Create codespace on main**. It installs everything, starts the app and opens it in a browser tab. Codespaces includes free monthly hours on personal accounts.

## Run locally

```bash
npm install
npm start            # http://localhost:3000  (homepage) and /app (the app)
npm test             # unit + integration tests
npm run e2e          # whole app in a real browser (needs: npx playwright install chromium)
```

Locally, the first account you register becomes the **admin**. In production, set `ADMIN_EMAIL` instead (one address, or several separated by commas). It also applies to accounts that already exist: the next page load with that email shows the **Owner** menu (Overview, Users, Money & fees, Support inbox, Setup). Everything works without keys: emails and SMS codes are printed in the server log, and payment buttons explain what is missing.

## Free hosting (about 15 minutes, $0/month)

| Piece | Free service | What it does |
|---|---|---|
| App and API | **Render** free web service | Runs the app at `https://<name>.onrender.com` |
| Database | **Turso** free plan | Keeps users and trades (Render's free disk is wiped on restart) |
| Homepage copy | **GitHub Pages** | `https://aryebleich.github.io/Tradingapp/` |
| Keep-awake and jobs | **GitHub Actions** | Wakes the app every 10 minutes and runs bots and scheduled trades |
| Email (optional) | **Resend** free plan | Password resets and verification |

Steps (the code must be on `main` first, so merge this branch):

1. **Database**: sign up at [turso.tech](https://turso.tech), create a database, and copy its URL (`libsql://…`) and an auth token.
2. **App**: open [render.com/deploy?repo=https://github.com/aryebleich/Tradingapp](https://render.com/deploy?repo=https://github.com/aryebleich/Tradingapp). Render reads `render.yaml`. Fill in:
   - `DATABASE_URL` and `DATABASE_AUTH_TOKEN` from Turso
   - `ADMIN_EMAIL`: your email
   - `PUBLIC_URL`: the address Render gives you, e.g. `https://quantpocket.onrender.com`

   `ENCRYPTION_KEY` and `CRON_SECRET` are generated for you. Copy `CRON_SECRET` from the Render dashboard for the next step.
3. **GitHub settings** for this repo:
   - Settings → Pages → Source: **GitHub Actions**
   - Settings → Secrets and variables → Actions:
     - Variable `APP_URL`: your Render address
     - Secret `CRON_SECRET`: the value from Render
4. Re-run the **Deploy homepage to GitHub Pages** workflow (Actions tab), then register with your `ADMIN_EMAIL`.

Optional later: add keys for Resend, Alpaca, Anthropic, Twilio and Stripe in Render → Environment. To use your own domain, add it in Render (app) and in Pages, then update `PUBLIC_URL` and `PUBLIC_ORIGINS`.

Webhook URLs, once those services are set up:

| Service | URL |
|---|---|
| Twilio number → Messaging | `POST https://YOUR_APP/twilio/sms` |
| Twilio number → Voice | `POST https://YOUR_APP/twilio/voice` (status callback `/twilio/voice/status`) |
| Stripe → Webhooks | `https://YOUR_APP/webhooks/stripe` (`checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`) |

Prefer Docker? `docker build -t quantpocket . && docker run -p 3000:3000 --env-file .env quantpocket`.

## Before taking real customers' money — read this

The code is built for the business model you described. Running that business is regulated, though, and the code cannot get you the licenses:

1. **Performance fees.** Charging people a share of their trading profits, or running strategies on their accounts, generally makes you an investment adviser (SEC or state registration in the US). Performance fees are usually only allowed for "qualified clients".
2. **Holding deposits.** Bank (ACH) deposits and withdrawals for brokerage accounts now go through the **Alpaca Broker API**, where Alpaca holds the money. Debit-card deposits through Stripe still land in *your* Stripe balance and must be transferred by hand (Admin page). Treat card deposits as a placeholder until you have legal sign-off, or turn them off.
3. **Card networks** limit funding investment accounts with cards. Stripe needs to approve your use case.
4. **Projected returns** are shown as a statistical range with disclaimers. Do not advertise them as expected or guaranteed returns.

5. **Legal pages** (`scripts/pages.py` generates them) are solid starting templates, not legal advice. Have them reviewed and add your company's legal name and address.

Talk to a securities lawyer before you go live. Until then, keep users on paper trading and on their own Alpaca accounts with their own keys.

## AI (free first)

The assistant, strategy builder, news brief, phone assistant and support agent use a free model by
default. Set one key (all free, no card needed): `GROQ_API_KEY` (console.groq.com), `GEMINI_API_KEY`
(aistudio.google.com) or `OPENROUTER_API_KEY`; or point `AI_BASE_URL` at any OpenAI-compatible server
(e.g. a local Ollama at `http://localhost:11434/v1`, with `AI_MODEL`). Setting `ANTHROPIC_API_KEY`
upgrades to Claude, which adds web search. `AI_PROVIDER` picks one when several keys are set.

## Reliability, execution and protection

- Load shedding (`SHED_AT`, default 0.85), circuit breakers per brokerage, a durable order queue for
  automated orders (`ORDER_QUEUE_TTL_SEC`, `ORDER_WORKERS`), `/readyz`, `/metrics` (`METRICS_TOKEN`),
  and a capacity planner (`BASE_REPLICAS`, `MAX_REPLICAS`, `ECONOMIC_EVENT_DATES`, `VOL_PROXY`).
  Kubernetes manifests with autoscaling and a predictive scaler are in `deploy/k8s`.
- Load and chaos drill: `node scripts/loadtest.mjs` against staging (with `CHAOS_FAIL_RATE`,
  `CHAOS_LATENCY_MS` on the server), or the "Chaos drill" GitHub workflow.
- Execution log: bid/ask at send and the fill, hash-chained and append-only. `ALPACA_STOCK_FEED=sip`
  records the consolidated NBBO. Smart routing scores your connected brokerages; `EXEC_DIRECT_BROKERS`
  lists brokerages that route directly to exchanges without payment for order flow.
- Passkeys (WebAuthn), typing-rhythm checks (`BEHAVIOR_ANOMALY_AT`), a one-tap account lock, lessons
  and risk notices for options/crypto/margin, budget quotas, graduated limits, margin watch
  (`MARGIN_FEED_URL` optional), and an AI support agent that escalates hacked accounts.

## Yiddish Labs translation (its own workflow, managed in Admin)

The app's new English text is translated on the Yiddish Labs website by the **Yiddish Labs
translation** GitHub workflow. It runs on its own, apart from every other job.

- **What is sent:** only text added since the last run (`scripts/yl-last-ref.txt`).
- **What is never sent:** the homepage, Admin and the README.
- **Kept as hand-written Yiddish:** one- and two-word labels, and text with HTML or links.
- **How:** whole sentences go together, up to 8 at a time (about 160 words), numbered `[[1]] [[2]] …`.
  Anything the site drops is sent again on its own.

One-time setup:
1. GitHub → the repository → **Settings → Secrets and variables → Actions** → add the secrets
   `YL_EMAIL` and `YL_PASSWORD` (your Yiddish Labs sign-in). The browser session is cached between
   runs, so the password is only used when it expires.
2. In **Admin → Keys**, add `GITHUB_TOKEN`: a fine-grained token for this repository with
   **Actions** and **Variables** set to read and write.

Then **Admin → Yiddish Labs** shows the last run (translated, kept, credits left) and the recent runs:
- **Translate new text now** starts a run (optionally from a given commit, or limited to N lines).
- **Run automatically after every push to main** switches the automatic run on or off.
- Without the token, start it on GitHub: Actions → Yiddish Labs translation → Run workflow.
- From a computer: `YL_STATE=/safe/place/state.json npm run yiddish:web -- --since <commit>`
  (add `--dry` to only count).

## Security updates (Node.js, certificates, dependencies)

The October 2026 advisories were three issues:
- a TLS hostname-check bypass and a Brotli remote-code-execution flaw in Node.js;
- the compromised **eMudhra** intermediate certificates.

What QuantPocket does:

- **Patched Node.js only.** `security/node-floor.json` holds the lowest patched release per line
  (22.23.4, 24.22.1, 26.12.1). Every place follows it:
  - **`package.json` engines plus `.npmrc` `engine-strict=true`:** installing on an older Node.js fails,
    so a Render build on it fails and the previous deploy keeps running.
  - **Render:** `NODE_VERSION=22` and `.node-version` give the newest Node.js 22 at every build. The new
    release also brings Node.js's updated certificate list, which no longer trusts eMudhra.
  - **Docker:** the newest `node:22-slim`, a fresh system certificate store, OS security updates, and a
    build that stops on an older Node.js. Build with `docker build --pull`.
  - **CI:** the newest Node.js 22 from `.node-version`.
  - **The server:** in production it refuses to start on an unpatched Node.js, or with
    `NODE_TLS_REJECT_UNAUTHORIZED=0`. **Admin → Setup** shows the running version.
- **No compressed request bodies.** Requests with `Content-Encoding` are refused (415), so no
  decompression code ever runs on what users send.
- **HTTPS cannot be weakened from Admin → Keys.** Names such as `NODE_TLS_REJECT_UNAUTHORIZED`,
  `NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS` and `SSL_CERT_FILE` are refused.
- **No PHP** anywhere in the app.

GitHub runners: every workflow uses action versions that run on Node.js 24 (Node.js 20 is retired
there) and the pinned `ubuntu-24.04` image, so the move of `ubuntu-latest` to Ubuntu 26 changes nothing
until the browser tests support it. A test fails if an older action or `ubuntu-latest` comes back.

So it does not happen again:
- **Dependabot** opens weekly update pull requests for npm packages, the Docker image and GitHub Actions.
- **The Security check workflow** runs every Monday:
  - `npm audit` fails on any high or critical advisory and opens an issue;
  - when nodejs.org marks a newer release as a security release, it raises the floor, tests and commits;
  - with the `RENDER_DEPLOY_HOOK_URL` secret (Render → service → Settings → Deploy Hook), it rebuilds
    Render, so the newest Node.js and certificates are live within a week.

## Automatic checks and fixes after every push

Every push to main runs **CI** (unit tests) and **Run app (end-to-end)** (the app in a real browser).
When one fails, the **Autofix failed runs** workflow takes over:

1. It re-runs the failed jobs once, so a one-off hiccup does not count.
2. If they fail again, Claude Code reads the failure log, finds the cause and fixes the code. It never
   skips or weakens a test.
3. It runs the tests and the e2e run, pushes an `Autofix: …` commit, and starts both runs again, until
   everything is green.
4. After 3 autofix commits in a row, or without a Claude key, it opens a GitHub issue with the log.

Setup: add the repository secret `CLAUDE_CODE_OAUTH_TOKEN` (run `claude setup-token` with your Claude
subscription) or `ANTHROPIC_API_KEY`.

## Where secret keys go

Never put a key in the code, in GitHub, or in the browser. Every key is an **environment variable**
on the server:

- **Render (the free hosting above):** dashboard.render.com → your `quantpocket` service →
  **Environment** → **Add Environment Variable** → name and value → **Save Changes**. Render restarts
  the app by itself. Mark nothing as "public"; every value is private to the server.
- **Running on your computer:** a file named `.env` in the project folder (it is in `.gitignore`),
  one `NAME=value` per line, then `node --env-file=.env server.js`.
- **Kubernetes:** `deploy/k8s/secret.example.yaml` → copy to `secret.yaml` (not committed) → `kubectl apply`.
- **GitHub Actions secrets** (only for the scheduled jobs and Yiddish Labs): the repository →
  **Settings → Secrets and variables → Actions → New repository secret**.

The owner's **Admin → Setup** page shows which ones are switched on (never their values), and
**Admin → Keys** edits them, imports or exports a `.env` file and syncs with Render (see above).

## Password resets and emails

**Forgot password** sends a reset link by email. People with a verified phone can get a 6-digit code
by text instead.

For emails to arrive:
1. resend.com → add and verify your own domain (DNS records).
2. Set `RESEND_API_KEY` and `EMAIL_FROM`, e.g. `QuantPocket <no-reply@yourdomain.com>`.
   Without `EMAIL_FROM`, Resend's test sender only delivers to your own Resend address.
3. Set `PUBLIC_URL` to your site's address so the links point to it. Without it, links use the
   address the request came in on.
4. **Admin → Setup → Send me a test email** checks it. A refused email shows its reason there.

Without an email service, the reset page says so and offers the text-message code.

## Connecting Stripe (payments and subscriptions)

1. Create an account at dashboard.stripe.com and finish **Activate payments** (business details, bank
   account for payouts). Until then, use **Test mode** (the toggle at the top right).
2. **Products → Add product** for each plan: Pro, Elite, Ultimate. For each, add two **recurring**
   prices: monthly ($53, $109, $320) and yearly ($530, $1,090, $3,200). Open each price and copy its
   id (`price_...`).
3. In Render set:
   - `STRIPE_SECRET_KEY` = Developers → **API keys** → Secret key (`sk_live_...`, or `sk_test_...` in test mode)
   - `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_ELITE`, `STRIPE_PRICE_ELITE_YEARLY`,
     `STRIPE_PRICE_ULTIMATE`, `STRIPE_PRICE_ULTIMATE_YEARLY` = the price ids from step 2
4. Developers → **Webhooks** → **Add endpoint**: URL `https://YOUR-APP/webhooks/stripe`. Events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`.
   Copy the endpoint's **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
5. Settings → **Billing → Customer portal**: turn it on (customers change card, switch or cancel plans there).
6. Optional: `STRIPE_ACH=1` to accept bank (ACH) deposits; `DEPOSIT_FEE_PERCENT` / `DEPOSIT_FEE_FIXED` for your deposit fee.
7. Test: in test mode, buy a plan with card `4242 4242 4242 4242`, any future date and CVC. The user's
   plan changes to Pro within seconds (Admin → Users shows it). Then switch the keys to live.

## Connecting Twilio (texts and the phone hotline)

1. Sign up at twilio.com/console. Buy a phone number with **SMS and Voice** (Phone Numbers → Buy a number).
2. US numbers must be registered for business texting: **Messaging → Regulatory compliance → A2P 10DLC**
   (register the brand, then a campaign "account notifications and customer care"). Approval takes days;
   until then texts to US phones may be blocked.
3. In Render set `TWILIO_ACCOUNT_SID` (starts with `AC`) and `TWILIO_AUTH_TOKEN` from the console home
   page, and `TWILIO_FROM` = your number in the form `+17185551234`.
4. Phone Numbers → your number → **Messaging**: "A message comes in" → Webhook →
   `https://YOUR-APP/twilio/sms` (HTTP POST). **Voice**: "A call comes in" → Webhook →
   `https://YOUR-APP/twilio/voice` (HTTP POST). Call status changes → `https://YOUR-APP/twilio/voice/status`.
5. Test: verify your phone in the app (Settings → Phone), text `BAL` to the number.

## Connecting the Alpaca Broker API (opening brokerage accounts for customers)

The Broker API is for businesses that open and run accounts for their customers. (Users who already
have an Alpaca account connect it themselves with OAuth or their own API keys; nothing to do here.)

1. Apply at alpaca.markets/broker → **Get started**. You get a **sandbox** right away; going live needs
   Alpaca's review of your business, compliance setup and agreements (weeks).
2. Credentials. Either kind works; use one:
   - **Client ID and client secret** (what newer Broker dashboards give out). Set `BROKER_CLIENT_ID`
     and `BROKER_CLIENT_SECRET`, and leave `BROKER_API_KEY` / `BROKER_API_SECRET` empty.
     - QuantPocket exchanges them for a short-lived token (OAuth client-credentials) and renews it by itself.
     - It uses the sandbox token service while `BROKER_BASE_URL` is the sandbox, and the live one after.
   - **API key and secret** (Broker dashboard → API Keys → generate). Set `BROKER_API_KEY` and
     `BROKER_API_SECRET`.

   Also set `BROKER_BASE_URL=https://broker-api.sandbox.alpaca.markets`. Enter them in **Admin → Keys**
   (they are saved on Render too), or in Render → Environment.
3. Market data for charts, scanners and options: a Trading API key pair in `ALPACA_KEY_ID` /
   `ALPACA_SECRET` (free IEX data; `ALPACA_STOCK_FEED=sip` once you pay for the full feed).
4. "Connect with Alpaca" for existing Alpaca users: alpaca.markets → OAuth Apps → create an app with
   redirect URL `https://YOUR-APP/oauth/alpaca/callback`, then set `ALPACA_OAUTH_CLIENT_ID`,
   `ALPACA_OAUTH_CLIENT_SECRET` and `ALPACA_OAUTH_ENV` (`paper` or `live`).
5. Test in the sandbox: open an account in the app (Open account), approve it in the Broker dashboard,
   link a bank and make a test deposit, then place an order.
6. Going live: after Alpaca's approval, replace the sandbox keys with production keys and set
   `BROKER_BASE_URL=https://broker-api.alpaca.markets`.

Several Alpaca accounts per user (a main account and sub accounts): each user adds them under
**All accounts** with each account's own API keys; the page shows every account and totals for the live ones.

## Money levers (Admin → Business mode)

- **Deposit service fee:** a percent plus a fixed amount, with an optional cap per deposit. It is shown
  to the customer before paying.
- **Referrals:**
  - a credit for each invited friend who pays;
  - extra free-trial days for invited friends (30 days instead of 14 by default);
  - bonus credits at milestones (5, 10, 25 paying friends);
  - a top-referrers list.
- **Partner commission (Alpaca Broker API):**
  - Added to orders in accounts opened through QuantPocket, in basis points, dollars per order or
    dollars per share. Alpaca collects it for you.
  - Kept small by design. Check with Alpaca and a lawyer before turning it on.
  - Other revenue sharing (cash interest) is set in your Alpaca contract.
- **Upgrade to a registered investment adviser:** a checklist of the steps, with links, ticked off as
  you go.
- **Admin → Alpaca plans** shows your own Alpaca account against each plan's requirements, with a
  button to Alpaca's dashboard for each:
  - Alpaca Elite: $30k net deposits;
  - the $100k tier;
  - the market data plan;
  - the options level;
  - high-yield cash.

## Wealth builder, bonds & AI assistants

- **Wealth builder** (Money → Wealth builder), with a tool for each habit:
  - index funds compared by cost and 5/10-year record;
  - compound growth, early start against late start;
  - automatic investing in a fund mix (weekly or monthly);
  - a buy-and-hold check of your own trades, with the extra tax;
  - automatic dividend reinvestment (Pro);
  - a fundamentals checklist from SEC filings;
  - a tax-advantaged account planner (2026 limits);
  - a core-and-satellite portfolio that rebalances itself;
  - sector and region diversification;
  - twice-yearly rebalance reminders.
- **Bonds, crypto & AI** (Markets):
  - Treasury and bond prices by ISIN (Alpaca Fixed Income Data API, beta);
  - crypto quotes from Alpaca US, Kraken US and Kraken EU;
  - setup for Alpaca's Trading MCP server and CLI;
  - multi-leg options.
- **QuantPocket MCP server** (Pro):
  - A user creates a token on that page and adds `https://YOUR_APP/mcp` to Claude, Cursor or VS Code.
  - Tools: account, positions, orders, quotes, news, and orders on the **paper** account only.
- **News pop-ups:** today's headlines about the stocks in the open account slide in every so often.
  They can be turned off in Settings.

## Becoming a registered investment adviser (United States)

*General information, not legal advice. Talk to a securities lawyer before taking clients' money.*

Whether QuantPocket needs registration depends on what it does. Software that lets people run their
own strategies, with impersonal and general content, can fall under the **publisher's exclusion**.
Giving **personalized advice**, **managing accounts**, or running followed strategies for pay usually
makes the business an **investment adviser**.

Until then, keep **Admin → Business mode** on **Software only**; switch it once approved.

**Performance fees:** under Advisers Act Rule 205-3, a registered adviser may charge a share of profits
only to **qualified clients** — roughly $1.1M+ under management with the adviser or $2.2M+ net worth;
check the current SEC figures. Charging every user a performance fee needs legal review first.

1. **Pick the regulator.** Advisers with under $100M of regulatory assets under management register with
   their **home state** (New York: the Attorney General's Investment Advisers section). Above $110M,
   or under the **internet adviser exemption** (advice given only through an interactive website), they
   register with the **SEC**.
2. **Form the business** (LLC or corporation), get an EIN, open a business bank account.
3. **Qualify the people.** Each investment adviser representative passes the **Series 65** exam (or
   Series 7 + 66), taken through FINRA. Some designations (CFP, CFA) waive it in many states.
4. **Open an IARD account** (FINRA's Investment Adviser Registration Depository) and fund it for the fees.
5. **File Form ADV:**
   - Part 1, about the firm.
   - Part 2A, the brochure for clients.
   - Part 2B, about each adviser.
   - **Form CRS**, a short relationship summary for retail clients.
   - Each person files a **Form U4**.
6. **Write the compliance program:**
   - A Chief Compliance Officer, a compliance manual and a code of ethics.
   - Books and records, privacy (Regulation S-P) and a cybersecurity plan.
   - Rules for advertising (the Marketing Rule) and business continuity.
   - Custody: keep clients' assets at the broker (Alpaca) so the firm does not have custody.
7. **Wait for approval:** about 45 days at the SEC; states usually take 30–90 days and may ask questions.
   Pay state notice-filing fees where clients live.
8. **Keep it current:**
   - Update Form ADV within 90 days after each fiscal year ends, and promptly when facts change.
   - Deliver the brochure to clients.
   - Expect examinations, keep records 5+ years and renew state registrations.

The broker side is Alpaca's (a FINRA member broker-dealer). Do not take commissions per trade, or
the business may also need broker-dealer registration.

## Filing the business's taxes (United States)

*General information, not tax advice. A CPA familiar with SaaS and financial services is worth it.*

1. **Set up:**
   - Choose the entity: a single-member LLC files on **Schedule C** of Form 1040; it can elect S-corp
     (Form 2553, then **Form 1120-S**). A partnership files **Form 1065**, a corporation **Form 1120**.
   - Get an **EIN** (irs.gov, free) and register with the state tax department.
   - New York LLCs also file the publication requirement and the annual **IT-204-LL** filing fee.
2. **Record income:**
   - Subscriptions, performance fees and deposit fees are business income.
   - Stripe sends **Form 1099-K**; your books must match it.
   - Keep monthly bookkeeping (QuickBooks, Wave or a bookkeeper) and keep receipts 7 years.
3. **Sales tax on software:**
   - Many states tax software subscriptions; New York treats SaaS as taxable prewritten software.
   - You owe it in states where you pass their "economic nexus" thresholds.
   - Stripe Tax can calculate and collect it; register in each state before collecting.
4. **Pay estimated tax:** federal estimated payments with **Form 1040-ES** (owners of pass-through
   entities) or 1120-W (corporations), due about April 15, June 15, September 15 and January 15. Pay
   state estimates too.
5. **Self-employment tax:** **Schedule SE** for sole proprietors and partners. An S-corp pays its owner
   a reasonable salary through payroll.
6. **People:**
   - Employees: payroll taxes (Form 941 quarterly, 940 yearly), W-2s by January 31.
   - Contractors paid $600+ (from 2026, $2,000+): **Form 1099-NEC** by January 31.
   - Collect W-9s up front.
7. **Annual return:** file by March 15 (S-corps, partnerships) or April 15 (sole proprietors,
   C-corps), with extensions available (Form 7004 or 4868), plus the state returns.
8. **Users' own taxes** are theirs:
   - The broker issues their official **Form 1099-B**.
   - The Taxes page gives estimates, **Form 8949** and **Schedule D** exports.
   - It never files for them.
