// Grok in the automatic loop (.github/workflows/ai-loop.yml):
//   work    research and second-opinion rows: a note under docs/research/ plus a hand-off
//   code    a coding row, when Claude stopped at its usage limit (the chain Claude → Grok → Codex): it
//           reads AGENTS.md, the brief and progress note (ai/tasks/<ID>.md) and the files involved, writes
//           the change as a patch, applies it, runs npm test and the clean check, and fixes failures
//           (up to 3 tries). It never touches workflows, the board or anything secret.
//   review  a market or product review of a pull request
// Needs XAI_API_KEY; XAI_MODEL overrides the model. The workflow runs it only while Grok's cap in Admin →
// AI team is above $0, and max_tokens keeps one run inside its per-run ceiling.
//   node scripts/ai-grok.mjs work --task RES-01 --out note-and-handoff.json
//   node scripts/ai-grok.mjs code --task REV-01 --out handoff.json
//   node scripts/ai-grok.mjs review --diff pr.diff --out review.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
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

// ---------- code ----------
// Paths a Grok patch may never touch: the workflows, the board, the rules and anything holding secrets.
export const FORBIDDEN = [/^\.github\//, /^AI_HANDOFF\.md$/, /^ai\/status\.json$/, /^AGENTS\.md$/, /^CLAUDE\.md$/, /(^|\/)\.env/, /^LEGAL_REVIEW\.md$/, /^COMPLIANCE_REVIEW\.md$/, /^src\/(keystore|keys-catalog|crypto)\.js$/];
export function patchFiles(patch) {
  return [...new Set([...String(patch).matchAll(/^(?:\+\+\+ b\/|--- a\/)(\S+)/gm)].map(m => m[1]).filter(f => f !== '/dev/null'))];
}
export function checkPatch(patch) {
  const files = patchFiles(patch);
  if (!files.length) throw new Error('the patch changes no file');
  const bad = files.filter(f => FORBIDDEN.some(r => r.test(f)) || f.includes('..'));
  if (bad.length) throw new Error('the patch touches files Grok may not change: ' + bad.join(', '));
  return files;
}
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 15 * 60e3, maxBuffer: 64 * 1024 * 1024, ...opts });
// npm test and the clean check; the tail of the output when either fails.
function checks() {
  const t = sh(process.execPath, ['--import', './test/setup.js', '--test', '--test-force-exit', ...fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.test.js')).map(f => 'test/' + f)]);
  if (t.status !== 0) return { ok: false, log: (t.stdout + t.stderr).split('\n').filter(l => /not ok|error|Error|expected|actual/.test(l)).slice(0, 60).join('\n') };
  const c = sh(process.execPath, ['scripts/clean-check.mjs']);
  if (c.status !== 0) return { ok: false, log: (c.stdout + c.stderr).slice(-3000) };
  return { ok: true };
}
async function code(id, tries = 3) {
  const st = build(read('AI_HANDOFF.md')), row = [...st.queue.active, ...st.queue.paused, ...st.queue.ready].find(r => r.id === id);
  if (!row) throw new Error(`${id} is not on the board`);
  const brief = read(`ai/tasks/${id}.md`), files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(f => /^(src|public|test|scripts)\/|^server\.js$/.test(f) && !/\.(png|jpg|mp4|woff2|db)$/.test(f));
  const sys = RULES + '\nYou are now coding: write small, correct changes in the style of the surrounding code, with tests. No secrets, no real money, paper trading by default.';
  const pickFiles = await ask(sys, `Task ${id}: ${row.task}\n\nBrief and progress so far:\n${brief.slice(0, 8000)}\n\nRules (AGENTS.md, first part):\n${read('AGENTS.md').slice(0, 6000)}\n\nRepository files:\n${files.join('\n')}\n\nWhich files do you need to read to do the next step? Answer as JSON: {"files": ["path", ...]} (at most 12, from the list).`, 800);
  const want = (pickFiles.files || []).filter(f => files.includes(f)).slice(0, 12);
  let ctx = '', budget = 120000;
  for (const f of want) { const c = read(f); if (c.length > budget) continue; budget -= c.length; ctx += `\n===== ${f} =====\n${c}`; }
  let feedback = '';
  for (let k = 1; k <= tries; k++) {
    const out = await ask(sys, `Task ${id}: ${row.task}\n\nBrief and progress so far:\n${brief.slice(0, 8000)}\n\nThe files:${ctx}\n${feedback ? `\nYour last patch failed:\n${feedback}\nWrite a corrected patch against the files as they are now (your earlier patch is undone).` : ''}\n\nWrite the next step of the task as a unified diff that git apply accepts (paths a/... b/...), with tests. Never touch ${FORBIDDEN.map(String).join(' ')}. Answer as JSON: {"patch": "...", "summary": "what you changed", "next": "the next concrete step after this one"}.`, 12000);
    try {
      const changed = checkPatch(out.patch || '');
      const pf = path.join(ROOT, '.grok.patch'); fs.writeFileSync(pf, String(out.patch).replace(/\r/g, '') + '\n');
      const ap = sh('git', ['apply', '--whitespace=nowarn', pf]); fs.rmSync(pf, { force: true });
      if (ap.status !== 0) throw new Error('git apply refused the patch: ' + (ap.stderr || '').slice(0, 1500));
      const r = checks();
      if (r.ok) return { ok: true, tries: k, changed, summary: String(out.summary || '').slice(0, 400), next: String(out.next || '').slice(0, 300) };
      // Undo the try: tracked files back, and new files the patch added removed.
      sh('git', ['checkout', '--', '.']); sh('git', ['clean', '-fdq', '--', ...changed]);
      feedback = 'The checks failed:\n' + r.log.slice(0, 4000);
    } catch (e) { sh('git', ['checkout', '--', '.']); feedback = e.message.slice(0, 2000); }
  }
  return { ok: false, tries, failed: true, error: feedback.slice(0, 500) };
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
    } else if (cmd === 'code') {
      const r = await code(arg('task'));
      fs.writeFileSync(outFile, JSON.stringify(r.ok ? { ok: true, handoff: { changed: `${r.changed.join(', ')}: ${r.summary}`, checks: `npm test and the clean check passed (try ${r.tries} of 3)`, blockers: 'none', next: r.next } } : { ok: false, failed: true, error: `failed after ${r.tries} tries: ${r.error}` }));
      if (!r.ok) process.exit(1);
    } else if (cmd === 'review') {
      const diff = fs.readFileSync(arg('diff'), 'utf8').slice(0, 60000);
      const user = `Give a market and product review of this pull request: market realism (fills, fees, slippage, trading rules), pricing and plan honesty, AI picks and their disclosures, and compliance with "no promised returns, no dark patterns". Only real problems; style is not your concern.\n\n${diff}\n\nAnswer as JSON: {"summary": "two sentences", "findings": [{"where": "file or area", "problem": "...", "fix": "..."}]}`;
      const out = await ask(RULES, user, 2500);
      fs.writeFileSync(outFile, JSON.stringify({ ok: true, summary: String(out.summary || ''), findings: Array.isArray(out.findings) ? out.findings.slice(0, 15) : [] }));
    } else { console.error('usage: ai-grok.mjs work|code|review ...'); process.exit(2); }
  } catch (e) {
    fs.writeFileSync(outFile, JSON.stringify({ ok: false, limit: !!e.limit, retryAfter: e.retryAfter || null, error: String(e.message).slice(0, 300) }));
    console.error(e.message); process.exit(1);
  }
}
