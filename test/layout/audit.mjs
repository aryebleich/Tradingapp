// Phase 1 inventory: writes the per-page table of AUDIT.md (part 2) from a run of run.mjs, using
// the OLD layout's measurements (what is live today). Layout problems are measured, not guessed:
// sideways scroll, h1 count, small targets, axe violations, hidden disclosures, page length on phones.
//   node test/layout/audit.mjs e2e-output/layout-staging/pair.json > /tmp/inventory.md
import fs from 'node:fs';

const { results, pages } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MONEY = /trade|order|position|options|optionsdesk|funding|billing|money|account|accounts|wealth|invest|bank|payroll|invoices|books|tax|retirement|crypto|close|shorting|margin|admin-money|admin-alpaca|robo|bots|fleet/;
const kind = id => /^site\//.test(id) ? 'Public' : /^out\//.test(id) ? 'Sign-in' : /admin/.test(id) ? 'Admin' : MONEY.test(id) ? 'Trading / payment' : 'App';
const esc = s => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const rows = [];
for (const pg of pages) {
  const r = results[pg.id] || {}, d = r[1440]?.old, m = r[390]?.old;
  if (!d || d.failed) { rows.push(`| ${pg.id} | ${kind(pg.id)} | (did not load: ${esc(d?.failed)}) | | | | |`); continue; }
  const probs = [];
  for (const w of [1440, 1280, 768, 390]) if (r[w]?.old?.overflowX) probs.push(`page scrolls sideways at ${w}`);
  if (d.h1 !== 1) probs.push(`${d.h1} visible h1`);
  if (m?.smallTargets) probs.push(`${m.smallTargets} targets < 24px on phones`);
  const ax = Object.entries([...(d.axe || []), ...(m?.axe || [])].reduce((a, v) => ((a[v.id] = Math.max(a[v.id] || 0, v.n)), a), {})).map(([k, n]) => `${k} ×${n}`);
  if (ax.length) probs.push('axe: ' + ax.join(', '));
  const hidden = d.disclosures.filter(x => !x.visible).length;
  if (hidden) probs.push(`${hidden} disclosure block(s) hidden`);
  if (m && m.pageHeight > 6 * 844) probs.push(`long on phones (${Math.round(m.pageHeight / 844)} screens)`);
  if (d.tables) probs.push(`${d.tables} table(s)`);
  const disc = [...new Set(d.disclosures.map(x => x.text.replace(/\s+/g, ' ').slice(0, 70)))];
  const fees = [...new Set(d.figures.map(f => f.split('\t')).filter(([v, c]) => /fee|commission|credit|price|\/mo|month|year|plan/i.test(c) && /[$%]/.test(v)).map(([v, c]) => `${v} (${c.slice(0, 30)})`))].slice(0, 4);
  const controls = /Trading|Sign-in/.test(kind(pg.id)) ? d.controls.filter(c => /buy|sell|order|review|submit|confirm|deposit|withdraw|transfer|close|cancel|pay|qty|amount|limit|stop|password|email|sign|log/i.test(c)) : [];
  rows.push(`| ${pg.id} | ${kind(pg.id)} | ${esc(d.title).slice(0, 50)} | ${esc(d.primary?.[0] || '—')} | ${esc(probs.join('; ') || 'none measured')} | ${esc(disc.slice(0, 4).join(' / ') || '—')}${disc.length > 4 ? ` (+${disc.length - 4} more)` : ''} | ${esc([...fees, ...[...new Set(controls)].slice(0, 10)].join(', ') || '—')} |`);
}
console.log(`| Page | Type | Purpose (its h1) | Primary action | Layout problems (old layout, measured) | Disclosures on the page | Fees, payment and trading controls |
|---|---|---|---|---|---|---|
${rows.join('\n')}`);
