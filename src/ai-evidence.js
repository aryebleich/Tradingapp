// What every AI answer carries (registry A-19, queue row AI-04; master plan section 2): the data it used,
// its sources, a plain confidence line, and the reminder that it is information and promises nothing.
// Confidence is worked out from what the answer was built on, never from the model's own say-so:
//   high:   built on two or more current data reads (prices, filings, the member's own account...);
//   medium: built on one data read or one cited source;
//   low:    a general explanation, not based on current data, or from plain rules without an AI model.
export const NOT_ADVICE = 'Information to help you decide, not investment advice. No AI or strategy can promise a profit.';

// Tool names (src/chat.js, src/aitrading.js, src/mcp.js) → the data they read, in plain words.
const DATA = {
  get_quote: 'Live quotes', quote: 'Live quotes', technical_snapshot: 'Daily prices and indicators', backtest_rules: 'Daily prices since 2016',
  my_portfolio: 'Your account holdings', my_positions: 'Your account holdings', my_orders: 'Your orders', buying_power: 'Your buying power',
  market_news: 'News headlines', sec_filing: 'SEC filings', fundamentals: 'SEC financial statements', portfolio_stress_test: 'Your holdings and past market moves',
  web_search: 'Web search results', propose_strategy: 'Your description of the strategy', options_chain: 'The options chain',
};
const label = t => DATA[t] || String(t || '').replace(/_/g, ' ');

export function evidence({ tools = [], sources = [], data = [], by = 'ai', asOf = null, forecast = false } = {}) {
  const basis = [...new Set([...tools.map(label), ...data].filter(Boolean))].slice(0, 6);
  const cited = (Array.isArray(sources) ? sources : []).filter(s => s && (s.url || s.title)).slice(0, 6).map(s => ({ title: String(s.title || s.url).slice(0, 120), url: /^https?:\/\//.test(s.url || '') ? s.url : null }));
  const reads = basis.length + cited.length;
  let level = by === 'rules' ? (basis.length ? 'medium' : 'low') : reads >= 2 ? 'high' : reads === 1 ? 'medium' : 'low';
  if (forecast && level === 'high') level = 'medium';
  const why = {
    high: `Built on ${basis.length ? basis.join(', ').toLowerCase() : 'the sources below'}. Still check the figures before you act.`,
    medium: reads > 1 ? `Built on ${(basis.length ? basis : cited.map(c => c.title)).join(', ').toLowerCase()}.` : `Built on ${basis.length ? basis[0].toLowerCase() : 'one source'} only, so parts of the picture may be missing.`,
    low: by === 'rules' ? 'Plain rules without an AI model; a general answer, not checked against current data.' : 'A general explanation, not based on current data for this question.',
  }[level];
  const note = forecast ? ' It is a forecast: prices can move the other way, and past results don\'t predict future ones.' : '';
  return { confidence: level, confidenceText: `How sure: ${level}. ${why}${note}`, basis, sources: cited, by, asOf, notAdvice: NOT_ADVICE };
}

// Adds the evidence to an AI answer object (keeps everything else as it was).
export const withEvidence = (answer, opts) => ({ ...answer, evidence: evidence({ tools: answer?.tools || [], sources: answer?.sources || [], ...opts }) });
