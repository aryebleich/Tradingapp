// Every AI answer says what it was built on and how sure it is, and that it promises nothing
// (src/ai-evidence.js, registry A-19, queue row AI-04; master plan section 2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve } from './client.js';

const { evidence, NOT_ADVICE } = await import('../src/ai-evidence.js');
let srv;
before(async () => { srv = await serve(); });
after(() => srv?.close());

const wellFormed = (ev, where) => {
  assert.ok(ev, `${where}: the answer carries its evidence`);
  assert.ok(['high', 'medium', 'low'].includes(ev.confidence), `${where}: a confidence level`);
  assert.match(ev.confidenceText, /^How sure: (high|medium|low)\./, where);
  assert.equal(ev.notAdvice, NOT_ADVICE, where);
  assert.ok(Array.isArray(ev.basis) && Array.isArray(ev.sources), where);
  assert.doesNotMatch(JSON.stringify(ev), /guarantee|will (rise|go up)|sure profit/i, `${where}: no promise`);
};

test('evidence: confidence comes from what the answer was built on, never from the model', () => {
  assert.equal(evidence({ tools: ['technical_snapshot', 'market_news'] }).confidence, 'high');
  assert.equal(evidence({ tools: ['technical_snapshot'] }).confidence, 'medium');
  assert.equal(evidence({ sources: [{ url: 'https://www.sec.gov/x', title: '10-K' }] }).confidence, 'medium');
  assert.equal(evidence({}).confidence, 'low');
  assert.equal(evidence({ by: 'rules' }).confidence, 'low');
  assert.equal(evidence({ by: 'rules', tools: ['technical_snapshot', 'market_news'] }).confidence, 'medium', 'plain rules are never "high"');
  assert.deepEqual(evidence({ tools: ['technical_snapshot'] }).basis, ['Daily prices and indicators']);
  assert.equal(evidence({ sources: [{ url: 'javascript:alert(1)', title: 'x' }] }).sources[0].url, null, 'only web links');
});

test('evidence: forecasts (picks, signals) are never "high" and say they are forecasts', () => {
  const f = evidence({ forecast: true, data: ['News headlines', 'Prices before the open', 'The record of past picks, losses included'] });
  assert.equal(f.confidence, 'medium');
  assert.match(f.confidenceText, /It is a forecast: prices can move the other way/);
  assert.match(f.confidenceText, /Built on news headlines, prices before the open, the record of past picks/);
});

test('evidence: AI morning picks, AI signals and the options desk review carry it', async () => {
  const c = srv.client(); await c.signup('evidence-2@example.com');
  for (const [path, body] of [['/newspicks'], ['/aisignals'], ['/optdesk/ai/review', { account: 'paper' }]]) {
    const r = await c(path, body);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body).slice(0, 200)}`);
    wellFormed(r.body.evidence, path);
  }
  assert.equal((await c('/newspicks')).body.evidence.confidence !== 'high', true);
});

test('evidence: the AI routes return it (chat, AI tools, why your P/L moved)', async () => {
  const c = srv.client(); await c.signup('evidence@example.com');
  const chat = await c('/ai/chat', { messages: [{ role: 'user', content: 'How does AAPL look technically?' }] });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  wellFormed(chat.body.evidence, 'chat');
  const general = await c('/ai/chat', { messages: [{ role: 'user', content: 'hello there' }] });
  wellFormed(general.body.evidence, 'chat (general)'); assert.equal(general.body.evidence.confidence, 'low');
  const news = await c('/aitools/news', { text: 'Apple beats earnings estimates and raises its buyback.' });
  assert.equal(news.status, 200, JSON.stringify(news.body)); wellFormed(news.body.evidence, 'AI tools: news');
  const why = await c('/pnlwhy?account=paper');
  if (why.body?.summary) wellFormed(why.body.evidence, 'why your P/L moved');
});
