// The three assistants' automatic loop (src/ai-loop.js): per-use billing starts at a $0 cap, so nothing
// costs money until the owner raises it; Claude through the owner's subscription may run; a pause
// always wins; and Grok (xAI) only becomes an AI provider once its cap is raised.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const L = await import('../src/ai-loop.js');
const S = await import('../src/site.js');
const keep = { XAI_API_KEY: process.env.XAI_API_KEY, XAI_MODEL: process.env.XAI_MODEL, AI_PROVIDER: process.env.AI_PROVIDER };
const reset = () => S.siteSet('aiLoop', null);
after(async () => { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } await reset(); });

test('by default only Claude through the subscription may run; everything billed per use is at $0', async () => {
  await reset();
  const b = L.budget();
  assert.equal(b.allowed.claudeSubscription.ok, true);
  for (const k of ['claudePerUse', 'codex', 'grok']) { assert.equal(b.allowed[k].ok, false, k); assert.match(b.allowed[k].reason, /\$0/); }
  assert.deepEqual(b.spent, { claude: 0, codex: 0, grok: 0 });
});

test('a raised cap allows runs until the month reaches it, counting each run at its ceiling', async () => {
  await reset();
  await L.setCaps({ grok: { monthlyUsd: 1, perRunUsd: 0.25 }, codex: { monthlyUsd: -5 } });
  assert.equal(L.loopSettings().caps.codex.monthlyUsd, 0, 'a negative cap is $0');
  for (let i = 0; i < 4; i++) { assert.equal(L.allowed('grok').ok, true, `run ${i + 1}`); await L.recordRun({ assistant: 'grok', task: 'RES-01', outcome: 'done', run: '123' }); }
  assert.equal(L.spent('grok'), 1);
  const no = L.allowed('grok'); assert.equal(no.ok, false); assert.match(no.reason, /cap is reached/);
  await L.recordRun({ assistant: 'claude', billing: 'subscription', task: 'REV-01' });
  assert.equal(L.spent('claude'), 0, 'subscription runs cost nothing per use');
  assert.equal(L.loopSettings().runs.at(-1).task, 'REV-01');
});

test('a pause stops an assistant even when its cap allows it, and the run record keeps no free text', async () => {
  await reset();
  await L.setCaps({ codex: { monthlyUsd: 50 } });
  await L.setPaused('codex', true, '2026-11-26T20:00Z');
  assert.equal(L.allowed('codex').ok, false); assert.match(L.allowed('codex').reason, /paused/);
  await L.setPaused('codex', false);
  assert.equal(L.allowed('codex').ok, true);
  await L.recordRun({ assistant: 'codex', task: 'REV-02 <script>', outcome: 'done; rm', run: 'abc999' });
  const r = L.loopSettings().runs.at(-1);
  assert.equal(r.task, 'REV-02script'); assert.equal(r.outcome, 'donerm'); assert.equal(r.run, '999');
  await assert.rejects(L.recordRun({ assistant: 'someone' }), /Unknown assistant/);
});

test('Grok is an AI provider only with its key and a raised cap, at the xAI base and the XAI_MODEL model', async () => {
  await reset();
  const llm = await import('../src/llm.js');
  process.env.XAI_API_KEY = 'test-placeholder'; delete process.env.XAI_MODEL;
  assert.equal(llm.providers().some(p => p.id === 'xai'), false, 'a key alone never costs money');
  await L.setCaps({ grok: { monthlyUsd: 5 } });
  const g = llm.providers().find(p => p.id === 'xai');
  assert.ok(g); assert.equal(g.base, 'https://api.x.ai/v1'); assert.equal(g.model, llm.XAI.model); assert.equal(g.paid, true);
  process.env.XAI_MODEL = 'grok-test-model'; process.env.AI_PROVIDER = 'xai';
  assert.equal(llm.provider().model, 'grok-test-model');
  delete process.env.XAI_API_KEY;
  assert.equal(llm.providers().some(p => p.id === 'xai'), false);
});

test('the deployed board is readable for Admin → AI team → Work status', () => {
  const s = L.workStatus();
  assert.ok(s); assert.deepEqual(s.assistants.map(a => a.name), ['Claude', 'Codex', 'Grok']);
});

// ---------- the workflow's picker (scripts/ai-loop.mjs) and Grok's notes (scripts/ai-grok.mjs) ----------
const P = await import('../scripts/ai-loop.mjs');
const G = await import('../scripts/ai-grok.mjs');
const row = (id, state, suggested, claimedBy = null, updated = null, priority = 1) => ({ id, state, priority, suggested, claimedBy, updated, task: `${id}. Done when it works.` });
const board = rows => ({ queue: Object.fromEntries(['active', 'paused', 'ready', 'blocked', 'done'].map(s => [s, rows.filter(r => r.state === s)])) });
const NOW = Date.parse('2026-11-26T15:00:00Z');
const OK = { allowed: { claudeSubscription: { ok: true }, claudePerUse: { ok: false }, codex: { ok: true }, grok: { ok: true } } };

test('the picker runs only assistants with a key and room under the cap; without the site, only Claude on the subscription', () => {
  assert.deepEqual(P.eligible(['claude_oauth', 'openai', 'xai'], null).map(x => x.assistant), ['claude']);
  assert.deepEqual(P.eligible(['anthropic', 'openai', 'xai'], OK).map(x => x.assistant), ['codex', 'grok'], 'Claude on a per-use key needs its own cap');
  assert.deepEqual(P.eligible(['claude_oauth', 'openai', 'xai'], OK).map(x => `${x.assistant}:${x.billing}`), ['claude:subscription', 'codex:per-use', 'grok:per-use']);
});

test('each assistant takes its own kind of row; Grok never takes a coding row; fresh claims are left alone', () => {
  const st = board([row('A-01', 'active', 'Claude', 'Codex', '2026-11-26 14:00'), row('B-01', 'ready', 'Codex'), row('C-01', 'ready', 'Grok'), row('D-01', 'ready', 'Claude')]);
  assert.equal(P.rowFor('codex', st, { now: NOW }).row.id, 'B-01');
  assert.equal(P.rowFor('grok', st, { now: NOW }).row.id, 'C-01');
  assert.equal(P.rowFor('claude', st, { now: NOW }).row.id, 'D-01');
  assert.match(P.rowFor('claude', st, { task: 'A-01', now: NOW }).none, /belongs to Codex/);
  assert.match(P.rowFor('grok', st, { task: 'B-01', now: NOW }).none, /coding task/);
  const onlyCoding = board([row('B-01', 'ready', 'Codex')]);
  assert.ok(P.rowFor('grok', onlyCoding, { now: NOW }).none);
  assert.equal(P.rowFor('claude', onlyCoding, { now: NOW }).row.id, 'B-01', 'an idle coder takes any ready coding row');
});

test('a claim older than 3 hours may be taken over, and the takeover is reported', () => {
  const st = board([row('A-01', 'active', 'Claude', 'Codex', '2026-11-26 11:00'), row('B-01', 'ready', 'Codex')]);
  const p = P.pick({ assistant: 'claude', keys: ['claude_oauth'], budget: OK, status: st, now: NOW });
  assert.equal(p.task, 'A-01'); assert.equal(p.takeover, 'Codex');
  const mine = board([row('A-01', 'active', 'Claude', 'Claude', '2026-11-26 14:30'), row('B-01', 'ready', 'Claude')]);
  assert.equal(P.rowFor('claude', mine, { now: NOW }).row.id, 'B-01', 'its own fresh claim may be an interactive session: left alone');
  assert.ok(P.pick({ assistant: 'codex', keys: ['claude_oauth'], budget: OK, status: mine, now: NOW }).none);
});

test('Grok notes go only to docs/research/, and never hold an email, an address or a key', () => {
  const long = 'Pricing of retail platforms, with sources and dates. '.repeat(8);
  assert.equal(G.checkNote({ notePath: 'docs/research/pricing.md', note: long }).notePath, 'docs/research/pricing.md');
  for (const p of ['src/llm.js', 'docs/research/../../server.js', 'docs/research/Pricing.md', 'AI_HANDOFF.md']) assert.throws(() => G.checkNote({ notePath: p, note: long }), /note path/, p);
  assert.throws(() => G.checkNote({ notePath: 'docs/research/notes.md', note: long + ' write to someone@example.com' }), /email/);
  assert.throws(() => G.checkNote({ notePath: 'docs/research/notes.md', note: 'short' }), /too short/);
});

test('ai-loop.yml: each assistant only with its key, caps asked first, one task at a time, reviews before merge', async () => {
  const fs = await import('node:fs'), y = fs.readFileSync('.github/workflows/ai-loop.yml', 'utf8'), g = fs.readFileSync('.github/workflows/release-gates.yml', 'utf8');
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'XAI_API_KEY']) assert.match(y, new RegExp(`secrets\\.${k} != ''`), k);
  assert.match(y, /\/internal\/ai-loop\/budget/); assert.match(y, /\/internal\/ai-loop\/run/);
  assert.match(y, /cancel-in-progress: false/); assert.match(y, /openai\/codex-action@v1/); assert.match(y, /anthropics\/claude-code-action@v1/);
  assert.match(y, /reviewed=true/); assert.match(g, /ai\/claude-\*\|ai\/codex-\*\)/); assert.match(g, /run-name: .*\(reviewed\)/);
  assert.doesNotMatch(y, /git push[^\n]*--force/);
});
