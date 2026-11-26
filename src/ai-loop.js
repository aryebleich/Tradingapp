// The three assistants' loop (AGENTS.md, AI_HANDOFF.md, .github/workflows/ai-loop.yml): spending caps
// per assistant, the record of automatic runs, and the Work status in Admin → AI team.
// Anything billed per use starts with a $0 cap, so nothing costs money until the owner raises it:
//   claude  per use only with ANTHROPIC_API_KEY; with CLAUDE_CODE_OAUTH_TOKEN it uses the owner's
//           Claude subscription (not billed per use), so it may run while its cap is $0
//   codex   through its GitHub integration (@codex, the owner's ChatGPT plan; the variable CODEX_GITHUB=1):
//           not billed per use, so no cap; or OPENAI_API_KEY, billed per use
//   grok    XAI_API_KEY, billed per use (also the admin chat and router: off until its cap is raised)
// A run is counted at its "per run" ceiling (perRunUsd), the most one run may cost (the workflow
// limits turns and tokens to stay inside it), so the month's total never exceeds the cap.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteGet, siteSet } from './site.js';

export const ASSISTANTS = ['claude', 'codex', 'grok'];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CAPS = { claude: { monthlyUsd: 0, perRunUsd: 2 }, codex: { monthlyUsd: 0, perRunUsd: 1 }, grok: { monthlyUsd: 0, perRunUsd: 0.25 } };
const money = (v, max = 10000) => Math.max(0, Math.min(max, Math.round((+v || 0) * 100) / 100));
const month = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
const usd = v => '$' + money(v).toFixed(2);

export function loopSettings() {
  const s = siteGet('aiLoop', null) || {};
  const caps = Object.fromEntries(ASSISTANTS.map(a => [a, { ...DEFAULT_CAPS[a], ...(s.caps?.[a] || {}) }]));
  return { caps, paused: { ...(s.paused || {}) }, runs: Array.isArray(s.runs) ? s.runs : [] };
}
async function save(s) { await siteSet('aiLoop', { caps: s.caps, paused: s.paused, runs: s.runs.slice(-200) }); }

export async function setCaps(body = {}) {
  const s = loopSettings();
  for (const a of ASSISTANTS) {
    const c = body[a]; if (!c) continue;
    if (c.monthlyUsd != null) s.caps[a].monthlyUsd = money(c.monthlyUsd);
    if (c.perRunUsd != null) s.caps[a].perRunUsd = Math.max(0.01, money(c.perRunUsd, 100));
  }
  await save(s); return s.caps;
}
export async function setPaused(assistant, on, until = null) {
  if (!ASSISTANTS.includes(assistant)) throw Object.assign(new Error('Unknown assistant'), { status: 400 });
  const s = loopSettings();
  if (on) s.paused[assistant] = { at: Date.now(), until: until ? String(until).slice(0, 40) : null }; else delete s.paused[assistant];
  await save(s); return s.paused;
}

// This month's per-use spend of one assistant (runs counted at their ceiling).
export const spent = (assistant, s = loopSettings(), m = month()) => money(s.runs.filter(r => r.assistant === assistant && r.month === m && r.billed).reduce((a, r) => a + (+r.usd || 0), 0));

// May this assistant start one automatic run now? billing: 'subscription' (Claude through the owner's
// plan) or 'per-use' (an API key). Pure given its inputs, so the tests can check every rule.
export function allowed(assistant, billing = 'per-use', s = loopSettings(), m = month()) {
  if (!ASSISTANTS.includes(assistant)) return { ok: false, reason: 'unknown assistant' };
  if (s.paused[assistant]) return { ok: false, reason: `paused in Admin${s.paused[assistant].until ? ' until ' + s.paused[assistant].until : ''}` };
  if (assistant === 'claude' && billing === 'subscription') return { ok: true, reason: 'Claude subscription (not billed per use)', billed: false };
  const c = s.caps[assistant], used = spent(assistant, s, m);
  if (!(c.monthlyUsd > 0)) return { ok: false, reason: 'the monthly cap is $0 (raise it in Admin → AI team → Work status)' };
  if (used + c.perRunUsd > c.monthlyUsd) return { ok: false, reason: `this month's cap is reached (${usd(used)} of ${usd(c.monthlyUsd)})` };
  return { ok: true, reason: `${usd(used)} of ${usd(c.monthlyUsd)} used this month`, billed: true, perRunUsd: c.perRunUsd };
}
export function budget(s = loopSettings()) {
  const m = month();
  return {
    month: m, caps: s.caps, spent: Object.fromEntries(ASSISTANTS.map(a => [a, spent(a, s, m)])), paused: s.paused,
    allowed: {
      claudeSubscription: allowed('claude', 'subscription', s, m), claudePerUse: allowed('claude', 'per-use', s, m),
      codexPlan: s.paused.codex ? { ok: false, reason: 'paused in Admin' } : { ok: true, reason: 'Codex through GitHub (@codex) on the ChatGPT plan, not billed per use', billed: false },
      codex: allowed('codex', 'per-use', s, m), grok: allowed('grok', 'per-use', s, m),
    },
  };
}
// One automatic run, recorded by the workflow (at its ceiling when billed per use).
export async function recordRun({ assistant, billing = 'per-use', task = '', outcome = '', run = '' } = {}) {
  if (!ASSISTANTS.includes(assistant)) throw Object.assign(new Error('Unknown assistant'), { status: 400 });
  const s = loopSettings(), billed = !((assistant === 'claude' && billing === 'subscription') || (assistant === 'codex' && billing === 'plan'));
  s.runs.push({
    assistant, billed, usd: billed ? s.caps[assistant].perRunUsd : 0, month: month(), at: Date.now(),
    task: String(task).replace(/[^A-Z0-9-]/gi, '').slice(0, 20), outcome: String(outcome).replace(/[^a-z_-]/gi, '').slice(0, 20), run: String(run).replace(/\D/g, '').slice(0, 20),
  });
  await save(s); return { spent: spent(assistant, s) };
}
// Grok in the admin chat and the router follows the same cap: off until the owner raises it.
export const grokAllowed = () => loopSettings().caps.grok.monthlyUsd > 0;

// The board as deployed with this version (ai/status.json, generated from AI_HANDOFF.md).
export function workStatus() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'ai/status.json'), 'utf8')); } catch { return null; }
}
