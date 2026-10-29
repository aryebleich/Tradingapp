// Chart read-out, portfolio number settings (live, since last look, hide today), the PDF cover
// page with links in the contents, and the new symbol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serve } from './client.js';
import { markdownPdf } from '../src/pdf.js';

test('portfolio number settings are saved per user and checked', async () => {
  const s = await serve();
  try {
    const u = s.client(); await u.signup('pnl-prefs@example.com');
    assert.deepEqual((await u('/prefs/portfolio')).body.value, null);
    assert.deepEqual((await u('/prefs/portfolio', { value: { mode: 'both', hideToday: true } }, 'PUT')).body.value, { mode: 'both', hideToday: true });
    assert.deepEqual((await u('/prefs/portfolio', { value: { mode: 'wild', hideToday: 'yes' } }, 'PUT')).body.value, { mode: 'live', hideToday: true });
    const seen = (await u('/prefs/seen', { value: { paper: { equity: 101000, at: 1 }, 'bad key!': { equity: 1, at: 1 }, alpaca: { equity: 'x', at: 1 } } }, 'PUT')).body.value;
    assert.deepEqual(seen, { paper: { equity: 101000, at: 1 } });
    assert.deepEqual((await u('/prefs/seen', { value: { paper: { equity: 2, at: 3, prevEquity: 1, prevAt: 2 } } }, 'PUT')).body.value, { paper: { equity: 2, at: 3, prevEquity: 1, prevAt: 2 } });
  } finally { s.close(); }
});

test('the PDF has a cover page with the symbol, and the contents link to each section', () => {
  const sec = n => `## Section ${n}\n\n` + Array.from({ length: 50 }, (_, i) => `Line ${i}.`).join('\n\n');
  const { pdf, pages } = markdownPdf('# Guide\n\n' + [1, 2, 3, 4].map(sec).join('\n\n'), { title: 'Guide', coverTitle: 'Private README', subtitle: 'For admins only' });
  const t = pdf.toString('latin1');
  const streams = [...t.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(m => m[1]);
  assert.equal(streams.length, pages);
  assert.match(streams[0], /\(Bright\) Tj .* \(folio\) Tj/); assert.match(streams[0], /\(Private README\) Tj/); assert.doesNotMatch(streams[0], /Page 1 of/);
  assert.match(streams[1], /\(Contents\) Tj/);
  // Every contents line is a link to the page its section starts on.
  const pageIds = [...t.matchAll(/(\d+) 0 obj\n<< \/Type \/Page \//g)].map(m => +m[1]);
  const links = [...t.matchAll(/\/Subtype \/Link \/Rect \[[^\]]+\] \/Border \[0 0 0\] \/Dest \[(\d+) 0 R \/XYZ/g)].map(m => pageIds.indexOf(+m[1]) + 1);
  assert.equal(links.length, 4);
  for (const [i, n] of [1, 2, 3, 4].entries()) assert.ok(streams[links[i] - 1].includes(`(Section ${n}) Tj`), `link ${n} goes to its section`);
  // Statements (no contents) have no cover.
  assert.doesNotMatch(markdownPdf('# One\n\nHi', { toc: false }).pdf.toString('latin1'), /\(folio\) Tj/);
});

test('the symbol, its spacing, and the chart read-out', () => {
  const svg = fs.readFileSync('public/favicon.svg', 'utf8');
  assert.match(svg, /linearGradient/); assert.match(svg, /#fde047/);
  assert.match(fs.readFileSync('public/site.css', 'utf8'), /\.logo \{ display: flex; align-items: center; gap: 12px;/);
  assert.match(fs.readFileSync('public/theme.css', 'utf8'), /\.brand \{[^}]*gap: 11px;[^}]*margin-inline-end: 8px;/);
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /function wireChartHover\(canvas\)/);
  assert.match(app, /drawChart\(\$\('#eqc', view\), a\.history\.map\(x => x\.equity\), \{ base, dates: a\.history\.map\(x => x\.day\) \}\)/);
});
