// When a scheduled order runs, worked out once when it is created or edited:
//   at      a New York date and time (optionally repeating)
//   close   at the close (offset 0) or a number of minutes before it
//   open    at the next open
//   delay   after a delay (minutes)
// Each plan says when the job starts (nextRun), how late it may still run (graceMin: missed by more
// and it expires, never sent late), whether it uses the broker's own auction order (tif 'opg' / 'cls'),
// and how precise the timing is, in words for the review screen.
import { nyTime, nyAt, nextOpenAt, sessionTimes, stockSession } from './time.js';
import { nextTradingDay, sessionOf, holidayName } from './market-calendar.js';

export const DEFAULT_GRACE_MIN = 15;
// Alpaca's auction cut-offs (Alpaca docs, "Orders at Alpaca", time in force): market- and limit-on-open
// (opg) orders are accepted until 9:28 New York and market- and limit-on-close (cls) orders until 15:50
// (10 minutes before an early close). Auction orders must be for whole shares.
export const OPG_CUTOFF_BEFORE_OPEN_MIN = 2, CLS_CUTOFF_BEFORE_CLOSE_MIN = 10;
export const WAKE_MIN = 10; // the app can sleep; a GitHub Actions tick wakes it at least every 10 minutes
const MIN = 60e3;

export const supportsAuction = (account, { qty, notional } = {}) => (account === 'alpaca' || /^alpaca/.test(account)) && +qty > 0 && Number.isInteger(+qty) && !(+notional > 0);

// The session (instants) a plan targets: today's when it has not passed the cut, else the next one.
function targetSession(t, cutBeforeCloseMin = 0) {
  const n = nyTime(t);
  let day = n.day;
  const today = sessionOf(day);
  if (!today || n.minutes >= today.close - cutBeforeCloseMin) day = nextTradingDay(day);
  return { day, ...sessionTimes(day) };
}

export function planWhen(w, { account = 'paper', qty, notional, t = Date.now() } = {}) {
  const kind = w.kind || 'at';
  const auctionOk = supportsAuction(account, { qty, notional });
  if (kind === 'close') {
    const offset = Math.max(0, Math.min(390, Math.round(+w.offsetMin || 0)));
    if (offset === 0 && auctionOk) {
      const s = targetSession(t, CLS_CUTOFF_BEFORE_CLOSE_MIN + 1);
      const cutoff = s.close - CLS_CUTOFF_BEFORE_CLOSE_MIN * MIN, start = s.close - 30 * MIN;
      return { kind, offsetMin: 0, nextRun: Math.max(start, t), tif: 'cls', graceMin: Math.round((cutoff - Math.max(start, t)) / MIN) - 1, day: s.day, early: s.early,
        precision: `Sent to the closing auction before Alpaca's ${CLS_CUTOFF_BEFORE_CLOSE_MIN}-minute cut-off; it fills at the official closing price.` };
    }
    const s = targetSession(t, offset + 1), at = s.close - Math.max(offset, 1) * MIN;
    const grace = Math.max(1, Math.min(DEFAULT_GRACE_MIN, Math.max(offset, 1) - 1 || 1));
    return { kind, offsetMin: offset, nextRun: at, tif: null, graceMin: grace, day: s.day, early: s.early,
      precision: offset === 0
        ? `This broker has no closing-auction order: it is sent as a market order about a minute before the close. If the app cannot send it by then, it is cancelled, never sent after the close.`
        : `Sent ${offset} minutes before the close, within about ${WAKE_MIN} minutes when the app has been idle; if it is more than ${grace} minutes late it is cancelled.` };
  }
  if (kind === 'open') {
    const next = nextOpenAt(t), day = nyTime(next).day;
    if (auctionOk) {
      const cutoff = next - OPG_CUTOFF_BEFORE_OPEN_MIN * MIN, start = Math.max(t, next - 50 * MIN);
      return { kind, nextRun: start, tif: 'opg', graceMin: Math.round((cutoff - start) / MIN) - 1, day,
        precision: `Sent to the opening auction before Alpaca's 9:${60 - OPG_CUTOFF_BEFORE_OPEN_MIN} cut-off; it fills at the official opening price.` };
    }
    return { kind, nextRun: next, tif: null, graceMin: DEFAULT_GRACE_MIN, day,
      precision: `This broker has no opening-auction order: it is sent as a market order when the market opens, within about ${WAKE_MIN} minutes. More than ${DEFAULT_GRACE_MIN} minutes late, it is cancelled.` };
  }
  if (kind === 'delay') {
    const m = Math.max(1, Math.min(7 * 1440, Math.round(+w.delayMin || 0)));
    let at = t + m * MIN, note = '';
    if (!stockSession(at)) { at = nextOpenAt(at); note = ' The market is closed then, so it waits for the next open.'; }
    return { kind, delayMin: m, nextRun: at, tif: null, graceMin: DEFAULT_GRACE_MIN, day: nyTime(at).day,
      precision: `Sent within about ${WAKE_MIN} minutes of the time.${note} More than ${DEFAULT_GRACE_MIN} minutes late, it is cancelled.` };
  }
  // 'at': a New York date and time
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date || '') || !/^\d{2}:\d{2}$/.test(w.time || '')) throw Object.assign(new Error('Pick a date and time'), { status: 400 });
  const minutes = +w.time.slice(0, 2) * 60 + +w.time.slice(3);
  const at = nyAt(w.date, minutes);
  const closed = holidayName(w.date) || (!sessionOf(w.date) ? 'a weekend' : null);
  const s = sessionOf(w.date);
  const outside = !s || minutes < s.open || minutes >= s.close;
  return { kind: 'at', nextRun: at, minutes, tif: null, graceMin: DEFAULT_GRACE_MIN, day: w.date,
    precision: (outside ? `The market is closed then${closed ? ` (${closed})` : ''}; it runs at the next open. ` : '') + `Sent within about ${WAKE_MIN} minutes of the time; more than ${DEFAULT_GRACE_MIN} minutes late, it is cancelled.` };
}
