# Shared layout and the homepage, in English (index.html) and Yiddish (yi.html).
# Every visible string goes through T(); scripts/yi_home.py holds the Yiddish for each one.
import html
from yi_home import YI

LANG = {'cur': 'en'}
MISSING = set()
def T(s):
    if LANG['cur'] == 'en': return s
    if s not in YI: MISSING.add(s); return s
    return YI[s]

def layout(title, desc, body, lang='en', home='index.html'):
    LANG['cur'] = lang
    rtl = lang == 'yi'
    nav = ''.join(f'<a href="{home}#{a}">{T(t)}</a>' for a, t in [('how', 'How it works'), ('strategies', 'Strategies'), ('sp500', 'S&amp;P 500'), ('pricing', 'Pricing'), ('faq', 'FAQ')])
    return f'''<!doctype html>
<html lang="{lang}" dir="{'rtl' if rtl else 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="theme-color" content="#0b1324">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-512.png">
<link rel="manifest" href="manifest.webmanifest">
<link rel="alternate" hreflang="en" href="index.html"><link rel="alternate" hreflang="yi" href="yi.html">
<meta property="og:type" content="website">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:image" content="og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Rubik:wght@400;500;600;700;800&family=Noto+Sans+Hebrew:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="site.css">
<script src="config.js"></script>
<script type="module" src="site.js"></script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="{home}"><img src="favicon.svg" alt=""><b>Quant<span>Pocket</span></b></a>
  <nav class="links">{nav}</nav>
  <a class="btn ghost" data-app="#/login" href="app">{T('Sign in')}</a>
  <a class="btn" data-app="#/register" href="app">{T('Start free')}</a>
</div></header>
<main>
{body}
</main>
<footer class="site"><div class="wrap">
  <div class="cols">
    <div><a class="logo" href="{home}"><img src="favicon.svg" alt=""><b>Quant<span>Pocket</span></b></a><p style="max-width:320px">{T('Turn alerts and strategies into trades on your own brokerage account, from your browser, your phone, or a text message.')}</p>
      <p class="phoneline" data-phone hidden>{T('Text or call us:')} <a data-phone-link dir="ltr"></a></p></div>
    <div><b>{T('Product')}</b><a href="{home}#how">{T('How it works')}</a><a href="{home}#strategies">{T('Strategies')}</a><a href="{home}#reality">{T('Reality Check')}</a><a href="{home}#sp500">{T('S&amp;P 500')}</a><a href="{home}#pricing">{T('Pricing')}</a><a data-app="#/register" href="app">{T('Create account')}</a></div>
    <div><b>{T('Company')}</b><a href="contact.html">{T('Contact &amp; support')}</a><a href="terms.html">{T('Terms of Service')}</a><a href="privacy.html">{T('Privacy Policy')}</a><a href="risk.html">{T('Risk Disclosure')}</a></div>
  </div>
  <p class="disc">{T('Investing involves risk, including possible loss of principal. Backtests and projections are hypothetical, are built with the benefit of hindsight and do not guarantee future results. QuantPocket is a software provider and is not a broker-dealer. Brokerage services are provided by your own broker (for example Alpaca Securities LLC, member FINRA/SIPC) under your own account agreement. Nothing on this site is an offer, solicitation or recommendation to buy or sell any security.')}</p>
  <p class="disc">© 2026 QuantPocket. {T('All rights reserved.')}<span data-credit></span></p>
</div></footer>
</body>
</html>
'''

ICON = {
 'chart': '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
 'bolt': '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
 'msg': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
 'doc': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
 'pulse': '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
 'hook': '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
 'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
 'layers': '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
 'grid': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 'phone': '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
 'bank': '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>',
 'plug': '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
 'eye': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
 'list': '<path d="M12 3v18M5 8h14M7 13h10M9 18h6"/>',
 'pair': '<path d="M7 4v16M17 4v16M4 8h6M14 16h6"/>',
 'up': '<path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h6v6"/>',
 'radar': '<circle cx="12" cy="12" r="9"/><path d="M12 12l6-4M12 3v3M12 18v3M3 12h3M18 12h3"/>',
 'globe': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
}
def ic(k, size=20):
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[k]}</svg>'
GOOGLE = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'
def gbtn(label='Sign up with Google', cls='lg'):
    # Shown only when the app has Google sign-in set up (site.js checks and fills in the link).
    return f'<a class="btn google {cls}" data-google hidden href="app#/register">{GOOGLE}<span>{T(label)}</span></a>'

# "What do you want to do?" picker: (id, chip, icon, title, text, bullets)
INTENTS = [
 ('alert', 'Turn my alert into a trade', 'hook', 'Your alert fires. The order goes out.',
  'Paste a private webhook URL into an alert from your charting platform or automation tool. When it fires, QuantPocket checks your risk rules and places the order in seconds.',
  ['Strategy and indicator alerts from any platform that sends webhooks', 'JSON, or plain text like <code>buy AAPL 10</code>', 'Every signal logged with its fill, or the reason it was blocked']),
 ('library', 'Copy a ready-made strategy', 'list', 'Seven strategies, ready to run.',
  'Pick a rotation strategy from the library. Every day the app fills in the numbers, walks the rules step by step and tells you exactly what to buy. Run it by hand or let it trade by itself.',
  ['Every rule, number and ticker can be changed', 'Type your own values, like in a spreadsheet', 'Backtest before you risk a dollar']),
 ('sp500', 'Invest in the S&amp;P 500', 'up', 'The S&amp;P 500, on autopilot.',
  'Choose an amount and a day. QuantPocket buys an S&amp;P 500 fund for you every month, so every dollar is invested, and shows the range of outcomes first.',
  ['VOO, SPLG, IVV or SPY', 'Fractional shares from $1', 'Projections from real market history']),
 ('pairs', 'Trade a pair of stocks', 'pair', 'When two stocks drift apart, trade the gap.',
  'Find pairs that move together, see when the gap between them is unusually wide, and let a pair bot trade it every day.',
  ['Hedge ratio, cointegration test and half-life', 'Market-neutral or long-only', 'Scanner for 20 classic pairs']),
 ('broker', 'Connect my broker', 'plug', 'Your own brokerage accounts, connected in minutes.',
  'Alpaca, Charles Schwab, tastytrade, Tradier and TradeStation. Open a new account inside QuantPocket, or connect the one you already have.',
  ['Start on paper, switch to live when you are ready', 'Several brokers at once', 'Disconnect at any time']),
 ('multi', 'Trade all my accounts at once', 'layers', 'One signal, many accounts.',
  'Send each alert or strategy to several accounts together: paper and live, or two different brokers, each with its own sizing.',
  ['Pick the accounts for each webhook or strategy', 'Sizing in shares or dollars', 'One log across accounts']),
 ('risk', 'Set my risk rules', 'shield', 'Guardrails before every order.',
  'Limits are checked before anything is sent to your broker, and Reality Check cuts the money a strategy trades when it stops behaving like its backtest.',
  ['Maximum position size and trades per day', 'Trailing stops sized to each ticker', 'Long-only by default']),
 ('review', 'Review my trades', 'eye', 'Every order, fill and signal in one record.',
  'Filter your order history, see why a signal was rejected, and follow realized gains by tax lot.',
  ['Order history with status filters', 'Signal and strategy logs', 'Realized P&amp;L, wash-sale flags and Form 8949 export']),
 ('all', 'See my accounts in one place', 'grid', 'All your accounts, side by side.',
  'Positions, orders, buying power and an equity chart that turns green or red with your P&amp;L, on desktop and on your phone.',
  ['Switch accounts with one tap', 'Live quotes and market news', 'Works on any phone, no app to install']),
 ('text', 'Trade by text or phone', 'msg', 'Your account, from any phone.',
  'Text or call QuantPocket and say what you need in plain words. The AI assistant answers questions and turns requests into orders; every trade needs your PIN.',
  ['One number to text or call', 'Answers questions about your account', 'Text PAUSE to stop all automation']),
]

LIBRARY = [
 ('BG Ensemble', 'Hierarchical decision-tree regime rotation', 'Every trading day', 'very high'),
 ('Multi-Model ETF Rotation', '4 independent sleeves × 25%', 'Every trading day', 'high'),
 ('Leveraged ETF Rotation', 'Holds one leveraged ETF at 100%', 'Every trading day', 'very high'),
 ('Gold Miner', 'Gold-miner fade and Nasdaq momentum tree', 'Every trading day', 'very high'),
 ('Large-Cap Momentum', 'One stock: the strongest 12-month momentum', 'Weekly', 'high'),
 ('Large-Cap Pullback', 'Buy the dip in an uptrend, sell the bounce', 'Every trading day', 'medium'),
 ('Macro Rotation', 'Stocks, gold, bonds and bitcoin by predicted return', 'Monthly', 'medium'),
]

USECASES = [
 ('Retail traders', 'Automation on your own account', 'Get reliable alert-to-broker automation without running servers or writing integrations.',
  ['Connect the charting tools you already use', 'Send alerts straight to your own brokerage account', 'Start on paper before going live']),
 ('Chart traders', 'Your strategy, executed', 'Your charting strategy already knows when to buy and sell. QuantPocket places those orders for you.',
  ['Copy-and-paste alert message templates', 'Size from the alert or a fixed amount', 'Exits close the whole position']),
 ('Swing traders', 'Set it and walk away', 'Pick your entry, then let bracket orders manage the exit while you are away from the screen.',
  ['Stop-loss and take-profit placed with the entry', 'Good-till-canceled orders', 'Price alerts by text message']),
 ('Quants &amp; developers', 'Code-first trading', 'Run Python strategies in the code lab, backtest rules here, and send orders from any script or AI agent.',
  ['Python code lab with backtests in your browser', 'Webhooks from any language, any tool', 'Risk rules your code cannot bypass']),
 ('Long-term investors', 'Invest on a schedule', 'Automate monthly S&amp;P 500 buys and keep an eye on taxes, without watching the market all day.',
  ['Monthly or weekly automatic buys', 'Tax-loss harvesting ideas', 'An equity curve that shows how you are doing']),
 ('Learners', 'Practice with zero risk', 'Learn how strategies behave with $100,000 in paper money and honest numbers.',
  ['Backtests with drawdowns and losing years', 'Paper trading that works like the real thing', 'Plain-English strategy builder']),
]

FEATURES = [
 ('list', 'Strategy library', 'Seven ready-made rotation strategies, by hand or automatic, every rule editable.'),
 ('radar', 'Reality Check', 'Live results compared with the backtest every day, with automatic throttling.'),
 ('hook', 'Webhook alerts', 'Send orders to your broker from any tool that can call a webhook.'),
 ('pair', 'Pairs trading', 'Cointegration, z-scores, half-life, walk-forward backtests and pair bots.'),
 ('up', 'S&amp;P 500 autopilot', 'Monthly index-fund buys with projections from real history.'),
 ('msg', 'AI phone assistant', 'Text or call one number; ask questions or trade in plain words.'),
 ('plug', 'Five brokerages', 'Alpaca, Schwab, tastytrade, Tradier and TradeStation, side by side.'),
 ('bolt', 'Paper trading', 'Test everything with $100,000 in paper money before risking real money.'),
 ('shield', 'Risk rules', 'Position limits, trade limits, allowed tickers, trailing stops and brackets.'),
 ('chart', 'Backtesting', 'Years of daily data, costs, drawdowns, walk-forward checks and an optimizer.'),
 ('doc', 'Tax center', 'Gains by lot, wash-sale flags, an estimated tax bill and Form 8949 export.'),
 ('globe', 'English &amp; Yiddish', 'The whole app and this site in English or Yiddish, right-to-left.'),
]

PLANS = [
 ('Starter', 'Learn and practice', '$0', None, '/forever', None, '+ 20% of new profits',
  ['$100,000 paper account', '1 chart per layout, every indicator', 'Strategy library by hand + 1 automatic strategy on paper', 'Unlimited backtests', '1 alert webhook (paper)', '2 scanners, checked hourly', 'AI assistant: 30 messages a day'], 'Start free', False),
 ('Pro', 'Automate your real accounts', '$53', '$530', '/month', '/year', '+ 10% of new profits',
  ['Everything in Starter', 'Live trading on Alpaca, Schwab, tastytrade, Tradier &amp; TradeStation', '2-chart layouts', '5 automatic strategies with Reality Check auto-throttle', '10 alert webhooks', 'Scanners every 5 minutes, portfolios &amp; signal mirroring', 'AI assistant: 300 messages a day', 'Optimizer, walk-forward testing &amp; code lab'], 'Start 14-day free trial', True),
 ('Elite', 'For active traders', '$109', '$1,090', '/month', '/year', '+ 5% of new profits',
  ['Everything in Pro', '4-chart layouts and pop-out windows', '25 automatic strategies &amp; 25 webhooks', 'Option income bots &amp; multi-leg orders', 'Market-neutral pairs (long + short)', 'Tax-loss harvesting &amp; Schedule D', 'AI assistant: 1,000 messages a day'], 'Start 14-day free trial', False),
 ('Ultimate', 'For serious capital', '$320', '$3,200', '/month', '/year', '+ 2.5% of new profits',
  ['Everything in Elite', 'Lowest performance fee (2.5%)', '100 automatic strategies &amp; 100 webhooks', 'Unlimited scanners and AI agents', 'AI assistant: 3,000 messages a day', 'Priority support'], 'Start 14-day free trial', False),
]

FAQ_AUTO = [
 ('Can I turn my chart alerts into trades?', 'Yes. Create a webhook under <b>Alerts to trades</b>, paste its URL into the alert&rsquo;s <b>Webhook URL</b> field, and use our message template. Strategy alerts can pass the direction and size with <code>{{strategy.order.action}}</code> and <code>{{strategy.order.contracts}}</code>.'),
 ('Where do the ready-made strategies come from?', 'They are rotation strategies from a trading spreadsheet that tracks cloud backtests. We show each backtest next to its live results, and Reality Check keeps watching them for you. A great backtest is not a promise: several of them did much worse live.'),
 ('What is Reality Check?', 'Every trading day we compare a strategy&rsquo;s live result with its backtest. If they drift apart, you get a text or email, and with Auto-throttle on, the money that strategy trades is cut to 50% (Watch) or 0% (Drifting) until it recovers.'),
 ('Can I run one strategy across all my accounts?', 'Yes. Webhooks can send each alert to several accounts at once (paper, Alpaca, Schwab, tastytrade, Tradier, TradeStation), with the same risk rules.'),
 ('Can my AI agent place real trades?', 'Any program that can send an HTTPS request can use a webhook, AI agents included. It can only do what that webhook allows: its accounts, sizes and risk rules. Start on paper.'),
 ('Can I set a swing trade and walk away?', 'Yes. Place a bracket order (entry, stop-loss and take-profit) as good-till-canceled. The exit orders wait at your broker even while you are offline.'),
 ('Can my strategy run fully hands-off?', 'Automatic strategies, pair bots and webhooks run without you. Automation can still fail or act on bad data, so check your account regularly.'),
 ('Can I trigger trades from automation tools?', 'Yes. Any tool that can call a webhook URL works. Use your QuantPocket webhook URL with the fields <code>ticker</code>, <code>action</code> and <code>quantity</code>.'),
]
FAQ_ACCOUNT = [
 ('Will I make money?', 'Nobody can promise that. Most active strategies underperform simply holding an index after costs. QuantPocket shows how an idea behaved in the past, how it is doing live, and the range of outcomes to expect, so you can decide with your eyes open.'),
 ('Can I use QuantPocket in Yiddish?', 'Yes. Choose ייִדיש at the top of this page or in the app. The whole app switches to Yiddish, written right-to-left.'),
 ('Which brokerages can I connect?', 'Alpaca (you can also open a new account inside QuantPocket), Charles Schwab, tastytrade, Tradier and TradeStation. Your money always stays at your broker.'),
 ('Can I sign up with Google?', 'Yes. Choose <b>Sign up with Google</b> and your account is ready in seconds. You can add a password later in Settings.'),
 ('How does the free trial work?', 'Every paid plan starts with 14 days free. Cancel before the trial ends and you are not charged. The free Starter plan has no time limit.'),
 ('How does the performance fee work?', 'Each month we compare your account to its previous peak, adjusted for deposits and withdrawals. You pay the plan&rsquo;s percentage only on value above that peak. Losses must be recovered before any new fee is charged.'),
 ('Is texting trades secure?', 'Commands only work from the phone number you verified, every order needs your personal PIN, and phone calls read the order back before it is placed.'),
 ('Can I cancel any time?', 'Yes. Cancel from <b>Manage billing</b> in the app; you keep access until the end of the period you paid for. You can also export or delete all your data from Settings.'),
]

def checks(items):
    return '<ul class="checks">' + ''.join(f'<li>{T(x)}</li>' for x in items) + '</ul>'
def tab(key, label, first):
    return f'<button role="tab" data-tab="{key}" aria-selected="{"true" if first else "false"}">{label}</button>'
def panel(key, cls, inner, first):
    return f'<div class="{cls}" role="tabpanel" data-panel="{key}"{"" if first else " hidden"}>{inner}</div>'

RISK = {'very high': 'neg', 'high': 'warn', 'medium': ''}

def index(lang='en'):
    LANG['cur'] = lang
    home = 'yi.html' if lang == 'yi' else 'index.html'
    chips = ''.join(tab(i, ic(k, 18) + f'<span>{T(c)}</span>', n == 0) for n, (i, c, k, t, d, b) in enumerate(INTENTS))
    panels = ''.join(panel(i, 'ipanel', f'<div class="ic">{ic(k, 24)}</div><h3>{T(t)}</h3><p>{T(d)}</p>{checks(b)}<a class="btn" data-app="#/register" href="app">{T("Get started free")} &rarr;</a>', n == 0)
                     for n, (i, c, k, t, d, b) in enumerate(INTENTS))
    uc_tabs = ''.join(tab(f'u{n}', T(t), n == 0) for n, (t, h, d, b) in enumerate(USECASES))
    uc_panels = ''.join(panel(f'u{n}', 'ucpanel', f'<span class="kicker">{T(t)}</span><h3>{T(h)}</h3><p>{T(d)}</p><b class="wyg">{T("What you get")}</b>{checks(b)}', n == 0)
                        for n, (t, h, d, b) in enumerate(USECASES))
    feats = ''.join(f'<div class="feature"><div class="ic">{ic(i)}</div><h3>{T(t)}</h3><p>{T(d)}</p></div>' for i, t, d in FEATURES)
    lib = ''.join(f'<div class="libcard"><div class="lh"><b>{n}</b><span class="risk {RISK[r]}">{T(r + " risk")}</span></div><p>{T(tg)}</p><span class="reb">{T(rb)}</span></div>' for n, tg, rb, r in LIBRARY)
    faq = lambda items: ''.join(f'<details><summary>{T(q)}</summary><p>{T(a)}</p></details>' for q, a in items)
    plans = ''.join(f'''<div class="plan{' best' if best else ''}">{'<div class="ribbon">' + T('Most popular') + '</div>' if best else ''}<h3>{T(n)}</h3><p class="tag">{T(tg)}</p>
      <div class="price"{f' data-m="{pm}" data-y="{py}"' if py else ''}>{pm}<small{f' data-m="{T(sm)}" data-y="{T(sy)}"' if sy else ''}>{T(sm)}</small></div><p class="fee">{T(fee)}</p>
      <ul>{''.join(f'<li>{T(x)}</li>' for x in feats_)}</ul><a class="btn{'' if best else ' ghost'}" data-app="#/register" href="app">{T(cta)}</a></div>''' for n, tg, pm, py, sm, sy, fee, feats_, cta, best in PLANS)
    body = f'''
<section class="hero"><div class="wrap hero-grid">
  <div>
    <a class="eyebrow" href="#reality"><span>{T('New')}</span> {T('Reality Check tells you when a strategy stops working')} &rarr;</a>
    <h1>{T('Every trade you take, <span>executed from one place.</span>')}</h1>
    <p class="lead">{T('Stocks, ETFs, options and crypto through your own brokerage account. Ready-made strategies, webhook alerts, pairs trading and an S&amp;P 500 plan: test them, paper trade them and automate them on one platform.')}</p>
    <div class="cta">{gbtn()}<a class="btn outline lg" data-app="#/register" href="app">{T('Start free with email')}</a></div>
    <ul class="ticks"><li>{T('Set up in 3 minutes')}</li><li>{T('$100,000 paper account')}</li><li>{T('No card needed')}</li></ul>
    <p class="acctlink"><a data-app="#/open-account" href="app">{T('Open a brokerage account')} &rarr;</a> <span>{T('Commission-free, held at Alpaca Securities LLC (FINRA/SIPC)')}</span></p>
    <p class="phoneline hero-phone" data-phone hidden>{ic('msg', 16)} {T('Text or call us:')} <a data-phone-link dir="ltr"></a></p>
  </div>
  <figure class="shot"><div class="frame"><i></i><i></i><i></i></div><img src="hero-app.webp" width="1600" height="1000" alt="{T('QuantPocket portfolio dashboard with equity chart, positions and order ticket')}" fetchpriority="high"><figcaption>{T('Illustrative paper-trading account')}</figcaption></figure>
</div>
<div class="wrap"><div class="logos"><span>{T('Brokers:')} <b>Alpaca</b> · <b>Schwab</b> · <b>tastytrade</b> · <b>Tradier</b> · <b>TradeStation</b></span><span>{T('Payments by')} <b>Stripe</b> &amp; <b>Helcim</b></span></div></div>
</section>

<section id="start"><div class="wrap">
  <h2 class="sec center">{T('What do you want to do?')}</h2>
  <p class="sub center">{T('Pick one. Everything works on paper first, with no risk.')}</p>
  <div class="intents" data-tabs><div class="ichips" role="tablist" aria-label="{T('What do you want to do?')}">{chips}</div>{panels}</div>
</div></section>

<section class="alt" id="strategies"><div class="wrap split">
  <div>
    <span class="kicker">{T('Strategy library')}</span>
    <h2 class="sec">{T('Ready-made strategies. Every number in your hands.')}</h2>
    <p class="sub">{T('Seven rotation strategies, built from a real trading spreadsheet. Every day QuantPocket fills in the market numbers, walks the rules step by step and tells you exactly what to buy.')}</p>
    <ul class="checks big"><li>{T('<b>By hand:</b> see each step, type your own numbers, place the orders with one click')}</li><li>{T('<b>Automatic:</b> trades at the time you choose, on the accounts you choose')}</li><li>{T('<b>Editable:</b> change any rule, threshold or ticker, then backtest it')}</li><li>{T('<b>Honest:</b> backtest and live results side by side')}</li></ul>
    <a class="btn" data-app="#/strategies" href="app">{T('Open the strategy library')} &rarr;</a>
  </div>
  <div class="libgrid2">{lib}</div>
</div></section>

<section class="dark" id="reality"><div class="wrap split">
  <div>
    <span class="kicker light">{T('Built into every strategy')}</span>
    <h2 class="sec">{T('Reality Check: know when a strategy stops working.')}</h2>
    <p class="sub">{T('Most platforms show you a beautiful backtest and stop there. But many strategies with spectacular backtests lose money once they go live. QuantPocket compares every strategy&rsquo;s live results with its backtest, every single day.')}</p>
    <ul class="checks big light"><li>{T('A text or email the day a strategy starts to drift')}</li><li>{T('<b>Auto-throttle:</b> 100% while healthy, 50% on Watch, 0% when Drifting')}</li><li>{T('Back to full size automatically when it recovers')}</li></ul>
  </div>
  <div class="rcbox">
    <div class="rcrow"><span class="pill pos">{T('Healthy')}</span><span>{T('Live results match the backtest')}</span><b>100%</b></div>
    <div class="rcrow"><span class="pill warn">{T('Watch')}</span><span>{T('Weaker than expected')}</span><b>50%</b></div>
    <div class="rcrow"><span class="pill neg">{T('Drifting')}</span><span>{T('Far below the backtest')}</span><b>0%</b></div>
    <div class="rcex"><b>{T('Example')}</b>: {T('a strategy with a 922% a year backtest returned &minus;27% in its first three live months. Reality Check would have flagged it and cut it to cash.')}<small>{T('Figures as recorded from the cloud backtest of one of the library strategies.')}</small></div>
  </div>
</div></section>

<section id="how"><div class="wrap">
  <h2 class="sec">{T('How it works')}</h2>
  <p class="sub">{T('Set up your strategy. Send a signal. Orders go to every account you chose, inside your rules.')}</p>
  <div class="how">
    <ol class="howsteps">
      <li><b>{T('Create')}</b><span>{T('Pick a ready-made strategy, or define entries and exits, sizing and risk limits. Use a webhook alert or our JSON templates.')}</span></li>
      <li><b>{T('Connect')}</b><span>{T('Link your brokerage in seconds, or start with the built-in paper account. Choose which accounts each strategy trades.')}</span></li>
      <li><b>{T('Send')}</b><span>{T('Signals fire, orders execute, and fills, P&amp;L and positions update in one place.')}</span></li>
    </ol>
    <div class="term" dir="ltr">
      <div class="bar"><i></i><i></i><i></i><span>{T('Webhook alert')} &rarr; QuantPocket</span></div>
<pre><span class="k">POST</span> /hook/&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;
{{
  <span class="s">"ticker"</span>: <span class="v">"NASDAQ:AAPL"</span>,
  <span class="s">"action"</span>: <span class="v">"buy"</span>,
  <span class="s">"quantity"</span>: <span class="v">10</span>
}}</pre>
      <div class="res"><div><i></i>{T('Risk rules passed')} <em>{T('max $5,000 per ticker &middot; 3 of 10 trades today')}</em></div><div><i></i>{T('Paper:')} <b>BUY 10 AAPL</b> {T('filled')}</div><div><i></i>Schwab: <b>BUY 10 AAPL</b> {T('accepted')}</div></div>
      <p class="figcap">{T('Illustration with example values.')}</p>
    </div>
  </div>
</div></section>

<section class="alt" id="sp500"><div class="wrap split">
  <div>
    <span class="kicker">{T('Investment plan')}</span>
    <h2 class="sec">{T('The S&amp;P 500, on autopilot.')}</h2>
    <p class="sub">{T('The 500 largest US companies in one fund. Pick an amount and a day: QuantPocket buys it for you every month, in dollars, so every dollar is invested.')}</p>
    <ul class="checks big"><li>{T('VOO, SPLG, IVV or SPY, with their yearly costs shown')}</li><li>{T('A range of outcomes built from real history, crashes included')}</li><li>{T('Free on the paper account; real accounts with Pro')}</li></ul>
    <a class="btn" data-app="#/sp500" href="app">{T('Start my S&amp;P 500 plan')} &rarr;</a>
  </div>
  <form class="calc" id="spcalc">
    <h3>{T('What could it grow to?')}</h3>
    <div class="cgrid"><label>{T('Every month ($)')}<input name="m" type="number" min="0" value="300"></label><label>{T('Years')}<input name="y" type="number" min="1" max="50" value="20"></label></div>
    <div class="cout" dir="ltr"><div><span>{T('You put in')}</span><b data-k="put">$72,000</b></div><div><span>{T('At 6% a year')}</span><b data-k="r6">-</b></div><div><span>{T('At 8% a year')}</span><b data-k="r8">-</b></div><div class="hi"><span>{T('At 10% a year')}</span><b data-k="r10">-</b></div></div>
    <p class="fine">{T('The S&amp;P 500 has averaged roughly 10% a year since 1957 with dividends reinvested, but some years fell more than 35%. Examples, not a promise.')}</p>
  </form>
</div></section>

<section id="pairs"><div class="wrap split rev">
  <div>
    <span class="kicker">{T('Advanced')}</span>
    <h2 class="sec">{T('Pairs trading, done properly.')}</h2>
    <p class="sub">{T('Two stocks that usually move together, like Coca-Cola and Pepsi. When the gap between them stretches far from normal, sell the expensive one and buy the cheap one, then close when the gap returns.')}</p>
    <ul class="checks big"><li>{T('Hedge ratio, cointegration test and half-life')}</li><li>{T('Walk-forward backtest: market-neutral or long-only')}</li><li>{T('Scanner for 20 classic pairs and bots that trade every day')}</li></ul>
    <a class="btn" data-app="#/pairs" href="app">{T('Analyze a pair')} &rarr;</a>
  </div>
  <div class="zbox" dir="ltr" aria-hidden="true"><svg viewBox="0 0 400 200" preserveAspectRatio="none"><line x1="0" y1="40" x2="400" y2="40" class="ent"/><line x1="0" y1="160" x2="400" y2="160" class="ent"/><line x1="0" y1="85" x2="400" y2="85" class="ex"/><line x1="0" y1="115" x2="400" y2="115" class="ex"/><line x1="0" y1="100" x2="400" y2="100" class="mid"/>
    <polyline class="z" points="0,110 20,95 40,80 60,62 80,45 95,34 110,48 130,70 150,92 170,104 190,120 210,138 230,152 245,168 260,150 280,128 300,110 320,96 340,88 360,100 380,108 400,102"/><circle cx="95" cy="34" r="6" class="dot s"/><circle cx="150" cy="92" r="6" class="dot c"/><circle cx="245" cy="168" r="6" class="dot b"/><circle cx="300" cy="110" r="6" class="dot c"/></svg>
    <div class="zleg"><span><i class="s"></i>{T('Gap wide: sell A, buy B')}</span><span><i class="b"></i>{T('Gap wide: buy A, sell B')}</span><span><i class="c"></i>{T('Gap normal: close')}</span></div></div>
</div></section>

<section class="alt" id="assistant"><div class="wrap split">
  <div>
    <span class="kicker">{T('AI assistant')}</span>
    <h2 class="sec">{T('Your account, by text or phone call.')}</h2>
    <p class="sub">{T('One number for everyone. Text or call QuantPocket and say what you need in plain words. The AI assistant answers questions and turns requests into orders.')}</p>
    <ul class="checks big"><li>{T('Balances, positions, prices and explanations, any time')}</li><li>{T('Every trade needs your PIN; calls read the order back first')}</li><li>{T('Text PAUSE to stop all automation at once')}</li></ul>
    <p class="phoneline" data-phone hidden>{T('Text or call us:')} <a data-phone-link dir="ltr"></a></p>
  </div>
  <div class="chat" aria-label="{T('Example conversation')}">
    <div class="b me">{T('how much is my account up this week?')}</div>
    <div class="b">{T('Paper: equity $103,240, up $1,180 (+1.2%) since Monday.')}</div>
    <div class="b me">{T('put $200 into the S&amp;P every month')}</div>
    <div class="b">{T('To do that, reply: DCA $200 SPY MONTHLY &lt;your PIN&gt;')}</div>
    <div class="b me">DCA $200 SPY MONTHLY ••••</div>
    <div class="b">{T('Scheduled #12: buy $200 SPY monthly.')}</div>
    <small>{T('Example conversation')}</small>
  </div>
</div></section>

<section id="who"><div class="wrap">
  <h2 class="sec">{T('Who is QuantPocket for?')}</h2>
  <p class="sub">{T('Whatever your style, QuantPocket automates the parts you don&rsquo;t want to do by hand. Pick the profile that fits you best.')}</p>
  <div class="usecases" data-tabs>
    <div class="uctabs" role="tablist" aria-label="{T('Trader profiles')}">{uc_tabs}</div>
    <div class="ucbody">{uc_panels}
      <div class="ucnav"><button type="button" data-step="-1" aria-label="{T('Previous profile')}">&larr;</button><span data-count dir="ltr">1 / {len(USECASES)}</span><button type="button" data-step="1" aria-label="{T('Next profile')}">&rarr;</button></div>
    </div>
  </div>
</div></section>

<section class="alt" id="features"><div class="wrap">
  <h2 class="sec">{T('An all-in-one trading automation platform')}</h2>
  <p class="sub">{T('From the first backtest to live orders on every account you own.')}</p>
  <div class="features">{feats}</div>
</div></section>

<section id="demo"><div class="wrap">
  <h2 class="sec">{T('Live demo: test a strategy now')}</h2>
  <p class="sub">{T('Pick a ticker and a classic strategy. It runs on the same engine as the app, using market data since 2015.')}</p>
  <div class="demo">
    <form id="demoForm">
      <label>{T('Ticker')}<input name="symbol" value="SPY" maxlength="8" autocomplete="off"></label>
      <label>{T('Strategy')}<select name="preset"><option>SMA cross</option><option>RSI dip in uptrend</option><option>Bollinger revert</option><option>Breakout</option><option>MACD trend</option><option>Momentum 12m</option></select></label>
      <button class="btn" style="margin-top:14px;width:100%">{T('Run backtest')}</button>
      <div class="err" id="demoErr"></div>
      <p class="mu" style="font-size:13px" id="demoSrc"></p>
    </form>
    <div dir="ltr">
      <canvas id="demoChart" aria-label="{T('Equity curve')}"></canvas>
      <div class="stats" id="demoStats"></div>
    </div>
  </div>
</div></section>

<section class="alt" id="pricing"><div class="wrap">
  <h2 class="sec center">{T('Simple pricing. Start free.')}</h2>
  <p class="sub center">{T('Every paid plan starts with a 14-day free trial. Plus a small share of new profits above your high-water mark, so you only pay more when your account reaches new highs.')}</p>
  <div class="toggle" id="billing"><button class="on" data-i="m">{T('Monthly')}</button><button data-i="y">{T('Yearly')} <em>{T('2 months free')}</em></button></div>
  <div class="plans">{plans}</div>
  <p class="fine">{T('Secure checkout by Stripe. Cancel anytime. Trading involves risk; see the')} <a href="risk.html">{T('Risk Disclosure')}</a>.</p>
</div></section>

<section id="faq"><div class="wrap faq" style="max-width:860px">
  <h2 class="sec center">{T('Popular questions')}</h2>
  <div data-tabs>
    <div class="toggle" role="tablist" aria-label="{T('Question topics')}">{tab('fa', T('Automation'), True)}{tab('fb', T('Account &amp; pricing'), False)}</div>
    {panel('fa', 'qs', faq(FAQ_AUTO), True)}{panel('fb', 'qs', faq(FAQ_ACCOUNT), False)}
  </div>
</div></section>

<section><div class="wrap"><div class="band final">
  <div><h2>{T('You&rsquo;re 3 minutes away from your first trade.')}</h2>
    <ul class="ticks"><li>{T('Free version')}</li><li>{T('Set up in 3 minutes')}</li><li>{T('Paper account for testing')}</li></ul></div>
  <div class="startbox">
    {gbtn('Sign up with Google', 'wide')}
    <div class="or" data-google hidden><span>{T('or')}</span></div>
    <form id="startForm"><input type="email" name="email" placeholder="{T('Email address')}" autocomplete="email" aria-label="{T('Email address')}" required dir="ltr"><button class="btn light">{T('Start free')}</button></form>
  </div>
</div></div></section>
<div class="stickycta"><a class="btn lg" data-app="#/register" href="app">{T('Start free')}</a></div>
'''
    title = T('QuantPocket: automate your trading from one place')
    desc = T('Ready-made strategies, webhook alerts, pairs trading and an S&P 500 autopilot on your own brokerage account, with Reality Check watching every strategy. In English and Yiddish.')
    return layout(title, desc, body, lang, home)
