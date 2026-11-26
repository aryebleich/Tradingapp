// The shared AI work board (AI_HANDOFF.md) and its JSON copy (ai/status.json) are public, because the
// repo is public: they must never hold anything that looks like a key, an email address or a server
// address, and the JSON must always match the board. The paste-in prompts follow the same rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, build, sortedProblems, RAW, ASSISTANTS } from '../scripts/ai-status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PUBLIC_FILES = ['AI_HANDOFF.md', 'ai/status.json', 'AGENTS.md', ...fs.readdirSync(path.join(ROOT, 'ai/prompts')).map(f => 'ai/prompts/' + f)];

// What a secret or a private detail tends to look like.
const LOOKS_PRIVATE = [
  ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/],
  ['an API key', /\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16}|whsec_[A-Za-z0-9]{8,}|[sr]k_(live|test)_[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9]{16,})/],
  ['a JWT or bearer token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a long random token', /\b(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])(?![0-9a-f]{40}\b)[A-Za-z0-9_-]{36,}\b/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a server IP address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ['the server\'s own address', /sslip\.io/i],
];
export function findPrivate(text) {
  const out = [];
  text.split('\n').forEach((line, i) => { for (const [what, re] of LOOKS_PRIVATE) if (re.test(line)) out.push(`line ${i + 1}: ${what}`); });
  return out;
}

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
