// Shariah screening and zakat. A stock is screened, in order, by: the compliance data feed the
// owner loads (ratios and status from a screening provider, CSV upload or HALAL_FEED_URL), the
// list of Shariah-certified funds, and a business-activity screen for well-known non-compliant
// industries. Anything else is reported as "not screened" rather than guessed. Ratio thresholds
// follow AAOIFI: interest-bearing debt and cash/securities each under 30% of market value,
// receivables under 49%, non-compliant income under 5%.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, requireAdmin } from './auth.js';
import { accountSummary, lastPrice, ACCOUNT_IDS } from './brokers.js';

export const THRESHOLDS = { debt: 30, cash: 30, receivables: 49, nonhalal: 5 };
export const HALAL_FUNDS = {
  SPUS: 'SP Funds S&P 500 Sharia Industry Exclusions ETF', HLAL: 'Wahed FTSE USA Shariah ETF', UMMA: 'Wahed Dow Jones Islamic World ETF',
  SPSK: 'SP Funds Dow Jones Global Sukuk ETF', SPRE: 'SP Funds S&P Global REIT Sharia ETF', SPTE: 'SP Funds S&P Global Technology ETF', SPWO: 'SP Funds S&P World (ex-US) ETF',
};
const BUSINESS = {
  'conventional banking and lending': 'JPM BAC WFC C GS MS USB PNC TFC COF AXP SCHW BK STT ALLY SYF DFS CFG FITB KEY RF HBAN MTB SOFI UPST',
  'conventional insurance': 'AIG MET PRU ALL PGR TRV CB AFL HIG BRK.A BRK.B LNC PFG MKL CINF',
  'alcohol': 'BUD STZ DEO TAP BF.B SAM',
  'tobacco': 'MO PM BTI',
  'gambling': 'LVS WYNN MGM CZR DKNG PENN RSI',
  'pork products': 'HRL',
  'cannabis': 'TLRY CGC ACB',
  'interest-based mortgage finance': 'AGNC NLY STWD RITM',
};
const BIZ = new Map(Object.entries(BUSINESS).flatMap(([why, s]) => s.split(' ').map(t => [t, why])));
const pct = v => (v == null || v === '' ? null : +v);

export function screen(symbol, feedRow) {
  const s = String(symbol).toUpperCase();
  if (feedRow) {
    const r = { debt: pct(feedRow.debt_ratio), cash: pct(feedRow.cash_ratio), receivables: pct(feedRow.receivables_ratio), nonhalal: pct(feedRow.nonhalal_pct) };
    const fails = Object.entries(THRESHOLDS).filter(([k, max]) => r[k] != null && r[k] >= max).map(([k, max]) => `${k} ${r[k]}% (limit ${max}%)`);
    const status = ['compliant', 'not_compliant', 'questionable'].includes(feedRow.status) ? feedRow.status : fails.length ? 'not_compliant' : Object.values(r).some(v => v != null) ? 'compliant' : 'unknown';
    return { symbol: s, status, basis: 'data feed', ratios: r, reasons: fails, source: feedRow.source || null, asOf: feedRow.as_of || null, nonhalalPct: r.nonhalal };
  }
  if (HALAL_FUNDS[s]) return { symbol: s, status: 'compliant', basis: 'Shariah-certified fund', reasons: [HALAL_FUNDS[s]] };
  if (BIZ.has(s)) return { symbol: s, status: 'not_compliant', basis: 'business activity', reasons: [BIZ.get(s)] };
  return { symbol: s, status: 'unknown', basis: 'not screened', reasons: ['No compliance data for this symbol yet'] };
}
export async function screenMany(symbols) {
  const list = [...new Set(symbols.map(s => String(s).toUpperCase()))];
  const rows = list.length ? await all(`SELECT * FROM halal_data WHERE symbol IN (${list.map(() => '?').join(',')})`, ...list) : [];
  const feed = new Map(rows.map(r => [r.symbol, r]));
  return list.map(s => screen(s, feed.get(s)));
}

// CSV: symbol,status,debt_ratio,cash_ratio,receivables_ratio,nonhalal_pct,source,as_of (header row optional).
export async function importFeed(csv, source = 'upload') {
  let n = 0;
  for (const line of String(csv).split(/\r?\n/)) {
    const c = line.split(',').map(x => x.trim()); if (!c[0] || /^symbol$/i.test(c[0])) continue;
    const sym = c[0].toUpperCase(); if (!/^[A-Z0-9.\-]{1,10}$/.test(sym)) continue;
    const status = ({ halal: 'compliant', compliant: 'compliant', pass: 'compliant', haram: 'not_compliant', 'not compliant': 'not_compliant', not_compliant: 'not_compliant', fail: 'not_compliant', doubtful: 'questionable', questionable: 'questionable' })[String(c[1] || '').toLowerCase()] || '';
    await run(`INSERT INTO halal_data (symbol, status, debt_ratio, cash_ratio, receivables_ratio, nonhalal_pct, source, as_of, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(symbol) DO UPDATE SET status = excluded.status, debt_ratio = excluded.debt_ratio, cash_ratio = excluded.cash_ratio, receivables_ratio = excluded.receivables_ratio, nonhalal_pct = excluded.nonhalal_pct, source = excluded.source, as_of = excluded.as_of, updated_at = excluded.updated_at`,
      sym, status, pct(c[2]), pct(c[3]), pct(c[4]), pct(c[5]), c[6] || source, c[7] || null, now());
    n++;
  }
  return n;
}
// A provider's CSV export at HALAL_FEED_URL is pulled once a day.
export async function refreshFeed() {
  const url = process.env.HALAL_FEED_URL; if (!url) return 0;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: process.env.HALAL_FEED_TOKEN ? { Authorization: 'Bearer ' + process.env.HALAL_FEED_TOKEN } : {} });
  if (!r.ok) throw new Error('halal feed ' + r.status);
  return importFeed(await r.text(), new URL(url).hostname);
}

// Zakat: 2.5% of zakatable wealth when it is at or above the nisab (85 g of gold or 595 g of silver).
export function zakat({ cash = 0, holdings = 0, holdingsMethod = 'market', zakatablePct = 30, gold = 0, silver = 0, receivables = 0, debts = 0, goldPerGram, silverPerGram, nisab = 'gold' }) {
  const g = +goldPerGram || 0, sv = +silverPerGram || 0;
  const stocks = holdingsMethod === 'longterm' ? +holdings * Math.max(0, Math.min(100, +zakatablePct)) / 100 : +holdings;
  const wealth = +cash + stocks + +gold * g + +silver * sv + +receivables - +debts;
  const threshold = nisab === 'silver' ? 595 * sv : 85 * g;
  const due = threshold > 0 && wealth >= threshold;
  return { stocksCounted: +stocks.toFixed(2), wealth: +wealth.toFixed(2), nisab: +threshold.toFixed(2), nisabBasis: nisab, due, zakat: due ? +(wealth * 0.025).toFixed(2) : 0 };
}

export const halalRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/screen', async (req, res) => res.json({ thresholds: THRESHOLDS, results: await screenMany(String(req.query.symbols || '').split(/[\s,]+/).filter(Boolean).slice(0, 100)) }));
  r.get('/funds', (req, res) => res.json(HALAL_FUNDS));
  // Every holding of an account with its status, the compliant share of the portfolio and the
  // purification estimate on dividends the user enters.
  r.get('/portfolio', async (req, res) => {
    const account = ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper';
    const s = await accountSummary(req.user.id, account), res_ = await screenMany(s.positions.map(p => p.symbol));
    const total = s.positions.reduce((a, p) => a + p.value, 0) || 1;
    const rows = s.positions.map(p => ({ ...res_.find(x => x.symbol === p.symbol), value: p.value, weight: +(p.value / total * 100).toFixed(1) }));
    const share = st => +rows.filter(x => x.status === st).reduce((a, x) => a + x.weight, 0).toFixed(1);
    res.json({ account, holdings: rows, compliantPct: share('compliant'), notCompliantPct: share('not_compliant'), questionablePct: share('questionable'), unknownPct: share('unknown'), equity: s.equity, cash: s.cash });
  });
  r.post('/zakat', async (req, res) => {
    const b = req.body || {};
    let holdings = +b.holdings || 0, cash = +b.cash || 0;
    if (b.includeAccounts) for (const a of (Array.isArray(b.includeAccounts) ? b.includeAccounts : [b.includeAccounts]).filter(x => ACCOUNT_IDS.includes(x))) {
      try { const s = await accountSummary(req.user.id, a); holdings += s.positions.reduce((x, p) => x + p.value, 0); cash += s.cash; } catch {}
    }
    // A rough default from the gold ETF (about 0.09 troy oz of gold per GLD share); users should enter today's price.
    let goldPerGram = +b.goldPerGram, estimated = false;
    if (!(goldPerGram > 0)) { const gld = await lastPrice('GLD', req.user.id).catch(() => null); if (gld) { goldPerGram = +(gld / 0.0905 / 31.1035).toFixed(2); estimated = true; } }
    res.json({ ...zakat({ ...b, cash, holdings, goldPerGram }), goldPerGram, goldPriceEstimated: estimated, cash: +cash.toFixed(2), holdings: +holdings.toFixed(2) });
  });
  r.get('/feed', requireAdmin, async (req, res) => res.json({ count: (await one('SELECT COUNT(*) n FROM halal_data')).n, url: process.env.HALAL_FEED_URL || null, latest: await all('SELECT * FROM halal_data ORDER BY updated_at DESC LIMIT 20') }));
  r.post('/feed', requireAdmin, async (req, res) => { const n = await importFeed(req.body.csv || ''); await audit(req.user.id, 'halal_feed_import', { rows: n }, req.ip); res.json({ imported: n }); });
  return r;
})();
