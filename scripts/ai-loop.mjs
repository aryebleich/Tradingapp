// The automatic side of the three-assistant loop (.github/workflows/ai-loop.yml, AGENTS.md):
//   pick     which assistant takes which row now (keys present, budget allowed, the queue, the 3-hour claims)
//   claim    marks the row active on the board (AI_HANDOFF.md) and regenerates ai/status.json
//   release  writes the hand-off and the row's new state (done, paused at a usage limit, blocked)
// The board edits are plain text edits of AI_HANDOFF.md (scripts/ai-status.mjs), so a human and the
// workflow keep the same file. Output is JSON on stdout (for the workflow's next steps).
//   node scripts/ai-loop.mjs pick --assistant auto|claude|codex|grok [--task REV-01] --keys claude_oauth,anthropic,codex_github,openai,xai [--budget budget.json]
//   node scripts/ai-loop.mjs claim --assistant claude --task REV-01 --sha abc1234
//   node scripts/ai-loop.mjs release --assistant claude --task REV-01 --state done --sha abc1234 [--pr 12] [--next "..."] [--changed "..."] [--checks "..."] [--blockers "..."]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, setRow, sortQueue, addHandoff, render, utcNow } from './ai-status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NAME = { claude: 'Claude', codex: 'Codex', grok: 'Grok' };
const CLAIM_MS = 3 * 3600e3;
const parseUtc = s => (s && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(s) ? Date.parse(s.replace(' ', 'T') + ':00Z') : NaN);

// Who may run: the key must exist, and anything billed per use needs room under its cap. With no
// budget answer (the site unreachable), only what is not billed per use runs: Claude through the
// owner's subscription, and Codex through its GitHub integration on the owner's ChatGPT plan
// (codex_github, the variable CODEX_GITHUB=1), which is preferred over Codex's per-use API key.
export function eligible(keys = [], budget = null) {
  const a = budget?.allowed || {}, out = [];
  if (keys.includes('claude_oauth') && (a.claudeSubscription?.ok ?? true)) out.push({ assistant: 'claude', billing: 'subscription' });
  else if (keys.includes('anthropic') && a.claudePerUse?.ok) out.push({ assistant: 'claude', billing: 'per-use' });
  if (keys.includes('codex_github') && !budget?.paused?.codex) out.push({ assistant: 'codex', billing: 'plan' });
  else if (keys.includes('openai') && a.codex?.ok) out.push({ assistant: 'codex', billing: 'per-use' });
  if (keys.includes('xai') && a.grok?.ok) out.push({ assistant: 'grok', billing: 'per-use' });
  return out;
}

// The row one assistant should take: its own active or paused row first, then the first ready row
// suggested for it, then (Claude and Codex only, when idle) any ready row that is not Grok's research.
// A claimed row updated less than 3 hours ago is never taken, even its own: an interactive session
// (Claude Code, Codex) may be working on it right now.
export function rowFor(assistant, status, { task = null, now = Date.now() } = {}) {
  const me = NAME[assistant], q = status.queue;
  const fresh = r => r.claimedBy && now - parseUtc(r.updated) < CLAIM_MS;
  if (task) {
    const all = [...q.active, ...q.paused, ...q.ready];
    const r = all.find(x => x.id === task);
    if (!r) return { none: `${task} is not active, paused or ready` };
    if (fresh(r)) return { none: `${task} belongs to ${r.claimedBy} (updated ${r.updated})` };
    if (assistant === 'grok' && r.suggested !== 'Grok') return { none: `${task} is a coding task; Grok takes research and review rows` };
    return { row: r };
  }
  const mine = [...q.active, ...q.paused].find(r => r.claimedBy === me && !fresh(r));
  if (mine) return { row: mine };
  const stale = [...q.active, ...q.paused].find(r => r.claimedBy && r.claimedBy !== me && !fresh(r) && (assistant !== 'grok' || r.suggested === 'Grok'));
  const suggested = q.ready.find(r => r.suggested === me);
  const any = assistant === 'grok' ? null : q.ready.find(r => r.suggested !== 'Grok');
  const row = suggested || stale || any;
  return row ? { row, takeover: row === stale ? row.claimedBy : null } : { none: 'nothing ready for ' + me };
}

export function pick({ assistant = 'auto', task = null, keys = [], budget = null, status, now = Date.now() }) {
  const can = eligible(keys, budget), reasons = {};
  const order = assistant === 'auto' ? can : can.filter(c => c.assistant === assistant);
  if (!order.length) return { none: assistant === 'auto' ? 'no assistant has a key and room under its cap' : `${assistant} has no key or no room under its cap`, budget: budget?.allowed || null };
  for (const c of order) {
    const r = rowFor(c.assistant, status, { task, now });
    if (r.row) return { assistant: c.assistant, name: NAME[c.assistant], billing: c.billing, task: r.row.id, title: r.row.task, takeover: r.takeover || null };
    reasons[c.assistant] = r.none;
  }
  return { none: 'nothing to do', reasons };
}

// ---------- the chain: Claude → Grok → Codex (TEAM-03) ----------
// An unfinished task never waits: Claude works it first; at Claude's usage limit the row is paused with
// the reset time and Grok continues on the same branch (only with XAI_API_KEY and a Grok cap above $0);
// when Grok is out (no key, $0 cap, its limit, or 3 failed tries) Codex continues through GitHub on the
// owner's ChatGPT plan; when all three are at their limits the task waits for the first reset, and the
// hourly schedule continues it there. After Claude's reset Claude is first again. Research rows go to
// Grok first. Every assistant continues from the task branch and its progress note, never from scratch.
export const CHAIN = ['claude', 'grok', 'codex'];
export const RESEARCH_CHAIN = ['grok', 'claude', 'codex'];
export const branchFor = id => 'ai/task-' + String(id).toLowerCase();
const NAMES = Object.fromEntries(Object.entries(NAME).map(([k, v]) => [v, k]));

// How an assistant may run now (key or plan, and room under its cap), or why not.
export function access(assistant, keys = [], budget = null) {
  const a = budget?.allowed || {};
  if (budget?.paused?.[assistant]) return { why: 'paused in Admin' };
  if (assistant === 'claude') {
    if (keys.includes('claude_oauth') && (a.claudeSubscription?.ok ?? true)) return { billing: 'subscription' };
    if (keys.includes('anthropic') && a.claudePerUse?.ok) return { billing: 'per-use' };
    return { why: keys.includes('claude_oauth') || keys.includes('anthropic') ? 'its cap' : 'no CLAUDE_CODE_OAUTH_TOKEN' };
  }
  if (assistant === 'grok') {
    if (!keys.includes('xai')) return { why: 'no XAI_API_KEY' };
    return a.grok?.ok ? { billing: 'per-use' } : { why: 'its cap is $0 or used up (Admin → AI team)' };
  }
  if (assistant === 'codex') {
    if (keys.includes('codex_github')) return { billing: 'plan' };
    if (keys.includes('openai') && a.codex?.ok) return { billing: 'per-use' };
    return { why: 'Codex is not connected (CODEX_GITHUB=1) and has no API key with a cap' };
  }
  return { why: 'unknown assistant' };
}
// The time an assistant's usage limit resets (Assistants table, "Reset (UTC)"), when it is still ahead.
export function resetOf(assistant, status, now = Date.now()) {
  const row = (status.assistants || []).find(a => a.name === NAME[assistant]), t = parseUtc(row?.reset);
  return Number.isFinite(t) && t > now ? t : null;
}
// Did this assistant's last hand-off on the task end in failure ("failed after 3 tries"), with no
// later hand-off by anyone that moved the task on?
export function failedOn(assistant, task, status) {
  const h = (status.handoffs || []).filter(x => x.task === task);
  const last = h.find(x => x.assistant === NAME[assistant]);
  return !!last && /failed after/i.test(last.blockers || '') && h.indexOf(last) === 0;
}
// The next task the chain works on: an explicit one, else a paused row, else an active row nobody
// touched for 3 hours, else the first ready row by priority.
export function nextTask(status, { task = null, now = Date.now() } = {}) {
  const q = status.queue;
  if (task) return [...q.active, ...q.paused, ...q.ready].find(r => r.id === task) || null;
  const stale = r => !r.updated || now - parseUtc(r.updated) >= CLAIM_MS;
  return q.paused[0] || q.active.find(stale) || q.ready[0] || null;
}
export function chainPick({ task = null, keys = [], budget = null, status, now = Date.now() }) {
  const row = nextTask(status, { task, now });
  if (!row) return { none: task ? `${task} is not active, paused or ready` : 'nothing to do' };
  if (row.state === 'active' && !task && row.updated && now - parseUtc(row.updated) < CLAIM_MS) return { none: `${row.id} was updated less than 3 hours ago` };
  const order = row.suggested === 'Grok' ? RESEARCH_CHAIN : CHAIN, skipped = [], resets = [];
  for (const a of order) {
    const acc = access(a, keys, budget);
    if (!acc.billing) { skipped.push({ assistant: a, why: acc.why }); continue; }
    const r = resetOf(a, status, now);
    if (r) { skipped.push({ assistant: a, why: `at its usage limit until ${new Date(r).toISOString().slice(0, 16).replace('T', ' ')} UTC` }); resets.push(r); continue; }
    if (failedOn(a, row.id, status)) { skipped.push({ assistant: a, why: 'failed after 3 tries on this task' }); continue; }
    const before = row.claimedBy && row.claimedBy !== NAME[a] ? row.claimedBy : null;
    return { assistant: a, name: NAME[a], billing: acc.billing, task: row.id, title: row.task, branch: branchFor(row.id), takeoverFrom: before, skipped };
  }
  // Everyone usable is at a limit: wait for the first reset (the hourly schedule continues it there).
  if (resets.length) return { wait: new Date(Math.min(...resets)).toISOString(), task: row.id, skipped };
  return { none: 'no assistant can run (keys, plans or caps)', task: row.id, skipped };
}

// Pull requests that wait for the owner-approved label instead of merging themselves: workflows, the
// legal and compliance reviews, anything about secrets, billing going live, or live-money trading.
export const OWNER_PATHS = [/^\.github\/workflows\//, /^LEGAL_REVIEW\.md$/, /^COMPLIANCE_REVIEW\.md$/, /(^|\/)\.env/, /^src\/(keystore|keys-catalog|crypto|secrets?)\.js$/, /^src\/(stripe|stripesetup|billing)\.js$/, /^src\/(brokers|execution|risk)\.js$/, /^src\/alpaca\/(broker|connections|http)\.js$/, /^src\/ext\//];
export const OWNER_WORDS = /\b(live[_ -]?mode|sk_live|STRIPE_LIVE|LIVE_TRADING|liveTrading\s*=\s*true|ALLOW_LIVE)\b/;
export function needsOwner(files = [], patch = '') {
  const paths = files.filter(f => OWNER_PATHS.some(r => r.test(f)));
  const words = OWNER_WORDS.test(String(patch).split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n'));
  return { owner: paths.length > 0 || words, paths, words };
}

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
function writeBoard(md) {
  md = sortQueue(md);
  fs.writeFileSync(path.join(ROOT, 'AI_HANDOFF.md'), md);
  fs.writeFileSync(path.join(ROOT, 'ai/status.json'), render(md));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2], md = fs.readFileSync(path.join(ROOT, 'AI_HANDOFF.md'), 'utf8');
  const who = arg('assistant', 'auto'), id = arg('task'), at = utcNow();
  if (cmd === 'pick') {
    const bfile = arg('budget'); let budget = null;
    try { budget = bfile ? JSON.parse(fs.readFileSync(bfile, 'utf8')) : null; } catch { budget = null; }
    if (budget && !budget.allowed) budget = null;
    console.log(JSON.stringify(pick({ assistant: who, task: id || null, keys: String(arg('keys', '')).split(',').filter(Boolean), budget, status: build(md) })));
  } else if (cmd === 'chain') {
    const bfile = arg('budget'); let budget = null;
    try { budget = bfile ? JSON.parse(fs.readFileSync(bfile, 'utf8')) : null; } catch { budget = null; }
    if (budget && !budget.allowed) budget = null;
    console.log(JSON.stringify(chainPick({ task: id || null, keys: String(arg('keys', '')).split(',').filter(Boolean), budget, status: build(md) })));
  } else if (cmd === 'owner') {
    // Reads a diff on stdin (git diff origin/main...HEAD) and its file list from --files.
    const files = String(arg('files', '')).split(',').filter(Boolean), patch = fs.existsSync(arg('diff', '')) ? fs.readFileSync(arg('diff'), 'utf8') : '';
    console.log(JSON.stringify(needsOwner(files, patch)));
  } else if (cmd === 'addrow') {
    // A real problem from a post-merge review becomes the next task at the top of the queue.
    const st = build(md), nums = Object.values(st.queue).flat().map(r => /^FIX-(\d+)$/.exec(r.id)?.[1]).filter(Boolean).map(Number);
    const fid = `FIX-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0')}`, who = NAME[arg('assistant', 'claude')] || 'Claude';
    const text = String(arg('text', '')).replace(/[|\n]/g, ' ').slice(0, 600);
    if (!text) throw new Error('addrow needs --text');
    const i = md.indexOf('\n## Queue\n'), j = md.indexOf('\n| ', md.indexOf('| --- |', i));
    const line = `\n| ${fid} | ready | 0 | ${who} | — | — | ${text} Done when the fix is merged and the reviewer's finding no longer applies. |`;
    writeBoard(md.slice(0, j) + line + md.slice(j)); console.log(JSON.stringify({ added: fid }));
  } else if (cmd === 'claim') {
    const name = NAME[who]; if (!name || !id) throw new Error('claim needs --assistant and --task');
    let b = setRow(md, 'Queue', id, { state: 'active', claimed_by: name, updated: at });
    b = setRow(b, 'Assistants', name, { task: id, state: 'active', updated: at, last_sha: arg('sha', '—'), next_action: `Working on ${id} in GitHub Actions${arg('run') ? ' (run ' + arg('run') + ')' : ''}.` });
    writeBoard(b); console.log(JSON.stringify({ claimed: id, by: name, at }));
  } else if (cmd === 'release') {
    const name = NAME[who], state = arg('state', 'done'); if (!name || !id) throw new Error('release needs --assistant and --task');
    if (!['done', 'active', 'paused', 'blocked', 'ready', 'later'].includes(state)) throw new Error('state must be done, active, paused, blocked, ready or later');
    const pr = arg('pr'), next = arg('next') || (state === 'done' ? (pr ? `Review PR #${pr} (cross-review), then take the next ready row.` : 'Take the next ready row.') : `Continue ${id}.`);
    let b = setRow(md, 'Queue', id, { state, claimed_by: state === 'ready' ? '—' : name, updated: at });
    b = setRow(b, 'Assistants', name, { task: state === 'done' ? '—' : id, state: state === 'done' ? 'idle' : state, updated: at, last_sha: arg('sha', '—'), next_action: next, reset: arg('reset') || '—' });
    const from = arg('from') && NAME[arg('from')] && NAME[arg('from')] !== name ? ` (taken over from ${NAME[arg('from')]})` : '';
    b = addHandoff(b, { at, assistant: name, task: id, state, lastSha: arg('sha'), changed: (arg('changed') || (pr ? `pull request #${pr}` : 'see the commits')) + from, checks: arg('checks') || 'see the run', blockers: arg('blockers') || 'none', next });
    writeBoard(b); console.log(JSON.stringify({ released: id, state, at }));
  } else { console.error('usage: ai-loop.mjs pick|chain|owner|claim|release ...'); process.exit(2); }
}
