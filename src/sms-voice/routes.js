// HTTP surface of the SMS and voice module:
//   mountCommsWebhooks(app)   POST /api/comms/webhooks/sms and /voice. Called BEFORE the JSON parser:
//                             the provider's signature is checked on the raw bytes.
//   commsRouter               under /api/comms, for the signed-in user (the Comms Drawer)
//   commsAdminRouter          under /api/admin/sms-voice: assign phone numbers to users
// Everything is off (404) until the owner switches the comms_drawer flag on.
import express from 'express';
import { rateLimit, requireUser } from '../auth.js';
import * as core from './core.js';
import * as sse from './sse.js';
import { getAdapter } from './adapter.js';
import './index.js'; // registers the adapters

// ---------- provider webhooks (no session; the signature is the credential) ----------
async function webhook(kind, req, res) {
  if (!core.moduleOn()) return res.status(404).end();
  if (!rateLimit(`comms:hook:${req.ip}`, 1200, 60e3)) return res.status(429).end();
  let adapter; try { adapter = getAdapter(); } catch { return res.status(503).json({ error: 'not configured' }); }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const v = adapter.verifyWebhook(raw, req.headers);
  if (!v.ok) { core.clog('warn', 'webhook_rejected', { kind, reason: v.reason, provider: adapter.name }); return res.status(401).json({ error: 'bad signature' }); }
  let json; try { json = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad payload' }); }
  let ev = null; try { ev = kind === 'sms' ? adapter.parseSmsEvent(json) : adapter.parseVoiceEvent(json); } catch { ev = null; }
  if (!ev) return res.json({ received: true, ignored: 'event' });
  let r;
  try { r = kind === 'sms' ? await core.ingestSms(ev, adapter) : await core.ingestVoice(ev, adapter); }
  catch (e) {
    core.clog('error', 'ingest_failed', { kind, reason: e?.name });
    await core.releaseClaim(ev, kind).catch(() => {}); // so the provider's retry is processed, not dropped as a duplicate
    return res.status(500).json({ error: 'error' });
  }
  res.json({ received: true, ...(r.outcome === 'duplicate' ? { duplicate: true } : {}) }); // answer first ...
  setImmediate(() => core.runAfter(r.after));                                                 // ... then live updates and provider commands
}
let maintenance = null;
export function mountCommsWebhooks(app) {
  const raw = express.raw({ type: () => true, limit: '256kb' });
  app.post('/api/comms/webhooks/sms', raw, (req, res) => webhook('sms', req, res));
  app.post('/api/comms/webhooks/voice', raw, (req, res) => webhook('voice', req, res));
  if (!maintenance) { maintenance = setInterval(() => core.purge().catch(() => {}), 10 * 60e3); maintenance.unref?.(); }
}

// ---------- the signed-in user ----------
export const commsRouter = express.Router();
const fail = (res, e) => {
  if (!e.status) core.clog('error', 'route_failed', { reason: e?.name });
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong', ...(e.code ? { code: e.code } : {}), ...(e.extra || {}) });
};
const route = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => fail(res, e));
// 404 unless the module is on for this user; 429 past a generous per-user ceiling.
const gate = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!core.moduleOn() || !core.userOn(req.user)) return res.status(404).json({ error: 'Not found' });
  if (!rateLimit(`comms:api:${req.user.id}`, 600, 600e3)) return res.status(429).json({ error: 'Too many requests', code: 'rate_limited' });
  next();
};

// Always answers for a signed-in user, so the app can ask once after sign-in without a 404 in the console.
commsRouter.get('/status', requireUser, route(async (req, res) => {
  const on = core.moduleOn() && core.userOn(req.user);
  if (!on) return res.json({ enabled: false });
  let configured = false; try { configured = getAdapter().configured(); } catch {}
  const row = await (await import('../db.js')).one('SELECT number, voice_mode FROM comms_numbers WHERE user_id = ?', req.user.id);
  res.json({ enabled: true, configured, number: row?.number || null, voiceMode: row?.voice_mode || null, recording: core.cfg().recording });
}));

commsRouter.get('/events', gate, (req, res) => {
  if (!rateLimit(`comms:sse:${req.user.id}`, 120, 600e3)) return res.status(429).json({ error: 'Too many connections', code: 'rate_limited' });
  sse.subscribe(req, res, req.user.id);
  core.pendingFor(req.user.id).then(async list => {
    for (const m of list) sse.send(res, 'sms.received', { ...m, pending: true });
    sse.send(res, 'ready', { at: Date.now(), ...(await core.summary(req.user.id)) });
  }).catch(() => {});
});
commsRouter.get('/summary', gate, route(async (req, res) => res.json(await core.summary(req.user.id))));
commsRouter.post('/sms/send', gate, route(async (req, res) => res.json(await core.sendSms(req.user, req.body))));
commsRouter.post('/sms/ack', gate, route(async (req, res) => res.json({ acked: await core.ackMessages(req.user.id, req.body?.ids) })));
commsRouter.get('/calls', gate, route(async (req, res) => res.json({ calls: await core.callHistory(req.user.id) })));
commsRouter.post('/calls/seen', gate, route(async (req, res) => res.json({ seen: await core.markCallsSeen(req.user.id) })));
commsRouter.post('/calls/outbound', gate, route(async (req, res) => res.json(await core.startOutboundCall(req.user, req.body?.to))));
commsRouter.post('/webrtc/login', gate, route(async (req, res) => {
  // Microphone audio needs a secure page; refuse to hand out softphone credentials over plain http in production.
  if (process.env.NODE_ENV === 'production' && !req.secure) return res.status(426).json({ error: 'The softphone needs https.', code: 'https_required' });
  res.json(await core.webRtcLogin(req.user));
}));

// ---------- admin ----------
export const commsAdminRouter = express.Router(); // mounted under /api/admin, which already requires an admin
commsAdminRouter.get('/', route(async (req, res) => {
  let provider = null, configured = false; try { const a = getAdapter(); provider = a.name; configured = a.configured(); } catch {}
  res.json({ on: core.moduleOn(), provider, configured, numbers: await core.listNumbers(), settings: (({ quietStart, quietEnd, quietTz, recording, sendPerHour, sendPerDay, retentionDays }) => ({ quietStart, quietEnd, quietTz, recording, sendPerHour, sendPerDay, retentionDays }))(core.cfg()) });
}));
commsAdminRouter.put('/numbers', route(async (req, res) => res.json(await core.assignNumber(req.body || {}))));
commsAdminRouter.delete('/numbers/:number', route(async (req, res) => res.json({ removed: await core.removeNumber(String(req.params.number)) })));
