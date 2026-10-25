// Execution transparency and smart order routing.
// - Every order records the best bid and offer at the moment it is sent, then the fill, in an
//   append-only log: each entry carries the SHA-256 hash of the one before, so any edit breaks the
//   chain (and the database refuses UPDATE and DELETE on it). Users can verify their chain.
// - Venue scoring: for each brokerage the user has connected, price improvement versus the quote,
//   fill rate and time to fill, from the user's own history (with neutral defaults until there is any).
// - Smart routing ("smart" account): buys go to the best-scoring connected brokerage whose circuit
//   breaker is closed and fall back to the next one if it fails; sells go to the brokerage that
//   holds the shares. A "direct to exchange" preference limits routing to brokerages the owner has
//   marked as offering direct exchange routing without payment for order flow (EXEC_DIRECT_BROKERS).
import crypto from 'node:crypto';
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';
import { breaker } from './reliability.js';
import * as D from './alpaca/data.js';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);

// Best bid/offer when sending. Stocks use the configured feed: 'sip' is the consolidated NBBO,
// the free 'iex' feed is one exchange's quote and is labelled as such.
export async function quoteAt(symbol, fallbackPrice) {
  const at = now();
  if (D.dataEnabled()) {
    try {
      const q = (await D.latest(symbol))[symbol]?.quote;
      if (q && (q.bp > 0 || q.ap > 0)) return { bid: q.bp || null, ask: q.ap || null, bidSize: q.bs ?? null, askSize: q.as ?? null, quoteTime: q.t || null, capturedAt: at, feed: symbol.includes('/') ? 'crypto' : (process.env.ALPACA_STOCK_FEED || 'iex') === 'sip' ? 'NBBO (SIP)' : 'IEX quote (not consolidated NBBO)' };
    } catch {}
  }
  return fallbackPrice > 0 ? { bid: null, ask: null, last: +fallbackPrice, capturedAt: at, feed: 'last price (no live quote)' } : { capturedAt: at, feed: 'unavailable' };
}

// Appends one entry. A per-process promise chain keeps appends in order; across replicas the
// UNIQUE hash and a retry keep the chain consistent.
let tail = Promise.resolve();
export function auditAppend(userId, kind, data) {
  const p = tail.then(async () => {
    for (let i = 0; i < 5; i++) {
      const prev = await one('SELECT hash FROM exec_audit WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);
      const at = now(), prevHash = prev?.hash || GENESIS, body = JSON.stringify(data);
      const hash = sha(`${prevHash}|${userId}|${kind}|${at}|${body}`);
      try { await run('INSERT INTO exec_audit (user_id, kind, data, prev_hash, hash, at) VALUES (?,?,?,?,?,?)', userId, kind, body, prevHash, hash, at); return hash; }
      catch (e) { if (!/UNIQUE/i.test(e.message)) throw e; }
    }
  });
  tail = p.catch(() => {});
  return p;
}
export async function verifyChain(userId) {
  const rows = await all('SELECT * FROM exec_audit WHERE user_id = ? ORDER BY id', userId);
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || sha(`${r.prev_hash}|${r.user_id}|${r.kind}|${r.at}|${r.data}`) !== r.hash) return { ok: false, entries: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length, head: prev };
}

// Price improvement in basis points: positive = better than the quote (bought below the ask, sold above the bid).
export function improvementBps(side, q, price) {
  const ref = side === 'buy' ? q?.ask : q?.bid;
  if (!(ref > 0) || !(price > 0)) return null;
  return +((side === 'buy' ? ref - price : price - ref) / ref * 1e4).toFixed(2);
}

export async function venueStats(userId) {
  const rows = await all("SELECT data FROM exec_audit WHERE user_id = ? AND kind IN ('order', 'fill') ORDER BY id DESC LIMIT 2000", userId);
  const orders = new Map(), by = {};
  for (const r of rows.reverse()) {
    const d = JSON.parse(r.data), key = d.orderRef;
    if (d.event === 'sent') orders.set(key, d);
    const v = (by[d.venue] ||= { venue: d.venue, sent: 0, filled: 0, rejected: 0, impr: [], ms: [] });
    if (d.event === 'sent') v.sent++;
    if (d.event === 'rejected') v.rejected++;
    if (d.event === 'filled') { v.filled++; const o = orders.get(key); if (d.improvementBps != null) v.impr.push(d.improvementBps); if (o) v.ms.push(d.at - o.at); }
  }
  return Object.values(by).map(v => ({ venue: v.venue, sent: v.sent, filled: v.filled, rejected: v.rejected, fillRate: v.sent ? +(v.filled / v.sent * 100).toFixed(1) : null,
    avgImprovementBps: v.impr.length ? +(v.impr.reduce((a, b) => a + b, 0) / v.impr.length).toFixed(2) : null, medianFillMs: v.ms.length ? v.ms.sort((a, b) => a - b)[Math.floor(v.ms.length / 2)] : null }));
}

export const ROUTING_DEFAULT = { mode: 'best', directOnly: false, failover: true, weights: { price: 0.5, fillRate: 0.3, speed: 0.2 } };
export const getRouting = async userId => ({ ...ROUTING_DEFAULT, ...(await getSetting(userId, 'routing', {})) });
export const directBrokers = () => String(process.env.EXEC_DIRECT_BROKERS || '').split(',').map(s => s.trim()).filter(Boolean);

// Scores each candidate brokerage: 0-100 from price improvement, fill rate and speed.
export function scoreVenues(candidates, stats, weights = ROUTING_DEFAULT.weights) {
  return candidates.map(id => {
    const s = stats.find(x => x.venue === id) || {}, b = breaker(id).info();
    const price = s.avgImprovementBps == null ? 50 : Math.max(0, Math.min(100, 50 + s.avgImprovementBps * 10));
    const fill = s.fillRate == null ? 70 : s.fillRate;
    const speed = s.medianFillMs == null ? 60 : Math.max(0, 100 - s.medianFillMs / 100);
    const score = b.state === 'open' ? 0 : +(price * weights.price + fill * weights.fillRate + speed * weights.speed).toFixed(1);
    return { venue: id, score, breaker: b.state, priceScore: +price.toFixed(1), fillScore: +fill.toFixed(1), speedScore: +speed.toFixed(1), basedOn: s.sent || 0 };
  }).sort((a, b) => b.score - a.score);
}

// The order of brokerages to try for an order sent to the "smart" account.
export async function routePlan(userId, symbol, side, { accounts, holdings }) {
  const pref = await getRouting(userId);
  let cands = accounts.filter(a => a.connected && a.id !== 'paper').map(a => a.id);
  if (symbol.includes('/')) cands = cands.filter(id => id === 'alpaca'); // crypto trades on Alpaca only
  if (pref.directOnly) cands = cands.filter(id => directBrokers().includes(id));
  if (!cands.length) throw Object.assign(new Error(pref.directOnly ? 'None of your connected brokerages offers direct exchange routing. Turn off "Direct to exchange only" or connect one that does.' : 'Connect a brokerage to use smart routing'), { status: 400 });
  if (side === 'sell') {
    const held = cands.filter(id => (holdings[id] || 0) > 0);
    if (!held.length) throw Object.assign(new Error(`You don't hold ${symbol} at a connected brokerage`), { status: 400 });
    return { order: held.sort((a, b) => holdings[b] - holdings[a]), scores: [], failover: false };
  }
  const scores = scoreVenues(cands, await venueStats(userId), pref.weights);
  return { order: scores.filter(s => s.breaker !== 'open').map(s => s.venue), scores, failover: pref.failover };
}

export function execRouter({ accounts }) {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const list = await accounts(req.user.id);
    const cands = list.filter(a => a.connected && a.id !== 'paper').map(a => a.id);
    const stats = await venueStats(req.user.id), pref = await getRouting(req.user.id);
    const rows = await all('SELECT id, kind, data, hash, prev_hash, at FROM exec_audit WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id);
    res.json({ routing: pref, directBrokers: directBrokers(), venues: scoreVenues(cands, stats, pref.weights), stats, log: rows.map(x => ({ ...x, data: JSON.parse(x.data) })), quoteFeed: (process.env.ALPACA_STOCK_FEED || 'iex') === 'sip' ? 'sip' : 'iex' });
  });
  r.put('/routing', async (req, res) => {
    const b = req.body || {}, w = b.weights || {};
    const n = (v, d) => (Number.isFinite(+v) && +v >= 0 ? +v : d);
    let weights = { price: n(w.price, 0.5), fillRate: n(w.fillRate, 0.3), speed: n(w.speed, 0.2) };
    const tot = weights.price + weights.fillRate + weights.speed || 1; weights = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, +(v / tot).toFixed(3)]));
    res.json(await setSetting(req.user.id, 'routing', { mode: 'best', directOnly: !!b.directOnly, failover: b.failover !== false, weights }));
  });
  r.get('/verify', async (req, res) => res.json(await verifyChain(req.user.id)));
  r.get('/export', async (req, res) => {
    const rows = await all('SELECT id, kind, data, prev_hash, hash, at FROM exec_audit WHERE user_id = ? ORDER BY id', req.user.id);
    res.type('application/json').attachment('execution-log.json').send(JSON.stringify({ algorithm: 'sha256(prev_hash|user_id|kind|at|data)', entries: rows }, null, 1));
  });
  return r;
}
