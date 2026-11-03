// Admin → AI coding agents: tools that help write, test and debug the app's own code.
//   Give Claude Code a task (write a feature, add tests, debug a failed run, review an area): it
//   runs in GitHub Actions on its own branch, runs the tests, and opens a pull request for review.
//   Run the tests or the end-to-end run on demand, see every run's result, read a failed run's
//   log, have the AI explain the failure in plain words, and send it to the agent to fix.
// Needs GITHUB_TOKEN (Admin → Keys: a fine-grained token for this repository with Actions read and
// write, Contents read and Pull requests read) and, for the agent itself, the repository secret
// CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.
import express from 'express';
import { requireUser, requireAdmin, rateLimit } from './auth.js';
import { audit } from './db.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const API = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const repo = () => process.env.GITHUB_REPO || 'aryebleich/Tradingapp';
export const WORKFLOWS = { agent: 'ai-agent.yml', ci: 'web-ci.yml', e2e: 'e2e.yml' };
export const KINDS = { write: 'Write or change a feature', test: 'Add or improve tests', debug: 'Debug a failed run', review: 'Review code (findings only)' };

async function gh(method, p, body, { raw = false } = {}) {
  if (!process.env.GITHUB_TOKEN) throw bad('Add GITHUB_TOKEN in Admin → Keys first', 400);
  const r = await fetch(`${API()}/repos/${repo()}${p}`, {
    method, redirect: 'follow', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Brightfolio', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  if (!r.ok) { const t = await r.text().catch(() => ''); throw bad(`GitHub answered ${r.status}${r.status === 403 || r.status === 404 ? ' (check the token can use Actions and Pull requests on this repository)' : ''}: ${t.slice(0, 160)}`, 502); }
  return raw ? r.text() : r.json();
}
const run = r => ({ id: r.id, name: r.name, title: r.display_title, status: r.status, conclusion: r.conclusion, event: r.event, branch: r.head_branch, sha: (r.head_sha || '').slice(0, 7), url: r.html_url, at: r.created_at, updated: r.updated_at });

export async function overview() {
  if (!process.env.GITHUB_TOKEN) return { configured: false, repo: repo() };
  const [agent, ci, e2e, prs] = await Promise.all([
    gh('GET', `/actions/workflows/${WORKFLOWS.agent}/runs?per_page=10`).catch(e => ({ error: e.message })),
    gh('GET', `/actions/workflows/${WORKFLOWS.ci}/runs?per_page=5&branch=main`).catch(() => ({ workflow_runs: [] })),
    gh('GET', `/actions/workflows/${WORKFLOWS.e2e}/runs?per_page=5&branch=main`).catch(() => ({ workflow_runs: [] })),
    gh('GET', '/pulls?state=open&per_page=30').catch(() => []),
  ]);
  return {
    configured: true, repo: repo(), agentError: agent.error || null,
    agentRuns: (agent.workflow_runs || []).map(run), ci: (ci.workflow_runs || []).map(run), e2e: (e2e.workflow_runs || []).map(run),
    pulls: (Array.isArray(prs) ? prs : []).filter(p => /^ai-agent\//.test(p.head?.ref || '')).map(p => ({ number: p.number, title: p.title, url: p.html_url, at: p.created_at, branch: p.head.ref, draft: p.draft })),
  };
}

// The end of a failed run's log (the failed jobs only), for reading and for the AI to explain.
export async function failedLog(runId, lines = 200) {
  if (!/^\d+$/.test(String(runId))) throw bad('Unknown run');
  const jobs = (await gh('GET', `/actions/runs/${runId}/jobs?per_page=50`)).jobs || [];
  const failed = jobs.filter(j => j.conclusion === 'failure');
  const out = [];
  for (const j of (failed.length ? failed : jobs).slice(0, 3)) {
    const text = await gh('GET', `/actions/jobs/${j.id}/logs`, null, { raw: true }).catch(e => `(log not available: ${e.message})`);
    const tail = String(text).split('\n').map(l => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, '')).filter(l => !/^##\[(group|endgroup)\]/.test(l)).slice(-lines).join('\n');
    out.push({ job: j.name, conclusion: j.conclusion, steps: (j.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name), log: tail });
  }
  return out;
}

// Plain-words explanation of a failure: what broke, the likely cause, where to look, how to fix it.
export async function explain(runId) {
  const { llmEnabled, jsonCall } = await import('./llm.js');
  if (!llmEnabled()) throw bad('Set up an AI provider in Admin → AI & privacy to get explanations', 503);
  const logs = await failedLog(runId, 160);
  const text = logs.map(l => `## ${l.job} (failed steps: ${l.steps.join(', ') || '-'})\n${l.log}`).join('\n\n').slice(-14000);
  return jsonCall({
    system: 'You are a senior engineer reading a failed CI log for a Node.js (Express) web app with Playwright end-to-end tests. Explain plainly and precisely. Do not guess beyond the log; say when the log is not enough.',
    user: `Explain this failure.\n\n${text}`,
    schema: { type: 'object', additionalProperties: false, required: ['summary', 'cause', 'where', 'fix', 'flaky'], properties: {
      summary: { type: 'string', description: 'One sentence: what failed' }, cause: { type: 'string', description: 'The most likely root cause' },
      where: { type: 'string', description: 'Files, tests or steps to look at' }, fix: { type: 'string', description: 'How to fix it, concretely' },
      flaky: { type: 'boolean', description: 'true only if the log shows a network or runner problem rather than a code problem' } } },
    maxTokens: 900,
  });
}

export function agentsRouter() {
  const r = express.Router();
  r.use(requireUser, requireAdmin);
  r.get('/', async (req, res) => res.json({ ...(await overview()), kinds: KINDS }));
  r.post('/task', async (req, res) => {
    const task = String(req.body?.task || '').trim(), kind = String(req.body?.kind || 'write'), runId = String(req.body?.runId || '');
    if (task.length < 10) throw bad('Describe the task in a sentence or two (at least 10 characters)');
    if (task.length > 4000) throw bad('Keep the task under 4,000 characters');
    if (!KINDS[kind]) throw bad('Pick write, test, debug or review');
    if (kind === 'debug' && !/^\d+$/.test(runId)) throw bad('Pick the failed run to debug');
    if (!rateLimit('agent:' + req.user.id, 20, 86400e3)) throw bad('Up to 20 agent tasks a day', 429);
    await gh('POST', `/actions/workflows/${WORKFLOWS.agent}/dispatches`, { ref: 'main', inputs: { task, kind, ...(runId ? { run_id: runId } : {}) } });
    await audit(req.user.id, 'ai_agent_task', { kind, chars: task.length, runId: runId || null }, req.ip);
    res.json({ ok: true });
  });
  r.post('/tests', async (req, res) => {
    const which = req.body?.which === 'e2e' ? 'e2e' : 'ci';
    await gh('POST', `/actions/workflows/${WORKFLOWS[which]}/dispatches`, { ref: 'main' });
    await audit(req.user.id, 'ai_agent_tests', { which }, req.ip);
    res.json({ ok: true });
  });
  r.get('/runs/:id/log', async (req, res) => res.json(await failedLog(req.params.id)));
  r.post('/runs/:id/explain', async (req, res) => res.json(await explain(req.params.id)));
  r.post('/runs/:id/rerun', async (req, res) => { if (!/^\d+$/.test(req.params.id)) throw bad('Unknown run'); await gh('POST', `/actions/runs/${req.params.id}/rerun-failed-jobs`); res.json({ ok: true }); });
  return r;
}
