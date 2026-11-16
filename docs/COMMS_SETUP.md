# SMS and voice module: setup guide

> **Update 2026-11-16: the feature flag system was removed** (CHANGELOG_AI.md). Wherever this page mentions a flag, read it as the feature being permanently on. The drawer shows for a user as soon as the owner assigns them a number; without a number every route answers 404.

Architecture and the compliance list: [COMMS_ARCHITECTURE.md](COMMS_ARCHITECTURE.md). The module is **off** until
a number is assigned to a user.

**Check the provider screens and API names against Telnyx's current documentation.** The steps below name Telnyx
menus and settings from memory (ASSUMPTIONS.md B-2); the build environment could not open developers.telnyx.com.
Where a step says "(verify)" it is the part most likely to have moved.

## 1. Environment (`.env.example` has the same list, all values empty)

| Variable | Needed for | Notes |
|---|---|---|
| `COMMS_PROVIDER` | all | `telnyx` (default) or `asterisk` (stub only) |
| `TELNYX_API_KEY` | send, calls, softphone login | a v2 API key from the Telnyx portal; server only, never in the browser |
| `TELNYX_PUBLIC_KEY` | webhooks | the account's public key (base64, 32 bytes, Ed25519) used to verify webhook signatures; without it every webhook is refused |
| `TELNYX_MESSAGING_PROFILE_ID` | send | the messaging profile the sending numbers belong to |
| `TELNYX_CREDENTIAL_CONNECTION_ID` | softphone | a credential connection (WebRTC / SIP) |
| `TURN_URLS`, `TURN_SECRET`, `STUN_URLS` | softphone behind NAT | `TURN_URLS` comma-separated (`turns:turn.example.com:5349?transport=tcp`); `TURN_SECRET` is the coturn `static-auth-secret` |
| `COMMS_QUIET_TZ`, `COMMS_QUIET_START`, `COMMS_QUIET_END` | quiet hours | default `America/New_York`, 21 and 8; start = end disables them (not advised) |
| `COMMS_SEND_PER_HOUR`, `COMMS_SEND_PER_DAY` | rate limit | per user, default 30 and 200 |
| `COMMS_RETENTION_DAYS` | housekeeping | metadata kept this long, default 365 |
| `COMMS_RECORDING` | calls | `off` (default) or `announce`; do not enable before legal review |
| `COMMS_HELP_TEXT`, `COMMS_HELP_REPLY` | HELP keyword | `COMMS_HELP_REPLY=off` if the provider already answers HELP / STOP itself (otherwise people get two replies) |
| `ASTERISK_ARI_URL`, `ASTERISK_ARI_USER`, `ASTERISK_ARI_PASSWORD` | asterisk only | private-network address, TLS, password of 16+ characters |
| `ENCRYPTION_KEY` | all | already required in production; it also encrypts the 72-hour delivery buffer |

Secrets go only in the host's environment (Render) or Admin → Keys, never in the repository or in chat.

## 2. Database migration

Nothing to run by hand. The tables are created by `src/db.js` when the server starts (`CREATE TABLE IF NOT EXISTS`,
five tables, see the architecture page). To check: `sqlite3 data/quantpocket.db ".tables" | tr ' ' '\n' | grep -E "sms_|call_|comms_"`
(use `DB_FILE` or your libSQL URL if set). Rollback of the schema is not needed: the tables are unused until a number is assigned,
and dropping them is `DROP TABLE comms_numbers, sms_messages, call_records, sms_consent, comms_webhook_events;`.

## 3. Try it locally, with no provider and no tunnel

```bash
npm run comms:sim -- keygen                        # writes .comms-sim-key.pem (git-ignored), prints TELNYX_PUBLIC_KEY=...
# put that line in .env (local only), plus COMMS_PROVIDER=telnyx and TELNYX_API_KEY=anything; then:
npm start
# sign in as the owner: assign a number to your own user (PUT /api/admin/sms-voice/numbers)
# give a user a number (admin only; the owner's session cookie is needed, easiest from the browser console):
#   fetch('/api/admin/sms-voice/numbers', {method:'PUT', headers:{'Content-Type':'application/json','X-Requested-With':'qp'},
#     body: JSON.stringify({number:'+18455550100', userId: 2, voiceMode:'ivr'})}).then(r=>r.json()).then(console.log)
# sign in as that user, open the app; the round button appears bottom right.
npm run comms:sim -- sms  --to +18455550100 --from +15551230001 --text "Hello"
npm run comms:sim -- sms  --to +18455550100 --from +15551230001 --text STOP
npm run comms:sim -- call --to +18455550100 --from +15551230001 --hangup
```

Expected: the text appears in the drawer and the badge shows 1; STOP shows as a note and blocks replies; the call shows
as a missed call. Sending a reply needs the provider (the simulator does not answer API calls), so a reply fails with
"The message could not be sent right now" until the section 5 link-up is done; the tests (`npm test`, `npm run comms:ui`)
use a fake provider for that.

## 4. Expose local webhooks to the provider (ngrok or Cloudflare Tunnel)

Telnyx needs a public https address. Use **one** of:

```bash
# ngrok (needs a free account and `ngrok config add-authtoken <token>` once)
ngrok http 3000                       # copy the https://<id>.ngrok-free.app address
# Cloudflare Tunnel, no account needed for a quick tunnel
cloudflared tunnel --url http://localhost:3000   # copy the https://<words>.trycloudflare.com address
```

Then set `PUBLIC_URL` to that address if you use features that build links, keep the server running, and give the
provider these two addresses (section 5): `https://<tunnel>/api/comms/webhooks/sms` and
`https://<tunnel>/api/comms/webhooks/voice`. Watch deliveries arrive in the server log (`POST /api/comms/webhooks/sms 200`);
a `401` means the signature check failed (wrong `TELNYX_PUBLIC_KEY`, or the body was changed by a proxy), a `404` means the
no number is assigned. Free tunnel addresses change on every restart; update the provider each time. Never leave a tunnel open
with a production key.

## 5. Link Telnyx (verify each step against the current Telnyx portal)

1. **API key and public key.** Portal → Auth / API keys: create a v2 key → `TELNYX_API_KEY`. The public key for webhook
   signatures is on the same area's "public key" page → `TELNYX_PUBLIC_KEY`.
2. **Messaging.** Messaging → Messaging Profiles → create one. Set its webhook URL to the `…/webhooks/sms` address. Assign
   the phone number(s) to the profile. `TELNYX_MESSAGING_PROFILE_ID` = its id.
3. **10DLC (US long numbers).** Messaging → Compliance / 10DLC: register your brand, then a campaign (use case, sample
   messages, opt-in and opt-out wording that matches this module: STOP / START / HELP), and attach the numbers. Unregistered US
   long-code traffic is filtered or blocked by carriers. Toll-free numbers use toll-free verification instead. Approval takes
   days to weeks: start early. The registration text is a legal item (architecture page, item 3).
4. **Voice.** Voice → Programmable Voice (Call Control) → create an application. Webhook API version v2, webhook URL = the
   `…/webhooks/voice` address. Assign the phone number to that application.
5. **Softphone.** Voice → SIP connections → create a **Credential connection** → `TELNYX_CREDENTIAL_CONNECTION_ID`. Install
   the browser SDK: the module does not bundle it (no new dependency). Build or download `@telnyx/webrtc`'s browser module and
   save it as `public/vendor/telnyx-webrtc.js` (it must export `TelnyxRTC`). Until it exists the Calls tab says the softphone
   is not installed.
6. **TURN.** Run coturn with `use-auth-secret` and `static-auth-secret=<TURN_SECRET>`, TLS on 5349, and open only the TURN
   ports (UDP/TCP 3478, TLS 5349, the relay port range). `TURN_URLS=turns:turn.example.com:5349?transport=tcp`.
7. **Number to user.** `PUT /api/admin/sms-voice/numbers` (admin session) with `{ "number": "+1…", "userId": N, "voiceMode": "ivr" | "softphone", "greeting": "…" }`.
   One number per user. `softphone` rings the user's open browser and falls back to the greeting when it is closed or unanswered.
8. **Users.** Assign a number to a small group of users first; the drawer appears only for them.

### Asterisk / FreeSWITCH instead of Telnyx

Only a stub exists. To build it: implement the methods in `src/sms-voice/adapter.js` for an ARI application (Asterisk) or
`mod_event_socket` (FreeSWITCH), register it in `src/sms-voice/index.js`, set `COMMS_PROVIDER=asterisk`. Keep AMI / ARI
and the event socket on a private network only (the adapter refuses public addresses, plain http and weak passwords). Serve
browser audio over **WSS with a valid certificate**, with TURN as in step 6.

## 6. Tests

```bash
npm test                    # includes test/comms.test.js: signatures, de-duplication, phone numbers, every webhook, SSE, consent, rate limits, privacy
npm run comms:ui            # the drawer in a real browser: keyboard, announcements, dialer, microphone refused, phone width, sign-out
npm run comms:sim -- …      # signed sample webhooks to a local server (section 3)
```

## 7. Production checklist

- [ ] Telnyx steps 1 to 6 done in a **test** account or sandbox first; a text and a call tried end to end with real numbers.
- [ ] 10DLC (or toll-free) registration approved before any real traffic.
- [ ] Site served over **HTTPS**; the PBX or provider media over **WSS**; TURN reachable (`turns:` on 5349).
- [ ] `TELNYX_PUBLIC_KEY` set, so webhook **signature verification is on** (without it every webhook returns 401); webhook URLs are the production ones.
- [ ] Secrets only in the host environment; **rotate** the Telnyx API key and `TURN_SECRET` after any test with a tunnel, and on a schedule; `ENCRYPTION_KEY` set and backed up (losing it makes waiting texts unreadable).
- [ ] `COMMS_RECORDING` still `off` unless legal has signed off the notice wording and the states you serve.
- [ ] `COMMS_HELP_REPLY` matches whether the provider answers HELP / STOP itself (no double replies).
- [ ] Quiet hours and rate limits set for your traffic; legal review list in COMMS_ARCHITECTURE.md worked through.
- [ ] Privacy policy and terms updated (provider, retention, device-side history, recording, consent).
- [ ] Monitoring and alerts: webhook responses (alert on any 401 or 5xx on `/api/comms/webhooks/*`), the provider's delivery-failure rate, TURN availability, server log lines with `"src":"comms"` and `"event":"…_failed"`.
- [ ] More than one server instance? The rate limits and live streams are per instance (ASSUMPTIONS.md B-14): use one instance, sticky routing, or move them to a shared store first.
- [ ] Start by assigning numbers to a few users; watch for a day; widen.

## 8. Rollback

1. Remove the user's number (DELETE /api/admin/sms-voice/numbers/{number}) or clear the provider keys. Takes effect on the next request: the drawer stops loading,
   every `/api/comms/*` route and both webhooks answer 404, nothing else in the app changes.
2. Tell the provider to stop sending (clear the two webhook URLs), or let it retry and give up.
3. Waiting texts still erase themselves after 72 hours; metadata stays until retention removes it (or `DROP TABLE`, section 2).
4. To remove the code: revert the merge commit of `feature/comms-module`. The only edit to existing behaviour outside the
   module is `Permissions-Policy: microphone=(self)` in `server.js`; reverting restores `microphone=()`.
