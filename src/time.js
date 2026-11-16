// New York market time, shared by the scheduler and the order guardrails. Trading days, holidays and
// early closes come from the US market calendar (market-calendar.js).
import { sessionOf, isTradingDay, nextTradingDay, OPEN_MIN } from './market-calendar.js';
export const nyTime = (t = Date.now()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour % 24) * 60 + +p.minute, weekday: p.weekday, weekend: ['Sat', 'Sun'].includes(p.weekday) };
};
// Regular US stock session: 9:30 to 16:00 New York time (13:00 on early-close days), trading days only.
export const stockSession = (t = Date.now()) => { const n = nyTime(t), s = sessionOf(n.day); return !!s && n.minutes >= s.open && n.minutes < s.close; };
export const isCryptoSymbol = s => String(s).includes('/');

// The moment a New York wall-clock time happens (handles daylight saving): day 'YYYY-MM-DD', minutes after midnight.
export function nyAt(day, minutes) {
  const [y, m, d] = day.split('-').map(Number), want = Date.UTC(y, m - 1, d) + minutes * 60e3;
  let t = want + 5 * 3600e3; // New York is 4-5 hours behind UTC
  for (let i = 0; i < 3; i++) { const n = nyTime(t), [a, b, c] = n.day.split('-').map(Number); t -= Date.UTC(a, b - 1, c) + n.minutes * 60e3 - want; }
  return t;
}
export const addDays = (day, k) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };
const weekdayOf = day => new Date(day + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
// The next run of a scheduled order after time t, at a fixed New York time:
//   once     no next run          daily    every weekday (Mon-Fri)
//   weekly   on the chosen weekdays (0-6)  monthly  the same day of the month (moved to Monday on weekends)
export function nextNyRun(t, { repeat, minutes, weekdays = [], monthDay = 1 }) {
  if (repeat === 'once') return null;
  const today = nyTime(t).day;
  if (repeat === 'monthly') {
    for (let k = 0; k < 24; k++) {
      const first = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 + k, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      let day = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(monthDay, last))).toISOString().slice(0, 10);
      if (!isTradingDay(day)) day = nextTradingDay(day); // weekend or holiday: the next trading day
      const at = nyAt(day, minutes);
      if (at > t) return at;
    }
    return null;
  }
  for (let k = 0; k < 15; k++) {
    const day = addDays(today, k), wd = weekdayOf(day), at = nyAt(day, minutes);
    if (at <= t) continue;
    if (!isTradingDay(day)) continue; // weekends and market holidays are skipped
    if (repeat === 'daily') return at;
    if (repeat === 'weekly' && (weekdays.length ? weekdays : [1, 2, 3, 4, 5]).includes(wd)) return at;
  }
  return null;
}
// Pre-market (4:00-9:30) and after-hours (close to 20:00; to 17:00 on early-close days), trading days only.
export const extendedSession = (t = Date.now()) => { const n = nyTime(t), s = sessionOf(n.day); return !!s && ((n.minutes >= 240 && n.minutes < s.open) || (n.minutes >= s.close && n.minutes < (s.early ? 1020 : 1200))); };

// ---------- session moments (instants in ms) ----------
// The open and close of the session on a New York day, or null when the market is closed that day.
export const sessionTimes = day => { const s = sessionOf(day); return s ? { open: nyAt(day, s.open), close: nyAt(day, s.close), early: s.early } : null; };
// The next regular-session open at or after t.
export function nextOpenAt(t = Date.now()) {
  const n = nyTime(t);
  let day = nextTradingDay(n.day, true);
  if (day === n.day && n.minutes >= OPEN_MIN) day = nextTradingDay(n.day);
  return nyAt(day, OPEN_MIN);
}
// The close of the current session, or of the next one when the market is closed now.
export function nextCloseAt(t = Date.now()) {
  const n = nyTime(t), s = sessionOf(n.day);
  if (s && n.minutes < s.close) return nyAt(n.day, s.close);
  const day = nextTradingDay(n.day); return nyAt(day, sessionOf(day).close);
}
