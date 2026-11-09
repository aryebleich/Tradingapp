// Contextual learning: a small "?" next to financial terms in labels, table headers and stat tiles
// opens a one-line explanation, right where the number is.
import { t } from '../i18n.js';

export const TERMS = {
  'sharpe': 'Return per unit of risk: average excess return divided by volatility. Above 1 is good, above 2 is excellent.',
  'sortino': 'Like the Sharpe ratio, but only counts downside swings as risk.',
  'max drawdown': 'The largest fall from a peak to a later low. It shows the worst loss you would have sat through.',
  'cagr': 'Compound annual growth rate: the steady yearly return that gets you from start to end.',
  'per year': 'The steady yearly return that would produce the same overall result (compound annual growth).',
  'volatility': 'How much the value swings, as a yearly percentage. Higher means a bumpier ride.',
  'profit factor': 'Money made on winning trades divided by money lost on losing trades. Above 1 means profitable.',
  'expectancy': 'The average profit or loss per trade you can expect from this record.',
  'win rate': 'The share of closed trades that made money. A low win rate can still be profitable if wins are large.',
  'slippage': 'The difference between the price you expected and the price you got.',
  'time-weighted return': 'Your return with deposits and withdrawals taken out, so it measures decisions, not contributions.',
  'beta': 'How much a holding tends to move when the S&P 500 moves 1%. A beta of 2 moves about twice as much.',
  'delta': 'How much an option price moves for a $1 move in the stock; also a rough chance of expiring in the money.',
  'iv': 'Implied volatility: the move the options market is pricing in, as a yearly percentage.',
  'implied volatility': 'The move the options market is pricing in, as a yearly percentage. High IV makes options expensive.',
  'break-even': 'The price at which the position neither makes nor loses money at expiration.',
  'stop loss': 'Sells automatically if the price falls a set amount, to limit a loss.',
  'take profit': 'Sells automatically once the price rises a set amount, to lock in a gain.',
  'trailing stop': 'A stop that follows the price up and sells if it falls a set percentage from the high.',
  'buying power': 'How much you can buy right now, including any margin your broker lends you.',
  'maintenance requirement': 'The equity your broker requires you to keep; below it you get a margin call.',
  'leverage': 'Investments divided by your own money. Above 1x means you are using borrowed money.',
  'wash-sale': 'A loss you cannot deduct yet because you bought the same stock within 30 days of selling it.',
  'maaser': 'Giving a tenth of your profit to tzedakah. Some give a fifth (chomesh).',
  'price improvement': 'Getting a better price than the quoted bid or ask when your order fills.',
  'fill rate': 'The share of orders sent to a brokerage that were filled.',
  'rsi': 'Relative Strength Index (0-100): below 30 is often called oversold, above 70 overbought.',
  'credit': 'Money you receive when opening an options position by selling.',
  'capital at risk': 'The most you can lose on the trade.',
  'rebalance': 'Buying and selling to bring holdings back to their target weights.',
  'effective independent bets': 'How many truly different investments you hold once you account for holdings that move together.',
  // Everyday account words, for people new to investing.
  'equity': 'What the account is worth right now: cash plus everything you own at today\'s prices.',
  'profit / loss': 'How much more or less the account is worth than what was put in.',
  'p/l': 'Profit or loss: the current value minus what you paid.',
  'avg': 'The average price you paid per share, across all your purchases.',
  'positions': 'A position is something you own (or are short): the shares, what you paid and what they are worth now.',
  'order type': 'Market buys or sells right away at the current price. Limit only at your price or better. Stop becomes a market order once the price reaches your stop.',
  'limit price': 'The worst price you accept: a buy fills at this price or lower, a sell at this price or higher. It may not fill at all.',
  'stop price': 'When the price reaches this level, the order is sent. Often used to limit a loss.',
  'time in force': 'How long an order stays open: Day ends at the 4 PM New York close; GTC (good till cancelled) stays until it fills or you cancel it.',
  'extended hours': 'Trading before the market opens (from 4 AM) or after it closes (until 8 PM New York time). Fewer buyers and sellers, so prices can jump more.',
  'fractional': 'Part of a share. Buying $50 of a $500 stock gets you 0.1 shares.',
  // Options.
  'strike': 'The price at which an option lets you buy (call) or sell (put) the shares.',
  'expiration': 'The last day an option can be used. After it, the option is worth nothing unless it is in the money.',
  'premium': 'The price of an option, paid by the buyer to the seller. Quoted per share; one contract is 100 shares.',
  'bid': 'The highest price a buyer is offering right now. You sell at about the bid.',
  'ask': 'The lowest price a seller is asking right now. You buy at about the ask.',
  'spread': 'The gap between the bid and the ask. A wide spread makes trading in and out more expensive.',
  'open interest': 'How many option contracts are open. Higher usually means easier to trade.',
  'theta': 'How much an option loses in value each day as expiration gets closer, if nothing else changes.',
  'gamma': 'How fast delta changes when the stock moves.',
  'vega': 'How much an option price changes when implied volatility moves one point.',
  'call': 'An option that gains value when the stock rises: the right to buy 100 shares at the strike.',
  'put': 'An option that gains value when the stock falls: the right to sell 100 shares at the strike.',
  // Company and fund numbers.
  'p/e': 'Price-to-earnings: the share price divided by a year of profit per share. A P/E of 20 means you pay $20 for each $1 of yearly profit.',
  'pe ratio': 'Price-to-earnings: the share price divided by a year of profit per share. Compare it with similar companies.',
  'eps': 'Earnings per share: the company\'s profit divided by its number of shares.',
  'surprise': 'How far reported earnings were above (a beat) or below (a miss) what analysts expected.',
  'dividend yield': 'Yearly dividends as a percentage of the share price. 3% means $3 a year for every $100 invested.',
  'expense ratio': 'A fund\'s yearly cost, as a percentage of what you invest. 0.10% costs $10 a year per $10,000.',
  'market cap': 'What the whole company is worth on the stock market: share price times the number of shares.',
  'yield': 'The yearly income an investment pays, as a percentage of its price.',
  'alpha': 'Return beyond what the market\'s moves would explain. Positive alpha means it did better than its risk suggests.',
  // Margin and shorting.
  'initial margin': 'The part of a purchase you must pay with your own money when buying on margin, usually 50%.',
  'maintenance margin': 'The minimum equity you must keep in a margin account. Fall below it and you get a margin call.',
  'margin call': 'A demand from the brokerage to add money or sell holdings because your equity fell too low. If you do not, it can sell for you.',
  'short interest': 'How many shares of a stock are sold short, often shown as a percentage of the shares that trade.',
  'borrow': 'To short a stock, the brokerage lends you the shares. Hard-to-borrow stocks can carry a daily fee.',
  // Charts and indicators.
  'volume': 'How many shares changed hands. Price moves on high volume tend to mean more.',
  'moving average': 'The average closing price over the last number of days. It smooths out daily noise to show the trend.',
  'sma': 'Simple moving average: the plain average of the last closing prices.',
  'ema': 'Exponential moving average: an average that gives more weight to recent days, so it reacts faster.',
  'macd': 'A trend indicator from two moving averages. Its line crossing above the signal line is often read as momentum turning up.',
  'bollinger': 'Bands two standard deviations above and below a moving average. Prices near a band are stretched compared with usual.',
  'vwap': 'Volume-weighted average price for the day: the average price paid, weighted by how many shares traded at each price.',
  // Quant and planning.
  'z-score': 'How unusual a value is compared with its history, in standard deviations. Beyond 2 or -2 is unusual.',
  'correlation': 'How closely two investments move together, from -1 (opposite) to 1 (in step).',
  'cointegration': 'Two prices that may wander apart but tend to come back to a steady relationship.',
  'half-life': 'How many days a gap usually takes to close halfway.',
  'drawdown': 'A fall from a previous high. A 20% drawdown means it is 20% below its peak.',
  'cost basis': 'What you paid for an investment, including fees. Your gain or loss is measured from it.',
  'short-term': 'Held a year or less. Gains are taxed like ordinary income.',
  'long-term': 'Held more than a year. Gains are usually taxed at a lower rate.',
  'dollar-cost averaging': 'Investing the same amount at regular times, so you buy more shares when prices are low and fewer when high.',
  'diversification': 'Spreading money over many investments, so one bad one hurts less.',
  'allocation': 'How your money is divided between kinds of investments, such as stocks, bonds and cash.',
};
const keys = Object.keys(TERMS).sort((a, b) => b.length - a.length);
// Short everyday words only count when they are the whole label ("Ask", "Calls"), never the start
// of an unrelated one ("Ask the AI assistant", "Spread money evenly").
const EXACT = new Set(['ask', 'bid', 'call', 'put', 'premium', 'spread', 'long-term', 'short-term', 'yield', 'positions', 'volume', 'strike', 'expiration', 'borrow', 'allocation', 'equity', 'avg', 'surprise', 'alpha', 'drawdown', 'correlation', 'fractional']);
const starts = (s, k) => EXACT.has(k) ? [k, k + 's', k + ':', k + 's:'].includes(s) || s === k + ' (%)' : s === k || s.startsWith(k + ' ') || s.startsWith(k + ':') || s.startsWith(k + ' /');
// In other languages the visible label is translated, so the translated term is matched too.
const local = () => keys.map(k => [t(k[0].toUpperCase() + k.slice(1)).toLowerCase(), k]).filter(([l, k]) => l !== k);
const match = txt => { const s = txt.trim().toLowerCase(); return keys.find(k => starts(s, k)) || local().find(([l]) => starts(s, l))?.[1]; };

let pop;
function show(btn) {
  pop ||= Object.assign(document.createElement('div'), { className: 'glpop', role: 'tooltip' });
  pop.textContent = t(TERMS[btn.dataset.term]);
  document.body.append(pop);
  const r = btn.getBoundingClientRect(), w = Math.min(300, innerWidth - 24);
  pop.style.width = w + 'px';
  pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = (r.bottom + scrollY + 6) + 'px';
  pop.hidden = false;
  pop.shownAt = Date.now();
}
addEventListener('click', e => {
  const b = e.target.closest('.gl');
  if (b) { e.preventDefault(); e.stopPropagation(); if (pop && !pop.hidden && pop.dataset.for === b.dataset.term) { pop.hidden = true; return; } show(b); pop.dataset.for = b.dataset.term; return; }
  if (pop) pop.hidden = true;
}, true);
// Scrolling closes it, except the scroll that brought the "?" into view just before the tap.
addEventListener('scroll', () => { if (pop && Date.now() - pop.shownAt > 400) pop.hidden = true; }, { passive: true });

export function attachGlossary(root) {
  for (const el of root.querySelectorAll('.stat > span:first-child, th, h2, h3, label:not(.chk)')) {
    if (el.dataset.gl) continue;
    el.dataset.gl = '1';
    const first = [...el.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
    // Text is matched on the English source (stored before translation) or the visible text.
    const src = el.dataset.en || first?.nodeValue || '';
    const k = match(src); if (!k) continue;
    const b = document.createElement('span');
    b.className = 'gl'; b.dataset.term = k; b.setAttribute('role', 'button'); b.tabIndex = 0; b.setAttribute('aria-label', 'What does this mean?'); b.textContent = '?';
    if (first) first.after(b); else el.prepend(b);
  }
}
