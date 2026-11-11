// What each plan unlocks in the AI parts of the Intelligence section (agents and API, AI bots, AI signals, market
// intelligence, the chart co-pilot). One table, read by the server for every check and shown to
// users on each page and on Plans & billing, so the limits are the same everywhere.
import { isPaid } from './fees.js';
import { one, run } from './db.js';
import { nyTime } from './time.js';

export const AI_PLAN = {
  free: {
    label: 'Starter',
    // Agents and API: every account can connect an AI agent; real-money orders need Pro.
    agentTokens: 1, agentLive: 'off', extendedHours: false, apiPerMin: 60,
    // AI bots: one bot at a time, checked once a day, on practice money.
    bots: 1, botEveryMin: 1440, botsLive: false, nlBuilds: 3, marketplaceCopy: false, backtestYears: 5,
    // AI signals: today's top 3, no automatic orders, no custom engines.
    signals: 3, signalAuto: 'off', customSignals: false,
    // Market intelligence: end-of-day options flow, no earnings summaries.
    optionsFlow: 'eod', earningsSummaries: 0, darkPool: true, whales: 3,
    // Chart co-pilot questions a day.
    copilot: 5,
  },
  pro: {
    label: 'Pro',
    agentTokens: 3, agentLive: 'approve', extendedHours: false, apiPerMin: 120,
    bots: 10, botEveryMin: 15, botsLive: true, nlBuilds: 30, marketplaceCopy: true, backtestYears: 15,
    signals: 25, signalAuto: 'paper', customSignals: false,
    optionsFlow: 'delayed', earningsSummaries: 5, darkPool: true, whales: 10,
    copilot: 50,
  },
  elite: {
    label: 'Elite',
    agentTokens: 10, agentLive: 'auto', extendedHours: true, apiPerMin: 300,
    bots: 25, botEveryMin: 5, botsLive: true, nlBuilds: 100, marketplaceCopy: true, backtestYears: 25,
    signals: 100, signalAuto: 'live', customSignals: true,
    optionsFlow: 'realtime', earningsSummaries: 30, darkPool: true, whales: 25,
    copilot: 200,
  },
  ultimate: {
    label: 'Ultimate',
    agentTokens: 25, agentLive: 'auto', extendedHours: true, apiPerMin: 600,
    bots: 60, botEveryMin: 1, botsLive: true, nlBuilds: 500, marketplaceCopy: true, backtestYears: 30,
    signals: 100, signalAuto: 'live', customSignals: true,
    optionsFlow: 'realtime', earningsSummaries: 200, darkPool: true, whales: 100,
    copilot: 1000,
  },
};

// The plan a user's AI limits come from: paid plans while active or in trial, Starter otherwise.
export const aiPlanKey = u => (u?.role === 'admin' && !u.previewPlan ? 'ultimate' : isPaid(u) && AI_PLAN[u.plan] ? u.plan : 'free');
export const aiLimits = u => AI_PLAN[aiPlanKey(u)];

// The lowest plan that allows something (for "part of Elite" messages).
export function planFor(test) {
  for (const k of ['free', 'pro', 'elite', 'ultimate']) if (test(AI_PLAN[k])) return AI_PLAN[k].label;
  return 'Ultimate';
}
export const upgrade = (what, test) => Object.assign(new Error(`${what} is part of the ${planFor(test)} plan`), { status: 402, upgrade: true, feature: what });

const every = m => (m >= 1440 ? 'once a day' : m >= 60 ? `every ${m / 60} hour${m === 60 ? '' : 's'}` : `every ${m} minute${m === 1 ? '' : 's'}`);
const flow = { eod: 'End of day', delayed: '15-minute delay', realtime: 'Real time' };
// Rows for the plan comparison (Plans & billing, and each AI page).
export const AI_PLAN_ROWS = [
  ['AI agents connected (Claude, ChatGPT, Cursor and others)', p => String(p.agentTokens)],
  ['Agent orders on real accounts', p => ({ off: 'Practice only', approve: 'With your approval', auto: 'Automatic within your limits' })[p.agentLive]],
  ['Extended-hours automation', p => (p.extendedHours ? 'Yes' : '-')],
  ['API requests a minute', p => String(p.apiPerMin)],
  ['AI bots running at once', p => String(p.bots)],
  ['Bot checks', p => every(p.botEveryMin)],
  ['Plain-English bot builds a day', p => String(p.nlBuilds)],
  ['AI strategy marketplace', p => (p.marketplaceCopy ? 'Browse and copy' : 'Browse')],
  ['AI signals a day', p => String(p.signals)],
  ['Automatic trades from signals', p => ({ off: '-', paper: 'Practice account', live: 'Real accounts' })[p.signalAuto]],
  ['Custom signal engines', p => (p.customSignals ? 'Yes' : '-')],
  ['Unusual options flow', p => flow[p.optionsFlow]],
  ['AI earnings-call summaries a month', p => String(p.earningsSummaries || '-')],
  ['Chart co-pilot questions a day', p => String(p.copilot)],
];
export const aiPlanTable = () => ({ plans: Object.fromEntries(Object.entries(AI_PLAN).map(([k, p]) => [k, p.label])), rows: AI_PLAN_ROWS.map(([name, f]) => [name, ...Object.values(AI_PLAN).map(f)]) });

// Usage counted per New York day (or month): plain-English builds, co-pilot questions, summaries.
export async function useQuota(u, kind, limit, period = 'day', what = 'This') {
  const day = nyTime().day, key = period === 'month' ? day.slice(0, 7) : day;
  const row = await one('SELECT n FROM ai_usage WHERE user_id = ? AND kind = ? AND period = ?', u.id, kind, key);
  if ((row?.n || 0) >= limit) throw Object.assign(new Error(limit ? `${what}: your plan allows ${limit} a ${period}. More come with a higher plan.` : `${what} is part of a higher plan`), { status: 402, upgrade: true, feature: what });
  await run('INSERT INTO ai_usage (user_id, kind, period, n) VALUES (?,?,?,1) ON CONFLICT(user_id, kind, period) DO UPDATE SET n = n + 1', u.id, kind, key);
  return limit - (row?.n || 0) - 1;
}
