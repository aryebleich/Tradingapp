# SMS and voice module (Project B): architecture

Branch `feature/comms-module` (stacked on `feature/stripe-audit`; not merged, not deployed).
Feature flag `comms_drawer`, **off by default**. Provider: Telnyx (the brief's default), behind an adapter.
Setup, local testing and the production checklist: [COMMS_SETUP.md](COMMS_SETUP.md). Choices made without asking:
ASSUMPTIONS.md, section B.

**What was and was not verified.** Everything below is tested against fakes: a fake Telnyx API, a fake
Telnyx browser SDK, and webhook payloads signed with a throwaway Ed25519 key. Telnyx's documentation could not be
opened from the build environment (ASSUMPTIONS.md B-2), so every Telnyx endpoint, field and header name is from
memory and **must be checked against developers.telnyx.com before a real number is connected**. No call or text
has gone through a real provider, and the WebRTC softphone has not been exercised against Telnyx.

## Parts

```
browser (public/pages/comms.js, comms.css)         server (src/sms-voice/)                         provider
 Comms Drawer ── EventSource /api/comms/events ◄──  sse.js  ◄── core.js ◄── routes.js ◄── webhooks ── Telnyx
   Texts tab  ── POST /api/comms/sms/send ───────►  core.sendSms ──► adapter.sendSms ───────────────► Messaging API
   Calls tab  ── POST /api/comms/calls/outbound ►   core.startOutboundCall                           
   softphone  ◄── WebRTC (provider SDK, TURN) ──────────────────────────────────────────────────────► Telnyx WebRTC
   IndexedDB: this device's copy of the texts        SQLite/libSQL: metadata only
```

| File | Job |
|---|---|
| `src/sms-voice/adapter.js` | The interface every provider implements, the registry, `ProviderError`. |
| `src/sms-voice/telnyx.js` | Telnyx adapter: Ed25519 signature check, event parsing, send, Call Control commands, WebRTC login. |
| `src/sms-voice/asterisk.js` | Asterisk / FreeSWITCH **stub**: documents the interface and refuses an unsafe (public, non-TLS, weak-password) address. |
| `src/sms-voice/core.js` | Sending rules (consent, quiet hours, rate limits), inbound ingestion, STOP / START / HELP, call state machine, pending-delivery buffer, TURN credentials, housekeeping. |
| `src/sms-voice/routes.js` | HTTP: the two raw-body webhooks, the signed-in user's API, the admin API. |
| `src/sms-voice/sse.js` | One stream per user (at most 5 tabs), heartbeat every 25 s. |
| `src/sms-voice/phone.js` | E.164 validation, last-4 masking. |
| `public/pages/comms.js`, `public/comms.css` | The drawer. Starts only when `/api/comms/status` says `enabled`. |

## Adapter interface (`src/sms-voice/adapter.js`)

```
name                                   short id stored on every row
configured()                           environment is set
verifyWebhook(rawBody, headers, now?)  -> { ok } | { ok:false, reason }   signature on the RAW bytes; refuses old timestamps; never throws
parseSmsEvent(json)                    -> null | { eventId, type:'received'|'status', messageId, direction, from, to, text, status, errorCode, occurredAt }
parseVoiceEvent(json)                  -> null | { eventId, type:'initiated'|'answered'|'speak_ended'|'hangup', callId, sessionId, direction, from, to, clientState, hangupCause, occurredAt }
sendSms({ from, to, text })            -> { messageId, status }                 throws ProviderError
voiceCommand(callId, action, params)   action: answer | speak | transfer | hangup | record_start          throws ProviderError
createWebRtcLogin({ userId, existing })-> { credentialId, sipUsername, loginToken }
sipTarget(sipUsername)                 -> where to transfer a call so the browser rings
```

To add a provider (Twilio, Vonage, a SIP trunk, Asterisk): write an object with these methods, register it in
`src/sms-voice/index.js` (`registerAdapter('name', factory)`), set `COMMS_PROVIDER=name`. `core.js` and
`routes.js` do not change; `test/comms.test.js` proves it by registering a fake adapter.

## Data (migration in `src/db.js`, run automatically at start; all `CREATE TABLE IF NOT EXISTS`)

| Table | Holds | Indexes |
|---|---|---|
| `comms_numbers` | which number belongs to which user, voice mode (`ivr` or `softphone`), greeting, softphone credential id and SIP user | `number` PK, unique `user_id` |
| `sms_messages` | one row per text: user, provider, **provider message id**, direction, thread key, last 4 digits, our number, status, error code, timestamps, and `pending_body` (see below) | unique `(provider, provider_message_id)` (de-duplication); `(user_id, thread_key, created_at)`; partial index on waiting text |
| `call_records` | one row per call: user, provider call id, direction, thread key, last 4, status, handling, stage, `seen`, started / answered / ended, duration | unique `(provider, provider_call_id)`; `(user_id, started_at)` |
| `sms_consent` | per user and recipient: `opted_in` / `opted_out`, source, last time they wrote to us | PK `(user_id, thread_key)` |
| `comms_webhook_events` | event ids seen (replay / duplicate protection), trimmed after 7 days | `id` PK |

**Not stored:** message text, recordings, call audio, the other person's full number. The other party is a keyed
hash (`thread_key`, HMAC of user and number with the server's secret) plus the last four digits. An inbound text
waits, encrypted (AES-256-GCM, the app's `ENCRYPTION_KEY`), in `sms_messages.pending_body` until the browser confirms
it saved it (`POST /sms/ack`), at most 72 hours, then it is erased. The history lives in the browser (IndexedDB, one
database per user, deleted at sign-out). A new device starts with an empty inbox. Metadata rows are deleted after
`COMMS_RETENTION_DAYS` (365). Logs carry event names, ids, status codes and counts only (tested).

## Endpoints

| Endpoint | Auth | Does |
|---|---|---|
| `POST /api/comms/webhooks/sms` | provider signature | Verify (Ed25519 over `timestamp|body`, 5-minute tolerance) -> parse -> claim the event id (duplicate = `{duplicate:true}`) -> write the row -> **answer 200** -> then live update, auto-reply, provider commands. 401 bad signature, 400 bad JSON, 404 module off, 429 more than 1,200 per minute per address. A failure while writing returns 500 and frees the event id so the provider's retry is processed. |
| `POST /api/comms/webhooks/voice` | provider signature | Same pipeline. `call.initiated` routes the call: browser softphone (transfer to its SIP address, only if the user's drawer is open) or the IVR greeting (answer, speak, hang up). Telnyx Call Control is command based: the 200 carries no instructions; the instructions are the API commands issued right after. |
| `POST /api/comms/sms/send` | session + CSRF header | E.164 check, 1 to 1,600 characters, own number assigned, per-user rate limit (30/hour, 200/day), consent, quiet hours, provider call, status row. Errors carry a `code`: `bad_number`, `empty`, `too_long`, `no_number`, `own_number`, `rate_limited` (429), `consent_required` (428), `opted_out` (403), `quiet_hours` (403, with `resumesAt`), `provider_error` (502). Provider status events (`sent`, `delivered`, `failed`) only move a message forward. |
| `GET /api/comms/events` | session | Server-Sent Events: `ready`, `sms.received`, `sms.status`, `sms.optout`, `sms.optin`, `call.incoming`, `call.answered`, `call.ended`, `call.missed`. On connect it replays anything still waiting. |
| `POST /api/comms/sms/ack` | session | The browser has the texts; erase them from the server. |
| `POST /api/comms/calls/outbound` | session | Registers a web-dialer call (returns `callRef`, `clientState`, `callerNumber`) so its provider events can be matched to the user. |
| `POST /api/comms/webrtc/login` | session, https in production | Softphone login token (credential created once, then reused) and ICE servers with short-lived TURN credentials. |
| `GET /api/comms/status`, `/summary`, `/calls`, `POST /calls/seen` | session | Flag state; unread counts; call history; mark missed calls seen. |
| `GET/PUT/DELETE /api/admin/sms-voice…` | admin | List providers and numbers; assign a number to a user and choose `ivr` or `softphone`. |

All user endpoints answer 404 unless the flag is on for that user (percentage rollout by user id), 401 when signed
out, and share a 600-per-10-minutes per-user ceiling.

## Real-time

Server-Sent Events, authenticated by the session cookie, one stream per user, up to five tabs (the oldest is
closed), a `: ping` comment every 25 seconds, `res.flush()` after each write so the app's compression middleware
does not hold events back. The browser's `EventSource` reconnects by itself; the drawer shows "Reconnecting…".

## Compliance and security (what the code enforces)

| Area | Rule in the code |
|---|---|
| Consent (SMS) | The first text to a number needs the sender's confirmation that the person agreed (`attest`), stored per user and recipient with its source (`user_attested`, `inbound_reply`, `inbound_start`). A recipient who texts first counts as consenting to replies in that thread. |
| STOP / START / HELP | Whole-message `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT` block all further texts to that person from that user (403 `opted_out`) and are not stored; only `START` or `UNSTOP` lifts it. `HELP` and `INFO` get an automatic reply with the help text ("Msg and data rates may apply. Reply STOP to unsubscribe."; switch off with `COMMS_HELP_REPLY=off` if the provider replies itself). |
| Quiet hours | No first-contact text from 21:00 to 08:00 in `COMMS_QUIET_TZ` (default New York); replies to someone who wrote in the last 24 hours are allowed. See the legal list: this is a single zone, not the recipient's. |
| 10DLC | Not code: US long-code traffic must be registered (brand and campaign) with the provider before real texts flow. See COMMS_SETUP.md. |
| Call recording | **Off by default.** `COMMS_RECORDING=announce` plays "This call may be recorded." to the caller and then asks the provider to record; recordings stay at the provider, the app never downloads, links or stores them. All-party-consent states: legal list. |
| Emergency calls | Not supported; the dialer says so, and the server only accepts E.164 numbers (`+1911` is rejected). |
| Asterisk / FreeSWITCH | AMI / ARI / event-socket must stay on a private network: the adapter refuses a public host, plain http (except loopback) and passwords under 16 characters. Never publish these ports. Browser audio needs HTTPS and WSS on the PBX plus TURN (below). |
| Browser audio | The softphone login is refused over plain http in production (426). The microphone is asked for only when a call is placed or answered; refusal, no device, insecure page and unsupported browser each get a plain message. `Permissions-Policy` changed from `microphone=()` to `microphone=(self)` (same origin only; camera and geolocation stay off). |
| TURN / NAT | `TURN_URLS` + `TURN_SECRET` give each login short-lived credentials (coturn REST scheme: `expiry:userId` and base64 HMAC-SHA1), so no permanent TURN password reaches a browser. `STUN_URLS` is optional. |
| Rate limits | Webhooks per address; send, call and softphone-login per user; the whole user API per user; SSE connects per user. In-memory: one server instance (B-14). |
| Signature verification | Before any parsing or database write; tested with bad, missing, old, future, altered, wrong-key and malformed signatures. |
| Privacy | No message text, call audio or recordings stored; no full phone numbers or text in logs; the browser copy is deleted at sign-out. |

## Accessibility (WCAG 2.2 AA), checked in a real browser (`npm run comms:ui`)

Keyboard: the button opens the drawer, focus moves to its heading, Escape closes it and focus returns; tabs use
arrow keys with a roving tab index; the keypad is real buttons; Ctrl/Cmd+Enter sends. Announcements: a polite live
region for new texts, sent texts, call state and missed calls, an assertive one for incoming calls and microphone
errors. Words as well as colour for message status ("Sending…", "Delivered", "Not delivered") and call kind. 44 by 44
pixel targets and a full-screen sheet at phone width, checked by the test. Error colour and buttons are chosen for 4.5:1
text contrast in light and dark. Logical CSS properties, so right-to-left pages mirror. Reduced motion respected.

## Legal and compliance review list (US assumed; UK / EU flagged)

1. **TCPA / CTIA (US).** Consent evidence: the module records an attestation by the sender, not the recipient's own
   opt-in. Marketing texts need prior express written consent; confirm whether this module may be used for anything
   other than conversational, user-initiated messages.
2. **Quiet hours.** Federal rule 8 am to 9 pm *recipient local time*; Florida, Oklahoma, Maryland, Washington and others are
   stricter. The module uses one configured zone, not the recipient's. Needs recipient-timezone logic (area code or
   address) if it will text across the US.
3. **10DLC / toll-free registration, carrier content rules (SHAFT), opt-in wording** on the sign-up path.
4. **Call recording consent.** California, Florida, Illinois, Maryland, Massachusetts, Montana, New Hampshire,
   Pennsylvania, Washington and others require all-party consent. "This call may be recorded" then continuing may be
   enough in some states and not others. Recording is off; do not enable it before review.
5. **Record keeping.** If any user of this module is a regulated financial firm (broker-dealer, RIA), business
   communications may have to be archived (SEC 17a-4, FINRA 4511 / 3110). The module deliberately keeps no content.
   Brightolio's own status is an open question in LEGAL_REVIEW.md (L6).
6. **Privacy notices.** The privacy policy should list the provider, the 72-hour delivery buffer, the 365-day metadata
   retention and that history is kept on the device. CCPA / CPRA and state privacy laws apply to the metadata.
7. **Emergency calling.** Interconnected VoIP rules (E911, Kari's Law, RAY BAUM'S Act) apply to services that let
   users call 911. The dialer does not and says so; confirm the wording.
8. **Caller ID and STIR / SHAKEN.** Outbound calls show the user's assigned number; the number must be owned by the
   account and registered for attestation by the provider.
9. **UK / EU.** PECR and ePrivacy (opt-in for marketing, sender and caller identification), GDPR (lawful basis, data
   processing agreement and transfer safeguards for a US provider, data-subject rights, a DPIA for call and message
   data), recording consent is stricter than the US default, sender ID registration rules differ by country.
10. **Accessibility.** WCAG 2.2 AA is the target; ADA / Section 508 exposure if the module is offered to the public.
11. **Spoken and written wording** used by the module: the help text, "This call may be recorded.", the default
    voicemail-style greeting, the consent line, the STOP / START notes. Yiddish and other translations are not done.
