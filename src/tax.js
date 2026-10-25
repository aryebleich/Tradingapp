// Realized gains (FIFO lots), holding period, wash-sale flags and a rough tax estimate.
// Informational only: brokers issue the official 1099-B.
const DAY = 86400e3;

export function realizedGains(fills) {
  const lots = {}, out = [];
  const sorted = [...fills].sort((a, b) => a.at - b.at);
  for (const f of sorted) {
    const book = (lots[f.symbol] ||= []);
    if (f.side === 'buy') { book.push({ qty: f.qty, price: f.price, at: f.at }); continue; }
    let left = f.qty;
    while (left > 1e-9 && book.length) {
      const lot = book[0], q = Math.min(left, lot.qty);
      const gain = (f.price - lot.price) * q;
      out.push({ symbol: f.symbol, qty: +q.toFixed(6), acquired: lot.at, sold: f.at, proceeds: +(f.price * q).toFixed(2), cost: +(lot.price * q).toFixed(2), gain: +gain.toFixed(2), longTerm: f.at - lot.at > 365 * DAY, washSale: false });
      lot.qty -= q; left -= q;
      if (lot.qty <= 1e-9) book.shift();
    }
  }
  // Wash sale: a loss with a purchase of the same symbol within 30 days before or after.
  for (const r of out) {
    if (r.gain >= 0) continue;
    r.washSale = sorted.some(f => f.side === 'buy' && f.symbol === r.symbol && Math.abs(f.at - r.sold) <= 30 * DAY && f.at !== r.acquired);
  }
  return out;
}

const ltRate = bracket => (bracket <= 0.12 ? 0 : bracket <= 0.35 ? 0.15 : 0.20);

export function taxSummary(fills, { year, bracket = 0.24, stateRate = 0.05 }) {
  const rows = realizedGains(fills).filter(r => new Date(r.sold).getUTCFullYear() === year);
  const sum = pred => +rows.filter(pred).reduce((a, r) => a + r.gain, 0).toFixed(2);
  const st = sum(r => !r.longTerm && !r.washSale), lt = sum(r => r.longTerm && !r.washSale);
  const disallowed = +rows.filter(r => r.washSale).reduce((a, r) => a - r.gain, 0).toFixed(2);
  // Net losses offset gains; up to $3,000 of net loss offsets ordinary income.
  const netSt = st, net = netSt + lt;
  let tax = 0;
  if (net > 0) {
    const stTaxable = Math.max(0, netSt + Math.min(lt, 0)), ltTaxable = Math.max(0, lt + Math.min(netSt, 0));
    tax = stTaxable * (bracket + stateRate) + ltTaxable * (ltRate(bracket) + stateRate);
  } else tax = -Math.min(3000, -net) * (bracket + stateRate);
  return { year, rows, shortTerm: st, longTerm: lt, washSaleDisallowed: disallowed, net: +net.toFixed(2), estimatedTax: +tax.toFixed(2), ltRate: ltRate(bracket), bracket, stateRate, carryforward: net < -3000 ? +(-net - 3000).toFixed(2) : 0 };
}

export function harvestCandidates(positions) {
  return positions.filter(p => p.pnl < -50).map(p => ({ symbol: p.symbol, unrealized: +p.pnl.toFixed(2), note: 'Selling realizes the loss; buying it back within 30 days makes it a wash sale.' }));
}

export function form8949Csv(rows) {
  const fmt = t => new Date(t).toISOString().slice(0, 10);
  const head = 'Description,Date acquired,Date sold,Proceeds,Cost basis,Adjustment code,Adjustment,Gain or loss,Term';
  return [head, ...rows.map(r => [`${r.qty} sh ${r.symbol}`, fmt(r.acquired), fmt(r.sold), r.proceeds, r.cost, r.washSale ? 'W' : '', r.washSale ? -r.gain : 0, r.washSale ? 0 : r.gain, r.longTerm ? 'Long' : 'Short'].join(','))].join('\n');
}

// Schedule D summary from the Form 8949 rows (all lots treated as basis reported to the IRS,
// boxes A and D). Wash-sale losses are added back as adjustments (code W).
export function scheduleD(summary) {
  const part = long => {
    const rows = summary.rows.filter(r => r.longTerm === long);
    const proceeds = rows.reduce((a, r) => a + r.proceeds, 0), cost = rows.reduce((a, r) => a + r.cost, 0), adj = rows.filter(r => r.washSale).reduce((a, r) => a - r.gain, 0);
    return { lots: rows.length, proceeds: +proceeds.toFixed(2), cost: +cost.toFixed(2), adjustments: +adj.toFixed(2), gain: +(proceeds - cost + adj).toFixed(2) };
  };
  const st = part(false), lt = part(true), total = +(st.gain + lt.gain).toFixed(2);
  return { year: summary.year, line1b_shortTerm: st, line7_netShortTerm: st.gain, line8b_longTerm: lt, line15_netLongTerm: lt.gain, line16_total: total, line21_allowedLoss: total < 0 ? Math.max(total, -3000) : null };
}
export const scheduleDCsv = d => ['Line,Description,Proceeds,Cost basis,Adjustments,Gain or loss',
  `1b,Short-term (Form 8949 box A),${d.line1b_shortTerm.proceeds},${d.line1b_shortTerm.cost},${d.line1b_shortTerm.adjustments},${d.line1b_shortTerm.gain}`,
  `7,Net short-term gain or loss,,,,${d.line7_netShortTerm}`,
  `8b,Long-term (Form 8949 box D),${d.line8b_longTerm.proceeds},${d.line8b_longTerm.cost},${d.line8b_longTerm.adjustments},${d.line8b_longTerm.gain}`,
  `15,Net long-term gain or loss,,,,${d.line15_netLongTerm}`,
  `16,Total,,,,${d.line16_total}`, ...(d.line21_allowedLoss != null ? [`21,Loss allowed this year (max $3000),,,,${d.line21_allowedLoss}`] : [])].join('\n');

// Mark-to-market (Section 475(f) trader election): every gain or loss is ordinary income, wash-sale
// rules do not apply, and positions still open at year end count as sold at their year-end price.
export function markToMarket(fills, positions, { year, bracket = 0.24, stateRate = 0.05 }) {
  const realized = realizedGains(fills).filter(r => new Date(r.sold).getUTCFullYear() === year).reduce((a, r) => a + r.gain, 0);
  const unrealized = positions.reduce((a, p) => a + (p.pnl || 0), 0);
  const ordinary = realized + unrealized;
  return { year, realized: +realized.toFixed(2), markedToMarket: +unrealized.toFixed(2), ordinaryIncome: +ordinary.toFixed(2), estimatedTax: +(ordinary * (bracket + stateRate)).toFixed(2), note: 'Open positions are valued at today\'s price until the year ends. The election must be made with the IRS by the due date of the prior year\'s return.' };
}
