// The shared AI work board (AI_HANDOFF.md) and its JSON copy (ai/status.json) are public, because the
// repo is public: they must never hold anything that looks like a key, an email address or a server
// address, and the JSON must always match the board. The paste-in prompts follow the same rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, build, sortedProblems, RAW, ASSISTANTS, findPrivate } from '../scripts/ai-status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PUBLIC_FILES = ['AI_HANDOFF.md', 'ai/status.json', 'AGENTS.md', ...fs.readdirSync(path.join(ROOT, 'ai/prompts')).map(f => 'ai/prompts/' + f)];

test('the public AI files hold nothing that looks like a key, an email address or a server address', () => {
  for (const f of PUBLIC_FILES) assert.deepEqual(findPrivate(read(f)), [], f);
});

test('the checker catches the usual leaks (and leaves short SHAs and links alone)', () => {
  for (const bad of ['contact owner@example.com', 'key sk-proj-abcdefgh1234', 'xai-AbC123dEf456', 'ghp_' + 'a1'.repeat(10), 'server 10.1.2.3', 'https://1-2-3-4.ss' + 'lip.io', 'tok ' + 'aZ9'.repeat(13)])
    assert.ok(findPrivate(bad).length, bad);
  assert.deepEqual(findPrivate('Last SHA: 84a43b1, see https://raw.githubusercontent.com/aryebleich/Tradingapp/main/ai/status.json'), []);
});

test('ai/status.json is generated from AI_HANDOFF.md and up to date', () => {
  assert.equal(read('ai/status.json'), render(read('AI_HANDOFF.md')), 'run npm run ai:status');
});

test('the board names the three assistants, keeps the queue in order, and gives the raw links', () => {
  const md = read('AI_HANDOFF.md'), s = build(md);
  assert.deepEqual(s.assistants.map(a => a.name), ASSISTANTS);
  assert.deepEqual(sortedProblems(md), []);
  for (const u of [RAW.board, RAW.status]) assert.ok(md.includes(u), u);
  assert.ok(Object.values(s.queue).flat().length >= 20, 'at least 20 tracked tasks across queue states');
  for (const r of s.queue.ready) { assert.match(r.task, /Done when/, r.id); assert.ok(ASSISTANTS.includes(r.suggested), `${r.id}: suggested assistant`); }
  assert.ok(s.handoffs.length && s.handoffs[0].next_action, 'the newest hand-off has a next action');
});

test('every paste-in prompt reads the board and the rules at their raw links, and covers working without push access', () => {
  for (const f of ['chatgpt.md', 'grok.md', 'claude-web.md']) {
    const p = read('ai/prompts/' + f);
    for (const u of [RAW.board, RAW.status, RAW.rules]) assert.ok(p.includes(u), `${f}: ${u}`);
    assert.match(p, /### [0-9-]+ [0-9:]+ UTC · /, `${f}: shows the hand-off heading format`);
    assert.match(p, /cannot push|can't push/i, `${f}: says what to do without push access`);
  }
});
