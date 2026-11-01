// The order desk: shared by the quick ticket on the dashboard and the full Trade page.
//  - a plain-English guide to each order type, with a small picture of where it fills;
//  - what the account holds of the symbol, and "Sell all";
//  - costs: commission, SEC and FINRA fees on sales, half the spread and expected slippage;
//  - ways to bet on a fall without a margin account (inverse funds, puts);
//  - the desk strip: price, its data source and response time, bid/ask, spread, session clock.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (x, d = 2) => (x == null || isNaN(x) ? '-' : (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

export const ORDER_TYPES = {
  market: { name: 'Market', short: 'Fills right away at the best price available now.',
    when: 'You want in or out now and the stock trades a lot (tight spread).', risk: 'The price is not guaranteed: in a fast market or a thinly traded stock you can pay more (or get less) than the last price.' },
  limit: { name: 'Limit', short: 'Fills only at your price or better.',
    when: 'You care more about the price than about filling right away.', risk: 'It may never fill if the price does not reach your limit.' },
  stop: { name: 'Stop (stop loss)', short: 'Waits until the price reaches your stop, then becomes a market order.',
    when: 'To limit a loss (sell stop below the price) or to buy a breakout (buy stop above).', risk: 'Once triggered it fills at the market, which can be well past your stop after a gap.' },
  stop_limit: { name: 'Stop limit', short: 'Waits for your stop price, then becomes a limit order at your limit price.',
    when: 'You want the trigger of a stop but no worse than a set price.', risk: 'If the price jumps past your limit, it may not fill at all and you stay in the position.' },
  trailing_stop: { name: 'Trailing stop', short: 'A stop that follows the price up (for a sell) by a set % or $ and never moves back.',
    when: 'To lock in gains while letting a winner run.', risk: 'Fills at the market when hit, like a stop.' },
};

// A small picture: the current price, the order's lines, and the zone where it fills.
export function orderPicture(type, side, px, limit, stop) {
  if (!(px > 0)) px = 100;
  const buy = side === 'buy', w = 260, h = 92;
  const L = +limit || (type === 'limit' || type === 'stop_limit' ? (buy ? px * 0.97 : px * 1.03) : null);
  const S = +stop || (type === 'stop' || type === 'stop_limit' ? (buy ? px * 1.03 : px * 0.97) : null);
  const vals = [px, L, S].filter(v => v > 0), hi = Math.max(...vals) * 1.01, lo = Math.min(...vals) * 0.99;
  const y = v => 8 + (hi - v) / (hi - lo || 1) * (h - 16);
  const line = (v, label, cls) => `<line x1="0" x2="${w}" y1="${y(v)}" y2="${y(v)}" class="${cls}"/><text x="${w - 4}" y="${y(v) - 3}" text-anchor="end" class="${cls}">${label} ${usd(v)}</text>`;
  let zone = '';
  if (type === 'limit' || type === 'stop_limit') zone = buy ? `<rect x="0" y="${y(L)}" width="${w}" height="${h - y(L)}" class="fillzone"/>` : `<rect x="0" y="0" width="${w}" height="${y(L)}" class="fillzone"/>`;
  return `<svg class="opic" viewBox="0 0 ${w} ${h}" role="img" aria-label="Where this order fills">${zone}${line(px, 'Now', 'now')}${L ? line(L, 'Limit', 'lim') : ''}${S ? line(S, 'Stop', 'stp') : ''}</svg>`;
}
export function guide(type, side, px, limit, stop) {
  const t = ORDER_TYPES[type] || ORDER_TYPES.market;
  const how = { market: side === 'buy' ? 'Buys at the current ask.' : 'Sells at the current bid.',
    limit: side === 'buy' ? 'Buys only at your limit or lower (shaded).' : 'Sells only at your limit or higher (shaded).',
    stop: side === 'buy' ? 'When the price rises to your stop, buys at the market.' : 'When the price falls to your stop, sells at the market.',
    stop_limit: side === 'buy' ? 'When the price rises to the stop, places a buy limit; fills in the shaded zone.' : 'When the price falls to the stop, places a sell limit; fills in the shaded zone.',
    trailing_stop: side === 'buy' ? 'Follows the price down and buys when it bounces back up by your trail.' : 'Follows the price up and sells when it drops back by your trail.' }[type] || '';
  return `<div class="oguide"><div><b>${esc(t.name)}</b>: ${esc(t.short)} ${esc(how)}<br><span class="mu"><b>Use it when</b> ${esc(t.when)} <b>Watch out:</b> ${esc(t.risk)}</span></div>${type === 'trailing_stop' ? '' : orderPicture(type, side, px, limit, stop)}</div>`;
}
export function costBox(c, side) {
  if (!c) return '<p class="mu small-print">Enter a quantity to see what the trade costs.</p>';
  const row = (k, v, tip = '') => `<span${tip ? ` title="${esc(tip)}"` : ''}>${k}</span><span class="num">${v}</span>`;
  return `<div class="kv costs">${row('Order value', usd(c.value))}${row('Commission', c.commission ? usd(c.commission) : '$0.00 (commission-free)')}
    ${side === 'sell' ? row('SEC + FINRA fees', usd(c.regulatory, 4), 'Regulatory fees on sales: SEC Section 31 and the FINRA trading activity fee') : ''}
    ${c.spread != null ? row('Spread', `${usd(c.spread, 4)} (${c.spreadBps} bps)`, 'The gap between the best bid and ask') : ''}
    ${c.halfSpread ? row('Crossing the spread', usd(c.halfSpread)) : ''}${c.slippage ? row('Expected slippage', usd(c.slippage), 'Fast markets and large orders can fill a little worse than the quote') : ''}
    ${row('<b>Estimated total cost</b>', `<b>${usd(c.total)}</b>`)}</div>`;
}
export function holdingLine(h, symbol, side) {
  if (!h) return '';
  if (h.qty > 0) return `<p class="holdline">You own <b>${+(+h.qty).toFixed(6)}</b> ${esc(symbol)}${h.avgPrice ? ` at ${usd(h.avgPrice)} average` : ''}${h.available < h.qty ? ` · ${+(+h.available).toFixed(6)} free to sell` : ''}${side === 'sell' ? ' <button type="button" class="small ghost" id="sellAll">Sell all</button>' : ''}</p>`;
  if (h.qty < 0) return `<p class="holdline">You are short <b>${Math.abs(h.qty)}</b> ${esc(symbol)}.</p>`;
  return side === 'sell' ? `<p class="holdline">You do not own ${esc(symbol)} in this account.</p>` : '';
}
// Betting on a fall without margin: no US broker lets an account under $2,000 sell short (FINRA
// rule 4210 requires a margin account with at least $2,000 equity), so these are the alternatives.
const INVERSE = { SPY: ['SH', 'ProShares Short S&P 500 (-1x)'], VOO: ['SH', 'ProShares Short S&P 500 (-1x)'], QQQ: ['PSQ', 'ProShares Short QQQ (-1x)'], DIA: ['DOG', 'ProShares Short Dow 30 (-1x)'], IWM: ['RWM', 'ProShares Short Russell 2000 (-1x)'], XLF: ['SEF', 'ProShares Short Financials (-1x)'], TLT: ['TBF', 'ProShares Short 20+ Year Treasury (-1x)'], EEM: ['EUM', 'ProShares Short MSCI Emerging Markets (-1x)'] };
export function bearishAlternatives(symbol) {
  const inv = INVERSE[symbol];
  return `<details class="bearalt"><summary>Want to profit if ${esc(symbol)} falls? (No short selling under $2,000)</summary>
    <p class="mu">Short selling needs a margin account with at least <b>$2,000</b> (FINRA rule 4210); no US brokerage allows it in smaller or cash accounts. Ways to bet on a fall that only risk what you put in:</p>
    <ul>${inv ? `<li><b>Buy an inverse fund:</b> <a href="#/trade?symbol=${inv[0]}">${inv[0]}</a>, ${esc(inv[1])}. Rises when ${esc(symbol)} falls; best for days or weeks, it drifts over long periods.</li>` : '<li><b>Inverse funds</b> exist for the big indexes (SH for the S&amp;P 500, PSQ for the Nasdaq-100, RWM for small caps).</li>'}
      <li><b>Buy a put option</b> on ${esc(symbol)}: you can lose at most what the put cost. <a href="#/options?underlying=${encodeURIComponent(symbol)}">Open the options chain</a> (needs options approval).</li>
      <li><b>Sell what you own</b> and wait in cash.</li></ul></details>`;
}
// The strip over the ticket: price, source, response time, bid/ask, spread and the session clock.
export function deskStrip(d) {
  const s = d.session, until = t => { const m = Math.max(0, Math.round((t - Date.now()) / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`; };
  return `<div class="deskstrip"><span class="sess ${s.open ? 'on' : ''}"><i></i>${s.open ? `Market open · closes in ${until(s.nextClose)}` : `${s.status === 'pre-market' ? 'Pre-market' : s.status === 'after-hours' ? 'After hours' : s.holiday ? 'Holiday: market closed' : 'Market closed'} · opens in ${until(s.nextOpen)}`}</span>
    <span>Last <b class="num">${usd(d.price)}</b></span>${d.bid ? `<span>Bid <b class="num">${usd(d.bid)}</b> · Ask <b class="num">${usd(d.ask)}</b></span>` : ''}
    <span title="Where the price came from and how long it took">${esc(d.source)} · <b class="num">${d.latencyMs} ms</b></span>${d.orderLatency ? `<span title="Your orders: time from sending to the broker accepting it">Order ack <b class="num">${d.orderLatency.medianMs} ms</b> median</span>` : ''}</div>`;
}
