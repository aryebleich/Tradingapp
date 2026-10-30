// Live data for private investments and real estate (add-ons, each can be switched off):
//  - home value and rent estimates from RentCast (RENTCAST_API_KEY), by hand or monthly, and
//    optionally used as the property's value and rent;
//  - a cap table per private company: funding rounds, your shares, ownership after each round,
//    and the value your shares imply at the latest price;
//  - K-1 forms from private funds: expected each year, the key boxes, the PDF, and a reminder
//    until it has arrived.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser } from './auth.js';
import { addonOn, requireAddon } from './addons.js';
import { notifyUser } from './notify-user.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const r2 = x => +(+x || 0).toFixed(2);
const DAY = 864e5;

// ---------- home values and rent (RentCast) ----------
export const rentcastOn = () => !!process.env.RENTCAST_API_KEY;
async function rentcast(path, address) {
  const base = (process.env.RENTCAST_BASE_URL || 'https://api.rentcast.io/v1').replace(/\/$/, '');
  const r = await fetch(`${base}${path}?address=${encodeURIComponent(address)}`, { headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw bad('RentCast has no estimate for that address. Check the full street address, city, state and ZIP.', 404);
  if (!r.ok) throw bad(`RentCast answered ${r.status}`, 502);
  return r.json();
}
export async function estimate(asset) {
  if (!rentcastOn()) throw bad('Live property values are not set up on this server yet (RENTCAST_API_KEY)', 503);
  const d = JSON.parse(asset.data || '{}');
  if (!d.address || d.address.length < 8) throw bad('Add the full address of the property first');
  const [v, rent] = await Promise.all([rentcast('/avm/value', d.address), rentcast('/avm/rent/long-term', d.address).catch(() => ({}))]);
  const e = { value: r2(v.price), valueLow: r2(v.priceRangeLow), valueHigh: r2(v.priceRangeHigh), rent: rent.rent ? r2(rent.rent) : null, rentLow: rent.rentRangeLow ? r2(rent.rentRangeLow) : null, rentHigh: rent.rentRangeHigh ? r2(rent.rentRangeHigh) : null };
  const cur = await one('SELECT auto, apply FROM property_estimates WHERE asset_id = ?', asset.id);
  await run('INSERT INTO property_estimates (asset_id, user_id, value, value_low, value_high, rent, rent_low, rent_high, auto, apply, at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET value = excluded.value, value_low = excluded.value_low, value_high = excluded.value_high, rent = excluded.rent, rent_low = excluded.rent_low, rent_high = excluded.rent_high, at = excluded.at',
    asset.id, asset.user_id, e.value, e.valueLow, e.valueHigh, e.rent, e.rentLow, e.rentHigh, cur?.auto ?? 0, cur?.apply ?? 0, now());
  if (cur?.apply) await applyEstimate(asset, e);
  return e;
}
async function applyEstimate(asset, e) {
  const d = JSON.parse(asset.data || '{}');
  const next = { ...d, value: e.value || d.value, ...(e.rent && d.type !== 'home' ? { rent: e.rent } : {}) };
  await run('UPDATE alt_assets SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(next), now(), asset.id);
}
// Monthly: properties set to update themselves (RentCast's free plan has 50 lookups a month).
export async function refreshEstimates(t = now()) {
  if (!rentcastOn()) return 0;
  let n = 0;
  for (const p of await all('SELECT a.* FROM alt_assets a JOIN property_estimates e ON e.asset_id = a.id WHERE e.auto = 1 AND e.at < ?', t - 30 * DAY)) {
    if (!(await addonOn(p.user_id, 'liveProperty'))) continue;
    await estimate(p).then(() => n++).catch(e => console.warn('estimate', p.id, e.message));
    if (n >= 40) break;
  }
  return n;
}

// ---------- cap tables ----------
function cleanCap(b) {
  const n = (v, lo = 0) => { if (v === '' || v == null) return null; const x = +v; if (!Number.isFinite(x) || x < lo || x > 1e13) throw bad('Check the numbers'); return x; };
  const rounds = (Array.isArray(b.rounds) ? b.rounds : []).slice(0, 30).map(r => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null, name: String(r.name || '').trim().slice(0, 40) || 'Round',
    price: n(r.price), raised: n(r.raised), preMoney: n(r.preMoney), sharesAfter: n(r.sharesAfter), myNewShares: n(r.myNewShares) || 0,
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { shareClass: String(b.shareClass || '').trim().slice(0, 40), myShares: n(b.myShares) || 0, options: n(b.options) || 0, strike: n(b.strike), rounds };
}
// Ownership after each round and what your shares are worth at the latest price.
export function capStats(c) {
  // Shares held before the first listed round, plus any bought in later rounds.
  const out = [];
  let mine = c.myShares - c.rounds.reduce((s, r) => s + (r.myNewShares || 0), 0);
  for (const r of c.rounds) {
    mine += r.myNewShares || 0;
    const post = r.preMoney != null && r.raised != null ? r.preMoney + r.raised : r.price && r.sharesAfter ? r.price * r.sharesAfter : null;
    out.push({ ...r, postMoney: post, myShares: mine, ownership: r.sharesAfter ? +(mine / r.sharesAfter * 100).toFixed(4) : null });
  }
  const last = [...c.rounds].reverse().find(r => r.price);
  const optionValue = last && c.options ? Math.max(0, last.price - (c.strike || 0)) * c.options : 0;
  return { rounds: out, lastPrice: last?.price ?? null, ownership: out.at(-1)?.ownership ?? null, sharesValue: last ? r2(c.myShares * last.price) : null, optionsValue: r2(optionValue), impliedValue: last ? r2(c.myShares * last.price + optionValue) : null };
}

// ---------- K-1s ----------
export const K1_BOXES = {
  1: 'Ordinary business income (loss)', 2: 'Net rental real estate income (loss)', 3: 'Other net rental income (loss)', 4: 'Guaranteed payments',
  5: 'Interest income', '6a': 'Ordinary dividends', '6b': 'Qualified dividends', 7: 'Royalties', 8: 'Net short-term capital gain (loss)',
  '9a': 'Net long-term capital gain (loss)', 10: 'Net section 1231 gain (loss)', 11: 'Other income (loss)', 12: 'Section 179 deduction',
  13: 'Other deductions', 15: 'Credits', 19: 'Distributions', 21: 'Foreign taxes paid or accrued',
};
const parseK1 = r => ({ id: r.id, assetId: r.asset_id, year: r.year, status: r.status, boxes: JSON.parse(r.boxes || '{}'), fileName: r.file_name, hasFile: !!r.file, receivedOn: r.received_on });
// Which funds should send a K-1 for a tax year: funds and private stakes held during that year.
export async function k1Overview(userId, year) {
  const assets = (await all("SELECT id, name, data, created_at FROM alt_assets WHERE user_id = ? AND kind = 'private'", userId)).map(a => ({ ...a, d: JSON.parse(a.data || '{}') }));
  const forms = (await all('SELECT * FROM k1s WHERE user_id = ? AND year = ?', userId, year)).map(parseK1);
  const expected = assets.filter(a => ['fund', 'business'].includes(a.d.type) || a.d.k1 === true || forms.some(f => f.assetId === a.id));
  const rows = expected.map(a => ({ assetId: a.id, name: a.name, form: forms.find(f => f.assetId === a.id) || null }));
  const totals = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.form?.boxes || {})) totals[k] = r2((totals[k] || 0) + v);
  return { year, rows, totals, received: rows.filter(r => r.form?.status === 'received').length, missing: rows.filter(r => r.form?.status !== 'received').map(r => r.name), boxes: K1_BOXES };
}
// From March to September, a monthly reminder of K-1s still missing for last year.
export async function k1Reminders(t = now()) {
  const d = new Date(t), m = d.getUTCMonth() + 1;
  if (d.getUTCDate() !== 1 || m < 3 || m > 9) return 0;
  let sent = 0;
  for (const u of await all("SELECT DISTINCT user_id FROM alt_assets WHERE kind = 'private'")) {
    if (!(await addonOn(u.user_id, 'k1'))) continue;
    const o = await k1Overview(u.user_id, d.getUTCFullYear() - 1);
    if (!o.missing.length) continue;
    await notifyUser(u.user_id, `K-1 forms still missing for ${o.year}: ${o.missing.slice(0, 5).join(', ')}${o.missing.length > 5 ? ` and ${o.missing.length - 5} more` : ''}. Add them under Private markets when they arrive; funds often send them late, so you may need a tax filing extension.`).catch(() => {});
    sent++;
  }
  return sent;
}

export const altLiveRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  const mine = async (req, kind) => { const a = await one('SELECT * FROM alt_assets WHERE id = ? AND user_id = ? AND kind = ?', +req.params.id, req.user.id, kind); if (!a) throw bad('Not found', 404); return a; };

  r.get('/estimate/:id', requireAddon('liveProperty'), async (req, res) => {
    const a = await mine(req, 'realestate'), e = await one('SELECT * FROM property_estimates WHERE asset_id = ?', a.id);
    res.json({ enabled: rentcastOn(), estimate: e && { value: e.value, valueLow: e.value_low, valueHigh: e.value_high, rent: e.rent, rentLow: e.rent_low, rentHigh: e.rent_high, at: e.at, auto: !!e.auto, apply: !!e.apply } });
  });
  r.post('/estimate/:id', requireAddon('liveProperty'), async (req, res) => { const a = await mine(req, 'realestate'); res.json(await estimate(a)); });
  r.put('/estimate/:id', requireAddon('liveProperty'), async (req, res) => {
    const a = await mine(req, 'realestate'), e = await one('SELECT * FROM property_estimates WHERE asset_id = ?', a.id);
    if (!e) throw bad('Get an estimate first');
    await run('UPDATE property_estimates SET auto = ?, apply = ? WHERE asset_id = ?', req.body?.auto ? 1 : 0, req.body?.apply ? 1 : 0, a.id);
    if (req.body?.apply) await applyEstimate(a, { value: e.value, rent: e.rent });
    res.json({ ok: true });
  });

  r.get('/cap/:id', requireAddon('capTable'), async (req, res) => {
    const a = await mine(req, 'private'), c = await one('SELECT data FROM cap_tables WHERE asset_id = ?', a.id);
    const cap = c ? JSON.parse(c.data) : cleanCap({});
    res.json({ cap, stats: capStats(cap) });
  });
  r.put('/cap/:id', requireAddon('capTable'), async (req, res) => {
    const a = await mine(req, 'private'), cap = cleanCap(req.body || {});
    await run('INSERT INTO cap_tables (asset_id, user_id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', a.id, req.user.id, JSON.stringify(cap), now());
    res.json({ cap, stats: capStats(cap) });
  });
  // Record the value the latest round implies as the stake's value (a valuation event).
  r.post('/cap/:id/use-value', requireAddon('capTable'), async (req, res) => {
    const a = await mine(req, 'private'), c = await one('SELECT data FROM cap_tables WHERE asset_id = ?', a.id);
    const s = c && capStats(JSON.parse(c.data)); if (!s?.impliedValue) throw bad('Add a round with a share price first');
    const d = JSON.parse(a.data || '{}'), on = new Date().toISOString().slice(0, 10);
    await run('UPDATE alt_assets SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify({ ...d, value: s.impliedValue, valuedOn: on, ...(s.ownership != null ? { ownership: +s.ownership.toFixed(2) } : {}) }), now(), a.id);
    await run('INSERT INTO alt_events (asset_id, user_id, kind, amount, on_date, memo, at) VALUES (?,?,?,?,?,?,?)', a.id, req.user.id, 'valuation', s.impliedValue, on, 'From the cap table (latest round price)', now());
    res.json({ value: s.impliedValue });
  });

  r.get('/k1', requireAddon('k1'), async (req, res) => res.json(await k1Overview(req.user.id, +req.query.year || new Date().getFullYear() - 1)));
  r.put('/k1/:id/:year', requireAddon('k1'), async (req, res) => {
    const a = await mine(req, 'private'), year = +req.params.year, b = req.body || {};
    if (!(year >= 2000 && year <= new Date().getFullYear())) throw bad('Pick the tax year');
    const boxes = {};
    for (const k of Object.keys(K1_BOXES)) if (b.boxes?.[k] !== undefined && b.boxes[k] !== '' && b.boxes[k] !== null) { const v = +b.boxes[k]; if (!Number.isFinite(v) || Math.abs(v) > 1e11) throw bad(`Check box ${k}`); boxes[k] = r2(v); }
    let file = null, fileName = null;
    if (b.file) {
      const buf = Buffer.from(String(b.file), 'base64');
      if (buf.length > 4e6) throw bad('The PDF can be up to 4 MB');
      if (buf.subarray(0, 4).toString() !== '%PDF') throw bad('Upload the K-1 as a PDF');
      file = buf.toString('base64'); fileName = String(b.fileName || `K-1 ${year}.pdf`).replace(/[^\w .()-]/g, '').slice(0, 80);
    }
    const status = b.status === 'expected' ? 'expected' : 'received';
    await run(`INSERT INTO k1s (user_id, asset_id, year, status, boxes, file, file_name, received_on, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(asset_id, year) DO UPDATE SET status = excluded.status, boxes = excluded.boxes, file = COALESCE(excluded.file, k1s.file), file_name = COALESCE(excluded.file_name, k1s.file_name), received_on = excluded.received_on, updated_at = excluded.updated_at`,
      req.user.id, a.id, year, status, JSON.stringify(boxes), file, fileName, status === 'received' ? (b.receivedOn || new Date().toISOString().slice(0, 10)) : null, now());
    // A stake that is not a fund can be marked as one that sends a K-1.
    const d = JSON.parse(a.data || '{}'); if (!d.k1) await run('UPDATE alt_assets SET data = ? WHERE id = ?', JSON.stringify({ ...d, k1: true }), a.id);
    await audit(req.user.id, 'k1_saved', { asset: a.id, year }, req.ip);
    res.json(await k1Overview(req.user.id, year));
  });
  r.get('/k1/:id/:year/file', requireAddon('k1'), async (req, res) => {
    const k = await one('SELECT file, file_name FROM k1s WHERE asset_id = ? AND year = ? AND user_id = ?', +req.params.id, +req.params.year, req.user.id);
    if (!k?.file) throw bad('Not found', 404);
    res.type('application/pdf').set('Content-Disposition', `inline; filename="${k.file_name || 'k1.pdf'}"`).send(Buffer.from(k.file, 'base64'));
  });
  r.get('/k1.csv', requireAddon('k1'), async (req, res) => {
    const o = await k1Overview(req.user.id, +req.query.year || new Date().getFullYear() - 1), keys = Object.keys(K1_BOXES);
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.type('text/csv').set('Content-Disposition', `attachment; filename="k1-${o.year}.csv"`)
      .send([['Fund', 'Status', ...keys.map(k => `Box ${k}`)].join(','), ...o.rows.map(r => [q(r.name), r.form?.status || 'expected', ...keys.map(k => r.form?.boxes[k] ?? '')].join(','))].join('\n'));
  });
  return r;
})();
