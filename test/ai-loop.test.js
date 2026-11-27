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

test('ai-loop.yml: each assistant only with its key, caps asked first, one task at a time, reviewed right after the merge', async () => {
  const fs = await import('node:fs'), y = fs.readFileSync('.github/workflows/ai-loop.yml', 'utf8'), g = fs.readFileSync('.github/workflows/release-gates.yml', 'utf8');
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'XAI_API_KEY']) assert.match(y, new RegExp(`secrets\\.${k} != ''`), k);
  assert.match(y, /\/internal\/ai-loop\/budget/); assert.match(y, /\/internal\/ai-loop\/run/);
  assert.match(y, /cancel-in-progress: false/); assert.match(y, /openai\/codex-action@v1/); assert.match(y, /anthropics\/claude-code-action@v1/);
  assert.match(y, /review_pr/); assert.match(g, /gh workflow run ai-loop\.yml -f review_pr/); assert.doesNotMatch(g, /reviewed=true|inputs\.reviewed/);
  assert.doesNotMatch(y, /git push[^\n]*--force/);
});

// ---------- without paid keys: Codex through GitHub (@codex), Grok through the AI hand-off inbox ----------
const I = await import('../scripts/ai-inbox.mjs');
const fsx = await import('node:fs');
const BOARD = fsx.readFileSync('AI_HANDOFF.md', 'utf8');
const form = (o = {}) => {
  const f = { Assistant: 'Grok', 'Task ID': 'RES-01', 'Note path (optional)': '_No response_', 'Note (optional)': '_No response_',
    'Hand-off': '```markdown\n### 2026-11-26 16:20 UTC · Grok · RES-01 · done\n- **Last SHA:** chat, not pushed\n- **Changed:** a follow-up of the pricing note\n- **Checks:** public pricing pages, 2026-11-26\n- **Blockers:** none\n- **Next action:** Claude: use option B in REV-01\n```', ...o };
  return Object.entries(f).map(([k, v]) => `### ${k}\n\n${v}`).join('\n\n');
};

test('Codex through its GitHub integration runs on the plan, with no API key and no cap, and is preferred over the API', () => {
  assert.deepEqual(P.eligible(['codex_github'], null).map(x => `${x.assistant}:${x.billing}`), ['codex:plan']);
  assert.deepEqual(P.eligible(['codex_github', 'openai'], OK).map(x => x.billing), ['plan']);
  assert.deepEqual(P.eligible(['codex_github'], { allowed: {}, paused: { codex: { at: 1 } } }), [], 'a pause in Admin still wins');
  assert.equal(L.budget().allowed.codexPlan.ok, true);
});

test('the AI inbox reads the issue form, keeps the hand-off heading inside its fence, and puts it on the board', () => {
  const f = I.parseForm(form());
  assert.equal(f.assistant, 'Grok'); assert.equal(f.task, 'RES-01'); assert.equal(f.note, ''); assert.match(f.handoff, /^### 2026-11-26 16:20 UTC · Grok · RES-01 · done/);
  const p = I.plan(f, BOARD, new Date('2026-11-26T16:25:00Z'));
  assert.equal(p.errors, undefined, JSON.stringify(p.errors));
  const S2 = I.apply(BOARD, f, p, 77);
  assert.match(S2, /### 2026-11-26 16:25 UTC · Grok · RES-01 · done\n- \*\*Last SHA:\*\* chat, not pushed\n- \*\*Changed:\*\* a follow-up of the pricing note \(from issue #77\)/);
  assert.match(S2, /\| Grok \| — \| idle \| 2026-11-26 16:25 \|/);
});

test('the AI inbox refuses a wrong task, a mismatched hand-off, a patch and anything that looks private', () => {
  const errs = o => I.plan(I.parseForm(form(o)), BOARD).errors || [];
  assert.match(errs({ 'Task ID': 'NOPE-99' }).join(), /not on the board/);
  assert.match(errs({ Assistant: 'Codex' }).join(), /names Grok, not Codex/);
  assert.match(errs({ 'Note (optional)': '```markdown\ndiff --git a/x b/x\n```', 'Note path (optional)': 'docs/research/notes.md' }).join(), /patches/);
  assert.match(errs({ 'Hand-off': '```\n### 2026-11-26 16:20 UTC · Grok · RES-01 · done\n- **Next action:** mail owner@example.com\n```' }).join(), /private/);
  assert.match(errs({ 'Note path (optional)': 'src/server.js', 'Note (optional)': 'x'.repeat(300) }).join(), /note path/);
  assert.match(errs({ 'Hand-off': 'no heading here' }).join(), /heading/);
});

test('the inbox and the @codex steps: only the owner\'s issues count, and Codex\'s verdict merges or sends back', () => {
  const inbox = fsx.readFileSync('.github/workflows/ai-inbox.yml', 'utf8'), loop = fsx.readFileSync('.github/workflows/ai-loop.yml', 'utf8');
  assert.match(inbox, /\["OWNER","MEMBER","COLLABORATOR"\][^\n]*github\.event\.issue\.author_association/, 'only people with write access');
  assert.doesNotMatch(inbox, /CONTRIBUTOR|NONE|FIRST_TIME/);
  assert.match(inbox, /node --test test\/ai-status\.test\.js/, 'the public-safety test runs before the commit');
  assert.ok(fsx.existsSync('.github/ISSUE_TEMPLATE/ai-handoff.yml'));
  assert.match(loop, /CODEX_GITHUB == '1'/); assert.match(loop, /@codex review/); assert.match(loop, /codex-verdict:/);
  assert.match(loop, /didn\.\?t find any major issues/); assert.match(loop, /CODEX_MENTION_TOKEN/);
  for (const f of ['chatgpt.md', 'grok.md', 'claude-web.md']) assert.match(fsx.readFileSync('ai/prompts/' + f, 'utf8'), /issues\/new\?template=ai-handoff\.yml/, f);
});

test('the AI inbox commits each issue once: a second event for the same issue is refused', () => {
  const f = I.parseForm(form());
  const p = I.plan(f, BOARD, new Date('2026-11-26T16:25:00Z'), 77);
  const once = I.apply(BOARD, f, p, 77);
  const again = I.plan(f, once, new Date('2026-11-26T16:26:00Z'), 77);
  assert.equal(again.already, true); assert.match(again.errors.join(), /already on the board/);
  assert.match(fsx.readFileSync('.github/workflows/ai-inbox.yml', 'utf8'), /types: \[opened, edited\]/);
});

// ---------- the chain: Claude → Grok → Codex (TEAM-03) ----------
const stamp = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const chainBoard = ({ rows, resets = {}, handoffs = [] }) => ({
  ...board(rows),
  assistants: ['Claude', 'Codex', 'Grok'].map(n => ({ name: n, reset: resets[n] ? stamp(resets[n]) : null })),
  handoffs,
});
const ALLOW = { allowed: { claudeSubscription: { ok: true }, claudePerUse: { ok: false }, codex: { ok: true }, grok: { ok: true } } };
const NO_GROK = { allowed: { ...ALLOW.allowed, grok: { ok: false, reason: 'the monthly cap is $0' } } };
const ALL_KEYS = ['claude_oauth', 'xai', 'codex_github'];

test('the chain: Claude first, then Grok on the same task and branch when Claude is at its usage limit', () => {
  const st = chainBoard({ rows: [row('REV-01', 'paused', 'Claude', 'Claude', '2026-11-26 13:00')], resets: { Claude: NOW + 3 * 3600e3 } });
  const p = P.chainPick({ keys: ALL_KEYS, budget: ALLOW, status: st, now: NOW });
  assert.equal(p.assistant, 'grok'); assert.equal(p.task, 'REV-01'); assert.equal(p.branch, 'ai/task-rev-01');
  assert.equal(p.takeoverFrom, 'Claude'); assert.match(p.skipped[0].why, /usage limit until/);
  // After Claude's reset, Claude is first again.
  assert.equal(P.chainPick({ keys: ALL_KEYS, budget: ALLOW, status: st, now: NOW + 4 * 3600e3 }).assistant, 'claude');
});

test('no XAI key, or a $0 Grok cap: straight to Codex through GitHub, with the reason', () => {
  const st = chainBoard({ rows: [row('REV-01', 'paused', 'Claude', 'Claude', '2026-11-26 13:00')], resets: { Claude: NOW + 3600e3 } });
  const noKey = P.chainPick({ keys: ['claude_oauth', 'codex_github'], budget: ALLOW, status: st, now: NOW });
  assert.equal(noKey.assistant, 'codex'); assert.equal(noKey.billing, 'plan'); assert.match(noKey.skipped.find(x => x.assistant === 'grok').why, /no XAI_API_KEY/);
  const zeroCap = P.chainPick({ keys: ALL_KEYS, budget: NO_GROK, status: st, now: NOW });
  assert.equal(zeroCap.assistant, 'codex'); assert.match(zeroCap.skipped.find(x => x.assistant === 'grok').why, /cap/);
});

test('Grok failing after 3 tries hands the task to Codex', () => {
  const st = chainBoard({ rows: [row('REV-01', 'paused', 'Claude', 'Grok', '2026-11-26 13:00')], resets: { Claude: NOW + 3600e3 },
    handoffs: [{ at: '2026-11-26 13:00 UTC', assistant: 'Grok', task: 'REV-01', state: 'paused', blockers: 'Grok failed after 3 tries: the checks failed' }] });
  const p = P.chainPick({ keys: ALL_KEYS, budget: ALLOW, status: st, now: NOW });
  assert.equal(p.assistant, 'codex'); assert.equal(p.takeoverFrom, 'Grok'); assert.match(p.skipped.find(x => x.assistant === 'grok').why, /failed after 3 tries/);
});

test('all three at their limits: the task waits for the first reset', () => {
  const first = NOW + 2 * 3600e3;
  const st = chainBoard({ rows: [row('REV-01', 'paused', 'Claude', 'Codex', '2026-11-26 13:00')], resets: { Claude: NOW + 5 * 3600e3, Grok: first, Codex: NOW + 4 * 3600e3 } });
  const p = P.chainPick({ keys: ALL_KEYS, budget: ALLOW, status: st, now: NOW });
  assert.equal(p.assistant, undefined); assert.equal(p.wait, new Date(Date.parse(stamp(first).replace(' ', 'T') + ':00Z')).toISOString()); assert.equal(p.task, 'REV-01');
});

test('no per-use key is used while its cap is $0', () => {
  const st = chainBoard({ rows: [row('REV-01', 'ready', 'Claude')] });
  const zero = { allowed: { claudeSubscription: { ok: true }, claudePerUse: { ok: false }, codex: { ok: false }, grok: { ok: false } } };
  assert.ok(P.chainPick({ keys: ['anthropic', 'openai', 'xai'], budget: zero, status: st, now: NOW }).none, 'per-use Claude, Codex and Grok all wait for a cap');
  assert.equal(P.access('codex', ['openai'], zero).billing, undefined);
  assert.equal(P.access('claude', ['anthropic'], zero).billing, undefined);
  assert.equal(P.access('codex', ['codex_github'], zero).billing, 'plan', 'the ChatGPT plan is not billed per use');
});

test('research rows go to Grok first; a fresh claim by another session is left alone', () => {
  const research = chainBoard({ rows: [row('RES-03', 'ready', 'Grok')] });
  assert.equal(P.chainPick({ keys: ALL_KEYS, budget: ALLOW, status: research, now: NOW }).assistant, 'grok');
  const fresh = chainBoard({ rows: [row('REV-01', 'active', 'Claude', 'Claude', stamp(NOW - 3600e3))] });
  assert.ok(P.chainPick({ keys: ALL_KEYS, budget: ALLOW, status: fresh, now: NOW }).none);
});

test('auto-merge on green gates for every change; no owner-approved label', async () => {
  assert.equal(P.needsOwner, undefined, 'the owner gate is gone');
  const fs2 = await import('node:fs'), g = fs2.readFileSync('.github/workflows/release-gates.yml', 'utf8');
  assert.match(g, /gh pr merge "\$PR" --squash --delete-branch/);
  assert.doesNotMatch(g, /owner-approved|ai-loop\.mjs owner/);
  assert.match(g, /gh workflow run deploy\.yml --ref main/);
  const loop = fs2.readFileSync('.github/workflows/ai-loop.yml', 'utf8');
  assert.match(loop, /merge it into main without a pull request/, 'a refused pull request does not stop the run');
});

test('Grok as a coder never touches workflows, the board, the rules or secrets', () => {
  assert.deepEqual(G.checkPatch('--- a/src/stock.js\n+++ b/src/stock.js\n@@ -1 +1 @@\n-a\n+b\n'), ['src/stock.js']);
  for (const f of ['.github/workflows/ci.yml', 'AI_HANDOFF.md', 'ai/status.json', 'AGENTS.md', '.env', 'src/keystore.js', 'LEGAL_REVIEW.md'])
    assert.throws(() => G.checkPatch(`--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-a\n+b\n`), /may not change/, f);
  assert.throws(() => G.checkPatch('nothing here'), /no file/);
});
