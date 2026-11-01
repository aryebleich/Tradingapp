// The search box (Ctrl+K): stocks, ETFs, mutual funds and futures by ticker or name, and the
// user's own things (strategies, bots, scanners, portfolios, scripts, rules, journal notes,
// private investments and properties). The app's pages are matched in the browser. Admin pages,
// the homepage and the owner's private README are never searched.
import express from 'express';
import { all } from './db.js';
import { requireUser } from './auth.js';

const like = q => `%${q.replace(/[%_]/g, '')}%`;
export async function searchAll(user, qRaw) {
  const q = String(qRaw || '').trim().slice(0, 60), Q = q.toUpperCase();
  if (q.length < 1) return { symbols: [], mine: [] };
  const F = await import('./fundamentals.js'), I = await import('./instruments.js');
  const symbols = [];
  const add = (symbol, name, kind, url) => { if (!symbols.some(s => s.symbol === symbol)) symbols.push({ symbol, name, kind, url }); };
  if (/^[A-Z0-9.=\-]{1,10}$/i.test(q)) {
    if (F.ETFS[Q]) add(Q, F.ETFS[Q][0], 'ETF', `#/trade?symbol=${Q}`);
    if (I.MUTUAL_FUNDS[Q]) add(Q, I.MUTUAL_FUNDS[Q][0], 'Mutual fund', '#/invest?tab=funds');
    if (I.FUTURES[Q]) add(Q, I.FUTURES[Q][0], 'Futures', '#/invest?tab=futures');
  }
  const map = await F.tickerCiks().catch(() => ({}));
  const exact = map[Q]; if (exact) add(Q, exact.name, 'Stock', `#/trade?symbol=${Q}`);
  for (const [k, v] of Object.entries(F.ETFS)) if (symbols.length < 12 && (k.startsWith(Q) || v[0].toUpperCase().includes(Q))) add(k, v[0], 'ETF', `#/trade?symbol=${k}`);
  for (const [k, v] of Object.entries(I.MUTUAL_FUNDS)) if (symbols.length < 12 && (k.startsWith(Q) || v[0].toUpperCase().includes(Q))) add(k, v[0], 'Mutual fund', '#/invest?tab=funds');
  for (const [k, v] of Object.entries(I.FUTURES)) if (symbols.length < 12 && q.length > 2 && v[0].toUpperCase().includes(Q)) add(k, v[0], 'Futures', '#/invest?tab=futures');
  if (q.length >= 2) for (const [t, v] of Object.entries(map)) { if (symbols.length >= 12) break; if (t.startsWith(Q) || (q.length >= 3 && v.name.toUpperCase().includes(Q))) add(t, v.name, 'Stock', `#/trade?symbol=${encodeURIComponent(t)}`); }
  const mine = [], uid = user.id, L = like(q);
  const pick = async (sql, kind, url) => { for (const r of await all(sql, uid, L).catch(() => [])) mine.push({ kind, title: r.t, url: url(r) }); };
  await pick('SELECT id, name t FROM user_strategies WHERE user_id = ? AND name LIKE ? LIMIT 5', 'My strategy', () => '#/strategies');
  await pick('SELECT id, name t FROM strategies WHERE user_id = ? AND (name LIKE ? ) LIMIT 5', 'Bot', () => '#/bots');
  await pick('SELECT id, name t FROM scanners WHERE user_id = ? AND name LIKE ? LIMIT 5', 'Scanner', () => '#/scanner');
  await pick('SELECT id, name t FROM baskets WHERE user_id = ? AND name LIKE ? LIMIT 5', 'Portfolio', () => '#/portfolios?tab=mine');
  await pick('SELECT id, name t FROM code_scripts WHERE user_id = ? AND name LIKE ? LIMIT 5', 'Script', () => '#/code');
  await pick('SELECT id, name t FROM rules WHERE user_id = ? AND name LIKE ? LIMIT 5', 'Rule', r => `#/rules?edit=${r.id}`);
  await pick("SELECT id, name t, kind FROM alt_assets WHERE user_id = ? AND name LIKE ? LIMIT 5", 'Private investment or property', () => '#/private');
  await pick('SELECT id, substr(note, 1, 80) t FROM journal_notes WHERE user_id = ? AND note LIKE ? LIMIT 5', 'Journal note', () => '#/insights?tab=journal');
  await pick('SELECT id, recipient t FROM tzedakah WHERE user_id = ? AND recipient LIKE ? GROUP BY recipient LIMIT 3', 'Tzedakah', () => '#/luach?tab=tzedakah');
  return { symbols: symbols.slice(0, 12), mine: mine.slice(0, 15) };
}
export const searchRouter = express.Router();
searchRouter.get('/', requireUser, async (req, res) => res.json(await searchAll(req.user, req.query.q)));
