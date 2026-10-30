// Values investing: screen stocks and portfolios against what the user prefers to avoid, with
// presets (Jewish values, general ethical, or custom), a maaser calculator, and an option to
// pause all trading on Shabbos and Yom Tov (src/zmanim.js). Screens use known lists of companies
// by business; anything not on a list is reported as "no flags found", never as approved.
import express from 'express';
import { audit, one } from './db.js';
import { requireUser, requireAdmin } from './auth.js';
import { accountSummary, ACCOUNT_IDS } from './brokers.js';
import { getSetting, setSetting } from './settings.js';
import { siteGet, siteSet } from './site.js';
import { CITIES, shabbosAt, upcoming } from './zmanim.js';

// Companies whose main business is in each category (well-known US listings).
export const CATEGORIES = {
  gambling: { label: 'Gambling and casinos', tickers: 'LVS WYNN MGM CZR DKNG PENN RSI BYD CHDN IGT' },
  nonkosher: { label: 'Pork and shellfish producers', tickers: 'HRL WH SFD' },
  alcohol: { label: 'Alcohol', tickers: 'BUD STZ DEO TAP BF.B SAM' },
  tobacco: { label: 'Tobacco and vaping', tickers: 'MO PM BTI TPB' },
  weapons: { label: 'Weapons and defense', tickers: 'LMT RTX NOC GD LHX HII SWBI RGR AXON' },
  cannabis: { label: 'Cannabis', tickers: 'TLRY CGC ACB CRON SNDL' },
  adult: { label: 'Adult entertainment', tickers: 'RICK' },
  fossil: { label: 'Oil, gas and coal', tickers: 'XOM CVX COP OXY EOG SLB PSX MPC VLO HAL DVN BTU ARCH' },
  predatory: { label: 'Payday and high-interest lending', tickers: 'ENVA CURO OMF WRLD' },
};
export const PRESETS = {
  jewish: { label: 'Jewish values', avoid: ['gambling', 'nonkosher', 'adult', 'predatory'], about: 'Avoids gambling, pork and shellfish producers, adult entertainment and high-interest lending. Adds the maaser calculator and an option to pause trading on Shabbos and Yom Tov.' },
  ethical: { label: 'General ethical', avoid: ['gambling', 'tobacco', 'weapons', 'adult', 'predatory', 'fossil'], about: 'Avoids gambling, tobacco, weapons, adult entertainment, high-interest lending and fossil fuels.' },
  custom: { label: 'Custom', avoid: [], about: 'Pick exactly what to avoid.' },
};
const DEFAULTS = { preset: 'jewish', avoid: PRESETS.jewish.avoid, shabbos: false, city: 'brooklyn', maaserPct: 10 };
export async function valuesFor(userId) {
  const v = await getSetting(userId, 'values', null) || {};
  const preset = PRESETS[v.preset] ? v.preset : DEFAULTS.preset;
  return {
    preset, avoid: preset === 'custom' ? (v.avoid || []).filter(k => CATEGORIES[k]) : PRESETS[preset].avoid,
    shabbos: !!v.shabbos, city: CITIES[v.city] ? v.city : DEFAULTS.city, maaserPct: [10, 20].includes(+v.maaserPct) ? +v.maaserPct : 10,
  };
}

// The owner can add tickers to a category (Admin, CSV "symbol,category").
const lists = () => {
  const extra = siteGet('valuesExtra', {}) || {}, m = new Map();
  for (const [k, c] of Object.entries(CATEGORIES)) for (const t of [...c.tickers.split(' '), ...(extra[k] || [])]) m.set(t, [...(m.get(t) || []), k]);
  return m;
};
export function screen(symbols, avoid) {
  const m = lists();
  return [...new Set(symbols.map(s => String(s).toUpperCase()))].map(symbol => {
    const cats = (m.get(symbol) || []).filter(k => avoid.includes(k));
    return { symbol, status: cats.length ? 'avoid' : 'clear', reasons: cats.map(k => CATEGORIES[k].label) };
  });
}

// Maaser: a tenth (or a fifth, chomesh) of the year's investment profit: realized gains plus
// dividends and interest, less losses. Other income can be added.
export function maaser({ gains = 0, dividends = 0, interest = 0, otherIncome = 0, alreadyGiven = 0, pct = 10 }) {
  const profit = +gains + +dividends + +interest + +otherIncome;
  const owed = Math.max(0, profit) * (+pct / 100);
  return { profit: +profit.toFixed(2), pct: +pct, maaser: +owed.toFixed(2), given: +(+alreadyGiven).toFixed(2), remaining: +Math.max(0, owed - alreadyGiven).toFixed(2) };
}

// For brokers.placeOrder: trading pauses on Shabbos and Yom Tov for users who turned it on.
export async function shabbosBlock(userId, t = Date.now()) {
  const v = await getSetting(userId, 'values', null);
  if (!v?.shabbos) return null;
  return shabbosAt(t, CITIES[v.city] ? v.city : 'brooklyn');
}

export const valuesRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const v = await valuesFor(req.user.id);
    res.json({ ...v, presets: PRESETS, categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.label])), cities: Object.fromEntries(Object.entries(CITIES).map(([k, c]) => [k, c.name])), tz: CITIES[v.city].tz, now: shabbosAt(Date.now(), v.city), upcoming: upcoming(v.city) });
  });
  r.put('/', async (req, res) => {
    const b = req.body || {}, cur = await valuesFor(req.user.id);
    const preset = PRESETS[b.preset] ? b.preset : cur.preset;
    const next = { preset, avoid: (Array.isArray(b.avoid) ? b.avoid : cur.avoid).filter(k => CATEGORIES[k]), shabbos: b.shabbos === undefined ? cur.shabbos : !!b.shabbos, city: CITIES[b.city] ? b.city : cur.city, maaserPct: [10, 20].includes(+b.maaserPct) ? +b.maaserPct : cur.maaserPct };
    await setSetting(req.user.id, 'values', next);
    if (next.shabbos !== cur.shabbos) await audit(req.user.id, 'shabbos_pause', { on: next.shabbos, city: next.city }, req.ip);
    res.json(await valuesFor(req.user.id));
  });
  r.get('/screen', async (req, res) => {
    const v = await valuesFor(req.user.id);
    res.json({ avoid: v.avoid, results: screen(String(req.query.symbols || '').split(/[\s,]+/).filter(Boolean).slice(0, 100), v.avoid) });
  });
  r.get('/portfolio', async (req, res) => {
    const account = ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper', v = await valuesFor(req.user.id);
    const s = await accountSummary(req.user.id, account), sc = screen(s.positions.map(p => p.symbol), v.avoid);
    const total = s.positions.reduce((a, p) => a + p.value, 0) || 1;
    const rows = s.positions.map(p => ({ ...sc.find(x => x.symbol === p.symbol), value: p.value, weight: +(p.value / total * 100).toFixed(1) }));
    res.json({ account, holdings: rows, avoidPct: +rows.filter(x => x.status === 'avoid').reduce((a, x) => a + x.weight, 0).toFixed(1) });
  });
  // Maaser on this year's results (from the tax records), plus anything typed in.
  r.post('/maaser', async (req, res) => {
    const b = req.body || {}, v = await valuesFor(req.user.id), year = +b.year || new Date().getFullYear();
    let gains = 0, dividends = 0, interest = 0;
    const { booksFor } = await import('./books.js');
    for (const a of (Array.isArray(b.accounts) ? b.accounts : ['paper']).filter(x => ACCOUNT_IDS.includes(x))) {
      const bk = await booksFor(req.user, a, year).catch(() => null); if (!bk) continue;
      for (const m of bk.months) { gains += m.shortTerm + m.longTerm; dividends += m.dividends; interest += m.interest; }
    }
    const ledger = (await one("SELECT COALESCE(SUM(amount), 0) s FROM tzedakah WHERE user_id = ? AND day LIKE ?", req.user.id, `${year}-%`)).s;
    res.json({ year, ledger: +(+ledger).toFixed(2), ...maaser({ gains, dividends, interest, otherIncome: +b.otherIncome || 0, alreadyGiven: (+b.alreadyGiven || 0) + ledger, pct: [10, 20].includes(+b.pct) ? +b.pct : v.maaserPct }) });
  });
  // Owner: add tickers to categories from a CSV ("symbol,category").
  r.post('/lists', requireAdmin, async (req, res) => {
    const extra = siteGet('valuesExtra', {}) || {}; let n = 0;
    for (const line of String(req.body?.csv || '').split(/\r?\n/)) {
      const [sym, cat] = line.split(',').map(x => String(x || '').trim()); const s = sym.toUpperCase();
      if (!CATEGORIES[cat] || !/^[A-Z0-9.\-]{1,10}$/.test(s)) continue;
      extra[cat] = [...new Set([...(extra[cat] || []), s])]; n++;
    }
    await siteSet('valuesExtra', extra);
    await audit(req.user.id, 'values_lists', { added: n }, req.ip);
    res.json({ added: n });
  });
  return r;
})();
