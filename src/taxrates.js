// Tax rates set automatically from where the user lives and what they earn: the federal bracket
// (2025 and 2026 IRS tables, by filing status), the long-term capital gains rate, the 3.8% net
// investment income tax, and the state's rate. Each January the new year's tables apply on their
// own; a year whose tables are not here yet is estimated by indexing the latest one for inflation
// (as the IRS does) and marked as estimated until the tables are added. Estimates only.
import express from 'express';
import { all, run } from './db.js';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';

// Upper limits of the 10, 12, 22, 24, 32 and 35% brackets (37% above), standard deduction, and the
// top of the 0% and 15% long-term capital gains rates.
export const FEDERAL = {
  2025: {
    single: { b: [11925, 48475, 103350, 197300, 250525, 626350], std: 15750, lt: [48350, 533400] },
    mfj: { b: [23850, 96950, 206700, 394600, 501050, 751600], std: 31500, lt: [96700, 600050] },
    hoh: { b: [17000, 64850, 103350, 197300, 250500, 626350], std: 23625, lt: [64750, 566700] },
    mfs: { b: [11925, 48475, 103350, 197300, 250525, 375800], std: 15750, lt: [48350, 300000] },
  },
  2026: {
    single: { b: [12400, 50400, 105700, 201775, 256225, 640600], std: 16100, lt: [49450, 545500] },
    mfj: { b: [24800, 100800, 211400, 403550, 512450, 768700], std: 32200, lt: [98900, 613700] },
    hoh: { b: [17700, 67450, 105700, 201750, 256200, 640600], std: 24150, lt: [66200, 579600] },
    mfs: { b: [12400, 50400, 105700, 201775, 256225, 384350], std: 16100, lt: [49450, 306850] },
  },
};
const RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
export const FILING = { single: 'Single', mfj: 'Married filing jointly', hoh: 'Head of household', mfs: 'Married filing separately' };
const NIIT = { single: 200000, hoh: 200000, mfj: 250000, mfs: 125000 };
export const INFLATION = 0.027;

// Brackets for a year: the IRS table, or the latest one indexed for inflation (rounded to $50).
export function federalTable(year) {
  if (FEDERAL[year]) return { ...FEDERAL[year], year, estimated: false };
  const years = Object.keys(FEDERAL).map(Number).sort(), base = year > years.at(-1) ? years.at(-1) : years[0];
  const f = (1 + INFLATION) ** (year - base), idx = v => Math.round(v * f / 50) * 50, out = { year, estimated: true };
  for (const [k, t] of Object.entries(FEDERAL[base])) out[k] = { b: t.b.map(idx), std: idx(t.std), lt: t.lt.map(idx) };
  return out;
}

// States: flat rates, no income tax, or approximate brackets for a single filer (doubled for joint).
const FLAT = { AZ: 2.5, CO: 4.4, GA: 5.19, ID: 5.3, IL: 4.95, IN: 3.0, IA: 3.8, KY: 4.0, LA: 3.0, MA: 5.0, MI: 4.25, MS: 4.4, NC: 4.25, PA: 3.07, UT: 4.5 };
const NONE = { AK: 'No state income tax', FL: 'No state income tax', NV: 'No state income tax', NH: 'No tax on wages, interest or dividends', SD: 'No state income tax', TN: 'No state income tax', TX: 'No state income tax', WY: 'No state income tax', WA: 'No income tax; a 7% tax on long-term capital gains over about $270,000 (9.9% over $1 million)' };
const TIERS = {
  CA: [[0, 1], [10756, 2], [25499, 4], [40245, 6], [55866, 8], [70606, 9.3], [360659, 10.3], [432787, 11.3], [721314, 12.3], [1000000, 13.3]],
  NY: [[0, 4], [8500, 4.5], [11700, 5.25], [13900, 5.5], [80650, 6], [215400, 6.85], [1077550, 9.65], [5000000, 10.3], [25000000, 10.9]],
  NJ: [[0, 1.4], [20000, 1.75], [35000, 3.5], [40000, 5.525], [75000, 6.37], [500000, 8.97], [1000000, 10.75]],
  OR: [[0, 4.75], [4300, 6.75], [10750, 8.75], [125000, 9.9]], MN: [[0, 5.35], [32570, 6.8], [106990, 7.85], [198630, 9.85]],
  HI: [[0, 1.4], [9600, 3.2], [14400, 5.5], [19200, 6.4], [24000, 6.8], [36000, 7.2], [48000, 7.6], [125000, 7.9], [175000, 8.25], [225000, 9], [275000, 10], [325000, 11]],
  VT: [[0, 3.35], [47900, 6.6], [116000, 7.6], [242000, 8.75]], WI: [[0, 3.5], [14680, 4.4], [29370, 5.3], [323290, 7.65]], ME: [[0, 5.8], [26800, 6.75], [63450, 7.15]],
  CT: [[0, 2], [10000, 4.5], [50000, 5.5], [100000, 6], [200000, 6.5], [250000, 6.9], [500000, 6.99]],
  MD: [[0, 2], [1000, 3], [2000, 4], [3000, 4.75], [100000, 5], [125000, 5.25], [150000, 5.5], [250000, 5.75], [500000, 6.25], [1000000, 6.5]],
  VA: [[0, 2], [3000, 3], [5000, 5], [17000, 5.75]], SC: [[0, 0], [3560, 3], [17830, 6.2]], OH: [[0, 0], [26050, 2.75]],
  MO: [[0, 0], [1313, 2], [2626, 2.5], [3939, 3], [5252, 3.5], [6565, 4], [7878, 4.5], [9191, 4.7]], AL: [[0, 2], [500, 4], [3000, 5]], AR: [[0, 2], [5500, 3.9]],
  DE: [[0, 0], [2000, 2.2], [5000, 3.9], [10000, 4.8], [20000, 5.2], [25000, 5.55], [60000, 6.6]], KS: [[0, 5.2], [23000, 5.58]], MT: [[0, 4.7], [21100, 5.9]],
  NE: [[0, 2.46], [4030, 3.51], [24120, 5.01], [38870, 5.2]], NM: [[0, 1.5], [5500, 3.2], [16500, 4.3], [33500, 4.7], [66500, 4.9], [210000, 5.9]],
  ND: [[0, 0], [48475, 1.95], [244825, 2.5]], OK: [[0, 0.25], [1000, 0.75], [2500, 1.75], [3750, 2.75], [4900, 3.75], [7200, 4.75]],
  RI: [[0, 3.75], [79900, 4.75], [181650, 5.99]], WV: [[0, 2.22], [10000, 2.96], [25000, 3.33], [40000, 4.44], [60000, 4.82]],
  DC: [[0, 4], [10000, 6], [40000, 6.5], [60000, 8.5], [250000, 9.25], [500000, 9.75], [1000000, 10.75]],
};
export const STATES = [...new Set([...Object.keys(FLAT), ...Object.keys(NONE), ...Object.keys(TIERS)])].sort();
export function stateRate(state, taxable, filing = 'single') {
  state = String(state || '').toUpperCase();
  if (NONE[state]) return { rate: 0, note: NONE[state] };
  if (FLAT[state] != null) return { rate: FLAT[state], note: 'Flat rate' };
  const t = TIERS[state]; if (!t) return { rate: 0, note: 'Unknown state' };
  const mult = filing === 'mfj' ? 2 : 1;
  let r = t[0][1]; for (const [min, rate] of t) if (taxable >= min * mult) r = rate;
  return { rate: r, note: 'Your bracket (approximate; local taxes such as New York City are extra)' };
}
// The rates for this profile in a year.
export function ratesFor({ state = 'NY', filing = 'single', income = 75000 } = {}, year = new Date().getFullYear()) {
  filing = FILING[filing] ? filing : 'single';
  const T = federalTable(year), t = T[filing], taxable = Math.max(0, (+income || 0) - t.std);
  let i = t.b.findIndex(x => taxable <= x); if (i < 0) i = 6;
  const lt = taxable <= t.lt[0] ? 0 : taxable <= t.lt[1] ? 0.15 : 0.2;
  const s = stateRate(state, taxable, filing);
  return { year, estimated: T.estimated, filing, state: String(state).toUpperCase(), income: +income || 0, standardDeduction: t.std, taxable, federal: RATES[i], longTerm: lt, niit: (+income || 0) > NIIT[filing] ? 0.038 : 0, stateRate: s.rate / 100, stateNote: s.note };
}

// Apply to the user's account (the rates the tax pages and estimates use).
export async function applyFor(userId, year = new Date().getFullYear()) {
  const p = await getSetting(userId, 'taxProfile', null);
  if (!p || p.auto === false) return null;
  const r = ratesFor(p, year);
  await run('UPDATE users SET tax_bracket = ?, state_tax = ? WHERE id = ?', r.federal, r.stateRate, userId);
  await setSetting(userId, 'taxProfile', { ...p, appliedYear: year, applied: { federal: r.federal, state: r.stateRate, estimated: r.estimated } });
  return r;
}
// Each January: move everyone on automatic rates to the new year's tables.
export async function yearlyUpdate(t = Date.now()) {
  const year = new Date(t).getUTCFullYear(); let n = 0;
  for (const row of await all("SELECT user_id, v FROM user_settings WHERE k = 'taxProfile'")) {
    const p = JSON.parse(row.v); if (p.auto === false || p.appliedYear === year) continue;
    await applyFor(row.user_id, year).catch(() => {}); n++;
  }
  return n;
}

export const taxRatesRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const p = await getSetting(req.user.id, 'taxProfile', null) || { state: '', filing: 'single', income: '', auto: true };
    res.json({ profile: p, states: STATES, filing: FILING, rates: p.state ? ratesFor(p) : null, current: { federal: req.user.tax_bracket, state: req.user.state_tax } });
  });
  r.put('/', async (req, res) => {
    const b = req.body || {}, state = String(b.state || '').toUpperCase();
    if (!STATES.includes(state)) throw Object.assign(new Error('Pick your state'), { status: 400 });
    const p = { state, city: String(b.city || '').slice(0, 60), filing: FILING[b.filing] ? b.filing : 'single', income: Math.max(0, Math.min(1e9, +b.income || 0)), auto: b.auto !== false };
    await setSetting(req.user.id, 'taxProfile', p);
    const applied = await applyFor(req.user.id);
    res.json({ profile: p, rates: ratesFor(p), applied: !!applied });
  });
  return r;
})();
