// The AI hand-off inbox (.github/workflows/ai-inbox.yml, .github/ISSUE_TEMPLATE/ai-handoff.yml): a web
// chat that cannot push (Grok on grok.com, ChatGPT, the Claude web chat) ends with a note and a
// hand-off; the owner pastes them into the issue form, and this commits them to the board, with no
// API key and no copy into Claude Code or Codex. Code patches are refused here: they go through Claude
// Code or Codex, which test them.
//   node scripts/ai-inbox.mjs <issue-body-file> <issue-number>   (edits AI_HANDOFF.md, ai/status.json, docs/research/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, handoffs, setRow, sortQueue, addHandoff, render, findPrivate, ASSISTANTS } from './ai-status.mjs';
import { checkNote } from './ai-grok.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABELS = ['Assistant', 'Task ID', 'Note path (optional)', 'Note (optional)', 'Hand-off'];
const unfence = v => v.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
const empty = v => !v || v === '_No response_';

// The issue form's body ("### Label\n\nvalue" for each field, in order) as an object.
export function parseForm(body) {
  const out = {}, text = String(body || '').replace(/\r/g, '');
  LABELS.forEach((label, k) => {
    const start = text.indexOf(`### ${label}\n`); if (start < 0) return;
    const from = start + label.length + 5, next = LABELS.slice(k + 1).map(l => text.indexOf(`\n### ${l}\n`, from)).filter(n => n >= 0);
    const v = text.slice(from, next.length ? Math.min(...next) : undefined).trim();
    out[label] = empty(v) ? '' : unfence(v);
  });
  return { assistant: out['Assistant'] || '', task: (out['Task ID'] || '').toUpperCase(), notePath: out['Note path (optional)'] || '', note: out['Note (optional)'] || '', handoff: out['Hand-off'] || '' };
}

// Checks a parsed form against the board, and returns the edits to make (pure; the tests use it).
export function plan(form, md, now = new Date(), issue = null) {
  const errors = [];
  // One issue, one hand-off: an issue already committed is never committed again.
  if (issue && md.includes(`(from issue #${issue})`)) return { errors: [`issue #${issue} is already on the board`], already: true };
  if (!ASSISTANTS.includes(form.assistant)) errors.push(`unknown assistant "${form.assistant}"`);
  if (!/^[A-Z]{2,8}-\d{1,3}$/.test(form.task)) errors.push(`"${form.task}" is not a task ID like RES-03`);
  const st = build(md), all = Object.values(st.queue).flat(), row = all.find(r => r.id === form.task);
  if (form.task && !row) errors.push(`${form.task} is not on the board`);
  const h = handoffs('\n## Hand-offs\n\n### ' + form.handoff.replace(/^###\s*/, ''))[0];
  if (!h || !h.next_action) errors.push('the hand-off needs the "### <UTC time> · <assistant> · <ID> · <state>" heading and a Next action line');
  if (h && h.assistant !== form.assistant) errors.push(`the hand-off names ${h.assistant}, not ${form.assistant}`);
  if (h && h.task !== form.task) errors.push(`the hand-off is for ${h.task}, not ${form.task}`);
  if (h && !['done', 'paused', 'blocked', 'ready'].includes(h.state)) errors.push(`the hand-off state must be done, paused, blocked or ready (not "${h.state}")`);
  if (/^(diff --git|--- a\/|\+\+\+ b\/)/m.test(form.handoff + '\n' + form.note)) errors.push('code patches go through Claude Code or Codex, not the inbox');
  let note = null;
  if (form.notePath || form.note) { try { note = checkNote({ notePath: form.notePath, note: form.note }); } catch (e) { errors.push(e.message); } }
  const leaks = findPrivate([form.handoff, form.note].join('\n'));
  if (leaks.length) errors.push('it looks like it holds private data (' + leaks.slice(0, 3).join('; ') + '): remove that and edit the issue');
  if (errors.length) return { errors };
  const at = now.toISOString().slice(0, 16).replace('T', ' ');
  return { at, note, row, handoff: h };
}

export function apply(md, form, p, issue) {
  const h = p.handoff;
  let b = setRow(md, 'Queue', form.task, { state: h.state, claimed_by: h.state === 'ready' ? '—' : form.assistant, updated: p.at });
  b = setRow(b, 'Assistants', form.assistant, { task: h.state === 'done' ? '—' : form.task, state: h.state === 'done' ? 'idle' : h.state, updated: p.at, last_sha: h.last_sha || '—', next_action: h.next_action });
  b = addHandoff(b, { at: p.at, assistant: form.assistant, task: form.task, state: h.state, lastSha: h.last_sha, changed: (h.changed || '') + (issue ? ` (from issue #${issue})` : ''), checks: h.checks, blockers: h.blockers, next: h.next_action });
  return sortQueue(b);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, issue] = process.argv.slice(2);
  const form = parseForm(fs.readFileSync(file, 'utf8')), board = path.join(ROOT, 'AI_HANDOFF.md'), md = fs.readFileSync(board, 'utf8');
  const p = plan(form, md, new Date(), issue);
  if (p.already) { console.log(JSON.stringify({ ok: true, already: true, task: form.task })); process.exit(3); }
  if (p.errors) { console.log(JSON.stringify({ ok: false, errors: p.errors })); process.exit(1); }
  const next = apply(md, form, p, issue);
  fs.writeFileSync(board, next); fs.writeFileSync(path.join(ROOT, 'ai/status.json'), render(next));
  if (p.note) { fs.mkdirSync(path.dirname(path.join(ROOT, p.note.notePath)), { recursive: true }); fs.writeFileSync(path.join(ROOT, p.note.notePath), p.note.note); }
  console.log(JSON.stringify({ ok: true, task: form.task, assistant: form.assistant, state: p.handoff.state, note: p.note?.notePath || null }));
}
