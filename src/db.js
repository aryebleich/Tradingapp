// Storage via libSQL: a SQLite file (DB_FILE; on the Oracle server with PERSISTENT_DISK=1), or a
// shared libSQL server when DATABASE_URL and DATABASE_AUTH_TOKEN are set (several replicas, deploy/k8s).
import { createClient } from '@libsql/client';
import { publish, on, isLeader } from './bus.js';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL || 'file:' + (process.env.DB_FILE || path.resolve('data/quantpocket.db'));
if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
// A shared database keeps accounts and trading data across restarts; a local file on a host
// without a lasting disk is wiped on every restart and deploy. A local file on a
// server with a lasting disk (the Oracle VM: a Docker volume on the boot volume) is just as lasting:
// PERSISTENT_DISK=1 says so, and it is then backed up every hour (src/backup.js).
export const dbFile = url.startsWith('file:') ? url.slice(5) : null;
export const persistentDisk = () => process.env.PERSISTENT_DISK === '1';
export const persistentDb = !url.startsWith('file:') || persistentDisk();
export const dbKind = () => (dbFile ? 'file' : 'remote');
export const needsHostedDb = () => process.env.REQUIRE_HOSTED_DB === '1' && !persistentDisk();
if (!persistentDb && needsHostedDb() && process.env.REDIRECT_ONLY !== '1') console.error('DATABASE ERROR: DATABASE_URL is not set, so this server uses a local SQLite file that is lost on restart. Set PERSISTENT_DISK=1 on a server with a lasting disk, or DATABASE_URL for a shared database.');
if (persistentDb && !process.env.DATABASE_AUTH_TOKEN && /^libsql:|^https:/.test(url)) console.error('DATABASE WARNING: DATABASE_URL is set but DATABASE_AUTH_TOKEN is empty; a libSQL server refuses connections without it.');
export const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  phone TEXT UNIQUE,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  phone_code TEXT,
  pin_hash TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_renews INTEGER,
  stripe_customer TEXT,
  tax_bracket REAL NOT NULL DEFAULT 0.24,
  state_tax REAL NOT NULL DEFAULT 0.05,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_pending INTEGER NOT NULL DEFAULT 0,
  ip TEXT, ua TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  event TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  blob TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  entry TEXT NOT NULL,
  exit TEXT NOT NULL,
  sl REAL, tp REAL, ts REAL,
  size REAL NOT NULL DEFAULT 100,
  deployed TEXT,
  last_run TEXT,
  last_action TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cash REAL NOT NULL,
  start_cash REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  symbol TEXT NOT NULL,
  qty REAL NOT NULL,
  avg_price REAL NOT NULL,
  PRIMARY KEY (user_id, account, symbol)
);
CREATE TABLE IF NOT EXISTS fills (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  source TEXT NOT NULL,
  broker_order_id TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS equity_history (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  day TEXT NOT NULL,
  equity REAL NOT NULL,
  PRIMARY KEY (user_id, account, day)
);
CREATE TABLE IF NOT EXISTS scheduled_orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty REAL,
  notional REAL,
  repeat TEXT NOT NULL DEFAULT 'once',
  next_run INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_result TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fee_state (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  high_water REAL NOT NULL,
  net_contrib REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, account)
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  ref TEXT,
  memo TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  name TEXT, email TEXT NOT NULL,
  subject TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS broker_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE,
  account_number TEXT,
  status TEXT NOT NULL,
  crypto_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS broker_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  event_id TEXT UNIQUE,
  status_from TEXT,
  status_to TEXT NOT NULL,
  reason TEXT,
  source TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS job_runs (
  k TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  op TEXT NOT NULL,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_strategies (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT,
  name TEXT NOT NULL,
  spec TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT 'paper',
  allocation REAL NOT NULL DEFAULT 100,
  cash_buffer REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'manual',
  whole_shares INTEGER NOT NULL DEFAULT 1,
  stop_pct REAL,
  run_at INTEGER NOT NULL DEFAULT 945,
  state TEXT,
  last_run TEXT,
  last_result TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pair_bots (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  params TEXT NOT NULL,
  account TEXT NOT NULL,
  mode TEXT NOT NULL,
  capital REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  state TEXT,
  last_run TEXT,
  last_summary TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_sessions (
  ledger_id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  secret TEXT NOT NULL,
  total REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_runs (
  id INTEGER PRIMARY KEY,
  strategy_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT,
  detail TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_days (
  strategy_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  ret REAL NOT NULL,
  weights TEXT,
  PRIMARY KEY (strategy_id, day)
);
CREATE TABLE IF NOT EXISTS signal_hooks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  accounts TEXT NOT NULL DEFAULT '["paper"]',
  size_mode TEXT NOT NULL DEFAULT 'dollars',
  size REAL NOT NULL DEFAULT 1000,
  max_position REAL,
  max_trades_day INTEGER,
  symbols TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hook_id INTEGER,
  symbol TEXT,
  action TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  payload TEXT,
  test INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
-- Risk guardrails and kill switch (settings is JSON).
CREATE TABLE IF NOT EXISTS risk_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings TEXT NOT NULL DEFAULT '{}',
  kill INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);
-- What an automated order expected to pay, to measure slippage and delay once it fills.
CREATE TABLE IF NOT EXISTS order_intents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  broker_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  expected_price REAL,
  signal_at INTEGER,
  source TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS journal_notes (
  fill_id INTEGER PRIMARY KEY REFERENCES fills(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT,
  tags TEXT,
  at INTEGER NOT NULL
);
-- Trainable AI agents: a model fitted to one symbol, optionally trading it.
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  config TEXT NOT NULL,
  model TEXT,
  metrics TEXT,
  account TEXT,
  size REAL NOT NULL DEFAULT 25,
  deployed INTEGER NOT NULL DEFAULT 0,
  last_run TEXT,
  last_action TEXT,
  trained_at INTEGER,
  created_at INTEGER NOT NULL
);
-- Market scanners that run on a schedule (crypto around the clock).
CREATE TABLE IF NOT EXISTS scanners (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  universe TEXT NOT NULL,
  rules TEXT NOT NULL,
  patterns TEXT,
  every_min INTEGER NOT NULL DEFAULT 60,
  action TEXT NOT NULL DEFAULT 'alert',
  account TEXT,
  notional REAL,
  active INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_hits (
  id INTEGER PRIMARY KEY,
  scanner_id INTEGER NOT NULL REFERENCES scanners(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  price REAL,
  day TEXT NOT NULL,
  result TEXT,
  at INTEGER NOT NULL
);
-- Rule-based portfolios: universe, filters, ranking, weighting, rebalancing, contributions.
CREATE TABLE IF NOT EXISTS baskets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  spec TEXT NOT NULL,
  account TEXT,
  amount REAL,
  deployed INTEGER NOT NULL DEFAULT 0,
  contribution REAL,
  contrib_day INTEGER,
  ach_relationship TEXT,
  public INTEGER NOT NULL DEFAULT 0,
  source_id INTEGER,
  follow_updates INTEGER NOT NULL DEFAULT 0,
  last_rebalance TEXT,
  last_contrib TEXT,
  holdings TEXT,
  stats TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Signal channels: one leader broadcasts, followers mirror into their own accounts.
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  public INTEGER NOT NULL DEFAULT 1,
  token_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_signals (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  size_pct REAL,
  price REAL,
  note TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_subs (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  sizing TEXT NOT NULL DEFAULT 'fixed',
  amount REAL NOT NULL DEFAULT 100,
  mode TEXT NOT NULL DEFAULT 'review',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (channel_id, user_id, account)
);
CREATE TABLE IF NOT EXISTS channel_pending (
  id INTEGER PRIMARY KEY,
  sub_id INTEGER NOT NULL REFERENCES channel_subs(id) ON DELETE CASCADE,
  signal_id INTEGER NOT NULL REFERENCES channel_signals(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  at INTEGER NOT NULL
);
-- Automated option income (covered calls, cash-secured puts, the wheel).
CREATE TABLE IF NOT EXISTS income_bots (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  underlying TEXT NOT NULL,
  kind TEXT NOT NULL,
  config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  state TEXT,
  last_run TEXT,
  last_action TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS code_scripts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Private markets and real estate (src/alts.js): the investment and its dated cash flows.
CREATE TABLE IF NOT EXISTS alt_assets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS alt_assets_user ON alt_assets(user_id, kind);
CREATE TABLE IF NOT EXISTS alt_events (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES alt_assets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  on_date TEXT NOT NULL,
  memo TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS alt_events_asset ON alt_events(asset_id);
-- One app for all your money (src/money.js): linked banks and cards (Plaid), their accounts and
-- transactions, and crypto wallets watched by address.
CREATE TABLE IF NOT EXISTS money_items (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution TEXT,
  token TEXT NOT NULL,
  cursor TEXT,
  accounts TEXT NOT NULL DEFAULT '[]',
  refreshed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS money_items_user ON money_items(user_id);
CREATE TABLE IF NOT EXISTS money_tx (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  account_id TEXT,
  day TEXT NOT NULL,
  name TEXT,
  amount REAL NOT NULL,
  category TEXT
);
CREATE INDEX IF NOT EXISTS money_tx_user ON money_tx(user_id, day);
CREATE TABLE IF NOT EXISTS crypto_wallets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT,
  amount REAL,
  checked_at INTEGER,
  created_at INTEGER NOT NULL
);
-- Rules across accounts (src/rules.js): a target mix for several accounts and trades awaiting approval.
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  targets TEXT NOT NULL,
  accounts TEXT NOT NULL,
  schedule TEXT NOT NULL DEFAULT 'quarterly',
  options TEXT NOT NULL DEFAULT '{}',
  pending TEXT,
  last_run INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
-- Saved Brightolio Scripts and their daily alerts (src/scripts.js).
-- Admin → AI team (src/aiteam.js): jobs worked on by the manager and its agents.
CREATE TABLE IF NOT EXISTS ai_team_jobs (
  id INTEGER PRIMARY KEY, job TEXT NOT NULL, status TEXT NOT NULL, plan TEXT, messages TEXT, result TEXT,
  created_by INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
-- AI long/short portfolios (src/aifunds.js): a book of longs and shorts rebuilt every week.
CREATE TABLE IF NOT EXISTS ai_funds (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, style TEXT NOT NULL, risk INTEGER NOT NULL, account TEXT NOT NULL, capital REAL,
  book TEXT, held TEXT, nav REAL NOT NULL DEFAULT 100, memo TEXT, pending TEXT, last_run INTEGER,
  active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
-- Sponsored news (src/sponsored.js): paid announcements of listed companies for free-plan users.
CREATE TABLE IF NOT EXISTS sponsored_ads (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL, company TEXT, exchange TEXT,
  headline TEXT NOT NULL, body TEXT, url TEXT,
  sponsor TEXT NOT NULL, paid REAL NOT NULL, disclosure TEXT,
  starts TEXT NOT NULL, ends TEXT, weight INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sponsored_views (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  alert INTEGER NOT NULL DEFAULT 0,
  last_fired TEXT,
  last_checked TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Business tools (src/business): every record is one JSON document of a kind (account, entry,
-- contact, invoice, item, employee, payrun, bank, receipt, settings).
CREATE TABLE IF NOT EXISTS biz_docs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS biz_docs_user_kind ON biz_docs(user_id, kind);
-- Groups of the user's Alpaca accounts with their own portfolio view (src/consolidate.js).
CREATE TABLE IF NOT EXISTS account_groups (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  accounts TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL
);
-- Equalize accounts (src/equalize.js): the same mix in every chosen account, by hand or each market open.
CREATE TABLE IF NOT EXISTS equalize (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  accounts TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT 'combined',
  options TEXT NOT NULL DEFAULT '{}',
  daily INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'approve',
  pending TEXT,
  last_run INTEGER,
  last_result TEXT
);
-- Public status page: the app's own checks every few minutes, and incidents the admin posts.
CREATE TABLE IF NOT EXISTS status_checks (
  id INTEGER PRIMARY KEY,
  t INTEGER NOT NULL,
  component TEXT NOT NULL,
  ok INTEGER NOT NULL,
  ms INTEGER
);
CREATE INDEX IF NOT EXISTS status_checks_t ON status_checks(t);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  impact TEXT NOT NULL DEFAULT 'minor',
  status TEXT NOT NULL DEFAULT 'investigating',
  components TEXT NOT NULL DEFAULT '[]',
  updates TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  resolved_at INTEGER
);
-- Tzedakah ledger (the luach page): what was given, to whom; it counts toward maaser.
CREATE TABLE IF NOT EXISTS tzedakah (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  amount REAL NOT NULL,
  recipient TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tzedakah_user ON tzedakah(user_id, day);
-- Yiddish on the phone line: the owner's recorded clips, and pieces callers heard with no clip yet.
CREATE TABLE IF NOT EXISTS voice_clips (
  k TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_missing (
  k TEXT PRIMARY KEY,
  english TEXT NOT NULL,
  heard INTEGER NOT NULL DEFAULT 1,
  last_at INTEGER NOT NULL
);
-- Live data for private investments and real estate (add-ons).
CREATE TABLE IF NOT EXISTS property_estimates (
  asset_id INTEGER PRIMARY KEY REFERENCES alt_assets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value REAL, value_low REAL, value_high REAL,
  rent REAL, rent_low REAL, rent_high REAL,
  auto INTEGER NOT NULL DEFAULT 0,
  apply INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cap_tables (
  asset_id INTEGER PRIMARY KEY REFERENCES alt_assets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS k1s (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES alt_assets(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'expected',
  boxes TEXT NOT NULL DEFAULT '{}',
  file TEXT,
  file_name TEXT,
  received_on TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (asset_id, year)
);
-- The weekly AI money brief.
CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  data TEXT NOT NULL,
  text TEXT NOT NULL,
  by_ai INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, week)
);
-- Tax-saving autopilot: the harvest plan waiting for approval.
CREATE TABLE IF NOT EXISTS tax_pilot (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  options TEXT NOT NULL DEFAULT '{}',
  pending TEXT,
  last_scan INTEGER,
  harvested REAL NOT NULL DEFAULT 0
);
-- Paper account limit, stop and stop-limit orders waiting for their price.
CREATE TABLE IF NOT EXISTS paper_orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty REAL NOT NULL,
  type TEXT NOT NULL,
  limit_price REAL,
  stop_price REAL,
  tif TEXT NOT NULL DEFAULT 'day',
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  triggered INTEGER NOT NULL DEFAULT 0,
  fill_price REAL,
  note TEXT,
  created_at INTEGER NOT NULL,
  filled_at INTEGER
);
CREATE INDEX IF NOT EXISTS paper_orders_open ON paper_orders(status, user_id);
-- Practice futures positions (contracts) in the paper account.
CREATE TABLE IF NOT EXISTS paper_futures (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root TEXT NOT NULL,
  contracts INTEGER NOT NULL,
  entry REAL NOT NULL,
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, root)
);
-- Business calls, texts and email (Admin → Calls, texts & email).
CREATE TABLE IF NOT EXISTS comms (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'in',
  party TEXT NOT NULL,
  name TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  media TEXT,
  duration INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comms_party ON comms(party, id);
-- One-time codes that hand a browser sign-in to the Android app.
CREATE TABLE IF NOT EXISTS app_handoffs (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
-- Brokerage applications by text, encrypted, kept at most 7 days (deleted once sent to Alpaca).
CREATE TABLE IF NOT EXISTS text_applications (
  phone TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Money in and out of each account, by date, for time-weighted returns.
CREATE TABLE IF NOT EXISTS cashflows (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  amount REAL NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cache (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  at INTEGER NOT NULL
);
-- Spend-based investing: card purchases turned into share purchases.
CREATE TABLE IF NOT EXISTS roundup_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings TEXT NOT NULL DEFAULT '{}',
  plaid_token TEXT,
  cursor TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS roundup_tx (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tx_id TEXT NOT NULL,
  day TEXT NOT NULL,
  merchant TEXT,
  amount REAL NOT NULL,
  ticker TEXT,
  invest REAL NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  at INTEGER NOT NULL,
  UNIQUE (user_id, tx_id)
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, k)
);
CREATE TABLE IF NOT EXISTS order_queue (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  payload TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exec_audit (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  kinds TEXT NOT NULL DEFAULT 'alerts,orders,reports',
  ua TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER
);
CREATE TABLE IF NOT EXISTS passkeys (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cred_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  hint TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS drip_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  amount REAL NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE (user_id, activity_id)
);
CREATE TABLE IF NOT EXISTS site_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS margin_snapshots (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  day TEXT NOT NULL,
  equity REAL, buying_power REAL, maintenance REAL, initial REAL, leverage REAL,
  PRIMARY KEY (user_id, account, day)
);
CREATE TABLE IF NOT EXISTS credit_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  monthly_left INTEGER NOT NULL DEFAULT 0,
  bought INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  memo TEXT,
  ref TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_ledger_user ON credit_ledger (user_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_ref ON credit_ledger (ref) WHERE ref IS NOT NULL;
`;

// Columns added after the first release; ALTER fails harmlessly when they already exist.
const MIGRATIONS = [
  // Batch 23: Admin → Analytics (page views and once-a-day visitor hashes).
  'CREATE TABLE IF NOT EXISTS traffic (day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, key))',
  'CREATE TABLE IF NOT EXISTS traffic_visitors (day TEXT NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (day, kind, hash))',
  // Batch 23: hedge-fund option hedges.
  'ALTER TABLE ai_funds ADD COLUMN hedge TEXT',
  'ALTER TABLE ai_funds ADD COLUMN hedge_plan TEXT',
  // Batch 23: the Home AI analysis of today's profit and loss (one saved answer per account).
  'CREATE TABLE IF NOT EXISTS pnl_why (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, account TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, account))',
  // AI trading (batch 22): agents and API, AI bots, AI signals, market intelligence.
  'CREATE TABLE IF NOT EXISTS ai_usage (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, period TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, kind, period))',
  'CREATE TABLE IF NOT EXISTS agent_settings (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS agent_orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, agent TEXT, account TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, qty REAL, notional REAL, type TEXT NOT NULL DEFAULT \'market\', limit_price REAL, extended INTEGER NOT NULL DEFAULT 0, est_usd REAL, reason TEXT, status TEXT NOT NULL, result TEXT, day TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER)',
  'CREATE INDEX IF NOT EXISTS agent_orders_user ON agent_orders (user_id, id)',
  'CREATE TABLE IF NOT EXISTS ai_bots (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, name TEXT NOT NULL, account TEXT NOT NULL, symbol TEXT NOT NULL, config TEXT NOT NULL, state TEXT NOT NULL DEFAULT \'{}\', active INTEGER NOT NULL DEFAULT 0, every_min INTEGER NOT NULL DEFAULT 1440, last_run INTEGER, last_result TEXT, shared INTEGER NOT NULL DEFAULT 0, description TEXT, copies INTEGER NOT NULL DEFAULT 0, copied_from INTEGER, created_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ai_bots_user ON ai_bots (user_id)',
  'CREATE INDEX IF NOT EXISTS ai_bots_active ON ai_bots (active)',
  'CREATE TABLE IF NOT EXISTS ai_signals (id INTEGER PRIMARY KEY, day TEXT NOT NULL, symbol TEXT NOT NULL, setup TEXT NOT NULL, side TEXT NOT NULL, entry REAL NOT NULL, stop REAL NOT NULL, target REAL NOT NULL, win_rate REAL NOT NULL, avg_return REAL NOT NULL, samples INTEGER NOT NULL, score REAL NOT NULL, horizon INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE (day, symbol, setup))',
  'CREATE INDEX IF NOT EXISTS ai_signals_day ON ai_signals (day, score)',
  'CREATE TABLE IF NOT EXISTS signal_auto (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, json TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS signal_trades (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, signal_id INTEGER, account TEXT NOT NULL, symbol TEXT NOT NULL, qty REAL NOT NULL, entry REAL NOT NULL, stop REAL NOT NULL, target REAL NOT NULL, risk REAL NOT NULL, status TEXT NOT NULL, exit_price REAL, note TEXT, opened_at INTEGER NOT NULL, closed_at INTEGER, expires_day TEXT)',
  'CREATE INDEX IF NOT EXISTS signal_trades_open ON signal_trades (status)',
  'CREATE TABLE IF NOT EXISTS family_members (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, born INTEGER, goal TEXT, symbol TEXT NOT NULL, amount REAL NOT NULL, every_days INTEGER NOT NULL DEFAULT 7, account TEXT NOT NULL DEFAULT \'paper\', active INTEGER NOT NULL DEFAULT 1, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS family_members_due ON family_members (active, next_at)',
  'CREATE TABLE IF NOT EXISTS family_ledger (id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL, qty REAL NOT NULL, price REAL NOT NULL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS family_ledger_member ON family_ledger (member_id)',
  'CREATE TABLE IF NOT EXISTS whale_wallets (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, chain TEXT NOT NULL, address TEXT NOT NULL, label TEXT, balance REAL, prev_balance REAL, threshold REAL NOT NULL DEFAULT 100, checked_at INTEGER, moved_at INTEGER, UNIQUE (user_id, chain, address))',
  'CREATE TABLE IF NOT EXISTS earnings_summaries (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT, title TEXT, summary TEXT NOT NULL, created_at INTEGER NOT NULL)',

  'ALTER TABLE user_strategies ADD COLUMN leverage REAL NOT NULL DEFAULT 1',
  'ALTER TABLE user_strategies ADD COLUMN public INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE user_strategies ADD COLUMN published_at INTEGER',
  'ALTER TABLE user_strategies ADD COLUMN notes TEXT',
  'ALTER TABLE user_strategies ADD COLUMN copied_from INTEGER',
  // Playbooks (template_id 'playbook'): every saved version (JSON, newest last), the AI-builder label,
  // library reports and moderation, and how often a published one was copied.
  'ALTER TABLE user_strategies ADD COLUMN versions TEXT',
  // Developer API keys share api_tokens with the agent tokens: kind 'api', JSON scopes, a per-key
  // rate limit, and revocation (kept for the record).
  "ALTER TABLE api_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'",
  'ALTER TABLE api_tokens ADD COLUMN scopes TEXT',
  'ALTER TABLE api_tokens ADD COLUMN rate_per_min INTEGER',
  'ALTER TABLE api_tokens ADD COLUMN revoked_at INTEGER',
  'ALTER TABLE user_strategies ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE user_strategies ADD COLUMN reports TEXT',
  'ALTER TABLE user_strategies ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE user_strategies ADD COLUMN copies INTEGER NOT NULL DEFAULT 0',
  // Scheduled trades at a fixed New York time, on chosen weekdays, as market or limit orders.
  'ALTER TABLE scheduled_orders ADD COLUMN run_minutes INTEGER',
  'ALTER TABLE scheduled_orders ADD COLUMN weekdays TEXT',
  'ALTER TABLE scheduled_orders ADD COLUMN month_day INTEGER',
  "ALTER TABLE scheduled_orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'market'",
  'ALTER TABLE scheduled_orders ADD COLUMN limit_price REAL',
  'ALTER TABLE scheduled_orders ADD COLUMN extended INTEGER NOT NULL DEFAULT 0',
  // Scheduling from the order ticket: how the time was chosen, the grace window (missed by more and the
  // order expires, never sent late), and the broker's auction order ('opg' at the open, 'cls' at the close).
  'ALTER TABLE scheduled_orders ADD COLUMN when_kind TEXT',
  'ALTER TABLE scheduled_orders ADD COLUMN close_offset INTEGER',
  'ALTER TABLE scheduled_orders ADD COLUMN grace_min INTEGER',
  'ALTER TABLE scheduled_orders ADD COLUMN tif TEXT',
  // A scheduled close: 'all', 'qty' (at most the order's quantity) or 'pct' (close_pct of the position),
  // always worked out from the position at run time.
  'ALTER TABLE scheduled_orders ADD COLUMN close_mode TEXT',
  'ALTER TABLE scheduled_orders ADD COLUMN close_pct REAL',
  // Pause, an end date for repeating schedules, and the run history (JSON, newest last, at most 50).
  'ALTER TABLE scheduled_orders ADD COLUMN paused INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE scheduled_orders ADD COLUMN end_at INTEGER',
  'ALTER TABLE scheduled_orders ADD COLUMN history TEXT',
  // A price condition checked when the order runs ('above' / 'below' a level), and a close in steps
  // (scale out: close_steps parts, step_every_min apart; steps_done counts the parts already run).
  'ALTER TABLE scheduled_orders ADD COLUMN cond_op TEXT',
  'ALTER TABLE scheduled_orders ADD COLUMN cond_price REAL',
  'ALTER TABLE scheduled_orders ADD COLUMN close_steps INTEGER',
  'ALTER TABLE scheduled_orders ADD COLUMN step_every_min INTEGER',
  'ALTER TABLE scheduled_orders ADD COLUMN steps_done INTEGER NOT NULL DEFAULT 0',
  // Scheduled stop, stop-limit, trailing-stop and bracket orders (sent through placeOrder like any other).
  'ALTER TABLE scheduled_orders ADD COLUMN stop_price REAL',
  'ALTER TABLE scheduled_orders ADD COLUMN trail_percent REAL',
  'ALTER TABLE scheduled_orders ADD COLUMN trail_price REAL',
  'ALTER TABLE scheduled_orders ADD COLUMN tp_price REAL',
  'ALTER TABLE scheduled_orders ADD COLUMN sl_price REAL',
  'ALTER TABLE scheduled_orders ADD COLUMN sl_limit REAL',
  'ALTER TABLE scheduled_orders ADD COLUMN bracket INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN reset_hash TEXT',
  'ALTER TABLE users ADD COLUMN reset_expires INTEGER',
  'ALTER TABLE users ADD COLUMN verify_hash TEXT',
  'ALTER TABLE users ADD COLUMN phone_code_expires INTEGER',
  'ALTER TABLE users ADD COLUMN alpaca_conn TEXT',
  'ALTER TABLE users ADD COLUMN plan_status TEXT',
  'ALTER TABLE users ADD COLUMN plan_interval TEXT',
  'ALTER TABLE users ADD COLUMN trial_used INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN ref_code TEXT',
  'ALTER TABLE users ADD COLUMN referred_by INTEGER',
  // 5-digit referral code that works by text ("name@example.com 12345").
  'ALTER TABLE users ADD COLUMN ref_num TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_ref_num ON users (ref_num) WHERE ref_num IS NOT NULL',
  'ALTER TABLE users ADD COLUMN referral_rewarded INTEGER NOT NULL DEFAULT 0',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_ref_code ON users (ref_code) WHERE ref_code IS NOT NULL',
  'ALTER TABLE users ADD COLUMN google_sub TEXT',
  'ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS signals_user ON signals (user_id, id)',
  'ALTER TABLE users ADD COLUMN github_id TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_github_id ON users (github_id) WHERE github_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS broker_events_user ON broker_events (user_id, id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ledger_ref ON ledger (kind, ref) WHERE ref IS NOT NULL',
  'ALTER TABLE fills ADD COLUMN expected_price REAL',
  'ALTER TABLE fills ADD COLUMN signal_at INTEGER',
  'ALTER TABLE strategies ADD COLUMN freq TEXT',
  'ALTER TABLE strategies ADD COLUMN last_run_at INTEGER',
  'ALTER TABLE strategies ADD COLUMN public INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE strategies ADD COLUMN description TEXT',
  'ALTER TABLE users ADD COLUMN mtm_election INTEGER NOT NULL DEFAULT 0',
  'CREATE INDEX IF NOT EXISTS risk_log_user ON risk_log (user_id, day)',
  'CREATE INDEX IF NOT EXISTS order_intents_order ON order_intents (broker_order_id)',
  'CREATE INDEX IF NOT EXISTS scan_hits_scanner ON scan_hits (scanner_id, symbol, day)',
  'CREATE INDEX IF NOT EXISTS channel_signals_channel ON channel_signals (channel_id, id)',
  'CREATE INDEX IF NOT EXISTS roundup_tx_user ON roundup_tx (user_id, status)',
  'CREATE INDEX IF NOT EXISTS order_queue_status ON order_queue (status, id)',
  'CREATE INDEX IF NOT EXISTS exec_audit_user ON exec_audit (user_id, id)',
  // The execution log is append-only: the database itself refuses edits and deletions.
  "CREATE TRIGGER IF NOT EXISTS exec_audit_no_update BEFORE UPDATE ON exec_audit BEGIN SELECT RAISE(ABORT, 'exec_audit is append-only'); END",
  "CREATE TRIGGER IF NOT EXISTS exec_audit_no_delete BEFORE DELETE ON exec_audit BEGIN SELECT RAISE(ABORT, 'exec_audit is append-only'); END",
  // AI team Chat (src/aichat, flag ai_team_chat): conversations, messages and, kept apart, the model's thinking.
  'CREATE TABLE IF NOT EXISTS ai_chat_conversations (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ai_chat_conversations_owner ON ai_chat_conversations (owner_id, updated_at)',
  'CREATE TABLE IF NOT EXISTS ai_chat_messages (id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_chat_conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, model TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ai_chat_messages_conv ON ai_chat_messages (conversation_id, id)',
  'ALTER TABLE ai_chat_messages ADD COLUMN route_reason TEXT', // why the router picked this model (src/ai/router.js)
  'ALTER TABLE ai_chat_messages ADD COLUMN error TEXT', // why a reply failed, shown when the conversation is reopened (no key, no message text)
  'CREATE TABLE IF NOT EXISTS ai_chat_thinking (message_id INTEGER PRIMARY KEY REFERENCES ai_chat_messages(id) ON DELETE CASCADE, content TEXT NOT NULL, duration_ms INTEGER)',
  // OpenAI webhooks (src/openai-webhook.js): each event id is handled once; background jobs wait for their event.
  'CREATE TABLE IF NOT EXISTS openai_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, error TEXT, received_at INTEGER NOT NULL, done_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS openai_jobs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, openai_id TEXT NOT NULL, status TEXT NOT NULL, owner_id INTEGER, conversation_id TEXT, message_id INTEGER, result TEXT, error TEXT, notify INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS openai_jobs_openai ON openai_jobs (openai_id)',
  // Stripe webhook hardening: each event id is processed once (Stripe re-sends events and may deliver
  // them late or out of order); per-object state lets a late "subscription updated" be ignored after
  // the subscription was deleted; ledger.livemode keeps test-mode payments out of revenue reports
  // (NULL = written before this column existed, counted as live).
  'CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, livemode INTEGER, created INTEGER, status TEXT NOT NULL, received_at INTEGER NOT NULL, done_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS stripe_object_state (object_id TEXT PRIMARY KEY, last_created INTEGER NOT NULL, terminal INTEGER NOT NULL DEFAULT 0)',
  'ALTER TABLE ledger ADD COLUMN livemode INTEGER',
  'CREATE INDEX IF NOT EXISTS ledger_ref_lookup ON ledger (ref)',
  // SMS and voice module (src/sms-voice/, flag comms_drawer). Metadata only: message text is never kept
  // for good. An inbound text waits, encrypted, in sms_messages.pending_body until the browser confirms
  // it has it (at most 72 hours); the history itself lives on the user's device. Recordings are never stored.
  'CREATE TABLE IF NOT EXISTS comms_numbers (number TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, voice_mode TEXT NOT NULL DEFAULT \'ivr\', greeting TEXT, credential_id TEXT, sip_username TEXT, created_at INTEGER NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS comms_numbers_user ON comms_numbers (user_id)',
  'CREATE TABLE IF NOT EXISTS sms_messages (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_message_id TEXT NOT NULL, direction TEXT NOT NULL, thread_key TEXT NOT NULL, peer_last4 TEXT, our_number TEXT, status TEXT NOT NULL, error_code TEXT, pending_body TEXT, pending_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_provider_id ON sms_messages (provider, provider_message_id)',
  'CREATE INDEX IF NOT EXISTS sms_messages_thread ON sms_messages (user_id, thread_key, created_at)',
  'CREATE INDEX IF NOT EXISTS sms_messages_pending ON sms_messages (user_id, pending_until) WHERE pending_body IS NOT NULL',
  'CREATE TABLE IF NOT EXISTS call_records (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_call_id TEXT NOT NULL, leg_id TEXT, direction TEXT NOT NULL, thread_key TEXT NOT NULL, peer_last4 TEXT, our_number TEXT, status TEXT NOT NULL, handling TEXT, stage TEXT, seen INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, answered_at INTEGER, ended_at INTEGER, duration_s INTEGER, created_at INTEGER NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS call_records_provider_id ON call_records (provider, provider_call_id)',
  'CREATE INDEX IF NOT EXISTS call_records_user ON call_records (user_id, started_at)',
  'CREATE TABLE IF NOT EXISTS sms_consent (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, thread_key TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, last_inbound_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, thread_key))',
  'CREATE TABLE IF NOT EXISTS comms_webhook_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL)',
  // Trading tools (src/tradetools): what each AI explainer was asked and answered, redacted, for compliance review.
  'CREATE TABLE IF NOT EXISTS ai_compliance_log (id INTEGER PRIMARY KEY, tool TEXT NOT NULL, user_ref TEXT NOT NULL, prompt TEXT, output TEXT, outcome TEXT NOT NULL, reason TEXT, model TEXT, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ai_compliance_log_at ON ai_compliance_log (at)',
  // Live ratio pair bots (src/pairslive.js): each bot and its trade log.
  'CREATE TABLE IF NOT EXISTS live_pairs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, a TEXT NOT NULL, b TEXT NOT NULL, account TEXT NOT NULL, params TEXT NOT NULL, status TEXT NOT NULL, state TEXT, created_at INTEGER NOT NULL, updated_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS live_pair_log (id INTEGER PRIMARY KEY, pair_id INTEGER NOT NULL REFERENCES live_pairs(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS live_pair_log_pair ON live_pair_log (pair_id, id)',
  // Growth features: AI morning news picks (the engine's daily picks = its public track record, and each
  // member's orders) and the AI intraday engine's trade log.
  // AI long/short portfolios: a cap on each position and the value history (drawdown, paper record).
  'ALTER TABLE ai_funds ADD COLUMN max_weight REAL',
  'CREATE TABLE IF NOT EXISTS ai_fund_nav (fund_id INTEGER NOT NULL REFERENCES ai_funds(id) ON DELETE CASCADE, at INTEGER NOT NULL, nav REAL NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ai_fund_nav_fund ON ai_fund_nav (fund_id, at)',
  'CREATE TABLE IF NOT EXISTS newspicks_log (day TEXT NOT NULL, symbol TEXT NOT NULL, rank INTEGER NOT NULL, score REAL, reasons TEXT, sources TEXT, open REAL, close REAL, ret REAL, PRIMARY KEY (day, symbol))',
  'CREATE TABLE IF NOT EXISTS newspicks_trades (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, account TEXT NOT NULL, symbol TEXT NOT NULL, dollars REAL, qty REAL, entry REAL, stop REAL, exit REAL, status TEXT NOT NULL, note TEXT, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS newspicks_trades_user ON newspicks_trades (user_id, day)',
  'CREATE TABLE IF NOT EXISTS intraday_log (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, account TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, qty REAL, price REAL, reason TEXT, pl REAL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS intraday_log_user ON intraday_log (user_id, at)',
  // Rows read (every row a query scans costs time): an index for every WHERE column the app filters
  // on. user_id on every table that has it, then the scheduler's, housekeeping's and lookups' columns
  // (READS_AUDIT.md lists the full scans these remove).
  'CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_audit_log_user ON audit_log (user_id, event)',
  'CREATE INDEX IF NOT EXISTS ix_strategies_user ON strategies (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_fills_user ON fills (user_id, account, at)',
  'CREATE INDEX IF NOT EXISTS ix_scheduled_orders_user ON scheduled_orders (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_ledger_user ON ledger (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_messages_user ON messages (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_alerts_user ON alerts (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_user_strategies_user ON user_strategies (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_pair_bots_user ON pair_bots (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_strategy_runs_user ON strategy_runs (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_signal_hooks_user ON signal_hooks (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_order_intents_user ON order_intents (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_journal_notes_user ON journal_notes (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_agents_user ON agents (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_scanners_user ON scanners (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_scan_hits_user ON scan_hits (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_baskets_user ON baskets (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_channels_user ON channels (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_channel_subs_user ON channel_subs (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_channel_pending_user ON channel_pending (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_income_bots_user ON income_bots (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_code_scripts_user ON code_scripts (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_alt_events_user ON alt_events (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_crypto_wallets_user ON crypto_wallets (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_rules_user ON rules (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_ai_funds_user ON ai_funds (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_scripts_user ON scripts (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_account_groups_user ON account_groups (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_property_estimates_user ON property_estimates (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_cap_tables_user ON cap_tables (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_k1s_user ON k1s (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_paper_orders_user ON paper_orders (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_app_handoffs_user ON app_handoffs (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_cashflows_user ON cashflows (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_order_queue_user ON order_queue (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_passkeys_user ON passkeys (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_api_tokens_user ON api_tokens (user_id, kind)',
  'CREATE INDEX IF NOT EXISTS ix_signal_trades_user ON signal_trades (user_id, signal_id)',
  'CREATE INDEX IF NOT EXISTS ix_family_members_user ON family_members (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_family_ledger_user ON family_ledger (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_earnings_summaries_user ON earnings_summaries (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_live_pairs_user ON live_pairs (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_live_pair_log_user ON live_pair_log (user_id)',
  'CREATE INDEX IF NOT EXISTS ix_job_runs_at ON job_runs (at)',
  'CREATE INDEX IF NOT EXISTS ix_sessions_expires_at ON sessions (expires_at)',
  'CREATE INDEX IF NOT EXISTS ix_scheduled_orders_active_next_run ON scheduled_orders (active, next_run)',
  'CREATE INDEX IF NOT EXISTS ix_alerts_active ON alerts (active)',
  'CREATE INDEX IF NOT EXISTS ix_user_settings_k ON user_settings (k)',
  'CREATE INDEX IF NOT EXISTS ix_fills_broker_order_id ON fills (broker_order_id)',
  'CREATE INDEX IF NOT EXISTS ix_ledger_at ON ledger (at)',
  'CREATE INDEX IF NOT EXISTS ix_audit_log_at ON audit_log (at)',
  'CREATE INDEX IF NOT EXISTS ix_users_created_at ON users (created_at)',
  'CREATE INDEX IF NOT EXISTS ix_users_verify_hash ON users (verify_hash)',
  'CREATE INDEX IF NOT EXISTS ix_users_reset_hash ON users (reset_hash)',
  'CREATE INDEX IF NOT EXISTS ix_users_stripe_customer ON users (stripe_customer)',
  'CREATE INDEX IF NOT EXISTS ix_users_referred_by ON users (referred_by)',
  'CREATE INDEX IF NOT EXISTS ix_comms_at ON comms (at)',
  'CREATE INDEX IF NOT EXISTS ix_comms_status ON comms (status)',
  'CREATE INDEX IF NOT EXISTS ix_credit_ledger_at ON credit_ledger (at)',
  'CREATE INDEX IF NOT EXISTS ix_strategies_deployed ON strategies (deployed)',
  'CREATE INDEX IF NOT EXISTS ix_user_strategies_template_id ON user_strategies (template_id)',
  'CREATE INDEX IF NOT EXISTS ix_user_strategies_mode ON user_strategies (mode)',
  'CREATE INDEX IF NOT EXISTS ix_rules_active ON rules (active)',
  'CREATE INDEX IF NOT EXISTS ix_live_pairs_status ON live_pairs (status)',
  'CREATE INDEX IF NOT EXISTS ix_pair_bots_active ON pair_bots (active)',
  'CREATE INDEX IF NOT EXISTS ix_ai_funds_active ON ai_funds (active)',
  'CREATE INDEX IF NOT EXISTS ix_scripts_alert ON scripts (alert)',
  'CREATE INDEX IF NOT EXISTS ix_baskets_source_id ON baskets (source_id)',
  'CREATE INDEX IF NOT EXISTS ix_baskets_deployed ON baskets (deployed)',
  'CREATE INDEX IF NOT EXISTS ix_channels_token_hash ON channels (token_hash)',
  'CREATE INDEX IF NOT EXISTS ix_strategy_runs_strategy_id ON strategy_runs (strategy_id)',
  'CREATE INDEX IF NOT EXISTS ix_broker_events_account_id ON broker_events (account_id)',
  'CREATE INDEX IF NOT EXISTS ix_app_handoffs_expires_at ON app_handoffs (expires_at)',
  'CREATE INDEX IF NOT EXISTS ix_income_bots_active ON income_bots (active)',
  'CREATE INDEX IF NOT EXISTS ix_status_checks_component_t ON status_checks (component, t)',
  'CREATE INDEX IF NOT EXISTS ix_equalize_daily ON equalize (daily)',
  'CREATE INDEX IF NOT EXISTS ix_agents_deployed ON agents (deployed)',
  'CREATE INDEX IF NOT EXISTS ix_newspicks_trades_day_status ON newspicks_trades (day, status)',
  'CREATE INDEX IF NOT EXISTS ix_scanners_active ON scanners (active)',
  'CREATE INDEX IF NOT EXISTS ix_messages_status ON messages (status)',
  'CREATE INDEX IF NOT EXISTS ix_signals_hook_id_at ON signals (hook_id, at)',
  'CREATE INDEX IF NOT EXISTS ix_sponsored_ads_active ON sponsored_ads (active)',
  'CREATE INDEX IF NOT EXISTS ix_incidents_resolved_at ON incidents (resolved_at)',
  'CREATE INDEX IF NOT EXISTS ix_comms_webhook_events_at ON comms_webhook_events (at)',
  'CREATE INDEX IF NOT EXISTS ix_call_records_started_at ON call_records (started_at)',
  'CREATE INDEX IF NOT EXISTS ix_sms_messages_created_at ON sms_messages (created_at)',
  'CREATE INDEX IF NOT EXISTS ix_stripe_events_done_at ON stripe_events (done_at)',
  'CREATE INDEX IF NOT EXISTS ix_text_applications_updated_at ON text_applications (updated_at)',
  'CREATE INDEX IF NOT EXISTS ix_ai_chat_conversations_updated_at ON ai_chat_conversations (updated_at)',
  'CREATE INDEX IF NOT EXISTS ix_broker_events_event_id ON broker_events (event_id)',
  'CREATE INDEX IF NOT EXISTS ix_broker_accounts_status ON broker_accounts (status)',
  'CREATE INDEX IF NOT EXISTS ix_income_bots_last_run ON income_bots (last_run)',
];

// Migrations run on every start. Re-running one that is already applied ("duplicate column",
// "already exists") is expected and ignored; any other failure is logged and kept, and shows in
// GET /healthz/full, so a half-updated schema never goes unnoticed.
export const migrationProblems = [];
const alreadyApplied = e => /duplicate column name|already exists/i.test(String(e?.message || e));
export const ready = (async () => {
  // A local file: write-ahead log (readers never wait for the writer), wait up to 5 s for a lock
  // instead of failing, and fsync at checkpoints only (safe with WAL; a power cut loses at most the
  // last moments, never the file).
  if (url.startsWith('file:')) { for (const p of ['journal_mode = WAL', 'busy_timeout = 5000', 'synchronous = NORMAL', 'foreign_keys = ON']) await db.execute('PRAGMA ' + p); }
  await db.executeMultiple(SCHEMA);
  for (const m of MIGRATIONS) await db.execute(m).catch(e => {
    if (alreadyApplied(e)) return;
    migrationProblems.push({ migration: m.replace(/\s+/g, ' ').slice(0, 120), error: String(e?.message || e).slice(0, 200) });
    console.error('DATABASE MIGRATION FAILED:', m.replace(/\s+/g, ' ').slice(0, 120), '->', e?.message || e);
  });
  if (url.startsWith('file:') && isLeader()) await compactFile().catch(e => console.warn('compact:', e.message)); // one process tidies the file
})();
// Whole SEC company-facts documents (5-10 MB each) were cached under sec:facts: until 2026-11-23 and
// filled the file; they are trimmed now (sec:facts2:). The old ones are removed, and when most of the
// file is free space it is compacted once (VACUUM rewrites only the live data: a second or two).
async function compactFile() {
  await db.execute("DELETE FROM cache WHERE k LIKE 'sec:facts:%' OR k LIKE 'sec:subs2:%' OR (k LIKE 'sec:sub:%' AND length(v) > 200000)");
  const n = q => db.execute(q).then(r => Number(Object.values(r.rows[0])[0]));
  const pages = await n('PRAGMA page_count'), free = await n('PRAGMA freelist_count'), size = await n('PRAGMA page_size');
  if (free * size > 100 * 1048576 && free > pages / 2) {
    const t0 = Date.now(); await db.execute('VACUUM');
    console.log(`Database compacted: ${Math.round(pages * size / 1048576)} MB → ${Math.round((await n('PRAGMA page_count')) * size / 1048576)} MB in ${Date.now() - t0} ms`);
  }
}

// Every column the migrations add must exist afterwards (checked against the live database).
export async function schemaReport() {
  await ready;
  const want = {};
  for (const m of MIGRATIONS) { const x = /^\s*ALTER TABLE (\w+) ADD COLUMN (\w+)/i.exec(m); if (x) (want[x[1]] ||= []).push(x[2]); }
  const missing = [];
  for (const [table, cols] of Object.entries(want)) {
    const have = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map(r => r.name ?? r[1]));
    for (const c of cols) if (!have.has(c)) missing.push(`${table}.${c}`);
  }
  return { ok: !missing.length && !migrationProblems.length, missingColumns: missing, failedMigrations: migrationProblems.length, checkedColumns: Object.values(want).flat().length };
}

const plain = rs => rs.rows.map(r => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

// ---------- read statistics (DB_READ_STATS=1) ----------
// Rows read: every row a query scans, not just the rows it returns. With
// DB_READ_STATS=1 every query is counted by its normalized SQL: calls, rows returned, time, and an
// estimate of the rows it reads (from EXPLAIN QUERY PLAN, worked out once per statement: a full
// table scan reads the whole table, an index search about the rows it returns). Admin → GET
// /api/admin/dbstats shows the top 30. Off by default: nothing is measured or stored.
export const statsOn = () => process.env.DB_READ_STATS === '1';
const STATS = new Map(), PLANS = new Map(), SIZES = new Map();
let statsSince = Date.now();
export const normalizeSql = sql => String(sql).replace(/\s+/g, ' ').replace(/'(?:[^']|'')*'/g, '?').replace(/\b\d+(\.\d+)?\b/g, '?').replace(/\(\s*\?(\s*,\s*\?)+\s*\)/g, '(?…)').trim().slice(0, 240);
async function tableSize(t) {
  const c = SIZES.get(t);
  if (c && Date.now() - c.at < 60e3) return c.n;
  const n = Number((await db.execute(`SELECT COUNT(*) n FROM "${t.replace(/"/g, '')}"`).catch(() => ({ rows: [[0]] }))).rows[0][0]) || 0;
  SIZES.set(t, { n, at: Date.now() }); return n;
}
// The plan of a statement: the tables it scans in full (SCAN without an index) and the ones it searches.
async function planOf(sql, args) {
  if (PLANS.has(sql)) return PLANS.get(sql);
  let plan = { scans: [], searches: [] };
  if (/^\s*(SELECT|UPDATE|DELETE|INSERT|WITH)/i.test(sql)) {
    try {
      const r = await db.execute({ sql: 'EXPLAIN QUERY PLAN ' + sql, args });
      for (const row of r.rows) {
        const d = String(row.detail ?? row[3] ?? '');
        const m = /^(SCAN|SEARCH) (?:TABLE )?(\w+)/.exec(d); if (!m || /^sqlite_|^json_each/.test(m[2])) continue;
        if (m[1] === 'SCAN' && !/USING (COVERING )?INDEX|USING INTEGER PRIMARY KEY/.test(d)) plan.scans.push(m[2]); else plan.searches.push(m[2]);
      }
    } catch { plan = { scans: [], searches: [], unknown: true }; }
  }
  PLANS.set(sql, plan); return plan;
}
async function record(sql, args, rows, ms) {
  const k = normalizeSql(sql), plan = await planOf(sql, args);
  let read = Math.max(1, rows);
  for (const t of plan.scans) read += await tableSize(t);
  const x = STATS.get(k) || { sql: k, calls: 0, rows: 0, ms: 0, read: 0, scans: plan.scans };
  x.calls++; x.rows += rows; x.ms += ms; x.read += read; STATS.set(k, x);
}
// Top statements by estimated rows read, with calls and reads per minute since the counters started.
export function dbStats(limit = 30) {
  const minutes = Math.max(1 / 60, (Date.now() - statsSince) / 60e3), list = [...STATS.values()];
  const total = list.reduce((a, x) => ({ calls: a.calls + x.calls, read: a.read + x.read }), { calls: 0, read: 0 });
  return { on: statsOn(), minutes: +minutes.toFixed(2), callsPerMin: +(total.calls / minutes).toFixed(1), readsPerMin: +(total.read / minutes).toFixed(1), readsPerDay: Math.round(total.read / minutes * 1440),
    top: list.sort((a, b) => b.read - a.read).slice(0, limit).map(x => ({ sql: x.sql, calls: x.calls, callsPerMin: +(x.calls / minutes).toFixed(2), rows: x.rows, readEstimate: x.read, readsPerMin: +(x.read / minutes).toFixed(1), avgMs: +(x.ms / x.calls).toFixed(2), fullScans: x.scans })) };
}
export const resetDbStats = () => { STATS.clear(); statsSince = Date.now(); };
// The last time a statement worked and the last time one failed: /healthz reports these instead of
// asking the database itself (a health check that reads would spend reads, and restarting the
// server does not help when the database is the problem).
const lastDb = { okAt: null, errAt: null, error: null };
export const dbHealth = () => ({ ...lastDb, ok: lastDb.okAt != null && (lastDb.errAt == null || lastDb.okAt > lastDb.errAt) });
const seen = p => p.then(r => { lastDb.okAt = Date.now(); return r; }, e => { lastDb.errAt = Date.now(); lastDb.error = String(e?.message || e).slice(0, 160); throw e; });
const timed = async (sql, args, run0) => {
  const run = () => seen(run0());
  if (!statsOn()) return run();
  const t0 = performance.now(), r = await run();
  await record(sql, args, r.rows?.length ?? 0, performance.now() - t0).catch(() => {});
  return r;
};

const exec = async (sql, args) => { await ready; const a = args.map(x => (x === undefined ? null : x)); return timed(sql, a, () => db.execute({ sql, args: a })); };

export const one = async (sql, ...a) => plain(await exec(sql, a))[0];
export const all = async (sql, ...a) => plain(await exec(sql, a));
export const run = async (sql, ...a) => { const r = await exec(sql, a); wrote(sql, a); return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) }; };
// Every write tells the read caches (src/memo.js) which table changed and with which values, so a
// cached session, user, setting or credential never outlives a change, whoever made it.
const writeHooks = [];
export const onWrite = fn => { writeHooks.push(fn); };
const WRITE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?(\w+)/i;
function wrote(sql, args) {
  const m = WRITE.exec(sql); if (!m) return; const t = m[1].toLowerCase();
  for (const h of writeHooks) { try { h(t, args, false); } catch {} }
  // The other processes (src/bus.js) drop their cached rows too; only plain values travel.
  publish('write', { t, args: (args || []).filter(x => typeof x === 'number' || typeof x === 'string').slice(0, 40) });
}
on('write', ({ t, args }) => { for (const h of writeHooks) { try { h(t, args, true); } catch {} } });
export const now = () => Date.now();

export async function audit(userId, event, detail, ip) {
  await run('INSERT INTO audit_log (user_id, event, detail, ip, at) VALUES (?,?,?,?,?)', userId ?? null, event, detail ? JSON.stringify(detail) : null, ip ?? null, now());
}

// Runs fn inside a write transaction; fn receives one/all/run bound to it.
export async function tx(fn) {
  await ready;
  const t = await db.transaction('write');
  const q = async (sql, a) => { const args = a.map(x => (x === undefined ? null : x)); return timed(sql, args, () => t.execute({ sql, args })); };
  const h = {
    one: async (sql, ...a) => plain(await q(sql, a))[0],
    all: async (sql, ...a) => plain(await q(sql, a)),
    run: async (sql, ...a) => { const r = await q(sql, a); wrote(sql, a); return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) }; },
  };
  try { const r = await fn(h); await t.commit(); return r; } catch (e) { await t.rollback(); throw e; } finally { t.close(); }
}
