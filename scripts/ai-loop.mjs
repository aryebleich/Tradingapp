// The automatic side of the three-assistant loop (.github/workflows/ai-loop.yml, AGENTS.md):
//   pick     which assistant takes which row now (keys present, budget allowed, the queue, the 3-hour claims)
//   claim    marks the row active on the board (AI_HANDOFF.md) and regenerates ai/status.json
//   release  writes the hand-off and the row's new state (done, paused at a usage limit, blocked)
// The board edits are plain text edits of AI_HANDOFF.md (scripts/ai-status.mjs), so a human and the
// workflow keep the same file. Output is JSON on stdout (for the workflow's next steps).
//   node scripts/ai-loop.mjs pick --assistant auto|claude|codex|grok [--task REV-01] --keys claude_oauth,anthropic,openai,xai [--budget budget.json]
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
// budget answer (the site unreachable), only Claude through the owner's subscription may run.
export function eligible(keys = [], budget = null) {
  const a = budget?.allowed || {}, out = [];
  if (keys.includes('claude_oauth') && (a.claudeSubscription?.ok ?? true)) out.push({ assistant: 'claude', billing: 'subscription' });
  else if (keys.includes('anthropic') && a.claudePerUse?.ok) out.push({ assistant: 'claude', billing: 'per-use' });
  if (keys.includes('openai') && a.codex?.ok) out.push({ assistant: 'codex', billing: 'per-use' });
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
  } else if (cmd === 'claim') {
    const name = NAME[who]; if (!name || !id) throw new Error('claim needs --assistant and --task');
    let b = setRow(md, 'Queue', id, { state: 'active', claimed_by: name, updated: at });
    b = setRow(b, 'Assistants', name, { task: id, state: 'active', updated: at, last_sha: arg('sha', '—'), next_action: `Working on ${id} in GitHub Actions${arg('run') ? ' (run ' + arg('run') + ')' : ''}.` });
    writeBoard(b); console.log(JSON.stringify({ claimed: id, by: name, at }));
  } else if (cmd === 'release') {
    const name = NAME[who], state = arg('state', 'done'); if (!name || !id) throw new Error('release needs --assistant and --task');
    if (!['done', 'paused', 'blocked', 'ready'].includes(state)) throw new Error('state must be done, paused, blocked or ready');
    const pr = arg('pr'), next = arg('next') || (state === 'done' ? (pr ? `Review PR #${pr} (cross-review), then take the next ready row.` : 'Take the next ready row.') : `Continue ${id}.`);
    let b = setRow(md, 'Queue', id, { state, claimed_by: state === 'ready' ? '—' : name, updated: at });
    b = setRow(b, 'Assistants', name, { task: state === 'done' ? '—' : id, state: state === 'done' ? 'idle' : state, updated: at, last_sha: arg('sha', '—'), next_action: next });
    b = addHandoff(b, { at, assistant: name, task: id, state, lastSha: arg('sha'), changed: arg('changed') || (pr ? `pull request #${pr}` : 'see the commits'), checks: arg('checks') || 'see the run', blockers: arg('blockers') || 'none', next });
    writeBoard(b); console.log(JSON.stringify({ released: id, state, at }));
  } else { console.error('usage: ai-loop.mjs pick|claim|release ...'); process.exit(2); }
}
