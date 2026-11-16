// Telnyx adapter: SMS through the Messaging API, calls through Call Control, the browser softphone
// through Telephony Credentials (WebRTC).
//
// IMPORTANT: written without being able to open developers.telnyx.com from the build environment
// (the host could not be reached, see ASSUMPTIONS.md B-2). Every endpoint, field name and header
// below is from memory of Telnyx's documentation and MUST be checked against it before use:
//   Webhook signing        https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
//   Send a message         https://developers.telnyx.com/api/messaging/send-message
//   Call Control commands  https://developers.telnyx.com/docs/voice/programmable-voice/receiving-webhooks
//   Telephony credentials  https://developers.telnyx.com/docs/voice/webrtc
// Environment: TELNYX_API_KEY, TELNYX_PUBLIC_KEY (base64 Ed25519, from Mission Control), TELNYX_MESSAGING_PROFILE_ID,
// TELNYX_CREDENTIAL_CONNECTION_ID (the WebRTC credential connection), TELNYX_API_URL (tests only).
import crypto from 'node:crypto';
import { ProviderError, VOICE_ACTIONS } from './adapter.js';

const TOLERANCE_S = 300; // refuse a webhook whose timestamp is more than five minutes off
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex'); // DER prefix of a raw 32-byte Ed25519 public key

export function ed25519PublicKey(b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64');
  if (raw.length !== 32) throw new Error('TELNYX_PUBLIC_KEY must be the base64 of a 32-byte Ed25519 key');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' });
}

const SMS_STATUS = { queued: 'queued', sending: 'queued', sent: 'sent', delivered: 'delivered', delivery_unconfirmed: 'sent', delivery_failed: 'failed', sending_failed: 'failed' };
const toMs = s => { const t = Date.parse(s); return Number.isFinite(t) ? t : Date.now(); };
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function createTelnyx(env = process.env) {
  const base = () => (env.TELNYX_API_URL || 'https://api.telnyx.com/v2').replace(/\/$/, '');
  async function api(method, path, body, { text = false } = {}) {
    if (!env.TELNYX_API_KEY) throw new ProviderError('The messaging provider is not set up', { status: 503, code: 'not_configured' });
    let r;
    try {
      r = await fetch(base() + path, { method, headers: { Authorization: 'Bearer ' + env.TELNYX_API_KEY, 'Content-Type': 'application/json', Accept: text ? 'text/plain, application/json' : 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch (e) { throw new ProviderError('The messaging provider could not be reached', { status: 503, code: e.name, retryable: true }); }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      const e0 = d.errors?.[0] || {};
      throw new ProviderError('The messaging provider refused the request', { status: r.status, code: str(e0.code) || null, retryable: r.status === 429 || r.status >= 500 });
    }
    return text ? r.text() : r.json().catch(() => ({}));
  }

  return {
    name: 'telnyx',
    configured: () => !!(env.TELNYX_API_KEY && env.TELNYX_PUBLIC_KEY),

    // Telnyx signs `${timestamp}|${raw body}` with Ed25519 and sends the signature (base64) in
    // telnyx-signature-ed25519 and the timestamp in telnyx-timestamp.
    verifyWebhook(rawBody, headers = {}, nowMs = Date.now()) {
      if (!env.TELNYX_PUBLIC_KEY) return { ok: false, reason: 'no_public_key' };
      const sig = headers['telnyx-signature-ed25519'], ts = headers['telnyx-timestamp'];
      if (!sig || !ts) return { ok: false, reason: 'missing_headers' };
      if (!/^\d{9,12}$/.test(String(ts)) || Math.abs(nowMs / 1000 - +ts) > TOLERANCE_S) return { ok: false, reason: 'timestamp' };
      let key; try { key = ed25519PublicKey(env.TELNYX_PUBLIC_KEY); } catch { return { ok: false, reason: 'bad_public_key' }; }
      const sigBuf = Buffer.from(String(sig), 'base64');
      if (sigBuf.length !== 64) return { ok: false, reason: 'signature' };
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
      let ok = false;
      try { ok = crypto.verify(null, Buffer.concat([Buffer.from(`${ts}|`), body]), key, sigBuf); } catch { ok = false; }
      return ok ? { ok: true } : { ok: false, reason: 'signature' };
    },

    parseSmsEvent(json) {
      const d = json?.data;
      // Only the events the module acts on; any other message.* type is ignored, not guessed at.
      if (!d || !['message.received', 'message.sent', 'message.finalized'].includes(d.event_type)) return null;
      const p = d.payload || {}, to0 = Array.isArray(p.to) ? p.to[0] : null;
      const received = d.event_type === 'message.received';
      return {
        eventId: str(d.id), type: received ? 'received' : 'status', messageId: str(p.id),
        direction: p.direction === 'inbound' ? 'in' : 'out',
        from: str(p.from?.phone_number), to: str(to0?.phone_number), text: received ? str(p.text) : '',
        status: received ? 'received' : d.event_type === 'message.sent' ? 'sent' : SMS_STATUS[to0?.status] || 'sent',
        errorCode: p.errors?.[0]?.code != null ? str(p.errors[0].code) : null, occurredAt: toMs(d.occurred_at),
      };
    },

    parseVoiceEvent(json) {
      const d = json?.data, TYPES = { 'call.initiated': 'initiated', 'call.answered': 'answered', 'call.speak.ended': 'speak_ended', 'call.hangup': 'hangup' };
      if (!d || typeof d.event_type !== 'string' || !d.event_type.startsWith('call.')) return null;
      const type = TYPES[d.event_type]; if (!type) return null;
      const p = d.payload || {};
      return {
        eventId: str(d.id), type, callId: str(p.call_control_id), sessionId: str(p.call_session_id),
        direction: p.direction === 'incoming' ? 'in' : 'out', from: str(p.from), to: str(p.to),
        clientState: str(p.client_state), hangupCause: str(p.hangup_cause) || null, occurredAt: toMs(d.occurred_at),
      };
    },

    async sendSms({ from, to, text }) {
      const body = { from, to, text, type: 'SMS' };
      if (env.TELNYX_MESSAGING_PROFILE_ID) body.messaging_profile_id = env.TELNYX_MESSAGING_PROFILE_ID;
      const d = await api('POST', '/messages', body);
      const id = d?.data?.id;
      if (!id) throw new ProviderError('The messaging provider gave no message id', { status: 502, code: 'no_id' });
      return { messageId: str(id), status: SMS_STATUS[d.data.to?.[0]?.status] || 'queued' };
    },

    async voiceCommand(callId, action, params = {}) {
      if (!VOICE_ACTIONS.includes(action)) throw new ProviderError('Unknown call command', { status: 400, code: 'bad_action' });
      if (!/^[\w.:=-]{8,200}$/.test(String(callId))) throw new ProviderError('Bad call id', { status: 400, code: 'bad_call_id' });
      return api('POST', `/calls/${encodeURIComponent(callId)}/actions/${action}`, params);
    },

    sipTarget: sipUsername => `sip:${sipUsername}@sip.telnyx.com`,

    async createWebRtcLogin({ userId, existing } = {}) {
      let credentialId = existing?.credentialId, sipUsername = existing?.sipUsername;
      if (!credentialId) {
        if (!env.TELNYX_CREDENTIAL_CONNECTION_ID) throw new ProviderError('The softphone is not set up', { status: 503, code: 'not_configured' });
        const d = await api('POST', '/telephony_credentials', { connection_id: env.TELNYX_CREDENTIAL_CONNECTION_ID, name: `qp-user-${userId}`, tag: `qp-user-${userId}` });
        credentialId = d?.data?.id; sipUsername = d?.data?.sip_username;
        if (!credentialId || !sipUsername) throw new ProviderError('The provider gave no softphone credential', { status: 502, code: 'no_credential' });
      }
      const token = await api('POST', `/telephony_credentials/${encodeURIComponent(credentialId)}/token`, undefined, { text: true });
      return { credentialId: str(credentialId), sipUsername: str(sipUsername), loginToken: str(token).trim() };
    },
  };
}
