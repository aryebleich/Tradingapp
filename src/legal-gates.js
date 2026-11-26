// Legal gates (Admin → Security → Legal gates; LEGAL_REVIEW.md L-MP1 to L-MP4). Parts of the master plan
// that can make Brightolio a broker, an adviser or a seller of trade ideas run only behind a switch that
// stays off until the owner has the legal sign-off (OWN-04). Off is the default, and turning one on asks
// for the owner's password (the Admin unlock) and is written to the audit log (server.js).
// What stays open with every gate off: paper trading and paper copies, copies the member approves trade
// by trade, free sharing of strategies, and every member's own orders on their own broker.
import { siteGet, siteSet, adviserMode } from './site.js';

export const GATES = {
  copyTrading: { review: 'L-MP1', title: 'Copy trading with real money', rows: ['SO-11'],
    what: "Following another member's trades, a shared Playbook or a ready-made strategy automatically in a real account. Also needs registered-adviser mode (Admin → Business mode)." },
  paidIdeas: { review: 'L-MP2', title: 'Paid trade ideas', rows: ['AT-18', 'MK-02', 'MK-03', 'MK-04', 'MK-08', 'SO-08', 'SO-13', 'SO-14'],
    what: 'Paid strategy and bot listings, and paid creator memberships, research, newsletters or livestreams that give trade ideas.' },
  adviceAndCut: { review: 'L-MP3', title: 'Personalized advice and a cut of trades', rows: ['E-02', 'E-05', 'SEC-15'],
    what: 'Personalized advice, adviser portals and the performance fee on profits. Also needs registered-adviser mode.' },
  brokerPerTrade: { review: 'L-MP4', title: 'Brokerage pay per trade', rows: [],
    what: 'The partner commission on orders in brokerage accounts opened through Brightolio.' },
};

const stored = () => { const v = siteGet('legalGates', {}); return v && typeof v === 'object' ? v : {}; };
// On only when the owner turned it on; an unknown name is always off.
export const legalGate = id => Object.hasOwn(GATES, id) && stored()[id]?.on === true;

// Automatic real-money copies need both the adviser registration and the gate.
export const realCopyAllowed = () => adviserMode() && legalGate('copyTrading');
export const performanceFeeAllowed = () => adviserMode() && legalGate('adviceAndCut');
export const brokerCommissionAllowed = () => legalGate('brokerPerTrade');

export function legalGates() {
  const s = stored();
  return Object.entries(GATES).map(([id, g]) => ({ id, ...g, on: s[id]?.on === true, changedAt: s[id]?.at || null, changedBy: s[id]?.by || null }));
}

// The caller has already checked the Admin unlock (the password step-up).
export async function setLegalGate(admin, id, on) {
  if (!Object.hasOwn(GATES, id)) throw Object.assign(new Error('Unknown legal gate'), { status: 400 });
  if (typeof on !== 'boolean') throw Object.assign(new Error('Say on or off'), { status: 400 });
  const s = { ...stored(), [id]: { on, at: Date.now(), by: admin?.email || null } };
  await siteSet('legalGates', s);
  return legalGates().find(g => g.id === id);
}
