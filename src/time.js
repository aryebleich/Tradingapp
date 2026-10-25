// New York market time, shared by the scheduler and the order guardrails.
export const nyTime = (t = Date.now()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour % 24) * 60 + +p.minute, weekday: p.weekday, weekend: ['Sat', 'Sun'].includes(p.weekday) };
};
// Regular US stock session, 9:30 to 16:00 New York time on weekdays.
export const stockSession = (t = Date.now()) => { const n = nyTime(t); return !n.weekend && n.minutes >= 570 && n.minutes < 960; };
export const isCryptoSymbol = s => String(s).includes('/');
