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

- Built-in admins: the owner's two email addresses and phone number.
  - They are not written anywhere in the code: `src/site.js` keeps only slow one-way fingerprints
    (scrypt), so the public source does not show who the owner is.
  - `ADMIN_EMAIL` (comma-separated) still works too.
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

## Strategy library

**Strategies** in the app holds seven ready-made rotation strategies:
- BG Ensemble;
- Multi-Model ETF Rotation (4 sleeves);
- Leveraged ETF Rotation;
- Gold Miner;
- Large-Cap Momentum;
- Large-Cap Pullback;
- Macro Rotation.

They are defined in `src/rotation/templates.js`. They are the same published rules for everyone. Each user copies one and can:
- **follow it by hand**:
  - today's walkdown, with every value filled in from market data (Wilder RSI, SMAs, returns,
    Bollinger, momentum);
  - any value can be overtyped;
  - the orders are sized in whole shares and placed with one click.
- **run it automatically**:
  - at a chosen time on each rebalance day (daily, Wednesday, or the first trading day of the month),
    with an optional trailing stop;
  - in software-only mode this works on the paper account only; see "Investment-adviser rules" below.
- **edit everything**:
  - thresholds, indicators, tickers, sleeves, lists and parameters (form or JSON);
  - preview and backtest before saving.

Some rules were not available:
- Gold Miner shows only the steps on one day's path; the walk stops at "needs a rule".
- Leveraged ETF Rotation steps 4-12 are rebuilt from the public "TQQQ For The Long Term" logic and
  marked "check".

**Reality Check** compares each strategy's live daily results with its backtest (z-test on the mean
daily return, plus a drawdown limit):
- statuses: Healthy, Watch or Drifting;
- a text or email when it gets worse;
- optional auto-throttle: 100%, 50% or 0% of the strategy's money.

The **portfolio split** suggests win-rate-weighted allocations (10%-70% each).

### Investment-adviser rules (what needs registration)

Not legal advice. Confirm with a securities lawyer before taking real customers.

- **Fine without registration (software-only mode):**
  - Software that publishes the **same impersonal rules and signals to everyone** fits the
    "publisher's exclusion" (*Lowe v. SEC*, 1985).
  - So does software that lets users build, test and run **their own** strategies: webhooks, pair
    bots, the code lab, S&P 500 plans, scanners, their own copies of the rules.
  - QuantPocket does not look at a user's finances or tell them what is right for them.
- **Needs a registered investment adviser:**
  - Letting **QuantPocket's own ready-made strategies trade a real account by themselves**. That is
    managing money; the SEC treats automated "robo" advisers as investment advisers.
  - Copying **another trader's** signals into a real account without review.
  - Charging a **performance fee** (a share of profits, for qualified clients only).
- **What the app does:**
  - In software-only mode, ready-made strategies run automatically on paper only. On a real account
    the user follows them by hand and places each order.
  - Signal-fleet subscriptions to someone else's channel can be automatic on paper; real accounts
    review each signal.
  - Strategies already set to automatic on a real account are paused until the mode changes.
- **Turning it on:** Admin → Business mode → "Registered investment adviser" turns all three on, after
  the registration is approved. See "Becoming a registered investment adviser" below.

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

Twilio carries the text messages (alerts, sign-in codes, trading by text) and the phone line (IVR).
Plan about an hour of work, plus a few days to two weeks of carrier review before US texting works.
Voice calls work as soon as the number is set up.

### 1. Account
1. Sign up at **twilio.com/try-twilio** and verify your email and phone.
2. **Upgrade the account** (Console → Admin → Account billing → Upgrade; add a card).
   - A trial can only call and text the few phone numbers you verified yourself.
   - Trial messages carry a "Sent from a Twilio trial account" prefix.
   - Trial accounts expire, and only work in your own country.

### 2. Phone number
- **Phone Numbers → Manage → Buy a number.** Pick a US number with **Voice** and **SMS** ticked.
- Choose one kind:
  - **Local (10DLC)** number: about $1.15 a month.
  - **Toll-free** (8XX) number: a little more per month; the text-message review is free and usually faster.

### 3. Get texting approved (US carriers require this; unregistered texts are blocked)
**Local number → A2P 10DLC registration** (Messaging → Regulatory Compliance → Onboarding):
1. **Profile:**
   - Without a business tax ID (EIN): a *Starter / Sole Proprietor* profile, with a US or Canadian
     address.
   - With an EIN: a *Business Profile* (legal name exactly as on the IRS letter, EIN, website,
     address, authorized contact).
2. **Brand:**
   - Sole proprietor: $4.50 one time. Twilio texts a one-time code to your own mobile; answer it
     within 24 hours.
   - Standard: $46 one time, includes secondary vetting.
3. **Campaign:**
   - Costs: a $15 vetting fee per campaign (not refunded if rejected, so edit and resubmit instead of
     deleting), plus a monthly fee: about $2 for sole proprietor, $10 for standard, $1.50 for low
     volume.
   - Use case: **Account notifications** (or *Customer care*; *Mixed* if you add both).
   - **Description:** "QuantPocket sends account holders alerts about their own trading account
     (orders, price alerts, risk warnings), one-time sign-in codes, and replies to account
     questions they text in. No marketing."
   - **How people opt in:** "Users add their phone number in the QuantPocket app under Settings →
     Phone and confirm it with a 6-digit code. Phone sign-up callers confirm with a texted code.
     Message frequency varies. Reply STOP to opt out, HELP for help."
   - **Sample messages:**
     - "QuantPocket sign-in code: 123456"
     - "Risk guardian (paper): stop-loss hit, sold 10 AAPL. Reply STOP to opt out."
     - "Paper: equity $103,240, cash $12,400"
   - Tick *Embedded links* if alerts include links.
   - Add the **Privacy Policy** and **Terms** links: `https://YOUR-APP/privacy.html`,
     `https://YOUR-APP/terms.html`.
4. **Attach the number:** add it to the campaign's **Messaging Service** (created during
   registration, or Messaging → Services).
5. **Wait for approval:** campaigns are vetted by hand, from a few days to two weeks. Until then,
   texts to US phones fail with error **30034** (unregistered number).

**Toll-free number → Toll-free verification**
1. Open the number and go to **Regulatory Information → Verify**.
2. Fill in the same use-case description, opt-in text and sample messages as above, and add a
   screenshot of the Settings → Phone screen.
3. Verification is free and takes about 3-5 business days.
4. Until it is approved, texts are blocked (error **30032**). Calls are not affected.

### 4. Keys in QuantPocket
1. Console home → **Account Info**: copy the **Account SID** (starts with `AC`) and the **Auth Token**.
2. **Admin → Keys** (or Render → Environment), set:
   - `TWILIO_ACCOUNT_SID`;
   - `TWILIO_AUTH_TOKEN`;
   - `TWILIO_FROM` = your number in the form `+17185551234`.
3. Also set `PUBLIC_URL` to the exact address Twilio will call (for example
   `https://quantpocket.onrender.com`, no trailing slash).
   - Every Twilio request is checked against its signature, which uses this address and the Auth
     Token.
   - A wrong `PUBLIC_URL` makes every call and text answer "forbidden".

### 5. Point the number at QuantPocket
Phone Numbers → Manage → **Active numbers** → your number:
- **Voice Configuration:**
  - *Configure with* → **Webhook, TwiML Bin, Function, Studio Flow, Proxy Service**. Not SIP trunk:
    with a trunk the webhook never fires.
  - **A call comes in** → Webhook → `https://YOUR-APP/twilio/voice` → **HTTP POST**.
  - **Call status changes** → `https://YOUR-APP/twilio/voice/status` → HTTP POST.
- **Messaging Configuration:**
  - **A message comes in** → Webhook → `https://YOUR-APP/twilio/sms` → **HTTP POST**.
  - If the number is in a Messaging Service, set the same URL in the service instead: Messaging →
    Services → your service → **Integration** → *Send a webhook*.
- **Save configuration.**

Admin → Phone line shows these three addresses ready to copy.

### 6. Protect the account
- **Geo permissions:** Voice → Settings → *Geo permissions*, and Messaging → Settings → *Geo
  permissions*. Allow only the countries you serve (for example US and Canada). This blocks
  expensive fraud calls and texts.
- **Usage alerts:** Console → Admin → Account billing → *Usage triggers* (for example, email at $20
  a day).
- **If the Auth Token leaks:**
  1. Console → Account → *API keys & tokens* → create a secondary token, then **promote** it.
  2. Update `TWILIO_AUTH_TOKEN` in Admin → Keys right away. Old-token requests fail the signature
     check.
- **Opt-out keywords:** STOP, UNSUBSCRIBE and HELP are handled by Twilio automatically. A user who
  texts STOP gets no more texts until they text START.

### 7. Test
1. In the app: **Settings → Phone**. Add your mobile, confirm the code and set a PIN.
2. Text `BAL` to the number. You should get your paper balance back.
3. Call the number. You should hear the welcome menu (see below); press 1 for paper, then 3 for the
   market clock.
4. **Admin → Phone line** lists the call; **Admin → Setup** shows Twilio as connected.
5. If something fails: Twilio Console → **Monitor → Logs → Errors**.
   - **11200:** QuantPocket could not be reached or answered with an error; check `PUBLIC_URL` and
     that the app is running.
   - **30032 / 30034:** texting not approved yet; see step 3.
   - **21608:** the account is still a trial; see step 1.

### Costs (US, check twilio.com/en-us/pricing)
- Number: about $1.15 a month (local).
- Each text and each minute of a call: a fraction of a cent to about a cent, plus carrier fees on
  texts.
- Registration: a one-time brand fee and $15 campaign vetting, plus the monthly campaign fee (see
  step 3).

### The phone line menu (IVR, managed in Admin → Phone line)

```
Welcome  (a new number: 1 = open a free account by phone)
  ▸ 1 Paper trading   ▸ 2 Live trading
Main menu
  ▸ 1 Account info   ▸ 2 Positions   ▸ 3 Market clock   ▸ 4 Place a trade
  ▸ 5 Cancel open orders (PIN)   ▸ 6 Close ALL positions (extra confirm + PIN)
  ▸ 7 Ask the assistant (when AI is on)   ▸ 9 Switch paper/live   ▸ 0 Hang up
Trade
  ▸ Pick a stock (1-9) ▸ 1 buy / 2 sell ▸ shares + # ▸ 1 confirm / 2 cancel ▸ 4-digit PIN ▸ market order
```

- **Opening an account by phone:**
  1. QuantPocket texts a 6-digit code to the calling number, which proves the caller holds that phone.
  2. The caller picks a 4-digit PIN.
  3. The account opens with a $100,000 paper account.
  4. A text brings a sign-in link (sign-in is by phone code). The real brokerage application is
     finished in the app, because it needs ID and address details that a keypad can't take.
- **Safety:**
  - A PIN is needed for every action that changes an account.
  - Closing everything needs an extra confirmation.
  - Each order is capped at a set number of shares (10,000 by default, changeable in Admin).
  - The account's own risk rules apply to every order.
  - 3 wrong PINs end the call, and the number's owner gets a text.
  - Every request is checked against **Twilio's signature** (`TWILIO_AUTH_TOKEN`, with `PUBLIC_URL`
    set to the address Twilio calls). Without it, the server refuses phone-line requests in production.
  - Each step's choices travel in the next step's URL, which Twilio signs. Any server instance can
    answer any step.
- **Admin → Phone line** has these settings:
  - turn the line on or off;
  - the greeting and the voice;
  - the 9 stocks on keys 1 to 9;
  - the share limit;
  - allow sign-up by phone;
  - let free-plan callers use the paper menu (you pay the call minutes). Otherwise the line is part
    of Pro.

  The page also shows the Twilio webhook addresses, 30-day counts and the call log.

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

## More card processors (each under 3.5%)

Deposits use the cheapest method that is set up, unless the customer picks another one. The cost of
each method on a $500 deposit is in Admin → Money & fees.

| Method | Cost | Keys (Admin → Keys) | Confirmation |
|---|---|---|---|
| Bank transfer (Stripe ACH) | 0.8%, at most $5 | `STRIPE_SECRET_KEY` | Stripe webhook |
| Helcim (debit) | interchange + 0.5% + 25¢ | `HELCIM_API_TOKEN` | signed result |
| **Square** | 2.9% + 30¢ | `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY` (`SQUARE_ENV=sandbox` to test) | webhook `https://YOUR-APP/webhooks/square`, event `payment.updated` |
| **Authorize.net** | 2.9% + 30¢, plus a $25/month gateway fee | `ANET_LOGIN_ID`, `ANET_TRANSACTION_KEY`, `ANET_SIGNATURE_KEY` (`ANET_ENV=sandbox` to test) | webhook `https://YOUR-APP/webhooks/authorizenet`, event `net.authorize.payment.authcapture.created` |
| Stripe card | 2.9% + 30¢ | `STRIPE_SECRET_KEY` | Stripe webhook |

How the new processors work:
- Square and Authorize.net use their own hosted payment pages, so card numbers never touch this server.
- A deposit counts only when a webhook arrives with a valid signature and the paid amount matches.
- Prices are the processors' published standard rates (2026); check their sites, since negotiated
  rates can be lower.
- Not added: PayPal Checkout, at 3.49% + 49¢ (over 3.5% once the fixed fee counts).
- Stripe rejects credit cards for deposits automatically. With Square and Authorize.net, a customer
  could pay with a credit card. If your terms say debit only, limit card types in each processor's
  settings.

## Statistical arbitrage (Strategies → Statistical arbitrage)

Pairs trading for a whole basket of related stocks (banks, energy, chips, staples…):
- **Live pair matrix:** a heat map of every pair in the basket. It switches between three views:
  - correlation of daily returns;
  - Engle-Granger cointegration t-statistic (outlined when below -3.34);
  - today's z-score of the gap.

  Click a square to open that pair in Pairs trading.
- **s-scores:** each stock's daily return is split into the basket's common move and the stock's own
  residual. The summed residual is fitted as a mean-reverting process (Avellaneda and Lee, 2010):
  - buy when s < -1.25;
  - sell short when s > +1.25;
  - close inside ±0.5.

  Stocks whose residual does not pull back within half the window are skipped.
- **Backtest:** re-fitted every day on past data only, equal money per position, costs included.
- **Python:** "Run it in Python" opens the same model in the code lab as a numpy script.
  - It runs in the browser (Pyodide), so it costs the server nothing.
  - numpy, pandas and scipy load on first `import`.
- **Plan limits:**

  | Plan | Stocks per basket | Live refresh |
  |---|---|---|
  | Starter | 6 | by hand |
  | Pro | 15 | every 60 s |
  | Elite | 30 | every 30 s |
  | Ultimate | 50 | every 15 s |

  The code lab loads up to 10 symbols on Starter and Pro, and the plan's basket size on Elite and
  Ultimate.

## Monthly bookkeeping for taxes (Taxes → Monthly bookkeeping)

- **Month by month:**
  - trades, money bought and sold;
  - realized short-term and long-term gains;
  - wash-sale amounts;
  - dividends, interest and broker fees (from Alpaca's account activity);
  - deposits and withdrawals.
- **Year-to-date totals:** realized gains, and how much to set aside for taxes (the user's rates, with
  dividends and interest as ordinary income).
- **The four IRS estimated-tax periods (Form 1040-ES):** Jan–Mar due Apr 15, Apr–May due Jun 15,
  Jun–Aug due Sep 15, Sep–Dec due Jan 15. Each shows its amount.
- **Books CSV:** the monthly table, the quarters and a journal of every line item, for an accountant
  or a spreadsheet.
- **Monthly email (opt-in):** last month's books on the 1st, with a reminder when an estimated
  payment is due.
- These are estimates for planning. The broker's 1099 is the official record.

## What the chart colors mean

Every equity chart (portfolio, backtests, strategies, pairs, the homepage demo) colors each stretch
of the line by what the money is doing. Each color is judged against the starting value (dashed
line) and the highest value so far:

| Color | Name | When |
|---|---|---|
| Green | New high | above the start **and** at its highest point so far: a gain that is still growing |
| Blue | Gain, below its high | still above the start, but down from its highest point: a gain giving some back |
| Amber | Loss, recovering | below the start, but up on the day |
| Red | Loss, falling | below the start and down (or flat) on the day |

The area between the line and the starting value is shaded in the same color. Under each chart:
- the current state, the change since the start, and how far it is from the high;
- a key showing only the colors that appear on that chart.

The logic is in `public/chartstates.js`, shared by the app and the homepage.

## AI & privacy (Admin → AI & privacy)

AI tools learn about a website in three ways: crawling its public pages, reading its public code
(GitHub), and receiving what the site's own assistant sends them. Each one is controlled here.

- **AI crawlers:**
  - Covered: Google Gemini (`Google-Extended`), OpenAI, Anthropic, Perplexity, Common Crawl, Apple,
    Meta, ByteDance, Amazon and others.
  - All are **blocked by default**. Allow each one separately.
  - The choice is published as `/robots.txt`, plus an `X-Robots-Tag: noai, noimageai` header on
    every page while all AI crawlers are blocked.
  - Search engines can still list the public pages; switch that off too if you want.
  - The GitHub Pages copy of the homepage gets the same default robots.txt.
- **Never open to any crawler:** the app, Admin, the API, sign-in, webhooks and the phone line.
- **llms.txt:** an optional short description you write. AI tools may use that text and nothing more.
- **The app's assistant:**
  - Emails, phone numbers, card and account numbers and keys are **always removed** from everything
    sent to the AI provider.
  - Account figures (balances, positions) go only to providers that do not train on what they
    receive (Claude, or your own model), unless you choose otherwise.
  - Free tiers such as Google Gemini's may use what they receive to improve their products.
- **Your own details:**
  - The owner's emails and phone are not in the code; only one-way fingerprints are kept (see Admins).
  - On public pages (marketplace, signal channels) creators show as a nickname such as
    "Trader 3F9A2C", never an email.
- **What was already taken:**
  - Blocking stops new reading; what a crawler already took stays until that company refreshes its data.
  - Google offers removal requests in Search Console.
  - If the GitHub repository is public, its history still holds earlier versions. Making the
    repository private (GitHub → Settings → General → Change visibility) is the only way to hide
    it. GitHub Pages for a private repository needs a paid GitHub plan.

## Partner revenue sharing on Broker API accounts

When QuantPocket opens brokerage accounts for customers through the Alpaca Broker API, Alpaca earns
money on those accounts. A partner can get part of it, but **only what the contract with Alpaca says**.
Nothing is shared automatically.

**What can be shared (each one is negotiated with Alpaca):**

| Source | Who pays | How a partner gets a share |
|---|---|---|
| Your own commission on each order | the customer | QuantPocket adds it to each order (Admin → Business mode → Partner commission); Alpaca collects it and pays it out. Already built. |
| Payment for order flow (PFOF) | market makers, per routed order | a percentage of what Alpaca receives for your customers' orders, if the contract includes it |
| Interest on uninvested cash (High-Yield Cash sweep) | the sweep banks | a split of the bank fee Alpaca receives, set in the contract |
| Margin interest | customers who borrow | a split, if offered |
| Fully paid securities lending | borrowers of your customers' shares | Alpaca offers partners "customizable tiers for pricing and revenue splits" |
| Crypto trading, deposit and withdrawal fees | the customer | Alpaca's configurable crypto commission: two-way (you and Alpaca) or three-way splits |

**How to set it up:**
1. Ask your Alpaca account manager for the partner revenue-share schedule (PFOF, cash sweep, margin,
   securities lending, crypto). Get every rate in writing in the Broker API agreement.
2. Ask how payouts work: monthly statements, which entity receives them, minimums.
3. Turn on only what the contract allows. The commission QuantPocket adds itself is set in
   Admin → Business mode. Shares of PFOF, interest and lending are paid by Alpaca and need no setting
   here. Record them in the business's books as income.
4. Before turning anything on, check with a securities lawyer:
   - In the United States, pay that depends on trades (commissions, a share of PFOF) is generally
     reserved for registered broker-dealers. Ask how your role is set up.
   - Customers must be told about it: the commission is shown before each order, and PFOF is disclosed
     in Alpaca's order-routing reports (SEC Rule 606).

**Public records so far:**
- **Binance (June 2026).** Binance's Securities Trading Terms, published June 2, 2026, give Binance:
  - 50% of the payment for order flow Alpaca receives on Binance users' US stock orders;
  - 65% of the profit from lending users' shares, after users are paid their interest.

  Alpaca handles execution, clearing, settlement and custody; the service runs through Nest Trading
  Limited, regulated in Abu Dhabi (ADGM). Some outlets also report that Binance holds a minority stake
  in Alpaca; that is not confirmed in the primary terms. These are partner-specific terms, not
  Alpaca's standard rates.
  ([Cointelegraph](https://cointelegraph.com/news/binance-partnership-tokenized-stock-custodian-alpaca),
  [Blockchain.news](https://blockchain.news/news/binance-alpaca-revenue-split-tokenized-stocks))
- **Alpaca's own statements:**
  - **PFOF sharing (2021).** When Alpaca raised its Series B (August 2021), it said it planned to share
    PFOF revenue with the partners that embed its APIs. It did not give the split. A reporter guessed
    15–25%, but that is not a disclosed figure.
    ([TechCrunch](https://techcrunch.com/2021/08/30/alpaca-raises-50m-to-rapidly-scale-its-equities-trading-api-business/))
  - **Crypto commission model.** Partners share revenue on crypto trading fees, deposits and
    withdrawals, in two-way or three-way splits.
    ([Alpaca](https://alpaca.markets/blog/alpaca-launches-configurable-crypto-commission-model-for-broker-api-partners/))
  - **Fully paid securities lending for the Broker API.** Customizable pricing tiers and revenue splits.
    ([Alpaca](https://alpaca.markets/blog/alpaca-launches-fully-paid-securities-lending-for-broker-api/))
  - **High-Yield Cash.** The interest-bearing cash sweep was announced with Alpaca's January 2026
    funding. The sweep terms say Alpaca receives a fee from each deposit bank, and that fee affects
    the rate customers earn.
    ([Business Wire](https://www.businesswire.com/news/home/20260114323821/en/Alpaca-Raises-$150-Million-at-a-$1.15B-Valuation-to-Build-the-Global-Standard-for-Brokerage-Infrastructure),
    [sweep terms](https://files.alpaca.markets/disclosures/library/Alpaca+Securities+LLC+Profit+Sharing+FDIC+Bank+Sweep+Program+Terms+and+Conditions.pdf))
- **Regulatory filings.** Alpaca Securities LLC files audited annual reports (Form X-17A-5) with the SEC.
  - The [FY2021 filing](https://www.sec.gov/Archives/edgar/data/1702580/000170258022000002/ASFinal2021Audit.pdf)
    describes it as a wholly owned subsidiary of AlpacaDB, Inc.
  - These filings do not list individual partners' revenue splits.
  - Alpaca's SEC Rule 606 reports show which market makers pay for its order flow (for example,
    Alpaca's partnership with Citadel Securities).

What other partners receive is mostly private contract terms. The Binance terms are the only
published per-partner split found so far (as of October 2026).

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
