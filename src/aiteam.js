// Admin → AI team: nine AI agents that work on the owner's jobs together.
//   Manager                  reads the job, splits it into steps, gives each step to an agent,
//                            and writes the final answer
//   Understands code         explains how the existing code works and where a change belongs
//   Writes code              writes the change (code, tests)
//   Reviews code             checks the written code for bugs, security and style, and grades it
//   Suggests ideas           product and feature ideas
//   Prompt engineering       writes and improves prompts for the app's own AI features
//   Finance & stocks         markets, investing, accounting and the rules around them
//   Alpaca & brokerages      the Alpaca APIs (trading, broker, market data) and other brokerages
//   Yiddish                  Yiddish text and translations (Hasidic spelling, natural phrasing)
// Agents talk to each other: every step sees the job, the plan and what the earlier agents wrote,
// and can ask the next one a question. The Reviewer grades the result.
//
// Choosing the model for each agent: every AI service with a key in Admin → Keys is a candidate.
// The Manager starts from a prior (what each model is known to be good at) and learns from results:
// each grade from the Reviewer and each thumbs up or down from the owner moves that model's score
// for that role. The best-scoring model with a key gets the role; the owner can pin one instead.
import express from 'express';
import { one, all, run, now, audit } from './db.js';
import { requireUser, requireAdmin } from './auth.js';
import { siteGet, siteSet } from './site.js';
import { providers, textWith } from './llm.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

export const ROLES = {
  manager: { name: 'Manager', system: 'You are the manager of a team of AI agents working on a trading and investing web app (Node.js, Express, libSQL, vanilla JavaScript; Alpaca brokerage; English and Yiddish). You plan the work, give each step to the right agent, and combine their results into one clear answer for the owner.' },
  code: { name: 'Understands code', system: 'You understand software deeply. Explain how the relevant code works, where a change belongs, and what could break. Be specific: name files, functions and data.' },
  write: { name: 'Writes code', system: 'You are a senior engineer. Write the change as complete code (unified diff or whole functions), with tests. Keep it minimal, safe and consistent with the code base.' },
  review: { name: 'Reviews code', system: 'You review code changes. List real bugs, security problems and missing tests first, then smaller points. End with a line "GRADE: n" where n is 1 (unusable) to 5 (ready to ship) for the work you reviewed.' },
  ideas: { name: 'Suggests ideas', system: 'You suggest practical product ideas for a retail trading and investing app: who it helps, why, and the simplest first version.' },
  prompts: { name: 'Prompt engineering', system: 'You write and improve prompts for language models: clear role, the facts needed, the output format, and what to avoid. Show the improved prompt in full.' },
  finance: { name: 'Finance & stocks', system: 'You are an expert in markets, investing, trading, accounting and US securities rules (SEC, FINRA, Reg T). Be accurate, say what is uncertain, and never give personal investment advice.' },
  alpaca: { name: 'Alpaca & brokerages', system: 'You know the Alpaca APIs in detail (Trading API, Broker API, Market Data API, OAuth, paper and live) and how other brokerages\' APIs work. Name the exact endpoints and fields.' },
  yiddish: { name: 'Yiddish', system: 'You write natural Yiddish in Hebrew letters as used by Hasidic communities today (common spelling, everyday words, loanwords as people say them). Translate meaning, not word by word; keep product names and numbers.' },
};
export const ROLE_IDS = Object.keys(ROLES);

// What each model is known to be good at (0-1). The Manager starts here and learns from results.
export const PRIOR = {
  anthropic: { manager: 0.95, code: 0.95, write: 0.95, review: 0.95, ideas: 0.85, prompts: 0.95, finance: 0.85, alpaca: 0.8, yiddish: 0.8 },
  gemini: { manager: 0.8, code: 0.8, write: 0.8, review: 0.75, ideas: 0.85, prompts: 0.75, finance: 0.85, alpaca: 0.75, yiddish: 0.75 },
  groq: { manager: 0.7, code: 0.75, write: 0.75, review: 0.7, ideas: 0.75, prompts: 0.7, finance: 0.7, alpaca: 0.6, yiddish: 0.45 },
  openrouter: { manager: 0.65, code: 0.65, write: 0.65, review: 0.6, ideas: 0.75, prompts: 0.65, finance: 0.65, alpaca: 0.55, yiddish: 0.45 },
  custom: { manager: 0.5, code: 0.5, write: 0.5, review: 0.5, ideas: 0.5, prompts: 0.5, finance: 0.5, alpaca: 0.5, yiddish: 0.4 },
};
const PRIOR_WEIGHT = 4; // the prior counts like four graded answers

// Learned results: { provider: { role: { n, sum } } } with each result scored 0-1.
const stats = () => siteGet('aiTeamStats', {}) || {};
const pins = () => siteGet('aiTeamPins', {}) || {};
export function score(provider, role, st = stats()) {
  const s = st[provider]?.[role] || { n: 0, sum: 0 }, p = PRIOR[provider]?.[role] ?? 0.5;
  return (p * PRIOR_WEIGHT + s.sum) / (PRIOR_WEIGHT + s.n);
}
// The model for each role: the pinned one if it has a key, otherwise the best score among those with keys.
export function assign(active = providers().map(p => p.id), st = stats(), pinned = pins()) {
  const out = {};
  for (const r of ROLE_IDS) {
    if (pinned[r] && active.includes(pinned[r])) { out[r] = { provider: pinned[r], score: +score(pinned[r], r, st).toFixed(3), pinned: true }; continue; }
    const best = active.map(p => [p, score(p, r, st)]).sort((a, b) => b[1] - a[1])[0];
    out[r] = best ? { provider: best[0], score: +best[1].toFixed(3), pinned: false } : null;
  }
  return out;
}
export async function learn(provider, role, value) {
  const st = stats(); st[provider] ||= {}; const s = st[provider][role] ||= { n: 0, sum: 0 };
  s.n++; s.sum += Math.max(0, Math.min(1, value));
  await siteSet('aiTeamStats', st);
}
export const gradeOf = text => { const m = /GRADE:\s*([1-5])/i.exec(text || ''); return m ? +m[1] : null; };

// The Manager's plan: up to 6 steps, each for one agent.
export function parsePlan(text) {
  const m = /\[[\s\S]*\]/.exec(text || '');
  let steps = []; try { steps = JSON.parse(m ? m[0] : '[]'); } catch { steps = []; }
  steps = (Array.isArray(steps) ? steps : []).filter(s => ROLE_IDS.includes(s?.role) && s.role !== 'manager' && s.task).slice(0, 6).map(s => ({ role: s.role, task: String(s.task).slice(0, 1500) }));
  return steps.length ? steps : [{ role: 'code', task: 'Work out what the job needs and how to do it.' }];
}

// Runs a job: plan, each agent in turn (seeing the earlier messages), review, final answer.
export async function runJob(id, ai = textWith) {
  const job = await one('SELECT * FROM ai_team_jobs WHERE id = ?', id); if (!job) return;
  const team = assign(), msgs = [];
  const save = async (status, extra = {}) => run('UPDATE ai_team_jobs SET status = ?, messages = ?, plan = ?, result = ?, updated_at = ? WHERE id = ?', status, JSON.stringify(msgs), JSON.stringify(extra.plan ?? JSON.parse(job.plan || '[]')), extra.result ?? null, now(), id);
  const say = async (role, task, prompt) => {
    const who = team[role]; if (!who) throw bad(`No AI service with a key for the ${ROLES[role].name} agent; add one in Admin → Keys`, 503);
    const t0 = Date.now(), text = await ai(who.provider, { system: ROLES[role].system, user: prompt, maxTokens: role === 'write' ? 6000 : 2500 });
    msgs.push({ role, name: ROLES[role].name, provider: who.provider, task, text, ms: Date.now() - t0 });
    return text;
  };
  const transcript = () => msgs.map(m => `--- ${m.name} (${m.task}) ---\n${m.text}`).join('\n\n');
  try {
    const planText = await say('manager', 'Plan', `Job from the owner:\n${job.job}\n\nAgents you can use: ${ROLE_IDS.filter(r => r !== 'manager').map(r => `${r} (${ROLES[r].name})`).join(', ')}.\nReply with a JSON array of up to 6 steps in order, each {"role": "...", "task": "..."}. Put "review" after any "write" step. Only the steps the job needs.`);
    const plan = parsePlan(planText);
    await save('working', { plan });
    for (const [i, s] of plan.entries()) {
      const out = await say(s.role, s.task, `Job from the owner:\n${job.job}\n\nYour step (${i + 1} of ${plan.length}): ${s.task}\n\nWhat the team has written so far:\n${transcript() || '(nothing yet)'}\n\nIf you need something from the next agent, end with a line "QUESTION FOR <agent>: ...".`);
      if (s.role === 'review') { const g = gradeOf(out), w = [...msgs].reverse().find(m => m.role === 'write'); if (g && w) await learn(w.provider, 'write', (g - 1) / 4); }
      await save('working', { plan });
    }
    const result = await say('manager', 'Final answer', `Job from the owner:\n${job.job}\n\nThe team's work:\n${transcript()}\n\nWrite the final answer for the owner: what was done, the result (code, text or decision) in full where it matters, open questions, and the next step.`);
    await save('done', { plan, result });
  } catch (e) {
    msgs.push({ role: 'manager', name: 'Manager', provider: null, task: 'Stopped', text: e.message });
    await save('failed', { result: e.message });
  }
}

export const aiTeamRouter = (() => {
  const r = express.Router();
  r.use(requireUser, requireAdmin);
  const act = () => providers().map(p => ({ id: p.id, name: p.name, model: p.model }));
  r.get('/', async (req, res) => {
    const st = stats(), active = act();
    res.json({ roles: Object.fromEntries(ROLE_IDS.map(k => [k, ROLES[k].name])), providers: active, team: assign(active.map(p => p.id), st), pins: pins(),
      scores: Object.fromEntries(Object.keys(PRIOR).map(p => [p, Object.fromEntries(ROLE_IDS.map(r => [r, { score: +score(p, r, st).toFixed(3), results: st[p]?.[r]?.n || 0 }]))])),
      jobs: (await all('SELECT id, job, status, created_at, updated_at FROM ai_team_jobs ORDER BY id DESC LIMIT 30')) });
  });
  r.get('/jobs/:id', async (req, res) => { const j = await one('SELECT * FROM ai_team_jobs WHERE id = ?', +req.params.id); if (!j) throw bad('Not found', 404); res.json({ ...j, plan: JSON.parse(j.plan || '[]'), messages: JSON.parse(j.messages || '[]') }); });
  r.post('/jobs', async (req, res) => {
    const job = String(req.body?.job || '').trim().slice(0, 8000);
    if (job.length < 10) throw bad('Describe the job');
    if (!providers().length) throw bad('Add at least one AI key in Admin → Keys (Claude, Gemini, Groq or OpenRouter)', 503);
    const id = Number((await run("INSERT INTO ai_team_jobs (job, status, plan, messages, created_by, created_at, updated_at) VALUES (?, 'working', '[]', '[]', ?, ?, ?)", job, req.user.id, now(), now())).lastInsertRowid);
    await audit(req.user.id, 'ai_team_job', { id }, req.ip);
    runJob(id).catch(e => console.warn('ai team', id, e.message));
    res.json({ id });
  });
  // The owner rates one agent's message: it trains the Manager's choice for that role.
  r.post('/jobs/:id/rate', async (req, res) => {
    const j = await one('SELECT messages FROM ai_team_jobs WHERE id = ?', +req.params.id); if (!j) throw bad('Not found', 404);
    const m = JSON.parse(j.messages || '[]')[+req.body?.index]; if (!m?.provider) throw bad('Nothing to rate');
    await learn(m.provider, m.role, req.body?.good ? 1 : 0);
    res.json({ ok: true, team: assign() });
  });
  r.put('/pins', async (req, res) => {
    const b = req.body || {}, p = {};
    for (const k of ROLE_IDS) if (b[k] && PRIOR[b[k]]) p[k] = b[k];
    await siteSet('aiTeamPins', p); res.json({ pins: p, team: assign() });
  });
  return r;
})();
