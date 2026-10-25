// Storage via libSQL: a local SQLite file by default, or a free hosted Turso database when
// DATABASE_URL (libsql://...) and DATABASE_AUTH_TOKEN are set.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL || 'file:' + (process.env.DB_FILE || path.resolve('data/quantpocket.db'));
if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
if (url.startsWith('file:') && process.env.RENDER) console.warn('WARNING: using a local SQLite file on Render. Free instances lose files on restart; set DATABASE_URL to a Turso database.');
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
-- Shariah screening data (from the owner's compliance feed).
CREATE TABLE IF NOT EXISTS halal_data (
  symbol TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  debt_ratio REAL, cash_ratio REAL, receivables_ratio REAL, nonhalal_pct REAL,
  source TEXT,
  as_of TEXT,
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
`;

// Columns added after the first release; ALTER fails harmlessly when they already exist.
const MIGRATIONS = [
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
  'ALTER TABLE users ADD COLUMN referral_rewarded INTEGER NOT NULL DEFAULT 0',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_ref_code ON users (ref_code) WHERE ref_code IS NOT NULL',
  'ALTER TABLE users ADD COLUMN google_sub TEXT',
  'ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1',
  'CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS signals_user ON signals (user_id, id)',
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
];

export const ready = (async () => {
  if (url.startsWith('file:')) { await db.execute('PRAGMA journal_mode = WAL'); await db.execute('PRAGMA foreign_keys = ON'); }
  await db.executeMultiple(SCHEMA);
  for (const m of MIGRATIONS) await db.execute(m).catch(() => {});
})();

const plain = rs => rs.rows.map(r => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
const exec = async (sql, args) => { await ready; return db.execute({ sql, args: args.map(a => (a === undefined ? null : a)) }); };

export const one = async (sql, ...a) => plain(await exec(sql, a))[0];
export const all = async (sql, ...a) => plain(await exec(sql, a));
export const run = async (sql, ...a) => { const r = await exec(sql, a); return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) }; };
export const now = () => Date.now();

export async function audit(userId, event, detail, ip) {
  await run('INSERT INTO audit_log (user_id, event, detail, ip, at) VALUES (?,?,?,?,?)', userId ?? null, event, detail ? JSON.stringify(detail) : null, ip ?? null, now());
}

// Runs fn inside a write transaction; fn receives one/all/run bound to it.
export async function tx(fn) {
  await ready;
  const t = await db.transaction('write');
  const q = async (sql, a) => t.execute({ sql, args: a.map(x => (x === undefined ? null : x)) });
  const h = {
    one: async (sql, ...a) => plain(await q(sql, a))[0],
    all: async (sql, ...a) => plain(await q(sql, a)),
    run: async (sql, ...a) => { const r = await q(sql, a); return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) }; },
  };
  try { const r = await fn(h); await t.commit(); return r; } catch (e) { await t.rollback(); throw e; } finally { t.close(); }
}
