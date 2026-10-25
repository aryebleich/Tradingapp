// AI trading assistant for the web app (text or voice in the browser). Claude answers market
// questions with live tools (prices, technicals, news, the user's portfolio, backtests, web search
// for fundamentals) and drafts strategies in the rule language; the user saves, backtests or
// deploys a draft with a button. The assistant never places orders itself.
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireUser, rateLimit } from './auth.js';
import { getBars, lastPrice, accountSummary } from './brokers.js';
import { backtest, warmupFor, compile } from './engine.js';
import { heuristic } from './ai.js';
import { snapshot } from './ta.js';
import { isPaid } from './fees.js';
import * as D from './alpaca/data.js';

export const chatEnabled = () => !!process.env.ANTHROPIC_API_KEY;
const DSL = `Strategy rules use one condition per line: <operand> <op> <operand>. Ops: > < >= <= crosses_above crosses_below.
Operands: Close, numbers, SMA(n), EMA(n), RSI(n), BBU(n,k), BBL(n,k), HIGH(n), LOW(n), ROC(n), MACD(f,s), MACDSIG(f,s,sig).
Entry lines must all be true (AND); any exit line closes the trade (OR). Daily bars, long only.`;
const SYSTEM = `You are the QuantPocket trading assistant inside a trading web app. Help with market questions, technical and fundamental analysis, trading concepts, and designing systematic strategies.
Use the tools for any number you quote (prices, indicators, backtests, the user's holdings); use web_search for company fundamentals, earnings or recent events, and name your sources.
To design or change a strategy, call propose_strategy with complete rules; the user then backtests, saves or deploys it with buttons. Refine the draft when the user asks.
${DSL}
You cannot place orders. Do not give personal investment advice or promise returns; explain risks plainly. Keep answers short and concrete, use Markdown lists or tables when helpful.
Reply in the language the user writes in (Yiddish if they write Yiddish).`;

const sym = s => String(s || '').trim().toUpperCase();
const yearsAgo = n => new Date(Date.now() - n * 365 * 864e5).toISOString().slice(0, 10);

export function tools(user, ctx) {
  const defs = {
    get_quote: { description: 'Latest price of a stock, ETF or crypto pair (e.g. AAPL, SPY, BTC/USD).', schema: { symbol: { type: 'string' } }, required: ['symbol'],
      run: async ({ symbol }) => ({ symbol: sym(symbol), price: await lastPrice(sym(symbol), user.id) }) },
    technical_snapshot: { description: 'Technical indicators from daily bars: RSI, moving averages, momentum (ROC), volatility, 52-week range, MACD.', schema: { symbol: { type: 'string' } }, required: ['symbol'],
      run: async ({ symbol }) => { const b = await getBars(sym(symbol), yearsAgo(2), user.id); return { symbol: sym(symbol), dataSource: b.source, ...snapshot(b.closes) }; } },
    market_news: { description: 'Recent news headlines for symbols.', schema: { symbols: { type: 'string', description: 'Comma separated' } }, required: ['symbols'],
      run: async ({ symbols }) => (D.dataEnabled() ? (await D.news({ symbols: sym(symbols), limit: 8 })).map(n => ({ headline: n.headline, summary: n.summary?.slice(0, 300), source: n.source, at: n.created_at, symbols: n.symbols })) : { note: 'News feed is not configured on this server' }) },
    my_portfolio: { description: "The user's holdings and cash for one account (paper, alpaca, or a connected brokerage id).", schema: { account: { type: 'string' } }, required: [],
      run: async ({ account = 'paper' }) => { const s = await accountSummary(user.id, account); return { account, equity: s.equity, cash: s.cash, positions: s.positions.map(p => ({ symbol: p.symbol, qty: p.qty, value: p.value, pnl: p.pnl })) }; } },
    backtest_rules: { description: 'Backtest entry/exit rules on daily data since 2016 and return the key results.', schema: { symbol: { type: 'string' }, entry: { type: 'string' }, exit: { type: 'string' }, stopLoss: { type: 'number' }, takeProfit: { type: 'number' }, trailingStop: { type: 'number' } }, required: ['symbol', 'entry', 'exit'],
      run: async a => {
        const b = await getBars(sym(a.symbol), '2016-01-01', user.id), cfg = { entry: a.entry, exit: a.exit, sl: a.stopLoss || 0, tp: a.takeProfit || 0, ts: a.trailingStop || 0, capital: 10000 };
        const r = backtest(b.closes, cfg, warmupFor(cfg), b.closes.length, b.dates);
        return { symbol: sym(a.symbol), dataSource: b.source, from: b.dates[0], ...r.m };
      } },
    propose_strategy: { description: 'Show the user a strategy draft they can backtest, save and deploy. Use the rule language exactly.', schema: { name: { type: 'string' }, symbol: { type: 'string' }, entry: { type: 'string' }, exit: { type: 'string' }, stopLoss: { type: 'number' }, takeProfit: { type: 'number' }, trailingStop: { type: 'number' }, explanation: { type: 'string' } }, required: ['name', 'symbol', 'entry', 'exit', 'explanation'],
      run: async a => {
        const probe = Array.from({ length: 300 }, (_, i) => 100 + i % 7); // checks the rules parse (throws a readable error)
        compile(a.entry, probe); compile(a.exit, probe);
        ctx.draft = { name: String(a.name).slice(0, 60), symbol: sym(a.symbol), entry: a.entry, exit: a.exit, sl: a.stopLoss || 0, tp: a.takeProfit || 0, ts: a.trailingStop || 0, explanation: a.explanation };
        return { shown: true };
      } },
  };
  for (const [k, f] of Object.entries(ctx.extraTools || {})) defs[k] = f;
  return defs;
}

let client;
// Runs the conversation with tools until Claude answers (at most 8 tool rounds).
export async function chat(user, history, { extraTools } = {}) {
  const ctx = { draft: null, used: [], sources: [], extraTools };
  const defs = tools(user, ctx);
  const apiTools = [
    ...Object.entries(defs).map(([name, d]) => ({ name, description: d.description, input_schema: { type: 'object', properties: d.schema, required: d.required } })),
    { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
  ];
  client ||= new Anthropic();
  const messages = history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }));
  for (let round = 0; round < 8; round++) {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5', max_tokens: 4000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low' }, system: SYSTEM, tools: apiTools, messages,
    });
    for (const b of res.content) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) ctx.sources.push({ title: r.title, url: r.url });
    if (res.stop_reason === 'refusal') return { reply: "Sorry, I can't help with that request.", ...out(ctx) };
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    const calls = res.content.filter(b => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) return { reply: res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), ...out(ctx) };
    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const c of calls) {
      ctx.used.push(c.name);
      let content, is_error = false;
      try { content = JSON.stringify(await defs[c.name].run(c.input || {})).slice(0, 12000); } catch (e) { content = 'Error: ' + e.message; is_error = true; }
      results.push({ type: 'tool_result', tool_use_id: c.id, content, is_error });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'That took too many steps. Please ask a narrower question.', ...out(ctx) };
}
const out = ctx => ({ draft: ctx.draft, tools: [...new Set(ctx.used)], sources: ctx.sources.filter((s, i, a) => a.findIndex(x => x.url === s.url) === i).slice(0, 6) });

// Without an AI key the assistant still answers the common questions from live data.
export async function fallbackChat(user, history) {
  const text = String(history.at(-1)?.content || ''), lower = text.toLowerCase();
  const ticker = text.match(/\b[A-Z]{1,5}(?:\/USD)?\b/g)?.find(t => !['I', 'A', 'RSI', 'SMA', 'EMA', 'MACD', 'AND', 'OR', 'ETF', 'AI'].includes(t));
  const ctx = { draft: null, used: [], sources: [] }, defs = tools(user, ctx);
  if (/strategy|bot|buy when|sell when|rule|system/.test(lower)) {
    const h = heuristic(text);
    await defs.propose_strategy.run({ name: h.name, symbol: h.symbol, entry: h.entry, exit: h.exit, stopLoss: h.stopLoss, takeProfit: h.takeProfit, trailingStop: h.trailingStop, explanation: h.explanation || 'Built from the keywords in your message.' });
    return { reply: `Here is a draft: **${h.name}** on ${h.symbol}. Entry: \`${h.entry.replace(/\n/g, ' AND ')}\`, exit: \`${h.exit.replace(/\n/g, ' OR ')}\`. Backtest it below, then save or deploy. (The full AI assistant needs ANTHROPIC_API_KEY on the server.)`, ...out(ctx) };
  }
  if (ticker) {
    const s = await defs.technical_snapshot.run({ symbol: ticker });
    const trend = s.aboveSma200 ? 'above' : 'below';
    return { reply: `**${s.symbol}** ${s.price}. RSI(14) ${s.rsi14}, ${trend} its 200-day average (${s.sma200}). Momentum: 1 month ${s.roc1m}%, 6 months ${s.roc6m}%, 1 year ${s.roc1y}%. Volatility ${s.vol20}% a year; ${s.fromHighPct}% from the 52-week high.${s.dataSource === 'synthetic' ? ' (Simulated data: no market data source is configured.)' : ''}`, ...out(ctx) };
  }
  return { reply: 'Ask me about a ticker (for example "How does AAPL look?") or describe a strategy ("buy SPY when RSI is below 30, sell above 60"). The full AI assistant needs ANTHROPIC_API_KEY on the server.', ...out(ctx) };
}

export function chatRouter({ extraTools } = {}) {
  const r = express.Router();
  r.use(requireUser);
  r.get('/status', (req, res) => res.json({ ai: chatEnabled() }));
  r.post('/chat', async (req, res) => {
    const limit = isPaid(req.user) ? 300 : 30;
    if (!rateLimit('chat:' + req.user.id, limit, 86400e3)) throw Object.assign(new Error(`Daily AI limit reached (${limit} messages)`), { status: 429, upgrade: !isPaid(req.user), feature: 'More AI messages' });
    const history = (Array.isArray(req.body?.messages) ? req.body.messages : []).filter(m => m && m.content).slice(-20);
    if (!history.length || history.at(-1).role === 'assistant') throw Object.assign(new Error('Send a message'), { status: 400 });
    const extra = typeof extraTools === 'function' ? extraTools(req.user) : undefined;
    try { res.json(chatEnabled() ? await chat(req.user, history, { extraTools: extra }) : await fallbackChat(req.user, history)); }
    catch (e) { if (e.status === 401 || e.status === 403) throw Object.assign(new Error('The AI service refused the request; check ANTHROPIC_API_KEY'), { status: 502 }); throw e; }
  });
  return r;
}
