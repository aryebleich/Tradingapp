// Batch pull requests and the "Unfinished tasks" overview (AGENTS.md): only the sub-pull-requests a merged
// batch lists are closed, and every unfinished task is listed at the top of the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const B = await import('../scripts/ai-batch.mjs');
const S = await import('../scripts/ai-status.mjs');

test('batch: only "- <ID> #<n>" lines count; a number mentioned elsewhere is never closed', () => {
  const body = B.batchBody([{ task: 'AI-04B', pr: 67 }, { task: 'FEAT-02', pr: 70 }]) + '\n\nReplaces the stale draft #12 later.';
  assert.deepEqual(B.included(body), [{ task: 'AI-04B', pr: 67 }, { task: 'FEAT-02', pr: 70 }]);
  assert.ok(B.TITLE.test('BATCH-2026-11-27: open tasks'));
  assert.ok(!B.TITLE.test('Batch: open tasks') && !B.TITLE.test('BATCH-2026-11-27: something else'));
});

test('batch: the closer runs only for a merged batch, closes only listed open pull requests, and never the batch itself', () => {
  const wf = fs.readFileSync(new URL('../.github/workflows/batch-close.yml', import.meta.url), 'utf8');
  assert.match(wf, /github\.event\.pull_request\.merged == true && startsWith\(github\.event\.pull_request\.title, 'BATCH-'\)/);
  assert.match(wf, /node scripts\/ai-batch\.mjs included/);
  assert.match(wf, /\[ "\$state" = OPEN \]/);
  assert.match(wf, /\[ "\$pr" = "\$BATCH" \] && continue/);
  assert.match(wf, /BODY: \$\{\{ github\.event\.pull_request\.body \}\}/, 'the body reaches the script through the environment, never pasted into the shell');
});

test('overview: active, paused and blocked rows, and ready rows the loop already started, with their branch and next action', () => {
  const md = [
    '# x', '', '## Assistants', '', '| Assistant | Task | State | Updated (UTC) | Last SHA | Next action | Reset (UTC) |', '| --- | --- | --- | --- | --- | --- | --- |', '',
    '## Queue', '', '| ID | State | Priority | Suggested | Claimed by | Updated (UTC) | Task and done when |', '| --- | --- | --- | --- | --- | --- | --- |',
    '| A-1 | active | 1 | Claude | Claude | 2026-11-27 10:00 | x |', '| B-2 | ready | 2 | Codex | — | — | started by the loop |', '| C-3 | ready | 3 | Codex | — | — | not started |', '| D-4 | done | 0 | Grok | Grok | 2026-11-26 10:00 | done |', '',
    '## Hand-offs', '', '### 2026-11-27 11:00 UTC · Codex · B-2 · ready', '- **Last SHA:** abc', '- **Blockers:** the run failed (ai-loop run 1)', '- **Next action:** Any assistant: take B-2 again from ai/task-b-2', '',
  ].join('\n');
  const out = S.withOverview(md);
  const block = out.slice(out.indexOf('<!-- open:start -->'), out.indexOf('<!-- open:end -->'));
  assert.match(block, /\| A-1 \| Claude \| active \| main \|/);
  assert.match(block, /\| B-2 \| Codex \| ready \| ai\/task-b-2 \| 2026-11-27 11:00 UTC \| Any assistant: take B-2 again/);
  assert.doesNotMatch(block, /C-3|D-4/);
  assert.equal(S.withOverview(out), out, 'rebuilding it changes nothing');
  assert.ok(out.indexOf('<!-- open:start -->') < out.indexOf('## Assistants'), 'at the top of the board');
});

test('overview: the real board carries a current one', () => {
  const md = fs.readFileSync(new URL('../AI_HANDOFF.md', import.meta.url), 'utf8');
  assert.equal(S.withOverview(md), md, 'run npm run ai:status');
});
