// The AI router (Part 2): it classifies the need by rules, picks a strong model for hard code, a free
// fast model for a short question, falls back when a provider is refused or out of quota, never
// sends member data to a provider whose terms do not allow it, and records why it chose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, decide, rank, score, catalogFor, healthOf, reasonText, recordDecision, recentDecisions } from '../src/ai/router.js';

const cand = (provider, id, name) => ({ ...catalogFor(provider, id), provider, id, name });
const CLAUDE = cand('anthropic', 'claude-opus-5-5', 'Claude');
const GROQ = cand('groq', 'openai/gpt-oss-120b', 'Groq');
const GEMINI = cand('gemini', 'gemini-2.5-flash', 'Gemini');
const OPENAI = cand('openai', 'gpt-test', 'ChatGPT (OpenAI)');
const ALL = [CLAUDE, GROQ, GEMINI, OPENAI];

test('rules classify the need: code, translation, finance, a short question, reasoning, an image', () => {
  assert.equal(classify({ text: 'why does this throw?\n```js\nfoo()\n```' }).need, 'coding');
  assert.equal(classify({ text: 'Translate this into Yiddish: good morning' }).need, 'translation');
  assert.equal(classify({ text: 'What is the NPV at 7% over 5 years?' }).need, 'finance');
  assert.equal(classify({ text: 'Is it open today?' }).need, 'quick');
  assert.equal(classify({ text: 'Compare two strategies and explain the trade-off in detail and why one wins over the other across regimes, with a short plan for each approach over several years of data and costs.' }).need, 'reasoning');
  assert.equal(classify({ text: 'what is this', hasImage: true }).need, 'image');
});

test('code gets a strong model, not a free one', () => {
  const d = decide({ text: 'Fix this bug:\n```js\nconst x = ;\n```' }, { candidates: ALL, health: {} });
  assert.equal(d.need, 'coding');
  assert.ok(['anthropic', 'openai'].includes(d.model.provider), d.reason); // both are strong coding models; a tie goes to the name
  assert.match(d.reason, /coding/);
});

test('a short question gets a fast free model, and the expensive one is kept for hard tasks', () => {
  const d = decide({ text: 'Is the market open today?' }, { candidates: ALL, health: {} });
  assert.equal(d.need, 'quick');
  assert.ok(['groq', 'gemini'].includes(d.model.provider), d.reason);
  assert.match(d.reason, /quick answer, free$/);
});

test('member data never goes to a provider whose terms do not allow it', () => {
  const d = decide({ text: 'Is the market open today?', member: true }, { candidates: ALL, health: {} });
  assert.ok(['anthropic', 'openai'].includes(d.model.provider), 'only a provider allowed to receive member data');
  assert.ok(d.blocked.some(b => b.provider === 'groq' && /privacy/.test(b.reason)));
  assert.ok(d.blocked.some(b => b.provider === 'gemini' && /privacy/.test(b.reason)));
});

test('a provider refused for its key or out of quota is skipped, and the next one answers', () => {
  const now = 1_000_000;
  const health = healthOf({ anthropic: { at: now - 1000, status: 401, message: 'refused' } }, now);
  const d = decide({ text: 'Fix this bug:\n```js\nx\n```' }, { candidates: ALL, health });
  assert.notEqual(d.model.provider, 'anthropic');
  assert.ok(d.blocked.some(b => b.provider === 'anthropic'));
  assert.equal(d.model.provider, 'openai', 'the next strong model is the fallback');
});

test('a rate-limited provider is ranked lower, not removed', () => {
  const now = 1_000_000;
  const health = healthOf({ gemini: { at: now - 1000, status: 429 } }, now);
  const r = rank([GEMINI, GROQ], 'quick', { health });
  assert.equal(r.ranked.length, 2);
  const solo = score(GEMINI, 'quick', { health }).score, free = score(GEMINI, 'quick', {}).score;
  assert.ok(solo < free);
});

test('the answer says which model and why, with its alternatives', () => {
  const d = decide({ text: 'Summarise the news for me in a few words' }, { candidates: [GROQ, GEMINI], health: {} });
  assert.equal(d.need, 'summary');
  assert.match(d.reason, /^(Groq|Gemini): summary/);
  assert.equal(reasonText({ name: 'Groq' }, 'quick'), 'Groq: quick answer');
  assert.equal(reasonText({ name: 'Groq', free: true }, 'quick'), 'Groq: quick answer, free');
});

test('with no key at all there is no model, and the decision says so', () => {
  const d = decide({ text: 'hello' }, { candidates: [], health: {} });
  assert.equal(d.model, null);
  assert.match(d.reason, /no model is available/);
});

test('decisions are recorded with their reason, and only the last 200 are kept', async () => {
  await recordDecision({ at: 1, need: 'quick', model: 'Groq', reason: 'Groq: quick answer, free' });
  const last = (await recentDecisions(1))[0];
  assert.equal(last.reason, 'Groq: quick answer, free');
  for (let i = 0; i < 205; i++) await recordDecision({ at: i + 2, need: 'general', model: 'x', reason: 'r' });
  assert.ok((await recentDecisions(500)).length <= 200);
});
