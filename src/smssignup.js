// Sign up by text: anyone who texts the business number and has no account gets the welcome, replies
// with an email (plus an optional 5-digit referral code) and has a free account at once, tied to
// the phone that texted (Twilio's signed From number proves it). Afterwards a ticker is enough.
// Each user also gets a 5-digit referral code that works by text (MY CODE shows it).
import { one, run, now, audit } from './db.js';
import { createUser } from './auth.js';
import { randomToken, sha256 } from './crypto.js';
import { normalizePhone, siteGet } from './site.js';
import { sendEmail } from './notify.js';

const site = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'https://app.brightolio.com').replace(/\/$/, '');
const EMAIL = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

export const welcome = () => `📊 Welcome to Brightolio!
Get stock prices, charts, earnings dates and company info by text, free.

To sign up, reply with your email address.
Have a 5-digit referral code? Add it after your email.
Example: name@example.com 12345

Reply HELP for help, TALK to reach a person, APPLY to open a brokerage account. Msg & data rates may apply. Reply STOP to opt out.`;

export const ready = (email, plan = 'free') => `✅ You're in! Your free Brightolio account (${email}) is ready, with $100,000 of practice money.

Text any ticker, for example AAPL.
More: AAPL CHART · AAPL EARNINGS · AAPL NEWS · AAPL INFO
Lists: WATCH AAPL · LIST · ALERT AAPL 250
Your plan: PLAN · Invite friends: MY CODE · All commands: HELP

We emailed you a link to set a password for the app: ${site()}/app`;

// A unique 5-digit referral code for a user, made the first time it is needed.
export async function refNumFor(userId) {
  const u = await one('SELECT ref_num FROM users WHERE id = ?', userId);
  if (u?.ref_num) return u.ref_num;
  for (let i = 0; i < 30; i++) {
    const code = String(10000 + Math.floor(Math.random() * 90000));
    if (await one('SELECT 1 FROM users WHERE ref_num = ?', code)) continue;
    const r = await run('UPDATE users SET ref_num = ? WHERE id = ? AND ref_num IS NULL', code, userId).catch(() => ({ changes: 0 }));
    if (r.changes) return code;
    const again = await one('SELECT ref_num FROM users WHERE id = ?', userId);
    if (again?.ref_num) return again.ref_num;
  }
  throw new Error('Could not make a referral code');
}
export const userByRefNum = code => (/^\d{5}$/.test(String(code || '')) ? one('SELECT id, ref_code FROM users WHERE ref_num = ?', String(code)) : null);

// "name@example.com 12345" → { email, code }; anything else → null.
export function parseSignup(text) {
  const m = EMAIL.exec(String(text || ''));
  if (!m) return null;
  const rest = String(text).replace(m[1], ' ');
  const code = /(?:^|\D)(\d{5})(?!\d)/.exec(rest)?.[1] || null;
  return { email: m[1].toLowerCase(), code };
}

export async function setPasswordEmail(userId, email) {
  const token = randomToken();
  await run('UPDATE users SET reset_hash = ?, reset_expires = ? WHERE id = ?', sha256(token), now() + 7 * 864e5, userId);
  await sendEmail(email, 'Welcome to Brightolio: set your password',
    `Your Brightolio account was opened by text from your phone.\n\nTo use the website and the app too, choose a password (link valid for 7 days):\n${site()}/app#/reset?token=${token}\n\nBy text, just send a ticker like AAPL. If you did not sign up, reply to this email and we will remove the account.`).catch(e => console.warn('sms signup email', e.message));
}

// The reply for a number that has no account. Returns null when the message is for someone else
// (TALK goes to the inbox).
export async function handleSignup(from, text) {
  const phone = normalizePhone(from), t = String(text || '').trim();
  if (/^talk\b/i.test(t)) return null;
  if (siteGet('smsSignup', { enabled: true })?.enabled === false) return null;
  const p = parseSignup(t);
  if (!p) return welcome();
  if (p.email.length > 120 || /\.invalid$/i.test(p.email)) return 'That email does not look right. Reply with your email address, for example: name@example.com';
  if (await one('SELECT 1 FROM users WHERE email = ?', p.email)) return `${p.email} already has a Brightolio account. To use it by text, sign in at ${site()}/app and add this phone in Settings → Phone. Or reply with a different email.`;
  const referrer = p.code ? await userByRefNum(p.code) : null;
  if (p.code && !referrer) return `We could not find referral code ${p.code}. Check it and send your email again, or send just your email to sign up without a code.`;
  const id = await createUser({ email: p.email, ref: referrer?.ref_code || null });
  await run('UPDATE users SET phone = NULL WHERE phone = ? AND phone_verified = 0', phone);
  await run('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?', phone, id);
  await audit(id, 'sms_signup', { referred: !!referrer }, phone);
  await setPasswordEmail(id, p.email);
  return ready(p.email);
}
