// Grok in the automatic loop (.github/workflows/ai-loop.yml): research and second-opinion rows, and a
// market or product review of a pull request. Grok writes no app code: its result is a research note
// under docs/research/ (merged through release-gates.yml like any branch) or a review comment, plus a
// hand-off for the next coding run. Needs XAI_API_KEY; XAI_MODEL overrides the model. max_tokens keeps
// one run inside its per-run ceiling (Admin → AI team → Work status).
//   node scripts/ai-grok.mjs work --task RES-01 --out note-and-handoff.json
//   node scripts/ai-grok.mjs review --diff pr.diff --out review.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './ai-status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
const MODEL = process.env.XAI_MODEL || 'grok-4-latest';
export const NOTE_PATH = /^docs\/research\/[a-z0-9][a-z0-9-]{1,60}\.md$/;

const RULES = `You are Grok, one of three AI assistants (with Claude and Codex) working on Brightolio, a trading platform in a PUBLIC GitHub repo.
Your role: market and news research, competitor and pricing scans, product second opinions, market realism, and reviews of AI picks and disclosures. You write no app code.
Rules: no investment advice and no promised returns; recommend no dark patterns (no countdowns, fake scarcity, invented reviews or hidden cancel); paper trading stays the default.
Facts need a public source with a link and a date. Mark estimates as estimates.
The output is public: never include secrets, email addresses, server addresses, account details or private plans.`;

async function ask(system, user, maxTokens) {
  if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY is not set');
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(240000),
    headers: { authorization: `Bearer ${process.env.XAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 429) throw Object.assign(new Error('usage limit: ' + (d.error?.message || 'rate limited')), { limit: true, retryAfter: r.headers.get('retry-after') });
  if (!r.ok) throw new Error(`xAI answered ${r.status}: ${String(d.error?.message || d.error || '').slice(0, 200)}`);
  const text = d.choices?.[0]?.message?.content || '';
  try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error('Grok did not answer in JSON'); }
}

// A note that is safe to commit: under docs/research/, Markdown, no email or key-looking text.
export function checkNote(out) {
  const p = String(out?.notePath || ''), note = String(out?.note || '');
  if (!NOTE_PATH.test(p)) throw new Error('the note path must be docs/research/<name>.md');
  if (note.length < 200) throw new Error('the note is too short');
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(note) || /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(note) || /\b(sk-|xai-|ghp_|AKIA)[A-Za-z0-9]{8,}/.test(note)) throw new Error('the note contains an email address, a server address or a key-like string');
  return { notePath: p, note: note.trimEnd() + '\n' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2], outFile = arg('out', 'grok-out.json');
  try {
    if (cmd === 'work') {
      const id = arg('task'), st = build(read('AI_HANDOFF.md'));
      const row = [...st.queue.active, ...st.queue.ready].find(r => r.id === id);
      if (!row) throw new Error(`${id} is not on the board`);
      const user = `Task ${id}: ${row.task}\n\nThe latest hand-offs:\n${JSON.stringify(st.handoffs.slice(0, 3), null, 1)}\n\nContext from the repo (PRO_REVIEW.md, first part):\n${read('PRO_REVIEW.md').slice(0, 9000)}\n\nAnswer as JSON: {"notePath": "docs/research/<short-name>.md", "note": "<the full Markdown note, with sources and dates>", "handoff": {"changed": "...", "checks": "the sources you checked, with dates", "blockers": "none or what", "next": "one concrete next step for Claude or Codex"}}`;
      const out = await ask(RULES, user, 6000);
      fs.writeFileSync(outFile, JSON.stringify({ ok: true, ...checkNote(out), handoff: out.handoff || {} }));
    } else if (cmd === 'review') {
      const diff = fs.readFileSync(arg('diff'), 'utf8').slice(0, 60000);
      const user = `Give a market and product review of this pull request: market realism (fills, fees, slippage, trading rules), pricing and plan honesty, AI picks and their disclosures, and compliance with "no promised returns, no dark patterns". Only real problems; style is not your concern.\n\n${diff}\n\nAnswer as JSON: {"summary": "two sentences", "findings": [{"where": "file or area", "problem": "...", "fix": "..."}]}`;
      const out = await ask(RULES, user, 2500);
      fs.writeFileSync(outFile, JSON.stringify({ ok: true, summary: String(out.summary || ''), findings: Array.isArray(out.findings) ? out.findings.slice(0, 15) : [] }));
    } else { console.error('usage: ai-grok.mjs work|review ...'); process.exit(2); }
  } catch (e) {
    fs.writeFileSync(outFile, JSON.stringify({ ok: false, limit: !!e.limit, retryAfter: e.retryAfter || null, error: String(e.message).slice(0, 300) }));
    console.error(e.message); process.exit(1);
  }
}
