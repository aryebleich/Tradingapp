// Admin → Analytics: the owner's view of the business in one place: overview, the website (visits,
// unique visitors, pages, where visitors come from), section usage inside the app, the phone line
// (calls), text messages, profit and loss (revenue, and how users' accounts did), and traffic.
// System health stays on its own tab (Admin → Analytics → System health).
//
// Counting is light and private: page views are added up in memory and written every 30 seconds;
// a visitor is counted once a day by a one-way hash of the address and browser with the day as
// salt, so no one can be followed from one day to the next. No cookies, no outside tracker.
import crypto from 'node:crypto';
import express from 'express';
import { all, one, run } from './db.js';

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const pending = new Map(); // `${day}|${kind}|${key}` -> n
const seen = new Map();    // `${day}|${hash}` -> 1 (flushed into traffic_visitors)
export function count(kind, key, n = 1) {
  const k = `${day()}|${kind}|${String(key).slice(0, 80)}`;
  pending.set(k, (pending.get(k) || 0) + n);
}
// A keyed hash (HMAC) with a server secret: without the secret nobody can turn a stored hash back
// into an address by trying every IP. The key comes from ENCRYPTION_KEY, or a random one per process.
const KEY = crypto.createHash('sha256').update('analytics|' + (process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'))).digest();
export const visitorHash = (d, kind, id) => crypto.createHmac('sha256', KEY).update(`${d}|${kind}|${id}`).digest('hex').slice(0, 20);
export function visitor(id, kind = 'web') {
  const d = day(), h = visitorHash(d, kind, id);
  seen.set(`${d}|${kind}|${h}`, 1);
}
export async function flush() {
  const p = [...pending.entries()], v = [...seen.keys()];
  pending.clear(); seen.clear();
  for (const [k, n] of p) { const [d, kind, key] = k.split('|'); await run('INSERT INTO traffic (day, kind, key, n) VALUES (?,?,?,?) ON CONFLICT(day, kind, key) DO UPDATE SET n = n + excluded.n', d, kind, key, n).catch(() => {}); }
  for (const k of v) { const [d, kind, h] = k.split('|'); await run('INSERT INTO traffic_visitors (day, kind, hash) VALUES (?,?,?) ON CONFLICT DO NOTHING', d, kind, h).catch(() => {}); }
  return p.length + v.length;
}
let timer = null;
export function start() { if (!timer) { timer = setInterval(() => flush().catch(() => {}), 30000); timer.unref?.(); } }

// Public pages: one view per page load; the visitor once a day; the site they came from.
const PUBLIC = new Set(['/', '/yi', '/terms', '/privacy', '/risk', '/security', '/contact', '/insurance', '/status', '/app']);
export function webMiddleware(req, res, next) {
  if (req.method === 'GET' && PUBLIC.has(req.path) && !/bot|crawl|spider|preview|monitor|uptime/i.test(req.get('user-agent') || '')) {
    count('web', req.path);
    visitor(`${req.ip}|${req.get('user-agent') || ''}`, 'web');
    const ref = req.get('referer');
    if (ref) { try { const h = new URL(ref).hostname.replace(/^www\./, ''); if (h && !h.includes(req.hostname)) count('ref', h); } catch {} }
  }
  next();
}

const r0 = x => Math.round(+x || 0), r2 = x => Math.round((+x || 0) * 100) / 100;
function series(rows, days) {
  const by = Object.fromEntries(rows.map(r => [r.day, r.n]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) { const d = day(Date.now() - i * 864e5); out.push({ day: d, n: by[d] || 0 }); }
  return out;
}
export async function report(days = 30) {
  await flush();
  const since = day(Date.now() - (days - 1) * 864e5), sinceMs = Date.parse(since + 'T00:00:00Z');
  const q = (sql, ...a) => all(sql, ...a).catch(() => []);
  const one_ = (sql, ...a) => one(sql, ...a).catch(() => null);
  // Overview
  const users = (await one_('SELECT COUNT(*) n FROM users'))?.n || 0;
  const newUsers = (await one_('SELECT COUNT(*) n FROM users WHERE created_at >= ?', sinceMs))?.n || 0;
  const paying = (await one_("SELECT COUNT(*) n FROM users WHERE plan IS NOT NULL AND plan != 'free' AND (plan_status IS NULL OR plan_status IN ('active','trialing'))"))?.n || 0;
  const { revenueSummary } = await import('./fees.js');
  const rev = await revenueSummary().catch(() => ({ mrr: 0, byKind: [] }));
  const activeToday = (await one_("SELECT COUNT(*) n FROM traffic_visitors WHERE day = ? AND kind = 'app'", day()))?.n || 0;
  const activeRange = (await one_("SELECT COUNT(DISTINCT hash) n FROM traffic_visitors WHERE day >= ? AND kind = 'app'", since))?.n || 0;
  const signups = series(await q("SELECT substr(datetime(created_at / 1000, 'unixepoch'), 1, 10) day, COUNT(*) n FROM users WHERE created_at >= ? GROUP BY day", sinceMs), days);
  // Website
  const webDays = series(await q("SELECT day, SUM(n) n FROM traffic WHERE kind = 'web' AND day >= ? GROUP BY day", since), days);
  const uniqDays = series(await q("SELECT day, COUNT(*) n FROM traffic_visitors WHERE kind = 'web' AND day >= ? GROUP BY day", since), days);
  const pages = await q("SELECT key, SUM(n) n FROM traffic WHERE kind = 'web' AND day >= ? GROUP BY key ORDER BY n DESC LIMIT 12", since);
  const referrers = await q("SELECT key, SUM(n) n FROM traffic WHERE kind = 'ref' AND day >= ? GROUP BY key ORDER BY n DESC LIMIT 12", since);
  // Sections of the app
  const sections = await q("SELECT key, SUM(n) n FROM traffic WHERE kind = 'page' AND day >= ? GROUP BY key ORDER BY n DESC LIMIT 40", since);
  const appDays = series(await q("SELECT day, SUM(n) n FROM traffic WHERE kind = 'page' AND day >= ? GROUP BY day", since), days);
  // Phone line and texts (src/comms.js keeps every call and message)
  const comms = await q('SELECT channel, direction, COUNT(*) n, SUM(COALESCE(duration, 0)) secs FROM comms WHERE at >= ? GROUP BY channel, direction', sinceMs);
  const callDays = series(await q("SELECT substr(datetime(at / 1000, 'unixepoch'), 1, 10) day, COUNT(*) n FROM comms WHERE channel IN ('voice', 'call') AND at >= ? GROUP BY day", sinceMs), days);
  const smsDays = series(await q("SELECT substr(datetime(at / 1000, 'unixepoch'), 1, 10) day, COUNT(*) n FROM comms WHERE channel = 'sms' AND at >= ? GROUP BY day", sinceMs), days);
  const hotline = await q("SELECT event, COUNT(*) n FROM audit_log WHERE event LIKE 'hotline%' AND at >= ? GROUP BY event ORDER BY n DESC", sinceMs);
  const smsEvents = await q("SELECT event, COUNT(*) n FROM audit_log WHERE (event LIKE 'sms%' OR event LIKE 'text%') AND at >= ? GROUP BY event ORDER BY n DESC", sinceMs);
  const c = (ch, dir) => comms.filter(x => (Array.isArray(ch) ? ch.includes(x.channel) : x.channel === ch) && (!dir || x.direction === dir)).reduce((a, x) => a + x.n, 0);
  // Profit and loss: the business (revenue) and the users' accounts (equity at the start and end of the range).
  const ledger = await q("SELECT kind, status, ROUND(SUM(amount), 2) total, COUNT(*) n FROM ledger WHERE at >= ? GROUP BY kind, status", sinceMs);
  const credits = await one_("SELECT COUNT(*) n, SUM(delta) credits FROM credit_ledger WHERE kind = 'purchase' AND at >= ?", sinceMs);
  const userPnl = { paper: null, live: null };
  for (const row of await q(`SELECT CASE WHEN account = 'paper' THEN 'paper' ELSE 'live' END grp, SUM(CASE WHEN rn_first = 1 THEN equity ELSE 0 END) start, SUM(CASE WHEN rn_last = 1 THEN equity ELSE 0 END) end_ FROM (
      SELECT user_id, account, equity, ROW_NUMBER() OVER (PARTITION BY user_id, account ORDER BY day) rn_first, ROW_NUMBER() OVER (PARTITION BY user_id, account ORDER BY day DESC) rn_last FROM equity_history WHERE day >= ?) GROUP BY grp`, since)) {
    userPnl[row.grp] = { start: r2(row.start), end: r2(row.end_), pnl: r2(row.end_ - row.start), pct: row.start ? r2((row.end_ / row.start - 1) * 100) : null };
  }
  return {
    days, since,
    overview: { users, newUsers, paying, mrr: r2(rev.mrr), activeToday, activeRange, webVisits: webDays.reduce((a, x) => a + x.n, 0), uniqueVisitors: uniqDays.reduce((a, x) => a + x.n, 0), calls: c(['voice', 'call']), texts: c('sms'), signups },
    web: { visits: webDays, unique: uniqDays, pages, referrers },
    sections: { views: appDays, top: sections },
    voice: { inbound: c(['voice', 'call'], 'in'), outbound: c(['voice', 'call'], 'out'), minutes: r0(comms.filter(x => ['voice', 'call'].includes(x.channel)).reduce((a, x) => a + (x.secs || 0), 0) / 60), days: callDays, events: hotline },
    sms: { inbound: c('sms', 'in'), outbound: c('sms', 'out'), days: smsDays, events: smsEvents },
    pnl: { mrr: r2(rev.mrr), ledger, creditPacks: { n: credits?.n || 0, credits: credits?.credits || 0 }, users: userPnl },
  };
}

export const analyticsRouter = (() => {
  const r = express.Router();
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);
  // A page of the app was opened (signed-in users only; the route name, nothing else).
  r.post('/track', (req, res) => {
    const route = String(req.body?.route || '').toLowerCase();
    if (req.user && /^[a-z0-9-]{1,40}$/.test(route)) { count('page', route); visitor(`u${req.user.id}`, 'app'); }
    res.status(204).end();
  });
  r.get('/admin', wrap(async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    res.json(await report(Math.min(365, Math.max(7, +req.query.days || 30))));
  }));
  return r;
})();
