// New York market time, shared by the scheduler and the order guardrails.
export const nyTime = (t = Date.now()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour % 24) * 60 + +p.minute, weekday: p.weekday, weekend: ['Sat', 'Sun'].includes(p.weekday) };
};
// Regular US stock session, 9:30 to 16:00 New York time on weekdays.
export const stockSession = (t = Date.now()) => { const n = nyTime(t); return !n.weekend && n.minutes >= 570 && n.minutes < 960; };
export const isCryptoSymbol = s => String(s).includes('/');

// The moment a New York wall-clock time happens (handles daylight saving): day 'YYYY-MM-DD', minutes after midnight.
export function nyAt(day, minutes) {
  const [y, m, d] = day.split('-').map(Number), want = Date.UTC(y, m - 1, d) + minutes * 60e3;
  let t = want + 5 * 3600e3; // New York is 4-5 hours behind UTC
  for (let i = 0; i < 3; i++) { const n = nyTime(t), [a, b, c] = n.day.split('-').map(Number); t -= Date.UTC(a, b - 1, c) + n.minutes * 60e3 - want; }
  return t;
}
const addDays = (day, k) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };
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
      while ([0, 6].includes(weekdayOf(day))) day = addDays(day, 1); // weekend: the next Monday
      const at = nyAt(day, minutes);
      if (at > t) return at;
    }
    return null;
  }
  for (let k = 0; k < 15; k++) {
    const day = addDays(today, k), wd = weekdayOf(day), at = nyAt(day, minutes);
    if (at <= t) continue;
    if (repeat === 'daily' && wd >= 1 && wd <= 5) return at;
    if (repeat === 'weekly' && (weekdays.length ? weekdays : [1, 2, 3, 4, 5]).includes(wd)) return at;
  }
  return null;
}
// Pre-market (4:00-9:30) and after-hours (16:00-20:00) on weekdays, New York time.
export const extendedSession = (t = Date.now()) => { const n = nyTime(t); return !n.weekend && ((n.minutes >= 240 && n.minutes < 570) || (n.minutes >= 960 && n.minutes < 1200)); };
