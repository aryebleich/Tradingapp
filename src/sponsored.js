// Sponsored news: paid announcements from companies listed on a US stock exchange, shown as a
// pop-up to users on the free plan, with a link to buy the stock. Paid plans never see them (upgrading
// is the only way to turn them off). The owner manages campaigns in Admin → Sponsored news.
//
// The law on paid stock promotion (Securities Act §17(b)): anyone paid to publish material about a
// security must say they were paid, by whom and how much. Every pop-up therefore carries the
// "Sponsored" label and that disclosure, which a campaign cannot be saved without.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, requireAdmin } from './auth.js';
import { isPaid } from './fees.js';
import { siteGet, siteSet } from './site.js';
import { listedCompanies } from './fundamentals.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const DEFAULTS = { on: true, perDay: 3, gapMinutes: 6 };
export const settings = () => ({ ...DEFAULTS, ...(siteGet('sponsored', {}) || {}) });
const day = (t = now()) => new Date(t).toISOString().slice(0, 10);

// The company behind a symbol, only if it is listed on an exchange (not over the counter).
export async function listed(symbol) {
  const m = await listedCompanies().catch(() => null);
  if (!m) throw bad('The list of listed companies (SEC) could not be loaded; try again in a minute', 503);
  return m[String(symbol || '').toUpperCase()] || null;
}

function clean(b) {
  const s = v => String(v ?? '').replace(/[<>]/g, '').trim();
  const c = {
    symbol: s(b.symbol).toUpperCase(), headline: s(b.headline).slice(0, 120), body: s(b.body).slice(0, 400),
    url: /^https:\/\/[^\s]+$/.test(s(b.url)) ? s(b.url).slice(0, 300) : '', sponsor: s(b.sponsor).slice(0, 80),
    paid: Math.max(0, +b.paid || 0), disclosure: s(b.disclosure).slice(0, 300),
    starts: /^\d{4}-\d{2}-\d{2}$/.test(b.starts || '') ? b.starts : day(), ends: /^\d{4}-\d{2}-\d{2}$/.test(b.ends || '') ? b.ends : null,
    weight: Math.min(10, Math.max(1, Math.round(+b.weight || 1))), active: b.active === false ? 0 : 1,
  };
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(c.symbol)) throw bad('Check the symbol');
  if (c.headline.length < 5) throw bad('Write a headline');
  if (!c.sponsor) throw bad('Who paid for it? (needed for the disclosure)');
  if (!(c.paid > 0)) throw bad('How much was paid? (the law requires showing it)');
  return c;
}
// The disclosure line shown on every pop-up.
export const disclosureOf = a => a.disclosure || `Paid promotion: Brightolio received $${(+a.paid).toLocaleString('en-US')} from ${a.sponsor} for this message about ${a.symbol}. Not a recommendation to buy or sell.`;

// The next pop-up for a user: none on paid plans, at most `perDay` a day, `gapMinutes` apart,
// picked by weight among the campaigns running today.
export async function nextFor(user, t = now()) {
  const s = settings();
  if (!s.on || isPaid(user)) return null;
  const d = day(t), seen = await one('SELECT n, last_at FROM sponsored_views WHERE user_id = ? AND day = ?', user.id, d);
  if (seen && (seen.n >= s.perDay || t - seen.last_at < s.gapMinutes * 60e3)) return null;
  const ads = await all('SELECT * FROM sponsored_ads WHERE active = 1 AND starts <= ? AND (ends IS NULL OR ends >= ?)', d, d);
  if (!ads.length) return null;
  let r = Math.random() * ads.reduce((x, a) => x + a.weight, 0), pick = ads[0];
  for (const a of ads) { r -= a.weight; if (r <= 0) { pick = a; break; } }
  await run('INSERT INTO sponsored_views (user_id, day, n, last_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1, last_at = excluded.last_at', user.id, d, t);
  await run('UPDATE sponsored_ads SET views = views + 1 WHERE id = ?', pick.id);
  return { id: pick.id, symbol: pick.symbol, company: pick.company, exchange: pick.exchange, headline: pick.headline, body: pick.body, url: pick.url || null, disclosure: disclosureOf(pick) };
}

export const sponsoredRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/next', async (req, res) => res.json({ ad: await nextFor(req.user), paid: isPaid(req.user) }));
  r.post('/:id/click', async (req, res) => { await run('UPDATE sponsored_ads SET clicks = clicks + 1 WHERE id = ?', +req.params.id); res.json({ ok: true }); });
  // ---------- owner ----------
  r.get('/admin', requireAdmin, async (req, res) => res.json({ settings: settings(), ads: (await all('SELECT * FROM sponsored_ads ORDER BY active DESC, id DESC')).map(a => ({ ...a, active: !!a.active, ctr: a.views ? +(a.clicks / a.views * 100).toFixed(2) : null, disclosureShown: disclosureOf(a) })) }));
  r.put('/admin/settings', requireAdmin, async (req, res) => {
    const b = req.body || {}, s = { on: b.on !== false, perDay: Math.min(20, Math.max(1, +b.perDay || DEFAULTS.perDay)), gapMinutes: Math.min(240, Math.max(1, +b.gapMinutes || DEFAULTS.gapMinutes)) };
    await siteSet('sponsored', s); await audit(req.user.id, 'sponsored_settings', s, req.ip); res.json(s);
  });
  r.post('/admin', requireAdmin, async (req, res) => {
    const c = clean(req.body || {}), co = await listed(c.symbol);
    if (!co) throw bad(`${c.symbol} is not a company listed on a US stock exchange (NYSE, Nasdaq or Cboe). Only listed companies can be promoted.`);
    const id = req.body?.id ? +req.body.id : null;
    if (id) await run('UPDATE sponsored_ads SET symbol = ?, company = ?, exchange = ?, headline = ?, body = ?, url = ?, sponsor = ?, paid = ?, disclosure = ?, starts = ?, ends = ?, weight = ?, active = ? WHERE id = ?', c.symbol, co.name, co.exchange, c.headline, c.body, c.url, c.sponsor, c.paid, c.disclosure, c.starts, c.ends, c.weight, c.active, id);
    const out = id || Number((await run('INSERT INTO sponsored_ads (symbol, company, exchange, headline, body, url, sponsor, paid, disclosure, starts, ends, weight, active, views, clicks, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?)', c.symbol, co.name, co.exchange, c.headline, c.body, c.url, c.sponsor, c.paid, c.disclosure, c.starts, c.ends, c.weight, c.active, now())).lastInsertRowid);
    await audit(req.user.id, 'sponsored_saved', { id: out, symbol: c.symbol, paid: c.paid }, req.ip);
    res.json({ id: out, company: co.name, exchange: co.exchange });
  });
  r.delete('/admin/:id', requireAdmin, async (req, res) => { await run('DELETE FROM sponsored_ads WHERE id = ?', +req.params.id); res.json({ ok: true }); });
  return r;
})();
