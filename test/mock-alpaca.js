// A small in-memory imitation of Alpaca's Broker, Trading, Market Data and OAuth APIs so the
// integration can be tested without network access. Every request is recorded for assertions.
import http from 'node:http';

export function startMock() {
  const log = [];
  const accounts = new Map(); // broker account id -> { status, polls, acct }
  const books = new Map();    // trading account key -> { orders, positions, watchlists }
  const ach = new Map(), transfers = new Map();
  let seq = 0;
  const id = p => `${p}-${++seq}`;
  const book = k => books.get(k) || books.set(k, { orders: [], positions: [{ symbol: 'AAPL', asset_class: 'us_equity', side: 'long', qty: '10', qty_available: '10', avg_entry_price: '150', current_price: '180', market_value: '1800', cost_basis: '1500', unrealized_pl: '300', unrealized_plpc: '0.2', unrealized_intraday_pl: '20', unrealized_intraday_plpc: '0.011', change_today: '0.011' }], watchlists: [], config: { dtbp_check: 'entry', fractional_trading: true, max_margin_multiplier: '4', no_shorting: false, pdt_check: 'entry', suspend_trade: false, trade_confirm_email: 'all' } }).get(k);
  const tradeAccount = () => ({ id: 'acct', account_number: 'PA123', status: 'ACTIVE', currency: 'USD', equity: '101800', last_equity: '100500', cash: '100000', buying_power: '200000', regt_buying_power: '200000', daytrading_buying_power: '400000', non_marginable_buying_power: '100000', options_buying_power: '100000', long_market_value: '1800', short_market_value: '0', initial_margin: '900', maintenance_margin: '540', multiplier: '2', sma: '0', daytrade_count: 0, pattern_day_trader: false, trading_blocked: false, shorting_enabled: true, crypto_status: 'ACTIVE', options_trading_level: 2 });

  function trading(key, path, method, body, query) {
    const b = book(key);
    let m;
    if (path === '/account') return tradeAccount();
    if (path === '/account/configurations') return method === 'PATCH' ? Object.assign(b.config, body) : b.config;
    if (path === '/account/portfolio/history') return { timestamp: [1700000000, 1700086400, 1700172800], equity: [100000, 99000, 101800], profit_loss: [0, -1000, 1800], profit_loss_pct: [0, -0.01, 0.018], base_value: 100000, timeframe: query.timeframe };
    if (path === '/orders' && method === 'POST') { const o = { id: id('ord'), status: 'accepted', ...body, submitted_at: new Date().toISOString(), filled_qty: '0' }; b.orders.unshift(o); return o; }
    if (path === '/orders' && method === 'GET') return b.orders.filter(o => query.status !== 'open' || ['accepted', 'new'].includes(o.status));
    if (path === '/orders' && method === 'DELETE') { const r = b.orders.filter(o => o.status === 'accepted').map(o => ((o.status = 'canceled'), { id: o.id, status: 200 })); return r; }
    if ((m = /^\/orders\/([^/]+)$/.exec(path))) {
      const o = b.orders.find(x => x.id === m[1]);
      if (!o) return { __status: 404, message: 'order not found' };
      if (method === 'DELETE') { o.status = 'canceled'; return null; }
      if (method === 'PATCH') { o.status = 'replaced'; const n = { ...o, ...body, id: id('ord'), status: 'accepted', replaces: o.id }; b.orders.unshift(n); return n; }
      return o;
    }
    if (path === '/positions' && method === 'GET') return b.positions;
    if (path === '/positions' && method === 'DELETE') { const r = b.positions.map(p => ({ symbol: p.symbol, status: 200 })); b.positions = []; return r; }
    if ((m = /^\/positions\/([^/]+)$/.exec(path)) && method === 'DELETE') {
      const p = b.positions.find(x => x.symbol === decodeURIComponent(m[1]));
      if (!p) return { __status: 404, message: 'position does not exist' };
      const qty = query.qty ? +query.qty : query.percentage ? +p.qty * query.percentage / 100 : +p.qty;
      p.qty = String(+p.qty - qty); if (+p.qty <= 0) b.positions = b.positions.filter(x => x !== p);
      return { id: id('ord'), symbol: p.symbol, side: 'sell', qty: String(qty), status: 'accepted' };
    }
    if (path === '/watchlists' && method === 'GET') return b.watchlists;
    if (path === '/watchlists' && method === 'POST') { const w = { id: id('wl'), name: body.name, assets: (body.symbols || []).map(symbol => ({ symbol })) }; b.watchlists.push(w); return w; }
    if ((m = /^\/watchlists\/([^/]+)(?:\/([^/]+))?$/.exec(path))) {
      const w = b.watchlists.find(x => x.id === m[1]);
      if (!w) return { __status: 404, message: 'watchlist not found' };
      if (m[2] && method === 'DELETE') { w.assets = w.assets.filter(a => a.symbol !== decodeURIComponent(m[2])); return w; }
      if (method === 'POST') { w.assets.push({ symbol: body.symbol }); return w; }
      if (method === 'PUT') { if (body.name) w.name = body.name; if (body.symbols) w.assets = body.symbols.map(symbol => ({ symbol })); return w; }
      if (method === 'DELETE') { b.watchlists = b.watchlists.filter(x => x !== w); return null; }
      return w;
    }
    if (path === '/clock') return { timestamp: new Date().toISOString(), is_open: true, next_open: '2026-10-23T13:30:00Z', next_close: '2026-10-22T20:00:00Z' };
    if (path === '/calendar') return [{ date: '2026-10-23', open: '09:30', close: '16:00' }, { date: '2026-11-27', open: '09:30', close: '13:00' }];
    if (path === '/assets') return [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', class: 'us_equity', tradable: true, fractionable: true, shortable: true }, { symbol: 'AMZN', name: 'Amazon.com Inc.', exchange: 'NASDAQ', class: 'us_equity', tradable: true }];
    if (path === '/corporate_actions/announcements') return [{ id: 'ca1', ca_type: 'dividend', ca_sub_type: 'cash', initiating_symbol: 'AAPL', ex_date: '2026-11-07', payable_date: '2026-11-14', cash: '0.26' }];
    return { __status: 404, message: 'not found ' + path };
  }

  function data(path, query) {
    const syms = String(query.symbols || '').split(',').filter(Boolean);
    const bar = (i, base) => ({ t: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), o: base + i, h: base + i + 2, l: base + i - 1, c: base + i + 1, v: 1000 + i });
    if (path === '/v2/stocks/bars' || path === '/v1beta3/crypto/us/bars') {
      // Two pages to exercise pagination.
      const page = query.page_token ? 2 : 1;
      return { bars: Object.fromEntries(syms.map(s => [s, [bar(page * 2, 100), bar(page * 2 + 1, 100)]])), next_page_token: page === 1 ? 'p2' : null };
    }
    if (/\/(stocks\/quotes|crypto\/us\/latest\/quotes|stocks\/quotes\/latest)/.test(path)) return { quotes: Object.fromEntries(syms.map(s => [s, { bp: 99.5, ap: 100.5, t: new Date().toISOString() }])) };
    if (/trades/.test(path)) return { trades: Object.fromEntries(syms.map(s => [s, { p: 100, s: 5, t: new Date().toISOString() }])) };
    if (path === '/v2/stocks/snapshots') return Object.fromEntries(syms.map(s => [s, { latestTrade: { p: 110 }, latestQuote: { bp: 109.9, ap: 110.1 }, dailyBar: bar(0, 108), prevDailyBar: { c: 100 } }]));
    if (path === '/v1beta3/crypto/us/snapshots') return { snapshots: Object.fromEntries(syms.map(s => [s, { latestTrade: { p: 60000 }, prevDailyBar: { c: 50000 }, dailyBar: bar(0, 59000) }])) };
    if (path === '/v1beta1/screener/stocks/most-actives') return { most_actives: [{ symbol: 'NVDA', volume: 5e7, trade_count: 4e5 }], last_updated: new Date().toISOString() };
    if (/\/v1beta1\/screener\/(stocks|crypto)\/movers/.test(path)) return { gainers: [{ symbol: 'XYZ', percent_change: 25, change: 2, price: 10 }], losers: [{ symbol: 'ABC', percent_change: -20, change: -3, price: 12 }], market_type: 'stocks' };
    if (path === '/v1beta1/news') return { news: [{ id: 1, headline: 'Apple beats estimates', summary: 'Strong quarter', source: 'benzinga', url: 'https://example.com/n1', symbols: ['AAPL'], created_at: new Date().toISOString() }] };
    if (path.startsWith('/v1beta1/options/snapshots/')) return { snapshots: {
      AAPL261120C00150000: { latestQuote: { bp: 5.1, ap: 5.3 }, latestTrade: { p: 5.2 }, impliedVolatility: 0.31, greeks: { delta: 0.55, gamma: 0.03, theta: -0.05, vega: 0.12, rho: 0.04 } },
      AAPL261120P00150000: { latestQuote: { bp: 4.0, ap: 4.2 }, impliedVolatility: 0.33, greeks: { delta: -0.45, gamma: 0.03, theta: -0.04, vega: 0.12, rho: -0.03 } },
      AAPL261218C00160000: { latestQuote: { bp: 3.0, ap: 3.2 }, impliedVolatility: 0.29, greeks: { delta: 0.4, gamma: 0.02, theta: -0.03, vega: 0.15, rho: 0.05 } },
    } };
    if (path === '/v1/corporate-actions') return { corporate_actions: { cash_dividends: [{ symbol: 'AAPL', rate: 0.26, ex_date: '2026-11-07' }] } };
    return { __status: 404, message: 'not found ' + path };
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), path = u.pathname, query = Object.fromEntries(u.searchParams);
      const ct = req.headers['content-type'] || '';
      const body = raw ? (ct.includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))) : null;
      log.push({ method: req.method, path, query, body, headers: req.headers });
      const send = (out, status = 200) => {
        if (out && out.__status) { status = out.__status; out = { code: status * 100, message: out.message }; }
        res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(out == null ? '' : JSON.stringify(out));
      };
      const auth = req.headers.authorization || '', key = req.headers['apca-api-key-id'];
      let m;
      if (path === '/oauth/token') return body?.code === 'good-code' ? send({ access_token: 'oauth-token-123', token_type: 'bearer', scope: 'account:write trading data' }) : send({ __status: 401, message: 'invalid code' });
      if (path.startsWith('/v1/') && !path.startsWith('/v1/corporate-actions')) {
        if (auth !== 'Basic ' + Buffer.from('BKEY:BSECRET').toString('base64')) return send({ __status: 401, message: 'bad broker auth' });
        if (path === '/v1/accounts' && req.method === 'POST') {
          if (!body?.identity?.tax_id || !body.agreements?.length) return send({ __status: 422, message: 'missing fields' });
          const a = { id: id('bacct'), account_number: '9' + seq, status: 'SUBMITTED', crypto_status: 'SUBMITTED', currency: 'USD', last_equity: '0', created_at: new Date().toISOString(), contact: body.contact, identity: body.identity, agreements: body.agreements, enabled_assets: body.enabled_assets };
          accounts.set(a.id, { polls: 0, a }); return send(a);
        }
        if ((m = /^\/v1\/accounts\/([^/]+)$/.exec(path))) {
          const r = accounts.get(m[1]); if (!r) return send({ __status: 404, message: 'account not found' });
          if (req.method === 'PATCH') { Object.assign(r.a.contact, body.contact); return send(r.a); }
          // Sandbox-style progression on each read: SUBMITTED -> APPROVED -> ACTIVE.
          r.polls++; r.a.status = r.polls >= 2 ? 'ACTIVE' : 'APPROVED'; r.a.crypto_status = r.a.status;
          return send(r.a);
        }
        if ((m = /^\/v1\/accounts\/([^/]+)\/ach_relationships(?:\/([^/]+))?$/.exec(path))) {
          const list = ach.get(m[1]) || ach.set(m[1], []).get(m[1]);
          if (req.method === 'POST') { const r = { id: id('ach'), status: 'APPROVED', account_owner_name: body.account_owner_name, bank_account_type: body.bank_account_type, bank_account_number: '****' + body.bank_account_number.slice(-4), nickname: body.nickname }; list.push(r); return send(r); }
          if (req.method === 'DELETE') { ach.set(m[1], list.filter(x => x.id !== m[2])); return send(null, 204); }
          return send(list);
        }
        if ((m = /^\/v1\/accounts\/([^/]+)\/transfers(?:\/([^/]+))?$/.exec(path))) {
          const list = transfers.get(m[1]) || transfers.set(m[1], []).get(m[1]);
          if (req.method === 'POST') { const t = { id: id('tr'), status: 'QUEUED', ...body, created_at: new Date().toISOString() }; list.unshift(t); return send(t); }
          if (req.method === 'DELETE') { const t = list.find(x => x.id === m[2]); if (t) t.status = 'CANCELED'; return send(null, 204); }
          return send(list);
        }
        if ((m = /^\/v1\/trading\/accounts\/([^/]+)(\/.*)$/.exec(path))) return send(trading('broker:' + m[1], m[2], req.method, body, query));
        return send(trading('broker-global', path.slice(3), req.method, body, query));
      }
      if (path.startsWith('/v2/') && !path.startsWith('/v2/stocks')) {
        const k = auth.startsWith('Bearer ') ? 'oauth:' + auth.slice(7) : key ? 'keys:' + key : null;
        if (!k || (auth.startsWith('Bearer ') && auth !== 'Bearer oauth-token-123')) return send({ __status: 401, message: 'unauthorized' });
        return send(trading(k, path.slice(3), req.method, body, query));
      }
      if (!key && !auth.startsWith('Basic ')) return send({ __status: 401, message: 'no data auth' });
      return send(data(path, query));
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, log, close: () => server.close(), accounts })));
}
