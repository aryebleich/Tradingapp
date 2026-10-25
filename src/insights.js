// Portfolio insights and the automatic trade journal: time-weighted return, P/L by symbol and by
// strategy (the source that opened the trade), round-trip statistics, execution quality
// (slippage and delay against the price an automation expected) and what-if scenarios.
import express from 'express';
import { one, all, run, now } from './db.js';
import { nyTime } from './time.js';
import { requireUser } from './auth.js';

// Matches sells against earlier buys (first in, first out) per account and symbol.
export function roundTrips(fills) {
  const lots = new Map(), trips = [];
  for (const f of [...fills].sort((a, b) => a.at - b.at || a.id - b.id)) {
    const k = f.account + '|' + f.symbol, q = lots.get(k) || lots.set(k, []).get(k);
    if (f.side === 'buy') { q.push({ qty: f.qty, price: f.price, at: f.at, source: f.source, id: f.id }); continue; }
    let left = f.qty;
    while (left > 1e-9 && q.length) {
      const lot = q[0], n = Math.min(left, lot.qty);
      trips.push({
        account: f.account, symbol: f.symbol, qty: +n.toFixed(6), entry: lot.price, exit: f.price, pnl: +((f.price - lot.price) * n).toFixed(2),
        pnlPct: +((f.price / lot.price - 1) * 100).toFixed(2), openedAt: lot.at, closedAt: f.at, holdDays: +((f.at - lot.at) / 864e5).toFixed(2),
        source: lot.source, exitSource: f.source, entryFill: lot.id, exitFill: f.id,
      });
      lot.qty -= n; left -= n;
      if (lot.qty <= 1e-9) q.shift();
    }
  }
  return trips;
}

const sum = a => a.reduce((x, y) => x + y, 0);
export function tripStats(trips) {
  const wins = trips.filter(t => t.pnl > 0), losses = trips.filter(t => t.pnl < 0);
  const gw = sum(wins.map(t => t.pnl)), gl = -sum(losses.map(t => t.pnl));
  const by = (key) => Object.values(trips.reduce((m, t) => { const k = key(t); (m[k] ||= { key: k, trades: 0, pnl: 0, wins: 0 }); m[k].trades++; m[k].pnl += t.pnl; if (t.pnl > 0) m[k].wins++; return m; }, {}))
    .map(x => ({ ...x, pnl: +x.pnl.toFixed(2), winRate: +(x.wins / x.trades * 100).toFixed(1) }));
  const day = t => nyTime(t).weekday;
  return {
    trades: trips.length, winRate: trips.length ? +(wins.length / trips.length * 100).toFixed(1) : null,
    avgWin: wins.length ? +(gw / wins.length).toFixed(2) : null, avgLoss: losses.length ? +(-gl / losses.length).toFixed(2) : null,
    profitFactor: gl > 0 ? +(gw / gl).toFixed(2) : null, expectancy: trips.length ? +((gw - gl) / trips.length).toFixed(2) : null,
    avgHoldDays: trips.length ? +(sum(trips.map(t => t.holdDays)) / trips.length).toFixed(1) : null,
    best: trips.reduce((b, t) => (!b || t.pnl > b.pnl ? t : b), null), worst: trips.reduce((b, t) => (!b || t.pnl < b.pnl ? t : b), null),
    byWeekday: by(t => day(t.closedAt)), byHour: by(t => String(Math.floor(nyTime(t.openedAt).minutes / 60)).padStart(2, '0') + ':00'),
  };
}

// Time-weighted return: daily returns with each day's deposits and withdrawals taken out, chained.
export function twr(history, flows) {
  const flowByDay = flows.reduce((m, f) => ((m[f.day] = (m[f.day] || 0) + f.amount), m), {});
  const series = [];
  let g = 1;
  for (let i = 0; i < history.length; i++) {
    if (i > 0 && history[i - 1].equity > 0) g *= (history[i].equity - (flowByDay[history[i].day] || 0)) / history[i - 1].equity;
    series.push({ day: history[i].day, twr: +((g - 1) * 100).toFixed(3) });
  }
  const days = history.length > 1 ? (Date.parse(history.at(-1).day) - Date.parse(history[0].day)) / 864e5 : 0;
  return { series, total: +((g - 1) * 100).toFixed(2), annualized: days >= 30 ? +((g ** (365 / days) - 1) * 100).toFixed(2) : null };
}

// Execution quality: what each automated fill paid against the price its signal expected
// (positive bps = worse than expected), and how long the order took.
export function execution(fills) {
  const rows = fills.filter(f => f.expected_price > 0).map(f => {
    const bps = (f.side === 'buy' ? f.price / f.expected_price - 1 : 1 - f.price / f.expected_price) * 1e4;
    return { symbol: f.symbol, side: f.side, source: f.source, expected: f.expected_price, price: f.price, slipBps: +bps.toFixed(1), slipUsd: +((f.side === 'buy' ? 1 : -1) * (f.price - f.expected_price) * f.qty).toFixed(2), delaySec: f.signal_at ? Math.max(0, Math.round((f.at - f.signal_at) / 1000)) : null, at: f.at };
  });
  const groups = Object.values(rows.reduce((m, r) => { const k = r.source.split(':')[0]; (m[k] ||= { source: k, fills: 0, slipBps: 0, slipUsd: 0, delay: [], }); m[k].fills++; m[k].slipBps += r.slipBps; m[k].slipUsd += r.slipUsd; if (r.delaySec != null) m[k].delay.push(r.delaySec); return m; }, {}))
    .map(g => ({ source: g.source, fills: g.fills, avgSlipBps: +(g.slipBps / g.fills).toFixed(1), costUsd: +g.slipUsd.toFixed(2), medianDelaySec: g.delay.length ? g.delay.sort((a, b) => a - b)[g.delay.length >> 1] : null }));
  return { bySource: groups, recent: rows.slice(-50).reverse() };
}

// What-if: P/L of today's holdings if every position moved by the same percentage.
export const whatIf = (positions, moves = [-30, -20, -10, -5, 0, 5, 10, 20, 30]) =>
  moves.map(m => ({ move: m, pnl: +sum(positions.map(p => p.value * m / 100)).toFixed(2) }));

export function insightsRouter({ summarize }) {
  const r = express.Router();
  r.use(requireUser);
  const acctOf = req => String(req.query.account || 'paper');
  r.get('/', async (req, res) => {
    const account = acctOf(req), uid = req.user.id;
    const fills = await all('SELECT * FROM fills WHERE user_id = ? AND account = ? ORDER BY at, id', uid, account);
    const trips = roundTrips(fills);
    const history = await all('SELECT day, equity FROM equity_history WHERE user_id = ? AND account = ? ORDER BY day', uid, account);
    const flows = (await all('SELECT amount, at FROM cashflows WHERE user_id = ? AND account = ?', uid, account)).map(f => ({ amount: f.amount, day: nyTime(f.at).day }));
    let summary = null; try { summary = await summarize(uid, account); } catch (e) { summary = { error: e.message, positions: [] }; }
    if (summary.equity && !history.find(h => h.day === nyTime().day)) history.push({ day: nyTime().day, equity: summary.equity });
    const bySymbol = {};
    for (const t of trips) (bySymbol[t.symbol] ||= { symbol: t.symbol, realized: 0, unrealized: 0, trades: 0 }), bySymbol[t.symbol].realized += t.pnl, bySymbol[t.symbol].trades++;
    for (const p of summary.positions || []) (bySymbol[p.symbol] ||= { symbol: p.symbol, realized: 0, unrealized: 0, trades: 0 }), bySymbol[p.symbol].unrealized += p.pnl || 0;
    const stats = tripStats(trips);
    res.json({
      account, equity: summary.equity ?? null, error: summary.error || null, twr: twr(history, flows),
      bySymbol: Object.values(bySymbol).map(x => ({ ...x, realized: +x.realized.toFixed(2), unrealized: +x.unrealized.toFixed(2), total: +(x.realized + x.unrealized).toFixed(2) })).sort((a, b) => b.total - a.total),
      bySource: Object.values(trips.reduce((m, t) => { const k = t.source.split(':')[0]; (m[k] ||= { source: k, trades: 0, pnl: 0, wins: 0 }); m[k].trades++; m[k].pnl += t.pnl; if (t.pnl > 0) m[k].wins++; return m; }, {})).map(x => ({ ...x, pnl: +x.pnl.toFixed(2), winRate: +(x.wins / x.trades * 100).toFixed(1) })),
      stats, execution: execution(fills), whatIf: whatIf(summary.positions || []),
    });
  });
  // The journal: every closed round trip with the user's notes and tags on its closing fill.
  r.get('/journal', async (req, res) => {
    const account = acctOf(req), uid = req.user.id;
    const fills = await all('SELECT * FROM fills WHERE user_id = ? AND account = ? ORDER BY at, id', uid, account);
    const notes = new Map((await all('SELECT fill_id, note, tags FROM journal_notes WHERE user_id = ?', uid)).map(n => [n.fill_id, n]));
    const trips = roundTrips(fills).reverse().slice(0, 300).map(t => ({ ...t, note: notes.get(t.exitFill)?.note || '', tags: notes.get(t.exitFill)?.tags || '' }));
    const open = fills.filter(f => f.side === 'buy').slice(-20).reverse().map(f => ({ ...f, note: notes.get(f.id)?.note || '', tags: notes.get(f.id)?.tags || '' }));
    res.json({ trips, recentBuys: open, stats: tripStats(roundTrips(fills)) });
  });
  r.put('/journal/:fillId', async (req, res) => {
    const f = await one('SELECT id FROM fills WHERE id = ? AND user_id = ?', +req.params.fillId, req.user.id);
    if (!f) throw Object.assign(new Error('No such trade'), { status: 404 });
    const note = String(req.body.note || '').slice(0, 2000), tags = String(req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 10).join(',');
    await run('INSERT INTO journal_notes (fill_id, user_id, note, tags, at) VALUES (?,?,?,?,?) ON CONFLICT(fill_id) DO UPDATE SET note = excluded.note, tags = excluded.tags, at = excluded.at', f.id, req.user.id, note, tags, now());
    res.json({ ok: true });
  });
  return r;
}
