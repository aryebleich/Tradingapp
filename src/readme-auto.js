// Sections of the private README that come with the code, so the README is updated with every
// change: on each deploy they are merged into the stored README (Admin → README) between markers,
// replacing the older version of the same section. Nothing here is secret (this file is in the
// repository); keep keys, revenue figures and personal details in the README itself.
export const SECTIONS = [
  { id: 'owner-faq', title: 'Owner questions and answers', md: `
### 1. How do I connect to the real servers where the trades go?
Brightfolio never sends orders to an exchange itself. Orders go to the brokerage (Alpaca Securities LLC, a FINRA member broker-dealer), and Alpaca routes them to exchanges (NYSE, Nasdaq and others) and market makers. Connecting straight to an exchange needs your own broker-dealer registration, exchange memberships and co-located servers, which is neither needed nor practical here. There are two ways to go live:

1. **Your users bring their own Alpaca accounts (the fastest way).** Create an OAuth app in the Alpaca dashboard (Apps / OAuth). Put its Client ID and Client Secret in Admin → Keys (ALPACA_OAUTH_CLIENT_ID, ALPACA_OAUTH_CLIENT_SECRET) and set ALPACA_OAUTH_ENV to live. Users then press "Connect Alpaca" in the app, and their orders are real orders in their own accounts.
2. **Brightfolio opens the accounts (Alpaca Broker API).** Apply at alpaca.markets/broker and you get sandbox keys. Put them in Admin → Keys (BROKER_API_KEY, BROKER_API_SECRET, with BROKER_BASE_URL set to the sandbox) and run the whole flow in the sandbox: account opening, KYC, funding, trades. Alpaca then reviews your app, your disclosures and your compliance setup, and you sign the Broker API agreement. After that you get production keys: change BROKER_BASE_URL to https://broker-api.alpaca.markets and add the production keys.

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

Also ask for the minimums and how payouts are reported. Brightfolio does not have an Alpaca contact person on file; use the contacts above, which Alpaca publishes.

### 3. What does "interchange" mean under Money & fees → card processing → Helcim?
Interchange is the fee the customer's card-issuing bank receives on every card payment. Visa and Mastercard set it, and it comes out of the merchant's side of the payment. It is the wholesale cost of taking cards, and it depends on the card:
- **Debit cards from large banks** are capped by law (Regulation II, the Durbin amendment) at 0.05% + 21 cents, plus 1 cent for fraud prevention.
- **Small-bank debit cards and rewards credit cards** cost more, often 1.5% to 2.5% or more.

Helcim uses "interchange-plus" pricing: you pay the exact interchange, plus Helcim's own small markup (a percentage plus cents, lower as volume grows). So in that screen:
- **"Interchange"** is the part that goes to the card's bank.
- **"Plus"** is Helcim's fee.

Debit cards keep the cost lowest, which is why card deposits here are debit-only.
` },
  { id: 'batch14', title: 'Changes: November 2026 (2)', md: `
- **Real Android app.** The Android app is now a native app (Kotlin, Jetpack Compose), not the website in a browser frame. Home (portfolio, today's change, positions, equity line), Trade (quote with bid/ask and market status, buy or sell in dollars or shares, market or limit, Day or GTC, a review step, a red warning on real money), Orders, a watchlist kept on the phone, and More (links to the rest of the site in an in-app browser tab). Sign-in by email and password in the app; Google, GitHub and phone codes go through the browser and come back to the app with a one-time code (/api/auth/app-handoff → brightfolio://signin, swapped at /api/auth/app-exchange). The session token is stored encrypted with a key in the Android Keystore. The "Android app" workflow builds it with Gradle and publishes the APK; the address comes from the APP_URL repository variable.
- **Apply for a brokerage account by text.** Anyone who texts the business number and is not a customer gets the application by text: photos of the ID and the Social Security card (NO ID / NO CARD to type instead), a request for a photo of the full card when the ID photo is cropped, the details the photos did not show (street, city, state, ZIP, name, date of birth, SSN), email, a check of everything (1 all correct / 2 something is wrong), the required disclosure questions, work status, marriage (the spouse's Social Security card; the spouse becomes the trusted contact with their phone), and AGREE to the Alpaca Customer Agreement. Then the application goes to Alpaca and the phone gets a Brightfolio account linked to it; status changes arrive by text. CONTINUE, RESTART, CANCEL and TALK (a person, in the inbox) work at any time; customers without a brokerage account text APPLY. Answers are encrypted, kept at most 7 days and deleted once sent; the Social Security card photo is never kept. Photos are read by AI only with Claude unless you allow other providers (Admin → Calls, texts & email → Apply by text). Needs the Broker API keys.
- **Open an account by phone without a texted code.** The caller's number is proven by the carrier's caller-ID check (STIR/SHAKEN "A"), or else the line hangs up and calls the number back; then a PIN entered twice. A text with the app link is offered, not required.
- **Menu.** The everyday pages always show (Home, Get started, Trade, Positions, Orders, Watchlists, Markets & news); everything else is in groups that start folded: Investing, Trading tools, Research & AI, Automation, Quant lab, Planning, Accounts, Help & settings. Each group has an arrow button and shows how many pages it holds.
- **Get started.** New accounts start with a 5-step guided setup: what they want to do, how practice money works, a first practice purchase (a fund or a well-known company, in dollars), two-factor login, and next steps matched to their goal, with how to open a real account.
- **AI assistant: prices, practice trades and balances, in simple English.** New tools: the price right now with bid/ask and whether the market is open, plus what the user holds in the chosen account; how a price moved over 1M to 5Y; practice (paper) orders, prepared by the AI as a card and sent only when the user presses "Place paper order" (to the user's Alpaca paper account through Alpaca's Trading API when connected: stocks, ETFs, crypto and options; otherwise to the Brightfolio practice account); practice order status with filled quantity and average price; practice buying power; and read-only balances and positions of real-money accounts. The assistant never places real-money orders. Account figures go to the AI only as set in Admin → AI & privacy (by default Claude yes, free providers no).
- **Screenshots.** \`node scripts/shots-alpaca.mjs\` takes pictures of the logo and of every page that works with Alpaca (into screenshots/).
` },
  { id: 'batch13', title: 'Changes: November 2026', md: `
**Market data.** Admin → Market data lists every price source:
- **Free, no key:** Alpaca, Yahoo, Stooq.
- **Free with a key:** Finnhub, Twelve Data, Tiingo, Alpha Vantage, Financial Modeling Prep, Polygon.

Each source shows its key status, speed and failures. Choose how they are used:
- **Fastest first**, measured on every call and by an hourly test;
- **your own order**;
- **race the two fastest**, where the first answer wins.

**Trading desk.**
- Every order ticket shows the market session clock (with NYSE holidays and early closes) and where the price came from, how fast, the bid and ask, and the median time for the broker to accept your orders.
- A plain guide to the order type, with a picture of where it fills.
- What the account holds, with "Sell all".
- Costs: commission, SEC and FINRA fees on sales, the spread and slippage. Admin keeps the fee rates in Market data → Trading fees.
- An opening- and closing-bell banner slides in at 9:30 and 4:00 New York time.

**Sell checks.** A sell can never be for more than the account holds (counting shares already promised to open orders). This applies on paper, Alpaca and other brokerages. Short selling happens only when the user ticks "Sell short". For people who can't short (under $2,000, FINRA rule 4210), the ticket suggests inverse funds and puts instead.

**Paper limit, stop and stop-limit orders.** Open paper orders wait for their price (checked every minute). Day orders end at the close; GTC orders last up to 90 days. They can be cancelled from the dashboard.

**More to invest in** (Futures, funds & savings):
- futures quotes, contract specs and practice trading;
- popular mutual funds with their costs and matching ETFs;
- T-bill yields, savings offers you list in Admin → Market data, and a savings-goal calculator.

**Research.**
- "About this stock / ETF" from SEC filings:
  - size class, blue chip, P/E, P/B, margins, growth;
  - returns, volatility, drawdown, beta;
  - ETF costs.
- Chart badges for size and trend.
- A "Bull / bear" chart indicator: 200-day regime shading, golden and death crosses, and 20% turns.
- A growth and value screen in the Scanner.

**Statistical arbitrage.**
- Four gap methods: Engle-Granger, Kalman filter, distance, and price ratio.
- PCA s-scores.
- A live market scan, up to the whole US market (2,000 stocks on Ultimate).

**Rates on the bonds page.** Treasury, mortgage and Fed rates (FRED, no key), Federal Reserve news, and a mortgage estimate for the user's state.

**Business inbox.** Admin → Calls, texts & email:
- texts from non-customers;
- calls forwarded to your phone, with transcribed voicemail;
- email by webhook;
- replies with AI drafts, or automatic AI replies.

**Phone line.** Callers can press 0 to spell any ticker on the keypad.

**Tax rates.** Set automatically from the user's state, filing status and income. The 2025 and 2026 IRS tables are built in; the rates update every January, and are estimated (inflation-indexed) until a new year's tables are added.

**Search and menu.**
- Search everything with Ctrl+K: pages, stocks, funds, futures, the user's own items and the glossary (never admin pages, the homepage or this README).
- The menu has new sections that fold with an arrow.

**This README.** The PDF no longer draws table grids, dividers or diagram lines, and these sections are updated with each change.
` },
];
const START = id => `<!-- auto:${id} -->`, END = id => `<!-- /auto:${id} -->`;
// The stored README with every code section in place (replaced, or added at the end).
export function mergeSections(text) {
  let out = String(text || '');
  for (const s of SECTIONS) {
    const block = `${START(s.id)}\n## ${s.title}\n${s.md.trim()}\n${END(s.id)}`;
    const a = out.indexOf(START(s.id)), b = out.indexOf(END(s.id));
    out = a >= 0 && b > a ? out.slice(0, a) + block + out.slice(b + END(s.id).length) : `${out.trimEnd()}\n\n${block}\n`;
  }
  return out;
}
