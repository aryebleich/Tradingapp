// Every key the app knows, for Admin → Keys: its group, what it is for, whether the app needs it,
// where to get one, and (when the provider has one) a real, harmless check call. A test never
// changes anything: it reads an account, a list of models or one quote.
// Values are never part of anything here; the tests receive the value and return ok or a short
// reason with the value removed.
export const GROUPS = ['AI', 'Brokers', 'Market data', 'Payments', 'Email and SMS', 'Hosting and backups', 'GitHub', 'Sign-in', 'Settings and other'];

// t(v, get): the request to make, with v the key's value and get(name) another key (a pair's other half).
const bearer = v => ({ authorization: `Bearer ${v}` });
const K = [
  // AI
  ['OPENAI_API_KEY', 'AI', 'OpenAI (ChatGPT): the admin AI chat and the AI features routed to it in Admin → AI.', 'optional', 'https://platform.openai.com/api-keys', v => ({ url: 'https://api.openai.com/v1/models', headers: bearer(v) })],
  ['OPENAI_WEBHOOK_SECRET', 'AI', 'Verifies webhooks from OpenAI (the signing secret, starts with whsec_). Needed for background AI jobs.', 'optional', 'https://platform.openai.com/settings/organization/webhooks'],
  ['ANTHROPIC_API_KEY', 'AI', 'Claude (Anthropic): the AI features routed to it, and the AI work queue when you allow paid use.', 'optional', 'https://console.anthropic.com/settings/keys', v => ({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': v, 'anthropic-version': '2023-06-01' } })],
  ['GROQ_API_KEY', 'AI', 'Groq: a fast free tier, the default fallback when a paid provider is down or at its cap.', 'optional', 'https://console.groq.com/keys', v => ({ url: 'https://api.groq.com/openai/v1/models', headers: bearer(v) })],
  ['GEMINI_API_KEY', 'AI', 'Google Gemini: a free tier for the AI features routed to it.', 'optional', 'https://aistudio.google.com/app/apikey', v => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(v)}` })],
  ['OPENROUTER_API_KEY', 'AI', 'OpenRouter: free and paid models from many providers through one key.', 'optional', 'https://openrouter.ai/keys', v => ({ url: 'https://openrouter.ai/api/v1/auth/key', headers: bearer(v) })],
  ['AI_API_KEY', 'AI', 'A custom OpenAI-compatible provider (with AI_BASE_URL and AI_MODEL).', 'optional', null, (v, get) => get('AI_BASE_URL') ? ({ url: get('AI_BASE_URL').replace(/\/$/, '') + '/models', headers: bearer(v) }) : null],
  ['AI_BASE_URL', 'AI', 'The address of the custom provider (https://…/v1).', 'optional', null],
  ['AI_MODEL', 'AI', 'The custom provider\'s model name.', 'optional', null],
  ['AI_PROVIDER', 'AI', 'The provider used when a feature has no routing of its own (older setting; Admin → AI routes each feature).', 'optional', null],
  ['GEMINI_MODEL', 'AI', 'The Gemini model (default: the current Flash model).', 'optional', null],
  // Brokers
  ['ALPACA_KEY_ID', 'Brokers', 'Alpaca (market data and the house trading account): the key ID.', 'recommended', 'https://app.alpaca.markets/paper/dashboard/overview', (v, get) => ({ url: (get('ALPACA_TRADING_URL') || 'https://paper-api.alpaca.markets').replace(/\/$/, '') + '/v2/account', headers: { 'APCA-API-KEY-ID': v, 'APCA-API-SECRET-KEY': get('ALPACA_SECRET') } })],
  ['ALPACA_SECRET', 'Brokers', 'Alpaca: the secret that goes with ALPACA_KEY_ID.', 'recommended', 'https://app.alpaca.markets/paper/dashboard/overview', (v, get) => ({ url: (get('ALPACA_TRADING_URL') || 'https://paper-api.alpaca.markets').replace(/\/$/, '') + '/v2/account', headers: { 'APCA-API-KEY-ID': get('ALPACA_KEY_ID'), 'APCA-API-SECRET-KEY': v } })],
  ['ALPACA_TRADING_URL', 'Brokers', 'Alpaca trading address (paper or live).', 'optional', null],
  ['ALPACA_STOCK_FEED', 'Brokers', 'Alpaca stock data feed (iex or sip).', 'optional', null],
  ['ALPACA_OPTIONS_FEED', 'Brokers', 'Alpaca options data feed.', 'optional', null],
  ['ALPACA_OAUTH_CLIENT_ID', 'Brokers', 'Alpaca OAuth: members connect their own Alpaca account.', 'optional', 'https://app.alpaca.markets/brokerage/apps/manage'],
  ['ALPACA_OAUTH_CLIENT_SECRET', 'Brokers', 'Alpaca OAuth secret.', 'optional', 'https://app.alpaca.markets/brokerage/apps/manage'],
  ['ALPACA_OAUTH_ENV', 'Brokers', 'Alpaca OAuth environment (paper or live).', 'optional', null],
  ['BROKER_API_KEY', 'Brokers', 'Alpaca Broker API: accounts Brightolio opens for members.', 'optional', 'https://broker-app.alpaca.markets/', (v, get) => ({ url: (get('BROKER_BASE_URL') || 'https://broker-api.sandbox.alpaca.markets').replace(/\/$/, '') + '/v1/clock', headers: { authorization: 'Basic ' + Buffer.from(`${v}:${get('BROKER_API_SECRET')}`).toString('base64') } })],
  ['BROKER_API_SECRET', 'Brokers', 'Alpaca Broker API secret.', 'optional', 'https://broker-app.alpaca.markets/'],
  ['BROKER_BASE_URL', 'Brokers', 'Alpaca Broker API address (sandbox or live).', 'optional', null],
  ['BROKER_CLIENT_ID', 'Brokers', 'Alpaca Broker API OAuth client.', 'optional', null],
  ['BROKER_CLIENT_SECRET', 'Brokers', 'Alpaca Broker API OAuth secret.', 'optional', null],
  ['BROKER_TOKEN_URL', 'Brokers', 'Alpaca Broker API token address.', 'optional', null],
  ['BROKER_EVENTS', 'Brokers', 'Broker account events on or off.', 'optional', null],
  ['SCHWAB_APP_KEY', 'Brokers', 'Charles Schwab: members connect their Schwab account.', 'optional', 'https://developer.schwab.com/'],
  ['SCHWAB_APP_SECRET', 'Brokers', 'Charles Schwab app secret.', 'optional', 'https://developer.schwab.com/'],
  ['TRADESTATION_CLIENT_ID', 'Brokers', 'TradeStation: members connect their account.', 'optional', 'https://developer.tradestation.com/'],
  ['TRADESTATION_CLIENT_SECRET', 'Brokers', 'TradeStation client secret.', 'optional', 'https://developer.tradestation.com/'],
  ['PLAID_CLIENT_ID', 'Brokers', 'Plaid: bank links for All my money.', 'optional', 'https://dashboard.plaid.com/developers/keys'],
  ['PLAID_SECRET', 'Brokers', 'Plaid secret.', 'optional', 'https://dashboard.plaid.com/developers/keys'],
  ['PLAID_ENV', 'Brokers', 'Plaid environment (sandbox, development, production).', 'optional', null],
  // Market data
  ['FINNHUB_API_KEY', 'Market data', 'Finnhub (free): quotes, news, earnings.', 'optional', 'https://finnhub.io/dashboard', v => ({ url: `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(v)}` })],
  ['TWELVEDATA_API_KEY', 'Market data', 'Twelve Data (free): prices and history.', 'optional', 'https://twelvedata.com/account/api-keys', v => ({ url: `https://api.twelvedata.com/quote?symbol=AAPL&apikey=${encodeURIComponent(v)}`, okIf: j => !j?.code })],
  ['TIINGO_API_KEY', 'Market data', 'Tiingo (free): daily prices and fundamentals.', 'optional', 'https://www.tiingo.com/account/api/token', v => ({ url: 'https://api.tiingo.com/api/test', headers: { authorization: `Token ${v}` } })],
  ['ALPHAVANTAGE_API_KEY', 'Market data', 'Alpha Vantage (free, 25 calls a day): fills gaps in dividend and company data.', 'optional', 'https://www.alphavantage.co/support/#api-key', v => ({ url: `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${encodeURIComponent(v)}`, okIf: j => !j?.['Error Message'] && !j?.Information })],
  ['FMP_API_KEY', 'Market data', 'Financial Modeling Prep (free): company financials.', 'optional', 'https://site.financialmodelingprep.com/developer/docs/dashboard', v => ({ url: `https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=${encodeURIComponent(v)}` })],
  ['POLYGON_API_KEY', 'Market data', 'Polygon (free): market status and history.', 'optional', 'https://polygon.io/dashboard/api-keys', v => ({ url: `https://api.polygon.io/v1/marketstatus/now?apiKey=${encodeURIComponent(v)}` })],
  ['FRED_API_KEY', 'Market data', 'FRED (free): interest rates and economic data.', 'optional', 'https://fredaccount.stlouisfed.org/apikeys', v => ({ url: `https://api.stlouisfed.org/fred/series?series_id=GDP&file_type=json&api_key=${encodeURIComponent(v)}` })],
  ['SEC_CONTACT', 'Market data', 'The contact address sent to SEC EDGAR with every request (its rules ask for one).', 'recommended', 'https://www.sec.gov/os/accessing-edgar-data'],
  ['MARGIN_FEED_URL', 'Market data', 'A feed of margin rates.', 'optional', null],
  ['BTC_API_URL', 'Market data', 'A Bitcoin balance service for All my money.', 'optional', null],
  ['ETH_RPC_URL', 'Market data', 'An Ethereum node for All my money.', 'optional', null],
  // Payments
  ['STRIPE_SECRET_KEY', 'Payments', 'Stripe: plans, credit packs and card deposits.', 'recommended', 'https://dashboard.stripe.com/apikeys', v => ({ url: 'https://api.stripe.com/v1/balance', headers: bearer(v) })],
  ['STRIPE_WEBHOOK_SECRET', 'Payments', 'Stripe webhook signing secret: payments are only counted after Stripe confirms them here.', 'recommended', 'https://dashboard.stripe.com/webhooks'],
  ['STRIPE_PORTAL_CONFIG', 'Payments', 'Stripe customer portal configuration.', 'optional', null],
  ['STRIPE_PRICE_PRO', 'Payments', 'Stripe price for Pro (monthly).', 'optional', null], ['STRIPE_PRICE_PRO_YEARLY', 'Payments', 'Stripe price for Pro (yearly).', 'optional', null],
  ['STRIPE_PRICE_ELITE', 'Payments', 'Stripe price for Elite (monthly).', 'optional', null], ['STRIPE_PRICE_ELITE_YEARLY', 'Payments', 'Stripe price for Elite (yearly).', 'optional', null],
  ['STRIPE_PRICE_ULTIMATE', 'Payments', 'Stripe price for Ultimate (monthly).', 'optional', null], ['STRIPE_PRICE_ULTIMATE_YEARLY', 'Payments', 'Stripe price for Ultimate (yearly).', 'optional', null],
  ['STRIPE_ACH', 'Payments', 'Bank (ACH) payments through Stripe on or off.', 'optional', null],
  ['HELCIM_API_TOKEN', 'Payments', 'Helcim card payments.', 'optional', 'https://www.helcim.com/'],
  ['SQUARE_ACCESS_TOKEN', 'Payments', 'Square payments.', 'optional', 'https://developer.squareup.com/apps'],
  // Email and SMS
  ['RESEND_API_KEY', 'Email and SMS', 'Resend: sign-in codes, receipts and alerts by email.', 'recommended', 'https://resend.com/api-keys', v => ({ url: 'https://api.resend.com/domains', headers: bearer(v) })],
  ['EMAIL_FROM', 'Email and SMS', 'The sender of the app\'s emails ("Brightolio <hi@…>").', 'optional', null],
  ['TWILIO_ACCOUNT_SID', 'Email and SMS', 'Twilio: SMS alerts and the phone line (the account SID).', 'optional', 'https://console.twilio.com/', (v, get) => ({ url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(v)}.json`, headers: { authorization: 'Basic ' + Buffer.from(`${v}:${get('TWILIO_AUTH_TOKEN')}`).toString('base64') } })],
  ['TWILIO_AUTH_TOKEN', 'Email and SMS', 'Twilio auth token (also checks that phone-line requests really come from Twilio).', 'optional', 'https://console.twilio.com/', (v, get) => get('TWILIO_ACCOUNT_SID') ? ({ url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(get('TWILIO_ACCOUNT_SID'))}.json`, headers: { authorization: 'Basic ' + Buffer.from(`${get('TWILIO_ACCOUNT_SID')}:${v}`).toString('base64') } }) : null],
  ['TWILIO_FROM', 'Email and SMS', 'The Twilio phone number messages come from.', 'optional', null],
  ['ADMIN_EMAIL', 'Email and SMS', 'Who is admin (and gets the admin notifications).', 'recommended', null],
  ['ADMIN_PHONE', 'Email and SMS', 'The admin\'s phone for urgent alerts.', 'optional', null],
  // Hosting and backups
  ['ENCRYPTION_KEY', 'Hosting and backups', 'Encrypts every stored key, broker credential and backup. Lives only in the server .env, never in the database: without the same one, the database and its backups cannot be read.', 'required', null],
  ['CRON_SECRET', 'Hosting and backups', 'Lets the scheduler and the server workflows call the app.', 'required', null],
  ['PUBLIC_URL', 'Hosting and backups', 'The site\'s one address (https://app.brightolio.com).', 'required', null],
  ['HOST_ID', 'Hosting and backups', 'This server\'s name.', 'required', null],
  ['OCI_BACKUP_PAR_URL', 'Hosting and backups', 'Oracle Object Storage pre-authenticated request (write only) for off-site backups.', 'recommended', 'https://cloud.oracle.com/object-storage/buckets'],
  ['BACKUP_KEY', 'Hosting and backups', 'Extra key for off-site backup copies.', 'optional', null],
  ['EDGE_SECRET', 'Hosting and backups', 'The secret the Cloudflare edge or Render forwarder signs requests with.', 'optional', null],
  ['CLOUDFLARE_API_TOKEN', 'Hosting and backups', 'Cloudflare: DNS for the main address and the edge cache.', 'optional', 'https://dash.cloudflare.com/profile/api-tokens', v => ({ url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: bearer(v) })],
  ['CLOUDFLARE_ACCOUNT_ID', 'Hosting and backups', 'Cloudflare account ID.', 'optional', null], ['CLOUDFLARE_KV_ID', 'Hosting and backups', 'Cloudflare KV namespace for the edge.', 'optional', null],
  ['CLOUDFLARE_ZONE_ID', 'Hosting and backups', 'Cloudflare zone ID of the domain.', 'optional', null], ['SITE_DOMAIN', 'Hosting and backups', 'The marketing site\'s domain.', 'optional', null],
  ['METRICS_TOKEN', 'Hosting and backups', 'Protects /metrics.', 'optional', null], ['PUBLIC_ORIGINS', 'Hosting and backups', 'Other addresses allowed to call the API.', 'optional', null],
  ['STANDBY', 'Hosting and backups', 'This server is the standby, not the active one.', 'optional', null], ['MAINTENANCE', 'Hosting and backups', 'Maintenance mode (held across restarts).', 'optional', null],
  ['RENDER_API_KEY', 'Hosting and backups', 'Render (only the redirect to app.brightolio.com runs there now).', 'optional', 'https://dashboard.render.com/u/settings#api-keys', v => ({ url: 'https://api.render.com/v1/owners?limit=1', headers: bearer(v) })],
  // GitHub
  ['GITHUB_TOKEN', 'GitHub', 'GitHub: the README, the AI coding agents and the AI work queue in Admin (a fine-grained token for this repository).', 'optional', 'https://github.com/settings/personal-access-tokens', v => ({ url: 'https://api.github.com/user', headers: { authorization: `Bearer ${v}`, 'user-agent': 'brightolio-admin', accept: 'application/vnd.github+json' } })],
  ['GITHUB_REPO', 'GitHub', 'The repository (owner/name).', 'optional', null],
  // Sign-in
  ['GOOGLE_CLIENT_ID', 'Sign-in', 'Sign in with Google: the OAuth client ID.', 'optional', 'https://console.cloud.google.com/apis/credentials'],
  ['GOOGLE_CLIENT_SECRET', 'Sign-in', 'Sign in with Google: the client secret.', 'optional', 'https://console.cloud.google.com/apis/credentials'],
  ['GITHUB_CLIENT_ID', 'Sign-in', 'Sign in with GitHub: the OAuth app\'s client ID.', 'optional', 'https://github.com/settings/developers'],
  ['GITHUB_CLIENT_SECRET', 'Sign-in', 'Sign in with GitHub: the client secret.', 'optional', 'https://github.com/settings/developers'],
  ['QBO_CLIENT_ID', 'Settings and other', 'QuickBooks Online (bookkeeping export).', 'optional', 'https://developer.intuit.com/app/developer/dashboard'],
  ['QBO_CLIENT_SECRET', 'Settings and other', 'QuickBooks client secret.', 'optional', 'https://developer.intuit.com/app/developer/dashboard'], ['QBO_ENV', 'Settings and other', 'QuickBooks environment.', 'optional', null],
  ['ANDROID_CERT_SHA256', 'Settings and other', 'The Android app\'s signing fingerprint (links open in the app).', 'optional', null],
  ['ANDROID_APK_URL', 'Settings and other', 'Where the Android download points.', 'optional', null], ['ANDROID_PLAY', 'Settings and other', 'The app is on Google Play.', 'optional', null], ['ANDROID_PLAY_URL', 'Settings and other', 'The Google Play page.', 'optional', null],
];
export const CATALOG = new Map(K.map(([name, group, what, need, url, test]) => [name, { name, group, what, need, url, test: test || null }]));
// Names that hold a secret (the rest are plain settings, shown in full).
export const isSecret = k => /SECRET|TOKEN|PASSWORD|_KEY$|_KEY_|KEY_ID|_SID$|PAR_URL$/.test(k) && !/(BASE|TRADING|TOKEN)_URL$|^PUBLIC_URL$/.test(k);
export const describe = name => CATALOG.get(name) || { name, group: 'Settings and other', what: 'A setting added by hand.', need: 'optional', url: null, test: null };
