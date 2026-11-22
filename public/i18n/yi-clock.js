// Yiddish for the market status labels of the shared calendar (public/market-calendar.js marketStatus):
// the Home clock, the order desk strip and the market overview use the same labels.
const DAYS = { today: 'היינט', tomorrow: 'מארגן', Monday: 'מאנטאג', Tuesday: 'דינסטאג', Wednesday: 'מיטוואך', Thursday: 'דאנערשטאג', Friday: 'פרייטאג', Saturday: 'שבת', Sunday: 'זונטאג' };
const HOLI = { weekend: 'סוף וואך', "New Year's Day": 'ניי-יאר', 'Martin Luther King Jr. Day': 'מארטין לוטער קינג טאג', "Washington's Birthday": 'פרעזידענטן טאג', 'Good Friday': 'גוד פריידעי',
  'Memorial Day': 'מעמאריעל דעי', Juneteenth: 'דזשונטינט', 'Independence Day': 'דזשולאי 4', 'Labor Day': 'לעיבאר דעי', 'Thanksgiving Day': 'טענקסגיווינג', 'Christmas Day': 'קריסמעס', 'Market closed': 'מארקעט פארמאכט' };
const opens = s => s.replace(/^opens (?:(today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) )?(\d{1,2}:\d{2} [AP]M)( \(closes early, 1 PM\))?$/,
  (_, d, t, e) => `עפנט זיך ${d ? DAYS[d] + ' ' : ''}${t}${e ? ' (מאכט זיך פריער צו, 1 PM)' : ''}`);
// One label → Yiddish ("Market closed: Thanksgiving Day · opens Friday 9:30 AM (closes early, 1 PM)").
export function yiMarketLabel(label) {
  const [head, rest] = label.split(' · ');
  let h = head;
  if (/^Market open$/.test(head)) h = 'מארקעט אפן';
  else if (head === 'Pre-market') h = 'פאר-מארקעט';
  else if (head === 'After hours') h = 'נאך די שעות';
  else if (head === 'Market closed') h = 'מארקעט פארמאכט';
  else if (/^Market closed: /.test(head)) { const n = head.slice(15); h = `מארקעט פארמאכט: ${HOLI[n] || n}`; }
  if (rest == null) return h;
  const r = /^closes /.test(rest) ? rest.replace(/^closes (\d{1,2}:\d{2} [AP]M)( \(early close\))?$/, (_, t, e) => `מאכט זיך צו ${t}${e ? ' (פריער צומאכן)' : ''}`) : opens(rest);
  return `${h} · ${r}`;
}
const LABEL = '((?:Market open|Market closed(?:: [^·]+)?|Pre-market|After hours) · (?:closes|opens) .+)';
export const strings = {};
export const patterns = [
  [new RegExp(`^New York (\\d{1,2}:\\d{2}:\\d{2} [AP]M) · ${LABEL}$`), m => `ניו יארק ${m[1]} · ${yiMarketLabel(m[2])}`],
  [new RegExp(`^${LABEL}$`), m => yiMarketLabel(m[1])],
  [/^Market closed: (.+)$/, m => yiMarketLabel(m[0])],
];
