// The AI router (Part 2): picks the best model that has a key for each request, by the kind of need
// (quick answer, deep reasoning, coding, a long document, a finance calculation, a summary, a
// translation, structured data, an image). Cheap rules decide the need; every model is scored on fit,
// cost, health and the privacy rule; expensive models are kept for hard tasks; and every decision is
// recorded with its reason. The static facts are in ./catalog.json; the health comes from the last
// real calls (src/llm.js lastErrors). Pure functions first, so they can be tested without a database.
import fs from 'node:fs';
const catalogFile = JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
import { providers, lastErrors, activeId } from '../llm.js';
import { siteGet, siteSet } from '../site.js';

export const NEEDS = ['quick', 'reasoning', 'coding', 'long', 'finance', 'summary', 'translation', 'extraction', 'image', 'general'];
export const NEED_LABEL = {
  quick: 'quick answer', reasoning: 'deep reasoning', coding: 'coding', long: 'long document', finance: 'finance and maths',
  summary: 'summary', translation: 'translation', extraction: 'structured data', image: 'image', general: 'general question',
};
// Needs that are worth a strong (expensive) model.
const HARD = new Set(['reasoning', 'coding', 'long', 'finance']);

// Which need a message is about. Rules first, in this order; the first match wins.
export function classify({ text = '', hasImage = false, feature = '' } = {}) {
  const t = String(text);
  if (hasImage || feature === 'image') return { need: 'image', why: 'an image is attached' };
  if (/```|\bfunction\s*\(|\bstack trace\b|\bbug\b|\btypeerror\b|\bsyntax\b|javascript|typescript|python|\bsql\b|\bregex\b/i.test(t)) return { need: 'coding', why: 'code or an error is in the message' };
  if (/translat|yiddish|ייִדיש|תרגם/i.test(t)) return { need: 'translation', why: 'asks for a translation' };
  if (/\bsummar|tl;?dr|key points/i.test(t) || feature === 'summary') return { need: 'summary', why: 'asks for a summary' };
  if (/\bjson\b|extract|schema|fields? from/i.test(t) || feature === 'extraction') return { need: 'extraction', why: 'asks for structured data' };
  if (/calculat|compute|\bnpv\b|\birr\b|\byield\b|interest rate|compound|amortiz|return on|\d+(\.\d+)?\s*%|\$\s?\d/i.test(t)) return { need: 'finance', why: 'a number or finance calculation' };
  if (t.length > 6000) return { need: 'long', why: 'a long text' };
  if (/\bwhy\b|prove|step by step|analy[sz]e|compare|trade-?off|reason|plan\b/i.test(t)) return { need: 'reasoning', why: 'asks for reasoning' };
  if (t.length < 200) return { need: 'quick', why: 'a short question' };
  return { need: 'general', why: 'a general question' };
}

// The catalog entry for a live provider + model id (unknown models get the provider's first entry).
export function catalogFor(provider, modelId, catalog = catalogFile) {
  const p = catalog.providers?.[provider];
  if (!p) return { strengths: ['general'], tier: 'medium', memberData: false, tierFree: false, price: null };
  const m = p.models.find(x => x.id === modelId) || p.models[0];
  const free = m.inputPerM === 0 && m.outputPerM === 0;
  return { ...m, memberData: !!p.memberData, free, tierFree: p.tier === 'free', price: m.inputPerM == null ? null : { inputPerM: m.inputPerM, outputPerM: m.outputPerM } };
}

// Scores one candidate for a need. Higher is better; null means it is not allowed (privacy or health).
export function score(candidate, need, { member = false, health = {}, preferred = null } = {}) {
  const c = candidate, h = health[c.provider];
  if (member && !c.memberData) return { score: null, blocked: 'privacy: this provider may not receive member data' };
  if (h && h.open) return { score: null, blocked: `${h.reason}` };
  let s = c.strengths.includes(need) ? 10 : need === 'general' ? 6 : 2;
  if (HARD.has(need)) s += c.tier === 'strong' ? 6 : c.tier === 'medium' ? 3 : 0;
  else s += c.tier === 'strong' ? 0 : 3; // quick, summary and similar: a smaller model is enough
  if (!HARD.has(need) && c.tier === 'strong') s -= 3; // keep the expensive model for hard tasks
  if (c.free || c.tierFree) s += HARD.has(need) ? 1 : 3; // free within its limits; a small bonus only, so a hard task keeps the strong model
  else if (c.price) s -= Math.min(4, c.price.inputPerM / 2 + c.price.outputPerM / 8); // a cost penalty, capped
  else s -= 1; // price not verified: a little caution
  if (h && h.slow) s -= 2;
  // The provider the owner made active is preferred where it fits the need (not where it is weak).
  if (preferred && c.provider === preferred && c.strengths.includes(need)) s += 4;
  return { score: Math.round(s * 10) / 10, blocked: null };
}

// The best model for a message, and the reasons. candidates: [{ provider, id, name, ...catalog facts }]
export function rank(candidates, need, opts = {}) {
  const scored = [], blocked = [];
  for (const c of candidates) {
    const r = score(c, need, opts);
    if (r.score == null) blocked.push({ provider: c.provider, model: c.id, reason: r.blocked });
    else scored.push({ provider: c.provider, model: c.id, name: c.name, score: r.score, free: !!(c.free || c.tierFree) });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { ranked: scored, blocked };
}

// The reason sentence shown under an answer, e.g. "Claude: deep reasoning" or "Groq: quick answer, free".
export function reasonText(pick, need) {
  return `${pick.name}: ${NEED_LABEL[need]}${pick.free ? ', free' : ''}`;
}

// Health from the last real calls: a provider that refused the key, ran out of quota or answered 5xx
// is skipped for a few minutes; one that was rate-limited is only ranked lower.
export function healthOf(lastErr = lastErrors, now = Date.now()) {
  const out = {};
  for (const [id, e] of Object.entries(lastErr || {})) {
    const age = now - (e.at || 0);
    if (age > 15 * 60e3) continue;
    if (e.status === 429 && age < 5 * 60e3) out[id] = { slow: true };
    if ([401, 402, 403].includes(e.status) && age < 15 * 60e3) out[id] = { open: true, reason: `${id} refused the last request (${e.status})` };
    if (e.status >= 500 && age < 5 * 60e3) out[id] = { open: true, reason: `${id} was failing (${e.status})` };
  }
  return out;
}

// Candidates from the providers that have a key right now.
export function candidatesFromKeys(list = providers(), catalog = catalogFile) {
  const out = [];
  for (const p of list) {
    const model = p.model || null;
    const c = catalogFor(p.id, model || undefined, catalog);
    out.push({ ...c, provider: p.id, id: model || c.id, name: model ? `${p.name} · ${model}` : p.name });
  }
  return out;
}

// The whole decision for a message: need, model, reason and the runners-up. Pure given its inputs.
export function decide({ text = '', hasImage = false, feature = '', member = false }, { candidates, health = {}, preferred = null } = {}) {
  const { need, why } = classify({ text, hasImage, feature });
  const { ranked, blocked } = rank(candidates || [], need, { member, health, preferred });
  const pick = ranked[0] || null;
  return {
    need, needWhy: why,
    model: pick ? { provider: pick.provider, id: pick.model, name: pick.name } : null,
    reason: pick ? reasonText(pick, need) : 'no model is available for this message',
    alternatives: ranked.slice(1, 4).map(r => ({ provider: r.provider, id: r.model, name: r.name })),
    blocked: blocked.slice(0, 6),
    member: !!member,
  };
}

// Routes a message with the live keys and health, and records the decision (the last 200 are kept
// for Admin → AI → Routing).
export async function route(input) {
  const d = decide(input, { candidates: candidatesFromKeys(), health: healthOf(), preferred: activeId() });
  await recordDecision({ at: Date.now(), need: d.need, model: d.model?.name || null, provider: d.model?.provider || null, reason: d.reason, member: d.member, blocked: d.blocked.length });
  return d;
}
export async function recordDecision(entry) {
  const list = (await siteGet('aiRoutes', [])) || [];
  list.push(entry);
  await siteSet('aiRoutes', list.slice(-200));
  return entry;
}
// The catalog for Admin → Routing: names, tiers, strengths and the privacy rule. No keys are in it.
export function catalogSummary(catalog = catalogFile) {
  return Object.entries(catalog.providers || {}).map(([id, p]) => ({ id, name: p.name, tier: p.tier, memberData: !!p.memberData, key: p.key, models: (p.models || []).map(m => ({ id: m.id, name: m.name, tier: m.tier, strengths: m.strengths || [], free: m.inputPerM === 0 && m.outputPerM === 0 })) }));
}
export async function recentDecisions(limit = 50) {
  return ((await siteGet('aiRoutes', [])) || []).slice(-limit).reverse();
}
