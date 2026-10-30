// Yiddish on the phone line. No phone voice speaks Yiddish, so the owner records short clips
// (Admin → Phone line): each sentence piece once, and the numbers, from which any amount is built
// (25 is "finf un tsvantsik"). A caller who picks Yiddish hears the clips; a piece with no clip
// yet is read in English, and is listed for the owner to record.
import crypto from 'node:crypto';
import { one, all, run, now } from './db.js';
import { xml } from './notify.js';

const norm = s => String(s).toLowerCase().replace(/[.,!?:;]+/g, ' ').replace(/\s+/g, ' ').trim();
export const clipId = k => crypto.createHash('sha256').update(k).digest('hex').slice(0, 16);
const NUM_RE = /^-?\d[\d,]*(?:\.\d+)?$/;

// Text → pieces: sentence parts (looked up by their words) and numbers (built from number clips).
export function fragments(text) {
  const out = [];
  for (const sentence of String(text).split(/(?<=[.?!])\s+/)) {
    for (const p of sentence.split(/(-?\d[\d,]*(?:\.\d+)?)/)) {
      if (!p) continue;
      if (NUM_RE.test(p)) out.push({ num: p.replace(/,/g, '') });
      else { const k = norm(p); if (k) out.push({ k, english: p.trim() }); }
    }
  }
  return out;
}

// The number clips and the Yiddish to read for each.
export const NUMBER_CLIPS = {
  'n:0': 'נול', 'n:1': 'איינס', 'n:1c': 'איין (as in איין און צוואַנציק)', 'n:2': 'צוויי', 'n:3': 'דריי', 'n:4': 'פֿיר', 'n:5': 'פֿינף', 'n:6': 'זעקס', 'n:7': 'זיבן', 'n:8': 'אַכט', 'n:9': 'ניין',
  'n:10': 'צען', 'n:11': 'עלף', 'n:12': 'צוועלף', 'n:13': 'דרייצן', 'n:14': 'פֿערצן', 'n:15': 'פֿופֿצן', 'n:16': 'זעכצן', 'n:17': 'זיבעצן', 'n:18': 'אַכצן', 'n:19': 'ניינצן',
  'n:20': 'צוואַנציק', 'n:30': 'דרייסיק', 'n:40': 'פֿערציק', 'n:50': 'פֿופֿציק', 'n:60': 'זעכציק', 'n:70': 'זיבעציק', 'n:80': 'אַכציק', 'n:90': 'ניינציק',
  'n:100': 'הונדערט', 'n:1000': 'טויזנט', 'n:1000000': 'מיליאָן', 'w:and': 'און', 'w:point': 'פּונקט', 'w:minus': 'מינוס',
};
// A whole number as clip keys, in Yiddish order: 25 is finf un tsvantsik, 1,250 is toyznt tsvey hundert fuftsik.
export function numberKeys(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return ['n:0'];
  const out = [];
  const under100 = (x, alone) => {
    if (x < 20) return x ? [x === 1 && !alone ? 'n:1c' : `n:${x}`] : [];
    const t = Math.floor(x / 10) * 10, u = x % 10;
    return u ? [u === 1 ? 'n:1c' : `n:${u}`, 'w:and', `n:${t}`] : [`n:${t}`];
  };
  const under1000 = (x, alone) => {
    const h = Math.floor(x / 100), r = x % 100, o = [];
    if (h) o.push(...(h === 1 ? [] : under100(h, false)), 'n:100');
    o.push(...under100(r, alone));
    return o;
  };
  const m = Math.floor(n / 1e6), th = Math.floor(n / 1000) % 1000, r = n % 1000;
  if (m) out.push(...under1000(m, false), 'n:1000000');
  if (th) out.push(...(th === 1 ? [] : under1000(th, false)), 'n:1000');
  out.push(...under1000(r, true));
  return out;
}
export function numberAsKeys(s) {
  const neg = s.startsWith('-'), [i, d] = s.replace('-', '').split('.');
  const keys = [...(neg ? ['w:minus'] : []), ...numberKeys(+i)];
  if (d) keys.push('w:point', ...d.slice(0, 2).split('').map(c => `n:${c}`));
  return keys;
}

// Suggested Yiddish for the sentences the line says most (the owner can read their own wording).
export const SCRIPT = {
  'welcome to brightfolio': 'ברוכים הבאים צו ברייטפֿאָליאָ.',
  'main menu paper trading': 'הויפּט־מעניו, פּראָבע־האַנדל.', 'main menu live trading': 'הויפּט־מעניו, עכטער האַנדל.',
  'press': 'דריקט', 'for account info': 'פֿאַר אייער חשבון', 'for positions': 'פֿאַר די פּאָזיציעס', 'for the market clock': 'פֿאַר דעם מאַרק־זייגער',
  'to place a trade': 'צו מאַכן אַ האַנדל', 'to cancel open orders': 'צו אָפּשטעלן אָפֿענע אָרדערס', 'to close all positions': 'צו פֿאַרמאַכן אַלע פּאָזיציעס',
  'to ask the assistant': 'צו פֿרעגן דעם אַסיסטענט', 'to switch to live trading': 'צו גיין צום עכטן האַנדל', 'to switch to paper trading': 'צו גיין צום פּראָבע־האַנדל',
  'for english': 'פֿאַר ענגליש', 'to hang up': 'צו ענדיקן', 'goodbye': 'זייט געזונט.',
  'for paper trading': 'פֿאַר פּראָבע־האַנדל', 'for live trading': 'פֿאַר עכטן האַנדל',
  'your paper account equity': 'אייער פּראָבע־חשבון: ווערט', 'your live account equity': 'אייער עכטער חשבון: ווערט',
  'dollars cash': 'דאָלער, געלט', 'dollars buying power': 'דאָלער, קויף־קראַפֿט', 'dollars': 'דאָלער', 'positions': 'פּאָזיציעס',
  'you have no positions': 'איר האָט נישט קיין פּאָזיציעס.', 'sorry that is not an option': 'אַנטשולדיקט, דאָס איז נישט קיין ברירה.',
  'to buy': 'צו קויפֿן', 'to sell': 'צו פֿאַרקויפֿן', 'to confirm': 'צו באַשטעטיקן', 'to cancel': 'אָפּצושטעלן', 'to continue': 'צו גיין ווייטער', 'to go back': 'צו גיין צוריק',
  'order cancelled': 'דער אָרדער איז אָפּגעשטעלט.', 'nothing was closed': 'גאָרנישט איז נישט פֿאַרמאַכט געוואָרן.',
  'wrong pin try again': 'אומריכטיקער פּין. פּרובירט נאָכאַמאָל.', 'too many wrong pins goodbye': 'צו פֿיל אומריכטיקע פּינס. זייט געזונט.',
  'the market is open': 'דער מאַרק איז אָפֿן.', 'the market is closed': 'דער מאַרק איז פֿאַרמאַכט.',
  'switched to paper trading': 'איבערגעביטן צום פּראָבע־האַנדל.', 'switched to live trading': 'איבערגעביטן צום עכטן האַנדל.',
  'thank you for calling brightfolio goodbye': 'אַ דאַנק פֿאַרן רופֿן ברייטפֿאָליאָ. זייט געזונט.',
  'sorry something went wrong': 'אַנטשולדיקט, עפּעס איז נישט געגאַנגען.', 'switched to yiddish': 'איבערגעביטן אויף אידיש.',
};

// The clips there are (key → id), refreshed every minute so every server instance sees new ones.
let clips = new Map(), loadedAt = 0;
export async function loadClips() { clips = new Map((await all('SELECT k, id FROM voice_clips')).map(r => [r.k, r.id])); loadedAt = now(); return clips.size; }
export async function freshClips() { if (now() - loadedAt > 60e3) await loadClips().catch(() => {}); }
export const hasClip = k => clips.has(k);
export const clipCount = () => clips.size;

const missing = new Map();
async function noteMissing(k, english) {
  if (missing.get(k) > now() - 3600e3) return; // at most once an hour per piece
  missing.set(k, now());
  await run('INSERT INTO voice_missing (k, english, heard, last_at) VALUES (?,?,1,?) ON CONFLICT(k) DO UPDATE SET heard = heard + 1, last_at = excluded.last_at', k, english.slice(0, 300), now()).catch(() => {});
}

// TwiML for a text in Yiddish: <Play> for each recorded piece, English <Say> for the rest.
export function sayYiddish(text, { base, voice }) {
  const play = k => `<Play>${xml(`${base}/voice/yi/${clips.get(k)}`)}</Play>`;
  const say = t => `<Say voice="${xml(voice)}">${xml(t)}</Say>`;
  let out = '';
  for (const f of fragments(text)) {
    if (f.num != null) {
      const keys = numberAsKeys(f.num);
      if (keys.every(hasClip)) out += keys.map(play).join('');
      else { out += say(f.num); for (const k of keys.filter(k => !hasClip(k))) noteMissing(k, NUMBER_CLIPS[k] || k); }
    } else if (hasClip(f.k)) out += play(f.k);
    else { out += say(f.english); noteMissing(f.k, f.english); }
  }
  return out;
}

// ---------- storage and the admin list ----------
const MIME = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav' };
export async function saveClip(k, mime, base64) {
  k = k.startsWith('n:') || k.startsWith('w:') ? k : norm(k);
  if (!k || k.length > 300) throw Object.assign(new Error('Which piece is this recording for?'), { status: 400 });
  if (!MIME[mime]) throw Object.assign(new Error('Use an MP3 or WAV file (phones cannot play other formats)'), { status: 400 });
  const data = Buffer.from(String(base64 || ''), 'base64');
  if (data.length < 500 || data.length > 1.5e6) throw Object.assign(new Error('The recording must be between a moment and about a minute long (up to 1.5 MB)'), { status: 400 });
  await run('INSERT INTO voice_clips (k, id, mime, data, size, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET mime = excluded.mime, data = excluded.data, size = excluded.size, updated_at = excluded.updated_at', k, clipId(k), mime, data.toString('base64'), data.length, now());
  await run('DELETE FROM voice_missing WHERE k = ?', k);
  await loadClips();
  return { k, id: clipId(k) };
}
export async function deleteClip(k) { await run('DELETE FROM voice_clips WHERE k = ?', k); await loadClips(); }
export async function clipById(id) { const r = await one('SELECT mime, data FROM voice_clips WHERE id = ?', String(id)); return r && { mime: r.mime, data: Buffer.from(r.data, 'base64') }; }

export async function clipList() {
  await loadClips();
  const rec = new Map((await all('SELECT k, id, size, updated_at FROM voice_clips')).map(r => [r.k, r]));
  const row = (k, english, yi) => ({ k, english, yi: yi || '', id: rec.get(k)?.id || null, updatedAt: rec.get(k)?.updated_at || null });
  const heard = await all('SELECT k, english, heard, last_at FROM voice_missing ORDER BY heard DESC LIMIT 200');
  return {
    numbers: Object.entries(NUMBER_CLIPS).map(([k, yi]) => row(k, k.replace(/^n:(\d+)c$/, '$1 (in compounds)').replace(/^[nw]:/, ''), yi)),
    sentences: Object.entries(SCRIPT).map(([k, yi]) => row(k, k, yi)),
    heard: heard.filter(h => !SCRIPT[h.k] && !NUMBER_CLIPS[h.k]).map(h => ({ ...row(h.k, h.english), heard: h.heard, lastAt: h.last_at })),
    other: [...rec.keys()].filter(k => !SCRIPT[k] && !NUMBER_CLIPS[k] && !heard.some(h => h.k === k)).map(k => row(k, k)),
    recorded: rec.size,
  };
}
