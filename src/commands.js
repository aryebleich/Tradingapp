// Text/voice command interpreter shared by SMS and the phone hotline.
import { one, all, run, now } from './db.js';
import { verifySecret } from './crypto.js';
import { accountSummary, placeOrder, lastPrice } from './brokers.js';
import { nextRunAfter } from './scheduler.js';
import { isPaid } from './fees.js';
import { performance, earnings, chartText, earningsText } from './events.js';

export const HELP = `Brightolio by text (every plan):
AAPL - price   AAPL CHART - 1 week, month, year
AAPL EARNINGS - next date   AAPL NEWS - headlines
AAPL INFO - what the company does, size, P/E
WATCH AAPL · UNWATCH AAPL · LIST - your watchlist
ALERT AAPL 250 - text me when AAPL crosses $250 · ALERTS
BAL · POS - practice account   PLAN - what your plan includes
MY CODE - your referral code
Trading (PIN at the end): BUY 5 AAPL 1234 · SELL 5 AAPL 1234 · BUY $100 AAPL 1234
(add LIVE for Alpaca, or SCHWAB, TRADIER, TASTYTRADE, TRADESTATION)
Pro and up: DCA $50 SPY WEEKLY 1234 · ORDERS · CANCEL 7 1234 · BOTS · PAUSE 1234
and questions in your own words ("how is my account doing?")`;

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, fifty: 50, hundred: 100 };
const NAMES = { apple: 'AAPL', microsoft: 'MSFT', tesla: 'TSLA', amazon: 'AMZN', google: 'GOOGL', nvidia: 'NVDA', meta: 'META', 's&p': 'SPY', spy: 'SPY', qqq: 'QQQ' };
// Words that pick the account: LIVE / ALPACA, or another connected brokerage.
const ACCOUNT_WORDS = { LIVE: 'alpaca', ALPACA: 'alpaca', TRADIER: 'tradier', TASTYTRADE: 'tastytrade', SCHWAB: 'schwab', TRADESTATION: 'tradestation' };
const ACCOUNT_NAMES = { paper: 'Paper', alpaca: 'Alpaca', tradier: 'Tradier', tastytrade: 'tastytrade', schwab: 'Schwab', tradestation: 'TradeStation' };
export const KNOWN = ['HELP', 'MENU', '?', 'BAL', 'BALANCE', 'POS', 'POSITIONS', 'PRICE', 'QUOTE', 'CHART', 'EARNINGS', 'NEWS', 'INFO', 'BUY', 'SELL', 'DCA', 'ORDERS', 'CANCEL', 'BOTS', 'PAUSE', 'WATCH', 'UNWATCH', 'LIST', 'ALERT', 'ALERTS', 'PLAN', 'MY', 'CODE'];
// Commands that work on every plan, including Starter (free).
export const FREE_COMMANDS = ['HELP', 'MENU', '?', 'BAL', 'BALANCE', 'POS', 'POSITIONS', 'PRICE', 'QUOTE', 'CHART', 'EARNINGS', 'NEWS', 'INFO', 'BUY', 'SELL', 'WATCH', 'UNWATCH', 'LIST', 'ALERT', 'ALERTS', 'PLAN', 'MY', 'CODE'];
const money = x => '$' + (+x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function normalize(text) {
  return String(text || '').toLowerCase().replace(/[.,!?]/g, ' ').split(/\s+/).filter(Boolean)
    .filter(w => !['shares', 'share', 'of', 'please', 'dollars', 'worth', 'stock', 'my', 'pin', 'is'].includes(w))
    .map(w => WORDS[w] ?? NAMES[w] ?? w).join(' ').toUpperCase();
}

// pinVerified lets the voice hotline (which checks the PIN up front) skip the trailing PIN.
export async function handleCommand(user, text, { pinVerified = false } = {}) {
  const t = normalize(text).split(' ');
  const cmd = t[0];
  const word = t.find(x => ACCOUNT_WORDS[x]);
  const args = t.filter(x => !ACCOUNT_WORDS[x]);
  const account = word ? ACCOUNT_WORDS[word] : 'paper';
  // Placing your own orders by text works on every plan; recurring buys (DCA) on a real account are automation (Pro).
  if (account !== 'paper' && !isPaid(user) && cmd === 'DCA') return 'Recurring buys on a brokerage account are part of Pro. Try it free for 14 days in the app under Plans & billing.';
  const pinOk = () => pinVerified || (user.pin_hash && verifySecret(args[args.length - 1], user.pin_hash));
  const needPin = 'That needs your PIN at the end. Set one in Settings > Phone.';

  // Stock look-ups: "AAPL", "AAPL CHART", "AAPL EARNINGS", "AAPL NEWS" (or "CHART AAPL"...).
  const LOOK = ['CHART', 'EARNINGS', 'NEWS', 'PRICE', 'QUOTE', 'INFO'];
  const isTicker = x => /^[A-Z][A-Z0-9.]{0,5}$/.test(x || '') && !KNOWN.includes(x) && !ACCOUNT_WORDS[x];
  let look = null;
  if (isTicker(args[0]) && (args.length === 1 ? !CHAT_WORDS.has(args[0]) : LOOK.includes(args[1]))) look = { sym: args[0], what: args[1] || 'PRICE' };
  else if (['CHART', 'EARNINGS', 'NEWS', 'INFO'].includes(cmd) && isTicker(args[1])) look = { sym: args[1], what: cmd };
  if (look) return lookup(user, look.sym, look.what);

  switch (cmd) {
    case 'HELP': case 'MENU': case '?': return HELP;
    case 'BAL': case 'BALANCE': {
      const s = await accountSummary(user.id, account);
      return `${ACCOUNT_NAMES[account]}: equity ${money(s.equity)}, cash ${money(s.cash)}`;
    }
    case 'POS': case 'POSITIONS': {
      const s = await accountSummary(user.id, account);
      return s.positions.length ? s.positions.map(p => `${p.symbol} ${p.qty} @ ${money(p.price)} (${p.pnl >= 0 ? '+' : ''}${money(p.pnl)})`).join('\n') : 'No positions.';
    }
    case 'PRICE': case 'QUOTE': {
      if (!args[1]) return 'Usage: PRICE AAPL';
      return `${args[1]} ${money(await lastPrice(args[1], user.id))}`;
    }
    case 'BUY': case 'SELL': {
      if (!pinOk()) return needPin;
      const [, amt, sym] = args;
      if (!amt || !sym) return 'Usage: BUY 5 AAPL 1234 or BUY $100 AAPL 1234';
      const order = amt.startsWith('$') ? { notional: +amt.slice(1) } : { qty: +amt };
      const r = await placeOrder(user.id, account, { ...order, symbol: sym, side: cmd.toLowerCase() }, 'sms');
      return `${r.side.toUpperCase()} ${r.symbol}: ${r.status}${r.price ? ' @ ' + money(r.price) : ''} (${r.broker})`;
    }
    case 'DCA': {
      if (!pinOk()) return needPin;
      const [, amt, sym, freq = 'WEEKLY'] = args;
      const repeat = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }[freq] || 'weekly';
      if (!amt?.startsWith('$') || !sym) return 'Usage: DCA $50 SPY WEEKLY 1234';
      const r = await run('INSERT INTO scheduled_orders (user_id, account, symbol, side, notional, repeat, next_run, created_at) VALUES (?,?,?,?,?,?,?,?)',
        user.id, account, sym, 'buy', +amt.slice(1), repeat, nextRunAfter(now(), 'daily'), now());
      return `Scheduled #${r.lastInsertRowid}: buy ${amt} ${sym} ${repeat}.`;
    }
    case 'ORDERS': {
      const rows = await all('SELECT * FROM scheduled_orders WHERE user_id = ? AND active = 1', user.id);
      return rows.length ? rows.map(o => `#${o.id} ${o.side} ${o.qty ?? '$' + o.notional} ${o.symbol} ${o.repeat} next ${new Date(o.next_run).toISOString().slice(0, 16)}Z`).join('\n') : 'No scheduled trades.';
    }
    case 'CANCEL': {
      if (!pinOk()) return needPin;
      const r = await run('UPDATE scheduled_orders SET active = 0 WHERE id = ? AND user_id = ?', +args[1], user.id);
      return r.changes ? `Cancelled #${args[1]}.` : 'Not found.';
    }
    case 'BOTS': {
      const rows = await all('SELECT id, name, symbol, deployed, last_action FROM strategies WHERE user_id = ? AND deployed IS NOT NULL', user.id);
      return rows.length ? rows.map(b => `#${b.id} ${b.name} ${b.symbol} on ${b.deployed}${b.last_action ? ' - ' + b.last_action : ''}`).join('\n') : 'No bots running.';
    }
    case 'PAUSE': {
      if (!pinOk()) return needPin;
      await run('UPDATE strategies SET deployed = NULL WHERE user_id = ?', user.id);
      await run('UPDATE scheduled_orders SET active = 0 WHERE user_id = ?', user.id);
      return 'All bots and scheduled trades paused.';
    }
    case 'WATCH': case 'UNWATCH': case 'LIST': {
      const { getSetting, setSetting } = await import('./settings.js');
      let list = (await getSetting(user.id, 'marketWatch', ['AAPL', 'MSFT', 'NVDA'])) || [];
      const syms = args.slice(1).filter(x => /^[A-Z][A-Z0-9.]{0,5}$/.test(x));
      if (cmd !== 'LIST') {
        if (!syms.length) return `Add the symbol: ${cmd} AAPL`;
        list = cmd === 'WATCH' ? [...new Set([...list, ...syms])].slice(0, 30) : list.filter(x => !syms.includes(x));
        await setSetting(user.id, 'marketWatch', list);
      }
      if (!list.length) return 'Your watchlist is empty. Text WATCH AAPL to add one.';
      const rows = await Promise.all(list.slice(0, 12).map(async x => { const p = await lastPrice(x, user.id).catch(() => null); return `${x} ${p ? money(p) : '-'}`; }));
      return `${cmd === 'LIST' ? 'Your watchlist' : cmd === 'WATCH' ? `Added ${syms.join(', ')}. Your watchlist` : `Removed ${syms.join(', ')}. Your watchlist`}:\n${rows.join('\n')}${list.length > 12 ? `\n(+${list.length - 12} more in the app)` : ''}`;
    }
    case 'ALERT': {
      const sym = args.find(x => /^[A-Z][A-Z0-9.]{0,5}$/.test(x) && x !== 'ALERT'), price = +args.find(x => /^\$?\d+(\.\d+)?$/.test(x))?.replace('$', '');
      if (!sym || !(price > 0)) return 'Write it like this: ALERT AAPL 250';
      const now$ = await lastPrice(sym, user.id).catch(() => null);
      const op = now$ && price < now$ ? 'below' : 'above';
      const n = (await one('SELECT COUNT(*) n FROM alerts WHERE user_id = ? AND active = 1', user.id)).n;
      const max = { free: 5, pro: 50, elite: 200, ultimate: 1000 }[isPaid(user) ? user.plan : 'free'] || 5;
      if (n >= max) return `You have ${n} alerts, the most your plan allows (${max}). Text ALERTS to see them, or remove some in the app.`;
      await run('INSERT INTO alerts (user_id, symbol, op, price, created_at) VALUES (?,?,?,?,?)', user.id, sym, op, price, now());
      return `Alert set: we'll text you when ${sym} goes ${op} ${money(price)}${now$ ? ` (now ${money(now$)})` : ''}.`;
    }
    case 'ALERTS': {
      const list = await all('SELECT symbol, op, price FROM alerts WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 10', user.id);
      return list.length ? 'Your alerts:\n' + list.map(a => `${a.symbol} ${a.op} ${money(a.price)}`).join('\n') : 'No alerts yet. Text ALERT AAPL 250 to add one.';
    }
    case 'PLAN': {
      const { PLANS } = await import('./fees.js'), { config } = await import('./credits.js');
      const plan = isPaid(user) ? user.plan : 'free', p = PLANS[plan] || PLANS.free;
      const st = await one('SELECT monthly_left + bought AS left FROM credit_state WHERE user_id = ?', user.id).catch(() => null);
      return `Your plan: ${p.name}.\nBy text: prices, charts, earnings, news, company info, watchlist, alerts and your own trades${plan === 'free' ? '' : ', plus recurring buys, bots and questions in your own words'}.\nEach reply uses 1 credit (${config().monthly[plan] ?? 0} a month on ${p.name}${st?.left != null ? `; ${st.left} left now` : ''}).${plan === 'free' ? '\nUpgrade in the app under Plans & billing.' : ''}`;
    }
    case 'MY': case 'CODE': {
      if (cmd === 'MY' && args[1] !== 'CODE') return 'Unknown command. Text HELP for the list.';
      const { refNumFor } = await import('./smssignup.js');
      const code = await refNumFor(user.id);
      return `Your referral code: ${code}\nFriends text their email and your code to this number, for example: name@example.com ${code}`;
    }
    default: return 'Unknown command. Text HELP for the list.';
  }
}

// One-word texts that are conversation, not a ticker.
export const CHAT_WORDS = new Set(['HI', 'HEY', 'HELLO', 'HIYA', 'YO', 'THANKS', 'THANK', 'THX', 'TY', 'OK', 'OKAY', 'K', 'YES', 'YEAH', 'YEP', 'NO', 'NOPE', 'SURE', 'COOL', 'GREAT', 'NICE', 'WOW', 'LOL', 'BYE', 'WHAT', 'WHY', 'HOW', 'WHO', 'WHEN', 'MENU', 'INFO', 'START', 'UNSTOP']);
async function lookup(user, sym, what) {
  try {
    if (what === 'CHART') return chartText(await performance(sym, user.id));
    if (what === 'EARNINGS') return earningsText(await earnings(sym));
    if (what === 'INFO') {
      const { profile } = await import('./fundamentals.js');
      const p = await profile(sym, user.id);
      if (p.kind === 'etf') return `${p.name} (${sym}): ${p.etf.about} Tracks ${p.etf.index}. Yearly cost ${p.etf.expenseRatio}%${p.price ? `. Price ${money(p.price)}` : ''}.`;
      const r = p.ratios || {}, c = p.company || {};
      return [`${p.name} (${sym})${c.industry ? `: ${c.industry.toLowerCase()}` : ''}`, p.price ? `Price ${money(p.price)}` : null, r.capClass ? `Size: ${r.capClass.name}${r.marketCap ? ` (about $${Math.round(r.marketCap / 1e9)} billion)` : ''}` : null, r.pe ? `P/E ${r.pe}` : null, p.fundamentals?.revenueGrowth != null ? `Sales growth ${p.fundamentals.revenueGrowth}%` : null, p.perf?.change1y != null ? `1 year ${p.perf.change1y >= 0 ? '+' : ''}${p.perf.change1y}%` : null].filter(Boolean).join('\n');
    }
    if (what === 'NEWS') {
      const D = await import('./alpaca/data.js');
      if (!D.dataEnabled()) return 'News is not set up on this server yet.';
      const n = await D.news({ symbols: sym, limit: 3 });
      return n.length ? `${sym} news:\n` + n.map(x => `- ${x.headline} (${x.source}, ${new Date(x.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`).join('\n') : `No recent news for ${sym}.`;
    }
    const p = await performance(sym, user.id).catch(() => null);
    if (p) return `${sym} ${money(p.price)} (1 week ${p.week >= 0 ? '+' : ''}${p.week?.toFixed(1)}%). Text ${sym} CHART or ${sym} EARNINGS for more.`;
    return `${sym} ${money(await lastPrice(sym, user.id))}`;
  } catch (e) { return e.setup ? 'Earnings data is not set up on this server yet.' : `Could not look up ${sym}: ${e.message}`; }
}

export const userByPhone = phone => one('SELECT * FROM users WHERE phone = ? AND phone_verified = 1', phone);
