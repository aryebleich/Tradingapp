// Sections of the private README that come with the code, so the README is updated with every
// change: on each deploy they are merged into the stored README (Admin → README) between markers,
// replacing the older version of the same section. Nothing here is secret (this file is in the
// repository); keep keys, revenue figures and personal details in the README itself.
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
- **Admin pages in the app:** public/pages/owner.js (Upgrades, Money & fees, Yiddish Labs, Phone line, AI & privacy, README, Admins, Keys), public/pages/admin-ops.js (Market data, Calls, texts & email, Original strategies, SEO, AI team, Hosting), public/pages/trust-admin.js (Trust), public/pages/sponsored.js (Sponsored news, Stripe Treasury card); Overview, Users, Support inbox, System health and Setup are drawn in public/app.js (adminPage).
- **Intelligence (AI) code:** src/aiplans.js (what each plan allows), src/agentic.js and src/mcp.js (agents), src/aibots.js, src/aisignals.js, src/intel.js, src/chartcopilot.js with public/chartai.js, and public/pages/aitrade.js. Jobs: aibots (every minute), aisignals (after the close), signaltrades (every 5 minutes in the session), whales (every 6 hours).
- **Admin server code:** src/admin-site.js (site settings, this README, keys, Google Drive), src/adminusers.js (users, live P&L, deleting accounts), src/aiteam.js and src/agents.js (AI team), src/hosting.js (which server is active), src/sponsored.js, src/business/ (the My business pages: payroll, invoices, books, bank, inventory, reports).
- **This README:** stored encrypted in the database (Admin → README); the sections marked auto come from src/readme-auto.js and src/readme-overview.js and are refreshed on every deploy. The public README.md in the repository is separate and written for search engines; a check after every push (npm run clean) fails if it mentions admin, setup, keys, business figures or Yiddish Labs.
- **Homepage text:** scripts/home.py (English) and scripts/yi_home.py (Yiddish), built with python3 scripts/pages.py.
` },
  { id: 'setup', title: 'Setup information', md: `
- **Servers:** Render (render.yaml, free plan) and an Oracle Cloud VM (deploy/vm/, set up by the "Oracle server setup" workflow). Admin → Hosting picks the active server; only the active one runs scheduled jobs.
- **Database:** a hosted Turso database through DATABASE_URL and DATABASE_AUTH_TOKEN. Without them the server falls back to a local file that Render loses on restart, and the start-up log shows a DATABASE ERROR. Migrations run on every start; any failure other than "already applied" is logged.
- **Keys and settings:** in the Render environment or Admin → Keys (names are listed in the Product overview above; values are never in the code, the README or chat). ENCRYPTION_KEY must never change once data exists.
- **Health checks:** /healthz (the server answers and reaches its database; Render uses it), /healthz/routing (paper orders go to paper and real money to live), /healthz/full (hosted database, complete schema and routing together). The deploy workflow checks routing and the database on the live site after every push.
- **GitHub:** repository variable APP_URL (the live site) and secret CRON_SECRET for the scheduler; the Render deploy hook, YL_EMAIL and YL_PASSWORD as repository secrets. CI, end-to-end tests and the clean check run on every push.
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
  { id: 'yiddish-labs', title: 'Yiddish Labs translation', md: `
- **What it does:** translates new English text in the app into Yiddish with the Yiddish Labs website, through the "Yiddish Labs translation" workflow (.github/workflows/yiddish.yml, scripts/yiddish-labs.mjs). Only text added since the last run is sent (scripts/yl-last-ref.txt); the homepage, Admin and the README are never sent.
- **How to run it:** Admin → Yiddish Labs ("Translate new text now"), by hand in GitHub Actions, or after every push when the YL_AUTO repository variable is true. The owner's rule: run it after every push to main.
- **Sign-in:** only the YL_EMAIL and YL_PASSWORD repository secrets; never in the repository, a file or a command line. The browser session is cached between runs.
- **Results:** public/i18n/yi-labs.js. After each run the new lines are read, and any line that changes the meaning is deleted (the English then shows until a better translation comes). The homepage Yiddish is written by hand in scripts/yi_home.py.
` },
  { id: 'recent', title: 'Recent changes', md: `
- **Intelligence (menu → Intelligence):** the former Research & AI and AI trading sections in one: AI assistant, Plain-language research, News & sentiment, Market intelligence, AI signals, Forecasts & AI agents, AI bots, Agents & API. Institutional portfolios moved to Investing. In detail: Agents & API (MCP connector open to every plan; per-account off / ask me / automatic, order and daily limits, allowed and blocked symbols, approvals queue), AI bots (DCA, grid, scalping, plain-English rules with backtests, marketplace), AI signals (nightly engine over about 12 setups, automatic trades with moving stops, custom engines on Elite), Market intelligence (earnings-call summaries, unusual options flow, FINRA off-exchange volume, whale wallets), and the chart co-pilot. Every limit comes from one table, src/aiplans.js, shown on Plans & billing.
- **Investing:** Stock & fund analyzer (P/E and other fundamentals, technical analysis, earnings vs expectations), Low-cost index & mutual funds, Earnings vs expectations for holdings, Automated portfolios, Investing toolkit (was Wealth builder).
- **Trading tools:** New leaders scan, Short the market (practice shorts with no minimum, inverse ETFs for small accounts, short futures on practice, puts), Margin center (what the account qualifies for, Reg T and maintenance, margin-call prices, bid/ask and market makers).
- **Automation:** AI long/short portfolios (weekly book, AI memo; automatic on practice, approval on real accounts), Text commands and Phone hotline as two pages.
- **Marketplace (menu → Marketplace):** its own section for everything members share: an overview (counts and the top 3 of each part), Top traders (moved from Automation), AI strategy marketplace (moved out of AI bots; the old tab sends you there), Shared strategies, Shared portfolios and Signal channels, with tabs on top of each.
- **Equalize:** "Equalize now" on Home (Your accounts card; uses the All accounts settings) and "Equalize positions" on Positions (the same dollar amount in every stock and fund of the account picked there; options and shorts stay; preview, then password). Routes: POST /api/equalize/positions/preview and /run (src/equalize.js, planPositions).
- **Tokenized securities:** laid out as steps: what it is (the security itself vs a promise that tracks it), why people use them, the main kinds, risks with a checklist that counts, and the price check.
- **Free plan:** sponsored news pop-ups from listed companies with the paid-promotion disclosure and a Buy button; upgrading turns them off. Campaigns in Admin → Sponsored news.
- **Admin:** four groups (people, money, site & content, technical), My business (payroll, invoices, books, bank, inventory, reports), AI team (nine agents, the Manager picks the best model per role and learns from grades), Stripe Treasury setup steps in Admin → Money & fees.
- **Speed:** the app is one bundled file, pages open from memory on a repeat visit, and the legal links moved into the menu so no footer moves while pages load. A check after every push fails if any file is unused or the README names a page that no longer exists.
` },
];
// Sections that were in earlier versions: their blocks are taken out of the stored README.
export const RETIRED = ['batch12', 'batch13', 'batch14', 'batch15', 'batch16', 'batch17', 'batch18'];
// One-time tidy of the README imported from the old repository guide: setup steps that are done or
// replaced, and lists the generated Product overview already covers.
export const OBSOLETE = ['Website features', 'Run it on GitHub', 'Run locally', 'Free hosting (about 15 minutes, $0/month)', 'Automatic checks and fixes after every push', 'Pairs trading, S&P 500 plan, more brokerages', 'Deposits, owner fees, AI phone assistant, Yiddish', 'Professional site extras', 'Wealth builder, bonds & AI assistants', 'Strategy library',
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
  for (const s of SECTIONS) put(s.id, s.title, s.md, false);
  return out;
}
