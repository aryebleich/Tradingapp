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
  const assistants = table(md, 'Assistants').map(r => ({ name: clean(r.assistant), task: dash(r.task), state: clean(r.state), updated: dash(r.updated), lastSha: dash(r.last_sha), next: dash(r.next_action), reset: dash(r.reset) }));
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


// ---------- public safety (test/ai-status.test.js, the AI hand-off inbox) ----------
// What a secret or a private detail tends to look like.
export const LOOKS_PRIVATE = [
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

// ---------- editing the board (scripts/ai-loop.mjs and the assistants use these) ----------
const cellsOf = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const lineOf = cells => '| ' + cells.join(' | ') + ' |';
function section(md, title) {
  const i = md.indexOf(`\n## ${title}\n`); if (i < 0) throw new Error(`AI_HANDOFF.md has no "## ${title}" section`);
  const end = md.indexOf('\n## ', i + 4);
  return { start: i, end: end < 0 ? md.length : end };
}
// The queue sorted: active, paused, ready by priority, blocked, done (stable within a state).
export function sortQueue(md) {
  const { start, end } = section(md, 'Queue'), body = md.slice(start, end).split('\n');
  const first = body.findIndex(l => l.trim().startsWith('|'));
  if (first < 0) return md;
  const rows = body.slice(first + 2).filter(l => l.trim().startsWith('|'));
  const head = cellsOf(body[first]).map(h => h.toLowerCase());
  const si = head.indexOf('state'), pi = head.indexOf('priority');
  const rank = l => { const c = cellsOf(l); const st = STATES.indexOf(clean(c[si])); return [st < 0 ? 99 : st, clean(c[si]) === 'ready' ? (clean(c[pi]) !== '' && Number.isFinite(Number(clean(c[pi]))) ? Number(clean(c[pi])) : 999) : 0]; }; // priority 0 is first, not missing
  const sorted = rows.map((l, k) => ({ l, k, r: rank(l) })).sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.k - b.k).map(x => x.l);
  const lastRow = first + 2 + body.slice(first + 2).findIndex(l => !l.trim().startsWith('|'));
  const stop = lastRow < first + 2 ? body.length : lastRow;
  const out = [...body.slice(0, first + 2), ...sorted, ...body.slice(stop)];
  return md.slice(0, start) + out.join('\n') + md.slice(end);
}
// Changes named cells of one table row (by its first cell); unknown columns are an error.
export function setRow(md, title, key, changes) {
  const { start, end } = section(md, title), body = md.slice(start, end).split('\n');
  const first = body.findIndex(l => l.trim().startsWith('|'));
  const head = cellsOf(body[first]).map(h => h.toLowerCase().replace(/\s*\(utc\)/, '').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''));
  const k = body.findIndex((l, n) => n > first + 1 && l.trim().startsWith('|') && clean(cellsOf(l)[0]) === key);
  if (k < 0) throw new Error(`no row "${key}" in ${title}`);
  const c = cellsOf(body[k]);
  for (const [col, v] of Object.entries(changes)) { const n = head.indexOf(col); if (n < 0) throw new Error(`no column ${col} in ${title}`); c[n] = String(v ?? '—').replace(/\|/g, '/').replace(/\n/g, ' '); }
  body[k] = lineOf(c);
  return md.slice(0, start) + body.join('\n') + md.slice(end);
}
// A hand-off at the top of "## Hand-offs".
export function addHandoff(md, { at, assistant, task, state, lastSha, changed, checks, blockers, next }) {
  const { start, end } = section(md, 'Hand-offs'), body = md.slice(start, end);
  const k = body.indexOf('\n### '), insertAt = k < 0 ? body.length : k;
  const f = v => String(v || 'none').replace(/\n+/g, ' ').trim();
  const block = `\n### ${at} UTC · ${assistant} · ${task} · ${state}\n- **Last SHA:** ${f(lastSha)}\n- **Changed:** ${f(changed)}\n- **Checks:** ${f(checks)}\n- **Blockers:** ${f(blockers)}\n- **Next action:** ${f(next)}\n`;
  return md.slice(0, start) + body.slice(0, insertAt) + block + body.slice(insertAt) + md.slice(end);
}
export const utcNow = (t = new Date()) => t.toISOString().slice(0, 16).replace('T', ' ');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const board = path.join(ROOT, 'AI_HANDOFF.md'), out = path.join(ROOT, 'ai/status.json'), check = process.argv.includes('--check');
  let md = fs.readFileSync(board, 'utf8');
  // Writing also keeps the queue in order (active, paused, ready by priority, blocked, done).
  if (!check) { const sorted = sortQueue(md); if (sorted !== md) { fs.writeFileSync(board, sorted); md = sorted; console.log('sorted the queue in AI_HANDOFF.md'); } }
  const bad = sortedProblems(md);
  if (bad.length) { console.error('AI_HANDOFF.md queue order:\n- ' + bad.join('\n- ')); process.exit(1); }
  const json = render(md);
  if (check) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== json) { console.error('ai/status.json is out of date: run npm run ai:status'); process.exit(1); }
    console.log('ai/status.json is up to date');
  } else { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, json); console.log('wrote ai/status.json'); }
}
