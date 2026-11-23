// Sections of the private README that come with the code, so the README is updated with every
// change: on each deploy they are merged into the stored README (Admin → README) between markers,
// replacing the older version of the same section. Nothing here is secret (this file is in the
// repository); keep keys, revenue figures and personal details in the README itself.
// Shown first: what the owner still has to do (kept current by the code).
export const TODO = { id: 'owner-todo', title: 'What you need to do', md: `
Everything that is waiting on you, in order. This list is kept up to date by the code; tick things off by telling Claude they are done.

### 1. Decisions only you can make (Admin → SEO → Open questions)
- [ ] **Regulatory status**: the exact statement for the footer, and which Alpaca disclosures must appear (legal item L6).
- [ ] **Alpaca referral**: is there a referral or payment arrangement? If yes it must be disclosed next to "we suggest Alpaca" (L1).
- [ ] **Sources** for the "922% a year" backtest example (L3) and "about 10% a year since 1957" for the S&P 500 (L4), or say they should be relabelled or removed.
- [ ] **Three bugs held back by the safety rules** (they touch money logic): BUG-003 practice margin race, BUG-004 AI refresh credits charged before it succeeds, BUG-005 options orders use the plain browser confirm. Say "fix BUG-003/004/005" and they will be fixed with tests.

### 2. Legal sign-off before switching things on
- [ ] Have LEGAL_REVIEW.md items L1 to L12 checked.
- [ ] The audited-order homepage (L9 to L12) was not released: when the flags were removed, the previous homepage was kept and the new version's code deleted. It can be rebuilt from git history (commit 1d9efaf) once L9 to L12 are approved.

### 3. Everything is merged and live (nothing is waiting on a merge)
- The Stripe fixes, the SMS and voice drawer, the AI team Chat, the planning tools with two AI explainers and the new page layout are all in the live site. There are **no feature flags any more** (see CHANGELOG_AI.md). Details: STRIPE_AUDIT.md, STRIPE_TEST_PLAN.md, COMMS_SETUP.md, COMMS_ARCHITECTURE.md, AI_CHAT.md, TRADING_TOOLS.md, DESIGN_SYSTEM.md.
- Releases are tagged (v-numbers on GitHub). To go back to one, redeploy its tag, or revert the release commit on main.

### 4. Stripe, before taking real payments (after step 3)
- [ ] In a test copy of the site: put a **test** key (starts sk_test_) in Admin → Keys and set STRIPE_TEST_ONLY=1.
- [ ] Admin → Money & fees → Stripe → **Finish setup** (adds the new webhook events; it should show 13 events and "ready").
- [ ] Run every step of docs/STRIPE_TEST_PLAN.md with Stripe's test cards.
- [ ] Decide D1 to D5 in docs/STRIPE_AUDIT.md: newer API version, a refund button in Admin, take credits back on refund, what to do on a dispute, separate test and live databases.
- [ ] Choose who answers disputes (each one sends an e-mail to the admins with the deadline).
- [ ] Going live: live keys only in Render (or Admin → Keys), a live-mode webhook with its own secret, NODE_ENV=production, STRIPE_TEST_ONLY empty.

### 5. SMS and voice drawer (only if you want it)
- [ ] Open a Telnyx account; put TELNYX_API_KEY and TELNYX_PUBLIC_KEY in Admin → Keys.
- [ ] Create a messaging profile and a voice (Call Control) application; point their webhooks at your site's /api/comms/webhooks/sms and /api/comms/webhooks/voice.
- [ ] **Register for 10DLC** (brand and campaign) before any real texts: carriers block unregistered US traffic, and approval takes days to weeks.
- [ ] For browser calls: a credential connection (TELNYX_CREDENTIAL_CONNECTION_ID), the Telnyx browser SDK saved as public/vendor/telnyx-webrtc.js, and a TURN server (TURN_URLS, TURN_SECRET).
- [ ] Give each user a number (Admin API, see COMMS_SETUP.md). The drawer appears for a user as soon as they have a number; nobody sees it before that.
- [ ] The Telnyx names in the code were written without access to Telnyx's documentation: check them against developers.telnyx.com (or ask Claude once the docs can be reached) before the first real call.
- [ ] Have the legal list in COMMS_ARCHITECTURE.md checked (consent, quiet hours by the recipient's time zone, call recording, record keeping, UK and EU). Leave call recording off until then.

### 6. Planning tools and AI explainers (live for everyone)
- [ ] Have each row of COMPLIANCE_REVIEW.md signed off; the two AI explainers are marked **Review required** (they talk about your users' own holdings and named securities).
- [ ] Check the market-data licence allows showing prices to users (sector heatmap).
- [ ] Set up a staging copy (own database, paper keys) and run the smoke test in docs/TRADING_TOOLS.md, section 6.
- [ ] The five tools are on for every signed-in user. The AI explainers have kill switches (AI_TOOLS_KILL=all, or Admin) that act at once.
- [ ] Read the AI log now and then (Admin API /api/admin/tools/log). If an answer slips through, switch the tool off at once: AI_TOOLS_KILL=all, or the kill switch.
- [ ] Decide the AI log retention (default 3 years) and an economic-calendar data provider if you want that tool.
- [ ] Decide whether the existing AI tools ("News to trades", AI signals, AI bots) should get the same advice filter (needs legal review).

### 7. Keys and safety
- [ ] ENCRYPTION_KEY is set in Render **and saved somewhere safe**. This README, saved keys and waiting texts are encrypted with it; if it changes, they cannot be read (this README would look empty: use Import below to bring the guide back).
- [ ] After any test with a public tunnel (ngrok, Cloudflare), change the keys that were used.

### 8. So Claude can check the official documentation
- [ ] docs.stripe.com and developers.telnyx.com were added to this project's allowed sites, but Claude's reader still could not open them. If you want answers checked against the live docs, look at the environment's network settings in Claude (or paste the page).
` };
export const SECTIONS = [
  { id: 'owner-faq', title: 'Owner questions and answers', md: `
### 1. How do I connect to the real servers where the trades go?
Brightolio never sends orders to an exchange itself. Orders go to the brokerage (Alpaca Securities LLC, a FINRA member broker-dealer), and Alpaca routes them to exchanges (NYSE, Nasdaq and others) and market makers. Connecting straight to an exchange needs your own broker-dealer registration, exchange memberships and co-located servers, which is neither needed nor practical here. There are two ways to go live:

1. **Your users bring their own Alpaca accounts (the fastest way).** Create an OAuth app in the Alpaca dashboard (Apps / OAuth). Put its Client ID and Client Secret in Admin → Keys (ALPACA_OAUTH_CLIENT_ID, ALPACA_OAUTH_CLIENT_SECRET) and set ALPACA_OAUTH_ENV to live. Users then press "Connect Alpaca" in the app, and their orders are real orders in their own accounts.
2. **Brightolio opens the accounts (Alpaca Broker API).** Apply at alpaca.markets/broker and you get sandbox keys. Put them in Admin → Keys (BROKER_API_KEY, BROKER_API_SECRET, with BROKER_BASE_URL set to the sandbox) and run the whole flow in the sandbox: account opening, KYC, funding, trades. Alpaca then reviews your app, your disclosures and your compliance setup, and you sign the Broker API agreement. After that you get production keys: change BROKER_BASE_URL to https://broker-api.alpaca.markets and add the production keys.

Then, for both ways:
- Turn on real-time consolidated prices (an Alpaca market-data subscription; set ALPACA_STOCK_FEED to sip).
- Make one small live trade and check it in Execution & routing: the quote at sending, the fill and the time are all recorded.
- For speed, run the server in a US East region (Render: Virginia or Ohio), close to Alpaca's trading servers. Admin → Market data shows how fast each price source answers.

### 2. Who is my Alpaca account manager, and how do I ask about the partner revenue share?
Alpaca assigns a partner or account manager to Broker API partners after onboarding. Their name and email appear in the Broker dashboard (and in the onboarding emails). Before that, or if you do not know who it is:
- Use the "Contact sales" form on alpaca.markets/broker and say you are a Broker API partner (or applying).
- Or write to Alpaca support (support@alpaca.markets) and ask them to connect you with your partner manager.

Ask for "the partner revenue-share schedule". It covers:
- any share of order-flow revenue;
- interest on customer cash;
- margin interest;
- stock lending;
- crypto and options.

Also ask for the minimums and how payouts are reported. Brightolio does not have an Alpaca contact person on file; use the contacts above, which Alpaca publishes.

### 3. What does "interchange" mean under Money & fees → card processing → Helcim?
Interchange is the fee the customer's card-issuing bank receives on every card payment. Visa and Mastercard set it, and it comes out of the merchant's side of the payment. It is the wholesale cost of taking cards, and it depends on the card:
- **Debit cards from large banks** are capped by law (Regulation II, the Durbin amendment) at 0.05% + 21 cents, plus 1 cent for fraud prevention.
- **Small-bank debit cards and rewards credit cards** cost more, often 1.5% to 2.5% or more.

Helcim uses "interchange-plus" pricing: you pay the exact interchange, plus Helcim's own small markup (a percentage plus cents, lower as volume grows). So in that screen:
- **"Interchange"** is the part that goes to the card's bank.
- **"Plus"** is Helcim's fee.

Debit cards keep the cost lowest, which is why card deposits here are debit-only.
` },
  { id: 'admin-files', title: 'Admin files (where the owner-only parts live)', md: `
Only admins can open these pages or reach their data: every /api/admin route sits behind one admin check (server.js), and owner pages redirect anyone else to Home.
- **Admin pages in the app:** public/pages/owner.js (Upgrades, Money & fees, Phone line, AI & privacy, README, Admins, Keys), public/pages/admin-ops.js (Market data, Calls, texts & email, Original strategies, SEO, AI team, Hosting), public/pages/trust-admin.js (Trust), public/pages/sponsored.js (Sponsored news, Stripe Treasury card); Overview, Users, Support inbox, System health and Setup are drawn in public/app.js (adminPage).
- **Intelligence (AI) code:** src/aiplans.js (what each plan allows), src/agentic.js and src/mcp.js (agents), src/aibots.js, src/aisignals.js, src/intel.js, src/chartcopilot.js with public/chartai.js, and public/pages/aitrade.js. Jobs: aibots (every minute), aisignals (after the close), signaltrades (every 5 minutes in the session), whales (every 6 hours).
- **Admin server code:** src/admin-site.js (site settings, this README, keys, Google Drive), src/adminusers.js (users, live P&L, deleting accounts), src/aiteam.js and src/agents.js (AI team), src/hosting.js (which server is active), src/sponsored.js, src/business/ (the My business pages: payroll, invoices, books, bank, inventory, reports).
- **This README:** stored encrypted in the database (Admin → README); the sections marked auto come from src/readme-auto.js and src/readme-overview.js and are refreshed on every deploy. The public README.md in the repository is separate and written for search engines; a check after every push (npm run clean) fails if it mentions admin, setup, keys, business figures or Yiddish Labs.
- **Homepage text:** scripts/home.py (English) and scripts/yi_home.py (Yiddish), built with python3 scripts/pages.py.
` },
  { id: 'setup', title: 'Setup information', md: `
- **Servers:** the Oracle Cloud VM (deploy/vm/, set up by the "Oracle server setup" workflow) is the active server since 2026-11-23; Render (render.yaml, free plan) is a standby with STANDBY=1 that serves pages only. Admin → Hosting shows each server's health, CPU, memory, disk and version, with Deploy now, Restart and Make active; only the active server runs scheduled jobs. MIGRATION_ORACLE.md has the move and the way back.
- **Database:** a SQLite file on the VM's disk (DB_FILE=/app/data/quantpocket.db with PERSISTENT_DISK=1), backed up every hour (48 hourly and 30 daily kept, a daily encrypted copy to Oracle Object Storage when OCI_BACKUP_PAR_URL is set). Admin → Database shows its size, tables and backups, makes a backup, downloads or restores one, and switches maintenance mode. Render still points at the old Turso database (DATABASE_URL). Migrations run on every start; any failure other than "already applied" is logged.
- **Keys and settings:** in the Render environment or Admin → Keys (names are listed in the Product overview above; values are never in the code, the README or chat). ENCRYPTION_KEY must never change once data exists.
- **Health checks:** /healthz (the server answers; it runs no query and reports what the database last did), /healthz/routing (paper orders go to paper and real money to live), /healthz/full (hosted database, complete schema and routing together). The deploy workflow checks routing and the database on the live site after every push.
- **GitHub:** repository variable APP_URL (the live site) and secret CRON_SECRET for the scheduler; the Render deploy hook as a repository secret. CI, end-to-end tests and the clean check run on every push.
- **First steps for a new server:** set the keys, open /healthz/full until it answers ok, then place one small paper order and one small live order and check them in Execution & routing.
` },
  { id: 'legal', title: 'Legal information and integrations', md: `
- **What Brightolio is, legally:** software, not a broker-dealer and not an investment adviser. It does not hold customer money; orders go to the user's own brokerage. Admin → Upgrades (Business mode tab) switches between software-only mode and registered-adviser mode, which changes fees, wording and what strategies may do.
- **Public legal pages:** Terms (/terms), Privacy (/privacy), Risk disclosure (/risk), Security (/security), Investor protection and insurance (/insurance), Contact (/contact) and Status (/status). The homepage, the app menu and the legal pages carry the "software, not a broker or adviser" notice, and a test checks the public pages for wording that promises returns.
- **Required disclosures in the app:** backtests and projections are hypothetical; real-money orders need the user's confirmation; sponsored news on the free plan is labeled as paid promotion and only covers companies listed on an exchange; beginner guides and the AI assistant give education, not personal advice.
- **Integrations (keys in Admin → Keys):** Alpaca (Broker API, OAuth and trading/data keys), Charles Schwab, TradeStation, Tradier and tastytrade; Plaid (bank links and round-ups); Stripe (subscriptions, billing portal, ACH, Treasury), Helcim and Square (card processing); Twilio (texts, phone line) and Resend (email); Google and GitHub sign-in, Google Drive (this README as a PDF); AI providers (Groq, Gemini, OpenRouter, Anthropic); market data (Finnhub, Twelve Data, Tiingo, Alpha Vantage, FMP, Polygon, FRED); QuickBooks; Cloudflare (edge server); Turso (database).
- **Privacy rules kept in the code:** the owner's real emails and phone appear only as fingerprints in the source; keys are stored encrypted and shown masked.
` },
  { id: 'business', title: 'Business information', md: `
- **Intelligence and AI by plan:** Starter connects one AI agent (practice orders), runs one bot checked daily and sees 3 signals; Pro adds real-money agent orders with approval, 10 bots every 15 minutes, automatic signal trades on practice and earnings summaries; Elite adds automatic real-money agent orders, extended hours, 25 bots every 5 minutes, live signal trades, custom engines and real-time options flow; Ultimate 60 bots checked every minute and the highest API limits.
- **Revenue:** monthly or yearly subscriptions (Pro, Elite, Ultimate, each with a free trial; prices in the Product overview above), a performance fee on new profits that falls with the plan (20% Starter, 10% Pro, 5% Elite, 2.5% Ultimate), credit packs, sponsored news on the free plan (Admin → Sponsored news), and the Alpaca partner revenue share once the Broker API is live (see Owner questions above).
- **Where the numbers are:** Admin → Overview (monthly recurring revenue, run rate, signups to paying), Admin → Money & fees (fees, card processing, deposits), Admin → Upgrades (plans, Business mode).
- **The owner's own business books:** the My business pages (Business dashboard, Invoices & payments, Bookkeeping, Bank & receipts, Inventory, Payroll, Financial reports), admin only. The currency converter is open to every user.
- **Referrals:** a user who invites someone earns a credit when the invited person starts paying (Invite & earn in the menu).
` },
  { id: 'recent', title: 'Recent changes', md: `
- **AI providers (src/llm.js):** keys are trimmed; Gemini thinks with room left for the answer, and a retired Gemini model is replaced by the best one the key can use (GEMINI_MODEL picks one); when a provider fails, the next one with a key answers. Admin → AI & privacy → Test the AI shows each provider's exact answer or error.
- **Home → Why your P/L moved today (src/pnlwhy.js):** market, sector and stock-specific parts of the day's P/L, the news, and an AI write-up; on/off and refresh time per plan in Admin → AI & privacy; refreshing sooner costs credits (pnlwhy in the credit prices).
- **Short selling (src/shortdesk.js) and the margin switch:** margin is off until the user switches it on per account (brokerage accounts: on the broker's approval, Alpaca configurations); shorts and borrowing are refused while off. The desk: borrow status, squeeze risk, a sized plan, screener, open shorts, beta hedge, AI thesis and cover plan.
- **Options desk (src/optionsdesk.js, public/pages/optionsdesk.js):** Greeks, moneyness, decay, chance ITM, contract analysis with returns and a risk disclosure to accept, my options with live return, close, roll and exercise, AI strategist, explainer and review. The old chain stays as the Spread builder (#/optionschain). Nine more Options lab templates.
- **AI hedge funds (src/aifunds.js):** multi-strategy style; protection by short/inverse fund, SPY puts or a put spread.
- **Homepage:** the hero screenshot is a live dashboard drawn in public/site.js. Real estate (page, RentCast, property in net worth) removed.
- **Company logos (src/logos.js):** /logo/:symbol, cached for a week, letter badge when no source answers; added next to tickers by attachLogos in public/app.js.
- **Admin → SEO:** the ad video in every version to download (ad/ holds the full-HD English and Yiddish files).
- **Algorithms on every plan:** full stat-arb engine and strategy builder, pair bots and option income bots on practice money.
- **Live ratio pair bots (src/pairslive.js):** an intraday pairs model (beta from the ratio of mean prices, volatility-ratio sizing), live quotes from the Alpaca stream or polling, two-leg orders through placeOrder with the risk checks, Paper first; real money after an intraday backtest, PAIRS_LIVE_MIN_PAPER_DAYS days on Paper (default 5), step-up and the password. PAIRS_LIVE_MAX_ORDERS_PER_MIN caps a member's orders a minute (default 20). Experimental, not investment advice.
- **Order flow (OFI) lab (src/hfofi.js, research/hf-ofi):** academic exercise, simulation only; the R project renders offline with ./run.sh.
- **Header:** the Paper/Live switch moved behind a small button in the header. **Page gears:** settings for one page open from a gear in its header (GEAR in public/app.js); the Settings page lists where they went.
- **Admin → Analytics (src/analytics.js):** overview, website (private counting: daily one-way visitor hashes, no cookies), section usage, phone, texts, P&L; System health is its last tab.
- **AI tools (src/aitools.js):** what-if scenarios on holdings, news to trades, theme to watchlist, head to head (toolsAi a day per plan).
- **Intelligence (since 2026-11-18 split between menu → Research and menu → Automate, see STRUCTURE_AUDIT.md):** the former Research & AI and AI trading sections in one: AI assistant, Plain-language research, News & sentiment, Market intelligence, AI signals, Forecasts & AI agents, AI bots, Agents & API. Institutional portfolios moved to Investing. In detail: Agents & API (MCP connector open to every plan; per-account off / ask me / automatic, order and daily limits, allowed and blocked symbols, approvals queue), AI bots (DCA, grid, scalping, plain-English rules with backtests, marketplace), AI signals (nightly engine over about 12 setups, automatic trades with moving stops, custom engines on Elite), Market intelligence (earnings-call summaries, unusual options flow, FINRA off-exchange volume, whale wallets), and the chart co-pilot. Every limit comes from one table, src/aiplans.js, shown on Plans & billing.
- **Investing:** Stock & fund analyzer (P/E and other fundamentals, technical analysis, earnings vs expectations), Low-cost index & mutual funds, Earnings vs expectations for holdings, Automated portfolios, Investing toolkit (was Wealth builder).
- **Trading tools:** New leaders scan, Short the market (practice shorts with no minimum, inverse ETFs for small accounts, short futures on practice, puts), Margin center (what the account qualifies for, Reg T and maintenance, margin-call prices, bid/ask and market makers).
- **Automation:** AI long/short portfolios (weekly book, AI memo; automatic on practice, approval on real accounts), Text commands and Phone hotline as two pages.
- **Trade, Positions and Orders follow the account in the side panel:** the full screens for an Alpaca account; simple pages (public/pages/simple.js: ticket, holdings with Close, order list with Cancel) for practice money and the other brokerages. Limit orders from the ticket go to every brokerage.
- **Fonts are served from the site** (public/fonts, rules at the top of theme.css and site.css): no requests to Google, and the content-security policy allows fonts and styles from this site only.
- **Errors customers read (src/usererrors.js):** only errors about what they typed. Anything about keys, setup or a server fault is shown to them as "This is not available right now" and listed for the owner in Admin → Analytics → System health → Setup problems customers ran into. On pages, lines that mention key names, "on this server" or the admin area are shown to admins only (public/app.js hideSetupNotes).
- **Admin → Phone & text accounts (src/phoneaccounts.js):** every account opened by a hotline call or by text, how it was opened, email, password, PIN, plan and brokerage application; add an email, send the password link again, remove the phone, and switch sign-up by text or by phone on and off.
- **Page guides:** one switch hides them on every page (in any guide, or on the Settings page under "Page guides").
- **This README** is shown to read only (Admin → README), and is put in order at every start: nothing said twice (organize in src/readme-auto.js), code sections refreshed.
- **Yiddish:** written by hand in heimish usage (public/i18n/yi-heimish.js, applied last, after yi.js and yi-more.js; the homepage in scripts/yi_home.py). There is no automatic translation run.
- **Optional features (src/extras.js, public/pages/extras.js):** fourteen features, each off until the user switches it on at the top of the Settings page: My day (Home card), monthly statement (job on the 1st), voice commands, goals in plain words, family allowances (job; tables family_members, family_ledger), a second opinion, behaviour coach and tax-aware selling (one window before an order, hooked in api() for /orders and /alpaca/orders), mistake replay, explain a move, strategy autopsy, earnings-call promise check, crowd check, questions for a rav. Tools with a page are under My tools in the menu (shown once one is on). All of it is worked out from prices and the user's own history; no AI key is needed.
- **Settings in sections:** Optional features, Display and language, Trading and taxes, Sign-in and security, Connections, Your data (the cards are regrouped after the page draws; SET_SECTIONS in public/app.js).
- **Marketplace (menu → Marketplace):** its own section for everything members share: an overview (counts and the top 3 of each part), Top traders (moved from Automation), AI strategy marketplace (moved out of AI bots; the old tab sends you there), Shared strategies, Shared portfolios and Signal channels, with tabs on top of each.
- **Equalize:** "Equalize now" on Home (Your accounts card; uses the All accounts settings) and "Equalize positions" on Positions (the same dollar amount in every stock and fund of the account chosen in the side panel; options and shorts stay; preview, then password). Routes: POST /api/equalize/positions/preview and /run (src/equalize.js, planPositions).
- **Tokenized securities:** laid out as steps: what it is (the security itself vs a promise that tracks it), why people use them, the main kinds, risks with a checklist that counts, and the price check.
- **Free plan:** sponsored news pop-ups from listed companies with the paid-promotion disclosure and a Buy button; upgrading turns them off. Campaigns in Admin → Sponsored news.
- **Admin:** four groups (people, money, site & content, technical), My business (payroll, invoices, books, bank, inventory, reports), AI team (nine agents, the Manager picks the best model per role and learns from grades), Stripe Treasury setup steps in Admin → Money & fees.
- **Speed:** the app is one bundled file, pages open from memory on a repeat visit, and the legal links moved into the menu so no footer moves while pages load. A check after every push fails if any file is unused or the README names a page that no longer exists.
` },
];
// Sections that were in earlier versions: their blocks are taken out of the stored README.
export const RETIRED = ['yiddish-labs', 'batch12', 'batch13', 'batch14', 'batch15', 'batch16', 'batch17', 'batch18'];
// One-time tidy of the README imported from the old repository guide: setup steps that are done or
// replaced, and lists the generated Product overview already covers.
export const OBSOLETE = ['Yiddish Labs translation', 'Website features', 'Run it on GitHub', 'Run locally', 'Free hosting (about 15 minutes, $0/month)', 'Automatic checks and fixes after every push', 'Pairs trading, S&P 500 plan, more brokerages', 'Deposits, owner fees, AI phone assistant, Yiddish', 'Professional site extras', 'Wealth builder, bonds & AI assistants', 'Strategy library',
  'Sign in with Google', 'Sign in with GitHub', 'Connecting Stripe (payments and subscriptions)', 'Alerts to trades (webhooks)', 'More card processors (each under 3.5%)', 'Statistical arbitrage (Strategies → Statistical arbitrage)', 'Monthly bookkeeping for taxes (Taxes → Monthly bookkeeping)', 'What the chart colors mean', 'Password resets and emails', 'Admins and signing in by text message',
  // Plan prices compared with other platforms and their averages: not kept in the guide.
  'Pricing comparison', 'Competitor prices (per month)', 'Averages', 'Feature limits, set from the same platforms'];
export function tidy(text) {
  let out = String(text || '');
  for (const id of RETIRED) { const a = out.indexOf(`<!-- auto:${id} -->`), e = `<!-- /auto:${id} -->`, b = out.indexOf(e); if (a >= 0 && b > a) out = out.slice(0, a) + out.slice(b + e.length); }
  // A "## heading" section runs to the next "## " heading (or an auto block).
  const lines = out.split('\n'), keep = []; let skip = false;
  for (const l of lines) {
    if (/^## /.test(l) || /^<!-- (\/)?auto:/.test(l)) skip = /^## /.test(l) && (OBSOLETE.includes(l.slice(3).trim()) || /^Changes: /.test(l.slice(3).trim()));
    if (!skip) keep.push(l);
  }
  return keep.join('\n').replace(/QuantPocket/g, 'Brightolio').replace(/\n{3,}/g, '\n\n');
}
// Nothing twice: a "## heading" that appears again is folded into the first one (its new lines
// only), and a bullet or paragraph that already appeared anywhere earlier is dropped. The parts
// that come with the code (auto blocks) are left as they are; hand-written text that repeats
// them goes. Run on every start, so the README is put in order again at every push.
export function organize(text) {
  const src = String(text || ''), norm = l => l.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[*_`]/g, '');
  // What the auto blocks already say.
  const seen = new Set();
  for (const m of src.matchAll(/<!-- auto:[\w-]+ -->[\s\S]*?<!-- \/auto:[\w-]+ -->/g)) for (const l of m[0].split('\n')) if (l.trim().length > 24) seen.add(norm(l));
  const parts = src.split(/(<!-- auto:[\w-]+ -->[\s\S]*?<!-- \/auto:[\w-]+ -->)/);
  const heads = new Map(); // heading → index in out[]
  const out = [];
  for (const part of parts) {
    if (/^<!-- auto:/.test(part)) { out.push({ auto: part }); continue; }
    // Hand-written text: sections by "## heading".
    for (const sec of part.split(/\n(?=## )/)) {
      const lines = sec.split('\n'), head = /^## /.test(lines[0]) ? norm(lines[0]) : null, keep = [];
      let fence = false;
      for (const [i, l] of lines.entries()) {
        if (/^```/.test(l.trim())) fence = !fence;
        const k = norm(l), countable = !fence && k.length > 24 && !/^#/.test(l) && !/^\|?[-| :]+\|?$/.test(l.trim());
        if (i === 0 && head) { keep.push(l); continue; }
        if (countable && seen.has(k)) continue;
        if (countable) seen.add(k);
        keep.push(l);
      }
      if (head && heads.has(head)) { const first = out[heads.get(head)], extra = keep.slice(1).join('\n').trim(); if (extra) first.text = `${first.text.trimEnd()}\n${extra}\n`; continue; }
      // A heading left with nothing under it goes too.
      if (head && !keep.slice(1).join('').trim()) continue;
      if (head) heads.set(head, out.length);
      out.push({ text: keep.join('\n') });
    }
  }
  return out.map(o => o.auto ?? o.text).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}
const START = id => `<!-- auto:${id} -->`, END = id => `<!-- /auto:${id} -->`;
// The stored README with every code section in place (replaced, or added at the end). `top` is
// the generated Product overview: it is replaced in place, or put right after the title.
export function mergeSections(text, top = null) {
  let out = String(text || '');
  const put = (id, title, md, first) => {
    const block = `${START(id)}\n## ${title}\n${md.trim()}\n${END(id)}`;
    const a = out.indexOf(START(id)), b = out.indexOf(END(id));
    if (a >= 0 && b > a) out = out.slice(0, a) + block + out.slice(b + END(id).length);
    else if (first) { const m = /^# .*\n/m.exec(out); out = m ? out.slice(0, m.index + m[0].length) + '\n' + block + '\n\n' + out.slice(m.index + m[0].length).replace(/^\n+/, '') : `${block}\n\n${out}`; }
    else out = `${out.trimEnd()}\n\n${block}\n`;
  };
  if (top) put('overview', 'Product overview', top, true);
  put(TODO.id, TODO.title, TODO.md, true); // above everything else, right under the title
  for (const s of SECTIONS) put(s.id, s.title, s.md, false);
  return out;
}
