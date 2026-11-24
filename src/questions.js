// Open questions from the website audit (docs/archive/AUDIT.md, LEGAL_REVIEW.md, docs/archive/BUG_REPORT.md), kept in Admin so
// the owner can record each answer and its status. Only the owner's answer text is stored; nothing
// here is shown to visitors.
import { siteGet, siteSet } from './site.js';

export const QUESTIONS = [
  { id: 'regulatory', area: 'Legal', ref: 'L6', question: 'What is the verified regulatory status statement for the footer, and which broker disclosures (Alpaca) must appear?', options: null },
  { id: 'alpaca_referral', area: 'Legal', ref: 'L1', question: 'Is there a referral or compensation arrangement with Alpaca? If yes, it must be disclosed next to the broker recommendation.', options: ['No arrangement', 'Yes, disclosed', 'Yes, not yet disclosed'] },
  { id: 'src_922', area: 'Content', ref: 'L3', question: 'Source for the "922% a year" backtest example, or should it be labelled as a hypothetical example?', options: ['Sourced (add it below)', 'Relabel as hypothetical'] },
  { id: 'src_sp500', area: 'Content', ref: 'L4', question: 'Source for "averaged roughly 10% a year since 1957 with dividends reinvested".', options: ['Sourced (add it below)', 'Remove the figure'] },
  { id: 'bug002', area: 'Bug', ref: 'BUG-002', question: 'Account data kept in the browser for fast start-up. Decision?', options: ['Keep it for this browser session only (done in code)', 'Keep it for 24 hours (accept the risk)', 'Do not keep account data at all'] },
  { id: 'bug003', area: 'Bug', ref: 'BUG-003', question: 'Practice margin race (two orders at once can exceed the margin limit). Fix now?', options: ['Fix now (margin logic)', 'Defer'] },
  { id: 'bug004', area: 'Bug', ref: 'BUG-004', question: 'Early P/L refresh charges credits before the analysis succeeds. Decision?', options: ['Charge only after success', 'Refund on failure', 'Keep as is'] },
  { id: 'bug005', area: 'Bug', ref: 'BUG-005', question: 'Options orders use the browser confirm box instead of the secure confirm. Fix now?', options: ['Use the secure confirm (order entry)', 'Defer'] },
];
const STATUS = ['open', 'answered', 'not_needed'];

export function questionList() {
  const saved = siteGet('openQuestions', {}) || {};
  return QUESTIONS.map(q => ({ ...q, status: STATUS.includes(saved[q.id]?.status) ? saved[q.id].status : 'open', answer: String(saved[q.id]?.answer || '').slice(0, 1000), choice: saved[q.id]?.choice || '', updatedAt: saved[q.id]?.updatedAt || null }));
}

export async function saveQuestion(id, body = {}) {
  const q = QUESTIONS.find(x => x.id === id);
  if (!q) return null;
  const all = { ...(siteGet('openQuestions', {}) || {}) };
  all[id] = {
    status: STATUS.includes(body.status) ? body.status : 'open',
    answer: String(body.answer || '').slice(0, 1000),
    choice: q.options?.includes(body.choice) ? body.choice : '',
    updatedAt: Date.now(),
  };
  await siteSet('openQuestions', all);
  return questionList().find(x => x.id === id);
}
