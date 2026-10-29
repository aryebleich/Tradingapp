// Brightfolio as an MCP server: users connect Claude, Cursor or VS Code to their own account with a
// personal access token (Settings → AI assistants). Read tools for every account; orders only on the
// paper account, so an AI assistant can never move real money. Paid plans only.
// Transport: MCP "Streamable HTTP" with plain JSON responses (POST /mcp, JSON-RPC 2.0).
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { randomToken, sha256 } from './crypto.js';
import { requireUser, rateLimit } from './auth.js';
import { isPaid } from './fees.js';

const PROTOCOL = '2025-06-18';
const TOKEN_PREFIX = 'qpk_';

// ---------- personal access tokens ----------
export const tokensRouter = express.Router();
tokensRouter.use(requireUser);
tokensRouter.get('/', async (req, res) => res.json(await all('SELECT id, name, hint, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id DESC', req.user.id)));
tokensRouter.post('/', async (req, res) => {
  if (!isPaid(req.user)) return res.status(402).json({ error: 'Connecting AI assistants is part of Pro', upgrade: true, feature: 'AI assistants (MCP)' });
  if ((await one('SELECT COUNT(*) n FROM api_tokens WHERE user_id = ?', req.user.id)).n >= 10) return res.status(400).json({ error: 'Up to 10 tokens' });
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
  place_paper_order: {
    description: 'Place a market order on the PAPER account only (simulated money). Give qty (shares) or notional (dollars).',
    inputSchema: S({ symbol: sym, side: { type: 'string', enum: ['buy', 'sell'] }, qty: { type: 'number' }, notional: { type: 'number' } }, ['symbol', 'side']),
    run: (u, a) => deps.placeOrder(u.id, 'paper', { symbol: a.symbol, side: a.side, qty: a.qty, notional: a.notional }, 'mcp'),
  },
});

export function mcpHandler(deps) {
  const tools = TOOLS(deps);
  return async (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const row = token.startsWith(TOKEN_PREFIX) ? await one('SELECT t.id tid, u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?', sha256(token)) : null;
    if (!row) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Add your Brightfolio token as: Authorization: Bearer qpk_…' } });
    if (!isPaid(row)) return res.status(402).json({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Connecting AI assistants is part of Pro' } });
    if (!rateLimit('mcp:' + row.id, 120, 60e3)) return res.status(429).json({ jsonrpc: '2.0', id: null, error: { code: -32003, message: 'Too many requests' } });
    await run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', now(), row.tid);
    const handle = async m => {
      const ok = result => ({ jsonrpc: '2.0', id: m.id, result }), err = (code, message) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
      if (m.id === undefined) return null; // notifications (e.g. notifications/initialized) need no answer
      switch (m.method) {
        case 'initialize': return ok({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'brightfolio', version: '1.0.0' }, instructions: 'Brightfolio trading account tools. Orders go to the paper account only.' });
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
        case 'tools/call': {
          const t = tools[m.params?.name];
          if (!t) return err(-32602, 'Unknown tool');
          try {
            const out = await t.run(row, m.params.arguments || {});
            if (m.params.name === 'place_paper_order') await audit(row.id, 'mcp_order', { symbol: m.params.arguments.symbol, side: m.params.arguments.side }, req.ip);
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
