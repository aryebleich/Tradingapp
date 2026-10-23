# Generates the static marketing pages in public/ from one shared layout.
# Run: python3 scripts/pages.py   (output is committed; the server just serves files)
import os, sys, html
sys.path.insert(0, os.path.dirname(__file__))
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')
UPDATED = 'October 22, 2026'

from home import layout, index

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
<li><b>Connected services:</b> brokerage and QuantConnect keys and access tokens, encrypted with AES-256-GCM.</li>
<li><b>Messages to the assistant:</b> texts and spoken requests you send to our phone number, used to answer you and kept in your security log.</li>
<li><b>Security data:</b> IP address, browser type and a log of sign-ins and sensitive actions.</li>
<li><b>Payments:</b> handled by Stripe. We never see or store full card numbers.</li>
</ul>
<h2>How we use it</h2>
<p>To provide the Service, open and maintain your brokerage account with Alpaca, secure your account, process payments and fees, send messages you request (such as SMS replies, alerts and password resets), comply with law, and improve the product. We do not sell personal information.</p>
<h2>Who we share it with</h2>
<p>Service providers that run parts of the Service on our behalf: hosting and database (Render, Turso), brokerages you choose to connect (Alpaca, Charles Schwab, tastytrade, Tradier, TradeStation), research (QuantConnect), messaging (Twilio, Resend), payments (Stripe, Helcim), sign-in (Google, if you use it) and AI (Anthropic: for the strategy builder, and for messages you send to the text and phone assistant). We may disclose information when required by law.</p>
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
 'index.html': index('en'),
 'yi.html': index('yi').replace('&rarr;', '&larr;'),
 'terms.html': doc('Terms of Service', 'The terms that govern your use of QuantPocket.', TERMS),
 'privacy.html': doc('Privacy Policy', 'What QuantPocket collects, why, and your choices.', PRIVACY),
 'risk.html': doc('Risk Disclosure', 'Important information about trading risk, backtests and automation.', RISK),
 'contact.html': doc('Contact & support', 'Get in touch with QuantPocket support.', CONTACT),
 '404.html': NOTFOUND,
}
for name, text in files.items():
    with open(os.path.join(OUT, name), 'w') as f: f.write(text)
print('wrote', ', '.join(files))
