// AI assistant for the company's Twilio number: understands free-form texts and speech
// ("how much do I have?", "put 200 dollars into the S&P"), turns them into the app's own commands,
// and answers questions. Orders still go through the normal command path, so the PIN (SMS) or the
// spoken read-back confirmation (phone) is always required; the AI never sees or invents a PIN.
import Anthropic from '@anthropic-ai/sdk';
import { accountSummary } from './brokers.js';

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['intent', 'symbol', 'qty', 'dollars', 'account', 'frequency', 'reply'],
  properties: {
    intent: { type: 'string', enum: ['balance', 'positions', 'quote', 'buy', 'sell', 'recurring_buy', 'scheduled', 'bots', 'pause', 'help', 'answer'] },
    symbol: { type: ['string', 'null'], description: 'US ticker in capitals, e.g. AAPL; S&P 500 = SPY' },
    qty: { type: ['number', 'null'], description: 'Number of shares, if given' },
    dollars: { type: ['number', 'null'], description: 'Dollar amount, if given instead of shares' },
    account: { type: ['string', 'null'], enum: ['paper', 'alpaca', 'tradier', 'tastytrade', 'schwab', 'tradestation', null] },
    frequency: { type: ['string', 'null'], enum: ['daily', 'weekly', 'monthly', null] },
    reply: { type: 'string', description: 'For intent "answer": the answer, at most 320 characters, plain text. Otherwise empty.' },
  },
};

const SYSTEM = `You are the assistant on QuantPocket's phone number. Users text or speak to manage their own trading account.
Map each message to one intent:
- balance, positions, quote (needs symbol), buy / sell (needs symbol and qty or dollars), recurring_buy (symbol, dollars, frequency),
  scheduled (list scheduled trades), bots (list running strategies), pause (stop all automation), help.
- answer: any question or chat that is not an action. Answer briefly in plain text (no markdown), in the user's language.
  You may explain trading terms, the app's features and the user's own account data given below. Do not recommend specific
  investments or predict prices; say that you can't give personal investment advice when asked what to buy.
Account: "paper" unless the user names a brokerage ("live" or "real" means alpaca).
Never put a PIN in any field. If a trade request is unclear, use intent "answer" and ask one short question.`;

let client;
export async function interpret(user, text) {
  client ||= new Anthropic();
  let context = '';
  try {
    const s = await accountSummary(user.id, 'paper');
    context = `User's paper account: equity $${s.equity.toFixed(2)}, cash $${s.cash.toFixed(2)}, positions: ${s.positions.map(p => `${p.symbol} ${p.qty}`).join(', ') || 'none'}.`;
  } catch {}
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `${context}\n\nMessage: ${String(text).slice(0, 600)}` }],
  });
  if (res.stop_reason === 'refusal') return { intent: 'answer', reply: "Sorry, I can't help with that. Text HELP for the list of commands." };
  const block = res.content.find(b => b.type === 'text');
  return JSON.parse(block.text);
}

// The intent as one of the app's own text commands (without the PIN).
export function toCommand(r) {
  const acct = r.account && r.account !== 'paper' ? ` ${r.account === 'alpaca' ? 'LIVE' : r.account.toUpperCase()}` : '';
  const amt = r.dollars ? `$${+r.dollars}` : r.qty ? String(+r.qty) : null;
  switch (r.intent) {
    case 'balance': return 'BAL' + acct;
    case 'positions': return 'POS' + acct;
    case 'quote': return r.symbol ? `PRICE ${r.symbol}` : null;
    case 'buy': case 'sell': return r.symbol && amt ? `${r.intent.toUpperCase()} ${amt} ${r.symbol}${acct}` : null;
    case 'recurring_buy': return r.symbol && r.dollars ? `DCA $${+r.dollars} ${r.symbol} ${(r.frequency || 'weekly').toUpperCase()}${acct}` : null;
    case 'scheduled': return 'ORDERS';
    case 'bots': return 'BOTS';
    case 'pause': return 'PAUSE';
    case 'help': return 'HELP';
    default: return null;
  }
}
