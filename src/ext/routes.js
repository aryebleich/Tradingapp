// /api/brokerages: connect and disconnect the other brokerages. accountsFor() lists every account
// the signed-in user can trade (served at /api/accounts for the account pickers in the app).
import express from 'express';
import { extraAlpaca } from '../alpaca/connections.js';
import { audit } from '../db.js';
import { requireUser } from '../auth.js';
import { EXT, catalog, getExtCred, saveExtCred, removeExtCred, withExt, takeState } from './brokers.js';
import { tradingFor } from '../alpaca/connections.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

export async function accountsFor(userId) {
  const out = [{ id: 'paper', name: 'Paper account', live: false, connected: true }];
  const t = await tradingFor(userId).catch(() => null);
  out.push({ id: 'alpaca', name: 'Alpaca', live: !!t?.live, connected: !!t });
  for (const x of await extraAlpaca(userId)) out.push({ id: x.id, name: `Alpaca · ${x.label}`, live: x.live, connected: true, role: x.role });
  for (const b of Object.values(EXT)) {
    const c = await getExtCred(userId, b.id);
    out.push({ id: b.id, name: b.name, live: !!c?.live, connected: !!c });
  }
  return out;
}

export const router = express.Router();
router.use(requireUser);

router.get('/', async (req, res) => {
  const list = await Promise.all(catalog().map(async b => {
    const c = await getExtCred(req.user.id, b.id);
    return { ...b, connected: !!c, live: !!c?.live, account: c ? String(c.accountNumber || c.account || '').slice(-4) : null };
  }));
  res.json(list);
});

// Token brokers: the credentials are checked against the broker before they are stored.
router.post('/:id/connect', async (req, res) => {
  const b = EXT[req.params.id];
  if (!b || b.kind !== 'token') throw bad('Unknown brokerage');
  const c = await b.connect(req.body);
  await saveExtCred(req.user.id, b.id, c);
  await audit(req.user.id, 'brokerage_connected', { broker: b.id, live: c.live }, req.ip);
  res.json({ ok: true, live: c.live });
});

// OAuth brokers: returns the broker's sign-in page.
router.post('/:id/start', async (req, res) => {
  const b = EXT[req.params.id];
  if (!b || b.kind !== 'oauth') throw bad('Unknown brokerage');
  if (!b.enabled()) throw bad(`${b.name} is not set up on this server yet`, 409);
  res.json({ url: b.startUrl(req.user.id, { sim: !!req.body.sim }) });
});

router.get('/:id/summary', async (req, res) => {
  res.json(await withExt(req.user.id, req.params.id, (b, c, save) => b.summary(c, save)));
});

router.delete('/:id', async (req, res) => {
  if (!EXT[req.params.id]) throw bad('Unknown brokerage');
  await removeExtCred(req.user.id, req.params.id);
  await audit(req.user.id, 'brokerage_disconnected', { broker: req.params.id }, req.ip);
  res.json({ ok: true });
});

// Redirect target after signing in at Schwab or TradeStation (mounted outside /api).
export async function oauthCallback(req, res) {
  const id = req.path.split('/')[2], b = EXT[id];
  try {
    if (!b || b.kind !== 'oauth') throw new Error('Unknown brokerage');
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const st = takeState(String(req.query.state || ''));
    if (!st || st.broker !== id) throw new Error('This sign-in link expired. Please connect again.');
    if (req.user && req.user.id !== st.userId) throw new Error('Signed-in user changed during the brokerage sign-in.');
    const c = await b.exchange(String(req.query.code || ''), st.opts);
    await saveExtCred(st.userId, id, c);
    await audit(st.userId, 'brokerage_connected', { broker: id, live: c.live }, req.ip);
    res.redirect('/app#/brokers?connected=' + id);
  } catch (e) { res.redirect('/app#/brokers?error=' + encodeURIComponent(e.message)); }
}
