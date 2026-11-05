// The "Product overview" at the top of the private README, rebuilt from the code itself on every
// deploy and every time the README is opened: the menu and its pages, the admin tabs, the plans
// and what each allows, brokerages, market-data and live-stream sources, background jobs, the
// settings (key names only, never values) and the GitHub workflows. Because it is generated, it
// is always a full, current picture rather than a list of additions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
// An array literal assigned to `name` in a client file (our own source, so evaluating it is safe).
export function literal(src, name) {
  const i = src.indexOf(`const ${name} = [`); if (i < 0) return null;
  let j = src.indexOf('[', i), depth = 0, k = j, q = null;
  for (; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') q = c; else if (c === '[') depth++; else if (c === ']' && --depth === 0) break;
  }
  try { return Function(`return ${src.slice(j, k + 1)}`)(); } catch { return null; }
}
const list = a => a.map(x => `- ${x}`).join('\n');

export async function overviewMd() {
  const app = read('public/app.js');
  const core = literal(app, 'CORE') || [], nav = literal(app, 'NAV') || [], adminTabs = literal(app, 'ADMIN_TABS') || [];
  const [{ PLANS, AI_LIMITS, TRIAL_DAYS }, { STRATEGY_LIMITS }, DS, { WS_PROVIDERS }, { EXT }, { JOBS }, { ENV_GROUPS }] = await Promise.all([
    import('./fees.js'), import('./rotation/routes.js'), import('./datasources.js'), import('./streams.js'), import('./ext/brokers.js'), import('./jobs.js'), import('./site.js')]);
  const pkg = JSON.parse(read('package.json') || '{}');
  const workflows = fs.existsSync(path.join(root, '.github/workflows')) ? fs.readdirSync(path.join(root, '.github/workflows')).filter(f => /\.ya?ml$/.test(f)).sort() : [];
  const wfName = f => (/^name:\s*(.+)$/m.exec(read('.github/workflows/' + f))?.[1] || f).replace(/^['"]|['"]$/g, '');
  const tests = fs.existsSync(path.join(root, 'test')) ? fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.js')).length : 0;
  const pages = core.length + nav.reduce((a, [, items]) => a + items.length, 0);
  const plans = Object.entries(PLANS);
  const limits = k => STRATEGY_LIMITS[k] || STRATEGY_LIMITS.free;
  const lines = [];
  lines.push(`_Generated from the code on ${new Date().toISOString().slice(0, 10)} (package ${pkg.version || '-'}). This section is rebuilt on every deploy, so it always describes the whole product as it is now. The dated "Changes" sections below record what changed and why._`);
  lines.push(`\n### What Brightolio is\nSoftware for practicing, researching, backtesting and automating investments on the brokerage the user chooses. Brightolio is not a broker-dealer and does not hold money; orders go to the user's own brokerage account (or the built-in $100,000 paper account). Users reach it on the web, the Android app, by text message and by phone. ${pages} pages in the menu, ${adminTabs.length} admin tabs, ${JOBS.length} background jobs, ${tests} unit-test files plus a browser end-to-end run.`);
  lines.push(`\n### The menu (what users see)\n**Always shown:** ${core.map(x => x[1]).join(', ')}.\n\n${nav.map(([g, items]) => `**${g}:** ${items.map(x => x[1]).join(', ')}.`).join('\n\n')}`);
  lines.push(`\n### Admin (owner only)\n${adminTabs.map(x => x[1]).join(' · ')}`);
  lines.push(`\n### Plans\nPaid plans start with a ${TRIAL_DAYS}-day free trial.\n\n| Plan | Price | AI messages a day | Saved / automatic strategies | Backtest years | Margin | Publish strategies |\n|---|---|---|---|---|---|---|\n${plans.map(([k, p]) => { const l = limits(k); return `| ${p.name} | ${p.monthly ? `$${p.monthly}/month or $${p.yearly}/year` : 'Free'} | ${AI_LIMITS[k] ?? '-'} | ${l.saved} / ${l.auto} | ${l.backtestYears} | ${l.margin > 1 ? `up to ${l.margin}x` : 'no'} | ${l.publish ? 'yes' : 'copy only'} |`; }).join('\n')}\n\n${plans.map(([, p]) => `**${p.name}** (${p.tagline}): ${p.features.join('; ')}.`).join('\n\n')}`);
  lines.push(`\n### Brokerages\nThe built-in paper account; Alpaca (suggested: OAuth for users' own accounts, or the Broker API to open accounts); ${Object.keys(EXT).map(k => ({ tradier: 'Tradier', tastytrade: 'tastytrade', schwab: 'Charles Schwab', tradestation: 'TradeStation' }[k] || k)).join(', ')}.`);
  lines.push(`\n### Market data\n**Prices and history** (Admin → Market data; fastest first, your order, or race the two fastest): ${Object.entries(DS.PROVIDERS).map(([k, p]) => `${p.name}${p.key ? ` (key ${p.key})` : ''} — ${DS.freshness(k).label.toLowerCase()}`).join('; ')}.\n\n**Live streams** (WebSocket, one shared connection; quotes, the Trade page and price alerts update as trades happen): Alpaca${Object.values(WS_PROVIDERS).map(p => `, ${p.name} (${p.key})`).join('')}. Every price on screen is labeled real-time, real-time (IEX), delayed, previous close or market closed.`);
  lines.push(`\n### Background jobs (minutes between runs)\n${list(JOBS.map(([id, every]) => `${id}: every ${every >= 1440 ? `${every / 1440} day(s)` : every >= 60 ? `${every / 60} hour(s)` : `${every} min`}`))}`);
  lines.push(`\n### Settings and keys (names only; values live in Render or Admin → Keys)\n${ENV_GROUPS.map(([g, keys]) => `**${g}:** ${keys.join(', ')}`).join('\n\n')}`);
  lines.push(`\n### GitHub workflows\n${list(workflows.map(f => `${wfName(f)} (\`${f}\`)`))}`);
  lines.push(`\n### Safety rules built into the product\n${list(['No claims that AI or any strategy guarantees returns; a test checks the public pages for such wording.', 'Real-money orders always need the user\'s confirmation (and the password for risky actions); the AI assistant can place real orders only on Ultimate, after the user turns it on, one confirmed order at a time.', 'Sells can never exceed what the account holds; short selling only when the user asks.', 'Personal details are removed before text is sent to an AI provider; Social Security and bank numbers are passed to the broker and not stored.', 'Risk disclosure, privacy policy and an in-app Investor protection page with links to FINRA BrokerCheck, the SEC adviser search and Investor.gov.'])}`);
  return lines.join('\n');
}
