// Sends signed, Telnyx-shaped webhooks to a local server, so the SMS and voice module can be tried
// without Telnyx or a public address (docs/COMMS_SETUP.md, "Try it locally").
//
//   node scripts/comms-webhook-sim.mjs keygen                      make a throwaway Ed25519 key; prints the line for .env
//   node scripts/comms-webhook-sim.mjs sms  --to +18455550100 --from +15551230001 --text "Hello"
//   node scripts/comms-webhook-sim.mjs call --to +18455550100 --from +15551230001 [--hangup]
//   node scripts/comms-webhook-sim.mjs sms  --to +18455550100 --from +15551230001 --text STOP
//   options: --url http://localhost:3000   --key .comms-sim-key.pem
// The server must have TELNYX_PUBLIC_KEY set to the public key that `keygen` prints (never your real
// Telnyx key), COMMS_PROVIDER=telnyx and the comms_drawer flag on. The private key file is ignored by git.
import crypto from 'node:crypto';
import fs from 'node:fs';

const [, , cmd = 'help', ...rest] = process.argv;
const opt = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? (rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[i + 1]) : d; };
const keyFile = opt('key', '.comms-sim-key.pem'), base = String(opt('url', 'http://localhost:3000')).replace(/\/$/, '');

if (cmd === 'keygen') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Private key written to ${keyFile} (keep it out of git; .gitignore covers .comms-sim-key.pem).\nPut this in the server's environment, for local testing only:\n\nTELNYX_PUBLIC_KEY=${publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')}`);
  process.exit(0);
}
if (!['sms', 'call'].includes(cmd)) { console.log('Usage: keygen | sms --to N --from N --text T | call --to N --from N [--hangup]   (see the top of this file)'); process.exit(cmd === 'help' ? 0 : 1); }
if (!fs.existsSync(keyFile)) { console.error(`No ${keyFile}: run "keygen" first.`); process.exit(1); }
const priv = crypto.createPrivateKey(fs.readFileSync(keyFile));
const to = String(opt('to', '')), from = String(opt('from', '+15551230001'));
if (!/^\+[1-9]\d{7,14}$/.test(to)) { console.error('--to must be the module number in E.164, like +18455550100'); process.exit(1); }

const evt = (type, payload) => ({ data: { event_type: type, id: crypto.randomUUID(), occurred_at: new Date().toISOString(), record_type: 'event', payload }, meta: { attempt: 1 } });
async function post(kind, payload) {
  const body = JSON.stringify(payload), ts = Math.floor(Date.now() / 1000);
  const sig = crypto.sign(null, Buffer.from(`${ts}|${body}`), priv).toString('base64');
  const r = await fetch(`${base}/api/comms/webhooks/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'telnyx-timestamp': String(ts), 'telnyx-signature-ed25519': sig }, body });
  console.log(`${kind} ${payload.data.event_type} -> ${r.status} ${await r.text()}`);
}
if (cmd === 'sms') {
  await post('sms', evt('message.received', { id: crypto.randomUUID(), direction: 'inbound', type: 'SMS', from: { phone_number: from }, to: [{ phone_number: to, status: 'webhook_delivered' }], text: String(opt('text', 'Hello from the simulator')), media: [] }));
} else {
  const callId = 'sim-leg-' + crypto.randomBytes(6).toString('hex'), session = 'sim-sess-' + crypto.randomBytes(6).toString('hex');
  const call = type => evt(type, { call_control_id: callId, call_session_id: session, direction: 'incoming', from, to });
  await post('voice', call('call.initiated'));
  if (opt('hangup', false)) { await new Promise(r => setTimeout(r, 500)); await post('voice', call('call.hangup')); }
}
