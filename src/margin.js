// Margin and liquidity watch. Brokers pass clearinghouse margin requirements on to accounts as
// their maintenance and initial margin, so this tracks those numbers daily for each Alpaca account,
// stress-tests them and estimates how many days of the current trend are left before a margin
// call. An optional MARGIN_FEED_URL (JSON {"SYMBOL": requirementPct}) from a data vendor adds
// per-symbol requirements, e.g. raised requirements on volatile names announced in advance.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { tradingFor } from './alpaca/connections.js';
import { nyTime } from './time.js';

let feed = { at: 0, data: {} };
async function marginFeed() {
  const url = process.env.MARGIN_FEED_URL; if (!url) return {};
  if (Date.now() - feed.at < 3600e3) return feed.data;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (r.ok) feed = { at: Date.now(), data: await r.json() }; } catch {}
  return feed.data;
}

export async function accountMargin(userId) {
  const t = await tradingFor(userId); if (!t) return null;
  const a = await t.account(), pos = await t.positions().catch(() => []);
  const equity = +a.equity, maint = +a.maintenance_margin || 0, init = +a.initial_margin || 0, bp = +a.buying_power || 0;
  const gross = pos.reduce((x, p) => x + Math.abs(+p.market_value || 0), 0);
  return { equity, maintenance: maint, initial: init, buyingPower: bp, multiplier: +a.multiplier || 1, leverage: equity > 0 ? +(gross / equity).toFixed(2) : 0, gross, positions: pos.map(p => ({ symbol: p.symbol, value: +p.market_value, qty: +p.qty })) };
}

export async function snapshotMargins() {
  const users = await all("SELECT DISTINCT user_id FROM credentials WHERE provider LIKE 'alpaca%' UNION SELECT user_id FROM broker_accounts");
  let n = 0;
  for (const { user_id } of users) {
    try {
      const m = await accountMargin(user_id); if (!m) continue;
      await run('INSERT INTO margin_snapshots (user_id, account, day, equity, buying_power, maintenance, initial, leverage) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET equity = excluded.equity, buying_power = excluded.buying_power, maintenance = excluded.maintenance, initial = excluded.initial, leverage = excluded.leverage',
        user_id, 'alpaca', nyTime().day, m.equity, m.buyingPower, m.maintenance, m.initial, m.leverage);
      n++;
    } catch {}
  }
  return n;
}

// Days until equity meets the maintenance requirement if the recent daily trend of
// (equity - maintenance) continues; null when the cushion is not shrinking.
export function forecast(history, current) {
  const pts = [...history.map(h => h.equity - h.maintenance), current.equity - current.maintenance];
  if (pts.length < 3) return { daysToCall: null, trendPerDay: null };
  const n = pts.length, xs = pts.map((_, i) => i), mx = (n - 1) / 2, my = pts.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (pts[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const cushion = pts.at(-1);
  return { trendPerDay: +slope.toFixed(2), daysToCall: slope < 0 && cushion > 0 ? Math.floor(cushion / -slope) : cushion <= 0 ? 0 : null };
}
// How far the market can fall before a margin call, and the shortfall in a few shocks.
export function stress(m, requirements = {}) {
  const extra = m.positions.reduce((a, p) => a + Math.abs(p.value) * Math.max(0, (+requirements[p.symbol] || 0) / 100 - (m.maintenance && m.gross ? m.maintenance / m.gross : 0.25)), 0);
  const maint = m.maintenance + extra, maintRate = m.gross ? maint / m.gross : 0.25;
  const shocks = [-5, -10, -20, -30].map(s => {
    const gross = m.gross * (1 + s / 100), eq = m.equity + m.gross * s / 100, req = gross * maintRate;
    return { shock: s, equity: +eq.toFixed(2), requirement: +req.toFixed(2), call: eq < req, shortfall: +Math.max(0, req - eq).toFixed(2) };
  });
  // Drop d where equity + gross*d = (gross*(1+d)) * rate  =>  d = (gross*rate - equity) / (gross*(1 - rate))
  const drop = m.gross > 0 && maintRate < 1 ? (m.gross * maintRate - m.equity) / (m.gross * (1 - maintRate)) : null;
  return { maintenanceWithFeed: +maint.toFixed(2), dropToCallPct: drop == null ? null : +Math.min(100, Math.max(0, -drop * 100)).toFixed(1), shocks };
}

export const marginRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    let m; try { m = await accountMargin(req.user.id); } catch (e) { return res.json({ connected: true, error: e.message }); }
    if (!m) return res.json({ connected: false });
    const hist = await all("SELECT day, equity, maintenance, buying_power, leverage FROM margin_snapshots WHERE user_id = ? AND account = 'alpaca' ORDER BY day DESC LIMIT 30", req.user.id);
    const feedData = await marginFeed();
    res.json({ connected: true, ...m, history: hist.reverse(), forecast: forecast(hist, m), stress: stress(m, feedData), feed: !!process.env.MARGIN_FEED_URL, updatedAt: now() });
  });
  return r;
})();
