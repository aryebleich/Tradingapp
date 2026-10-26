// Contextual learning: a small "?" next to financial terms in labels, table headers and stat tiles
// opens a one-line explanation, right where the number is.
import { t } from './i18n.js';

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
  'nisab': 'The minimum wealth (85 g of gold or 595 g of silver) above which zakat is due.',
  'price improvement': 'Getting a better price than the quoted bid or ask when your order fills.',
  'fill rate': 'The share of orders sent to a brokerage that were filled.',
  'rsi': 'Relative Strength Index (0-100): below 30 is often called oversold, above 70 overbought.',
  'credit': 'Money you receive when opening an options position by selling.',
  'capital at risk': 'The most you can lose on the trade.',
  'rebalance': 'Buying and selling to bring holdings back to their target weights.',
  'effective independent bets': 'How many truly different investments you hold once you account for holdings that move together.',
};
const keys = Object.keys(TERMS).sort((a, b) => b.length - a.length);
const starts = (s, k) => s === k || s.startsWith(k + ' ') || s.startsWith(k + ':') || s.startsWith(k + ' /');
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
