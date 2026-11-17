// US stock market calendar (NYSE and Nasdaq share it): full-day holidays and 1 pm early closes,
// computed from the exchange rules so no yearly list has to be updated. Days are New York dates
// 'YYYY-MM-DD'. Regular session 9:30-16:00; early-close days end at 13:00.
//   Holidays: New Year's Day, Martin Luther King Jr. Day (3rd Monday of January), Presidents Day
//   (3rd Monday of February), Good Friday, Memorial Day (last Monday of May), Juneteenth (from 2022),
//   Independence Day, Labor Day (1st Monday of September), Thanksgiving (4th Thursday of November),
//   Christmas. A holiday on Saturday is observed the Friday before, on Sunday the Monday after;
//   New Year's Day on a Saturday is not observed (NYSE rule 7.2).
//   Early closes (13:00): July 3 when it is a trading day, the day after Thanksgiving, and
//   December 24 when it is a trading day.
//   Unscheduled closures announced by the exchange (national days of mourning) are listed in EXTRA_CLOSED.
export const OPEN_MIN = 570, CLOSE_MIN = 960, EARLY_CLOSE_MIN = 780;
export const EXTRA_CLOSED = new Set(['2018-12-05', '2025-01-09']);

const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dow = day => new Date(day + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
export const addDays = (day, k) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };
const nthWeekday = (y, m, wd, n) => { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7); };
const lastWeekday = (y, m, wd) => { const last = new Date(Date.UTC(y, m, 0)); const d = last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7); return ymd(y, m, d); };
function easter(y) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}
const observed = day => { const w = dow(day); return w === 6 ? addDays(day, -1) : w === 0 ? addDays(day, 1) : day; };

const cache = new Map();
// The holidays of a calendar year, as a Map day -> name.
export function holidays(y) {
  if (cache.has(y)) return cache.get(y);
  const h = new Map();
  const ny = ymd(y, 1, 1); if (dow(ny) !== 6) h.set(observed(ny), "New Year's Day");
  h.set(nthWeekday(y, 1, 1, 3), 'Martin Luther King Jr. Day');
  h.set(nthWeekday(y, 2, 1, 3), "Washington's Birthday");
  h.set(addDays(easter(y), -2), 'Good Friday');
  h.set(lastWeekday(y, 5, 1), 'Memorial Day');
  if (y >= 2022) h.set(observed(ymd(y, 6, 19)), 'Juneteenth');
  h.set(observed(ymd(y, 7, 4)), 'Independence Day');
  h.set(nthWeekday(y, 9, 1, 1), 'Labor Day');
  h.set(nthWeekday(y, 11, 4, 4), 'Thanksgiving Day');
  h.set(observed(ymd(y, 12, 25)), 'Christmas Day');
  // New Year's Day of next year on a Sunday is observed Monday Jan 2 (same year); on a Saturday, not at all.
  cache.set(y, h);
  return h;
}
export const holidayName = day => holidays(+day.slice(0, 4)).get(day) || (EXTRA_CLOSED.has(day) ? 'Market closed' : null);
export const isWeekend = day => [0, 6].includes(dow(day));
export const isTradingDay = day => !isWeekend(day) && !holidayName(day);
// 13:00 New York on early-close days, null otherwise.
export function earlyClose(day) {
  if (!isTradingDay(day)) return null;
  const y = +day.slice(0, 4);
  if (day === ymd(y, 7, 3) || day === ymd(y, 12, 24) || day === addDays(nthWeekday(y, 11, 4, 4), 1)) return EARLY_CLOSE_MIN;
  return null;
}
// The regular session of a day in minutes after New York midnight, or null when the market is closed.
export const sessionOf = day => (isTradingDay(day) ? { open: OPEN_MIN, close: earlyClose(day) ?? CLOSE_MIN, early: earlyClose(day) != null } : null);
export function nextTradingDay(day, includeToday = false) {
  let d = includeToday ? day : addDays(day, 1);
  for (let i = 0; i < 15 && !isTradingDay(d); i++) d = addDays(d, 1);
  return d;
}
export function prevTradingDay(day) { let d = addDays(day, -1); for (let i = 0; i < 15 && !isTradingDay(d); i++) d = addDays(d, -1); return d; }
// Days between from and to (inclusive) that are closed or close early, for the date picker.
export function closedDays(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const n = holidayName(d); if (n && !isWeekend(d)) out.push({ day: d, closed: true, name: n });
    else if (earlyClose(d)) out.push({ day: d, closed: false, early: '13:00' });
  }
  return out;
}
