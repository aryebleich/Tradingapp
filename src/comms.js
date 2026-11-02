// Business calls, texts and email in one inbox (Admin → Calls, texts & email):
//  - texts to the company number from people who are not customers (customers' texts stay
//    commands); the AI can answer them for the owner when switched on;
//  - calls: a caller who presses 9 (or anyone, when "forward all calls" is on) is put through to
//    the owner's phone; if nobody answers, a voicemail is recorded and transcribed into the inbox;
//  - email: messages from the contact form, and any email service that can forward incoming mail
//    to a webhook (SendGrid Inbound Parse, Mailgun routes, Cloudflare Email Workers, Postmark);
//  - replies by text or email from the inbox, with an AI-written draft to edit, or automatic
//    AI replies for texts and email when the owner switches them on.
import express from 'express';
import crypto from 'node:crypto';
import { one, all, run, now, audit } from './db.js';
import { requireUser, requireAdmin } from './auth.js';
import { siteGet, siteSet, normalizePhone } from './site.js';
import * as N from './notify.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const DEFAULTS = { forwardTo: '', forwardAll: false, ringSeconds: 20, voicemailGreeting: 'Thank you for calling Brightfolio. Please leave a message after the tone and we will call you back.', aiSms: false, aiEmail: false, notes: '', emailToken: '' };
export const settings = () => ({ ...DEFAULTS, ...(siteGet('comms', {}) || {}) });
export async function saveSettings(b = {}) {
  const cur = settings(), out = { ...cur };
  if ('forwardTo' in b) out.forwardTo = b.forwardTo ? normalizePhone(String(b.forwardTo)) : '';
  if (out.forwardTo && !/^\+\d{10,15}$/.test(out.forwardTo)) throw bad('Enter the forwarding phone with country code, like +18455551234');
  for (const k of ['forwardAll', 'aiSms', 'aiEmail']) if (k in b) out[k] = !!b[k];
  if ('ringSeconds' in b) out.ringSeconds = Math.min(60, Math.max(5, Math.round(+b.ringSeconds || 20)));
  if ('voicemailGreeting' in b) out.voicemailGreeting = String(b.voicemailGreeting || '').replace(/[<>&]/g, '').slice(0, 300) || DEFAULTS.voicemailGreeting;
  if ('notes' in b) out.notes = String(b.notes || '').slice(0, 4000);
  if (!out.emailToken || b.newToken) out.emailToken = crypto.randomBytes(18).toString('base64url');
  await siteSet('comms', out);
  return out;
}

export async function record(m) {
  const id = Number((await run('INSERT INTO comms (channel, direction, party, name, subject, body, media, duration, status, at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    m.channel, m.direction || 'in', String(m.party || '').slice(0, 200), m.name ? String(m.name).slice(0, 100) : null, m.subject ? String(m.subject).slice(0, 200) : null, String(m.body || '').slice(0, 10000), m.media || null, m.duration || null, m.direction === 'out' ? 'done' : 'open', now())).lastInsertRowid);
  return id;
}

// The AI's reply in the business's voice, from the owner's notes; never trades or gives advice.
export async function draft(msg, history = []) {
  const { llmEnabled, jsonCall } = await import('./llm.js');
  if (!llmEnabled()) throw bad('Set up an AI provider in Admin → AI & privacy to get drafts', 503);
  const s = settings();
  const r = await jsonCall({
    system: `You answer customer ${msg.channel === 'email' ? 'emails' : 'text messages'} for Brightfolio, a software app for investing and trading on the customer's own brokerage account (it is not a broker and gives no investment advice). Be brief, warm and accurate. Use only the facts below and in the message; if you do not know, say the team will follow up. Never promise returns, never give investment, tax or legal advice, never ask for passwords or full account numbers.${msg.channel === 'sms' ? ' Keep it under 300 characters.' : ''}\n\nFacts from the owner:\n${s.notes || '(none yet)'}`,
    user: `${history.length ? `Earlier in this conversation:\n${history.map(h => `${h.direction === 'in' ? 'Customer' : 'Us'}: ${h.body}`).join('\n')}\n\n` : ''}New message${msg.subject ? ` (subject: ${msg.subject})` : ''} from ${msg.name || msg.party}:\n${msg.body}`,
    schema: { type: 'object', additionalProperties: false, required: ['reply', 'needsHuman'], properties: { reply: { type: 'string' }, needsHuman: { type: 'boolean', description: 'true when a person should look at it (complaint, account problem, anything you could not answer)' } } },
    maxTokens: 700,
  });
  return { reply: String(r.reply || '').slice(0, msg.channel === 'sms' ? 600 : 5000), needsHuman: !!r.needsHuman };
}
async function thread(channel, party, limit = 8) { return (await all('SELECT direction, body FROM comms WHERE channel IN (?, ?) AND party = ? ORDER BY id DESC LIMIT ?', channel, channel === 'call' ? 'voicemail' : channel, party, limit)).reverse(); }

// An incoming text from someone who is not a customer. Returns the text to send back.
export async function inboundSms(from, body) {
  const party = normalizePhone(from), id = await record({ channel: 'sms', party, body });
  const s = settings();
  if (s.aiSms) {
    try {
      const d = await draft({ channel: 'sms', party, body }, (await thread('sms', party)).slice(0, -1));
      await record({ channel: 'sms', direction: 'out', party, body: d.reply });
      if (!d.needsHuman) await run("UPDATE comms SET status = 'done' WHERE id = ?", id);
      return d.reply;
    } catch (e) { console.warn('comms ai sms', e.message); }
  }
  return 'Thanks for your message to Brightfolio. We will get back to you soon. Customers: add this number in the app under Settings > Phone to trade and ask by text.';
}
export async function inboundEmail({ from, name, subject, text }) {
  const party = String(from || '').toLowerCase().match(/[^<\s]+@[^>\s]+/)?.[0];
  if (!party) throw bad('No sender');
  const id = await record({ channel: 'email', party, name, subject, body: text });
  const s = settings();
  if (s.aiEmail) {
    try {
      const d = await draft({ channel: 'email', party, name, subject, body: text });
      if (!d.needsHuman) { await N.sendEmail(party, `Re: ${subject || 'your message'}`, d.reply); await record({ channel: 'email', direction: 'out', party, subject: `Re: ${subject || ''}`, body: d.reply }); await run("UPDATE comms SET status = 'done' WHERE id = ?", id); }
    } catch (e) { console.warn('comms ai email', e.message); }
  }
  return id;
}

// ---------- calls ----------
export function forwardTwiml(base) {
  const s = settings();
  if (!s.forwardTo) return null;
  return `<Dial timeout="${s.ringSeconds}" action="${N.xml(`${base}/twilio/voice/comms/after-dial`)}" method="POST" record="do-not-record">${N.xml(s.forwardTo)}</Dial>`;
}
export function registerCalls(app, { twilioOk, twiml }) {
  const base = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  app.post('/twilio/voice/comms/after-dial', async (req, res) => {
    if (!twilioOk(req)) return res.status(403).send('forbidden');
    const st = req.body.DialCallStatus, from = normalizePhone(req.body.From || '');
    if (st === 'completed') { await record({ channel: 'call', party: from, body: `Answered call, ${req.body.DialCallDuration || 0} seconds`, duration: +req.body.DialCallDuration || null }); await run("UPDATE comms SET status = 'done' WHERE id = (SELECT MAX(id) FROM comms)"); return twiml(res, '<Hangup/>'); }
    const s = settings();
    twiml(res, `<Say>${N.xml(s.voicemailGreeting)}</Say><Record maxLength="180" playBeep="true" transcribe="true" transcribeCallback="${N.xml(`${base()}/twilio/voice/comms/transcript`)}" action="${N.xml(`${base()}/twilio/voice/comms/recorded`)}" method="POST"/><Say>We did not get a message. Goodbye.</Say>`);
  });
  app.post('/twilio/voice/comms/recorded', async (req, res) => {
    if (!twilioOk(req)) return res.status(403).send('forbidden');
    await record({ channel: 'voicemail', party: normalizePhone(req.body.From || ''), body: '(transcribing…)', media: req.body.RecordingUrl ? String(req.body.RecordingUrl) : null, duration: +req.body.RecordingDuration || null });
    if (process.env.ADMIN_EMAIL) N.sendEmail(process.env.ADMIN_EMAIL, 'New voicemail on the Brightfolio line', `From ${req.body.From}. Listen in Admin → Calls, texts & email.`).catch(() => {});
    twiml(res, '<Say>Thank you. Goodbye.</Say><Hangup/>');
  });
  app.post('/twilio/voice/comms/transcript', async (req, res) => {
    if (!twilioOk(req)) return res.status(403).send('forbidden');
    const url = String(req.body.RecordingUrl || '');
    if (url) await run("UPDATE comms SET body = ? WHERE channel = 'voicemail' AND media = ?", String(req.body.TranscriptionText || '(no transcription)').slice(0, 5000), url);
    res.sendStatus(204);
  });
  // Inbound email from a forwarding service: JSON or form fields from, to, subject, text.
  app.post('/hooks/email/inbound', express.urlencoded({ extended: false, limit: '1mb' }), async (req, res) => {
    const s = settings();
    if (!s.emailToken || !crypto.timingSafeEqual(Buffer.from(String(req.query.token || '').padEnd(64)), Buffer.from(s.emailToken.padEnd(64)))) return res.status(401).json({ error: 'bad token' });
    const b = req.body || {};
    await inboundEmail({ from: b.from || b.sender || b.From, name: b.fromName || null, subject: b.subject || b.Subject, text: b.text || b['body-plain'] || b.TextBody || b.plain || String(b.html || '').replace(/<[^>]+>/g, ' ') });
    res.json({ ok: true });
  });
}

// ---------- admin ----------
export const commsAdminRouter = (() => {
  const r = express.Router();
  r.use(requireUser, requireAdmin);
  r.get('/', async (req, res) => {
    const ch = ['sms', 'email', 'call', 'voicemail', 'form'].includes(req.query.channel) ? req.query.channel : null, status = req.query.status === 'all' ? null : 'open';
    let items = ch === 'form' ? [] : (await all(`SELECT * FROM comms WHERE 1 = 1 ${ch ? 'AND channel = ?' : ''} ${status ? "AND status = 'open'" : ''} ORDER BY id DESC LIMIT 200`, ...(ch ? [ch] : [])));
    if (!ch || ch === 'form') items = [...items, ...(await all(`SELECT id, name, email, subject, body, status, at FROM messages ${status ? "WHERE status = 'open'" : ''} ORDER BY id DESC LIMIT 100`)).map(m => ({ id: 'f' + m.id, channel: 'form', direction: 'in', party: m.email, name: m.name, subject: m.subject, body: m.body, status: m.status, at: m.at }))].sort((a, b) => b.at - a.at);
    const s = settings(), base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const counts = Object.fromEntries((await all("SELECT channel, COUNT(*) n FROM comms WHERE status = 'open' GROUP BY channel")).map(x => [x.channel, x.n]));
    counts.form = (await one("SELECT COUNT(*) n FROM messages WHERE status = 'open'")).n;
    const TA = await import('./textapply.js'), B = await import('./alpaca/broker.js');
    const apply = { ...TA.settings(), brokerEnabled: B.brokerEnabled(), aiReady: TA.aiReady(), open: (await one('SELECT COUNT(*) n FROM text_applications')).n };
    res.json({ items, counts, settings: s, apply, inboundUrl: `${base}/hooks/email/inbound?token=${s.emailToken || '(save settings to create)'}`, twilio: N.twilioEnabled(), number: process.env.TWILIO_FROM || null });
  });
  r.put('/apply', async (req, res) => { const s = await (await import('./textapply.js')).saveSettings(req.body || {}); await audit(req.user.id, 'text_apply_settings', s, req.ip); res.json(s); });
  r.put('/settings', async (req, res) => { const s = await saveSettings(req.body || {}); await audit(req.user.id, 'comms_settings', { forwardTo: !!s.forwardTo, aiSms: s.aiSms, aiEmail: s.aiEmail }, req.ip); res.json(s); });
  const item = async id => {
    if (String(id).startsWith('f')) { const m = await one('SELECT * FROM messages WHERE id = ?', +String(id).slice(1)); if (!m) throw bad('Not found', 404); return { id, form: m.id, channel: 'email', party: m.email, name: m.name, subject: m.subject, body: m.body }; }
    const m = await one('SELECT * FROM comms WHERE id = ?', +id); if (!m) throw bad('Not found', 404); return m;
  };
  r.get('/:id/thread', async (req, res) => { const m = await item(req.params.id); res.json({ item: m, thread: m.form ? [] : await all('SELECT * FROM comms WHERE party = ? ORDER BY id DESC LIMIT 30', m.party) }); });
  r.post('/:id/draft', async (req, res) => { const m = await item(req.params.id); res.json(await draft({ ...m, channel: ['sms', 'call', 'voicemail'].includes(m.channel) ? 'sms' : 'email' }, m.form ? [] : await thread(m.channel, m.party))); });
  r.post('/:id/reply', async (req, res) => {
    const m = await item(req.params.id), body = String(req.body?.body || '').trim(), via = ['sms', 'email'].includes(req.body?.via) ? req.body.via : /@/.test(m.party) ? 'email' : 'sms';
    if (!body) throw bad('Write the reply');
    if (via === 'sms') { if (!/^\+\d{10,15}$/.test(m.party)) throw bad('This contact has no phone number'); await N.sendSms(m.party, body.slice(0, 1500)); }
    else { if (!/@/.test(m.party)) throw bad('This contact has no email address'); await N.sendEmail(m.party, `Re: ${m.subject || 'your message to Brightfolio'}`, body); }
    await record({ channel: via, direction: 'out', party: m.party, subject: via === 'email' ? `Re: ${m.subject || ''}` : null, body });
    if (m.form) await run("UPDATE messages SET status = 'done' WHERE id = ?", m.form); else await run("UPDATE comms SET status = 'done' WHERE id = ?", m.id);
    await audit(req.user.id, 'comms_reply', { via, to: m.party.replace(/.(?=.{4})/g, '•') }, req.ip);
    res.json({ ok: true });
  });
  r.post('/:id/done', async (req, res) => { const id = String(req.params.id); if (id.startsWith('f')) await run("UPDATE messages SET status = 'done' WHERE id = ?", +id.slice(1)); else await run("UPDATE comms SET status = 'done' WHERE id = ?", +id); res.json({ ok: true }); });
  r.post('/send', async (req, res) => {
    const to = String(req.body?.to || '').trim(), body = String(req.body?.body || '').trim();
    if (!to || !body) throw bad('Who to, and what to say?');
    if (/@/.test(to)) { await N.sendEmail(to, String(req.body.subject || 'A message from Brightfolio'), body); await record({ channel: 'email', direction: 'out', party: to.toLowerCase(), subject: req.body.subject, body }); }
    else { const p = normalizePhone(to); if (!/^\+\d{10,15}$/.test(p)) throw bad('Enter a phone with country code or an email'); await N.sendSms(p, body.slice(0, 1500)); await record({ channel: 'sms', direction: 'out', party: p, body }); }
    res.json({ ok: true });
  });
  return r;
})();
