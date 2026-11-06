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
  { id: 'recent', title: 'Recent changes', md: `
- **All accounts** (menu → Accounts): every Alpaca account in one portfolio, each counted once (the same account connected twice, or a master/omnibus account holding its sub accounts, is never added twice), one chart, totals, merged holdings, your own groups as separate views, and **Equalize accounts** (same mix in every account: by hand with the password, or every market open, waiting for approval or placed by itself).
- **Hosting:** Oracle Cloud server plus Render as backup, switched in Admin → Hosting; the free Cloudflare edge in front of app.brightolio.com (one button in Admin → Hosting); sign-in with Google keeps the address the user is on.
- **Paper is paper, live is live:** every order checks it goes to the right Alpaca server; checked after every deploy.
- **Stripe** set up with one button (Admin → Money & fees); payment methods come from the Stripe dashboard.
- **Sign up by text**, Admin → Users (delete account, live P&L), Retirement & IRAs, charts with prices on both sides.
` },
];
// Sections that were in earlier versions: their blocks are taken out of the stored README.
export const RETIRED = ['batch13', 'batch14', 'batch15', 'batch16', 'batch17', 'batch18'];
// One-time tidy of the README imported from the old repository guide: setup steps that are done or
// replaced, and lists the generated Product overview already covers.
export const OBSOLETE = ['Website features', 'Run it on GitHub', 'Run locally', 'Free hosting (about 15 minutes, $0/month)', 'Automatic checks and fixes after every push', 'Pairs trading, S&P 500 plan, more brokerages', 'Deposits, owner fees, AI phone assistant, Yiddish', 'Professional site extras', 'Wealth builder, bonds & AI assistants', 'Strategy library',
  'Sign in with Google', 'Sign in with GitHub', 'Connecting Stripe (payments and subscriptions)', 'Alerts to trades (webhooks)', 'More card processors (each under 3.5%)', 'Statistical arbitrage (Strategies → Statistical arbitrage)', 'Monthly bookkeeping for taxes (Taxes → Monthly bookkeeping)', 'What the chart colors mean', 'Password resets and emails', 'Admins and signing in by text message'];
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
