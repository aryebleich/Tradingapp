// Brightolio as an MCP server: users connect AI agents (Claude, ChatGPT, Cursor, Codex, VS Code or
// their own) to their own account with a personal access token (Intelligence → Agents & API). Every
// plan can connect: read tools, market scans, order books, news and practice orders. Orders on real
// accounts go through the user's agent boundaries and approvals (src/agentic.js) and need Pro
// (approval) or Elite (automatic). The plan also sets how many agents and requests a minute.
// Transport: MCP "Streamable HTTP" with plain JSON responses (POST /mcp, JSON-RPC 2.0).
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { randomToken, sha256 } from './crypto.js';
import { requireUser, rateLimit } from './auth.js';
import { aiLimits, upgrade } from './aiplans.js';
import * as AG from './agentic.js';

const PROTOCOL = '2025-06-18';
const TOKEN_PREFIX = 'qpk_';

// ---------- personal access tokens ----------
export const tokensRouter = express.Router();
tokensRouter.use(requireUser);
tokensRouter.get('/', async (req, res) => res.json(await all('SELECT id, name, hint, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id DESC', req.user.id)));
tokensRouter.post('/', async (req, res) => {
  const lim = aiLimits(req.user);
  if ((await one('SELECT COUNT(*) n FROM api_tokens WHERE user_id = ?', req.user.id)).n >= lim.agentTokens) { const e = upgrade(`More than ${lim.agentTokens} connected agent${lim.agentTokens === 1 ? '' : 's'}`, p => p.agentTokens > lim.agentTokens); return res.status(402).json({ error: e.message, upgrade: true, feature: e.feature }); }
  const token = TOKEN_PREFIX + randomToken(24), name = String(req.body?.name || 'AI assistant').slice(0, 40);
  await run('INSERT INTO api_tokens (user_id, token_hash, name, hint, created_at) VALUES (?,?,?,?,?)', req.user.id, sha256(token), name, token.slice(-4), now());
  await audit(req.user.id, 'api_token_created', { name }, req.ip);
  res.json({ token, name }); // shown once
});
tokensRouter.delete('/:id', async (req, res) => {
  await run('DELETE FROM api_tokens WHERE id = ? AND user_id = ?', +req.params.id, req.user.id);
  await audit(req.user.id, 'api_token_revoked', { id: +req.params.id }, req.ip);
  res.json({ ok: true });
});

// ---------- tools ----------
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const sym = { type: 'string', description: 'Ticker, e.g. AAPL, or a crypto pair such as BTC/USD' };
const acct = { type: 'string', description: 'Account id: paper (default), alpaca, or a connected broker such as tradier' };
const TOOLS = deps => ({
  get_account: {
    description: 'Balances and positions of one of the user\'s accounts.', inputSchema: S({ account: acct }),
    run: (u, a) => deps.accountSummary(u.id, a.account || 'paper'),
  },
  list_accounts: { description: 'The user\'s accounts and whether each is connected.', inputSchema: S({}), run: u => deps.accountsFor(u.id) },
  get_quote: {
    description: 'Latest price for a symbol.', inputSchema: S({ symbol: sym }, ['symbol']),
    run: async (u, a) => ({ symbol: String(a.symbol).toUpperCase(), price: await deps.lastPrice(String(a.symbol).toUpperCase(), u.id) }),
  },
  list_orders: { description: 'Recent orders on one account.', inputSchema: S({ account: acct }), run: (u, a) => deps.listOrders(u.id, a.account || 'paper') },
  get_news: {
    description: 'Today\'s news headlines for symbols (comma-separated).', inputSchema: S({ symbols: { type: 'string' } }, ['symbols']),
    run: async (u, a) => (await deps.news({ symbols: a.symbols, limit: 10 })).map(n => ({ headline: n.headline, symbols: n.symbols, at: n.created_at, url: n.url })),
  },
  scan_market: {
    description: 'Scan a universe of symbols: price, 1/5/20-day change, RSI(14) and whether price is above its 50-day average. universe: dow30, mega, nasdaq, etfs, crypto, or a comma-separated list (up to 60).',
    inputSchema: S({ universe: { type: 'string' }, sort: { type: 'string', enum: ['change1d', 'change5d', 'change20d', 'rsi14'] }, limit: { type: 'number' } }),
    run: (u, a) => AG.scan(u.id, a),
  },
  get_order_book: { description: 'Order book: bid, ask and spread; full depth for crypto.', inputSchema: S({ symbol: sym }, ['symbol']), run: (u, a) => AG.orderBook(u.id, a.symbol, deps) },
  get_signals: {
    description: 'Today\'s AI signals (setups with historical win rate, entry, stop and target), as many as the user\'s plan shows.',
    inputSchema: S({}), run: async u => (await import('./aisignals.js')).signalsFor(u),
  },
  get_boundaries: {
    description: 'The limits the user set for agents: per account off / approve / auto, largest order, daily limits, allowed and blocked symbols. Read these before submitting orders.',
    inputSchema: S({}), run: async u => { const b = await AG.boundaries(u.id), lim = aiLimits(u); return { ...b, planAllows: { realAccounts: lim.agentLive, extendedHours: lim.extendedHours } }; },
  },
  submit_order: {
    description: 'Submit an order to one of the user\'s accounts. It is checked against the user\'s boundaries and plan, then placed (automatic), queued for the user\'s approval, or refused with the reason. Give qty (shares) or notional (dollars); type market or limit (limit_price); always give a short reason.',
    inputSchema: S({ account: acct, symbol: sym, side: { type: 'string', enum: ['buy', 'sell'] }, qty: { type: 'number' }, notional: { type: 'number' }, type: { type: 'string', enum: ['market', 'limit'] }, limit_price: { type: 'number' }, extended_hours: { type: 'boolean' }, reason: { type: 'string' } }, ['symbol', 'side', 'reason']),
    run: (u, a, agent) => AG.submit(u, agent, a, deps),
  },
  list_agent_orders: {
    description: 'Orders agents submitted, with their status (placed, pending approval, rejected, blocked, failed).',
    inputSchema: S({}), run: async u => (await all('SELECT id, agent, account, symbol, side, qty, notional, type, limit_price, status, result, reason, created_at FROM agent_orders WHERE user_id = ? ORDER BY id DESC LIMIT 50', u.id)),
  },
  place_paper_order: {
    description: 'Place a market order on the PAPER account (simulated money). Give qty (shares) or notional (dollars).',
    inputSchema: S({ symbol: sym, side: { type: 'string', enum: ['buy', 'sell'] }, qty: { type: 'number' }, notional: { type: 'number' } }, ['symbol', 'side']),
    run: (u, a, agent) => AG.submit(u, agent, { ...a, account: 'paper', reason: a.reason || 'practice order' }, deps),
  },
});

export function mcpHandler(deps) {
  const tools = TOOLS(deps);
  return async (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const row = token.startsWith(TOKEN_PREFIX) ? await one('SELECT t.id tid, t.name tname, u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?', sha256(token)) : null;
    if (!row) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Add your Brightolio token as: Authorization: Bearer qpk_…' } });
    if (!rateLimit('mcp:' + row.id, aiLimits(row).apiPerMin, 60e3)) return res.status(429).json({ jsonrpc: '2.0', id: null, error: { code: -32003, message: 'Too many requests' } });
    await run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', now(), row.tid);
    const handle = async m => {
      const ok = result => ({ jsonrpc: '2.0', id: m.id, result }), err = (code, message) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
      if (m.id === undefined) return null; // notifications (e.g. notifications/initialized) need no answer
      switch (m.method) {
        case 'initialize': return ok({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'brightolio', version: '1.0.0' }, instructions: 'Brightolio trading account tools. Read get_boundaries before submit_order: every order is checked against the user\'s limits and plan, and may wait for the user\'s approval. Use the paper account to practice.' });
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
        case 'tools/call': {
          const t = tools[m.params?.name];
          if (!t) return err(-32602, 'Unknown tool');
          try {
            const out = await t.run(row, m.params.arguments || {}, row.tname || 'AI agent');
            return ok({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: Array.isArray(out) ? { items: out } : out });
          } catch (e) { return ok({ content: [{ type: 'text', text: e.message }], isError: true }); }
        }
        default: return err(-32601, 'Method not found');
      }
    };
    const body = req.body;
    if (Array.isArray(body)) { const out = (await Promise.all(body.map(handle))).filter(Boolean); return out.length ? res.json(out) : res.status(202).end(); }
    if (!body || body.jsonrpc !== '2.0') return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Send a JSON-RPC 2.0 message' } });
    const out = await handle(body);
    return out ? res.json(out) : res.status(202).end();
  };
}
