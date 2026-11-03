// Retirement & IRAs: this year's limits, Traditional vs Roth in plain words, who can put how much
// into each, a planner (what savings grow to and what monthly income they could give), and which
// of the user's accounts are IRAs (the tax page then treats them as tax-sheltered).
// Figures: IRS Notice 2025-67 (2026 limits). Estimates only; not tax advice.
import express from 'express';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const r0 = x => Math.round(+x || 0), r2 = x => Math.round((+x || 0) * 100) / 100;

export const LIMITS = {
  year: 2026, source: 'IRS Notice 2025-67',
  ira: 7500, iraCatchUp: 1100, // age 50 and over
  k401: 24500, k401CatchUp: 8000, k401CatchUp6063: 11250, // the higher catch-up for ages 60 to 63
  roth: { single: [153000, 168000], married: [242000, 252000], separate: [0, 10000] }, // modified AGI phase-out
  // Traditional IRA deduction phase-out when covered by a workplace plan (or the spouse is).
  deduct: { single: [81000, 91000], married: [129000, 149000], separate: [0, 10000], spouseCovered: [242000, 252000] },
  rmdAge: 73, rmdAgeFrom1960: 75, penaltyAge: 59.5,
};
export const ACCOUNT_TYPES = { taxable: 'Taxable (regular brokerage)', traditional_ira: 'Traditional IRA', roth_ira: 'Roth IRA', rollover_ira: 'Rollover IRA', sep_ira: 'SEP IRA' };
export const isIra = t => /_ira$/.test(String(t || ''));

// The IRS phase-out: the limit falls in a straight line across the range, rounded up to the next
// $10, and anything above zero is at least $200.
export function phaseOut(limit, magi, [lo, hi]) {
  if (magi <= lo) return limit;
  if (magi >= hi) return 0;
  const left = Math.ceil(limit * (hi - magi) / (hi - lo) / 10) * 10;
  return Math.min(limit, Math.max(200, left));
}

// Who can put how much where, for one person.
export function eligibility({ age = 40, filing = 'single', magi = 0, covered = false, spouseCovered = false, earned = null } = {}) {
  const f = ['single', 'married', 'separate'].includes(filing) ? filing : 'single';
  const base = LIMITS.ira + (age >= 50 ? LIMITS.iraCatchUp : 0);
  const limit = earned != null ? Math.min(base, Math.max(0, earned)) : base; // can't put in more than you earned
  const roth = phaseOut(limit, magi, LIMITS.roth[f]);
  const range = covered ? LIMITS.deduct[f] : spouseCovered && f === 'married' ? LIMITS.deduct.spouseCovered : null;
  const deductible = range ? phaseOut(limit, magi, range) : limit;
  const k401 = LIMITS.k401 + (age >= 60 && age <= 63 ? LIMITS.k401CatchUp6063 : age >= 50 ? LIMITS.k401CatchUp : 0);
  const notes = [];
  if (roth === 0) notes.push(`Your income is above the Roth IRA limit (${f === 'married' ? 'married filing jointly' : f}). People in this spot sometimes use a "backdoor Roth" (a non-deductible Traditional IRA converted to Roth); ask a tax professional first.`);
  else if (roth < limit) notes.push(`Your income is in the Roth phase-out range, so you can put in only part of the full amount.`);
  if (range && deductible < limit) notes.push(deductible === 0 ? 'You can still put money in a Traditional IRA, but it is not tax-deductible at your income because you (or your spouse) have a workplace plan.' : 'Only part of a Traditional IRA contribution is tax-deductible at your income, because of a workplace plan.');
  if (age >= 50) notes.push(`At ${age} you get the catch-up: $${LIMITS.iraCatchUp.toLocaleString('en-US')} more in an IRA${age >= 60 && age <= 63 ? `, and $${LIMITS.k401CatchUp6063.toLocaleString('en-US')} more in a 401(k) (ages 60-63)` : `, $${LIMITS.k401CatchUp.toLocaleString('en-US')} more in a 401(k)`}.`);
  notes.push('The IRA limit is shared: Traditional and Roth together, across all your IRAs.');
  return { year: LIMITS.year, limit, rothMax: roth, traditionalMax: limit, traditionalDeductible: deductible, k401Max: k401, notes };
}

// What savings grow to by retirement, and the monthly income that could support, in today's dollars.
export function plan({ age = 35, retireAge = 65, saved = 0, monthly = 500, returnPct = 6, inflationPct = 2.5, taxNowPct = 22, taxLaterPct = 15, withdrawPct = 4, lifeTo = 92 } = {}) {
  if (!(retireAge > age)) throw bad('Pick a retirement age after your age now');
  if (retireAge - age > 70) throw bad('Check the ages');
  const years = retireAge - age, m = (1 + returnPct / 100) ** (1 / 12) - 1, infl = (1 + inflationPct / 100) ** years;
  let bal = +saved || 0, paidIn = bal;
  const path = [{ age, balance: r0(bal) }];
  for (let y = 1; y <= years; y++) { for (let k = 0; k < 12; k++) { bal = bal * (1 + m) + (+monthly || 0); paidIn += +monthly || 0; } path.push({ age: age + y, balance: r0(bal), real: r0(bal / (1 + inflationPct / 100) ** y) }); }
  const realBal = bal / infl, yearly = realBal * withdrawPct / 100;
  // The same savings in a Roth (paid in after tax, out tax-free) or Traditional (in before tax, out taxed).
  const roth = { contribution: monthly, monthlyIncome: r0(yearly / 12) };
  const traditional = { contribution: r0(monthly / (1 - taxNowPct / 100)), monthlyIncome: r0(yearly / (1 - taxNowPct / 100) * (1 - taxLaterPct / 100) / 12) };
  // How long the money lasts drawing that income (real return after inflation).
  const realR = (1 + returnPct / 100) / (1 + inflationPct / 100) - 1;
  let left = realBal, lasts = 0; while (left > 0 && lasts < 60) { left = left * (1 + realR) - yearly; lasts++; }
  return {
    years, balance: r0(bal), realBalance: r0(realBal), paidIn: r0(paidIn), growth: r0(bal - paidIn), monthlyIncome: r0(yearly / 12), lastsYears: lasts >= 60 ? null : lasts, lastsToAge: lasts >= 60 ? null : retireAge + lasts, enoughTo: lifeTo,
    path, compare: { roth, traditional, better: roth.monthlyIncome >= traditional.monthlyIncome ? 'roth' : 'traditional', why: taxLaterPct >= taxNowPct ? 'Your tax rate later is expected to be the same or higher, so paying the tax now (Roth) tends to leave you more.' : 'Your tax rate later is expected to be lower, so delaying the tax (Traditional) tends to leave you more.' },
    assumptions: { returnPct, inflationPct, withdrawPct, taxNowPct, taxLaterPct },
  };
}

export const retirementRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => res.json({ limits: LIMITS, types: ACCOUNT_TYPES, accounts: await getSetting(req.user.id, 'accountTax', {}) || {} }));
  r.post('/eligibility', (req, res) => {
    const b = req.body || {}, num = (v, lo, hi) => { const n = +v; if (!Number.isFinite(n) || n < lo || n > hi) throw bad('Check the numbers'); return n; };
    res.json(eligibility({ age: num(b.age ?? 40, 0, 120), filing: b.filing, magi: num(b.magi ?? 0, 0, 1e9), covered: !!b.covered, spouseCovered: !!b.spouseCovered, earned: b.earned === '' || b.earned == null ? null : num(b.earned, 0, 1e9) }));
  });
  r.post('/plan', (req, res) => {
    const b = req.body || {}, num = (k, d, lo, hi) => { const n = b[k] === '' || b[k] == null ? d : +b[k]; if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`Check "${k}"`); return n; };
    res.json(plan({ age: num('age', 35, 0, 100), retireAge: num('retireAge', 65, 1, 110), saved: num('saved', 0, 0, 1e10), monthly: num('monthly', 500, 0, 1e7), returnPct: num('returnPct', 6, -5, 20), inflationPct: num('inflationPct', 2.5, 0, 15), taxNowPct: num('taxNowPct', 22, 0, 60), taxLaterPct: num('taxLaterPct', 15, 0, 60), withdrawPct: num('withdrawPct', 4, 1, 10) }));
  });
  // Mark which connected accounts are IRAs (Traditional, Roth...) for taxes and planning.
  r.put('/accounts', async (req, res) => {
    const m = req.body?.accounts || {}, out = {};
    for (const [k, v] of Object.entries(m).slice(0, 30)) { if (!/^[a-z0-9_-]{2,40}$/.test(k)) throw bad('Unknown account'); if (!ACCOUNT_TYPES[v]) throw bad('Unknown account type'); out[k] = v; }
    await setSetting(req.user.id, 'accountTax', out);
    res.json({ accounts: out });
  });
  return r;
})();
