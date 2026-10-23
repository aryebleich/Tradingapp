// The MULTI_STRATEGIES (v8.3) sheet as editable strategy definitions.
//
// Tree strategies are lists of steps, walked from the first step like the sheet's daily walkdown:
//   cmp     a <op> b  -> yes : no           (b is another indicator or a number)
//   band    a > hi -> hiTo ; a < lo -> loTo ; otherwise -> mid   (RSI exhaustion gates)
//   higher  a >= b -> aTo : bTo             ("pick the higher RSI")
//   vote    count of conditions that hold >= need -> yes : no
//   missing a step whose rule is not in the sheet export; the walk stops there
// Targets are another step's id, or "@TICKER" to buy that ticker.
// Indicators are [fn, ticker, length]; see indicators.js for the exact definitions.
// `rebuilt: true` marks steps that were not spelled out in the sheet export (see each note).

const QQQ_TOP50 = 'NVDA MSFT AAPL AMZN AVGO META NFLX TSLA GOOGL GOOG COST PLTR CSCO AMD TMUS LIN INTU ISRG PEP TXN BKNG QCOM ADBE AMGN HON AMAT GILD CMCSA ADP VRTX LRCX PANW ADI MU KLAC SBUX INTC MELI CRWD CTAS MDLZ ORLY CEG ABNB MAR FTNT SNPS CDNS DASH'.split(' ');
const LARGE_CAP50 = 'NVDA AAPL GOOGL MSFT AMZN TSM META AVGO TSLA LLY BRK.B MU WMT JPM AMD V XOM JNJ ASML MA ABBV PLTR INTC CVX COST CSCO KO ORCL UNH PG MRK BAC HD CAT PM PANW AMAT GE LRCX MS NFLX TXN GS CRWD TMO WFC AMGN IBM LIN'.split(' ');

const close = t => ['close', t, 0], sma = (t, n) => ['sma', t, n], rsi = (t, n = 10) => ['rsi', t, n], ret = (t, n) => ['ret', t, n], avgret = (t, n) => ['avgret', t, n];

export const TEMPLATES = [
  {
    id: 'bg_ensemble', name: 'BG Ensemble', tagline: 'Hierarchical decision-tree regime rotation',
    kind: 'tree', rebalance: 'daily', risk: 'very high',
    qc: { ref: 'QC #698', cagr5y: 576.21, maxdd: 58, sharpe1y: 4.9, oos3m: -47.15 },
    about: 'Gold-miner RSI exhaustion gate, then Nasdaq momentum decides between a fast risk-on path (TQQQ / SPXL / UVXY / BTAL) and a slow path through bonds, financials and inverse ETFs. Holds one ETF at 100%.',
    sleeves: [{
      name: 'Main', weight: 1, steps: [
        { id: '1', t: 'band', a: rsi('GDXU'), hi: 79, hiTo: '@GDXD', lo: 30, loTo: '@GDXU', mid: '2' },
        { id: '2', t: 'cmp', label: 'QQQ momentum', a: ret('QQQ', 90), op: '>', b: ret('QQQ', 70), yes: '3', no: '6' },
        { id: '3', t: 'band', a: rsi('TQQQ'), hi: 79, hiTo: '@UVXY', lo: 31, loTo: '@TQQQ', mid: '4' },
        { id: '4', t: 'cmp', a: close('SPY'), op: '>', b: sma('SPY', 200), yes: '5', no: '@BTAL' },
        { id: '5', t: 'band', a: rsi('SPY'), hi: 79, hiTo: '@UVXY', lo: 30, loTo: '@SPXL', mid: '@TQQQ' },
        { id: '6', t: 'cmp', a: ret('GDXU', 70), op: '<', b: ret('GDXU', 75), yes: '@TQQQ', no: '7' },
        { id: '7', t: 'cmp', a: ret('TLT', 95), op: '<', b: ret('QQQ', 35), yes: '8', no: '@TLT' },
        { id: '8', t: 'cmp', a: avgret('FAS', 50), op: '>', b: avgret('FAS', 200), yes: '9', no: '11' },
        { id: '9', t: 'cmp', a: close('FAS'), op: '<', b: sma('FAS', 100), yes: '12', no: '10' },
        { id: '10', t: 'band', a: rsi('SPXL'), hi: 80, hiTo: '@UVXY', lo: null, loTo: null, mid: '@SPXL' },
        { id: '11', t: 'cmp', a: rsi('TLT', 20), op: '>', b: rsi('PSQ', 20), yes: '@TLT', no: '@PSQ' },
        { id: '12', t: 'cmp', a: avgret('FAZ', 15), op: '>', b: 0, yes: '@FAZ', no: '@BTAL' },
      ],
    }],
  },
  {
    id: 'multi_model', name: 'Multi-Model ETF Rotation', tagline: '4 independent sleeves × 25%',
    kind: 'tree', rebalance: 'daily', risk: 'high',
    qc: { ref: 'QC #504', cagr5y: 243.73, maxdd: 31.8, sharpe1y: 1.61, oos3m: 15.43 },
    about: 'Four separate models each run a quarter of the money: Nasdaq trend (TQQQ/SQQQ), semiconductors (SOXL), a 202-day trend vote across SPY/QQQ/IWM (TECL or T-bills), and S&P trend (SPXL or anti-beta).',
    sleeves: [
      { name: 'Sleeve 1: TQQQ / UVXY / SQQQ', weight: 0.25, steps: [
        { id: '1A', t: 'cmp', a: close('SPY'), op: '>', b: sma('SPY', 200), yes: '1B', no: '1C' },
        { id: '1B', t: 'band', a: rsi('TQQQ'), hi: 79, hiTo: '@UVXY', lo: null, loTo: null, mid: '@TQQQ' },
        { id: '1C', t: 'band', a: rsi('SQQQ'), hi: 79, hiTo: '@UVXY', lo: 31, loTo: '@PSQ', mid: '@SQQQ' },
      ] },
      { name: 'Sleeve 2: SOXL / UVIX / BSV', weight: 0.25, steps: [
        { id: '2A', t: 'band', a: rsi('SOXL'), hi: 79, hiTo: '@UVIX', lo: 31, loTo: '@SOXL', mid: '2B' },
        { id: '2B', t: 'cmp', a: rsi('XLK'), op: '>', b: rsi('KMLM'), yes: '@SOXL', no: '@BSV' },
      ] },
      { name: 'Sleeve 3: TECL / UVIX / BIL', weight: 0.25, steps: [
        { id: '3A', t: 'vote', label: '202-day trend vote (SPY, QQQ, IWM)', conds: [
          { a: close('SPY'), op: '>', b: sma('SPY', 202) }, { a: close('QQQ'), op: '>', b: sma('QQQ', 202) }, { a: close('IWM'), op: '>', b: sma('IWM', 202) },
        ], need: 2, yes: '3B', no: '@BIL' },
        { id: '3B', t: 'band', a: rsi('TECL'), hi: 79, hiTo: '@UVIX', lo: null, loTo: null, mid: '@TECL' },
      ] },
      { name: 'Sleeve 4: SPXL / UVXY / BTAL / BIL', weight: 0.25, steps: [
        { id: '4A', t: 'cmp', a: close('SPY'), op: '>', b: sma('SPY', 200), yes: '4B', no: '4C' },
        { id: '4B', t: 'band', a: rsi('SPXL'), hi: 79, hiTo: '@UVXY', lo: null, loTo: null, mid: '@SPXL' },
        { id: '4C', t: 'cmp', a: rsi('BTAL'), op: '>', b: rsi('BIL'), yes: '@BTAL', no: '@BIL' },
      ] },
    ],
  },
  {
    id: 'lev_etf_rotation', name: 'Leveraged ETF Rotation', tagline: 'Holds one leveraged ETF at 100%',
    kind: 'tree', rebalance: 'daily', risk: 'very high',
    qc: null,
    about: 'Bull market (SPY above its 200-day average): TQQQ unless Nasdaq or the S&P is overbought, then volatility (UVXY). Bear market: buys oversold dips in TECL / SPXL, otherwise rotates between TQQQ, SQQQ, TECS and short-term bonds.',
    note: 'Steps 1-3 are exactly as in the sheet. The sheet export did not include the rules for steps 4-12, so they are rebuilt from the well-known "TQQQ For The Long Term" logic the sheet\'s step list matches. Check them against your code and adjust.',
    sleeves: [{
      name: 'Main', weight: 1, steps: [
        { id: '1', t: 'cmp', label: 'Bull or bear market', a: close('SPY'), op: '>', b: sma('SPY', 200), yes: '2', no: '4' },
        { id: '2', t: 'band', a: rsi('QQQ'), hi: 81, hiTo: '@UVXY', lo: null, loTo: null, mid: '3' },
        { id: '3', t: 'band', a: rsi('SPY'), hi: 80, hiTo: '@UVXY', lo: null, loTo: null, mid: '@TQQQ' },
        { id: '4', t: 'band', rebuilt: true, a: rsi('TQQQ'), hi: null, hiTo: null, lo: 31, loTo: '@TECL', mid: '5' },
        { id: '5', t: 'band', rebuilt: true, a: rsi('SPY'), hi: null, hiTo: null, lo: 30, loTo: '@SPXL', mid: '6' },
        { id: '6', t: 'band', rebuilt: true, a: rsi('UVXY'), hi: 74, hiTo: '7', lo: null, loTo: null, mid: '11' },
        { id: '7', t: 'band', rebuilt: true, a: rsi('UVXY'), hi: 84, hiTo: '8', lo: null, loTo: null, mid: '@UVXY' },
        { id: '8', t: 'cmp', rebuilt: true, a: close('QQQ'), op: '>', b: sma('QQQ', 20), yes: '9', no: '10' },
        { id: '9', t: 'band', rebuilt: true, a: rsi('SQQQ'), hi: null, hiTo: null, lo: 31, loTo: '@SQQQ', mid: '@TQQQ' },
        { id: '10', t: 'higher', rebuilt: true, a: rsi('TECS'), b: rsi('BSV'), aTo: '@TECS', bTo: '@BSV' },
        { id: '11', t: 'cmp', rebuilt: true, a: close('TQQQ'), op: '>', b: sma('TQQQ', 20), yes: '12', no: '10' },
        { id: '12', t: 'band', rebuilt: true, a: rsi('SQQQ'), hi: null, hiTo: null, lo: 31, loTo: '@SQQQ', mid: '@TQQQ' },
      ],
    }],
  },
  {
    id: 'gold_miner', name: 'Gold Miner', tagline: 'Gold-miner fade and Nasdaq momentum tree',
    kind: 'tree', rebalance: 'daily', risk: 'very high',
    qc: { ref: 'QC #687', cagr5y: 921.85, maxdd: 51.3, sharpe1y: 6.42, oos3m: -27 },
    about: 'Starts with the GDXU RSI exhaustion gate and the Nasdaq 90-day vs 70-day momentum split, then a long tree of RSI, trend and return checks across leveraged ETFs and single stocks.',
    note: 'The sheet export only shows the rules for the steps on that day\'s path (steps 1, 2 and 4). The other ~105 steps have no thresholds in the export, so the walk stops with "needs a rule" when it reaches one. Send the QC #687 code (or the sheet itself) to fill them in, or type them in the editor.',
    sleeves: [{
      name: 'Main', weight: 1, steps: [
        { id: '1', t: 'band', a: rsi('GDXU'), hi: 79, hiTo: '@GDXD', lo: 30, loTo: '@GDXU', mid: '2' },
        { id: '2', t: 'cmp', a: ret('QQQ', 90), op: '>', b: ret('QQQ', 70), yes: '3', no: '4' },
        { id: '3', t: 'missing', label: 'GDXU ROC(70) vs ROC(75)', a: ret('GDXU', 70), b: ret('GDXU', 75) },
        { id: '4', t: 'cmp', a: ret('TLT', 95), op: '<', b: ret('QQQ', 35), yes: '@GDXD', no: '6' },
        { id: '6', t: 'missing', label: 'SPY Close vs SMA(200) and the rest of the tree', a: close('SPY'), b: sma('SPY', 200) },
      ],
    }],
  },
  {
    id: 'cl_momentum', name: 'Large-Cap Momentum', tagline: 'One stock: the strongest 12-month momentum',
    kind: 'momentum', rebalance: 'weekly', weekday: 3, risk: 'high',
    qc: null,
    about: 'Every Wednesday ranks 50 large US companies by their 252-day return and holds the single strongest one at 100%. The original code uses a 10% stop.',
    params: { universe: LARGE_CAP50, lookback: 252, top: 1, stopPct: 10 },
    note: 'The sheet builds the list from price > $5, top 100 by dollar volume and top 50 by market cap. Here the list is the sheet\'s current top 50 and you can edit it.',
  },
  {
    id: 'pullback_mr', name: 'Large-Cap Pullback', tagline: 'Buy the dip in an uptrend, sell the bounce',
    kind: 'pullback', rebalance: 'daily', risk: 'medium',
    qc: null,
    about: 'Buys top Nasdaq-100 stocks in a long-term uptrend that dipped below the lower Bollinger band with weak RSI and a real pullback. Sells on the bounce back to the 15-day average, a break of the 200-day average, or after 15 days. Equal weight, up to 10 stocks.',
    params: { universe: QQQ_TOP50, bbLen: 15, bbMult: 1.75, rsiLen: 14, rsiEntry: 45, minPullback: 3, highLen: 60, maxPositions: 10, maxHoldDays: 15 },
  },
  {
    id: 'macro_rotation', name: 'Macro Rotation', tagline: 'Stocks, gold, bonds and bitcoin by predicted return',
    kind: 'macro', rebalance: 'monthly', risk: 'medium',
    qc: null,
    about: 'Once a month, weights SPY, GLD, BND and bitcoin (IBIT) by their predicted 21-day return. Only positive predictions get money, bitcoin is capped, and the total never exceeds 100% (no margin).',
    params: { assets: ['SPY', 'GLD', 'BND', 'IBIT'], btc: 'IBIT', btcCap: 10, maxTotal: 100, source: 'manual', predictions: { SPY: 1.8, GLD: -4.29, BND: -1.25, IBIT: 6.7 }, proxyDays: 63 },
    note: 'In the sheet you type the model\'s 4 predictions each month. Here you can keep typing them (manual), or let the app use each asset\'s recent 3-month return as a simple stand-in (automatic).',
  },
];

export const template = id => TEMPLATES.find(t => t.id === id);

// Short-hand for UI and logs: "GDXU RSI(10)".
export function metricLabel(m) {
  if (typeof m === 'number') return String(m);
  const [fn, t, n] = m;
  return `${t} ${{ rsi: `RSI(${n})`, sma: `SMA(${n})`, close: 'Close', ret: `ROC(${n})`, avgret: `AvgRet(${n}d)`, stdev: `StdDev(${n}d)`, high: `${n}d high`, pstdev: `StDev(${n})` }[fn] || fn}`;
}
