// Research tools for the AI assistant: summaries of a company's latest 10-K / 10-Q from SEC EDGAR
// (the assistant reads the key sections and summarizes them) and a stress test of the user's
// portfolio under market shocks and past crashes, scaled by each holding's beta to the S&P 500.
import { get, secData, secWww, secCached } from './institutions.js';
import { getBars, accountSummary } from './brokers.js';

const yearsAgo = n => new Date(Date.now() - n * 365 * 864e5).toISOString().slice(0, 10);
async function cikFor(ticker) {
  const map = await secCached('sec:cik', 7 * 864e5, async () => {
    const d = await get(`${secWww()}/files/company_tickers.json`), m = {};
    for (const r of Object.values(d)) m[r.ticker] = String(r.cik_str).padStart(10, '0');
    return m;
  });
  return map[String(ticker).toUpperCase().replace('.', '-')] || null;
}
const text = html => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/&#\d+;|&\w+;/g, ' ').replace(/\s+/g, ' ');
// The parts of a filing worth reading first: business, risk factors, MD&A.
export function sections(t) {
  const find = re => { const all = [...t.matchAll(re)]; return all.length ? all.at(-1).index : -1; }; // the last match skips the table of contents
  const pick = (re, len) => { const i = find(re); return i >= 0 ? t.slice(i, i + len) : ''; };
  return {
    business: pick(/item\s*1\.?\s*business/gi, 3500),
    riskFactors: pick(/item\s*1a\.?\s*risk\s*factors/gi, 4500),
    mdna: pick(/item\s*[27]\.?\s*management['’]?s\s*discussion/gi, 6000),
  };
}
export async function filing(symbol, form = '10-K') {
  const cik = await cikFor(symbol); if (!cik) throw new Error(`No SEC filer found for ${symbol}`);
  const sub = await get(`${secData()}/submissions/CIK${cik}.json`), f = sub.filings?.recent || {};
  const i = (f.form || []).findIndex(x => x === form);
  if (i < 0) throw new Error(`No ${form} on file for ${symbol}`);
  const acc = f.accessionNumber[i].replace(/-/g, ''), url = `${secWww()}/Archives/edgar/data/${+cik}/${acc}/${f.primaryDocument[i]}`;
  const t = text(await get(url, 'text'));
  return { company: sub.name, form, filed: f.filingDate[i], period: f.reportDate[i], url, ...sections(t), length: t.length };
}

export async function stressTest(userId, account = 'paper') {
  const s = await accountSummary(userId, account);
  const spy = await getBars('SPY', yearsAgo(2), userId), sr = spy.closes.slice(1).map((x, i) => x / spy.closes[i] - 1);
  const beta = async sym => {
    if (sym.includes('/')) return 2; // crypto: treat as about twice as volatile as stocks
    try {
      const b = await getBars(sym, yearsAgo(2), userId), r = b.closes.slice(1).map((x, i) => x / b.closes[i] - 1), n = Math.min(r.length, sr.length);
      const a = r.slice(-n), m = sr.slice(-n), ma = a.reduce((x, y) => x + y, 0) / n, mm = m.reduce((x, y) => x + y, 0) / n;
      const cov = a.reduce((x, v, i) => x + (v - ma) * (m[i] - mm), 0), vm = m.reduce((x, v) => x + (v - mm) ** 2, 0);
      return vm ? +(cov / vm).toFixed(2) : 1;
    } catch { return 1; }
  };
  const rows = [];
  for (const p of s.positions) rows.push({ symbol: p.symbol, value: +p.value.toFixed(2), beta: await beta(p.symbol) });
  const scenarios = [['Market -10%', -10], ['Market -20%', -20], ['2020 COVID crash (S&P -34%)', -34], ['2022 bear market (S&P -25%)', -25], ['2008 financial crisis (S&P -55%)', -55]];
  const invested = rows.reduce((a, r) => a + r.value, 0), pbeta = invested ? rows.reduce((a, r) => a + r.value * r.beta, 0) / invested : 0;
  return {
    account, equity: s.equity, cash: s.cash, portfolioBeta: +pbeta.toFixed(2), holdings: rows,
    scenarios: scenarios.map(([name, m]) => { const loss = rows.reduce((a, r) => a + r.value * Math.max(-1, r.beta * m / 100), 0); return { name, marketMovePct: m, estimatedLoss: +loss.toFixed(2), equityAfter: +(s.equity + loss).toFixed(2), pctOfEquity: s.equity ? +(loss / s.equity * 100).toFixed(1) : 0 }; }),
    note: 'Estimates from each holding\'s one-year beta to the S&P 500; real crashes can hit some holdings much harder.',
  };
}

export const researchTools = user => ({
  sec_filing: { description: "Key sections (business, risk factors, MD&A) of a company's latest 10-K or 10-Q from SEC EDGAR, to summarize for the user. Quote the filing date.", schema: { symbol: { type: 'string' }, form: { type: 'string', enum: ['10-K', '10-Q'] } }, required: ['symbol'],
    run: ({ symbol, form }) => filing(symbol, form === '10-Q' ? '10-Q' : '10-K') },
  portfolio_stress_test: { description: "Stress-test the user's portfolio: estimated losses in market drops and past crashes, from each holding's beta.", schema: { account: { type: 'string' } }, required: [],
    run: ({ account }) => stressTest(user.id, account || 'paper') },
});
