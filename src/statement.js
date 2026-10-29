// A monthly account statement as a PDF, on every plan: the month's start and end value, the change
// next to the S&P 500 (SPY), the worst drop, every fill and the positions at the end. It reports
// the user's own results only; nothing in it is a recommendation.
import express from 'express';
import { all } from './db.js';
import { requireUser } from './auth.js';
import { accountSummary, portfolioHistory, getBars, ACCOUNT_IDS } from './brokers.js';
import { markdownPdf } from './pdf.js';

const usd = x => (x == null || !Number.isFinite(+x) ? '-' : (x < 0 ? '-$' : '$') + Math.abs(+x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = x => (x == null || !Number.isFinite(x) ? '-' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`);
const monthName = ym => new Date(ym + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export async function statementMarkdown(user, account, ym) {
  const from = `${ym}-01`, to = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
  const hist = (await portfolioHistory(user.id, account).catch(() => [])).filter(x => x.equity > 0);
  const before = hist.filter(x => x.day < from).pop(), inMonth = hist.filter(x => x.day >= from && x.day <= to);
  const sum = await accountSummary(user.id, account).catch(() => null);
  const isNow = new Date().toISOString().slice(0, 7) === ym;
  // A new account has no daily history yet: it starts at its opening balance and ends at today's value.
  const start = (before || inMonth[0])?.equity ?? (hist.length ? null : sum?.startCash ?? null);
  const end = isNow && sum?.equity != null ? sum.equity : inMonth[inMonth.length - 1]?.equity ?? null;
  let peak = start ?? 0, worst = 0;
  for (const x of inMonth) { peak = Math.max(peak, x.equity); worst = Math.min(worst, (x.equity / peak - 1) * 100); }
  // The S&P 500 over the same days, for comparison.
  let spy = null;
  const b = await getBars('SPY', new Date(Date.parse(from) - 500 * 864e5).toISOString().slice(0, 10), user.id).catch(() => null);
  if (b?.closes?.length) {
    const at = d => { let i = b.dates.length - 1; while (i > 0 && b.dates[i] > d) i--; return b.closes[i]; };
    const s0 = at(new Date(Date.parse(from) - 864e5).toISOString().slice(0, 10)), s1 = at(to);
    // Only when the prices cover the whole month (never from stale data).
    if (s0 && s1 && b.dates[0] <= from && b.dates[b.dates.length - 1] >= (isNow ? new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10) : to.slice(0, 8) + '20')) spy = (s1 / s0 - 1) * 100;
  }
  const t0 = Date.parse(from + 'T00:00:00Z'), t1 = Date.parse(to + 'T23:59:59Z');
  const fills = await all('SELECT symbol, side, qty, price, source, at FROM fills WHERE user_id = ? AND account = ? AND at BETWEEN ? AND ? ORDER BY at', user.id, account, t0, t1).catch(() => []);
  const change = start && end ? end - start : null;
  const lines = [
    `# Account statement: ${monthName(ym)}`,
    '',
    `Brightfolio · ${account === 'paper' ? 'Paper account (pretend money)' : `Brokerage account (${account})`} · ${user.email}`,
    '',
    '## Summary',
    '',
    '| | |', '|---|---|',
    `| Value at the start | ${usd(start)} |`,
    `| Value at the end${isNow ? ' (so far)' : ''} | ${usd(end)} |`,
    `| Change | ${usd(change)} (${pct(start && end ? (end / start - 1) * 100 : null)}) |`,
    `| S&P 500 (SPY) over the same days | ${pct(spy)} |`,
    `| Worst drop from a high during the month | ${pct(worst)} |`,
    `| Trades | ${fills.length} |`,
    '',
    'The change includes deposits and withdrawals made during the month.',
    '',
    '## Trades',
    '',
    ...(fills.length ? ['| Date | Side | Qty | Symbol | Price | Source |', '|---|---|---|---|---|---|', ...fills.map(f => `| ${new Date(f.at).toISOString().slice(0, 10)} | ${f.side.toUpperCase()} | ${+(+f.qty).toFixed(4)} | ${f.symbol} | ${usd(f.price)} | ${f.source || 'you'} |`)] : ['No trades this month.']),
    '',
    `## Positions${isNow ? ' now' : ' today'}`,
    '',
    ...(sum?.positions?.length ? ['| Symbol | Qty | Value | Profit / loss |', '|---|---|---|---|', ...sum.positions.map(p => `| ${p.symbol} | ${+(+p.qty).toFixed(4)} | ${usd(p.value)} | ${usd(p.pnl)} |`)] : ['No open positions.']),
    '',
    '---',
    '',
    'This statement reports your own account activity as recorded by Brightfolio. Your broker\'s statements are the official record. Past results do not predict future results, and nothing here is investment advice.',
  ];
  return lines.join('\n');
}

export const statementRouter = express.Router();
statementRouter.use(requireUser);
// GET /api/statement?account=paper&month=2026-10 → PDF
statementRouter.get('/', async (req, res) => {
  const account = ACCOUNT_IDS.includes(req.query.account) ? req.query.account : 'paper';
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  if (ym > new Date().toISOString().slice(0, 7)) throw Object.assign(new Error('Pick this month or an earlier one'), { status: 400 });
  const md = await statementMarkdown(req.user, account, ym);
  const { pdf } = markdownPdf(md, { title: `Brightfolio statement · ${monthName(ym)}`, toc: false });
  res.type('application/pdf').attachment(`Brightfolio statement ${ym}.pdf`).send(pdf);
});
