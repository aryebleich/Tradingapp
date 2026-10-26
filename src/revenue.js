// The owner's money levers, set in Admin → Business mode: the deposit service fee, the referral
// program (reward, a longer trial for invited friends, milestone bonuses) and the commission on
// orders in brokerage accounts opened through QuantPocket (Alpaca Broker API partner commission).
import { one, run, now } from './db.js';
import { siteGet, siteSet } from './site.js';

const num = (v, d = 0) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const DEFAULTS = () => ({
  depositFeePercent: Math.max(0, num(process.env.DEPOSIT_FEE_PERCENT)),
  depositFeeFixed: Math.max(0, num(process.env.DEPOSIT_FEE_FIXED)),
  depositFeeCap: 0, // 0 = no cap
  referralCredit: num(process.env.REFERRAL_CREDIT, 10),
  friendTrialBonusDays: 16, // invited friends get 14 + 16 = 30 days free
  milestones: [{ at: 5, bonus: 50 }, { at: 10, bonus: 100 }, { at: 25, bonus: 300 }],
  commissionType: 'bps', // bps | notional (dollars per order) | qty (dollars per share)
  commissionValue: 0,
});
export const settings = () => ({ ...DEFAULTS(), ...siteGet('money', {}) });

// Saves only known fields, each checked and kept in a sane range.
export async function saveSettings(b = {}) {
  const cur = settings(), out = { ...cur };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, +v));
  if (b.depositFeePercent !== undefined) out.depositFeePercent = clamp(b.depositFeePercent, 0, 5);
  if (b.depositFeeFixed !== undefined) out.depositFeeFixed = clamp(b.depositFeeFixed, 0, 25);
  if (b.depositFeeCap !== undefined) out.depositFeeCap = clamp(b.depositFeeCap, 0, 1000);
  if (b.referralCredit !== undefined) out.referralCredit = clamp(b.referralCredit, 0, 500);
  if (b.friendTrialBonusDays !== undefined) out.friendTrialBonusDays = Math.round(clamp(b.friendTrialBonusDays, 0, 76));
  if (Array.isArray(b.milestones)) out.milestones = b.milestones.map(m => ({ at: Math.round(clamp(m.at, 1, 1000)), bonus: clamp(m.bonus, 0, 5000) })).filter(m => m.bonus > 0).sort((x, y) => x.at - y.at).slice(0, 6);
  if (b.commissionType !== undefined) { if (!['bps', 'notional', 'qty'].includes(b.commissionType)) throw Object.assign(new Error('Commission type is bps, notional or qty'), { status: 400 }); out.commissionType = b.commissionType; }
  // Limits keep the commission small enough to stay a fair price for customers.
  if (b.commissionValue !== undefined) out.commissionValue = clamp(b.commissionValue, 0, { bps: 50, notional: 5, qty: 0.05 }[out.commissionType]);
  return siteSet('money', out);
}

// ---------- deposit service fee ----------
export function serviceFee(amount) {
  const s = settings();
  const fee = amount * s.depositFeePercent / 100 + (s.depositFeePercent || s.depositFeeFixed ? s.depositFeeFixed : 0);
  return +(s.depositFeeCap > 0 ? Math.min(fee, s.depositFeeCap) : fee).toFixed(2);
}
export const feeTerms = () => { const s = settings(); return { percent: s.depositFeePercent, fixed: s.depositFeeFixed, cap: s.depositFeeCap }; };

// ---------- referrals ----------
export const trialDaysFor = (u, base) => base + (u?.referred_by ? settings().friendTrialBonusDays : 0);
// The credit for one paying friend, plus a milestone bonus when this friend reaches one.
export async function referralReward(referrerId) {
  const s = settings();
  const paying = (await one('SELECT COUNT(*) n FROM users WHERE referred_by = ? AND referral_rewarded = 1', referrerId)).n;
  const m = s.milestones.find(x => x.at === paying);
  return { credit: s.referralCredit, bonus: m ? m.bonus : 0, paying, milestone: m || null };
}
export function nextMilestone(paying) {
  return settings().milestones.find(m => m.at > paying) || null;
}

// ---------- Broker API partner commission ----------
// Added to orders in accounts QuantPocket opened (Broker API); Alpaca collects it for the partner.
export function withCommission(body) {
  const s = settings();
  if (!(s.commissionValue > 0)) return body;
  return { ...body, commission: String(s.commissionValue), commission_type: s.commissionType };
}
// Records what the commission on a sent order should bring in, for the revenue page.
export async function recordCommission(userId, order, priceHint) {
  const s = settings();
  if (!(s.commissionValue > 0) || !order?.id) return;
  const qty = +order.qty || 0, notional = +order.notional || qty * (+priceHint || +order.limit_price || 0);
  const amount = s.commissionType === 'bps' ? notional * s.commissionValue / 1e4 : s.commissionType === 'qty' ? qty * s.commissionValue : s.commissionValue;
  if (!(amount > 0)) return;
  await run('INSERT OR IGNORE INTO ledger (user_id, kind, amount, status, ref, memo, at) VALUES (?,?,?,?,?,?,?)', userId, 'broker_commission', +amount.toFixed(4), 'pending', 'order:' + order.id, `${order.side || ''} ${order.symbol || ''}`.trim(), now());
}
