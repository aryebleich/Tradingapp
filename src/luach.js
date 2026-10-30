// The luach: today's Hebrew date and zmanim for the user's city, a month calendar with Yom Tov,
// fasts, Rosh Chodesh and more, opt-in reminders before Shabbos and Yom Tov (candle lighting and
// when it ends), and a tzedakah ledger that counts toward the maaser calculator.
import express from 'express';
import { one, all, run, now } from './db.js';
import { requireUser } from './auth.js';
import { getSetting, setSetting } from './settings.js';
import { notifyUser } from './notify-user.js';
import { CITIES, hebrewDate, yearDays, zmanim, upcoming } from './zmanim.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const DAY = 864e5;
const isoDay = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s)) ? String(s) : null);
const localDay = (t, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

// Settings: the city comes from Values investing unless chosen here; reminders are off until turned on.
export async function luachFor(userId) {
  const l = await getSetting(userId, 'luach', null) || {}, v = await getSetting(userId, 'values', null) || {};
  const city = CITIES[l.city] ? l.city : CITIES[v.city] ? v.city : 'brooklyn';
  return { city, remind: !!l.remind, remindHours: [2, 4, 6, 24].includes(+l.remindHours) ? +l.remindHours : 4 };
}

// The special days between two civil dates (both Hebrew years that touch them).
export function daysBetween(from, to, israel = false) {
  const h1 = hebrewDate(from).year, h2 = hebrewDate(to).year, out = [];
  for (let hy = h1; hy <= h2; hy++) for (const d of yearDays(hy, israel)) if (d.date >= from && d.date <= to) out.push(d);
  return out;
}

export function dayView(iso, cityId) {
  const c = CITIES[cityId];
  return { date: iso, hebrew: hebrewDate(iso), zmanim: zmanim(iso, cityId), events: daysBetween(iso, iso, c.israel), shabbos: new Date(iso + 'T12:00:00Z').getUTCDay() === 6 };
}

// A civil month: each day with its Hebrew date and events, for the calendar grid.
export function monthView(y, m, cityId) {
  const c = CITIES[cityId], first = `${y}-${String(m).padStart(2, '0')}-01`, days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = addDays(first, days - 1), events = daysBetween(first, last, c.israel), out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(first, i), h = hebrewDate(d);
    out.push({ date: d, weekday: new Date(d + 'T12:00:00Z').getUTCDay(), hebrew: { day: h.day, month: h.month, yi: h.yi }, events: events.filter(e => e.date === d) });
  }
  return { year: y, month: m, days: out };
}

// Reminder job: once per Shabbos or Yom Tov, a few hours before candle lighting.
export async function runLuachReminders(t = now()) {
  let sent = 0;
  for (const row of await all("SELECT user_id FROM user_settings WHERE k = 'luach' AND v LIKE '%\"remind\":true%'")) {
    const s = await luachFor(row.user_id); if (!s.remind) continue;
    const c = CITIES[s.city], next = upcoming(s.city, t, 1)[0];
    if (!next || next.starts - t > s.remindHours * 3600e3 || next.starts < t) continue;
    const key = `${next.name}:${localDay(next.starts, c.tz)}`, last = await getSetting(row.user_id, 'luachSent', null);
    if (last === key) continue;
    const fmt = x => new Date(x).toLocaleString('en-US', { timeZone: c.tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
    await notifyUser(row.user_id, `${next.name} in ${c.name}: candle lighting ${fmt(next.starts)}; ends ${fmt(next.ends)}. Good ${next.name === 'Shabbos' ? 'Shabbos' : 'Yom Tov'}!`).catch(() => {});
    await setSetting(row.user_id, 'luachSent', key); sent++;
  }
  return sent;
}

const cleanGift = b => {
  const day = isoDay(b.day) || new Date().toISOString().slice(0, 10), amount = +b.amount, recipient = String(b.recipient || '').trim().slice(0, 100);
  if (!(amount > 0) || amount > 1e8) throw bad('Enter the amount given');
  if (!recipient) throw bad('Who was it given to?');
  return { day, amount: +amount.toFixed(2), recipient, note: String(b.note || '').trim().slice(0, 300) };
};

export const luachRouter = (() => {
  const r = express.Router();
  r.use(requireUser);
  r.get('/', async (req, res) => {
    const s = await luachFor(req.user.id), c = CITIES[s.city];
    const today = isoDay(req.query.date) || localDay(Date.now(), c.tz);
    res.json({ settings: s, cities: Object.fromEntries(Object.entries(CITIES).map(([k, x]) => [k, x.name])), tz: c.tz, today: dayView(today, s.city), coming: daysBetween(addDays(today, 1), addDays(today, 45), c.israel).filter(d => d.kind !== 'cholhamoed' || d.name === 'Hoshana Rabba'), shabbos: upcoming(s.city, Date.now(), 3) });
  });
  r.get('/month', async (req, res) => {
    const s = await luachFor(req.user.id), y = +req.query.y, m = +req.query.m;
    if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12)) throw bad('Pick a month');
    res.json(monthView(y, m, s.city));
  });
  r.put('/settings', async (req, res) => {
    const cur = await luachFor(req.user.id), b = req.body || {};
    const next = { city: CITIES[b.city] ? b.city : cur.city, remind: b.remind === undefined ? cur.remind : !!b.remind, remindHours: [2, 4, 6, 24].includes(+b.remindHours) ? +b.remindHours : cur.remindHours };
    await setSetting(req.user.id, 'luach', next);
    res.json(next);
  });
  // The tzedakah ledger.
  r.get('/tzedakah', async (req, res) => {
    const year = +req.query.year || new Date().getFullYear();
    const items = await all('SELECT id, day, amount, recipient, note FROM tzedakah WHERE user_id = ? AND day LIKE ? ORDER BY day DESC, id DESC', req.user.id, `${year}-%`);
    const byRecipient = {}; for (const i of items) byRecipient[i.recipient] = +((byRecipient[i.recipient] || 0) + i.amount).toFixed(2);
    res.json({ year, items, total: +items.reduce((s, i) => s + i.amount, 0).toFixed(2), byRecipient: Object.entries(byRecipient).sort((a, b) => b[1] - a[1]).map(([recipient, amount]) => ({ recipient, amount })) });
  });
  r.post('/tzedakah', async (req, res) => {
    if ((await one('SELECT COUNT(*) n FROM tzedakah WHERE user_id = ?', req.user.id)).n >= 5000) throw bad('The ledger is full');
    const g = cleanGift(req.body || {});
    const id = Number((await run('INSERT INTO tzedakah (user_id, day, amount, recipient, note, created_at) VALUES (?,?,?,?,?,?)', req.user.id, g.day, g.amount, g.recipient, g.note, now())).lastInsertRowid);
    res.json({ id, ...g });
  });
  r.delete('/tzedakah/:id', async (req, res) => { await run('DELETE FROM tzedakah WHERE id = ? AND user_id = ?', +req.params.id, req.user.id); res.json({ ok: true }); });
  r.get('/tzedakah.csv', async (req, res) => {
    const year = +req.query.year || new Date().getFullYear(), q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const items = await all('SELECT day, amount, recipient, note FROM tzedakah WHERE user_id = ? AND day LIKE ? ORDER BY day', req.user.id, `${year}-%`);
    res.type('text/csv').set('Content-Disposition', `attachment; filename="tzedakah-${year}.csv"`).send(['Date,Amount,Given to,Note', ...items.map(i => [i.day, i.amount.toFixed(2), q(i.recipient), q(i.note)].join(','))].join('\n'));
  });
  return r;
})();
