// Bonds, crypto & AI: Alpaca's newer add-ons in one place. Treasury and bond prices by ISIN,
// crypto quotes across liquidity venues, connecting AI assistants (QuantPocket's own MCP server,
// Alpaca's Trading MCP server and CLI), and multi-leg options.
let H;
export function registerTools(routes, helpers) { H = helpers; routes['alpaca-tools'] = tools; }

const code = s => `<pre data-no-tr><code>${H.esc(s)}</code></pre>`;
const FIELD = { p: 'Price', bp: 'Bid', ap: 'Ask', ytm: 'Yield to maturity', by: 'Bid yield', ay: 'Ask yield', y: 'Yield', bs: 'Bid size', as: 'Ask size', t: 'Time' };
const fields = o => (o ? Object.entries(o).map(([k, v]) => `<span class="kvp"><span class="mu">${FIELD[k] || k}</span> <b data-no-tr>${k === 't' ? new Date(v).toLocaleString() : H.esc(String(v))}</b></span>`).join('') : '<span class="mu">No data</span>');

async function tools(view) {
  const origin = location.origin, paid = H.paid(), admin = H.me()?.role === 'admin';
  const tokens = await H.api('/tokens').catch(() => []);
  view.innerHTML = `<h1>Bonds, crypto & AI</h1><p class="mu">The newest Alpaca add-ons, ready to use.</p>
  <form class="card" id="fi"><h2>Treasuries and bonds</h2><p class="mu">Latest prices and quotes (bid, ask and yield) for bonds and Treasury bills by ISIN. Beta data from Alpaca.</p>
    <div class="row"><label>ISINs (comma-separated)<input name="isins" value="US912797KJ59, US912797KS58, US912797SX61" data-no-tr></label><button>Look up</button></div><div class="err"></div><div id="fiOut"></div></form>

  <form class="card" id="cv"><h2>Crypto across venues</h2><p class="mu">The same coin can trade at slightly different prices at each liquidity source: Alpaca US, Kraken US and Kraken EU.</p>
    <div class="row"><label>Pairs<input name="syms" value="BTC/USD, ETH/USD" data-no-tr></label><button>Compare</button></div><div class="err"></div><div id="cvOut"></div></form>

  <div class="card"><h2>Connect AI assistants to QuantPocket</h2>
    <p>Ask Claude, Cursor or VS Code about your portfolio, prices and news, and let them place <b>paper</b> trades. Real-money orders always stay with you.</p>
    ${paid ? `<div class="row"><input id="tokName" placeholder="Name, e.g. Claude Desktop" style="max-width:280px"><button id="newTok">Create a token</button></div><div class="err"></div><div id="tokOut"></div>
      <div class="tablewrap"><table><tr><th>Name</th><th>Ends with</th><th>Created</th><th>Last used</th><th></th></tr>${tokens.map(t => `<tr><td>${H.esc(t.name)}</td><td data-no-tr>…${H.esc(t.hint || '')}</td><td>${H.date(t.created_at)}</td><td>${t.last_used_at ? H.date(t.last_used_at) : '-'}</td><td><button class="small ghost" data-revoke="${t.id}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="5" class="mu">No tokens yet</td></tr>'}</table></div>
      <h3>Add it to your assistant</h3>${code(JSON.stringify({ mcpServers: { quantpocket: { type: 'http', url: origin + '/mcp', headers: { Authorization: 'Bearer YOUR_QUANTPOCKET_TOKEN' } } } }, null, 2))}`
      : '<p class="banner">Part of Pro. <a href="#/funding">Start a free trial</a> to connect your AI assistant.</p>'}
    <p class="mu small-print">Tools: get_account, list_accounts, get_quote, list_orders, get_news, place_paper_order.</p></div>

  <div class="card"><h2>Alpaca's own AI and command-line tools</h2>
    <h3>Trading API MCP server</h3><p class="mu">About 65 tools for trading, market data and account management in Claude, Cursor or VS Code. Runs on your computer with your Alpaca keys (never paste keys into a chat).</p>
    ${code(`// ~/.cursor/mcp.json or claude_desktop_config.json
{
  "mcpServers": {
    "alpaca": {
      "command": "uvx",
      "args": ["alpaca-mcp-server"],
      "env": { "ALPACA_API_KEY": "your_key", "ALPACA_SECRET_KEY": "your_secret" }
    }
  }
}`)}
    <h3>Trading CLI</h3><p class="mu">Trade from the terminal, also usable by AI agents.</p>
    ${code(`alpaca order submit --symbol AAPL --side buy --qty 10 --type market
alpaca position list
alpaca order cancel-all`)}
    ${admin ? `<h3>Broker API MCP server (owner)</h3><p class="mu">Manage customer accounts, trading and funding from an AI assistant, with OAuth sign-in. Sandbox shown; use the live host once approved.</p>
    ${code(`// VS Code .vscode/mcp.json
{
  "servers": {
    "alpaca-broker-mcp-sandbox": { "type": "http", "url": "https://broker-api.sandbox.alpaca.markets/mcp" }
  }
}`)}` : ''}</div>

  <div class="card"><h2>Multi-leg options</h2><p>Spreads, straddles and iron condors go out as one order with up to four legs, so every leg fills together or not at all. Build one in the <a href="#/optionslab">Options lab</a> or the <a href="#/options">options chain</a>. Professional desks can send the same orders over FIX (New Order - Multileg).</p></div>`;

  const fi = H.$('#fi', view);
  H.act(H.$('button', fi), async () => {
    const d = await H.api('/alpaca/data/fixed-income?isins=' + encodeURIComponent(fi.isins.value.replace(/\s/g, '')));
    H.$('#fiOut', fi).innerHTML = d.map(x => `<div class="firow"><b data-no-tr>${x.isin}</b><div>${fields(x.price)}</div><div>${fields(x.quote)}</div></div>`).join('');
    return '';
  });
  const cv = H.$('#cv', view);
  H.act(H.$('button', cv), async () => {
    const d = await H.api('/alpaca/data/crypto-venues?symbols=' + encodeURIComponent(cv.syms.value.replace(/\s/g, '')));
    H.$('#cvOut', cv).innerHTML = d.map(x => {
      const bestBid = Math.max(...x.venues.map(v => v.bid || 0)), bestAsk = Math.min(...x.venues.map(v => v.ask || Infinity));
      return `<h3 data-no-tr>${x.symbol}</h3><div class="tablewrap"><table><tr><th>Venue</th><th>Bid</th><th>Ask</th><th>Spread</th></tr>${x.venues.map(v => `<tr><td>${H.esc(v.name)}</td><td class="${v.bid === bestBid ? 'pos' : ''}">${H.money(v.bid)}</td><td class="${v.ask === bestAsk ? 'pos' : ''}">${H.money(v.ask)}</td><td>${v.bid && v.ask ? ((v.ask - v.bid) / v.ask * 1e4).toFixed(1) + ' bps' : '-'}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">No quotes</td></tr>'}</table></div>`;
    }).join('');
    return '';
  });
  if (H.$('#newTok', view)) H.act(H.$('#newTok', view), async () => {
    const r = await H.api('/tokens', { body: { name: H.$('#tokName', view).value } });
    H.$('#tokOut', view).innerHTML = `<p class="banner">Copy it now; it is shown only once: <code data-no-tr>${H.esc(r.token)}</code></p>`;
    return '';
  });
  H.$$('[data-revoke]', view).forEach(b => H.act(b, async () => { await H.api('/tokens/' + b.dataset.revoke, { method: 'DELETE' }); H.render(); }));
}
