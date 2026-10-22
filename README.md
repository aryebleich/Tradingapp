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
- **Revenue**: monthly plans (Starter free, Pro $29, Elite $99) through Stripe Checkout, plus a **performance fee** (20%, 10% or 5% by plan) charged only on new profit above a high-water mark. The admin page shows MRR, fees due and collected, and deposits.
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
4. Live trading later: set `BROKER_BASE_URL=https://broker-api.alpaca.markets` (production Broker API, requires Alpaca's approval) or use live keys / `ALPACA_OAUTH_ENV=live`. Live trading is limited to the Pro and Elite plans, and the app shows a **LIVE** badge and warning on every order.

Tests run the whole integration against a local mock of Alpaca (`test/mock-alpaca.js`), including the exact auth headers and request bodies. Check the first real sandbox calls in your own environment as well.

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

Locally, the first account you register becomes the **admin**. In production, set `ADMIN_EMAIL` instead. Everything works without keys: emails and SMS codes are printed in the server log, and payment buttons explain what is missing.

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
