// Shabbos and Yom Tov times, for users who turn on "No trading on Shabbos and Yom Tov" (Values
// investing). The Hebrew calendar gives the Yom Tov dates (the fixed arithmetic calendar: molad
// and the postponement rules); a solar formula gives sunset for the user's city. Trading pauses
// from candle lighting (18 minutes before sunset; 40 in Jerusalem) until 72 minutes after sunset
// at the end of the day (Rabbeinu Tam), the stricter common practice.
const DAY = 864e5;

// ---------- the Hebrew calendar ----------
// Days from the Hebrew epoch to Rosh Hashana of year y (Calendrical Calculations).
function elapsed(y) {
  const months = Math.floor((235 * y - 234) / 19), parts = 12084 + 13753 * months;
  let d = 29 * months + Math.floor(parts / 25920);
  if ((3 * (d + 1)) % 7 < 3) d++;
  return d;
}
function delay(y) {
  const last = elapsed(y - 1), now = elapsed(y), next = elapsed(y + 1);
  return next - now === 356 ? 2 : now - last === 382 ? 1 : 0;
}
const EPOCH = -1373427; // fixed day (R.D.) of the Hebrew epoch; R.D. 719163 is 1970-01-01
const isoOfRd = rd => new Date((rd - 719163) * DAY).toISOString().slice(0, 10);
const rdOfIso = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY) + 719163;
export const roshHashana = hy => isoOfRd(EPOCH + elapsed(hy) + delay(hy));

// Every Yom Tov day in a Gregorian year (two days outside Israel), with its name.
export function yomTovDays(gy, israel = false) {
  const out = [];
  const add = (rd, name) => { const iso = isoOfRd(rd); if (iso.startsWith(String(gy))) out.push({ date: iso, name }); };
  // Pesach and Shavuos of the spring, counted back from the next Rosh Hashana (15 Nisan is 163 days before).
  const p = rdOfIso(roshHashana(gy + 3761)) - 163;
  add(p, 'Pesach'); if (!israel) add(p + 1, 'Pesach');
  add(p + 6, 'Shevi\'i shel Pesach'); if (!israel) add(p + 7, 'Acharon shel Pesach');
  add(p + 50, 'Shavuos'); if (!israel) add(p + 51, 'Shavuos');
  // The autumn: Rosh Hashana, Yom Kippur, Sukkos, Shemini Atzeres and Simchas Torah.
  const r = rdOfIso(roshHashana(gy + 3761));
  add(r, 'Rosh Hashana'); add(r + 1, 'Rosh Hashana');
  add(r + 9, 'Yom Kippur');
  add(r + 14, 'Sukkos'); if (!israel) add(r + 15, 'Sukkos');
  add(r + 21, israel ? 'Shemini Atzeres and Simchas Torah' : 'Shemini Atzeres'); if (!israel) add(r + 22, 'Simchas Torah');
  return out;
}

// ---------- sunset ----------
// Sunset (UTC milliseconds) on a date at a place: the NOAA solar formula (equation of time and
// the sun's declination), within about a minute of published times.
export function sunset(iso, lat, lon) {
  const rad = Math.PI / 180, deg = 1 / rad, [y, mo, d] = iso.split('-').map(Number);
  const day0 = Date.UTC(y, mo - 1, d);
  const jd = day0 / DAY + 2440587.5 + 0.5 - lon / 360; // local noon
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * t, appLong = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const obliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(obliq * rad) * Math.sin(appLong * rad));
  const yv = Math.tan(obliq * rad / 2) ** 2;
  const eqTime = 4 * deg * (yv * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * yv * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * yv * yv * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) * deg;
  const minutes = 720 - 4 * lon - eqTime + 4 * ha;
  return day0 + minutes * 60e3;
}

// ---------- places ----------
export const CITIES = {
  brooklyn: { name: 'Brooklyn / New York', lat: 40.65, lon: -73.95, tz: 'America/New_York' },
  monsey: { name: 'Monsey', lat: 41.11, lon: -74.07, tz: 'America/New_York' },
  lakewood: { name: 'Lakewood', lat: 40.08, lon: -74.21, tz: 'America/New_York' },
  williamsburg: { name: 'Williamsburg', lat: 40.71, lon: -73.96, tz: 'America/New_York' },
  kiryasjoel: { name: 'Kiryas Joel', lat: 41.34, lon: -74.17, tz: 'America/New_York' },
  chicago: { name: 'Chicago', lat: 41.88, lon: -87.63, tz: 'America/Chicago' },
  miami: { name: 'Miami', lat: 25.76, lon: -80.19, tz: 'America/New_York' },
  losangeles: { name: 'Los Angeles', lat: 34.05, lon: -118.24, tz: 'America/Los_Angeles' },
  montreal: { name: 'Montreal', lat: 45.50, lon: -73.57, tz: 'America/Toronto' },
  toronto: { name: 'Toronto', lat: 43.65, lon: -79.38, tz: 'America/Toronto' },
  london: { name: 'London', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
  antwerp: { name: 'Antwerp', lat: 51.22, lon: 4.40, tz: 'Europe/Brussels' },
  jerusalem: { name: 'Jerusalem', lat: 31.78, lon: 35.22, tz: 'Asia/Jerusalem', israel: true, candles: 40 },
  bneibrak: { name: 'Bnei Brak', lat: 32.08, lon: 34.83, tz: 'Asia/Jerusalem', israel: true },
};
const localDay = (t, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const holyCache = new Map();
// Shabbos or Yom Tov on this calendar date (in the place's own calendar), with its name.
export function holyDay(iso, israel = false) {
  const key = iso.slice(0, 4) + (israel ? 'i' : 'd');
  if (!holyCache.has(key)) holyCache.set(key, new Map(yomTovDays(+iso.slice(0, 4), israel).map(x => [x.date, x.name])));
  const yt = holyCache.get(key).get(iso);
  if (yt) return yt;
  return new Date(iso + 'T12:00:00Z').getUTCDay() === 6 ? 'Shabbos' : null;
}

// Is time t within Shabbos or Yom Tov at this place? Returns { name, until } or null.
export function shabbosAt(t, cityId = 'brooklyn') {
  const c = CITIES[cityId] || CITIES.brooklyn, before = (c.candles ?? 18) * 60e3, after = 72 * 60e3;
  const today = localDay(t, c.tz);
  const endOf = start => { let d = start; while (holyDay(addDays(d, 1), c.israel)) d = addDays(d, 1); return sunset(d, c.lat, c.lon) + after; };
  // Today is holy and it is not yet over (nightfall), or tomorrow is holy and candle lighting passed.
  const h = holyDay(today, c.israel);
  if (h && t < sunset(today, c.lat, c.lon) + after) return { name: h, until: endOf(today) };
  const yesterday = addDays(today, -1), hy = holyDay(yesterday, c.israel);
  if (hy && t < sunset(yesterday, c.lat, c.lon) + after && !h) return { name: hy, until: sunset(yesterday, c.lat, c.lon) + after };
  const tomorrow = addDays(today, 1), ht = holyDay(tomorrow, c.israel);
  if (ht && t >= sunset(today, c.lat, c.lon) - before) return { name: ht, until: endOf(tomorrow) };
  return null;
}
// The next few start and end times, for the Settings page.
export function upcoming(cityId = 'brooklyn', from = Date.now(), n = 4) {
  const c = CITIES[cityId] || CITIES.brooklyn, out = [];
  let d = localDay(from, c.tz);
  for (let i = 0; i < 60 && out.length < n; i++, d = addDays(d, 1)) {
    const name = holyDay(d, c.israel);
    if (!name || holyDay(addDays(d, -1), c.israel)) continue;
    let end = d; while (holyDay(addDays(end, 1), c.israel)) end = addDays(end, 1);
    const starts = sunset(addDays(d, -1), c.lat, c.lon) - (c.candles ?? 18) * 60e3, ends = sunset(end, c.lat, c.lon) + 72 * 60e3;
    if (ends > from) out.push({ name, starts, ends });
  }
  return out;
}
