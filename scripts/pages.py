# Generates the static marketing pages in public/ from one shared layout.
# Run: python3 scripts/pages.py   (output is committed; the server just serves files)
import os, html
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')
UPDATED = 'October 22, 2026'

def layout(title, desc, body, path=''):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="theme-color" content="#0b1324">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-512.png">
<link rel="manifest" href="manifest.webmanifest">
<meta property="og:type" content="website">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:image" content="og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="site.css">
<script src="config.js"></script>
<script type="module" src="site.js"></script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="./"><img src="favicon.svg" alt=""><b>Quant<span>Pocket</span></b></a>
  <nav class="links"><a href="./#how">How it works</a><a href="./#who">Use cases</a><a href="./#features">Features</a><a href="./#pricing">Pricing</a><a href="./#faq">FAQ</a></nav>
  <a class="btn ghost" data-app="#/login" href="app">Sign in</a>
  <a class="btn" data-app="#/register" href="app">Start free</a>
</div></header>
<main>
{body}
</main>
<footer class="site"><div class="wrap">
  <div class="cols">
    <div><a class="logo" href="./"><img src="favicon.svg" alt=""><b>Quant<span>Pocket</span></b></a><p style="max-width:300px">Turn alerts and strategies into trades on your own brokerage account, from your browser, your phone, or a text message.</p></div>
    <div><b>Product</b><a href="./#how">How it works</a><a href="./#features">Features</a><a href="./#pricing">Pricing</a><a href="./#demo">Live demo</a><a data-app="#/register" href="app">Create account</a></div>
    <div><b>Company</b><a href="contact.html">Contact &amp; support</a><a href="terms.html">Terms of Service</a><a href="privacy.html">Privacy Policy</a><a href="risk.html">Risk Disclosure</a></div>
  </div>
  <p class="disc">Investing involves risk, including possible loss of principal. Backtests and projections are hypothetical, are built with the benefit of hindsight and do not guarantee future results. QuantPocket is a software provider and is not a broker-dealer. Brokerage services are provided by Alpaca Securities LLC, member FINRA/SIPC, under your own account agreement with Alpaca. Nothing on this site is an offer, solicitation or recommendation to buy or sell any security. See the <a href="risk.html" style="display:inline">Risk Disclosure</a>.</p>
  <p class="disc">© 2026 QuantPocket. All rights reserved.</p>
</div></footer>
</body>
</html>
'''

ICON = {
 'chart': '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
 'bolt': '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
 'msg': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
 'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
 'cube': '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
 'doc': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
 'pulse': '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
 'hook': '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
 'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
 'layers': '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
 'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
 'grid': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 'phone': '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
 'bank': '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>',
 'plug': '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
 'eye': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
}
def ic(k, size=20):
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[k]}</svg>'
GOOGLE = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'
def gbtn(label='Sign up with Google', cls='lg'):
    # Shown only when the app has Google sign-in set up (site.js checks and fills in the link).
    return f'<a class="btn google {cls}" data-google hidden href="app#/register">{GOOGLE}<span>{label}</span></a>'

# "What do you want to do?" picker: (id, chip, icon, title, text, bullets)
INTENTS = [
 ('alert', 'Turn my alert into a trade', 'hook', 'Your alert fires. The order goes out.',
  'Paste a private webhook URL into a TradingView, TrendSpider or Zapier alert. When it fires, QuantPocket checks your risk rules and places the order in seconds.',
  ['TradingView strategy and indicator alerts', 'JSON, or plain text like <code>buy AAPL 10</code>', 'Every signal logged with its fill, or the reason it was blocked']),
 ('broker', 'Connect my broker', 'plug', 'Your own brokerage account, connected in minutes.',
  'Open an Alpaca brokerage account right inside QuantPocket, sign in with an Alpaca account you already have, or paste API keys.',
  ['One-click Alpaca sign-in', 'Start on paper, switch to live when you are ready', 'Disconnect at any time']),
 ('multi', 'Trade paper and live at once', 'layers', 'One signal, more than one account.',
  'Send each alert to your paper account and your Alpaca account at the same time, then compare simulated and real fills side by side.',
  ['Pick the accounts for each webhook', 'Sizing in shares or dollars', 'One log across accounts']),
 ('risk', 'Set my risk rules', 'shield', 'Guardrails before every order.',
  'Each webhook has its own limits, checked before anything is sent to your broker. Brackets put a stop-loss and take-profit on every manual entry.',
  ['Maximum position size per ticker', 'Maximum trades per day and allowed tickers', 'Long-only: sells never go below zero']),
 ('review', 'Review my trades', 'eye', 'Every order, fill and signal in one record.',
  'Filter your order history, see why a signal was rejected, and follow realized gains by tax lot.',
  ['Order history with status filters', 'Signal log with the reason for every rejection', 'Realized P&amp;L, wash-sale flags and Form 8949 export']),
 ('all', 'See my accounts in one place', 'grid', 'Paper and live, side by side.',
  'Positions, orders, buying power and an equity chart that turns green or red with your P&amp;L, on desktop and on your phone.',
  ['Switch between paper and Alpaca with one tap', 'Live quotes and market news', 'Works on any phone, no app to install']),
 ('auto', 'Run a strategy hands-off', 'clock', 'Test it, then let it run.',
  'Backtest a rule-based strategy on years of data, then deploy it as a bot that acts every trading day, or schedule recurring buys.',
  ['Ten presets, or describe rules in plain English', 'Walk-forward testing and an optimizer', 'Pause everything with one tap or one text']),
 ('text', 'Trade by text or phone', 'msg', 'Your account, from any phone.',
  'Text <b>BAL</b>, <b>POS</b> or <b>BUY 5 AAPL</b>, or call the hotline and say it. Every order needs your personal PIN.',
  ['Works from your verified number only', 'Voice menu for balance and positions', 'Text PAUSE to stop all automation']),
]

USECASES = [
 ('Retail traders', 'Automation on your own account', 'Get reliable alert-to-broker automation without running servers or writing integrations.',
  ['Connect the charting tools you already use', 'Send alerts straight to your own Alpaca account', 'Start on paper before going live']),
 ('TradingView users', 'Your strategy, executed', 'Your Pine Script strategy already knows when to buy and sell. QuantPocket places those orders for you.',
  ['Copy-and-paste alert message templates', 'Size from the alert or a fixed amount', 'Exits close the whole position']),
 ('Swing traders', 'Set it and walk away', 'Pick your entry, then let bracket orders manage the exit while you are away from the screen.',
  ['Stop-loss and take-profit placed with the entry', 'Good-till-canceled orders', 'Price alerts by text message']),
 ('Quants &amp; developers', 'Code-first trading', 'Run Python algorithms on QuantConnect, backtest rules here, and send orders from any script or AI agent.',
  ['QuantConnect LEAN projects and cloud backtests', 'Webhooks from any language, any tool', 'Risk rules your code cannot bypass']),
 ('Long-term investors', 'Invest on a schedule', 'Automate recurring buys and keep an eye on taxes, without watching the market all day.',
  ['Weekly or monthly recurring buys', 'Tax-loss harvesting ideas', 'An equity curve that shows how you are doing']),
 ('Learners', 'Practice with zero risk', 'Learn how strategies behave with $100,000 in paper money and honest numbers.',
  ['Backtests with drawdowns and losing years', 'Paper trading that works like the real thing', 'Plain-English strategy builder']),
]

FEATURES = [
 ('chart', 'Backtesting', 'Years of daily data, stops, costs, Sharpe, drawdown, walk-forward checks and an optimizer.'),
 ('hook', 'TradingView alerts', 'Send orders to your broker from TradingView strategies and indicator alerts.'),
 ('pulse', 'TrendSpider &amp; Zapier', 'Any tool that can call a webhook can place orders, inside your rules.'),
 ('cube', 'QuantConnect', 'Create LEAN projects from templates and run cloud backtests of Python algorithms.'),
 ('bolt', 'Paper trading', 'Test every strategy with $100,000 in paper money before risking real money.'),
 ('shield', 'Risk rules', 'Position limits, trade limits, allowed tickers and bracket orders.'),
 ('layers', 'Stocks, options &amp; crypto', 'US stocks and ETFs, option chains and spreads, and crypto through Alpaca.'),
 ('users', 'Paper + live together', 'Route a single alert to paper and live at the same time.'),
 ('grid', 'One trading screen', 'Orders, positions, watchlists, news and an economic calendar in one place.'),
 ('phone', 'Made for phones', 'A full trading app in your phone browser, plus SMS and a voice hotline.'),
 ('bank', 'Built-in brokerage', 'Open and fund an Alpaca brokerage account without leaving QuantPocket.'),
 ('doc', 'Tax center', 'Gains by lot, wash-sale flags, an estimated tax bill and Form 8949 export.'),
]

FAQ_AUTO = [
 ('Can I turn my TradingView alerts into trades?', 'Yes. Create a webhook under <b>Alerts to trades</b>, paste its URL into the alert&rsquo;s <b>Webhook URL</b> field, and use our message template. Strategy alerts can pass the direction and size with <code>{{strategy.order.action}}</code> and <code>{{strategy.order.contracts}}</code>.'),
 ('Can I run one strategy across all my accounts?', 'One webhook can send each alert to your paper account and your connected Alpaca account at the same time, with the same risk rules. Each QuantPocket login connects one Alpaca account.'),
 ('I pick my own entries. Can the rest be automated?', 'Yes. Enter with a bracket order and the stop-loss and take-profit are placed with it. You can also send exit alerts or schedule trades.'),
 ('Can my AI agent place real trades?', 'Any program that can send an HTTPS request can use a webhook, AI agents included. It can only do what that webhook allows: its accounts, sizes and risk rules. Start on paper.'),
 ('Can I send my QuantConnect algorithm to my broker?', 'You can create QuantConnect projects and run cloud backtests from QuantPocket. For live orders, QuantConnect can trade your Alpaca account directly, or your algorithm can call a QuantPocket webhook so its orders follow your risk rules here.'),
 ('Can I set a swing trade and walk away?', 'Yes. Place a bracket order (entry, stop-loss and take-profit) as good-till-canceled. The exit orders wait at Alpaca even while you are offline.'),
 ('Can I automate trades on my own brokerage account?', 'Yes, on your own Alpaca account. Live trading and sending alerts to Alpaca are part of Pro, which you can try free for 14 days.'),
 ('Can my strategy run fully hands-off?', 'Bots run your rules every trading day and webhooks act on alerts around the clock. Automation can still fail or act on bad data, so check your account regularly.'),
 ('Can I send TrendSpider bot alerts to my broker?', 'Yes. TrendSpider bots can call a webhook URL. Use your QuantPocket webhook URL and the same JSON message.'),
 ('Can I trigger trades from Zapier?', 'Yes. Add a <b>Webhooks by Zapier</b> POST step with your webhook URL and the fields <code>ticker</code>, <code>action</code> and <code>quantity</code>.'),
]
FAQ_ACCOUNT = [
 ('Will I make money?', 'Nobody can promise that. Most active strategies underperform simply holding an index after costs. QuantPocket shows how an idea behaved in the past, how it held up out of sample, and the range of outcomes to expect, so you can decide with your eyes open.'),
 ('Can I sign up with Google?', 'Yes. Choose <b>Sign up with Google</b> and your account is ready in seconds, with a confirmed email. You can add a password later in Settings.'),
 ('Who holds my money?', 'Your brokerage account is opened and held by Alpaca Securities LLC, a FINRA/SIPC member. QuantPocket connects to it with access you control and can revoke at any time.'),
 ('How does the free trial work?', 'Every paid plan starts with 14 days free. Cancel before the trial ends and you are not charged. The free Starter plan has no time limit.'),
 ('How does the performance fee work?', 'Each month we compare your account to its previous peak, adjusted for deposits and withdrawals. You pay the plan&rsquo;s percentage only on value above that peak. Losses must be recovered before any new fee is charged.'),
 ('Is texting trades secure?', 'Commands only work from the phone number you verified, and every order needs your personal PIN. You can pause all bots and scheduled trades with one text.'),
 ('Can I cancel any time?', 'Yes. Cancel from <b>Manage billing</b> in the app; you keep access until the end of the period you paid for. You can also export or delete all your data from Settings.'),
]

def checks(items):
    return '<ul class="checks">' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>'
def tab(key, label, first):
    return f'<button role="tab" data-tab="{key}" aria-selected="{"true" if first else "false"}">{label}</button>'
def panel(key, cls, inner, first):
    return f'<div class="{cls}" role="tabpanel" data-panel="{key}"{"" if first else " hidden"}>{inner}</div>'

def index():
    chips = ''.join(tab(i, ic(k, 18) + f'<span>{c}</span>', n == 0) for n, (i, c, k, t, d, b) in enumerate(INTENTS))
    panels = ''.join(panel(i, 'ipanel', f'<div class="ic">{ic(k, 24)}</div><h3>{t}</h3><p>{d}</p>{checks(b)}<a class="btn" data-app="#/register" href="app">Get started free &rarr;</a>', n == 0)
                     for n, (i, c, k, t, d, b) in enumerate(INTENTS))
    uc_tabs = ''.join(tab(f'u{n}', t, n == 0) for n, (t, h, d, b) in enumerate(USECASES))
    uc_panels = ''.join(panel(f'u{n}', 'ucpanel', f'<span class="kicker">{t}</span><h3>{h}</h3><p>{d}</p><b class="wyg">What you get</b>{checks(b)}', n == 0)
                        for n, (t, h, d, b) in enumerate(USECASES))
    feats = ''.join(f'<div class="feature"><div class="ic">{ic(i)}</div><h3>{t}</h3><p>{d}</p></div>' for i, t, d in FEATURES)
    faq = lambda items: ''.join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q, a in items)
    body = f'''
<section class="hero"><div class="wrap hero-grid">
  <div>
    <a class="eyebrow" href="#how"><span>New</span> Turn TradingView alerts into trades &rarr;</a>
    <h1>Every trade you take, <span>executed from one place.</span></h1>
    <p class="lead">Stocks, ETFs, options and crypto through your own Alpaca account. Systematic, discretionary, swing or recurring investing: test it, paper trade it and automate it on the same platform.</p>
    <div class="cta">{gbtn()}<a class="btn outline lg" data-app="#/register" href="app">Start free with email</a></div>
    <ul class="ticks"><li>Set up in 3 minutes</li><li>$100,000 paper account</li><li>No card needed</li></ul>
  </div>
  <figure class="shot"><div class="frame"><i></i><i></i><i></i></div><img src="hero-app.webp" width="1600" height="1000" alt="QuantPocket portfolio dashboard with equity chart, positions and order ticket" fetchpriority="high"><figcaption>Illustrative paper-trading account</figcaption></figure>
</div>
<div class="wrap"><div class="logos"><span>Brokerage by <b>Alpaca Securities LLC</b> (FINRA/SIPC)</span><span>Alerts from <b>TradingView</b>, <b>TrendSpider</b> &amp; <b>Zapier</b></span><span><b>QuantConnect</b> LEAN</span><span>Payments by <b>Stripe</b></span></div></div>
</section>

<section id="start"><div class="wrap">
  <h2 class="sec center">What do you want to do?</h2>
  <p class="sub center">Pick one. Everything works on paper first, with no risk.</p>
  <div class="intents" data-tabs><div class="ichips" role="tablist" aria-label="What do you want to do">{chips}</div>{panels}</div>
</div></section>

<section class="alt" id="how"><div class="wrap">
  <h2 class="sec">How it works</h2>
  <p class="sub">Set up your strategy. Send a signal. Orders go to every account you chose, inside your rules.</p>
  <div class="how">
    <ol class="howsteps">
      <li><b>Create</b><span>Define entries and exits, sizing in shares or dollars, and risk limits. Use a TradingView alert or our JSON templates.</span></li>
      <li><b>Connect</b><span>Link your Alpaca account in seconds, or start with the built-in paper account. Choose which accounts each webhook trades.</span></li>
      <li><b>Send</b><span>Fire a webhook from any signal source. Orders execute, and fills, P&amp;L and positions update in one place.</span></li>
    </ol>
    <div class="term">
      <div class="bar"><i></i><i></i><i></i><span>TradingView alert &rarr; QuantPocket</span></div>
<pre><span class="k">POST</span> /hook/&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;
{{
  <span class="s">"ticker"</span>: <span class="v">"NASDAQ:AAPL"</span>,
  <span class="s">"action"</span>: <span class="v">"buy"</span>,
  <span class="s">"quantity"</span>: <span class="v">10</span>
}}</pre>
      <div class="res"><div><i></i>Risk rules passed <em>max $5,000 per ticker &middot; 3 of 10 trades today</em></div><div><i></i>Paper: <b>BUY 10 AAPL</b> filled</div><div><i></i>Alpaca: <b>BUY 10 AAPL</b> accepted</div></div>
      <p class="figcap">Illustration with example values.</p>
    </div>
  </div>
</div></section>

<section id="who"><div class="wrap">
  <h2 class="sec">Who is QuantPocket for?</h2>
  <p class="sub">Whatever your style, QuantPocket automates the parts you don&rsquo;t want to do by hand. Pick the profile that fits you best.</p>
  <div class="usecases" data-tabs>
    <div class="uctabs" role="tablist" aria-label="Trader profiles">{uc_tabs}</div>
    <div class="ucbody">{uc_panels}
      <div class="ucnav"><button type="button" data-step="-1" aria-label="Previous profile">&larr;</button><span data-count>1 of {len(USECASES)}</span><button type="button" data-step="1" aria-label="Next profile">&rarr;</button></div>
    </div>
  </div>
</div></section>

<section class="alt" id="features"><div class="wrap">
  <h2 class="sec">An all-in-one trading automation platform</h2>
  <p class="sub">Connect your strategies, choose your accounts and automate your trades, from the first backtest to live orders.</p>
  <div class="features">{feats}</div>
</div></section>

<section id="demo"><div class="wrap">
  <h2 class="sec">Live demo: test a strategy now</h2>
  <p class="sub">Pick a ticker and a classic strategy. It runs on the same engine as the app, using market data since 2015.</p>
  <div class="demo">
    <form id="demoForm">
      <label>Ticker<input name="symbol" value="SPY" maxlength="8" autocomplete="off"></label>
      <label>Strategy<select name="preset"><option>SMA cross</option><option>RSI dip in uptrend</option><option>Bollinger revert</option><option>Breakout</option><option>MACD trend</option><option>Momentum 12m</option></select></label>
      <button class="btn" style="margin-top:14px;width:100%">Run backtest</button>
      <div class="err" id="demoErr"></div>
      <p class="mu" style="font-size:13px" id="demoSrc"></p>
    </form>
    <div>
      <canvas id="demoChart" aria-label="Equity curve"></canvas>
      <div class="stats" id="demoStats"></div>
    </div>
  </div>
</div></section>

<section class="alt" id="pricing"><div class="wrap">
  <h2 class="sec center">Simple pricing. Start free.</h2>
  <p class="sub center">Every paid plan starts with a 14-day free trial. Plus a small share of new profits above your high-water mark, so you only pay more when your account reaches new highs.</p>
  <div class="toggle" id="billing"><button class="on" data-i="m">Monthly</button><button data-i="y">Yearly <em>2 months free</em></button></div>
  <div class="plans">
    <div class="plan"><h3>Starter</h3><p class="tag">Learn and practice</p><div class="price">$0<small>/forever</small></div><p class="fee">+ 20% of new profits</p><ul><li>$100,000 paper account</li><li>1 alert webhook (paper)</li><li>Backtests &amp; AI strategy builder</li><li>Alpaca paper &amp; sandbox trading</li><li>Markets, news &amp; watchlists</li></ul><a class="btn ghost" data-app="#/register" href="app">Start free</a></div>
    <div class="plan best"><div class="ribbon">Most popular</div><h3>Pro</h3><p class="tag">Automate your trading</p><div class="price" data-m="$29" data-y="$290">$29<small data-m="/month" data-y="/year">/month</small></div><p class="fee">+ 10% of new profits</p><ul><li>Everything in Starter</li><li>Live trading with Alpaca</li><li>10 alert webhooks to Alpaca</li><li>Auto-trading bots &amp; scheduled trades</li><li>Optimizer + walk-forward testing</li><li>QuantConnect cloud backtests</li><li>Full SMS &amp; voice hotline</li></ul><a class="btn" data-app="#/register" href="app">Start 14-day free trial</a></div>
    <div class="plan"><h3>Elite</h3><p class="tag">For serious capital</p><div class="price" data-m="$99" data-y="$990">$99<small data-m="/month" data-y="/year">/month</small></div><p class="fee">+ 5% of new profits</p><ul><li>Everything in Pro</li><li>Lowest performance fee</li><li>50 alert webhooks</li><li>Priority AI strategy builder</li><li>Tax-loss harvesting report</li><li>Priority support</li></ul><a class="btn ghost" data-app="#/register" href="app">Start 14-day free trial</a></div>
  </div>
  <p class="fine">Secure checkout by Stripe. Cancel anytime. Trading involves risk; see the <a href="risk.html">Risk Disclosure</a>.</p>
</div></section>

<section id="faq"><div class="wrap faq" style="max-width:860px">
  <h2 class="sec center">Popular questions</h2>
  <div data-tabs>
    <div class="toggle" role="tablist" aria-label="Question topics">{tab('fa', 'Automation', True)}{tab('fb', 'Account &amp; pricing', False)}</div>
    {panel('fa', 'qs', faq(FAQ_AUTO), True)}{panel('fb', 'qs', faq(FAQ_ACCOUNT), False)}
  </div>
</div></section>

<section><div class="wrap"><div class="band final">
  <div><h2>You&rsquo;re 3 minutes away from your first trade.</h2>
    <ul class="ticks"><li>Free version</li><li>Set up in 3 minutes</li><li>Paper account for testing</li></ul></div>
  <div class="startbox">
    {gbtn('Sign up with Google', 'wide')}
    <div class="or" data-google hidden><span>or</span></div>
    <form id="startForm"><input type="email" name="email" placeholder="Email address" autocomplete="email" aria-label="Email address" required><button class="btn light">Start free</button></form>
  </div>
</div></div></section>
<div class="stickycta"><a class="btn lg" data-app="#/register" href="app">Start free</a></div>
'''
    return layout('QuantPocket: automate your trading from one place', 'Turn TradingView, TrendSpider and Zapier alerts into trades, backtest and paper trade strategies, and automate them on your own Alpaca account. Sign up with Google in seconds.', body)

def doc(title, desc, content):
    return layout(f'{title} | QuantPocket', desc, f'<article class="doc"><h1>{title}</h1><p class="mu">Last updated {UPDATED}</p>{content}</article>')

TERMS = '''
<p>These Terms of Service ("Terms") govern your use of the QuantPocket website, apps, SMS and voice services (together, the "Service"). By creating an account you agree to these Terms.</p>
<h2>1. What QuantPocket is</h2>
<p>QuantPocket is software for researching, testing and automating trading strategies. We are not a broker-dealer, bank or custodian, and we do not hold customer securities. Live trading happens in your own brokerage account with Alpaca Securities LLC under your separate agreement with Alpaca.</p>
<h2>2. No investment advice</h2>
<p>Content, backtests, projections, templates and AI-generated rules are for information and education. They are not a recommendation to buy or sell any security. You decide which strategies to run and are responsible for every order placed from your account, including orders placed by bots, schedules, SMS or voice commands you set up.</p>
<h2>3. Eligibility and accounts</h2>
<p>You must be at least 18 years old and able to form a binding contract. Keep your password, PIN and two-factor device secure. You are responsible for activity under your account. Tell us immediately about any unauthorized use.</p>
<h2>4. Plans, fees and payments</h2>
<ul>
<li>Paid plans are billed monthly in advance through Stripe and renew automatically until cancelled.</li>
<li>Performance fees are calculated monthly at your plan's rate on account value above a high-water mark, adjusted for deposits and withdrawals. No performance fee is charged while an account is below its high-water mark.</li>
<li>Card deposits are accepted from debit cards only and are subject to verification and processing times before they are available in your brokerage account.</li>
<li>Fees are non-refundable except where required by law.</li>
</ul>
<h2>5. Acceptable use</h2>
<p>Do not misuse the Service: no unlawful activity, market manipulation, attempts to access other accounts, scraping, reverse engineering, or overloading our systems. We may suspend accounts that violate these Terms.</p>
<h2>6. Third-party services</h2>
<p>The Service connects to Alpaca, QuantConnect, Twilio, Stripe and other providers. Their terms govern your use of their services, and we are not responsible for their availability or actions.</p>
<h2>7. Data and availability</h2>
<p>Market data may be delayed, incomplete or inaccurate. Automated features run on a best-effort basis and may be delayed or fail to run, for example during outages or market closures. Do not rely on the Service as your only way to manage positions.</p>
<h2>8. Disclaimers</h2>
<p>The Service is provided "as is" without warranties of any kind. Past performance and hypothetical results do not guarantee future results.</p>
<h2>9. Limitation of liability</h2>
<p>To the maximum extent permitted by law, QuantPocket is not liable for trading losses, lost profits, or indirect or consequential damages. Our total liability for any claim is limited to the fees you paid us in the three months before the claim.</p>
<h2>10. Termination</h2>
<p>You may close your account at any time from Settings. We may suspend or end access for violations or legal reasons. Sections that by their nature should survive termination will survive.</p>
<h2>11. Changes</h2>
<p>We may update these Terms. Material changes will be announced by email or in the app before they take effect.</p>
<h2>12. Contact</h2>
<p>Questions? Use the <a href="contact.html">contact page</a>.</p>
'''
PRIVACY = '''
<p>This policy explains what personal information QuantPocket collects, why, and the choices you have.</p>
<h2>What we collect</h2>
<ul>
<li><b>Account data:</b> email address, a hashed password, optional phone number, a hashed PIN, two-factor settings, and tax-rate preferences. If you sign in with Google, Google shares your email address and an account identifier with us; we do not receive your Google password.</li>
<li><b>Webhooks:</b> the alerts you send to your webhook URLs and the resulting orders, kept in your signal log.</li>
<li><b>Brokerage application data:</b> when you open a brokerage account we collect your legal name, date of birth, Social Security number, citizenship, address, phone, employment and regulatory disclosures. This is sent directly to Alpaca Securities LLC for identity verification (KYC) and account opening. QuantPocket does not store your Social Security number; we keep only your Alpaca account ID, account number and status.</li>
<li><b>Bank details:</b> bank routing and account numbers you link for transfers are sent to Alpaca; we do not store them.</li>
<li><b>Trading data:</b> strategies, paper and synced live orders, positions, scheduled trades, alerts and the ledger of fees and deposits.</li>
<li><b>Connected services:</b> Alpaca and QuantConnect API keys, encrypted with AES-256-GCM.</li>
<li><b>Security data:</b> IP address, browser type and a log of sign-ins and sensitive actions.</li>
<li><b>Payments:</b> handled by Stripe. We never see or store full card numbers.</li>
</ul>
<h2>How we use it</h2>
<p>To provide the Service, open and maintain your brokerage account with Alpaca, secure your account, process payments and fees, send messages you request (such as SMS replies, alerts and password resets), comply with law, and improve the product. We do not sell personal information.</p>
<h2>Who we share it with</h2>
<p>Service providers that run parts of the Service on our behalf: hosting and database (Render, Turso), brokerage (Alpaca), research (QuantConnect), messaging (Twilio, Resend), payments (Stripe) and AI (Anthropic, for the strategy builder only). We may disclose information when required by law.</p>
<h2>Cookies</h2>
<p>We use one essential, HttpOnly session cookie to keep you signed in. We do not use advertising or tracking cookies.</p>
<h2>Retention</h2>
<p>We keep your data while your account is open. When you delete your account we delete your data from our systems, except where we must keep records by law.</p>
<h2>Your choices</h2>
<p>From Settings you can download all your data (export) or permanently delete your account. You can also disconnect integrations and stop SMS at any time by replying STOP.</p>
<h2>Security</h2>
<p>Passwords and PINs are hashed with scrypt, API keys are encrypted, connections use HTTPS, and two-factor authentication is available. No system is perfectly secure, so please use a unique password and enable two-factor authentication.</p>
<h2>Children</h2>
<p>The Service is not for anyone under 18.</p>
<h2>Contact</h2>
<p>Privacy questions or requests: use the <a href="contact.html">contact page</a>.</p>
'''
RISK = '''
<div class="callout">Please read this before trading.</div>
<h2>Trading involves risk</h2>
<p>Investing in stocks and ETFs involves risk, including the possible loss of your entire investment. Automated and frequent trading can magnify losses and increase costs and taxes.</p>
<h2>Hypothetical results</h2>
<p>Backtests and projections are hypothetical. They are calculated with the benefit of hindsight, do not reflect actual trading, and may not account for slippage, liquidity, fees, taxes or market impact. Projected annual returns are statistical ranges built by resampling past returns. They are not forecasts or promises. Actual results will differ, possibly by a lot.</p>
<h2>Automation risk</h2>
<p>Bots, scheduled trades, SMS and voice commands can fail, run late, run more than once, or act on bad data. Speech recognition can mishear a command. Always monitor your account and keep the ability to act directly with your broker.</p>
<h2>AI-generated strategies</h2>
<p>The AI builder turns descriptions into rules automatically and can misunderstand you. Always review and backtest rules before using them.</p>
<h2>Brokerage</h2>
<p>Brokerage services are provided by Alpaca Securities LLC, member FINRA/SIPC. QuantPocket is not a broker-dealer and is not affiliated with Alpaca, QuantConnect, Twilio or Stripe. SIPC protection does not cover market losses.</p>
<h2>Margin and short selling</h2>
<p>QuantPocket strategies are long-only by default. If your brokerage account has margin enabled, losses can exceed your deposits.</p>
<h2>No advice</h2>
<p>Nothing in the Service is investment, legal or tax advice. Tax estimates are approximate. Your broker's Form 1099-B is the official record. Consult qualified professionals.</p>
'''
CONTACT = '''
<p>We usually reply within one business day.</p>
<form id="contactForm" style="max-width:560px">
  <label>Your name<input name="name" autocomplete="name"></label>
  <label>Email<input name="email" type="email" required autocomplete="email"></label>
  <label>Subject<select name="subject"><option>General question</option><option>Account or billing</option><option>Technical support</option><option>Security report</option><option>Privacy request</option></select></label>
  <label>Message<textarea name="body" required></textarea></label>
  <button class="btn" style="margin-top:14px">Send message</button>
  <div class="err" id="contactErr"></div>
</form>
<p class="mu" style="margin-top:30px">Urgent account security issue? Sign in and use Settings &gt; Active sessions to sign out other devices, change your password, and text <b>PAUSE &lt;PIN&gt;</b> to stop all automation.</p>
'''
NOTFOUND = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | QuantPocket</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#0b1324;color:#e7ecf5;text-align:center;padding:16px}a{color:#8fb2ff}h1{font-size:64px;margin:0}</style></head>
<body><div><h1>404</h1><p>We could not find that page.</p><p><a href="/">Go to the home page</a></p></div></body></html>
'''

files = {
 'index.html': index(),
 'terms.html': doc('Terms of Service', 'The terms that govern your use of QuantPocket.', TERMS),
 'privacy.html': doc('Privacy Policy', 'What QuantPocket collects, why, and your choices.', PRIVACY),
 'risk.html': doc('Risk Disclosure', 'Important information about trading risk, backtests and automation.', RISK),
 'contact.html': doc('Contact & support', 'Get in touch with QuantPocket support.', CONTACT),
 '404.html': NOTFOUND,
}
for name, text in files.items():
    with open(os.path.join(OUT, name), 'w') as f: f.write(text)
print('wrote', ', '.join(files))
