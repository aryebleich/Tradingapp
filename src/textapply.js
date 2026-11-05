// Open a brokerage account by text message. Anyone who texts the business number (and any
// customer who texts APPLY) is walked through Alpaca's application one question at a time:
//   photos     a photo of the ID and of the Social Security card (MMS); NO ID / NO CARD to skip
//   fullid     when the ID photo is cropped: a photo of the whole card (SKIP)
//   details    whatever the photos did not show: name, date of birth, address, SSN, one by one
//   email      where Alpaca sends account documents
//   confirm    1 all correct / 2 something is wrong (then which part, and it is asked again)
//   disclose   the required disclosure questions (none true / one is true → finish in the app)
//   job        employment status (and employer and title when employed)
//   married    1 yes → a photo of the spouse's Social Security card (their name becomes the
//              trusted contact, with their phone) / 2 no
//   agree      AGREE to the Alpaca Customer Agreement, then the application goes to Alpaca
// CONTINUE re-sends the current question, RESTART starts over, CANCEL deletes everything.
//
// Privacy: answers are kept encrypted (AES-256-GCM) only while the application is open, at most
// 7 days, and deleted the moment it is sent to Alpaca or cancelled. The Social Security card photo
// is read and thrown away at once; only the ID photo is kept, to send to Alpaca with the
// application. Photos are read by the AI only when the owner allows it (Admin → Calls, texts &
// email → Apply by text), by default with Claude only; otherwise the details are asked by text.
import { one, run, now, audit } from './db.js';
import { encrypt, tryDecrypt, randomToken } from './crypto.js';
import { siteGet, siteSet, normalizePhone } from './site.js';
import * as B from './alpaca/broker.js';

export const DEFAULTS = { enabled: true, aiRead: true, aiAnyProvider: false };
export const settings = () => ({ ...DEFAULTS, ...(siteGet('textApply', {}) || {}) });
export async function saveSettings(b = {}) {
  const out = { ...settings() };
  for (const k of Object.keys(DEFAULTS)) if (k in b) out[k] = !!b[k];
  await siteSet('textApply', out);
  return out;
}
const KEEP_MS = 7 * 864e5;
const AGREEMENT = 'https://files.alpaca.markets/disclosures/library/AcctAppMarginAndCustAgmt.pdf';
const US = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR'];

export const TEXT = {
  welcome: 'Welcome to Brightolio - apply by text.\nTo apply, have ready: (1) a clear photo of your ID (driver\'s license, state ID, US passport or passport card), and (2) a clear photo of your Social Security card. If you are married, we will also ask for a photo of your spouse\'s Social Security card later.\nPlease text the photos now (they can be in one message or separate). No ID? Reply NO ID. No Social Security card? Reply NO CARD.\nAlready started an application? Reply CONTINUE to pick up where you left off.\nReply RESTART at any time to start over.',
  both: 'Got your Social Security card and ID.',
  gotId: 'Got your ID. Now please text a clear photo of your Social Security card. No card? Reply NO CARD.',
  gotCard: 'Got your Social Security card. Now please text a clear photo of your ID. No ID? Reply NO ID.',
  photos: 'Please text a clear photo of your ID and of your Social Security card. No ID? Reply NO ID. No Social Security card? Reply NO CARD.',
  unclear: 'We could not tell what that photo shows. Please text a clear photo of your ID or Social Security card, flat on a table, with no glare.',
  fullId: 'Thank you, we could read your ID. For our records we also need a clear photo of the FULL ID - the whole card with all four corners visible, flat on a table, no glare. Please text it now. If you can\'t, reply SKIP.',
  someDetails: 'We could not read everything from the photos, so we need a few details.',
  fewDetails: 'We need a few details.',
  givenName: 'What is your first name (as on your ID)?',
  familyName: 'What is your last name (as on your ID)?',
  dateOfBirth: 'What is your date of birth? (MM/DD/YYYY)',
  street: 'What is your street address (number and street, plus apt if any)?',
  city: 'What city?',
  state: 'What state? (2 letters, like NY)',
  postalCode: 'What is your 5-digit ZIP code?',
  ssn: 'What is your 9-digit Social Security number?',
  email: 'What is your email address? Alpaca, the brokerage that holds the account, sends your statements there.',
  whatWrong: 'What is wrong? Reply with the NUMBER:\n1. Name\n2. Date of birth\n3. Address\n4. SSN',
  disclose: 'Required questions. Is ANY of these true?\n- You or a family member work for a stock exchange or a FINRA member firm\n- You are a director, 10% owner or policy-making officer of a public company\n- You or a family member hold a senior political office\n1. None of these is true\n2. One or more is true\nReply with the NUMBER 1 or 2.',
  job: 'What is your work status? Reply with the NUMBER:\n1. Employed or self-employed\n2. Not working\n3. Student\n4. Retired',
  employer: 'Who is your employer? (For self-employed, your business name.)',
  position: 'What is your job title?',
  married: 'Are you married?\n1. Yes\n2. No\nReply with the NUMBER 1 or 2.',
  spouseCard: 'Please text a clear photo of your spouse\'s Social Security card. We list your spouse as your trusted contact (someone the brokerage may call if it cannot reach you). If you can\'t, reply SKIP.',
  spouseName: 'What is your spouse\'s full name?',
  spousePhone: 'What is your spouse\'s phone number? Reply SKIP to leave it out.',
  agree: `Last step. Please read the Alpaca Customer Agreement: ${AGREEMENT}\nReply AGREE to accept it and send your application.`,
  number12: 'Reply with the NUMBER 1 or 2.',
  restart: 'Your application was cleared. Let\'s start over.',
  cancelled: 'Your application was cancelled and everything you sent was deleted. Text us any time to start again.',
  none: 'We could not find an application in progress for this number, so let\'s start.',
  closed: 'Opening an account by text is not available right now. Please apply in the Brightolio app.',
  inApp: 'Thank you. Because one of those is true, the brokerage needs a few more details that we cannot take by text. Please finish your application in the Brightolio app under Open an account. Your answers here are deleted.',
};

// ---------- the stored application ----------
async function load(phone) {
  const r = await one('SELECT data, updated_at FROM text_applications WHERE phone = ?', phone);
  if (!r || r.updated_at < now() - KEEP_MS) return null;
  return tryDecrypt(r.data, 'text application');
}
async function save(phone, a) {
  await run('INSERT INTO text_applications (phone, data, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(phone) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', phone, encrypt(a), now(), now());
}
const drop = phone => run('DELETE FROM text_applications WHERE phone = ?', phone);
export const purgeOld = () => run('DELETE FROM text_applications WHERE updated_at < ?', now() - KEEP_MS);
export const hasOpen = async phone => !!(await load(normalizePhone(phone)));
const fresh = () => ({ step: 'photos', f: {}, seen: {}, photos: 0 });

// ---------- reading the photos ----------
// The reader can be swapped in tests. It returns what one photo shows.
let reader = aiRead;
export const setReader = fn => { reader = fn || aiRead; };
const READ_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'idType', 'fullCardVisible', 'givenName', 'middleName', 'familyName', 'dateOfBirth', 'street', 'unit', 'city', 'state', 'postalCode', 'ssn'],
  properties: {
    kind: { type: 'string', enum: ['id', 'ssn_card', 'other'], description: 'id = driver\'s license, state ID, passport or passport card; ssn_card = US Social Security card' },
    idType: { type: 'string', enum: ['drivers_license', 'state_id', 'passport', 'none'] },
    fullCardVisible: { type: 'boolean', description: 'all four corners of the card or passport page are in the photo' },
    givenName: { type: 'string' }, middleName: { type: 'string' }, familyName: { type: 'string' },
    dateOfBirth: { type: 'string', description: 'YYYY-MM-DD or empty' },
    street: { type: 'string' }, unit: { type: 'string' }, city: { type: 'string' }, state: { type: 'string', description: '2-letter code' }, postalCode: { type: 'string' },
    ssn: { type: 'string', description: '9 digits on a Social Security card, else empty' },
  },
};
export function aiReady() {
  const s = settings();
  if (!s.aiRead) return false;
  const k = process.env;
  if (k.ANTHROPIC_API_KEY && (!k.AI_PROVIDER || k.AI_PROVIDER === 'anthropic')) return true;
  return s.aiAnyProvider && !!(k.GEMINI_API_KEY || k.OPENROUTER_API_KEY || k.AI_BASE_URL);
}
async function aiRead({ b64, mime }) {
  if (!aiReady()) return null;
  const system = 'You read US identity documents for a brokerage application. Read only what is printed; leave a field empty when it is not clearly readable. Never guess.';
  const ask = 'What does this photo show? Read the fields.';
  if (process.env.ANTHROPIC_API_KEY && (!process.env.AI_PROVIDER || process.env.AI_PROVIDER === 'anthropic')) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const res = await new Anthropic().messages.create({
      model: 'claude-opus-5-5', max_tokens: 800, system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: READ_SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }, { type: 'text', text: ask }] }],
    });
    if (res.stop_reason === 'refusal') return null;
    return JSON.parse(res.content.find(b => b.type === 'text').text);
  }
  // OpenAI-compatible vision (Gemini, OpenRouter, a local model), only when the owner allows it.
  const { provider, parseJson } = await import('./llm.js');
  const p = provider(); if (!p?.base) return null;
  const r = await fetch(`${p.base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
    body: JSON.stringify({ model: p.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: `${system}\nAnswer with one JSON object matching: ${JSON.stringify(READ_SCHEMA)}` }, { role: 'user', content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }] }),
  });
  const d = await r.json().catch(() => ({}));
  return r.ok ? parseJson(d.choices?.[0]?.message?.content) : null;
}
// Photos come from Twilio's media store (and nowhere else), at most 5 MB each.
async function download(url) {
  const allowed = [new URL(process.env.TWILIO_API_URL || 'https://api.twilio.com').host, 'api.twilio.com'];
  const u = new URL(url);
  if (u.protocol !== 'https:' && !process.env.TWILIO_API_URL) throw new Error('bad media url');
  if (!allowed.includes(u.host)) throw new Error('bad media url');
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  const r = await fetch(url, { headers: sid && tok ? { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') } : {}, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!r.ok) throw new Error('media ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > B.MAX_DOC_BYTES) throw new Error('too big');
  return { b64: buf.toString('base64'), mime: (r.headers.get('content-type') || '').split(';')[0] };
}

// ---------- checking typed answers ----------
const clean = s => String(s || '').trim().replace(/\s+/g, ' ');
const CHECK = {
  givenName: v => (/^[A-Za-z][A-Za-z' .-]{0,49}$/.test(v) ? v : null),
  familyName: v => (/^[A-Za-z][A-Za-z' .-]{0,49}$/.test(v) ? v : null),
  dateOfBirth: v => { const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v); if (!m) return null; const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; const d = new Date(iso + 'T12:00:00Z'); const age = (Date.now() - d) / (365.25 * 864e5); return !isNaN(d) && d.toISOString().slice(0, 10) === iso && age >= 18 && age < 120 ? iso : null; },
  street: v => (/\d/.test(v) && v.length >= 4 && v.length <= 100 ? v : null),
  city: v => (/^[A-Za-z][A-Za-z .'-]{1,49}$/.test(v) ? v : null),
  state: v => (US.includes(v.toUpperCase()) ? v.toUpperCase() : null),
  postalCode: v => (/^\d{5}$/.test(v) ? v : null),
  ssn: v => { const d = v.replace(/\D/g, ''); return /^\d{9}$/.test(d) && !/^(000|666|9)/.test(d) ? d : null; },
  email: v => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length < 120 ? v.toLowerCase() : null),
  employer: v => (v.length >= 2 && v.length <= 80 ? v : null),
  position: v => (v.length >= 2 && v.length <= 80 ? v : null),
  spouseName: v => (/^[A-Za-z][A-Za-z' .-]{2,80}$/.test(v) && v.includes(' ') ? v : null),
  spousePhone: v => { const p = normalizePhone(v); return /^\+\d{10,15}$/.test(p) ? p : null; },
};
const RETRY = {
  givenName: 'Please reply with your first name only, letters only.', familyName: 'Please reply with your last name only, letters only.',
  dateOfBirth: 'Please reply with your date of birth like 04/27/1990. You must be at least 18.', street: 'Please reply with your house number and street, like 12 Main St Apt 3.',
  city: 'Please reply with the city name.', state: 'Please reply with the 2-letter state code, like NY or NJ.', postalCode: 'Please reply with the 5-digit ZIP code, like 10950.',
  ssn: 'Please reply with the 9 digits of your Social Security number.', email: 'Please reply with a valid email address, like name@example.com.',
  employer: 'Please reply with the employer\'s name.', position: 'Please reply with your job title.', spouseName: 'Please reply with your spouse\'s first and last name.',
  spousePhone: 'Please reply with a 10-digit phone number, or SKIP.',
};
const DETAILS = ['givenName', 'familyName', 'dateOfBirth', 'street', 'city', 'state', 'postalCode', 'ssn'];
const missing = a => DETAILS.filter(k => !a.f[k]);
const mmdd = iso => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : '-');
export const summary = a => `Please check what we have:\nName: ${[a.f.givenName, a.f.middleName, a.f.familyName].filter(Boolean).join(' ').toUpperCase()}\nDate of birth: ${mmdd(a.f.dateOfBirth)}\nAddress: ${[a.f.street, a.f.unit].filter(Boolean).join(' ').toUpperCase()}, ${String(a.f.city || '').toUpperCase()}, ${a.f.state} ${a.f.postalCode}\nSSN: xxx-xx-${String(a.f.ssn || '').slice(-4)}\n1. All correct\n2. Something is wrong\nReply with the NUMBER 1 or 2.`;

// What to ask next once the photos are done (or skipped).
function next(a, lead = '') {
  const join = (...x) => x.filter(Boolean).join('\n');
  if (a.step === 'photos' || a.step === 'fullid') {
    if (a.idRead && a.idPartial && !a.seen.fullid) { a.step = 'fullid'; a.seen.fullid = 1; return join(lead, TEXT.fullId); }
    a.step = 'details';
  }
  if (a.step === 'details') {
    const m = missing(a);
    if (m.length) { a.ask = m[0]; const intro = a.seen.intro ? '' : (a.photos ? TEXT.someDetails : TEXT.fewDetails); a.seen.intro = 1; return join(lead, intro, TEXT[m[0]]); }
    a.step = a.f.email ? 'confirm' : 'email';
    if (a.step === 'email') { a.ask = 'email'; return join(lead, TEXT.email); }
  }
  if (a.step === 'email' && a.f.email) a.step = 'confirm';
  if (a.step === 'confirm') return join(lead, summary(a));
  return join(lead, TEXT[a.step] || '');
}
const prompt = a => {
  if (a.step === 'photos') return TEXT.photos;
  if (a.step === 'fullid') return TEXT.fullId;
  if (a.step === 'details' || a.step === 'email' || a.step === 'fix') return TEXT[a.ask] || next(a);
  if (a.step === 'confirm') return summary(a);
  if (a.step === 'jobDetail') return TEXT[a.ask];
  if (a.step === 'spouse') return TEXT[a.ask] || TEXT.spouseCard;
  return TEXT[a.step] || TEXT.photos;
};

// ---------- the conversation ----------
// Starts or continues an application; returns the reply text. `media` = [{ url, type }].
export async function handle(fromRaw, bodyRaw, media = [], meta = {}) {
  const phone = normalizePhone(fromRaw), body = clean(bodyRaw), word = body.toUpperCase();
  if (!settings().enabled || !B.brokerEnabled()) return TEXT.closed;
  let a = await load(phone);
  if (word === 'CANCEL') { await drop(phone); return TEXT.cancelled; }
  if (word === 'RESTART') { a = fresh(); await save(phone, a); return `${TEXT.restart}\n${TEXT.welcome}`; }
  if (!a) {
    a = fresh(); await save(phone, a);
    if (word === 'CONTINUE') return `${TEXT.none}\n${TEXT.welcome}`;
    if (!media.length) return TEXT.welcome;
  }
  if (word === 'CONTINUE' && !media.length) return prompt(a);
  const reply = await step(a, phone, body, word, media, meta);
  if (a.done) await drop(phone); else await save(phone, a);
  return reply;
}

async function readPhotos(a, media) {
  let id = false, card = false, unclear = 0;
  for (const m of media.slice(0, 4)) {
    let img; try { img = await download(m.url); } catch (e) { console.warn('text apply media', e.message); unclear++; continue; }
    if (!/^image\//.test(img.mime)) { unclear++; continue; }
    let r = null; try { r = await reader(img); } catch (e) { console.warn('text apply read', e.message); }
    const kind = r?.kind || (a.step === 'spouse' ? 'ssn_card' : !a.got?.id ? 'id' : !a.got?.card ? 'ssn_card' : 'other');
    a.got ||= {};
    if (a.step === 'spouse') {
      if (kind !== 'ssn_card') { unclear++; continue; }
      const n = [r?.givenName, r?.familyName].filter(Boolean).join(' ');
      if (n) a.spouse = { name: n };
      card = true; continue;
    }
    if (kind === 'id') {
      id = true; a.got.id = 1; a.photos++;
      // The ID photo is kept for Alpaca (JPG or PNG only); a later, fuller photo replaces it.
      if (['image/jpeg', 'image/png'].includes(img.mime)) a.doc = { content: img.b64, mimeType: img.mime, subType: r?.idType && r.idType !== 'none' ? r.idType : 'drivers_license' };
      if (r) {
        a.idRead = true; a.idPartial = !r.fullCardVisible;
        for (const k of ['givenName', 'middleName', 'familyName', 'street', 'unit', 'city']) if (r[k] && !a.f[k]) a.f[k] = clean(r[k]);
        const dob = r.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(r.dateOfBirth) ? CHECK.dateOfBirth(mmdd(r.dateOfBirth)) : null; if (dob && !a.f.dateOfBirth) a.f.dateOfBirth = dob;
        const st = r.state && CHECK.state(r.state); if (st && !a.f.state) a.f.state = st;
        const z = r.postalCode && String(r.postalCode).slice(0, 5); if (z && CHECK.postalCode(z) && !a.f.postalCode) a.f.postalCode = z;
        for (const k of ['givenName', 'familyName', 'city']) if (a.f[k] && !CHECK[k](a.f[k])) delete a.f[k];
        if (a.f.street && !CHECK.street(a.f.street)) delete a.f.street;
      }
    } else if (kind === 'ssn_card') {
      // Read and thrown away: the card photo is never stored.
      card = true; a.got.card = 1; a.photos++;
      const s = r?.ssn && CHECK.ssn(r.ssn); if (s) a.f.ssn = s;
      if (r && !a.f.givenName && r.givenName && CHECK.givenName(clean(r.givenName))) a.f.givenName = clean(r.givenName);
      if (r && !a.f.familyName && r.familyName && CHECK.familyName(clean(r.familyName))) a.f.familyName = clean(r.familyName);
    } else unclear++;
  }
  return { id, card, unclear };
}

async function step(a, phone, body, word, media, meta) {
  const num = /^[1-9]$/.test(body) ? +body : null;
  // Photos: the ID and the card (in any order, together or apart).
  if (a.step === 'photos') {
    if (media.length) {
      const r = await readPhotos(a, media);
      if (!r.id && !r.card) return TEXT.unclear;
    }
    if (word === 'NO ID') a.noId = 1;
    if (word === 'NO CARD') a.noCard = 1;
    const haveId = a.got?.id || a.noId, haveCard = a.got?.card || a.noCard;
    if (haveId && haveCard) return next(a, a.got?.id && a.got?.card ? TEXT.both : '');
    if (a.got?.id && !haveCard) return TEXT.gotId;
    if (a.got?.card && !haveId) return TEXT.gotCard;
    if (a.noId && !haveCard) return 'OK. Now please text a clear photo of your Social Security card. No card? Reply NO CARD.';
    if (a.noCard && !haveId) return 'OK. Now please text a clear photo of your ID. No ID? Reply NO ID.';
    return TEXT.photos;
  }
  if (a.step === 'fullid') {
    if (media.length) { const r = await readPhotos(a, media); if (!r.id) return 'That did not look like the ID. ' + TEXT.fullId; return next(a, 'Thank you.'); }
    if (word === 'SKIP') return next(a);
    return TEXT.fullId;
  }
  if (a.step === 'details' || a.step === 'email' || a.step === 'fix') {
    const k = a.ask, v = CHECK[k]?.(body);
    if (!v) return RETRY[k] || prompt(a);
    a.f[k] = v;
    if (k === 'street') { const m = /^(.*?)\s+((?:apt|apartment|unit|ste|suite|#)\s*\S+)$/i.exec(v); if (m) { a.f.street = m[1]; a.f.unit = m[2].replace(/^(apartment|apt)\s*/i, '#').replace(/^#\s*/, '#'); } else delete a.f.unit; }
    if (a.step === 'fix') {
      const q = a.queue.shift();
      if (q) { a.ask = q; return TEXT[q]; }
      a.step = 'confirm'; return summary(a);
    }
    return next(a);
  }
  if (a.step === 'confirm') {
    if (num === 1) { a.step = 'disclose'; return TEXT.disclose; }
    if (num === 2) { a.step = 'whatWrong'; return TEXT.whatWrong; }
    return summary(a);
  }
  if (a.step === 'whatWrong') {
    const fields = { 1: ['givenName', 'familyName'], 2: ['dateOfBirth'], 3: ['street', 'city', 'state', 'postalCode'], 4: ['ssn'] }[num];
    if (!fields) return TEXT.whatWrong;
    a.queue = fields.slice(1); a.ask = fields[0]; a.step = 'fix';
    if (num === 1) delete a.f.middleName;
    return TEXT[a.ask];
  }
  if (a.step === 'disclose') {
    if (num === 1) { a.step = 'job'; return TEXT.job; }
    if (num === 2) { a.done = true; await audit(null, 'text_apply_to_app', { reason: 'disclosure' }, phone); return TEXT.inApp; }
    return TEXT.disclose;
  }
  if (a.step === 'job') {
    const s = { 1: 'employed', 2: 'unemployed', 3: 'student', 4: 'retired' }[num];
    if (!s) return TEXT.job;
    a.f.employmentStatus = s;
    if (s === 'employed') { a.step = 'jobDetail'; a.ask = 'employer'; return TEXT.employer; }
    a.step = 'married'; return TEXT.married;
  }
  if (a.step === 'jobDetail') {
    const v = CHECK[a.ask](body); if (!v) return RETRY[a.ask];
    a.f[a.ask === 'employer' ? 'employerName' : 'employmentPosition'] = v;
    if (a.ask === 'employer') { a.ask = 'position'; return TEXT.position; }
    a.step = 'married'; return TEXT.married;
  }
  if (a.step === 'married') {
    if (num === 1) { a.step = 'spouse'; a.ask = 'spouseCard'; return TEXT.spouseCard; }
    if (num === 2) { a.step = 'agree'; return TEXT.agree; }
    return TEXT.married;
  }
  if (a.step === 'spouse') {
    if (a.ask === 'spouseCard') {
      if (media.length) {
        const r = await readPhotos(a, media);
        if (!r.card) return 'That did not look like a Social Security card. ' + TEXT.spouseCard;
        if (!a.spouse?.name) { a.ask = 'spouseName'; return `Got it. ${TEXT.spouseName}`; }
        a.ask = 'spousePhone'; return `Got it. ${TEXT.spousePhone}`;
      }
      if (word === 'SKIP') { a.step = 'agree'; return TEXT.agree; }
      return TEXT.spouseCard;
    }
    if (a.ask === 'spouseName') { const v = CHECK.spouseName(body); if (!v) return RETRY.spouseName; a.spouse = { name: v }; a.ask = 'spousePhone'; return TEXT.spousePhone; }
    if (a.ask === 'spousePhone') {
      if (word !== 'SKIP') { const v = CHECK.spousePhone(body); if (!v) return RETRY.spousePhone; a.spouse.phone = v; }
      a.step = 'agree'; return TEXT.agree;
    }
  }
  if (a.step === 'agree') {
    if (word !== 'AGREE' && word !== 'I AGREE') return TEXT.agree;
    return submit(a, phone, meta);
  }
  return prompt(a);
}

// Sends the application to Alpaca and links it to the Brightolio account for this phone number
// (made now when the number has none). Everything stored for the application is then deleted.
async function submit(a, phone, meta) {
  const { userByPhone } = await import('./commands.js');
  const { createUser } = await import('./auth.js');
  const { applyStatus, adoptAccount } = await import('./alpaca/kyc.js');
  let u = await userByPhone(phone);
  if (u && await one('SELECT 1 FROM broker_accounts WHERE user_id = ?', u.id)) { a.done = true; return 'This phone number already has a brokerage account. Sign in to the Brightolio app to see it.'; }
  const f = a.f;
  const form = {
    givenName: f.givenName, middleName: f.middleName, familyName: f.familyName, dateOfBirth: f.dateOfBirth, ssn: f.ssn, email: f.email, phone,
    street: f.street, unit: f.unit, city: f.city, state: f.state, postalCode: f.postalCode, citizenship: 'USA', agreeCustomer: true,
    employmentStatus: f.employmentStatus, employerName: f.employerName, employmentPosition: f.employmentPosition,
    documents: a.doc ? [a.doc] : [],
  };
  let body;
  try { body = B.buildAccountRequest(form, meta.ip); } catch (e) { a.step = 'confirm'; return `${e.message}. ${summary(a)}`; }
  // The spouse becomes the trusted contact when we have a way to reach them.
  if (a.spouse?.name && a.spouse.phone) {
    const [given, ...rest] = a.spouse.name.split(' ');
    body.trusted_contact = { given_name: given, family_name: rest.join(' ') || given, phone_number: a.spouse.phone };
  }
  let acct;
  try { acct = await B.createAccount(body); } catch (e) {
    console.warn('text apply submit', e.message);
    return 'Sorry, the brokerage could not take the application right now. Reply AGREE in a few minutes to try again, or apply in the Brightolio app.';
  }
  if (!u) {
    const id = await createUser({ email: `p${phone.replace(/\D/g, '')}.${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}@phone.invalid` });
    await run('UPDATE users SET phone = NULL WHERE phone = ? AND phone_verified = 0', phone);
    await run('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', phone, id);
    u = { id };
  }
  await run('INSERT INTO broker_accounts (user_id, account_id, account_number, status, crypto_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', u.id, acct.id, acct.account_number, acct.status, acct.crypto_status ?? null, now(), now());
  await applyStatus(acct.id, { to: acct.status, source: 'created' });
  await adoptAccount(acct.id);
  await run("UPDATE users SET alpaca_conn = 'broker' WHERE id = ?", u.id);
  await audit(u.id, 'broker_account_created', { via: 'text', status: acct.status, documents: body.documents?.length || 0 }, phone);
  a.done = true;
  const info = B.statusInfo(acct.status), base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return `Thank you! Your application was sent. ${info.title}. We will text you when it changes.\nSign in to the app with this phone number to fund the account: ${base}/app#/login-phone`;
}
