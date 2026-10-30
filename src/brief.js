// The weekly money brief: everything linked (brokerage accounts, banks, cards, crypto, private
// investments and property) read once a week and written up in plain English: "here is what
// changed and why". The AI writes it when one is set up; otherwise a plain summary of the same
// numbers. Facts only, from the user's own data: it never tells anyone to buy or sell.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { accountSummary } from './brokers.js';
import { accountsFor } from './ext/routes.js';
import { getSetting, setSetting } from './settings.js';
import { addonOn, requireAddon } from './addons.js';
import { nyTime } from './time.js';
import { sendEmail } from './notify.js';

const DAY = 864e5, r2 = x => +(+x || 0).toFixed(2);
const money = x => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = x => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
// The Monday (New York) that starts the week of t.
export function weekOf(t = now()) { const d = nyTime(t).day, wd = new Date(d + 'T12:00:00Z').getUTCDay(); return new Date(Date.parse(d + 'T12:00:00Z') - ((wd + 6) % 7) * DAY).toISOString().slice(0, 10); }

export async function gather(user, t = now()) {
  const { overview } = await import('./money.js');
  const o = await overview(user);
  const prev = await one('SELECT data FROM briefs WHERE user_id = ? AND week < ? ORDER BY week DESC LIMIT 1', user.id, weekOf(t));
  const prevNet = prev ? JSON.parse(prev.data).netWorth : null;
  const weekAgo = new Date(t - 7 * DAY).toISOString().slice(0, 10);
  // Brokerage accounts: value now and a week ago (daily snapshots).
  const accounts = [], holdings = [];
  for (const a of await accountsFor(user.id).catch(() => [])) {
    if (a.connected === false) continue;
    const s = await accountSummary(user.id, a.id).catch(() => null); if (!s) continue;
    const then = await one('SELECT equity FROM equity_history WHERE user_id = ? AND account = ? AND day <= ? ORDER BY day DESC LIMIT 1', user.id, a.id, weekAgo);
    accounts.push({ name: a.id === 'paper' ? 'Paper (practice)' : a.name || a.id, paper: a.id === 'paper', equity: r2(s.equity), weekAgo: then ? r2(then.equity) : null, change: then ? r2(s.equity - then.equity) : null });
    for (const p of s.positions || []) if (a.id !== 'paper' || !o.brokerage) holdings.push({ symbol: p.symbol, value: r2(p.value), pnl: r2(p.pnl) });
  }
  const top = holdings.sort((a, b) => b.value - a.value).slice(0, 6);
  const { performance } = await import('./events.js');
  for (const h of top) { const p = await performance(h.symbol, user.id).catch(() => null); h.week = p?.week ?? null; }
  const tx = await all('SELECT amount, category FROM money_tx WHERE user_id = ? AND day >= ?', user.id, weekAgo);
  const skip = c => /TRANSFER|LOAN_PAYMENTS|CREDIT_CARD/i.test(c || '');
  const spend = {}; for (const x of tx) if (x.amount > 0 && !skip(x.category)) spend[x.category || 'Other'] = r2((spend[x.category || 'Other'] || 0) + x.amount);
  const pendingRules = (await one('SELECT COUNT(*) n FROM rules WHERE user_id = ? AND pending IS NOT NULL', user.id)).n;
  const pilot = await one('SELECT pending FROM tax_pilot WHERE user_id = ?', user.id);
  let earnings = [];
  if (top.length) { const { earningsCalendar } = await import('./events.js'); earnings = await earningsCalendar(new Date(t).toISOString().slice(0, 10), new Date(t + 7 * DAY).toISOString().slice(0, 10), top.map(h => h.symbol)).catch(() => []); }
  return {
    week: weekOf(t), netWorth: o.netWorth, assets: o.assets, debts: o.debts, netWorthLastBrief: prevNet, netWorthChange: prevNet == null ? null : r2(o.netWorth - prevNet),
    parts: o.parts, accounts, holdings: top, moneyIn: r2(tx.filter(x => x.amount < 0 && !skip(x.category)).reduce((s, x) => s - x.amount, 0)), moneyOut: r2(tx.filter(x => x.amount > 0 && !skip(x.category)).reduce((s, x) => s + x.amount, 0)),
    spending: Object.entries(spend).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category, amount]) => ({ category: category.replace(/_/g, ' ').toLowerCase(), amount })),
    waiting: { rules: pendingRules, taxHarvest: pilot?.pending ? JSON.parse(pilot.pending).trades?.length || 0 : 0 }, earnings: earnings.slice(0, 6),
  };
}

// Plain summary of the same numbers, used when no AI is set up (or it fails).
export function plainBrief(d) {
  const lines = [];
  lines.push(`Net worth ${money(d.netWorth)}${d.netWorthChange != null ? ` (${d.netWorthChange >= 0 ? 'up' : 'down'} ${money(Math.abs(d.netWorthChange))} since your last brief)` : ''}: you own ${money(d.assets)} and owe ${money(-d.debts)}.`);
  const real = d.accounts.filter(a => a.change != null && !a.paper);
  if (real.length) lines.push(real.map(a => `${a.name} ${a.change >= 0 ? 'rose' : 'fell'} ${money(Math.abs(a.change))} this week to ${money(a.equity)}${a.weekAgo ? ` (${pct(a.change / a.weekAgo * 100)})` : ''}.`).join(' '));
  const moved = d.holdings.filter(h => h.week != null).sort((a, b) => Math.abs(b.week) - Math.abs(a.week));
  if (moved.length) lines.push(`Biggest moves among your largest holdings: ${moved.slice(0, 3).map(h => `${h.symbol} ${pct(h.week)}`).join(', ')}.`);
  if (d.moneyIn || d.moneyOut) lines.push(`Money in this week ${money(d.moneyIn)}, money out ${money(d.moneyOut)}${d.spending.length ? `, mostly ${d.spending.slice(0, 2).map(s => s.category).join(' and ')}` : ''}.`);
  if (d.earnings.length) lines.push(`Reporting earnings this week: ${d.earnings.map(e => `${e.symbol} (${e.date})`).join(', ')}.`);
  const w = [];
  if (d.waiting.rules) w.push(`${d.waiting.rules} rule${d.waiting.rules > 1 ? 's' : ''} across accounts`);
  if (d.waiting.taxHarvest) w.push(`${d.waiting.taxHarvest} tax-saving trades`);
  if (w.length) lines.push(`Waiting for your approval: ${w.join(' and ')}.`);
  return { headline: d.netWorthChange == null ? 'Your week in money' : `Net worth ${d.netWorthChange >= 0 ? 'up' : 'down'} ${money(Math.abs(d.netWorthChange))}`, paragraphs: lines, watch: [] };
}

export async function writeBrief(user, { force = false, t = now() } = {}) {
  const week = weekOf(t), have = await one('SELECT * FROM briefs WHERE user_id = ? AND week = ?', user.id, week);
  if (have && !force) return parse(have);
  const d = await gather(user, t);
  let text = plainBrief(d), byAi = false;
  const { llmEnabled, jsonCall } = await import('./llm.js');
  if (llmEnabled()) {
    try {
      text = await jsonCall({
        system: 'You write a short weekly money brief for one person, in plain English a beginner understands. Say what changed this week and why, using only the numbers given (do not invent prices, news or reasons that are not in the data; when the reason is not in the data, say the market moved). Never recommend buying, selling or any investment, and do not give tax or legal advice. Mention anything waiting for their approval. Friendly, calm, no hype, no emojis. 3 to 5 short paragraphs.',
        user: `This week's numbers (JSON):\n${JSON.stringify(d)}`,
        schema: { type: 'object', additionalProperties: false, required: ['headline', 'paragraphs', 'watch'], properties: { headline: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } }, watch: { type: 'array', items: { type: 'string' }, description: 'Up to 3 neutral things to keep an eye on next week (dates, approvals), no advice' } } },
        maxTokens: 1500,
      });
      byAi = true;
    } catch (e) { console.warn('brief ai', e.message); }
  }
  await run('INSERT INTO briefs (user_id, week, data, text, by_ai, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, week) DO UPDATE SET data = excluded.data, text = excluded.text, by_ai = excluded.by_ai, created_at = excluded.created_at', user.id, week, JSON.stringify(d), JSON.stringify(text), byAi ? 1 : 0, now());
  return parse(await one('SELECT * FROM briefs WHERE user_id = ? AND week = ?', user.id, week));
}
const parse = r => ({ id: r.id, week: r.week, data: JSON.parse(r.data), ...JSON.parse(r.text), byAi: !!r.by_ai, createdAt: r.created_at });

// Mondays from 7 AM New York: write and email the brief to everyone who asked for it.
export async function weeklyBriefs(t = now()) {
  const n = nyTime(t);
  if (new Date(n.day + 'T12:00:00Z').getUTCDay() !== 1 || n.minutes < 420) return 0;
  let sent = 0;
  for (const u of await all("SELECT u.* FROM users u JOIN user_settings s ON s.user_id = u.id WHERE s.k = 'briefEmail' AND s.v = 'true'")) {
    if (!(await addonOn(u.id, 'brief'))) continue;
    if (await one('SELECT 1 FROM briefs WHERE user_id = ? AND week = ?', u.id, weekOf(t))) continue;
    const b = await writeBrief(u, { t }).catch(e => (console.warn('brief', u.id, e.message), null));
    if (!b || !u.email) continue;
    const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    await sendEmail(u.email, `Your week in money: ${b.headline}`, `${b.headline}\n\n${b.paragraphs.join('\n\n')}${b.watch?.length ? `\n\nTo keep an eye on:\n${b.watch.map(w => '- ' + w).join('\n')}` : ''}\n\nRead it in the app: ${base}/app#/brief\n\nFacts from your own accounts, not investment advice.`).catch(e => console.warn('brief email', e.message));
    sent++; if (sent >= 200) break;
  }
  return sent;
}

export const briefRouter = (() => {
  const r = express.Router();
  r.use(requireUser, requireAddon('brief'));
  r.get('/', async (req, res) => {
    const list = (await all('SELECT * FROM briefs WHERE user_id = ? ORDER BY week DESC LIMIT 12', req.user.id)).map(parse);
    res.json({ latest: list[0] || null, past: list.slice(1).map(b => ({ week: b.week, headline: b.headline })), email: await getSetting(req.user.id, 'briefEmail', false), thisWeek: weekOf() });
  });
  r.get('/week/:week', async (req, res) => { const b = await one('SELECT * FROM briefs WHERE user_id = ? AND week = ?', req.user.id, String(req.params.week)); if (!b) throw Object.assign(new Error('Not found'), { status: 404 }); res.json(parse(b)); });
  r.post('/write', async (req, res) => {
    const last = await one('SELECT created_at FROM briefs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', req.user.id);
    if (req.body?.force && last && now() - last.created_at < 10 * 60e3) throw Object.assign(new Error('You just wrote one; try again in a few minutes'), { status: 429 });
    res.json(await writeBrief(req.user, { force: !!req.body?.force }));
  });
  r.put('/email', async (req, res) => { await setSetting(req.user.id, 'briefEmail', !!req.body?.on); res.json({ email: !!req.body?.on }); });
  return r;
})();
