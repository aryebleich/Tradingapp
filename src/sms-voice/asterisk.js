// Asterisk / FreeSWITCH adapter STUB. It documents what a self-hosted telephony backend has to provide
// and refuses to start against an unsafe address; the telephony calls themselves are not written.
// Implement the methods listed in adapter.js (an ARI application for Asterisk, mod_event_socket for
// FreeSWITCH) and register it; the core module does not change.
//
// Security rules this stub already enforces (checked when COMMS_PROVIDER=asterisk):
//   - The AMI / ARI / event-socket address (ASTERISK_ARI_URL) must be on a PRIVATE network or loopback,
//     never a public address. These management interfaces give full control of the phone system and
//     must never be reachable from the internet.
//   - Anything that is not loopback must use TLS (https:// or wss://) and a user name and password
//     (ASTERISK_ARI_USER, ASTERISK_ARI_PASSWORD, long and random).
//   - Browser audio (WebRTC) is served over WSS on the PBX, with TURN (see docs/COMMS_SETUP.md).
import net from 'node:net';
import { NotImplementedError } from './adapter.js';

const PRIVATE = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];
export function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.lan')) return true;
  if (net.isIPv4(h)) return PRIVATE.some(re => re.test(h));
  if (net.isIPv6(h)) return h === '::1' || /^f[cd]/.test(h) || h.startsWith('fe80');
  return false; // a public-looking name: refuse
}
export function assertSafeAsteriskConfig(env = process.env) {
  const raw = env.ASTERISK_ARI_URL;
  if (!raw) throw new Error('ASTERISK_ARI_URL is not set');
  let u; try { u = new URL(raw); } catch { throw new Error('ASTERISK_ARI_URL is not a valid URL'); }
  if (!isPrivateHost(u.hostname)) throw new Error('ASTERISK_ARI_URL must be a private-network address: Asterisk AMI/ARI must never be exposed to the public internet');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(u.hostname.replace(/^\[|\]$/g, ''));
  if (!loopback && !['https:', 'wss:'].includes(u.protocol)) throw new Error('ASTERISK_ARI_URL must use https:// or wss:// unless it is loopback');
  if (!env.ASTERISK_ARI_USER || !env.ASTERISK_ARI_PASSWORD || String(env.ASTERISK_ARI_PASSWORD).length < 16) throw new Error('Set ASTERISK_ARI_USER and a random ASTERISK_ARI_PASSWORD of at least 16 characters');
  return u;
}

export function createAsterisk(env = process.env) {
  const nope = what => () => { throw new NotImplementedError(`Asterisk ${what}`); };
  return {
    name: 'asterisk',
    configured: () => { try { assertSafeAsteriskConfig(env); return true; } catch { return false; } },
    verifyWebhook: () => ({ ok: false, reason: 'not_implemented' }), // refuse everything until a real check exists
    parseSmsEvent: nope('SMS parsing'), parseVoiceEvent: nope('call event parsing'),
    sendSms: nope('SMS sending (Asterisk has no SMS; use a SIP MESSAGE gateway)'),
    sipTarget: nope('softphone address (PJSIP endpoint)'),
    voiceCommand: nope('call commands (ARI channels/bridges)'), createWebRtcLogin: nope('WebRTC login (PJSIP endpoint + WSS)'),
  };
}
