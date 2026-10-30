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
export const sunset = (iso, lat, lon) => sunTime(iso, lat, lon, 90.833, false);
export const sunrise = (iso, lat, lon) => sunTime(iso, lat, lon, 90.833, true);
// The sun at a given angle (zenith degrees) in the morning or the evening; null when it never gets there.
export function sunTime(iso, lat, lon, zenith = 90.833, rising = false) {
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
  const cosH = Math.cos(zenith * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (zenith !== 90.833 && (cosH < -1 || cosH > 1)) return null;
  const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) * deg;
  const minutes = 720 - 4 * lon - eqTime + (rising ? -4 : 4) * ha;
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

// ---------- the luach: Hebrew dates, zmanim and the year's days ----------
const isLeap = hy => (7 * hy + 1) % 19 < 7;
const yearLength = hy => rdOfIso(roshHashana(hy + 1)) - rdOfIso(roshHashana(hy));
// The months of a Hebrew year from Tishrei, with their lengths.
export function monthsOf(hy) {
  const len = yearLength(hy) % 10; // 3 deficient, 4 regular, 5 complete (353/354/355 or 383/384/385)
  const m = [['Tishrei', 30], ['Cheshvan', len === 5 ? 30 : 29], ['Kislev', len === 3 ? 29 : 30], ['Teves', 29], ['Shevat', 30]];
  if (isLeap(hy)) m.push(['Adar I', 30], ['Adar II', 29]); else m.push(['Adar', 29]);
  m.push(['Nisan', 30], ['Iyar', 29], ['Sivan', 30], ['Tammuz', 29], ['Av', 30], ['Elul', 29]);
  return m.map(([name, days]) => ({ name, days }));
}
export const YI_MONTHS = { Tishrei: 'תשרי', Cheshvan: 'חשון', Kislev: 'כסלו', Teves: 'טבת', Shevat: 'שבט', 'Adar I': 'אדר א׳', 'Adar II': 'אדר ב׳', Adar: 'אדר', Nisan: 'ניסן', Iyar: 'אייר', Sivan: 'סיון', Tammuz: 'תמוז', Av: 'אב', Elul: 'אלול' };
// A number in Hebrew letters (gematria): 15 is ט״ו, 16 ט״ז, 5787 is תשפ״ז.
export function gematria(n) {
  n %= 1000;
  let out = '';
  for (const [v, l] of [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק']]) while (n >= v) { out += l; n -= v; }
  if (n === 15) out += 'טו'; else if (n === 16) out += 'טז';
  else { const tens = 'יכלמנסעפצ', ones = 'אבגדהוזחט'; if (n >= 10) out += tens[Math.floor(n / 10) - 1]; if (n % 10) out += ones[n % 10 - 1]; }
  return out.length > 1 ? out.slice(0, -1) + '״' + out.slice(-1) : out + '׳';
}
// The Hebrew date of a civil date (the day that begins at the evening before is not counted here).
export function hebrewDate(iso) {
  const rd = rdOfIso(iso);
  let hy = +iso.slice(0, 4) + 3761;
  if (rdOfIso(roshHashana(hy)) > rd) hy--;
  let left = rd - rdOfIso(roshHashana(hy));
  for (const m of monthsOf(hy)) {
    if (left < m.days) {
      const day = left + 1;
      return { day, month: m.name, year: hy, text: `${day} ${m.name} ${hy}`, yi: `${gematria(day)} ${YI_MONTHS[m.name]} ${gematria(hy)}` };
    }
    left -= m.days;
  }
}
// The civil date of a Hebrew date (month by name; "Adar" in a leap year means Adar II).
export function civilOf(hy, month, day) {
  const months = monthsOf(hy);
  const name = month === 'Adar' && isLeap(hy) ? 'Adar II' : month;
  let rd = rdOfIso(roshHashana(hy));
  for (const m of months) { if (m.name === name) return isoOfRd(rd + day - 1); rd += m.days; }
  return null;
}
const dow = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
// Every special day of a Hebrew year: Yom Tov, fasts, Chanukah, Purim, Rosh Chodesh and more.
export function yearDays(hy, israel = false) {
  const out = [], add = (iso, name, kind) => iso && out.push({ date: iso, name, kind });
  const on = (m, d) => civilOf(hy, m, d), next = (iso, n) => addDays(iso, n);
  // A fast that falls on Shabbos moves to Sunday (Taanis Esther moves back to Thursday).
  const fast = (iso, name) => add(dow(iso) === 6 ? next(iso, 1) : iso, name, 'fast');
  add(on('Tishrei', 1), 'Rosh Hashana', 'yomtov'); add(on('Tishrei', 2), 'Rosh Hashana', 'yomtov');
  fast(on('Tishrei', 3), 'Tzom Gedalia');
  add(on('Tishrei', 10), 'Yom Kippur', 'yomtov');
  add(on('Tishrei', 15), 'Sukkos', 'yomtov'); if (!israel) add(on('Tishrei', 16), 'Sukkos', 'yomtov');
  for (let d = israel ? 16 : 17; d <= 20; d++) add(on('Tishrei', d), 'Chol Hamoed Sukkos', 'cholhamoed');
  add(on('Tishrei', 21), 'Hoshana Rabba', 'cholhamoed');
  add(on('Tishrei', 22), israel ? 'Shemini Atzeres and Simchas Torah' : 'Shemini Atzeres', 'yomtov'); if (!israel) add(on('Tishrei', 23), 'Simchas Torah', 'yomtov');
  for (let i = 0; i < 8; i++) add(next(on('Kislev', 25), i), `Chanukah (${i + 1} candle${i ? 's' : ''})`, 'chanukah');
  const tevet10 = on('Teves', 10); add(tevet10, 'Asara B\'Teves', 'fast');
  add(on('Shevat', 15), 'Tu B\'Shvat', 'minor');
  if (isLeap(hy)) add(civilOf(hy, 'Adar I', 14), 'Purim Katan', 'minor');
  const esther = on('Adar', 13); add(dow(esther) === 6 ? next(esther, -2) : esther, 'Taanis Esther', 'fast');
  add(on('Adar', 14), 'Purim', 'purim'); add(on('Adar', 15), 'Shushan Purim', 'purim');
  add(next(on('Nisan', 14), dow(on('Nisan', 14)) === 6 ? -2 : 0), 'Taanis Bechoros (fast of the firstborn)', 'fast');
  add(on('Nisan', 15), 'Pesach', 'yomtov'); if (!israel) add(on('Nisan', 16), 'Pesach', 'yomtov');
  for (let d = israel ? 16 : 17; d <= 20; d++) add(on('Nisan', d), 'Chol Hamoed Pesach', 'cholhamoed');
  add(on('Nisan', 21), 'Shevi\'i shel Pesach', 'yomtov'); if (!israel) add(on('Nisan', 22), 'Acharon shel Pesach', 'yomtov');
  add(on('Iyar', 14), 'Pesach Sheni', 'minor'); add(on('Iyar', 18), 'Lag Ba\'Omer', 'minor');
  add(on('Sivan', 6), 'Shavuos', 'yomtov'); if (!israel) add(on('Sivan', 7), 'Shavuos', 'yomtov');
  fast(on('Tammuz', 17), 'Shiva Asar B\'Tammuz');
  fast(on('Av', 9), 'Tisha B\'Av');
  add(on('Av', 15), 'Tu B\'Av', 'minor');
  // Rosh Chodesh: the 30th of a 30-day month and the 1st of the next (not Tishrei).
  let rd = rdOfIso(roshHashana(hy));
  const months = monthsOf(hy);
  months.forEach((m, i) => {
    if (i) add(isoOfRd(rd), `Rosh Chodesh ${m.name}`, 'roshchodesh');
    if (m.days === 30 && months[i + 1]) add(isoOfRd(rd + 29), `Rosh Chodesh ${months[i + 1].name}`, 'roshchodesh');
    rd += m.days;
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// The day's zmanim at a place (UTC milliseconds): the GRA counts the day from sunrise to sunset,
// the Magen Avraham from 72 minutes before sunrise to 72 minutes after sunset.
export function zmanim(iso, cityId = 'brooklyn') {
  const c = CITIES[cityId] || CITIES.brooklyn;
  const rise = sunrise(iso, c.lat, c.lon), set = sunset(iso, c.lat, c.lon), hour = (set - rise) / 12;
  const mgaStart = rise - 72 * 60e3, mgaHour = (set + 72 * 60e3 - mgaStart) / 12;
  return {
    alos: sunTime(iso, c.lat, c.lon, 106.1, true) ?? mgaStart, // 16.1° below the horizon
    misheyakir: sunTime(iso, c.lat, c.lon, 101, true), // 11°
    sunrise: rise,
    shemaMGA: mgaStart + 3 * mgaHour, shemaGRA: rise + 3 * hour,
    tefilaMGA: mgaStart + 4 * mgaHour, tefilaGRA: rise + 4 * hour,
    chatzos: rise + 6 * hour,
    minchaGedola: rise + 6.5 * hour, minchaKetana: rise + 9.5 * hour, plag: rise + 10.75 * hour,
    candles: set - (c.candles ?? 18) * 60e3,
    sunset: set,
    tzeis: sunTime(iso, c.lat, c.lon, 98.5, false) ?? set + 45 * 60e3, // 8.5°: three stars
    rabbeinuTam: set + 72 * 60e3,
  };
}
