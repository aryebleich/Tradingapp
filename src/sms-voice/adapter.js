// The provider adapter interface. The core module (core.js, routes.js) never talks to Telnyx,
// Asterisk or any other provider directly; it calls these six methods. To add a provider, write an
// object with the same methods, register it with registerAdapter(name, factory) in index.js, and
// set COMMS_PROVIDER=<name>. Nothing in the core changes.
//
//   name                  short id stored on every row ("telnyx")
//   configured()          true when its environment variables are set
//   verifyWebhook(rawBody, headers, nowMs?)
//                         -> { ok: true } | { ok: false, reason }. Must check the provider's signature
//                         on the RAW bytes and refuse old timestamps. Never throws.
//   parseSmsEvent(json)   -> null (not an SMS event) | {
//                           eventId, type: 'received' | 'status', messageId, direction: 'in' | 'out',
//                           from, to, text, status: 'queued' | 'sent' | 'delivered' | 'failed',
//                           errorCode, occurredAt }
//   parseVoiceEvent(json) -> null | {
//                           eventId, type: 'initiated' | 'answered' | 'speak_ended' | 'hangup',
//                           callId, sessionId, direction: 'in' | 'out', from, to, clientState,
//                           hangupCause, occurredAt }
//   sendSms({ from, to, text })
//                         -> { messageId, status }. Throws ProviderError on failure.
//   voiceCommand(callId, action, params)
//                         action is one of VOICE_ACTIONS: 'answer' | 'speak' | 'transfer' | 'hangup' |
//                         'record_start'. Throws ProviderError on failure.
//   createWebRtcLogin({ userId, existing })
//                         -> { credentialId, sipUsername, loginToken }: what the browser softphone
//                         needs to register. `existing` ({ credentialId, sipUsername }) is reused.
//   sipTarget(sipUsername) -> the address a call is transferred to so the browser softphone rings
//                         (for Telnyx a sip: URI).
export const VOICE_ACTIONS = ['answer', 'speak', 'transfer', 'hangup', 'record_start'];
const METHODS = ['configured', 'verifyWebhook', 'parseSmsEvent', 'parseVoiceEvent', 'sendSms', 'voiceCommand', 'createWebRtcLogin', 'sipTarget'];

export class ProviderError extends Error {
  constructor(message, { status = 502, code = null, retryable = false } = {}) { super(message); this.name = 'ProviderError'; Object.assign(this, { status, code, retryable }); }
}
export class NotImplementedError extends Error {
  constructor(what) { super(`${what} is not implemented by this provider adapter`); this.name = 'NotImplementedError'; this.status = 501; }
}

export function assertAdapter(a) {
  if (!a || typeof a.name !== 'string' || !a.name) throw new Error('A comms adapter needs a name');
  for (const m of METHODS) if (typeof a[m] !== 'function') throw new Error(`Comms adapter "${a.name}" is missing ${m}()`);
  return a;
}

const factories = new Map(), cache = new Map();
export const registerAdapter = (name, factory) => { factories.set(name, factory); cache.delete(name); };
export function getAdapter(name = process.env.COMMS_PROVIDER || 'telnyx') {
  if (!cache.has(name)) {
    const f = factories.get(name);
    if (!f) throw new Error(`Unknown comms provider "${name}". Known: ${[...factories.keys()].join(', ') || 'none registered'}`);
    cache.set(name, assertAdapter(f(process.env)));
  }
  return cache.get(name);
}
export const resetAdapters = () => cache.clear();
export const adapterNames = () => [...factories.keys()];
