// The developer API, version 1 (/api/v1). Personal API keys are made in Settings → Developer API:
// stored hashed (sha256), shown once, with scopes ('read' by default; 'write' to create and edit;
// 'trade' to deploy, pause, rebalance and close, granted explicitly), a per-key rate limit, and
// revocation. Requests: Authorization: Bearer bk_… . Every order goes through the same Playbook
// handlers and placeOrder as the website; real-money actions are refused over the API because they
// need the website's step-up confirmation (src/playbooks.js realMoneyGuard).
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { randomToken, sha256 } from './crypto.js';
import { requireUser, rateLimit } from './auth.js';
import { playbooksRouter } from './playbooks.js';

export const PREFIX = 'bk_';
export const SCOPES = { read: 'Read Playbooks, history, previews and accounts', write: 'Create, edit and backtest Playbooks', trade: 'Deploy, pause, resume, rebalance and close Playbooks (practice account only over the API)' };
export const MAX_KEYS = 10, DEFAULT_RATE = 60, MAX_RATE = 600;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(e.status || 400).json({ error: e.message }));
const J = s => { try { return JSON.parse(s || '[]'); } catch { return []; } };

// ---------- keys (Settings, signed in) ----------
export const keysRouter = express.Router();
keysRouter.use(requireUser);
keysRouter.get('/', wrap(async (req, res) => {
  const rows = await all("SELECT id, name, hint, scopes, rate_per_min, created_at, last_used_at, revoked_at FROM api_tokens WHERE user_id = ? AND kind = 'api' ORDER BY id DESC", req.user.id);
  res.json({ keys: rows.map(k => ({ id: k.id, name: k.name, hint: k.hint, scopes: J(k.scopes), ratePerMin: k.rate_per_min, createdAt: k.created_at, lastUsedAt: k.last_used_at, revokedAt: k.revoked_at })), scopes: SCOPES, maxRate: MAX_RATE });
}));
keysRouter.post('/', wrap(async (req, res) => {
  const n = (await one("SELECT COUNT(*) n FROM api_tokens WHERE user_id = ? AND kind = 'api' AND revoked_at IS NULL", req.user.id)).n;
  if (n >= MAX_KEYS) throw bad(`At most ${MAX_KEYS} active keys; revoke one first`);
  const asked = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
  if (asked.some(s => !SCOPES[s])) throw bad(`Scopes are ${Object.keys(SCOPES).join(', ')}`);
  const scopes = [...new Set(['read', ...asked])];
  const rate = Math.round(+(req.body?.ratePerMin ?? DEFAULT_RATE));
  if (!(rate >= 1 && rate <= MAX_RATE)) throw bad(`The rate limit is 1 to ${MAX_RATE} requests a minute`);
  const name = String(req.body?.name || 'My API key').trim().slice(0, 40) || 'My API key';
  const token = PREFIX + randomToken(24);
  await run("INSERT INTO api_tokens (user_id, token_hash, name, hint, created_at, kind, scopes, rate_per_min) VALUES (?,?,?,?,?, 'api', ?, ?)", req.user.id, sha256(token), name, token.slice(-4), now(), JSON.stringify(scopes), rate);
  await audit(req.user.id, 'api_key_created', { name, scopes, rate }, req.ip);
  res.json({ token, name, scopes, ratePerMin: rate, note: 'Copy it now: it is shown only once and stored only as a hash.' });
}));
keysRouter.delete('/:id', wrap(async (req, res) => {
  const r = await run("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND kind = 'api' AND revoked_at IS NULL", now(), +req.params.id, req.user.id);
  if (!r.changes) throw bad('No such active key', 404);
  await audit(req.user.id, 'api_key_revoked', { id: +req.params.id }, req.ip);
  res.json({ ok: true });
}));

// ---------- /api/v1 ----------
// Which scope a request needs: GET reads; trading actions need 'trade'; other changes need 'write'.
const TRADE = /\/(deploy|pause|resume|skip|close|execute|stop)$/;
export const scopeFor = (method, path) => (method === 'GET' ? 'read' : TRADE.test(path) ? 'trade' : 'write');

async function keyAuth(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token.startsWith(PREFIX)) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Send your API key as: Authorization: Bearer bk_… (create one in Settings → Developer API)' });
  const k = await one("SELECT * FROM api_tokens WHERE token_hash = ? AND kind = 'api'", sha256(token));
  if (!k || k.revoked_at) return res.status(401).json({ error: k ? 'This API key was revoked' : 'Unknown API key' });
  const u = await one('SELECT * FROM users WHERE id = ?', k.user_id);
  if (!u) return res.status(401).json({ error: 'Unknown API key' });
  if (!rateLimit('apiv1:' + k.id, k.rate_per_min || DEFAULT_RATE, 60e3)) return res.status(429).set('Retry-After', '60').json({ error: `Rate limit: ${k.rate_per_min || DEFAULT_RATE} requests a minute for this key` });
  const scopes = J(k.scopes), need = scopeFor(req.method, req.path);
  if (!scopes.includes(need)) return res.status(403).json({ error: `This key does not have the "${need}" scope. Create a key with it in Settings → Developer API.` });
  await run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', now(), k.id);
  req.user = u; req.apiKey = { id: k.id, scopes };
  next();
}

export function v1Router({ accountsFor, accountSummary }) {
  const r = express.Router();
  r.get('/', (req, res) => res.json({ version: 'v1', docs: '/developers', openapi: '/openapi.json' }));
  r.use(keyAuth);
  r.get('/me', (req, res) => res.json({ id: req.user.id, scopes: req.apiKey.scopes }));
  r.get('/accounts', wrap(async (req, res) => {
    const list = await accountsFor(req.user.id).catch(() => []);
    const out = await Promise.all((list || []).map(async a => {
      const s = await accountSummary(req.user.id, a.id).catch(() => null);
      return { id: a.id, name: a.name || a.label || a.id, live: !!a.live, equity: s?.equity ?? null, cash: s?.cash ?? null, positions: (s?.positions || []).map(p => ({ symbol: p.symbol, qty: p.qty, value: p.value })) };
    }));
    res.json(out);
  }));
  r.use('/playbooks', playbooksRouter());
  r.use((req, res) => res.status(404).json({ error: 'Not found in API v1. See /openapi.json' }));
  return r;
}
