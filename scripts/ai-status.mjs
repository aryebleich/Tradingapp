// AI_HANDOFF.md → ai/status.json: the shared work board of Claude, Codex and Grok, in a form that
// scripts, the Admin page (Admin → AI team → Work status) and web chats can read. Never edit
// ai/status.json by hand: run `npm run ai:status` (the AI status workflow also runs it after every
// push to main). `--check` exits 1 when ai/status.json is out of date.
// The output is deterministic (no generation time), so the check is stable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RAW = {
  board: 'https://raw.githubusercontent.com/aryebleich/Tradingapp/main/AI_HANDOFF.md',
  status: 'https://raw.githubusercontent.com/aryebleich/Tradingapp/main/ai/status.json',
  rules: 'https://raw.githubusercontent.com/aryebleich/Tradingapp/main/AGENTS.md',
};
export const ASSISTANTS = ['Claude', 'Codex', 'Grok'];
export const STATES = ['active', 'paused', 'ready', 'blocked', 'done'];
const clean = s => String(s || '').replace(/`/g, '').replace(/\*\*/g, '').trim();
const dash = s => (/^[-—–]?$/.test(clean(s)) ? null : clean(s));

// The rows of the first Markdown table under "## <title>".
export function table(md, title) {
  const i = md.indexOf(`\n## ${title}\n`); if (i < 0) return [];
  const end = md.indexOf('\n## ', i + 4), body = md.slice(i, end < 0 ? undefined : end);
  const lines = body.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const head = cells(lines[0]).map(h => h.toLowerCase().replace(/\s*\(utc\)/, '').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''));
  return lines.slice(2).map(l => Object.fromEntries(cells(l).map((c, k) => [head[k], c])));
}

// "### 2026-11-26 14:05 UTC · Claude · TEAM-01 · active" blocks, newest first, with their "- **Field:** text" lines.
export function handoffs(md) {
  const i = md.indexOf('\n## Hand-offs'); if (i < 0) return [];
  const end = md.indexOf('\n## ', i + 4), body = md.slice(i, end < 0 ? undefined : end);
  return body.split('\n### ').slice(1).map(b => {
    const [title, ...rest] = b.split('\n');
    const [at, assistant, task, state] = title.split('·').map(clean);
    const fields = {};
    for (const l of rest) { const m = /^\s*-\s+\*\*([^*]+?):\*\*\s*(.*)$/.exec(l); if (m) fields[m[1].toLowerCase().replace(/[^a-z]+/g, '_')] = clean(m[2]); }
    return { at, assistant, task, state, ...fields };
  });
}

export function build(md) {
  const assistants = table(md, 'Assistants').map(r => ({ name: clean(r.assistant), task: dash(r.task), state: clean(r.state), updated: dash(r.updated), lastSha: dash(r.last_sha), next: dash(r.next_action) }));
  const rows = table(md, 'Queue').map(r => ({ id: clean(r.id), state: clean(r.state), priority: Number(clean(r.priority)) || null, suggested: dash(r.suggested), claimedBy: dash(r.claimed_by), updated: dash(r.updated), task: clean(r.task_and_done_when) }));
  const by = s => rows.filter(r => r.state === s);
  return {
    board: RAW.board, rules: RAW.rules, about: 'Generated from AI_HANDOFF.md by scripts/ai-status.mjs. Public: holds no secrets or private details.',
    assistants,
    queue: { active: by('active'), paused: by('paused'), ready: by('ready'), blocked: by('blocked'), done: by('done') },
    blockers: rows.filter(r => r.state === 'blocked').map(r => ({ id: r.id, task: r.task })),
    owner: table(md, 'Owner only').map(r => ({ id: clean(r.id), task: clean(r.what_only_the_owner_can_do) })),
    handoffs: handoffs(md).slice(0, 10),
  };
}
// Rows in board order: active, paused, ready by priority, blocked, done.
export function sortedProblems(md) {
  const rows = table(md, 'Queue'), out = [];
  for (let k = 1; k < rows.length; k++) {
    const a = rows[k - 1], b = rows[k], ia = STATES.indexOf(clean(a.state)), ib = STATES.indexOf(clean(b.state));
    if (ia < 0) out.push(`${clean(a.id)}: unknown state "${clean(a.state)}"`);
    if (ia > ib) out.push(`${clean(b.id)} (${clean(b.state)}) comes after ${clean(a.id)} (${clean(a.state)})`);
    else if (ia === ib && clean(a.state) === 'ready' && Number(clean(a.priority)) > Number(clean(b.priority))) out.push(`${clean(b.id)} has a higher priority than ${clean(a.id)} above it`);
  }
  return out;
}
export const render = md => JSON.stringify(build(md), null, 2) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const md = fs.readFileSync(path.join(ROOT, 'AI_HANDOFF.md'), 'utf8'), out = path.join(ROOT, 'ai/status.json'), json = render(md);
  const bad = sortedProblems(md);
  if (bad.length) { console.error('AI_HANDOFF.md queue order:\n- ' + bad.join('\n- ')); process.exit(1); }
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== json) { console.error('ai/status.json is out of date: run npm run ai:status'); process.exit(1); }
    console.log('ai/status.json is up to date');
  } else { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, json); console.log('wrote ai/status.json'); }
}
