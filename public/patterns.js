// Candlestick pattern recognition on bars { o, h, l, c } (oldest first). Shared by the chart (to
// highlight patterns) and the server-side scanner (to trigger on them). Returns one entry per
// pattern found: { i (index of the last candle), name, bias: 'bull' | 'bear' | 'neutral' }.
export const PATTERNS = {
  doji: 'Doji', hammer: 'Hammer', inverted_hammer: 'Inverted hammer', hanging_man: 'Hanging man', shooting_star: 'Shooting star',
  bull_engulfing: 'Bullish engulfing', bear_engulfing: 'Bearish engulfing', piercing: 'Piercing line', dark_cloud: 'Dark cloud cover',
  morning_star: 'Morning star', evening_star: 'Evening star', three_soldiers: 'Three white soldiers', three_crows: 'Three black crows',
  bull_harami: 'Bullish harami', bear_harami: 'Bearish harami', bull_marubozu: 'Bullish marubozu', bear_marubozu: 'Bearish marubozu',
};
const body = b => Math.abs(b.c - b.o), range = b => b.h - b.l || 1e-9, up = b => b.c > b.o, down = b => b.c < b.o;
const upper = b => b.h - Math.max(b.o, b.c), lower = b => Math.min(b.o, b.c) - b.l, mid = b => (b.o + b.c) / 2;
// Direction of the 5 bars before i, measured on closes.
const trend = (bars, i) => (i < 5 ? 0 : Math.sign(bars[i - 1].c - bars[i - 5].c));

export function detect(bars, from = 0) {
  const out = [], avgBody = [];
  for (let i = 0; i < bars.length; i++) { const s = bars.slice(Math.max(0, i - 10), i).map(body); avgBody.push(s.length ? s.reduce((a, b) => a + b, 0) / s.length : body(bars[i])); }
  for (let i = Math.max(from, 2); i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1], q = bars[i - 2], t = trend(bars, i), big = x => body(x) > avgBody[i] * 1.1, small = x => body(x) < avgBody[i] * 0.5;
    const add = (name, bias) => out.push({ i, name, bias });
    if (body(b) <= range(b) * 0.1) add('doji', 'neutral');
    const hammerShape = lower(b) >= body(b) * 2 && upper(b) <= body(b) * 0.6 && body(b) > range(b) * 0.05;
    const invShape = upper(b) >= body(b) * 2 && lower(b) <= body(b) * 0.6 && body(b) > range(b) * 0.05;
    if (hammerShape && t < 0) add('hammer', 'bull');
    if (hammerShape && t > 0) add('hanging_man', 'bear');
    if (invShape && t < 0) add('inverted_hammer', 'bull');
    if (invShape && t > 0) add('shooting_star', 'bear');
    if (down(p) && up(b) && b.o <= p.c && b.c >= p.o && body(b) > body(p)) add('bull_engulfing', 'bull');
    if (up(p) && down(b) && b.o >= p.c && b.c <= p.o && body(b) > body(p)) add('bear_engulfing', 'bear');
    if (down(p) && big(p) && up(b) && b.o < p.c && b.c > mid(p) && b.c < p.o) add('piercing', 'bull');
    if (up(p) && big(p) && down(b) && b.o > p.c && b.c < mid(p) && b.c > p.o) add('dark_cloud', 'bear');
    if (down(q) && big(q) && small(p) && up(b) && b.c > mid(q)) add('morning_star', 'bull');
    if (up(q) && big(q) && small(p) && down(b) && b.c < mid(q)) add('evening_star', 'bear');
    if ([q, p, b].every(up) && p.c > q.c && b.c > p.c && [q, p, b].every(x => upper(x) < body(x) * 0.5)) add('three_soldiers', 'bull');
    if ([q, p, b].every(down) && p.c < q.c && b.c < p.c && [q, p, b].every(x => lower(x) < body(x) * 0.5)) add('three_crows', 'bear');
    if (down(p) && big(p) && up(b) && Math.max(b.o, b.c) < p.o && Math.min(b.o, b.c) > p.c) add('bull_harami', 'bull');
    if (up(p) && big(p) && down(b) && Math.max(b.o, b.c) < p.c && Math.min(b.o, b.c) > p.o) add('bear_harami', 'bear');
    if (up(b) && big(b) && upper(b) + lower(b) < range(b) * 0.06) add('bull_marubozu', 'bull');
    if (down(b) && big(b) && upper(b) + lower(b) < range(b) * 0.06) add('bear_marubozu', 'bear');
  }
  return out;
}
